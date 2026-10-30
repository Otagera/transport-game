// The land first (map versions 8-10; the fidelity scope of 2026-10-30): what a map version changes in
// play. Twelve seeds, 15 days with nobody playing, one version against another -- the sites placed and
// working, fuel supplied, trips a day -- and what a road between two towns costs, in the home box and
// beyond it.
//   bun scripts/lab/land-first.lab.ts [from] [to]      (default: 9 10)
import { GAME_MAP } from "../../src/game/map";
import { startRun } from "../../src/engine/game/runlog";
import { gameTick } from "../../src/engine/game/tick";
import { SIM_DT } from "../../src/engine/loop";
import { SECONDS_PER_GAME_DAY } from "../../src/engine/economy/state";
import { siteProduction } from "../../src/engine/game/production";
import { fuelSupply, inHome } from "../../src/engine/game/fuel";
import { planRoad } from "../../src/engine/game/roads";
import { headline, roadChain } from "../../src/engine/game/world";

const versions = (process.argv.length > 3 ? process.argv.slice(2, 4) : ["9", "10"]).map(Number);
const seeds = [3, 11, 17, 42, 101, 256, 777, 1234, 2411, 2418, 4202, 8510];
const blank = () => ({ sites: 0, working: 0, fuel: 0, fuelN: 0, trips: 0, home: { cost: 0, hills: 0, n: 0 }, far: { cost: 0, hills: 0, n: 0 } });
const sum = new Map(versions.map((v) => [v, blank()]));
for (const seed of seeds) {
  for (const version of versions) {
    const s = sum.get(version)!;
    const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { mapVersion: version });
    // Roads first, before the days run (the same pairs both versions: towns don't move, though their names may).
    const towns = [...w.towns.values()].filter((t) => !t.industry).sort((a, b) => a.x - b.x || a.y - b.y);
    for (let i = 0; i < towns.length; i += 1) for (let j = i + 1; j < towns.length; j += 1) {
      const [a, b] = [towns[i]!, towns[j]!];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 30 || roadChain(w, a.id, b.id) || inHome(w, a) !== inHome(w, b)) continue;
      const plan = planRoad(w, a.id, b.id, "cheapest");
      if (!plan) continue;
      const bucket = inHome(w, a) ? s.home : s.far;
      bucket.cost += plan.cost; bucket.hills += plan.hillsCost; bucket.n += 1;
    }
    for (let i = 0; i < Math.round((15 * SECONDS_PER_GAME_DAY) / SIM_DT); i += 1) gameTick(w, SIM_DT);
    const sites = [...w.towns.values()].filter((t) => t.industry);
    s.sites += sites.length;
    s.working += sites.filter((site) => (siteProduction(w, site.id)?.made ?? 0) > 0).length;
    for (const t of w.towns.values()) { const f = fuelSupply(w, t.id); if (f) { s.fuel += f.supplied; s.fuelN += 1; } }
    s.trips += headline(w).tripsPerDay ?? 0;
  }
  process.stdout.write(".");
}
console.log();
const avg = (b: { cost: number; hills: number; n: number }) => `₦${Math.round(b.cost / Math.max(1, b.n))} (hills ₦${Math.round(b.hills / Math.max(1, b.n))}, ${b.n} pairs)`;
for (const [v, s] of sum) {
  console.log(`version ${v}: sites ${s.sites}, working ${s.working}, fuel supplied ${((s.fuel / Math.max(1, s.fuelN)) * 100).toFixed(1)}%, trips ${Math.round(s.trips / seeds.length)} a day; a road in the home box ${avg(s.home)}, beyond it ${avg(s.far)}`);
}
