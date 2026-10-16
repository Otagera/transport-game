import { computeSegmentLoads } from "../simulation/congestion";
import type { Segment } from "../map/types";
import type { Vehicle } from "../simulation/types";
import type { SliceWorld } from "./types";

// Shared road (docs/principles.md §6, step 2). Your buses and the informal
// sector slow each other down -- which closes the loop the hook depends on
// (principles §3, Congestion): weak service invites danfos and okadas, and
// they take the road your buses need, which weakens service further. The
// exit: every rider you carry is one fewer okada on the road.
//
// Speed follows the BPR curve -- the standard traffic-engineering
// speed-flow relation: free flow until near capacity, then a sharp fall.
//
//   travel time multiplier = 1 + α · (flow / capacity)^β
//
// Flow, not occupancy. The first version fed BPR the road space *on* each
// segment, which feeds back on itself: a jam slows vehicles, so more sit on
// the road at once, so the jam deepens -- measured, one bus on the half of
// the Ilase-Owode road that Mile 6 split off locked it at the speed floor
// for good. Flow (road space *entering* per second, rolling) has the
// opposite, stable feedback: a jammed bus completes fewer round trips, so it
// enters the road less often. Capacity is per road, not per cell -- a lane
// carries so many vehicles an hour whatever its length.
//
// Road space is each vehicle's congestion weight (bus, danfo 1, keke 0.5,
// okada 0.3). Congestion scales effective capacity, not just speed
// (principles §3): a slower bus completes fewer round trips, so carries
// fewer riders per day for the same running cost.

const BPR_ALPHA = 0.15;
const BPR_BETA = 4;
/** How quickly a road's measured flow follows its traffic. */
const FLOW_TAU_SECONDS = 10;

/**
 * Inherited roads are dirt until paved (world.ts paveRoad). Provenance is
 * the surface in the slice: paving makes a road "built", so a town
 * splitting a paved road leaves both halves paved, and the map draws it
 * like any road you built.
 */
export function isDirt(segment: Segment): boolean {
  return segment.provenance === "inherited";
}

export function roadCapacity(world: SliceWorld, segmentId: string): number {
  const segment = world.simulation.map.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) return Infinity;
  return world.tuning.roadFlowCapacity * (isDirt(segment) ? world.tuning.dirtRoadCapacity : 1);
}

export function speedFactor(flow: number, capacity: number, floor: number): number {
  const utilisation = flow / capacity;
  return Math.max(floor, 1 / (1 + BPR_ALPHA * utilisation ** BPR_BETA));
}

function currentSegment(world: SliceWorld, vehicle: Vehicle): string | null {
  const length = vehicle.path.length;
  if (length < 2 || vehicle.pathIndex >= length) return null;
  const from = vehicle.path[(vehicle.pathIndex - 1 + length) % length]!;
  const to = vehicle.path[vehicle.pathIndex]!;
  return world.simulation.routing.graph.get(from)?.find((candidate) => candidate.to === to)?.segmentId ?? null;
}

/**
 * Updates every road's flow and speed for this tick, before anything moves,
 * so every vehicle sees the same road (same rule as the original game's
 * tick). Publishes speed on the world: the number that slows a bus is
 * literally the number the map draws.
 */
export function updateRoadSpeeds(world: SliceWorld, dt: number): void {
  const { simulation, tuning } = world;

  // Road space entering each segment since last tick. Keyed by leg (path
  // index), not segment: a bus shuttling A<->B uses the same segment both
  // ways, and keyed by segment it never "entered" again -- its traffic was
  // invisible until something split the road.
  const entering = new Map<string, number>();
  const heavy = new Map<string, number>();
  const nowOn = new Map<string, string>();
  for (const vehicle of simulation.vehicles) {
    const segmentId = currentSegment(world, vehicle);
    if (!segmentId) continue;
    const leg = `${segmentId}#${vehicle.pathIndex}`;
    nowOn.set(vehicle.id, leg);
    if (world.vehicleSegment.get(vehicle.id) !== leg) {
      entering.set(segmentId, (entering.get(segmentId) ?? 0) + vehicle.congestionWeight);
      // Lorries counted apart too: they wear a road harder (wear.ts).
      if (vehicle.carries === "goods") heavy.set(segmentId, (heavy.get(segmentId) ?? 0) + vehicle.congestionWeight);
    }
  }
  world.vehicleSegment = nowOn;

  const alpha = 1 - Math.exp(-dt / FLOW_TAU_SECONDS);
  world.segmentLoad = computeSegmentLoads(simulation.vehicles, simulation.routing);
  world.segmentSpeed = new Map();
  for (const segment of simulation.map.segments) {
    const previous = world.roadFlowEMA.get(segment.id) ?? 0;
    const flow = previous + ((entering.get(segment.id) ?? 0) / dt - previous) * alpha;
    world.roadFlowEMA.set(segment.id, flow);
    const previousHeavy = world.heavyFlowEMA.get(segment.id) ?? 0;
    world.heavyFlowEMA.set(segment.id, previousHeavy + ((heavy.get(segment.id) ?? 0) / dt - previousHeavy) * alpha);
    world.segmentSpeed.set(segment.id, tuning.congestion ? speedFactor(flow, roadCapacity(world, segment.id), tuning.minSpeedFactor) : 1);
  }
}
