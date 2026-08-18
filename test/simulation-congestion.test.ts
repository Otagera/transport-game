import { describe, expect, test } from "bun:test";
import { buildRoutingContext } from "@engine/simulation/routing";
import { createVehicle, tickVehicle } from "@engine/simulation/vehicle";
import { computeSegmentLoads, congestionFactor, FREE_SLOT_WEIGHT, MIN_CONGESTION_FACTOR } from "@engine/simulation/congestion";
import type { GeneratedMap } from "@engine/map/types";
import type { NodeQueues, SegmentTraffic } from "@engine/simulation/types";

function fixtureMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: { width: 1, height: 1, elevation: new Float32Array(1), water: new Uint8Array(1), settlementDensity: new Float32Array(1) },
    nodes: [
      { id: "a", kind: "settlement", x: 0, y: 0 },
      { id: "b", kind: "village", x: 10, y: 0 },
    ],
    corridors: [{ id: "corridor-ab", nodeIds: ["a", "b"], polyline: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
    segments: [
      { id: "s-ab", corridorId: "corridor-ab", fromNodeId: "a", toNodeId: "b", type: "road", level: "ground", condition: 1, provenance: "inherited" },
    ],
  };
}

describe("congestionFactor", () => {
  test("free first slot: no congestion up to FREE_SLOT_WEIGHT", () => {
    expect(congestionFactor(0)).toBe(1);
    expect(congestionFactor(FREE_SLOT_WEIGHT)).toBe(1);
  });

  test("decreases beyond the free slot and floors at MIN_CONGESTION_FACTOR", () => {
    const light = congestionFactor(FREE_SLOT_WEIGHT + 1);
    const heavy = congestionFactor(FREE_SLOT_WEIGHT + 20);
    expect(light).toBeLessThan(1);
    expect(heavy).toBeGreaterThanOrEqual(MIN_CONGESTION_FACTOR);
    expect(heavy).toBeLessThan(light);
    expect(congestionFactor(1000)).toBe(MIN_CONGESTION_FACTOR);
  });
});

describe("computeSegmentLoads", () => {
  test("sums per-vehicle congestion weight for vehicles on the same segment", () => {
    const context = buildRoutingContext(fixtureMap());
    const v1 = createVehicle("v1", ["a", "b"], context, 1, 10, undefined, "passengers", 1);
    const v2 = createVehicle("v2", ["a", "b"], context, 1, 10, undefined, "passengers", 2.5);
    const loads = computeSegmentLoads([v1, v2], context);
    expect(loads.get("s-ab")).toBeCloseTo(3.5, 5);
  });

  test("a vehicle with an incomplete path contributes no load", () => {
    const context = buildRoutingContext(fixtureMap());
    const v1 = createVehicle("v1", ["a", "b"], context, 1, 10);
    v1.path = ["a"];
    const loads = computeSegmentLoads([v1], context);
    expect(loads.size).toBe(0);
  });
});

describe("congestion effect on vehicle movement", () => {
  test("a congested segment slows a vehicle down relative to a free one", () => {
    const context = buildRoutingContext(fixtureMap());
    const queues: NodeQueues = new Map([
      ["a", new Map()],
      ["b", new Map()],
    ]);

    const free = createVehicle("free", ["a", "b"], context, 4, 10, queues);
    const congested = createVehicle("congested", ["a", "b"], context, 4, 10, queues);

    const traffic: Map<string, SegmentTraffic> = new Map();
    tickVehicle(free, queues, context, traffic, new Map(), 0.5);
    tickVehicle(congested, queues, context, traffic, new Map([["s-ab", 20]]), 0.5);

    expect(congested.edgeProgress).toBeLessThan(free.edgeProgress);
  });

  test("recordCrossing's reported potential capacity is scaled by the congestion factor", () => {
    const context = buildRoutingContext(fixtureMap());
    const queues: NodeQueues = new Map([
      ["a", new Map()],
      ["b", new Map()],
    ]);
    const vehicle = createVehicle("v1", ["a", "b"], context, 100, 10, queues); // fast enough to cross in one tick
    const traffic: Map<string, SegmentTraffic> = new Map();
    const heavyLoad = new Map([["s-ab", 20]]);

    tickVehicle(vehicle, queues, context, traffic, heavyLoad, 1);

    const stats = traffic.get("s-ab")!;
    expect(stats.potentialRecently).toBeCloseTo(10 * congestionFactor(20), 5);
    expect(stats.potentialRecently).toBeLessThan(10);
  });
});
