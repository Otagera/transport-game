import { laneMood } from "@engine/game/union";
import { LINE_COLOURS, labelOf, roadLabelKey, routeLabelKey } from "@engine/game/labels";
import { waysFor } from "@engine/game/crossings";
import { isWater } from "@engine/pathing/terrainAStar";
import { SWITCHED_OFF } from "@engine/game/tuning";
import { borderFuelSite, exportGateway, importsArriving, portScale, seaportLink } from "@engine/game/gateways";
import { builtUp, homeBox } from "@engine/game/fuel";
import { fordBridgeCost, highBridgeCost, isFlooded } from "@engine/game/floods";
import { farmland } from "@engine/game/food";
import { clusterOfferShare } from "@engine/game/clusters";
import { privateLoad, townCars, updatePrivateTraffic } from "@engine/game/private";
import { fuelReach, fuelSupply } from "@engine/game/fuel";
import type { GameEvent } from "@engine/game/settlement";
import { pledgeMove, pledgeNow, pledgeProgress, type TermRecord } from "@engine/game/term";
import { fuelPlanned, fuelReachable } from "@engine/game/fuel";
import { describe, expect, test } from "bun:test";
import { addBus, buildRoad, createGameWorld, largestGapMidpoint, networkShare, removeBus, roadCost, routeSummaries, townOutcomes, tripsFrom, waitingAt, diagnoseRoute, isCutOff, roadPath, debtAdvice, demandAlong, throughRoute, pairDemand, paveRoad, paveCost, checkPave, dirtRoadsOn, localTravel, roadChain, chainOf, checkRoad, addMinibus, isMinibusRoute, headline, routeKey, gameDay, directRoad } from "@engine/game/world";
import { informalBudget, gameTick } from "@engine/game/tick";
import { laneOn, setEnforcement, settleStrike, settlementPrice, struckSegments } from "@engine/game/pushback";
import { addBrt, addBusLane, brtRouteId, checkBrt, checkLane, laneCost } from "@engine/game/world";
import { heldForProject, nameProject, updateProject } from "@engine/game/project";
import { ALL_SYSTEMS_ON, DEFAULT_GAME_TUNING } from "@engine/game/tuning";
import type { GameMapDef, GameTuning, GameWorld } from "@engine/game/types";
import { SIM_DT } from "@engine/loop";
import { lastDay, routeExtraCostLastDay, routeIncomeLastDay } from "@engine/game/ledger";
import { forecast } from "@engine/game/forecast";
import { allocationPerDay, remittanceDue, remittanceExpected } from "@engine/game/budget";
import { goodsFares, legFare, stageFare } from "@engine/game/fares";
import { routineUpkeepPerDay, totalRoutineUpkeepPerDay } from "@engine/game/upkeep";
import { paveStepCost } from "@engine/pathing/cost";
import { paveMoves } from "@engine/game/moves";
import { startGame } from "@engine/game/start";
import { industryFlows, openQuarry, stoneServed, updateIndustries } from "@engine/game/industries";
import { bondAmount, repayBonds } from "@engine/game/bonds";
import { expandCost } from "@engine/game/expand";
import { expectedShare } from "@engine/game/growth";
import { sweepDue, updateSweep } from "@engine/game/sweep";
import { cropsFor, farmTowns, flourCapacity, flourOutput, flourWant, foodGrowth, foodServed, foodWant, marketFed, marketTowns, millOutput, payExports } from "@engine/game/food";
import { jobsGrowth, siteJobs, staffFactor, updateSites, workforceShares } from "@engine/game/workers";
import { foundGateTown, refreshDemand } from "@engine/game/settlement";
import { cementDemand, cementFlows, cementImports, worksCapacity, worksOutput } from "@engine/game/cement";
import { lineSlots, onRoadCost, stationTowns, trackCost } from "@engine/game/rail";
import { haulShare, truckersPickUp } from "@engine/game/truckers";
import { cargoName, chargeFuelPremium, fuelFlows, refineryOutput, newRefinery, newRefineryOutput, newRefineryCapacity, updateNewRefinery } from "@engine/game/fuel";
import { siteProduction as newRefinerySiteProduction } from "@engine/game/production";
import { flowKey } from "@engine/game/goods";
import { restoreRoad, retireRoad } from "@engine/game/retire";
import { isYourRoad } from "@engine/game/upkeep";
import { affordable, corridorNoSeat, namedMoves, noSeatPairs, seatMove, shrinkCause, townNoSeat, wornRoadAt } from "@engine/game/problems";
import { CORRIDOR_TAG_DAYS, corridorChanges, corridorSummaries, takenCorridors } from "@engine/game/corridors";
import { MILESTONE_BADGE_DAYS, TREND_DAYS, freshMilestone, milestoneLabel, peopleSinceStart, tripsTrend, updateMilestones } from "@engine/game/score";
import { variedGameMap } from "@engine/game/variation";
import { generatedMapInfo, generatedGameMap } from "@engine/game/generate";
import { REGION_HEIGHT, REGION_WIDTH, gameMap, regionInfo } from "@engine/game/region";
import { restoreSteel, steelDemand, steelFlows, steelImports, steelServed } from "@engine/game/steel";
import { issueBond as issueSteelBond } from "@engine/game/bonds";
import { flowKey as goodsKey, recordGoodsDelivered, relayArrivals } from "@engine/game/goods";
import { goodsOnTheWay, haulBreak, haulDistance, haulPlans, legReach, nextStop, relayed, yardWouldBring } from "@engine/game/haulage";
import { buildYard } from "@engine/game/yards";
import { backToStation, foundStationTowns, stationOpen } from "@engine/game/stations";
import { correspondentName, handoverNote, notATutorial, predecessors, termLetter } from "../src/game/correspondent";
import { thenAndNowSvg } from "../src/game/thenandnow";
import { MITER_LIMIT, congestionStop, junctionPlates, offsetPolyline, overloaded } from "../src/game/corridor";
import { PRIORITY, Placer, drawsAt, tierOf } from "../src/game/density";
import { assemblyGeneration, assemblyNeeds, assemblyShare, updateAssembly, vehiclePrice } from "@engine/game/assembly";
import { siteChain, siteProduction } from "@engine/game/production";
import { checkSignalBudget } from "../scripts/signal-budget";
import { segmentRung } from "@engine/game/roads";
import type { Segment } from "@engine/map/types";
import { isDirt as isDirtRoad } from "@engine/game/congestion";
import { agberoCutAt, parkReport } from "@engine/game/parks";
import { cementBreak } from "@engine/game/cement";
import { freightFareFactor, haulierPull } from "@engine/game/freightrates";
import { metroLines, metroRiders, runMetros } from "@engine/game/metro";
import { indexOutcomes, townShare as shareOfTown, townShareBetweenTowns } from "@engine/game/world";
import { buildGameTerrain } from "@engine/game/terrain";
import { GAME_MAP } from "../src/game/map";
import { averageBudget, averageHeadline, averageNet } from "@engine/game/history";
import { applyAction } from "@engine/game/actions";
import { createRunRecorder, recordAction, recordTick, replayRun, runFile, startRun, startRunSteps, type RunFile } from "@engine/game/runlog";
import { createReceiptBook, perform, tickReceipts, RECEIPT_SECONDS, SETTLE_SECONDS, type Receipt } from "@engine/game/receipts";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import { insertIntoPath } from "@engine/game/settlement";
import { setRoadMaintained } from "@engine/game/wear";
import { routesOnTrip, tripPlans } from "@engine/game/transfers";
import { roadCapacity, speedFactor } from "@engine/game/congestion";
import { costRate, planRoad, polylineLength, segmentLength, segmentPolyline } from "@engine/game/roads";
import { bridgeCellsOn, corridorWear, fixRoadNow, repairCost, setMaintained, upkeepPerDay, wearRate } from "@engine/game/wear";
import { computeBurnRate } from "@engine/economy/report";
import { bestRung, growthTrend, roadFull, townGrowth } from "@engine/game/growth";
import { addFreightTrain, addLorry, diagnoseLorryRoute, goodsAlong, goodsFlows, lorryEstimate, removeLorry, lorrySummaries } from "@engine/game/goods";
import { buildHalt, haltSite, addTrain, buildTrack, checkTrain, derelictRun, railPath, restoreCost, trackAction } from "@engine/game/rail";
import { slowOrder } from "@engine/game/wear";
import type { Vehicle } from "@engine/simulation/types";
import { createHintState, dismissHint, updateHints } from "../src/game/hints";
import { MAX_VERDICT_WORDS, shortVerdict, wordCount } from "../src/game/verdicts";
import type { RouteVerdict } from "@engine/game/world";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Tests that pin what the player should *feel*, not just that the
// mechanics run (docs/principles.md §6): bounded queues, a frequency
// optimum, danfos filling gaps, unconnected towns staying home.

const MAP: GameMapDef = {
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

function run(world: GameWorld, seconds: number): void {
  for (let t = 0; t < seconds; t += SIM_DT) gameTick(world, SIM_DT);
}

/** No tolls, levies or allocation: for tests about fares or costs alone. */
const noBudget: Partial<GameTuning> = { tollPerRoad: 0, levyPerSeat: 0, allocationBase: 0, allocationPerThousand: 0, remittanceEnabled: false, levyEnabled: false };
/** The remittance as it was (budget.ts remit), for the tests of it: the levy off. */
const REMITTANCE: Partial<GameTuning> = { remittanceEnabled: true, levyEnabled: false };

function world(overrides: Partial<GameTuning> = {}): GameWorld {
  // The small map's mechanics were measured without private cars (private.ts); a test of them opts in.
  return createGameWorld(MAP, { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, privateTrafficEnabled: false, ...overrides });
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
  }, 20_000); // several fleets run for days each: ~5-7 s, over bun's 5 s default on a loaded machine

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
    expect(refund).toBeLessThan(DEFAULT_GAME_TUNING.busPurchaseCost);
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
  // Wear and goods came back on by default (Revision 2); switched off they still behave as slice zero had them.
  const zero = () => createGameWorld({ ...MAP, port: "big", rails: [{ a: "big", b: "far" }] }, { ...DEFAULT_GAME_TUNING, startingFunds: 1e6, maxEmergentTowns: 0, wearEnabled: false, goodsEnabled: false });

  test("the default tuning: the straight alignment off; rail back as the ladder's top rung (Revision 1); wear and goods back (Revision 2)", () => {
    expect(DEFAULT_GAME_TUNING.wearEnabled).toBe(true);
    expect(DEFAULT_GAME_TUNING.goodsEnabled).toBe(true);
    expect(DEFAULT_GAME_TUNING.railEnabled).toBe(true);
    expect(DEFAULT_GAME_TUNING.straightAlignmentEnabled).toBe(false);
  });

  test("their actions are refused; roads, buses, minibuses and track still work", () => {
    const w = zero();
    for (const spec of [
      { kind: "lorry", a: "big", b: "mid" },
      { kind: "freight", a: "big", b: "far" },
      { kind: "road", a: "mid", b: "cut", alignment: "direct" },
    ] as const) {
      expect(applyAction(w, spec).ok).toBe(false);
    }
    const roadId = w.simulation.map.segments.find((s) => s.type === "road")!.id;
    expect(applyAction(w, { kind: "fix", segmentId: roadId, on: true }).ok).toBe(false);
    expect(applyAction(w, { kind: "road", a: "mid", b: "cut", alignment: "cheapest" }).ok).toBe(true);
    expect(applyAction(w, { kind: "bus", a: "big", b: "mid" }).ok).toBe(true);
    expect(applyAction(w, { kind: "minibus", a: "mid", b: "cut" }).ok).toBe(true);
    w.economy.funds = 1e6;
    expect(applyAction(w, { kind: "track", a: "big", b: "far", alignment: "cheapest" }).ok).toBe(true);
  });

  test("a bus takes a shorter road built after it was bought, once it's back at the start of its route", () => {
    const w = world();
    w.economy.funds = 1e7;
    expect(addBus(w, "big", "far").ok).toBe(true);
    const bus = w.simulation.vehicles.find((v) => v.id === w.routes[0]!.vehicleIds[0])!;
    expect(bus.path).toContain("mid"); // the only road there is through Mid
    run(w, 5);
    expect(buildRoad(w, "big", "far").ok).toBe(true);
    expect(roadPath(w, "big", "far")!.nodeIds).not.toContain("mid");
    expect(bus.path).toContain("mid"); // not mid-trip: riders aboard may be bound for Mid
    run(w, 900);
    expect(bus.path).not.toContain("mid");
    expect(bus.path[0]).toBe("big");
    // Nobody left riding to a stop it no longer makes.
    expect(bus.cargo.every((entry) => bus.path.includes(entry.to))).toBe(true);
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
  test("startGame warms the world up, then day 1 begins", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    expect(gameDay(w)).toBe(1);
    expect(w.startSeconds).toBeCloseTo(DEFAULT_GAME_TUNING.warmUpDays * SECONDS_PER_GAME_DAY);
    // Danfos are already carrying people: the share you meet is the share that holds.
    const early = networkShare(w).informal;
    expect(early).toBeGreaterThan(0.2);
    run(w, 9 * SECONDS_PER_GAME_DAY);
    expect(gameDay(w)).toBe(10);
    expect(Math.abs(networkShare(w).informal - early)).toBeLessThan(0.05);
  });

  test("the 5-day averages start filled; money averages only your days", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
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
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    expect(w.informal.earnings).toBe(0);
    expect(w.economy.funds).toBe(DEFAULT_GAME_TUNING.startingFunds + (DEFAULT_GAME_TUNING.termOpeningGrant ?? 0)); // the term's opening grant is yours (term.ts)
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
    expect(informalBudget(w, bigMid)).toBe(DEFAULT_GAME_TUNING.informalRoadSpaceDirt);
    paveRoad(w, "big", "mid");
    expect(informalBudget(w, bigMid)).toBe(DEFAULT_GAME_TUNING.informalRoadSpace);
    expect(DEFAULT_GAME_TUNING.informalRoadSpace).toBeGreaterThan(DEFAULT_GAME_TUNING.informalRoadSpaceDirt);
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
      gameTick(w, SIM_DT);
      for (const info of w.informal.active.values()) if (info.segmentIds.includes(bigMid)) informalOnIt += 1;
    }
    expect(informalOnIt).toBe(0);
    // Without your bus the same road carries danfos.
    const empty = world({ startingFunds: 1e6, maxEmergentTowns: 0, informalRoadSpace: 1, informalRoadSpaceDirt: 1 });
    let informalOnEmpty = 0;
    for (let t = 0; t < 300; t += SIM_DT) {
      gameTick(empty, SIM_DT);
      for (const info of empty.informal.active.values()) if (info.segmentIds.includes(bigMid)) informalOnEmpty += 1;
    }
    expect(informalOnEmpty).toBeGreaterThan(0);
  });
});

describe("informal road space is held only ahead of the vehicle", () => {
  test("space on each road is what the informal vehicles still to drive it hold", () => {
    const w = createGameWorld(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    let checked = 0;
    let partlyReleased = 0;
    for (let t = 0; t < 600; t += SIM_DT) {
      gameTick(w, SIM_DT);
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
    // Without private cars: twelve buses on the short trunk is the point, not the town's traffic.
    const w = world({ startingFunds: 1e6, privateTrafficEnabled: false });
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
    for (let t = 0; t < 400; t += SIM_DT) for (const event of gameTick(w, SIM_DT)) events.push(event.kind);
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
    for (let t = 0; t < 60; t += SIM_DT) for (const event of gameTick(w, SIM_DT)) events.push(event.kind);
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
  function network(): GameWorld {
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

function pairDemandOn(w: GameWorld, towns: string[]): number {
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
      gameTick(w, SIM_DT);
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
    const w = world({ privateTrafficEnabled: false, startingFunds: 1e6 });
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
    // Joined only through another town: the refusal names the roads to pave instead (OpenCode playtests).
    const through = checkPave(w, "big", "far");
    expect(through.ok).toBe(false);
    expect((through as { reason: string }).reason).toMatch(/^no one road joins them: the way runs .+–.+ \(dirt\), .+–.+/);
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
      const w = world({ privateTrafficEnabled: false, startingFunds: 1e6, maxEmergentTowns: 0 });
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
    const t = { ...DEFAULT_GAME_TUNING, fareBoarding: 1, farePerStage: 1, fareStageCells: 10 };
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
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    expect(w.economy.funds).toBe(DEFAULT_GAME_TUNING.startingFunds + (DEFAULT_GAME_TUNING.termOpeningGrant ?? 0)); // the term's opening grant is yours (term.ts)
    expect(w.budget.levies).toBe(0);
    expect(w.budget.allocation).toBe(0);
  });
});

describe("slice: the treasury remittance (step 6, pass 2)", () => {
  const period = DEFAULT_GAME_TUNING.remittancePeriodDays * SECONDS_PER_GAME_DAY;
  // Income only from the allocation, so a period's net is exactly what it paid.
  const remitting = (startingFunds: number, allocationBase: number) =>
    world({ startingFunds, maxEmergentTowns: 0, townGrowthCap: 0, ...noBudget, allocationBase, remittanceEnabled: true, remittanceShare: 0.8, remittanceReserve: 3000 });

  test("it takes the share of the period's surplus when the funds are well above the reserve", () => {
    const w = remitting(100_000, 100);
    run(w, period + SIM_DT);
    const surplus = 100 * DEFAULT_GAME_TUNING.remittancePeriodDays;
    expect(w.budget.remitted).toBeCloseTo(0.8 * surplus, 0);
  });

  test("it takes the share of the funds above the reserve, never more, so saving stays possible", () => {
    const w = remitting(3_200, 100);
    run(w, period + SIM_DT);
    // ₦3,200 + ~₦1,000 surplus: ~₦1,200 above the reserve, but the surplus (~₦1,000) is the cap.
    const above = 3_200 + 100 * DEFAULT_GAME_TUNING.remittancePeriodDays - 3000;
    expect(w.budget.remitted).toBeCloseTo(0.8 * Math.min(above, 100 * DEFAULT_GAME_TUNING.remittancePeriodDays), 0);
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
  const TERRAIN_MAP: GameMapDef = {
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
  const terrainWorld = (overrides: Partial<GameTuning> = {}) => createGameWorld(TERRAIN_MAP, { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, ...overrides });

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
    expect(wearRate(w, wet)).toBeCloseTo(wearRate(w, dry) * DEFAULT_GAME_TUNING.bridgeWearMultiplier);
    expect(repairCost(w, wet, 0.5) / wet.length!).toBeGreaterThan(repairCost(w, dry, 0.5) / segmentLength(w, dry));
  });

  test("water wider than a bridge can span can't be crossed, and the refusal says why", () => {
    const wide: GameMapDef = { ...TERRAIN_MAP, towns: TERRAIN_MAP.towns.slice(0, 2), roads: [], terrain: { rivers: [{ points: [[24, -2], [24, 42]], width: 20 }] } };
    const w = createGameWorld(wide, { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6 });
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
    const wide = createGameWorld(
      { ...TERRAIN_MAP, towns: TERRAIN_MAP.towns.slice(0, 2), roads: [], terrain: { rivers: [{ points: [[24, -2], [24, 42]], width: 20 }] } },
      { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6 },
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
  const road = (w: GameWorld, a: string, b: string) =>
    w.simulation.map.segments.find((s) => (s.fromNodeId === a && s.toNodeId === b) || (s.fromNodeId === b && s.toNodeId === a))!;
  const calm = { startingFunds: 1e6, maxEmergentTowns: 0 };

  test("the inherited network arrives worn; a road you build arrives new", () => {
    const w = world(calm);
    expect(road(w, "big", "mid").condition).toBe(DEFAULT_GAME_TUNING.inheritedRoadCondition);
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
    expect(wearRate(w, road(w, "big", "mid"))).toBeCloseTo(dirtRate / DEFAULT_GAME_TUNING.dirtWearMultiplier);
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
    // At the wear rate this was written for (calibration lives in tuning.ts; this is the mechanism).
    const w = world({ ...calm, wearPerFlow: 0.00045, dirtWearMultiplier: 3 });
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
  const pop = (w: GameWorld, id: string) => w.towns.get(id)!.population;

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
    // At the wear rate this was written for: the thin route's loss includes its worn road.
    const w = world({ maxEmergentTowns: 0, wearPerFlow: 0.00045, dirtWearMultiplier: 3 });
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
    // Roads already worn, so the test is about the verdict's order, not how fast they wear.
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, busCapacity: 8, farePerStage: 30, inheritedRoadCondition: 0.35 });
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
  const goodsWorld = (overrides: Partial<GameTuning> = {}) =>
    createGameWorld({ ...MAP, port: "big" }, { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, noPlayerLorries: false, ...overrides });

  test("the lorry hint: what one more lorry would carry, never more than it can lift or than nobody else moves", () => {
    const w = goodsWorld({ truckersEnabled: false });
    const e = lorryEstimate(w, "big", "mid")!;
    const along = goodsAlong(w, "big", "mid");
    const cells = roadPath(w, "big", "mid")!.distance;
    const lift = (w.tuning.lorryCapacity * w.tuning.lorrySpeed * SECONDS_PER_GAME_DAY) / (2 * cells);
    expect(e.tonnesPerDay).toBeCloseTo(Math.min(lift, along.outbound) + Math.min(lift, along.inbound), 6);
    expect(e.costPerDay).toBeCloseTo(w.tuning.lorryOperatingCostPerSecond * SECONDS_PER_GAME_DAY, 9);
    // Goods already delivered by your vehicles aren't there for another lorry.
    // (Twice: what's delivered to a market can go on to the port, a flow of its own.)
    for (let i = 0; i < 3; i += 1) for (const flow of goodsFlows(w)) w.goods.outcomes.set(flowKey(flow), { delivered: flow.rate, spoiled: 0 });
    expect(lorryEstimate(w, "big", "mid")!.tonnesPerDay).toBeCloseTo(0, 9);
  });

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
    // Truckers off: this is the yard's own rule (with them on, they take the short hauls).
    const w = goodsWorld({ truckersEnabled: false });
    const plain = goodsWorld({ producePerThousandPerDay: 0, suppliesPerThousandPerDay: 0, truckersEnabled: false });
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
    const w = createGameWorld(
      { ...MAP, port: "big", rails: [{ a: "big", b: "far" }] },
      { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0 },
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
      const x = createGameWorld(
        { ...MAP, port: "big", rails: [{ a: "big", b: "far" }] },
        { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, freightSpeed: 8, trainSpeed: 8 },
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
    w.roadFlowEMA.set(road.id, 0);
    w.heavyFlowEMA.set(road.id, 0);
    const weather = wearRate(w, road);
    w.roadFlowEMA.set(road.id, 1);
    const light = wearRate(w, road) - weather;
    w.heavyFlowEMA.set(road.id, 1); // the same road space, all of it lorries
    // The traffic's share of the wear, lorries counted lorryWearMultiplier times over.
    expect((wearRate(w, road) - weather) / light).toBeCloseTo(w.tuning.lorryWearMultiplier, 6);
  });

  test("a losing lorry route is in the debt advice, and selling it returns what was quoted", () => {
    const w = goodsWorld({ goodsFarePerTonneCell: 0 }); // nothing it carries pays: it loses
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
  const railWorld = (overrides: Partial<GameTuning> = {}) =>
    createGameWorld({ ...MAP, rails: [{ a: "big", b: "far" }] }, { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, ...overrides });

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
    // No informal sector (hauliers' trucks held to its road space too): with only trains moving, any road flow would be the trains'.
    // (With danfos about, trains do lower road traffic -- by taking riders who'd have given up.)
    const w = railWorld({ informalRoadSpace: 0, informalRoadSpaceDirt: 0, trucksFreeOfDanfoBudget: false });
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
    const w = createGameWorld({ ...MAP, rails: [{ a: "mid", b: "cut" }] }, { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6 });
    expect(isCutOff(w, "cut")).toBe(true); // the old line is out of service
    buildTrack(w, "mid", "cut");
    expect(isCutOff(w, "cut")).toBe(false);
    expect(tripsFrom(w, "cut").find((t) => t.to === "mid")!.reachable).toBe(true);
    expect(roadPath(w, "mid", "cut")).toBeNull(); // still no road: no danfo gets there
  });

  test("track wears with the trains that run on it; disused track doesn't change", () => {
    const w = createGameWorld(
      { ...MAP, rails: [{ a: "big", b: "far" }, { a: "mid", b: "cut" }] },
      { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0 },
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
  function runWithReceipts(w: GameWorld, book: ReturnType<typeof createReceiptBook>, seconds: number): Receipt[] {
    const out: Receipt[] = [];
    for (let t = 0; t < seconds; t += SIM_DT) {
      gameTick(w, SIM_DT);
      out.push(...tickReceipts(w, book, SIM_DT));
    }
    return out;
  }
  /** Ticks until the next receipt finishes; returns it and how many ticks it took. */
  function untilReceipt(w: GameWorld, book: ReturnType<typeof createReceiptBook>): { receipt: Receipt; ticks: number } {
    for (let ticks = 1; ; ticks += 1) {
      gameTick(w, SIM_DT);
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
      gameTick(without, SIM_DT);
      gameTick(withBus, SIM_DT);
    }
    const gap1 = withBus.economy.funds - without.economy.funds;
    for (let i = settleTicks; i < ticks; i += 1) {
      gameTick(without, SIM_DT);
      gameTick(withBus, SIM_DT);
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
  function splitRoad(): GameWorld {
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
  function maintainWorth(setup: (w: GameWorld) => void, a: string, b: string): number {
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
    const cost = (w: GameWorld) => routeSummaries(w)[0]!.costPerDay;
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
    createGameWorld(
      { ...MAP, rails: [{ a: "big", b: "far" }] },
      { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, haltReachCells: 10 },
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
    const w = createGameWorld({ ...MAP, port: "big" }, { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, noPlayerLorries: false, inheritedRoadCondition: 0.35 });
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
    // At the wear rate this was written for: worn roads slow the bus, so it runs full.
    const w = world({ startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0, busCapacity: 6, wearPerFlow: 0.00045, dirtWearMultiplier: 3, privateTrafficEnabled: false });
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
      gameTick(w, SIM_DT);
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
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    addBus(w, "big", "mid");
    buildRoad(w, "mid", "cut");
    run(w, 3 * SECONDS_PER_GAME_DAY);
    const b = averageBudget(w);
    expect(b.fares).toBeGreaterThan(0);
    expect(b.running).toBeGreaterThan(0);
    expect(b.upkeep).toBeGreaterThan(0); // the road you built
    expect(b.levies).toBeGreaterThan(0);
    expect(b.allocation).toBeGreaterThan(0);
    const net = b.fares + b.goods + b.tolls + b.levies + b.loading + b.allocation - b.running - b.upkeep - b.enforcement;
    expect(net).toBeCloseTo(averageNet(w), 0);
  });

  test("the warm-up's money isn't yours: the breakdown starts at day 1", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    run(w, SECONDS_PER_GAME_DAY);
    // Doing nothing: the base allocation and the levies, a day's worth each.
    const b = averageBudget(w);
    expect(b.allocation).toBeCloseTo(DEFAULT_GAME_TUNING.allocationBase, 0);
    expect(b.fares).toBe(0);
  });

  test("the levy: the treasury takes its share of what you earn as you earn it, never the state's allocation", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0, startingFunds: 10_000 });
    expect(w.tuning.levyEnabled).toBe(true);
    expect(w.tuning.remittanceEnabled).toBe(false);
    addBus(w, "big", "mid");
    run(w, 3 * SECONDS_PER_GAME_DAY);
    const b = w.budget;
    const earned = b.fares + b.goods + b.tolls + b.levies + b.loading;
    expect(b.remitted).toBeCloseTo(w.tuning.levyShare * earned, 3);
    expect(b.remitted).toBeGreaterThan(0);
  });

  test("the remittance remembers what it last took, and when", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, ...REMITTANCE, maxEmergentTowns: 0, startingFunds: 10_000 });
    expect(w.remittance.last).toBeNull();
    run(w, DEFAULT_GAME_TUNING.remittancePeriodDays * SECONDS_PER_GAME_DAY + 1);
    expect(w.remittance.last).not.toBeNull();
    expect(w.remittance.last!.amount).toBeCloseTo(w.budget.remitted, 6);
  });

  test("the treasury visible: the countdown names what it takes, and its day comes as an event naming the amount", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, ...REMITTANCE, maxEmergentTowns: 0, startingFunds: 10_000 });
    addBus(w, "big", "mid");
    const events: Array<{ kind: string; amount?: number }> = [];
    let dueBefore = 0;
    const end = w.remittance.endsAtSeconds;
    while (w.economy.elapsedSeconds < end - 1e-6) {
      dueBefore = remittanceDue(w);
      events.push(...gameTick(w, SIM_DT));
    }
    const remitted = events.filter((event) => event.kind === "remitted");
    expect(remitted.length).toBe(1);
    expect(remitted[0]!.amount!).toBeGreaterThan(0);
    expect(remitted[0]!.amount!).toBeCloseTo(w.budget.remitted, 6);
    // The countdown a tick before named (to within a tick's money) what it took.
    expect(Math.abs(dueBefore - remitted[0]!.amount!)).toBeLessThan(5);
  });

  test("the countdown, read mid-period, expects about what the period's end takes", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, ...REMITTANCE, maxEmergentTowns: 0, startingFunds: 10_000 });
    addBus(w, "big", "mid");
    // Past the first period, so the 5-day net is a settled network's.
    run(w, w.remittance.endsAtSeconds - w.economy.elapsedSeconds + 1);
    run(w, 5 * SECONDS_PER_GAME_DAY);
    const expected = remittanceExpected(w, averageNet(w));
    const before = w.budget.remitted;
    run(w, w.remittance.endsAtSeconds - w.economy.elapsedSeconds + 1);
    const taken = w.budget.remitted - before;
    expect(taken).toBeGreaterThan(0);
    // Halfway through, the amount so far is about half; the expectation is within a fifth.
    expect(Math.abs(expected - taken) / taken).toBeLessThan(0.2);
  });

  test("money set aside for a named project is left out of what the countdown says goes", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, ...REMITTANCE, maxEmergentTowns: 0, startingFunds: 10_000 });
    addBus(w, "big", "mid");
    run(w, 5 * SECONDS_PER_GAME_DAY);
    const due = remittanceDue(w);
    expect(due).toBeGreaterThan(0);
    w.project = { a: "big", b: "mid", rung: "lane", price: 1_000_000, namedAt: w.economy.elapsedSeconds, affordableAt: null, warned: false };
    expect(remittanceDue(w)).toBe(0);
  });

  test("a named project's clock starts when you can afford it, not when you name it (playtest: rail lapsed twice)", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, ...REMITTANCE, maxEmergentTowns: 0 });
    w.project = { a: "big", b: "mid", rung: "lane", price: 50_000, namedAt: w.economy.elapsedSeconds, affordableAt: null, warned: false };
    // Saving for longer than the lapse time: still yours, nothing taken.
    w.economy.funds = 20_000;
    w.economy.elapsedSeconds += (w.tuning.projectLapseDays + 10) * SECONDS_PER_GAME_DAY;
    expect(updateProject(w)).toEqual([]);
    expect(w.project).not.toBeNull();
    // Affordable now: the clock starts, then a warning, then the lapse.
    w.economy.funds = w.tuning.remittanceReserve + 60_000;
    expect(updateProject(w).map((e) => e.kind)).toEqual(["project-affordable"]);
    w.economy.elapsedSeconds += (w.tuning.projectLapseDays - 4) * SECONDS_PER_GAME_DAY;
    expect(updateProject(w).map((e) => e.kind)).toEqual(["project-lapse-warning"]);
    expect(updateProject(w)).toEqual([]); // warned once
    w.economy.elapsedSeconds += 5 * SECONDS_PER_GAME_DAY;
    expect(updateProject(w).map((e) => e.kind)).toEqual(["project-lapsed"]);
    expect(w.project).toBeNull();
  });
});

