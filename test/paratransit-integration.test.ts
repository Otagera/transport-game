import { describe, expect, test } from "bun:test";
import { generateMap } from "@engine/map/generate";
import { createSimulation, tick } from "@engine/simulation/simulate";
import { createParatransitState } from "@engine/paratransit/types";
import { createEconomyState } from "@engine/economy/state";

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

  // Regression: caught live -- the tick() revenue loop originally credited
  // *any* vehicle's deliveries to the player's economy, including
  // paratransit's. Funds rose from ~1,000 to over 5,000 in 90 seconds
  // with zero player vehicles ever purchased, purely from informal
  // traffic nobody bought. Paratransit is an independent economy; it
  // must never pay the player.
  test("paratransit deliveries never accrue to the player's funds", () => {
    const map = generateMap(11);
    const state = createSimulation(map, []);
    const paratransit = createParatransitState();
    const economy = createEconomyState({ passengers: 5, produce: 3, supplies: 2 }, 1000);

    for (let i = 0; i < 3600; i += 1) {
      tick(state, 1 / 30, economy, paratransit);
    }

    // No player vehicle was ever purchased, so no operating cost should
    // have accrued either -- funds should sit exactly at the starting
    // amount despite (per the test above) paratransit having spawned,
    // moved, and delivered repeatedly over the same window.
    expect(economy.funds).toBe(1000);
    expect(economy.ledger.size).toBe(0);
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
