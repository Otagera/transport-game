import { describe, expect, test } from "bun:test";
import { planCorridorPrune, pruneCorridor } from "@engine/map/prune";
import type { GeneratedMap, MapNode, Segment } from "@engine/map/types";

function node(id: string, kind: MapNode["kind"], x = 0, y = 0): MapNode {
  return { id, kind, x, y };
}

function segment(id: string, corridorId: string, from: string, to: string): Segment {
  return { id, corridorId, fromNodeId: from, toNodeId: to, type: "road", level: "ground", condition: 1, provenance: "built" };
}

// Two corridors sharing a junction: A -- J -- B via corridor-1, and
// J -- C via corridor-2. Pruning corridor-1 must not take J with it.
function fixtureMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: { width: 4, height: 4, elevation: new Float32Array(16), water: new Uint8Array(16), settlementDensity: new Float32Array(16) },
    nodes: [
      node("town", "settlement", 0, 0),
      node("junction", "junction", 1, 0),
      node("village", "village", 2, 0),
      node("bend", "vertex", 1, 1),
      node("outpost", "village", 3, 3),
    ],
    corridors: [
      { id: "corridor-1", nodeIds: ["town", "junction", "village"], polyline: [] },
      { id: "corridor-2", nodeIds: ["junction", "bend", "outpost"], polyline: [] },
    ],
    segments: [
      segment("s1", "corridor-1", "town", "junction"),
      segment("s2", "corridor-1", "junction", "village"),
      segment("s3", "corridor-2", "junction", "bend"),
      segment("s4", "corridor-2", "bend", "outpost"),
    ],
  };
}

describe("planCorridorPrune", () => {
  test("lists every segment belonging to the corridor", () => {
    const plan = planCorridorPrune(fixtureMap(), "corridor-1")!;
    expect(plan.segmentIds.sort()).toEqual(["s1", "s2"]);
  });

  test("never removes a settlement or village -- a place is not built infrastructure", () => {
    const plan = planCorridorPrune(fixtureMap(), "corridor-1")!;
    expect(plan.nodeIds).not.toContain("town");
    expect(plan.nodeIds).not.toContain("village");
  });

  test("keeps a junction that another corridor still connects to", () => {
    const plan = planCorridorPrune(fixtureMap(), "corridor-1")!;
    expect(plan.nodeIds).not.toContain("junction");
  });

  test("removes a vertex the pruned corridor was the only user of", () => {
    const plan = planCorridorPrune(fixtureMap(), "corridor-2")!;
    expect(plan.nodeIds).toEqual(["bend"]);
  });

  test("returns null for a corridor that isn't there", () => {
    expect(planCorridorPrune(fixtureMap(), "nope")).toBeNull();
  });
});

describe("pruneCorridor", () => {
  test("is pure -- the input map is untouched, so snapshot undo still works", () => {
    const map = fixtureMap();
    const before = JSON.stringify({ nodes: map.nodes, corridors: map.corridors, segments: map.segments });
    pruneCorridor(map, "corridor-2");
    expect(JSON.stringify({ nodes: map.nodes, corridors: map.corridors, segments: map.segments })).toBe(before);
  });

  test("drops the corridor, its segments, and only its orphaned vertices", () => {
    const pruned = pruneCorridor(fixtureMap(), "corridor-2");
    expect(pruned.corridors.map((c) => c.id)).toEqual(["corridor-1"]);
    expect(pruned.segments.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(pruned.nodes.map((n) => n.id).sort()).toEqual(["junction", "outpost", "town", "village"]);
  });

  test("an unknown corridor id is a no-op, not a partial edit", () => {
    const map = fixtureMap();
    expect(pruneCorridor(map, "nope")).toBe(map);
  });
});
