import type { GeneratedMap } from "./types";

// Module 8: segment condition ticks down over real time, era-scaled, with
// a minor speed penalty -- deliberately NOT the full deferred "Corridor
// failure state" (docs/rebuild-plan.md), just enough that decay is a
// mechanical fact the player feels, not only a number sitting unused on
// Segment (it existed since Module 4 but nothing ever read or wrote it
// past creation time). Floors well above zero: decay is friction, not a
// route-killing failure state.
export const BASE_DECAY_PER_SECOND = 0.002;
export const MIN_CONDITION = 0.3;
export const MIN_CONDITION_SPEED_FACTOR = 0.6;

export function decaySegments(map: GeneratedMap, dt: number, decayMultiplier: number): void {
  for (const segment of map.segments) {
    segment.condition = Math.max(MIN_CONDITION, segment.condition - BASE_DECAY_PER_SECOND * decayMultiplier * dt);
  }
}

export function conditionSpeedFactor(condition: number): number {
  return MIN_CONDITION_SPEED_FACTOR + (1 - MIN_CONDITION_SPEED_FACTOR) * condition;
}

// The other half of decay: maintenance buys condition back. Returns the
// deficit that was actually restored (0 if the segment is already at
// full condition or doesn't exist), which is what the caller prices via
// pathing/cost.ts's maintenanceCost -- never the other way round, since
// pricing a repair that didn't happen is exactly the drift the cost rule
// exists to prevent. Mutates in place, matching decaySegments.
export function restoreSegmentCondition(map: GeneratedMap, segmentId: string): number {
  const segment = map.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) return 0;
  const deficit = 1 - segment.condition;
  if (deficit <= 0) return 0;
  segment.condition = 1;
  return deficit;
}
