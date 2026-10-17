import { forgetRoute } from "./ledger";
import type { TerrainField } from "../map/types";
import type { PathResult, RoutingContext, Vehicle } from "../simulation/types";
import { buildRoutingContext, findPath } from "../simulation/routing";
import { createVehicle } from "../simulation/vehicle";
import { canAfford, registerPurchase } from "../economy/state";
import { BASE_COST_PER_CELL } from "../pathing/cost";
import type { SliceWorld } from "./types";
import { SWITCHED_OFF } from "./tuning";
import { planAlignment, polylineLength, segmentLength, segmentPolyline, splitPolyline, type Alignment, type Point, type RoadPlan } from "./roads";
import { insertIntoPath } from "./settlement";
import { cycleFraction, largestGapMidpoint, placeAtCycleFraction, routeKey, type ActionResult } from "./world";

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
export function rebuildNetworks(world: SliceWorld): void {
  const map = world.simulation.map;
  world.simulation.routing = buildRoutingContext({ ...map, segments: map.segments.filter((s) => s.type === "road") });
  world.railRouting = buildRoutingContext({
    ...map,
    segments: map.segments.filter((s) => s.type === "rail" && !world.railOutOfService.has(s.id)),
  });
  world.pathCache.clear();
  world.railPathCache.clear();
}

export function railPath(world: SliceWorld, from: string, to: string): PathResult | null {
  const key = `${from}:${to}`;
  if (!world.railPathCache.has(key)) world.railPathCache.set(key, findPath(world.railRouting, from, to));
  return world.railPathCache.get(key)!;
}

export function isRailRoute(routeId: string): boolean {
  return routeId.startsWith("rail:");
}

/** The network a vehicle runs on. */
export function routingFor(world: SliceWorld, vehicle: Vehicle): RoutingContext {
  return world.railVehicles.has(vehicle.id) ? world.railRouting : world.simulation.routing;
}

// --- Track ------------------------------------------------------------------

let railTerrainCache: { source: TerrainField; terrain: TerrainField } | null = null;

/** The terrain as track sees it: every climb `railGradientMultiplier` times steeper. */
function railTerrain(world: SliceWorld): TerrainField {
  const source = world.simulation.map.terrain;
  if (railTerrainCache?.source !== source) {
    const elevation = new Float32Array(source.elevation.length);
    for (let i = 0; i < elevation.length; i += 1) elevation[i] = source.elevation[i]! * world.tuning.railGradientMultiplier;
    railTerrainCache = { source, terrain: { ...source, elevation } };
  }
  return railTerrainCache.terrain;
}

/** New track between two towns, planned and priced like a road (roads.ts planAlignment) on rail's terms. */
export function planRail(world: SliceWorld, a: string, b: string, alignment: Alignment = "cheapest"): RoadPlan | null {
  return planAlignment(world, a, b, railTerrain(world), world.tuning.railCostPerCell / BASE_COST_PER_CELL, world.railPlans, alignment);
}

/** The inherited, out-of-service track directly joining two towns, if any. */
export function derelictTrack(world: SliceWorld, a: string, b: string) {
  return world.simulation.map.segments.find(
    (s) => s.type === "rail" && world.railOutOfService.has(s.id) && ((s.fromNodeId === a && s.toNodeId === b) || (s.fromNodeId === b && s.toNodeId === a)),
  );
}

function liveTrack(world: SliceWorld, a: string, b: string) {
  return world.simulation.map.segments.find(
    (s) => s.type === "rail" && !world.railOutOfService.has(s.id) && ((s.fromNodeId === a && s.toNodeId === b) || (s.fromNodeId === b && s.toNodeId === a)),
  );
}

export function restoreCost(world: SliceWorld, a: string, b: string): number {
  const track = derelictTrack(world, a, b);
  return track ? Math.round(segmentLength(world, track) * world.tuning.railRestoreCostPerCell) : Infinity;
}

