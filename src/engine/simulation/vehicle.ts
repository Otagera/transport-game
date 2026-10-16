import type { CargoKind, DeliveryEvent, LoadEntry, NodeQueues, PickupEvent, RoutingContext, SegmentTraffic, Vehicle } from "./types";
import { findPath } from "./routing";
import { congestionFactor } from "./congestion";
import { conditionSpeedFactor } from "../map/decay";

function cargoAmount(cargo: LoadEntry[]): number {
  let total = 0;
  for (const entry of cargo) {
    total += entry.amount;
  }
  return total;
}

function unloadAt(vehicle: Vehicle, nodeId: string): LoadEntry[] {
  const delivered = vehicle.cargo.filter((entry) => entry.to === nodeId);
  vehicle.cargo = vehicle.cargo.filter((entry) => entry.to !== nodeId);
  return delivered;
}

// Paratransit is passengers-only (docs/principles.md §3); goods need
// capital an okada doesn't have. Generalized here as "what this vehicle
// is built to carry" rather than a paratransit-specific rule, since
// Module 6 is where vehicle carries becomes a real, content-driven
// distinction -- not just a decorative catalog field.
function isCompatibleCargo(carries: Vehicle["carries"], kind: CargoKind): boolean {
  if (carries === "passengers") return kind === "passengers";
  return kind === "produce" || kind === "supplies";
}

// The nodes a vehicle standing at path[currentIndex] will reach before it
// next comes back through this node. Two bugs bracket this rule:
//
// - Too short: reading only the tail of the path array meant a cyclic
//   route never saw the stops behind the wrap point, so every A<->B route
//   ran its return leg empty -- reciprocal demand (docs/principles.md §3)
//   generated both ways, served one way.
// - Too long: reading the whole cycle meant a rider at a mid-route stop
//   (X on a shuttle A-X-B) boarded a bus heading the wrong way and rode all
//   the way round. Stopping at the next visit to *this* node is what makes
//   "ahead" directional: at X heading for B, A is not ahead -- the bus
//   comes back through X first.
export function nodesAhead(vehicle: Vehicle, currentIndex: number): Set<string> {
  const length = vehicle.path.length;
  const here = vehicle.path[currentIndex];
  if (vehicle.lifecycle === "one-shot") return new Set(vehicle.path.slice(currentIndex + 1));
  const ahead = new Set<string>();
  for (let k = 1; k < length; k += 1) {
    const node = vehicle.path[(currentIndex + k) % length]!;
    if (node === here) break;
    ahead.add(node);
  }
  return ahead;
}

/**
 * Replaces a vehicle's default boarding rule at a stop. The slice uses it
 * for transfers: which riders board depends on their whole trip, not just
 * on whether their destination is ahead. Called where loadAt would be.
 */
export type Loader = (vehicle: Vehicle, nodeId: string, currentIndex: number) => void;

export function freeSeats(vehicle: Vehicle): number {
  return vehicle.capacity - cargoAmount(vehicle.cargo);
}

// Opportunistic loading, no manifests (docs/principles.md §3): at each
// node the vehicle loads queued demand whose destination it will reach
// before coming back round to this node (see nodesAhead).
// pickupEvents is optional and only populated by tickVehicle's ongoing
// loads (docs/architecture/engine.md §growth/) -- a vehicle's one-time initial
// load at creation doesn't feed growth's service-ratio accounting, since
// that's a bootstrap event, not sustained service.
function loadAt(
  vehicle: Vehicle,
  nodeId: string,
  currentIndex: number,
  queues: NodeQueues,
  pickupEvents?: PickupEvent[],
): void {
  const nodeQueue = queues.get(nodeId);
  if (!nodeQueue) {
    return;
  }

  const ahead = nodesAhead(vehicle, currentIndex);
  ahead.delete(nodeId);
  let free = vehicle.capacity - cargoAmount(vehicle.cargo);
  if (free <= 0) {
    return;
  }

  for (const [key, amount] of nodeQueue) {
    if (free <= 0) break;
    if (amount <= 0) continue;
    const [destination, kind] = key.split(":") as [string, CargoKind];
    if (!ahead.has(destination)) continue;
    if (!isCompatibleCargo(vehicle.carries, kind)) continue;

    const take = Math.min(amount, free);
    vehicle.cargo.push({ from: nodeId, to: destination, kind, amount: take });
    nodeQueue.set(key, amount - take);
    free -= take;
    pickupEvents?.push({ nodeId, to: destination, vehicleId: vehicle.id, kind, amount: take, lifecycle: vehicle.lifecycle });
  }
}