describe("R1 5: the score as visible as money", () => {
  test("a town passing a quarter, a half, double and triple its day-1 size is an event, each once", () => {
    const w = createGameWorld(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    const mid = w.towns.get("mid")!;
    expect(updateMilestones(w)).toEqual([]);
    mid.population = 64; // +28%
    const first = updateMilestones(w);
    expect(first.map((event) => event.kind === "milestone" && event.index)).toEqual([0]);
    expect(updateMilestones(w)).toEqual([]); // not again while it stays there
    expect(freshMilestone(w, "mid")).toBe("+25%");
    // Shrinking and regrowing past it earns nothing; jumping two at once is one event naming the higher.
    mid.population = 55;
    expect(updateMilestones(w)).toEqual([]);
    mid.population = 101;
    const jump = updateMilestones(w);
    expect(jump.length).toBe(1);
    expect(jump[0]!.kind === "milestone" && jump[0]!.index).toBe(2);
    expect(freshMilestone(w, "mid")).toBe("×2");
    // The map's badge fades after a few days.
    w.economy.elapsedSeconds += (MILESTONE_BADGE_DAYS + 0.1) * SECONDS_PER_GAME_DAY;
    expect(freshMilestone(w, "mid")).toBeNull();
    expect([0, 1, 2, 3].map(milestoneLabel)).toEqual(["+25%", "+50%", "×2", "×3"]);
  });

  test("growth during the warm-up isn't yours: milestones count from day 1", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    expect(w.milestones.size).toBe(0);
    expect(peopleSinceStart(w)).toBeCloseTo(0, 6);
  });

  test("people since day 1 counts shrinking towns against growing ones", () => {
    const w = createGameWorld(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    w.towns.get("big")!.population += 10;
    w.towns.get("far")!.population -= 4;
    expect(peopleSinceStart(w)).toBeCloseTo(6, 6);
  });

  test("the trips-made trend compares the 5-day average with itself TREND_DAYS ago", () => {
    // The trend's arithmetic, on one bus's gain: relayed goods' trucks (haulage.ts) on this small
    // map's roads take about as many trips as the bus adds, so they're left out here.
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0, goodsRelay: false });
    expect(tripsTrend(w)).toBeNull();
    addBus(w, "big", "mid");
    run(w, (TREND_DAYS + 2) * SECONDS_PER_GAME_DAY + 1);
    const trend = tripsTrend(w)!;
    expect(trend.series.length).toBe(TREND_DAYS + 3); // the world as you found it, then a sample a day
    expect(trend.now).toBeCloseTo(averageHeadline(w).tripsPerDay, 6);
    expect(trend.change).toBeCloseTo(trend.now - trend.series[trend.series.length - 1 - TREND_DAYS]!, 6);
    // A bus on the best pair: more trips made than the warm-up's world.
    expect(trend.now).toBeGreaterThan(trend.series[0]!);
  });
});

describe("R1 6: each corridor's informal share, and corridor taken", () => {
  function runCollecting(w: GameWorld, seconds: number): string[] {
    const kinds: string[] = [];
    for (let t = 0; t < seconds; t += SIM_DT) for (const event of gameTick(w, SIM_DT)) kinds.push(event.kind);
    return kinds;
  }

  test("a corridor's shares are of the trips along it; one nobody of yours runs on is the informal sector's", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    expect(takenCorridors(w)).toEqual([]);
    run(w, SECONDS_PER_GAME_DAY);
    const far = corridorSummaries(w).find((c) => c.key === routeKey("far", "mid"))!;
    expect(far.you).toBe(0);
    expect(far.informal).toBeGreaterThan(0.5);
    expect(far.you + far.informal + far.lost).toBeCloseTo(1, 6);
    expect(far.leviesLostPerDay).toBe(0); // you never ran along it
  });

  test("carry 40% of a corridor's trips and it's taken, with the day; sell out and the danfos have it back", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0, startingFunds: 20_000 });
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    const taking = runCollecting(w, 4 * SECONDS_PER_GAME_DAY);
    expect(taking.filter((kind) => kind === "corridor-taken").length).toBe(1);
    const trunk = corridorSummaries(w)[0]!; // taken ones first
    expect(trunk.key).toBe(routeKey("big", "mid"));
    expect(trunk.you).toBeGreaterThanOrEqual(DEFAULT_GAME_TUNING.corridorReleaseShare);
    expect(trunk.takenSince).not.toBeNull();
    expect(gameDay(w, trunk.takenSince!)).toBeLessThanOrEqual(4);
    expect(trunk.leviesLostPerDay).toBeGreaterThanOrEqual(0);
    expect(trunk.hasLane).toBe(false);
    // The map tags the change for a few days, then leaves it to the panel.
    expect(corridorChanges(w).map((c) => c.change)).toEqual(["taken"]);
    run(w, (CORRIDOR_TAG_DAYS + 1) * SECONDS_PER_GAME_DAY);
    expect(corridorChanges(w)).toEqual([]);
    expect(takenCorridors(w).length).toBe(1);
    const route = w.routes.find((r) => r.a === "big" || r.b === "big")!;
    while (route.vehicleIds.length > 0) removeBus(w, route.id);
    const losing = runCollecting(w, 4 * SECONDS_PER_GAME_DAY);
    expect(losing).toContain("corridor-released");
    expect(takenCorridors(w)).toEqual([]);
    expect(w.corridors.get(routeKey("big", "mid"))!.change).toBe("lost");
  });
});

describe("slice zero step 8: route verdicts and hints", () => {
  test("every short verdict is at most 12 words", () => {
    const verdicts: RouteVerdict[] = ["thin", "overcapacity", "jammed", "long", "worn", "full", "poached", "waiting", "healthy"];
    for (const verdict of verdicts) {
      for (const vehicle of ["bus", "minibus", "train", "BRT bus"]) {
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
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
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
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0, startingFunds: 1e6 });
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
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    const hints = createHintState();
    updateHints(hints, w, null);
    dismissHint(hints);
    expect(updateHints(hints, w, null)).toBeNull();
    expect(hints.done.has(1)).toBe(true);
    const off = createHintState(true);
    expect(updateHints(off, w, null)).toBeNull();
  });

  test("hint 6 follows the first road you build, by the road, and goes after a day", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0, startingFunds: 1e6 });
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

  test("the union calls a strike, then strikes a few days after the lane: no danfo sets off along it", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    paveRoad(w, "big", "mid");
    addBusLane(w, "big", "mid");
    const events: string[] = [];
    const step = (seconds: number) => {
      for (let t = 0; t < seconds; t += SIM_DT) for (const e of gameTick(w, SIM_DT)) events.push(e.kind);
    };
    step((w.tuning.strikeDelayDays - 0.5) * SECONDS_PER_GAME_DAY);
    expect(events).toContain("strike-announced");
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
    step(w.tuning.strikeDays * SECONDS_PER_GAME_DAY);
    expect(events).toContain("strike-over");
    expect(laneOn(w, "big", "mid")!.lastStrike).not.toBeNull();
  });

  test("relaxing enforcement after a strike is called calls it off", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    paveRoad(w, "big", "mid");
    addBusLane(w, "big", "mid");
    const events: string[] = [];
    const step = (seconds: number) => {
      for (let t = 0; t < seconds; t += SIM_DT) for (const e of gameTick(w, SIM_DT)) events.push(e.kind);
    };
    setEnforcement(w, "big", "mid", "strict");
    step((w.tuning.strikeDelayDays - w.tuning.strikeNoticeDays + 0.5) * SECONDS_PER_GAME_DAY);
    expect(events).toContain("strike-announced");
    setEnforcement(w, "big", "mid", "lax");
    step(w.tuning.strikeNoticeDays * SECONDS_PER_GAME_DAY);
    expect(events).toContain("strike-called-off");
    expect(events).not.toContain("strike");
  });
});

describe("Revision 1, 1b+: enforcement, encroachment, and strikes that cost", () => {
  const laneWorld = () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    paveRoad(w, "big", "mid");
    addBusLane(w, "big", "mid");
    return w;
  };

  test("a new lane opens with no wardens; enforcing it bills them as their own line", () => {
    const w = laneWorld();
    expect(laneOn(w, "big", "mid")!.enforcement).toBe("lax");
    run(w, SECONDS_PER_GAME_DAY);
    expect(w.budget.enforcement).toBe(0);
    setEnforcement(w, "big", "mid", "strict");
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
      for (let t = 0; t < 40 * SECONDS_PER_GAME_DAY; t += SIM_DT) if (gameTick(w, SIM_DT).some((e) => e.kind === "strike")) return t / SECONDS_PER_GAME_DAY;
      return Infinity;
    };
    expect(firstStrike("strict")).toBeLessThan(firstStrike("lax"));
  });

  test("on a strike day the strikers block the lane: your buses are back in general traffic", () => {
    const w = laneWorld();
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    const road = roadChain(w, "big", "mid")![0]!;
    for (let t = 0; t < 30 * SECONDS_PER_GAME_DAY && struckSegments(w).size === 0; t += SIM_DT) gameTick(w, SIM_DT);
    expect(struckSegments(w).has(road.id)).toBe(true);
    run(w, 1);
    expect(w.laneSpeed.has(road.id)).toBe(false);
  });
});

describe("Revision 1: a town at its rung's cap says its road is full", () => {
  test("grown by your service to all its rung allows: the next rung is named; with room to grow, nothing", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    expect(roadFull(w, "mid")).toBeNull();
    // Full service: every trip from Mid carried by you, and Mid grown to the target that allows.
    for (const [key, rates] of w.pairOutcomes) if (key.includes("mid")) Object.assign(rates, { player: 1, poached: 0, gaveUp: 0, lost: 0 });
    w.towns.get("mid")!.population = townGrowth(w, "mid")!.target;
    expect(roadFull(w, "mid")).toMatchObject({ rung: "dirt", next: "paved" });
    paveRoad(w, "big", "mid");
    expect(roadFull(w, "mid")).toBeNull(); // paving raised the cap, and the target with it: room again
  });
});

describe("Revision 1: the BRT bus runs only in a bus lane", () => {
  test("refused without a lane the whole way; 80 seats once there is one", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    paveRoad(w, "big", "mid");
    expect(checkBrt(w, "big", "mid").ok).toBe(false);
    addBusLane(w, "big", "mid");
    expect(checkBrt(w, "big", "mid").ok).toBe(true);
    // Mid-Far has no lane: a BRT can't run through to Far.
    expect(checkBrt(w, "big", "far").ok).toBe(false);
    expect(addBrt(w, "big", "mid").ok).toBe(true);
    const route = w.routes.find((r) => r.id === brtRouteId("big", "mid"))!;
    const vehicle = w.simulation.vehicles.find((v) => v.id === route.vehicleIds[0])!;
    expect(vehicle.capacity).toBe(w.tuning.brtCapacity);
  });
});

describe("Revision 1: a called strike always has a way out -- settle with the union", () => {
  test("settling pays the union and calls the strike off, lax lane or strict", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    paveRoad(w, "big", "mid");
    addBusLane(w, "big", "mid");
    const events: string[] = [];
    for (let t = 0; t < 30 * SECONDS_PER_GAME_DAY && !events.includes("strike-announced"); t += SIM_DT) for (const e of gameTick(w, SIM_DT)) events.push(e.kind);
    const lane = laneOn(w, "big", "mid")!;
    expect(lane.enforcement).toBe("lax");
    const price = settlementPrice(w, lane);
    expect(price).toBeGreaterThanOrEqual(w.tuning.settlementMin);
    const funds = w.economy.funds;
    expect(settleStrike(w, "big", "mid").ok).toBe(true);
    expect(w.economy.funds).toBeCloseTo(funds - price);
    for (let t = 0; t < (w.tuning.strikeNoticeDays + 1) * SECONDS_PER_GAME_DAY; t += SIM_DT) for (const e of gameTick(w, SIM_DT)) events.push(e.kind);
    expect(events).not.toContain("strike");
  });

  test("new lanes' first strikes are staggered, not all on one day", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    paveRoad(w, "big", "mid");
    paveRoad(w, "mid", "far");
    addBusLane(w, "big", "mid");
    addBusLane(w, "mid", "far");
    const [first, second] = w.lanes;
    expect(second!.grievance).toBeLessThan(first!.grievance);
  });
});

describe("Revision 1: a lane's town size limit follows what it carries", () => {
  test("as danfos take a lax lane, its towns' cap slides back to a paved road's", () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6 });
    paveRoad(w, "big", "mid");
    const paved = townGrowth(w, "mid")!.cap;
    addBusLane(w, "big", "mid");
    const clear = townGrowth(w, "mid")!.cap;
    expect(clear).toBeGreaterThan(paved);
    laneOn(w, "big", "mid")!.encroachment = 0.5;
    const half = townGrowth(w, "mid")!.cap;
    expect(half).toBeCloseTo((clear + paved) / 2);
    laneOn(w, "big", "mid")!.encroachment = 1;
    expect(townGrowth(w, "mid")!.cap).toBeCloseTo(paved);
  });
});

describe("Revision 1: the road-full line suggests a lane only where traffic could fill one", () => {
  test("a paved road at its cap: a lane on a busy road, 'too thin' on a quiet one", () => {
    const setUp = (laneMinTripsPerDay: number) => {
      const w = world({ maxEmergentTowns: 0, startingFunds: 1e6, laneMinTripsPerDay });
      paveRoad(w, "big", "mid");
      for (const [key, rates] of w.pairOutcomes) if (key.includes("mid")) Object.assign(rates, { player: 1, poached: 0, gaveUp: 0, lost: 0 });
      w.towns.get("mid")!.population = townGrowth(w, "mid")!.target;
      return roadFull(w, "mid");
    };
    expect(setUp(0)).toMatchObject({ rung: "paved", next: "lane", thin: false });
    expect(setUp(1e9)).toMatchObject({ rung: "paved", next: "lane", thin: true });
  });
});

describe("Revision 1: the named project the treasury leaves alone, for a while", () => {
  const setUp = () => {
    const w = world({ maxEmergentTowns: 0, startingFunds: 1e6, remittanceEnabled: true, remittanceReserve: 3000, remittanceShare: 0.8 });
    paveRoad(w, "big", "mid");
    return w;
  };
  test("what you hold toward it isn't remitted", () => {
    const named = setUp();
    nameProject(named, "big", "mid", "lane");
    const plain = setUp();
    // The same surplus this period in both, so the treasury takes something.
    named.remittance.net = 1e6;
    plain.remittance.net = 1e6;
    expect(heldForProject(named)).toBeGreaterThan(0);
    run(named, w0(named));
    run(plain, w0(plain));
    expect(named.budget.remitted).toBeLessThan(plain.budget.remitted);
  });
  test("built in time, it's done; left unbuilt, it lapses to the treasury", () => {
    const w = setUp();
    nameProject(w, "big", "mid", "lane");
    addBusLane(w, "big", "mid");
    run(w, 1);
    expect(w.project).toBeNull();
    const v = setUp();
    v.tuning.remittanceEnabled = false; // isolate the lapse
    nameProject(v, "big", "mid", "lane");
    v.tuning.remittanceEnabled = true;
    const events: string[] = [];
    for (let t = 0; t < (v.tuning.projectLapseDays + 1) * SECONDS_PER_GAME_DAY; t += SIM_DT) for (const e of gameTick(v, SIM_DT)) events.push(e.kind);
    expect(events).toContain("project-lapsed");
    expect(v.project).toBeNull();
  });
  const w0 = (w: GameWorld) => (w.tuning.remittancePeriodDays + 0.5) * SECONDS_PER_GAME_DAY;
});

describe("Revision 2, step 1: the problems the late game already has, with their moves", () => {
  test("no seat by pair adds up to the strip's no seat: the same trips, now with where they are", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    addBus(w, "big", "mid");
    run(w, 3 * SECONDS_PER_GAME_DAY);
    const total = noSeatPairs(w).reduce((sum, p) => sum + p.perDay, 0);
    expect(total).toBeCloseTo(headline(w).noSeatPerDay, 3);
    // The cut-off town's trips are "no road", never a seat problem.
    expect(noSeatPairs(w).some((p) => p.a === "cut" || p.b === "cut")).toBe(false);
  });

  test("the move for a pair: one more of the vehicle you run there, else a new one sized to the pair", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    const fresh = seatMove(w, "big", "mid");
    expect(fresh.action.kind === "bus" || fresh.action.kind === "minibus").toBe(true);
    expect(fresh.label).toMatch(/^Run a (bus|minibus) Big ↔ Mid/);
    addMinibus(w, "big", "mid");
    const more = seatMove(w, "big", "mid");
    expect(more.action.kind).toBe("minibus");
    expect(more.label).toBe("Add a minibus to Big ↔ Mid (+)");
    expect(more.price).toBe(DEFAULT_GAME_TUNING.minibusPurchaseCost);
  });

  test("no advice to add a vehicle a route can't pay for: once judged, it says why instead, and isn't a move", () => {
    // Minibuses that cost far more to run than any fare brings in.
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0, minibusOperatingCostPerSecond: 500 });
    addMinibus(w, "big", "mid");
    run(w, 4 * SECONDS_PER_GAME_DAY);
    const more = seatMove(w, "big", "mid");
    expect(more.price).toBe(Infinity);
    expect(more.label).toMatch(/another minibus wouldn't pay/);
    expect(namedMoves(w).some((m) => m.label === more.label)).toBe(false);
  });

  test("a town's no seat names the trip most of it wants and a move; corridors list theirs worst first", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    run(w, 2 * SECONDS_PER_GAME_DAY);
    const seat = townNoSeat(w, "big");
    if (seat) {
      expect(seat.perDay).toBeGreaterThan(0);
      expect([seat.worst.a, seat.worst.b]).toContain("big");
      expect(seat.move.label.length).toBeGreaterThan(0);
    }
    const corridors = [...corridorNoSeat(w).values()].map((c) => c.perDay);
    expect(corridors).toEqual([...corridors].sort((x, y) => y - x));
  });

  test("a town you stop serving says why it's shrinking, and the move back", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0, startingFunds: 1e6, townGrowthTauSeconds: 60, remittanceEnabled: false });
    for (let i = 0; i < 3; i += 1) addBus(w, "big", "mid");
    run(w, 12 * SECONDS_PER_GAME_DAY);
    expect(w.towns.get("mid")!.population).toBeGreaterThan(55); // grown on your service
    const route = w.routes[0]!;
    while (route.vehicleIds.length > 0) removeBus(w, route.id);
    run(w, 3 * SECONDS_PER_GAME_DAY);
    const cause = shrinkCause(w, "mid");
    expect(cause).not.toBeNull();
    expect(cause!.why).toMatch(/you carry \d+% of its trips/);
    expect(cause!.move).not.toBeNull();
    // C5's measure: the screen names a move, and one this rich player can afford.
    expect(namedMoves(w).some((move) => affordable(w, move))).toBe(true);
  });
});

describe("Revision 2: wear returns, per corridor", () => {
  test("a corridor's wear is one decision: its worst piece, kept as a whole, fixed as a whole", () => {
    const w = startGame(MAP, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0, startingFunds: 1e6 });
    for (let i = 0; i < 4; i += 1) addBus(w, "big", "mid");
    run(w, 15 * SECONDS_PER_GAME_DAY);
    const worn = corridorWear(w, "big", "mid")!;
    expect(worn.condition).toBeLessThan(1);
    expect(worn.speed).toBeLessThan(1);
    expect(worn.repair).toBeGreaterThan(0);
    expect(worn.kept).toBe(false);
    // The town card names it once your buses pay for it.
    if (worn.speed < 0.85 && worn.roughPerDay >= 1) expect(wornRoadAt(w, "mid")?.move.action.kind).toBe("fix");
    // Fix now: new again, charged once, not kept.
    const funds = w.economy.funds;
    const fixed = fixRoadNow(w, worn.pieceIds[0]!);
    expect(fixed.ok).toBe(true);
    expect(w.economy.funds).toBeCloseTo(funds - worn.repair, 6);
    expect(corridorWear(w, "big", "mid")!.condition).toBe(1);
    expect(corridorWear(w, "big", "mid")!.kept).toBe(false);
    // Kept up: it stays new, billed as it goes.
    expect(applyAction(w, { kind: "fix", segmentId: worn.pieceIds[0]!, on: true }).ok).toBe(true);
    run(w, 5 * SECONDS_PER_GAME_DAY);
    const kept = corridorWear(w, "big", "mid")!;
    expect(kept.kept).toBe(true);
    expect(kept.condition).toBe(1);
    expect(kept.upkeepPerDay).toBeGreaterThan(0);
  });
});

describe("Revision 2: industries that open and close -- the quarry", () => {
  const quarryWorld = (overrides: Partial<GameTuning> = {}) =>
    createGameWorld({ ...MAP, port: "big" }, { ...DEFAULT_GAME_TUNING, startingFunds: 1e6, maxEmergentTowns: 0, industryFirstDay: 1, ...overrides });

  test("one opens when it's due, as a site off the network: a few workers, no growth, not in the people count", () => {
    const w = quarryWorld();
    const events: string[] = [];
    for (let t = 0; t < 2 * SECONDS_PER_GAME_DAY; t += SIM_DT) for (const e of gameTick(w, SIM_DT)) events.push(e.kind);
    expect(events).toContain("industry-opened");
    const [site] = [...w.industries.keys()];
    const town = w.towns.get(site!)!;
    expect(town.industry).toBe("quarry");
    expect(town.population).toBe(w.tuning.industryWorkers);
    expect(townGrowth(w, site!)).toBeNull();
    expect(isCutOff(w, site!)).toBe(true); // nothing reaches it yet
    const nearest = Math.min(...[...w.towns.values()].filter((t) => !t.industry).map((t) => Math.hypot(t.x - town.x, t.y - town.y)));
    expect(nearest).toBeGreaterThanOrEqual(8);
    expect(nearest).toBeLessThanOrEqual(20);
  });

  test("its stone goes to its three nearest towns by size and a share to the port, adding up to its output", () => {
    const w = quarryWorld();
    openQuarry(w);
    const flows = industryFlows(w);
    const total = flows.reduce((sum, f) => sum + f.rate, 0) * SECONDS_PER_GAME_DAY;
    expect(total).toBeCloseTo(w.tuning.quarryOutputPerDay, 6);
    const toPort = flows.filter((f) => f.to === "big").reduce((sum, f) => sum + f.rate, 0) * SECONDS_PER_GAME_DAY;
    expect(toPort).toBeGreaterThanOrEqual(w.tuning.quarryOutputPerDay * w.tuning.quarryExportShare - 1e-6);
    expect(new Set(flows.map((f) => f.to)).size).toBeLessThanOrEqual(4);
  });

  test("one nothing is moved from closes after its grace, and stays on the map as a ruin", () => {
    const w = quarryWorld({ industryGraceDays: 3, industryEveryMinDays: 999, industryEveryMaxDays: 999 });
    openQuarry(w);
    const [site] = [...w.industries.keys()];
    const events: string[] = [];
    for (let t = 0; t < 4 * SECONDS_PER_GAME_DAY; t += SIM_DT) for (const e of gameTick(w, SIM_DT)) events.push(e.kind);
    expect(events).toContain("industry-closed");
    expect(w.industries.size).toBe(0);
    expect(w.towns.has(site!)).toBe(false);
    expect(w.ruins.get(site!)?.industry).toBe("quarry");
  });

  test("served, its stone raises the towns it reaches: their cap grows by the share delivered", () => {
    const w = quarryWorld({ industryEveryMinDays: 999, industryEveryMaxDays: 999, noPlayerLorries: false });
    openQuarry(w);
    const [site] = [...w.industries.keys()];
    const buyer = [...industryFlows(w)].filter((f) => f.to !== "big").sort((p, q) => q.rate - p.rate)[0]!.to;
    const capBefore = townGrowth(w, buyer)!.cap;
    expect(buildRoad(w, site!, buyer).ok).toBe(true);
    expect(addLorry(w, site!, buyer).ok).toBe(true);
    run(w, 6 * SECONDS_PER_GAME_DAY);
    expect(stoneServed(w, buyer)).toBeGreaterThan(0.2);
    expect(townGrowth(w, buyer)!.cap).toBeGreaterThan(capBefore);
  });

  test("goods pay by the tonne and the cell: the same tonnes carried twice as far pay twice as much", () => {
    const w = quarryWorld();
    const near = { from: "big", to: "mid", kind: "supplies" as const, amount: 10 };
    const deliveries = (entry: typeof near) => [{ entry, amount: entry.amount }] as never;
    const one = goodsFares(w, deliveries(near));
    expect(one).toBeCloseTo(10 * roadPath(w, "big", "mid")!.distance * w.tuning.goodsFarePerTonneCell, 6);
  });
});

