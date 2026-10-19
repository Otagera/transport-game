import { describe, expect, test } from "bun:test";
import { addBus, buildRoad, createSliceWorld, largestGapMidpoint, networkShare, removeBus, roadCost, routeSummaries, townOutcomes, tripsFrom, waitingAt, diagnoseRoute, isCutOff, roadPath, debtAdvice, demandAlong, throughRoute, pairDemand, paveRoad, paveCost, checkPave, dirtRoadsOn, localTravel, roadChain, chainOf, checkRoad, addMinibus, isMinibusRoute, headline, routeKey, gameDay, directRoad } from "@engine/slice/world";
import { informalBudget, sliceTick } from "@engine/slice/tick";
import { laneOn, setEnforcement, struckSegments } from "@engine/slice/pushback";
import { addBusLane, checkLane, laneCost } from "@engine/slice/world";
import { ALL_SYSTEMS_ON, DEFAULT_SLICE_TUNING } from "@engine/slice/tuning";
import type { SliceMapDef, SliceTuning, SliceWorld } from "@engine/slice/types";
import { SIM_DT } from "@engine/loop";
import { lastDay, routeExtraCostLastDay, routeIncomeLastDay } from "@engine/slice/ledger";
import { forecast } from "@engine/slice/forecast";
import { allocationPerDay } from "@engine/slice/budget";
import { legFare, stageFare } from "@engine/slice/fares";
import { routineUpkeepPerDay, totalRoutineUpkeepPerDay } from "@engine/slice/upkeep";
import { paveStepCost } from "@engine/pathing/cost";
import { paveMoves } from "@engine/slice/moves";
import { startSliceGame } from "@engine/slice/start";
import { averageBudget, averageHeadline, averageNet } from "@engine/slice/history";
import { applyAction } from "@engine/slice/actions";
import { createReceiptBook, perform, tickReceipts, RECEIPT_SECONDS, SETTLE_SECONDS, type Receipt } from "@engine/slice/receipts";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import { insertIntoPath } from "@engine/slice/settlement";
import { setRoadMaintained } from "@engine/slice/wear";
import { routesOnTrip, tripPlans } from "@engine/slice/transfers";
import { roadCapacity, speedFactor } from "@engine/slice/congestion";
import { costRate, planRoad, polylineLength, segmentLength, segmentPolyline } from "@engine/slice/roads";
import { bridgeCellsOn, repairCost, setMaintained, upkeepPerDay, wearRate } from "@engine/slice/wear";
import { computeBurnRate } from "@engine/economy/report";
import { bestRung, growthTrend, townGrowth } from "@engine/slice/growth";
import { addFreightTrain, addLorry, diagnoseLorryRoute, goodsFlows, removeLorry, lorrySummaries } from "@engine/slice/goods";
import { buildHalt, haltSite, addTrain, buildTrack, checkTrain, railPath, restoreCost, trackAction } from "@engine/slice/rail";
import { slowOrder } from "@engine/slice/wear";
import type { Vehicle } from "@engine/simulation/types";
import { createHintState, dismissHint, updateHints } from "../src/slice/hints";
import { MAX_VERDICT_WORDS, shortVerdict, wordCount } from "../src/slice/verdicts";
import type { RouteVerdict } from "@engine/slice/world";

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

/** No tolls, levies or allocation: for tests about fares or costs alone. */
const noBudget: Partial<SliceTuning> = { tollPerRoad: 0, levyPerSeat: 0, allocationBase: 0, allocationPerThousand: 0, remittanceEnabled: false };

function world(overrides: Partial<SliceTuning> = {}): SliceWorld {
  return createSliceWorld(MAP, { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, ...overrides });
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
    const w = world(noBudget);
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

describe("slice zero: systems switched off", () => {
  const zero = () => createSliceWorld({ ...MAP, port: "big", rails: [{ a: "big", b: "far" }] }, { ...DEFAULT_SLICE_TUNING, startingFunds: 1e6, maxEmergentTowns: 0 });

  test("the default tuning is slice zero: wear, goods, rail and the straight alignment off", () => {
    expect(DEFAULT_SLICE_TUNING.wearEnabled).toBe(false);
    expect(DEFAULT_SLICE_TUNING.goodsEnabled).toBe(false);
    expect(DEFAULT_SLICE_TUNING.railEnabled).toBe(false);
    expect(DEFAULT_SLICE_TUNING.straightAlignmentEnabled).toBe(false);
  });

  test("their actions are refused; roads, buses and minibuses still work", () => {
    const w = zero();
    for (const spec of [
      { kind: "lorry", a: "big", b: "mid" },
      { kind: "train", a: "big", b: "far" },
      { kind: "freight", a: "big", b: "far" },
      { kind: "track", a: "big", b: "far", alignment: "cheapest" },
      { kind: "road", a: "mid", b: "cut", alignment: "direct" },
      { kind: "halt", town: "mid" },
    ] as const) {
      expect(applyAction(w, spec).ok).toBe(false);
    }
    const roadId = w.simulation.map.segments.find((s) => s.type === "road")!.id;
    expect(applyAction(w, { kind: "fix", segmentId: roadId, on: true }).ok).toBe(false);
    expect(applyAction(w, { kind: "road", a: "mid", b: "cut", alignment: "cheapest" }).ok).toBe(true);
    expect(applyAction(w, { kind: "bus", a: "big", b: "mid" }).ok).toBe(true);
    expect(applyAction(w, { kind: "minibus", a: "mid", b: "cut" }).ok).toBe(true);
  });

  test("roads start sound and stay sound, and your buses pay no rough-road cost", () => {
    const w = zero();
    for (let i = 0; i < 4; i += 1) addBus(w, "big", "mid");
    run(w, 600);
    for (const segment of w.simulation.map.segments.filter((s) => s.type === "road")) expect(segment.condition).toBe(1);
    expect(routeExtraCostLastDay(w.ledger, routeKey("big", "mid"), 600)).toBe(0);
  });

  test("no goods are produced", () => {
    const w = zero();
    run(w, 300);
    expect(w.goods.yards.size).toBe(0);
  });
});

describe("slice zero: the world is already running on day 1", () => {
  test("startSliceGame warms the world up, then day 1 begins", () => {
    const w = startSliceGame(MAP, { ...DEFAULT_SLICE_TUNING, maxEmergentTowns: 0 });
    expect(gameDay(w)).toBe(1);
    expect(w.startSeconds).toBeCloseTo(DEFAULT_SLICE_TUNING.warmUpDays * SECONDS_PER_GAME_DAY);
    // Danfos are already carrying people: the share you meet is the share that holds.
    const early = networkShare(w).informal;
    expect(early).toBeGreaterThan(0.2);
    run(w, 9 * SECONDS_PER_GAME_DAY);
    expect(gameDay(w)).toBe(10);
    expect(Math.abs(networkShare(w).informal - early)).toBeLessThan(0.05);
  });

  test("the 5-day averages start filled; money averages only your days", () => {
    const w = startSliceGame(MAP, { ...DEFAULT_SLICE_TUNING, maxEmergentTowns: 0 });
    // Trips made: five warm-up days already in the average on day 1.
    expect(w.history.days).toHaveLength(5);
    expect(averageHeadline(w).tripsPerDay).toBeGreaterThan(0);
    expect(averageNet(w)).toBe(0);
    addBus(w, "big", "mid");
    run(w, SECONDS_PER_GAME_DAY);
    // One day of yours: the money average is that day alone, not diluted by the warm-up's zeros.
    expect(averageNet(w)).toBeCloseTo(w.history.days.at(-1)!.net);
    expect(averageNet(w)).not.toBe(0);
  });

  test("the informal sector's earnings count from day 1, and your funds are untouched", () => {
    const w = startSliceGame(MAP, { ...DEFAULT_SLICE_TUNING, maxEmergentTowns: 0 });
    expect(w.informal.earnings).toBe(0);
    expect(w.economy.funds).toBe(DEFAULT_SLICE_TUNING.startingFunds);
    expect(lastDay(w.ledger).net).toBe(0);
  });
});

describe("moves: paving is a move", () => {
  test("every dirt road is a pave move at its pave price, until it's paved", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    const moves = paveMoves(w);
    expect(moves.map((m) => `${m.action.a}-${m.action.b}`).sort()).toEqual(["big-mid", "mid-far"]);
    for (const move of moves) expect(move.price).toBe(paveCost(w, move.action.a, move.action.b));
    paveRoad(w, "big", "mid");
    expect(paveMoves(w).map((m) => `${m.action.a}-${m.action.b}`)).toEqual(["mid-far"]);
  });
});

