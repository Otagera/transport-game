import { describe, expect, test } from "bun:test";
import {
  D_MAX,
  INITIAL_DEMAND_MULTIPLIER,
  PLAYER_SERVICE_EPSILON,
  applyPromotion,
  createGrowthState,
  demandMultiplierFor,
  updateGrowthState,
} from "@engine/growth/state";
import type { NodeDemandSample } from "@engine/growth/types";
import type { GeneratedMap } from "@engine/map/types";

function fixtureMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: { width: 1, height: 1, elevation: new Float32Array(1), water: new Uint8Array(1), settlementDensity: new Float32Array(1) },
    nodes: [
      { id: "village-a", kind: "village", x: 0, y: 0 },
      { id: "settlement-a", kind: "settlement", x: 5, y: 0 },
      { id: "junction-a", kind: "junction", x: 2, y: 2 },
    ],
    corridors: [],
    segments: [],
  };
}

function fullyServedSample(nodeId: string, generated = 10): NodeDemandSample {
  return { nodeId, generated, playerServed: generated, paratransitServed: 0 };
}

describe("createGrowthState", () => {
  test("creates entries only for village/settlement nodes, not junction", () => {
    const growth = createGrowthState(fixtureMap());
    expect(growth.size).toBe(2);
    expect(growth.has("village-a")).toBe(true);
    expect(growth.has("settlement-a")).toBe(true);
    expect(growth.has("junction-a")).toBe(false);
  });

  test("every node starts at the initial demand multiplier", () => {
    const growth = createGrowthState(fixtureMap());
    expect(demandMultiplierFor(growth, "village-a")).toBe(INITIAL_DEMAND_MULTIPLIER);
  });

  test("demandMultiplierFor returns the initial value for an unknown node id", () => {
    const growth = createGrowthState(fixtureMap());
    expect(demandMultiplierFor(growth, "nonexistent")).toBe(INITIAL_DEMAND_MULTIPLIER);
  });
});

describe("updateGrowthState -- necessary-condition gate", () => {
  test("zero growth with sustained paratransit-only service and no player service ever", () => {
    const growth = createGrowthState(fixtureMap());
    const sample: NodeDemandSample = { nodeId: "village-a", generated: 10, playerServed: 0, paratransitServed: 10 };
    for (let i = 0; i < 3000; i += 1) {
      updateGrowthState(growth, [sample], 1 / 30);
    }
    // S̄ should be pulled up by the discounted paratransit contribution,
    // but demandMultiplier must not have moved at all -- paratransit alone
    // can never be a "weighted contributor" that unlocks growth.
    const node = growth.get("village-a")!;
    expect(node.serviceRatioEMA).toBeGreaterThan(0.3);
    expect(node.demandMultiplier).toBe(INITIAL_DEMAND_MULTIPLIER);
  });

  test("a single momentary high-service tick does not immediately unlock full growth -- EMA must build up", () => {
    const growth = createGrowthState(fixtureMap());
    const before = demandMultiplierFor(growth, "village-a");
    updateGrowthState(growth, [fullyServedSample("village-a")], 1 / 30);
    const after = demandMultiplierFor(growth, "village-a");
    // playerServiceEMA after one tiny tick is still far below the epsilon
    // gate (EMA starts at 0, alpha is tiny for dt=1/30 against a 10s tau),
    // so growth this tick should be negligible, not a jump.
    expect(after - before).toBeLessThan(0.001);
  });
});

