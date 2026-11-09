// Jetties and boats measured (docs/water.md, Step 2: C53, C54). On one map: the towns a jetty
// could go at, the pairs the water joins (water against road), then -- from a world as it starts
// -- a water bus between the two busiest jetty towns the water joins, against buses on the road
// between them, and a barge on the waterside goods leg with the most tonnes, against a freight
// lorry's worth (hauliers'). Each run 40 days; nets are the mean of days 21-40.
//   SEED=7585 bun scripts/boat-probe.ts   (DAYS=, BUSES=)
import { GAME_MAP } from "../src/game/map";
import { startRun } from "../src/engine/game/runlog";
import { applyAction, type ActionSpec } from "../src/engine/game/actions";
import { gameTick } from "../src/engine/game/tick";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "../src/engine/economy/state";
import { pairDemand, roadPath, routeSummaries } from "../src/engine/game/world";
import { goodsFlows, lorrySummaries } from "../src/engine/game/goods";
import { crossingsInTheWay, jettyLanding, waterWay } from "../src/engine/game/boats";
import { fordBridgeCost } from "../src/engine/game/floods";
import type { GameWorld } from "../src/engine/game/types";

const seed = Number(process.env.SEED ?? 7585);
const DAYS = Number(process.env.DAYS ?? 40);
const begin = () => startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, {});
const w0 = begin();
const name = (id: string) => w0.towns.get(id)?.name ?? id;

const jettyTowns = [...w0.towns.values()].filter((t) => !t.industry && jettyLanding(w0, t.id));
console.log(`map ${seed}: ${jettyTowns.length} towns a jetty could go at: ${jettyTowns.map((t) => `${t.name} (${Math.round(t.population / 1000)}k, ${jettyLanding(w0, t.id)!.edge.toFixed(1)} off)`).join(", ")}`);

const pairs: Array<{ a: string; b: string; day: number; road: number; water: number }> = [];
for (let i = 0; i < jettyTowns.length; i += 1) for (let j = i + 1; j < jettyTowns.length; j += 1) {
  const a = jettyTowns[i]!.id, b = jettyTowns[j]!.id;
  const way = waterWay(w0, a, b, "boat");
  if (!way) continue;
  pairs.push({ a, b, day: (pairDemand(w0, a, b) + pairDemand(w0, b, a)) * D, road: roadPath(w0, a, b)?.distance ?? Infinity, water: way.length });
}
pairs.sort((p, q) => q.day - p.day);
console.log(`  pairs the water joins (a water bus): ${pairs.length}; busiest: ${pairs.slice(0, 6).map((p) => `${name(p.a)}-${name(p.b)} ${Math.round(p.day)}/day, water ${Math.round(p.water)} road ${Number.isFinite(p.road) ? Math.round(p.road) : "none"}`).join("; ")}`);

/** Runs a world `DAYS` days after the moves, the line's net the mean of the second half. */
function play(moves: ActionSpec[], lineOf: (w: GameWorld) => number | null): { net: number | null; refused: string[] } {
  const w = begin();
  w.economy.funds = 1e7;
  const refused = moves.map((m) => applyAction(w, m)).map((r, i) => (r.ok ? "" : `${moves[i]!.kind}: ${r.reason}`)).filter(Boolean);
  const perDay = Math.round(D / SIM_DT);
  const nets: number[] = [];
  for (let day = 1; day <= DAYS; day += 1) {
    for (let i = 0; i < perDay; i += 1) gameTick(w, SIM_DT);
    if (day > DAYS / 2) {
      const n = lineOf(w);
      if (n !== null) nets.push(n);
    }
  }
  return { net: nets.length ? nets.reduce((s, x) => s + x, 0) / nets.length : null, refused };
}
const routeNet = (id: string) => (w: GameWorld) => routeSummaries(w).find((r) => r.id === id)?.netPerDay ?? null;
const routesNet = (pred: (id: string) => boolean) => (w: GameWorld) => routeSummaries(w).filter((r) => pred(r.id)).reduce((s, r) => s + r.netPerDay, 0);

