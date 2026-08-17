import type { CorridorTraffic } from "./types";

export interface BottleneckMetrics {
  health: number;
  utilisation: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// Placeholder for Module 3's scope: health/utilisation as a display
// signal (hue/brightness mapping is a render-layer concern, once corridor
// rendering exists -- engine only computes the numbers). Full congestion
// modeling (capacity scaling, free first slot, per-vehicle weight) is
// Module 7's job, not this one's.
export function computeBottleneckMetrics(traffic: CorridorTraffic): BottleneckMetrics {
  const health = traffic.potentialRecently > 0 ? clamp01(traffic.deliveredRecently / traffic.potentialRecently) : 1;
  const utilisation = traffic.sampleCount > 0 ? clamp01(traffic.loadFractionSum / traffic.sampleCount) : 0;
  return { health, utilisation };
}
