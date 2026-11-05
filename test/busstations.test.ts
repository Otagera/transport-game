import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "./support/worlds"; // built once, copied after
import { applyAction } from "@engine/game/actions";
import { gameTick, queueKey } from "@engine/game/tick";
import { SIM_DT } from "@engine/loop";
import { changePatience, depotFactor } from "@engine/game/busstations";
import type { GameTuning, GameWorld } from "@engine/game/types";

// Your bus station (busstations.ts; brief, Your bus station): people changing lines wait there
// under cover, and it's the depot of the lines ending there.

const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 8703, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, startingFunds: 2e5, ...overrides });
const aTown = (w: GameWorld) => [...w.towns.values()].find((t) => !t.industry && t.id !== w.port)!.id;

describe("your bus station (busstations.ts)", () => {
  test("one a town, at its price; not at a site; absent in games played before it", () => {
    const w = start();
    const town = aTown(w);
    const funds = w.economy.funds;
    expect(applyAction(w, { kind: "busStation", townId: town }).ok).toBe(true);
    expect(funds - w.economy.funds).toBe(w.tuning.busStationCost!);
    expect(applyAction(w, { kind: "busStation", townId: town }).ok).toBe(false);
    expect(applyAction(w, { kind: "busStation", townId: w.airport! }).ok).toBe(false);
    const old = start({ busStationsEnabled: undefined });
    expect(applyAction(old, { kind: "busStation", townId: aTown(old) }).ok).toBe(false);
    expect(changePatience(old, aTown(old))).toBe(1);
  }, 120_000);

  test("riders changing lines there give up more slowly; riders starting there as anywhere", () => {
    const run = (station: boolean) => {
      const w = start();
      const town = aTown(w);
      const other = [...w.towns.values()].find((t) => !t.industry && t.id !== town && t.id !== w.port)!.id;
      if (station) expect(applyAction(w, { kind: "busStation", townId: town }).ok).toBe(true);
      const queue = w.simulation.queues.get(town)!;
      // Changing: on their way from the home city; starting: from the town itself.
      const changing = queueKey(other, w.port!), starting = queueKey(other, town);
      queue.set(changing, 100);
      queue.set(starting, 100);
      gameTick(w, SIM_DT);
      return { changing: queue.get(changing)!, starting: queue.get(starting)! };
    };
    const without = run(false), withIt = run(true);
    expect(withIt.changing).toBeGreaterThan(without.changing);
    expect(withIt.starting).toBeCloseTo(without.starting, 3);
  }, 120_000);

  test("its depot takes back a share of the rough roads' cost on lines ending there, none elsewhere", () => {
    const w = start();
    const town = aTown(w);
    const other = [...w.towns.values()].find((t) => !t.industry && t.id !== town)!.id;
    expect(depotFactor(w, town, other)).toBe(1);
    applyAction(w, { kind: "busStation", townId: town });
    expect(depotFactor(w, town, other)).toBeCloseTo(1 - w.tuning.busStationDepotShare!, 9);
    expect(depotFactor(w, other, other)).toBe(1);
  }, 120_000);
});
