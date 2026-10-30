import { waysFor } from "./crossings";
import { forgetRoute } from "./ledger";
import type { Segment, TerrainField } from "../map/types";
import type { PathResult, RoutingContext, Vehicle } from "../simulation/types";
import { buildRoutingContext, findPath } from "../simulation/routing";
import { createVehicle } from "../simulation/vehicle";
import { canAfford, registerPurchase } from "../economy/state";
import { BASE_COST_PER_CELL } from "../pathing/cost";
import type { GameWorld } from "./types";
import { SWITCHED_OFF } from "./tuning";
import { planAlignment, polylineLength, segmentLength, segmentPolyline, splitPolyline, type Alignment, type Point, type RoadPlan } from "./roads";
import { insertIntoPath } from "./settlement";
import { cycleFraction, largestGapMidpoint, placeAtCycleFraction, routeKey, type ActionResult } from "./world";
import { removeRoads, retiredRoadBetween } from "./retire";

// Rail (docs/principles.md §6, step 4: depth, one at a time -- rail last,
// the user's pick: an inherited line plus new track, passenger trains).
//
//   - Two networks. Track is a `rail` segment on the same map, but
//     `simulation.routing` is roads only -- buses, danfos, lorries,
//     congestion, wear and roadside towns never see track -- and trains
//     route on `world.railRouting`. Rail's immunity to road traffic is
//     structural, not a filter (architecture engine.md §simulation/).
//   - Trains are passenger routes (`rail:a~b`) in `world.routes`, so trip
//     plans, transfers, diagnosis and debt advice treat them like buses:
//     riders change bus <-> train at any town. No danfo runs on the line;
//     danfos still wait at the same stations.
//   - The brownfield line (principles §1): the map's inherited railway is
//     straight, built for export, and out of service. Restoring it is cheap;
//     its geometry stays wrong for the trips people make. New track is
//     planned over the terrain like a road, ~3x the price, and minds
//     gradients more -- the choice is restore the wrong line or build the
//     right one.
//   - Track wears with the trains that run over it, and the Fix tool keeps
//     it up like a road (wear.ts); disused track doesn't change.

export const TRAIN_DEF_ID = "slice-train";

/** Rebuilds both networks from the map: roads for everything that drives, in-service track for trains. */
export function rebuildNetworks(world: GameWorld): void {
  const map = world.simulation.map;
  world.simulation.routing = buildRoutingContext({ ...map, segments: map.segments.filter((s) => s.type === "road") });
  world.railRouting = buildRoutingContext({
    ...map,
    segments: map.segments.filter((s) => s.type === "rail" && !world.railOutOfService.has(s.id)),
  });
  world.pathCache.clear();
  world.railPathCache.clear();
}

export function railPath(world: GameWorld, from: string, to: string): PathResult | null {
  const key = `${from}:${to}`;
  if (!world.railPathCache.has(key)) world.railPathCache.set(key, findPath(world.railRouting, from, to));
  return world.railPathCache.get(key)!;
}

export function isRailRoute(routeId: string): boolean {
  return routeId.startsWith("rail:");
}

/** The network a vehicle runs on. */
export function routingFor(world: GameWorld, vehicle: Vehicle): RoutingContext {
  return world.railVehicles.has(vehicle.id) ? world.railRouting : world.simulation.routing;
}

// --- Track ------------------------------------------------------------------

let railTerrainCache: { source: TerrainField; terrain: TerrainField } | null = null;

/** The terrain as track sees it: every climb `railGradientMultiplier` times steeper. */
function railTerrain(world: GameWorld): TerrainField {
  const source = world.simulation.map.terrain;
  if (railTerrainCache?.source !== source) {
    const elevation = new Float32Array(source.elevation.length);
    for (let i = 0; i < elevation.length; i += 1) elevation[i] = source.elevation[i]! * world.tuning.railGradientMultiplier;
    railTerrainCache = { source, terrain: { ...source, elevation } };
  }
  return railTerrainCache.terrain;
}

/** New track between two towns, planned and priced like a road (roads.ts planAlignment) on rail's terms. */
export function planRail(world: GameWorld, a: string, b: string, alignment: Alignment = "cheapest"): RoadPlan | null {
  return planAlignment(world, a, b, railTerrain(world), world.tuning.railCostPerCell / BASE_COST_PER_CELL, world.railPlans, alignment);
}

