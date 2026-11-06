// Water's case (docs/water.md; five-modes.md §5), before building it. On one map at day 1: the rivers as a
// waterway (each drawn line's centre, its width at each point standing for its depth; a
// tributary joined where its end meets another line; the sea, a line 9+ wide, joining the mouths),
// how much of it is wide enough for a boat, the towns and sites near enough for a jetty, the fords
// that block it (a road low on the water: no boat passes), and what would go by it -- the goods
// flows and the people between jetty places, by road against by water, and the fords to raise.
//   SEED=2418 bun scripts/water-probe.ts   (docs/water.md; REACH=, EDGES=1 for each town's distance)
import { GAME_MAP } from "../src/game/map";
import { startRun } from "../src/engine/game/runlog";
import { goodsFlows } from "../src/engine/game/goods";
import { pairDemand, roadPath } from "../src/engine/game/world";
import { fordBridgeCost } from "../src/engine/game/floods";
import { SECONDS_PER_GAME_DAY as D } from "../src/engine/economy/state";
import type { Ford } from "../src/engine/game/floods";

const seed = Number(process.env.SEED ?? 2418);
/** Widths (cells) a boat needs: the probe reports each. */
const DEPTHS = [1.5, 2.5, 3.5];
/** A jetty's reach: a place this far from the water's edge. */
const REACH = Number(process.env.REACH ?? 7);
const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, process.env.MAP_VERSION ? { mapVersion: Number(process.env.MAP_VERSION) } : {});
const name = (id: string) => w.towns.get(id)?.name ?? id;

// --- The waterway: one node a drawn point.
interface Node { x: number; y: number; width: number; line: number; sea: boolean }
const nodes: Node[] = [];
const edges: Array<Array<{ to: number; len: number }>> = [];
const lines = (w.waterLines ?? []).map((r, i) => ({ r, i })).filter(({ r }) => !r.lake);
const firstOf: number[] = [];
const lastOf: number[] = [];
for (const { r, i } of lines) {
  const sea = Math.max(r.width, ...(r.widths ?? [])) >= 9;
  firstOf[i] = nodes.length;
  r.points.forEach(([x, y], k) => {
    nodes.push({ x, y, width: r.widths?.[k] ?? r.width, line: i, sea });
    edges.push([]);
    if (k > 0) {
      const a = nodes.length - 2, b = nodes.length - 1;
      const len = Math.hypot(x - nodes[a]!.x, y - nodes[a]!.y);
      edges[a]!.push({ to: b, len });
      edges[b]!.push({ to: a, len });
    }
  });
  lastOf[i] = nodes.length - 1;
}
// Joins: a line's end within the other line's water.
for (const { i } of lines) {
  for (const end of [firstOf[i]!, lastOf[i]!]) {
    const e = nodes[end]!;
    let best = -1, bestD = Infinity;
    nodes.forEach((n, j) => {
      if (n.line === i) return;
      const d = Math.hypot(n.x - e.x, n.y - e.y);
      if (d < bestD) { bestD = d; best = j; }
    });
    if (best >= 0 && bestD <= nodes[best]!.width / 2 + e.width / 2 + 2) {
      edges[end]!.push({ to: best, len: bestD });
      edges[best]!.push({ to: end, len: bestD });
    }
  }
}
// The sea: its own points are off the map; join every sea node to every other along it (it is one
// water), already done by its line's chain.

// --- Fords on the water: each ford at its nearest node (a road low on the water there).
const fords = w.floods?.fords ?? [];
const fordAt = new Map<number, Ford>();
for (const f of fords) {
  let best = -1, bestD = Infinity;
  nodes.forEach((n, j) => { const d = Math.hypot(n.x - f.x, n.y - f.y); if (d < bestD) { bestD = d; best = j; } });
  if (best >= 0 && bestD <= nodes[best]!.width / 2 + 2) fordAt.set(best, f);
}

// --- Navigable length at each depth.
function lengthAt(depth: number): number {
  let total = 0;
  edges.forEach((list, a) => list.forEach(({ to, len }) => { if (to > a && !nodes[a]!.sea && Math.min(nodes[a]!.width, nodes[to]!.width) >= depth) total += len; }));
  return total;
}

