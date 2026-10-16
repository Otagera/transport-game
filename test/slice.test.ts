import { describe, expect, test } from "bun:test";
import { addBus, buildRoad, createSliceWorld, largestGapMidpoint, networkShare, removeBus, roadCost, routeSummaries, townOutcomes, tripsFrom, waitingAt, diagnoseRoute, isCutOff, debtAdvice, demandAlong, throughRoute, pairDemand, paveRoad, paveCost, checkPave, dirtRoadsOn, localTravel } from "@engine/slice/world";
import { sliceTick } from "@engine/slice/tick";
import { DEFAULT_SLICE_TUNING } from "@engine/slice/tuning";
import type { SliceMapDef, SliceTuning, SliceWorld } from "@engine/slice/types";
import { SIM_DT } from "@engine/loop";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import { insertIntoPath } from "@engine/slice/settlement";
import { routesOnTrip, tripPlans } from "@engine/slice/transfers";
import { roadCapacity, speedFactor } from "@engine/slice/congestion";
import { planRoad, polylineLength, segmentLength, segmentPolyline } from "@engine/slice/roads";
import { bridgeCellsOn, repairCost, setMaintained, upkeepPerDay, wearRate } from "@engine/slice/wear";
import { computeBurnRate } from "@engine/economy/report";
import { townGrowth } from "@engine/slice/growth";
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

  test("a bus on a thin feeder costs more to run than it earns, and the route says why", () => {
    const w = world();
    addBus(w, "mid", "far");
    run(w, 600);
    expect(routeSummaries(w)[0]!.netPerDay).toBeLessThan(0);
    expect(diagnoseRoute(w, w.routes[0]!.id)!.verdict).toBe("thin");
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
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    run(w, 300);
    const trips = new Map(tripsFrom(w, "big").map((trip) => [trip.to, trip]));
    // Biggest trip first, and every other town listed.
    expect(tripsFrom(w, "big")[0]!.to).toBe("mid");
    expect(trips.size).toBe(3);
    // Served by your buses.
    expect(trips.get("mid")!.share.player).toBeGreaterThan(0.3);
    // Reachable by road but not on your route: the informal sector.
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

  test("a route one bus can't pay for, even catching all it realistically can, reads as thin", () => {
    // ~₦60/day to run against a ~₦88/day ceiling: the whole ceiling would
    // cover it, but one bus never catches the whole ceiling.
    const w = world({ startingFunds: 1e6, busOperatingCostPerSecond: 2 });
    addBus(w, "mid", "far");
    run(w, 120);
    const d = diagnoseRoute(w, w.routes[0]!.id)!;
    expect(d.ceilingPerDay).toBeGreaterThan(routeSummaries(w)[0]!.costPerDay);
    expect(d.verdict).toBe("thin");
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
    // No per-road record outlives the road it described.
    const live = new Set(w.simulation.map.segments.map((s) => s.id));
    for (const record of [w.roadFlowEMA, w.settlement.segmentFlowEMA, w.informal.segmentSpace, w.upkeepRateEMA, w.bridgeCells]) {
      for (const id of record.keys()) expect(live.has(id)).toBe(true);
    }
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

describe("slice: transfers", () => {
  function network(): SliceWorld {
    // Fixed towns: these pin how transfers work, not how growth moves demand.
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0 });
    for (let i = 0; i < 2; i += 1) addBus(w, "big", "mid");
    for (let i = 0; i < 2; i += 1) addBus(w, "mid", "far");
    return w;
  }

  test("a rider with no direct route plans to change buses at the interchange", () => {
    const w = network();
    const plans = tripPlans(w);
    expect(plans.rides.get("big")!.get("far")).toBe(2);
    expect(plans.alight.get("big")!.get("far")!.get(w.routes[0]!.id)).toBe("mid");
    expect(routesOnTrip(w, "big", "far")).toEqual(new Set([w.routes[0]!.id, w.routes[1]!.id]));
  });

  test("riders take the fewest buses: a direct route beats a change", () => {
    const w = network();
    addBus(w, "big", "far"); // runs big-mid-far on the roads
    expect(tripPlans(w).rides.get("big")!.get("far")).toBe(1);
  });

  test("riders actually change buses and arrive, and both legs earn", () => {
    const w = network();
    run(w, 400);
    const trip = tripsFrom(w, "big").find((candidate) => candidate.to === "far")!;
    expect(trip.share.player).toBeGreaterThan(0.1);
    // The feeder's diagnosis counts the riders it hands on.
    const feeder = diagnoseRoute(w, w.routes[0]!.id)!;
    const ownTripsOnly = pairDemandOn(w, ["big", "mid"]);
    expect(feeder.demand).toBeGreaterThan(ownTripsOnly);
  });

  test("a missed connection can be lost: riders waiting at the interchange give up too", () => {
    const w = network();
    run(w, 400);
    const trip = townOutcomes(w, "big");
    expect(trip.gaveUp + trip.lost).toBeGreaterThan(0);
  });

  test("a trip two routes serve equally well counts toward both routes", () => {
    const w = network();
    addBus(w, "big", "far"); // big-mid-far: serves big->mid as well as big-mid does
    const direct = w.routes.find((route) => route.id.includes("far") && route.id.includes("big"))!;
    const shuttle = w.routes.find((route) => route.id.includes("big") && route.id.includes("mid"))!;
    const on = routesOnTrip(w, "big", "mid");
    expect(on.has(direct.id)).toBe(true);
    expect(on.has(shuttle.id)).toBe(true);
    run(w, 200);
    expect(diagnoseRoute(w, direct.id)!.demand).toBeGreaterThan(0);
    expect(diagnoseRoute(w, shuttle.id)!.demand).toBeGreaterThan(0);
  });

  test("the plan goes stale when routes change, and is rebuilt", () => {
    const w = network();
    tripPlans(w);
    removeBus(w, w.routes[1]!.id);
    removeBus(w, w.routes[1]!.id);
    expect(w.plans).toBeNull();
    expect(tripPlans(w).rides.get("big")?.get("far")).toBeUndefined();
  });
});

function pairDemandOn(w: SliceWorld, towns: string[]): number {
  return w.simulation.demand.filter((pair) => towns.includes(pair.from) && towns.includes(pair.to)).reduce((sum, pair) => sum + pair.rate, 0);
}

describe("slice: kekes and okadas", () => {
  test("riders who won't wait for a danfo to fill take kekes and okadas instead of going home", () => {
    const w = world({ maxEmergentTowns: 0 });
    run(w, 300);
    const modes = new Set([...w.informal.active.values()].map((info) => info.mode));
    expect(modes.has("okada") || modes.has("keke")).toBe(true);
    // Every connected trip is mostly informal, not stayed-home.
    const far = tripsFrom(w, "big").find((trip) => trip.to === "far")!;
    expect(far.share.informal).toBeGreaterThan(far.share.lost);
  });

  test("road space caps the informal sector in danfo-equivalents", () => {
    const w = world({ maxEmergentTowns: 0, informalRoadSpace: 1 });
    for (let t = 0; t < 120; t += SIM_DT) {
      sliceTick(w, SIM_DT);
      for (const used of w.informal.segmentSpace.values()) expect(used).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  test("with no road, nobody takes them -- not even an okada", () => {
    const w = world({ maxEmergentTowns: 0 });
    run(w, 200);
    expect(townOutcomes(w, "cut").lost).toBeGreaterThan(0);
    expect(townOutcomes(w, "cut").gaveUp).toBe(0);
  });
});

describe("slice: shared road", () => {
  test("speed follows the BPR curve: free flow, then a sharp fall, never below the floor", () => {
    expect(speedFactor(0, 1, 0.15)).toBe(1);
    expect(speedFactor(0.5, 1, 0.15)).toBeGreaterThan(0.99);
    expect(speedFactor(1, 1, 0.15)).toBeCloseTo(1 / 1.15);
    expect(speedFactor(2, 1, 0.15)).toBeLessThan(speedFactor(1.5, 1, 0.15));
    expect(speedFactor(100, 1, 0.15)).toBe(0.15);
  });

  test("piling buses onto one road slows it, and the route says so", () => {
    const light = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    addBus(light, "big", "mid");
    run(light, 300);
    const heavy = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    for (let i = 0; i < 16; i += 1) addBus(heavy, "big", "mid");
    run(heavy, 300);
    expect(heavy.routes[0]!.speedEMA).toBeLessThan(light.routes[0]!.speedEMA - 0.15);
    expect(diagnoseRoute(heavy, heavy.routes[0]!.id)!.speed).toBeLessThan(0.8);
  });

  test("one bus never locks a road at the floor (congestion is stable)", () => {
    const w = world({ startingFunds: 1e6 });
    addBus(w, "big", "mid");
    run(w, 600);
    for (const speed of w.segmentSpeed.values()) expect(speed).toBeGreaterThan(0.5);
  });

  test("a built road carries more than an inherited dirt one", () => {
    const w = world();
    buildRoad(w, "mid", "cut");
    const dirt = w.simulation.map.segments.find((s) => s.provenance === "inherited")!;
    const built = w.simulation.map.segments.find((s) => s.provenance === "built")!;
    expect(roadCapacity(w, built.id)).toBeGreaterThan(roadCapacity(w, dirt.id));
  });

  test("an informal operator won't set off into a jam", () => {
    const w = world({ maxEmergentTowns: 0, informalMinSpeed: 1.01 }); // every road counts as too slow
    run(w, 200);
    expect(w.informal.active.size).toBe(0);
  });

  test("with congestion off, roads always run at free speed", () => {
    const w = world({ startingFunds: 1e6, congestion: false });
    for (let i = 0; i < 16; i += 1) addBus(w, "big", "mid");
    run(w, 200);
    for (const speed of w.segmentSpeed.values()) expect(speed).toBe(1);
  });
});

describe("slice: paving a dirt road", () => {
  test("paving charges the previewed price and makes the road carry what a built one does", () => {
    const w = world();
    const before = w.economy.funds;
    const price = paveCost(w, "big", "mid");
    expect(paveRoad(w, "big", "mid").ok).toBe(true);
    expect(w.economy.funds).toBe(before - price);
    const paved = w.simulation.map.segments.find((s) => s.fromNodeId === "big" && s.toNodeId === "mid")!;
    buildRoad(w, "mid", "cut");
    const built = w.simulation.map.segments.find((s) => s.toNodeId === "cut")!;
    expect(roadCapacity(w, paved.id)).toBe(roadCapacity(w, built.id));
  });

  test("it refuses what isn't a dirt road between neighbours, and refusals cost nothing", () => {
    const w = world();
    const before = w.economy.funds;
    expect(checkPave(w, "big", "far")).toEqual({ ok: false, reason: "no road joins them directly" });
    expect(paveRoad(w, "mid", "cut")).toEqual({ ok: false, reason: "no road joins them directly" });
    expect(w.economy.funds).toBe(before);
    paveRoad(w, "big", "mid");
    const after = w.economy.funds;
    expect(paveRoad(w, "big", "mid")).toEqual({ ok: false, reason: "already paved" });
    expect(w.economy.funds).toBe(after);
    const poor = world({ startingFunds: 10 });
    expect(paveRoad(poor, "big", "mid")).toEqual({ ok: false, reason: "can't afford it" });
    expect(poor.economy.funds).toBe(10);
  });

  test("paving a road your buses jam lifts their speed, and the route stops listing it as dirt", () => {
    const run16 = (pave: boolean) => {
      const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
      if (pave) paveRoad(w, "big", "mid");
      for (let i = 0; i < 16; i += 1) addBus(w, "big", "mid");
      run(w, 300);
      return w;
    };
    const dirt = run16(false);
    const paved = run16(true);
    expect(paved.routes[0]!.speedEMA).toBeGreaterThan(dirt.routes[0]!.speedEMA + 0.1);
    expect(dirtRoadsOn(dirt, dirt.routes[0]!.id)).toEqual([{ a: "big", b: "mid" }]);
    expect(dirtRoadsOn(paved, paved.routes[0]!.id)).toEqual([]);
  });

  test("a town founded on a paved road leaves both halves paved", () => {
    const w = world({ startingFunds: 1e6, foundTownFlow: 1, foundTownPlayerFlow: 0.3, minSecondsBetweenTowns: 0 });
    paveRoad(w, "big", "mid");
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    run(w, 400);
    const town = [...w.settlement.emergent][0]!;
    const halves = w.simulation.map.segments.filter((s) => s.fromNodeId === town || s.toNodeId === town);
    expect(halves.length).toBe(2);
    for (const half of halves) expect(half.provenance).toBe("built");
  });
});

describe("slice: inside towns", () => {
  test("every town has inside trips, more of them than it sends to every other town", () => {
    const w = world();
    for (const id of ["big", "mid", "far", "cut"]) {
      const between = tripsFrom(w, id).reduce((sum, trip) => sum + trip.demand, 0) * SECONDS_PER_GAME_DAY;
      expect(localTravel(w, id).tripsPerDay).toBeGreaterThan(between);
    }
  });

  test("in a bigger town, more of your riders reach the bus by keke or okada", () => {
    const w = world();
    expect(localTravel(w, "big").firstMileShare).toBeGreaterThan(localTravel(w, "far").firstMileShare);
  });

  test("they feed your buses once you run some, and never touch your share or your money", () => {
    const quiet = world({ maxEmergentTowns: 0 });
    run(quiet, 300);
    expect(localTravel(quiet, "big").feederPerDay).toBe(0);
    const served = world({ maxEmergentTowns: 0 });
    addBus(served, "big", "mid");
    run(served, 300);
    expect(localTravel(served, "big").feederPerDay).toBeGreaterThan(0);
    // Inside trips are display only: changing their size changes nothing else.
    const bigger = world({ maxEmergentTowns: 0, localTripsPerThousandPerDay: 1000, walkableTownPopulation: 1 });
    addBus(bigger, "big", "mid");
    run(bigger, 300);
    expect(networkShare(bigger)).toEqual(networkShare(served));
    expect(bigger.economy.funds).toBe(served.economy.funds);
  });
});

describe("slice: terrain (step 3)", () => {
  // West and east banks of a river; a hill sits between south and its neighbours.
  const TERRAIN_MAP: SliceMapDef = {
    width: 60,
    height: 40,
    towns: [
      { id: "west", name: "West", x: 8, y: 10, population: 100 },
      { id: "east", name: "East", x: 40, y: 10, population: 60 },
      { id: "sw", name: "Sw", x: 4, y: 32, population: 50 },
      { id: "se", name: "Se", x: 28, y: 32, population: 50 },
    ],
    roads: [{ a: "west", b: "sw" }],
    terrain: {
      rivers: [{ points: [[24, -2], [24, 42]], width: 3 }],
      hills: [{ x: 16, y: 32, radius: 7, height: 4 }],
    },
  };
  const terrainWorld = (overrides: Partial<SliceTuning> = {}) => createSliceWorld(TERRAIN_MAP, { ...DEFAULT_SLICE_TUNING, startingFunds: 1e6, ...overrides });

  test("crossing water costs a bridge, the quote says so, and the quote is the charge", () => {
    const w = terrainWorld();
    const plan = planRoad(w, "west", "east")!;
    expect(plan.bridgeCells).toBeGreaterThanOrEqual(3);
    expect(plan.bridgeCost).toBeGreaterThan(0);
    // Dearer than the same length of dry road.
    expect(plan.cost).toBeGreaterThan(plan.length * w.tuning.roadCostPerCell * 1.2);
    const before = w.economy.funds;
    expect(buildRoad(w, "west", "east").ok).toBe(true);
    expect(w.economy.funds).toBe(before - plan.cost);
  });

  test("a road with a bridge wears faster and costs more to keep than dry road (principles §3, Bridges)", () => {
    const w = terrainWorld();
    buildRoad(w, "west", "east");
    paveRoad(w, "west", "sw"); // the inherited road on the west bank: dry, and now paved like the other
    const wet = w.simulation.map.segments.find((s) => s.fromNodeId === "west" && s.toNodeId === "east")!;
    const dry = w.simulation.map.segments.find((s) => s.fromNodeId === "west" && s.toNodeId === "sw")!;
    expect(bridgeCellsOn(w, dry)).toBe(0);
    expect(bridgeCellsOn(w, wet)).toBeGreaterThan(0);
    // No traffic yet: weather alone, both paved.
    expect(wearRate(w, wet)).toBeCloseTo(wearRate(w, dry) * DEFAULT_SLICE_TUNING.bridgeWearMultiplier);
    expect(repairCost(w, wet, 0.5) / wet.length!).toBeGreaterThan(repairCost(w, dry, 0.5) / segmentLength(w, dry));
  });

  test("water wider than a bridge can span can't be crossed, and the refusal says why", () => {
    const wide: SliceMapDef = { ...TERRAIN_MAP, towns: TERRAIN_MAP.towns.slice(0, 2), roads: [], terrain: { rivers: [{ points: [[24, -2], [24, 42]], width: 20 }] } };
    const w = createSliceWorld(wide, { ...DEFAULT_SLICE_TUNING, startingFunds: 1e6 });
    expect(buildRoad(w, "west", "east")).toEqual({ ok: false, reason: "the water is too wide to bridge here" });
  });

  test("the cheapest road bends round a hill, and the bend is a longer trip for the buses on it", () => {
    const w = terrainWorld({ maxEmergentTowns: 0 });
    const plan = planRoad(w, "sw", "se")!;
    expect(plan.length).toBeGreaterThan(24 * 1.05); // the straight line is 24
    buildRoad(w, "sw", "se");
    const edge = w.simulation.routing.graph.get("sw")!.find((e) => e.to === "se")!;
    expect(edge.weight).toBeCloseTo(plan.length);
    // A bus covers the bent road at its speed: progress after 1s is speed/length, not speed/24.
    addBus(w, "sw", "se");
    const bus = w.simulation.vehicles.find((v) => v.lifecycle === "cyclic")!;
    const start = bus.edgeProgress;
    run(w, 1);
    expect(bus.edgeProgress - start).toBeCloseTo((w.tuning.busSpeed * 1) / plan.length, 2);
  });

  test("an inherited road stays straight, whatever the terrain", () => {
    const w = terrainWorld();
    const road = w.simulation.map.segments.find((s) => s.provenance === "inherited")!;
    expect(road.length).toBeUndefined();
    expect(segmentPolyline(w.simulation.map, road)).toHaveLength(2);
  });

  test("a road whose middle is a bridge never grows a town in the river", () => {
    const w = terrainWorld({ foundTownFlow: 1, foundTownPlayerFlow: 0.3, minSecondsBetweenTowns: 0 });
    buildRoad(w, "west", "east");
    for (let i = 0; i < 4; i += 1) addBus(w, "west", "east");
    run(w, 400);
    // Busy enough to found a town on any other road...
    const road = w.simulation.map.segments.find((s) => s.provenance === "built")!;
    expect(w.settlement.segmentFlowEMA.get(road.id)!).toBeGreaterThan(1);
    expect(w.settlement.segmentPlayerFlowEMA.get(road.id)!).toBeGreaterThan(0.3);
    // ...but its middle is the river.
    expect(w.settlement.emergent.size).toBe(0);
  });

  test("a town founded on a bent road stands on it, and its halves add up to the road", () => {
    const w = terrainWorld({ foundTownFlow: 1, foundTownPlayerFlow: 0.3, minSecondsBetweenTowns: 0 });
    buildRoad(w, "sw", "se");
    const road = w.simulation.map.segments.find((s) => s.provenance === "built")!;
    const line = segmentPolyline(w.simulation.map, road);
    const length = road.length!;
    for (let i = 0; i < 3; i += 1) addBus(w, "sw", "se");
    run(w, 400);
    const town = [...w.settlement.emergent].map((id) => w.towns.get(id)!)[0];
    expect(town).toBeDefined();
    const toSegment = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((town!.x - a.x) * dx + (town!.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(town!.x - (a.x + t * dx), town!.y - (a.y + t * dy));
    };
    const nearest = Math.min(...line.slice(1).map((p, i) => toSegment(line[i]!, p)));
    expect(nearest).toBeLessThan(1e-6);
    const halves = w.simulation.map.segments.filter((s) => s.fromNodeId === town!.id || s.toNodeId === town!.id);
    expect(halves.reduce((sum, s) => sum + (s.length ?? 0), 0)).toBeCloseTo(length, 1);
    for (const half of halves) expect(polylineLength(segmentPolyline(w.simulation.map, half))).toBeCloseTo(half.length!, 5);
  });
});

describe("slice: wear (step 4)", () => {
  const road = (w: SliceWorld, a: string, b: string) =>
    w.simulation.map.segments.find((s) => (s.fromNodeId === a && s.toNodeId === b) || (s.fromNodeId === b && s.toNodeId === a))!;
  const calm = { startingFunds: 1e6, maxEmergentTowns: 0 };

  test("the inherited network arrives worn; a road you build arrives new", () => {
    const w = world(calm);
    expect(road(w, "big", "mid").condition).toBe(DEFAULT_SLICE_TUNING.inheritedRoadCondition);
    buildRoad(w, "mid", "cut");
    expect(road(w, "mid", "cut").condition).toBe(1);
  });

  test("wear follows use: a busy road wears faster than a quiet one, dirt faster than paved", () => {
    const w = world(calm);
    for (let i = 0; i < 4; i += 1) addBus(w, "big", "mid");
    run(w, 60);
    expect(wearRate(w, road(w, "big", "mid"))).toBeGreaterThan(wearRate(w, road(w, "mid", "far")));
    const dirtRate = wearRate(w, road(w, "big", "mid"));
    paveRoad(w, "big", "mid");
    expect(wearRate(w, road(w, "big", "mid"))).toBeCloseTo(dirtRate / DEFAULT_SLICE_TUNING.dirtWearMultiplier);
  });

  test("a worn road slows the buses on it, down to a floor", () => {
    const progressIn1s = (condition: number) => {
      const w = world({ ...calm, congestion: false, wearPerFlow: 0, weatherPerSecond: 0 });
      road(w, "big", "mid").condition = condition;
      addBus(w, "big", "mid");
      const bus = w.simulation.vehicles.find((v) => v.lifecycle === "cyclic")!;
      const start = bus.edgeProgress;
      run(w, 1);
      return bus.edgeProgress - start;
    };
    expect(progressIn1s(0.3)).toBeLessThan(progressIn1s(1) * 0.8);
    expect(progressIn1s(0.3)).toBeGreaterThan(progressIn1s(1) * 0.6);
  });

  test("left alone, a busy road wears to the floor and the route says it's worn", () => {
    const w = world(calm);
    for (let i = 0; i < 2; i += 1) addBus(w, "big", "mid");
    run(w, 1200);
    expect(road(w, "big", "mid").condition).toBeCloseTo(0.3);
    expect(diagnoseRoute(w, w.routes[0]!.id)!.wornSpeed).toBeLessThan(0.8);
  });

  test("maintaining a road repairs it now for the quoted price, then keeps it new for upkeep that shows in net/day", () => {
    const w = world(calm);
    for (let i = 0; i < 2; i += 1) addBus(w, "big", "mid");
    run(w, 120);
    const trunk = road(w, "big", "mid");
    const quote = repairCost(w, trunk, 1 - trunk.condition);
    const before = w.economy.funds;
    expect(setMaintained(w, trunk.id, true)).toEqual({ ok: true, charged: quote });
    expect(w.economy.funds).toBe(before - quote);
    const costBefore = computeBurnRate(w.economy).costPerDay;
    run(w, 300);
    expect(trunk.condition).toBe(1);
    expect(upkeepPerDay(w, trunk)).toBeGreaterThan(0);
    // Upkeep is a running cost: the burn rate now carries it on top of the buses.
    expect(computeBurnRate(w.economy).costPerDay).toBeGreaterThan(costBefore + upkeepPerDay(w, trunk) * 0.5);
    // Stopping costs nothing, and the road wears again.
    const funds = w.economy.funds;
    setMaintained(w, trunk.id, false);
    expect(w.economy.funds).toBe(funds);
    run(w, 60);
    expect(trunk.condition).toBeLessThan(1);
  });

  test("a repair you can't afford is refused and costs nothing", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 0.01 });
    const trunk = road(w, "big", "mid");
    expect(setMaintained(w, trunk.id, true)).toEqual({ ok: false, reason: "can't afford the repair" });
    expect(w.economy.funds).toBe(0.01);
    expect(w.maintained.has(trunk.id)).toBe(false);
  });

  test("paving lays a new surface on a repaired base: on a worn road it costs more than the repair alone", () => {
    const w = world(calm);
    const trunk = road(w, "big", "mid");
    trunk.condition = 0.3;
    const repair = repairCost(w, trunk, 0.7);
    expect(paveCost(w, "big", "mid")).toBeGreaterThan(repair);
    expect(paveCost(w, "big", "mid")).toBe(Math.round(segmentLength(w, trunk) * w.tuning.roadCostPerCell + repair));
    paveRoad(w, "big", "mid");
    expect(trunk.condition).toBe(1);
  });
});

describe("slice: growth of the original towns (step 4)", () => {
  // A faster drift than the game's (τ 60s, not 300s): these pin the rules, not the calibration.
  const calm = { startingFunds: 1e6, maxEmergentTowns: 0, townGrowthTauSeconds: 60 };
  const pop = (w: SliceWorld, id: string) => w.towns.get(id)!.population;

  test("danfos alone never grow a town: your service is a necessary condition", () => {
    const w = world(calm);
    run(w, 300);
    for (const id of ["big", "mid", "far", "cut"]) expect(pop(w, id)).toBeCloseTo(w.basePopulation.get(id)!, 5);
    expect(townGrowth(w, "big")!.playerShare).toBe(0);
  });

  test("a town you serve well grows, slowly, toward a cap fixed by its starting size", () => {
    const w = world(calm);
    for (let i = 0; i < 4; i += 1) addBus(w, "big", "mid");
    run(w, 5);
    const early = pop(w, "mid");
    run(w, 400);
    const g = townGrowth(w, "mid")!;
    expect(g.playerShare).toBeGreaterThan(w.tuning.growthMinPlayerShare);
    expect(pop(w, "mid")).toBeGreaterThan(w.basePopulation.get("mid")! * 1.05);
    expect(pop(w, "mid")).toBeLessThanOrEqual(g.cap);
    // Not a jump: a few seconds in, it had barely moved.
    expect(early).toBeLessThan(w.basePopulation.get("mid")! * 1.02);
  });

  test("at the game's pace, a day of good service moves a town only a few percent", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    for (let i = 0; i < 4; i += 1) addBus(w, "big", "mid");
    run(w, 30); // one game day
    expect(pop(w, "mid")).toBeGreaterThan(w.basePopulation.get("mid")!);
    expect(pop(w, "mid")).toBeLessThan(w.basePopulation.get("mid")! * 1.06);
  });

  test("a bigger town makes more trips", () => {
    const w = world(calm);
    const before = tripsFrom(w, "mid").reduce((sum, trip) => sum + trip.demand, 0);
    for (let i = 0; i < 4; i += 1) addBus(w, "big", "mid");
    run(w, 400);
    const after = tripsFrom(w, "mid").reduce((sum, trip) => sum + trip.demand, 0);
    expect(after).toBeGreaterThan(before * 1.05);
  });

  test("take the service away and it shrinks back -- never below where it started", () => {
    const w = world(calm);
    for (let i = 0; i < 4; i += 1) addBus(w, "big", "mid");
    run(w, 400);
    const grown = pop(w, "mid");
    for (let i = 0; i < 4; i += 1) removeBus(w, w.routes[0]!.id);
    run(w, 600);
    expect(pop(w, "mid")).toBeLessThan(grown);
    expect(pop(w, "mid")).toBeGreaterThanOrEqual(w.basePopulation.get("mid")! - 1e-9);
  });

  test("roadside towns grow from traffic, not from this", () => {
    const w = world({ startingFunds: 1e6, foundTownFlow: 1, foundTownPlayerFlow: 0.3, minSecondsBetweenTowns: 0 });
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    run(w, 400);
    const emergent = [...w.settlement.emergent][0]!;
    expect(townGrowth(w, emergent)).toBeNull();
  });
});

describe("slice: the way out of debt (playtest, day 14)", () => {
  test("no advice while money isn't a worry", () => {
    const w = world();
    expect(debtAdvice(w)).toBeNull();
  });

  test("in debt, it names the losing routes, and selling them returns exactly what it quoted", () => {
    const w = world({ maxEmergentTowns: 0 });
    addBus(w, "big", "mid");
    addBus(w, "mid", "far"); // thin: loses money
    run(w, 300);
    w.economy.funds = -400;
    const advice = debtAdvice(w)!;
    expect(advice.daysLeft).toBe(0);
    expect(advice.sell.map((s) => s.routeId)).toEqual([w.routes.find((r) => r.a === "mid" || r.b === "far")!.id]);
    const quote = advice.sell[0]!;
    expect(quote.savesPerDay).toBeGreaterThan(0);
    const before = w.economy.funds;
    const refund = removeBus(w, quote.routeId);
    expect(refund).toBeCloseTo(quote.refund, 6);
    expect(w.economy.funds).toBeCloseTo(before + quote.refund, 6);
  });

  test("a full route on worn roads asks for a bus, not a repair", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, busCapacity: 8 });
    addBus(w, "big", "mid");
    run(w, 1200);
    const d = diagnoseRoute(w, w.routes[0]!.id)!;
    expect(d.wornSpeed).toBeLessThan(0.85);
    expect(d.loadFactor).toBeGreaterThanOrEqual(0.85);
    expect(d.verdict).toBe("full");
  });
});

