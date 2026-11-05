import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "@engine/game/runlog";
import { carLoad, carsByProsperity, insideSplit } from "@engine/game/inside";
import { privateLoad, updatePrivateTraffic } from "@engine/game/private";
import type { GameTuning } from "@engine/game/types";

// The inside scale (inside.ts; docs/SCALES-AND-MODES.md, scope 3): a town's inside trips in four
// slices -- walk, keke and okada, your city line, car -- of which only the cars leave the town and
// load its approach roads; a city line takes its riders out of the cars and the informal in one
// stated ratio, so the shares add up and the roads get lighter.

const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 2418, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, ...overrides });
const towns = (w: ReturnType<typeof start>) => [...w.towns.values()].filter((t) => !t.industry);
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);

describe("the inside scale (inside.ts; the three scales, scope 3)", () => {
  test("four slices that add up: the walk falling as a town grows, its cars 4% on day 1 and rising with its growth", () => {
    const w = start();
    const ts = towns(w).sort((a, b) => a.population - b.population);
    for (const t of ts) {
      const s = insideSplit(w, t.id);
      close(s.walk + s.informal + s.line + s.car, 1);
      expect(s.car).toBeCloseTo(0.04, 6);
    }
    expect(insideSplit(w, ts[0]!.id).walk).toBeGreaterThan(insideSplit(w, ts[ts.length - 1]!.id).walk);
    // Grown a fifth: more of its trips by car (its growth is prosperity's, as its cars always were).
    const big = ts[ts.length - 1]!;
    big.population *= 1.2;
    expect(insideSplit(w, big.id).car).toBeGreaterThan(0.1);
  }, 60_000);

  test("with no city line, a town's cars on its roads are what they always were, however it grows", () => {
    const w = start();
    // To the last bit: a float's difference here tips a decision and the game drifts from the same game before.
    for (const t of towns(w)) expect(carLoad(w, t.id)).toBe(carsByProsperity(w, t.id));
    // Grown, prosperous: still exactly -- the cars come first, the walk gives way.
    for (const t of towns(w)) t.population *= 1.3;
    for (const t of towns(w)) expect(carLoad(w, t.id)).toBe(carsByProsperity(w, t.id));
  }, 60_000);

  test("a city line takes its riders out of the cars and the informal in the stated ratio, and its approach roads get lighter", () => {
    const w = start();
    const big = towns(w).sort((a, b) => b.population - a.population)[0]!;
    big.population *= 1.3; // a prosperous town: a car slice worth taking from
    const before = insideSplit(w, big.id);
    w.privateFlowAtSeconds = undefined; // worked out again now, with its growth
    updatePrivateTraffic(w);
    const roads = w.simulation.map.segments.filter((s) => s.type === "road" && (s.fromNodeId === big.id || s.toNodeId === big.id));
    const load = (ids = roads) => ids.reduce((sum, s) => sum + privateLoad(w, s.id), 0);
    const loaded = load();
    w.metros.set(big.id, 2);
    const after = insideSplit(w, big.id);
    close(after.walk + after.informal + after.line + after.car, 1);
    expect(after.line).toBeCloseTo(2 * w.tuning.metroLineShare, 6);
    // One partition, one subtraction: the cars give the stated share of the line, the informal the rest; nobody stops walking.
    close(before.car - after.car, (w.tuning.cityLineCarDraw ?? 0.5) * after.line);
    close(before.informal - after.informal, (1 - (w.tuning.cityLineCarDraw ?? 0.5)) * after.line);
    close(after.walk, before.walk);
    w.privateFlowAtSeconds = undefined;
    updatePrivateTraffic(w);
    expect(load()).toBeLessThan(loaded);
  }, 60_000);

  test("absent in games before it: a metro takes no cars off the roads", () => {
    const w = start({ insideEnabled: undefined });
    const big = towns(w).sort((a, b) => b.population - a.population)[0]!;
    big.population *= 1.3;
    w.metros.set(big.id, 2);
    expect(carLoad(w, big.id)).toBe(carsByProsperity(w, big.id));
  }, 60_000);
});
