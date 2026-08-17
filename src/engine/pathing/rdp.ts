export interface Point {
  x: number;
  y: number;
}

export function simplifyPolyline(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2 || epsilon <= 0) {
    return points.slice();
  }
  return simplifySegment(points, 0, points.length - 1, epsilon);
}

function simplifySegment(points: Point[], first: number, last: number, epsilon: number): Point[] {
  const start = points[first];
  const end = points[last];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const segmentLengthSquared = dx * dx + dy * dy;

  let maxDistance = 0;
  let maxIndex = -1;
  for (let i = first + 1; i < last; i++) {
    const distance = perpendicularDistance(points[i], start, dx, dy, segmentLengthSquared);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  if (maxIndex === -1 || maxDistance <= epsilon) {
    return [start, end];
  }

  const left = simplifySegment(points, first, maxIndex, epsilon);
  const right = simplifySegment(points, maxIndex, last, epsilon);
  return [...left, ...right.slice(1)];
}

function perpendicularDistance(
  point: Point,
  start: Point,
  dx: number,
  dy: number,
  segmentLengthSquared: number,
): number {
  // A zero-length segment (duplicate consecutive points) has no perpendicular
  // direction; fall back to the plain distance to the segment's start point.
  if (segmentLengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const cross = dx * (point.y - start.y) - dy * (point.x - start.x);
  return Math.abs(cross) / Math.sqrt(segmentLengthSquared);
}
