import type { Corridor, GeneratedMap, Segment } from "../engine/map/types";

export interface GridPoint {
  x: number;
  y: number;
}

// A corridor stores one smoothed polyline for its whole chain (that is the
// point -- pathing/smoothing.ts smooths the entire chain at once so joins
// don't kink), but rendering, health and utilisation are all per *segment*.
// This splits the one back into the other.
//
// Until now render/network.ts ignored the polyline entirely and drew each
// segment as a straight line between its two nodes, so none of the
// smoothing that Module 4 paid for was ever visible. Sweeping a profile
// makes that gap impossible to ignore: a cross-section swept along a
// straight line through a curve fans out at the corner.
//
// Chain points are guaranteed to be present in the polyline by
// construction (pathing/plan.ts pushes each forced index into it), so
// matching by nearest point is exact rather than approximate -- but it
// still falls back to the straight two-node line if a polyline is missing,
// degenerate, or out of order, because a corridor that fails to split must
// still render.
function nearestIndex(polyline: GridPoint[], point: GridPoint, from: number): number {
  let best = from;
  let bestDistance = Infinity;
  for (let i = from; i < polyline.length; i += 1) {
    const candidate = polyline[i]!;
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

export function splitPolylineByNodes(polyline: GridPoint[], nodePoints: GridPoint[]): GridPoint[][] {
  const pairCount = Math.max(0, nodePoints.length - 1);
  const straight = (i: number): GridPoint[] => [nodePoints[i]!, nodePoints[i + 1]!];
  if (pairCount === 0) return [];
  if (polyline.length < 2) return Array.from({ length: pairCount }, (_, i) => straight(i));

  const indices: number[] = [0];
  let cursor = 0;
  for (let i = 1; i < nodePoints.length; i += 1) {
    // Searching forward from the previous match keeps the indices
    // monotonic by construction: a corridor that doubles back near itself
    // would otherwise match a later node to an earlier polyline point and
    // produce a reversed, self-crossing run.
    cursor = nearestIndex(polyline, nodePoints[i]!, cursor);
    indices.push(cursor);
  }

  const runs: GridPoint[][] = [];
  for (let i = 0; i < pairCount; i += 1) {
    const start = indices[i]!;
    const end = indices[i + 1]!;
    const run = end > start ? polyline.slice(start, end + 1) : [];
    runs.push(run.length >= 2 ? run : straight(i));
  }
  return runs;
}

/**
 * The centreline for each segment of a corridor, in grid coordinates and
 * in the corridor's own chain order. Keyed by segment id so the caller
 * never has to assume segments are stored in chain order.
 */
export function segmentCenterlines(map: GeneratedMap, corridor: Corridor): Map<string, GridPoint[]> {
  const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
  const nodePoints = corridor.nodeIds
    .map((id) => nodeById.get(id))
    .filter((node): node is NonNullable<typeof node> => node !== undefined)
    .map((node) => ({ x: node.x, y: node.y }));

  const runs = splitPolylineByNodes(corridor.polyline, nodePoints);
  const byPair = new Map<string, GridPoint[]>();
  for (let i = 0; i < corridor.nodeIds.length - 1; i += 1) {
    byPair.set(pairKey(corridor.nodeIds[i]!, corridor.nodeIds[i + 1]!), runs[i] ?? []);
  }

  const result = new Map<string, GridPoint[]>();
  for (const segment of map.segments) {
    if (segment.corridorId !== corridor.id) continue;
    const run = byPair.get(pairKey(segment.fromNodeId, segment.toNodeId));
    if (run && run.length >= 2) result.set(segment.id, run);
  }
  return result;
}

function pairKey(a: string, b: string): string {
  // Order-independent: a segment records from/to in chain order, but this
  // guards against a caller that ever stores them the other way round.
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Straight fallback for a segment whose corridor could not be split. */
export function straightCenterline(map: GeneratedMap, segment: Segment): GridPoint[] | null {
  const from = map.nodes.find((node) => node.id === segment.fromNodeId);
  const to = map.nodes.find((node) => node.id === segment.toNodeId);
  if (!from || !to) return null;
  return [
    { x: from.x, y: from.y },
    { x: to.x, y: to.y },
  ];
}
