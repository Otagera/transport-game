import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { gameMap } from "@engine/game/region";
import { generatedMapInfo } from "@engine/game/generate";
import { buildGameTerrain } from "@engine/game/terrain";
import { DEFAULT_GAME_TUNING } from "@engine/game/tuning";

// Map versions 11 (old roads by the land) and 12 (hamlets): region.ts roadsByTheLand, withHamlets.
const SEEDS = [3, 11, 42, 101, 777, 2418, 4202, 8510];
const v = (mapVersion: number) => ({ ...DEFAULT_GAME_TUNING, mapVersion });
const toSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};

describe("map version 11: old roads by the land", () => {
  test("the home cluster's roads keep their lines; the rest stay clear of the towns they don't serve, and join the same towns", () => {
    for (const seed of SEEDS) {
      const [before, after] = [gameMap(GAME_MAP, seed, v(10)), gameMap(GAME_MAP, seed, v(11))];
      const homeRoads = generatedMapInfo(GAME_MAP, seed).map.roads.length;
      expect(after.roads.map((r) => [r.a, r.b])).toEqual(before.roads.map((r) => [r.a, r.b]));
      for (let k = 0; k < homeRoads; k += 1) expect(after.roads[k]!.via).toEqual(before.roads[k]!.via);
      const at = new Map(after.towns.map((t) => [t.id, t]));
      for (const road of after.roads.slice(homeRoads)) {
        const line = [at.get(road.a)!, ...(road.via ?? []).map(([x, y]) => ({ x, y })), at.get(road.b)!];
        for (const t of after.towns) {
          if (t.id === road.a || t.id === road.b) continue;
          expect(Math.min(...line.slice(1).map((p, k) => toSegment(t, line[k]!, p)))).toBeGreaterThanOrEqual(3 - 1e-6);
        }
      }
    }
  }, 180_000);
});

describe("map version 12: hamlets", () => {
  test("hamlets on dry land, clear of the towns, the same seed the same; none before version 12", () => {
    for (const seed of SEEDS) {
      const map = gameMap(GAME_MAP, seed, v(12));
      expect(gameMap(GAME_MAP, seed, v(11)).hamlets).toBeUndefined();
      expect(map.hamlets!.length).toBeGreaterThan(20);
      expect(gameMap(GAME_MAP, seed, v(12)).hamlets).toEqual(map.hamlets);
      const terrain = buildGameTerrain(map);
      for (const h of map.hamlets!) {
        expect(terrain.water[h.y * map.width + h.x]).toBe(0);
        for (const t of map.towns) expect(Math.hypot(t.x - h.x, t.y - h.y)).toBeGreaterThanOrEqual(9);
      }
    }
  }, 180_000);
});
