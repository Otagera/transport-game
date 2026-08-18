import type { EraDef, EraTimeline } from "./types";

export function createEraTimeline(eras: EraDef[]): EraTimeline {
  if (eras.length === 0) {
    throw new Error("createEraTimeline requires at least one era.");
  }
  const sorted = [...eras].sort((a, b) => a.order - b.order);
  return { eras: sorted, currentIndex: 0, elapsedInEraSeconds: 0 };
}

export function currentEra(timeline: EraTimeline): EraDef {
  return timeline.eras[timeline.currentIndex]!;
}

export interface EraTransition {
  from: EraDef;
  to: EraDef;
}

// Eras advance over time (docs/rebuild-plan.md §6 Module 8), not by
// player action -- four compressed eras, not a fifth to loop into.
// Advances at most one step per call; with the small, fixed SIM_DT this
// codebase always ticks at, a call can never need to skip more than one
// era anyway.
export function advanceEraTimeline(timeline: EraTimeline, dt: number): EraTransition | null {
  timeline.elapsedInEraSeconds += dt;
  const from = timeline.eras[timeline.currentIndex]!;

  if (timeline.elapsedInEraSeconds < from.durationSeconds) {
    return null;
  }
  if (timeline.currentIndex >= timeline.eras.length - 1) {
    return null; // already in the final era -- hold there
  }

  timeline.currentIndex += 1;
  timeline.elapsedInEraSeconds = 0;
  const to = timeline.eras[timeline.currentIndex]!;
  return { from, to };
}
