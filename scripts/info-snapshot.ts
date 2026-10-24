// A played game, as data for the information lab (info-lab.html; docs/brief.md,
// the carry-over plan: information design). The lab mocks the full game's
// three layers -- the map at a glance, side panels, the revenue screen -- on a
// real game, not made-up numbers. A run file already holds a summary of every
// day (money, the headline, the budget by line, routes, towns, corridors,
// events); this replays it once to its last day for what the map draws and the
// panels show (road shapes and loads, town shares and growth, sites, the moves
// the game names), and writes both to one JSON file.
//
//   bun scripts/info-snapshot.ts run.json [out.json]   # default out: src/info-lab/snapshot.json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { GAME_MAP } from "../src/game/map";
import { replayRun } from "../src/engine/game/runlog";
import { gameMap } from "../src/engine/game/region";
import { SECONDS_PER_GAME_DAY as D } from "../src/engine/economy/state";
import { segmentPolyline } from "../src/engine/game/roads";
import { roadCapacity } from "../src/engine/game/congestion";
import { townGrowth, growthTrend, roadFull } from "../src/engine/game/growth";
import { townShare, routeSummaries, diagnoseRoute, roadPath } from "../src/engine/game/world";
import { lorrySummaries, goodsFlows, flowKey } from "../src/engine/game/goods";
import { siteProduction } from "../src/engine/game/production";
import { corridorSummaries } from "../src/engine/game/corridors";
import { namedMoves, noSeatPairs } from "../src/engine/game/problems";
import { cargoName, fuelSupply } from "../src/engine/game/fuel";
import { cementBreak, cementServed } from "../src/engine/game/cement";
import { railPath } from "../src/engine/game/rail";
import { farmTowns } from "../src/engine/game/food";

const [runPath, outPath = "src/info-lab/snapshot.json"] = process.argv.slice(2);
if (!runPath) throw new Error("usage: bun scripts/info-snapshot.ts run.json [out.json]");
const file = JSON.parse(readFileSync(runPath, "utf8"));
const world = replayRun(GAME_MAP, file, file.ticks);
const r1 = (x: number) => Math.round(x * 10) / 10;
const perDay = (x: number) => Math.round(x * D);

const map = gameMap(GAME_MAP, file.seed, file.tuning ?? {});
const towns = [...world.towns.values()].map((t) => {
  const g = townGrowth(world, t.id);
  const share = townShare(world, t.id);
  const full = roadFull(world, t.id);
  return {
    id: t.id,
    name: t.name,
    x: t.x,
    y: t.y,
    population: r1(t.population),
    base: world.basePopulation.get(t.id) ?? null,
    industry: t.industry ?? null,
    roadside: !t.industry && !world.basePopulation.has(t.id),
    trend: growthTrend(world, t.id),
    target: g ? r1(g.target) : null,
    cap: g ? r1(g.cap) : null,
    cementHeld: g ? r1(g.cementHeld) : 0,
    expected: g ? r1(g.expected) : 0,
    share: { you: r1(share.player * 100) / 100, informal: r1(share.informal * 100) / 100, lost: r1(share.lost * 100) / 100 },
    fuel: fuelSupply(world, t.id)?.supplied ?? null,
    cement: world.cement ? cementServed(world, t.id) : null,
    roadFull: full && full.road ? { next: full.next, thin: !!full.thin } : null,
  };
});

const segments = world.simulation.map.segments.map((s) => {
  const flow = world.roadFlowEMA.get(s.id) ?? 0;
  const cap = s.type === "rail" ? Infinity : roadCapacity(world, s.id);
  return {
    id: s.id,
    a: s.fromNodeId,
    b: s.toNodeId,
    type: s.type,
    surface: s.surface ?? null,
    busLane: !!s.busLane,
    points: segmentPolyline(world.simulation.map, s).map((p) => [r1(p.x), r1(p.y)]),
    load: Number.isFinite(cap) && cap > 0 ? r1((flow / cap) * 100) / 100 : 0,
    speed: r1((world.segmentSpeed.get(s.id) ?? 1) * 100) / 100,
    condition: r1((s.condition ?? 1) * 100) / 100,
  };
});

const routes = routeSummaries(world).map((r) => {
  const d = diagnoseRoute(world, r.id);
  const route = world.routes.find((x) => x.id === r.id)!;
  const rail = r.id.startsWith("rail:");
  return {
    id: r.id,
    a: r.a,
    b: r.b,
    kind: rail ? "train" : r.id.startsWith("mini:") ? "minibus" : r.id.startsWith("brt:") ? "brt" : "bus",
    vehicles: r.buses,
    incomePerDay: Math.round(r.incomePerDay),
    costPerDay: Math.round(r.costPerDay),
    netPerDay: Math.round(r.netPerDay),
    ridersPerDay: perDay(route.boardingRateEMA),
    loadFactor: r1(route.loadFactorEMA * 100) / 100,
    verdict: d?.verdict ?? null,
    stops: (rail ? railPath(world, r.a, r.b) : roadPath(world, r.a, r.b))?.nodeIds ?? [r.a, r.b],
  };
});

