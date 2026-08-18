import type { GeneratedMap } from "../map/types";
import { decaySegments } from "../map/decay";
import type { EconomyState } from "../economy/types";
import { applyOperatingCosts, recordDeliveryRevenue, updateIncomeRateEMA } from "../economy/state";
import type { ParatransitState } from "../paratransit/types";
import { reapCompletedParatransit, trySpawnParatransit, updateUnservedEMA } from "../paratransit/spawn";
import type { EraModifiers } from "../eras/types";
import { applyPromotion, demandMultiplierFor, updateGrowthState } from "../growth/state";
import type { GrowthState, NodeDemandSample, PromotionEvent } from "../growth/types";
import { generateDemandPairs } from "./demand";
import { buildRoutingContext } from "./routing";
import { addLoads, computeAmbientGeometry, computeAmbientLoads, computeSegmentLoads } from "./congestion";
import { createVehicle, tickVehicle } from "./vehicle";
import type { NodeQueues, PickupEvent, SimulationState } from "./types";

const QUEUE_CAP = 50;

export interface VehicleSpec {
  id: string;
  waypoints: string[];
  speed: number;
  capacity: number;
  carries?: "passengers" | "goods";
}

export function createSimulation(map: GeneratedMap, vehicleSpecs: VehicleSpec[] = []): SimulationState {
  const demand = generateDemandPairs(map);
  const queues: NodeQueues = new Map(map.nodes.map((node) => [node.id, new Map()]));
  const routing = buildRoutingContext(map);
  const vehicles = vehicleSpecs.map((spec) =>
    createVehicle(spec.id, spec.waypoints, routing, spec.speed, spec.capacity, queues, spec.carries),
  );

  return {
    map,
    demand,
    queues,
    vehicles,
    segmentTraffic: new Map(),
    routing,
    ambientGeometry: computeAmbientGeometry(map.nodes, map.segments),
    segmentLoads: new Map(),
    ambientLoads: new Map(),
  };
}

// Everything derived from map topology, rebuilt in one place. Callers used
// to set `state.routing` and `state.map` by hand at two separate sites in
// render/fleet.ts; adding a second derived cache to that pattern would
// have meant two more places to forget. A stale proximity map is the
// quiet kind of wrong -- ambient traffic would keep clustering around a
// settlement that has since been pruned away from.
export function rebuildFromMap(state: SimulationState, map: GeneratedMap): void {
  state.map = map;
  state.routing = buildRoutingContext(map);
  state.ambientGeometry = computeAmbientGeometry(map.nodes, map.segments);
}

// `economy`, `paratransit`, and `growth` are optional and separate from
// SimulationState on purpose: engine/simulation stays about physical
// movement, engine/economy about money, engine/paratransit about the
// informal sector's own spawning, engine/growth about tier promotion --
// this is the one place all four get threaded together. `eraModifiers` is
// threaded the same way (docs/rebuild-plan.md §6 Module 8): simulate.ts
// is the one integration point that knows about eras at all --
// economy/pathing/paratransit/growth each take a plain multiplier, never
// the EraModifiers type itself, so those submodules stay decoupled from
// engine/eras. Returns any promotions this tick produced (docs/
// rebuild-plan.md §6 Module 9) so a caller that owns rendering can react
// (re-render the map, show a notification) without engine/simulation
// needing to know either exists.
export function tick(
  state: SimulationState,
  dt: number,
  economy?: EconomyState,
  paratransit?: ParatransitState,
  eraModifiers?: EraModifiers,
  growth?: GrowthState,
  // profileId -> decay multiplier. A plain Map, not the content type
  // (architecture.md hard rule 2). Passed per tick rather than held on
  // SimulationState because it is derived from loaded content, and
  // SimulationState is meant to be the physical world only.
  profileDecayById?: ReadonlyMap<string, number>,
): PromotionEvent[] {
  const generatedByNode = growQueues(state, dt, eraModifiers?.demand ?? 1, growth);
  decaySegments(state.map, dt, eraModifiers?.decay ?? 1, profileDecayById);

  // Computed once per tick, before any vehicle moves, so every vehicle
  // sees the same congestion snapshot this tick rather than reacting to
  // vehicles that have already moved earlier in the same pass. Segment
  // condition is read the same way, post-decay, for the same reason.
  // Ambient private traffic is folded in before anything reads a load, so
  // vehicles, the paratransit operator and the stress overlay all see one
  // road occupancy rather than three views of it.
  const vehicleLoads = computeSegmentLoads(state.vehicles, state.routing);
  const ambientLoads = computeAmbientLoads(
    state.ambientGeometry,
    demandMultipliers(growth),
    eraModifiers?.ambientTraffic ?? 0,
  );
  const segmentLoads = addLoads(vehicleLoads, ambientLoads);
  state.segmentLoads = segmentLoads;
  state.ambientLoads = ambientLoads;
  const segmentConditions = new Map(state.map.segments.map((segment) => [segment.id, segment.condition]));

  // Paratransit is an independent informal economy, not the player's --
  // its deliveries must never accrue to the player's funds. Gating on
  // `lifecycle` here, not "does economy have an entry for this vehicle
  // id" (registerPurchase is the only thing that would add one): the
  // explicit lifecycle check keeps this correct even if that invariant
  // ever slips, since paratransit vehicles are never meant to touch
  // economy at all.
  let totalRevenueThisTick = 0;
  const pickupEvents: PickupEvent[] = [];
  for (const vehicle of state.vehicles) {
    const deliveries = tickVehicle(
      vehicle,
      state.queues,
      state.routing,
      state.segmentTraffic,
      segmentLoads,
      dt,
      segmentConditions,
      pickupEvents,
    );
    if (economy && vehicle.lifecycle !== "one-shot" && deliveries.length > 0) {
      totalRevenueThisTick += recordDeliveryRevenue(economy, vehicle.id, deliveries);
    }
  }

  if (economy) {
    applyOperatingCosts(economy, dt, eraModifiers?.fuel ?? 1);
    updateIncomeRateEMA(economy, totalRevenueThisTick, dt);
  }

  if (paratransit) {
    updateUnservedEMA(paratransit, state, dt);
    trySpawnParatransit(
      paratransit,
      state,
      segmentLoads,
      eraModifiers?.paratransitPressure ?? 1,
      playerServiceByNode(growth),
    );
    reapCompletedParatransit(paratransit, state);
  }

  if (!growth) return [];

  const samples = buildGrowthSamples(generatedByNode, pickupEvents);
  const promotions = updateGrowthState(growth, samples, dt);
  for (const promotion of promotions) {
    applyPromotion(state.map, promotion);
  }
  return promotions;
}

