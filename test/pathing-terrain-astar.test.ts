import { describe, expect, test } from "bun:test";
import { findTerrainPath } from "@engine/pathing/terrainAStar";
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

describe("findTerrainPath", () => {
  test("finds a direct path on flat, dry terrain", () => {
    const terrain = makeTerrain(5, 5);
    const result = findTerrainPath(terrain, { x: 0, y: 0 }, { x: 4, y: 4 });
    expect(result).not.toBeNull();
    expect(result!.cells[0]).toEqual({ x: 0, y: 0 });
    expect(result!.cells[result!.cells.length - 1]).toEqual({ x: 4, y: 4 });
  });

  test("returns null when the start or end is water", () => {
    const terrain = makeTerrain(5, 5, [[2, 2]]);
    expect(findTerrainPath(terrain, { x: 2, y: 2 }, { x: 4, y: 4 })).toBeNull();
  });

  test("bridges a thin water wall rather than being blocked by it", () => {
    const waterWall: Array<[number, number]> = [];
    for (let x = 0; x < 5; x += 1) waterWall.push([x, 2]);
    const terrain = makeTerrain(5, 5, waterWall);
    const result = findTerrainPath(terrain, { x: 0, y: 0 }, { x: 0, y: 4 });
    expect(result).not.toBeNull();
    expect(result!.bridgeSpans.some((span) => span > 0)).toBe(true);
  });

  test("returns null when the water is wider than the max bridge span", () => {
    const width = 20;
    const height = 20;
    const waterWall: Array<[number, number]> = [];
    for (let x = 0; x < width; x += 1) {
      for (let y = 2; y < 18; y += 1) {
        waterWall.push([x, y]);
      }
    }
    const terrain = makeTerrain(width, height, waterWall);
    expect(findTerrainPath(terrain, { x: 0, y: 0 }, { x: 0, y: 19 })).toBeNull();
  });

  test("routes around a water obstacle rather than through it", () => {
    const terrain = makeTerrain(5, 5, [
      [2, 0],
      [2, 1],
      [2, 2],
    ]);
    const result = findTerrainPath(terrain, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(result).not.toBeNull();
    for (const cell of result!.cells) {
      expect(terrain.water[cell.y * 5 + cell.x]).toBe(0);
    }
  });

  test("disallows a diagonal move that cuts a water corner", () => {
    const terrain = makeTerrain(2, 2, [
      [1, 0],
      [0, 1],
    ]);
    expect(findTerrainPath(terrain, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  test("a bridge jump's cost matches bridgeStepCost for its span", () => {
    // A full-width wall leaves no detour, so the only way across is a
    // bridge -- unlike a single isolated water cell, which a cheap
    // diagonal detour usually beats.
    const waterWall: Array<[number, number]> = [];
    for (let x = 0; x < 5; x += 1) waterWall.push([x, 2]);
    const terrain = makeTerrain(5, 5, waterWall);
    const result = findTerrainPath(terrain, { x: 0, y: 0 }, { x: 0, y: 4 });
    expect(result).not.toBeNull();
    const bridgeIndex = result!.bridgeSpans.findIndex((span) => span > 0);
    expect(bridgeIndex).toBeGreaterThanOrEqual(0);
    expect(result!.bridgeSpans[bridgeIndex]).toBe(2);
    const step = result!.steps[bridgeIndex]!;
    expect(step.water).toBe(60); // BRIDGE_PREMIUM_PER_CELL * span(2)
  });

  test("prefers a short bridge over a long detour when bridging is cheaper", () => {
    // A 1-cell-wide strait across the whole width -- the only way around
    // is a long way, the bridge is a single-cell jump.
    const width = 5;
    const height = 21;
    const waterCells: Array<[number, number]> = [];
    for (let x = 0; x < width; x += 1) waterCells.push([x, 10]);
    const terrain = makeTerrain(width, height, waterCells);
    const result = findTerrainPath(terrain, { x: 0, y: 9 }, { x: 0, y: 11 });
    expect(result).not.toBeNull();
    expect(result!.cells.length).toBeLessThanOrEqual(3); // straight bridge, not a detour around 20 rows
    expect(result!.bridgeSpans.some((span) => span > 0)).toBe(true);
  });

  test("prefers a detour over an expensive long bridge when going around is cheaper", () => {
    // A wide lake with dry land wrapping close around one side -- the
    // detour is short, but the direct crossing would need a long bridge.
    const width = 16;
    const height = 16;
    const waterCells: Array<[number, number]> = [];
    for (let x = 2; x < 14; x += 1) {
      for (let y = 2; y < 14; y += 1) {
        waterCells.push([x, y]);
      }
    }
    const terrain = makeTerrain(width, height, waterCells);
    const result = findTerrainPath(terrain, { x: 1, y: 7 }, { x: 14, y: 7 });
    expect(result).not.toBeNull();
    expect(result!.bridgeSpans.every((span) => span === 0)).toBe(true);
  });

  test("routes around a steep gradient spike when a flatter detour exists", () => {
    const width = 5;
    const height = 3;
    const elevation = new Float32Array(width * height);
    elevation[1 * width + 2] = 1;
    const terrain: TerrainField = {
      width,
      height,
      elevation,
      water: new Uint8Array(width * height),
      settlementDensity: new Float32Array(width * height),
    };
    const result = findTerrainPath(terrain, { x: 0, y: 1 }, { x: 4, y: 1 });
    expect(result).not.toBeNull();
    const crossesSpike = result!.cells.some((cell) => cell.x === 2 && cell.y === 1);
    expect(crossesSpike).toBe(false);
  });
});
