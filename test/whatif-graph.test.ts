import { describe, expect, test } from "bun:test";
import { graphEdges, moved } from "../src/game/whatifgraph";

// The what-if's map graph (brief, Dev tools, step 4): edges by pair, both ways and every kind of
// goods together; what's too small not drawn; a change too small not coloured.
describe("the what-if's map graph (whatifgraph.ts)", () => {
  const end = (trips: Record<string, number>, flows: Record<string, number>) => ({ people: {}, trips, flows });

  test("a pair's trips both ways are one edge; goods of every kind on a pair summed", () => {
    const base = end({ "a:b": 10, "b:a": 5, "a:c": 0.2 }, { "x:y:cement": 3, "x:y:steel": 2, "y:x:fuel": 1 });
    const after = end({ "a:b": 20, "b:a": 5 }, { "x:y:cement": 1 });
    expect(graphEdges(base, after, "trips")).toEqual([{ a: "a", b: "b", base: 15, with: 25 }]);
    expect(graphEdges(base, after, "goods")).toEqual([{ a: "x", b: "y", base: 6, with: 1 }]);
  });

  test("moved: half a trip or 2% of the flow, whichever is more", () => {
    expect(moved(10, 10.4)).toBe(false);
    expect(moved(10, 10.6)).toBe(true);
    expect(moved(1000, 1015)).toBe(false);
    expect(moved(1000, 1025)).toBe(true);
  });
});

// The systems graph (brief, Dev tools, step 5; D5): the chain table is hand-kept, so it's held to
// the tuning -- a number added without a place in it fails here until it's placed.
import { DEFAULT_GAME_TUNING } from "../src/engine/game/tuning";
import { SYSTEM_NODES, chainFrom, moveNode, placeOf } from "../src/game/systems";

describe("the systems graph (systems.ts)", () => {
  test("D5: every tuning number lands on a node or is named as not drawn", () => {
    const keys = Object.keys(DEFAULT_GAME_TUNING).filter((k) => ["number", "boolean"].includes(typeof (DEFAULT_GAME_TUNING as unknown as Record<string, unknown>)[k]));
    expect(keys.filter((k) => !placeOf(k))).toEqual([]);
    // Spot checks: a vehicle's capacity is its carrier's, a road's the road's, the map's not drawn.
    expect(placeOf("busCapacity")).toEqual({ node: "service" });
    expect(placeOf("danfoCapacity")).toEqual({ node: "informal" });
    expect(placeOf("dirtRoadCapacity")).toEqual({ node: "roads" });
    expect(placeOf("mapVersion")).toHaveProperty("notDrawn");
  });

  test("the chain is whole: every node fed is a node, and every chain ends in people or money", () => {
    const ids = new Set(SYSTEM_NODES.map((n) => n.id));
    for (const node of SYSTEM_NODES) for (const next of node.feeds) expect(ids.has(next)).toBe(true);
    for (const node of SYSTEM_NODES) {
      const chain = chainFrom(node.id);
      expect(chain.has("people") || chain.has("money")).toBe(true);
    }
    expect(moveNode({ kind: "yard", townId: "x" })).toBe("hauliers");
    expect(moveNode({ kind: "console", op: "tune", key: "fare", value: 5 })).toBe("service");
  });
});
