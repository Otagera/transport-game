import { describe, expect, test } from "bun:test";
import { addBus, buildRoad, createSliceWorld, largestGapMidpoint, networkShare, removeBus, roadCost, routeSummaries, waitingAt } from "@engine/slice/world";
import { sliceTick } from "@engine/slice/tick";
import { DEFAULT_SLICE_TUNING } from "@engine/slice/tuning";
import type { SliceMapDef, SliceTuning, SliceWorld } from "@engine/slice/types";
import { SIM_DT } from "@engine/loop";

// Tests that pin what the player should *feel*, not just that the
// mechanics run (docs/principles.md §6): bounded queues, a frequency
// optimum, danfos filling gaps, unconnected towns staying home.

const MAP: SliceMapDef = {
  width: 60,
  height: 40,
  towns: [
    { id: "big", name: "Big", x: 10, y: 20, population: 100 },
    { id: "mid", name: "Mid", x: 34, y: 20, population: 50 },
    { id: "far", name: "Far", x: 50, y: 5, population: 20 },
    { id: "cut", name: "Cut", x: 50, y: 35, population: 20 },
  ],
  roads: [
    { a: "big", b: "mid" },
    { a: "mid", b: "far" },
  ],
};

function run(world: SliceWorld, seconds: number): void {
  for (let t = 0; t < seconds; t += SIM_DT) sliceTick(world, SIM_DT);
}

function world(overrides: Partial<SliceTuning> = {}): SliceWorld {
  return createSliceWorld(MAP, { ...DEFAULT_SLICE_TUNING, ...overrides });
}

describe("slice: waiting passengers", () => {
  test("queues settle instead of growing without bound", () => {
    const w = world();
    run(w, 200);
    const early = waitingAt(w, "big");
    run(w, 200);
    const late = waitingAt(w, "big");
    expect(late).toBeGreaterThan(0);
    expect(Math.abs(late - early) / early).toBeLessThan(0.05);
  });

  test("a town no road reaches only ever stays home", () => {
    const w = world();
    run(w, 120);
    const cut = w.outcomes.get("cut")!;
    expect(cut.lost).toBeGreaterThan(0);
    expect(cut.player).toBe(0);
    expect(cut.informal).toBe(0);
  });
});

describe("slice: danfos", () => {
  test("with no player service, danfos carry the people who gave up", () => {
    const w = world();
    run(w, 120);
    expect(networkShare(w).informal).toBeGreaterThan(0.3);
    expect(w.informal.earnings).toBeGreaterThan(0);
    expect(w.simulation.vehicles.some((vehicle) => vehicle.lifecycle === "one-shot")).toBe(true);
  });

  test("danfo fares never reach the player's funds", () => {
    const w = world();
    const before = w.economy.funds;
    run(w, 120);
    expect(w.economy.funds).toBe(before);
  });

  test("serving a route shrinks the danfo share", () => {
    const idle = world();
    run(idle, 300);
    const served = world({ startingFunds: 1e6 });
    for (let i = 0; i < 3; i += 1) addBus(served, "big", "mid");
    run(served, 300);
    expect(networkShare(served).informal).toBeLessThan(networkShare(idle).informal);
    expect(networkShare(served).player).toBeGreaterThan(0);
  });
});

describe("slice: buses and money", () => {
  test("a bus on the strong route earns more than it costs to run", () => {
    const w = world();
    addBus(w, "big", "mid");
    run(w, 300);
    const [route] = routeSummaries(w);
    expect(route!.netPerDay).toBeGreaterThan(0);
  });

  test("more buses buy share with diminishing returns, and enough of them lose money", () => {
    const income = (n: number) => {
      const w = world({ startingFunds: 1e6 });
      for (let i = 0; i < n; i += 1) addBus(w, "big", "mid");
      run(w, 600);
      return routeSummaries(w)[0]!;
    };
    const one = income(1);
    const three = income(3);
    const twelve = income(12);
    expect(three.incomePerDay).toBeGreaterThan(one.incomePerDay);
    // Diminishing: twelve buses earn far less than 4x three buses.
    expect(twelve.incomePerDay).toBeLessThan(three.incomePerDay * 2);
    expect(twelve.netPerDay).toBeLessThan(0);
  });

  test("new buses spread out round the route instead of running as a convoy", () => {
    expect(largestGapMidpoint([])).toBe(0);
    expect(largestGapMidpoint([0])).toBeCloseTo(0.5);
    // Two equal gaps: either midpoint is a correct answer.
    expect([0.25, 0.75]).toContain(largestGapMidpoint([0, 0.5]));
    expect(largestGapMidpoint([0.9, 0.1])).toBeCloseTo(0.5);
  });

  test("selling a bus refunds less than it cost and drops an emptied route", () => {
    const w = world();
    addBus(w, "big", "mid");
    run(w, 60);
    const routeId = w.routes[0]!.id;
    const refund = removeBus(w, routeId);
    expect(refund).toBeGreaterThan(0);
    expect(refund).toBeLessThan(DEFAULT_SLICE_TUNING.busPurchaseCost);
    expect(w.routes).toHaveLength(0);
  });

  test("a bus can't run where no road goes, and refusals cost nothing", () => {
    const w = world();
    const before = w.economy.funds;
    expect(addBus(w, "big", "cut")).toEqual({ ok: false, reason: "no road between them" });
    expect(w.economy.funds).toBe(before);
  });
});

describe("slice: roads", () => {
  test("building a road charges exactly the previewed cost and connects the town", () => {
    const w = world();
    const cost = roadCost(w, "mid", "cut");
    const before = w.economy.funds;
    expect(buildRoad(w, "mid", "cut").ok).toBe(true);
    expect(w.economy.funds).toBe(before - cost);
    expect(addBus(w, "big", "cut").ok).toBe(true);
  });

  test("connecting a cut-off town lets danfos in", () => {
    const w = world({ startingFunds: 1e6 });
    buildRoad(w, "mid", "cut");
    run(w, 200);
    expect(w.outcomes.get("cut")!.informal).toBeGreaterThan(0);
  });
});
