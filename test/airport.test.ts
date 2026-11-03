import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "@engine/game/runlog";
import { applyAction } from "@engine/game/actions";
import { gameTick } from "@engine/game/tick";
import { SIM_DT } from "@engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";
import { goodsFares } from "@engine/game/fares";
import { roadPath, routeSummaries } from "@engine/game/world";
import { airportDemand, airportFlows, airportSummary, airportTravellersPerDay } from "@engine/game/airport";
import type { GameTuning, GameWorld } from "@engine/game/types";

// The airport (airport.ts; five-modes.md, 2. Airport): the third gateway, demand at a point with
// no people -- there on day 1 on a long dirt road, its travellers stranded until you reach it.

const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 8703, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, startingFunds: 2e5, ...overrides });
const days = (w: GameWorld, n: number) => { for (let i = 0; i < Math.round((n * D) / SIM_DT); i += 1) gameTick(w, SIM_DT); };

describe("the airport (airport.ts; five modes scoped, the airport)", () => {
  test("there on day 1, well outside the home city, on a long dirt road; no people of its own", () => {
    const w = start();
    const a = w.towns.get(w.airport!)!;
    const city = w.towns.get(w.port!)!;
    expect(a.industry).toBe("airport");
    expect(a.population).toBe(0);
    const away = Math.hypot(a.x - city.x, a.y - city.y);
    expect(away).toBeGreaterThanOrEqual(17);
    expect(away).toBeLessThanOrEqual(31);
    const road = w.simulation.map.segments.find((s) => s.id === "airport-road")!;
    expect(road.surface).toBe("dirt");
    expect(roadPath(w, a.id, city.id)!.distance).toBeGreaterThanOrEqual(17);
  }, 120_000);

  test("a few hundred travellers a day each way, rising with the region's people; air freight a few tonnes", () => {
    const w = start();
    const each = airportTravellersPerDay(w);
    expect(each).toBeGreaterThan(100);
    expect(each).toBeLessThan(600);
    const pairs = airportDemand(w);
    const into = pairs.filter((p) => p.from === w.airport).reduce((s, p) => s + p.rate, 0) * D;
    const out = pairs.filter((p) => p.to === w.airport).reduce((s, p) => s + p.rate, 0) * D;
    expect(into).toBeCloseTo(each, 6);
    expect(out).toBeCloseTo(each, 6);
    for (const t of w.towns.values()) if (!t.industry) t.population *= 1.5;
    expect(airportTravellersPerDay(w)).toBeCloseTo(each * 1.5, 6);
    const freight = airportFlows(w).reduce((s, f) => s + f.rate, 0) * D;
    expect(freight).toBeGreaterThan(4);
    expect(freight).toBeLessThan(20);
  }, 120_000);

  test("unserved, its trips show as wanted and not made; a bus line from it carries them, and pays", () => {
    const left = start();
    days(left, 6);
    const before = airportSummary(left)!;
    expect(before.tripsPerDay).toBeGreaterThan(100);
    expect(before.stranded).toBeGreaterThan(0.3);
    expect(before.you).toBe(0);
    const served = start();
    for (let i = 0; i < 3; i += 1) expect(applyAction(served, { kind: "bus", a: served.airport!, b: served.port! }).ok).toBe(true);
    days(served, 6);
    const after = airportSummary(served)!;
    expect(after.you).toBeGreaterThan(0.08);
    expect(routeSummaries(served).find((r) => r.a === served.airport || r.b === served.airport)!.netPerDay).toBeGreaterThan(0);
  }, 240_000);

  test("air freight pays its rate the tonne: 8x the goods rate on your freight train", () => {
    const w = start();
    const to = airportFlows(w)[0]!.to;
    const entry = (from: string) => ({ kind: "supplies" as const, entry: { from, to, kind: "supplies" as const, amount: 10 }, amount: 10 });
    const air = goodsFares(w, [entry(w.airport!)]);
    // The same tonnes over the same road from the home city, at the usual rate, scaled to the distance.
    const usual = goodsFares(w, [entry(w.port!)]);
    const dAir = roadPath(w, w.airport!, to)?.distance ?? 1, dUsual = roadPath(w, w.port!, to)?.distance ?? 1;
    if (dUsual > 0) expect(air / dAir).toBeCloseTo((usual / dUsual) * (w.tuning.airFreightRate ?? 8), 6);
  }, 120_000);

  test("absent in games played before it", () => {
    const w = start({ airportEnabled: false });
    expect(w.airport).toBeUndefined();
    expect(airportDemand(w)).toEqual([]);
  }, 120_000);
});
