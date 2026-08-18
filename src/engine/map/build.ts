import type { Corridor, GeneratedMap, InfrastructureType, MapNode, Segment } from "./types";
import type { CorridorPlan } from "../pathing/plan";
import type { GridPoint } from "../pathing/terrainAStar";

export interface WaypointSpec {
  point: GridPoint;
  existingNodeId?: string;
}

// "authored-" prefixes deliberately never collide with the generator's
// "node-N" / "corridor-N" / "segment-corridor-N" scheme (engine/map/nodes.ts,
// corridors.ts). A collision here is silent and severe: node lookups are
// keyed by id in a Map, so a new vertex reusing an existing id overwrites
// that entry -- every old segment referencing the original node then
// renders at the new vertex's position instead. Caught live: an authored
// 2-waypoint corridor rendered as several lines fanning out to unrelated
// distant nodes, because "node-1" from a fresh counter collided with an
// actual settlement's id.
let nextIdCounter = 0;
function generateId(prefix: string): string {
  nextIdCounter += 1;
  return `authored-${prefix}-${nextIdCounter}`;
}

// Pure: returns a new GeneratedMap with the built corridor appended, never
// mutating the input -- so the caller's undo is just "go back to holding
// the previous reference." One node per chain point (existing nodes
// reused via `existingNodeId`, new ones -- including auto-inserted
// bridge banks -- get the `vertex` kind, never named,
// docs/rebuild-plan.md §5); one segment per consecutive pair in that
// chain, independently typed and levelled per plan.segmentLevels.
// `plan.chainPoints` is longer than `waypoints` whenever the route
// crossed water: `waypoints` supplies existingNodeId for the player's
// own points (in order, isBridgeBank === false), bridge banks are
// always new.
export function commitCorridor(
  map: GeneratedMap,
  waypoints: WaypointSpec[],
  plan: CorridorPlan,
  infrastructureType: InfrastructureType,
  profileId?: string,
): GeneratedMap {
  const newNodes: MapNode[] = [];
  const nodeIds: string[] = [];
  let waypointCursor = 0;

  for (const chainPoint of plan.chainPoints) {
    if (!chainPoint.isBridgeBank) {
      const waypoint = waypoints[waypointCursor]!;
      waypointCursor += 1;
      if (waypoint.existingNodeId) {
        nodeIds.push(waypoint.existingNodeId);
        continue;
      }
    }
    const id = generateId("node");
    newNodes.push({ id, kind: "vertex", x: chainPoint.point.x, y: chainPoint.point.y });
    nodeIds.push(id);
  }

  const corridorId = generateId("corridor");
  const corridor: Corridor = { id: corridorId, nodeIds, polyline: plan.polyline };

  const newSegments: Segment[] = [];
  for (let i = 0; i < nodeIds.length - 1; i += 1) {
    newSegments.push({
      id: generateId("segment"),
      corridorId,
      fromNodeId: nodeIds[i]!,
      toNodeId: nodeIds[i + 1]!,
      type: infrastructureType,
      level: plan.segmentLevels[i]!,
      condition: 1,
      provenance: "built",
      profileId,
    });
  }

  return {
    ...map,
    nodes: [...map.nodes, ...newNodes],
    corridors: [...map.corridors, corridor],
    segments: [...map.segments, ...newSegments],
  };
}
