import type { SegmentLevel, TerrainField } from "../map/types";
import { cellIndex, findTerrainPath, isWater, type GridPoint } from "./terrainAStar";
import { walkCellsAlongSegment } from "./supercover";
import { simplifyPolyline } from "./rdp";
import { clampToTraversable, smoothChain } from "./smoothing";
import { MAX_BRIDGE_SPAN, bridgeStepCost, stepCost, sumStepCosts, type CostBreakdown, type StepCost } from "./cost";

export type AlignmentMode = "auto" | "straight" | "curve";

// A forced chain node: either one of the player's own waypoints, or a
// bank point the water rule inserted automatically. "The generator never
// places vertices; only the player and the water rule do"
// (docs/rebuild-plan.md §5) -- this is that water rule, for bridges.
export interface ChainPoint {
  point: GridPoint;
  isBridgeBank: boolean;
}

export interface CorridorPlan {
  chainPoints: ChainPoint[];
  segmentLevels: SegmentLevel[];
  polyline: GridPoint[];
  breakdown: CostBreakdown;
}

const RDP_EPSILON = 0.6;
const SAMPLES_PER_SEGMENT = 8;
const JUMP_THRESHOLD = Math.SQRT2 + 1e-6;

function isJump(a: GridPoint, b: GridPoint): boolean {
  return Math.hypot(b.x - a.x, b.y - a.y) > JUMP_THRESHOLD;
}

// Collapses a supercover cell walk into a water-free point list: any
// contiguous water run becomes a single direct jump from the last dry
// cell to the next one, exactly like a terrain-A* bridge edge, so "hold
// this line" (straight/curve modes) prices a water crossing the same way
// "auto" mode's search does. Returns null if the crossing exceeds the
// span cap or never reaches dry land.
function collapseWaterRuns(terrain: TerrainField, cells: GridPoint[]): GridPoint[] | null {
  const collapsed: GridPoint[] = [cells[0]!];
  let i = 1;
  while (i < cells.length) {
    const cell = cells[i]!;
    if (isWater(terrain, cell.x, cell.y)) {
      let j = i;
      while (j < cells.length && isWater(terrain, cells[j]!.x, cells[j]!.y)) {
        j += 1;
      }
      if (j >= cells.length) return null;
      const bankIn = collapsed[collapsed.length - 1]!;
      const bankOut = cells[j]!;
      const span = Math.round(Math.hypot(bankOut.x - bankIn.x, bankOut.y - bankIn.y));
      if (span < 1 || span > MAX_BRIDGE_SPAN) return null;
      collapsed.push(bankOut);
      i = j + 1;
      continue;
    }
    const last = collapsed[collapsed.length - 1]!;
    if (cell.x !== last.x || cell.y !== last.y) {
      collapsed.push(cell);
    }
    i += 1;
  }
  return collapsed;
}

// One waypoint-to-waypoint leg's raw, water-free (jumps-for-bridges) cell
// path. "auto" searches for the cheapest terrain-respecting route
// (bridges included, per terrainAStar.ts); "straight" and "curve" both
// hold the literal line the player drew -- "straight does not mean
// ignore terrain; it means hold this line and tell me what holding it
// costs" (docs/rebuild-plan.md §5).
function planLeg(terrain: TerrainField, from: GridPoint, to: GridPoint, mode: AlignmentMode): GridPoint[] | null {
  if (mode === "auto") {
    const result = findTerrainPath(terrain, from, to);
    return result ? result.cells : null;
  }
  const cells = walkCellsAlongSegment(from.x, from.y, to.x, to.y);
  return collapseWaterRuns(terrain, cells);
}

// The one place a raw point sequence turns into cost -- used for every
// alignment mode, so a transition never gets priced two different ways
// (docs/rebuild-plan.md §5: "the A* cost function IS the build price").
function costForRawChain(terrain: TerrainField, points: GridPoint[]): StepCost[] {
  const steps: StepCost[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (isJump(a, b)) {
      steps.push(bridgeStepCost(Math.round(Math.hypot(b.x - a.x, b.y - a.y))));
    } else {
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (distance === 0) continue;
      steps.push(stepCost(terrain, cellIndex(terrain, a.x, a.y), cellIndex(terrain, b.x, b.y), distance));
    }
  }
  return steps;
}

// Ties the whole authoring pipeline together: per-leg pathing -> split
// into ground "runs" and bridge "jumps" -> RDP + whole-run Catmull-Rom
// smoothing per ground run (bridge decks stay straight, bank-to-bank,
// never smoothed) -> the one cost-breakdown function.
export function planCorridor(
  terrain: TerrainField,
  waypoints: GridPoint[],
  mode: AlignmentMode,
  existingWaypointIndices: Set<number>,
  buildCostMultiplier: number = 1,
): CorridorPlan | null {
  if (waypoints.length < 2) {
    return null;
  }

  const rawChain: GridPoint[] = [waypoints[0]!];
  const waypointChainIndices: number[] = [0];

  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const leg = planLeg(terrain, waypoints[i]!, waypoints[i + 1]!, mode);
    if (!leg) return null;
    rawChain.push(...leg.slice(1));
    waypointChainIndices.push(rawChain.length - 1);
  }

  const bridgeChainIndices = new Set<number>();
  for (let i = 1; i < rawChain.length; i += 1) {
    if (isJump(rawChain[i - 1]!, rawChain[i]!)) {
      bridgeChainIndices.add(i - 1);
      bridgeChainIndices.add(i);
    }
  }

  const waypointIndexSet = new Set(waypointChainIndices);
  const forcedIndices = [...new Set([...waypointChainIndices, ...bridgeChainIndices])].sort((a, b) => a - b);

  const chainPoints: ChainPoint[] = [];
  const segmentLevels: SegmentLevel[] = [];
  const polyline: GridPoint[] = [rawChain[forcedIndices[0]!]!];

  for (let s = 0; s < forcedIndices.length; s += 1) {
    const idx = forcedIndices[s]!;
    chainPoints.push({ point: rawChain[idx]!, isBridgeBank: !waypointIndexSet.has(idx) });
    if (s === 0) continue;

    const prevIdx = forcedIndices[s - 1]!;
    // A bridge is specifically a *single* raw-chain step (bank straight to
    // bank, nothing in between) whose distance is a jump. Two forced
    // points can also be many raw-chain steps apart while still being an
    // ordinary ground run (just a long one) -- checking distance alone
    // between forced points, without requiring index-adjacency, would
    // misclassify a long ground run between two *different* bridges as a
    // third bridge. Caught by a test with two separate water bodies on
    // one leg.
    if (idx === prevIdx + 1 && isJump(rawChain[prevIdx]!, rawChain[idx]!)) {
      segmentLevels.push("elevated");
      polyline.push(rawChain[idx]!);
      continue;
    }

    segmentLevels.push("ground");
    const run = rawChain.slice(prevIdx, idx + 1);
    const simplified = simplifyPolyline(run, RDP_EPSILON);
    const smoothed = clampToTraversable(terrain, smoothChain(simplified, SAMPLES_PER_SEGMENT), simplified);
    polyline.push(...smoothed.slice(1));
  }

  const steps = costForRawChain(terrain, rawChain);
  let newNodeCount = 0;
  for (let i = 0; i < waypoints.length; i += 1) {
    if (!existingWaypointIndices.has(i)) newNodeCount += 1;
  }
  newNodeCount += chainPoints.filter((c) => c.isBridgeBank).length;

  const breakdown = sumStepCosts(steps, newNodeCount, buildCostMultiplier);
  return { chainPoints, segmentLevels, polyline, breakdown };
}
