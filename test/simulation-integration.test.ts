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
});
