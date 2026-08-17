import { describe, expect, test } from "bun:test";
import { computeStranded } from "@engine/simulation/reachability";
import { buildRoutingContext } from "@engine/simulation/routing";
import { generateDemandPairs } from "@engine/simulation/demand";
import { generateMap } from "@engine/map/generate";
import type { GeneratedMap } from "@engine/map/types";

function disconnectedFixture(): GeneratedMap {
  return {
    seed: 0,
    terrain: { width: 1, height: 1, elevation: new Float32Array(1), water: new Uint8Array(1), settlementDensity: new Float32Array(1) },
    nodes: [
      { id: "a", kind: "settlement", x: 0, y: 0 },
      { id: "b", kind: "village", x: 3, y: 0 },
      { id: "c", kind: "village", x: 10, y: 10 },
    ],
    corridors: [{ id: "c-ab", nodeIds: ["a", "b"], polyline: [{ x: 0, y: 0 }, { x: 3, y: 0 }] }],
    infrastructure: [],
  };
}

describe("computeStranded", () => {
  test("a node with no path to any of its demand destinations is stranded", () => {
    const context = buildRoutingContext(disconnectedFixture());
    const stranded = computeStranded(
      [
        { from: "a", to: "b", kind: "passengers", rate: 1 },
        { from: "c", to: "a", kind: "passengers", rate: 1 },
      ],
      context,
    );
    expect(stranded.has("c")).toBe(true);
    expect(stranded.has("a")).toBe(false);
  });

  test("a node reaching at least one of several destinations is not stranded", () => {
    const context = buildRoutingContext(disconnectedFixture());
    const stranded = computeStranded(
      [
        { from: "a", to: "b", kind: "passengers", rate: 1 },
        { from: "a", to: "c", kind: "passengers", rate: 1 },
      ],
      context,
    );
    expect(stranded.has("a")).toBe(false);
  });

  test("a generated map strands nothing, per Module 2's connectivity guarantee", () => {
    const map = generateMap(7);
    const demand = generateDemandPairs(map);
    const context = buildRoutingContext(map);
    const stranded = computeStranded(demand, context);
    expect(stranded.size).toBe(0);
  });
});
