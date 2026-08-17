import { describe, expect, test } from "bun:test";
import { computeBottleneckMetrics } from "@engine/simulation/bottleneck";

describe("computeBottleneckMetrics", () => {
  test("delivering everything that could have moved reads as fully healthy", () => {
    const metrics = computeBottleneckMetrics({
      deliveredRecently: 10,
      potentialRecently: 10,
      loadFractionSum: 0.8,
      sampleCount: 1,
    });
    expect(metrics.health).toBeCloseTo(1, 5);
    expect(metrics.utilisation).toBeCloseTo(0.8, 5);
  });

  test("no crossings yet reads as healthy with zero utilisation", () => {
    const metrics = computeBottleneckMetrics({
      deliveredRecently: 0,
      potentialRecently: 0,
      loadFractionSum: 0,
      sampleCount: 0,
    });
    expect(metrics.health).toBe(1);
    expect(metrics.utilisation).toBe(0);
  });

  test("delivering far less than potential capacity reads as unhealthy", () => {
    const metrics = computeBottleneckMetrics({
      deliveredRecently: 2,
      potentialRecently: 20,
      loadFractionSum: 0.1,
      sampleCount: 1,
    });
    expect(metrics.health).toBeCloseTo(0.1, 5);
  });
});