// How far each town sits from the water's edge (the generator keeps towns off it).
if (process.env.EDGES) {
  const edge = [...w.towns.values()].filter((t) => !t.industry).map((t) => Math.min(...nodes.map((n) => Math.hypot(n.x - t.x, n.y - t.y) - n.width / 2))).sort((a, b) => a - b);
  console.log(`  towns' distance to the water's edge: ${edge.map((d) => d.toFixed(1)).join(" ")}`);
}
// --- Jetty places: towns and sites near water deep enough.
const places = [...w.towns.values()].map((t) => {
  let best = -1, bestD = Infinity;
  nodes.forEach((n, j) => { const d = Math.hypot(n.x - t.x, n.y - t.y) - n.width / 2; if (d < bestD) { bestD = d; best = j; } });
  return { t, node: best, edge: bestD };
}).filter((p) => p.node >= 0 && p.edge <= REACH);

// Dijkstra over water at a depth, from a node: distance and the fords passed (by predecessor).
function water(from: number, depth: number): { dist: Float64Array; prev: Int32Array } {
  const dist = new Float64Array(nodes.length).fill(Infinity);
  const prev = new Int32Array(nodes.length).fill(-1);
  dist[from] = 0;
  const open = new Set<number>([from]);
  while (open.size) {
    let u = -1, du = Infinity;
    for (const v of open) if (dist[v]! < du) { du = dist[v]!; u = v; }
    open.delete(u);
    for (const { to, len } of edges[u]!) {
      if (Math.min(nodes[u]!.width, nodes[to]!.width) < depth && !(nodes[u]!.sea && nodes[to]!.sea)) continue;
      if (du + len < dist[to]!) { dist[to] = du + len; prev[to] = u; open.add(to); }
    }
  }
  return { dist, prev };
}
function fordsOn(prev: Int32Array, to: number): Ford[] {
  const out: Ford[] = [];
  for (let v = to; v >= 0; v = prev[v]!) { const f = fordAt.get(v); if (f && !f.bridged) out.push(f); }
  return out;
}

const seaport = w.seaport ? w.towns.get(w.seaport) : undefined;
console.log(`map ${seed}: ${lines.length} rivers and seas (${lines.filter(({ r }) => Math.max(r.width, ...(r.widths ?? [])) >= 9).length} sea), ${fords.length} fords (${fordAt.size} on a waterway); seaport ${seaport?.name}${seaport?.industry ? ` (${seaport.industry})` : ""}`);
console.log(`  river wide enough: ${DEPTHS.map((d) => `${d}+ cells ${Math.round(lengthAt(d))}`).join(", ")} cells of river`);
console.log(`  jetty places (within ${REACH} of the water): ${places.length} -- towns ${places.filter((p) => !p.t.industry).length} (${places.filter((p) => !p.t.industry).map((p) => `${p.t.name} w${nodes[p.node]!.width.toFixed(1)}`).join(", ")}), sites ${places.filter((p) => p.t.industry).length}; seaport ${places.some((p) => p.t.id === w.seaport) ? "on the water" : "not"}`);

