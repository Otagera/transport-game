import { describe, expect, test } from "bun:test";
import { generateMap } from "@engine/map/generate";
import { createSimulation, tick } from "@engine/simulation/simulate";
import { createEconomyState, registerPurchase } from "@engine/economy/state";
import { createParatransitState } from "@engine/paratransit/types";
import { createGrowthState } from "@engine/growth/state";
import { createEraTimeline } from "@engine/eras/timeline";
import type { EraDef } from "@engine/eras/types";
import { createSnapshot, restoreIntoState } from "@engine/save/snapshot";
import { SAVE_FORMAT_VERSION } from "@engine/save/types";

function testEras(): EraDef[] {
  const modifiers = { demand: 1, fuel: 1, buildCost: 1, decay: 1, paratransitPressure: 1, ambientTraffic: 0 };
  return [
    { id: "era-a", order: 0, durationSeconds: 10, modifiers, railAvailable: true },
    { id: "era-b", order: 1, durationSeconds: 10, modifiers, railAvailable: true },
  ];
}

// A dedicated map with a profileId already set, mirroring the shape of a
// built corridor (Module 11b). This is the field docs/handoff-module-10.md
// §2.3 warns drops silently -- rendering fine while the corridor reverts
// to the wrong cross-section, decay rate and cost basis.
function twoNodeMapWithProfile(): ReturnType<typeof generateMap> {
  return {
    seed: 42,
    terrain: generateMap(42).terrain,
    nodes: [
      { id: "village", kind: "village", x: 0, y: 0 },
      { id: "settlement", kind: "settlement", x: 4, y: 0 },
    ],
    corridors: [{ id: "corridor-1", nodeIds: ["village", "settlement"], polyline: [{ x: 0, y: 0 }, { x: 4, y: 0 }] }],
    segments: [
      {
        id: "seg-1",
        corridorId: "corridor-1",
        fromNodeId: "village",
        toNodeId: "settlement",
        type: "road",
        level: "ground",
        condition: 0.7,
        provenance: "built",
        profileId: "trunk-road",
      },
    ],
  };
}

