import type { GeneratedMap, Segment } from "../map/types";
import type { DemandPair, PathResult, Vehicle } from "../simulation/types";
import { createSimulation } from "../simulation/simulate";
import { findPath } from "../simulation/routing";
import { computeSegmentLoads } from "../simulation/congestion";
import { createVehicle } from "../simulation/vehicle";
import { canAfford, createEconomyState, registerPurchase, resaleValue, sellVehicle } from "../economy/state";
import { createDayLedger, forgetRoute, lastDay, routeExtraCostLastDay, routeIncomeLastDay } from "./ledger";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import type { OutcomeRates, SliceMapDef, SliceRoute, SliceTown, SliceTuning, SliceWorld } from "./types";
import { DEFAULT_SLICE_TUNING } from "./tuning";
import { createSettlementState } from "./settlement";
import { createGoodsState, lorryResale, lorrySummaries } from "./goods";
import { routesOnTrip } from "./transfers";
import { isDirt } from "./congestion";
import { buildSliceTerrain } from "./terrain";
import { isRailRoute, railPath, rebuildNetworks, routingFor, vehicleCostPerDay } from "./rail";
import { repairCost, roughCostPerDay, upkeepPerDay, wearSpeed } from "./wear";
import { planRoad, segmentLength, type Alignment, type Point } from "./roads";

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
  const map: GeneratedMap = {
    seed: 0,
    terrain: buildSliceTerrain(def),
    nodes: def.towns.map((town) => ({ id: town.id, kind: "settlement" as const, x: town.x, y: town.y })),
    corridors: [],
    segments: [],
  };
  def.roads.forEach((road, i) => addRoadToMap(map, `inherited-${i}`, road.a, road.b, "inherited"));
  // The def's towns are copied, not shared: emergent towns grow and the
  // def is the map's starting state, not live state.
  return map;
}

function addRoadToMap(
  map: GeneratedMap,
  id: string,
  a: string,
  b: string,
  provenance: Segment["provenance"],
  alignment?: { polyline: Point[]; length: number },
): void {
  const nodeA = map.nodes.find((node) => node.id === a)!;
  const nodeB = map.nodes.find((node) => node.id === b)!;
  const segment = roadSegment(id, a, b, provenance);
  if (alignment) segment.length = alignment.length;
  map.segments.push(segment);
  // One geometry representation (docs/principles.md §3): a straight road
  // is still a two-point polyline.
  const polyline = alignment?.polyline ?? [{ x: nodeA.x, y: nodeA.y }, { x: nodeB.x, y: nodeB.y }];
  map.corridors.push({ id: segment.corridorId, nodeIds: [a, b], polyline });
}

export function createSliceWorld(def: SliceMapDef, tuning: SliceTuning = DEFAULT_SLICE_TUNING): SliceWorld {
  const map = buildMap(def);
  const simulation = createSimulation(map, []);
  simulation.demand = gravityDemand(def.towns, tuning.demandK);
  const world: SliceWorld = {
    width: def.width,
    height: def.height,
    towns: new Map(def.towns.map((town) => [town.id, { ...town }])),
    tuning,
    simulation,
    economy: createEconomyState({ passengers: tuning.fare, produce: tuning.produceFare, supplies: tuning.suppliesFare }, tuning.startingFunds),
    routes: [],
    informal: { pool: new Map(), smallPool: new Map(), active: new Map(), segmentSpace: new Map(), earnings: 0 },
    pairOutcomes: new Map(),
    settlement: createSettlementState(),
    plans: null,
    transferRateEMA: new Map(),
    roughCostRateEMA: new Map(),
    ledger: createDayLedger(),
    segmentLoad: new Map(),
    roadFlowEMA: new Map(),
    vehicleSegment: new Map(),
    segmentSpeed: new Map(),
    ruins: new Map(),
    pathCache: new Map(),
    roadPlans: new Map(),
    railRouting: { graph: new Map(), positions: new Map() },
    railPathCache: new Map(),
    railPlans: new Map(),
    railOutOfService: new Set(),
    railVehicles: new Set(),
    railFlowEMA: new Map(),
    basePopulation: new Map(def.towns.map((town) => [town.id, town.population])),
    lorryRoutes: [],
    goods: createGoodsState(),
    port: def.port,
    heavyFlowEMA: new Map(),
    maintained: new Set(),
    upkeepRateEMA: new Map(),
    bridgeCells: new Map(),
    nextId: 0,
  };
  for (const pair of simulation.demand) world.pairOutcomes.set(pairKey(pair.from, pair.to), emptyOutcome());
  // The inherited network arrives neglected (principles §1, brownfield premise).
  for (const segment of map.segments) segment.condition = tuning.inheritedRoadCondition;
  // And the old railway arrives out of service, straight as it was laid.
  (def.rails ?? []).forEach((rail, i) => {
    const id = `inherited-rail-${i}`;
    addRoadToMap(map, id, rail.a, rail.b, "inherited");
    const segment = map.segments.find((s) => s.id === id)!;
    segment.type = "rail";
    segment.condition = 0.3;
    world.railOutOfService.add(id);
  });
  rebuildNetworks(world);
  return world;
}

