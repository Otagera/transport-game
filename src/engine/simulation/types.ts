import type { GeneratedMap } from "../map/types";
import type { AmbientGeometry } from "./congestion";

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
  // An okada occupying the same road space as a bus is plainly wrong
  // (docs/rebuild-plan.md §5) -- this is how much of a segment's
  // congestion capacity one vehicle actually uses.
  congestionWeight: number;
  // Player vehicles run cyclic routes; paratransit is one-shot (docs/
  // rebuild-plan.md §5) -- cyclic paratransit drains queues to a
  // comfortable equilibrium and removes the pressure to build. A
  // one-shot vehicle's path is not a closed loop; it's removed once it
  // reaches the end instead of wrapping back to the start.
  lifecycle: "cyclic" | "one-shot";
}

// Revenue accrues on unload, not on carriage (docs/rebuild-plan.md §5) --
// this is what a tick reports so the economy layer can turn it into
// money without engine/simulation needing to know about fares itself.
export interface DeliveryEvent {
  kind: CargoKind;
  amount: number;
}

// Module 9 (Growth): what engine/growth needs to compute a per-node
// service ratio -- how much of a node's generated demand actually got
// picked up, and by which kind of vehicle (player's cyclic fleet vs.
// paratransit's one-shot fleet get weighted differently there). Lives
// here, not in engine/growth, so engine/simulation stays the one module
// that knows about vehicle movement -- growth only ever reads this.
export interface PickupEvent {
  nodeId: string;
  kind: CargoKind;
  amount: number;
  lifecycle: Vehicle["lifecycle"];
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
  // Derived from map topology alone, so it is rebuilt with `routing` on
  // every map change rather than recomputed per tick -- nothing about it
  // can move between builds. See simulate.ts's rebuildFromMap.
  ambientGeometry: AmbientGeometry;
  // Total road occupancy per segment as of the last tick: player vehicles,
  // paratransit, and ambient private cars, already summed. Published here
  // rather than left for each reader to recompute so the number that slows
  // a bus down and the number the Corridor stress overlay draws are
  // literally the same number.
  segmentLoads: Map<string, number>;
  // The private-car share of the above, published separately because the
  // two answer different questions: `segmentLoads` is what slows a bus
  // down, `ambientLoads` is what the renderer draws as cars. Deriving one
  // from the other in render/ would mean player vehicles spawning phantom
  // traffic that nobody is driving.
  ambientLoads: Map<string, number>;
}
