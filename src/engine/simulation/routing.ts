import type { GeneratedMap } from "../map/types";
import type { PathResult, RoutingContext, RoutingGraph } from "./types";

export function buildRoutingContext(map: GeneratedMap): RoutingContext {
  const graph: RoutingGraph = new Map();
  const positions = new Map(map.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));

  for (const node of map.nodes) {
    graph.set(node.id, []);
  }

  for (const corridor of map.corridors) {
    const [a, b] = corridor.nodeIds;
    const posA = positions.get(a);
    const posB = positions.get(b);
    if (!posA || !posB) continue;
    const weight = Math.hypot(posA.x - posB.x, posA.y - posB.y);
    graph.get(a)!.push({ to: b, corridorId: corridor.id, weight });
    graph.get(b)!.push({ to: a, corridorId: corridor.id, weight });
  }

  return { graph, positions };
}

function heuristic(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// A* over the built-infrastructure graph -- not terrain. The terrain-aware,
// authoring-time cost function ("the A* cost function IS the build price")
// is Module 4's. This is runtime pathfinding for demand/vehicles over
// whatever's already built. Edge weight is straight-line corridor length,
// which is also an admissible heuristic here.
export function findPath(context: RoutingContext, fromId: string, toId: string): PathResult | null {
  if (fromId === toId) {
    return { nodeIds: [fromId], corridorIds: [], distance: 0 };
  }
  if (!context.graph.has(fromId) || !context.graph.has(toId)) {
    return null;
  }

  const goal = context.positions.get(toId);
  if (!goal) {
    return null;
  }

  const open = new Set<string>([fromId]);
  const cameFrom = new Map<string, { node: string; corridorId: string }>();
  const gScore = new Map<string, number>([[fromId, 0]]);
  const fScore = new Map<string, number>([[fromId, heuristic(context.positions.get(fromId)!, goal)]]);

  while (open.size > 0) {
    let current: string | null = null;
    let currentF = Infinity;
    for (const candidate of open) {
      const f = fScore.get(candidate) ?? Infinity;
      if (f < currentF) {
        currentF = f;
        current = candidate;
      }
    }
    if (current === null) {
      break;
    }

    if (current === toId) {
      const nodeIds: string[] = [current];
      const corridorIds: string[] = [];
      let cursor = current;
      while (cameFrom.has(cursor)) {
        const step = cameFrom.get(cursor)!;
        nodeIds.unshift(step.node);
        corridorIds.unshift(step.corridorId);
        cursor = step.node;
      }
      return { nodeIds, corridorIds, distance: gScore.get(toId) ?? Infinity };
    }

    open.delete(current);
    const currentG = gScore.get(current) ?? Infinity;

    for (const edge of context.graph.get(current) ?? []) {
      const tentativeG = currentG + edge.weight;
      if (tentativeG < (gScore.get(edge.to) ?? Infinity)) {
        cameFrom.set(edge.to, { node: current, corridorId: edge.corridorId });
        gScore.set(edge.to, tentativeG);
        const point = context.positions.get(edge.to);
        fScore.set(edge.to, tentativeG + (point ? heuristic(point, goal) : 0));
        open.add(edge.to);
      }
    }
  }

  return null;
}
