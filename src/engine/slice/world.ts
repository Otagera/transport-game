import type { GeneratedMap, Segment } from "../map/types";
import type { DemandPair, PathResult, Vehicle } from "../simulation/types";
import { createSimulation, rebuildFromMap } from "../simulation/simulate";
import { findPath } from "../simulation/routing";
import { createVehicle } from "../simulation/vehicle";
import { canAfford, createEconomyState, registerPurchase, sellVehicle } from "../economy/state";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import type { SliceMapDef, SliceRoute, SliceTown, SliceTuning, SliceWorld } from "./types";
import { DEFAULT_SLICE_TUNING } from "./tuning";

export const BUS_DEF_ID = "slice-bus";

export function pairKey(from: string, to: string): string {
  return `${from}:${to}`;
}

function townDistance(a: SliceTown, b: SliceTown): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Gravity demand, passengers only. Reciprocal by construction
// (docs/principles.md §3) and between every pair of towns whether or not a
// road joins them -- demand is where people want to go, not where the
// network lets them. An unconnected pair's passengers simply give up and
// stay home, which is the signal a missing road should send.
export function gravityDemand(towns: SliceTown[], demandK: number): DemandPair[] {
  const pairs: DemandPair[] = [];
  for (let i = 0; i < towns.length; i += 1) {
    for (let j = i + 1; j < towns.length; j += 1) {
      const a = towns[i]!;
      const b = towns[j]!;
      const d = townDistance(a, b);
      if (d === 0) continue;
      const rate = (demandK * a.population * b.population) / d;
      pairs.push({ from: a.id, to: b.id, kind: "passengers", rate });
      pairs.push({ from: b.id, to: a.id, kind: "passengers", rate });
    }
  }
  return pairs;
}

function roadSegment(id: string, a: string, b: string, provenance: Segment["provenance"]): Segment {
  return { id, corridorId: `corridor-${id}`, fromNodeId: a, toNodeId: b, type: "road", level: "ground", condition: 1, provenance };
}

function buildMap(def: SliceMapDef): GeneratedMap {
  const cells = def.width * def.height;
  const map: GeneratedMap = {
    seed: 0,
    // The slice has no terrain yet (step 3). A blank field keeps the
    // GeneratedMap shape the rest of engine/ expects.
    terrain: {
      width: def.width,
      height: def.height,
      elevation: new Float32Array(cells),
      water: new Uint8Array(cells),
      settlementDensity: new Float32Array(cells),
    },
    nodes: def.towns.map((town) => ({ id: town.id, kind: "settlement" as const, x: town.x, y: town.y })),
    corridors: [],
    segments: [],
  };
  def.roads.forEach((road, i) => addRoadToMap(map, `inherited-${i}`, road.a, road.b, "inherited"));
  return map;
}

function addRoadToMap(map: GeneratedMap, id: string, a: string, b: string, provenance: Segment["provenance"]): void {
  const nodeA = map.nodes.find((node) => node.id === a)!;
  const nodeB = map.nodes.find((node) => node.id === b)!;
  const segment = roadSegment(id, a, b, provenance);
  map.segments.push(segment);
  // One geometry representation (docs/principles.md §3): a straight road
  // is still a two-point polyline.
  map.corridors.push({ id: segment.corridorId, nodeIds: [a, b], polyline: [{ x: nodeA.x, y: nodeA.y }, { x: nodeB.x, y: nodeB.y }] });
}

export function createSliceWorld(def: SliceMapDef, tuning: SliceTuning = DEFAULT_SLICE_TUNING): SliceWorld {
  const map = buildMap(def);
  const simulation = createSimulation(map, []);
  simulation.demand = gravityDemand(def.towns, tuning.demandK);
  return {
    width: def.width,
    height: def.height,
    towns: new Map(def.towns.map((town) => [town.id, town])),
    tuning,
    simulation,
    economy: createEconomyState({ passengers: tuning.fare, produce: 0, supplies: 0 }, tuning.startingFunds),
    routes: [],
    informal: { pool: new Map(), active: new Map(), segmentCounts: new Map(), earnings: 0 },
    outcomes: new Map(def.towns.map((town) => [town.id, { player: 0, informal: 0, lost: 0 }])),
    pathCache: new Map(),
    nextId: 0,
  };
}

