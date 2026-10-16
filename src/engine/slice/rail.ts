import type { TerrainField } from "../map/types";
import type { PathResult, RoutingContext, Vehicle } from "../simulation/types";
import { buildRoutingContext, findPath } from "../simulation/routing";
import { createVehicle } from "../simulation/vehicle";
import { canAfford, registerPurchase } from "../economy/state";
import { BASE_COST_PER_CELL } from "../pathing/cost";
import type { SliceWorld } from "./types";
import { planAlignment, segmentLength, type RoadPlan } from "./roads";
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
//   - Track doesn't wear in this first cut (wear.ts skips it).

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
export function planRail(world: SliceWorld, a: string, b: string): RoadPlan | null {
  return planAlignment(world, a, b, railTerrain(world), world.tuning.railCostPerCell / BASE_COST_PER_CELL, world.railPlans);
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

export function trackCost(world: SliceWorld, a: string, b: string): number {
  return trackAction(world, a, b) === "restore" ? restoreCost(world, a, b) : (planRail(world, a, b)?.cost ?? Infinity);
}

export function checkTrack(world: SliceWorld, a: string, b: string): ActionResult {
  if (a === b) return { ok: false, reason: "pick two different towns" };
  if (liveTrack(world, a, b)) return { ok: false, reason: "track already joins them" };
  if (trackAction(world, a, b) === "build" && !planRail(world, a, b)) return { ok: false, reason: "the water is too wide to bridge here" };
  if (!canAfford(world.economy, trackCost(world, a, b))) return { ok: false, reason: "can't afford it" };
  return { ok: true };
}

/** Restores the old line between two towns, or lays new track. */
export function buildTrack(world: SliceWorld, a: string, b: string): ActionResult {
  const check = checkTrack(world, a, b);
  if (!check.ok) return check;
  world.economy.funds -= trackCost(world, a, b);
  const derelict = derelictTrack(world, a, b);
  if (derelict) {
    world.railOutOfService.delete(derelict.id);
    derelict.condition = 1;
  } else {
    const plan = planRail(world, a, b)!;
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

// --- Trains -----------------------------------------------------------------

function railRouteId(a: string, b: string): string {
  return `rail:${routeKey(a, b)}`;
}

export function checkTrain(world: SliceWorld, a: string, b: string): ActionResult {
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
    route = { id, a, b, vehicleIds: [], revenueRateEMA: 0, boardingRateEMA: 0, loadFactorEMA: 0, speedEMA: 1 };
    world.routes.push(route);
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
  return (isRailRoute(routeId) ? world.tuning.trainOperatingCostPerSecond : world.tuning.busOperatingCostPerSecond) * secondsPerDay;
}