describe("updateGrowthState -- sustained player service drives growth and promotion", () => {
  test("demandMultiplier climbs monotonically toward D_max under sustained full player service", () => {
    const growth = createGrowthState(fixtureMap());
    let previous = demandMultiplierFor(growth, "village-a");
    let sawIncrease = false;
    for (let i = 0; i < 3000; i += 1) {
      updateGrowthState(growth, [fullyServedSample("village-a")], 1 / 30);
      const current = demandMultiplierFor(growth, "village-a");
      expect(current).toBeGreaterThanOrEqual(previous);
      if (current > previous) sawIncrease = true;
      previous = current;
    }
    expect(sawIncrease).toBe(true);
    // May have promoted to settlement partway through (a separate test
    // covers promotion itself) -- bound by whichever tier's cap applies.
    expect(previous).toBeLessThanOrEqual(D_MAX.settlement);
  });

  test("promotes village to settlement once D crosses the early threshold, and growth continues past it", () => {
    const map = fixtureMap();
    const growth = createGrowthState(map);
    let promoted = false;
    for (let i = 0; i < 6000 && !promoted; i += 1) {
      const promotions = updateGrowthState(growth, [fullyServedSample("village-a")], 1 / 30);
      if (promotions.length > 0) {
        expect(promotions).toEqual([{ nodeId: "village-a", from: "village", to: "settlement" }]);
        applyPromotion(map, promotions[0]!);
        promoted = true;
      }
    }
    expect(promoted).toBe(true);

    const node = growth.get("village-a")!;
    expect(node.tier).toBe("settlement");
    expect(map.nodes.find((n) => n.id === "village-a")!.kind).toBe("settlement");
    // Promotion happens well before the (much higher) village cap, and
    // strictly below D_MAX.village -- "early in the curve, not near the
    // cap."
    expect(node.demandMultiplier).toBeLessThan(D_MAX.village);

    // Growth keeps going past promotion, now bounded by the settlement's
    // higher cap rather than resetting.
    for (let i = 0; i < 6000; i += 1) {
      updateGrowthState(growth, [fullyServedSample("village-a")], 1 / 30);
    }
    expect(node.demandMultiplier).toBeGreaterThan(D_MAX.village);
    expect(node.demandMultiplier).toBeLessThanOrEqual(D_MAX.settlement);
  });

  test("player service below the epsilon gate produces no growth even with a nonzero ratio", () => {
    const growth = createGrowthState(fixtureMap());
    // A tiny trickle of player service, well under PLAYER_SERVICE_EPSILON.
    const sample: NodeDemandSample = { nodeId: "village-a", generated: 1000, playerServed: 1, paratransitServed: 0 };
    for (let i = 0; i < 3000; i += 1) {
      updateGrowthState(growth, [sample], 1 / 30);
    }
    const node = growth.get("village-a")!;
    expect(node.playerServiceEMA).toBeLessThan(PLAYER_SERVICE_EPSILON);
    expect(node.demandMultiplier).toBe(INITIAL_DEMAND_MULTIPLIER);
  });

  test("paratransit's discount means half-strength paratransit alone still can't out-drive an equal-strength gate check", () => {
    // Sanity check on the discount constant: full player service converges
    // S̄ to 1; paratransit-only service (fully served, but zero player)
    // converges S̄ to the discount factor, not 1.
    const growth = createGrowthState(fixtureMap());
    const paratransitOnly: NodeDemandSample = { nodeId: "village-a", generated: 10, playerServed: 0, paratransitServed: 10 };
    for (let i = 0; i < 3000; i += 1) {
      updateGrowthState(growth, [paratransitOnly], 1 / 30);
    }
    const node = growth.get("village-a")!;
    expect(node.serviceRatioEMA).toBeGreaterThan(0.4);
    expect(node.serviceRatioEMA).toBeLessThan(0.6);
  });
});

describe("applyPromotion", () => {
  test("mutates the map node's kind in place", () => {
    const map = fixtureMap();
    applyPromotion(map, { nodeId: "village-a", from: "village", to: "settlement" });
    expect(map.nodes.find((n) => n.id === "village-a")!.kind).toBe("settlement");
  });

  test("is a no-op for an unknown node id", () => {
    const map = fixtureMap();
    expect(() => applyPromotion(map, { nodeId: "nonexistent", from: "village", to: "settlement" })).not.toThrow();
  });
});
