import type { SliceWorld } from "./types";
import { demandAlong, isCutOff, isMinibusRoute, minibusRouteId, roadCost, roadPath, routeKey } from "./world";
import { isRailRoute } from "./rail";
import type { ActionSpec } from "./actions";

// The moves worth forecasting, as data: what the developer view's "best
// next moves" lists and what the probe's bots choose between
// (scripts/slice-bots.ts). One list, so a bot playing "the best move" plays
// exactly what the player was shown.

export interface VehicleMove {
  action: { kind: "bus" | "minibus"; a: string; b: string };
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
export function vehicleMoves(world: SliceWorld): VehicleMove[] {
  const list: VehicleMove[] = [];
  const t = world.tuning;
  const price = (kind: "bus" | "minibus") => (kind === "minibus" ? t.minibusPurchaseCost : t.busPurchaseCost);
  for (const route of world.routes) {
    if (isRailRoute(route.id)) continue;
    const kind = isMinibusRoute(route.id) ? "minibus" : "bus";
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

/** For each town no road reaches, the cheapest road (cheapest alignment) to a town that has one. */
export function roadMoves(world: SliceWorld): RoadMove[] {
  const moves: RoadMove[] = [];
  const towns = [...world.towns.keys()];
  const reached = towns.filter((id) => !isCutOff(world, id));
  for (const town of towns.filter((id) => isCutOff(world, id))) {
    let best: RoadMove | null = null;
    for (const other of reached) {
      const price = roadCost(world, town, other);
      if (price < (best?.price ?? Infinity)) best = { action: { kind: "road", a: town, b: other, alignment: "cheapest" }, price };
    }
    if (best) moves.push(best);
  }
  return moves;
}
