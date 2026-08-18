import { describe, expect, test } from "bun:test";
import { segmentSignalColor } from "@render/network";

// Hue = health, brightness = utilisation. Two channels, two meanings,
// never conflated (docs/principles.md §3). These assertions exist so a
// later "let's make it pop" tweak can't quietly start encoding health in
// brightness or utilisation in hue -- which is the "a visual must not say
// something the model doesn't mean" failure the Findings call the single
// most reliable rule in the project.
function hue(health: number, utilisation: number): number {
  const { h } = segmentSignalColor(health, utilisation).getHSL({ h: 0, s: 0, l: 0 });
  return h;
}

describe("segmentSignalColor", () => {
  test("hue tracks health and is independent of utilisation", () => {
    expect(hue(1, 0)).toBeCloseTo(hue(1, 1), 5);
    expect(hue(0, 0)).toBeCloseTo(hue(0, 1), 5);
    expect(hue(1, 0.5)).not.toBeCloseTo(hue(0, 0.5), 2);
  });

  test("healthy reads green, unhealthy reads red", () => {
    const healthy = segmentSignalColor(1, 1);
    const unhealthy = segmentSignalColor(0, 1);
    expect(healthy.g).toBeGreaterThan(healthy.r);
    expect(unhealthy.r).toBeGreaterThan(unhealthy.g);
  });

  test("brightness tracks utilisation at fixed health", () => {
    const busy = segmentSignalColor(1, 1);
    const quiet = segmentSignalColor(1, 0);
    expect(busy.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(quiet.getHSL({ h: 0, s: 0, l: 0 }).l);
  });

  test("an unused-but-healthy segment is still visible, not black -- the channel means 'how busy', not 'does it exist'", () => {
    const quiet = segmentSignalColor(1, 0);
    expect(quiet.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(0.05);
  });

  test("clamps out-of-range inputs instead of wrapping the hue past red", () => {
    expect(hue(-5, 0.5)).toBeCloseTo(hue(0, 0.5), 5);
    expect(hue(5, 0.5)).toBeCloseTo(hue(1, 0.5), 5);
  });
});
