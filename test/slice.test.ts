import { describe, expect, test } from "bun:test";
import { addBus, buildRoad, createSliceWorld, largestGapMidpoint, networkShare, removeBus, roadCost, routeSummaries, townOutcomes, tripsFrom, waitingAt, diagnoseRoute } from "@engine/slice/world";
import { sliceTick } from "@engine/slice/tick";
import { DEFAULT_SLICE_TUNING } from "@engine/slice/tuning";
import type { SliceMapDef, SliceTuning, SliceWorld } from "@engine/slice/types";
import { SIM_DT } from "@engine/loop";
import { insertIntoPath } from "@engine/slice/settlement";
import type { Vehicle } from "@engine/simulation/types";

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
    const cut = townOutcomes(w, "cut");
    expect(cut.lost).toBeGreaterThan(0);
    expect(cut.player).toBe(0);
    expect(cut.poached + cut.gaveUp).toBe(0);
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
    const cut = townOutcomes(w, "cut");
    expect(cut.poached + cut.gaveUp).toBeGreaterThan(0);
  });
});

describe("slice: where people want to go", () => {
  test("each trip's share says who carries it", () => {
    const w = world({ startingFunds: 1e6 });
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    run(w, 300);
    const trips = new Map(tripsFrom(w, "big").map((trip) => [trip.to, trip]));
    // Biggest trip first, and every other town listed.
    expect(tripsFrom(w, "big")[0]!.to).toBe("mid");
    expect(trips.size).toBe(3);
    // Served by your buses.
    expect(trips.get("mid")!.share.player).toBeGreaterThan(0.3);
    // Reachable by road but not on your route: danfos.
    expect(trips.get("far")!.share.player).toBe(0);
    expect(trips.get("far")!.share.informal).toBeGreaterThan(0);
    // No road: everyone stays home.
    expect(trips.get("cut")!.share.lost).toBeCloseTo(1);
  });
});

describe("slice: why a route earns what it does", () => {
  test("too many buses on a route reads as overcapacity", () => {
    const w = world({ startingFunds: 1e6 });
    for (let i = 0; i < 12; i += 1) addBus(w, "big", "mid");
    run(w, 300);
    const d = diagnoseRoute(w, w.routes[0]!.id)!;
    expect(d.verdict).toBe("overcapacity");
    expect(d.loadFactor).toBeLessThan(0.35);
  });

  test("a route whose every possible rider can't pay its running cost reads as thin", () => {
    const w = world({ startingFunds: 1e6, busOperatingCostPerSecond: 50 });
    addBus(w, "mid", "far");
    run(w, 120);
    expect(diagnoseRoute(w, w.routes[0]!.id)!.verdict).toBe("thin");
  });

  test("a route's outcome shares cover all its riders", () => {
    const w = world();
    addBus(w, "big", "mid");
    run(w, 300);
    const d = diagnoseRoute(w, w.routes[0]!.id)!;
    expect(d.carried + d.poached + d.gaveUp + d.lost).toBeCloseTo(1);
    expect(d.boardingsPerDay).toBeGreaterThan(0);
  });
});