function findSegmentId(context: RoutingContext, fromNode: string, toNode: string): string | null {
  const edges = context.graph.get(fromNode);
  if (!edges) return null;
  const edge = edges.find((candidate) => candidate.to === toNode);
  return edge ? edge.segmentId : null;
}

function recordCrossing(
  traffic: Map<string, SegmentTraffic>,
  segmentId: string,
  effectiveCapacity: number,
  delivered: number,
  cargoAtArrivalAfterUnload: number,
): void {
  let entry = traffic.get(segmentId);
  if (!entry) {
    entry = { deliveredRecently: 0, potentialRecently: 0, loadFractionSum: 0, sampleCount: 0 };
    traffic.set(segmentId, entry);
  }
  entry.potentialRecently += effectiveCapacity;
  entry.deliveredRecently += delivered;
  entry.loadFractionSum += (cargoAtArrivalAfterUnload + delivered) / effectiveCapacity;
  entry.sampleCount += 1;
}

function nodeDistance(context: RoutingContext, a: string, b: string): number {
  const pa = context.positions.get(a);
  const pb = context.positions.get(b);
  if (!pa || !pb) return 0.0001;
  return Math.hypot(pa.x - pb.x, pa.y - pb.y) || 0.0001;
}

// Expands a cyclic list of waypoints into the full node-by-node path
// (including pass-through nodes) via A*, and does the vehicle's first load
// at its starting node before it ever departs.
export function createVehicle(
  id: string,
  waypoints: string[],
  context: RoutingContext,
  speed: number,
  capacity: number,
  queues?: NodeQueues,
  carries: Vehicle["carries"] = "passengers",
  congestionWeight = 1,
): Vehicle {
  if (waypoints.length < 2) {
    throw new Error(`Vehicle "${id}" needs at least two waypoints.`);
  }

  const path: string[] = [waypoints[0]!];
  for (let i = 0; i < waypoints.length; i += 1) {
    const from = waypoints[i]!;
    const to = waypoints[(i + 1) % waypoints.length]!;
    const result = findPath(context, from, to);
    if (!result) {
      throw new Error(`Vehicle "${id}": no path from "${from}" to "${to}".`);
    }
    path.push(...result.nodeIds.slice(1));
  }
  path.pop(); // closing the loop duplicates waypoints[0] at the end

  const vehicle: Vehicle = {
    id,
    path,
    pathIndex: 1,
    edgeProgress: 0,
    speed,
    capacity,
    cargo: [],
    carries,
    congestionWeight,
    lifecycle: "cyclic",
  };
  if (queues) {
    loadAt(vehicle, path[0]!, 0, queues);
  }
  return vehicle;
}

// A one-shot paratransit vehicle: a straight point-to-point path (not a
// closed loop), passengers-only, removed once it reaches the end instead
// of running forever (docs/principles.md §3: "cyclic paratransit drains
// queues to a comfortable equilibrium and removes the pressure to
// build. Measured, not assumed.").
export function createOneShotVehicle(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  context: RoutingContext,
  speed: number,
  capacity: number,
  congestionWeight: number,
  queues: NodeQueues,
): Vehicle | null {
  const result = findPath(context, fromNodeId, toNodeId);
  if (!result || result.nodeIds.length < 2) {
    return null;
  }

  const vehicle: Vehicle = {
    id,
    path: result.nodeIds,
    pathIndex: 1,
    edgeProgress: 0,
    speed,
    capacity,
    cargo: [],
    carries: "passengers",
    congestionWeight,
    lifecycle: "one-shot",
  };
  loadAt(vehicle, fromNodeId, 0, queues);
  return vehicle;
}

