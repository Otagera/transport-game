import type { GameWorld } from "./types";
import { chainOf, checkPave, demandAlong, isBrtRoute, isCutOff, isMinibusRoute, minibusRouteId, paveCost, roadCost, roadPath, routeKey } from "./world";
import { isDirt } from "./congestion";
import { isRailRoute } from "./rail";
import type { ActionSpec } from "./actions";

// The moves worth forecasting, as data: what the developer view's "best
// next moves" lists and what the probe's bots choose between
// (scripts/game-bots.ts). One list, so a bot playing "the best move" plays
// exactly what the player was shown.

export interface VehicleMove {
  action: { kind: "bus" | "minibus" | "brt"; a: string; b: string };
  routeId: string;
  /** Vehicles on the route once this one is bought. */
  count: number;
  price: number;
}

/**
 * One more vehicle on each road route you run, then a new bus and a new
 * minibus on every road-connected pair without one, the pairs with the most
 * riders wanting trips along them first. Every pair, not the top few:
 * ranking by trips along put long through-routes first and missed Owode <->
 * Kuto, the best first minibus on the map (browser check).
 */
export function vehicleMoves(world: GameWorld): VehicleMove[] {
  const list: VehicleMove[] = [];
  const t = world.tuning;
  const price = (kind: "bus" | "minibus" | "brt") => (kind === "minibus" ? t.minibusPurchaseCost : kind === "brt" ? t.brtPurchaseCost : t.busPurchaseCost);
  for (const route of world.routes) {
    if (isRailRoute(route.id)) continue;
    const kind = isMinibusRoute(route.id) ? "minibus" : isBrtRoute(route.id) ? "brt" : "bus";
    list.push({ action: { kind, a: route.a, b: route.b }, routeId: route.id, count: route.vehicleIds.length + 1, price: price(kind) });
  }
  const towns = [...world.towns.keys()];
  const pairs: Array<{ a: string; b: string; along: number }> = [];
  for (let i = 0; i < towns.length; i += 1) {
    for (let j = i + 1; j < towns.length; j += 1) {
      const a = towns[i]!;
      const b = towns[j]!;
      if (!roadPath(world, a, b)) continue;
      pairs.push({ a, b, along: demandAlong(world, a, b) });
    }
  }
  for (const { a, b } of pairs.sort((p, q) => q.along - p.along)) {
    for (const kind of ["minibus", "bus"] as const) {
      const routeId = kind === "minibus" ? minibusRouteId(a, b) : routeKey(a, b);
      if (world.routes.some((r) => r.id === routeId)) continue;
      list.push({ action: { kind, a, b }, routeId, count: 1, price: price(kind) });
    }
  }
  return list;
}

export interface RoadMove {
  action: Extract<ActionSpec, { kind: "road" }>;
  price: number;
}

/**
 * Every road from a town no road reaches to a town one does (cheapest
 * alignment). All of them, not the cheapest per town: the cheapest road can
 * be one nobody would build -- Ikole-Ogbe joins Ikole to the network, but
 * reaches Ilase only the long way round. Which is worth building is measured
 * (scripts/game-bots.ts ranks them by trips unlocked per naira), not
 * guessed from price.
 */
export function roadMoves(world: GameWorld): RoadMove[] {
  const moves: RoadMove[] = [];
  const towns = [...world.towns.keys()];
  const reached = towns.filter((id) => !isCutOff(world, id));
  for (const town of towns.filter((id) => isCutOff(world, id))) {
    for (const other of reached) {
      const price = roadCost(world, town, other);
      if (Number.isFinite(price)) moves.push({ action: { kind: "road", a: town, b: other, alignment: "cheapest" }, price });
    }
  }
  return moves;
}

/**
 * The cheapest road joining a cut-off town to the network (`keep`: which towns may be the other end),
 * the same answer as the cheapest of roadMoves from it -- without planning a road to every town
 * (on the region, ~180 plans: opening the term's pledge card froze the page ~5 s, 2026-10-28).
 * Towns are tried nearest first, and none past where even a straight road at the base price per
 * cell would cost more than the best so far: a road's price is never under that (cost.ts: base on
 * every cell, climbs and bridges on top).
 */
export function cheapestRoadFrom(world: GameWorld, town: string, keep: (id: string) => boolean = () => true): RoadMove | null {
  const from = world.towns.get(town);
  if (!from || !isCutOff(world, town)) return null;
  const order = [...world.towns.keys()].filter((id) => id !== town && !isCutOff(world, id) && keep(id));
  const near = order.map((id, rank) => ({ id, rank, d: Math.hypot(world.towns.get(id)!.x - from.x, world.towns.get(id)!.y - from.y) })).sort((p, q) => p.d - q.d);
  let best: { move: RoadMove; rank: number } | null = null;
  for (const { id, rank, d } of near) {
    if (best && world.tuning.roadCostPerCell * d - 0.5 > best.move.price) break;
    const price = roadCost(world, town, id);
    if (!Number.isFinite(price)) continue;
    // Ties as roadMoves would break them: the earlier town in the world's order.
    if (!best || price < best.move.price || (price === best.move.price && rank < best.rank)) best = { move: { action: { kind: "road", a: town, b: id, alignment: "cheapest" }, price }, rank };
  }
  return best?.move ?? null;
}

export interface PaveMove {
  action: Extract<ActionSpec, { kind: "pave" }>;
  price: number;
}

/**
 * Every road with dirt on it, as the player paves it: a whole road between
 * two towns, through any roadside towns on it (world.ts roadChain). The bots
 * couldn't see paving at all until this: paving the dirt trunk adds ~158
 * trips a day with no buses (389 -> 547) for ~₦435, about six times a bus
 * per naira -- the opening a player would find and the bots never tried.
 */
export function paveMoves(world: GameWorld): PaveMove[] {
  const moves: PaveMove[] = [];
  const seen = new Set<string>();
  for (const segment of world.simulation.map.segments) {
    if (segment.type !== "road" || !isDirt(segment)) continue;
    const chain = chainOf(world, segment.id);
    if (!chain) continue;
    const key = chain.a < chain.b ? `${chain.a}|${chain.b}` : `${chain.b}|${chain.a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const price = paveCost(world, chain.a, chain.b);
    if (!Number.isFinite(price)) continue;
    // Refused for a reason other than money (no road chain between them as towns): skip.
    const check = checkPave(world, chain.a, chain.b);
    if (!check.ok && check.reason !== "can't afford it") continue;
    moves.push({ action: { kind: "pave", a: chain.a, b: chain.b }, price });
  }
  return moves;
}
