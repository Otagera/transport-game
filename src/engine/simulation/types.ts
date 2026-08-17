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
  // What this vehicle is built to carry -- a goods vehicle never loads
  // passenger demand and vice versa (docs/rebuild-plan.md §5: paratransit
  // is passengers-only because goods need capital an okada doesn't have,
  // generalized here to any vehicle).
  carries: "passengers" | "goods";
}

// Revenue accrues on unload, not on carriage (docs/rebuild-plan.md §5) --
// this is what a tick reports so the economy layer can turn it into
// money without engine/simulation needing to know about fares itself.
export interface DeliveryEvent {
  kind: CargoKind;
  amount: number;
}

// Traffic is tracked per segment, not per corridor -- a segment is the
// actual typed/levelled/maintained traversable unit (docs/rebuild-plan.md
// §5), so it's what "which link is the bottleneck" needs to point at.
export interface SegmentTraffic {
  deliveredRecently: number;
  potentialRecently: number;
  loadFractionSum: number;
  sampleCount: number;
}

export interface RoutingEdge {
  to: string;
  segmentId: string;
  weight: number;
}

export type RoutingGraph = Map<string, RoutingEdge[]>;

export interface RoutingContext {
  graph: RoutingGraph;
  positions: Map<string, { x: number; y: number }>;
}

export interface PathResult {
  nodeIds: string[];
  segmentIds: string[];
  distance: number;
}

export interface SimulationState {
  map: GeneratedMap;
  demand: DemandPair[];
  queues: NodeQueues;
  vehicles: Vehicle[];
  segmentTraffic: Map<string, SegmentTraffic>;
  routing: RoutingContext;
}