export function hasCompletedTrip(vehicle: Vehicle): boolean {
  return vehicle.lifecycle === "one-shot" && vehicle.pathIndex >= vehicle.path.length;
}

// Vehicles move along corridors as progress values on a graph -- no
// forces, no collisions (docs/principles.md §2, rejected: physics
// engines). The outer loop lets a large dt cross more than one edge in a
// single call without losing sub-edge progress; it now consumes a *time*
// budget rather than a distance budget, since congestion makes effective
// speed vary edge to edge within the same call.
export function tickVehicle(
  vehicle: Vehicle,
  queues: NodeQueues,
  context: RoutingContext,
  segmentTraffic: Map<string, SegmentTraffic>,
  segmentLoads: Map<string, number>,
  dt: number,
  segmentConditions: Map<string, number> = new Map(),
  pickupEvents: PickupEvent[] = [],
  loader?: Loader,
): DeliveryEvent[] {
  const pathLength = vehicle.path.length;
  if (pathLength < 2 || hasCompletedTrip(vehicle)) {
    return [];
  }

  const deliveries: DeliveryEvent[] = [];
  let timeRemaining = dt;

  while (timeRemaining > 0) {
    const fromIndex = (vehicle.pathIndex - 1 + pathLength) % pathLength;
    const fromNode = vehicle.path[fromIndex]!;
    const toNode = vehicle.path[vehicle.pathIndex]!;
    const edgeLength = nodeDistance(context, fromNode, toNode);
    const segmentId = findSegmentId(context, fromNode, toNode);
    const factor = segmentId ? congestionFactor(segmentLoads.get(segmentId) ?? 0) : 1;
    const decayFactor = segmentId ? conditionSpeedFactor(segmentConditions.get(segmentId) ?? 1) : 1;
    const effectiveSpeed = vehicle.speed * factor * decayFactor;

    const remainingDistanceOnEdge = (1 - vehicle.edgeProgress) * edgeLength;
    const distanceThisStep = effectiveSpeed * timeRemaining;

    if (distanceThisStep < remainingDistanceOnEdge) {
      vehicle.edgeProgress += distanceThisStep / edgeLength;
      timeRemaining = 0;
    } else {
      timeRemaining -= remainingDistanceOnEdge / effectiveSpeed;
      vehicle.edgeProgress = 0;

      const delivered = unloadAt(vehicle, toNode);
      let deliveredHere = 0;
      for (const entry of delivered) {
        deliveredHere += entry.amount;
        deliveries.push({ kind: entry.kind, amount: entry.amount, entry });
      }
      const cargoAfterUnload = cargoAmount(vehicle.cargo);

      const arrivedAtEnd = vehicle.lifecycle === "one-shot" && vehicle.pathIndex === pathLength - 1;
      if (!arrivedAtEnd) {
        if (loader) loader(vehicle, toNode, vehicle.pathIndex);
        else loadAt(vehicle, toNode, vehicle.pathIndex, queues, pickupEvents);
      }

      if (segmentId) {
        recordCrossing(segmentTraffic, segmentId, vehicle.capacity * factor, deliveredHere, cargoAfterUnload);
      }

      if (arrivedAtEnd) {
        vehicle.pathIndex = pathLength; // sentinel: trip complete, see hasCompletedTrip
        return deliveries;
      }

      vehicle.pathIndex = (vehicle.pathIndex + 1) % pathLength;
    }
  }

  return deliveries;
}
