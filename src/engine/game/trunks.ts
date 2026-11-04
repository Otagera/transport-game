import type { GameWorld } from "./types";
import type { Segment } from "../map/types";
import type { ActionResult } from "./world";
import { chainOf } from "./world";
import { segmentLength } from "./roads";
import { clusterAt } from "./remit";
import { canAfford } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";

// Trunks and feeders (docs/SCALES-AND-MODES.md, scopes 1 and 2; five-modes.md, 4. Okada
// permission; your calls, 2026-11-04: a road's class changes both ways, the union answers with a
// demand afterwards, and trunk and feeder land together).
//
// A corridor knows its class: a trunk -- long hops, regional town to regional town -- or a feeder,
// the villages, sites and approaches into a town, the informal sector's ground. Not a rung: a
// property a road has, as a bus lane is.
//
//   - Derived for the inherited network, so nothing is authored: an old highway joining two
//     clusters, or a road between two towns of `trunkTownPopulation`+ on day 1, is a trunk; the
//     rest feeders. A road you build is a feeder until you declare it.
//   - Declared by you, on a road you build or on one you have (`trunkCostPerCell`, the signs and
//     the wardens), and made a feeder again for nothing -- which is also what the union's "ease
//     it" asks for (union.ts).
//   - On a trunk (tick.ts, the informal sector): no okadas or kekes -- they were never allowed on
//     an expressway; a danfo may, and pays its toll (budget.ts tollFor). The okadas and kekes don't
//     vanish: one bound along a trunk carries its riders to the trunk's head, where they wait for a
//     danfo on for the rest -- so the feeders into a trunk get thicker, and the journeys go on, by a
//     different mode on a different leg.
//
// Off, and absent, in runs played before it (no trunksEnabled): every road as it was.

export type RoadClass = "trunk" | "feeder";

export function trunksOn(world: GameWorld): boolean {
  return !!world.tuning.trunksEnabled;
}

/** Day 1's size of a town (thousands): an original town's, else what it is now. */
const startSize = (world: GameWorld, id: string) => world.basePopulation.get(id) ?? world.towns.get(id)?.population ?? 0;

/** A road's class as it stands: declared, else derived (the inherited network), else a feeder. */
export function roadClass(world: GameWorld, segment: Segment): RoadClass {
  if (segment.roadClass) return segment.roadClass;
  if (segment.type !== "road" || segment.provenance !== "inherited") return "feeder";
  const a = segment.fromNodeId, b = segment.toNodeId;
  // An old highway: its ends in two clusters.
  const ca = clusterAt(world, a), cb = clusterAt(world, b);
  if (ca && cb && ca.hub !== cb.hub) return "trunk";
  const big = world.tuning.trunkTownPopulation ?? 45;
  const town = (id: string) => world.towns.get(id) && !world.towns.get(id)!.industry;
  return town(a) && town(b) && startSize(world, a) >= big && startSize(world, b) >= big ? "trunk" : "feeder";
}

/** The roads that are trunks now (ids), worked out again when the network or a class changes. */
const trunkSets = new WeakMap<GameWorld, { key: string; ids: Set<string> }>();
export function trunkSet(world: GameWorld): ReadonlySet<string> {
  if (!trunksOn(world)) return EMPTY;
  const segments = world.simulation.map.segments;
  let declared = 0, retired = 0;
  for (const s of segments) {
    if (s.roadClass) declared += s.roadClass === "trunk" ? 2 : 1;
    if (s.retiredAt !== undefined) retired += 1;
  }
  const key = `${segments.length}:${segments[segments.length - 1]?.id ?? ""}:${declared}:${retired}`;
  const known = trunkSets.get(world);
  if (known?.key === key) return known.ids;
  const ids = new Set<string>();
  for (const s of segments) if (s.type === "road" && s.retiredAt === undefined && roadClass(world, s) === "trunk") ids.add(s.id);
  trunkSets.set(world, { key, ids });
  return ids;
}
const EMPTY: ReadonlySet<string> = new Set();

export function isTrunk(world: GameWorld, segmentId: string): boolean {
  return trunkSet(world).has(segmentId);
}

/** What declaring the whole road a piece belongs to a trunk costs: its cells not already a trunk. */
export function trunkPrice(world: GameWorld, segmentId: string): number {
  const chain = chainOf(world, segmentId);
  if (!chain) return Infinity;
  const per = world.tuning.trunkCostPerCell ?? 50;
  return Math.round(chain.pieces.filter((p) => !isTrunk(world, p.id)).reduce((sum, p) => sum + segmentLength(world, p) * per, 0));
}

export function checkTrunk(world: GameWorld, segmentId: string, on: boolean): ActionResult {
  if (!trunksOn(world)) return { ok: false, reason: SWITCHED_OFF };
  const chain = chainOf(world, segmentId);
  if (!chain) return { ok: false, reason: "no road there" };
  if (chain.pieces.some((p) => p.retiredAt !== undefined)) return { ok: false, reason: "it's retired" };
  const now = chain.pieces.every((p) => isTrunk(world, p.id));
  if (on && now) return { ok: false, reason: "it's a trunk already" };
  if (!on && chain.pieces.every((p) => !isTrunk(world, p.id))) return { ok: false, reason: "it's a feeder already" };
  if (on && !canAfford(world.economy, trunkPrice(world, segmentId))) return { ok: false, reason: "can't afford the signs and wardens" };
  return { ok: true };
}

/** Declares a road (the whole of it, through roadside towns) a trunk, or makes it a feeder again (free). */
export function setTrunk(world: GameWorld, segmentId: string, on: boolean): ActionResult & { charged?: number; a?: string; b?: string } {
  const check = checkTrunk(world, segmentId, on);
  if (!check.ok) return check;
  const chain = chainOf(world, segmentId)!;
  const price = on ? trunkPrice(world, segmentId) : 0;
  world.economy.funds -= price;
  for (const piece of chain.pieces) piece.roadClass = on ? "trunk" : "feeder";
  return { ok: true, charged: price, a: chain.a, b: chain.b };
}
