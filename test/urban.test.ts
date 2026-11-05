import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "@engine/game/runlog";
import { applyAction } from "@engine/game/actions";
import { insideSplit, insideTrips } from "@engine/game/inside";
import { roadCapacity } from "@engine/game/congestion";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";
import { checkUrban, metroLines, runMetros, urbanGrowthShare, urbanKind, urbanRiders, urbanRung, URBAN_KINDS } from "@engine/game/metro";
import type { LaneState } from "@engine/game/pushback";
import type { GameTuning, GameWorld, UrbanKind } from "@engine/game/types";
import type { ActionResult } from "@engine/game/world";

// The urban ladder (metro.ts; docs/PROMPT-urban-ladder.md, its reason rewritten on the inside scale):
// light rail, the monorail and the metro on the town card, one kind a town; light rail sharing the
// street and stopped by a strike; each rung drawing its own share of its riders out of the cars.

const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 2418, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, startingFunds: 5e6, ...overrides });
const why = (r: ActionResult) => (r.ok ? "" : r.reason);
const towns = (w: GameWorld) => [...w.towns.values()].filter((t) => !t.industry).sort((a, b) => b.population - a.population);
const build = (w: GameWorld, townId: string, kind: UrbanKind) => applyAction(w, { kind: "metro", townId, ...(kind === "metro" ? {} : { mode: kind }) });
/** A town at a size, in a fresh world. */
const sized = (population: number, overrides: Partial<GameTuning> = {}) => {
  const w = start(overrides);
  const town = towns(w)[0]!;
  town.population = population;
  return { w, town };
};

