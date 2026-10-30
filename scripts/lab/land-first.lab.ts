// Map version 7, the land first (the scope of 2026-10-30, A1-A2): what it changes in play. Twelve
// seeds, 15 days with nobody playing, version 6 against the latest (8) -- the sites placed and working, fuel
// supplied, trips a day -- and what a road between two towns beyond the home box costs.
//   bun scripts/lab/land-first.lab.ts
import { GAME_MAP } from "../../src/game/map";
import { startRun } from "../../src/engine/game/runlog";
import { gameTick } from "../../src/engine/game/tick";
import { SIM_DT } from "../../src/engine/loop";
import { SECONDS_PER_GAME_DAY } from "../../src/engine/economy/state";
import { siteProduction } from "../../src/engine/game/production";
import { fuelSupply, inHome } from "../../src/engine/game/fuel";
import { planRoad } from "../../src/engine/game/roads";
import { roadChain } from "../../src/engine/game/world";
import { headline } from "../../src/engine/game/world";

const seeds = [3, 11, 17, 42, 101, 256, 777, 1234, 2411, 2418, 4202, 8510];
const sum = { 6: { sites: 0, working: 0, fuel: 0, fuelN: 0, trips: 0, road: 0, roadN: 0, hills: 0 }, 8: { sites: 0, working: 0, fuel: 0, fuelN: 0, trips: 0, road: 0, roadN: 0, hills: 0 } };
for (const seed of seeds) {
  for (const version of [6, 8] as const) {
    const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { mapVersion: version });
    // Roads first, before the days run (the same pairs both versions: towns don't move).
    const far = [...w.towns.values()].filter((t) => !t.industry && !inHome(w, t)).sort((a, b) => a.id.localeCompare(b.id));
    for (let i = 0; i < far.length; i += 1) for (let j = i + 1; j < far.length; j += 1) {
      const [a, b] = [far[i]!, far[j]!];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 30 || roadChain(w, a.id, b.id)) continue;
      const plan = planRoad(w, a.id, b.id, "cheapest");
      if (!plan) continue;
      sum[version].road += plan.cost; sum[version].hills += plan.hillsCost; sum[version].roadN += 1;
    }
    for (let i = 0; i < Math.round((15 * SECONDS_PER_GAME_DAY) / SIM_DT); i += 1) gameTick(w, SIM_DT);
    const sites = [...w.towns.values()].filter((t) => t.industry);
    sum[version].sites += sites.length;
    sum[version].working += sites.filter((s) => (siteProduction(w, s.id)?.made ?? 0) > 0).length;
    for (const t of w.towns.values()) { const f = fuelSupply(w, t.id); if (f) { sum[version].fuel += f.supplied; sum[version].fuelN += 1; } }
    sum[version].trips += headline(w).tripsPerDay ?? 0;
  }
  process.stdout.write(".");
}
console.log();
for (const v of [6, 8] as const) {
  const s = sum[v];
  console.log(`version ${v}: sites ${s.sites}, working ${s.working}, fuel supplied ${((s.fuel / Math.max(1, s.fuelN)) * 100).toFixed(1)}%, trips ${Math.round(s.trips / seeds.length)} a day; a road beyond the home box ₦${Math.round(s.road / Math.max(1, s.roadN))} on average (hills ₦${Math.round(s.hills / Math.max(1, s.roadN))}), ${s.roadN} pairs`);
}