/** The inherited, out-of-service track directly joining two towns, if any. */
export function derelictTrack(world: GameWorld, a: string, b: string) {
  return derelictRun(world, a, b)?.[0];
}

/**
 * The out-of-service old line between two places: the one piece joining them; or, with the
 * old line's stations (stations.ts), any run of it between two of its stops, every piece on the
 * way -- restored at once, station to station or end to end. Null if the old line doesn't join them.
 */
export function derelictRun(world: GameWorld, a: string, b: string): Segment[] | null {
  const pieces = world.simulation.map.segments.filter((s) => s.type === "rail" && world.railOutOfService.has(s.id));
  const direct = pieces.find((s) => (s.fromNodeId === a && s.toNodeId === b) || (s.fromNodeId === b && s.toNodeId === a));
  if (direct) return [direct];
  if (!world.tuning.railStations) return null;
  // Along the old line only: a walk over its out-of-service pieces.
  const from = new Map<string, { node: string; piece: Segment } | null>([[a, null]]);
  const queue = [a];
  while (queue.length > 0) {
    const at = queue.shift()!;
    if (at === b) break;
    for (const piece of pieces) {
      const next = piece.fromNodeId === at ? piece.toNodeId : piece.toNodeId === at ? piece.fromNodeId : null;
      if (next === null || from.has(next)) continue;
      from.set(next, { node: at, piece });
      queue.push(next);
    }
  }
  if (!from.has(b)) return null;
  const run: Segment[] = [];
  for (let at = b; from.get(at); at = from.get(at)!.node) run.unshift(from.get(at)!.piece);
  return run;
}

function liveTrack(world: GameWorld, a: string, b: string) {
  return world.simulation.map.segments.find(
    (s) => s.type === "rail" && !world.railOutOfService.has(s.id) && ((s.fromNodeId === a && s.toNodeId === b) || (s.fromNodeId === b && s.toNodeId === a)),
  );
}

export function restoreCost(world: GameWorld, a: string, b: string): number {
  const run = derelictRun(world, a, b);
  return run ? Math.round(run.reduce((sum, piece) => sum + segmentLength(world, piece), 0) * world.tuning.railRestoreCostPerCell) : Infinity;
}

/** What the Rail tool would do between two towns: restore the old line there, lay track on a retired road's alignment, or lay new track. */
export function trackAction(world: GameWorld, a: string, b: string): "restore" | "onroad" | "build" {
  return derelictTrack(world, a, b) ? "restore" : retiredRoadBetween(world, a, b) ? "onroad" : "build";
}

/** Track along a retired road (retire.ts): its length at track's price per cell, times `railOnRoadShare` -- the earthworks are done. */
export function onRoadCost(world: GameWorld, a: string, b: string): number {
  const pieces = retiredRoadBetween(world, a, b);
  if (!pieces) return Infinity;
  return Math.round(pieces.reduce((sum, piece) => sum + segmentLength(world, piece), 0) * world.tuning.railCostPerCell * world.tuning.railOnRoadShare);
}

export function trackCost(world: GameWorld, a: string, b: string, alignment: Alignment = "cheapest"): number {
  const action = trackAction(world, a, b);
  if (action === "restore") return restoreCost(world, a, b);
  if (action === "onroad") return onRoadCost(world, a, b);
  return planRail(world, a, b, alignment)?.cost ?? Infinity;
}

export function checkTrack(world: GameWorld, a: string, b: string, alignment: Alignment = "cheapest"): ActionResult {
  if (!world.tuning.railEnabled) return { ok: false, reason: SWITCHED_OFF };
  if (alignment !== "cheapest" && !waysFor(world, (way) => planRail(world, a, b, way)).includes(alignment)) {
    return { ok: false, reason: world.tuning.crossingsEnabled || world.tuning.straightAlignmentEnabled ? "that way isn't open for this track" : SWITCHED_OFF };
  }
  if (a === b) return { ok: false, reason: "pick two different towns" };
  if (liveTrack(world, a, b)) return { ok: false, reason: "track already joins them" };
  if (trackAction(world, a, b) === "build" && !planRail(world, a, b, alignment)) return { ok: false, reason: "the water is too wide to bridge here" };
  if (!canAfford(world.economy, trackCost(world, a, b, alignment))) return { ok: false, reason: "can't afford it" };
  return { ok: true };
}