describe("Revision 2: rail gets a job of its own", () => {
  const railWorld = (overrides: Partial<GameTuning> = {}) =>
    createGameWorld({ ...MAP, port: "big" }, { ...DEFAULT_GAME_TUNING, startingFunds: 1e7, maxEmergentTowns: 0, industryFirstDay: 999, ...overrides });

  test("a line carries trackSlots trains, passenger and freight together: a freight train takes a passenger train's slot", () => {
    const w = railWorld({ trackSlots: 3 });
    expect(buildTrack(w, "big", "mid").ok).toBe(true);
    expect(addTrain(w, "big", "mid").ok).toBe(true);
    expect(addTrain(w, "big", "mid").ok).toBe(true);
    expect(addFreightTrain(w, "big", "mid").ok).toBe(true);
    expect(lineSlots(w, "big", "mid")).toEqual({ used: 3, slots: 3 });
    const refused = checkTrain(w, "big", "mid");
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.reason).toContain("the line is full");
    expect(addFreightTrain(w, "big", "mid").ok).toBe(false);
  });

  test("a passenger line makes trips that weren't made before, and its towns can grow past the rail rung", () => {
    const w = railWorld();
    buildTrack(w, "big", "mid");
    const before = pairDemand(w, "big", "mid");
    const capBefore = townGrowth(w, "mid")!.cap;
    addTrain(w, "big", "mid");
    expect(stationTowns(w).has("mid")).toBe(true);
    run(w, SECONDS_PER_GAME_DAY + 1); // demand follows within the day
    expect(pairDemand(w, "big", "mid")).toBeGreaterThan(before * 1.2);
    expect(townGrowth(w, "mid")!.cap).toBeGreaterThan(capBefore);
    // A freight line alone makes no station.
    const f = railWorld();
    buildTrack(f, "big", "mid");
    addFreightTrain(f, "big", "mid");
    expect(stationTowns(f).size).toBe(0);
  });
});

describe("Revision 2: private truckers, the informal freight rival", () => {
  const truckWorld = (overrides: Partial<GameTuning> = {}) =>
    createGameWorld({ ...MAP, port: "big" }, { ...DEFAULT_GAME_TUNING, startingFunds: 1e6, maxEmergentTowns: 0, industryFirstDay: 999, ...overrides });

  test("short hauls are theirs, long ones never: keenness falls with the run and stops at the limit", () => {
    const w = truckWorld();
    expect(haulShare(w, 0)).toBe(1);
    expect(haulShare(w, w.tuning.truckerMaxHaulCells / 2)).toBeCloseTo(0.5, 6);
    expect(haulShare(w, w.tuning.truckerMaxHaulCells)).toBe(0);
    expect(haulShare(w, 999)).toBe(0);
  });

  test("they carry goods you don't, on trucks on the road, paying tolls and loading levies; it's their money, not yours", () => {
    const w = truckWorld();
    run(w, 3 * SECONDS_PER_GAME_DAY);
    const trucked = [...w.goods.outcomes.values()].reduce((sum, o) => sum + (o.trucked ?? 0), 0);
    expect(trucked).toBeGreaterThan(0);
    expect(w.budget.goods).toBe(0); // you carried nothing
    expect(w.budget.loading).toBeGreaterThan(0); // supplies lifted at the port
    expect(w.budget.touts).toBeCloseTo(w.budget.loading * w.tuning.agberoCut / (1 - w.tuning.agberoCut), 6);
    // Fewer goods spoil than with nobody to take them.
    const alone = truckWorld({ truckersEnabled: false });
    run(alone, 3 * SECONDS_PER_GAME_DAY);
    const spoiled = (x: GameWorld) => [...x.goods.outcomes.values()].reduce((sum, o) => sum + o.spoiled, 0);
    expect(spoiled(w)).toBeLessThan(spoiled(alone));
  });
});

describe("Revision 2: retiring a road, and the road that became the railway", () => {
  const retireWorld = (overrides: Partial<GameTuning> = {}) =>
    createGameWorld(MAP, { ...DEFAULT_GAME_TUNING, startingFunds: 1e7, maxEmergentTowns: 0, industryFirstDay: 999, retireGoneDays: 2, ...overrides });

  test("only a road you built or paved is yours to retire; retired, it's no longer yours to keep or toll", () => {
    const w = retireWorld();
    const inherited = directRoad(w, "big", "mid")!;
    expect(retireRoad(w, inherited.id).ok).toBe(false);
    expect(buildRoad(w, "mid", "cut").ok).toBe(true);
    const built = directRoad(w, "mid", "cut")!;
    expect(isYourRoad(built)).toBe(true);
    expect(retireRoad(w, built.id).ok).toBe(true);
    expect(isYourRoad(built)).toBe(false);
    // Restored: yours again, repaired.
    expect(restoreRoad(w, built.id).ok).toBe(true);
    expect(built.retiredAt).toBeUndefined();
    expect(built.condition).toBe(1);
  });

  test("gone after its days: towns it joined are cut off again, and a route with no other way is sold", () => {
    const w = retireWorld();
    buildRoad(w, "mid", "cut");
    addBus(w, "mid", "cut");
    const road = directRoad(w, "mid", "cut")!;
    retireRoad(w, road.id);
    const funds = w.economy.funds;
    const events: Array<{ kind: string; sold?: number }> = [];
    for (let t = 0; t < 3 * SECONDS_PER_GAME_DAY; t += SIM_DT) events.push(...(gameTick(w, SIM_DT) as Array<{ kind: string; sold?: number }>));
    const gone = events.find((e) => e.kind === "road-gone");
    expect(gone?.sold).toBe(1);
    expect(directRoad(w, "mid", "cut")).toBeUndefined();
    expect(isCutOff(w, "cut")).toBe(true);
    expect(w.routes.some((r) => r.a === "cut" || r.b === "cut")).toBe(false);
    expect(w.economy.funds).toBeGreaterThan(funds - 1000); // the bus's resale came back
  });

  test("track on a retired road's line costs less than new track, and the road goes with it", () => {
    const w = retireWorld({ retireGoneDays: 60 });
    buildRoad(w, "mid", "cut");
    const road = directRoad(w, "mid", "cut")!;
    const fresh = trackCost(w, "mid", "cut");
    retireRoad(w, road.id);
    expect(trackAction(w, "mid", "cut")).toBe("onroad");
    expect(onRoadCost(w, "mid", "cut")).toBeLessThan(fresh);
    expect(buildTrack(w, "mid", "cut").ok).toBe(true);
    expect(directRoad(w, "mid", "cut")).toBeUndefined();
    expect(w.simulation.map.segments.some((s) => s.type === "rail" && ((s.fromNodeId === "mid" && s.toNodeId === "cut") || (s.fromNodeId === "cut" && s.toNodeId === "mid")))).toBe(true);
  });
});

describe("the region: the seed's map as the home cluster of a wider map (brief, The region)", () => {
  test("a game's tuning picks the map: the region for new games, the slice map for files without it; seed 0 stays hand-made", () => {
    expect(gameMap(GAME_MAP, 7, { regionEnabled: true }).width).toBe(REGION_WIDTH);
    expect(gameMap(GAME_MAP, 7, {})).toEqual(generatedGameMap(GAME_MAP, 7));
    expect(gameMap(GAME_MAP, 0, { regionEnabled: true })).toEqual(generatedGameMap(GAME_MAP, 0));
    expect(gameMap(GAME_MAP, 7, { regionEnabled: true })).toEqual(gameMap(GAME_MAP, 7, { regionEnabled: true }));
  });

  test("map version 2: rivers wind and keep their narrows, towns stay dry, the railway follows the land; version 1 is the map as drawn", () => {
    const narrowest = (r: { width: number; widths?: number[] }) => Math.min(...(r.widths ?? [r.width]));
    for (let seed = 1; seed <= 20; seed += 1) {
      const v1 = gameMap(GAME_MAP, seed, { regionEnabled: true });
      expect(v1).toEqual(gameMap(GAME_MAP, seed, { regionEnabled: true, mapVersion: 1 }));
      const v2 = gameMap(GAME_MAP, seed, { regionEnabled: true, mapVersion: 2 });
      // Only the water's line and the railway's change.
      expect(v2.towns).toEqual(v1.towns);
      expect(v2.roads).toEqual(v1.roads);
      const before = v1.terrain!.rivers!, after = v2.terrain!.rivers!;
      expect(after.length).toBe(before.length);
      // Smoothed (more points), each as narrow at its narrowest as drawn -- a ford stays a ford.
      after.forEach((r, i) => {
        expect(r.points.length).toBeGreaterThanOrEqual(before[i]!.points.length);
        // (resampled every 1.5 cells, a point may fall a little off the narrowest one)
        expect(narrowest(r)).toBeGreaterThanOrEqual(narrowest(before[i]!) - 0.01);
        expect(narrowest(r)).toBeLessThanOrEqual(narrowest(before[i]!) * 1.15 + 0.05);
      });
      // No town in the water, nor within a cell of it (buildGameTerrain throws on a wet town).
      const terrain = buildGameTerrain(v2);
      for (const t of v2.towns) {
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) expect(isWater(terrain, Math.round(t.x) + dx, Math.round(t.y) + dy)).toBe(false);
      }
      // The old railway planned over the land.
      expect(v2.rails!.every((r) => (r.via?.length ?? 0) > 0)).toBe(true);
    }
    expect(gameMap(GAME_MAP, 0, { regionEnabled: true, mapVersion: 2 })).toEqual(gameMap(GAME_MAP, 0, { regionEnabled: true }));
  }, 30_000); // dozens of maps drawn: over bun's 5 s on a busy machine

  test("map version 4: the land by region beyond the home box, towns dry, the home cluster untouched", () => {
    let changed = 0;
    for (const seed of [3, 11, 17, 42, 101, 256, 777, 2411, 2418, 9001]) {
      const v3 = gameMap(GAME_MAP, seed, { regionEnabled: true, mapVersion: 3 });
      const v4 = gameMap(GAME_MAP, seed, { regionEnabled: true, mapVersion: 4 });
      expect(v4.towns).toEqual(v3.towns);
      expect(v4.roads).toEqual(v3.roads);
      buildGameTerrain(v4); // throws on a town in the water
      // Whatever's new stands outside the home cluster's box.
      const box = v4.home!;
      const inBox = (x: number, y: number) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
      const oldHills = new Set(v3.terrain!.hills!.map((h) => `${h.x},${h.y}`));
      for (const h of v4.terrain!.hills!.filter((h) => !oldHills.has(`${h.x},${h.y}`))) expect(inBox(h.x, h.y)).toBe(false);
      for (const r of v4.terrain!.rivers!.slice(v3.terrain!.rivers!.length)) for (const [x, y] of r.points) expect(inBox(x, y)).toBe(false);
      if (JSON.stringify(v4.terrain) !== JSON.stringify(v3.terrain)) changed += 1;
    }
    expect(changed).toBeGreaterThanOrEqual(9); // a map falls back to version 3 only where the guards refuse it
  }, 30_000); // dozens of maps drawn: over bun's 5 s on a busy machine

  test("map version 5: a southern region's sea lies to the south, its home cluster turned whole; the north's is not turned", () => {
    let southern = 0;
    for (let seed = 1; seed <= 16; seed += 1) {
      const info = generatedMapInfo(GAME_MAP, seed);
      const map = gameMap(GAME_MAP, seed, { regionEnabled: true, mapVersion: 5 });
      expect([map.width, map.height]).toEqual([REGION_WIDTH, REGION_HEIGHT]);
      buildGameTerrain(map); // throws on a town in the water
      const sea = map.terrain!.rivers!.find((r) => Math.max(...(r.widths ?? [r.width])) > 12)!;
      const meanY = sea.points.reduce((s, p) => s + p[1], 0) / sea.points.length;
      const meanX = sea.points.reduce((s, p) => s + p[0], 0) / sea.points.length;
      if (["southwest", "southeast", "southSouth"].includes(info.region)) {
        southern += 1;
        expect(meanY).toBeGreaterThan(map.height * 0.8); // along the bottom
        // The home cluster turned, not stretched: every distance between its towns as on the slice map.
        const home = info.map.towns;
        const at = new Map(map.towns.map((t) => [t.id, t]));
        for (const [i, a] of home.entries()) for (const b of home.slice(i + 1)) {
          expect(Math.hypot(at.get(a.id)!.x - at.get(b.id)!.x, at.get(a.id)!.y - at.get(b.id)!.y)).toBeCloseTo(Math.hypot(a.x - b.x, a.y - b.y), 6);
        }
      } else {
        expect(meanX < map.width * 0.2 || meanX > map.width * 0.8).toBe(true); // still down a side, for now
      }
    }
    expect(southern).toBeGreaterThan(0);
  }, 30_000);

  test("the seaport (gateways, step 1): imports come up from it in part by the old highway, all of it by the old railway restored", () => {
    const run = (seed: number, overrides = {}) => startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { warmUpDays: 0, ...overrides });
    let far = 0, home = 0, restored = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const w = run(seed);
      const link = seaportLink(w);
      if (!w.seaport || w.seaport === w.port) {
        home += 1;
        expect(link).toMatchObject({ by: "here", share: 1 });
        continue;
      }
      far += 1;
      // Up the old dirt highway: the dirt share (the inherited roads are dirt).
      expect(link.by).toBe("road");
      expect(link.share).toBeCloseTo(w.tuning.importsOverDirt!, 6);
      expect(importsArriving(w)).toBeCloseTo(w.tuning.importsOverDirt!, 6);
      // Off (an older run): everything lands at the home city as before.
      expect(seaportLink(run(seed, { seaportImports: false })).share).toBe(1);
      // The old railway restored between the two: all of it.
      w.economy.funds = 1e9;
      // The old line, through its stations (stations.ts), between the two.
      const rail = derelictRun(w, w.port!, w.seaport);
      if (rail) {
        expect(applyAction(w, { kind: "track", a: w.port!, b: w.seaport, alignment: "cheapest" }).ok).toBe(true);
        w.economy.elapsedSeconds += 1; // a new tick's reading
        expect(seaportLink(w)).toMatchObject({ by: "rail", share: 1 });
        restored += 1;
      }
    }
    expect(far).toBeGreaterThan(0);
    expect(restored).toBeGreaterThan(0);
    expect(home).toBeGreaterThan(0);
  }, 30_000);

  test("the border crossing (gateways, step 2): one a map on its region's edge, on the network; each farm's crop out the way that nets more", () => {
    const run = (seed: number, overrides = {}) => startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { warmUpDays: 0, ...overrides });
    for (let seed = 1; seed <= 8; seed += 1) {
      const w = run(seed);
      const b = w.towns.get(w.border!)!;
      expect(b.industry).toBe("border");
      expect(isCutOff(w, b.id)).toBe(false);
      if (w.region === "southwest") expect(b.x).toBeLessThanOrEqual(5); // Idiroko, to Benin, on the west
      // Each farm town's way out is the one that nets more a tonne by road.
      const t = w.tuning;
      for (const farm of farmTowns(w)) {
        const way = exportGateway(w, farm.id)!;
        const net = (to: string, pay: number) => { const p = roadPath(w, farm.id, to); return p ? pay - p.distance * t.goodsFarePerTonneCell : -Infinity; };
        const sea = net(w.port!, t.exportPayPerTonne * importsArriving(w)), border = net(b.id, t.exportPayPerTonne * t.borderPayShare!);
        expect(way.to).toBe(border > sea ? b.id : w.port!);
      }
      // Off (an older run): no border, every crop to the home city.
      const off = run(seed, { borderCrossing: false });
      expect(off.border).toBeUndefined();
      for (const farm of farmTowns(off)) expect(exportGateway(off, farm.id)!.to).toBe(off.port!);
    }
  }, 60_000);

  test("map version 6 (gateways, step 3): the north landlocked, its sea trade by the coast road on the south edge", () => {
    const run = (seed: number, overrides = {}) => startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { warmUpDays: 0, ...overrides });
    const hasSea = (w: ReturnType<typeof run>) => (w.waterLines ?? []).some((r) => Math.max(...(r.widths ?? [r.width])) > 12);
    let north = 0, south = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const w = run(seed);
      if (["north", "northeast", "middleBelt"].includes(w.region ?? "")) {
        north += 1;
        expect(hasSea(w)).toBe(false);
        const road = w.towns.get(w.seaport!)!;
        expect(road.industry).toBe("gateway");
        expect(road.y).toBeGreaterThanOrEqual(w.height - 6); // the south edge
        expect(isCutOff(w, road.id)).toBe(false);
        expect(seaportLink(w).by).toBe("road");
        // Off (an older run): no coast road.
        expect(run(seed, { landlockedNorth: false }).towns.has("coast-road")).toBe(false);
      } else {
        south += 1;
        expect(hasSea(w)).toBe(true);
        expect(w.towns.has("coast-road")).toBe(false);
      }
    }
    expect(north).toBeGreaterThan(0);
    expect(south).toBeGreaterThan(0);
  }, 60_000);

  test("the port's rungs: a berth, then a container terminal, each landing more of day 1's need; off, it stays as it was", () => {
    const run = (overrides = {}) => startRun(GAME_MAP, 9, { all: false, goodsOff: false, wearOff: false }, null, { warmUpDays: 0, ...overrides });
    const w = run();
    // The tank farm sends only what the towns its tankers reach still need, and day 1's imports
    // were for the whole region (map 9: 25.2 landed, 11.6 wanted within reach): the rungs show once
    // the towns in reach outgrow it -- here, every town three times its size (34.7 wanted).
    for (const town of w.towns.values()) if (!town.industry) town.population *= 3;
    const landed = () => siteProduction(w, w.fuel!.depotId)!.capacity;
    const fuelIn = () => fuelFlows(w).filter((f) => f.from === w.fuel!.depotId).reduce((sum, f) => sum + f.rate, 0);
    const [cap0, in0] = [landed(), fuelIn()];
    w.economy.funds = 1e6;
    const t = w.tuning;
    expect(applyAction(w, { kind: "upgradePort" }).ok).toBe(true);
    expect(w.economy.funds).toBe(1e6 - t.portUpgradeCosts![0]!);
    expect(landed()).toBeCloseTo(cap0 * t.portImportScale![1]!, 6);
    expect(fuelIn()).toBeGreaterThan(in0 * 1.1);
    expect(applyAction(w, { kind: "upgradePort" }).ok).toBe(true);
    expect(landed()).toBeCloseTo(cap0 * t.portImportScale![2]!, 6);
    expect(applyAction(w, { kind: "upgradePort" }).ok).toBe(false); // as big as it gets
    const off = run({ portRungs: false });
    off.economy.funds = 1e6;
    expect(applyAction(off, { kind: "upgradePort" }).ok).toBe(false);
    expect(portScale(off)).toBe(1);
  });

  test("fuel over the border: from Benin and Niger, to the towns in tanker reach; none from Cameroon, none switched off", () => {
    const run = (seed: number, overrides = {}) => startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { warmUpDays: 0, ...overrides });
    let over = 0, none = 0;
    for (let seed = 1; seed <= 8; seed += 1) {
      const w = run(seed);
      const name = w.towns.get(w.border!)!.name;
      const fromBorder = fuelFlows(w).filter((f) => f.from === w.border);
      if (name.startsWith("Idiroko") || name.startsWith("Jibia")) {
        over += 1;
        expect(borderFuelSite(w)).toBe(w.border!);
        for (const f of fromBorder) expect(roadPath(w, w.border!, f.to)!.distance).toBeLessThanOrEqual(w.tuning.tankerMaxHaulCells);
        expect(fromBorder.reduce((s, f) => s + f.rate, 0)).toBeLessThanOrEqual(w.tuning.borderFuelShare! * w.fuel!.baseDemand + 1e-9);
        expect(fuelFlows(run(seed, { borderFuel: false })).some((f) => f.from === w.border)).toBe(false);
      } else {
        none += 1;
        expect(borderFuelSite(w)).toBeNull();
        expect(fromBorder.length).toBe(0);
      }
    }
    expect(over).toBeGreaterThan(0);
    expect(none).toBeGreaterThan(0);
  }, 60_000);

  test("map version 3: the port's sites stand past where it's built up, every site still placed", () => {
    const run = (seed: number, mapVersion: number) => startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { mapVersion, warmUpDays: 0 });
    let inside2 = 0, inside3 = 0;
    for (const seed of [3, 11, 17, 42, 101, 256]) {
      const [v2, v3] = [run(seed, 2), run(seed, 3)];
      const sites = (w: typeof v2) => [...w.towns.values()].filter((t) => t.industry);
      expect(sites(v3).map((t) => t.id).sort()).toEqual(sites(v2).map((t) => t.id).sort());
      const inside = (w: typeof v2) => { const port = w.towns.get(w.port!)!; return sites(w).filter((t) => Math.hypot(t.x - port.x, t.y - port.y) < builtUp(port.population)).length; };
      inside2 += inside(v2);
      inside3 += inside(v3);
    }
    // At most a fifth as many inside the city as at version 2 (on twelve seeds, 46 -> 5).
    expect(inside3).toBeLessThanOrEqual(Math.floor(inside2 / 5));
  });

  test("every seed: the home cluster is the seed's slice map moved whole; clusters beyond it; one dominant city; a port; all reachable", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const info = regionInfo(GAME_MAP, seed);
      const { map, home } = info;
      expect(info.rejected).toBeLessThan(300); // never the fallback
      expect([map.width, map.height]).toEqual([REGION_WIDTH, REGION_HEIGHT]);
      expect(map.towns.length).toBeGreaterThanOrEqual(home.map.towns.length + 12);
      expect(new Set(map.towns.map((t) => t.id)).size).toBe(map.towns.length);
      // The home cluster: the slice map's towns, roads and sizes, moved by the home box's corner.
      const box = map.home!;
      home.map.towns.forEach((t, i) => expect(map.towns[i]).toEqual({ ...t, x: t.x + box.x, y: t.y + box.y }));
      expect(map.roads.slice(0, home.map.roads.length)).toEqual(home.map.roads);
      // Every other town beyond the home box, and no two towns close.
      for (const t of map.towns.slice(home.map.towns.length)) {
        expect(t.x < box.x || t.x > box.x + box.width || t.y < box.y || t.y > box.y + box.height).toBe(true);
      }
      for (const [i, a] of map.towns.entries()) for (const b of map.towns.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(15);
      const largest = map.towns.reduce((big, t) => (t.population > big.population ? t : big));
      expect(largest.id).toBe(home.trunk[0]);
      expect(map.towns.some((t) => t.id === map.port)).toBe(true);
      // Old highways join every cluster: the inherited roads alone make one network of everything not cut off.
      const joinedTowns = map.towns.filter((t) => map.roads.some((r) => r.a === t.id || r.b === t.id));
      const reached = new Set([home.trunk[0]]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const r of map.roads) for (const [a, b] of [[r.a, r.b], [r.b, r.a]] as const) if (reached.has(a) && !reached.has(b)) { reached.add(b); grew = true; }
      }
      expect(joinedTowns.every((t) => reached.has(t.id))).toBe(true);
      expect(info.hubs.every((h) => reached.has(h))).toBe(true);
      buildGameTerrain(map); // every town dry (it throws otherwise)
    }
  }, 30_000);

  test("a start a slice at a time (the loading screen's) builds the same world as one in a go", () => {
    const switches = { all: false, goodsOff: false, wearOff: false };
    const overrides = { regionEnabled: false, warmUpDays: 2 };
    const steps = startRunSteps(GAME_MAP, 5, switches, null, overrides);
    const progress: number[] = [];
    let step = steps.next();
    while (!step.done) {
      progress.push(step.value);
      step = steps.next();
    }
    const whole = startRun(GAME_MAP, 5, switches, null, overrides);
    expect(progress.length).toBeGreaterThan(10);
    expect(progress.at(-1)).toBe(1);
    expect(step.value.economy.elapsedSeconds).toBe(whole.economy.elapsedSeconds);
    expect(averageHeadline(step.value)).toEqual(averageHeadline(whole));
    expect([...step.value.towns.values()].map((t) => t.population)).toEqual([...whole.towns.values()].map((t) => t.population));
  }, 30_000);

  test("the chains are the home cluster's: every site in its box, the port the home city's (map 4882's oilfield sat in the region's far corner)", () => {
    for (const seed of [3, 11, 4882]) {
      const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 0 });
      const box = w.home!;
      const info = regionInfo(GAME_MAP, seed);
      expect(w.port).toBe(info.home.map.port!); // inland, a dry port
      // Steel's works and mine are placed over the whole region on purpose (steel.ts: a long haul),
      // and so are the far clusters' limestone fields (clusters.ts).
      const sites = [...w.towns.values()].filter((t) => t.industry && t.id !== "steel-works" && t.id !== "iron-mine" && !t.id.startsWith("field-") && t.id !== "ridge-field" && t.industry !== "border" && t.industry !== "gateway" && t.industry !== "station"); // the far fields, the border crossing, the coast road and the old line's stations are out there by design (clusters.ts, crossings.ts, border.ts, stations.ts)
      expect(sites.length).toBeGreaterThanOrEqual(4);
      for (const s of sites) expect(s.x >= box.x && s.x < box.x + box.width && s.y >= box.y && s.y < box.y + box.height).toBe(true);
    }
  }, 60_000);

  test("the water drains: the big river reaches the sea, the home river joins it, the seaport is on the coast; the hills stay out of the home box", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const { map, seaport } = regionInfo(GAME_MAP, seed);
      const terrain = buildGameTerrain(map);
      const [coast, main, homeRiver] = map.terrain!.rivers!;
      const wet = (x: number, y: number) => terrain.water[Math.round(y) * map.width + Math.round(x)] === 1;
      // The big river's mouth is in the sea; the home river's mouth is in the big river.
      const mouth = main!.points.at(-1)!;
      expect(wet(mouth[0], mouth[1])).toBe(true);
      const ends = [homeRiver!.points[0]!, homeRiver!.points.at(-1)!];
      expect(ends.some(([x, y]) => Math.abs(y - main!.points.reduce((best, p) => (Math.abs(p[0] - x) < Math.abs(best[0] - x) ? p : best))[1]) < 12)).toBe(true);
      // The seaport within a few cells of the sea.
      const port = map.towns.find((t) => t.id === seaport)!;
      let nearSea = false;
      for (let dx = -12; dx <= 12; dx += 1) if (wet(port.x + dx, port.y) && Math.abs(port.x + dx - (coast!.points[0]![0] < 0 ? 0 : map.width - 1)) < 30) nearSea = true;
      expect(nearSea).toBe(true);
      const box = map.home!;
      for (const h of map.terrain!.hills!.slice(regionInfo(GAME_MAP, seed).home.map.terrain!.hills!.length)) {
        const dx = Math.max(box.x - h.x, 0, h.x - (box.x + box.width));
        const dy = Math.max(box.y - h.y, 0, h.y - (box.y + box.height));
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(h.radius);
      }
    }
  }, 60_000);

  test("a region plays: started as a new game is, a bus in the home cluster carries riders", () => {
    const w = startRun(GAME_MAP, 3, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 0 });
    expect(w.width).toBe(REGION_WIDTH);
    expect(w.home).toBeDefined();
    const info = regionInfo(GAME_MAP, 3);
    expect(addBus(w, info.home.trunk[0], info.home.trunk[1]).ok).toBe(true);
    run(w, 2 * SECONDS_PER_GAME_DAY);
    expect(averageHeadline(w).yourRidersPerDay).toBeGreaterThan(0);
  }, 60_000);
});