describe("slice: through-routes (playtest, day 14)", () => {
  test("a bus's reach is every trip along its road, not just its two ends", () => {
    const w = world();
    const along = demandAlong(w, "big", "far");
    expect(along).toBeCloseTo(pairDemand(w, "big", "mid") + pairDemand(w, "mid", "far") + pairDemand(w, "big", "far"));
    expect(along).toBeGreaterThan(pairDemand(w, "big", "far"));
  });

  test("a thin shuttle is pointed at running on to the next town, and says why", () => {
    const w = world({ startingFunds: 1e6 });
    addBus(w, "mid", "far");
    const through = throughRoute(w, w.routes[0]!.id)!;
    expect(through).toMatchObject({ a: "big", b: "far", via: ["mid"] });
    expect(through.reachPerDay).toBeGreaterThan(through.currentReachPerDay * 1.5);
  });

  test("a strong route isn't told to stretch: longer must also be denser", () => {
    const w = world({ startingFunds: 1e6 });
    addBus(w, "big", "mid");
    expect(throughRoute(w, w.routes[0]!.id)).toBeNull();
  });

  test("a thin route with nowhere better to go is left as thin", () => {
    const w = world({ startingFunds: 1e6 });
    addBus(w, "mid", "far");
    // Make every through-route too thin to pay: nothing to point at.
    w.tuning = { ...w.tuning, busOperatingCostPerSecond: 1000 };
    expect(throughRoute(w, w.routes[0]!.id)).toBeNull();
  });
});

describe("slice: cut-off towns", () => {
  test("a town no road reaches is cut off, and every trip to it is unreachable", () => {
    const w = world();
    expect(isCutOff(w, "cut")).toBe(true);
    expect(isCutOff(w, "big")).toBe(false);
    expect(tripsFrom(w, "cut").every((trip) => !trip.reachable)).toBe(true);
    const fromBig = new Map(tripsFrom(w, "big").map((trip) => [trip.to, trip.reachable]));
    expect(fromBig.get("mid")).toBe(true);
    expect(fromBig.get("cut")).toBe(false);
  });

  test("building a road ends it", () => {
    const w = world();
    buildRoad(w, "mid", "cut");
    expect(isCutOff(w, "cut")).toBe(false);
    expect(tripsFrom(w, "cut").every((trip) => trip.reachable)).toBe(true);
  });
});
