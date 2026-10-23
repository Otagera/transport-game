import type { Segment } from "../map/types";
import type { GameWorld } from "./types";
import type { GameEvent } from "./settlement";
import { MIN_CONDITION } from "../map/decay";
import { canAfford, SECONDS_PER_GAME_DAY } from "../economy/state";
import { chainOf, cycleFraction, placeAtCycleFraction, removeBus, roadChain, roadPath, type ActionResult } from "./world";
import { isYourRoad } from "./upkeep";
import { repairCost } from "./wear";
import { isFreightRoute, removeLorry } from "./goods";
import { isRailRoute, rebuildNetworks } from "./rail";
import { findPath } from "../simulation/routing";

// Retiring what you built (docs/brief.md, Revision 2: "you asked to remove
// things"). Routes already go (selling a route's last vehicle closes it);
// roads couldn't. Retiring a road stops its upkeep and its tolls at once and
// lets it decay; after `retireGoneDays` it's gone from the map, unless you
// restore it first (the repair, cheaper than building). Brownfield: removal
// has consequences -- a town it joined can be cut off again and shrink, the
// danfos lose the road, and your routes on it go round, or are sold if
// nothing else joins their towns. Track can be laid along a retired road's
// alignment for less (rail.ts): the earthworks are done.

/** Retires the whole road a piece belongs to. Only a road that's yours (built or paved). */
export function retireRoad(world: GameWorld, segmentId: string): ActionResult {
  const chain = chainOf(world, segmentId);
  if (!chain) return { ok: false, reason: "no such road" };
  if (!chain.pieces.every((piece) => isYourRoad(piece))) return { ok: false, reason: "only a road you built or paved is yours to retire" };
  const now = world.economy.elapsedSeconds;
  for (const piece of chain.pieces) {
    piece.retiredAt = now;
    world.maintained.delete(piece.id);
    piece.busLane = false;
  }
  // A lane on it goes with it.
  world.lanes = world.lanes.filter((lane) => !((lane.a === chain.a && lane.b === chain.b) || (lane.a === chain.b && lane.b === chain.a)));
  return { ok: true };
}

/** What restoring a retired road costs: its repair to new. */
export function restoreCost(world: GameWorld, segmentId: string): number {
  const pieces = chainOf(world, segmentId)?.pieces ?? [];
  return pieces.reduce((sum, piece) => sum + repairCost(world, piece, 1 - piece.condition), 0);
}

export function restoreRoad(world: GameWorld, segmentId: string): ActionResult & { charged?: number } {
  const pieces = chainOf(world, segmentId)?.pieces ?? [];
  if (!pieces.some((piece) => piece.retiredAt !== undefined)) return { ok: false, reason: "that road isn't retired" };
  const cost = restoreCost(world, segmentId);
  if (!canAfford(world.economy, cost)) return { ok: false, reason: "can't afford the repair" };
  world.economy.funds -= cost;
  for (const piece of pieces) {
    piece.retiredAt = undefined;
    piece.condition = 1;
  }
  return { ok: true, charged: cost };
}

/** The day a retired piece goes. */
export function goneAt(world: GameWorld, segment: Segment): number {
  return (segment.retiredAt ?? Infinity) + world.tuning.retireGoneDays * SECONDS_PER_GAME_DAY;
}

/** Called every tick: retired roads decay; one past its days is taken off the map. */
export function updateRetired(world: GameWorld, dt: number): GameEvent[] {
  const retired = world.simulation.map.segments.filter((segment) => segment.retiredAt !== undefined);
  if (retired.length === 0) return [];
  const decay = (dt / SECONDS_PER_GAME_DAY) / world.tuning.retireGoneDays;
  for (const piece of retired) piece.condition = Math.max(MIN_CONDITION, piece.condition - decay);
  const now = world.economy.elapsedSeconds;
  const gone = retired.filter((piece) => now >= goneAt(world, piece));
  if (gone.length === 0) return [];
  const ends = chainOf(world, gone[0]!.id) ?? { a: gone[0]!.fromNodeId, b: gone[0]!.toNodeId };
  const result = removeRoads(world, gone.map((piece) => piece.id));
  return [{ kind: "road-gone", a: ends.a, b: ends.b, sold: result.sold, refund: result.refund }];
}

/**
 * Takes road pieces off the map: the networks rebuilt, every road route
 * re-pathed round them (each vehicle kept at its place in its cycle), and a
 * route whose towns nothing joins any more sold, vehicle by vehicle.
 */
export function removeRoads(world: GameWorld, segmentIds: string[]): { sold: number; refund: number } {
  const map = world.simulation.map;
  const ids = new Set(segmentIds);
  const corridors = new Set(map.segments.filter((segment) => ids.has(segment.id)).map((segment) => segment.corridorId));
  map.segments = map.segments.filter((segment) => !ids.has(segment.id));
  map.corridors = map.corridors.filter((corridor) => !corridors.has(corridor.id) || map.segments.some((segment) => segment.corridorId === corridor.id));
  for (const id of ids) world.maintained.delete(id);
  // Where each vehicle was in its cycle, before its road changes under it.
  const fractions = new Map(world.simulation.vehicles.filter((v) => v.lifecycle === "cyclic").map((v) => [v.id, cycleFraction(world, v)]));
  rebuildNetworks(world);
  world.plans = null;
  let sold = 0;
  let refund = 0;
  for (const route of [...world.routes, ...world.lorryRoutes]) {
    if (isRailRoute(route.id) || isFreightRoute(route.id)) continue;
    if (!roadPath(world, route.a, route.b)) {
      while (route.vehicleIds.length > 0) {
        refund += route.id.startsWith("lorry:") ? removeLorry(world, route.id) : removeBus(world, route.id);
        sold += 1;
      }
      continue;
    }
    for (const id of route.vehicleIds) {
      const vehicle = world.simulation.vehicles.find((candidate) => candidate.id === id);
      const there = findPath(world.simulation.routing, route.a, route.b);
      const back = findPath(world.simulation.routing, route.b, route.a);
      if (!vehicle || !there || !back) continue;
      vehicle.path = [...there.nodeIds, ...back.nodeIds.slice(1, -1)];
      placeAtCycleFraction(world, vehicle, fractions.get(id) ?? 0);
    }
  }
  return { sold, refund };
}

/** A retired road joining two towns, if any: track can be laid on its alignment for less (rail.ts). */
export function retiredRoadBetween(world: GameWorld, a: string, b: string): Segment[] | null {
  const chain = roadChain(world, a, b);
  return chain && chain.every((piece) => piece.retiredAt !== undefined) ? chain : null;
}