export function emptyOutcome(): OutcomeRates {
  return { player: 0, poached: 0, gaveUp: 0, lost: 0 };
}

export function roadPath(world: SliceWorld, from: string, to: string): PathResult | null {
  const key = pairKey(from, to);
  if (!world.pathCache.has(key)) world.pathCache.set(key, findPath(world.simulation.routing, from, to));
  return world.pathCache.get(key)!;
}

// --- Player actions -------------------------------------------------------
// Each returns a reason on refusal rather than throwing: the UI shows it.

export type ActionResult = { ok: true } | { ok: false; reason: string };

// A new road's price is its plan's (roads.ts: engine/pathing's cost
// function IS the build price, architecture hard rule 3). The preview and
// the charge both call this; nothing else prices a road.
export function roadCost(world: SliceWorld, a: string, b: string, alignment: Alignment = "cheapest"): number {
  return planRoad(world, a, b, alignment)?.cost ?? Infinity;
}

// Paving buys the surface, not the earthworks: the alignment is already
// cut and any bridge already stands. So it's length times a flat cell's
// price -- on flat ground, what building the same road would cost -- plus
// repairing whatever wear the road has first: you can't pave over a broken
// base. Without that, paving a worn dirt road (new surface and all) cost
// less than repairing it, and repair was never the choice (step 4).
export function paveCost(world: SliceWorld, a: string, b: string): number {
  const chain = roadChain(world, a, b);
  if (!chain) return Infinity;
  let cost = 0;
  for (const road of chain.filter(isDirt)) {
    cost += segmentLength(world, road) * world.tuning.roadCostPerCell + repairCost(world, road, 1 - road.condition);
  }
  return Math.round(cost);
}

/** The one road segment joining two neighbouring towns, if there is one. */
export function directRoad(world: SliceWorld, a: string, b: string): Segment | undefined {
  return world.simulation.map.segments.find(
    (s) => s.type === "road" && ((s.fromNodeId === a && s.toNodeId === b) || (s.fromNodeId === b && s.toNodeId === a)),
  );
}

function roadsAt(world: SliceWorld, nodeId: string): Segment[] {
  return world.simulation.map.segments.filter((s) => s.type === "road" && (s.fromNodeId === nodeId || s.toNodeId === nodeId));
}

function otherEnd(segment: Segment, nodeId: string): string {
  return segment.fromNodeId === nodeId ? segment.toNodeId : segment.fromNodeId;
}

/** A roadside town (or its ruin) that a road only passes through: on exactly two roads. */
function isPassThrough(world: SliceWorld, nodeId: string): boolean {
  return (world.settlement.emergent.has(nodeId) || world.ruins.has(nodeId)) && roadsAt(world, nodeId).length === 2;
}

/**
 * The road joining a and b, as the player thinks of it: one segment, or
 * several where roadside towns have grown on it and split it. The lever
 * audit found that once Mile 10 split the Owode-Ado road, paving "Owode to
 * Ado" was refused -- "no road joins them directly" -- and nothing said
 * you now had to pave each piece.
 */
export function roadChain(world: SliceWorld, a: string, b: string): Segment[] | null {
  for (const first of roadsAt(world, a)) {
    const chain = [first];
    let at = otherEnd(first, a);
    while (at !== b && isPassThrough(world, at)) {
      const next = roadsAt(world, at).find((s) => s !== chain[chain.length - 1])!;
      chain.push(next);
      at = otherEnd(next, at);
    }
    if (at === b) return chain;
  }
  return null;
}

/** The whole road a piece belongs to, extended both ways through roadside towns, with its end towns. */
export function chainOf(world: SliceWorld, segmentId: string): { a: string; b: string; pieces: Segment[] } | null {
  const piece = world.simulation.map.segments.find((s) => s.id === segmentId);
  if (!piece || piece.type !== "road") return null;
  const walk = (from: Segment, towards: string): { end: string; pieces: Segment[] } => {
    const pieces: Segment[] = [];
    let at = towards;
    let last = from;
    while (isPassThrough(world, at)) {
      const next = roadsAt(world, at).find((s) => s !== last)!;
      pieces.push(next);
      at = otherEnd(next, at);
      last = next;
    }
    return { end: at, pieces };
  };
  const back = walk(piece, piece.fromNodeId);
  const forward = walk(piece, piece.toNodeId);
  return { a: back.end, b: forward.end, pieces: [...back.pieces.reverse(), piece, ...forward.pieces] };
}