/** Restores the old line between two towns, or lays new track (restoring ignores `alignment`: the old line is where it is). */
export function buildTrack(world: GameWorld, a: string, b: string, alignment: Alignment = "cheapest"): ActionResult {
  const check = checkTrack(world, a, b, alignment);
  if (!check.ok) return check;
  world.economy.funds -= trackCost(world, a, b, alignment);
  const derelict = derelictTrack(world, a, b);
  const road = derelict ? null : retiredRoadBetween(world, a, b);
  if (derelict) {
    for (const piece of derelictRun(world, a, b) ?? [derelict]) {
      world.railOutOfService.delete(piece.id);
      piece.condition = 1;
    }
  } else if (road) {
    // Along the retired road's own line, which goes now: the road became the railway.
    const polyline: Array<{ x: number; y: number }> = [];
    let at = a;
    for (const piece of road) {
      const line = segmentPolyline(world.simulation.map, piece);
      const oriented = piece.fromNodeId === at ? line : [...line].reverse();
      polyline.push(...(polyline.length > 0 ? oriented.slice(1) : oriented));
      at = piece.fromNodeId === at ? piece.toNodeId : piece.fromNodeId;
    }
    const length = road.reduce((sum, piece) => sum + segmentLength(world, piece), 0);
    removeRoads(world, road.map((piece) => piece.id));
    const id = `rail-${world.nextId++}`;
    world.simulation.map.segments.push({ id, corridorId: `corridor-${id}`, fromNodeId: a, toNodeId: b, type: "rail", level: "ground", condition: 1, provenance: "built", length });
    world.simulation.map.corridors.push({ id: `corridor-${id}`, nodeIds: [a, b], polyline });
  } else {
    const plan = planRail(world, a, b, alignment)!;
    const id = `rail-${world.nextId++}`;
    world.simulation.map.segments.push({
      id,
      corridorId: `corridor-${id}`,
      fromNodeId: a,
      toNodeId: b,
      type: "rail",
      level: "ground",
      condition: 1,
      provenance: "built",
      length: plan.length,
    });
    world.simulation.map.corridors.push({ id: `corridor-${id}`, nodeIds: [a, b], polyline: plan.polyline });
  }
  rebuildNetworks(world);
  return { ok: true };
}

// --- Halts ------------------------------------------------------------------
//
// The old line runs four cells past Owode without stopping: built for
// export, not for the trips people make (principles §1). A halt brings it
// in -- a short spur where the line passes nearest -- so trains on it stop
// at the town. Restoring the old line alone always lost money (lever audit:
// −₦78/day with a passenger train), so "restore the wrong line or build the
// right one" wasn't a choice; with a halt it is: cheap and roundabout, or
// dear and direct. Historically true too -- colonial lines gained halts as
// towns grew up beside them.

export interface HaltSite {
  segmentId: string;
  townId: string;
  /** Distance along the track's polyline to the point nearest the town. */
  along: number;
  point: Point;
  /** How far that point is from the town: the spur's length. */
  distance: number;
}

export function nearestOnPolyline(line: Point[], p: Point): { along: number; point: Point; distance: number } {
  let best = { along: 0, point: line[0]!, distance: Infinity };
  let travelled = 0;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const step = Math.hypot(dx, dy);
    const t = step > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (step * step))) : 0;
    const point = { x: a.x + dx * t, y: a.y + dy * t };
    const distance = Math.hypot(p.x - point.x, p.y - point.y);
    if (distance < best.distance) best = { along: travelled + step * t, point, distance };
    travelled += step;
  }
  return best;
}

/** Where track passes a town without stopping, near enough for a halt. */
export function haltSite(world: GameWorld, townId: string): HaltSite | null {
  const town = world.towns.get(townId);
  if (!town) return null;
  const map = world.simulation.map;
  let best: HaltSite | null = null;
  for (const segment of map.segments) {
    if (segment.type !== "rail" || segment.fromNodeId === townId || segment.toNodeId === townId) continue;
    const line = segmentPolyline(map, segment);
    const nearest = nearestOnPolyline(line, town);
    // Not at either end: a halt splits the line, it doesn't extend it.
    const length = polylineLength(line);
    if (nearest.along < 1 || nearest.along > length - 1) continue;
    if (nearest.distance > world.tuning.haltReachCells) continue;
    if (!best || nearest.distance < best.distance) best = { segmentId: segment.id, townId, ...nearest };
  }
  return best;
}

