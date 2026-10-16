import { describe, expect, test } from "bun:test";
import { buildRoutingContext } from "@engine/simulation/routing";
import { createOneShotVehicle, hasCompletedTrip, tickVehicle } from "@engine/simulation/vehicle";
import type { GeneratedMap } from "@engine/map/types";
import type { NodeQueues, SegmentTraffic } from "@engine/simulation/types";

function fixtureMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: { width: 1, height: 1, elevation: new Float32Array(1), water: new Uint8Array(1), settlementDensity: new Float32Array(1) },
    nodes: [
      { id: "a", kind: "settlement", x: 0, y: 0 },
      { id: "b", kind: "village", x: 3, y: 0 },
      { id: "c", kind: "village", x: 6, y: 0 },
    ],
    corridors: [
      { id: "corridor-ab", nodeIds: ["a", "b"], polyline: [{ x: 0, y: 0 }, { x: 3, y: 0 }] },
      { id: "corridor-bc", nodeIds: ["b", "c"], polyline: [{ x: 3, y: 0 }, { x: 6, y: 0 }] },
    ],
    segments: [
      { id: "s-ab", corridorId: "corridor-ab", fromNodeId: "a", toNodeId: "b", type: "road", level: "ground", condition: 1, provenance: "inherited" },
      { id: "s-bc", corridorId: "corridor-bc", fromNodeId: "b", toNodeId: "c", type: "road", level: "ground", condition: 1, provenance: "inherited" },
    ],
  };
}

describe("createOneShotVehicle", () => {
  test("builds a one-way path, not a closed loop", () => {
    const context = buildRoutingContext(fixtureMap());
    const vehicle = createOneShotVehicle("p1", "a", "c", context, 5, 1, 0.4, new Map());
    expect(vehicle).not.toBeNull();
    expect(vehicle!.path).toEqual(["a", "b", "c"]);
    expect(vehicle!.lifecycle).toBe("one-shot");
    expect(vehicle!.carries).toBe("passengers");
  });

  test("returns null when no path exists", () => {
    const context = buildRoutingContext({
      ...fixtureMap(),
      segments: [], // disconnect everything
    });
    const vehicle = createOneShotVehicle("p1", "a", "c", context, 5, 1, 0.4, new Map());
    expect(vehicle).toBeNull();
  });

  test("loads queued demand at the origin before departing", () => {
    const context = buildRoutingContext(fixtureMap());
    const queues: NodeQueues = new Map([
      ["a", new Map([["c:passengers", 5]])],
      ["b", new Map()],
      ["c", new Map()],
    ]);
    const vehicle = createOneShotVehicle("p1", "a", "c", context, 5, 1, 0.4, queues);
    expect(vehicle!.cargo).toEqual([{ from: "a", to: "c", kind: "passengers", amount: 1 }]); // capped at capacity 1
  });
});

describe("hasCompletedTrip / one-shot tickVehicle", () => {
  test("a one-shot vehicle is not complete until it reaches the final node", () => {
    const context = buildRoutingContext(fixtureMap());
    const vehicle = createOneShotVehicle("p1", "a", "c", context, 100, 1, 0.4, new Map())!;
    expect(hasCompletedTrip(vehicle)).toBe(false);

    const traffic: Map<string, SegmentTraffic> = new Map();
    tickVehicle(vehicle, new Map(), context, traffic, new Map(), 0.01); // barely moves
    expect(hasCompletedTrip(vehicle)).toBe(false);
  });

  test("completes and stops (does not wrap back to the start) after reaching the final node", () => {
    const context = buildRoutingContext(fixtureMap());
    const vehicle = createOneShotVehicle("p1", "a", "c", context, 100, 1, 0.4, new Map())!;
    const traffic: Map<string, SegmentTraffic> = new Map();

    tickVehicle(vehicle, new Map(), context, traffic, new Map(), 10); // more than enough to finish

    expect(hasCompletedTrip(vehicle)).toBe(true);
    // Ticking again does nothing further -- it's done, not looping.
    const deliveries = tickVehicle(vehicle, new Map(), context, traffic, new Map(), 10);
    expect(deliveries).toEqual([]);
  });

  test("delivers cargo on arrival at the final node and does not pick up new cargo there", () => {
    const context = buildRoutingContext(fixtureMap());
    const queues: NodeQueues = new Map([
      ["a", new Map([["c:passengers", 3]])],
      ["b", new Map()],
      ["c", new Map([["a:passengers", 9]])], // demand queued for the reverse trip -- shouldn't be picked up
    ]);
    const vehicle = createOneShotVehicle("p1", "a", "c", context, 100, 5, 0.4, queues)!;
    const traffic: Map<string, SegmentTraffic> = new Map();

    const deliveries = tickVehicle(vehicle, queues, context, traffic, new Map(), 10);

    expect(deliveries).toEqual([{ kind: "passengers", amount: 3, entry: { from: "a", to: "c", kind: "passengers", amount: 3 } }]);
    expect(vehicle.cargo).toEqual([]);
    expect(queues.get("c")!.get("a:passengers")).toBe(9); // untouched
  });
});
