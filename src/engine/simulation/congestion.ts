import type { RoutingContext, Vehicle } from "./types";

export const FREE_SLOT_WEIGHT = 1;
export const CONGESTION_DECAY_RATE = 0.15;
export const MIN_CONGESTION_FACTOR = 0.15;

// Sum of congestion weight for every vehicle currently on each segment
// (their current edge). Per-vehicle weight, not a flat count per vehicle
// (docs/rebuild-plan.md §5): an okada occupying the same road space as a
// bus is plainly wrong and inflates the congestion effect.
export function computeSegmentLoads(vehicles: Vehicle[], context: RoutingContext): Map<string, number> {
  const loads = new Map<string, number>();
  for (const vehicle of vehicles) {
    const pathLength = vehicle.path.length;
    if (pathLength < 2) continue;
    const fromIndex = (vehicle.pathIndex - 1 + pathLength) % pathLength;
    const fromNode = vehicle.path[fromIndex]!;
    const toNode = vehicle.path[vehicle.pathIndex]!;
    const edge = context.graph.get(fromNode)?.find((candidate) => candidate.to === toNode);
    if (!edge) continue;
    loads.set(edge.segmentId, (loads.get(edge.segmentId) ?? 0) + vehicle.congestionWeight);
  }
  return loads;
}

// Congestion scales effective capacity, not just speed (docs/rebuild-
// plan.md §5) -- speed-only would mean more vehicles is always better
// and there'd be no puzzle. Free first slot: load up to FREE_SLOT_WEIGHT
// isn't congested at all. Floors at MIN_CONGESTION_FACTOR rather than
// approaching zero, so a jammed segment slows to a crawl instead of a
// full stop.
export function congestionFactor(load: number): number {
  const excess = Math.max(0, load - FREE_SLOT_WEIGHT);
  return Math.max(MIN_CONGESTION_FACTOR, 1 - CONGESTION_DECAY_RATE * excess);
}