export function roadPath(world: SliceWorld, from: string, to: string): PathResult | null {
  const key = pairKey(from, to);
  if (!world.pathCache.has(key)) world.pathCache.set(key, findPath(world.simulation.routing, from, to));
  return world.pathCache.get(key)!;
}

// --- Player actions -------------------------------------------------------
// Each returns a reason on refusal rather than throwing: the UI shows it.

export type ActionResult = { ok: true } | { ok: false; reason: string };

function hasDirectRoad(world: SliceWorld, a: string, b: string): boolean {
  return world.simulation.map.segments.some(
    (s) => (s.fromNodeId === a && s.toNodeId === b) || (s.fromNodeId === b && s.toNodeId === a),
  );
}

// The one function that turns a road into money (architecture hard rule 3:
// the cost function IS the build price). The preview and the charge both
// call this; nothing else prices a road.
export function roadCost(world: SliceWorld, a: string, b: string): number {
  const townA = world.towns.get(a);
  const townB = world.towns.get(b);
  if (!townA || !townB) return Infinity;
  return Math.round(townDistance(townA, townB) * world.tuning.roadCostPerCell);
}

export function checkRoad(world: SliceWorld, a: string, b: string): ActionResult {
  if (a === b) return { ok: false, reason: "pick two different towns" };
  if (hasDirectRoad(world, a, b)) return { ok: false, reason: "already connected directly" };
  if (!canAfford(world.economy, roadCost(world, a, b))) return { ok: false, reason: "can't afford it" };
  return { ok: true };
}

export function buildRoad(world: SliceWorld, a: string, b: string): ActionResult {
  const check = checkRoad(world, a, b);
  if (!check.ok) return check;
  world.economy.funds -= roadCost(world, a, b);
  addRoadToMap(world.simulation.map, `road-${world.nextId++}`, a, b, "built");
  rebuildFromMap(world.simulation, world.simulation.map);
  world.pathCache.clear();
  return { ok: true };
}

function routeKey(a: string, b: string): string {
  return a < b ? `${a}~${b}` : `${b}~${a}`;
}

export function findRoute(world: SliceWorld, a: string, b: string): SliceRoute | undefined {
  return world.routes.find((route) => route.id === routeKey(a, b));
}

export function checkBus(world: SliceWorld, a: string, b: string): ActionResult {
  if (a === b) return { ok: false, reason: "pick two different towns" };
  if (!roadPath(world, a, b)) return { ok: false, reason: "no road between them" };
  if (!canAfford(world.economy, world.tuning.busPurchaseCost)) return { ok: false, reason: "can't afford a bus" };
  return { ok: true };
}

export function addBus(world: SliceWorld, a: string, b: string): ActionResult {
  const check = checkBus(world, a, b);
  if (!check.ok) return check;

  let route = findRoute(world, a, b);
  if (!route) {
    route = { id: routeKey(a, b), a, b, vehicleIds: [], revenueRateEMA: 0 };
    world.routes.push(route);
  }
  const { tuning } = world;
  const id = `bus-${world.nextId++}`;
  // No queues: a bus placed mid-route must not teleport-load at route.a.
  const vehicle = createVehicle(id, [route.a, route.b], world.simulation.routing, tuning.busSpeed, tuning.busCapacity, undefined, "passengers");
  // Headway, not bunching, is what another bus on a route is supposed to
  // buy. Starting every new bus at a terminus sends them out as a convoy
  // that serves the route exactly as often as one bus would -- measured:
  // 2, 4 and 8 buses earned identically. So a new bus joins at the middle
  // of the largest gap between the buses already running.
  const others = route.vehicleIds
    .map((otherId) => world.simulation.vehicles.find((candidate) => candidate.id === otherId))
    .filter((candidate): candidate is Vehicle => candidate !== undefined);
  placeAtCycleFraction(world, vehicle, largestGapMidpoint(others.map((other) => cycleFraction(world, other))));
  world.simulation.vehicles.push(vehicle);
  registerPurchase(world.economy, id, tuning.busPurchaseCost, tuning.busOperatingCostPerSecond, BUS_DEF_ID);
  route.vehicleIds.push(id);
  return { ok: true };
}