export function checkPave(world: SliceWorld, a: string, b: string): ActionResult {
  const chain = roadChain(world, a, b);
  if (!chain) return { ok: false, reason: "no road joins them" };
  if (!chain.some(isDirt)) return { ok: false, reason: "already paved" };
  if (!canAfford(world.economy, paveCost(world, a, b))) return { ok: false, reason: "can't afford it" };
  return { ok: true };
}

export function paveRoad(world: SliceWorld, a: string, b: string): ActionResult {
  const check = checkPave(world, a, b);
  if (!check.ok) return check;
  world.economy.funds -= paveCost(world, a, b);
  for (const road of roadChain(world, a, b)!.filter(isDirt)) {
    road.provenance = "built";
    // A new surface: paving renews the road as well as widening what it carries.
    road.condition = 1;
  }
  return { ok: true };
}

export function checkRoad(world: SliceWorld, a: string, b: string, alignment: Alignment = "cheapest"): ActionResult {
  if (a === b) return { ok: false, reason: "pick two different towns" };
  if (roadChain(world, a, b)) return { ok: false, reason: "already connected directly" };
  if (!planRoad(world, a, b, alignment)) return { ok: false, reason: "the water is too wide to bridge here" };
  if (!canAfford(world.economy, roadCost(world, a, b, alignment))) return { ok: false, reason: "can't afford it" };
  return { ok: true };
}

export function buildRoad(world: SliceWorld, a: string, b: string, alignment: Alignment = "cheapest"): ActionResult {
  const check = checkRoad(world, a, b, alignment);
  if (!check.ok) return check;
  const plan = planRoad(world, a, b, alignment)!;
  world.economy.funds -= plan.cost;
  addRoadToMap(world.simulation.map, `road-${world.nextId++}`, a, b, "built", plan);
  rebuildNetworks(world);
  return { ok: true };
}

export function routeKey(a: string, b: string): string {
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
    route = { id: routeKey(a, b), a, b, vehicleIds: [], openedAtSeconds: world.economy.elapsedSeconds, boardingRateEMA: 0, loadFactorEMA: 0, speedEMA: 1 };
    world.routes.push(route);
    forgetRoute(world.ledger, route.id);
    world.plans = null; // a new route changes how riders cross the network
  }
  const { tuning } = world;
  const id = `bus-${world.nextId++}`;
  // No queues: a bus placed mid-route must not teleport-load at route.a.
  const vehicle = createVehicle(
    id,
    [route.a, route.b],
    world.simulation.routing,
    tuning.busSpeed,
    tuning.busCapacity,
    undefined,
    "passengers",
    tuning.busRoadSpace,
  );
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
  const { graph } = routingFor(world, vehicle);
  return vehicle.path.map((nodeId, i) => {
    const next = vehicle.path[(i + 1) % vehicle.path.length]!;
    return graph.get(nodeId)?.find((edge) => edge.to === next)?.weight ?? 0;
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

export function placeAtCycleFraction(world: SliceWorld, vehicle: Vehicle, fraction: number): void {
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
  world.railVehicles.delete(id);
  const resale = sellVehicle(world.economy, id);
  if (route.vehicleIds.length === 0) {
    world.routes = world.routes.filter((candidate) => candidate !== route);
    world.plans = null;
  }
  return resale;
}

/**
 * The way out of debt, or away from it (playtest 2026-10-16, day 14: "felt
 * stuck, didn't know how to get out of debt"). Debt blocks spending but not
 * billing (principles §3), so the only exit is to stop the bleeding: the
 * routes losing money on their own book, what selling their buses returns
 * now, and what it saves a day. Null when money isn't a worry -- in
 * credit and either earning or with more than a week of runway.
 */
export interface DebtAdvice {
  funds: number;
  netPerDay: number;
  /** Days until funds hit zero at this rate; 0 if already in debt, Infinity if earning. */
  daysLeft: number;
  /** Losing routes, worst first: selling all their buses returns `refund` and saves `savesPerDay`. */
  sell: Array<{ routeId: string; a: string; b: string; vehicles: number; refund: number; savesPerDay: number }>;
}

const RUNWAY_WARNING_DAYS = 7;

export function debtAdvice(world: SliceWorld): DebtAdvice | null {
  const funds = world.economy.funds;
  const netPerDay = lastDay(world.ledger).net;
  const daysLeft = funds <= 0 ? 0 : netPerDay >= 0 ? Infinity : funds / -netPerDay;
  if (funds >= 0 && daysLeft > RUNWAY_WARNING_DAYS) return null;
  const buses = routeSummaries(world).map((route) => ({
    routeId: route.id,
    a: route.a,
    b: route.b,
    vehicles: route.buses,
    refund: world.routes.find((r) => r.id === route.id)!.vehicleIds.reduce((sum, id) => sum + resaleValue(world.economy, id), 0),
    savesPerDay: -route.netPerDay,
  }));
  const lorries = lorrySummaries(world).map((route) => ({
    routeId: route.id,
    a: route.a,
    b: route.b,
    vehicles: route.lorries,
    refund: lorryResale(world, route.id),
    savesPerDay: -route.netPerDay,
  }));
  const sell = [...buses, ...lorries].filter((route) => route.savesPerDay > 0).sort((p, q) => q.savesPerDay - p.savesPerDay);
  return { funds, netPerDay, daysLeft, sell };
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
      const incomePerDay = routeIncomeLastDay(world.ledger, route.id, world.economy.elapsedSeconds - route.openedAtSeconds);
      const costPerDay =
        route.vehicleIds.length * vehicleCostPerDay(world, route.id, SECONDS_PER_GAME_DAY) +
        routeExtraCostLastDay(world.ledger, route.id, world.economy.elapsedSeconds - route.openedAtSeconds);
      return { id: route.id, a: route.a, b: route.b, buses: route.vehicleIds.length, incomePerDay, costPerDay, netPerDay: incomePerDay - costPerDay };
    })
    .sort((x, y) => x.netPerDay - y.netPerDay);
}

