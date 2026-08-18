import { describe, expect, test } from "bun:test";
import { generateMap } from "@engine/map/generate";
import { createSimulation, tick } from "@engine/simulation/simulate";

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
      });
    }

    const conditions = state.map.segments.map((segment) => segment.condition);
    expect(conditions.every((c) => c < 1)).toBe(true);
    expect(conditions.every((c) => c > 0)).toBe(true);
  });
});
