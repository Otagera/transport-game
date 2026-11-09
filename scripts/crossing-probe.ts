// Water's step 3 measured before it's built (docs/water.md, Step 3): on one map at the start, the
// fords on the water routes worth a boat -- how many of the busiest pairs the water joins have one
// in the way, how many fords that is, and what raising them all costs.
//   SEED=8703 bun scripts/crossing-probe.ts
import { GAME_MAP } from "../src/game/map";
import { startRun } from "../src/engine/game/runlog";
import { pairDemand } from "../src/engine/game/world";
import { fordBridgeCost } from "../src/engine/game/floods";
import { jettyLanding, minWidth, waterWay } from "../src/engine/game/boats";
import { waterway } from "../src/engine/game/waterways";
import { SECONDS_PER_GAME_DAY as D } from "../src/engine/economy/state";

const seed = Number(process.env.SEED ?? 8703);
const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, {});
const way = waterway(w);
const fords = w.floods?.fords ?? [];
// Each ford at the waterway node it lies on (within the water's edge and a cell).
const fordAt = new Map<number, (typeof fords)[number]>();
for (const f of fords) {
  let best = -1, bestD = Infinity;
  way.nodes.forEach((n, j) => { const d = Math.hypot(n.x - f.x, n.y - f.y); if (d < bestD) { bestD = d; best = j; } });
  if (best >= 0 && bestD <= way.nodes[best]!.width / 2 + 1.5) fordAt.set(best, f);
}
const near = (x: number, y: number) => { let best = -1, bestD = Infinity; way.nodes.forEach((n, j) => { const d = Math.hypot(n.x - x, n.y - y); if (d < bestD) { bestD = d; best = j; } }); return best; };
const towns = [...w.towns.values()].filter((t) => !t.industry && jettyLanding(w, t.id));
const pairs: Array<{ a: string; b: string; day: number; fords: string[] }> = [];
for (let i = 0; i < towns.length; i += 1) for (let j = i + 1; j < towns.length; j += 1) {
  const a = towns[i]!, b = towns[j]!;
  const route = waterWay(w, a.id, b.id, "boat");
  if (!route) continue;
  const on = new Set<string>();
  for (const [x, y] of route.points.slice(1, -1)) { const f = fordAt.get(near(x, y)); if (f) on.add(f.id); }
  pairs.push({ a: a.name, b: b.name, day: (pairDemand(w, a.id, b.id) + pairDemand(w, b.id, a.id)) * D, fords: [...on] });
}
pairs.sort((p, q) => q.day - p.day);
const top = pairs.slice(0, 10);
const blocked = top.filter((p) => p.fords.length > 0);
const needed = new Set(blocked.flatMap((p) => p.fords));
const cost = [...needed].reduce((s, id) => s + fordBridgeCost(w, fords.find((f) => f.id === id)!), 0);
console.log(`map ${seed}: ${fords.length} fords, ${fordAt.size} on the waterway; of the 10 busiest pairs the water joins, ${blocked.length} have a ford in the way (${needed.size} fords, raising them ₦${Math.round(cost / 1000)}k); widths ${minWidth(w, "boat")}`);
for (const p of top) console.log(`  ${p.a}-${p.b} ${Math.round(p.day)}/day: ${p.fords.length ? p.fords.map((id) => fords.find((f) => f.id === id)!.name).join(", ") : "clear"}`);