describe("the steel chain (steel.ts; brief, More industries, more chains)", () => {
  // Seed 4 is a South-South region (a works and its mine), seed 1 the South-West (imports only).
  const game = (seed: number, tuning: Partial<typeof DEFAULT_GAME_TUNING> = {}) => startGame(gameMap(GAME_MAP, seed, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 0, ...tuning });

  test("a South-South map has an idle works, its mine far out with no road to it, and a terminal by the port; a South-West map only the terminal", () => {
    const w = game(4);
    expect(regionInfo(GAME_MAP, 4).home.region).toBe("southSouth");
    const steel = w.steel!;
    expect(steel.working).toBe(false);
    const works = w.towns.get(steel.worksId!)!;
    const mine = w.towns.get(steel.mineId!)!;
    expect([works.industry, mine.industry, w.towns.get(steel.terminalId!)!.industry]).toEqual(["steelworks", "ironmine", "steelport"]);
    expect(Math.hypot(works.x - mine.x, works.y - mine.y)).toBeGreaterThanOrEqual(40);
    // The ore's way to the works is yours to build: no road joins them directly.
    expect(w.simulation.map.segments.some((s) => [s.fromNodeId, s.toNodeId].includes(mine.id) && [s.fromNodeId, s.toNodeId].includes(works.id))).toBe(false);
    const sw = game(1).steel!;
    expect(sw.worksId).toBeNull();
    expect(sw.terminalId).not.toBeNull();
  }, 30_000);

  test("idle, the mine digs nothing and the port's imports are split over the towns; restored, ore is wanted", () => {
    const w = game(4);
    const steel = w.steel!;
    const flows = steelFlows(w);
    expect(flows.some((f) => f.from === steel.mineId)).toBe(false);
    const imported = flows.filter((f) => f.from === steel.terminalId).reduce((sum, f) => sum + f.rate, 0);
    // Of what lands at the seaport, the share that reaches the home city (gateways.ts).
    expect(imported).toBeCloseTo(w.tuning.steelImportShare * steel.baseDemand * importsArriving(w), 6);
    w.economy.funds = w.tuning.steelRestoreCost;
    expect(restoreSteel(w).ok).toBe(true);
    expect(w.economy.funds).toBe(0);
    expect(steelFlows(w).find((f) => f.from === steel.mineId && f.to === steel.worksId)!.rate).toBeGreaterThan(0);
    expect(restoreSteel(w).ok).toBe(false); // already working
  }, 30_000);

  test("past +80% of its start a town grows only as far as its steel lets it", () => {
    // Cement off, and room to grow far past +80%, so only steel can hold the town back.
    const w = game(1, { cementEnabled: false, townGrowthCap: 20 });
    const town = [...w.towns.values()].filter((t) => !t.industry && w.basePopulation.has(t.id)).sort((p, q) => q.population - p.population)[0]!;
    const base = w.basePopulation.get(town.id)!;
    const key = goodsKey({ from: w.steel!.terminalId!, to: town.id, kind: "supplies" });
    w.goods.outcomes.set(key, { delivered: 0, spoiled: 0, trucked: 0, arrived: 0 });
    expect(steelServed(w, town.id)).toBe(0);
    expect(townGrowth(w, town.id)!.cap).toBeCloseTo(base * (1 + w.tuning.steelFreeShare), 6);
    // Served reads the 10-day roll (goods.ts servedRate).
    w.goods.outcomes.set(key, { delivered: steelDemand(w, town.id), spoiled: 0, trucked: 0, arrived: steelDemand(w, town.id) });
    expect(steelServed(w, town.id)).toBe(1);
    expect(townGrowth(w, town.id)!.cap).toBeGreaterThan(base * (1 + w.tuning.steelFreeShare) * 2);
  }, 30_000);

  test("a bond can restore the works; a run file without steel has none", () => {
    const w = game(4);
    w.economy.incomeRateEMA = 1_000_000; // income enough to carry the repayments
    expect(issueSteelBond(w, "steel").ok).toBe(true);
    expect(w.steel!.working).toBe(true);
    const old = game(4, { steelEnabled: undefined as unknown as boolean });
    expect(old.steel).toBeNull();
  }, 30_000);
  test("map version 7 spreads the clusters over the frame: on twenty seeds less land is far from every town, none worse, and every map still draws (brief, Chains: convergent, 3)", () => {
    // The land more than 25 cells from any town, off the sea, sampled every 6 cells.
    const far = (map: ReturnType<typeof gameMap>) => {
      const sea = (map.terrain?.rivers ?? []).filter((r) => Math.max(...(r.widths ?? [r.width])) > 12);
      const wet = (x: number, y: number) => sea.some((r) => r.points.some(([px, py], i) => Math.hypot(px - x, py - y) < (r.widths?.[i] ?? r.width) / 2));
      let land = 0, empty = 0;
      for (let y = 3; y < map.height; y += 6) for (let x = 3; x < map.width; x += 6) {
        if (wet(x, y)) continue;
        land += 1;
        if (!map.towns.some((t) => Math.hypot(t.x - x, t.y - y) <= 25)) empty += 1;
      }
      return empty / land;
    };
    let before = 0, after = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const v6 = far(gameMap(GAME_MAP, seed, { regionEnabled: true, mapVersion: 6 }));
      const map = gameMap(GAME_MAP, seed, { regionEnabled: true, mapVersion: 7 });
      expect(map.width * map.height).toBe(REGION_WIDTH * REGION_HEIGHT);
      for (const [i, a] of map.towns.entries()) for (const b of map.towns.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(15);
      const v7 = far(map);
      expect(v7).toBeLessThanOrEqual(v6 + 0.02);
      before += v6;
      after += v7;
    }
    // 47% -> 38% of the land, on twenty-four seeds when measured.
    expect(after).toBeLessThanOrEqual(before * 0.88);
  }, 120_000);
});

describe("generated maps per seed, with guards (brief, After the ladder's playtest, 5; P8)", () => {
  test("seed 0 is the hand-made map; a seed always draws the same map, and another seed another", () => {
    expect(generatedGameMap(GAME_MAP, 0)).toEqual({ ...GAME_MAP, region: "southwest" });
    expect(generatedGameMap(GAME_MAP, 7)).toEqual(generatedGameMap(GAME_MAP, 7));
    expect(generatedGameMap(GAME_MAP, 7)).not.toEqual(generatedGameMap(GAME_MAP, 8));
  });

  test("every seed passes the guards: trunk length, one dominant city, a river splitting it, 2-3 cut off, all reachable", () => {
    const settings = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const info = generatedMapInfo(GAME_MAP, seed);
      const { map } = info;
      settings.add(info.setting);
      expect(info.rejected).toBeLessThan(400); // never the fallback
      expect(map.towns.length).toBe(9);
      expect(new Set(map.towns.map((t) => t.id)).size).toBe(9);
      // Not the hand-made positions nudged.
      expect(map.towns.filter((t) => GAME_MAP.towns.some((h) => Math.hypot(h.x - t.x, h.y - t.y) < 3)).length).toBeLessThan(5);
      const town = (id: string) => map.towns.find((t) => t.id === id)!;
      const [city, middle, second] = info.trunk.map(town);
      const largest = map.towns.reduce((big, t) => (t.population > big.population ? t : big));
      expect(largest.id).toBe(city!.id);
      expect(map.port).toBe(city!.id);
      expect(Math.abs(Math.hypot(city!.x - middle!.x, city!.y - middle!.y) - 25.5) / 25.5).toBeLessThanOrEqual(0.25);
      expect(Math.abs(Math.hypot(middle!.x - second!.x, middle!.y - second!.y) - 38.1) / 38.1).toBeLessThanOrEqual(0.25);
      const joined = (a: string, b: string) => map.roads.some((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
      expect(joined(city!.id, middle!.id) && joined(middle!.id, second!.id)).toBe(true);
      const cutOff = map.towns.filter((t) => !map.roads.some((r) => r.a === t.id || r.b === t.id));
      expect(cutOff.length).toBeGreaterThanOrEqual(2);
      expect(cutOff.length).toBeLessThanOrEqual(3);
      // The river splits the map: it runs off the top and the bottom.
      const river = map.terrain!.rivers![0]!;
      expect(river.points[0]![1]).toBeLessThan(0);
      expect(river.points[river.points.length - 1]![1]).toBeGreaterThan(map.height);
      // Every town dry (buildGameTerrain throws otherwise), and every cut-off town reachable by a road you can build.
      const w = createGameWorld(map, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
      for (const t of cutOff) expect(map.towns.some((other) => other !== t && planRoad(w, t.id, other.id) !== null)).toBe(true);
      expect(map.terrain!.hills!.length).toBe(2);
    }
    expect([...settings].sort()).toEqual(["coast", "inland", "river"]);
  });

  test("a map's towns are named from one region; only the south-west and south-south have a coast", () => {
    const regions = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) {
      const info = generatedMapInfo(GAME_MAP, seed);
      regions.add(info.region);
      if (info.setting === "coast") expect(["southwest", "southSouth"]).toContain(info.region);
      // Ids follow the names, letters only ("Dutsin-Ma" -> "dutsinma").
      expect(info.map.towns.every((t) => t.id === t.name.toLowerCase().replace(/[^a-z]/g, ""))).toBe(true);
    }
    expect(regions.size).toBeGreaterThanOrEqual(4);
    expect(regions.has("southwest")).toBe(true);
  });

  test("a generated map plays: the world starts, and a bus on the trunk carries riders", () => {
    const info = generatedMapInfo(GAME_MAP, 3);
    const w = startGame(info.map, { ...DEFAULT_GAME_TUNING, maxEmergentTowns: 0 });
    expect(addBus(w, info.trunk[0], info.trunk[1]).ok).toBe(true);
    run(w, 2 * SECONDS_PER_GAME_DAY);
    expect(averageHeadline(w).yourRidersPerDay).toBeGreaterThan(0);
  });
});

describe("seeded variation of the hand-made map (brief, Revision 1, the order, 3; P8)", () => {
  test("seed 0 is the authored map, and a seed always draws the same map", () => {
    expect(variedGameMap(GAME_MAP, 0)).toEqual(GAME_MAP);
    expect(variedGameMap(GAME_MAP, 7)).toEqual(variedGameMap(GAME_MAP, 7));
    expect(variedGameMap(GAME_MAP, 7)).not.toEqual(variedGameMap(GAME_MAP, 8));
  });

  test("the same towns and roads; Ilase stays the biggest; every town dry and on its own bank", () => {
    const riverX = (map: GameMapDef, y: number) => {
      const points = map.terrain!.rivers![0]!.points;
      for (let k = 1; k < points.length; k += 1) {
        const [ax, ay] = points[k - 1]!;
        const [bx, by] = points[k]!;
        if (y >= ay && y <= by) return ax + ((bx - ax) * (y - ay)) / (by - ay);
      }
      return points[0]![0];
    };
    for (let seed = 1; seed <= 200; seed += 1) {
      const map = variedGameMap(GAME_MAP, seed);
      expect(map.towns.map((t) => [t.id, t.x, t.y])).toEqual(GAME_MAP.towns.map((t) => [t.id, t.x, t.y]));
      expect(map.roads).toEqual(GAME_MAP.roads);
      expect(map.rails).toEqual(GAME_MAP.rails);
      const ilase = map.towns.find((t) => t.id === "ilase")!;
      for (const town of map.towns) if (town !== ilase) expect(town.population).toBeLessThan(ilase.population);
      buildGameTerrain(map); // throws if a town is in water
      for (const town of map.towns) expect(Math.sign(town.x - riverX(map, town.y))).toBe(Math.sign(town.x - riverX(GAME_MAP, town.y)));
      expect(map.terrain!.rivers![0]!.widths!.some((w) => w < 2)).toBe(true); // a ford somewhere
    }
  });

  test("a narrow stretch is cheaper to bridge than a wide one", () => {
    const at = (widths: number[]) => {
      const map = structuredClone(GAME_MAP);
      map.terrain!.rivers![0]!.widths = widths;
      const terrain = buildGameTerrain(map);
      let row = 0; // water cells across the row at y = 22, where the third point is
      for (let x = 0; x < map.width; x += 1) row += terrain.water[22 * map.width + x]!;
      return row;
    };
    expect(at([3, 3, 1.2, 3, 3, 3, 3])).toBeLessThan(at([3, 3, 5, 3, 3, 3, 3]));
  });
});

describe("run files: a played game saved, read and replayed (runlog.ts)", () => {
  test("a run saved as JSON replays to exactly the same world", () => {
    const switches = { all: false, goodsOff: false, wearOff: false };
    // A new game's map is the region (and its replay must draw the region again); no warm-up, for time.
    const world = startRun(GAME_MAP, 3, switches, null, { warmUpDays: 0 });
    expect(world.width).toBe(REGION_WIDTH);
    const recorder = createRunRecorder(world, 3, switches, null);
    const ticksADay = Math.round(SECONDS_PER_GAME_DAY / SIM_DT);
    const towns = [...world.towns.keys()];
    const play = (days: number) => {
      for (let i = 0; i < days * ticksADay; i += 1) recordTick(recorder, world, gameTick(world, SIM_DT));
    };
    const act = (action: Parameters<typeof applyAction>[1]) => {
      if (applyAction(world, action).ok) recordAction(recorder, world, action);
    };
    act({ kind: "bus", a: towns[0]!, b: towns[1]! });
    play(3);
    act({ kind: "minibus", a: towns[0]!, b: towns[2]! });
    act({ kind: "pave", a: towns[0]!, b: towns[1]! });
    play(4);
    const file = JSON.parse(JSON.stringify(runFile(recorder))) as RunFile;
    expect(file.actions.length).toBeGreaterThanOrEqual(2);
    expect(file.days.length).toBeGreaterThanOrEqual(6); // 7 days played; with no warm-up the first day row lands a day later
    expect(file.days.at(-1)!.routes.length).toBeGreaterThan(0);
    const replayed = replayRun(GAME_MAP, file);
    expect(replayed.economy.funds).toBe(world.economy.funds);
    expect(headline(replayed)).toEqual(headline(world));
    expect([...replayed.towns.values()].map((t) => t.population)).toEqual([...world.towns.values()].map((t) => t.population));
  }, 90_000);
});

describe("Revision 3, step 1: the fuel chain (fuel.ts)", () => {
  const game = () => startGame(generatedGameMap(GAME_MAP, 543), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });

  test("a new game has a tank farm by the port with its old road, an idle refinery, and crude far from it", () => {
    const w = game();
    const fuel = w.fuel!;
    const site = (id: string) => w.towns.get(id)!;
    expect(site(fuel.depotId).industry).toBe("depot");
    expect(site(fuel.refineryId).industry).toBe("refinery");
    expect(site(fuel.sourceId).industry).toBe("oilfield"); // a south-south map: crude from the wells
    expect(fuel.restored).toBe(false);
    expect(roadChain(w, fuel.depotId, w.port!)).not.toBeNull();
    const [r, s] = [site(fuel.refineryId), site(fuel.sourceId)];
    expect(Math.hypot(r.x - s.x, r.y - s.y)).toBeGreaterThanOrEqual(30);
    // Elsewhere crude comes by pipeline.
    expect(startGame(generatedGameMap(GAME_MAP, 0), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 }).towns.get("fuel-source")!.industry).toBe("terminal");
  });

  test("the refinery makes nothing until it's restored and crude reaches it; then its fuel fills what imports don't", () => {
    const w = game();
    const fuel = w.fuel!;
    const crudeKey = flowKey({ from: fuel.sourceId, to: fuel.refineryId, kind: "supplies" });
    expect(fuelFlows(w).some((f) => f.from === fuel.sourceId)).toBe(false); // idle: no crude wanted
    w.economy.funds = 1e6;
    expect(applyAction(w, { kind: "restoreRefinery" }).ok).toBe(true);
    expect(fuelFlows(w).some((f) => f.from === fuel.sourceId && f.to === fuel.refineryId)).toBe(true);
    expect(refineryOutput(w)).toBe(0); // restored, but no crude yet
    w.goods.outcomes.set(crudeKey, { delivered: 0.5 * fuel.baseDemand, spoiled: 0 });
    expect(refineryOutput(w)).toBeCloseTo(0.5 * fuel.baseDemand, 9);
    // Imports go first: while they cover every town, the refinery's fuel isn't sent across the map.
    expect(fuelFlows(w).some((f) => f.from === fuel.refineryId)).toBe(false);
    // Once imports fall short, and a road leaves it, its fuel goes to towns, never more than it makes.
    w.tuning = { ...w.tuning, fuelImportShare: 0.5 };
    expect(fuelFlows(w).some((f) => f.from === fuel.refineryId)).toBe(false); // no road out yet
    const r = w.towns.get(fuel.refineryId)!;
    const near = [...w.basePopulation.keys()].map((id) => w.towns.get(id)!).sort((p, q) => Math.hypot(p.x - r.x, p.y - r.y) - Math.hypot(q.x - r.x, q.y - r.y))[0]!;
    expect(applyAction(w, { kind: "road", a: fuel.refineryId, b: near.id, alignment: "cheapest" }).ok).toBe(true);
    const refined = fuelFlows(w).filter((f) => f.from === fuel.refineryId);
    expect(refined.length).toBeGreaterThan(0);
    expect(refined.reduce((sum, f) => sum + f.rate, 0)).toBeLessThanOrEqual(refineryOutput(w) + 1e-12);
    // Never more than its capacity, however much crude arrives.
    w.goods.outcomes.set(crudeKey, { delivered: 10 * fuel.baseDemand, spoiled: 0 });
    expect(refineryOutput(w)).toBeCloseTo(w.tuning.refineryShare * fuel.baseDemand, 9);
    expect(cargoName(w, fuel.sourceId, "supplies")).toBe("crude");
    expect(cargoName(w, fuel.refineryId, "supplies")).toBe("fuel");
  });

  test("tankers carry fuel, never crude: getting crude to the refinery is yours", () => {
    const w = game();
    const fuel = w.fuel!;
    w.goods.yards.set(fuel.sourceId, new Map([[`${fuel.refineryId}|supplies`, 500]]));
    w.goods.yards.set(fuel.depotId, new Map([[`${w.port}|supplies`, 500]]));
    // A road from the source to the refinery, so only the rule stops them.
    w.economy.funds = 1e7;
    buildRoad(w, fuel.sourceId, fuel.refineryId);
    for (let i = 0; i < 300; i += 1) truckersPickUp(w, SIM_DT);
    expect(w.goods.yards.get(fuel.sourceId)!.get(`${fuel.refineryId}|supplies`)).toBe(500);
    expect(w.goods.yards.get(fuel.depotId)!.get(`${w.port}|supplies`)!).toBeLessThan(500);
  });
});

describe("Revision 3, step 1b: what a fuel shortage does (fuel.ts)", () => {
  const game = () => startGame(generatedGameMap(GAME_MAP, 543), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });

  test("a short town parks danfos: less of the road into it is theirs", () => {
    const w = game();
    const town = [...w.towns.values()].find((t) => !t.industry && !isCutOff(w, t.id))!;
    const road = w.simulation.map.segments.find((s) => s.type === "road" && (s.fromNodeId === town.id || s.toNodeId === town.id))!;
    w.fuel!.shortage.clear();
    const full = informalBudget(w, road.id);
    w.fuel!.shortage.set(town.id, 1);
    expect(informalBudget(w, road.id)).toBeCloseTo(full * (1 - w.tuning.fuelParked), 9);
  });

  test("your vehicles pay above the pump price on routes through short towns, and nothing where fuel is plentiful", () => {
    const w = game();
    w.economy.funds = 1e6;
    const [a, b] = [...w.towns.values()].filter((t) => !t.industry && !isCutOff(w, t.id)).sort((p, q) => q.population - p.population);
    expect(addBus(w, a!.id, b!.id).ok).toBe(true);
    const routeOf = new Map(w.routes.flatMap((route) => route.vehicleIds.map((id) => [id, route.id] as [string, string])));
    w.fuel!.shortage.clear();
    expect(chargeFuelPremium(w, 1, routeOf).total).toBe(0);
    w.fuel!.shortage.set(a!.id, 1);
    w.fuel!.shortage.set(b!.id, 1);
    const cost = w.economy.vehicleEconomics.get(w.routes[0]!.vehicleIds[0]!)!.operatingCostPerSecond;
    expect(chargeFuelPremium(w, 1, routeOf).total).toBeCloseTo(cost * w.tuning.fuelCostPremium, 6);
  });
});

describe("Revision 3, step 2a: the building chain (cement.ts)", () => {
  // Map 0's works starts working, map 1's idle (by each map's own draw).
  const game = (seed: number) => startGame(generatedGameMap(GAME_MAP, seed), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });

  test("a working works starts with a limestone quarry on an old road to it, and its own road to a town on the network", () => {
    const w = game(0);
    const cement = w.cement!;
    expect(cement.working).toBe(true);
    expect(cement.siloId).toBeNull();
    expect(w.towns.get(cement.worksId)!.industry).toBe("works");
    const [quarry] = [...w.industries.keys()];
    expect(quarry).toBeDefined();
    expect(roadPath(w, quarry!, cement.worksId)).not.toBeNull();
    expect(isCutOff(w, cement.worksId)).toBe(false);
    expect(cargoName(w, quarry!, "supplies")).toBe("limestone");
    expect(cargoName(w, cement.worksId, "supplies")).toBe("cement");
    // All the quarry's limestone goes to the works.
    expect(industryFlows(w).every((flow) => flow.to === cement.worksId)).toBe(true);
  });

  test("an idle works has imports through a terminal by the port, no quarry, and opens one only once restored", () => {
    const w = game(1);
    const cement = w.cement!;
    expect(cement.working).toBe(false);
    expect(w.towns.get(cement.siloId!)!.industry).toBe("silo");
    expect(w.industries.size).toBe(0);
    expect(worksOutput(w)).toBe(0);
    // Imports are split over the towns by what they want, adding up to the imports.
    const imported = cementFlows(w).filter((flow) => flow.from === cement.siloId);
    expect(imported.reduce((sum, flow) => sum + flow.rate, 0)).toBeCloseTo(cementImports(w), 9);
    // No quarry while it's idle, however long.
    w.industrySchedule.nextAtSeconds = 0;
    updateIndustries(w, SIM_DT);
    expect(w.industries.size).toBe(0);
    w.economy.funds = 1e6;
    expect(applyAction(w, { kind: "restoreWorks" }).ok).toBe(true);
    expect(cement.working).toBe(true);
    w.economy.elapsedSeconds = w.industrySchedule.nextAtSeconds;
    updateIndustries(w, SIM_DT);
    expect(w.industries.size).toBe(1);
  });

  test("the works makes what its limestone allows, up to its capacity, split by want, only where a road from it goes", () => {
    const w = game(0);
    const cement = w.cement!;
    const [quarry] = [...w.industries.keys()];
    const key = flowKey({ from: quarry!, to: cement.worksId, kind: "supplies" });
    w.goods.outcomes.set(key, { delivered: 0, spoiled: 0 });
    expect(worksOutput(w)).toBe(0);
    const some = 0.3 * cement.baseDemand * w.tuning.limestonePerCement;
    w.goods.outcomes.set(key, { delivered: some, spoiled: 0 });
    expect(worksOutput(w)).toBeCloseTo(0.3 * cement.baseDemand, 9);
    const flows = cementFlows(w);
    expect(flows.reduce((sum, flow) => sum + flow.rate, 0)).toBeCloseTo(worksOutput(w), 9);
    for (const flow of flows) {
      expect(roadPath(w, cement.worksId, flow.to)).not.toBeNull();
      // Short, every town it reaches gets the same share of what it wants.
      expect(flow.rate / cementDemand(w, flow.to)).toBeCloseTo(flows[0]!.rate / cementDemand(w, flows[0]!.to), 9);
    }
    w.goods.outcomes.set(key, { delivered: 100 * cement.baseDemand, spoiled: 0 });
    expect(worksOutput(w)).toBeCloseTo(worksCapacity(w), 9);
  });

  test("cement holds a town's growth back past its free stretch, not before", () => {
    const w = game(0);
    const town = [...w.basePopulation.keys()][0]!;
    const base = w.basePopulation.get(town)!;
    // Room to grow well past the free stretch: a lane-level road, served well.
    w.tuning = { ...w.tuning, townGrowthCap: 3 };
    for (const from of [w.cement!.worksId]) w.goods.outcomes.set(flowKey({ from, to: town, kind: "supplies" }), { delivered: 0, spoiled: 0, arrived: 0 });
    const none = townGrowth(w, town)!;
    expect(none.cap).toBeCloseTo(base * (1 + w.tuning.cementFreeShare), 6);
    // Served reads the 10-day roll (goods.ts servedRate).
    w.goods.outcomes.set(flowKey({ from: w.cement!.worksId, to: town, kind: "supplies" }), { delivered: cementDemand(w, town), spoiled: 0, arrived: cementDemand(w, town) });
    const full = townGrowth(w, town)!;
    expect(full.cap).toBeGreaterThan(none.cap);
    expect(full.cementHeld).toBeCloseTo(0, 9);
    // With the chain off, no limit.
    w.tuning = { ...w.tuning, cementEnabled: false };
    expect(townGrowth(w, town)!.cap).toBeCloseTo(full.cap, 6);
  });
});

