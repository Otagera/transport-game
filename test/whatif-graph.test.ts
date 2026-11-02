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
