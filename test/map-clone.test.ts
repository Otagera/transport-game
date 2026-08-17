import { describe, expect, test } from "bun:test";
import { cloneMap } from "@engine/map/clone";
import { generateMap } from "@engine/map/generate";

describe("cloneMap", () => {
  test("produces a deeply independent copy", () => {
    const original = generateMap(3);
    const clone = cloneMap(original);

    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(clone.terrain.elevation).not.toBe(original.terrain.elevation);
    expect(clone.nodes).not.toBe(original.nodes);
    expect(clone.corridors).not.toBe(original.corridors);
    expect(clone.segments).not.toBe(original.segments);

    clone.terrain.elevation[0] = 999;
    clone.nodes.push({ id: "extra", kind: "vertex", x: 0, y: 0 });
    clone.segments[0]!.condition = -1;

    expect(original.terrain.elevation[0]).not.toBe(999);
    expect(original.nodes.find((n) => n.id === "extra")).toBeUndefined();
    expect(original.segments[0]!.condition).not.toBe(-1);
  });
});
