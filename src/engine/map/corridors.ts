import type { Corridor, MapNode, Segment } from "./types";

function distance(a: MapNode, b: MapNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// The inherited network only (docs/architecture/engine.md §map/) -- the
// player authors corridors from Module 4 onward. This is a straight-line
// Prim's MST over Euclidean distance, deliberately not terrain-aware
// pathing: that A*-over-terrain machinery is Module 4's job, not this
// module's. Every settlement-to-settlement link is tagged rail (the
// colonial spine); anything touching a village is a road -- so the rail
// network, by construction, does not reach every village. That's the
// brownfield premise, not a bug. Each MST edge is one corridor with
// exactly one segment (the generator never produces multi-node chains).
export function generateInheritedNetwork(nodes: MapNode[]): {
  corridors: Corridor[];
  segments: Segment[];
} {
  const corridors: Corridor[] = [];
  const segments: Segment[] = [];

  if (nodes.length < 2) {
    return { corridors, segments };
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const connected = new Set<string>([nodes[0]!.id]);
  const remaining = new Set<string>(nodes.slice(1).map((node) => node.id));
  let nextCorridorId = 0;

  while (remaining.size > 0) {
    let bestFrom: MapNode | null = null;
    let bestTo: MapNode | null = null;
    let bestDistance = Infinity;

    for (const fromId of connected) {
      const from = byId.get(fromId)!;
      for (const toId of remaining) {
        const to = byId.get(toId)!;
        const d = distance(from, to);
        if (d < bestDistance) {
          bestDistance = d;
          bestFrom = from;
          bestTo = to;
        }
      }
    }

    if (!bestFrom || !bestTo) {
      break;
    }

    const corridorId = `corridor-${nextCorridorId}`;
    nextCorridorId += 1;
    corridors.push({
      id: corridorId,
      nodeIds: [bestFrom.id, bestTo.id],
      polyline: [
        { x: bestFrom.x, y: bestFrom.y },
        { x: bestTo.x, y: bestTo.y },
      ],
    });

    const isRail = bestFrom.kind === "settlement" && bestTo.kind === "settlement";
    segments.push({
      id: `segment-${corridorId}`,
      corridorId,
      fromNodeId: bestFrom.id,
      toNodeId: bestTo.id,
      type: isRail ? "rail" : "road",
      level: "ground",
      condition: isRail ? 0.6 : 0.75,
      provenance: "inherited",
    });

    connected.add(bestTo.id);
    remaining.delete(bestTo.id);
  }

  return { corridors, segments };
}