describe("the informal budget by surface", () => {
  test("a paved road holds more danfos than a dirt one", () => {
    const w = world({ maxEmergentTowns: 0 });
    const bigMid = directRoad(w, "big", "mid")!.id;
    expect(informalBudget(w, bigMid)).toBe(DEFAULT_SLICE_TUNING.informalRoadSpaceDirt);
    paveRoad(w, "big", "mid");
    expect(informalBudget(w, bigMid)).toBe(DEFAULT_SLICE_TUNING.informalRoadSpace);
    expect(DEFAULT_SLICE_TUNING.informalRoadSpace).toBeGreaterThan(DEFAULT_SLICE_TUNING.informalRoadSpaceDirt);
  });
});

describe("one road, one budget: your vehicles' road space counts against the informal cap", () => {
  test("a road your buses fill has no room for a danfo", () => {
    // Room for one danfo; one of your buses (road space 1.2) is always on the only road out of Big.
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, informalRoadSpace: 1, informalRoadSpaceDirt: 1 });
    addBus(w, "big", "mid");
    const bigMid = directRoad(w, "big", "mid")!.id;
    let informalOnIt = 0;
    for (let t = 0; t < 300; t += SIM_DT) {
      sliceTick(w, SIM_DT);
      for (const info of w.informal.active.values()) if (info.segmentIds.includes(bigMid)) informalOnIt += 1;
    }
    expect(informalOnIt).toBe(0);
    // Without your bus the same road carries danfos.
    const empty = world({ startingFunds: 1e6, maxEmergentTowns: 0, informalRoadSpace: 1, informalRoadSpaceDirt: 1 });
    let informalOnEmpty = 0;
    for (let t = 0; t < 300; t += SIM_DT) {
      sliceTick(empty, SIM_DT);
      for (const info of empty.informal.active.values()) if (info.segmentIds.includes(bigMid)) informalOnEmpty += 1;
    }
    expect(informalOnEmpty).toBeGreaterThan(0);
  });
});

describe("informal road space is held only ahead of the vehicle", () => {
  test("space on each road is what the informal vehicles still to drive it hold", () => {
    const w = createSliceWorld(MAP, { ...DEFAULT_SLICE_TUNING, maxEmergentTowns: 0 });
    let checked = 0;
    let partlyReleased = 0;
    for (let t = 0; t < 600; t += SIM_DT) {
      sliceTick(w, SIM_DT);
      const expected = new Map<string, number>();
      for (const [id, info] of w.informal.active) {
        const vehicle = w.simulation.vehicles.find((v) => v.id === id)!;
        // Nothing behind the segment it's on is still held.
        expect(info.released).toBeLessThanOrEqual(Math.max(0, vehicle.pathIndex - 1));
        if (info.released > 0) partlyReleased += 1;
        for (const segmentId of info.segmentIds.slice(info.released)) expected.set(segmentId, (expected.get(segmentId) ?? 0) + info.weight);
      }
      for (const [segmentId, used] of w.informal.segmentSpace) expect(used).toBeCloseTo(expected.get(segmentId) ?? 0, 6);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    // Big -> far runs two roads: some danfo gave back the first while on the second.
    expect(partlyReleased).toBeGreaterThan(0);
  });
});

describe("slice: the headline", () => {
  test("counts trips a day, and splits stayed home into no road and no seat", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    addBus(w, "big", "mid");
    run(w, 300);
    const h = headline(w);
    expect(h.yourRidersPerDay).toBeGreaterThan(0);
    expect(h.tripsPerDay).toBeGreaterThan(h.yourRidersPerDay);
    // Cut has no road: all of its trips stay home for want of one.
    const cutDemand = tripsFrom(w, "cut").reduce((sum, trip) => sum + trip.demand, 0) * SECONDS_PER_GAME_DAY;
    expect(h.noRoadPerDay).toBeGreaterThan(cutDemand * 0.8);
    // A road to Cut moves its trips out of "no road".
    buildRoad(w, "mid", "cut");
    run(w, 300);
    expect(headline(w).noRoadPerDay).toBeLessThan(h.noRoadPerDay * 0.2);
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
    const w = world({ maxEmergentTowns: 0, informalRoadSpace: 1, informalRoadSpaceDirt: 1 });
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

  test("a road you build is born dirt; paved, it carries more", () => {
    const w = world({ startingFunds: 1e6 });
    buildRoad(w, "mid", "cut");
    const inherited = w.simulation.map.segments.find((s) => s.provenance === "inherited")!;
    const built = w.simulation.map.segments.find((s) => s.provenance === "built")!;
    expect(roadCapacity(w, built.id)).toBe(roadCapacity(w, inherited.id));
    paveRoad(w, "mid", "cut");
    expect(roadCapacity(w, built.id)).toBeGreaterThan(roadCapacity(w, inherited.id));
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
  test("paving charges the previewed price and gives the road a paved road's capacity", () => {
    const w = world({ startingFunds: 1e6 });
    const before = w.economy.funds;
    const price = paveCost(w, "big", "mid");
    expect(paveRoad(w, "big", "mid").ok).toBe(true);
    expect(w.economy.funds).toBe(before - price);
    const paved = w.simulation.map.segments.find((s) => s.fromNodeId === "big" && s.toNodeId === "mid")!;
    expect(paved.surface).toBe("paved");
    expect(paved.provenance).toBe("inherited"); // still the state's road, now paved
    expect(roadCapacity(w, paved.id)).toBe(w.tuning.roadFlowCapacity);
  });

  test("it refuses what isn't a dirt road between neighbours, and refusals cost nothing", () => {
    const w = world();
    const before = w.economy.funds;
    expect(checkPave(w, "big", "far")).toEqual({ ok: false, reason: "no road joins them" });
    expect(paveRoad(w, "mid", "cut")).toEqual({ ok: false, reason: "no road joins them" });
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
    for (const half of halves) expect(half.surface).toBe("paved");
  });
});

describe("slice: fares by distance (step 5)", () => {
  test("a boarding fare plus a price per stage, rounded up to the next stage", () => {
    const t = { ...DEFAULT_SLICE_TUNING, fareBoarding: 1, farePerStage: 1, fareStageCells: 10 };
    expect(stageFare(t, 3)).toBe(2);
    expect(stageFare(t, 10)).toBe(2);
    expect(stageFare(t, 10.5)).toBe(3);
    expect(stageFare(t, 25)).toBe(4);
  });

  test("a longer leg pays more, and changing buses costs one more boarding fare, not a whole fare", () => {
    const w = world();
    const near = legFare(w, "big", "mid");
    const far = legFare(w, "big", "far");
    expect(far).toBeGreaterThan(near);
    // Big -> mid -> far in two legs pays at most one boarding fare (plus rounding) over one leg.
    const twoLegs = legFare(w, "big", "mid") + legFare(w, "mid", "far");
    expect(twoLegs - far).toBeLessThanOrEqual(w.tuning.fareBoarding + w.tuning.farePerStage);
  });

  test("your fares on unload are each leg's fare", () => {
    // Riders don't respond to price (yet), so the same run at another fare
    // carries the same riders: income scales exactly with this leg's fare.
    const income = (farePerStage: number) => {
      const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, farePerStage, ...noBudget });
      addBus(w, "big", "mid");
      run(w, 120);
      return { income: lastDay(w.ledger).income, fare: legFare(w, "big", "mid") };
    };
    const one = income(1);
    const two = income(2);
    expect(one.income).toBeGreaterThan(0);
    expect(two.income / one.income).toBeCloseTo(two.fare / one.fare, 6);
  });
});

describe("slice: tolls, levies and the allocation (step 6)", () => {
  test("danfos pay a toll on roads you built or paved, pass it on, and some riders stay home", () => {
    const run2 = (tollPerRoad: number) => {
      const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, ...noBudget, tollPerRoad });
      paveRoad(w, "big", "mid");
      run(w, 300);
      return w;
    };
    const free = run2(0);
    const tolled = run2(10);
    expect(free.budget.tolls).toBe(0);
    expect(tolled.budget.tolls).toBeGreaterThan(0);
    // Priced out: more stay home from the towns the paved road serves.
    expect(townOutcomes(tolled, "big").lost).toBeGreaterThan(townOutcomes(free, "big").lost);
  });

  test("inherited roads you haven't paved charge no toll", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, ...noBudget, tollPerRoad: 10 });
    run(w, 300);
    expect(w.budget.tolls).toBe(0);
  });

  test("every informal departure pays the park levy; the agberos keep their cut", () => {
    const w = world({ maxEmergentTowns: 0, ...noBudget, levyPerSeat: 1, agberoCut: 0.5 });
    const before = w.economy.funds;
    run(w, 300);
    expect(w.budget.levies).toBeGreaterThan(0);
    expect(w.budget.agberos).toBeCloseTo(w.budget.levies);
    expect(w.economy.funds - before).toBeCloseTo(w.budget.levies, 6);
  });

  test("the allocation pays a base a day, and more for the growth since day 1", () => {
    const w = world({ maxEmergentTowns: 0, townGrowthCap: 0, ...noBudget, allocationBase: 30, allocationPerThousand: 10 });
    expect(allocationPerDay(w)).toBe(30);
    w.towns.get("mid")!.population += 5;
    expect(allocationPerDay(w)).toBeCloseTo(80);
  });

  test("on day 1 your funds are the starting funds: warm-up levies and allocation aren't yours", () => {
    const w = startSliceGame(MAP, { ...DEFAULT_SLICE_TUNING, maxEmergentTowns: 0 });
    expect(w.economy.funds).toBe(DEFAULT_SLICE_TUNING.startingFunds);
    expect(w.budget.levies).toBe(0);
    expect(w.budget.allocation).toBe(0);
  });
});

