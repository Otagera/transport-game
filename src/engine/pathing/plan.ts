import type { TerrainField } from "../map/types";
import { cellIndex, findTerrainPath, inBounds, isWater, type GridPoint } from "./terrainAStar";
import { walkCellsAlongSegment } from "./supercover";
import { simplifyPolyline } from "./rdp";
import { clampToTraversable, smoothChain } from "./smoothing";
import { stepCost, sumStepCosts, type CostBreakdown, type StepCost } from "./cost";

export type AlignmentMode = "auto" | "straight" | "curve";

export interface CorridorPlan {
  polyline: GridPoint[];
  breakdown: CostBreakdown;
}

const RDP_EPSILON = 0.6;
const SAMPLES_PER_SEGMENT = 8;

function stepsAlongCells(terrain: TerrainField, cells: GridPoint[]): StepCost[] | null {
  const steps: StepCost[] = [];
  for (let i = 1; i < cells.length; i += 1) {
    const a = cells[i - 1]!;
    const b = cells[i]!;
    if (!inBounds(terrain, b.x, b.y) || isWater(terrain, b.x, b.y)) {
      return null;
    }
    const stepDistance = Math.hypot(b.x - a.x, b.y - a.y);
    if (stepDistance === 0) continue;
    steps.push(stepCost(terrain, cellIndex(terrain, a.x, a.y), cellIndex(terrain, b.x, b.y), stepDistance));
  }
  return steps;
}

// One waypoint-to-waypoint leg: the raw cell path plus its step costs.
// "auto" searches for the cheapest terrain-respecting route; "straight"
// and "curve" both hold the literal line the player drew -- "straight
// does not mean ignore terrain; it means hold this line and tell me what
// holding it costs" (docs/rebuild-plan.md §5). Wet waypoints are already
// rejected earlier, so any water touched here means the direct line
// isn't buildable at ground level -- returns null either way.
function planLeg(terrain: TerrainField, from: GridPoint, to: GridPoint, mode: AlignmentMode): { raw: GridPoint[]; steps: StepCost[] } | null {
  if (mode === "auto") {
    const result = findTerrainPath(terrain, from, to);
    if (!result) return null;
    return { raw: result.cells, steps: result.steps };
  }

  const raw = walkCellsAlongSegment(from.x, from.y, to.x, to.y);
  const steps = stepsAlongCells(terrain, raw);
  if (!steps) return null;
  return { raw, steps };
}

// Ties the whole authoring pipeline together: per-leg pathing -> RDP
// simplification -> whole-chain Catmull-Rom smoothing -> clamp back to
// the traversable set -> the one cost-breakdown function, now also
// counting newly-placed vertex nodes. `existingNodeIds` are waypoint
// indices that reuse an existing map node (no node cost); anything else
// is a new vertex.
export function planCorridor(
  terrain: TerrainField,
  waypoints: GridPoint[],
  mode: AlignmentMode,
  existingWaypointIndices: Set<number>,
): CorridorPlan | null {
  if (waypoints.length < 2) {
    return null;
  }

  const rawChain: GridPoint[] = [waypoints[0]!];
  const allSteps: StepCost[] = [];

  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const leg = planLeg(terrain, waypoints[i]!, waypoints[i + 1]!, mode);
    if (!leg) return null;
    rawChain.push(...leg.raw.slice(1));
    allSteps.push(...leg.steps);
  }

  const simplified = simplifyPolyline(rawChain, RDP_EPSILON);
  const smoothed = smoothChain(simplified, SAMPLES_PER_SEGMENT);
  const polyline = clampToTraversable(terrain, smoothed, simplified);

  let newNodeCount = 0;
  for (let i = 0; i < waypoints.length; i += 1) {
    if (!existingWaypointIndices.has(i)) {
      newNodeCount += 1;
    }
  }

  const breakdown = sumStepCosts(allSteps, newNodeCount);
  return { polyline, breakdown };
}
