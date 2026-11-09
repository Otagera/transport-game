import type { ActionSpec } from "@engine/game/actions";
import type { GameWorld } from "@engine/game/types";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";
import { headline } from "@engine/game/world";
import { cementServed } from "@engine/game/cement";
import { steelServed } from "@engine/game/steel";
import { fuelSupply } from "@engine/game/fuel";
import { marketFed, marketTowns } from "@engine/game/food";
import { goodsFlows } from "@engine/game/goods";

// The systems graph (docs/brief.md, Dev tools, step 5): the model as a chain -- what a tuning
// number enters, what that feeds, and the measures it moves -- read from the same what-if as the
// map graph, each measured node with its value without and with. Hand-kept: what feeds what is
// written here, not derived from the engine, so it can drift. D5 holds it to the tuning: every
// number in tuning.ts lands on a node (`keys`) or on NOT_DRAWN with its reason, and a test fails
// on one that lands nowhere.

export interface SystemNode {
  id: string;
  label: string;
  /** Where it's drawn: columns run cause to outcome, rows within a column. */
  col: number;
  row: number;
  /** What it feeds. */
  feeds: string[];
  /** The tuning numbers that enter the model here (the first node whose pattern matches). */
  keys?: RegExp[];
  /** Read from a world at the what-if's last day, and how to show it. */
  measure?: (world: GameWorld) => number;
  unit?: "k" | "/day" | "t/day" | "%" | "₦" | "speed";
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const towns = (world: GameWorld) => [...world.basePopulation.keys()].filter((id) => world.towns.has(id));
/** A measure that can't be read on this map (a chain it doesn't have) reads 0, not a throw. */
const safe = (f: (world: GameWorld) => number) => (world: GameWorld) => {
  try {
    const x = f(world);
    return Number.isFinite(x) ? x : 0;
  } catch {
    return 0;
  }
};

export const SYSTEM_NODES: SystemNode[] = [
  // Causes. A vehicle's capacity is its carrier's (below): roads take only what's about the road.
  {
    id: "demand", label: "Trips wanted", col: 1, row: 0, feeds: ["service", "informal", "noSeat"], unit: "/day",
    keys: [/^airport/, /^demandK$/, /^commute/, /^localTrips/, /^market/, /^priceElasticity$/, /^railInducedDemand$/, /^populationPerFlow$/, /^flowTau/, /^outcomeTau/, /^patience/, /^walkable/, /^produce/, /^cashCrop/, /^gateTown/, /^growthIgnoresCommutes$/],
    measure: safe((w) => { const h = headline(w); return h.tripsPerDay + h.noSeatPerDay + h.noRoadPerDay; }),
  },
  {
    id: "roads", label: "Road speed", col: 1, row: 2, feeds: ["service", "informal", "hauliers"], unit: "speed",
    keys: [/^congestion$/, /^dirtRoadCapacity$/, /^laneGeneralCapacity$/, /^roadFlowCapacity$/, /RoadSpace/, /^minSpeedFactor$/, /^wear/, /WearMultiplier$/, /^inheritedRoadCondition$/, /^flood/, /^ford/, /^causeways/, /^private/, /^trucksFreeOfDanfoBudget$/, /^tollPerRoad$/, /^roughRoad/, /^encroachment/, /^weatherPerSecond$/],
    measure: safe((w) => mean(w.simulation.map.segments.filter((s) => s.type === "road").map((s) => w.segmentSpeed.get(s.id) ?? 1))),
  },
  {
    id: "supplies", label: "Sites making goods", col: 1, row: 4, feeds: ["hauliers"], unit: "t/day",
    keys: [/^cement/, /^steel/, /^coal/, /^power/, /^pipe/, /^airFreight/, /^fuel/, /^refinery/, /^crude/, /^works/, /^mine/, /^ore/, /^limestone/, /^quarry/, /^newRefinery/, /^flour/, /^food/, /^mill/, /^wheat/, /^staple/, /^farm/, /^field/, /^industr/, /^expand/, /^assembly/, /^jobs/, /^staff/, /^workers/, /^peoplePerJob$/, /^stone/, /^ridgeField/, /^supplies/, /^tanker/, /^textile/, /^cloth/, /^cotton/],
    measure: safe((w) => goodsFlows(w).reduce((t, f) => t + f.rate * D, 0)),
  },
  {
    id: "budget", label: "Budget and upkeep", col: 1, row: 6, feeds: ["money"],
    keys: [/^allocation/, /^remittance/, /^sweep/, /^bond/, /^term/, /^mandate/, /^startingFunds$/, /^repairCost/, /^routineUpkeep/, /^roadCostPerCell$/, /^railCostPerCell$/, /^railRestoreCost/, /^railGradient/, /^projectLapse/, /^retireGone/, /Cost$/, /^pledges/],
  },
  // Who carries
  {
    id: "service", label: "Your vehicles", col: 2, row: 0, feeds: ["noSeat", "growth", "money"], unit: "/day",
    keys: [/^bus/, /^minibus/, /^brt/, /^train/, /^metro/, /^cityLine/, /^inside/, /^fare/, /^halt/, /^station/, /^lane/, /^oldLine/, /^track/, /^rail/, /^carriage/, /^growthCapLaneShare$/, /^boats/, /^jetty/, /^waterBus/],
    measure: safe((w) => headline(w).yourRidersPerDay),
  },
  {
    id: "informal", label: "Danfos and kekes", col: 2, row: 1, feeds: ["noSeat", "money"], unit: "/day",
    keys: [/^danfo/, /^keke/, /^okada/, /^informal/, /^trunk/, /^agbero/, /^levy/, /^park/, /^settlement/, /^strike/, /^union/, /^enforcement/, /^corridor/],
    measure: safe((w) => [...w.pairOutcomes.values()].reduce((t, r) => t + r.poached * D, 0)),
  },
  {
    id: "hauliers", label: "Hauliers and yards", col: 2, row: 3, feeds: ["cement", "fuel", "steel", "food", "money"], unit: "t/day",
    keys: [/^trucker/, /^truck/, /^yard/, /^goods/, /^partLoad/, /^lorry/, /^noPlayerLorries$/, /^freight/, /^relayLimestone$/, /^longHaulTail$/, /^wagon/, /^loadingLevy/, /^servedTau/, /^importsOver/, /^seaport/, /^port/, /^border/, /^export/, /^exports/, /^barge/, /^fish/, /^smoke/],
    measure: safe((w) => [...w.goods.outcomes.values()].reduce((t, o) => t + (o.delivered + (o.trucked ?? 0)) * D, 0)),
  },
  // What's served
  { id: "noSeat", label: "Left without a seat", col: 3, row: 0, feeds: ["growth"], unit: "/day", measure: safe((w) => headline(w).noSeatPerDay) },
  { id: "cement", label: "Cement served", col: 3, row: 2, feeds: ["growth"], unit: "%", measure: safe((w) => mean(towns(w).map((id) => cementServed(w, id)))) },
  { id: "fuel", label: "Fuel supplied", col: 3, row: 3, feeds: ["growth"], unit: "%", measure: safe((w) => mean(towns(w).map((id) => fuelSupply(w, id)?.supplied ?? 1))) },
  { id: "steel", label: "Steel served", col: 3, row: 4, feeds: ["growth"], unit: "%", measure: safe((w) => mean(towns(w).map((id) => steelServed(w, id)))) },
  { id: "food", label: "Markets fed", col: 3, row: 5, feeds: ["growth"], unit: "%", measure: safe((w) => mean(marketTowns(w).map((t) => marketFed(w, t.id)))) },
  // Outcomes
  {
    id: "growth", label: "Town growth", col: 4, row: 2, feeds: ["people"],
    keys: [/^growth/, /^town/, /^serviceExpect/, /^maxEmergent/, /^newTown/, /^minSecondsBetweenTowns$/, /^foundTown/, /^abandonBelow/],
  },
  { id: "money", label: "Your money", col: 4, row: 5, feeds: [], unit: "₦", measure: (w) => w.economy.funds },
  { id: "people", label: "People", col: 5, row: 2, feeds: [], unit: "k", measure: (w) => towns(w).reduce((t, id) => t + w.towns.get(id)!.population, 0) },
];

/** Numbers the graph doesn't draw, and why: none of them moves the simulation once a game is running. */
export const NOT_DRAWN: Array<{ keys: RegExp[]; why: string }> = [
  { keys: [/^mapVersion$/, /^regionEnabled$/, /^riverValleys$/, /^tautRoads$/, /^landlockedNorth$/, /^townSpacingCells$/, /^warmUpDays$/, /^straightAlignmentEnabled$/, /^crossingsEnabled$/], why: "the map's drawing and the start: read once, before you arrive" },
  { keys: [/^remitOpens$/, /^clusterOffersEnabled$/], why: "what you may build and what's offered, not what the world does" },
];

/** Where a tuning number enters the graph: a node's id, or why it isn't drawn. */
export function placeOf(key: string): { node: string } | { notDrawn: string } | null {
  for (const group of NOT_DRAWN) if (group.keys.some((re) => re.test(key))) return { notDrawn: group.why };
  for (const node of SYSTEM_NODES) if (node.keys?.some((re) => re.test(key))) return { node: node.id };
  return null;
}

/** The node a move enters by. */
export function moveNode(action: ActionSpec): string | null {
  switch (action.kind) {
    case "bus": case "minibus": case "brt": case "train": case "lane": case "metro": case "halt": case "busStation": case "jetty": case "boat":
      return "service";
    case "road": case "pave": case "fix": case "retire": case "restore": case "repair": case "bridgeFord": case "track":
      return "roads";
    case "yard": case "freight": case "freightRate": case "lorry": case "barge": case "smokehouse":
      return "hauliers";
    case "park": case "settle": case "enforce": case "union":
      return "informal";
    case "restoreWorks": case "restoreRefinery": case "restoreSteel": case "restorePower": case "expand":
      return "supplies";
    case "car":
      return action.routeId.startsWith("freight:") ? "hauliers" : "service";
    case "bond": case "sell": case "project":
      return "budget";
    case "console":
      return action.op === "tune" && action.key ? (() => { const p = placeOf(action.key); return p && "node" in p ? p.node : null; })() : action.op === "funds" ? "money" : null;
    default:
      return null;
  }
}

/** Everything downstream of a node, itself included: the chain a change there lights. */
export function chainFrom(id: string): Set<string> {
  const lit = new Set<string>();
  const visit = (at: string) => {
    if (lit.has(at)) return;
    lit.add(at);
    for (const next of SYSTEM_NODES.find((n) => n.id === at)?.feeds ?? []) visit(next);
  };
  visit(id);
  return lit;
}

/** Every measured node's value on a world: what the worker reads at a what-if's last day. */
export function measureSystems(world: GameWorld): Record<string, number> {
  const out: Record<string, number> = {};
  for (const node of SYSTEM_NODES) if (node.measure) out[node.id] = node.measure(world);
  return out;
}