describe("slice: the treasury remittance (step 6, pass 2)", () => {
  const period = DEFAULT_SLICE_TUNING.remittancePeriodDays * SECONDS_PER_GAME_DAY;
  // Income only from the allocation, so a period's net is exactly what it paid.
  const remitting = (startingFunds: number, allocationBase: number) =>
    world({ startingFunds, maxEmergentTowns: 0, townGrowthCap: 0, ...noBudget, allocationBase, remittanceEnabled: true, remittanceShare: 0.8, remittanceReserve: 3000 });

  test("it takes the share of the period's surplus when the funds are well above the reserve", () => {
    const w = remitting(100_000, 100);
    run(w, period + SIM_DT);
    const surplus = 100 * DEFAULT_SLICE_TUNING.remittancePeriodDays;
    expect(w.budget.remitted).toBeCloseTo(0.8 * surplus, 0);
  });

  test("it takes the share of the funds above the reserve, never more, so saving stays possible", () => {
    const w = remitting(3_200, 100);
    run(w, period + SIM_DT);
    // ₦3,200 + ~₦1,000 surplus: ~₦1,200 above the reserve, but the surplus (~₦1,000) is the cap.
    const above = 3_200 + 100 * DEFAULT_SLICE_TUNING.remittancePeriodDays - 3000;
    expect(w.budget.remitted).toBeCloseTo(0.8 * Math.min(above, 100 * DEFAULT_SLICE_TUNING.remittancePeriodDays), 0);
    const low = remitting(1_000, 100);
    run(low, period + SIM_DT);
    expect(low.budget.remitted).toBe(0); // under the reserve: nothing
  });

  test("a period in deficit pays nothing", () => {
    const w = remitting(100_000, 0);
    w.tuning.fareBoarding = 0;
    w.tuning.farePerStage = 0;
    addBus(w, "big", "far"); // no fares: it only costs
    run(w, period + SIM_DT);
    expect(w.budget.remitted).toBe(0);
  });
});

