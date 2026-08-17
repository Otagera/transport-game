import type { GeneratedMap } from "../map/types";
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
}

export function createSimulation(map: GeneratedMap, vehicleSpecs: VehicleSpec[] = []): SimulationState {
  const demand = generateDemandPairs(map);
  const queues: NodeQueues = new Map(map.nodes.map((node) => [node.id, new Map()]));
  const routing = buildRoutingContext(map);
  const vehicles = vehicleSpecs.map((spec) =>
    createVehicle(spec.id, spec.waypoints, routing, spec.speed, spec.capacity, queues),
  );

  return { map, demand, queues, vehicles, segmentTraffic: new Map(), routing };
}

export function tick(state: SimulationState, dt: number): void {
  growQueues(state, dt);
  for (const vehicle of state.vehicles) {
    tickVehicle(vehicle, state.queues, state.routing, state.segmentTraffic, dt);
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
