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

// --- Ambient private traffic ---------------------------------------------
//
// Prosperity shows up as traffic. As a node's demand multiplier D grows
// (engine/growth), the private car ownership that growth implies takes
// road space away from the player's buses and lorries -- so a network that
// develops its villages successfully ends up congesting its own highways.
// That is the intended late-game hazard: road transit becomes a victim of
// its own success, and rail is the only way out (see below).
//
// Modelled as an *ambient load*, not as vehicles. No car agents exist
// anywhere in engine/: a private commuter is not a thing the simulation
// moves, it is a thing that makes the road narrower. This keeps the
// aggregate-demand rule (architecture.md hard rule 4) intact -- the same
// reason passengers are queue amounts rather than agents -- and it costs
// one number per segment per tick rather than a population of entities
// nobody can interact with.

// How fast private traffic thins out away from settled land, in cells. At
// this distance ambient load is down to 1/e.
export const AMBIENT_ATTENUATION_CELLS = 6;

export interface AmbientSegment {
  segmentId: string;
  /** Nearest inhabited node to each endpoint: where this traffic comes from. */
  sourceNodeIdA: string;
  sourceNodeIdB: string;
  /**
   * Distance from the segment's **midpoint** to the nearest inhabited
   * node -- not from its endpoints.
   *
   * This distinction is the whole mechanic. Measured at the endpoints, a
   * 24-cell settlement-to-settlement highway has both ends sitting at
   * distance zero and therefore carries full traffic along its entire
   * length, which reads as "the whole map is congested" -- a flat tax on
   * prosperity with nothing to route around. Measured at the midpoint, a
   * short approach stays busy and the open country in the middle of a long
   * intercity run stays clear, which is what makes the approaches choke
   * first and gives the congestion somewhere to be.
   */
  midpointDistanceCells: number;
}

export type AmbientGeometry = AmbientSegment[];

interface PositionedNode {
  id: string;
  kind: string;
  x: number;
  y: number;
}

interface EndpointedSegment {
  id: string;
  type: string;
  fromNodeId: string;
  toNodeId: string;
}

function nearestInhabited(
  inhabited: PositionedNode[],
  x: number,
  y: number,
): { id: string; distance: number } | null {
  let best: { id: string; distance: number } | null = null;
  for (const candidate of inhabited) {
    const distance = Math.hypot(candidate.x - x, candidate.y - y);
    if (best === null || distance < best.distance) best = { id: candidate.id, distance };
  }
  return best;
}

/**
 * Everything ambient traffic needs that depends only on map topology.
 * Computed once per map change and cached on SimulationState beside the
 * routing graph -- nothing in here can move between builds, so recomputing
 * it per tick would be pure waste.
 *
 * **Rail is excluded at this point**, not filtered out later. See
 * computeAmbientLoads.
 */
export function computeAmbientGeometry(nodes: PositionedNode[], segments: EndpointedSegment[]): AmbientGeometry {
  const inhabited = nodes.filter((node) => node.kind === "settlement" || node.kind === "village");
  if (inhabited.length === 0) return [];

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const geometry: AmbientGeometry = [];

  for (const segment of segments) {
    if (segment.type === "rail") continue;
    const from = byId.get(segment.fromNodeId);
    const to = byId.get(segment.toNodeId);
    if (!from || !to) continue;

    const sourceA = nearestInhabited(inhabited, from.x, from.y);
    const sourceB = nearestInhabited(inhabited, to.x, to.y);
    const midpoint = nearestInhabited(inhabited, (from.x + to.x) / 2, (from.y + to.y) / 2);
    if (!sourceA || !sourceB || !midpoint) continue;

    geometry.push({
      segmentId: segment.id,
      sourceNodeIdA: sourceA.id,
      sourceNodeIdB: sourceB.id,
      midpointDistanceCells: midpoint.distance,
    });
  }
  return geometry;
}

export function ambientAttenuation(distanceCells: number): number {
  return Math.exp(-Math.max(0, distanceCells) / AMBIENT_ATTENUATION_CELLS);
}

/**
 * One segment's ambient load, in the same congestion-weight units
 * vehicles use. `eraFactor` is the era's private car factor; the two D
 * values are the demand multipliers of the inhabited nodes this segment's
 * traffic comes from.
 */
export function ambientSegmentLoad(
  eraFactor: number,
  demandMultiplierA: number,
  demandMultiplierB: number,
  midpointDistanceCells: number,
): number {
  const averageD = (demandMultiplierA + demandMultiplierB) / 2;
  return Math.max(0, eraFactor) * averageD * ambientAttenuation(midpointDistanceCells);
}

/**
 * Ambient load per segment.
 *
 * **Rail is completely immune** -- it is absent from the geometry
 * entirely rather than scaled down. That is the strategic point of the
 * mechanic: private cars are what make late-game road transit unreliable,
 * so grade-separated rail has to be the one thing they cannot touch, or
 * there is no answer to the hazard and it becomes a flat tax instead of a
 * decision. It also happens to be true -- a car cannot drive on a railway.
 */
export function computeAmbientLoads(
  geometry: AmbientGeometry,
  demandMultiplierByNode: ReadonlyMap<string, number>,
  eraFactor: number,
): Map<string, number> {
  const loads = new Map<string, number>();
  if (eraFactor <= 0) return loads;

  for (const entry of geometry) {
    const load = ambientSegmentLoad(
      eraFactor,
      demandMultiplierByNode.get(entry.sourceNodeIdA) ?? 1,
      demandMultiplierByNode.get(entry.sourceNodeIdB) ?? 1,
      entry.midpointDistanceCells,
    );
    if (load > 0) loads.set(entry.segmentId, load);
  }
  return loads;
}

/**
 * Total road occupancy: the player's and the informal sector's vehicles
 * plus everybody else's cars. Merged into one map so that everything
 * downstream -- vehicle speed, the paratransit operator's "is this jam
 * worth joining" check, and the Corridor stress overlay -- reads the same
 * number. A display that recomputed its own idea of load would be exactly
 * the drift docs/rebuild-plan.md §5 warns about at the display boundary.
 */
export function addLoads(base: Map<string, number>, extra: ReadonlyMap<string, number>): Map<string, number> {
  const total = new Map(base);
  for (const [segmentId, load] of extra) {
    total.set(segmentId, (total.get(segmentId) ?? 0) + load);
  }
  return total;
}
