import { describe, expect, test } from "bun:test";
import { buildRoutingContext } from "@engine/simulation/routing";
import { createVehicle, tickVehicle } from "@engine/simulation/vehicle";
import type { GeneratedMap } from "@engine/map/types";
import type { NodeQueues, PickupEvent, SegmentTraffic } from "@engine/simulation/types";

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

  test("records a pickup event for demand loaded during a tick, not at vehicle creation", () => {
    const context = buildRoutingContext(fixtureMap());
    const vehicle = createVehicle("v1", ["a", "b"], context, 4, 10); // no queues -- no initial load
    const queues: NodeQueues = new Map([
      ["a", new Map([["b:passengers", 6]])],
      ["b", new Map()],
    ]);
    const traffic: Map<string, SegmentTraffic> = new Map();
    const pickupEvents: PickupEvent[] = [];

    // dt=2s covers both edges (a->b, then b->a) at speed 4 over length-4
    // edges -- a full cyclic lap, so the vehicle reloads at "a" mid-tick,
    // not at creation.
    tickVehicle(vehicle, queues, context, traffic, new Map(), 2, new Map(), pickupEvents);

    expect(pickupEvents).toEqual([{ nodeId: "a", to: "b", vehicleId: "v1", kind: "passengers", amount: 6, lifecycle: "cyclic" }]);
  });
});

describe("cyclic loading wraps around the route", () => {
  // Regression: loadAt used to read only the tail of the path array, so on
  // an a<->b shuttle the vehicle standing at b never saw a as "ahead" and
  // ran every return leg empty.
  test("a two-stop shuttle carries the return direction too", () => {
    const context = buildRoutingContext(fixtureMap());
    const queues: NodeQueues = new Map([
      ["a", new Map([["b:passengers", 20]])],
      ["b", new Map([["a:passengers", 20]])],
    ]);
    const vehicle = createVehicle("v1", ["a", "b"], context, 1, 10, queues);
    const traffic = new Map<string, SegmentTraffic>();
    for (let t = 0; t < 40; t += 0.1) tickVehicle(vehicle, queues, context, traffic, new Map(), 0.1);
    expect(queues.get("a")!.get("b:passengers")).toBe(0);
    expect(queues.get("b")!.get("a:passengers")).toBe(0);
  });
});

describe("boarding is directional at mid-route stops", () => {
  // Regression: with "ahead" read as the whole cycle, a rider at x going to
  // a boarded a bus heading for b and rode all the way round.
  function lineMap(): GeneratedMap {
    const map = fixtureMap();
    map.nodes = [
      { id: "a", kind: "settlement", x: 0, y: 0 },
      { id: "x", kind: "settlement", x: 4, y: 0 },
      { id: "b", kind: "settlement", x: 8, y: 0 },
    ];
    map.segments = [
      { id: "s-ax", corridorId: "c1", fromNodeId: "a", toNodeId: "x", type: "road", level: "ground", condition: 1, provenance: "inherited" },
      { id: "s-xb", corridorId: "c2", fromNodeId: "x", toNodeId: "b", type: "road", level: "ground", condition: 1, provenance: "inherited" },
    ];
    return map;
  }

  test("a bus at x heading for b leaves x's riders for a waiting", () => {
    const context = buildRoutingContext(lineMap());
    const vehicle = createVehicle("v1", ["a", "b"], context, 1, 10); // path a, x, b, x
    const queues: NodeQueues = new Map([["a", new Map()], ["x", new Map([["a:passengers", 5], ["b:passengers", 5]])], ["b", new Map()]]);
    // Arrive at x on the way to b.
    tickVehicle(vehicle, queues, context, new Map(), new Map(), 4.01);
    expect(vehicle.path[vehicle.pathIndex]).toBe("b");
    expect(queues.get("x")!.get("b:passengers")).toBe(0);
    expect(queues.get("x")!.get("a:passengers")).toBe(5);
  });
});
