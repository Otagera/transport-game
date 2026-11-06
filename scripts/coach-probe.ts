// The coach's case (five-modes.md §3), before building it. On one map at day 1 (after the warm-up),
// every cluster open: the town pairs 60+ cells apart by road, how many travel end to end a day
// (a coach's only riders: it doesn't stop between), whether the road is trunk all the way, and for
// the busiest, what a real bus on the pair nets, days 4-12 (on a copy) against a
// coach at the scope's numbers (50 seats, 1.8x the fare, the bus's round trips -- the same roads).
//   SEED=2418 bun scripts/coach-probe.ts   (five-modes.md §3: why the coach is shelved)
import { GAME_MAP } from "../src/game/map";
import { startRun } from "../src/engine/game/runlog";
import { demandAlong, diagnoseRoute, pairDemand, roadPath, routeSummaries } from "../src/engine/game/world";
import { applyAction } from "../src/engine/game/actions";
import { gameTick } from "../src/engine/game/tick";
import { SIM_DT } from "../src/engine/loop";
import { trunkSet } from "../src/engine/game/trunks";
import { clusterAt } from "../src/engine/game/remit";
import { stageFare } from "../src/engine/game/fares";
import { SECONDS_PER_GAME_DAY as D } from "../src/engine/economy/state";
import type { GameWorld } from "../src/engine/game/types";

const seed = Number(process.env.SEED ?? 2418);
const MIN = Number(process.env.MIN_CELLS ?? 60);
const DAYS = Number(process.env.DAYS ?? 12);
const TOP = Number(process.env.TOP ?? 3);
const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, 5e6, {});
if (w.remit && w.clusters) w.remit.open = [...new Set([...w.remit.open, ...w.clusters.map((c) => c.hub)])];
const name = (id: string) => w.towns.get(id)?.name ?? id;
const where = (id: string) => (clusterAt(w, id) ? `far:${name(clusterAt(w, id)!.hub)}` : "home");
const towns = [...w.towns.values()].filter((t) => !t.industry);
const trunks = trunkSet(w);

interface Pair { a: string; b: string; cells: number; trunk: number; e2e: number; along: number; cross: boolean }
const pairs: Pair[] = [];
const short: Pair[] = [];
for (let i = 0; i < towns.length; i += 1) {
  for (let j = i + 1; j < towns.length; j += 1) {
    const [a, b] = [towns[i]!.id, towns[j]!.id];
    const path = roadPath(w, a, b);
    if (!path) continue;
    const p: Pair = {
      a, b, cells: path.distance,
      trunk: path.segmentIds.filter((s) => trunks.has(s)).length / Math.max(1, path.segmentIds.length),
      e2e: pairDemand(w, a, b) * D, along: demandAlong(w, a, b) * D, cross: where(a) !== where(b),
    };
    (p.cells >= MIN ? pairs : p.cells >= 15 && p.cells <= 40 ? short : []).push(p);
  }
}
pairs.sort((p, q) => q.e2e - p.e2e);
short.sort((p, q) => q.e2e - p.e2e);
const total = pairs.reduce((s, p) => s + p.e2e, 0);
const allTrips = w.simulation.demand.reduce((s, p) => s + p.rate, 0) * D;
console.log(`map ${seed}: ${towns.length} towns, ${w.clusters?.length ?? 0} far clusters; pairs ${MIN}+ cells by road: ${pairs.length} (${pairs.filter((p) => p.trunk === 1).length} trunk all the way, ${pairs.filter((p) => p.cross).length} between clusters)`);
console.log(`  end-to-end on them: ${Math.round(total)} a day of ${Math.round(allTrips)} wanted on the map (${((total / allTrips) * 100).toFixed(1)}%); pairs with 50+ a day: ${pairs.filter((p) => p.e2e >= 50).length}, 20+: ${pairs.filter((p) => p.e2e >= 20).length}`);
const row = (p: Pair) => `${name(p.a)}-${name(p.b)} ${Math.round(p.cells)} cells, ${Math.round(p.trunk * 100)}% trunk, ${where(p.a)}/${where(p.b)}: ${Math.round(p.e2e)} end to end a day, ${Math.round(p.along)} along it`;
for (const p of pairs.slice(0, 8)) console.log(`    ${row(p)}`);

// A bus on the pair, on a copy, for DAYS days: its income and cost each day (the ledger keeps one
// day), averaged over the days after the first three (it fills up), and its round trips at the end.
function bus(world: GameWorld, p: Pair) {
  const copy = structuredClone(world);
  const made = applyAction(copy, { kind: "bus", a: p.a, b: p.b });
  if (!made.ok) return { ok: false as const, reason: made.reason };
  const route = copy.routes.find((r) => (r.a === p.a && r.b === p.b) || (r.a === p.b && r.b === p.a))!;
  const days: { income: number; cost: number }[] = [];
  for (let d = 0; d < DAYS; d += 1) {
    for (let i = 0; i < D / SIM_DT; i += 1) gameTick(copy, SIM_DT);
    const s = routeSummaries(copy).find((x) => x.id === route.id)!;
    if (d >= 3) days.push({ income: s.incomePerDay, cost: s.costPerDay });
  }
  const dg = diagnoseRoute(copy, route.id)!;
  const mean = (f: (x: { income: number; cost: number }) => number) => days.reduce((t, x) => t + f(x), 0) / days.length;
  return { ok: true as const, income: mean((x) => x.income), cost: mean((x) => x.cost), trips: dg.roundTripsPerDay, load: dg.loadFactor, boardings: dg.boardingsPerDay };
}

const coach = (p: Pair, roundTrips: number) => {
  const each = Math.min(p.e2e / 2, 50 * roundTrips);
  const fare = 1.8 * stageFare(w.tuning, p.cells);
  return { riders: 2 * each, fare, revenue: 2 * each * fare };
};

const k = (n: number) => `₦${Math.round(n)}`;
for (const [label, list] of [["long", pairs.slice(0, TOP)], ["short, for comparison", short.slice(0, 1)]] as const) {
  for (const p of list) {
    const m = bus(w, p);
    if (!m.ok) { console.log(`  bus ${name(p.a)}-${name(p.b)}: refused (${m.reason})`); continue; }
    const c = coach(p, m.trips);
    console.log(`  ${label}: ${row(p)}`);
    console.log(`    a bus, days 4-${DAYS}: income ${k(m.income)}, cost ${k(m.cost)}, net ${k(m.income - m.cost)} a day; ${m.trips.toFixed(2)} round trips a day, load ${Math.round(m.load * 100)}%, ${Math.round(m.boardings)} boardings a day`);
    if (label === "long") console.log(`    a coach at those round trips: ${Math.round(c.riders)} riders a day at ${k(c.fare)} = ${k(c.revenue)} a day (a bus costs ${k(m.cost)}); its seats ${Math.round(50 * m.trips)} a day each way`);
  }
}