describe("slice: routine upkeep on the roads you keep (step 5)", () => {
  test("inherited dirt roads are free; a road you build costs its dirt rate per cell; paved costs more", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    const inherited = directRoad(w, "big", "mid")!;
    expect(routineUpkeepPerDay(w, inherited)).toBe(0);
    buildRoad(w, "mid", "cut");
    const built = w.simulation.map.segments.find((s) => s.provenance === "built")!;
    expect(routineUpkeepPerDay(w, built)).toBeCloseTo(segmentLength(w, built) * w.tuning.routineUpkeepDirtPerCell);
    const dirtUpkeep = routineUpkeepPerDay(w, built);
    paveRoad(w, "mid", "cut");
    expect(routineUpkeepPerDay(w, built)).toBeGreaterThan(dirtUpkeep);
    // Paving the state's road makes it yours to keep.
    paveRoad(w, "big", "mid");
    expect(routineUpkeepPerDay(w, inherited)).toBeCloseTo(segmentLength(w, inherited) * w.tuning.routineUpkeepPavedPerCell);
  });

  test("it leaves the funds a day at a time, with nothing else running", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, ...noBudget });
    buildRoad(w, "mid", "cut");
    const perDay = totalRoutineUpkeepPerDay(w);
    const before = w.economy.funds;
    run(w, SECONDS_PER_GAME_DAY);
    expect(before - w.economy.funds).toBeCloseTo(perDay, 0);
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
  const terrainWorld = (overrides: Partial<SliceTuning> = {}) => createSliceWorld(TERRAIN_MAP, { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, ...overrides });

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
    const w = createSliceWorld(wide, { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6 });
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

  test("a straight road is priced as a line: on flat ground, exactly its length at the flat rate", () => {
    const w = world(); // MAP: flat, dry
    const plan = planRoad(w, "big", "far", "direct")!;
    const length = Math.hypot(50 - 10, 5 - 20);
    expect(plan.length).toBeCloseTo(length);
    expect(plan.cost).toBe(Math.round(length * w.tuning.roadCostPerCell));
    expect(plan.polyline).toHaveLength(2);
  });

  test("holding the line over a hill costs the climb and is shorter; the cheapest bends round", () => {
    const w = terrainWorld();
    const direct = planRoad(w, "sw", "se", "direct")!;
    const cheapest = planRoad(w, "sw", "se")!;
    expect(direct.length).toBeCloseTo(24);
    expect(direct.hillsCost).toBeGreaterThan(0);
    expect(direct.cost).toBeGreaterThan(cheapest.cost);
    expect(cheapest.length).toBeGreaterThan(direct.length);
    // And building it straight gives the straight road, at the quoted price.
    const before = w.economy.funds;
    buildRoad(w, "sw", "se", "direct");
    expect(w.economy.funds).toBe(before - direct.cost);
    const road = w.simulation.map.segments.find((s) => s.provenance === "built")!;
    expect(road.length).toBeCloseTo(24);
  });

  test("a straight line across water pays one bridge, and is refused past the span cap", () => {
    const w = terrainWorld();
    const plan = planRoad(w, "west", "east", "direct")!;
    expect(plan.bridgeCells).toBeGreaterThanOrEqual(3);
    const wide = createSliceWorld(
      { ...TERRAIN_MAP, towns: TERRAIN_MAP.towns.slice(0, 2), roads: [], terrain: { rivers: [{ points: [[24, -2], [24, 42]], width: 20 }] } },
      { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6 },
    );
    expect(planRoad(wide, "west", "east", "direct")).toBeNull();
  });

  test("cheapest is never dearer than straight", () => {
    const w = terrainWorld();
    for (const [a, b] of [["west", "east"], ["sw", "se"], ["west", "se"], ["east", "sw"]] as const) {
      const direct = planRoad(w, a, b, "direct");
      const cheapest = planRoad(w, a, b);
      if (direct && cheapest) expect(cheapest.cost).toBeLessThanOrEqual(direct.cost);
    }
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
    expect(paveCost(w, "big", "mid")).toBe(Math.round(paveStepCost(segmentLength(w, trunk)).base * costRate(w) + repair));
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

  test("a town a little over its start, settling back, reads as steady -- not shrinking", () => {
    const w = world(calm); // no service: every target is the town's start
    w.towns.get("big")!.population = w.basePopulation.get("big")! * 1.03;
    expect(growthTrend(w, "big")).toBe("steady");
    // Well over it, losing the growth it had: that is shrinking.
    w.towns.get("big")!.population = w.basePopulation.get("big")! * 1.2;
    expect(growthTrend(w, "big")).toBe("shrinking");
  });

  test("a town your service is growing reads as growing", () => {
    const w = world(calm);
    for (let i = 0; i < 4; i += 1) addBus(w, "big", "mid");
    run(w, 60);
    expect(townGrowth(w, "mid")!.target).toBeGreaterThan(w.basePopulation.get("mid")! * 1.1);
    expect(growthTrend(w, "mid")).toBe("growing");
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
    // Small buses so it runs full, a fare high enough that a full one pays its way.
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, busCapacity: 8, farePerStage: 30 });
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

describe("slice: goods (step 4c)", () => {
  // MAP with Big as the port. Markets: Big and Mid (>= 40k). Far's produce goes to Mid, its nearest.
  const goodsWorld = (overrides: Partial<SliceTuning> = {}) =>
    createSliceWorld({ ...MAP, port: "big" }, { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, ...overrides });

  test("goods are one-way: produce from farm towns to their nearest market, supplies from the port", () => {
    const w = goodsWorld();
    const flows = goodsFlows(w);
    const produce = flows.filter((f) => f.kind === "produce");
    expect(produce.map((f) => `${f.from}>${f.to}`).sort()).toEqual(["cut>mid", "far>mid"]);
    expect(flows.filter((f) => f.kind === "supplies").map((f) => f.to).sort()).toEqual(["cut", "far", "mid"]);
    // Never mirrored: no produce comes back from market.
    expect(flows.some((f) => f.kind === "produce" && f.from === "mid")).toBe(false);
  });

  test("goods nobody carries wait a while and spoil -- and never touch the passenger share", () => {
    const w = goodsWorld();
    const plain = goodsWorld({ producePerThousandPerDay: 0, suppliesPerThousandPerDay: 0 });
    run(w, 300);
    run(plain, 300);
    const yard = w.goods.yards.get("far")!;
    expect([...yard.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    const outcome = [...w.goods.outcomes.values()][0]!;
    expect(outcome.delivered).toBe(0);
    expect(outcome.spoiled).toBeGreaterThan(0);
    expect(networkShare(w)).toEqual(networkShare(plain));
  });

  test("a lorry delivers goods ahead of it and earns freight fares", () => {
    const w = goodsWorld();
    addLorry(w, "big", "far");
    const before = w.economy.funds;
    run(w, 300);
    expect(routeIncomeLastDay(w.ledger, w.lorryRoutes[0]!.id, Infinity)).toBeGreaterThan(0);
    expect(w.economy.funds).toBeGreaterThan(before - 300 * w.tuning.lorryOperatingCostPerSecond);
    const d = diagnoseLorryRoute(w, w.lorryRoutes[0]!.id)!;
    expect(d.delivered).toBeGreaterThan(0);
  });

  test("a route with goods both ways isn't one-way; a produce-only one is", () => {
    const w = goodsWorld();
    addLorry(w, "big", "far"); // supplies out to Mid and Far, Far's produce back to Mid
    addLorry(w, "mid", "far"); // Far's produce only: the port's supplies don't start on it
    run(w, 120);
    const both = diagnoseLorryRoute(w, w.lorryRoutes.find((r) => (r.a === "big" || r.b === "big") && (r.a === "far" || r.b === "far"))!.id)!;
    const oneWay = diagnoseLorryRoute(w, w.lorryRoutes.find((r) => (r.a === "mid" || r.b === "mid") && (r.a === "far" || r.b === "far"))!.id)!;
    expect(both.outbound).toBeGreaterThan(0);
    expect(both.inbound).toBeGreaterThan(0);
    expect(both.verdict).not.toBe("one-way");
    expect(Math.min(oneWay.outbound, oneWay.inbound)).toBe(0);
    expect(["one-way", "thin"]).toContain(oneWay.verdict);
  });

  test("export: a market sends on to the port half the produce actually delivered to it -- and nothing before", () => {
    const w = goodsWorld();
    const exportFrom = (from: string) => goodsFlows(w).find((f) => f.from === from && f.to === "big" && f.kind === "produce");
    expect(exportFrom("mid")).toBeUndefined(); // nothing delivered to Mid yet
    addLorry(w, "mid", "far"); // brings Far's produce to Mid
    run(w, 300);
    const delivered = w.goods.outcomes.get("far:mid:produce")!.delivered;
    expect(delivered).toBeGreaterThan(0);
    expect(exportFrom("mid")!.rate).toBeCloseTo(delivered * w.tuning.exportShare, 9);
    // The port itself doesn't export to itself.
    expect(goodsFlows(w).some((f) => f.from === "big" && f.to === "big")).toBe(false);
  });

  test("a freight train carries goods on track only, and wears it harder than a passenger train", () => {
    const w = createSliceWorld(
      { ...MAP, port: "big", rails: [{ a: "big", b: "far" }] },
      { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0 },
    );
    expect(addFreightTrain(w, "big", "far")).toEqual({ ok: false, reason: "no working track between them" });
    buildTrack(w, "big", "far");
    expect(addFreightTrain(w, "big", "far").ok).toBe(true);
    const train = w.simulation.vehicles.find((v) => v.id.startsWith("freight-"))!;
    expect(train.path).not.toContain("mid"); // the track, not the road
    run(w, 300);
    const route = w.lorryRoutes.find((r) => r.id.startsWith("freight:"))!;
    expect(routeIncomeLastDay(w.ledger, route.id, Infinity)).toBeGreaterThan(0);
    for (const flow of w.roadFlowEMA.values()) expect(flow).toBeLessThan(1); // danfos only, no freight on roads
    // Same speed, same track: a freight train counts lorryWearMultiplier passenger trains toward wear.
    const pair = (freight: boolean) => {
      const x = createSliceWorld(
        { ...MAP, port: "big", rails: [{ a: "big", b: "far" }] },
        { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, freightSpeed: 8, trainSpeed: 8 },
      );
      buildTrack(x, "big", "far");
      if (freight) addFreightTrain(x, "big", "far");
      else addTrain(x, "big", "far");
      run(x, 200);
      return x.railFlowEMA.get(x.simulation.map.segments.find((seg) => seg.type === "rail")!.id)!;
    };
    // (Flow is a rolling average of discrete entries, so the exact ratio wobbles: assert clearly harder.)
    expect(pair(true) / pair(false)).toBeGreaterThan(1.3);
  });

  test("lorries don't grow roadside towns: they carry tonnes, not people passing", () => {
    const w = goodsWorld();
    for (let i = 0; i < 4; i += 1) addLorry(w, "big", "far");
    run(w, 300);
    for (const flow of w.settlement.segmentPlayerFlowEMA.values()) expect(flow).toBe(0);
  });

  test("a lorry's road space wears a road harder than anyone else's", () => {
    const w = goodsWorld();
    const road = w.simulation.map.segments[0]!;
    w.roadFlowEMA.set(road.id, 1);
    w.heavyFlowEMA.set(road.id, 0);
    const light = wearRate(w, road);
    w.heavyFlowEMA.set(road.id, 1); // the same road space, all of it lorries
    expect(wearRate(w, road)).toBeGreaterThan(light * 1.3);
  });

  test("a losing lorry route is in the debt advice, and selling it returns what was quoted", () => {
    const w = goodsWorld({ produceFare: 0, suppliesFare: 0 }); // nothing it carries pays: it loses
    addLorry(w, "big", "mid");
    run(w, 200);
    w.economy.funds = -100;
    const quote = debtAdvice(w)!.sell.find((s) => s.routeId === w.lorryRoutes[0]!.id)!;
    // Its own running cost, plus what it was paying extra on worn roads.
    expect(quote.savesPerDay).toBeGreaterThanOrEqual(w.tuning.lorryOperatingCostPerSecond * 30);
    expect(quote.savesPerDay).toBeCloseTo(-lorrySummaries(w)[0]!.netPerDay, 6);
    expect(removeLorry(w, quote.routeId)).toBeCloseTo(quote.refund, 6);
    expect(w.lorryRoutes).toHaveLength(0);
  });
});

describe("slice: rail (step 4d)", () => {
  // MAP plus an old export line from Big to Far, straight past Mid.
  const railWorld = (overrides: Partial<SliceTuning> = {}) =>
    createSliceWorld({ ...MAP, rails: [{ a: "big", b: "far" }] }, { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, ...overrides });

  test("the inherited line is on the map but out of service: no train runs until it's restored", () => {
    const w = railWorld();
    expect(w.simulation.map.segments.some((s) => s.type === "rail")).toBe(true);
    expect(checkTrain(w, "big", "far")).toEqual({ ok: false, reason: "no working track between them" });
    expect(trackAction(w, "big", "far")).toBe("restore");
    const quote = restoreCost(w, "big", "far");
    const before = w.economy.funds;
    expect(buildTrack(w, "big", "far").ok).toBe(true);
    expect(w.economy.funds).toBe(before - quote);
    expect(railPath(w, "big", "far")?.nodeIds).toEqual(["big", "far"]); // straight: it stops nowhere between
    expect(checkTrain(w, "big", "far").ok).toBe(true);
  });

  test("two networks: buses never take track, trains never take roads", () => {
    const w = railWorld();
    buildTrack(w, "big", "far");
    // The road from Big to Far goes through Mid; the track goes straight.
    expect(roadPath(w, "big", "far")!.nodeIds).toEqual(["big", "mid", "far"]);
    addBus(w, "big", "far");
    addTrain(w, "big", "far");
    const bus = w.simulation.vehicles.find((v) => v.id.startsWith("bus-"))!;
    const train = w.simulation.vehicles.find((v) => v.id.startsWith("train-"))!;
    expect(bus.path).toContain("mid");
    expect(train.path).not.toContain("mid");
    // New track where there was none doesn't give buses a road.
    buildTrack(w, "mid", "cut");
    expect(roadPath(w, "mid", "cut")).toBeNull();
  });

  test("a train is never road traffic: it adds no flow, wear or roadside-town traffic", () => {
    // No informal sector: with only trains moving, any road flow would be the trains'.
    // (With danfos about, trains do lower road traffic -- by taking riders who'd have given up.)
    const w = railWorld({ informalRoadSpace: 0, informalRoadSpaceDirt: 0 });
    buildTrack(w, "big", "far");
    for (let i = 0; i < 6; i += 1) addTrain(w, "big", "far");
    run(w, 200);
    expect(w.simulation.vehicles.filter((v) => v.lifecycle === "one-shot")).toHaveLength(0);
    for (const flow of w.roadFlowEMA.values()) expect(flow).toBe(0);
    for (const flow of w.heavyFlowEMA.values()) expect(flow).toBe(0);
    for (const flow of w.settlement.segmentPlayerFlowEMA.values()) expect(flow).toBe(0);
  });

  test("trains carry riders, and riders change between bus and train", () => {
    const w = railWorld();
    buildTrack(w, "big", "far");
    addTrain(w, "big", "far");
    addBus(w, "far", "mid"); // Big -> Mid can go by train to Far, then bus back... or the road
    run(w, 300);
    const train = w.routes.find((r) => r.id.startsWith("rail:"))!;
    expect(routeIncomeLastDay(w.ledger, train.id, Infinity)).toBeGreaterThan(0);
    expect(diagnoseRoute(w, train.id)!.informalTraffic).toBe(0);
  });

  test("new track is planned over the terrain at rail's price: dearer than the same road", () => {
    const w = railWorld();
    expect(trackAction(w, "mid", "cut")).toBe("build");
    const before = w.economy.funds;
    buildTrack(w, "mid", "cut");
    const spent = before - w.economy.funds;
    expect(spent).toBeGreaterThan(roadCost(w, "mid", "cut") * 2);
  });

  test("a town only track reaches isn't cut off once the track works", () => {
    const w = createSliceWorld({ ...MAP, rails: [{ a: "mid", b: "cut" }] }, { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6 });
    expect(isCutOff(w, "cut")).toBe(true); // the old line is out of service
    buildTrack(w, "mid", "cut");
    expect(isCutOff(w, "cut")).toBe(false);
    expect(tripsFrom(w, "cut").find((t) => t.to === "mid")!.reachable).toBe(true);
    expect(roadPath(w, "mid", "cut")).toBeNull(); // still no road: no danfo gets there
  });

  test("track wears with the trains that run on it; disused track doesn't change", () => {
    const w = createSliceWorld(
      { ...MAP, rails: [{ a: "big", b: "far" }, { a: "mid", b: "cut" }] },
      { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0 },
    );
    buildTrack(w, "big", "far");
    for (let i = 0; i < 3; i += 1) addTrain(w, "big", "far");
    const used = w.simulation.map.segments.find((s) => s.type === "rail" && s.fromNodeId === "big")!;
    const disused = w.simulation.map.segments.find((s) => s.type === "rail" && s.fromNodeId === "mid")!;
    const disusedBefore = disused.condition;
    run(w, 300);
    expect(used.condition).toBeLessThan(0.9);
    expect(w.railFlowEMA.get(used.id)!).toBeGreaterThan(0);
    expect(disused.condition).toBe(disusedBefore);
  });

  test("worn track runs under a slow order, and the train route says worn, not jammed", () => {
    const w = railWorld();
    buildTrack(w, "big", "far");
    addTrain(w, "big", "far");
    const track = w.simulation.map.segments.find((s) => s.type === "rail")!;
    expect(slowOrder(w, track)).toBe(1);
    track.condition = 0.4;
    expect(slowOrder(w, track)).toBe(w.tuning.railSlowOrderSpeed);
    run(w, 120);
    const d = diagnoseRoute(w, w.routes.find((r) => r.id.startsWith("rail:"))!.id)!;
    expect(d.verdict).not.toBe("jammed");
    expect(d.wornSpeed).toBeLessThan(0.6);
  });

  test("maintained track is kept new for upkeep at a road's price per cell, not track's", () => {
    const w = railWorld();
    buildTrack(w, "big", "far");
    const track = w.simulation.map.segments.find((s) => s.type === "rail")!;
    expect(setMaintained(w, track.id, true).ok).toBe(true);
    for (let i = 0; i < 3; i += 1) addTrain(w, "big", "far");
    run(w, 300);
    expect(track.condition).toBe(1);
    // Same cells, same deficit: track costs what a road does to keep up.
    const road = w.simulation.map.segments.find((s) => s.type === "road" && s.provenance === "inherited")!;
    expect(repairCost(w, track, 0.5) / segmentLength(w, track)).toBeCloseTo(repairCost(w, road, 0.5) / segmentLength(w, road), 6);
  });

  test("selling a route's last train drops it, and the train leaves the rail set", () => {
    const w = railWorld();
    buildTrack(w, "big", "far");
    addTrain(w, "big", "far");
    const route = w.routes.find((r) => r.id.startsWith("rail:"))!;
    expect(removeBus(w, route.id)).toBeGreaterThan(0);
    expect(w.routes.some((r) => r.id === route.id)).toBe(false);
    expect(w.railVehicles.size).toBe(0);
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

describe("slice: money over the last day (ledger)", () => {
  test("net, last day matches what the funds actually did over that day", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    for (let i = 0; i < 2; i += 1) addBus(w, "big", "mid");
    run(w, 60);
    const start = w.economy.funds;
    run(w, 30);
    // The ledger's day and the test's day differ by under a second, so they
    // can disagree by at most a busload of fares landing in the gap.
    const busload = w.tuning.busCapacity * w.tuning.fare;
    expect(Math.abs(lastDay(w.ledger).net - (w.economy.funds - start))).toBeLessThan(busload);
  });

  test("it holds steadier than the old third-of-a-day average", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    for (let i = 0; i < 2; i += 1) addBus(w, "big", "mid");
    run(w, 90);
    const ledger: number[] = [];
    const ema: number[] = [];
    for (let t = 0; t < 60; t += 1) {
      run(w, 1);
      ledger.push(lastDay(w.ledger).net);
      ema.push((w.economy.incomeRateEMA - w.economy.costRateEMA) * 30);
    }
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(spread(ledger)).toBeLessThan(spread(ema) * 0.75);
  });

  test("a new route reads at its real rate from the start, not ramping from zero", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    addBus(w, "big", "mid");
    run(w, 90);
    addBus(w, "mid", "far");
    run(w, 20); // its first unload: a bus placed mid-route starts empty
    const early = routeSummaries(w).find((r) => r.id.includes("far"))!.incomePerDay;
    run(w, 60);
    const settled = routeSummaries(w).find((r) => r.id.includes("far"))!.incomePerDay;
    expect(early).toBeGreaterThan(settled * 0.4);
    expect(early).toBeLessThan(settled * 2.5);
  });
});

describe("slice: receipts (a day after each action, exactly what it did)", () => {
  function runWithReceipts(w: SliceWorld, book: ReturnType<typeof createReceiptBook>, seconds: number): Receipt[] {
    const out: Receipt[] = [];
    for (let t = 0; t < seconds; t += SIM_DT) {
      sliceTick(w, SIM_DT);
      out.push(...tickReceipts(w, book, SIM_DT));
    }
    return out;
  }
  /** Ticks until the next receipt finishes; returns it and how many ticks it took. */
  function untilReceipt(w: SliceWorld, book: ReturnType<typeof createReceiptBook>): { receipt: Receipt; ticks: number } {
    for (let ticks = 1; ; ticks += 1) {
      sliceTick(w, SIM_DT);
      const [receipt] = tickReceipts(w, book, SIM_DT);
      if (receipt) return { receipt, ticks };
    }
  }

  test("a receipt equals the difference between the world with and without the action", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    addBus(w, "big", "mid");
    run(w, 90);
    const without = structuredClone(w);
    const withBus = structuredClone(w);
    addBus(withBus, "big", "mid");
    const book = createReceiptBook();
    perform(w, book, (x) => addBus(x, "big", "mid").ok, { label: "2nd bus", towns: ["big", "mid"], routeId: w.routes[0]!.id });
    const { receipt, ticks } = untilReceipt(w, book);
    expect(receipt.capital).toBe(w.tuning.busPurchaseCost);
    // The same measurement done by hand: the second day's change in the gap.
    const settleTicks = Math.round(SETTLE_SECONDS / SIM_DT);
    for (let i = 0; i < settleTicks; i += 1) {
      sliceTick(without, SIM_DT);
      sliceTick(withBus, SIM_DT);
    }
    const gap1 = withBus.economy.funds - without.economy.funds;
    for (let i = settleTicks; i < ticks; i += 1) {
      sliceTick(without, SIM_DT);
      sliceTick(withBus, SIM_DT);
    }
    const gap2 = withBus.economy.funds - without.economy.funds;
    expect(receipt.moneyPerDay).toBeCloseTo((gap2 - gap1) / receipt.measuredDays, 0);
    expect(receipt.you).toBeGreaterThan(0);
  });

  test("a refused action leaves no receipt and costs nothing", () => {
    const w = world();
    const book = createReceiptBook();
    const before = w.economy.funds;
    expect(perform(w, book, (x) => addBus(x, "big", "cut").ok, { label: "bus to nowhere", towns: [] })).toBe(false);
    expect(book.pending).toHaveLength(0);
    expect(w.economy.funds).toBe(before);
  });

  test("a later action isn't credited to an earlier one: it's replayed into the earlier copy", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    run(w, 60);
    const book = createReceiptBook();
    perform(w, book, (x) => addBus(x, "big", "mid").ok, { label: "first", towns: ["big"] });
    run(w, 1);
    perform(w, book, (x) => addBus(x, "mid", "far").ok, { label: "second", towns: ["far"] });
    // The first copy now has the second route too: it differs from reality only by the first bus.
    expect(book.pending[0]!.shadow.routes.some((r) => r.id.includes("far"))).toBe(true);
    expect(book.pending[0]!.shadow.routes.some((r) => r.id.includes("big"))).toBe(false);
  });

  test("selling a bus reports its capital as money coming in, and what it saved or lost", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    addBus(w, "big", "mid");
    addBus(w, "big", "mid");
    run(w, 120);
    const book = createReceiptBook();
    const routeId = w.routes[0]!.id;
    perform(w, book, (x) => removeBus(x, routeId) > 0, { label: "sold a bus", towns: ["big"] });
    const [receipt] = runWithReceipts(w, book, RECEIPT_SECONDS + 1);
    expect(receipt!.capital).toBeLessThan(0);
    expect(receipt!.paybackDays).toBeNull();
    expect(receipt!.you).toBeLessThanOrEqual(0);
  });

  test("never more than four measured at once: a fifth finishes the oldest early", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    const book = createReceiptBook();
    for (let i = 0; i < 5; i += 1) {
      perform(w, book, (x) => addBus(x, "big", "mid").ok, { label: `bus ${i}`, towns: [] });
      run(w, 1);
    }
    expect(book.pending).toHaveLength(4);
    expect(book.done).toHaveLength(1);
    expect(book.done[0]!.measuredDays).toBeLessThan(1);
  });
});

describe("slice: a road split by roadside towns is still one road", () => {
  function splitRoad(): SliceWorld {
    const w = world({ startingFunds: 1e6, foundTownFlow: 1, foundTownPlayerFlow: 0.3, minSecondsBetweenTowns: 0, maxEmergentTowns: 1 });
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    run(w, 400);
    expect(w.settlement.emergent.size).toBe(1);
    return w;
  }

  test("the chain runs from end town to end town through the roadside town", () => {
    const w = splitRoad();
    const chain = roadChain(w, "big", "mid")!;
    expect(chain).toHaveLength(2);
    const whole = chainOf(w, chain[1]!.id)!;
    expect(new Set([whole.a, whole.b])).toEqual(new Set(["big", "mid"]));
    expect(whole.pieces.map((p) => p.id)).toEqual(chain.map((p) => p.id));
  });

  test("paving it by its end towns paves every piece", () => {
    const w = splitRoad();
    expect(paveRoad(w, "big", "mid").ok).toBe(true);
    for (const piece of roadChain(w, "big", "mid")!) expect(piece.surface).toBe("paved");
  });

  test("you can't build a second road alongside it", () => {
    const w = splitRoad();
    expect(checkRoad(w, "big", "mid")).toEqual({ ok: false, reason: "already connected directly" });
  });

  test("fixing one piece maintains the whole road", () => {
    const w = splitRoad();
    const chain = roadChain(w, "big", "mid")!;
    const result = setRoadMaintained(w, chain[0]!.id, true);
    expect(result.ok).toBe(true);
    for (const piece of chain) expect(w.maintained.has(piece.id)).toBe(true);
    setRoadMaintained(w, chain[1]!.id, false);
    for (const piece of chain) expect(w.maintained.has(piece.id)).toBe(false);
  });
});

describe("slice: worn roads cost your vehicles (track 2)", () => {
  // Same world twice, warmed, then one maintains the road: the money
  // difference over the next days is what maintaining it was worth.
  function maintainWorth(setup: (w: SliceWorld) => void, a: string, b: string): number {
    const make = () => {
      const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, inheritedRoadCondition: 0.6 });
      setup(w);
      run(w, 120);
      return w;
    };
    const kept = make();
    const left = make();
    for (const piece of roadChain(kept, a, b)!) setRoadMaintained(kept, piece.id, true);
    const start = kept.economy.funds - left.economy.funds; // the catch-up repair
    run(kept, 300);
    run(left, 300);
    return kept.economy.funds - left.economy.funds - start;
  }

  test("a worn road makes your buses cost more to run", () => {
    const sound = world({ startingFunds: 1e6, maxEmergentTowns: 0, inheritedRoadCondition: 1 });
    const worn = world({ startingFunds: 1e6, maxEmergentTowns: 0, inheritedRoadCondition: 0.4 });
    for (const w of [sound, worn]) {
      addBus(w, "big", "mid");
      run(w, 60);
    }
    const cost = (w: SliceWorld) => routeSummaries(w)[0]!.costPerDay;
    expect(cost(worn)).toBeGreaterThan(cost(sound) * 1.2);
  });

  test("keeping up a road your buses run on pays; keeping up one only danfos use doesn't", () => {
    const busy = maintainWorth((w) => {
      for (let i = 0; i < 4; i += 1) addBus(w, "big", "mid");
    }, "big", "mid");
    const danfosOnly = maintainWorth(() => {}, "mid", "far");
    expect(busy).toBeGreaterThan(0);
    expect(danfosOnly).toBeLessThan(0);
  });
});

