import { describe, expect, test } from "bun:test";
import { buildRoutingContext } from "@engine/simulation/routing";
import { createVehicle, tickVehicle } from "@engine/simulation/vehicle";
import type { GeneratedMap } from "@engine/map/types";
import type { NodeQueues, SegmentTraffic } from "@engine/simulation/types";

function fixtureMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: { width: 1, height: 1, elevation: new Float32Array(1), water: new Uint8Array(1), settlementDensity: new Float32Array(1) },
    nodes: [
      { id: "a", kind: "settlement", x: 0, y: 0 },
      { id: "b", kind: "village", x: 4, y: 0 },
    ],
    corridors: [{ id: "corridor-ab", nodeIds: ["a", "b"], polyline: [{ x: 0, y: 0 }, { x: 4, y: 0 }] }],
    segments: [
      { id: "s-ab", corridorId: "corridor-ab", fromNodeId: "a", toNodeId: "b", type: "road", level: "ground", condition: 1, provenance: "inherited" },
    ],
  };
}

describe("createVehicle", () => {
  test("expands waypoints into a full cyclic path", () => {
    const context = buildRoutingContext(fixtureMap());
    const vehicle = createVehicle("v1", ["a", "b"], context, 1, 10);
    expect(vehicle.path).toEqual(["a", "b"]);
    expect(vehicle.pathIndex).toBe(1);
    expect(vehicle.cargo).toEqual([]);
  });

  test("loads queued demand at its starting node before departing", () => {
    const context = buildRoutingContext(fixtureMap());
    const queues: NodeQueues = new Map([
      ["a", new Map([["b:passengers", 5]])],
      ["b", new Map()],
    ]);
    const vehicle = createVehicle("v1", ["a", "b"], context, 1, 10, queues);
    expect(vehicle.cargo).toEqual([{ from: "a", to: "b", kind: "passengers", amount: 5 }]);
    expect(queues.get("a")!.get("b:passengers")).toBe(0);
  });

  test("defaults to carrying passengers", () => {
    const context = buildRoutingContext(fixtureMap());
    const vehicle = createVehicle("v1", ["a", "b"], context, 1, 10);
    expect(vehicle.carries).toBe("passengers");
  });

  test("a goods vehicle ignores queued passenger demand and loads produce/supplies instead", () => {
    const context = buildRoutingContext(fixtureMap());
    const queues: NodeQueues = new Map([
      ["a", new Map([["b:passengers", 5], ["b:produce", 3]])],
      ["b", new Map()],
    ]);
    const vehicle = createVehicle("v1", ["a", "b"], context, 1, 10, queues, "goods");
    expect(vehicle.cargo).toEqual([{ from: "a", to: "b", kind: "produce", amount: 3 }]);
    expect(queues.get("a")!.get("b:passengers")).toBe(5); // untouched
  });

  test("a passenger vehicle ignores queued goods demand", () => {
    const context = buildRoutingContext(fixtureMap());
    const queues: NodeQueues = new Map([
      ["a", new Map([["b:produce", 3], ["b:supplies", 2]])],
      ["b", new Map()],
    ]);
    const vehicle = createVehicle("v1", ["a", "b"], context, 1, 10, queues, "passengers");
    expect(vehicle.cargo).toEqual([]);
  });
});

describe("tickVehicle", () => {
  test("delivers cargo on arrival and records segment traffic", () => {
    const context = buildRoutingContext(fixtureMap());
    const queues: NodeQueues = new Map([
      ["a", new Map([["b:passengers", 5]])],
      ["b", new Map()],
    ]);
    const vehicle = createVehicle("v1", ["a", "b"], context, 4, 10, queues);
    const traffic: Map<string, SegmentTraffic> = new Map();

    // speed 4 * dt 1s = 4 units = exactly one edge (a -> b, length 4).
    tickVehicle(vehicle, queues, context, traffic, new Map(), 1);

    expect(vehicle.cargo).toEqual([]);
    const segmentStats = traffic.get("s-ab")!;
    expect(segmentStats).toBeDefined();
    expect(segmentStats.deliveredRecently).toBe(5);
    expect(segmentStats.potentialRecently).toBe(10);
  });

  test("a vehicle with fewer than two path nodes does nothing", () => {
    const context = buildRoutingContext(fixtureMap());
    const vehicle = createVehicle("v1", ["a", "b"], context, 4, 10);
    vehicle.path = ["a"];
    const queues: NodeQueues = new Map([["a", new Map()]]);
    const traffic: Map<string, SegmentTraffic> = new Map();
    expect(() => tickVehicle(vehicle, queues, context, traffic, new Map(), 1)).not.toThrow();
  });
});
