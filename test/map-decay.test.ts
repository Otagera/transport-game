import { describe, expect, test } from "bun:test";
import { BASE_DECAY_PER_SECOND, MIN_CONDITION, MIN_CONDITION_SPEED_FACTOR, conditionSpeedFactor, decaySegments } from "@engine/map/decay";
import type { GeneratedMap } from "@engine/map/types";

function fixtureMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: { width: 1, height: 1, elevation: new Float32Array(1), water: new Uint8Array(1), settlementDensity: new Float32Array(1) },
    nodes: [],
    corridors: [],
    segments: [
      { id: "s1", corridorId: "c1", fromNodeId: "a", toNodeId: "b", type: "road", level: "ground", condition: 1, provenance: "built" },
      { id: "s2", corridorId: "c1", fromNodeId: "b", toNodeId: "c", type: "road", level: "ground", condition: 1, provenance: "built" },
    ],
  };
}

describe("decaySegments", () => {
  test("reduces every segment's condition by the base rate times dt", () => {
    const map = fixtureMap();
    decaySegments(map, 10, 1);
    expect(map.segments[0]!.condition).toBeCloseTo(1 - BASE_DECAY_PER_SECOND * 10, 6);
    expect(map.segments[1]!.condition).toBeCloseTo(1 - BASE_DECAY_PER_SECOND * 10, 6);
  });

  test("decayMultiplier scales the rate linearly", () => {
    const map = fixtureMap();
    decaySegments(map, 10, 2);
    expect(map.segments[0]!.condition).toBeCloseTo(1 - BASE_DECAY_PER_SECOND * 10 * 2, 6);
  });

  test("floors at MIN_CONDITION rather than decaying toward zero", () => {
    const map = fixtureMap();
    decaySegments(map, 1_000_000, 1);
    expect(map.segments[0]!.condition).toBe(MIN_CONDITION);
  });
});

describe("conditionSpeedFactor", () => {
  test("full condition means no speed penalty", () => {
    expect(conditionSpeedFactor(1)).toBe(1);
  });

  test("floored condition applies the minimum speed factor", () => {
    expect(conditionSpeedFactor(MIN_CONDITION)).toBeCloseTo(
      MIN_CONDITION_SPEED_FACTOR + (1 - MIN_CONDITION_SPEED_FACTOR) * MIN_CONDITION,
      6,
    );
  });

  test("is a minor penalty, not a route-killing one -- never drops below the floor factor", () => {
    expect(conditionSpeedFactor(0)).toBe(MIN_CONDITION_SPEED_FACTOR);
  });
});

describe("decaySegments with profile multipliers", () => {
  function profiledMap(): GeneratedMap {
    const map = fixtureMap();
    map.segments[0]!.profileId = "expressway";
    map.segments[1]!.profileId = "feeder-road";
    return map;
  }
  const multipliers = new Map([
    ["expressway", 0.7],
    ["feeder-road", 1.6],
  ]);

  test("a well-built profile rots slower than a cheap one on the same map", () => {
    const map = profiledMap();
    decaySegments(map, 10, 1, multipliers);
    expect(map.segments[0]!.condition).toBeGreaterThan(map.segments[1]!.condition);
  });

  test("the profile and era multipliers compose -- an era decay spike still bites the cheap road harder", () => {
    const map = profiledMap();
    decaySegments(map, 10, 2, multipliers);
    expect(map.segments[0]!.condition).toBeCloseTo(1 - BASE_DECAY_PER_SECOND * 10 * 2 * 0.7, 6);
    expect(map.segments[1]!.condition).toBeCloseTo(1 - BASE_DECAY_PER_SECOND * 10 * 2 * 1.6, 6);
  });

  test("a segment with no profile decays at the base rate, exactly as before profiles existed", () => {
    const map = fixtureMap();
    decaySegments(map, 10, 1, multipliers);
    expect(map.segments[0]!.condition).toBeCloseTo(1 - BASE_DECAY_PER_SECOND * 10, 6);
  });

  test("a profile the map doesn't know about decays at the base rate rather than freezing or accelerating", () => {
    const map = fixtureMap();
    map.segments[0]!.profileId = "profile-from-a-mod-that-was-removed";
    decaySegments(map, 10, 1, multipliers);
    expect(map.segments[0]!.condition).toBeCloseTo(1 - BASE_DECAY_PER_SECOND * 10, 6);
  });

  test("still floors at MIN_CONDITION however fast the profile rots", () => {
    const map = profiledMap();
    decaySegments(map, 1_000_000, 5, multipliers);
    expect(map.segments[1]!.condition).toBe(MIN_CONDITION);
  });
});
