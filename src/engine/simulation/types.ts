import type { GeneratedMap } from "../map/types";

export type CargoKind = "passengers" | "produce" | "supplies";

export interface DemandPair {
  from: string;
  to: string;
  kind: CargoKind;
  rate: number;
}

// Aggregate demand, never per-passenger agents (docs/rebuild-plan.md §4
// hard rule 6): a node's queue is (destination, kind) -> amount waiting.
export type NodeQueueKey = string; // `${destinationNodeId}:${CargoKind}`
export type NodeQueues = Map<string, Map<NodeQueueKey, number>>;

// Conveyor model: a vehicle carries a list of these aggregate entries, not
// individual passengers. `from` is required, or a delivered trip can't be
// attributed back to the origin that generated it.
export interface LoadEntry {
  from: string;
  to: string;
  kind: CargoKind;
  amount: number;
}

export interface Vehicle {
  id: string;
  path: string[];
  pathIndex: number;
  edgeProgress: number;
  speed: number;
  capacity: number;
  cargo: LoadEntry[];
}

export interface CorridorTraffic {
  deliveredRecently: number;
  potentialRecently: number;
  loadFractionSum: number;
  sampleCount: number;
}

export interface RoutingEdge {
  to: string;
  corridorId: string;
  weight: number;
}

export type RoutingGraph = Map<string, RoutingEdge[]>;

export interface RoutingContext {
  graph: RoutingGraph;
  positions: Map<string, { x: number; y: number }>;
}

export interface PathResult {
  nodeIds: string[];
  corridorIds: string[];
  distance: number;
}

export interface SimulationState {
  map: GeneratedMap;
  demand: DemandPair[];
  queues: NodeQueues;
  vehicles: Vehicle[];
  corridorTraffic: Map<string, CorridorTraffic>;
  routing: RoutingContext;
}
