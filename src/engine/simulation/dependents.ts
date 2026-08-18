import type { RoutingContext, Vehicle } from "./types";

// Pruning a corridor out from under a running vehicle would leave it on a
// path whose edges no longer exist -- a silently wrong state rather than a
// crash, which is the exact failure class docs/rebuild-plan.md §5 warns
// about at the display boundary. So the Inspector asks this first and
// refuses the prune while anything still depends on it, naming the
// blockers, rather than silently liquidating a fleet the player didn't
// ask to sell. Funds never enter into it: a prune is a recovery lever and
// must stay available in debt.
//
// A vehicle's whole path is checked, not just the edge it currently
// occupies: a cyclic vehicle will come back around to every edge in its
// loop.
export function vehiclesUsingSegments(
  vehicles: Vehicle[],
  routing: RoutingContext,
  segmentIds: ReadonlySet<string>,
): string[] {
  if (segmentIds.size === 0) return [];

  const blocked: string[] = [];
  for (const vehicle of vehicles) {
    if (usesAnySegment(vehicle, routing, segmentIds)) {
      blocked.push(vehicle.id);
    }
  }
  return blocked;
}

function usesAnySegment(vehicle: Vehicle, routing: RoutingContext, segmentIds: ReadonlySet<string>): boolean {
  const pathLength = vehicle.path.length;
  if (pathLength < 2) return false;

  // A cyclic vehicle's last-to-first edge is a real edge it traverses; a
  // one-shot vehicle's path is not a closed loop, so it has one fewer.
  const edgeCount = vehicle.lifecycle === "cyclic" ? pathLength : pathLength - 1;
  for (let i = 0; i < edgeCount; i += 1) {
    const from = vehicle.path[i]!;
    const to = vehicle.path[(i + 1) % pathLength]!;
    const edge = routing.graph.get(from)?.find((candidate) => candidate.to === to);
    if (edge && segmentIds.has(edge.segmentId)) return true;
  }
  return false;
}
