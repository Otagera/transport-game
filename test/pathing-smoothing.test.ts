import { describe, expect, test } from "bun:test";
import { clampToTraversable, smoothChain } from "@engine/pathing/smoothing";
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

describe("smoothChain", () => {
  test("returns points unchanged (a copy) for fewer than 3 control points", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ];
    const result = smoothChain(points, 8);
    expect(result).toEqual(points);
    expect(result).not.toBe(points);
  });

  test("smoothing a straight chain stays on the line", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 4, y: 4 },
    ];
    const result = smoothChain(points, 8);
    for (const point of result) {
      expect(point.x).toBeCloseTo(point.y, 5);
    }
  });

  test("passes through every original control point exactly", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 3, y: 1 },
      { x: 6, y: 0 },
    ];
    const result = smoothChain(points, 4);
    for (const control of points) {
      const hit = result.some((p) => Math.abs(p.x - control.x) < 1e-6 && Math.abs(p.y - control.y) < 1e-6);
      expect(hit).toBe(true);
    }
  });
});

describe("clampToTraversable", () => {
  test("keeps the smoothed curve when it stays on land", () => {
    const terrain = makeTerrain(10, 10);
    const raw = [
      { x: 0, y: 0 },
      { x: 9, y: 9 },
    ];
    const smoothed = [
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 9, y: 9 },
    ];
    expect(clampToTraversable(terrain, smoothed, raw)).toEqual(smoothed);
  });

  test("falls back to the raw path when the smoothed curve dips into water", () => {
    const terrain = makeTerrain(10, 10, [[4, 4]]);
    const raw = [
      { x: 0, y: 0 },
      { x: 9, y: 9 },
    ];
    const smoothed = [
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 9, y: 9 },
    ];
    expect(clampToTraversable(terrain, smoothed, raw)).toEqual(raw);
  });

  test("falls back to the raw path on an excessively sharp turn", () => {
    const terrain = makeTerrain(10, 10);
    const raw = [
      { x: 0, y: 0 },
      { x: 9, y: 0 },
    ];
    // Near-complete reversal: ~179 degrees, well past the max turn angle.
    const smoothed = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 0.1, y: 0.1 },
    ];
    expect(clampToTraversable(terrain, smoothed, raw)).toEqual(raw);
  });
});