describe("Revision 3, steps 2b-2c: sites need people, and towns grow around them (workers.ts)", () => {
  const game = () => startGame(generatedGameMap(GAME_MAP, 0), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
  const into = (w: GameWorld, siteId: string, made: number, lost: number) => {
    for (const key of [...w.pairOutcomes.keys()]) if (key.endsWith(`:${siteId}`)) w.pairOutcomes.delete(key);
    w.pairOutcomes.set(`somewhere:${siteId}`, { player: 0, poached: made, gaveUp: 0, lost });
  };

  test("a site's trips are its workers' commutes, both ways, sized by its jobs; it's out of the towns' gravity", () => {
    const w = game();
    const works = w.towns.get(w.cement!.worksId)!;
    const to = w.simulation.demand.filter((pair) => pair.to === works.id).reduce((sum, pair) => sum + pair.rate, 0);
    const from = w.simulation.demand.filter((pair) => pair.from === works.id).reduce((sum, pair) => sum + pair.rate, 0);
    const expected = (w.tuning.commutePerThousandJobs * siteJobs(w, works)) / SECONDS_PER_GAME_DAY;
    expect(to).toBeCloseTo(expected, 9);
    expect(from).toBeCloseTo(expected, 9);
    // Between two sites, no trips: they're workplaces, not towns.
    const depot = w.fuel!.depotId;
    expect(w.simulation.demand.some((pair) => pair.from === depot && pair.to === works.id)).toBe(false);
    // Crude sources have no commuters and run regardless.
    expect(siteJobs(w, w.towns.get(w.fuel!.sourceId)!)).toBe(0);
    expect(staffFactor(w, w.fuel!.sourceId)).toBe(1);
  });

  test("a site short of workers makes less: a quarter with nobody arriving, all from half its commutes made", () => {
    const w = game();
    const id = w.cement!.worksId;
    into(w, id, 0, 10);
    expect(staffFactor(w, id)).toBeCloseTo(w.tuning.staffFloor, 9);
    const [quarry] = [...w.industries.keys()];
    w.goods.outcomes.set(flowKey({ from: quarry!, to: id, kind: "supplies" }), { delivered: 100 * w.cement!.baseDemand, spoiled: 0 });
    expect(worksOutput(w)).toBeCloseTo(worksCapacity(w) * w.tuning.staffFloor, 9);
    into(w, id, 5, 5);
    expect(staffFactor(w, id)).toBe(1);
    expect(worksOutput(w)).toBeCloseTo(worksCapacity(w), 9);
    // Switched off, nobody's counted.
    w.tuning = { ...w.tuning, workersEnabled: false };
    into(w, id, 0, 10);
    expect(staffFactor(w, id)).toBe(1);
  });

  test("jobs its people reach give a town room to grow, bounded by its start; jobs nobody reaches give none", () => {
    const w = game();
    const id = w.cement!.worksId;
    const works = w.towns.get(id)!;
    const [town, share] = [...workforceShares(w, works)].sort((p, q) => q[1] - p[1])[0]!;
    for (const site of [...w.towns.values()].filter((s) => s.industry && s.id !== id)) into(w, site.id, 0, 10);
    into(w, id, 5, 5);
    const base = w.basePopulation.get(town)!;
    expect(jobsGrowth(w, town)).toBeCloseTo(Math.min(base * w.tuning.jobsCapShare, siteJobs(w, works) * share * w.tuning.peoplePerJob), 6);
    into(w, id, 0, 10);
    expect(jobsGrowth(w, town)).toBeCloseTo(0, 9);
  });

  test("a big site that has worked staffed long enough grows one camp at its gate, on its road", () => {
    const w = game();
    const id = w.cement!.worksId;
    into(w, id, 5, 5);
    w.sites.workedDays.set(id, w.tuning.gateTownDays);
    const road = w.simulation.map.segments.find((s) => s.type === "road" && (s.fromNodeId === id || s.toNodeId === id))!;
    w.settlement.segmentFlowEMA.set(road.id, 10);
    const events = updateSites(w, SIM_DT, foundGateTown);
    const founded = events.find((e) => e.kind === "founded");
    expect(founded && founded.kind === "founded" && founded.site).toBe(id);
    const camp = w.sites.gates.get(id)!;
    expect(w.towns.get(camp)!.name).toBe("Cement Camp");
    expect(w.settlement.emergent.has(camp)).toBe(true);
    expect(roadPath(w, id, camp)!.nodeIds.length).toBe(2); // on its road, next to it
    // Only one.
    w.sites.workedDays.set(id, 2 * w.tuning.gateTownDays);
    expect(updateSites(w, SIM_DT, foundGateTown).some((e) => e.kind === "founded")).toBe(false);
  });
});

describe("Revision 3, money: bonds (bonds.ts)", () => {
  const game = () => startGame(generatedGameMap(GAME_MAP, 543), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });

  test("a bond restores the refinery now, and is repaid with interest, the same each day, until it's paid", () => {
    const w = game();
    w.economy.funds = 1000;
    w.economy.incomeRateEMA = 1e6 / SECONDS_PER_GAME_DAY; // income enough that the cap doesn't bind
    expect(applyAction(w, { kind: "bond", purpose: "refinery" }).ok).toBe(true);
    expect(w.fuel!.restored).toBe(true);
    expect(w.economy.funds).toBeCloseTo(1000, 6); // lent the price, spent on the restore
    const bond = w.bonds[0]!;
    const t = w.tuning;
    expect(bond.perDay).toBeCloseTo((t.refineryRestoreCost * (1 + t.bondInterest)) / t.bondTermDays, 6);
    repayBonds(w, SECONDS_PER_GAME_DAY);
    expect(w.budget.bonds).toBeCloseTo(bond.perDay, 6);
    for (let i = 0; i < t.bondTermDays + 5; i += 1) repayBonds(w, SECONDS_PER_GAME_DAY);
    expect(bond.owed).toBeCloseTo(0, 6);
    expect(w.budget.bonds).toBeCloseTo(t.refineryRestoreCost * (1 + t.bondInterest), 3);
    // Nothing left to borrow for there.
    expect(applyAction(w, { kind: "bond", purpose: "refinery" }).ok).toBe(false);
  });

  test("repayments are bounded by income: a bond that would pass the cap is refused", () => {
    const w = game();
    w.economy.incomeRateEMA = 100 / SECONDS_PER_GAME_DAY; // ₦100 a day
    const result = applyAction(w, { kind: "bond", purpose: "refinery" });
    expect(result.ok).toBe(false);
    expect(w.fuel!.restored).toBe(false);
    expect(w.bonds.length).toBe(0);
  });

  test("a bond for your named project pays what you still lack into your funds", () => {
    const w = game();
    const [a, b] = [...w.basePopulation.keys()];
    w.economy.funds = 5000;
    w.economy.incomeRateEMA = 1e6 / SECONDS_PER_GAME_DAY;
    w.project = { a: a!, b: b!, rung: "lane", price: 20000, namedAt: 0, affordableAt: null, warned: false };
    const short = bondAmount(w, "project")!;
    expect(applyAction(w, { kind: "bond", purpose: "project" }).ok).toBe(true);
    expect(w.economy.funds).toBeCloseTo(5000 + short, 6);
    expect(heldForProject(w)).toBeCloseTo(20000, 6);
  });
});

describe("Revision 3, step 3: the food chain (food.ts)", () => {
  const game = () => startGame(generatedGameMap(GAME_MAP, 2791), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });

  test("a working mill among the farm towns, on an old road to a town on the network, making the region's food", () => {
    const w = game();
    const food = w.food!;
    expect(w.towns.get(food.millId)!.industry).toBe("mill");
    expect(isCutOff(w, food.millId)).toBe(false);
    expect(food.crops).toEqual(cropsFor(generatedGameMap(GAME_MAP, 2791).region));
    expect(cargoName(w, food.millId, "supplies")).toBe(food.crops.food);
    const farm = farmTowns(w)[0]!;
    expect(cargoName(w, farm.id, "produce", food.millId)).toBe(food.crops.staple);
    expect(cargoName(w, farm.id, "produce", w.port!)).toBe(food.crops.cash);
  });

  test("farm towns send their staple to the mill and their cash crop to the port, not produce to markets; the mill's food is split by want", () => {
    const w = game();
    const food = w.food!;
    const flows = goodsFlows(w);
    const markets = new Set(marketTowns(w).map((town) => town.id).filter((id) => id !== w.port)); // the port takes the cash crop
    for (const farm of farmTowns(w)) {
      expect(flows.some((flow) => flow.from === farm.id && flow.to === food.millId)).toBe(true);
      expect(flows.some((flow) => flow.from === farm.id && flow.to === w.port)).toBe(true);
      expect(flows.some((flow) => flow.from === farm.id && flow.kind === "produce" && markets.has(flow.to))).toBe(false);
    }
    // Staple enough for the whole capacity: the mill makes it, split by want, only where its road goes.
    for (const farm of farmTowns(w)) w.goods.outcomes.set(flowKey({ from: farm.id, to: food.millId, kind: "produce" }), { delivered: 1e3, spoiled: 0 });
    const out = goodsFlows(w).filter((flow) => flow.from === food.millId);
    expect(out.reduce((sum, flow) => sum + flow.rate, 0)).toBeLessThanOrEqual(millOutput(w) + 1e-9);
    for (const flow of out) expect(flow.rate / foodWant(w, flow.to)).toBeCloseTo(out[0]!.rate / foodWant(w, out[0]!.to), 9);
  });

  test("market trade: a fed market draws more trips, by the share of its food it gets; and room to grow", () => {
    const w = game();
    const food = w.food!;
    const market = marketTowns(w)[0]!;
    const key = flowKey({ from: food.millId, to: market.id, kind: "supplies" });
    const tripsTo = () => w.simulation.demand.filter((pair) => pair.to === market.id).reduce((sum, pair) => sum + pair.rate, 0);
    // Its whole basket: the region's food and, where there's a flour mill, flour.
    const flourKey = food.flourMillId ? flowKey({ from: food.flourMillId, to: market.id, kind: "supplies" }) : null;
    w.goods.outcomes.set(key, { delivered: 0, spoiled: 0 });
    if (flourKey) w.goods.outcomes.set(flourKey, { delivered: 0, spoiled: 0 });
    refreshDemand(w);
    const hungry = tripsTo();
    expect(foodGrowth(w, market.id)).toBe(0);
    w.goods.outcomes.set(key, { delivered: foodWant(w, market.id), spoiled: 0 });
    if (flourKey) w.goods.outcomes.set(flourKey, { delivered: flourWant(w, market.id), spoiled: 0 });
    refreshDemand(w);
    expect(foodServed(w, market.id)).toBe(1);
    expect(marketFed(w, market.id)).toBeCloseTo(1, 9);
    // Every trip to it grows by the boost, except where the other end is a fed market too (the larger boost applies once).
    expect(tripsTo()).toBeGreaterThan(hungry * (1 + w.tuning.marketTripBoost) * 0.9);
    expect(foodGrowth(w, market.id)).toBeCloseTo(w.basePopulation.get(market.id)! * w.tuning.foodCapShare, 6);
  });

  test("the state pays for cash crops reaching the port, a sum a tonne", () => {
    const w = game();
    const farm = farmTowns(w)[0]!;
    w.goods.outcomes.set(flowKey({ from: farm.id, to: w.port!, kind: "produce" }), { delivered: 2, spoiled: 0 });
    const funds = w.economy.funds;
    expect(payExports(w, 1)).toBeCloseTo(2 * w.tuning.exportPayPerTonne, 9);
    expect(w.economy.funds).toBeCloseTo(funds + 2 * w.tuning.exportPayPerTonne, 9);
    expect(w.budget.exports).toBeCloseTo(2 * w.tuning.exportPayPerTonne, 9);
  });
});

describe("Revision 3, step 3c: flour from imported wheat at the port (food.ts)", () => {
  const game = (seed = 2791) => startGame(generatedGameMap(GAME_MAP, seed), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });

  test("a flour mill by the port on an old road to it; the north mills sorghum into meal, not wheat into flour", () => {
    const w = game();
    const food = w.food!;
    expect(w.towns.get(food.flourMillId!)!.industry).toBe("flourmill");
    expect(roadPath(w, food.flourMillId!, w.port!)).not.toBeNull();
    expect(cargoName(w, w.port!, "supplies", food.flourMillId!)).toBe("wheat");
    expect(cargoName(w, food.flourMillId!, "supplies")).toBe("flour");
    expect(cropsFor("north")).toEqual({ staple: "sorghum", food: "grain meal", mill: "Grain Mill", cash: "groundnuts" });
  });

  test("imported wheat makes flour, by what arrives, up to capacity; a market's basket is its food and its flour", () => {
    const w = game();
    const food = w.food!;
    const wheat = flowKey({ from: w.port!, to: food.flourMillId!, kind: "supplies" });
    w.goods.outcomes.set(wheat, { delivered: 0, spoiled: 0 });
    expect(flourOutput(w)).toBe(0);
    w.goods.outcomes.set(wheat, { delivered: 1e3, spoiled: 0 });
    expect(flourOutput(w)).toBeCloseTo(flourCapacity(w) * staffFactor(w, food.flourMillId!), 9);
    const market = marketTowns(w)[0]!;
    w.goods.outcomes.set(flowKey({ from: food.millId, to: market.id, kind: "supplies" }), { delivered: foodWant(w, market.id), spoiled: 0 });
    w.goods.outcomes.set(flowKey({ from: food.flourMillId!, to: market.id, kind: "supplies" }), { delivered: 0, spoiled: 0 });
    expect(marketFed(w, market.id)).toBeCloseTo(1 - w.tuning.flourWeight, 9);
    w.goods.outcomes.set(flowKey({ from: food.flourMillId!, to: market.id, kind: "supplies" }), { delivered: flourWant(w, market.id), spoiled: 0 });
    expect(marketFed(w, market.id)).toBeCloseTo(1, 9);
  });
});