describe("engine/save snapshot round-trip", () => {
  test("restoreIntoState reproduces map, economy, and era position into a fresh set of state objects", () => {
    const map = twoNodeMapWithProfile();
    const simulation = createSimulation(map, [
      { id: "shuttle", waypoints: ["village", "settlement"], speed: 4, capacity: 20 },
    ]);
    const economy = createEconomyState({ passengers: 5, produce: 3, supplies: 2 }, 1000);
    registerPurchase(economy, "shuttle", 200, 1, "danfo");
    const paratransit = createParatransitState();
    const growth = createGrowthState(map);
    const eraTimeline = createEraTimeline(testEras());

    for (let i = 0; i < 300; i += 1) {
      tick(simulation, 1 / 30, economy, paratransit, testEras()[0]!.modifiers, growth);
    }

    const save = createSnapshot(simulation, economy, paratransit, growth, eraTimeline);
    expect(save.version).toBe(SAVE_FORMAT_VERSION);

    // A fresh set of state objects, as bootstrap() constructs before
    // restoring -- restoreIntoState must fully repopulate them, not rely
    // on anything left over from a prior game.
    const freshMap = generateMap(1);
    const freshSimulation = createSimulation(freshMap, []);
    const freshEconomy = createEconomyState({ passengers: 5, produce: 3, supplies: 2 }, 0);
    const freshParatransit = createParatransitState();
    const freshGrowth = createGrowthState(freshMap);
    const freshEraTimeline = createEraTimeline(testEras());

    const result = restoreIntoState(save, freshSimulation, freshEconomy, freshParatransit, freshGrowth, freshEraTimeline);
    expect(result.ok).toBe(true);

    expect(freshSimulation.map.seed).toBe(42);
    expect(freshSimulation.map.nodes.map((n) => n.id).sort()).toEqual(["settlement", "village"]);
    // The field that silently corrupts a save if dropped.
    expect(freshSimulation.map.segments.find((s) => s.id === "seg-1")!.profileId).toBe("trunk-road");
    expect(freshSimulation.map.segments.find((s) => s.id === "seg-1")!.condition).toBeCloseTo(
      simulation.map.segments.find((s) => s.id === "seg-1")!.condition,
    );

    expect(freshSimulation.vehicles).toHaveLength(1);
    expect(freshSimulation.vehicles[0]!.id).toBe("shuttle");

    expect(freshEconomy.funds).toBeCloseTo(economy.funds);
    expect(freshEconomy.vehicleEconomics.has("shuttle")).toBe(true);

    expect(freshEraTimeline.currentIndex).toBe(eraTimeline.currentIndex);
    expect(freshEraTimeline.elapsedInEraSeconds).toBeCloseTo(eraTimeline.elapsedInEraSeconds);

    // Regenerated from the seed, not carried over from freshMap's terrain.
    expect(freshSimulation.map.terrain.width).toBe(simulation.map.terrain.width);
    expect(freshSimulation.map.terrain.elevation).toEqual(simulation.map.terrain.elevation);
  });

  test("a promoted node's kind and a decayed segment's condition survive the round-trip", () => {
    const map = generateMap(7);
    const simulation = createSimulation(map, []);
    const village = map.nodes.find((n) => n.kind === "village");
    expect(village).toBeDefined();
    village!.kind = "settlement"; // simulate applyPromotion having run
    const segment = map.segments[0]!;
    segment.condition = 0.42; // simulate decaySegments having run

    const economy = createEconomyState({ passengers: 5, produce: 3, supplies: 2 }, 500);
    const paratransit = createParatransitState();
    const growth = createGrowthState(map);
    const eraTimeline = createEraTimeline(testEras());

    const save = createSnapshot(simulation, economy, paratransit, growth, eraTimeline);

    const freshMap = generateMap(1);
    const freshSimulation = createSimulation(freshMap, []);
    const freshEconomy = createEconomyState({ passengers: 5, produce: 3, supplies: 2 }, 0);
    const freshParatransit = createParatransitState();
    const freshGrowth = createGrowthState(freshMap);
    const freshEraTimeline = createEraTimeline(testEras());
    restoreIntoState(save, freshSimulation, freshEconomy, freshParatransit, freshGrowth, freshEraTimeline);

    expect(freshSimulation.map.nodes.find((n) => n.id === village!.id)!.kind).toBe("settlement");
    expect(freshSimulation.map.segments.find((s) => s.id === segment.id)!.condition).toBeCloseTo(0.42);
  });

  test("a mismatched version is rejected clearly and does not mutate the target state", () => {
    const map = generateMap(3);
    const simulation = createSimulation(map, []);
    const economy = createEconomyState({ passengers: 5, produce: 3, supplies: 2 }, 1000);
    const paratransit = createParatransitState();
    const growth = createGrowthState(map);
    const eraTimeline = createEraTimeline(testEras());
    const save = createSnapshot(simulation, economy, paratransit, growth, eraTimeline);
    const staleSave = { ...save, version: SAVE_FORMAT_VERSION + 1 };

    const targetMap = generateMap(9);
    const targetSimulation = createSimulation(targetMap, []);
    const targetEconomy = createEconomyState({ passengers: 5, produce: 3, supplies: 2 }, 777);
    const targetParatransit = createParatransitState();
    const targetGrowth = createGrowthState(targetMap);
    const targetEraTimeline = createEraTimeline(testEras());

    const result = restoreIntoState(
      staleSave,
      targetSimulation,
      targetEconomy,
      targetParatransit,
      targetGrowth,
      targetEraTimeline,
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("version");
    expect(targetSimulation.map.seed).toBe(9);
    expect(targetEconomy.funds).toBe(777);
  });
});
