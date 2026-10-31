// Map version 13's land: lakes, swamps, dry beds and dunes by seed.   bun scripts/lab/forms.lab.ts
import { GAME_MAP } from "../../src/game/map";
import { gameMap } from "../../src/engine/game/region";
import { DEFAULT_GAME_TUNING } from "../../src/engine/game/tuning";
for (const seed of [3, 11, 17, 42, 101, 256, 777, 1234, 2411, 2418, 4202, 8510]) {
  const m = gameMap(GAME_MAP, seed, DEFAULT_GAME_TUNING);
  const lakes = (m.terrain?.rivers ?? []).filter((r) => r.lake).length;
  const f = m.features ?? {};
  console.log(`${seed} ${m.region}: lakes ${lakes}, wetlands ${f.wetlands?.length ?? 0}, dry beds ${f.dryBeds?.length ?? 0}, dunes ${f.dunes?.length ?? 0}, hamlets ${m.hamlets?.length ?? 0}`);
}