const flows = goodsFlows(w);
const allTonnes = flows.reduce((s, f) => s + f.rate * D, 0);
const placeOf = new Map(places.map((p) => [p.t.id, p]));
for (const depth of DEPTHS) {
  const from = new Map<number, ReturnType<typeof water>>();
  const reach = (node: number) => from.get(node) ?? (from.set(node, water(node, depth)), from.get(node)!);
  // Freight between jetty places.
  const by: Array<{ f: (typeof flows)[number]; road: number; water: number; fords: Ford[] }> = [];
  for (const f of flows) {
    const a = placeOf.get(f.from), b = placeOf.get(f.to);
    if (!a || !b || a.node === b.node) continue;
    const r = reach(a.node);
    if (!Number.isFinite(r.dist[b.node]!)) continue;
    by.push({ f, road: roadPath(w, f.from, f.to)?.distance ?? Infinity, water: r.dist[b.node]!, fords: fordsOn(r.prev, b.node) });
  }
  const tonnes = by.reduce((s, x) => s + x.f.rate * D, 0);
  const open = by.filter((x) => x.fords.length === 0);
  const fordSet = new Map<string, Ford>();
  for (const x of by) for (const f of x.fords) fordSet.set(f.id, f);
  console.log(`  boats needing ${depth}+ cells: goods by water ${Math.round(tonnes)} of ${Math.round(allTonnes)} t/day (${by.length} flows), ${Math.round(open.reduce((s, x) => s + x.f.rate * D, 0))} with no ford in the way; to open the rest raise ${fordSet.size} fords, ₦${Math.round([...fordSet.values()].reduce((s, f) => s + fordBridgeCost(w, f), 0) / 1000)}k`);
  for (const x of by.sort((p, q) => q.f.rate - p.f.rate).slice(0, 5)) console.log(`      ${name(x.f.from)} -> ${name(x.f.to)} ${x.f.kind} ${(x.f.rate * D).toFixed(0)} t/day: road ${Math.round(x.road)} cells, water ${Math.round(x.water)}${x.fords.length ? `, fords ${x.fords.map((f) => f.name).join(", ")}` : ""}`);
  // People between jetty towns.
  const towns = places.filter((p) => !p.t.industry);
  let people = 0;
  const pairs: Array<{ a: string; b: string; day: number; road: number; water: number; fords: number }> = [];
  for (let i = 0; i < towns.length; i += 1) for (let j = i + 1; j < towns.length; j += 1) {
    const a = towns[i]!, b = towns[j]!;
    const r = reach(a.node);
    if (!Number.isFinite(r.dist[b.node]!) || a.node === b.node) continue;
    const day = pairDemand(w, a.t.id, b.t.id) * D;
    people += day;
    pairs.push({ a: a.t.name, b: b.t.name, day, road: roadPath(w, a.t.id, b.t.id)?.distance ?? Infinity, water: r.dist[b.node]!, fords: fordsOn(r.prev, b.node).length });
  }
  const allPeople = w.simulation.demand.reduce((s, p) => s + p.rate, 0) * D;
  console.log(`    people between jetty towns: ${Math.round(people)} of ${Math.round(allPeople)} a day, ${pairs.length} pairs; busiest: ${pairs.sort((p, q) => q.day - p.day).slice(0, 4).map((p) => `${p.a}-${p.b} ${Math.round(p.day)} (road ${Math.round(p.road)}, water ${Math.round(p.water)}${p.fords ? `, ${p.fords} ford${p.fords > 1 ? "s" : ""}` : ""})`).join("; ")}`);
}

// The home city, the seaport and each far cluster's regional town: how far from the water, and
// whether the water joins them (2.5+ cells wide; the sea counts), its length and the fords on it.
{
  const nearestNode = (x: number, y: number) => { let best = -1, bestD = Infinity; nodes.forEach((n, j) => { const d = Math.hypot(n.x - x, n.y - y) - n.width / 2; if (d < bestD) { bestD = d; best = j; } }); return { node: best, edge: bestD }; };
  const home = [...w.towns.values()].filter((t) => !t.industry).sort((a, b) => b.population - a.population)[0]!;
  const hubs = (w.clusters ?? []).map((c) => w.towns.get(c.hub)!).filter(Boolean);
  const port = w.seaport ? w.towns.get(w.seaport) : undefined;
  const h = nearestNode(home.x, home.y);
  const r = water(h.node, 2.5);
  const to = (t: { name: string; x: number; y: number }) => {
    const n = nearestNode(t.x, t.y);
    const d = r.dist[n.node]!;
    return `${t.name} ${n.edge.toFixed(1)} off the water${Number.isFinite(d) ? `, ${Math.round(d)} by water from ${home.name}${fordsOn(r.prev, n.node).length ? ` (${fordsOn(r.prev, n.node).length} fords)` : ""}` : ", not joined by water"}`;
  };
  console.log(`  home ${home.name} ${h.edge.toFixed(1)} off the water; seaport: ${port && port.id !== home.id ? to(port) : port ? "the home city" : "none"}; far hubs: ${hubs.map(to).join("; ")}`);
}
