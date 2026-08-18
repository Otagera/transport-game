import { describe, expect, test } from "bun:test";
import { buildSnapshot, type InspectorEffects, type InspectorSources } from "@ui/inspector";
import { createEconomyState, registerPurchase } from "@engine/economy/state";
import { decaySegments } from "@engine/map/decay";
import { buildRoutingContext } from "@engine/simulation/routing";
import type { GeneratedMap } from "@engine/map/types";
import type { SimulationState, Vehicle } from "@engine/simulation/types";
import type { EconomyState } from "@engine/economy/types";

function fixtureMap(): GeneratedMap {
  return {
    seed: 0,
    terrain: { width: 8, height: 8, elevation: new Float32Array(64), water: new Uint8Array(64), settlementDensity: new Float32Array(64) },
    nodes: [
      { id: "town", kind: "settlement", x: 1, y: 1 },
      { id: "village", kind: "village", x: 5, y: 1 },
    ],
    corridors: [{ id: "c1", nodeIds: ["town", "village"], polyline: [] }],
    segments: [
      { id: "s1", corridorId: "c1", fromNodeId: "town", toNodeId: "village", type: "road", level: "ground", condition: 1, provenance: "built" },
    ],
  };
}

function fixtureVehicle(): Vehicle {
  return {
    id: "vehicle-0",
    path: ["town", "village"],
    pathIndex: 1,
    edgeProgress: 0.5,
    speed: 3,
    capacity: 14,
    cargo: [],
    carries: "passengers",
    congestionWeight: 1,
    lifecycle: "cyclic",
  };
}

interface Fixture {
  sources: InspectorSources;
  economy: EconomyState;
  simulation: SimulationState;
  calls: string[];
  effects: InspectorEffects;
}

function fixture(options: { withVehicle?: boolean; funds?: number } = {}): Fixture {
  const map = fixtureMap();
  const simulation: SimulationState = {
    map,
    demand: [],
    queues: new Map([
      ["town", new Map()],
      ["village", new Map()],
    ]),
    vehicles: options.withVehicle === false ? [] : [fixtureVehicle()],
    segmentTraffic: new Map(),
    routing: buildRoutingContext(map),
  };
  const economy = createEconomyState({ passengers: 5, produce: 3, supplies: 2 }, 1000);
  registerPurchase(economy, "vehicle-0", 200, 0.4, "danfo");
  economy.funds = options.funds ?? 1000;

  const calls: string[] = [];
  const effects: InspectorEffects = {
    sellVehicle: (id) => calls.push(`sell:${id}`),
    pruneCorridor: (id) => calls.push(`prune:${id}`),
    maintainSegment: (id) => calls.push(`maintain:${id}`),
  };

  return {
    simulation,
    economy,
    calls,
    effects,
    sources: {
      simulation: () => simulation,
      economy: () => economy,
      growth: () => new Map(),
      catalog: () => [
        { id: "danfo", name: "Danfo", carries: "passengers", capacity: 14, speed: 3.5, purchaseCost: 200, operatingCostPerSecond: 0.4, runsOn: "petrol", eraIn: "post-independence", eraOut: null, congestionWeight: 1 },
      ],
      stranded: () => new Set<string>(),
      profileFor: () => undefined,
    },
  };
}

describe("Inspector snapshot", () => {
  test("is null when nothing is selected -- empty is the correct render, not a fallback", () => {
    const { sources, effects } = fixture();
    expect(buildSnapshot(null, sources, effects)).toBeNull();
  });

  test("is null when the selected entity has since gone (sold, pruned, reaped)", () => {
    const { sources, effects } = fixture();
    expect(buildSnapshot({ kind: "vehicle", id: "gone" }, sources, effects)).toBeNull();
  });

  test("a segment links to its corridor, so a prune is reachable from a click on the road", () => {
    const { sources, effects } = fixture();
    const snapshot = buildSnapshot({ kind: "segment", id: "s1" }, sources, effects)!;
    expect(snapshot.links).toContainEqual({ label: "corridor c1", target: { kind: "corridor", id: "c1" } });
  });
});

// The load-bearing claim of the whole Inspector: these three actions are
// the only levers a player in debt has, and docs/rebuild-plan.md §5
// records three playthroughs ending in undiagnosable debt. If a later
// change routes them through canAfford "for consistency" with purchases,
// this is what should fail.
describe("actions at negative funds", () => {
  const DEEP_DEBT = -5000;

  test("selling a vehicle is not blocked", () => {
    const { sources, effects, calls } = fixture({ funds: DEEP_DEBT });
    const snapshot = buildSnapshot({ kind: "vehicle", id: "vehicle-0" }, sources, effects)!;
    const sell = snapshot.actions.find((action) => action.label.startsWith("Sell"))!;
    expect(sell.blockedReason).toBeUndefined();
    sell.run();
    expect(calls).toEqual(["sell:vehicle-0"]);
  });

  test("maintaining a segment is not blocked", () => {
    const { sources, effects, calls, simulation } = fixture({ funds: DEEP_DEBT, withVehicle: false });
    decaySegments(simulation.map, 100, 1);
    const snapshot = buildSnapshot({ kind: "segment", id: "s1" }, sources, effects)!;
    const maintain = snapshot.actions[0]!;
    expect(maintain.blockedReason).toBeUndefined();
    expect(maintain.label).toContain("₦");
    maintain.run();
    expect(calls).toEqual(["maintain:s1"]);
  });

  test("pruning a corridor is not blocked", () => {
    const { sources, effects, calls } = fixture({ funds: DEEP_DEBT, withVehicle: false });
    const snapshot = buildSnapshot({ kind: "corridor", id: "c1" }, sources, effects)!;
    const prune = snapshot.actions[0]!;
    expect(prune.blockedReason).toBeUndefined();
    prune.run();
    expect(calls).toEqual(["prune:c1"]);
  });

  test("a prune is blocked by vehicles, not by money -- and the blockers are named", () => {
    const { sources, effects, calls } = fixture({ funds: 100_000 });
    const snapshot = buildSnapshot({ kind: "corridor", id: "c1" }, sources, effects)!;
    const prune = snapshot.actions[0]!;
    expect(prune.blockedReason).toContain("vehicle-0");
    prune.run();
    expect(calls).toEqual([]);
    // ...and the blocker is a link, so it can be selected and sold.
    expect(snapshot.links).toContainEqual({ label: "vehicle vehicle-0", target: { kind: "vehicle", id: "vehicle-0" } });
  });

  test("a healthy segment's maintain action is blocked by having nothing to buy back, not by funds", () => {
    const { sources, effects } = fixture({ funds: DEEP_DEBT, withVehicle: false });
    const snapshot = buildSnapshot({ kind: "segment", id: "s1" }, sources, effects)!;
    expect(snapshot.actions[0]!.blockedReason).toBe("already at full condition");
  });

  test("paratransit offers no sell action -- it is not the player's to sell", () => {
    const { sources, effects, simulation } = fixture();
    simulation.vehicles[0]!.lifecycle = "one-shot";
    const snapshot = buildSnapshot({ kind: "vehicle", id: "vehicle-0" }, sources, effects)!;
    expect(snapshot.actions).toEqual([]);
  });
});
