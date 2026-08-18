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

  test("buildCostMultiplier scales every breakdown field, keeping the receipt internally consistent", () => {
    const terrain = makeTerrain(10, 10);
    const waypoints: [number, number][] = [
      [0, 0],
      [9, 9],
    ];
    const base = planCorridor(terrain, waypoints.map(([x, y]) => ({ x, y })), "auto", new Set())!;
    const scaled = planCorridor(terrain, waypoints.map(([x, y]) => ({ x, y })), "auto", new Set(), 1.3)!;

    expect(scaled.breakdown.total).toBeCloseTo(base.breakdown.total * 1.3, 5);
    expect(scaled.breakdown.nodes).toBeCloseTo(base.breakdown.nodes * 1.3, 5);
    expect(scaled.breakdown.base + scaled.breakdown.gradient + scaled.breakdown.water + scaled.breakdown.density + scaled.breakdown.nodes).toBeCloseTo(
      scaled.breakdown.total,
      5,
    );
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

  test("straight mode bridges a single water cell on the direct line", () => {
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
    expect(plan).not.toBeNull();
    expect(plan!.segmentLevels).toContain("elevated");
    expect(plan!.chainPoints.some((c) => c.isBridgeBank)).toBe(true);
    expect(plan!.breakdown.water).toBeGreaterThan(0);
  });

  test("straight mode returns null when the water is wider than the max bridge span", () => {
    // Water runs 16 cells wide *along* the straight line's own direction
    // (x=2..17 at y=0), so the crossing itself needs span 16 > 14.
    const waterCells: Array<[number, number]> = [];
    for (let x = 2; x <= 17; x += 1) waterCells.push([x, 0]);
    const terrain = makeTerrain(20, 5, waterCells);
    const plan = planCorridor(
      terrain,
      [
        { x: 0, y: 0 },
        { x: 19, y: 0 },
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

  test("a leg with two separate water bodies produces two bridge banks pairs", () => {
    const terrain = makeTerrain(20, 5, [
      [5, 0],
      [6, 0],
      [13, 0],
    ]);
    const plan = planCorridor(
      terrain,
      [
        { x: 0, y: 0 },
        { x: 19, y: 0 },
      ],
      "straight",
      new Set(),
    );
    expect(plan).not.toBeNull();
    const bridgeCount = plan!.segmentLevels.filter((level) => level === "elevated").length;
    expect(bridgeCount).toBe(2);
    expect(plan!.chainPoints.filter((c) => c.isBridgeBank).length).toBe(4);
  });

  test("auto mode's ground runs still get simplified and smoothed around a bridge", () => {
    const terrain = makeTerrain(20, 5, [
      [10, 0],
      [10, 1],
    ]);
    const plan = planCorridor(
      terrain,
      [
        { x: 0, y: 0 },
        { x: 19, y: 4 },
      ],
      "auto",
      new Set(),
    );
    expect(plan).not.toBeNull();
    expect(plan!.polyline.length).toBeGreaterThan(plan!.chainPoints.length);
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
