import { describe, expect, test } from "bun:test";
import { gridToWorld, worldToGrid } from "@render/gridCoords";

describe("grid <-> world coordinate mapping", () => {
  test("round-trips for a range of grid cells", () => {
    const width = 20;
    const height = 16;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const world = gridToWorld(x, y, width, height);
        const grid = worldToGrid(world.x, world.z, width, height);
        expect(grid).toEqual({ x, y });
      }
    }
  });

  test("increasing grid y decreases world z (matches the -PI/2 rotation's sign flip)", () => {
    const width = 10;
    const height = 10;
    const low = gridToWorld(5, 0, width, height);
    const high = gridToWorld(5, 9, width, height);
    expect(high.z).toBeLessThan(low.z);
  });

  test("grid (0,0) lands at the expected world corner", () => {
    const width = 10;
    const height = 10;
    const origin = gridToWorld(0, 0, width, height);
    expect(origin.x).toBeCloseTo(-4.5, 5);
    expect(origin.z).toBeCloseTo(4.5, 5);
  });
});
