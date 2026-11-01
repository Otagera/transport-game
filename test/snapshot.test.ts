import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { applyAction, type ActionSpec } from "@engine/game/actions";
import { RUN_FORMAT, replayRun, replayRunSteps, startRun, type RunFile } from "@engine/game/runlog";
import { restoreSnapshot, snapshotOf } from "@engine/game/snapshot";
import { gameTick } from "@engine/game/tick";
import { SIM_DT } from "@engine/loop";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import type { GameWorld } from "@engine/game/types";

// Saved games (snapshot.ts, src/game/saves.ts): a world kept and opened again runs on exactly as it
// would have, and a run opened by another build replays a step at a time to the same world.
const SWITCHES = { all: false, goodsOff: false, wearOff: false };
const DAY = Math.round(SECONDS_PER_GAME_DAY / SIM_DT);
const run = (world: GameWorld, ticks: number) => { for (let i = 0; i < ticks; i += 1) gameTick(world, SIM_DT); };
/** A bus between the home city and the first town a road reaches: corridors to judge. */
function firstBus(world: GameWorld): ActionSpec {
  const towns = [...world.towns.values()].filter((t) => !t.industry).sort((a, b) => b.population - a.population);
  for (const b of towns.slice(1)) {
    const spec: ActionSpec = { kind: "bus", a: towns[0]!.id, b: b.id };
    if (applyAction(structuredClone(world), spec).ok) return spec;
  }
  throw new Error("no bus route on this map");
}

describe("saved games", () => {
  test("a kept world, opened again, runs on exactly as the one it was kept from", () => {
    const world = startRun(GAME_MAP, 2418, SWITCHES, null);
    expect(applyAction(world, firstBus(world)).ok).toBe(true);
    run(world, Math.round(DAY * 1.4));
    const kept = restoreSnapshot(structuredClone(snapshotOf(world)));
    // On past the corridors' next judging (once a game day), each on its own.
    run(world, Math.round(DAY * 1.3));
    run(kept, Math.round(DAY * 1.3));
    expect(kept.economy).toEqual(world.economy);
    expect(kept.corridors).toEqual(world.corridors);
    expect(kept.pairOutcomes).toEqual(world.pairOutcomes);
    expect(kept.simulation.vehicles.map((v) => [v.id, v.cargo])).toEqual(world.simulation.vehicles.map((v) => [v.id, v.cargo]));
  }, 120_000);

  test("a run replayed a step at a time is the run replayed at once", () => {
    const world = startRun(GAME_MAP, 101, SWITCHES, null);
    const action = firstBus(world);
    const file: RunFile = { format: RUN_FORMAT, version: 1, savedAt: "", seed: 101, switches: SWITCHES, devFunds: null, ticks: DAY, tuning: structuredClone(world.tuning), actions: [{ tick: 40, day: 1, action }], days: [] };
    const steps = replayRunSteps(GAME_MAP, file);
    let step = steps.next();
    let progress = 0;
    while (!step.done) {
      expect(step.value).toBeGreaterThanOrEqual(progress);
      progress = step.value;
      step = steps.next();
    }
    const whole = replayRun(GAME_MAP, file);
    expect(step.value.economy).toEqual(whole.economy);
    expect(step.value.routes.map((r) => r.id)).toEqual(whole.routes.map((r) => r.id));
  }, 120_000);
});
