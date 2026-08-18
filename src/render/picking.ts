import type { GeneratedMap } from "../engine/map/types";
import type { Vehicle } from "../engine/simulation/types";
import type { Selection } from "../ui/selection";

// Picking is done in grid space, not by raycasting three.js objects. Two
// reasons, both learned the expensive way in this codebase: line
// primitives are extremely hard to hit with a ray (Module 5's bridge-deck
// bug lived at exactly this boundary), and grid-space picking is plain
// arithmetic, so it is unit-testable without a WebGL context at all. The
// pointer -> grid conversion itself is already a single shared function
// (render/gridCoords.ts) that the terrain texture, node placement and
// authoring all go through, so picking automatically agrees with what the
// player sees.
//
// Preference order is most-specific-first: a vehicle sits on a segment
// which belongs to a corridor, so clicking where all three overlap must
// resolve to the vehicle. A corridor is never picked directly -- it is
// reached from the segment Inspector, since two corridors sharing an
// alignment would be indistinguishable to a click.
export const VEHICLE_PICK_RADIUS = 0.9;
export const NODE_PICK_RADIUS = 1.2;
export const SEGMENT_PICK_RADIUS = 0.7;

export interface GridPoint {
  x: number;
  y: number;
}

/**
 * Where a vehicle currently is, in grid coordinates, interpolated along
 * the edge it is traversing. Shared with the fleet renderer so the marker
 * you see and the thing you click are derived from one formula.
 */
export function vehicleGridPosition(vehicle: Vehicle, map: GeneratedMap): GridPoint | null {
  const pathLength = vehicle.path.length;
  if (pathLength < 2 || vehicle.pathIndex >= pathLength) return null;

  const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
  const fromIndex = (vehicle.pathIndex - 1 + pathLength) % pathLength;
  const from = nodeById.get(vehicle.path[fromIndex]!);
  const to = nodeById.get(vehicle.path[vehicle.pathIndex]!);
  if (!from || !to) return null;

  const t = vehicle.edgeProgress;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Perpendicular distance from a point to the finite segment a->b. */
export function distanceToSegment(point: GridPoint, a: GridPoint, b: GridPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

interface Candidate {
  selection: Selection;
  distance: number;
}

function nearest(candidates: Candidate[], radius: number): Selection | null {
  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (candidate.distance > radius) continue;
    if (best === null || candidate.distance < best.distance) best = candidate;
  }
  return best === null ? null : best.selection;
}

export function pickAt(point: GridPoint, map: GeneratedMap, vehicles: Vehicle[]): Selection | null {
  const vehicleCandidates: Candidate[] = [];
  for (const vehicle of vehicles) {
    const position = vehicleGridPosition(vehicle, map);
    if (!position) continue;
    vehicleCandidates.push({
      selection: { kind: "vehicle", id: vehicle.id },
      distance: Math.hypot(point.x - position.x, point.y - position.y),
    });
  }
  const vehicleHit = nearest(vehicleCandidates, VEHICLE_PICK_RADIUS);
  if (vehicleHit) return vehicleHit;

  const nodeHit = nearest(
    map.nodes.map((node) => ({
      selection: { kind: "node" as const, id: node.id },
      distance: Math.hypot(point.x - node.x, point.y - node.y),
    })),
    NODE_PICK_RADIUS,
  );
  if (nodeHit) return nodeHit;

  const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
  const segmentCandidates: Candidate[] = [];
  for (const segment of map.segments) {
    const from = nodeById.get(segment.fromNodeId);
    const to = nodeById.get(segment.toNodeId);
    if (!from || !to) continue;
    segmentCandidates.push({
      selection: { kind: "segment", id: segment.id },
      distance: distanceToSegment(point, from, to),
    });
  }
  return nearest(segmentCandidates, SEGMENT_PICK_RADIUS);
}

/**
 * Where a selection is, in grid coordinates -- what the camera flies to.
 * A segment resolves to its midpoint and a corridor to the midpoint of
 * its chain, since neither is a point and framing one end of a long
 * viaduct would be worse than framing neither.
 */
export function selectionGridPosition(
  selection: Selection,
  map: GeneratedMap,
  vehicles: Vehicle[],
): GridPoint | null {
  const nodeById = new Map(map.nodes.map((node) => [node.id, node]));

  switch (selection.kind) {
    case "vehicle": {
      const vehicle = vehicles.find((candidate) => candidate.id === selection.id);
      return vehicle ? vehicleGridPosition(vehicle, map) : null;
    }
    case "node": {
      const node = nodeById.get(selection.id);
      return node ? { x: node.x, y: node.y } : null;
    }
    case "segment": {
      const segment = map.segments.find((candidate) => candidate.id === selection.id);
      if (!segment) return null;
      const from = nodeById.get(segment.fromNodeId);
      const to = nodeById.get(segment.toNodeId);
      if (!from || !to) return null;
      return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    }
    case "corridor": {
      const corridor = map.corridors.find((candidate) => candidate.id === selection.id);
      if (!corridor) return null;
      const points = corridor.nodeIds.map((id) => nodeById.get(id)).filter((node) => node !== undefined);
      if (points.length === 0) return null;
      const sum = points.reduce((total, node) => ({ x: total.x + node.x, y: total.y + node.y }), { x: 0, y: 0 });
      return { x: sum.x / points.length, y: sum.y / points.length };
    }
  }
}