describe("slice: halts on the old line (track 2)", () => {
  // MAP plus an old export line Big - Far, passing ~8 cells from Mid.
  const railWorld = () =>
    createSliceWorld(
      { ...MAP, rails: [{ a: "big", b: "far" }] },
      { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, haltReachCells: 10 },
    );

  test("the old line passing Mid offers a halt there, and nowhere it doesn't pass", () => {
    const w = railWorld();
    const site = haltSite(w, "mid")!;
    expect(site.distance).toBeGreaterThan(5);
    expect(site.distance).toBeLessThan(10);
    expect(haltSite(w, "cut")).toBeNull();
  });

  test("a halt splits the line into the town, so each side can be restored on its own", () => {
    const w = railWorld();
    expect(buildHalt(w, "mid").ok).toBe(true);
    expect(haltSite(w, "mid")).toBeNull(); // it's on the line now
    expect(trackAction(w, "big", "mid")).toBe("restore");
    expect(trackAction(w, "mid", "far")).toBe("restore");
    expect(buildTrack(w, "big", "mid").ok).toBe(true); // just the useful stretch
    expect(railPath(w, "big", "mid")).not.toBeNull();
    expect(railPath(w, "big", "far")).toBeNull(); // the rest still out of service
    expect(addTrain(w, "big", "mid").ok).toBe(true);
  });

  test("a train already on the line stops at a new halt", () => {
    const w = railWorld();
    buildTrack(w, "big", "far");
    addTrain(w, "big", "far");
    run(w, 30);
    buildHalt(w, "mid");
    const train = w.simulation.vehicles.find((v) => w.railVehicles.has(v.id))!;
    expect(train.path).toContain("mid");
  });

  test("the old narrow-gauge line runs slower than new track", () => {
    const w = railWorld();
    buildTrack(w, "big", "far"); // restore
    buildTrack(w, "big", "mid"); // new track
    run(w, 1);
    const old = w.simulation.map.segments.find((s) => s.type === "rail" && s.provenance === "inherited")!;
    const fresh = w.simulation.map.segments.find((s) => s.type === "rail" && s.provenance === "built")!;
    expect(w.segmentSpeed.get(old.id)).toBeCloseTo(w.tuning.oldLineSpeed);
    expect(w.segmentSpeed.get(fresh.id)).toBe(1);
  });
});

