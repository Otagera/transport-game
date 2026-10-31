import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { gameMap } from "@engine/game/region";
import { buildGameTerrain } from "@engine/game/terrain";
import { DEFAULT_GAME_TUNING } from "@engine/game/tuning";

// Map version 13: lakes (water), swamps, dry beds and dunes (scenery) -- region.ts landForms.
const SEEDS = [3, 11, 42, 101, 777, 2418, 4202, 8510];
const v = (mapVersion: number) => ({ ...DEFAULT_GAME_TUNING, mapVersion });
const toSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};

describe("map version 13: more kinds of land", () => {
  test("lakes clear of the towns, the roads and the home box; none before version 13; the same seed the same", () => {
    let lakes = 0;
    for (const seed of SEEDS) {
      const map = gameMap(GAME_MAP, seed, v(13));
      expect(gameMap(GAME_MAP, seed, v(12)).terrain!.rivers!.some((r) => r.lake)).toBe(false);
      expect(gameMap(GAME_MAP, seed, v(12)).features).toBeUndefined();
      expect(gameMap(GAME_MAP, seed, v(13)).terrain).toEqual(map.terrain);
      expect(gameMap(GAME_MAP, seed, v(13)).features).toEqual(map.features);
      expect(() => buildGameTerrain(map)).not.toThrow();
      const at = new Map(map.towns.map((t) => [t.id, t]));
      const box = map.home!;
      for (const lake of map.terrain!.rivers!.filter((r) => r.lake)) {
        lakes += 1;
        for (const [x, y] of lake.points) {
          const p = { x, y };
          for (const t of map.towns) expect(Math.hypot(t.x - x, t.y - y)).toBeGreaterThan(8);
          expect(x < box.x || x >= box.x + box.width || y < box.y || y >= box.y + box.height).toBe(true);
          for (const road of map.roads) {
            const line = [at.get(road.a)!, ...(road.via ?? []).map(([vx, vy]) => ({ x: vx, y: vy })), at.get(road.b)!];
            const r = Math.max(...(lake.widths ?? [lake.width])) / 2;
            expect(Math.min(...line.slice(1).map((q, k) => toSegment(p, line[k]!, q)))).toBeGreaterThan(r);
          }
        }
      }
    }
    expect(lakes).toBeGreaterThanOrEqual(SEEDS.length);
  }, 180_000);

  test("the scenery by region: the delta's swamps, the north's dry beds and dunes, the south none of those", () => {
    for (const seed of SEEDS) {
      const map = gameMap(GAME_MAP, seed, v(13));
      const f = map.features ?? {};
      if (map.region === "southSouth") expect(f.wetlands!.length).toBeGreaterThan(50);
      if (map.region === "north" || map.region === "northeast") {
        expect(f.dryBeds!.length).toBeGreaterThan(0);
        expect(f.dunes!.length).toBe(1);
      }
      if (map.region === "southwest" || map.region === "southeast") {
        expect(f.dryBeds).toBeUndefined();
        expect(f.dunes).toBeUndefined();
      }
    }
  }, 180_000);
});
