import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { gameMap } from "@engine/game/region";
import { waterFirstMap, waterRegion } from "@engine/game/waterfirst";
import { buildGameTerrain } from "@engine/game/terrain";
import { startGame } from "@engine/game/start";
import { DEFAULT_GAME_TUNING } from "@engine/game/tuning";
import { crosses } from "@engine/game/generate";
import type { GameRiverDef } from "@engine/game/types";

// Map version 16: water first (waterfirst.ts; docs/water.md, Step 1, redrawn).
const v = (mapVersion: number) => ({ ...DEFAULT_GAME_TUNING, mapVersion });
const SEEDS = [8703, 2418, 949, 3218, 7585, 5059, 1201, 4420, 6633, 9187, 3305, 7741];

/** The water's edge's distance from a point (0 inside the water). */
function toWater(rivers: GameRiverDef[], p: { x: number; y: number }): number {
  let best = Infinity;
  for (const r of rivers) for (let k = 1; k < r.points.length; k += 1) {
    const [ax, ay] = r.points[k - 1]!, [bx, by] = r.points[k]!;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len2));
    const w = r.widths ? r.widths[k - 1]! + (r.widths[k]! - r.widths[k - 1]!) * t : r.width;
    best = Math.min(best, Math.max(0, Math.hypot(p.x - (ax + dx * t), p.y - (ay + dy * t)) - w / 2));
  }
  return best;
}

describe("map version 16: water first", () => {
  test("the same seed draws the same map; a different one from version 13's (version 15 and before keep their own tests)", () => {
    for (const seed of [8703, 2418, 7585]) {
      const map = gameMap(GAME_MAP, seed, v(16));
      expect(gameMap(GAME_MAP, seed, v(16))).toEqual(map);
      expect(map.terrain!.rivers).not.toEqual(gameMap(GAME_MAP, seed, v(13)).terrain!.rivers);
      expect(() => buildGameTerrain(map)).not.toThrow();
    }
  }, 240_000);

  test("every region drawn, evenly; every seed draws (C47's precondition)", () => {
    const regions = new Map<string, number>();
    for (let seed = 1; seed <= 60; seed += 1) {
      regions.set(waterRegion(seed), (regions.get(waterRegion(seed)) ?? 0) + 1);
      expect(waterFirstMap(seed)).not.toBeNull();
    }
    expect(regions.size).toBe(6);
    for (const n of regions.values()) expect(n).toBeGreaterThanOrEqual(5);
  }, 240_000);

  test("rivers are rivers: on 50 seeds none crosses another, save where one joins it (C50)", () => {
    for (let seed = 101; seed <= 150; seed += 1) {
      const rivers = waterFirstMap(seed)!.map.terrain!.rivers!.filter((r) => !r.lake && Math.max(...(r.widths ?? [r.width])) <= 12);
      for (let i = 0; i < rivers.length; i += 1) for (let j = i + 1; j < rivers.length; j += 1) {
        const a = rivers[i]!, b = rivers[j]!;
        // Where one river meets another its end lies on it: its last few segments, and its first (a delta's arms leave the head together).
        for (let k = 3; k < a.points.length - 3; k += 1) for (let m = 3; m < b.points.length - 3; m += 1) {
          const p = (r: GameRiverDef, n: number) => ({ x: r.points[n]![0], y: r.points[n]![1] });
          expect(crosses(p(a, k - 1), p(a, k), p(b, m - 1), p(b, m))).toBe(false);
        }
      }
    }
  }, 240_000);

  test("the home city stands on the water on most seeds (C49): on at least 8 of 12, within 15 cells on the rest", () => {
    let on = 0;
    for (const seed of SEEDS) {
      const map = waterFirstMap(seed)!.map;
      const city = map.towns.find((t) => t.id === map.port)!;
      const d = toWater(map.terrain!.rivers!, city);
      if (d <= 3) on += 1;
      else expect(d).toBeLessThanOrEqual(15);
    }
    expect(on).toBeGreaterThanOrEqual(8);
  }, 240_000);

  test("a game starts on it: sites placed, a port and a seaport, every town on the map (a delta, a lake basin, a lagoon)", () => {
    for (const seed of [8703, 2418, 7585]) {
      const world = startGame(gameMap(GAME_MAP, seed, v(16)), v(16));
      expect(world.port).toBeDefined();
      expect(world.seaport).toBeDefined();
      expect([...world.towns.values()].some((t) => t.industry)).toBe(true);
      expect(world.towns.size).toBeGreaterThan(30);
    }
  }, 600_000);
});
