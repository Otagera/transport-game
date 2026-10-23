import type { SliceWorld } from "./types";
import type { ActionResult } from "./world";
import { flowKey, goodsFlows, isFreightRoute } from "./goods";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import { railPath } from "./rail";
import { SWITCHED_OFF } from "./tuning";

// What your freight trains charge (2026-10-23, after Revision 4: "give the
// player control on how much they charge on freight and have them face the
// consequences"). Road freight is the hauliers'; rail freight is yours, and
// each line has a rate: cheap, standard or dear. Shippers weigh it against
// the hauliers':
//
//   - your train earns the goods fare times the rate's multiplier
//     (`freightRateCheap`, 1, `freightRateDear`);
//   - at a station your line serves, for goods bound for a stop on it, the
//     hauliers load faster and reach further when you're dear
//     (`freightHaulierPull`), slower and shorter when you're cheap -- so a dear
//     line earns more a tonne and carries fewer, puts trucks on your roads
//     (jams, wear, passengers crowded out) and leaves goods past their reach
//     to wait and spoil; a cheap one carries more for less and takes trucks
//     off the roads.
//
// Goods matter by what they grow, not what they earn (brief, C11 amended):
// the rate is a choice about who carries what.

export type FreightRate = "cheap" | "standard" | "dear";

/** A freight line's rate (standard unless set, or the tuning's default for every line). */
export function freightRate(world: SliceWorld, routeId: string): FreightRate {
  if (!world.tuning.freightRatesEnabled) return "standard";
  return world.freightRates.get(routeId) ?? world.tuning.freightRateDefault ?? "standard";
}

/** What a freight line's loads pay, as a multiple of the goods fare. */
export function freightFareFactor(world: SliceWorld, routeId: string | undefined): number {
  if (!routeId || !isFreightRoute(routeId)) return 1;
  const rate = freightRate(world, routeId);
  return rate === "cheap" ? world.tuning.freightRateCheap : rate === "dear" ? world.tuning.freightRateDear : 1;
}

export function setFreightRate(world: SliceWorld, routeId: string, rate: FreightRate): ActionResult {
  if (!world.tuning.freightRatesEnabled) return { ok: false, reason: SWITCHED_OFF };
  if (!isFreightRoute(routeId) || !world.lorryRoutes.some((route) => route.id === routeId)) return { ok: false, reason: "no freight line there" };
  if (rate === "standard") world.freightRates.delete(routeId);
  else world.freightRates.set(routeId, rate);
  return { ok: true };
}

/**
 * How keen hauliers are on goods from `from` to `to`, against your freight:
 * 1 where no line of yours serves both stops; more where the cheapest line
 * that does is dear, less where it's cheap. Multiplies their loading speed
 * and their reach (truckers.ts).
 */
export function haulierPull(world: SliceWorld, from: string, to: string): number {
  const t = world.tuning;
  if (!t.freightRatesEnabled) return 1;
  let best: FreightRate | null = null;
  for (const route of world.lorryRoutes) {
    if (!isFreightRoute(route.id)) continue;
    const stops = railPath(world, route.a, route.b)?.nodeIds;
    if (!stops || !stops.includes(from) || !stops.includes(to)) continue;
    const rate = freightRate(world, route.id);
    // Shippers take your cheapest line.
    if (best === null || rate === "cheap" || (rate === "standard" && best === "dear")) best = rate;
  }
  if (best === "dear") return 1 + t.freightHaulierPull;
  if (best === "cheap") return 1 / (1 + t.freightHaulierPull);
  return 1;
}

/** Along a freight line, tonnes a day of the goods it could carry: by your trains, by hauliers' trucks, and spoiling (its card). */
export function freightLineSplit(world: SliceWorld, routeId: string): { yours: number; hauliers: number; spoiled: number } {
  const route = world.lorryRoutes.find((r) => r.id === routeId);
  const stops = route ? new Set(railPath(world, route.a, route.b)?.nodeIds ?? []) : new Set<string>();
  const split = { yours: 0, hauliers: 0, spoiled: 0 };
  for (const flow of goodsFlows(world)) {
    if (!stops.has(flow.from) || !stops.has(flow.to)) continue;
    const outcome = world.goods.outcomes.get(flowKey(flow));
    split.yours += (outcome?.delivered ?? 0) * SECONDS_PER_GAME_DAY;
    split.hauliers += (outcome?.trucked ?? 0) * SECONDS_PER_GAME_DAY;
    split.spoiled += (outcome?.spoiled ?? 0) * SECONDS_PER_GAME_DAY;
  }
  return split;
}
