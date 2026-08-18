import { describe, expect, test } from "bun:test";
import { createSimulation, tick } from "@engine/simulation/simulate";
import { createGrowthState } from "@engine/growth/state";
import { congestionFactor } from "@engine/simulation/congestion";
import type { EraModifiers } from "@engine/eras/types";
import type { GeneratedMap, InfrastructureType } from "@engine/map/types";

function era(ambientTraffic: number): EraModifiers {
  return { demand: 1, fuel: 1, buildCost: 1, decay: 1, paratransitPressure: 1, ambientTraffic };
}

// Two settlements, one link, nothing else -- so any load on that link can
// only have come from ambient traffic.
function twoTownMap(type: InfrastructureType): GeneratedMap {
  const cells = 32 * 32;
  return {
    seed: 0,
    terrain: {
      width: 32,
      height: 32,
      elevation: new Float32Array(cells),
      water: new Uint8Array(cells),
      settlementDensity: new Float32Array(cells),
    },
    nodes: [
      { id: "town-a", kind: "settlement", x: 4, y: 4 },
      { id: "town-b", kind: "settlement", x: 10, y: 4 },
    ],
    corridors: [{ id: "c1", nodeIds: ["town-a", "town-b"], polyline: [] }],
    segments: [
      { id: "s1", corridorId: "c1", fromNodeId: "town-a", toNodeId: "town-b", type, level: "ground", condition: 1, provenance: "inherited" },
    ],
  };
}

function runFor(state: ReturnType<typeof createSimulation>, modifiers: EraModifiers, ticks: number): void {
  const growth = createGrowthState(state.map);
  for (const node of growth.values()) node.demandMultiplier = 5;
  for (let i = 0; i < ticks; i += 1) tick(state, 1 / 30, undefined, undefined, modifiers, growth);
}

describe("ambient traffic through tick()", () => {
  test("a motorised era puts load on a road nobody is driving on", () => {
    const state = createSimulation(twoTownMap("road"));
    runFor(state, era(0.38), 30);
    expect(state.vehicles).toHaveLength(0);
    expect(state.ambientLoads.get("s1")).toBeGreaterThan(0);
    expect(state.segmentLoads.get("s1")).toBe(state.ambientLoads.get("s1")!);
  });

  test("the earliest era leaves the same road effectively clear", () => {
    const early = createSimulation(twoTownMap("road"));
    const modern = createSimulation(twoTownMap("road"));
    runFor(early, era(0.02), 30);
    runFor(modern, era(0.38), 30);
    expect(early.ambientLoads.get("s1")!).toBeLessThan(modern.ambientLoads.get("s1")!);
  });

  // Rail's immunity is the strategic answer to the whole mechanic, so it
  // is asserted end-to-end through tick() and not only at the unit level.
  test("rail carries no ambient load even in the most motorised era", () => {
    const state = createSimulation(twoTownMap("rail"));
    runFor(state, era(0.38), 30);
    expect(state.ambientLoads.size).toBe(0);
    expect(state.segmentLoads.get("s1") ?? 0).toBe(0);
  });

  test("growth drives it: the same era on an ungrown map produces less traffic", () => {
    const ungrown = createSimulation(twoTownMap("road"));
    const grownGrowth = createGrowthState(ungrown.map);
    for (let i = 0; i < 30; i += 1) tick(ungrown, 1 / 30, undefined, undefined, era(0.38), grownGrowth);

    const grown = createSimulation(twoTownMap("road"));
    runFor(grown, era(0.38), 30);

    expect(ungrown.ambientLoads.get("s1")!).toBeLessThan(grown.ambientLoads.get("s1")!);
  });

  // The payoff: prosperity alone, with no player or informal vehicle
  // anywhere near it, is enough to make a road slower than free-flowing.
  test("prosperity alone can push a corridor past its free slot", () => {
    const state = createSimulation(twoTownMap("road"));
    runFor(state, era(0.38), 30);
    expect(congestionFactor(state.segmentLoads.get("s1")!)).toBeLessThan(1);
  });

  test("without era modifiers at all there is no ambient traffic -- the mechanic is opt-in", () => {
    const state = createSimulation(twoTownMap("road"));
    for (let i = 0; i < 30; i += 1) tick(state, 1 / 30);
    expect(state.ambientLoads.size).toBe(0);
  });
});