// C53: a water bus between the busiest pair, against buses on the road.
const shortWay = pairs.find((p) => p.water <= p.road) ?? null;
for (const p of process.env.ONLY === "barge" ? [] : [pairs[0], shortWay].filter((x, i, all): x is (typeof pairs)[number] => !!x && all.indexOf(x) === i)) {
  const jetties: ActionSpec[] = [{ kind: "jetty", townId: p.a }, { kind: "jetty", townId: p.b }];
  const boat = play([...jetties, { kind: "boat", a: p.a, b: p.b }], routesNet((id) => id.startsWith("boat:")));
  const boat2 = play([...jetties, { kind: "boat", a: p.a, b: p.b }, { kind: "boat", a: p.a, b: p.b }], routesNet((id) => id.startsWith("boat:")));
  const buses: string[] = [];
  if (Number.isFinite(p.road)) for (const n of [1, 2, 4]) {
    const r = play(Array.from({ length: n }, () => ({ kind: "bus" as const, a: p.a, b: p.b })), routesNet((id) => !id.startsWith("boat:") && !id.startsWith("rail:")));
    buses.push(`${n} bus${n > 1 ? "es" : ""} ₦${Math.round(r.net ?? 0)}`);
  }
  console.log(`  C53 ${name(p.a)}-${name(p.b)} (${Math.round(p.day)} trips/day, water ${Math.round(p.water)}, road ${Number.isFinite(p.road) ? Math.round(p.road) : "none"}): 1 water bus ₦${Math.round(boat.net ?? 0)}/day, 2 ₦${Math.round(boat2.net ?? 0)}${boat.refused.length ? ` (refused: ${boat.refused.join("; ")})` : ""}; on the road ${buses.join(", ") || "no road"}`);
}

// C54: a barge on the waterside goods leg with the most tonnes.
const flows = goodsFlows(w0);
const legs = new Map<string, { a: string; b: string; out: number; back: number }>();
for (const f of flows) {
  if (!jettyLanding(w0, f.from) && !w0.towns.get(f.from)?.industry) continue;
  const key = [f.from, f.to].sort().join("|");
  const leg = legs.get(key) ?? { a: f.from < f.to ? f.from : f.to, b: f.from < f.to ? f.to : f.from, out: 0, back: 0 };
  if (f.from === leg.a) leg.out += f.rate * D;
  else leg.back += f.rate * D;
  legs.set(key, leg);
}
const barged = [...legs.values()]
  .filter((l) => !w0.towns.get(l.a)?.industry && !w0.towns.get(l.b)?.industry && (waterWay(w0, l.a, l.b, "barge") || crossingsInTheWay(w0, l.a, l.b, "barge").length > 0))
  .sort((p, q) => q.out + q.back - (p.out + p.back));
console.log(`  goods legs between waterside towns a barge can reach: ${barged.length}; most: ${barged.slice(0, 4).map((l) => `${name(l.a)}-${name(l.b)} ${Math.round(l.out)}+${Math.round(l.back)} t/day, water ${Math.round((waterWay(w0, l.a, l.b, "barge") ?? { length: NaN }).length)} road ${Math.round(roadPath(w0, l.a, l.b)?.distance ?? Infinity)}`).join("; ")}`);
const leg = barged[0];
if (leg) {
  // Its fords raised first, where any are in the way (water.md, Step 3): what opening the leg costs.
  const fords = crossingsInTheWay(w0, leg.a, leg.b, "barge");
  const raise = fords.reduce((s, f) => s + fordBridgeCost(w0, f), 0);
  console.log(`  C54 leg ${name(leg.a)}-${name(leg.b)}: ${fords.length} ford${fords.length === 1 ? "" : "s"} in a barge's way, raising them ₦${raise}`);
  const barge = play([...fords.map((f) => ({ kind: "bridgeFord" as const, fordId: f.id })), { kind: "jetty", townId: leg.a }, { kind: "jetty", townId: leg.b }, { kind: "barge", a: leg.a, b: leg.b }], (w) => lorrySummaries(w).filter((r) => r.id.startsWith("barge:")).reduce((s, r) => s + r.netPerDay, 0));
  console.log(`  C54 a barge ${name(leg.a)}-${name(leg.b)}: ₦${Math.round(barge.net ?? 0)}/day${barge.refused.length ? ` (refused: ${barge.refused.join("; ")})` : ""}`);
}
