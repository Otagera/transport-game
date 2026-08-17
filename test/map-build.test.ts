import { describe, expect, test } from "bun:test";
import { commitCorridor } from "@engine/map/build";
import { planCorridor } from "@engine/pathing/plan";
import type { GeneratedMap } from "@engine/map/types";

function makeMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: {
      width: 10,
      height: 10,
      elevation: new Float32Array(100),
      water: new Uint8Array(100),
      settlementDensity: new Float32Array(100),
    },
    nodes: [{ id: "existing-a", kind: "settlement", x: 0, y: 0 }],
    corridors: [],
    segments: [],
  };
}

describe("commitCorridor", () => {
  test("creates a new vertex node for a fresh waypoint and reuses an existing one", () => {
    const map = makeMap();
    const plan = planCorridor(
      map.terrain,
      [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
      "auto",
      new Set([0]),
    )!;

    const result = commitCorridor(
      map,
      [{ point: { x: 0, y: 0 }, existingNodeId: "existing-a" }, { point: { x: 5, y: 5 } }],
      plan,
      "road",
    );

    expect(result.nodes.length).toBe(2);
    const newNode = result.nodes.find((n) => n.id !== "existing-a")!;
    expect(newNode.kind).toBe("vertex");
    expect(newNode.x).toBe(5);
    expect(newNode.y).toBe(5);

    expect(result.corridors.length).toBe(1);
    expect(result.corridors[0]!.nodeIds).toEqual(["existing-a", newNode.id]);

    expect(result.segments.length).toBe(1);
    expect(result.segments[0]!.fromNodeId).toBe("existing-a");
    expect(result.segments[0]!.toNodeId).toBe(newNode.id);
    expect(result.segments[0]!.type).toBe("road");
    expect(result.segments[0]!.level).toBe("ground");
    expect(result.segments[0]!.provenance).toBe("built");
  });

  test("does not mutate the input map", () => {
    const map = makeMap();
    const plan = planCorridor(
      map.terrain,
      [
        { x: 0, y: 0 },
        { x: 3, y: 3 },
      ],
      "straight",
      new Set([0]),
    )!;

    commitCorridor(map, [{ point: { x: 0, y: 0 }, existingNodeId: "existing-a" }, { point: { x: 3, y: 3 } }], plan, "rail");

    expect(map.nodes.length).toBe(1);
    expect(map.corridors.length).toBe(0);
    expect(map.segments.length).toBe(0);
  });

  test("a three-waypoint chain produces two segments", () => {
    const map = makeMap();
    const waypoints = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ];
    const plan = planCorridor(map.terrain, waypoints, "straight", new Set([0]))!;

    const result = commitCorridor(
      map,
      waypoints.map((point, i) => (i === 0 ? { point, existingNodeId: "existing-a" } : { point })),
      plan,
      "road",
    );

    expect(result.nodes.length).toBe(3);
    expect(result.corridors[0]!.nodeIds.length).toBe(3);
    expect(result.segments.length).toBe(2);
  });
});
