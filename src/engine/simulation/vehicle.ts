import type { CargoKind, CorridorTraffic, LoadEntry, NodeQueues, RoutingContext, Vehicle } from "./types";
import { findPath } from "./routing";

function cargoAmount(cargo: LoadEntry[]): number {
  let total = 0;
  for (const entry of cargo) {
    total += entry.amount;
  }
  return total;
}

function sumAmountTo(cargo: LoadEntry[], nodeId: string): number {
  let total = 0;
  for (const entry of cargo) {
    if (entry.to === nodeId) {
      total += entry.amount;
    }
  }
  return total;
}

function unloadAt(vehicle: Vehicle, nodeId: string): void {
  vehicle.cargo = vehicle.cargo.filter((entry) => entry.to !== nodeId);
}

// Opportunistic loading, no manifests (docs/rebuild-plan.md §5): at each
// node the vehicle loads queued demand whose destination lies ahead on its
// remaining route -- not a full lookahead across the wrap-around.
function loadAt(vehicle: Vehicle, nodeId: string, queues: NodeQueues): void {
  const nodeQueue = queues.get(nodeId);
  if (!nodeQueue) {
    return;
  }

  const ahead = new Set(vehicle.path.slice(vehicle.pathIndex));
  let free = vehicle.capacity - cargoAmount(vehicle.cargo);
  if (free <= 0) {
    return;
  }

  for (const [key, amount] of nodeQueue) {
    if (free <= 0) break;
    if (amount <= 0) continue;
    const [destination, kind] = key.split(":") as [string, CargoKind];
    if (!ahead.has(destination)) continue;

    const take = Math.min(amount, free);
    vehicle.cargo.push({ from: nodeId, to: destination, kind, amount: take });
    nodeQueue.set(key, amount - take);
    free -= take;
  }
}

function findCorridorId(context: RoutingContext, fromNode: string, toNode: string): string | null {
  const edges = context.graph.get(fromNode);
  if (!edges) return null;
  const edge = edges.find((candidate) => candidate.to === toNode);
  return edge ? edge.corridorId : null;
}

function recordCrossing(
  traffic: Map<string, CorridorTraffic>,
  corridorId: string,
  capacity: number,
  delivered: number,
  cargoAtArrivalAfterUnload: number,
): void {
  let entry = traffic.get(corridorId);
  if (!entry) {
    entry = { deliveredRecently: 0, potentialRecently: 0, loadFractionSum: 0, sampleCount: 0 };
    traffic.set(corridorId, entry);
  }
  entry.potentialRecently += capacity;
  entry.deliveredRecently += delivered;
  entry.loadFractionSum += (cargoAtArrivalAfterUnload + delivered) / capacity;
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

  const vehicle: Vehicle = { id, path, pathIndex: 1, edgeProgress: 0, speed, capacity, cargo: [] };
  if (queues) {
    loadAt(vehicle, path[0]!, queues);
  }
  return vehicle;
}

// Vehicles move along corridors as progress values on a graph -- no
// forces, no collisions (docs/rebuild-plan.md §3, rejected: physics
// engines). The while loop lets a large dt cross more than one edge in a
// single call without losing sub-edge progress.
export function tickVehicle(
  vehicle: Vehicle,
  queues: NodeQueues,
  context: RoutingContext,
  corridorTraffic: Map<string, CorridorTraffic>,
  dt: number,
): void {
  const pathLength = vehicle.path.length;
  if (pathLength < 2) {
    return;
  }

  let distanceToTravel = vehicle.speed * dt;

  while (distanceToTravel > 0) {
    const fromIndex = (vehicle.pathIndex - 1 + pathLength) % pathLength;
    const fromNode = vehicle.path[fromIndex]!;
    const toNode = vehicle.path[vehicle.pathIndex]!;
    const edgeLength = nodeDistance(context, fromNode, toNode);
    const remainingOnEdge = (1 - vehicle.edgeProgress) * edgeLength;

    if (distanceToTravel < remainingOnEdge) {
      vehicle.edgeProgress += distanceToTravel / edgeLength;
      distanceToTravel = 0;
    } else {
      distanceToTravel -= remainingOnEdge;
      vehicle.edgeProgress = 0;

      const corridorId = findCorridorId(context, fromNode, toNode);
      const deliveredHere = sumAmountTo(vehicle.cargo, toNode);
      unloadAt(vehicle, toNode);
      const cargoAfterUnload = cargoAmount(vehicle.cargo);
      loadAt(vehicle, toNode, queues);
      if (corridorId) {
        recordCrossing(corridorTraffic, corridorId, vehicle.capacity, deliveredHere, cargoAfterUnload);
      }

      vehicle.pathIndex = (vehicle.pathIndex + 1) % pathLength;
    }
  }
}
