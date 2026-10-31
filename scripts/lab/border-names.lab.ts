// The border crossing's and the coast road's names, by map version.   bun scripts/lab/border-names.lab.ts
import { GAME_MAP } from "../../src/game/map";
import { startRun } from "../../src/engine/game/runlog";
import { borderCountry } from "../../src/engine/game/border";
for (const seed of [3, 11, 42, 2418, 4202, 8510]) for (const mapVersion of [8, 12]) {
  const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { warmUpDays: 0, mapVersion });
  const coast = [...w.towns.values()].find((t) => t.industry === "gateway");
  console.log(`${seed} v${mapVersion} ${w.region}: ${w.border ? w.towns.get(w.border)!.name : "-"} (to ${borderCountry(w)})${coast ? ` · ${coast.name}` : ""}`);
}