describe("slice: a lorry on worn roads says so (track 2)", () => {
  test("worn dirt roads read as the lorry route's reason, naming the roads to pave", () => {
    // Big is the port: supplies out to Far, Far's produce in to market Mid -- goods both ways along it.
    const w = createSliceWorld({ ...MAP, port: "big" }, { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, inheritedRoadCondition: 0.35 });
    addLorry(w, "big", "far");
    run(w, 120);
    const d = diagnoseLorryRoute(w, w.lorryRoutes[0]!.id)!;
    expect(d.roughPerDay).toBeGreaterThan(0);
    expect(d.verdict).toBe("worn");
    expect(dirtRoadsOn(w, w.lorryRoutes[0]!.id).length).toBeGreaterThan(0);
  });
});

describe("slice: a route too long for flat fares (playtest, day 31)", () => {
  test("full, but a full bus loses money: it says the route is too long, not to add a bus", () => {
    // Small buses so it runs full; the long run big-mid-far makes few trips a day.
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, busCapacity: 6 });
    addBus(w, "big", "far");
    run(w, 600);
    const d = diagnoseRoute(w, w.routes[0]!.id)!;
    expect(d.loadFactor).toBeGreaterThanOrEqual(0.85);
    expect(d.incomePerVehicle).toBeLessThan(d.costPerVehicle);
    expect(d.verdict).toBe("long");
    // And it names the stop to end it at, which makes more round trips.
    expect(d.shorter).not.toBeNull();
    expect(d.shorter!.b).toBe("mid");
    expect(d.shorter!.roundTripsPerDay).toBeGreaterThan(d.roundTripsPerDay);
  });
});

