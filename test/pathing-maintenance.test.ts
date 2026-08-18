import { describe, expect, test } from "bun:test";
import {
  BASE_COST_PER_CELL,
  MAINTENANCE_FRACTION_OF_BUILD,
  REFERENCE_COST_PER_METRE,
  maintenanceCost,
  profileCostMultiplier,
  sumStepCosts,
} from "@engine/pathing/cost";
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

describe("profileCostMultiplier", () => {
  test("the reference profile costs exactly what the pre-profile pricing did", () => {
    expect(profileCostMultiplier(REFERENCE_COST_PER_METRE)).toBe(1);
  });

  test("twice the cost per metre is twice the price -- it is a ratio, not an absolute", () => {
    expect(profileCostMultiplier(REFERENCE_COST_PER_METRE * 2)).toBe(2);
  });
});

describe("sumStepCosts with a profile multiplier", () => {
  const steps = [{ base: 100, gradient: 40, water: 20, density: 10 }];

  test("scales the per-length terms", () => {
    const doubled = sumStepCosts(steps, 0, 1, 2);
    expect(doubled.base).toBe(200);
    expect(doubled.gradient).toBe(80);
    expect(doubled.water).toBe(40);
    expect(doubled.density).toBe(20);
  });

  // costPerMeter is a price per metre of alignment and has no claim on a
  // point cost: a junction is a junction whichever surface meets there.
  test("does not scale node cost, which the era multiplier still does", () => {
    expect(sumStepCosts(steps, 2, 1, 5).nodes).toBe(sumStepCosts(steps, 2, 1, 1).nodes);
    expect(sumStepCosts(steps, 2, 3, 1).nodes).toBe(sumStepCosts(steps, 2, 1, 1).nodes * 3);
  });

  test("the breakdown still sums to its own total -- it is shown as a receipt", () => {
    const breakdown = sumStepCosts(steps, 3, 1.5, 2.5);
    expect(breakdown.total).toBeCloseTo(
      breakdown.base + breakdown.gradient + breakdown.water + breakdown.density + breakdown.nodes,
      6,
    );
  });

  test("era and profile multipliers compose on the per-length terms", () => {
    expect(sumStepCosts(steps, 0, 2, 3).base).toBe(sumStepCosts(steps, 0, 1, 1).base * 6);
  });
});