/** What the Rail tool would do between two towns: restore the old line there, or lay new track. */
export function trackAction(world: SliceWorld, a: string, b: string): "restore" | "build" {
  return derelictTrack(world, a, b) ? "restore" : "build";
}

export function trackCost(world: SliceWorld, a: string, b: string, alignment: Alignment = "cheapest"): number {
  return trackAction(world, a, b) === "restore" ? restoreCost(world, a, b) : (planRail(world, a, b, alignment)?.cost ?? Infinity);
}

export function checkTrack(world: SliceWorld, a: string, b: string, alignment: Alignment = "cheapest"): ActionResult {
  if (!world.tuning.railEnabled) return { ok: false, reason: SWITCHED_OFF };
  if (alignment === "direct" && !world.tuning.straightAlignmentEnabled) return { ok: false, reason: SWITCHED_OFF };
  if (a === b) return { ok: false, reason: "pick two different towns" };
  if (liveTrack(world, a, b)) return { ok: false, reason: "track already joins them" };
  if (trackAction(world, a, b) === "build" && !planRail(world, a, b, alignment)) return { ok: false, reason: "the water is too wide to bridge here" };
  if (!canAfford(world.economy, trackCost(world, a, b, alignment))) return { ok: false, reason: "can't afford it" };
  return { ok: true };
}

/** Restores the old line between two towns, or lays new track (restoring ignores `alignment`: the old line is where it is). */
export function buildTrack(world: SliceWorld, a: string, b: string, alignment: Alignment = "cheapest"): ActionResult {
  const check = checkTrack(world, a, b, alignment);
  if (!check.ok) return check;
  world.economy.funds -= trackCost(world, a, b, alignment);
  const derelict = derelictTrack(world, a, b);
  if (derelict) {
    world.railOutOfService.delete(derelict.id);
    derelict.condition = 1;
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

function nearestOnPolyline(line: Point[], p: Point): { along: number; point: Point; distance: number } {
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
export function haltSite(world: SliceWorld, townId: string): HaltSite | null {
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
export function haltCost(world: SliceWorld, site: HaltSite): number {
  return Math.round(world.tuning.haltCost + 2 * site.distance * world.tuning.railCostPerCell);
}

export function checkHalt(world: SliceWorld, townId: string): ActionResult {
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
export function buildHalt(world: SliceWorld, townId: string): ActionResult {
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

export function checkTrain(world: SliceWorld, a: string, b: string): ActionResult {
  if (!world.tuning.railEnabled) return { ok: false, reason: SWITCHED_OFF };
  if (a === b) return { ok: false, reason: "pick two different towns" };
  if (!railPath(world, a, b)) return { ok: false, reason: "no working track between them" };
  if (!canAfford(world.economy, world.tuning.trainPurchaseCost)) return { ok: false, reason: "can't afford a train" };
  return { ok: true };
}

export function addTrain(world: SliceWorld, a: string, b: string): ActionResult {
  const check = checkTrain(world, a, b);
  if (!check.ok) return check;
  const id = railRouteId(a, b);
  let route = world.routes.find((candidate) => candidate.id === id);
  if (!route) {
    route = { id, a, b, vehicleIds: [], openedAtSeconds: world.economy.elapsedSeconds, boardingRateEMA: 0, loadFactorEMA: 0, speedEMA: 1 };
    world.routes.push(route);
    forgetRoute(world.ledger, route.id);
    world.plans = null; // a new route changes how riders cross the network
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
export function vehicleCostPerDay(world: SliceWorld, routeId: string, secondsPerDay: number): number {
  const t = world.tuning;
  const perSecond = isRailRoute(routeId) ? t.trainOperatingCostPerSecond : routeId.startsWith("mini:") ? t.minibusOperatingCostPerSecond : t.busOperatingCostPerSecond;
  return perSecond * secondsPerDay;
}