const goodsLines = lorrySummaries(world).map((l) => ({
  id: l.id,
  a: l.a,
  b: l.b,
  vehicles: l.lorries,
  netPerDay: Math.round(l.netPerDay),
  stops: railPath(world, l.a, l.b)?.nodeIds ?? [l.a, l.b],
}));

const flows = goodsFlows(world).map((f) => {
  const o = world.goods.outcomes.get(flowKey(f));
  return {
    from: f.from,
    to: f.to,
    cargo: cargoName(world, f.from, f.kind, f.to),
    perDay: perDay(f.rate),
    yours: perDay(o?.delivered ?? 0),
    hauliers: perDay(o?.trucked ?? 0),
    spoiled: perDay(o?.spoiled ?? 0),
  };
}).filter((f) => f.perDay >= 1);

const sites = [...world.towns.values()].filter((t) => t.industry).map((t) => {
  const p = siteProduction(world, t.id);
  return {
    id: t.id,
    product: p?.product ?? null,
    made: p ? perDay(p.made) : 0,
    capacity: p ? perDay(p.capacity) : 0,
    limit: p?.limit ?? null,
    staffing: p?.staffing ?? null,
    shipped: p?.shipped ?? null,
  };
});

// Every trip between two towns a day, by outcome: the demand and no-seat overlays.
const pairs = new Map<string, { a: string; b: string; you: number; informal: number; noSeat: number; noRoad: number }>();
for (const [key, rates] of world.pairOutcomes) {
  const i = key.indexOf(":");
  const [from, to] = [key.slice(0, i), key.slice(i + 1)];
  const [a, b] = from < to ? [from, to] : [to, from];
  const reach = !!(roadPath(world, from, to) || railPath(world, from, to));
  const p = pairs.get(`${a}~${b}`) ?? { a, b, you: 0, informal: 0, noSeat: 0, noRoad: 0 };
  p.you += rates.player * D;
  p.informal += (rates.poached + rates.gaveUp) * D;
  if (reach) p.noSeat += rates.lost * D;
  else p.noRoad += rates.lost * D;
  pairs.set(`${a}~${b}`, p);
}
const demand = [...pairs.values()]
  .map((p) => ({ ...p, you: Math.round(p.you), informal: Math.round(p.informal), noSeat: Math.round(p.noSeat), noRoad: Math.round(p.noRoad) }))
  .filter((p) => p.you + p.informal + p.noSeat + p.noRoad >= 5);

// Every vehicle on the map at the last tick, counted on the road piece it's on: the real
// crowding the lab redraws (danfos, kekes and okadas by their id; trucks; the rest yours).
const pieceByEnds = new Map<string, string>();
for (const seg of world.simulation.map.segments) {
  pieceByEnds.set(`${seg.fromNodeId}|${seg.toNodeId}|${seg.type}`, seg.id);
  pieceByEnds.set(`${seg.toNodeId}|${seg.fromNodeId}|${seg.type}`, seg.id);
}
const traffic: Record<string, { danfo: number; keke: number; okada: number; truck: number; yours: number }> = {};
for (const v of world.simulation.vehicles) {
  const from = v.path[v.pathIndex];
  const to = v.path[v.pathIndex + 1];
  if (!from || !to) continue;
  const rail = world.railVehicles.has(v.id);
  const piece = pieceByEnds.get(`${from}|${to}|${rail ? "rail" : "road"}`);
  if (!piece) continue;
  const kind = v.id.startsWith("danfo-") ? "danfo" : v.id.startsWith("keke-") ? "keke" : v.id.startsWith("okada-") ? "okada" : v.id.startsWith("truck-") ? "truck" : "yours";
  traffic[piece] ??= { danfo: 0, keke: 0, okada: 0, truck: 0, yours: 0 };
  traffic[piece]![kind] += 1;
}

const corridors = corridorSummaries(world).map((c) => ({ a: c.a, b: c.b, you: c.you, informal: c.informal, lost: c.lost, taken: c.takenSince !== null }));
const moves = namedMoves(world).filter((m) => Number.isFinite(m.price)).slice(0, 20).map((m) => ({ label: m.label, price: Math.round(m.price) }));
const broken = cementBreak(world);

const snapshot = {
  seed: file.seed,
  regionEnabled: !!file.tuning?.regionEnabled,
  day: file.days.at(-1)?.day ?? null,
  savedAt: file.savedAt,
  width: map.width,
  height: map.height,
  port: world.port,
  farms: world.food ? farmTowns(world).map((t) => t.id) : [],
  towns,
  segments,
  routes,
  goodsLines,
  flows,
  sites,
  demand,
  corridors,
  noSeatPairs: noSeatPairs(world).slice(0, 10).map((p) => ({ ...p, perDay: Math.round(p.perDay) })),
  moves,
  cementBreak: broken,
  traffic,
  days: file.days,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(snapshot));
console.log(`wrote ${outPath}: day ${snapshot.day}, ${towns.length} towns, ${segments.length} segments, ${routes.length} routes, ${file.days.length} days`);
