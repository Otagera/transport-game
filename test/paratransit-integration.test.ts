import { describe, expect, test } from "bun:test";
import { generateMap } from "@engine/map/generate";
import { createSimulation, tick } from "@engine/simulation/simulate";
import { createParatransitState } from "@engine/paratransit/types";

describe("paratransit integration", () => {
  test("leaving a map entirely unserved eventually fills it with one-shot informal traffic", () => {
    const map = generateMap(11);
    const state = createSimulation(map, []); // no player vehicles at all
    const paratransit = createParatransitState();

    let sawParatransit = false;
    let sawCompletion = false;
    for (let i = 0; i < 3600; i += 1) {
      // 120 simulated seconds
      tick(state, 1 / 30, undefined, paratransit);
      if (state.vehicles.some((v) => v.lifecycle === "one-shot")) sawParatransit = true;
      if (paratransit.active.size === 0 && sawParatransit) sawCompletion = true;
    }

    expect(sawParatransit).toBe(true);
    // The loop has an exit: at least one spawned vehicle finished its trip
    // and was reaped rather than accumulating forever.
    expect(sawCompletion).toBe(true);
    // Everything spawned is passengers-only.
    for (const vehicle of state.vehicles) {
      if (vehicle.lifecycle === "one-shot") {
        expect(vehicle.carries).toBe("passengers");
      }
    }
  });

  test("no demand-generating map produces no paratransit spawns", () => {
    const map = generateMap(11);
    // Zero out every node so nothing generates demand.
    const emptyMap = { ...map, nodes: map.nodes.filter((n) => n.kind === "junction") };
    const state = createSimulation(emptyMap, []);
    const paratransit = createParatransitState();

    for (let i = 0; i < 300; i += 1) {
      tick(state, 1 / 30, undefined, paratransit);
    }

    expect(state.vehicles.length).toBe(0);
  });
});