/** A halt's price: the platform, and a spur in and out. */
export function haltCost(world: GameWorld, site: HaltSite): number {
  return Math.round(world.tuning.haltCost + 2 * site.distance * world.tuning.railCostPerCell);
}

export function checkHalt(world: GameWorld, townId: string): ActionResult {
  if (!world.tuning.railEnabled) return { ok: false, reason: SWITCHED_OFF };
  const site = haltSite(world, townId);
  if (!site) return { ok: false, reason: "no line passes near enough for a halt" };
  if (!canAfford(world.economy, haltCost(world, site))) return { ok: false, reason: "can't afford it" };
  return { ok: true };
}

/**
 * Builds a halt: the line is split where it passes nearest the town and
 * runs in to it, so every train on it stops there. Works on the old line
 * before it's restored -- then each side is restored on its own, which is
 * what lets a player bring back just the useful stretch.
 */
export function buildHalt(world: GameWorld, townId: string): ActionResult {
  const check = checkHalt(world, townId);
  if (!check.ok) return check;
  const site = haltSite(world, townId)!;
  world.economy.funds -= haltCost(world, site);

  const map = world.simulation.map;
  const segment = map.segments.find((candidate) => candidate.id === site.segmentId)!;
  const town = world.towns.get(townId)!;
  const [before, after] = splitPolyline(segmentPolyline(map, segment), site.along);
  const firstLine = [...before, { x: town.x, y: town.y }];
  const secondLine = [{ x: town.x, y: town.y }, ...after];
  const first = { ...segment, id: `${segment.id}.h1`, corridorId: `corridor-${segment.id}.h1`, toNodeId: townId, length: polylineLength(firstLine) };
  const second = { ...segment, id: `${segment.id}.h2`, corridorId: `corridor-${segment.id}.h2`, fromNodeId: townId, length: polylineLength(secondLine) };
  map.segments = map.segments.filter((candidate) => candidate !== segment).concat(first, second);
  map.corridors = map.corridors
    .filter((corridor) => corridor.id !== segment.corridorId)
    .concat(
      { id: first.corridorId, nodeIds: [segment.fromNodeId, townId], polyline: firstLine },
      { id: second.corridorId, nodeIds: [townId, segment.toNodeId], polyline: secondLine },
    );

  // Everything the old piece carried, both halves carry.
  const carry = (set: Set<string>) => {
    if (set.delete(segment.id)) {
      set.add(first.id);
      set.add(second.id);
    }
  };
  carry(world.railOutOfService);
  carry(world.maintained);
  for (const rates of [world.railFlowEMA, world.upkeepRateEMA]) {
    const rate = rates.get(segment.id) ?? 0;
    rates.set(first.id, rate);
    rates.set(second.id, rate);
    rates.delete(segment.id);
  }
  world.bridgeCells.delete(segment.id);
  // Trains on the line now stop at the halt.
  for (const vehicle of world.simulation.vehicles) {
    if (world.railVehicles.has(vehicle.id)) insertIntoPath(vehicle, segment.fromNodeId, segment.toNodeId, townId);
  }
  rebuildNetworks(world);
  world.plans = null;
  return { ok: true };
}

// --- Trains -----------------------------------------------------------------

export function railRouteId(a: string, b: string): string {
  return `rail:${routeKey(a, b)}`;
}

// --- A line's slots, and what rail does to the map (brief, Revision 2:
// rail gets a job of its own) ------------------------------------------------

/** Trains on each piece of track: every passenger and freight route's trains, on each piece of its path. */
export function trainsBySegment(world: GameWorld): Map<string, number> {
  const count = new Map<string, number>();
  const routes = [...world.routes.filter((route) => isRailRoute(route.id)), ...world.lorryRoutes.filter((route) => route.id.startsWith("freight:"))];
  for (const route of routes) {
    const path = railPath(world, route.a, route.b);
    if (!path) continue;
    for (const id of new Set(path.segmentIds)) count.set(id, (count.get(id) ?? 0) + route.vehicleIds.length);
  }
  return count;
}

/**
 * How full the line between two towns is (`trackSlots` trains a piece of
 * track, passenger and freight together): a freight train takes a passenger
 * train's slot, so where both want a line you choose, or build a second.
 */
