import { describe, expect, test } from "bun:test";
import { buildRoutingContext, findPath } from "@engine/simulation/routing";
import type { GeneratedMap } from "@engine/map/types";

function emptyTerrain() {
  return { width: 1, height: 1, elevation: new Float32Array(1), water: new Uint8Array(1), settlementDensity: new Float32Array(1) };
}

function fixtureMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: emptyTerrain(),
    nodes: [
      { id: "a", kind: "settlement", x: 0, y: 0 },
      { id: "b", kind: "village", x: 3, y: 0 },
      { id: "c", kind: "village", x: 6, y: 0 },
      { id: "d", kind: "settlement", x: 3, y: 4 },
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

describe("findPath", () => {
  test("finds the shortest path across two hops", () => {
    const context = buildRoutingContext(fixtureMap());
    const result = findPath(context, "a", "c");
    expect(result).not.toBeNull();
    expect(result!.nodeIds).toEqual(["a", "b", "c"]);
    expect(result!.segmentIds).toEqual(["s-ab", "s-bc"]);
    expect(result!.distance).toBeCloseTo(6, 5);
  });

  test("returns null for a node with no edges reaching the target", () => {
    const context = buildRoutingContext(fixtureMap());
    expect(findPath(context, "a", "d")).toBeNull();
  });

  test("returns a trivial zero-distance result for the same node", () => {
    const context = buildRoutingContext(fixtureMap());
    expect(findPath(context, "a", "a")).toEqual({ nodeIds: ["a"], segmentIds: [], distance: 0 });
  });
});
