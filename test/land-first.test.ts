import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { gameMap } from "@engine/game/region";
import { buildGameTerrain } from "@engine/game/terrain";
import { DEFAULT_GAME_TUNING } from "@engine/game/tuning";

// Map version 7, the land first (region.ts landFirst, terrain.ts addRelief; the scope of 2026-10-30).
const SEEDS = [3, 11, 42, 101, 777, 2418, 4202, 8510];
const tuning = (mapVersion: number) => ({ ...DEFAULT_GAME_TUNING, mapVersion });

describe("map version 7: the land first", () => {
  test("a relief beyond the home box; the home box's ground as version 6 drew it", () => {
    for (const seed of SEEDS) {
      const v6 = gameMap(GAME_MAP, seed, tuning(6)), v7 = gameMap(GAME_MAP, seed, tuning(7));
      expect(v6.terrain?.relief).toBeUndefined();
      expect(v7.terrain?.relief).toBeDefined();
      const [a, b] = [buildGameTerrain(v6), buildGameTerrain(v7)];
      const box = v7.home!;
      let changedOutside = 0;
      for (let y = 0; y < v7.height; y += 1) for (let x = 0; x < v7.width; x += 1) {
        const i = y * v7.width + x;
        const inside = x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
        if (inside && a.water[i] === b.water[i]) expect(b.elevation[i]).toBeCloseTo(a.elevation[i]!, 5);
        if (!inside && b.elevation[i]! > a.elevation[i]! + 0.2) changedOutside += 1;
      }
      expect(changedOutside).toBeGreaterThan(v7.width * v7.height * 0.1);
    }
  }, 120_000);

  test("towns, roads and their places as version 6: only the land and the water's line change", () => {
    for (const seed of SEEDS) {
      const v6 = gameMap(GAME_MAP, seed, tuning(6)), v7 = gameMap(GAME_MAP, seed, tuning(7));
      expect(v7.towns).toEqual(v6.towns);
      expect(v7.roads.map((r) => [r.a, r.b])).toEqual(v6.roads.map((r) => [r.a, r.b]));
      expect(() => buildGameTerrain(v7)).not.toThrow(); // no town in the water
    }
  }, 120_000);

  test("a tributary is narrower than the river it joins, and the same seed draws the same land", () => {
    let joins = 0;
    for (const seed of SEEDS) {
      const map = gameMap(GAME_MAP, seed, tuning(7));
      expect(gameMap(GAME_MAP, seed, tuning(7)).terrain).toEqual(map.terrain);
      const rivers = map.terrain!.rivers!;
      const sea = rivers.find((r) => Math.max(...(r.widths ?? [r.width])) > 12);
      for (const river of rivers) {
        if (river === sea) continue;
        const widths = river.widths ?? river.points.map(() => river.width);
        for (const end of [0, river.points.length - 1]) {
          const [x, y] = river.points[end]!;
          for (const host of rivers) {
            if (host === river || host === sea) continue;
            const hw = host.widths ?? host.points.map(() => host.width);
            const k = host.points.findIndex(([hx, hy]) => Math.hypot(hx - x, hy - y) < 1.5);
            if (k < 0 || Math.max(...widths) > Math.max(...hw)) continue;
            joins += 1;
            expect(widths[end]!).toBeLessThan(Math.max(...hw));
          }
        }
      }
    }
    expect(joins).toBeGreaterThan(0);
  }, 120_000);

  test("a tributary's mouth is in its river's water, not on the bank beside it (your look: one stopped short with sand between)", () => {
    const seg = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t };
    };
    let mouths = 0;
    for (const seed of SEEDS) {
      const map = gameMap(GAME_MAP, seed, tuning(7));
      const rivers = map.terrain!.rivers!;
      const sea = rivers.find((r) => Math.max(...(r.widths ?? [r.width])) > 12);
      for (const river of rivers) {
        if (river === sea) continue;
        for (const end of [0, river.points.length - 1]) {
          const p = river.points[end]!;
          for (const host of rivers) {
            if (host === river || host === sea) continue;
            const hw = host.widths ?? host.points.map(() => host.width);
            let best = { d: Infinity, w: 0 };
            for (let k = 1; k < host.points.length; k += 1) {
              const { d, t } = seg(p, host.points[k - 1]!, host.points[k]!);
              if (d < best.d) best = { d, w: hw[k - 1]! + (hw[k]! - hw[k - 1]!) * t };
            }
            if (best.d > best.w / 2 + 1.5) continue; // not this river's mouth
            mouths += 1;
            expect(best.d).toBeLessThanOrEqual(best.w / 2 + 0.05);
          }
        }
      }
    }
    expect(mouths).toBeGreaterThan(0);
  }, 120_000);
});