export function lineSlots(world: GameWorld, a: string, b: string): { used: number; slots: number } {
  const path = railPath(world, a, b);
  const by = trainsBySegment(world);
  const used = path ? Math.max(0, ...path.segmentIds.map((id) => by.get(id) ?? 0)) : 0;
  return { used, slots: world.tuning.trackSlots };
}

/** The towns a passenger train stops at: every stop on a running rail route's path. */
export function stationTowns(world: GameWorld): Set<string> {
  const towns = new Set<string>();
  for (const route of world.routes) {
    if (!isRailRoute(route.id) || route.vehicleIds.length === 0) continue;
    for (const id of railPath(world, route.a, route.b)?.nodeIds ?? []) if (world.towns.has(id)) towns.add(id);
  }
  return towns;
}

/**
 * Rail makes trips that weren't made before (the proposed "rail reshapes
 * the map", folded into Revision 2): between two towns the same passenger
 * line stops at, demand rises by `railInducedDemand` -- new desire lines, a
 * station town pulling from along its line. Applied after gravity demand.
 */
export function applyRailDemand(world: GameWorld): void {
  if (!world.tuning.railEnabled || world.tuning.railInducedDemand <= 0) return;
  const lines: Array<Set<string>> = [];
  for (const route of world.routes) {
    if (!isRailRoute(route.id) || route.vehicleIds.length === 0) continue;
    const stops = railPath(world, route.a, route.b)?.nodeIds;
    if (stops) lines.push(new Set(stops));
  }
  if (lines.length === 0) return;
  for (const pair of world.simulation.demand) {
    if (lines.some((stops) => stops.has(pair.from) && stops.has(pair.to))) pair.rate *= 1 + world.tuning.railInducedDemand;
  }
}

export function checkTrain(world: GameWorld, a: string, b: string): ActionResult {
  if (!world.tuning.railEnabled) return { ok: false, reason: SWITCHED_OFF };
  if (a === b) return { ok: false, reason: "pick two different towns" };
  if (!railPath(world, a, b)) return { ok: false, reason: "no working track between them" };
  const line = lineSlots(world, a, b);
  if (line.used >= line.slots) return { ok: false, reason: `the line is full: ${line.used} of ${line.slots} trains` };
  if (!canAfford(world.economy, world.tuning.trainPurchaseCost)) return { ok: false, reason: "can't afford a train" };
  return { ok: true };
}

export function addTrain(world: GameWorld, a: string, b: string): ActionResult {
  const check = checkTrain(world, a, b);
  if (!check.ok) return check;
  const id = railRouteId(a, b);
  let route = world.routes.find((candidate) => candidate.id === id);
  if (!route) {
    route = { id, a, b, vehicleIds: [], openedAtSeconds: world.economy.elapsedSeconds, boardingRateEMA: 0, loadFactorEMA: 0, speedEMA: 1 };
    world.routes.push(route);
    forgetRoute(world.ledger, route.id);
    world.plans = null; // a new route changes how riders cross the network
    // Its new trips (applyRailDemand) arrive with the day's demand refresh (settlement.ts).
  }
  const { tuning } = world;
  const vehicleId = `train-${world.nextId++}`;
  // Road space 0: a train is never on a road.
  const vehicle = createVehicle(vehicleId, [route.a, route.b], world.railRouting, tuning.trainSpeed, tuning.trainCapacity, undefined, "passengers", 0);
  world.railVehicles.add(vehicleId);
  const others = route.vehicleIds
    .map((otherId) => world.simulation.vehicles.find((candidate) => candidate.id === otherId))
    .filter((candidate): candidate is Vehicle => candidate !== undefined);
  placeAtCycleFraction(world, vehicle, largestGapMidpoint(others.map((other) => cycleFraction(world, other))));
  world.simulation.vehicles.push(vehicle);
  registerPurchase(world.economy, vehicleId, tuning.trainPurchaseCost, tuning.trainOperatingCostPerSecond, TRAIN_DEF_ID);
  route.vehicleIds.push(vehicleId);
  return { ok: true };
}

/** Running cost a day of one vehicle on a route: a train's or a bus's. */
export function vehicleCostPerDay(world: GameWorld, routeId: string, secondsPerDay: number): number {
  const t = world.tuning;
  const perSecond = isRailRoute(routeId) ? t.trainOperatingCostPerSecond : routeId.startsWith("mini:") ? t.minibusOperatingCostPerSecond : t.busOperatingCostPerSecond;
  return perSecond * secondsPerDay;
}