describe("site production: what a site makes, and what holds it back (production.ts)", () => {
  test("a refinery short of crude says so; idle says idle; fed in full, capacity's the limit", () => {
    const w = startGame(generatedGameMap(GAME_MAP, 543), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
    const fuel = w.fuel!;
    expect(siteProduction(w, fuel.refineryId)!.limit).toBe("idle");
    w.economy.funds = 1e6;
    applyAction(w, { kind: "restoreRefinery" });
    const crude = flowKey({ from: fuel.sourceId, to: fuel.refineryId, kind: "supplies" });
    const capacity = w.tuning.refineryShare * fuel.baseDemand;
    w.goods.outcomes.set(crude, { delivered: 0.1 * capacity, spoiled: 0 });
    const short = siteProduction(w, fuel.refineryId)!;
    expect(short.product).toBe("fuel");
    expect(short.inputs[0]!.name).toBe("crude");
    expect(short.inputs[0]!.arriving).toBeCloseTo(0.1 * capacity, 9);
    expect(short.limit).toBe("input");
    w.goods.outcomes.set(crude, { delivered: 2 * capacity, spoiled: 0 });
    const full = siteProduction(w, fuel.refineryId)!;
    expect(full.made).toBeLessThanOrEqual(full.capacity + 1e-12);
    expect(["capacity", "workers"]).toContain(full.limit);
  });
});

describe("farm towns keep farming as they grow (food.ts, farmsByStart)", () => {
  test("a farm town grown past market size still farms its start's land, and is a market too", () => {
    const w = startGame(generatedGameMap(GAME_MAP, 2791), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
    const farm = farmTowns(w)[0]!;
    const base = w.basePopulation.get(farm.id)!;
    farm.population = w.tuning.marketPopulation + 20;
    expect(farmTowns(w).some((town) => town.id === farm.id)).toBe(true);
    expect(marketTowns(w).some((town) => town.id === farm.id)).toBe(true);
    const staple = goodsFlows(w).find((flow) => flow.from === farm.id && flow.to === w.food!.millId)!;
    expect(staple.rate).toBeCloseTo((w.tuning.producePerThousandPerDay * base) / SECONDS_PER_GAME_DAY, 9);
    // A run file from before the rule replays as played: by size now.
    w.tuning = { ...w.tuning, farmsByStart: false };
    expect(farmTowns(w).some((town) => town.id === farm.id)).toBe(false);
  });
});

describe("expanding a site (expand.ts)", () => {
  test("a line adds half the capacity, more input wanted and more jobs, twice at most, each dearer; an idle site can't", () => {
    const w = startGame(generatedGameMap(GAME_MAP, 0), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
    const works = w.cement!.worksId;
    w.economy.funds = 1e6;
    const capacity = worksCapacity(w);
    const jobs = siteJobs(w, w.towns.get(works)!);
    const first = expandCost(w, works)!;
    expect(applyAction(w, { kind: "expand", siteId: works }).ok).toBe(true);
    expect(worksCapacity(w)).toBeCloseTo(capacity * (1 + w.tuning.expandStep), 9);
    expect(siteJobs(w, w.towns.get(works)!)).toBeCloseTo(jobs * (1 + w.tuning.expandStep), 9);
    expect(expandCost(w, works)!).toBeGreaterThan(first);
    expect(applyAction(w, { kind: "expand", siteId: works }).ok).toBe(true);
    expect(applyAction(w, { kind: "expand", siteId: works }).ok).toBe(false); // as big as it gets
    // The refinery starts idle: restore it first.
    expect(applyAction(w, { kind: "expand", siteId: w.fuel!.refineryId }).ok).toBe(false);
  });
});

describe("Revision 4: towns expect service; the budget-year sweep", () => {
  test("a town past the threshold expects a share that rises with its size, capped; short of it, it grows less", () => {
    const w = startGame(generatedGameMap(GAME_MAP, 0), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
    const t = w.tuning;
    const town = [...w.basePopulation.keys()].map((id) => w.towns.get(id)!).sort((p, q) => q.population - p.population)[0]!;
    town.population = t.serviceExpectFrom - 1;
    expect(expectedShare(w, town.id)).toBe(0);
    town.population = t.serviceExpectFrom + 100;
    expect(expectedShare(w, town.id)).toBeCloseTo(t.serviceExpectBase + 100 * t.serviceExpectPerThousand, 9);
    town.population = 10_000;
    expect(expectedShare(w, town.id)).toBe(t.serviceExpectMax);
    w.tuning = { ...t, serviceExpectEnabled: false };
    expect(expectedShare(w, town.id)).toBe(0);
  });

  test("at the year's end, cash above the carry-over goes back; a named project's price and this year's borrowing are safe", () => {
    // Off by default since C17 failed in play (2026-10-23); the mechanics stay, behind the switch.
    const w = startGame(generatedGameMap(GAME_MAP, 0), { ...DEFAULT_GAME_TUNING, warmUpDays: 0, sweepEnabled: true });
    const t = w.tuning;
    w.economy.funds = t.sweepCarryMin + 30_000;
    expect(sweepDue(w)).toBeCloseTo(30_000, 6);
    const [a, b] = [...w.basePopulation.keys()];
    w.project = { a: a!, b: b!, rung: "lane", price: t.sweepCarryMin + 20_000, namedAt: 0, affordableAt: null, warned: false };
    expect(sweepDue(w)).toBeCloseTo(10_000, 6);
    w.sweep.borrowed = 10_000;
    expect(sweepDue(w)).toBeCloseTo(0, 6);
    w.sweep.borrowed = 0;
    w.economy.elapsedSeconds = w.sweep.endsAtSeconds;
    expect(updateSweep(w)).toBeCloseTo(10_000, 6);
    expect(w.economy.funds).toBeCloseTo(t.sweepCarryMin + 20_000, 6);
    expect(w.budget.swept).toBeCloseTo(10_000, 6);
    expect(w.sweep.endsAtSeconds).toBeGreaterThan(w.economy.elapsedSeconds);
  });
});

describe("Revision 4: haulage yards", () => {
  test("a yard lets hauliers carry from a place further and faster, crude included from a yard at the source", () => {
    const w = startGame(generatedGameMap(GAME_MAP, 543), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
    const fuel = w.fuel!;
    w.economy.funds = 1e7;
    expect(applyAction(w, { kind: "lorry", a: fuel.sourceId, b: fuel.refineryId }).ok).toBe(false); // no player lorries
    applyAction(w, { kind: "road", a: fuel.sourceId, b: fuel.refineryId, alignment: "cheapest" });
    w.goods.yards.set(fuel.sourceId, new Map([[`${fuel.refineryId}|supplies`, 500]]));
    truckersPickUp(w, 1);
    expect(w.truckers.size).toBe(0); // nobody trucks crude
    expect(applyAction(w, { kind: "yard", townId: fuel.sourceId }).ok).toBe(true);
    expect(applyAction(w, { kind: "yard", townId: fuel.sourceId }).ok).toBe(false); // one is enough
    truckersPickUp(w, 1);
    expect([...w.truckers.values()].reduce((s, t) => s + t, 0)).toBeGreaterThan(0);
  });
});

describe("hauliers: no hoarding (map 2418, day 233)", () => {
  test("they hold at most a few loads a destination; the rest waits at the yard", () => {
    const w = startGame(generatedGameMap(GAME_MAP, 0), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
    const works = w.cement!.worksId;
    w.yards.add(works);
    const to = [...w.basePopulation.keys()][0]!;
    w.goods.yards.set(works, new Map([[`${to}|supplies`, 10_000]]));
    for (let i = 0; i < 200; i += 1) truckersPickUp(w, 1);
    const held = w.truckers.get(`${works}|${to}|supplies`) ?? 0;
    expect(held).toBeLessThanOrEqual(w.tuning.truckerHoldLoads * w.tuning.truckLoad + 1e-9);
    expect(w.goods.yards.get(works)!.get(`${to}|supplies`)!).toBeGreaterThan(9_000);
  });
});

describe("Revision 4, step 4: a second, private refinery (fuel.ts)", () => {
  const game = (tuning: Partial<GameTuning> = {}) => startGame(generatedGameMap(GAME_MAP, 543), { ...DEFAULT_GAME_TUNING, warmUpDays: 0, ...tuning });
  const open = (w: GameWorld) => {
    w.economy.elapsedSeconds = w.fuel!.newRefineryAt;
    return updateNewRefinery(w);
  };

  test("it opens once, mid-game, by the port and far from the crude, with no road, and says so", () => {
    const w = game();
    const fuel = w.fuel!;
    const opensAt = fuel.newRefineryAt;
    const day = opensAt / SECONDS_PER_GAME_DAY;
    expect(day).toBeGreaterThanOrEqual(w.tuning.newRefineryDayMin);
    expect(day).toBeLessThanOrEqual(w.tuning.newRefineryDayMax);
    expect(updateNewRefinery(w)).toBeNull(); // not yet
    expect(newRefinery(w)).toBeNull();
    const event = open(w)!;
    expect(event.kind).toBe("refinery-opened");
    const site = newRefinery(w)!;
    expect(site.industry).toBe("newrefinery");
    expect(isCutOff(w, site.id)).toBe(true);
    const port = w.towns.get(w.port!)!;
    const source = w.towns.get(fuel.sourceId)!;
    // By the port: on its 10-16 ring, or at map version 3 a ring as wide starting past where it's built up.
    const ring = Math.max(16, Math.ceil(builtUp(port.population) + 2) + 6) + 0.5;
    expect(Math.hypot(site.x - port.x, site.y - port.y)).toBeLessThanOrEqual(ring);
    expect(Math.hypot(site.x - source.x, site.y - source.y)).toBeGreaterThan(Math.hypot(port.x - source.x, port.y - source.y) - ring);
    expect(updateNewRefinery(w)).toBeNull(); // once
    // Seeded: the same map opens it on the same day.
    expect(game().fuel!.newRefineryAt).toBe(opensAt);
  });

  test("it wants crude whether or not the old one runs, makes fuel only from crude delivered, and sends it out", () => {
    const w = game();
    const fuel = w.fuel!;
    open(w);
    const site = newRefinery(w)!;
    expect(fuel.restored).toBe(false);
    expect(fuelFlows(w).some((f) => f.from === fuel.sourceId && f.to === site.id)).toBe(true);
    expect(newRefineryOutput(w)).toBe(0);
    expect(newRefinerySiteProduction(w, site.id)!.limit).not.toBe("idle");
    w.goods.outcomes.set(flowKey({ from: fuel.sourceId, to: site.id, kind: "supplies" }), { delivered: 10 * fuel.baseDemand, spoiled: 0 });
    expect(newRefineryOutput(w)).toBeCloseTo(newRefineryCapacity(w) * (w.tuning.newRefineryShare > 0 ? 1 : 0), 6);
    expect(cargoName(w, site.id, "supplies")).toBe("fuel");
    // No road out: nothing leaves for the towns. With one, it fills what's short, and the rest goes to the port.
    w.tuning = { ...w.tuning, fuelImportShare: 0.5 };
    expect(fuelFlows(w).some((f) => f.from === site.id && f.to !== w.port)).toBe(false);
    w.economy.funds = 1e7;
    expect(applyAction(w, { kind: "road", a: site.id, b: w.port!, alignment: "cheapest" }).ok).toBe(true);
    const out = fuelFlows(w).filter((f) => f.from === site.id);
    expect(out.some((f) => f.to !== w.port)).toBe(true);
    expect(out.reduce((sum, f) => sum + f.rate, 0)).toBeCloseTo(newRefineryOutput(w), 9);
  });

  test("switched off (and in a run file from before it), it never opens", () => {
    const w = game({ newRefineryEnabled: false });
    expect(w.fuel!.newRefineryAt).toBe(0);
    w.economy.elapsedSeconds = 200 * SECONDS_PER_GAME_DAY;
    expect(updateNewRefinery(w)).toBeNull();
    const old = game({ newRefineryEnabled: undefined as unknown as boolean });
    old.economy.elapsedSeconds = 200 * SECONDS_PER_GAME_DAY;
    expect(updateNewRefinery(old)).toBeNull();
  });
});

describe("exports are paid once (tick.ts, 2026-10-23)", () => {
  test("a tick's funds rise by exactly the income it books, exports included", () => {
    const w = startGame(generatedGameMap(GAME_MAP, 543), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
    const farm = farmTowns(w)[0]!;
    // Hold the cash crop's arrival steady so the tick pays a known sum.
    const key = flowKey({ from: farm.id, to: w.port!, kind: "produce" });
    const paidTwice = (once: boolean) => {
      const v = structuredClone(w);
      v.tuning = { ...v.tuning, exportsPaidOnce: once, exportPayPerTonne: 1000 };
      v.goods.outcomes.set(key, { delivered: 1, spoiled: 0 });
      const funds = v.economy.funds;
      const exports = v.budget.exports;
      gameTick(v, SIM_DT);
      return { gained: v.economy.funds - funds, exported: v.budget.exports - exports };
    };
    const once = paidTwice(true);
    const twice = paidTwice(false);
    expect(once.exported).toBeGreaterThan(0);
    // The old way paid the same exports in a second time.
    expect(twice.gained - once.gained).toBeCloseTo(twice.exported, 6);
  });
});

describe("growth reads service between towns, not commutes to sites (2026-10-23)", () => {
  test("a site's unserved commutes lower the town's share overall, never the share its growth reads", () => {
    const w = startGame(generatedGameMap(GAME_MAP, 543), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
    const town = [...w.basePopulation.keys()][0]!;
    const other = [...w.basePopulation.keys()][1]!;
    const site = [...w.towns.values()].find((t) => t.industry)!.id;
    w.pairOutcomes.clear();
    w.pairOutcomes.set(`${town}:${other}`, { player: 6, poached: 2, gaveUp: 0, lost: 2 });
    w.pairOutcomes.set(`${town}:${site}`, { player: 0, poached: 0, gaveUp: 0, lost: 30 });
    for (const indexed of [false, true]) {
      w.outcomeIndex = null;
      if (indexed) indexOutcomes(w);
      expect(townShareBetweenTowns(w, town).player).toBeCloseTo(0.6, 9);
      expect(shareOfTown(w, town).player).toBeCloseTo(0.15, 9);
    }
  });
});

describe("Revision 4, step 5: motor parks for danfos (parks.ts)", () => {
  const game = (tuning: Partial<GameTuning> = {}) => startGame(generatedGameMap(GAME_MAP, 543), { ...DEFAULT_GAME_TUNING, warmUpDays: 0, ...tuning });

  test("a park goes at a town, once, for its price; never at a site", () => {
    const w = game();
    const town = [...w.basePopulation.keys()][0]!;
    const site = [...w.towns.values()].find((t) => t.industry)!.id;
    w.economy.funds = w.tuning.parkCost - 1;
    expect(applyAction(w, { kind: "park", townId: town }).ok).toBe(false);
    w.economy.funds = 10 * w.tuning.parkCost;
    expect(applyAction(w, { kind: "park", townId: site }).ok).toBe(false);
    expect(applyAction(w, { kind: "park", townId: town }).ok).toBe(true);
    expect(w.economy.funds).toBe(9 * w.tuning.parkCost);
    expect(applyAction(w, { kind: "park", townId: town }).ok).toBe(false);
    expect(game({ parksEnabled: false }).tuning.parksEnabled).toBe(false);
    const off = game({ parksEnabled: false });
    off.economy.funds = 1e6;
    expect(applyAction(off, { kind: "park", townId: town }).ok).toBe(false);
  });

  test("the roads touching a parked town carry more before they jam; the agberos keep less of its levy", () => {
    const w = game();
    const town = [...w.basePopulation.keys()][0]!;
    const touching = w.simulation.map.segments.find((s) => s.fromNodeId === town || s.toNodeId === town)!;
    const elsewhere = w.simulation.map.segments.find((s) => s.fromNodeId !== town && s.toNodeId !== town && s.surface === touching.surface && !s.busLane)!;
    const before = roadCapacity(w, touching.id);
    expect(agberoCutAt(w, town)).toBe(w.tuning.agberoCut);
    w.economy.funds = 1e6;
    applyAction(w, { kind: "park", townId: town });
    expect(roadCapacity(w, touching.id)).toBeCloseTo(before * (1 + w.tuning.parkCapacityBoost), 9);
    expect(roadCapacity(w, elsewhere.id)).toBeCloseTo(roadCapacity(game(), elsewhere.id), 9);
    expect(agberoCutAt(w, town)).toBe(w.tuning.parkAgberoCut);
  });
});

describe("a park says what it's doing (parks.ts parkReport, 2026-10-23)", () => {
  test("after a day, its card has the levy paid there, yours and the agberos', and what they'd keep without it", () => {
    const w = startGame(generatedGameMap(GAME_MAP, 543), { ...DEFAULT_GAME_TUNING, warmUpDays: 3 });
    const town = [...w.basePopulation.keys()].map((id) => w.towns.get(id)!).sort((p, q) => q.population - p.population)[0]!.id;
    expect(parkReport(w, town)).toBeNull();
    w.economy.funds = 1e6;
    applyAction(w, { kind: "park", townId: town });
    for (let i = 0; i < Math.round(SECONDS_PER_GAME_DAY / SIM_DT); i += 1) gameTick(w, SIM_DT);
    const report = parkReport(w, town)!;
    expect(report.yours).toBeGreaterThan(0);
    expect(report.agberos / (report.yours + report.agberos)).toBeCloseTo(w.tuning.parkAgberoCut, 6);
    expect(report.agberosWithout).toBeGreaterThan(report.agberos);
    expect(report.roadSpeed).toBeGreaterThan(0);
  });
});

describe("Revision 4, step 6: a metro (metro.ts)", () => {
  const game = (tuning: Partial<GameTuning> = {}) => startGame(generatedGameMap(GAME_MAP, 543), { ...DEFAULT_GAME_TUNING, warmUpDays: 0, ...tuning });
  const biggest = (w: GameWorld) => [...w.basePopulation.keys()].map((id) => w.towns.get(id)!).sort((p, q) => q.population - p.population)[0]!;

  test("only a big town gets one, a line at a time, up to its most, at the first line's price then the next's", () => {
    const w = game();
    const t = w.tuning;
    const town = biggest(w);
    w.economy.funds = 1e7;
    town.population = t.metroMinPopulation - 1;
    expect(applyAction(w, { kind: "metro", townId: town.id }).ok).toBe(false);
    town.population = 400;
    const funds = w.economy.funds;
    expect(applyAction(w, { kind: "metro", townId: town.id }).ok).toBe(true);
    expect(w.economy.funds).toBe(funds - t.metroCost);
    for (let line = 2; line <= t.metroMaxLines; line += 1) expect(applyAction(w, { kind: "metro", townId: town.id }).ok).toBe(true);
    expect(w.economy.funds).toBe(funds - t.metroCost - (t.metroMaxLines - 1) * t.metroLineCost);
    expect(applyAction(w, { kind: "metro", townId: town.id }).ok).toBe(false);
    expect(metroLines(w, town.id)).toBe(t.metroMaxLines);
  });

  test("each line carries its share of the town's inside trips; pays fares, costs its running; each lifts growth", () => {
    // Cement off: past its free stretch a town's growth waits on cement (cement.ts), metro or not.
    const w = game({ cementEnabled: false });
    const t = w.tuning;
    const town = biggest(w);
    town.population = 400;
    w.economy.funds = 1e7;
    const inside = 400 * t.localTripsPerThousandPerDay;
    let cap = townGrowth(w, town.id)!.cap;
    for (let line = 1; line <= t.metroMaxLines; line += 1) {
      applyAction(w, { kind: "metro", townId: town.id });
      expect(metroRiders(w, town.id).riders).toBeCloseTo(line * t.metroLineShare * inside, 6);
      const next = townGrowth(w, town.id)!.cap;
      expect(next).toBeGreaterThan(cap); // every line lifts it
      cap = next;
    }
    const funds = w.economy.funds;
    const paid = runMetros(w, SECONDS_PER_GAME_DAY);
    expect(paid.fares).toBeCloseTo(t.metroMaxLines * t.metroLineShare * inside * t.metroFare, 6);
    expect(paid.running).toBeCloseTo(t.metroMaxLines * t.metroRunningPerLine, 6);
    expect(w.economy.funds).toBeCloseTo(funds + paid.fares - paid.running, 6);
  });

  test("switched off, it never runs", () => {
    const w = game({ metroEnabled: false });
    w.economy.funds = 1e7;
    const town = biggest(w);
    town.population = 400;
    expect(applyAction(w, { kind: "metro", townId: town.id }).ok).toBe(false);
  });
});

describe("a cement shortage names where the chain breaks (cement.ts cementBreak, 2026-10-23)", () => {
  test("idle works, then no quarry working (with when the next opens), then a quarry the works doesn't hear from", () => {
    const w = startGame(generatedGameMap(GAME_MAP, 543), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
    const cement = w.cement!;
    cement.working = false;
    expect(cementBreak(w)).toEqual({ kind: "idle" });
    cement.working = true;
    w.industries.clear();
    const none = cementBreak(w)!;
    expect(none.kind).toBe("no-quarry");
    expect((none as { nextDay: number }).nextDay).toBeGreaterThanOrEqual(1);
    w.industrySchedule.nextAtSeconds = 0;
    const opened = openQuarry(w);
    expect(opened).not.toBeNull();
    expect(cementBreak(w)).toEqual({ kind: "quarry", quarryId: (opened as { townId: string }).townId });
  });
});

describe("freight rates (freightrates.ts, 2026-10-23)", () => {
  const MAP2: GameMapDef = {
    width: 60,
    height: 20,
    towns: [
      { id: "big", name: "Big", x: 5, y: 10, population: 120 },
      { id: "mid", name: "Mid", x: 18, y: 10, population: 40 },
      // Within the hauliers' reach by road (~25 cells), so the rate is what moves them.
      { id: "far", name: "Far", x: 30, y: 10, population: 30 },
    ],
    roads: [{ a: "big", b: "mid" }, { a: "mid", b: "far" }],
    port: "big",
    rails: [{ a: "big", b: "far" }],
  };
  const world = () => {
    const w = createGameWorld(MAP2, { ...DEFAULT_GAME_TUNING, ...ALL_SYSTEMS_ON, startingFunds: 1e6, maxEmergentTowns: 0, townGrowthCap: 0 });
    buildTrack(w, "big", "far");
    addFreightTrain(w, "big", "far");
    return w;
  };

  test("a line's rate sets what it earns a tonne, and how keen the hauliers are on goods it could carry", () => {
    const w = world();
    const line = w.lorryRoutes.find((r) => r.id.startsWith("freight:"))!.id;
    expect(freightFareFactor(w, line)).toBe(1);
    expect(haulierPull(w, "big", "far")).toBe(1);
    expect(applyAction(w, { kind: "freightRate", routeId: line, rate: "dear" }).ok).toBe(true);
    expect(freightFareFactor(w, line)).toBe(w.tuning.freightRateDear);
    expect(haulierPull(w, "big", "far")).toBeCloseTo(1 + w.tuning.freightHaulierPull, 9);
    expect(haulierPull(w, "big", "mid")).toBe(1); // mid isn't on the line: no say there
    expect(applyAction(w, { kind: "freightRate", routeId: line, rate: "cheap" }).ok).toBe(true);
    expect(freightFareFactor(w, line)).toBe(w.tuning.freightRateCheap);
    expect(haulierPull(w, "big", "far")).toBeLessThan(1);
    expect(applyAction(w, { kind: "freightRate", routeId: "freight:nowhere", rate: "dear" }).ok).toBe(false);
  });

  test("dear, the hauliers take more of the goods waiting at its station; cheap, less", () => {
    const taken = (rate: "cheap" | "standard" | "dear") => {
      const w = world();
      const line = w.lorryRoutes.find((r) => r.id.startsWith("freight:"))!.id;
      applyAction(w, { kind: "freightRate", routeId: line, rate });
      w.goods.yards.set("big", new Map([["far|supplies", 300]]));
      for (let i = 0; i < 30; i += 1) truckersPickUp(w, SIM_DT);
      return 300 - w.goods.yards.get("big")!.get("far|supplies")!;
    };
    expect(taken("dear")).toBeGreaterThan(taken("standard"));
    expect(taken("standard")).toBeGreaterThan(taken("cheap"));
  });
});

describe("terms and pledges (brief, Revision 5, step 2: the probe)", () => {
  const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 2418, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 1, ...overrides });

  test("a term opens as play begins: up to three pledges from the world's problems, of different kinds and towns, the home cluster's first", () => {
    const w = start();
    const term = w.term!;
    expect(term.number).toBe(1);
    expect(term.pledges.length).toBeGreaterThanOrEqual(1);
    expect(term.pledges.length).toBeLessThanOrEqual(3);
    expect(new Set(term.pledges.map((p) => p.kind)).size).toBe(term.pledges.length);
    expect(new Set(term.pledges.map((p) => p.townId)).size).toBe(term.pledges.length);
    const box = w.home!;
    for (const p of term.pledges) {
      const t = w.towns.get(p.townId)!;
      expect(t.x >= box.x && t.x < box.x + box.width && t.y >= box.y && t.y < box.y + box.height).toBe(true);
      expect(pledgeProgress(w, p)).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);

  test("each pledge names a real move with its price: bought, it goes through (outside review, 2026-10-26)", () => {
    for (const seed of [2418, 7585]) {
      const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 1 });
      for (const p of w.term!.pledges) {
        const move = pledgeMove(w, p);
        if (["connect", "fuel", "cement"].includes(p.kind)) expect(move).not.toBeNull();
        if (!move) continue;
        expect(Number.isFinite(move.price) && move.price > 0).toBe(true);
        const copy = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 1 });
        copy.economy.funds = 1e6;
        expect(applyAction(copy, move.action)).toMatchObject({ ok: true });
      }
      // Fuel is pledged only where the network leaves a town short and a source could reach it
      // (a 57% read just after the warm-up, planned full, reached 100% by day 40 untouched).
      for (const p of w.term!.pledges.filter((q) => q.kind === "fuel")) {
        expect(fuelPlanned(w, p.townId)!).toBeLessThan(0.6);
        expect(fuelReachable(w, p.townId)).toBe(true);
      }
      // A seat pledge says where it's going, and no "now" until it moves.
      for (const p of w.term!.pledges.filter((q) => q.kind === "seats")) {
        expect(p.text).toMatch(/: \d+ a day to \d+$/);
        expect(pledgeNow(w, p)).toBe("");
      }
    }
  }, 120_000);

  test("you pledge two at most, once each; it's an action, so a run file replays it", () => {
    const w = start();
    const [a, b, c] = w.term!.pledges;
    expect(applyAction(w, { kind: "pledge", id: a!.id }).ok).toBe(true);
    expect(applyAction(w, { kind: "pledge", id: a!.id }).ok).toBe(false);
    if (b) expect(applyAction(w, { kind: "pledge", id: b.id }).ok).toBe(true);
    if (c) expect(applyAction(w, { kind: "pledge", id: c.id })).toEqual({ ok: false, reason: "you've pledged 2 this term" });
    expect(applyAction(w, { kind: "pledge", id: "nope" }).ok).toBe(false);
  }, 60_000);

  test("a term ends with a verdict and the next opens; a build is reported a week on", () => {
    const w = start({ termDays: 10 });
    applyAction(w, { kind: "pledge", id: w.term!.pledges[0]!.id });
    const towns = [...w.basePopulation.keys()];
    applyAction(w, { kind: "bus", a: towns[0]!, b: towns[1]! });
    const events: GameEvent[] = [];
    for (let i = 0; i < 11 * SECONDS_PER_GAME_DAY * 30; i += 1) events.push(...gameTick(w, SIM_DT));
    const ended = events.find((e) => e.kind === "term-ended");
    expect(ended && ended.kind === "term-ended" && ended.kept.length + ended.missed.length).toBe(1);
    expect(events.some((e) => e.kind === "term-started" && e.number === 2)).toBe(true);
    expect(w.term!.number).toBe(2);
    expect(w.term!.history).toHaveLength(1);
    const week = events.find((e) => e.kind === "a-week-on");
    expect(week && week.kind === "a-week-on" && week.towns).toEqual([towns[0], towns[1]]);
  }, 120_000);

  test("a pledge missed isn't offered again the next term; a service pledge asks a good step past where you are; one week-on note per pair", () => {
    const w = start({ termDays: 8 });
    for (const p of w.term!.pledges) {
      if (p.kind === "service") expect(p.target).toBeGreaterThanOrEqual(p.from + 0.2 - 1e-9);
    }
    const pledged = w.term!.pledges.slice(0, 2);
    for (const p of pledged) applyAction(w, { kind: "pledge", id: p.id });
    const towns = [...w.basePopulation.keys()];
    applyAction(w, { kind: "bus", a: towns[0]!, b: towns[1]! });
    applyAction(w, { kind: "bus", a: towns[1]!, b: towns[0]! });
    const events: GameEvent[] = [];
    for (let i = 0; i < 9 * SECONDS_PER_GAME_DAY * 30; i += 1) events.push(...gameTick(w, SIM_DT));
    expect(events.filter((e) => e.kind === "a-week-on")).toHaveLength(1);
    const missed = w.term!.history[0]!.missedKeys!;
    for (const p of w.term!.pledges) expect(missed).not.toContain(`${p.kind}:${p.townId}`);
  }, 120_000);

  test("the mandate: a term's verdict pays the next term's grant (debt cleared from it); two failed terms in a row and you're replaced", () => {
    const w = start({ termDays: 4 });
    applyAction(w, { kind: "console", op: "funds", amount: -10000 });
    const events: GameEvent[] = [];
    // No pledges made: each term fails. The towns barely move in four days.
    for (let i = 0; i < 9 * SECONDS_PER_GAME_DAY * 30; i += 1) events.push(...gameTick(w, SIM_DT));
    const ended = events.filter((e) => e.kind === "term-ended");
    expect(ended.length).toBeGreaterThanOrEqual(2);
    const first = ended[0]!;
    expect(first.kind === "term-ended" && first.failed).toBe(true);
    expect(first.kind === "term-ended" && first.grant).toBeGreaterThanOrEqual(w.tuning.termGrantBase!);
    expect(w.budget.grant).toBeGreaterThanOrEqual(2 * w.tuning.termGrantBase!);
    expect(events.some((e) => e.kind === "replaced")).toBe(true);
    expect(w.term!.replacedAtSeconds).toBeDefined();
    // The save goes on: a new term still opens after.
    expect(w.term!.number).toBeGreaterThanOrEqual(3);
  }, 120_000);

  test("the console ends a term at the next day's check", () => {
    const w = start();
    expect(applyAction(w, { kind: "console", op: "end-term" }).ok).toBe(true);
    const events: GameEvent[] = [];
    for (let i = 0; i < 2 * SECONDS_PER_GAME_DAY * 30; i += 1) events.push(...gameTick(w, SIM_DT));
    expect(events.some((e) => e.kind === "term-ended" && e.number === 1)).toBe(true);
  }, 60_000);

  test("fuel goes only to towns its source reaches: on the region, none to the far clusters past the tankers (map 2418, day 230)", () => {
    const w = start({ startingFunds: 1e6 });
    expect(applyAction(w, { kind: "restoreRefinery" }).ok).toBe(true);
    const refinery = w.fuel!.refineryId;
    for (const f of fuelFlows(w).filter((f) => f.from === refinery)) {
      const cells = roadPath(w, refinery, f.to)?.distance ?? Infinity;
      expect(f.to === w.port || cells <= fuelReach(w, refinery) || !!railPath(w, refinery, f.to)).toBe(true);
    }
  }, 60_000);

  test("a run played before terms (no pledgesEnabled in its tuning) has none", () => {
    const w = start({ pledgesEnabled: undefined });
    expect(w.term).toBeUndefined();
  }, 60_000);
});

describe("private traffic (private.ts; brief, Revision 5, Ideas parked)", () => {
  const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 2418, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 1, ...overrides });

  test("a town's cars: a little for its size, all of its growth; heavier on the roads near it, and in its roads' speed", () => {
    const w = start();
    updatePrivateTraffic(w);
    const city = [...w.basePopulation.keys()].sort((a, b) => w.towns.get(b)!.population - w.towns.get(a)!.population)[0]!;
    const before = townCars(w, city);
    const roads = w.simulation.map.segments.filter((s) => s.type === "road" && (s.fromNodeId === city || s.toNodeId === city));
    const loadBefore = roads.reduce((sum, r) => sum + privateLoad(w, r.id), 0);
    // It grows by half: its cars, and their load on its roads, jump.
    w.towns.get(city)!.population *= 1.5;
    w.privateFlowAtSeconds = undefined;
    updatePrivateTraffic(w);
    expect(townCars(w, city)).toBeGreaterThan(before * 5);
    expect(roads.reduce((sum, r) => sum + privateLoad(w, r.id), 0)).toBeGreaterThan(loadBefore * 5);
    // Fading with distance: a road whose middle is far from every town carries next to nothing from them.
    const nodes = new Map(w.simulation.map.nodes.map((n) => [n.id, n]));
    const far = w.simulation.map.segments.filter((s) => s.type === "road").find((s) => {
      const a = nodes.get(s.fromNodeId)!, b = nodes.get(s.toNodeId)!;
      return Math.hypot(a.x - b.x, a.y - b.y) > 60;
    });
    if (far) expect(privateLoad(w, far.id)).toBeLessThan(0.05);
  }, 60_000);

  test("a run played before it (no privateTrafficEnabled) has none", () => {
    const w = start({ privateTrafficEnabled: undefined });
    for (let i = 0; i < 60; i += 1) gameTick(w, SIM_DT);
    expect(w.privateFlow).toBeUndefined();
  }, 60_000);
});

describe("the far clusters' offers (clusters.ts; brief, Revision 5: a reason for each far cluster)", () => {
  const start = (seed: number, overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 1, ...overrides });

  test("every region's far clusters offer something: limestone in the hills, a farm belt elsewhere, one of each", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const { map } = regionInfo(GAME_MAP, seed);
      const offers = map.clusters!.map((c) => c.offer);
      expect(offers.length).toBeGreaterThanOrEqual(2);
      expect(offers).toContain("limestone");
      expect(offers).toContain("farm");
      for (const c of map.clusters!) expect(c.towns[0]).toBe(c.hub);
    }
  }, 60_000);

  test("a limestone field: placed by its hub, permanent, twice a quarry, and not counted against the quarries that open", () => {
    const w = start(2418, { cementEnabled: true });
    const cluster = w.clusters!.find((c) => c.offer === "limestone")!;
    const field = w.industries.get(`field-${cluster.hub}`);
    if (!w.cement) return; // a map without the building chain has no field
    expect(field?.field).toBe(true);
    expect(field!.closesAtSeconds).toBe(Infinity);
    const site = w.towns.get(field!.id)!;
    const hub = w.towns.get(cluster.hub)!;
    expect(Math.hypot(site.x - hub.x, site.y - hub.y)).toBeLessThanOrEqual(15);
    expect(clusterOfferShare(w, cluster)).not.toBeNull();
  }, 60_000);

  test("a farm belt's towns grow twice the staple; term 2 asks you to bring an offer home", () => {
    const w = start(2418, { termDays: 3 });
    const belt = w.clusters!.find((c) => c.offer === "farm")!;
    const town = w.towns.get(belt.towns[1] ?? belt.towns[0]!)!;
    const land = farmland(w, town);
    w.tuning.farmBeltScale = 1;
    expect(land).toBeCloseTo(farmland(w, town) * 2, 6);
    w.tuning.farmBeltScale = 2;
    for (let i = 0; i < 4 * SECONDS_PER_GAME_DAY * 30; i += 1) gameTick(w, SIM_DT);
    expect(w.term!.number).toBe(2);
    expect(w.term!.pledges.some((p) => p.kind === "reach")).toBe(true);
  }, 60_000);
});

describe("the union as a party (union.ts; brief, Revision 5: the union, agreed 2026-10-25)", () => {
  const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 2418, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 1, startingFunds: 1e6, ...overrides });
  /** A home road between two towns, paved and laned. */
  const laned = (w: GameWorld) => {
    const homeIds = new Set(w.unions!.find((u) => u.id === "home")!.towns);
    const road = w.simulation.map.segments.find((s) => s.type === "road" && homeIds.has(s.fromNodeId) && homeIds.has(s.toNodeId))!;
    const [a, b] = [road.fromNodeId, road.toNodeId];
    expect(applyAction(w, { kind: "pave", a, b }).ok).toBe(true);
    expect(applyAction(w, { kind: "lane", a, b }).ok).toBe(true);
    return [a, b] as const;
  };
  const tick = (w: GameWorld, days: number) => { const events: GameEvent[] = []; for (let i = 0; i < days * SECONDS_PER_GAME_DAY * 30; i += 1) events.push(...gameTick(w, SIM_DT)); return events; };

  test("a chairman for the home cluster and each far one, wary to begin", () => {
    const w = start();
    expect(w.unions!.length).toBe(1 + (w.clusters?.length ?? 0));
    for (const u of w.unions!) { expect(u.stance).toBe(0); expect(u.chairman.length).toBeGreaterThan(3); expect(u.towns.length).toBeGreaterThan(0); }
  }, 60_000);

  test("a bus lane angers him and brings a demand with a deadline; paying meets it and pleases him", () => {
    const w = start();
    laned(w);
    const home = w.unions!.find((u) => u.id === "home")!;
    expect(home.stance).toBeLessThan(0);
    expect(home.demand?.kind).toBe("lane");
    const before = home.stance;
    const funds = w.economy.funds;
    const price = home.demand!.price;
    expect(applyAction(w, { kind: "union", unionId: "home", answer: "pay" }).ok).toBe(true);
    expect(w.economy.funds).toBeCloseTo(funds - price, 6);
    expect(home.stance).toBeGreaterThan(before);
    expect(home.demand).toBeNull();
  }, 60_000);

  test("conceding eases the lane; refusing, or letting the deadline pass, brings a strike", () => {
    const w = start();
    const [a, b] = laned(w);
    expect(applyAction(w, { kind: "union", unionId: "home", answer: "concede" }).ok).toBe(true);
    const lane = laneOn(w, a, b)!;
    expect(lane.enforcement).toBe("lax");
    expect(lane.encroachment).toBeGreaterThanOrEqual(0.5);
    // A second lane's demand, ignored past its deadline: he strikes.
    const w2 = start();
    laned(w2);
    const events = tick(w2, (w2.tuning.unionDemandDays ?? 7) + 1);
    expect(events.some((e) => e.kind === "union-answered" && e.answer === "ignored")).toBe(true);
    expect(events.some((e) => e.kind === "strike-announced")).toBe(true);
  }, 120_000);

  test("against you, a lane's grievance builds faster; with you, slower", () => {
    const w = start();
    const [a, b] = laned(w);
    const lane = laneOn(w, a, b)!;
    const home = w.unions!.find((u) => u.id === "home")!;
    home.stance = -0.8;
    expect(laneMood(w, lane).grievance).toBeGreaterThan(2);
    home.stance = 0.8;
    expect(laneMood(w, lane).grievance).toBeLessThan(0.6);
  }, 60_000);

  test("a run played before it (no unionEnabled) has none", () => {
    const w = start({ unionEnabled: undefined });
    expect(w.unions).toBeUndefined();
  }, 60_000);
});

