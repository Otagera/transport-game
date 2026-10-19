import { computeSegmentLoads } from "../simulation/congestion";
import type { Segment } from "../map/types";
import type { Vehicle } from "../simulation/types";
import type { SliceWorld } from "./types";
import { lineSpeed } from "./wear";
import { laneEncroachment, struckSegments } from "./pushback";

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
 * Every road is dirt until paved (world.ts paveRoad), inherited or built:
 * since step 5 (brief, 2026-10-17) a road you build is born dirt, and
 * paving is the dear upgrade. A town splitting a road copies its surface
 * to both halves. Provenance still says whose road it is (routine upkeep
 * is yours on roads you built). Track has no surface; inherited track
 * counts as dirt here, as it always has, for its road capacity.
 */
export function isDirt(segment: Segment): boolean {
  return (segment.surface ?? (segment.provenance === "inherited" ? "dirt" : "paved")) === "dirt";
}

/**
 * General traffic's capacity: a bus lane (Revision 1) takes a share of the
 * road for your vehicles, less what danfos have taken back by encroaching.
 */
export function roadCapacity(world: SliceWorld, segmentId: string, encroachment?: number): number {
  const segment = world.simulation.map.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) return Infinity;
  const taken = segment.busLane ? (encroachment ?? laneEncroachment(world).get(segmentId) ?? 0) : 0;
  const lane = segment.busLane ? world.tuning.laneGeneralCapacity + (1 - world.tuning.laneGeneralCapacity) * taken : 1;
  return world.tuning.roadFlowCapacity * (isDirt(segment) ? world.tuning.dirtRoadCapacity : 1) * lane;
}

/**
 * The speeds your road vehicles see: general traffic's, except on a bus
 * lane, where only your own vehicles are in their way -- the lane's own
 * capacity (busLaneCapacity): past it, buses bunch and slow, as a real lane
 * does. The same map when there's no lane.
 */
export function yourSpeeds(world: SliceWorld): Map<string, number> {
  if (world.laneSpeed.size === 0) return world.segmentSpeed;
  const speeds = new Map(world.segmentSpeed);
  for (const [segmentId, speed] of world.laneSpeed) speeds.set(segmentId, speed);
  return speeds;
}

export function speedFactor(flow: number, capacity: number, floor: number): number {
  const utilisation = flow / capacity;
  return Math.max(floor, 1 / (1 + BPR_ALPHA * utilisation ** BPR_BETA));
}

function currentSegment(world: SliceWorld, vehicle: Vehicle): string | null {
  if (world.railVehicles.has(vehicle.id)) return null; // trains are never road traffic
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
  // Your vehicles on a bus lane are out of general traffic's way -- except
  // on a strike day, when the strikers block the lane and your buses are
  // back in the traffic (pushback.ts).
  const struck = struckSegments(world);
  const laned = new Set(simulation.map.segments.filter((segment) => segment.busLane && !struck.has(segment.id)).map((segment) => segment.id));
  const laneEntering = new Map<string, number>();
  for (const vehicle of simulation.vehicles) {
    const segmentId = currentSegment(world, vehicle);
    if (!segmentId) continue;
    const leg = `${segmentId}#${vehicle.pathIndex}`;
    nowOn.set(vehicle.id, leg);
    if (laned.has(segmentId) && vehicle.lifecycle !== "one-shot") {
      if (world.vehicleSegment.get(vehicle.id) !== leg) laneEntering.set(segmentId, (laneEntering.get(segmentId) ?? 0) + vehicle.congestionWeight);
      continue;
    }
    if (world.vehicleSegment.get(vehicle.id) !== leg) {
      entering.set(segmentId, (entering.get(segmentId) ?? 0) + vehicle.congestionWeight);
      // Lorries counted apart too: they wear a road harder (wear.ts).
      if (vehicle.carries === "goods") heavy.set(segmentId, (heavy.get(segmentId) ?? 0) + vehicle.congestionWeight);
    }
  }
  // Trains, on their own network: one entry per train onto a stretch of
  // track, for track wear (wear.ts) -- never road flow.
  const trainsEntering = new Map<string, number>();
  for (const vehicle of simulation.vehicles) {
    if (!world.railVehicles.has(vehicle.id)) continue;
    const length = vehicle.path.length;
    if (length < 2 || vehicle.pathIndex >= length) continue;
    const from = vehicle.path[(vehicle.pathIndex - 1 + length) % length]!;
    const to = vehicle.path[vehicle.pathIndex]!;
    const segmentId = world.railRouting.graph.get(from)?.find((candidate) => candidate.to === to)?.segmentId;
    if (!segmentId) continue;
    const leg = `${segmentId}#${vehicle.pathIndex}`;
    nowOn.set(vehicle.id, leg);
    // A freight train wears track as a lorry wears a road: harder.
    const weight = vehicle.carries === "goods" ? tuning.lorryWearMultiplier : 1;
    if (world.vehicleSegment.get(vehicle.id) !== leg) trainsEntering.set(segmentId, (trainsEntering.get(segmentId) ?? 0) + weight);
  }
  world.vehicleSegment = nowOn;

  const alpha = 1 - Math.exp(-dt / FLOW_TAU_SECONDS);
  world.segmentLoad = computeSegmentLoads(
    simulation.vehicles.filter((vehicle) => !world.railVehicles.has(vehicle.id)),
    simulation.routing,
  );
  world.segmentSpeed = new Map();
  const encroached = laneEncroachment(world);
  for (const segment of simulation.map.segments) {
    if (segment.type === "rail") {
      // Track has no traffic but its own trains; worn track runs under a slow order (wear.ts).
      world.segmentSpeed.set(segment.id, lineSpeed(world, segment));
      const previousTrains = world.railFlowEMA.get(segment.id) ?? 0;
      world.railFlowEMA.set(segment.id, previousTrains + ((trainsEntering.get(segment.id) ?? 0) / dt - previousTrains) * alpha);
      continue;
    }
    const previous = world.roadFlowEMA.get(segment.id) ?? 0;
    const flow = previous + ((entering.get(segment.id) ?? 0) / dt - previous) * alpha;
    world.roadFlowEMA.set(segment.id, flow);
    const previousHeavy = world.heavyFlowEMA.get(segment.id) ?? 0;
    world.heavyFlowEMA.set(segment.id, previousHeavy + ((heavy.get(segment.id) ?? 0) / dt - previousHeavy) * alpha);
    world.segmentSpeed.set(segment.id, tuning.congestion ? speedFactor(flow, roadCapacity(world, segment.id, encroached.get(segment.id)), tuning.minSpeedFactor) : 1);
  }
  // Your buses' speed in each lane: the lane's own capacity against their
  // flow -- and, as danfos encroach, worn toward general traffic's speed:
  // fully taken, the lane is no faster than the road.
  world.laneSpeed = new Map();
  for (const segmentId of laned) {
    const previousLane = world.laneFlowEMA.get(segmentId) ?? 0;
    const laneFlow = previousLane + ((laneEntering.get(segmentId) ?? 0) / dt - previousLane) * alpha;
    world.laneFlowEMA.set(segmentId, laneFlow);
    const own = tuning.congestion ? speedFactor(laneFlow, tuning.busLaneCapacity, tuning.minSpeedFactor) : 1;
    const taken = encroached.get(segmentId) ?? 0;
    world.laneSpeed.set(segmentId, own * (1 - taken) + Math.min(own, world.segmentSpeed.get(segmentId) ?? 1) * taken);
  }
}
