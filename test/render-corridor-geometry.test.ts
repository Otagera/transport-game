import { describe, expect, test } from "bun:test";
import { segmentCenterlines, splitPolylineByNodes, straightCenterline } from "@render/corridorGeometry";
import type { GeneratedMap } from "@engine/map/types";

describe("splitPolylineByNodes", () => {
  const nodes = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 8, y: 0 },
  ];

  test("splits a smoothed polyline at the chain's nodes, sharing the boundary point", () => {
    const polyline = [
      { x: 0, y: 0 },
      { x: 2, y: 1 },
      { x: 4, y: 0 },
      { x: 6, y: -1 },
      { x: 8, y: 0 },
    ];
    const runs = splitPolylineByNodes(polyline, nodes);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual([{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 4, y: 0 }]);
    expect(runs[1]).toEqual([{ x: 4, y: 0 }, { x: 6, y: -1 }, { x: 8, y: 0 }]);
  });

  test("keeps the smoothing -- a run is not collapsed back to its two ends", () => {
    const polyline = [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 2 },
      { x: 4, y: 0 },
      { x: 8, y: 0 },
    ];
    expect(splitPolylineByNodes(polyline, nodes)[0]!.length).toBe(5);
  });

  test("falls back to the straight two-node line when there is no usable polyline", () => {
    expect(splitPolylineByNodes([], nodes)).toEqual([
      [{ x: 0, y: 0 }, { x: 4, y: 0 }],
      [{ x: 4, y: 0 }, { x: 8, y: 0 }],
    ]);
  });

  test("indices stay monotonic when a corridor doubles back near itself", () => {
    // The second node is nearest to polyline[1], but the third node is
    // equidistant from an earlier point -- searching forward from the
    // previous match is what stops the run reversing.
    const polyline = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0.2, y: 0.2 },
    ];
    const runs = splitPolylineByNodes(polyline, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(runs[1]!.at(0)).toEqual({ x: 4, y: 0 });
    expect(runs[1]!.length).toBeGreaterThanOrEqual(2);
  });

  test("a single node yields no runs rather than an empty one", () => {
    expect(splitPolylineByNodes([{ x: 0, y: 0 }], [{ x: 0, y: 0 }])).toEqual([]);
  });
});

function chainMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: { width: 16, height: 16, elevation: new Float32Array(256), water: new Uint8Array(256), settlementDensity: new Float32Array(256) },
    nodes: [
      { id: "a", kind: "settlement", x: 0, y: 0 },
      { id: "b", kind: "vertex", x: 4, y: 0 },
      { id: "c", kind: "village", x: 8, y: 0 },
    ],
    corridors: [
      {
        id: "c1",
        nodeIds: ["a", "b", "c"],
        polyline: [
          { x: 0, y: 0 },
          { x: 2, y: 1 },
          { x: 4, y: 0 },
          { x: 6, y: -1 },
          { x: 8, y: 0 },
        ],
      },
    ],
    segments: [
      { id: "s1", corridorId: "c1", fromNodeId: "a", toNodeId: "b", type: "road", level: "ground", condition: 1, provenance: "built" },
      { id: "s2", corridorId: "c1", fromNodeId: "b", toNodeId: "c", type: "road", level: "ground", condition: 1, provenance: "built" },
    ],
  };
}

describe("segmentCenterlines", () => {
  test("keys each run by segment id, not by position in the chain", () => {
    const runs = segmentCenterlines(chainMap(), chainMap().corridors[0]!);
    expect([...runs.keys()].sort()).toEqual(["s1", "s2"]);
    expect(runs.get("s1")!.at(-1)).toEqual({ x: 4, y: 0 });
    expect(runs.get("s2")!.at(0)).toEqual({ x: 4, y: 0 });
  });

  test("ignores segments belonging to a different corridor", () => {
    const map = chainMap();
    map.segments.push({ id: "other", corridorId: "c2", fromNodeId: "a", toNodeId: "c", type: "road", level: "ground", condition: 1, provenance: "built" });
    expect(segmentCenterlines(map, map.corridors[0]!).has("other")).toBe(false);
  });
});

describe("straightCenterline", () => {
  test("is the two node positions, in order", () => {
    const map = chainMap();
    expect(straightCenterline(map, map.segments[0]!)).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }]);
  });

  test("returns null when an endpoint is missing rather than half a line", () => {
    const map = chainMap();
    map.nodes = map.nodes.filter((node) => node.id !== "b");
    expect(straightCenterline(map, map.segments[0]!)).toBeNull();
  });
});
