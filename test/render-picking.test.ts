import { describe, expect, test } from "bun:test";
import { distanceToSegment, pickAt, selectionGridPosition, vehicleGridPosition } from "@render/picking";
import type { GeneratedMap } from "@engine/map/types";
import type { Vehicle } from "@engine/simulation/types";

function fixtureMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: { width: 20, height: 20, elevation: new Float32Array(400), water: new Uint8Array(400), settlementDensity: new Float32Array(400) },
    nodes: [
      { id: "town", kind: "settlement", x: 2, y: 2 },
      { id: "market", kind: "settlement", x: 12, y: 2 },
    ],
    corridors: [{ id: "c1", nodeIds: ["town", "market"], polyline: [] }],
    segments: [
      { id: "s1", corridorId: "c1", fromNodeId: "town", toNodeId: "market", type: "road", level: "ground", condition: 1, provenance: "built" },
    ],
  };
}

function vehicle(edgeProgress: number): Vehicle {
  return {
    id: "v1",
    path: ["town", "market"],
    pathIndex: 1,
    edgeProgress,
    speed: 1,
    capacity: 10,
    cargo: [],
    carries: "passengers",
    congestionWeight: 1,
    lifecycle: "cyclic",
  };
}

describe("distanceToSegment", () => {
  test("measures perpendicular distance for a point beside the segment", () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3, 6);
  });

  test("clamps past the ends rather than measuring to the infinite line", () => {
    expect(distanceToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(10, 6);
  });

  test("a degenerate segment is just its point", () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5, 6);
  });
});

describe("vehicleGridPosition", () => {
  test("interpolates along the edge it is traversing", () => {
    expect(vehicleGridPosition(vehicle(0.5), fixtureMap())).toEqual({ x: 7, y: 2 });
  });
});

describe("pickAt", () => {
  test("prefers the vehicle when a vehicle, a segment and a node all overlap", () => {
    // edgeProgress 0 puts the vehicle exactly on the "town" node, which is
    // also an endpoint of segment s1 -- all three are within their radii.
    expect(pickAt({ x: 2, y: 2 }, fixtureMap(), [vehicle(0)])).toEqual({ kind: "vehicle", id: "v1" });
  });

  test("prefers a node over the segment that ends at it", () => {
    expect(pickAt({ x: 2, y: 2 }, fixtureMap(), [])).toEqual({ kind: "node", id: "town" });
  });

  test("picks the segment out in open track, away from either node", () => {
    expect(pickAt({ x: 7, y: 2 }, fixtureMap(), [])).toEqual({ kind: "segment", id: "s1" });
  });

  test("returns null on empty ground rather than snapping to the nearest thing", () => {
    expect(pickAt({ x: 7, y: 15 }, fixtureMap(), [])).toBeNull();
  });

  test("never picks a corridor directly -- two corridors on one alignment would be a coin flip", () => {
    const hit = pickAt({ x: 7, y: 2 }, fixtureMap(), []);
    expect(hit?.kind).not.toBe("corridor");
  });
});

describe("selectionGridPosition", () => {
  test("a segment resolves to its midpoint, not one of its ends", () => {
    expect(selectionGridPosition({ kind: "segment", id: "s1" }, fixtureMap(), [])).toEqual({ x: 7, y: 2 });
  });

  test("a corridor resolves to the mean of its chain", () => {
    expect(selectionGridPosition({ kind: "corridor", id: "c1" }, fixtureMap(), [])).toEqual({ x: 7, y: 2 });
  });

  test("a selection whose entity has since gone resolves to null, not a stale point", () => {
    expect(selectionGridPosition({ kind: "vehicle", id: "sold" }, fixtureMap(), [])).toBeNull();
  });
});
