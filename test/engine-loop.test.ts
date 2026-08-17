import { describe, expect, test } from "bun:test";
import { Accumulator, SIM_DT } from "@engine/loop";

describe("Accumulator", () => {
  test("ticks exactly once per SIM_DT of elapsed time", () => {
    const acc = new Accumulator(SIM_DT);
    let ticks = 0;
    acc.advance(SIM_DT, () => {
      ticks += 1;
    });
    expect(ticks).toBe(1);
  });

  test("ticks multiple times and returns the leftover alpha", () => {
    const acc = new Accumulator(SIM_DT);
    let ticks = 0;
    const alpha = acc.advance(SIM_DT * 2.5, () => {
      ticks += 1;
    });
    expect(ticks).toBe(2);
    expect(alpha).toBeCloseTo(0.5, 5);
  });

  test("clamps a huge stall instead of producing a spiral of death", () => {
    const acc = new Accumulator(SIM_DT);
    let ticks = 0;
    acc.advance(10, () => {
      ticks += 1;
    });
    // Clamped to 0.25s max per advance() call, so ticks stay bounded.
    expect(ticks).toBeLessThan(10);
  });

  test("does not tick before a full step has accumulated", () => {
    const acc = new Accumulator(SIM_DT);
    let ticks = 0;
    acc.advance(SIM_DT / 2, () => {
      ticks += 1;
    });
    expect(ticks).toBe(0);
  });
});
