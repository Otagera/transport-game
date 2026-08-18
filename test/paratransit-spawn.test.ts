import { describe, expect, test } from "bun:test";
import { buildRoutingContext } from "@engine/simulation/routing";
import { createVehicle } from "@engine/simulation/vehicle";
import type { GeneratedMap } from "@engine/map/types";
import type { NodeQueues, SimulationState } from "@engine/simulation/types";
import { createParatransitState } from "@engine/paratransit/types";
import {
  CORRIDOR_CAP,
  PAIR_CAP,
  SPAWN_COOLDOWN_SECONDS,
  SPAWN_EMA_THRESHOLD,
  reapCompletedParatransit,
  trySpawnParatransit,
  updateUnservedEMA,
} from "@engine/paratransit/spawn";

function fixtureMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: { width: 1, height: 1, elevation: new Float32Array(1), water: new Uint8Array(1), settlementDensity: new Float32Array(1) },
    nodes: [
      { id: "a", kind: "settlement", x: 0, y: 0 },
      { id: "b", kind: "village", x: 5, y: 0 },
    ],
    corridors: [{ id: "corridor-ab", nodeIds: ["a", "b"], polyline: [{ x: 0, y: 0 }, { x: 5, y: 0 }] }],
    segments: [
      { id: "s-ab", corridorId: "corridor-ab", fromNodeId: "a", toNodeId: "b", type: "road", level: "ground", condition: 1, provenance: "inherited" },
    ],
  };
}

function fixtureState(queuedAmount: number): SimulationState {
  const map = fixtureMap();
  const routing = buildRoutingContext(map);
  const queues: NodeQueues = new Map([
    ["a", new Map([["b:passengers", queuedAmount]])],
    ["b", new Map()],
  ]);
  return {
    map,
    demand: [{ from: "a", to: "b", kind: "passengers", rate: 1 }],
    queues,
    vehicles: [],
    segmentTraffic: new Map(),
    routing,
  };
}

describe("updateUnservedEMA", () => {
  test("converges toward sustained queue depth over the time constant", () => {
    const paratransit = createParatransitState();
    const state = fixtureState(10);
    for (let i = 0; i < 900; i += 1) {
      updateUnservedEMA(paratransit, state, 1 / 30);
    }
    expect(paratransit.pairUnservedEMA.get("a:b")).toBeGreaterThan(9);
  });

  test("only tracks passengers-kind pairs", () => {
    const paratransit = createParatransitState();
    const state = fixtureState(10);
    state.demand = [{ from: "a", to: "b", kind: "produce", rate: 1 }];
    updateUnservedEMA(paratransit, state, 1);
    expect(paratransit.pairUnservedEMA.size).toBe(0);
  });
});

