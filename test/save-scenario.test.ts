import { describe, expect, test } from "bun:test";
import { createSimulation } from "@engine/simulation/simulate";
import { createEconomyState } from "@engine/economy/state";
import { createParatransitState } from "@engine/paratransit/types";
import { createGrowthState, demandMultiplierFor } from "@engine/growth/state";
import { createEraTimeline, currentEra } from "@engine/eras/timeline";
import type { EraDef } from "@engine/eras/types";
import { applyScenario, warmForward } from "@engine/save/scenario";
import type { GeneratedMap } from "@engine/map/types";

function testEras(): EraDef[] {
  const modifiers = { demand: 1, fuel: 1, buildCost: 1, decay: 1, paratransitPressure: 1, ambientTraffic: 0 };
  return [
    { id: "era-a", order: 0, durationSeconds: 5, modifiers, railAvailable: true },
    { id: "era-b", order: 1, durationSeconds: 5, modifiers, railAvailable: true },
  ];
}

function twoNodeMap(): GeneratedMap {
  return {
    seed: 1,
    terrain: { width: 1, height: 1, elevation: new Float32Array(1), water: new Uint8Array(1), settlementDensity: new Float32Array(1) },
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
        condition: 1,
        provenance: "inherited",
      },
    ],
  };
}

const danfoSpec = {
  defId: "danfo",
  speed: 4,
  capacity: 20,
  carries: "passengers" as const,
  purchaseCost: 200,
  operatingCostPerSecond: 0.1,
  congestionWeight: 2,
};

describe("engine/save scenario", () => {
  test("applyScenario sets funds, jumps to the starting era, and places the seed fleet", () => {
    const map = twoNodeMap();
    const simulation = createSimulation(map, []);
    const economy = createEconomyState({ passengers: 5, produce: 3, supplies: 2 }, 0);
    const eraTimeline = createEraTimeline(testEras());

    applyScenario(
      { startingEraId: "era-b", startingFunds: 5000, warmForwardDays: 0, seedFleet: [{ defId: "danfo", count: 2 }] },
      simulation,
      economy,
      eraTimeline,
      [danfoSpec],
    );

    expect(currentEra(eraTimeline).id).toBe("era-b");
    expect(eraTimeline.elapsedInEraSeconds).toBe(0);
    expect(simulation.vehicles).toHaveLength(2);
    expect(economy.funds).toBeCloseTo(5000 - 2 * danfoSpec.purchaseCost);
    expect(economy.vehicleEconomics.size).toBe(2);
  });

  test("applyScenario ignores seed-fleet entries for defs missing from the catalog", () => {
    const map = twoNodeMap();
    const simulation = createSimulation(map, []);
    const economy = createEconomyState({ passengers: 5, produce: 3, supplies: 2 }, 0);
    const eraTimeline = createEraTimeline(testEras());

    applyScenario(
      { startingEraId: "era-a", startingFunds: 1000, warmForwardDays: 0, seedFleet: [{ defId: "not-a-real-def", count: 3 }] },
      simulation,
      economy,
      eraTimeline,
      [danfoSpec],
    );

    expect(simulation.vehicles).toHaveLength(0);
    expect(economy.funds).toBe(1000);
  });

  test("warmForward runs real ticks: it can cross an era boundary and grow a served village", () => {
    const map = twoNodeMap();
    const simulation = createSimulation(map, [
      { id: "shuttle", waypoints: ["village", "settlement"], speed: 4, capacity: 20 },
    ]);
    const economy = createEconomyState({ passengers: 5, produce: 3, supplies: 2 }, 1000);
    const paratransit = createParatransitState();
    const growth = createGrowthState(map);
    const eraTimeline = createEraTimeline(testEras());
    const eraModifiersById = new Map(testEras().map((era) => [era.id, era.modifiers]));

    // era-a is 5s long; 3 warm-forward days (90s at 30s/day) must cross into era-b.
    warmForward(simulation, economy, paratransit, growth, eraTimeline, 3, eraModifiersById, new Map());

    expect(currentEra(eraTimeline).id).toBe("era-b");
    expect(demandMultiplierFor(growth, "village")).toBeGreaterThan(1);
  });
});