export type RouteVerdict = "thin" | "overcapacity" | "jammed" | "long" | "worn" | "full" | "poached" | "waiting" | "healthy";

export interface RouteDiagnosis {
  routeId: string;
  /** Passengers per second wanting trips this route can carry (both ends on its path). */
  demand: number;
  /** What carrying every one of them would earn per day -- the route's ceiling. */
  ceilingPerDay: number;
  /** Of the riders wanting this route's trips: where they went, 0..1 each. */
  carried: number;
  poached: number;
  gaveUp: number;
  lost: number;
  boardingsPerDay: number;
  loadFactor: number;
  /** Mean speed of this route's buses as a share of free flow. */
  speed: number;
  /** Of the traffic on this route's roads, the share that's informal (danfos, kekes, okadas). */
  informalTraffic: number;
  /** How fast its roads' condition lets its buses go, 0..1 of free speed (the worst stretch it runs). */
  wornSpeed: number;
  /** Fares one of its vehicles takes a day, and what one costs to run on sound roads. */
  incomePerVehicle: number;
  costPerVehicle: number;
  /** Round trips one vehicle makes a day, at its speed now. */
  roundTripsPerDay: number;
  /** For a route too long for flat fares: a stop to end it at instead, and the round trips that would make. */
  shorter: { a: string; b: string; roundTripsPerDay: number } | null;
  verdict: RouteVerdict;
}

// Thresholds for the one-line reason. Ordered most structural first: a
// route whose ceiling can't cover one bus's running cost is "thin" however
// it's run; past that, empty buses mean too many and full ones too few; past
// that, the biggest leak.
const OVERCAPACITY_LOAD = 0.35;
// Low load alone isn't overcapacity: measured on ilase-owode, 2 buses run
// ~35% full yet beat 1 bus, because they still catch riders who'd
// otherwise be lost. It's only too many buses once there's little left to
// catch.
const OVERCAPACITY_CARRIED = 0.6;
const FULL_LOAD = 0.85;
// Below this share of free-flow speed, traffic is the story.
const JAMMED_SPEED = 0.7;
// "Long": buses leave full, yet a full one takes less in fares than it
// costs to run on sound roads. Fares are flat, so a vehicle earns per trip
// and a long route makes few trips -- another bus would lose money too.
// Before this verdict existed, "full" told a playtester to add a bus to a
// 60-cell route whose one full bus took ₦87/day against ₦134 (day 31).
const POACHED_SHARE = 0.2;
// Below this share of free speed from wear alone, the road is the story
// (wear.ts). Ranked after jammed (traffic is the cause you can't repair)
// and after full: buses leaving full is the leak that pays to fix first
// -- ranked above it, "worn" hid the one move that would earn money
// (playtest, day 14: a 100%-full route said only "worn").
const WORN_SPEED = 0.85;
const WAITING_SHARE = 0.3;
// About how much of a route's riders one bus catches, measured: ~35% on
// ilase-owode, ~55% on the thin ilase-ise, ~33% on ilase-kuto -- the rest
// give up, stay home, or take a danfo first. So a route is thin when even
// this share of its ceiling can't pay one bus: comparing the whole ceiling
// called ilase-ise "waiting" (add buses) while its one bus lost money.
export const ONE_BUS_REACH = 0.5;