describe("trySpawnParatransit", () => {
  test("does not spawn below the EMA threshold", () => {
    const paratransit = createParatransitState();
    const state = fixtureState(1);
    paratransit.pairUnservedEMA.set("a:b", SPAWN_EMA_THRESHOLD - 0.01);
    expect(trySpawnParatransit(paratransit, state, new Map())).toBeNull();
    expect(state.vehicles.length).toBe(0);
  });

  test("paratransitPressure divides the threshold, letting a higher-pressure era spawn sooner", () => {
    const paratransit = createParatransitState();
    const state = fixtureState(10);
    // Below the base threshold, so a pressure of 1 (or omitted) refuses.
    paratransit.pairUnservedEMA.set("a:b", SPAWN_EMA_THRESHOLD / 2);
    expect(trySpawnParatransit(paratransit, state, new Map())).toBeNull();
    expect(trySpawnParatransit(paratransit, state, new Map(), 1)).toBeNull();

    // A pressure of 2 halves the effective threshold, which this EMA now clears.
    expect(trySpawnParatransit(paratransit, state, new Map(), 2)).not.toBeNull();
  });

  test("spawns a one-shot passengers-only vehicle once sustained demand crosses the threshold", () => {
    const paratransit = createParatransitState();
    const state = fixtureState(10);
    paratransit.pairUnservedEMA.set("a:b", SPAWN_EMA_THRESHOLD + 1);

    const vehicle = trySpawnParatransit(paratransit, state, new Map());

    expect(vehicle).not.toBeNull();
    expect(vehicle!.lifecycle).toBe("one-shot");
    expect(vehicle!.carries).toBe("passengers");
    expect(state.vehicles).toContain(vehicle!);
    expect(paratransit.pairCounts.get("a:b")).toBe(1);
    expect(paratransit.segmentCounts.get("s-ab")).toBe(1);
  });

  test("respects the per-pair cap", () => {
    const paratransit = createParatransitState();
    const state = fixtureState(10);
    paratransit.pairUnservedEMA.set("a:b", SPAWN_EMA_THRESHOLD + 1);

    for (let i = 0; i < PAIR_CAP; i += 1) {
      paratransit.pairLastSpawnSeconds.set("a:b", -SPAWN_COOLDOWN_SECONDS * 2 * (i + 1));
      expect(trySpawnParatransit(paratransit, state, new Map())).not.toBeNull();
    }
    // Cooldown already elapsed (set far in the past above); the cap is
    // what should block the next one now.
    paratransit.pairLastSpawnSeconds.set("a:b", -SPAWN_COOLDOWN_SECONDS * 100);
    expect(trySpawnParatransit(paratransit, state, new Map())).toBeNull();
    expect(state.vehicles.length).toBe(PAIR_CAP);
  });

  test("respects the cooldown even when under the pair cap", () => {
    const paratransit = createParatransitState();
    const state = fixtureState(10);
    paratransit.pairUnservedEMA.set("a:b", SPAWN_EMA_THRESHOLD + 1);

    expect(trySpawnParatransit(paratransit, state, new Map())).not.toBeNull();
    expect(trySpawnParatransit(paratransit, state, new Map())).toBeNull(); // same tick, cooldown not elapsed
    expect(state.vehicles.length).toBe(1);
  });

  test("respects the per-corridor cap even under the pair cap", () => {
    const paratransit = createParatransitState();
    const state = fixtureState(10);
    paratransit.pairUnservedEMA.set("a:b", SPAWN_EMA_THRESHOLD + 1);
    paratransit.segmentCounts.set("s-ab", CORRIDOR_CAP);

    expect(trySpawnParatransit(paratransit, state, new Map())).toBeNull();
  });

  test("refuses to spawn into an already-too-congested corridor", () => {
    const paratransit = createParatransitState();
    const state = fixtureState(10);
    paratransit.pairUnservedEMA.set("a:b", SPAWN_EMA_THRESHOLD + 1);

    const heavyLoad = new Map([["s-ab", 1000]]);
    expect(trySpawnParatransit(paratransit, state, heavyLoad)).toBeNull();
  });

  test("never spawns for a goods pair", () => {
    const paratransit = createParatransitState();
    const state = fixtureState(10);
    state.demand = [{ from: "a", to: "b", kind: "produce", rate: 1 }];
    paratransit.pairUnservedEMA.set("a:b", SPAWN_EMA_THRESHOLD + 1);

    expect(trySpawnParatransit(paratransit, state, new Map())).toBeNull();
  });
});

describe("reapCompletedParatransit", () => {
  test("removes a completed vehicle and frees its cap slots", () => {
    const paratransit = createParatransitState();
    const state = fixtureState(10);
    paratransit.pairUnservedEMA.set("a:b", SPAWN_EMA_THRESHOLD + 1);
    const vehicle = trySpawnParatransit(paratransit, state, new Map())!;

    vehicle.pathIndex = vehicle.path.length; // simulate trip completion

    reapCompletedParatransit(paratransit, state);

    expect(state.vehicles.length).toBe(0);
    expect(paratransit.pairCounts.get("a:b")).toBe(0);
    expect(paratransit.segmentCounts.get("s-ab")).toBe(0);
    expect(paratransit.active.has(vehicle.id)).toBe(false);
  });

  test("leaves cyclic (player) vehicles untouched", () => {
    const paratransit = createParatransitState();
    const state = fixtureState(10);
    const playerVehicle = createVehicle("player-1", ["a", "b"], state.routing, 1, 10);
    state.vehicles.push(playerVehicle);

    reapCompletedParatransit(paratransit, state);

    expect(state.vehicles).toContain(playerVehicle);
  });
});
