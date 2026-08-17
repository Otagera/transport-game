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

  test("returns null when a solid water wall blocks every route", () => {
    const waterWall: Array<[number, number]> = [];
    for (let x = 0; x < 5; x += 1) waterWall.push([x, 2]);
    const terrain = makeTerrain(5, 5, waterWall);
    expect(findTerrainPath(terrain, { x: 0, y: 0 }, { x: 0, y: 4 })).toBeNull();
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