function edgeLengths(world: SliceWorld, vehicle: Vehicle): number[] {
  const { positions } = world.simulation.routing;
  return vehicle.path.map((nodeId, i) => {
    const a = positions.get(nodeId)!;
    const b = positions.get(vehicle.path[(i + 1) % vehicle.path.length]!)!;
    return Math.hypot(a.x - b.x, a.y - b.y);
  });
}

/** How far round its cycle a vehicle is, 0..1. */
export function cycleFraction(world: SliceWorld, vehicle: Vehicle): number {
  const lengths = edgeLengths(world, vehicle);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) return 0;
  const length = vehicle.path.length;
  const fromIndex = (vehicle.pathIndex - 1 + length) % length;
  let distance = vehicle.edgeProgress * lengths[fromIndex]!;
  for (let i = 0; i < fromIndex; i += 1) distance += lengths[i]!;
  return distance / total;
}

function placeAtCycleFraction(world: SliceWorld, vehicle: Vehicle, fraction: number): void {
  const lengths = edgeLengths(world, vehicle);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = fraction * total;
  for (let i = 0; i < lengths.length; i += 1) {
    if (remaining < lengths[i]! || i === lengths.length - 1) {
      vehicle.pathIndex = (i + 1) % vehicle.path.length;
      vehicle.edgeProgress = lengths[i]! > 0 ? Math.min(remaining / lengths[i]!, 0.999) : 0;
      return;
    }
    remaining -= lengths[i]!;
  }
}

export function largestGapMidpoint(fractions: number[]): number {
  if (fractions.length === 0) return 0;
  const sorted = [...fractions].sort((a, b) => a - b);
  let bestStart = sorted[sorted.length - 1]!;
  let bestGap = sorted[0]! + 1 - bestStart; // the wrap-around gap
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i]! - sorted[i - 1]!;
    if (gap > bestGap) {
      bestGap = gap;
      bestStart = sorted[i - 1]!;
    }
  }
  return (bestStart + bestGap / 2) % 1;
}

/** Sells the route's most recently bought bus, at depreciated value. */
export function removeBus(world: SliceWorld, routeId: string): number {
  const route = world.routes.find((candidate) => candidate.id === routeId);
  if (!route) return 0;
  const id = route.vehicleIds.pop();
  if (!id) return 0;
  world.simulation.vehicles = world.simulation.vehicles.filter((vehicle) => vehicle.id !== id);
  const resale = sellVehicle(world.economy, id);
  if (route.vehicleIds.length === 0) world.routes = world.routes.filter((candidate) => candidate !== route);
  return resale;
}

export interface RouteSummary {
  id: string;
  a: string;
  b: string;
  buses: number;
  incomePerDay: number;
  costPerDay: number;
  netPerDay: number;
}

// Worst-first (docs/principles.md §3): the bleeding route is the first
// thing you read.
export function routeSummaries(world: SliceWorld): RouteSummary[] {
  return world.routes
    .map((route) => {
      const incomePerDay = route.revenueRateEMA * SECONDS_PER_GAME_DAY;
      const costPerDay = route.vehicleIds.length * world.tuning.busOperatingCostPerSecond * SECONDS_PER_GAME_DAY;
      return { id: route.id, a: route.a, b: route.b, buses: route.vehicleIds.length, incomePerDay, costPerDay, netPerDay: incomePerDay - costPerDay };
    })
    .sort((x, y) => x.netPerDay - y.netPerDay);
}

export interface ShareSummary {
  player: number;
  informal: number;
  lost: number;
}

/** Network-wide share of where passengers ended up, 0..1 each. */
export function networkShare(world: SliceWorld): ShareSummary {
  let player = 0;
  let informal = 0;
  let lost = 0;
  for (const rates of world.outcomes.values()) {
    player += rates.player;
    informal += rates.informal;
    lost += rates.lost;
  }
  const total = player + informal + lost;
  if (total <= 0) return { player: 0, informal: 0, lost: 0 };
  return { player: player / total, informal: informal / total, lost: lost / total };
}

export function waitingAt(world: SliceWorld, townId: string): number {
  let total = 0;
  for (const amount of world.simulation.queues.get(townId)?.values() ?? []) total += amount;
  return total;
}