describe("slice: forecast before acting (playtest, day 31)", () => {
  test("a forecast is the receipt the same action then gets, if nothing else changes", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    addBus(w, "big", "mid");
    run(w, 90);
    const spec = { label: "2nd bus", towns: ["big", "mid"] };
    const predicted = forecast(w, { kind: "bus", a: "big", b: "mid" }, spec)!;
    const book = createReceiptBook();
    perform(w, book, (x) => applyAction(x, { kind: "bus", a: "big", b: "mid" }).ok, spec);
    let receipt: Receipt | undefined;
    while (!receipt) {
      sliceTick(w, SIM_DT);
      [receipt] = tickReceipts(w, book, SIM_DT);
    }
    expect(predicted.moneyPerDay).toBeCloseTo(receipt.moneyPerDay, 6);
    expect(predicted.you).toBeCloseTo(receipt.you, 6);
  });

  test("forecasting changes nothing in the real world", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    run(w, 30);
    const before = { funds: w.economy.funds, routes: w.routes.length, t: w.economy.elapsedSeconds };
    forecast(w, { kind: "bus", a: "big", b: "mid" }, { label: "a bus", towns: [] });
    expect({ funds: w.economy.funds, routes: w.routes.length, t: w.economy.elapsedSeconds }).toEqual(before);
  });

  test("a refused action forecasts nothing", () => {
    const w = world();
    expect(forecast(w, { kind: "bus", a: "big", b: "cut" }, { label: "nowhere", towns: [] })).toBeNull();
  });

  test("a road alone forecasts no fares, only its upkeep and who it lets travel", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, ...noBudget });
    run(w, 60);
    const predicted = forecast(w, { kind: "road", a: "mid", b: "cut", alignment: "cheapest" }, { label: "road", towns: ["cut"] })!;
    const built = structuredClone(w);
    buildRoad(built, "mid", "cut");
    const upkeep = routineUpkeepPerDay(built, built.simulation.map.segments.find((s) => s.provenance === "built")!);
    expect(upkeep).toBeGreaterThan(0);
    expect(predicted.moneyPerDay).toBeCloseTo(-upkeep, 0);
    expect(predicted.towns[0]!.informal).toBeGreaterThan(0);
  });
});

describe("slice: the minibus (playtest, day 11)", () => {
  test("a minibus runs its own route, smaller and cheaper than a bus", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    const before = w.economy.funds;
    expect(addMinibus(w, "big", "mid").ok).toBe(true);
    expect(before - w.economy.funds).toBe(w.tuning.minibusPurchaseCost);
    const route = w.routes.find((r) => isMinibusRoute(r.id))!;
    const vehicle = w.simulation.vehicles.find((v) => v.id === route.vehicleIds[0])!;
    expect(vehicle.capacity).toBe(w.tuning.minibusCapacity);
    expect(routeSummaries(w).find((r) => r.id === route.id)!.costPerDay).toBeLessThan(w.tuning.busOperatingCostPerSecond * 30);
  });

  test("on a thin route a minibus loses less than a bus (or pays where a bus can't)", () => {
    const run2 = (kind: "bus" | "minibus") => {
      const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
      run(w, 60);
      return forecast(w, { kind, a: "mid", b: "far" }, { label: "", towns: [] })!.moneyPerDay;
    };
    expect(run2("minibus")).toBeGreaterThan(run2("bus"));
  });

  test("riders change between a minibus and a bus like any two routes", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0 });
    addBus(w, "big", "mid");
    addMinibus(w, "mid", "far");
    expect(tripPlans(w).rides.get("big")!.get("far")).toBe(2);
  });
});

describe("slice: the way out mends before it sells (playtest, day 25)", () => {
  test("a losing route on worn roads is mended first; only what it still loses is a reason to sell", () => {
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, inheritedRoadCondition: 0.35, roughRoadCostMax: 1.5 });
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    run(w, 120);
    w.economy.funds = -10;
    const advice = debtAdvice(w)!;
    const routeId = w.routes[0]!.id;
    if (routeSummaries(w)[0]!.netPerDay >= 0) return; // not losing in this world: nothing to check
    const loss = -routeSummaries(w)[0]!.netPerDay;
    const fix = advice.fix.find((f) => f.routeId === routeId)!;
    expect(fix.savesPerDay).toBeGreaterThan(0);
    // Selling is only advised for what it still loses once mended.
    const sell = advice.sell.find((s) => s.routeId === routeId);
    if (sell) expect(sell.savesPerDay).toBeCloseTo(loss - fix.savesPerDay, 6);
  });
});

describe("slice zero step 7: the budget breakdown", () => {
  test("its lines, a day over the last 5 days, sum to the strip's net", () => {
    const w = startSliceGame(MAP, { ...DEFAULT_SLICE_TUNING, maxEmergentTowns: 0 });
    addBus(w, "big", "mid");
    buildRoad(w, "mid", "cut");
    run(w, 3 * SECONDS_PER_GAME_DAY);
    const b = averageBudget(w);
    expect(b.fares).toBeGreaterThan(0);
    expect(b.running).toBeGreaterThan(0);
    expect(b.upkeep).toBeGreaterThan(0); // the road you built
    expect(b.levies).toBeGreaterThan(0);
    expect(b.allocation).toBeGreaterThan(0);
    const net = b.fares + b.goods + b.tolls + b.levies + b.allocation - b.running - b.upkeep - b.enforcement;
    expect(net).toBeCloseTo(averageNet(w), 0);
  });

  test("the warm-up's money isn't yours: the breakdown starts at day 1", () => {
    const w = startSliceGame(MAP, { ...DEFAULT_SLICE_TUNING, maxEmergentTowns: 0 });
    run(w, SECONDS_PER_GAME_DAY);
    // Doing nothing: the base allocation and the levies, a day's worth each.
    const b = averageBudget(w);
    expect(b.allocation).toBeCloseTo(DEFAULT_SLICE_TUNING.allocationBase, 0);
    expect(b.fares).toBe(0);
  });

  test("the remittance remembers what it last took, and when", () => {
    const w = startSliceGame(MAP, { ...DEFAULT_SLICE_TUNING, maxEmergentTowns: 0, startingFunds: 10_000 });
    expect(w.remittance.last).toBeNull();
    run(w, DEFAULT_SLICE_TUNING.remittancePeriodDays * SECONDS_PER_GAME_DAY + 1);
    expect(w.remittance.last).not.toBeNull();
    expect(w.remittance.last!.amount).toBeCloseTo(w.budget.remitted, 6);
  });
});

describe("slice zero step 8: route verdicts and hints", () => {
  test("every short verdict is at most 12 words", () => {
    const verdicts: RouteVerdict[] = ["thin", "overcapacity", "jammed", "long", "worn", "full", "poached", "waiting", "healthy"];
    for (const verdict of verdicts) {
      for (const vehicle of ["bus", "minibus", "train"]) {
        for (const netPerDay of [-50, 50]) {
          for (const [dirtRoad, throughTo] of [[null, null], ["Owode–Ado", "Ikole"]] as const) {
            const text = shortVerdict({ verdict, vehicle, netPerDay, dirtRoad, throughTo });
            expect(wordCount(text)).toBeLessThanOrEqual(MAX_VERDICT_WORDS);
          }
        }
      }
    }
  });

  test("a route losing money is never told to add a vehicle", () => {
    const verdicts: RouteVerdict[] = ["thin", "overcapacity", "jammed", "long", "worn", "full", "poached", "waiting", "healthy"];
    for (const verdict of verdicts) {
      const text = shortVerdict({ verdict, vehicle: "bus", netPerDay: -29, dirtRoad: null, throughTo: null });
      if (verdict !== "full") expect(text).not.toContain("(+)");
    }
  });

  test("hint 1 shows at the start and goes once you hover a town; hint 2 follows", () => {
    const w = startSliceGame(MAP, { ...DEFAULT_SLICE_TUNING, maxEmergentTowns: 0 });
    const hints = createHintState();
    expect(updateHints(hints, w, null)?.id).toBe(1);
    expect(updateHints(hints, w, "big")?.id).toBe(2);
    expect(updateHints(hints, w, "big")?.town).toBe("big");
    // Done by doing the thing: running a bus.
    addBus(w, "big", "mid");
    expect(updateHints(hints, w, null)).toBeNull();
    expect(hints.done.has(2)).toBe(true);
  });

  test("hint 3 waits its turn, and is skipped if a road was built meanwhile", () => {
    const w = startSliceGame(MAP, { ...DEFAULT_SLICE_TUNING, maxEmergentTowns: 0, startingFunds: 1e6 });
    const hints = createHintState();
    updateHints(hints, w, null); // hint 1 showing
    updateHints(hints, w, "big"); // hint 2 now, hint 1 done
    updateHints(hints, w, "cut"); // hint 3 latched behind hint 2
    expect(hints.triggered.has(3)).toBe(true);
    buildRoad(w, "mid", "cut");
    addBus(w, "big", "mid"); // hint 2 done
    const next = updateHints(hints, w, null);
    expect(next?.id).not.toBe(3);
    expect(hints.done.has(3)).toBe(true);
  });

  test("a hint fires once: dismissed, it never comes back; off, nothing shows", () => {
    const w = startSliceGame(MAP, { ...DEFAULT_SLICE_TUNING, maxEmergentTowns: 0 });
    const hints = createHintState();
    updateHints(hints, w, null);
    dismissHint(hints);
    expect(updateHints(hints, w, null)).toBeNull();
    expect(hints.done.has(1)).toBe(true);
    const off = createHintState(true);
    expect(updateHints(off, w, null)).toBeNull();
  });

  test("hint 6 follows the first road you build, by the road, and goes after a day", () => {
    const w = startSliceGame(MAP, { ...DEFAULT_SLICE_TUNING, maxEmergentTowns: 0, startingFunds: 1e6 });
    const hints = createHintState();
    updateHints(hints, w, "big");
    addBus(w, "big", "mid");
    updateHints(hints, w, null);
    buildRoad(w, "mid", "cut");
    const hint = updateHints(hints, w, null);
    expect(hint?.id).toBe(6);
    expect(["mid", "cut"]).toContain(hint!.town!);
    run(w, SECONDS_PER_GAME_DAY + 1);
    expect(updateHints(hints, w, null)?.id).not.toBe(6);
  });
});

