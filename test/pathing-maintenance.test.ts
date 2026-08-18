import { describe, expect, test } from "bun:test";
import { BASE_COST_PER_CELL, MAINTENANCE_FRACTION_OF_BUILD, maintenanceCost } from "@engine/pathing/cost";
import { MIN_CONDITION, decaySegments, restoreSegmentCondition } from "@engine/map/decay";
import type { GeneratedMap } from "@engine/map/types";

function fixtureMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: { width: 1, height: 1, elevation: new Float32Array(1), water: new Uint8Array(1), settlementDensity: new Float32Array(1) },
    nodes: [],
    corridors: [],
    segments: [
      { id: "s1", corridorId: "c1", fromNodeId: "a", toNodeId: "b", type: "road", level: "ground", condition: 1, provenance: "built" },
    ],
  };
}

describe("maintenanceCost", () => {
  test("a segment at full condition costs nothing to maintain", () => {
    expect(maintenanceCost(10, 0)).toBe(0);
  });

  test("is priced off the same BASE_COST_PER_CELL construction was -- never a second cost formula", () => {
    expect(maintenanceCost(10, 1)).toBeCloseTo(BASE_COST_PER_CELL * 10 * MAINTENANCE_FRACTION_OF_BUILD, 6);
  });

  test("scales linearly with the deficit actually being bought back", () => {
    expect(maintenanceCost(10, 0.5)).toBeCloseTo(maintenanceCost(10, 1) / 2, 6);
  });

  test("clamps a nonsense deficit rather than paying out or overcharging", () => {
    expect(maintenanceCost(10, -3)).toBe(0);
    expect(maintenanceCost(10, 5)).toBe(maintenanceCost(10, 1));
  });

  test("a fully-decayed segment never costs more than its floor deficit implies", () => {
    // Decay floors at MIN_CONDITION, so the worst a real segment can be is
    // a 1 - MIN_CONDITION deficit -- maintenance can never be asked to buy
    // back more than that.
    expect(maintenanceCost(10, 1 - MIN_CONDITION)).toBeLessThan(maintenanceCost(10, 1));
  });
});

describe("restoreSegmentCondition", () => {
  test("returns the deficit it actually restored, which is what gets priced", () => {
    const map = fixtureMap();
    decaySegments(map, 100, 1);
    const before = map.segments[0]!.condition;
    expect(restoreSegmentCondition(map, "s1")).toBeCloseTo(1 - before, 6);
    expect(map.segments[0]!.condition).toBe(1);
  });

  test("restoring an already-healthy segment restores nothing and therefore costs nothing", () => {
    const map = fixtureMap();
    expect(restoreSegmentCondition(map, "s1")).toBe(0);
    expect(maintenanceCost(10, restoreSegmentCondition(map, "s1"))).toBe(0);
  });

  test("an unknown segment id restores nothing rather than throwing mid-transaction", () => {
    expect(restoreSegmentCondition(fixtureMap(), "nope")).toBe(0);
  });
});