/**
 * Why a route earns what it does (docs/principles.md §3: per-route P&L
 * must be diagnosable). Every number is measured, not modelled: the
 * outcome rates of the trips whose both ends lie on the route's path.
 */
export function diagnoseRoute(world: SliceWorld, routeId: string): RouteDiagnosis | null {
  const route = world.routes.find((candidate) => candidate.id === routeId);
  if (!route || route.vehicleIds.length === 0) return null;

  // The trips this route carries: every trip that might ride it for a leg
  // on a fewest-buses journey -- including riders changing buses, which is
  // what makes a feeder route's numbers honest, and trips it shares with a
  // parallel route.
  const carried = new Set<string>();
  let demand = 0;
  for (const pair of world.simulation.demand) {
    if (!routesOnTrip(world, pair.from, pair.to).has(routeId)) continue;
    carried.add(pairKey(pair.from, pair.to));
    demand += pair.rate;
  }
  const outcomes = sumOutcomes(world, (from, to) => carried.has(pairKey(from, to)));
  const total = outcomes.player + outcomes.poached + outcomes.gaveUp + outcomes.lost;
  const of = (n: number) => (total > 0 ? n / total : 0);

  const ceilingPerDay = demand * world.tuning.fare * SECONDS_PER_GAME_DAY;
  // Thin means the trips can't pay for even one bus, at what one bus can
  // realistically catch (ONE_BUS_REACH). Comparing against the
  // whole fleet's cost instead would call an over-bused strong route
  // "thin" -- the fix there is fewer buses, not giving up on the route.
  const oneBusPerDay = vehicleCostPerDay(world, routeId, SECONDS_PER_GAME_DAY);
  const diagnosis: RouteDiagnosis = {
    routeId,
    demand,
    ceilingPerDay,
    carried: of(outcomes.player),
    poached: of(outcomes.poached),
    gaveUp: of(outcomes.gaveUp),
    lost: of(outcomes.lost),
    boardingsPerDay: route.boardingRateEMA * SECONDS_PER_GAME_DAY,
    loadFactor: route.loadFactorEMA,
    speed: route.speedEMA,
    informalTraffic: informalTrafficShare(world, routeId),
    wornSpeed: Math.min(1, ...[...routeSegments(world, routeId)].map((id) => wearSpeed(world, world.simulation.map.segments.find((s) => s.id === id)!))),
    incomePerVehicle:
      routeIncomeLastDay(world.ledger, routeId, world.economy.elapsedSeconds - route.openedAtSeconds) / route.vehicleIds.length,
    costPerVehicle: oneBusPerDay,
    roundTripsPerDay: 0,
    shorter: null,
    verdict: "healthy",
  };
  const trips = roundTrips(world, routeId);
  diagnosis.roundTripsPerDay = trips?.perDay ?? 0;
  const fullButLosing = route.loadFactorEMA >= FULL_LOAD && diagnosis.incomePerVehicle < oneBusPerDay;

  if (ceilingPerDay * ONE_BUS_REACH < oneBusPerDay) diagnosis.verdict = "thin";
  else if (route.vehicleIds.length >= 2 && route.loadFactorEMA < OVERCAPACITY_LOAD && diagnosis.carried >= OVERCAPACITY_CARRIED) {
    diagnosis.verdict = "overcapacity";
  }
  // Track has no traffic: a slow train is worn track under a slow order, not a jam.
  else if (!isRailRoute(routeId) && route.speedEMA < JAMMED_SPEED) diagnosis.verdict = "jammed";
  else if (fullButLosing) {
    diagnosis.verdict = "long";
    diagnosis.shorter = trips?.shorter ?? null;
  } else if (route.loadFactorEMA >= FULL_LOAD) diagnosis.verdict = "full";
  else if (diagnosis.wornSpeed < WORN_SPEED) diagnosis.verdict = "worn";
  else if (diagnosis.poached >= POACHED_SHARE) diagnosis.verdict = "poached";
  else if (diagnosis.gaveUp + diagnosis.lost >= WAITING_SHARE) diagnosis.verdict = "waiting";
  return diagnosis;
}

/**
 * Round trips a route's vehicle makes a day at its speed now, and -- for
 * a route with stops along it -- the shorter route ending at the stop
 * nearest halfway, from the end with more people, with its round trips.
 */
