import type { TerrainField } from "../map/types";
import type { GridPoint } from "./terrainAStar";
import { isWater, inBounds } from "./terrainAStar";
import { walkCellsAlongSegment } from "./supercover";

const MAX_TURN_ANGLE_RADIANS = (150 * Math.PI) / 180;

function catmullRom(p0: GridPoint, p1: GridPoint, p2: GridPoint, p3: GridPoint, t: number): GridPoint {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

// Smoothing the WHOLE chain as one spline -- not per-segment -- is what
// gives tangent continuity across interior nodes for free. Smoothing per
// segment independently produces a kink at every join
// (docs/principles.md §3); there's only one curve here, so there's
// nothing to stitch.
export function smoothChain(points: GridPoint[], samplesPerSegment: number): GridPoint[] {
  if (points.length < 3) {
    return points.slice();
  }

  const padded = [points[0]!, ...points, points[points.length - 1]!];
  const result: GridPoint[] = [padded[1]!];

  for (let i = 1; i < padded.length - 2; i += 1) {
    const p0 = padded[i - 1]!;
    const p1 = padded[i]!;
    const p2 = padded[i + 1]!;
    const p3 = padded[i + 2]!;
    for (let s = 1; s <= samplesPerSegment; s += 1) {
      result.push(catmullRom(p0, p1, p2, p3, s / samplesPerSegment));
    }
  }

  return result;
}

function segmentCrossesWater(terrain: TerrainField, a: GridPoint, b: GridPoint): boolean {
  for (const cell of walkCellsAlongSegment(a.x, a.y, b.x, b.y)) {
    if (isWater(terrain, cell.x, cell.y)) {
      return true;
    }
  }
  return false;
}

function turnAngle(a: GridPoint, b: GridPoint, c: GridPoint): number {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const len1 = Math.hypot(v1x, v1y);
  const len2 = Math.hypot(v2x, v2y);
  if (len1 === 0 || len2 === 0) return 0;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (len1 * len2)));
  return Math.acos(cos);
}

// Smoothing must not change corridor type: clamp back to the traversable
// set -- both vertices and segments -- with a raw-path fallback if the
// smoothed curve would leave it (docs/principles.md §3). Also applies
// the turning-radius constraint across the whole curve, not just at the
// original joins.
export function clampToTraversable(terrain: TerrainField, smoothed: GridPoint[], raw: GridPoint[]): GridPoint[] {
  for (const point of smoothed) {
    const cx = Math.round(point.x);
    const cy = Math.round(point.y);
    if (!inBounds(terrain, cx, cy) || isWater(terrain, cx, cy)) {
      return raw.slice();
    }
  }

  for (let i = 0; i < smoothed.length - 1; i += 1) {
    if (segmentCrossesWater(terrain, smoothed[i]!, smoothed[i + 1]!)) {
      return raw.slice();
    }
  }

  for (let i = 1; i < smoothed.length - 1; i += 1) {
    if (turnAngle(smoothed[i - 1]!, smoothed[i]!, smoothed[i + 1]!) > MAX_TURN_ANGLE_RADIANS) {
      return raw.slice();
    }
  }

  return smoothed;
}
