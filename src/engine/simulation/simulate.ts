import type { GeneratedMap } from "../map/types";
import type { EconomyState } from "../economy/types";
import { applyOperatingCosts, recordDeliveryRevenue, updateIncomeRateEMA } from "../economy/state";
import { generateDemandPairs } from "./demand";
import { buildRoutingContext } from "./routing";
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

// `economy` is optional and separate from SimulationState on purpose:
// engine/simulation stays about physical movement, engine/economy about
// money, and this is the one place they're threaded together.
export function tick(state: SimulationState, dt: number, economy?: EconomyState): void {
  growQueues(state, dt);

  let totalRevenueThisTick = 0;
  for (const vehicle of state.vehicles) {
    const deliveries = tickVehicle(vehicle, state.queues, state.routing, state.segmentTraffic, dt);
    if (economy && deliveries.length > 0) {
      totalRevenueThisTick += recordDeliveryRevenue(economy, vehicle.id, deliveries);
    }
  }

  if (economy) {
    applyOperatingCosts(economy, dt);
    updateIncomeRateEMA(economy, totalRevenueThisTick, dt);
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
