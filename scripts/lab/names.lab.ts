// Map version 8's names: a dozen maps' towns, by region (names.ts).   bun scripts/lab/names.lab.ts
import { GAME_MAP } from "../../src/game/map";
import { gameMap } from "../../src/engine/game/region";
import { DEFAULT_GAME_TUNING } from "../../src/engine/game/tuning";
for (const seed of [3, 11, 17, 42, 101, 256, 777, 1234, 2411, 2418, 4202, 8510]) {
  const map = gameMap(GAME_MAP, seed, DEFAULT_GAME_TUNING);
  console.log(`${seed} ${map.region}: ${[...map.towns].sort((a, b) => b.population - a.population).map((t) => t.name).join(", ")}`);
}
