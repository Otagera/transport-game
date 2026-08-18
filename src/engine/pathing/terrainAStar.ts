import type { TerrainField } from "../map/types";
import { BASE_COST_PER_CELL, MAX_BRIDGE_SPAN, bridgeStepCost, stepCost, type StepCost } from "./cost";

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridPathResult {
  cells: GridPoint[];
  steps: StepCost[];
  /** Parallel to `steps`: 0 for a normal ground step, the span (in cells) for a bridge jump. */
  bridgeSpans: number[];
}

const NEIGHBOR_OFFSETS: Array<{ dx: number; dy: number; diagonal: boolean }> = [
  { dx: 1, dy: 0, diagonal: false },
  { dx: -1, dy: 0, diagonal: false },
  { dx: 0, dy: 1, diagonal: false },
  { dx: 0, dy: -1, diagonal: false },
  { dx: 1, dy: 1, diagonal: true },
  { dx: 1, dy: -1, diagonal: true },
  { dx: -1, dy: 1, diagonal: true },
  { dx: -1, dy: -1, diagonal: true },
];

export function cellIndex(terrain: TerrainField, x: number, y: number): number {
  return y * terrain.width + x;
}

export function inBounds(terrain: TerrainField, x: number, y: number): boolean {
  return x >= 0 && x < terrain.width && y >= 0 && y < terrain.height;
}

export function isWater(terrain: TerrainField, x: number, y: number): boolean {
  if (!inBounds(terrain, x, y)) return true;
  return terrain.water[cellIndex(terrain, x, y)] === 1;
}

// No corner cutting: a diagonal move between two land cells is disallowed
// if either cell adjoining the shared corner is water. Both endpoints can
// be land while the diagonal step still visually clips a water corner --
// disallowing it keeps pathing cost, water measurement, and rendered
// geometry in agreement (docs/principles.md §3).
function cornerBlocked(terrain: TerrainField, x: number, y: number, dx: number, dy: number): boolean {
  return isWater(terrain, x + dx, y) || isWater(terrain, x, y + dy);
}

// Walks cardinally from (x,y) through consecutive water cells; returns the
// bank-to-bank distance if dry land is reached within maxSpan, else null.
// Bridges only run cardinal -- diagonal water spans would tangle with the
// corner-cutting rule in ways not worth the complexity here.
function findWaterSpan(terrain: TerrainField, x: number, y: number, dx: number, dy: number, maxSpan: number): number | null {
  for (let distance = 1; distance <= maxSpan; distance += 1) {
    const cx = x + dx * distance;
    const cy = y + dy * distance;
    if (!inBounds(terrain, cx, cy)) return null;
    if (!isWater(terrain, cx, cy)) {
      return distance;
    }
  }
  return null;
}

function heuristic(a: GridPoint, b: GridPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y) * BASE_COST_PER_CELL;
}

// Terrain A* over the grid -- not the built-infrastructure graph
// (engine/simulation/routing.ts owns that, for runtime vehicle routing).
// This is the authoring-time search: it decides what a corridor is
// allowed to cost, cell by cell. Ground moves are 8-directional; water
// crossings are bridge "jump" edges straight to the far bank (Module 5),
// capped at MAX_BRIDGE_SPAN and priced via bridgeStepCost -- the same
// premium the cost breakdown reports, not a second function that could
// drift from what the search actually paid.
export function findTerrainPath(terrain: TerrainField, from: GridPoint, to: GridPoint): GridPathResult | null {
  if (isWater(terrain, from.x, from.y) || isWater(terrain, to.x, to.y)) {
    return null;
  }

  const startKey = `${from.x},${from.y}`;
  const goalKey = `${to.x},${to.y}`;

  const open = new Set<string>([startKey]);
  const cameFrom = new Map<string, string>();
  const cameFromStep = new Map<string, StepCost>();
  const cameFromBridgeSpan = new Map<string, number>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, heuristic(from, to)]]);
  const keyToPoint = new Map<string, GridPoint>([[startKey, from]]);

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
    if (current === null) break;

    if (current === goalKey) {
      const cells: GridPoint[] = [keyToPoint.get(current)!];
      const steps: StepCost[] = [];
      const bridgeSpans: number[] = [];
      let cursor = current;
      while (cameFrom.has(cursor)) {
        steps.unshift(cameFromStep.get(cursor)!);
        bridgeSpans.unshift(cameFromBridgeSpan.get(cursor) ?? 0);
        cursor = cameFrom.get(cursor)!;
        cells.unshift(keyToPoint.get(cursor)!);
      }
      return { cells, steps, bridgeSpans };
    }

    open.delete(current);
    const currentPoint = keyToPoint.get(current)!;
    const currentG = gScore.get(current) ?? Infinity;

    for (const { dx, dy, diagonal } of NEIGHBOR_OFFSETS) {
      const nx = currentPoint.x + dx;
      const ny = currentPoint.y + dy;

      if (isWater(terrain, nx, ny)) {
        if (diagonal) continue;
        const span = findWaterSpan(terrain, currentPoint.x, currentPoint.y, dx, dy, MAX_BRIDGE_SPAN);
        if (span === null) continue;

        const bx = currentPoint.x + dx * span;
        const by = currentPoint.y + dy * span;
        const step = bridgeStepCost(span);
        const tentativeG = currentG + step.base + step.water;

        const bridgeKey = `${bx},${by}`;
        if (tentativeG < (gScore.get(bridgeKey) ?? Infinity)) {
          cameFrom.set(bridgeKey, current);
          cameFromStep.set(bridgeKey, step);
          cameFromBridgeSpan.set(bridgeKey, span);
          gScore.set(bridgeKey, tentativeG);
          keyToPoint.set(bridgeKey, { x: bx, y: by });
          fScore.set(bridgeKey, tentativeG + heuristic({ x: bx, y: by }, to));
          open.add(bridgeKey);
        }
        continue;
      }

      if (diagonal && cornerBlocked(terrain, currentPoint.x, currentPoint.y, dx, dy)) continue;

      const stepDistance = diagonal ? Math.SQRT2 : 1;
      const step = stepCost(terrain, cellIndex(terrain, currentPoint.x, currentPoint.y), cellIndex(terrain, nx, ny), stepDistance);
      const stepTotal = step.base + step.gradient + step.density;
      const tentativeG = currentG + stepTotal;

      const neighborKey = `${nx},${ny}`;
      if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
        cameFrom.set(neighborKey, current);
        cameFromStep.set(neighborKey, step);
        cameFromBridgeSpan.delete(neighborKey);
        gScore.set(neighborKey, tentativeG);
        keyToPoint.set(neighborKey, { x: nx, y: ny });
        fScore.set(neighborKey, tentativeG + heuristic({ x: nx, y: ny }, to));
        open.add(neighborKey);
      }
    }
  }

  return null;
}