describe("Revision 1, 1a: a town's cap is set by its best corridor's rung", () => {
  test("paving a town's road raises its cap; dirt allows the share it always did", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    const t = w.tuning;
    expect(bestRung(w, "mid")).toBe("dirt");
    expect(townGrowth(w, "mid")!.cap).toBeCloseTo(50 * (1 + t.townGrowthCap * t.growthCapDirtShare));
    paveRoad(w, "big", "mid");
    expect(bestRung(w, "mid")).toBe("paved");
    expect(townGrowth(w, "mid")!.cap).toBeCloseTo(50 * (1 + t.townGrowthCap));
  });

  test("the cap never follows the town's current size (principles §3, Growth)", () => {
    const w = world({ maxEmergentTowns: 0 });
    const before = townGrowth(w, "mid")!.cap;
    w.towns.get("mid")!.population *= 1.4;
    expect(townGrowth(w, "mid")!.cap).toBe(before);
  });

  test("a town no road reaches has no rung and no room to grow", () => {
    const w = world({ maxEmergentTowns: 0 });
    expect(bestRung(w, "cut")).toBe("none");
    expect(townGrowth(w, "cut")!.cap).toBe(20);
  });
});

describe("Revision 1, 1b: the bus lane, and the strike it brings", () => {
  test("a lane needs a paved road, costs money, and lifts its towns' cap", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    expect(checkLane(w, "big", "mid")).toEqual({ ok: false, reason: "pave it first" });
    paveRoad(w, "big", "mid");
    const capPaved = townGrowth(w, "mid")!.cap;
    const funds = w.economy.funds;
    const price = laneCost(w, "big", "mid");
    expect(addBusLane(w, "big", "mid").ok).toBe(true);
    expect(w.economy.funds).toBeCloseTo(funds - price);
    expect(bestRung(w, "mid")).toBe("lane");
    expect(townGrowth(w, "mid")!.cap).toBeGreaterThan(capPaved);
    expect(checkLane(w, "big", "mid")).toEqual({ ok: false, reason: "it already has a bus lane" });
  });

  test("the danfos lose road space on it; your buses run free of the traffic", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6, informalRoadSpace: 30 });
    paveRoad(w, "big", "mid");
    const road = roadChain(w, "big", "mid")![0]!;
    expect(informalBudget(w, road.id)).toBe(30);
    addBusLane(w, "big", "mid");
    expect(informalBudget(w, road.id)).toBe(w.tuning.informalRoadSpaceLane);
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    run(w, 120);
    // A few of your buses: the lane is theirs, and they run at its free speed.
    const route = w.routes.find((r) => r.id === routeKey("big", "mid"))!;
    expect(route.speedEMA).toBeGreaterThan(0.95);
    expect(w.roadFlowEMA.get(road.id) ?? 0).toBeLessThan(w.laneFlowEMA.get(road.id)!);
  });

  test("a lane has its own capacity: too many buses bunch and slow", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    paveRoad(w, "big", "mid");
    addBusLane(w, "big", "mid");
    const road = roadChain(w, "big", "mid")![0]!;
    for (let i = 0; i < 40; i += 1) addBus(w, "big", "mid");
    run(w, 120);
    expect(w.laneSpeed.get(road.id)!).toBeLessThan(0.9);
  });

  test("the union strikes a few days after the lane: no danfo sets off along it that day", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    paveRoad(w, "big", "mid");
    addBusLane(w, "big", "mid");
    const events: string[] = [];
    const step = (seconds: number) => {
      for (let t = 0; t < seconds; t += SIM_DT) for (const e of sliceTick(w, SIM_DT)) events.push(e.kind);
    };
    step((w.tuning.strikeDelayDays - 0.5) * SECONDS_PER_GAME_DAY);
    expect(events).not.toContain("strike");
    step(SECONDS_PER_GAME_DAY);
    expect(events).toContain("strike");
    const struck = struckSegments(w);
    expect(struck.size).toBeGreaterThan(0);
    // Mid-strike: count danfos that set off along the corridor.
    const before = new Set(w.informal.active.keys());
    step(SECONDS_PER_GAME_DAY * 0.4);
    const setOff = [...w.informal.active.entries()].filter(([id, trip]) => !before.has(id) && trip.mode === "danfo" && trip.segmentIds.some((s) => struck.has(s)));
    expect(setOff).toHaveLength(0);
    step(SECONDS_PER_GAME_DAY);
    expect(events).toContain("strike-over");
  });
});

describe("Revision 1, 1b+: enforcement, encroachment, and strikes that cost", () => {
  const laneWorld = () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    paveRoad(w, "big", "mid");
    addBusLane(w, "big", "mid");
    return w;
  };

  test("a new lane is strictly enforced, and its wardens are billed as their own line", () => {
    const w = laneWorld();
    expect(laneOn(w, "big", "mid")!.enforcement).toBe("strict");
    run(w, SECONDS_PER_GAME_DAY);
    expect(w.budget.enforcement).toBeGreaterThan(0);
  });

  test("left lax, danfos creep into the lane and wear its speed away; strict clears them", () => {
    const w = laneWorld();
    setEnforcement(w, "big", "mid", "lax");
    run(w, 10 * SECONDS_PER_GAME_DAY);
    const lane = laneOn(w, "big", "mid")!;
    expect(lane.encroachment).toBeCloseTo(Math.min(1, 10 * w.tuning.encroachmentPerDay), 1);
    const road = roadChain(w, "big", "mid")![0]!;
    // Their road space comes back as they take the lane.
    expect(informalBudget(w, road.id)).toBeGreaterThan(w.tuning.informalRoadSpaceLane);
    const spent = w.budget.enforcement;
    setEnforcement(w, "big", "mid", "strict");
    run(w, 3 * SECONDS_PER_GAME_DAY);
    expect(lane.encroachment).toBeLessThan(0.01);
    expect(w.budget.enforcement).toBeGreaterThan(spent);
  });

  test("strict enforcement brings strikes far sooner than lax", () => {
    const firstStrike = (enforcement: "strict" | "lax") => {
      const w = laneWorld();
      setEnforcement(w, "big", "mid", enforcement);
      for (let t = 0; t < 40 * SECONDS_PER_GAME_DAY; t += SIM_DT) if (sliceTick(w, SIM_DT).some((e) => e.kind === "strike")) return t / SECONDS_PER_GAME_DAY;
      return Infinity;
    };
    expect(firstStrike("strict")).toBeLessThan(firstStrike("lax"));
  });

  test("on a strike day the strikers block the lane: your buses are back in general traffic", () => {
    const w = laneWorld();
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    const road = roadChain(w, "big", "mid")![0]!;
    for (let t = 0; t < 30 * SECONDS_PER_GAME_DAY && struckSegments(w).size === 0; t += SIM_DT) sliceTick(w, SIM_DT);
    expect(struckSegments(w).has(road.id)).toBe(true);
    run(w, 1);
    expect(w.laneSpeed.has(road.id)).toBe(false);
  });
});