function roundTrips(world: SliceWorld, routeId: string): { perDay: number; shorter: { a: string; b: string; roundTripsPerDay: number } | null } | null {
  const route = world.routes.find((candidate) => candidate.id === routeId);
  const vehicle = route && world.simulation.vehicles.find((candidate) => candidate.id === route.vehicleIds[0]);
  if (!route || !vehicle) return null;
  const { graph } = routingFor(world, vehicle);
  const speed = vehicle.speed * Math.max(0.05, route.speedEMA);
  // One way along the path, a -> b, with the distance to each stop.
  const start = vehicle.path.indexOf(route.a);
  if (start === -1) return null;
  const stops: Array<{ id: string; at: number }> = [{ id: route.a, at: 0 }];
  let travelled = 0;
  for (let k = 1; k <= vehicle.path.length; k += 1) {
    const from = vehicle.path[(start + k - 1) % vehicle.path.length]!;
    const to = vehicle.path[(start + k) % vehicle.path.length]!;
    travelled += graph.get(from)?.find((edge) => edge.to === to)?.weight ?? 0;
    stops.push({ id: to, at: travelled });
    if (to === route.b) break;
  }
  const oneWay = travelled;
  const perDay = (distance: number) => (distance > 0 ? SECONDS_PER_GAME_DAY / ((2 * distance) / speed) : 0);
  const middle = stops.slice(1, -1).filter((stop) => world.towns.has(stop.id));
  if (middle.length === 0) return { perDay: perDay(oneWay), shorter: null };
  const halfway = middle.reduce((best, stop) => (Math.abs(stop.at - oneWay / 2) < Math.abs(best.at - oneWay / 2) ? stop : best));
  const popA = world.towns.get(route.a)?.population ?? 0;
  const popB = world.towns.get(route.b)?.population ?? 0;
  const [end, distance] = popA >= popB ? [route.a, halfway.at] : [route.b, oneWay - halfway.at];
  return { perDay: perDay(oneWay), shorter: { a: end, b: halfway.id, roundTripsPerDay: perDay(distance) } };
}

/** Of the road space in use on a route's roads right now, the share that's informal. */
/** The road segments a route's buses run over. */
function routeSegments(world: SliceWorld, routeId: string): Set<string> {
  // Passenger and goods routes alike: a lorry's dirt roads are what paving it means too.
  const route = [...world.routes, ...world.lorryRoutes].find((candidate) => candidate.id === routeId);
  const vehicle = route && world.simulation.vehicles.find((candidate) => candidate.id === route.vehicleIds[0]);
  const segments = new Set<string>();
  if (!vehicle) return segments;
  // On the network it runs on: a train's track, not the road between the same towns.
  const { graph } = routingFor(world, vehicle);
  for (let i = 0; i < vehicle.path.length; i += 1) {
    const from = vehicle.path[i]!;
    const to = vehicle.path[(i + 1) % vehicle.path.length]!;
    const edge = graph.get(from)?.find((candidate) => candidate.to === to);
    if (edge) segments.add(edge.segmentId);
  }
  return segments;
}

/** The worn roads on a route, worst first, with what keeping each one up would cost a day. */
export function wornRoadsOn(
  world: SliceWorld,
  routeId: string,
): Array<{ a: string; b: string; speed: number; upkeepPerDay: number; roughPerDay: number; maintained: boolean }> {
  const ids = routeSegments(world, routeId);
  return world.simulation.map.segments
    // A bus route's roads, a train route's track (routeSegments is network-aware).
    .filter((segment) => ids.has(segment.id) && !world.railOutOfService.has(segment.id) && wearSpeed(world, segment) < 0.95)
    .map((segment) => ({
      a: segment.fromNodeId,
      b: segment.toNodeId,
      speed: wearSpeed(world, segment),
      upkeepPerDay: upkeepPerDay(world, segment),
      roughPerDay: roughCostPerDay(world, segment),
      maintained: world.maintained.has(segment.id),
    }))
    .sort((p, q) => p.speed - q.speed);
}

/** The dirt roads on a route, as town pairs -- what paving it would mean. */
export function dirtRoadsOn(world: SliceWorld, routeId: string): Array<{ a: string; b: string }> {
  const ids = routeSegments(world, routeId);
  return world.simulation.map.segments
    .filter((segment) => ids.has(segment.id) && segment.type === "road" && isDirt(segment))
    .map((segment) => ({ a: segment.fromNodeId, b: segment.toNodeId }));
}

function informalTrafficShare(world: SliceWorld, routeId: string): number {
  const segments = routeSegments(world, routeId);
  if (segments.size === 0) return 0;
  // Same measure as segmentLoad -- vehicles on the road now -- not the
  // informal road-space reservation, which spans each vehicle's whole trip.
  const informalNow = computeSegmentLoads(
    world.simulation.vehicles.filter((candidate) => candidate.lifecycle === "one-shot"),
    world.simulation.routing,
  );
  let total = 0;
  let informal = 0;
  for (const id of segments) {
    total += world.segmentLoad.get(id) ?? 0;
    informal += informalNow.get(id) ?? 0;
  }
  return total > 0 ? Math.min(1, informal / total) : 0;
}

export interface ShareSummary {
  player: number;
  informal: number;
  lost: number;
}