describe("slice: towns along busy roads", () => {
  // Thresholds lowered for the small test map; what's pinned is the rule,
  // not this map's calibration.
  const growing = { startingFunds: 1e6, foundTownFlow: 1, foundTownPlayerFlow: 0.3, minSecondsBetweenTowns: 0 };

  test("a busy road you run buses on grows a town, splitting the road, and your buses stop there", () => {
    const w = world(growing);
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    const events: string[] = [];
    for (let t = 0; t < 400; t += SIM_DT) for (const event of sliceTick(w, SIM_DT)) events.push(event.kind);
    expect(events).toContain("founded");
    const town = [...w.towns.values()].find((candidate) => w.settlement.emergent.has(candidate.id))!;
    expect(town.x).toBeCloseTo(22);
    // The road is now big-town-mid, and the route passes through.
    expect(w.simulation.map.segments.some((s) => s.fromNodeId === "big" && s.toNodeId === "mid")).toBe(false);
    const bus = w.simulation.vehicles.find((vehicle) => vehicle.lifecycle === "cyclic")!;
    expect(bus.path).toContain(town.id);
    // It wants trips like any town, and you carry some of them.
    expect(tripsFrom(w, town.id).length).toBe(w.towns.size - 1);
    run(w, 200);
    expect(townOutcomes(w, town.id).player).toBeGreaterThan(0);
  });

  test("danfo traffic alone never founds a town", () => {
    const w = world(growing);
    run(w, 400);
    expect(w.settlement.emergent.size).toBe(0);
  });

  test("never more than the cap, never closer than the spacing", () => {
    const w = world({ ...growing, maxEmergentTowns: 1 });
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    for (let i = 0; i < 3; i += 1) addBus(w, "mid", "far");
    run(w, 600);
    expect(w.settlement.emergent.size).toBe(1);
    const nodes = w.simulation.map.nodes;
    for (const a of nodes) for (const b of nodes) {
      if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(w.tuning.townSpacingCells - 1e-9);
    }
  });

  test("an emergent town that shrinks away is abandoned: a ruin on a junction, no trips", () => {
    const w = world(growing);
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    run(w, 400);
    const townId = [...w.settlement.emergent][0]!;
    w.towns.get(townId)!.population = 0.5;
    w.tuning = { ...w.tuning, populationPerFlow: 0 };
    const events: string[] = [];
    for (let t = 0; t < 60; t += SIM_DT) for (const event of sliceTick(w, SIM_DT)) events.push(event.kind);
    expect(events).toContain("abandoned");
    expect(w.towns.has(townId)).toBe(false);
    expect(w.ruins.has(townId)).toBe(true);
    expect(w.simulation.map.nodes.find((node) => node.id === townId)!.kind).toBe("junction");
    expect(w.simulation.demand.some((pair) => pair.from === townId || pair.to === townId)).toBe(false);
    // Buses still run through the bend.
    run(w, 60);
    expect(routeSummaries(w)[0]!.incomePerDay).toBeGreaterThan(0);
  });
});

describe("slice: inserting a town into a vehicle's path", () => {
  const vehicle = (path: string[], pathIndex: number, edgeProgress: number, lifecycle: "cyclic" | "one-shot" = "cyclic") =>
    ({ id: "v", path, pathIndex, edgeProgress, speed: 1, capacity: 1, cargo: [], carries: "passengers", congestionWeight: 1, lifecycle }) as Vehicle;

  test("splits both directions of a shuttle, including the wrap-around", () => {
    const v = vehicle(["a", "b"], 1, 0.2);
    insertIntoPath(v, "a", "b", "m");
    expect(v.path).toEqual(["a", "m", "b", "m"]);
  });

  test("a vehicle in the first half of a split edge lands on the first half", () => {
    const v = vehicle(["a", "b"], 1, 0.2); // a -> b, 20% along
    insertIntoPath(v, "a", "b", "m");
    expect(v.path[v.pathIndex]).toBe("m");
    expect(v.edgeProgress).toBeCloseTo(0.4);
  });

  test("a vehicle in the second half lands on the second half", () => {
    const v = vehicle(["a", "b"], 1, 0.8);
    insertIntoPath(v, "a", "b", "m");
    expect(v.path[v.pathIndex]).toBe("b");
    expect(v.path[v.pathIndex - 1]).toBe("m");
    expect(v.edgeProgress).toBeCloseTo(0.6);
  });

  test("on the wrap-around edge, it lands on the right half", () => {
    const early = vehicle(["a", "b"], 0, 0.25); // b -> a
    insertIntoPath(early, "a", "b", "m");
    expect(early.path[early.pathIndex]).toBe("m");
    expect(early.path[(early.pathIndex - 1 + early.path.length) % early.path.length]).toBe("b");
    const late = vehicle(["a", "b"], 0, 0.75);
    insertIntoPath(late, "a", "b", "m");
    expect(late.path[late.pathIndex]).toBe("a");
    expect(late.path[(late.pathIndex - 1 + late.path.length) % late.path.length]).toBe("m");
  });

  test("a one-shot path gets the town only where it crosses that road", () => {
    const v = vehicle(["x", "a", "b"], 1, 0.5, "one-shot");
    insertIntoPath(v, "a", "b", "m");
    expect(v.path).toEqual(["x", "a", "m", "b"]);
    expect(v.path[v.pathIndex]).toBe("a");
  });
});