describe("the urban ladder (metro.ts; PROMPT-urban-ladder.md)", () => {
  test("each kind's riders are its lines times its share of the town's inside trips, at one line and at the most", () => {
    for (const kind of URBAN_KINDS) {
      const { w, town } = sized(260);
      const rung = urbanRung(w, kind)!;
      const inside = insideTrips(w, town.id);
      for (let line = 1; line <= rung.maxLines; line += 1) {
        expect(build(w, town.id, kind).ok).toBe(true);
        if (line === 1 || line === rung.maxLines) expect(urbanRiders(w, town.id).riders).toBeCloseTo(line * rung.lineShare * inside, 6);
      }
      expect(urbanKind(w, town.id)).toBe(kind);
    }
  }, 120_000);

  test("one kind a town: a second kind is refused, by name", () => {
    const { w, town } = sized(260);
    expect(build(w, town.id, "lightrail").ok).toBe(true);
    const check = checkUrban(w, town.id, "metro");
    expect(check.ok).toBe(false);
    expect(why(check)).toBe(`${town.name} already has light rail`);
    expect(build(w, town.id, "monorail").ok).toBe(false);
    expect(build(w, town.id, "lightrail").ok).toBe(true); // its own kind, another line
  }, 60_000);

  test("population gates: a 100k town takes light rail, not the monorail or the metro", () => {
    const { w, town } = sized(100);
    expect(checkUrban(w, town.id, "lightrail").ok).toBe(true);
    expect(why(checkUrban(w, town.id, "monorail"))).toBe("a monorail needs a town of 150k");
    expect(why(checkUrban(w, town.id, "metro"))).toBe("a metro needs a town of 200k");
  }, 60_000);

  test("line caps: light rail and the monorail stop at 2, the metro at 3", () => {
    for (const [kind, most] of [["lightrail", 2], ["monorail", 2], ["metro", 3]] as const) {
      const { w, town } = sized(260);
      for (let n = 0; n < most; n += 1) expect(build(w, town.id, kind).ok).toBe(true);
      expect(metroLines(w, town.id)).toBe(most);
      expect(build(w, town.id, kind).ok).toBe(false);
    }
  }, 120_000);

  test("growth: each kind lifts the limit by its share times its lines over its most, nothing with none", () => {
    for (const kind of URBAN_KINDS) {
      const { w, town } = sized(260);
      const rung = urbanRung(w, kind)!;
      expect(urbanGrowthShare(w, town.id)).toBe(0);
      for (let n = 1; n <= rung.maxLines; n += 1) {
        build(w, town.id, kind);
        expect(urbanGrowthShare(w, town.id)).toBeCloseTo((rung.capShare * n) / rung.maxLines, 9);
      }
    }
  }, 120_000);

  test("a strike on its town's roads stops light rail, its running still paid; the monorail and the metro run on", () => {
    for (const kind of URBAN_KINDS) {
      const { w, town } = sized(260);
      build(w, town.id, kind);
      const road = w.simulation.map.segments.find((s) => s.type === "road" && (s.fromNodeId === town.id || s.toNodeId === town.id))!;
      const riders = urbanRiders(w, town.id).riders;
      expect(riders).toBeGreaterThan(0);
      w.lanes.push({ a: road.fromNodeId, b: road.toNodeId, strikeUntil: w.economy.elapsedSeconds + D, segmentIds: [road.id] } as unknown as LaneState);
      const rung = urbanRung(w, kind)!;
      const paid = runMetros(w, D);
      expect(paid.running).toBeCloseTo(rung.runningPerLine, 6);
      if (kind === "lightrail") {
        expect(urbanRiders(w, town.id).riders).toBe(0);
        expect(paid.fares).toBe(0);
        // Its riders back in the cars and on the okadas while it's stopped.
        expect(insideSplit(w, town.id).line).toBe(0);
      } else {
        expect(urbanRiders(w, town.id).riders).toBeCloseTo(riders, 9);
        expect(paid.fares).toBeCloseTo(riders * rung.fare, 6);
      }
    }
  }, 120_000);

  test("light rail takes 12% a line of the roads into its town, at each end; the monorail none", () => {
    const w = start();
    const isTown = (id: string) => !!w.towns.get(id) && !w.towns.get(id)!.industry;
    const road = w.simulation.map.segments.find((s) => s.type === "road" && isTown(s.fromNodeId) && isTown(s.toNodeId))!;
    const base = roadCapacity(w, road.id);
    const [a, b] = [w.towns.get(road.fromNodeId)!, w.towns.get(road.toNodeId)!];
    a.population = 260;
    b.population = 260;
    build(w, a.id, "lightrail");
    build(w, a.id, "lightrail");
    expect(roadCapacity(w, road.id) / base).toBeCloseTo(0.76, 9);
    build(w, b.id, "lightrail");
    build(w, b.id, "lightrail");
    expect(roadCapacity(w, road.id) / base).toBeCloseTo(0.76 * 0.76, 9);
    const m = start();
    const ma = m.towns.get(road.fromNodeId)!;
    ma.population = 260;
    build(m, ma.id, "monorail");
    build(m, ma.id, "monorail");
    expect(roadCapacity(m, road.id)).toBe(base);
  }, 60_000);

  test("old runs: a metro action with no mode builds a metro, written down nowhere new; a world saved before the ladder is all metros", () => {
    const { w, town } = sized(260);
    expect(applyAction(w, { kind: "metro", townId: town.id }).ok).toBe(true);
    expect(urbanKind(w, town.id)).toBe("metro");
    expect(w.urbanKinds!.size).toBe(0);
    delete (w as { urbanKinds?: unknown }).urbanKinds;
    expect(urbanKind(w, town.id)).toBe("metro");
    expect(urbanRiders(w, town.id).riders).toBeGreaterThan(0);
    // A run file before the ladder has no other rungs: only the metro.
    const old = sized(260, { urbanRungs: undefined });
    expect(checkUrban(old.w, old.town.id, "lightrail").ok).toBe(false);
    expect(checkUrban(old.w, old.town.id, "metro").ok).toBe(true);
  }, 60_000);

  test("the metro's numbers are the metro's as they were; each rung draws its own share of its riders out of the cars", () => {
    const w = start();
    const t = w.tuning;
    expect(urbanRung(w, "metro")).toEqual({
      minPopulation: t.metroMinPopulation, firstCost: t.metroCost, lineCost: t.metroLineCost, maxLines: t.metroMaxLines,
      lineShare: t.metroLineShare, fare: t.metroFare, runningPerLine: t.metroRunningPerLine, capShare: t.metroCapShare,
      roadCapacityPerLine: 0, stoppedByStrikes: false, carDraw: t.cityLineCarDraw ?? 0.5,
    });
    expect([t.metroMinPopulation, t.metroCost, t.metroLineCost, t.metroMaxLines, t.metroLineShare, t.metroFare, t.metroRunningPerLine, t.metroCapShare]).toEqual([200, 150000, 100000, 3, 0.15, 3, 300, 0.3]);
    // The ladder: light rail draws least from the cars, the metro most.
    const draws = URBAN_KINDS.map((k) => urbanRung(w, k)!.carDraw);
    expect(draws[0]!).toBeLessThan(draws[1]!);
    expect(draws[1]!).toBeLessThan(draws[2]!);
    for (const kind of URBAN_KINDS) {
      const { w: g, town } = sized(260);
      town.population = 260; // prosperous: grown past its start, a car slice to take from
      const before = insideSplit(g, town.id);
      build(g, town.id, kind);
      const after = insideSplit(g, town.id);
      expect(before.car - after.car).toBeCloseTo(urbanRung(g, kind)!.carDraw * after.line, 9);
    }
  }, 120_000);
});