describe("the rains: fords that flood (floods.ts; brief, Revision 5, step 6: the first shock)", () => {
  // Short seasons: the rains on day 4-5, named 2 days ahead, 3 days of flood, every 10 days.
  const quick = { floodFirstDayMin: 4, floodFirstDayMax: 5, floodWarnDays: 2, floodDays: 3, floodEveryDays: 10 };
  const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 2418, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 1, startingFunds: 1e6, ...quick, ...overrides });
  const tick = (w: GameWorld, days: number) => { const events: GameEvent[] = []; for (let i = 0; i < days * SECONDS_PER_GAME_DAY * 30; i += 1) events.push(...gameTick(w, SIM_DT)); return events; };
  const until = (w: GameWorld, kind: GameEvent["kind"], days = 20) => {
    for (let i = 0; i < days * SECONDS_PER_GAME_DAY * 30; i += 1) {
      const hit = gameTick(w, SIM_DT).find((e) => e.kind === kind);
      if (hit) return hit;
    }
    return null;
  };

  test("the old roads' river crossings are named fords; a road you build has its bridge", () => {
    const w = start();
    const fords = w.floods!.fords;
    expect(fords.length).toBeGreaterThan(0);
    for (const ford of fords) {
      expect(ford.name).toMatch(/ford( \(\d+\))?$/);
      expect(ford.bridged).toBe(false);
      expect(ford.span).toBeGreaterThanOrEqual(1);
    }
    expect(new Set(fords.map((f) => f.name)).size).toBe(fords.length);
  }, 60_000);

  test("named ahead, the busiest first; under water the road runs at floodSpeed; then the water falls and the next rains are drawn", () => {
    const w = start();
    const warning = until(w, "flood-warning");
    expect(warning?.kind).toBe("flood-warning");
    if (warning?.kind !== "flood-warning") return;
    expect(warning.fords.length).toBe(2);
    expect(warning.inDays).toBeGreaterThanOrEqual(1);
    const rose = until(w, "flood-rose");
    expect(rose?.kind).toBe("flood-rose");
    tick(w, 0.2);
    const flooded = [...w.floods!.flooded];
    expect(flooded.length).toBeGreaterThan(0);
    for (const id of flooded) {
      expect(isFlooded(w, id)).toBe(true);
      expect(w.segmentSpeed.get(id)).toBeLessThanOrEqual(w.tuning.floodSpeed!);
    }
    const riseAt = w.floods!.riseAt;
    expect(until(w, "flood-fell")?.kind).toBe("flood-fell");
    tick(w, 0.2);
    expect(w.floods!.flooded.size).toBe(0);
    for (const id of flooded) expect(w.segmentSpeed.get(id)!).toBeGreaterThan(w.tuning.floodSpeed!);
    expect(w.floods!.riseAt).toBe(riseAt + 10 * SECONDS_PER_GAME_DAY);
  }, 120_000);

  test("a bridge raised before the water keeps that road open, for its price, and it never floods again", () => {
    const w = start();
    const warning = until(w, "flood-warning");
    if (warning?.kind !== "flood-warning") throw new Error("no warning");
    const [first, second] = warning.fords;
    const ford = w.floods!.fords.find((f) => f.id === first!.id)!;
    const funds = w.economy.funds;
    const outcome = applyAction(w, { kind: "bridgeFord", fordId: ford.id });
    expect(outcome.ok).toBe(true);
    expect(outcome.amount).toBe(fordBridgeCost(w, ford));
    expect(funds - w.economy.funds).toBeCloseTo(fordBridgeCost(w, ford), 0);
    expect(applyAction(w, { kind: "bridgeFord", fordId: ford.id }).ok).toBe(false);
    const rose = until(w, "flood-rose");
    if (rose?.kind !== "flood-rose") throw new Error("no flood");
    expect(rose.fords.map((f) => f.id)).toEqual([second!.id]);
    expect(w.floods!.under).not.toContain(ford.id);
  }, 120_000);

  test("a bridge raised under the flood opens the road at once", () => {
    const w = start();
    until(w, "flood-rose");
    tick(w, 0.2);
    const id = w.floods!.under[0]!;
    const before = w.floods!.flooded.size;
    expect(applyAction(w, { kind: "bridgeFord", fordId: id }).ok).toBe(true);
    expect(w.floods!.under).not.toContain(id);
    expect(w.floods!.flooded.size).toBeLessThan(before);
  }, 120_000);

  test("your buses go round a flooded ford by a dry road you built, and back when the water falls", () => {
    // Seed 7585: the Ikire ford on the Ikire-Itori road; a high-bridged road Ikire-Ipetu is the other way across.
    const w = startRun(GAME_MAP, 7585, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 1, startingFunds: 1e6, ...quick, floodFordsPerSeason: 1, floodDays: 8 });
    const id = (name: string) => [...w.towns.values()].find((t) => t.name === name)!.id;
    const [ikire, itori, ipetu] = [id("Ikire"), id("Itori"), id("Ipetu")];
    expect(applyAction(w, { kind: "road", a: ikire, b: ipetu, alignment: "cheapest", high: true }).ok).toBe(true);
    for (let i = 0; i < 3; i += 1) applyAction(w, { kind: "bus", a: ikire, b: itori });
    const buses = w.routes.flatMap((r) => r.vehicleIds).map((v) => w.simulation.vehicles.find((x) => x.id === v)!);
    const over = (v: (typeof buses)[number]) => v.path.some((node, k) => {
      const from = v.path[(k - 1 + v.path.length) % v.path.length]!;
      const seg = w.simulation.routing.graph.get(from)?.find((e) => e.to === node)?.segmentId;
      return !!seg && w.floods!.flooded.has(seg);
    });
    expect(until(w, "flood-rose")?.kind).toBe("flood-rose");
    expect(w.floods!.flooded.size).toBeGreaterThan(0);
    const flooded = new Set(w.floods!.flooded);
    tick(w, 5);
    // Most have turned at an end and gone round (one may still be crawling out of the water).
    expect(buses.filter((v) => !over(v)).length).toBeGreaterThanOrEqual(2);
    expect(until(w, "flood-fell")?.kind).toBe("flood-fell");
    // Back the short way, over the old road, once it's dry: each takes it at its next end, so
    // watched over days, not at one instant (hauliers' relayed trucks shift when).
    const back = new Set<string>();
    for (let s = 0; s < 16; s += 1) {
      tick(w, 1);
      for (const v of buses) if (v.path.some((node, k) => {
        const from = v.path[(k - 1 + v.path.length) % v.path.length]!;
        return flooded.has(w.simulation.routing.graph.get(from)?.find((e) => e.to === node)?.segmentId ?? "");
      })) back.add(v.id);
    }
    expect(back.size).toBeGreaterThanOrEqual(2);
  }, 180_000);

  test("a run played before it (no floodsEnabled) has no fords", () => {
    const w = start({ floodsEnabled: undefined });
    expect(w.floods).toBeUndefined();
  }, 60_000);
});

describe("named crossings, straight or round, the ridge's limestone (crossings.ts; brief, Revision 5, step 6)", () => {
  const start = (seed: number, overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 1, startingFunds: 1e6, ...overrides });
  const named = (w: GameWorld, name: string) => [...w.towns.values()].find((t) => t.name === name)!.id;

  test("each river's crossings are named, bank to bank within a bridge's span, clear of the fords", () => {
    const w = start(4202);
    expect(w.crossings!.length).toBeGreaterThan(0);
    for (const c of w.crossings!) {
      expect(c.name).toMatch(/(narrows|crossing)( \(\d+\))?$/);
      for (const b of c.banks) expect(isWater(w.simulation.map.terrain, b.x, b.y)).toBe(false);
      expect(c.span).toBeLessThan(14);
      for (const f of w.floods!.fords) expect(Math.hypot(f.x - c.x, f.y - c.y)).toBeGreaterThanOrEqual(8);
    }
  }, 60_000);

  test("straight across is offered where a ridge makes it a different road -- shorter, dearer -- and built as asked", () => {
    const w = start(8510);
    const [a, b] = [named(w, "Gashua"), named(w, "Potiskum")];
    const ways = waysFor(w, (way) => planRoad(w, a, b, way));
    expect(ways).toEqual(["cheapest", "direct"]);
    const round = planRoad(w, a, b, "cheapest")!, over = planRoad(w, a, b, "direct")!;
    expect(over.length).toBeLessThan(round.length * 0.8);
    expect(over.cost).toBeGreaterThan(round.cost);
    expect(applyAction(w, { kind: "road", a, b, alignment: "direct" }).ok).toBe(true);
    expect(roadChain(w, a, b)).toBeTruthy();
  }, 60_000);

  test("on open land there's one way: straight isn't offered, and asking for it is refused", () => {
    const w = start(8510);
    const towns = [...w.towns.values()].filter((t) => !t.industry);
    let checked = 0;
    for (const p of towns) for (const q of towns) {
      if (p.id >= q.id || roadChain(w, p.id, q.id) || checked >= 3) continue;
      const cheapest = planRoad(w, p.id, q.id, "cheapest");
      const direct = planRoad(w, p.id, q.id, "direct");
      if (!cheapest || !direct || cheapest.bridgeCells > 0 || cheapest.hillsCost > 0 || direct.bridgeCells > 0 || direct.hillsCost > 0) continue;
      checked += 1;
      expect(waysFor(w, (way) => planRoad(w, p.id, q.id, way))).toEqual(["cheapest"]);
      expect(applyAction(w, { kind: "road", a: p.id, b: q.id, alignment: "direct" }).ok).toBe(false);
    }
    expect(checked).toBeGreaterThan(0);
  }, 60_000);

  test("a limestone field on the range's heights, outside the home cluster: a quarry that never works out, out of the hauliers' reach", () => {
    const w = start(8510);
    const field = w.towns.get("ridge-field")!;
    expect(field.industry).toBe("quarry");
    expect(w.industries.get("ridge-field")!.closesAtSeconds).toBe(Infinity);
    const box = homeBox(w);
    expect(field.x < box.x || field.x >= box.x + box.width || field.y < box.y || field.y >= box.y + box.height).toBe(true);
    const works = w.towns.get(w.cement!.worksId)!;
    expect(Math.hypot(field.x - works.x, field.y - works.y)).toBeGreaterThan(40);
  }, 60_000);

  test("a run played before it (no crossingsEnabled) has none, no ridge field, and straight stays switched off", () => {
    const w = start(8510, { crossingsEnabled: undefined, ridgeFieldEnabled: undefined });
    expect(w.crossings).toBeUndefined();
    expect(w.towns.has("ridge-field")).toBe(false);
    const [a, b] = [named(w, "Gashua"), named(w, "Potiskum")];
    expect(applyAction(w, { kind: "road", a, b, alignment: "direct" })).toEqual({ ok: false, reason: SWITCHED_OFF });
  }, 60_000);
});

describe("a new road over water: a causeway that floods, or a high bridge (floods.ts; brief, Revision 5, step 6)", () => {
  const quick = { floodFirstDayMin: 4, floodFirstDayMax: 5, floodWarnDays: 2, floodDays: 3, floodEveryDays: 10 };
  const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 8510, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 1, startingFunds: 1e6, ...quick, ...overrides });
  const named = (w: GameWorld, name: string) => [...w.towns.values()].find((t) => t.name === name)!.id;
  const until = (w: GameWorld, kind: GameEvent["kind"], days = 20) => {
    for (let i = 0; i < days * SECONDS_PER_GAME_DAY * 30; i += 1) {
      const hit = gameTick(w, SIM_DT).find((e) => e.kind === kind);
      if (hit) return hit;
    }
    return null;
  };

  test("built plain, its crossing is a causeway: at the quoted price, a ford of yours the rains can take", () => {
    const w = start();
    const [a, b] = [named(w, "Ganye"), named(w, "Gashua")];
    const plan = planRoad(w, a, b, "cheapest")!;
    expect(plan.bridgeCells).toBeGreaterThan(0);
    const fords = w.floods!.fords.length;
    const funds = w.economy.funds;
    expect(applyAction(w, { kind: "road", a, b, alignment: "cheapest" }).ok).toBe(true);
    expect(funds - w.economy.funds).toBeCloseTo(plan.cost, 0);
    const added = w.floods!.fords.slice(fords);
    expect(added.length).toBeGreaterThan(0);
    for (const ford of added) { expect(ford.built).toBe(true); expect(ford.name).toMatch(/causeway/); }
  }, 60_000);

  test("built high, it costs the raise on top -- a ford's price a cell -- and never floods", () => {
    const w = start();
    const [a, b] = [named(w, "Ganye"), named(w, "Gashua")];
    const plan = planRoad(w, a, b, "cheapest")!;
    const raise = highBridgeCost(w, plan.polyline);
    expect(raise).toBeGreaterThanOrEqual(w.tuning.fordBridgePerCell!);
    const fords = w.floods!.fords.length;
    const funds = w.economy.funds;
    expect(applyAction(w, { kind: "road", a, b, alignment: "cheapest", high: true }).ok).toBe(true);
    expect(funds - w.economy.funds).toBeCloseTo(plan.cost + raise, 0);
    expect(w.floods!.fords.length).toBe(fords);
  }, 60_000);

  test("your buses over a causeway: the rains name it first, and it floods", () => {
    const w = start();
    const [a, b] = [named(w, "Ganye"), named(w, "Gashua")];
    expect(applyAction(w, { kind: "road", a, b, alignment: "cheapest" }).ok).toBe(true);
    const causeway = w.floods!.fords.find((f) => f.built)!;
    expect(applyAction(w, { kind: "bus", a, b }).ok).toBe(true);
    expect(applyAction(w, { kind: "bus", a, b }).ok).toBe(true);
    const warning = until(w, "flood-warning");
    if (warning?.kind !== "flood-warning") throw new Error("no warning");
    expect(warning.fords[0]!.id).toBe(causeway.id);
    until(w, "flood-rose");
    for (let i = 0; i < 300; i += 1) gameTick(w, SIM_DT);
    const piece = roadChain(w, a, b)!.find((s) => isFlooded(w, s.id));
    expect(piece).toBeTruthy();
  }, 120_000);

  test("a run played before it (no causewaysEnabled): a new road's bridge never floods", () => {
    const w = start({ causewaysEnabled: undefined });
    const [a, b] = [named(w, "Ganye"), named(w, "Gashua")];
    const fords = w.floods!.fords.length;
    expect(applyAction(w, { kind: "road", a, b, alignment: "cheapest" }).ok).toBe(true);
    expect(w.floods!.fords.length).toBe(fords);
  }, 60_000);
});

describe("your names and colours (labels.ts; brief, The map, \"Your mark on it\", 1)", () => {
  const switches = { all: false, goodsOff: false, wearOff: false };

  test("a route gets a name and a colour, a road a name; a blank clears; nonsense is refused", () => {
    const w = startRun(GAME_MAP, 3, switches, null, { warmUpDays: 0, startingFunds: 1e6 });
    const road = w.simulation.map.segments.find((s) => s.type === "road")!;
    const [a, b] = [road.fromNodeId, road.toNodeId];
    expect(applyAction(w, { kind: "bus", a, b }).ok).toBe(true);
    const route = w.routes[0]!;
    expect(applyAction(w, { kind: "label", key: routeLabelKey(route.id), name: "  The   Shuttle ", colour: LINE_COLOURS[3] }).ok).toBe(true);
    expect(labelOf(w, routeLabelKey(route.id))).toEqual({ name: "The Shuttle", colour: LINE_COLOURS[3] });
    expect(applyAction(w, { kind: "label", key: roadLabelKey(b, a), name: "Old Trunk Road" }).ok).toBe(true);
    expect(labelOf(w, roadLabelKey(a, b))?.name).toBe("Old Trunk Road");
    expect(applyAction(w, { kind: "label", key: roadLabelKey(a, b), colour: LINE_COLOURS[0] }).ok).toBe(false);
    expect(applyAction(w, { kind: "label", key: routeLabelKey(route.id), colour: "#123456" }).ok).toBe(false);
    expect(applyAction(w, { kind: "label", key: "route:nowhere", name: "x" }).ok).toBe(false);
    expect(applyAction(w, { kind: "label", key: routeLabelKey(route.id), name: "", colour: "" }).ok).toBe(true);
    expect(labelOf(w, routeLabelKey(route.id))).toEqual({});
  }, 60_000);

  test("a run file keeps them: the replay has the same names", () => {
    const world = startRun(GAME_MAP, 3, switches, null, { warmUpDays: 0, startingFunds: 1e6 });
    const recorder = createRunRecorder(world, 3, switches, null);
    const act = (action: Parameters<typeof applyAction>[1]) => { if (applyAction(world, action).ok) recordAction(recorder, world, action); };
    const road = world.simulation.map.segments.find((s) => s.type === "road")!;
    act({ kind: "bus", a: road.fromNodeId, b: road.toNodeId });
    act({ kind: "label", key: routeLabelKey(world.routes[0]!.id), name: "Line 1", colour: LINE_COLOURS[1] });
    for (let i = 0; i < 30; i += 1) recordTick(recorder, world, gameTick(world, SIM_DT));
    const replayed = replayRun(GAME_MAP, JSON.parse(JSON.stringify(runFile(recorder))) as RunFile);
    expect(replayed.labels).toEqual(world.labels);
  }, 90_000);
});

describe("goods get there over connected roads (haulage.ts; brief, The gateways, 4)", () => {
  // Seed 1 is a South-West region: the steel terminal by the port, the cement works, towns far out.
  const game = (tuning: Partial<typeof DEFAULT_GAME_TUNING> = {}) => startGame(gameMap(GAME_MAP, 1, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 0, ...tuning });
  const farthest = (w: GameWorld, from: string) => [...w.towns.values()].filter((t) => !t.industry && Number.isFinite(haulDistance(w, from, t.id))).sort((p, q) => haulDistance(w, from, q.id) - haulDistance(w, from, p.id))[0]!;

  test("cement bound past a leg's reach goes to a town on the way, nearer to it; within reach, straight", () => {
    const w = game();
    const works = w.cement!.worksId;
    const far = farthest(w, works);
    const reach = legReach(w, works, "supplies");
    expect(haulDistance(w, works, far.id)).toBeGreaterThan(reach);
    const stop = nextStop(w, works, far.id, reach);
    if (stop) {
      expect(stop).not.toBe(far.id);
      expect(haulDistance(w, works, stop)).toBeLessThan(reach);
      expect(haulDistance(w, stop, far.id)).toBeLessThan(haulDistance(w, works, far.id));
    } else expect(haulBreak(w, works, far.id)?.kind).toBe("gap");
    const near = [...w.towns.values()].filter((t) => !t.industry).sort((p, q) => haulDistance(w, works, p.id) - haulDistance(w, works, q.id))[0]!;
    expect(haulDistance(w, works, near.id)).toBeLessThan(reach);
    expect(nextStop(w, works, near.id, reach)).toBe(near.id);
  }, 60_000);

  test("a yard at the stop on the way stretches its legs, and the cards name the gap it bridges", () => {
    const w = game({ startingFunds: 1e6 });
    const works = w.cement!.worksId;
    const far = farthest(w, works);
    // Each yard the card names carries the goods on past it, until they get there.
    let b = haulBreak(w, works, far.id)!;
    for (let k = 0; k < 8 && b.kind === "gap" && b.yardAt; k += 1) {
      const at = b.yardAt;
      expect(buildYard(w, at).ok).toBe(true);
      b = haulBreak(w, works, far.id)!;
      if (b.kind === "gap" && b.yardAt) expect(haulDistance(w, b.yardAt, far.id)).toBeLessThan(haulDistance(w, at, far.id));
    }
    expect(b.kind).toBe("legs");
  }, 60_000);

  test("a leg's end isn't a delivery: the goods wait there, and the last leg counts under where they began", () => {
    const w = game();
    const works = w.cement!.worksId;
    const [via, to] = [...w.towns.values()].filter((t) => !t.industry).map((t) => t.id);
    const leg = { entry: { from: works, to: via!, kind: "supplies" as const, amount: 20, trip: { origin: works, destination: to! } }, amount: 20 };
    const delivered = new Map<string, number>();
    recordGoodsDelivered([leg] as never, delivered);
    expect(delivered.size).toBe(0);
    relayArrivals(w, [leg] as never);
    expect(w.goods.relay!.get(via!)!.get(`${to}|supplies|${works}`)).toBe(20);
    const last = { entry: { from: via!, to: to!, kind: "supplies" as const, amount: 20, trip: { origin: works, destination: to! } }, amount: 20 };
    recordGoodsDelivered([last] as never, delivered);
    expect(delivered.get(goodsKey({ from: works, to: to!, kind: "supplies" }))).toBe(20);
  }, 60_000);

  test("only what a town waits on to grow goes in legs; a run file without goodsRelay never relays", () => {
    const w = game();
    expect(relayed(w, w.cement!.worksId, "supplies")).toBe(true);
    expect(relayed(w, w.steel!.terminalId!, "supplies")).toBe(true);
    const farm = [...w.towns.values()].find((t) => !t.industry)!;
    expect(relayed(w, farm.id, "produce")).toBe(false);
    const old = game({ goodsRelay: undefined as unknown as boolean });
    expect(relayed(old, old.cement!.worksId, "supplies")).toBe(false);
    expect(haulBreak(old, old.cement!.worksId, farthest(old, old.cement!.worksId).id)).toBeNull();
  }, 60_000);

  test("the Yard tool's preview names the towns a yard would bring goods to, and changes nothing", () => {
    const w = game();
    const works = w.cement!.worksId;
    const far = farthest(w, works);
    const b = haulBreak(w, works, far.id)!;
    if (b.kind !== "gap" || !b.yardAt) return;
    const plans = haulPlans(w);
    const yards = [...w.yards];
    const brings = yardWouldBring(w, b.yardAt);
    expect(brings.reached.length + brings.quicker).toBeGreaterThan(0);
    expect([...w.yards]).toEqual(yards);
    expect(w.haulPlans).toBe(plans);
  }, 60_000);

  test("a town's card counts its cement waiting between legs as on the way, and where it waits", () => {
    const w = game();
    const works = w.cement!.worksId;
    const [via, to] = [...w.towns.values()].filter((t) => !t.industry).map((t) => t.id);
    relayArrivals(w, [{ entry: { from: works, to: via!, kind: "supplies", amount: 12, trip: { origin: works, destination: to! } }, amount: 12 }] as never);
    const way = goodsOnTheWay(w, to!).find((x) => x.origin === works)!;
    expect(way.tonnes).toBeGreaterThanOrEqual(12);
    expect(way.waitingAt[0]).toBe(via);
  }, 60_000);

  test("on a map without a works, imported steel follows the towns as they grow", () => {
    const w = game();
    const before = steelImports(w);
    for (const t of w.towns.values()) if (!t.industry) t.population *= 2;
    expect(steelImports(w)).toBeCloseTo(before * 2, 6);
    const old = game({ steelImportsFollowTowns: undefined as unknown as boolean });
    const was = steelImports(old);
    for (const t of old.towns.values()) if (!t.industry) t.population *= 2;
    expect(steelImports(old)).toBeCloseTo(was, 6);
  }, 60_000);
});

describe("stations on the old line (stations.ts; brief, Revision 5, Stations on the old line)", () => {
  // Seed 1 is a South-West region whose old line passes a town, towns further off, and empty land.
  const game = (tuning: Partial<typeof DEFAULT_GAME_TUNING> = {}) => startGame(gameMap(GAME_MAP, 1, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 0, ...tuning });
  const rail = (w: GameWorld) => w.simulation.map.segments.filter((s) => s.type === "rail");
  const lineEnds = (w: GameWorld) => {
    const degree = new Map<string, number>();
    for (const s of rail(w)) for (const n of [s.fromNodeId, s.toNodeId]) degree.set(n, (degree.get(n) ?? 0) + 1);
    return [...degree].filter(([, d]) => d === 1).map(([id]) => id);
  };

  test("the old line comes with its stations: at a town, out of one with a road to it, or at a town that's gone", () => {
    const w = game();
    const stations = [...w.stations!];
    expect(stations.length).toBeGreaterThanOrEqual(3);
    const kinds = new Set(stations.map(([, s]) => s.kind));
    expect(kinds.has("out")).toBe(true);
    for (const [id, s] of stations) {
      // Every station is a stop on the line.
      expect(rail(w).some((piece) => piece.fromNodeId === id || piece.toNodeId === id)).toBe(true);
      if (s.kind === "out") {
        expect(w.towns.get(id)!.name).toBe(`${w.towns.get(s.serves)!.name} Road`);
        expect(w.simulation.map.segments.some((r) => r.type === "road" && (r.fromNodeId === id || r.toNodeId === id))).toBe(true);
      }
      if (s.kind === "gone") expect(w.ruins.has(s.serves)).toBe(true);
      if (s.kind !== "town") expect(w.towns.get(id)!.population).toBe(0);
    }
    // All of it out of service, as the line was.
    expect(rail(w).every((piece) => w.railOutOfService.has(piece.id))).toBe(true);
  }, 60_000);

  test("restoring the old line end to end reopens every stretch and station on it, at its whole length's price", () => {
    const w = game({ startingFunds: 1e7 });
    const [a, b] = lineEnds(w);
    const run = derelictRun(w, a!, b!)!;
    expect(run.length).toBe(rail(w).length);
    expect(restoreCost(w, a!, b!)).toBeCloseTo(run.reduce((sum, p) => sum + segmentLength(w, p), 0) * w.tuning.railRestoreCostPerCell, 0);
    expect(applyAction(w, { kind: "track", a: a!, b: b!, alignment: "cheapest" }).ok).toBe(true);
    expect(rail(w).every((piece) => !w.railOutOfService.has(piece.id))).toBe(true);
    for (const id of w.stations!.keys()) expect(stationOpen(w, id)).toBe(true);
    expect(railPath(w, a!, b!)!.nodeIds.length).toBe(run.length + 1);
  }, 60_000);

  test("a run file without railStations has the line as it was: one piece, no stations", () => {
    const old = game({ railStations: undefined as unknown as boolean });
    expect(old.stations).toBeUndefined();
    expect(rail(old).length).toBeLessThanOrEqual(2);
  }, 60_000);

  test("where riders change trains a station grows a town, and fades back to the station, not off the line", () => {
    const w = game({ startingFunds: 1e7 });
    const [id, info] = [...w.stations!].find(([, s]) => s.kind !== "town")!;
    const [a, b] = lineEnds(w);
    expect(applyAction(w, { kind: "track", a: a!, b: b!, alignment: "cheapest" }).ok).toBe(true);
    expect(applyAction(w, { kind: "train", a: a!, b: b! }).ok).toBe(true);
    w.transferRateEMA.set(id, (w.tuning.stationTownRiders! * 2) / SECONDS_PER_GAME_DAY);
    w.settlement.lastFoundedAtSeconds = -Infinity;
    const founded = foundStationTowns(w);
    expect(founded?.kind === "founded" && founded.townId).toBe(id);
    expect(w.towns.get(id)!.industry).toBeUndefined();
    expect(w.towns.get(id)!.population).toBeGreaterThan(0);
    if (info.kind === "gone") expect(w.ruins.has(info.serves)).toBe(false);
    expect(backToStation(w, id)).toBe(true);
    expect(w.towns.get(id)!.industry).toBe("station");
    expect(rail(w).some((piece) => piece.fromNodeId === id || piece.toNodeId === id)).toBe(true);
    if (info.kind === "gone") expect(w.ruins.has(info.serves)).toBe(true);
  }, 60_000);
});

