import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "./support/worlds"; // built once, copied after
import { applyAction } from "@engine/game/actions";
import { gameTick } from "@engine/game/tick";
import { SIM_DT } from "@engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";
import { goodsFares } from "@engine/game/fares";
import { roadPath, routeSummaries } from "@engine/game/world";
import { airportDemand, airportFlows, airportSummary, airportTravellersPerDay } from "@engine/game/airport";
import { airportAdvice } from "@engine/game/problems";
import type { GameTuning, GameWorld } from "@engine/game/types";

// The airport (airport.ts; five-modes.md, 2. Airport): the third gateway, demand at a point with
// no people -- there on day 1 on a long dirt road, its travellers stranded until you reach it.

const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 8703, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, startingFunds: 2e5, ...overrides });
const days = (w: GameWorld, n: number) => { for (let i = 0; i < Math.round((n * D) / SIM_DT); i += 1) gameTick(w, SIM_DT); };

describe("the airport (airport.ts; five modes scoped, the airport)", () => {
  test("there on day 1, well outside the home city, on a long dirt road worn to the floor; no people of its own", () => {
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
    // A poor road (the scope's brownfield): worn, as no other inherited road starts.
    expect(road.condition).toBeCloseTo(w.tuning.airportRoadCondition ?? 0.3, 6);
    expect(roadPath(w, a.id, city.id)!.distance).toBeGreaterThanOrEqual(17);
  }, 120_000);

  test("a few dozen travellers a day each way, rising faster than the region's people; air freight a few tonnes", () => {
    const w = start();
    // A few dozen a day each way on day 1, grown into (tuning.ts airportGrowthElasticity).
    const each = airportTravellersPerDay(w);
    expect(each).toBeGreaterThan(40);
    expect(each).toBeLessThan(300);
    const pairs = airportDemand(w);
    const into = pairs.filter((p) => p.from === w.airport).reduce((s, p) => s + p.rate, 0) * D;
    const out = pairs.filter((p) => p.to === w.airport).reduce((s, p) => s + p.rate, 0) * D;
    expect(into).toBeCloseTo(each, 6);
    expect(out).toBeCloseTo(each, 6);
    // The region half as big again: its people half again, and its prosperity on top of that.
    for (const t of w.towns.values()) if (!t.industry) t.population *= 1.5;
    expect(airportTravellersPerDay(w)).toBeCloseTo(each * Math.pow(1.5, 1 + (w.tuning.airportGrowthElasticity ?? 0)), 6);
    const freight = airportFlows(w).reduce((s, f) => s + f.rate, 0) * D;
    expect(freight).toBeGreaterThan(4);
    expect(freight).toBeLessThan(20);
  }, 120_000);

  test("unserved, its trips show as wanted and not made; a bus from it costs more on its worn road, and pays once the region has grown", () => {
    const left = start();
    days(left, 6);
    const before = airportSummary(left)!;
    expect(before.tripsPerDay).toBeGreaterThan(80);
    expect(before.stranded).toBeGreaterThan(0.3);
    expect(before.you).toBe(0);
    // One bus, its road as it is (worn) or kept up; on day 1, or with the region grown a quarter.
    // The road is what reaching it costs besides the bus, and the region's growth what it's worth
    // (2026-11-04; engine.md, The airport).
    const line = (keep: boolean, grown: number) => {
      const w = start();
      for (const t of w.towns.values()) if (!t.industry) t.population *= grown;
      if (keep) expect(applyAction(w, { kind: "fix", segmentId: "airport-road", on: true }).ok).toBe(true);
      expect(applyAction(w, { kind: "bus", a: w.airport!, b: w.port! }).ok).toBe(true);
      days(w, 8);
      const r = routeSummaries(w).find((x) => x.a === w.airport || x.b === w.airport)!;
      return { you: airportSummary(w)!.you, net: r.netPerDay, cost: r.costPerDay };
    };
    const worn = line(false, 1), kept = line(true, 1), grown = line(true, 1.25);
    expect(worn.you).toBeGreaterThan(0.05);
    // The worn road's toll is on the bus: a good deal more a day to run (up to 70%, wear.ts).
    expect(worn.cost).toBeGreaterThan(kept.cost * 1.4);
    // On day 1 it's about break-even kept up; grown a quarter, the travellers more than double and it pays.
    expect(Math.abs(kept.net)).toBeLessThan(60);
    // (+₦20 before trunks; with them, okadas off the old highways, ₦19.9 on this map: the margin is the test's, not the game's.)
    expect(grown.net).toBeGreaterThan(kept.net + 10);
    expect(grown.net).toBeGreaterThan(0);
  }, 360_000);

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

  test("its card says why its travellers aren't carried, and the move for that (map 5059 playtest)", () => {
    // Unserved: no line of yours, and the move is a line from it.
    const left = start();
    days(left, 3);
    const none = airportAdvice(left)!;
    expect(none.lines).toBe(0);
    expect(none.why).toContain("no line of yours");
    expect(["bus", "minibus", "train"]).toContain(none.move!.action.kind);
    // Served by a bus: the lost have a road and found no seat, and the card says what the line makes.
    const w = start();
    expect(applyAction(w, { kind: "bus", a: w.airport!, b: w.port! }).ok).toBe(true);
    days(w, 4);
    const advice = airportAdvice(w)!;
    expect(advice.lines).toBe(1);
    expect(advice.why).toContain("no seat");
    expect(advice.why).toMatch(/1 vehicle on 1 line to it (makes|loses) ₦\d+ a day/);
    // A train is named only where it would carry enough: to the town at the track's end, or on
    // from it by your lines. Its travellers spread over the region (40 a day the most to any one
    // town here), so with no line on from the home city a train there isn't the move.
    expect(advice.move!.action.kind).not.toBe("train");
  }, 240_000);

  test("absent in games played before it", () => {
    const w = start({ airportEnabled: false });
    expect(w.airport).toBeUndefined();
    expect(airportDemand(w)).toEqual([]);
  }, 120_000);
});
