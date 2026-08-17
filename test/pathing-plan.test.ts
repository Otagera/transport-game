import { describe, expect, test } from "bun:test";
import { planCorridor } from "@engine/pathing/plan";
import { NODE_COST } from "@engine/pathing/cost";
import type { TerrainField } from "@engine/map/types";

function makeTerrain(width: number, height: number, waterCells: Array<[number, number]> = []): TerrainField {
  const water = new Uint8Array(width * height);
  for (const [x, y] of waterCells) {
    water[y * width + x] = 1;
  }
  return {
    width,
    height,
    elevation: new Float32Array(width * height),
    water,
    settlementDensity: new Float32Array(width * height),
  };
}

describe("planCorridor", () => {
  test("auto mode finds a valid path with a positive cost breakdown", () => {
    const terrain = makeTerrain(10, 10);
    const plan = planCorridor(
      terrain,
      [
        { x: 0, y: 0 },
        { x: 9, y: 9 },
      ],
      "auto",
      new Set(),
    );
    expect(plan).not.toBeNull();
    expect(plan!.breakdown.total).toBeGreaterThan(0);
    expect(plan!.breakdown.nodes).toBe(2 * NODE_COST);
  });

  test("existing waypoints don't incur node cost", () => {
    const terrain = makeTerrain(10, 10);
    const plan = planCorridor(
      terrain,
      [
        { x: 0, y: 0 },
        { x: 9, y: 9 },
      ],
      "auto",
      new Set([0, 1]),
    );
    expect(plan).not.toBeNull();
    expect(plan!.breakdown.nodes).toBe(0);
  });

  test("straight mode returns null when the direct line crosses water", () => {
    const terrain = makeTerrain(10, 10, [[5, 5]]);
    const plan = planCorridor(
      terrain,
      [
        { x: 0, y: 0 },
        { x: 9, y: 9 },
      ],
      "straight",
      new Set(),
    );
    expect(plan).toBeNull();
  });

  test("auto mode routes around the same water that blocks straight mode", () => {
    const terrain = makeTerrain(10, 10, [[5, 5]]);
    const plan = planCorridor(
      terrain,
      [
        { x: 0, y: 0 },
        { x: 9, y: 9 },
      ],
      "auto",
      new Set(),
    );
    expect(plan).not.toBeNull();
  });

  test("the breakdown's total matches the sum of its own categories", () => {
    const terrain = makeTerrain(10, 10);
    terrain.elevation[5 * 10 + 5] = 1;
    const plan = planCorridor(
      terrain,
      [
        { x: 0, y: 5 },
        { x: 9, y: 5 },
      ],
      "auto",
      new Set(),
    );
    expect(plan).not.toBeNull();
    const b = plan!.breakdown;
    expect(b.total).toBeCloseTo(b.base + b.gradient + b.water + b.density + b.nodes, 5);
  });
});
