import { describe, expect, test } from "bun:test";
import { generateMap } from "@engine/map/generate";
import { createSimulation, tick } from "@engine/simulation/simulate";
import { createGrowthState, demandMultiplierFor } from "@engine/growth/state";

describe("simulation integration", () => {
  test("a vehicle running between two settlements delivers demand over time", () => {
    const map = generateMap(11);
    const settlements = map.nodes.filter((node) => node.kind === "settlement");
    expect(settlements.length).toBeGreaterThanOrEqual(2);

    // findPath does a full graph search, not just direct edges, so this
    // works for any two settlements regardless of seed -- Module 2's
    // hard-asserted connectivity guarantees a path exists.
    const waypoints = [settlements[0]!.id, settlements[1]!.id];
    const state = createSimulation(map, [{ id: "spine-1", waypoints, speed: 3, capacity: 20 }]);

    for (let i = 0; i < 900; i += 1) {
      tick(state, 1 / 30);
    }

    const totalDelivered = [...state.segmentTraffic.values()].reduce(
      (sum, traffic) => sum + traffic.deliveredRecently,
      0,
    );
    expect(totalDelivered).toBeGreaterThan(0);
  });

  test("era demand multiplier scales how fast queues grow", () => {
    const map = generateMap(11);
    const state = createSimulation(map);
    const baseline = createSimulation(map);

    for (let i = 0; i < 30; i += 1) {
      tick(state, 1 / 30, undefined, undefined, {
        demand: 3,
        fuel: 1,
        buildCost: 1,
        decay: 1,
        paratransitPressure: 1,
        ambientTraffic: 0,
      });
      tick(baseline, 1 / 30);
    }

    const sumQueued = (s: typeof state) =>
      [...s.queues.values()].reduce((sum, byDest) => sum + [...byDest.values()].reduce((a, b) => a + b, 0), 0);

    expect(sumQueued(state)).toBeGreaterThan(sumQueued(baseline) * 2);
  });

  test("era decay multiplier degrades segment condition, which slows vehicles over a long run", () => {
    const map = generateMap(11);
    const settlements = map.nodes.filter((node) => node.kind === "settlement");
    const waypoints = [settlements[0]!.id, settlements[1]!.id];
    const state = createSimulation(map, [{ id: "spine-1", waypoints, speed: 3, capacity: 20 }]);

    // A large decay multiplier over a long run should visibly degrade
    // condition below its starting value, without ever hitting zero
    // (decay is friction, not a route-killing failure state).
    for (let i = 0; i < 3000; i += 1) {
      tick(state, 1 / 30, undefined, undefined, {
        demand: 1,
        fuel: 1,
        buildCost: 1,
        decay: 50,
        paratransitPressure: 1,
        ambientTraffic: 0,
      });
    }

    const conditions = state.map.segments.map((segment) => segment.condition);
    expect(conditions.every((c) => c < 1)).toBe(true);
    expect(conditions.every((c) => c > 0)).toBe(true);
  });

  test("growth: a village a cyclic vehicle actually serves grows its demand multiplier and can promote it", () => {
    // A dedicated two-node map, not generateMap(): on the full procedural
    // map a village generates demand toward every other inhabited node,
    // and a single route can only ever serve the one destination it runs
    // -- served share stays a thin, EMA-invisible slice of total
    // generated demand. Isolating one village with exactly one other
    // inhabited node makes 100% of its demand reachable by the one route
    // that exists, which is what actually exercises growth's wiring
    // (tick -> pickup events -> growth samples -> updateGrowthState ->
    // demandMultiplierFor feeding back into growQueues) rather than
    // drowning it in unrelated destinations.
    const map = {
      seed: 0,
      terrain: {
        width: 1,
        height: 1,
        elevation: new Float32Array(1),
        water: new Uint8Array(1),
        settlementDensity: new Float32Array(1),
      },
      nodes: [
        { id: "village", kind: "village" as const, x: 0, y: 0 },
        { id: "settlement", kind: "settlement" as const, x: 4, y: 0 },
      ],
      corridors: [{ id: "corridor-1", nodeIds: ["village", "settlement"], polyline: [{ x: 0, y: 0 }, { x: 4, y: 0 }] }],
      segments: [
        {
          id: "seg-1",
          corridorId: "corridor-1",
          fromNodeId: "village",
          toNodeId: "settlement",
          type: "road" as const,
          level: "ground" as const,
          condition: 1,
          provenance: "inherited" as const,
        },
      ],
    };

    // Both a passenger route and a goods route: on this two-node map,
    // village demand is split between passengers and produce, and only a
    // vehicle whose `carries` matches a queue entry can ever load it --
    // serving just one kind structurally caps the service ratio well
    // below what's achievable, which isn't the thing this test wants to
    // exercise.
    const state = createSimulation(map, [
      { id: "shuttle", waypoints: ["village", "settlement"], speed: 4, capacity: 20 },
      { id: "lorry", waypoints: ["village", "settlement"], speed: 4, capacity: 20, carries: "goods" },
    ]);
    const growth = createGrowthState(map);

    let promoted = false;
    for (let i = 0; i < 9000 && !promoted; i += 1) {
      const promotions = tick(state, 1 / 30, undefined, undefined, undefined, growth);
      if (promotions.length > 0) promoted = true;
    }

    expect(demandMultiplierFor(growth, "village")).toBeGreaterThan(1);
    expect(promoted).toBe(true);
    expect(map.nodes.find((n) => n.id === "village")!.kind).toBe("settlement");
  });
});