// Plain nodeId -> number maps, never the GrowthState type itself: both
// congestion and paratransit stay decoupled from engine/growth's shape,
// the same way they take era multipliers as bare numbers.
function demandMultipliers(growth?: GrowthState): ReadonlyMap<string, number> {
  const multipliers = new Map<string, number>();
  if (!growth) return multipliers;
  for (const [nodeId, node] of growth) multipliers.set(nodeId, node.demandMultiplier);
  return multipliers;
}

function playerServiceByNode(growth?: GrowthState): ReadonlyMap<string, number> {
  const service = new Map<string, number>();
  if (!growth) return service;
  for (const [nodeId, node] of growth) service.set(nodeId, node.playerServiceEMA);
  return service;
}

function buildGrowthSamples(generatedByNode: Map<string, number>, pickupEvents: PickupEvent[]): NodeDemandSample[] {
  const playerServed = new Map<string, number>();
  const paratransitServed = new Map<string, number>();
  for (const event of pickupEvents) {
    const target = event.lifecycle === "one-shot" ? paratransitServed : playerServed;
    target.set(event.nodeId, (target.get(event.nodeId) ?? 0) + event.amount);
  }

  const samples: NodeDemandSample[] = [];
  for (const [nodeId, generated] of generatedByNode) {
    samples.push({
      nodeId,
      generated,
      playerServed: playerServed.get(nodeId) ?? 0,
      paratransitServed: paratransitServed.get(nodeId) ?? 0,
    });
  }
  return samples;
}

// Returns total demand generated per origin node this tick (all kinds
// combined) -- growth's service ratio needs this as the denominator, and
// computing it here (where the multiplier is already being applied) means
// there's exactly one place growth's rate ever gets folded into a
// generated amount, not two that could drift apart.
function growQueues(
  state: SimulationState,
  dt: number,
  demandMultiplier: number,
  growth?: GrowthState,
): Map<string, number> {
  const generatedByNode = new Map<string, number>();
  for (const pair of state.demand) {
    const nodeQueue = state.queues.get(pair.from);
    if (!nodeQueue) continue;
    const growthMultiplier = growth ? demandMultiplierFor(growth, pair.from) : 1;
    const key = `${pair.to}:${pair.kind}`;
    const current = nodeQueue.get(key) ?? 0;
    const amount = pair.rate * demandMultiplier * growthMultiplier * dt;
    nodeQueue.set(key, Math.min(QUEUE_CAP, current + amount));
    generatedByNode.set(pair.from, (generatedByNode.get(pair.from) ?? 0) + amount);
  }
  return generatedByNode;
}
