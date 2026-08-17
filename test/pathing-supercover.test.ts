import { describe, expect, test } from "bun:test";
import { walkCellsAlongSegment } from "@engine/pathing/supercover";

describe("walkCellsAlongSegment", () => {
  test("a horizontal line visits every cell in between", () => {
    expect(walkCellsAlongSegment(0, 0, 3, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  test("a vertical line visits every cell in between", () => {
    expect(walkCellsAlongSegment(0, 0, 0, 3)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
    ]);
  });

  test("a diagonal line through exact lattice corners includes both corner-adjacent cells, not just one staircase", () => {
    const cells = walkCellsAlongSegment(0, 0, 2, 2);
    expect(cells).toContainEqual({ x: 1, y: 0 });
    expect(cells).toContainEqual({ x: 0, y: 1 });
    expect(cells).toContainEqual({ x: 1, y: 1 });
    expect(cells).toContainEqual({ x: 2, y: 1 });
    expect(cells).toContainEqual({ x: 1, y: 2 });
  });

  test("a zero-length segment returns just the one cell", () => {
    expect(walkCellsAlongSegment(1, 1, 1, 1)).toEqual([{ x: 1, y: 1 }]);
  });
});