function toShare(rates: OutcomeRates): ShareSummary {
  const informal = rates.poached + rates.gaveUp;
  const total = rates.player + informal + rates.lost;
  if (total <= 0) return { player: 0, informal: 0, lost: 0 };
  return { player: rates.player / total, informal: informal / total, lost: rates.lost / total };
}

function sumOutcomes(world: SliceWorld, include: (from: string, to: string) => boolean): OutcomeRates {
  const sum = emptyOutcome();
  for (const [key, rates] of world.pairOutcomes) {
    const separator = key.indexOf(":");
    if (!include(key.slice(0, separator), key.slice(separator + 1))) continue;
    sum.player += rates.player;
    sum.poached += rates.poached;
    sum.gaveUp += rates.gaveUp;
    sum.lost += rates.lost;
  }
  return sum;
}

/** Network-wide share of where passengers ended up, 0..1 each. */
export function networkShare(world: SliceWorld): ShareSummary {
  return toShare(sumOutcomes(world, () => true));
}

/** Where passengers *leaving* this town ended up. */
export function townOutcomes(world: SliceWorld, townId: string): OutcomeRates {
  return sumOutcomes(world, (from) => from === townId);
}

export function townShare(world: SliceWorld, townId: string): ShareSummary {
  return toShare(townOutcomes(world, townId));
}

/**
 * Travel inside a town (docs/principles.md §5): the short trips and the
 * last mile that kekes and okadas carry and nothing you run reaches. It's
 * informal's for good, so it's kept out of every share and all money -- a
 * permanent informal share must not read as failure. Inside a town the
 * relationship flips from competitor to feeder: most of your riders in a
 * big town reach the bus park, and leave it, by keke or okada.
 */
export interface LocalTravel {
  /** Inside-town trips per day, all informal. */
  tripsPerDay: number;
  /** Share of your riders here who ride a keke or okada to or from the park, 0..1. */
  firstMileShare: number;
  /** Your riders boarding or getting off here per day who came or left that way. */
  feederPerDay: number;
}

export function localTravel(world: SliceWorld, townId: string): LocalTravel {
  const town = world.towns.get(townId);
  if (!town) return { tripsPerDay: 0, firstMileShare: 0, feederPerDay: 0 };
  const firstMileShare = town.population / (town.population + world.tuning.walkableTownPopulation);
  // Your riders starting or ending a trip here (outcomes are per trip, so a
  // rider changing buses here isn't counted -- they never leave the park).
  const yours = sumOutcomes(world, (from, to) => from === townId || to === townId).player;
  return {
    tripsPerDay: town.population * world.tuning.localTripsPerThousandPerDay,
    firstMileShare,
    feederPerDay: yours * firstMileShare * SECONDS_PER_GAME_DAY,
  };
}

export interface TripSummary {
  /** The other town. */
  to: string;
  /** Passengers per second wanting this trip, both directions combined. */
  demand: number;
  share: ShareSummary;
  /** Whether a road or working track joins the two towns -- if not, nobody can take this trip. */
  reachable: boolean;
}

/**
 * Every trip touching a town, both directions combined, biggest first --
 * what the player needs to see to route: where people want to go, and who
 * is carrying them now.
 */
export function tripsFrom(world: SliceWorld, townId: string): TripSummary[] {
  const demandByOther = new Map<string, number>();
  for (const pair of world.simulation.demand) {
    if (pair.from === townId) demandByOther.set(pair.to, (demandByOther.get(pair.to) ?? 0) + pair.rate);
    else if (pair.to === townId) demandByOther.set(pair.from, (demandByOther.get(pair.from) ?? 0) + pair.rate);
  }
  return [...demandByOther]
    .map(([to, demand]) => ({
      to,
      demand,
      share: toShare(sumOutcomes(world, (a, b) => (a === townId && b === to) || (a === to && b === townId))),
      reachable: canTravel(world, townId, to),
    }))
    .sort((x, y) => y.demand - x.demand);
}

/**
 * A town no road reaches: every trip its people want stays home. Said
 * outright, because a playtester read a cut-off town's all-grey wish-lines
 * as "nowhere to go" rather than "no way to get there" (day 17).
 */
export function isCutOff(world: SliceWorld, townId: string): boolean {
  for (const other of world.towns.keys()) {
    if (other !== townId && canTravel(world, townId, other)) return false;
  }
  return true;
}

/** Whether anything could carry people between two towns: a road, or working track. */
function canTravel(world: SliceWorld, a: string, b: string): boolean {
  return roadPath(world, a, b) !== null || railPath(world, a, b) !== null;
}

/** Passengers per second wanting to travel between a and b, both directions. */
export function pairDemand(world: SliceWorld, a: string, b: string): number {
  let total = 0;
  for (const pair of world.simulation.demand) {
    if ((pair.from === a && pair.to === b) || (pair.from === b && pair.to === a)) total += pair.rate;
  }
  return total;
}

