import type { GeneratedMap } from "../map/types";
import type { EconomyState } from "../economy/types";
import { applyOperatingCosts, recordDeliveryRevenue, updateIncomeRateEMA } from "../economy/state";
import type { ParatransitState } from "../paratransit/types";
import { reapCompletedParatransit, trySpawnParatransit, updateUnservedEMA } from "../paratransit/spawn";
import { generateDemandPairs } from "./demand";
import { buildRoutingContext } from "./routing";
import { computeSegmentLoads } from "./congestion";
import { createVehicle, tickVehicle } from "./vehicle";
import type { NodeQueues, SimulationState } from "./types";

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

  return { map, demand, queues, vehicles, segmentTraffic: new Map(), routing };
}

// `economy` and `paratransit` are optional and separate from
// SimulationState on purpose: engine/simulation stays about physical
// movement, engine/economy about money, engine/paratransit about the
// informal sector's own spawning -- this is the one place all three get
// threaded together.
export function tick(state: SimulationState, dt: number, economy?: EconomyState, paratransit?: ParatransitState): void {
  growQueues(state, dt);

  // Computed once per tick, before any vehicle moves, so every vehicle
  // sees the same congestion snapshot this tick rather than reacting to
  // vehicles that have already moved earlier in the same pass.
  const segmentLoads = computeSegmentLoads(state.vehicles, state.routing);

  let totalRevenueThisTick = 0;
  for (const vehicle of state.vehicles) {
    const deliveries = tickVehicle(vehicle, state.queues, state.routing, state.segmentTraffic, segmentLoads, dt);
    if (economy && deliveries.length > 0) {
      totalRevenueThisTick += recordDeliveryRevenue(economy, vehicle.id, deliveries);
    }
  }

  if (economy) {
    applyOperatingCosts(economy, dt);
    updateIncomeRateEMA(economy, totalRevenueThisTick, dt);
  }

  if (paratransit) {
    updateUnservedEMA(paratransit, state, dt);
    trySpawnParatransit(paratransit, state, segmentLoads);
    reapCompletedParatransit(paratransit, state);
  }
}

function growQueues(state: SimulationState, dt: number): void {
  for (const pair of state.demand) {
    const nodeQueue = state.queues.get(pair.from);
    if (!nodeQueue) continue;
    const key = `${pair.to}:${pair.kind}`;
    const current = nodeQueue.get(key) ?? 0;
    nodeQueue.set(key, Math.min(QUEUE_CAP, current + pair.rate * dt));
  }
}