describe("the correspondent (src/game/correspondent.ts; brief, Revision 5, step 4 rebuilt)", () => {
  const game = (seed: number) => startGame(gameMap(GAME_MAP, seed, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
  const kinds = ["connect", "cement", "fuel", "seats", "service", "grow", "reach"];
  /** A term record that fires every clause he has: each kind kept and missed, the union, the rains, paved road. */
  const everything = (w: GameWorld, number: number): TermRecord => {
    const towns = [...w.towns.values()].filter((t) => !t.industry).map((t) => t.id);
    const now = w.economy.elapsedSeconds;
    const union = w.unions?.[0];
    if (union) union.memory.push({ day: gameDay(w), text: "you saw to his members (₦8,000)", delta: 0.2 }, { day: gameDay(w), text: `you refused him on ${w.towns.get(towns[0]!)!.name}–${w.towns.get(towns[1]!)!.name}`, delta: -0.3 });
    const ford = w.floods?.fords[0];
    if (ford && w.floods) (w.floods.risen ??= []).push({ atSeconds: now, under: [ford.id], bridged: w.floods.fords[1] ? [w.floods.fords[1].id] : [] });
    return {
      number, kept: kinds.map((k) => k), missed: kinds.map((k) => k), peopleFrom: 500, peopleTo: 520, failed: false, grant: 40_000,
      keptKeys: kinds.map((k, i) => `${k}:${towns[i % towns.length]}`), missedKeys: kinds.map((k, i) => `${k}:${towns[(i + 3) % towns.length]}`),
      towns: towns.map((id) => ({ id, from: 20, to: 31 })), fromSeconds: now - 1, toSeconds: now + 1, pavedCells: 400,
    };
  };

  test("C32, not a tutorial: nothing he can write names a key, a control, a screen or a price, or tells you what to do", () => {
    // The check itself catches what it must, and lets the world's own nouns through.
    expect(notATutorial("Press R to pave the road")).not.toBeNull();
    expect(notATutorial("Build a yard at Ede (Y).")).not.toBeNull();
    expect(notATutorial("The bridge cost ₦1,200 a cell.")).not.toBeNull();
    expect(notATutorial("Click the Track tool.")).not.toBeNull();
    expect(notATutorial("You have the roads, the track and the buses.")).toBeNull();
    for (const seed of [1, 4, 77, 2418, 543]) {
      const w = game(seed);
      const letters = [handoverNote(w), termLetter(w, everything(w, 1))];
      // His every stance.
      w.term!.history = [everything(w, 1), everything(w, 2)];
      letters.push(termLetter(w, everything(w, 3)));
      w.term!.history = [{ ...everything(w, 1), failed: true }];
      letters.push(termLetter(w, everything(w, 2)));
      w.term!.history = [{ ...everything(w, 1), failed: true }, { ...everything(w, 2), failed: true }];
      w.term!.replacedAtSeconds = w.economy.elapsedSeconds;
      letters.push(termLetter(w, w.term!.history[1]!));
      for (const letter of letters) for (const p of letter.paragraphs) expect([p, notATutorial(p)]).toEqual([p, null]);
    }
  }, 120_000);

  test("C34, the handover reads true on any seed: the line's real ends and stations, the real fords and chairman", () => {
    for (const seed of [1, 2, 3, 4, 5, 77, 543, 949, 2418, 4882]) {
      const w = game(seed);
      const note = handoverNote(w);
      expect(note.paragraphs.length).toBe(3);
      expect(note.paragraphs.join(" ").length).toBeLessThan(1400);
      const text = note.paragraphs[0]!;
      const rail = w.simulation.map.segments.filter((s) => s.type === "rail");
      if (rail.length > 0) {
        // The two real ends of one of its old lines (the longest, where there's more than one), named.
        const lines = new Map<string, Map<string, number>>();
        for (const s of rail) {
          const line = s.id.match(/^inherited-rail-\d+/)?.[0] ?? s.id;
          const degree = lines.get(line) ?? new Map<string, number>();
          for (const n of [s.fromNodeId, s.toNodeId]) degree.set(n, (degree.get(n) ?? 0) + 1);
          lines.set(line, degree);
        }
        const named = [...lines.values()].some((degree) => [...degree].filter(([, d]) => d === 1).every(([end]) => text.includes(w.towns.get(end)!.name)));
        expect(named).toBe(true);
      }
      const gone = [...(w.stations?.values() ?? [])].filter((s) => s.kind === "gone").length;
      if (gone > 0) expect(text).toMatch(/serves? (?:a town|towns) that (?:is|are) no longer there/);
      else expect(text).not.toContain("no longer there");
      if ((w.floods?.fords.length ?? 0) > 0) expect(text).toContain("they ford it");
      if (w.unions?.length) expect(text).toContain((w.unions.find((u) => u.id === "home") ?? w.unions[0]!).chairman);
      // Every town he names is on this map.
      const names = new Set([...w.towns.values(), ...w.ruins.values()].map((t) => t.name));
      for (const p of note.paragraphs) for (const m of p.matchAll(/\b(?:between|from|to|at|in) ([A-Z][a-z']*(?:[ -][A-Z][a-z']*)*)/g)) {
        if (["The", "Ministry", "Transportation"].includes(m[1]!)) continue;
        expect([m[1], names.has(m[1]!) || /^(Cement|Refinery)/.test(m[1]!)]).toEqual([m[1], true]);
      }
      expect(note.paragraphs[2]).toContain(`I have written ${["three", "four", "five", "six"][predecessors(w) - 3]} of these`);
    }
  }, 120_000);

  test("C33, every letter says something, and at most three things; a term with nothing pledged still gets one", () => {
    const w = game(1);
    const full = termLetter(w, everything(w, 2)).paragraphs[0]!;
    expect(full.split(/(?<=\.) /).length).toBeLessThanOrEqual(1 + 3 * 3 + 1); // "Term n." + three clauses (each up to three sentences) + his stance
    const empty = termLetter(game(1), { number: 1, kept: [], missed: [], peopleFrom: 500, peopleTo: 512 }).paragraphs[0]!;
    expect(empty).toContain("The towns grew by 12,000 people");
    // His name and count come from the map: the same map, the same man.
    expect(correspondentName(game(1))).toBe(correspondentName(w));
  }, 60_000);
});

describe("the correspondent's stance, letter by letter", () => {
  test("a term's letter is written as things stood at its end: a good term 1 isn't doubted for a failed term 2", () => {
    const w = startGame(gameMap(GAME_MAP, 1, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
    const good: TermRecord = { number: 1, kept: ["a"], missed: [], peopleFrom: 500, peopleTo: 520, failed: false, grant: 1 };
    const bad: TermRecord = { number: 2, kept: [], missed: ["b"], peopleFrom: 520, peopleTo: 510, failed: true, grant: 1 };
    w.term!.history = [good, bad];
    expect(termLetter(w, good).paragraphs[0]).not.toContain("The state has noticed");
    expect(termLetter(w, bad).paragraphs[0]).toContain("The state has noticed");
  }, 60_000);
});

describe("then and now (src/game/thenandnow.ts; brief, Revision 5, step 4 rebuilt)", () => {
  test("day 1 faint under today: every inherited road as found, what you built over it, each town's day-1 ring, the letter's places pinned", () => {
    const w = startGame(gameMap(GAME_MAP, 4, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 0, startingFunds: 1e7 });
    const towns = [...w.towns.values()].filter((t) => !t.industry);
    const before = thenAndNowSvg(w, []);
    const inherited = w.simulation.map.segments.filter((s) => s.type === "road" && s.provenance === "inherited" && s.retiredAt === undefined).length;
    expect((before.match(/class="tn-then"/g) ?? []).length).toBe(inherited);
    expect((before.match(/class="tn-built"|class="tn-paved"/g) ?? []).length).toBe(0);
    expect(applyAction(w, { kind: "road", a: towns[0]!.id, b: towns[5]!.id, alignment: "cheapest" }).ok).toBe(true);
    const after = thenAndNowSvg(w, [towns[0]!.id]);
    expect((after.match(/class="tn-built"/g) ?? []).length).toBeGreaterThan(0);
    expect((after.match(/class="tn-was/g) ?? []).length).toBe(towns.filter((t) => w.startPopulation.has(t.id)).length);
    expect(after).toContain(`>${towns[0]!.name}</text>`);
  }, 60_000);
});

describe("the corridor (src/game/corridor.ts; look.md, Corridor encoding and geometry)", () => {
  const dist = (p: { x: number; y: number }, line: Array<{ x: number; y: number }>) => {
    let best = Infinity;
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1]!, b = line[i]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
    }
    return best;
  };
  /** The worst relative error, sampled densely along an offset line, of its distance from the source. */
  const worst = (offset: Array<{ x: number; y: number }>, source: Array<{ x: number; y: number }>, d: number) => {
    let err = 0;
    for (let i = 1; i < offset.length; i += 1) for (let k = 0; k <= 50; k += 1) {
      const a = offset[i - 1]!, b = offset[i]!;
      err = Math.max(err, Math.abs(dist({ x: a.x + (b.x - a.x) * (k / 50), y: a.y + (b.y - a.y) * (k / 50) }, source) - Math.abs(d)) / Math.abs(d));
    }
    return err;
  };
  // The offset as it was drawn (render.ts strokeOffset before 2026-10-30): central differences, no mitre.
  const centralDifference = (line: Array<{ x: number; y: number }>, d: number) => line.map((p, i) => {
    const a = line[Math.max(0, i - 1)]!, b = line[Math.min(line.length - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: p.x - ((b.y - a.y) / len) * d, y: p.y + ((b.x - a.x) / len) * d };
  });

  test("an offset through a right-angled bend stays within 1% of its distance; central differences pinched it", () => {
    const bend = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(worst(offsetPolyline(bend, 1), bend, 1)).toBeLessThan(0.01);
    expect(worst(centralDifference(bend, 1), bend, 1)).toBeGreaterThan(0.01); // the bug it fixes
  });

  test("a hairpin's offset reaches no further than the mitre limit", () => {
    const hairpin = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0.4 }];
    const [, corner] = offsetPolyline(hairpin, 1);
    expect(Math.hypot(corner!.x - 10, corner!.y - 0)).toBeLessThanOrEqual(MITER_LIMIT * 1 + 1e-9);
  });

  test("the congestion ramp rises with load and never jumps, free to jammed, with headroom past 150%", () => {
    const rank = { free: 0, busy: 1, jammed: 2 } as const;
    const level = (load: number) => { const s = congestionStop(load); return rank[s.from] + (rank[s.to] - rank[s.from]) * s.t; };
    let last = level(0);
    for (let load = 0.001; load <= 3; load += 0.001) {
      const now = level(load);
      expect(now).toBeGreaterThanOrEqual(last - 1e-9);
      expect(now - last).toBeLessThan(0.01);
      last = now;
    }
    expect(level(0.4)).toBe(0);
    expect(level(0.9)).toBe(1);
    expect(level(1.6)).toBe(2);
    expect(overloaded(1.2)).toBe(false);
    expect(overloaded(4)).toBe(true);
    // A road crawling reads jammed whatever its load.
    expect(congestionStop(0.2, 0.5).from).toBe("jammed");
  });

  test("segmentRung agrees with the three expressions it replaced, on five maps", () => {
    for (const seed of [1, 4, 77, 949, 2418]) {
      const w = startGame(gameMap(GAME_MAP, seed, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
      for (const s of w.simulation.map.segments) {
        const was = s.type === "rail" ? "rail" : s.busLane ? "lane" : isDirtRoad(s) ? "dirt" : "paved";
        expect(segmentRung(s)).toBe(was);
        if (s.type === "road") expect(segmentRung(s)).toBe(s.busLane ? "lane" : isDirtRoad(s) ? "dirt" : "paved");
      }
    }
  }, 120_000);

  test("every node where two or more live pieces meet gets exactly one plate, as wide as the widest of them", () => {
    const width = (s: Segment) => ({ dirt: 3, paved: 5, lane: 7, rail: 4 })[segmentRung(s)];
    for (const seed of [1, 4, 77, 949, 2418]) {
      const w = startGame(gameMap(GAME_MAP, seed, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
      const live = (s: Segment) => s.retiredAt === undefined;
      const plates = junctionPlates(w, live, width);
      const at = new Map<string, Segment[]>();
      for (const s of w.simulation.map.segments.filter(live)) for (const n of [s.fromNodeId, s.toNodeId]) at.set(n, [...(at.get(n) ?? []), s]);
      const junctions = [...at].filter(([, pieces]) => pieces.length >= 2);
      expect(plates.length).toBe(junctions.length);
      expect(new Set(plates.map((p) => p.node)).size).toBe(plates.length);
      for (const [node, pieces] of junctions) {
        const plate = plates.find((p) => p.node === node)!;
        expect(plate.radius).toBeGreaterThanOrEqual(Math.max(...pieces.map(width)) / 2);
      }
    }
  }, 120_000);
});

describe("frame budgets don't change the game (principles.md §3: derive from elapsed time, never accumulate per frame)", () => {
  // The page runs the simulation a different number of ticks a frame as it can, and between frames
  // reads it for the panels, the cards, the map, the yard preview and the letters -- some of which
  // fill caches on the world, and the yard preview adds a yard for a moment. None of that may change
  // what happens: a run file replays only if the game is the same however it was watched.
  const snapshot = (w: GameWorld) => JSON.stringify({
    t: w.economy.elapsedSeconds,
    funds: Math.round(w.economy.funds * 1000),
    towns: [...w.towns.values()].map((t) => [t.id, Math.round(t.population * 1e6)]),
    vehicles: w.simulation.vehicles.map((v) => [v.id, v.pathIndex, Math.round(v.edgeProgress * 1e6)]),
    trucks: [...w.truckers].map(([k, a]) => [k, Math.round(a * 1000)]),
    yards: [...w.yards],
    budget: Object.entries(w.budget).map(([k, v]) => [k, Math.round(Number(v) * 1000)]),
  });
  const read = (w: GameWorld) => {
    routeSummaries(w);
    corridorSummaries(w);
    averageHeadline(w);
    for (const t of w.towns.values()) {
      townGrowth(w, t.id);
      roadFull(w, t.id);
      townNoSeat(w, t.id);
      tripsFrom(w, t.id);
      goodsOnTheWay(w, t.id);
    }
    if (w.cement) {
      cementBreak(w);
      for (const t of [...w.towns.values()].slice(0, 6)) haulBreak(w, w.cement.worksId, t.id);
    }
    for (const t of [...w.towns.values()].slice(0, 4)) yardWouldBring(w, t.id);
    handoverNote(w);
    for (const p of w.term?.pledges ?? []) pledgeMove(w, p);
    junctionPlates(w, (s) => s.retiredAt === undefined, () => 4);
  };

  test("the same seed, ticked straight through or in uneven frames with the screen read between, ends the same", () => {
    const start = () => {
      const w = startGame(gameMap(GAME_MAP, 949, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 1 });
      const towns = [...w.towns.values()].filter((t) => !t.industry).sort((p, q) => q.population - p.population);
      applyAction(w, { kind: "bus", a: towns[0]!.id, b: towns[1]!.id });
      return w;
    };
    const ticks = 3 * SECONDS_PER_GAME_DAY * 30;
    const straight = start();
    for (let i = 0; i < ticks; i += 1) gameTick(straight, SIM_DT);
    const watched = start();
    const frames = [1, 7, 2, 30, 3, 61, 5];
    for (let i = 0, f = 0; i < ticks; f += 1) {
      for (let k = 0; k < frames[f % frames.length]! && i < ticks; k += 1, i += 1) gameTick(watched, SIM_DT);
      if (f % 9 === 0) read(watched);
    }
    expect(snapshot(watched)).toBe(snapshot(straight));
  }, 300_000);

  test("the screen reading the world just before an action doesn't change what the next tick does (epoch.ts; map 3218, day 433)", () => {
    // Map 1's seaport is a coast town up a dirt highway: imports reach the home city by how much of
    // it is paved (gateways.ts seaportLink), worked out once a tick. Keyed on the clock alone, the
    // screen's read between ticks was what the next tick used -- paved in between or not -- and a
    // live game parted from its replay by ₦1 on day 40.
    const start = () => startGame(gameMap(GAME_MAP, 1, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 1, startingFunds: 1e6 });
    const probe = start();
    const legs = roadPath(probe, probe.port!, probe.seaport!)!.nodeIds;
    expect(seaportLink(probe).by).toBe("road");
    const day = SECONDS_PER_GAME_DAY * 30;
    const paveAt = new Map(legs.slice(1).map((b, k) => [(k + 1) * Math.round(day / 3), { kind: "pave" as const, a: legs[k]!, b }]));
    const ticks = (legs.length + 1) * Math.round(day / 3);
    const play = (watch: boolean) => {
      const w = start();
      for (let i = 0; i < ticks; i += 1) {
        const pave = paveAt.get(i);
        if (watch && (pave || i % 13 === 0)) {
          read(w);
          const flows = goodsFlows(w);
          for (const t of w.towns.values()) {
            if (t.industry) siteChain(w, t.id, flows);
            else fuelSupply(w, t.id);
          }
          seaportLink(w);
        }
        if (pave) applyAction(w, pave);
        gameTick(w, SIM_DT);
      }
      return w;
    };
    const watched = play(true);
    expect(seaportLink(watched).paved).toBeGreaterThan(0.5);
    expect(snapshot(watched)).toBe(snapshot(play(false)));
  }, 300_000);
});

describe("map density (src/game/density.ts; look.md, Map density)", () => {
  const box = (x: number, y: number, w = 40, h = 18) => ({ x0: x, y0: y, x1: x + w, y1: y + h });

  test("the placer: the higher priority wins wherever it was claimed, and the loser isn't placed", () => {
    for (const order of [["road", "strike"], ["strike", "road"]]) {
      const p = new Placer();
      for (const id of order) p.claim({ id, kind: id, priority: id === "strike" ? PRIORITY.event : PRIORITY.roadName, box: box(100, 100), at: { x: 100, y: 100 } });
      const { placed } = p.resolve();
      expect(placed.has("strike")).toBe(true);
      expect(placed.has("road")).toBe(false);
    }
    // Clear of each other, both are placed.
    const p = new Placer();
    p.claim({ id: "a", kind: "townName", priority: PRIORITY.townName, box: box(0, 0), at: { x: 0, y: 0 } });
    p.claim({ id: "b", kind: "townName", priority: PRIORITY.townName, box: box(200, 0), at: { x: 200, y: 0 } });
    expect([...p.resolve().placed].sort()).toEqual(["a", "b"]);
  });

  test("five TAKEN tags in one place are one chip reading 5, and none of them alone", () => {
    const p = new Placer();
    for (let k = 0; k < 5; k += 1) p.claim({ id: `taken:${k}`, kind: "taken", priority: PRIORITY.taken, box: box(100 + k * 6, 100 + k * 4), at: { x: 100 + k * 6, y: 100 + k * 4 } });
    const { placed, chips } = p.resolve([{ kind: "taken", radius: 40, min: 3, chipBox: (at) => box(at.x, at.y) }]);
    expect(chips.length).toBe(1);
    expect(chips[0]!.count).toBe(5);
    for (let k = 0; k < 5; k += 1) expect(placed.has(`taken:${k}`)).toBe(false);
    // Two aren't a crowd.
    const q = new Placer();
    for (let k = 0; k < 2; k += 1) q.claim({ id: `taken:${k}`, kind: "taken", priority: PRIORITY.taken, box: box(100 + k * 60, 100), at: { x: 100 + k * 60, y: 100 } });
    expect(q.resolve([{ kind: "taken", radius: 40, min: 3, chipBox: (at) => box(at.x, at.y) }]).chips.length).toBe(0);
  });

  test("the tiers: zoomed out no site, road or crossing names, ruins or vehicles one by one; zoomed in all of them", () => {
    const detail = ["siteName", "roadName", "ruin", "vehiclesOneByOne", "wardens"] as const;
    expect(tierOf(1)).toBe("far");
    expect(tierOf(3)).toBe("near");
    for (const layer of detail) {
      expect(drawsAt(tierOf(1), layer)).toBe(false);
      expect(drawsAt(tierOf(3), layer)).toBe(true);
    }
    // Events, towns' marks and names, at every tier.
    for (const layer of ["event", "townMark", "townName"] as const) expect(drawsAt("far", layer)).toBe(true);
  });

  test("what you've selected, or what's waiting on you, draws its name at any tier", () => {
    expect(drawsAt("far", "siteName", true)).toBe(true);
    expect(drawsAt("far", "siteName", false)).toBe(false);
  });

  test("a change of hands is a few days' news: a TAKEN tag ages off the map", () => {
    const w = startGame(gameMap(GAME_MAP, 1, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
    const [c] = [...w.corridors.values()];
    if (!c) return;
    c.change = "taken";
    c.changedAt = w.economy.elapsedSeconds - (CORRIDOR_TAG_DAYS - 1) * SECONDS_PER_GAME_DAY;
    expect(corridorChanges(w).length).toBeGreaterThan(0);
    c.changedAt = w.economy.elapsedSeconds - (CORRIDOR_TAG_DAYS + 1) * SECONDS_PER_GAME_DAY;
    expect(corridorChanges(w).length).toBe(0);
  }, 60_000);

  test("the signal budget passes on the real map, and fails on a pass that reaches a seventh group", () => {
    const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8");
    const [render, icons, look] = [read("src/game/render.ts"), read("src/game/icons.ts"), read("docs/architecture/look.md")];
    expect(checkSignalBudget(render, icons, look).failures).toEqual([]);
    // A seventh group: a token the budget doesn't place, used on the base map...
    const louder = render.replace("export const COLORS = {", 'export const COLORS = {\n  extra: token("--route-3"),') + "\nfunction drawExtra() { ctx.fillStyle = COLORS.extra; }\n";
    const lookWithRoutes = look.replace("| the chains |", "| routes | `--route-3` |\n| the chains |");
    expect(checkSignalBudget(louder, icons, lookWithRoutes).failures.join(" ")).toContain("signal groups");
    // ...and one in no group at all.
    const stray = look.replace("`--trade` `--s3`", "`--s3`");
    const strayRender = render + "\nfunction drawStray() { ctx.fillStyle = COLORS.player; drawSiteIcon(); }\n";
    expect(checkSignalBudget(strayRender, icons, stray).failures.join(" ")).toContain("--trade");
  });
});

describe("the assembly plant (assembly.ts; brief, Chains: convergent)", () => {
  const game = (seed = 1, tuning: Partial<typeof DEFAULT_GAME_TUNING> = {}) => startGame(gameMap(GAME_MAP, seed, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 0, ...tuning });
  /** Steel and fuel arriving at the plant, as shares of what full output takes. */
  const feed = (w: GameWorld, steel: number, fuel: number) => {
    const plant = w.assembly!.siteId;
    const need = assemblyNeeds(w);
    w.goods.outcomes.set(goodsKey({ from: w.steel!.terminalId!, to: plant, kind: "supplies" }), { delivered: 0, spoiled: 0, arrived: need.steel * steel });
    w.goods.outcomes.set(goodsKey({ from: w.fuel!.depotId, to: plant, kind: "supplies" }), { delivered: 0, spoiled: 0, arrived: need.fuel * fuel });
    for (const from of [w.steel!.worksId, w.fuel!.refineryId]) if (from) w.goods.outcomes.delete(goodsKey({ from, to: plant, kind: "supplies" }));
  };

  test("short of one input it runs at that input's share, not the mean, and the reading names the short one", () => {
    const w = game();
    feed(w, 0.5, 1);
    const s = assemblyShare(w);
    expect(s.steel).toBeCloseTo(0.5, 6);
    expect(s.fuel).toBeCloseTo(1, 6);
    expect(s.share).toBeCloseTo(0.5 * staffFactor(w, w.assembly!.siteId), 6);
    const p = siteProduction(w, w.assembly!.siteId)!;
    expect(p.limit).toBe("input");
    expect(p.binding).toBe("steel");
  }, 60_000);

  test("short of both, the reading names the lower", () => {
    const w = game();
    feed(w, 0.6, 0.3);
    expect(siteProduction(w, w.assembly!.siteId)!.binding).toBe("fuel");
    feed(w, 0.2, 0.7);
    expect(siteProduction(w, w.assembly!.siteId)!.binding).toBe("steel");
  }, 60_000);

  test("its steel comes two ways, the port's and the works', so with the works idle the port's still feeds it", () => {
    const w = game(4); // a South-South map: a works and the terminal
    const plant = w.assembly!.siteId;
    const fromPort = () => steelFlows(w).filter((f) => f.from === w.steel!.terminalId && f.to === plant).reduce((s, f) => s + f.rate, 0);
    expect(w.steel!.working).toBe(false); // the works idle, as every game starts
    expect(fromPort()).toBeGreaterThan(0);
  }, 60_000);

  test("the discount deepens with each generation while it runs, and fades when it's starved", () => {
    const w = game();
    const D = SECONDS_PER_GAME_DAY;
    const list = w.tuning.busPurchaseCost;
    feed(w, 1, 1);
    const per = w.tuning.assemblyDiscountPerGeneration!;
    let last = 0;
    for (let day = 0; day < 120; day += 1) updateAssembly(w, D);
    expect(assemblyGeneration(w)).toBeGreaterThanOrEqual(2);
    expect(w.assembly!.discount).toBeGreaterThan(per * 2 * staffFactor(w, w.assembly!.siteId) * 0.9);
    expect(vehiclePrice(w, "bus")).toBeLessThan(list);
    last = w.assembly!.discount;
    feed(w, 0, 1);
    for (let day = 0; day < 30; day += 1) updateAssembly(w, D);
    expect(w.assembly!.discount).toBeLessThan(last * 0.05);
    expect(vehiclePrice(w, "train")).toBe(w.tuning.trainPurchaseCost); // buses and minibuses only
  }, 60_000);

  test("a run file without assemblyPlant has no plant, and pays list prices", () => {
    const old = game(1, { assemblyPlant: undefined as unknown as boolean });
    expect(old.assembly).toBeUndefined();
    expect(vehiclePrice(old, "bus")).toBe(old.tuning.busPurchaseCost);
  }, 60_000);
});

describe("the chain strip (production.ts siteChain; brief, Chains: convergent)", () => {
  const game = (seed = 1) => startGame(gameMap(GAME_MAP, seed, { regionEnabled: true }), { ...DEFAULT_GAME_TUNING, warmUpDays: 0 });
  const broken = (c: NonNullable<ReturnType<typeof siteChain>>) => [...c.inputs, c.output].filter((l) => l.broken);

  test("the plant's fork marks its short arm, and only that", () => {
    const w = game();
    const plant = w.assembly!.siteId;
    const need = assemblyNeeds(w);
    for (const [from, share, n] of [[w.steel!.terminalId!, 0.3, need.steel], [w.fuel!.depotId, 1, need.fuel]] as const) w.goods.outcomes.set(goodsKey({ from, to: plant, kind: "supplies" }), { delivered: 0, spoiled: 0, arrived: n * share });
    const c = siteChain(w, plant)!;
    expect(c.inputs.map((i) => i.name)).toEqual(["steel", "fuel"]);
    expect(broken(c).map((l) => l.name)).toEqual(["steel"]);
    expect(c.inputs.find((i) => i.name === "steel")!.places).toContain(w.steel!.terminalId!);
  }, 60_000);

  test("a linear chain short of its one input marks exactly that link", () => {
    for (const seed of [1, 4, 77, 949, 2418]) {
      const w = game(seed);
      if (!w.cement?.working) continue;
      for (const key of [...w.goods.outcomes.keys()]) if (key.split(":")[1] === w.cement.worksId) w.goods.outcomes.set(key, { delivered: 0, spoiled: 0, trucked: 0, arrived: 0 });
      const c = siteChain(w, w.cement.worksId)!;
      expect(broken(c).map((l) => l.name)).toEqual(["limestone"]);
      return;
    }
    throw new Error("no seed with a working cement works");
  }, 120_000);

  test("no site's chain ever marks more than one link", () => {
    const w = game(3218);
    for (let i = 0; i < 20 * SECONDS_PER_GAME_DAY * 30; i += 1) gameTick(w, SIM_DT);
    for (const site of [...w.towns.values()].filter((t) => t.industry)) {
      const c = siteChain(w, site.id);
      if (c) expect(broken(c).length).toBeLessThanOrEqual(1);
    }
  }, 300_000);
});