/**
 * Riders per second wanting trips a bus between `a` and `b` would carry
 * without a change: every trip with both ends on its road path, both
 * directions. What a route can reach on its own -- the honest number to
 * show when buying a bus, since a bus from Ilase to Ikole also carries
 * Ilase-Kuto and Kuto-Ikole riders, not only Ilase-Ikole ones.
 */
export function demandAlong(world: SliceWorld, a: string, b: string, along?: string[]): number {
  // `along`: the stops of a path that isn't the road one (a train's, on track).
  const nodeIds = along ?? roadPath(world, a, b)?.nodeIds;
  if (!nodeIds) return 0;
  const stops = new Set(nodeIds);
  let total = 0;
  for (const pair of world.simulation.demand) if (stops.has(pair.from) && stops.has(pair.to)) total += pair.rate;
  return total;
}

export interface ThroughRoute {
  /** The route's ends, extended past one of the current ones. */
  a: string;
  b: string;
  /** Towns it passes through, in order, between a and b. */
  via: string[];
  /** Fares a day of every trip along it, against the current route's along its own path. */
  reachPerDay: number;
  currentReachPerDay: number;
}

// How much bigger an extension's reach must be before it's worth saying.
const THROUGH_ROUTE_GAIN = 1.5;
// And how far past one bus's break-even (at ONE_BUS_REACH) it must reach.
// Measured over 20 days: Owode-Ogbe via Ado reached 1.1x break-even and
// still lost 72/day (long, slow, one bus) -- not worth pointing at.
// Kuto-Ikole -> Ilase-Ikole via Kuto (2.2x) and Ilase-Ise -> Owode-Ise via
// Ilase (2.9x: 0/day -> +63) are.
const THROUGH_ROUTE_PAY_MARGIN = 1.5;

/**
 * A thin shuttle can often be run through to the next town past one of its
 * ends, and then carries every trip along the longer path (playtest, day
 * 14: a bridge to Ikole got a Kuto-Ikole shuttle at -74/day; a bus from
 * Ilase through Kuto reaches several times the trips). One hop only, and
 * only if the longer path is at least as dense in trips per cell: measured
 * on reach alone, the longest route always won (Kuto-Ikole "should" run
 * from Ipaja through five towns), and one bus on it comes round too rarely
 * to carry any of it. Returns the best extension if it's clearly more and
 * could pay for a bus.
 */
export function throughRoute(world: SliceWorld, routeId: string): ThroughRoute | null {
  const route = world.routes.find((candidate) => candidate.id === routeId);
  // Roads only for now: running a train on is a track decision, not a bus one.
  if (!route || isRailRoute(routeId)) return null;
  const perDay = (rate: number) => rate * world.tuning.fare * SECONDS_PER_GAME_DAY;
  const lengthOf = (from: string, to: string) => roadPath(world, from, to)?.distance ?? Infinity;
  const current = perDay(demandAlong(world, route.a, route.b));
  const currentDensity = current / lengthOf(route.a, route.b);
  const oneBus = world.tuning.busOperatingCostPerSecond * SECONDS_PER_GAME_DAY;
  let best: ThroughRoute | null = null;
  for (const segment of world.simulation.map.segments) {
    if (segment.type !== "road") continue; // a bus runs on along roads, not track
    // A road leaving one end of the route, to a town not on it: past `a`
    // it runs t, a, ..., b; past `b` it runs a, ..., b, t.
    for (const [end, other] of [[route.a, route.b], [route.b, route.a]] as const) {
      const t = segment.fromNodeId === end ? segment.toNodeId : segment.toNodeId === end ? segment.fromNodeId : null;
      if (!t || t === other || !world.towns.has(t)) continue;
      const [from, to] = end === route.a ? [t, route.b] : [route.a, t];
      const path = roadPath(world, from, to);
      if (!path || !path.nodeIds.includes(end)) continue;
      const reach = perDay(demandAlong(world, from, to));
      if (reach / path.distance < currentDensity) continue;
      if (best && reach <= best.reachPerDay) continue;
      best = { a: from, b: to, via: path.nodeIds.slice(1, -1), reachPerDay: reach, currentReachPerDay: current };
    }
  }
  if (!best || best.reachPerDay < current * THROUGH_ROUTE_GAIN) return null;
  if (best.reachPerDay * ONE_BUS_REACH < oneBus * THROUGH_ROUTE_PAY_MARGIN) return null;
  return best;
}

export function waitingAt(world: SliceWorld, townId: string): number {
  let total = 0;
  for (const amount of world.simulation.queues.get(townId)?.values() ?? []) total += amount;
  return total;
}
