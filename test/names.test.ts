import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { gameMap } from "@engine/game/region";
import { NAMES, REGION_NAMES, townId } from "@engine/game/generate";
import { DEFAULT_GAME_TUNING } from "@engine/game/tuning";

// Map version 9: fictional names, true to the region (names.ts; the fidelity scope, A5).
const SEEDS = [3, 11, 17, 42, 101, 256, 777, 1234, 2411, 2418, 4202, 8510];
const v = (mapVersion: number) => ({ ...DEFAULT_GAME_TUNING, mapVersion });

describe("map version 9: fictional names", () => {
  test("no real town's name, none twice, the same seed the same names; version 8 keeps the real ones", () => {
    const real = new Set([...NAMES, ...Object.values(REGION_NAMES).flat()].map(townId));
    for (const seed of SEEDS) {
      const map = gameMap(GAME_MAP, seed, v(9));
      const ids = map.towns.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const t of map.towns) {
        expect(real.has(t.id)).toBe(false);
        expect(t.id).toBe(townId(t.name));
      }
      expect(gameMap(GAME_MAP, seed, v(9)).towns.map((t) => t.name)).toEqual(map.towns.map((t) => t.name));
      expect(gameMap(GAME_MAP, seed, v(8)).towns.every((t) => real.has(t.id))).toBe(true);
    }
  }, 120_000);

  test("only the names change: every road, rail, port and cluster still names a town, and the land is version 8's", () => {
    for (const seed of SEEDS) {
      const [old, map] = [gameMap(GAME_MAP, seed, v(8)), gameMap(GAME_MAP, seed, v(9))];
      const ids = new Set(map.towns.map((t) => t.id));
      for (const r of [...map.roads, ...(map.rails ?? [])]) { expect(ids.has(r.a)).toBe(true); expect(ids.has(r.b)).toBe(true); }
      if (map.port) expect(ids.has(map.port)).toBe(true);
      if (map.seaport) expect(ids.has(map.seaport)).toBe(true);
      for (const c of map.clusters ?? []) { expect(ids.has(c.hub)).toBe(true); for (const t of c.towns) expect(ids.has(t)).toBe(true); }
      expect(map.towns.map((t) => [t.x, t.y, t.population])).toEqual(old.towns.map((t) => [t.x, t.y, t.population]));
      expect(map.terrain).toEqual(old.terrain);
    }
  }, 120_000);
});
