// Map version 10, the home cluster's land: how much each map's home box gets, what it costs to
// draw, and the trunk's legs before and after.   bun scripts/lab/home-land.lab.ts
import { GAME_MAP } from "../../src/game/map";
import { gameMap } from "../../src/engine/game/region";
import { DEFAULT_GAME_TUNING } from "../../src/engine/game/tuning";
const seeds = [3, 11, 17, 42, 101, 256, 777, 1234, 2411, 2418, 4202, 8510];
for (const seed of seeds) {
  const t0 = performance.now();
  gameMap(GAME_MAP, seed, { ...DEFAULT_GAME_TUNING, mapVersion: 9 });
  const t1 = performance.now();
  const map = gameMap(GAME_MAP, seed, { ...DEFAULT_GAME_TUNING, mapVersion: 10 });
  const t2 = performance.now();
  console.log(`${seed} ${map.region}: home share ${map.terrain?.relief?.home ?? 0} · drawn in ${Math.round(t1 - t0)} -> ${Math.round(t2 - t1)} ms`);
}
