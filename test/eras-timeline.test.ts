import { describe, expect, test } from "bun:test";
import { advanceEraTimeline, createEraTimeline, currentEra } from "@engine/eras/timeline";
import type { EraDef } from "@engine/eras/types";

function makeEras(): EraDef[] {
  const modifiers = { demand: 1, fuel: 1, buildCost: 1, decay: 1, paratransitPressure: 1, ambientTraffic: 0 };
  return [
    { id: "a", order: 0, durationSeconds: 10, modifiers, railAvailable: true },
    { id: "b", order: 1, durationSeconds: 10, modifiers, railAvailable: true },
    { id: "c", order: 2, durationSeconds: 10, modifiers, railAvailable: false },
  ];
}

describe("createEraTimeline", () => {
  test("starts at the first era by order, regardless of input array order", () => {
    const [a, b, c] = makeEras();
    const timeline = createEraTimeline([c!, a!, b!]);
    expect(currentEra(timeline).id).toBe("a");
  });

  test("throws for an empty era list", () => {
    expect(() => createEraTimeline([])).toThrow();
  });
});

describe("advanceEraTimeline", () => {
  test("does not transition before the current era's duration elapses", () => {
    const timeline = createEraTimeline(makeEras());
    const transition = advanceEraTimeline(timeline, 5);
    expect(transition).toBeNull();
    expect(currentEra(timeline).id).toBe("a");
  });

  test("transitions exactly when the duration is reached", () => {
    const timeline = createEraTimeline(makeEras());
    advanceEraTimeline(timeline, 9);
    const transition = advanceEraTimeline(timeline, 1);
    expect(transition).toEqual({ from: makeEras()[0]!, to: makeEras()[1]! });
    expect(currentEra(timeline).id).toBe("b");
    expect(timeline.elapsedInEraSeconds).toBe(0);
  });

  test("holds at the final era instead of advancing past it", () => {
    const timeline = createEraTimeline(makeEras());
    advanceEraTimeline(timeline, 10);
    advanceEraTimeline(timeline, 10);
    expect(currentEra(timeline).id).toBe("c");

    const transition = advanceEraTimeline(timeline, 100);
    expect(transition).toBeNull();
    expect(currentEra(timeline).id).toBe("c");
  });

  test("a single generateMap-scale seed run reaches every era in order", () => {
    const timeline = createEraTimeline(makeEras());
    const seen: string[] = [currentEra(timeline).id];
    for (let i = 0; i < 35; i += 1) {
      const transition = advanceEraTimeline(timeline, 1);
      if (transition) seen.push(transition.to.id);
    }
    expect(seen).toEqual(["a", "b", "c"]);
  });
});
