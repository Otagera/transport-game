import type { GeneratedMap, MapNode } from "./types";

// "Per-route P&L with worst-first sorting is what makes the economy
// diagnosable. Three playthroughs ended in undiagnosable debt without it"
// (docs/principles.md §3). Diagnosing a bleeding corridor is only half
// of that -- the other half is being able to act on the diagnosis, which
// means removing infrastructure, not only vehicles.
//
// Pruning is the inverse of commitCorridor and is pure the same way:
// returns a new GeneratedMap, never mutates the input, so it composes
// with the authoring controller's snapshot undo for free.

export interface CorridorPrunePlan {
  corridorId: string;
  segmentIds: string[];
  /**
   * Nodes that exist only because this corridor did. A settlement or
   * village is never removed -- it is a place, not a piece of built
   * infrastructure, and it keeps originating demand whether or not
   * anything currently reaches it (that's what makes "stranded" a real
   * state rather than an impossible one). Junctions and vertices are
   * pure geometry and go with the corridor that created them, but only
   * once nothing else still connects to them.
   */
  nodeIds: string[];
}

const REMOVABLE_KINDS: ReadonlySet<MapNode["kind"]> = new Set(["vertex", "junction"]);

export function planCorridorPrune(map: GeneratedMap, corridorId: string): CorridorPrunePlan | null {
  const corridor = map.corridors.find((candidate) => candidate.id === corridorId);
  if (!corridor) return null;

  const segmentIds = map.segments.filter((segment) => segment.corridorId === corridorId).map((segment) => segment.id);
  const doomed = new Set(segmentIds);

  const survivingDegree = new Map<string, number>();
  for (const segment of map.segments) {
    if (doomed.has(segment.id)) continue;
    survivingDegree.set(segment.fromNodeId, (survivingDegree.get(segment.fromNodeId) ?? 0) + 1);
    survivingDegree.set(segment.toNodeId, (survivingDegree.get(segment.toNodeId) ?? 0) + 1);
  }

  const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
  const nodeIds: string[] = [];
  for (const nodeId of new Set(corridor.nodeIds)) {
    const node = nodeById.get(nodeId);
    if (!node || !REMOVABLE_KINDS.has(node.kind)) continue;
    if ((survivingDegree.get(nodeId) ?? 0) > 0) continue;
    nodeIds.push(nodeId);
  }

  return { corridorId, segmentIds, nodeIds };
}

export function pruneCorridor(map: GeneratedMap, corridorId: string): GeneratedMap {
  const plan = planCorridorPrune(map, corridorId);
  if (!plan) return map;

  const removedSegments = new Set(plan.segmentIds);
  const removedNodes = new Set(plan.nodeIds);

  return {
    ...map,
    nodes: map.nodes.filter((node) => !removedNodes.has(node.id)),
    corridors: map.corridors.filter((corridor) => corridor.id !== corridorId),
    segments: map.segments.filter((segment) => !removedSegments.has(segment.id)),
  };
}
