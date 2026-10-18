// Scripted bots for slice zero (docs/brief.md, Playtest protocol 1, and the
// measured checks M1-M9). Each persona plays 40 game days on the real
// sliceTick; the script prints the headline (trips made, stayed home split
// into no road and no seat, your riders) at days 10, 20 and 40, then runs
// the checks. Run it on every change; the first run, on the game as it was
// on 2026-10-17, is the baseline in docs/status.md.
//
//   bun scripts/slice-bots.ts                 # every persona, every check
//   BOTS=naive,idle bun scripts/slice-bots.ts # some personas (checks that need others are skipped)
//   CHECKS=0 bun scripts/slice-bots.ts        # personas only
//   SLICE_TUNING='{"fare":5}' ...             # tuning overrides, as in slice-probe.ts
//   BOTS_WORKERS=6 ...                        # forecast threads (default 2: runs cool, ~3x slower)
//
// Greedy forecasts every move it could afford, every day, in a worker pool:
// it's the slow one (a few minutes).
import { availableParallelism } from "node:os";
import { SLICE_MAP } from "../src/slice/map";
import { startSliceGame } from "../src/engine/slice/start";
import { addBus, buildRoad, chainOf, demandAlong, headline, routeSummaries, networkShare, paveRoad, roadChain, type Headline } from "../src/engine/slice/world";
import { sliceTick } from "../src/engine/slice/tick";
import { applyAction, type ActionSpec } from "../src/engine/slice/actions";
import { paveMoves, roadMoves, vehicleMoves, type PaveMove, type RoadMove, type VehicleMove } from "../src/engine/slice/moves";
import { lastDay } from "../src/engine/slice/ledger";
import { averageHeadline, averageNet } from "../src/engine/slice/history";
import { totalRoutineUpkeepPerDay } from "../src/engine/slice/upkeep";
import type { BudgetTally } from "../src/engine/slice/budget";
import { DEFAULT_SLICE_TUNING } from "../src/engine/slice/tuning";
import type { SliceWorld } from "../src/engine/slice/types";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY } from "../src/engine/economy/state";
import type { Trajectory } from "./slice-bots-worker";

const DAYS = 40;
const tuning = { ...DEFAULT_SLICE_TUNING, ...JSON.parse(process.env.SLICE_TUNING ?? "{}") };
// Every persona and twin starts from the same warmed-up world (start.ts):
// the game as the player meets it on day 1.
const started = startSliceGame(SLICE_MAP, tuning);
const newWorld = () => structuredClone(started);
const log = (message: string) => process.stderr.write(`  ${message}\n`);

function runDays(world: SliceWorld, days: number): void {
  const ticks = Math.round((days * SECONDS_PER_GAME_DAY) / SIM_DT);
  for (let i = 0; i < ticks; i += 1) sliceTick(world, SIM_DT);
}

const population = (world: SliceWorld) => [...world.towns.values()].reduce((sum, town) => sum + town.population, 0);

// --- Forecasts, in a worker pool ------------------------------------------

// Two worker threads by default: every core but one ran a laptop hot for
// half an hour. BOTS_WORKERS=6 for a faster run on a machine that can take it.
const workerCount = Math.max(1, Math.min(availableParallelism() - 1, Number(process.env.BOTS_WORKERS ?? 2)));
const workers = Array.from({ length: workerCount }, () => new Worker(new URL("./slice-bots-worker.ts", import.meta.url)));
let nextId = 0;
const waiting = new Map<number, (trajectory: Trajectory) => void>();
for (const worker of workers) {
  worker.onmessage = (event: MessageEvent<Trajectory>) => {
    waiting.get(event.data.id)?.(event.data);
    waiting.delete(event.data.id);
  };
}

/**
 * Forecast ₦/day of each action: the receipt the player would get two days
 * on (forecast.ts), against one shared do-nothing twin. Null if refused.
 */
async function forecastAll(world: SliceWorld, actions: ActionSpec[]): Promise<Array<number | null>> {
  const jobs = [null, ...actions].map((action, index) => {
    const id = nextId++;
    const job = new Promise<Trajectory>((resolve) => waiting.set(id, resolve));
    workers[index % workers.length]!.postMessage({ id, world, action });
    return job;
  });
  const [twin, ...moves] = await Promise.all(jobs);
  return moves.map((move) => {
    if (move.end === null || move.settled === null) return null;
    const days = move.measured / SECONDS_PER_GAME_DAY;
    return (move.end - twin!.end! - (move.settled - twin!.settled!)) / days;
  });
}

/**
 * Trips made a day each action adds, against one shared do-nothing twin:
 * the mean over days 6-10 after it. Danfos take days to find a new road:
 * measured over days 3-5, Kuto-Ikole read -7 trips a day; over days 6-10,
 * +16; by days 16-20, +15. Null if refused.
 */
async function tripsAdded(world: SliceWorld, actions: ActionSpec[]): Promise<Array<number | null>> {
  return tripsAddedOver(world, actions, 10, 5);
}

/** Trips made a day each action adds over `days`, averaged after skipping the first `skip`. */
async function tripsAddedOver(world: SliceWorld, actions: ActionSpec[], days: number, skip = 0): Promise<Array<number | null>> {
  return (await addedOver(world, actions, days, skip)).map((x) => (x ? x.trips : null));
}

/** Trips made and your riders a day each action adds over `days`, after skipping the first `skip`. */
async function addedOver(world: SliceWorld, actions: ActionSpec[], days: number, skip = 0): Promise<Array<{ trips: number; riders: number } | null>> {
  const jobs = [null, ...actions].map((action, index) => {
    const id = nextId++;
    const job = new Promise<Trajectory>((resolve) => waiting.set(id, resolve));
    workers[index % workers.length]!.postMessage({ id, world, action, tripDays: days });
    return job;
  });
  const [twin, ...moves] = await Promise.all(jobs);
  const mean = (xs: number[]) => xs.slice(skip).reduce((sum, x) => sum + x, 0) / (xs.length - skip);
  return moves.map((move) => (move.trips && move.riders ? { trips: mean(move.trips) - mean(twin!.trips!), riders: mean(move.riders) - mean(twin!.riders!) } : null));
}

interface RankedRoad extends RoadMove {
  tripsAdded: number;
  perNaira: number;
}

/**
 * Roads to cut-off towns, best trips unlocked per naira first. Measured,
 * not guessed: the cheapest road from a town can be one nobody would build
 * (Ikole-Ogbe reaches Ilase only the long way round). Ranked again when the
 * road network changes, or every ten days as towns grow.
 */
const roadRanks = new WeakMap<SliceWorld, { key: string; roads: RankedRoad[] }>();
async function rankedRoads(world: SliceWorld): Promise<RankedRoad[]> {
  const key = `${world.simulation.map.segments.length}|${Math.floor(world.economy.elapsedSeconds / (10 * SECONDS_PER_GAME_DAY))}`;
  const cached = roadRanks.get(world);
  if (cached?.key === key) return cached.roads;
  const moves = roadMoves(world);
  const funds = world.economy.funds;
  // Measured as if affordable: a road worth saving for is still worth knowing.
  const measuring = structuredClone(world);
  measuring.economy.funds = 1e9;
  const added = await tripsAdded(measuring, moves.map((m) => m.action));
  const roads = moves
    .map((move, i) => ({ ...move, tripsAdded: added[i] ?? 0, perNaira: (added[i] ?? 0) / move.price }))
    .sort((x, y) => y.perNaira - x.perNaira);
  world.economy.funds = funds;
  roadRanks.set(world, { key, roads });
  return roads;
}

interface RankedPave extends PaveMove {
  tripsAdded: number;
  perNaira: number;
}

/**
 * Roads to pave, best trips added per naira first, measured like roads
 * (days 6-10 against a twin). Ranked again when anything is paved or built,
 * or every ten days.
 */
const paveRanks = new WeakMap<SliceWorld, { key: string; paves: RankedPave[] }>();
async function rankedPaves(world: SliceWorld): Promise<RankedPave[]> {
  const dirt = world.simulation.map.segments.filter((segment) => segment.type === "road" && segment.provenance === "inherited").length;
  const key = `${world.simulation.map.segments.length}|${dirt}|${Math.floor(world.economy.elapsedSeconds / (10 * SECONDS_PER_GAME_DAY))}`;
  const cached = paveRanks.get(world);
  if (cached?.key === key) return cached.paves;
  const moves = paveMoves(world);
  const measuring = structuredClone(world);
  measuring.economy.funds = 1e9;
  const added = await tripsAdded(measuring, moves.map((m) => m.action));
  const paves = moves
    .map((move, i) => ({ ...move, tripsAdded: added[i] ?? 0, perNaira: (added[i] ?? 0) / move.price }))
    .sort((x, y) => y.perNaira - x.perNaira);
  paveRanks.set(world, { key, paves });
  return paves;
}

/**
 * The vehicle moves worth forecasting: another vehicle on each route it
 * runs, and the 16 new routes with the most riders wanting trips along them
 * per naira. Forecasting every road-connected pair every day -- 110 of them
 * once roads joined the cut-off towns -- took Greedy 20 minutes a run.
 */
function shortlistVehicles(world: SliceWorld): VehicleMove[] {
  const all = vehicleMoves(world);
  const along = (m: VehicleMove) => demandAlong(world, m.action.a, m.action.b) / m.price;
  return [...all.filter((m) => m.count > 1), ...all.filter((m) => m.count === 1).sort((x, y) => along(y) - along(x)).slice(0, 16)];
}

/** Roads paved since day 1, by their end towns (a road through roadside towns counts once). */
function pavedRoads(world: SliceWorld): string[] {
  const names = new Set<string>();
  for (const segment of world.simulation.map.segments) {
    if (segment.type !== "road" || segment.surface !== "paved") continue;
    const chain = chainOf(world, segment.id);
    if (chain) names.add([chain.a, chain.b].sort().join("-"));
  }
  return [...names];
}

/** The best road for each cut-off town, from a ranked list. */
function bestRoadPerTown(roads: RankedRoad[]): RankedRoad[] {
  const best = new Map<string, RankedRoad>();
  for (const road of roads) if (!best.has(road.action.a)) best.set(road.action.a, road);
  return [...best.values()];
}

/** Builds the best road per naira if it can afford it; true if it built one. */
async function buildBestRoad(world: SliceWorld): Promise<RankedRoad | null> {
  const best = (await rankedRoads(world))[0];
  if (best && best.price <= world.economy.funds && applyAction(world, best.action).ok) return best;
  return null;
}

// --- Personas -------------------------------------------------------------

interface Persona {
  name: string;
  /** The verbs it ever uses: one verb is a candidate for M6's one-verb win. */
  verbs: string[];
  /**
   * Called at the start of each game day, before the day runs. "blocked":
   * it wanted a move it couldn't afford (M10).
   */
  decide: (world: SliceWorld, day: number) => Promise<void | "blocked"> | void | "blocked";
  /** Days it plays; DAYS unless a check needs longer (or, for an opening, shorter). */
  days?: number;
  /** One of M1's openings: compared only with each other. */
  opening?: boolean;
}

/** The two biggest towns a road joins directly (a road chain through roadside towns counts). */
function biggestJoinedPair(world: SliceWorld): [string, string] | null {
  const towns = [...world.towns.values()];
  let best: [string, string] | null = null;
  let bestSize = -1;
  for (let i = 0; i < towns.length; i += 1) {
    for (let j = i + 1; j < towns.length; j += 1) {
      const a = towns[i]!;
      const b = towns[j]!;
      const size = a.population + b.population;
      if (size > bestSize && roadChain(world, a.id, b.id)) {
        best = [a.id, b.id];
        bestSize = size;
      }
    }
  }
  return best;
}

const personas: Persona[] = [
  { name: "idle", verbs: [], decide: () => {} },
  {
    // A bus between the two biggest towns a road joins, repeated: one more
    // every third day it can afford one.
    name: "naive",
    verbs: ["bus"],
    decide: (world, d) => {
      const pair = biggestJoinedPair(world);
      if (pair && d % 3 === 0) addBus(world, pair[0], pair[1]);
    },
  },
  {
    // Roads to every cut-off town first, best trips unlocked per naira
    // first; then a minibus to each town it reached, then buses as naive does.
    name: "builder",
    verbs: ["road", "minibus", "bus"],
    decide: (() => {
      const built: Array<[string, string]> = [];
      return async (world: SliceWorld, d: number) => {
        if (roadMoves(world).length > 0) {
          const road = await buildBestRoad(world);
          if (road) built.push([road.action.a, road.action.b]);
          return; // saving for the next road
        }
        for (const [a, b] of built) {
          if (!world.routes.some((route) => route.a === a && route.b === b) && applyAction(world, { kind: "minibus", a, b }).ok) return;
        }
        const pair = biggestJoinedPair(world);
        if (pair && d % 3 === 0) addBus(world, pair[0], pair[1]);
      };
    })(),
  },
  { name: "roads only", verbs: ["road"], decide: async (world) => void (await buildBestRoad(world)) },
  {
    // Spends everything on day 1: a bus on each pair, most trips along first,
    // round again until it can't afford one.
    name: "overbuilder",
    verbs: ["bus"],
    decide: (world, d) => {
      if (d !== 0) return;
      for (let bought = true; bought; ) {
        bought = false;
        for (const move of vehicleMoves(world).filter((m) => m.action.kind === "bus" && m.count === 1)) {
          if (applyAction(world, move.action).ok) bought = true;
        }
        if (!bought) bought = applyAction(world, { kind: "bus", ...pairOf(biggestJoinedPair(world)) }).ok;
      }
    },
  },
  {
    // Each day, the move with the best forecast ₦/day that it can afford --
    // what the page's best-moves list would put first -- if it pays at all.
    name: "greedy",
    verbs: ["bus", "minibus", "road", "pave"],
    decide: greedyMove,
  },
  // M1's openings: plans of equal skill that differ in how they spend the
  // first ₦2,500 -- all of it on one kind of move, the best each time --
  // then all play greedy. The naive openings measured the bots' skill gap,
  // not the game: greedy, the only one that forecast, earned about twice the
  // next at every fare level. (Differing only in the day-1 move, they would
  // converge.)
  ...(["bus", "minibus", "road", "pave"] as const).map((kind) => ({
    name: `${kind} first`,
    verbs: ["bus", "minibus", "road", "pave"],
    // To day 60: M1 as proposed asks whether infrastructure-first catches up by then.
    days: Number(process.env.OPENING_DAYS ?? 60),
    opening: true,
    decide: async (world: SliceWorld, d: number) => (d === 0 ? spendOpening(world, kind) : greedyMove(world)),
  })),
  {
    // Each day, the move that adds the most trips made per naira -- vehicles
    // measured against a twin, roads from the ranking -- among those that
    // keep its budget balanced (net a day, plus the move's forecast, at or
    // above zero). If it can't afford that move it saves for it rather than
    // settling for a lesser one: how often it's waiting on money is M10.
    // Played 60 days, for M10's window. (Allowed to run losses, it sat in
    // debt from day 10 and "waited" on money by being broke.)
    //
    // Speed: it buys almost daily, and re-measuring every candidate after
    // each purchase took over 35 minutes; ranking all of them every third
    // day still took 25 s a time once roads joined 110 candidate pairs. So
    // it ranks every third day, works down that list as it buys, and
    // measures in three stages: riders wanting trips along the route per
    // naira picks 16 new routes (another vehicle on a route it runs always
    // goes through), a 3-day run screens those, and days 3-5 rank the six best.
    name: "trips-greedy",
    verbs: ["bus", "minibus", "road", "pave"],
    days: 60,
    decide: tripsGreedy(false),
  },
  {
    // M10's comparison: trips-greedy with money no object.
    name: "trips-greedy unlimited",
    verbs: ["bus", "minibus", "road", "pave"],
    days: 60,
    decide: tripsGreedy(true),
  },
];

/**
 * Trips-greedy's policy (its persona above). `unlimited`: the same policy
 * with its funds topped up every day and no remittance -- what M10 compares
 * it against: if money limits the score, unlimited money buys more trips.
 */
function tripsGreedy(unlimited: boolean): (world: SliceWorld) => Promise<void | "blocked"> {
  type Option = { action: ActionSpec; price: number; perNaira: number; money?: number | null };
  let ranked: { key: string; list: Option[] } = { key: "", list: [] };
  return async (world: SliceWorld): Promise<void | "blocked"> => {
    if (unlimited) {
      world.economy.funds = 1e9;
      world.tuning.remittanceEnabled = false;
    }
    const key = `${Math.floor(world.economy.elapsedSeconds / (3 * SECONDS_PER_GAME_DAY))}`;
    if (ranked.key !== key) {
      const t0 = performance.now();
      const vehicles = shortlistVehicles(world);
      const measuring = structuredClone(world);
      measuring.economy.funds = 1e9;
      const screen = await tripsAddedOver(measuring, vehicles.map((m) => m.action), 3, 2);
      const shortlist = vehicles
        .map((m, i) => ({ action: m.action as ActionSpec, price: m.price, perNaira: (screen[i] ?? 0) / m.price }))
        .sort((x, y) => y.perNaira - x.perNaira)
        .slice(0, 6);
      const measured = await tripsAddedOver(measuring, shortlist.map((o) => o.action), 5, 2);
      const options: Option[] = [
        ...shortlist.map((o, i) => ({ ...o, perNaira: (measured[i] ?? 0) / o.price })),
        ...bestRoadPerTown(await rankedRoads(world)).map((r) => ({ action: r.action as ActionSpec, price: r.price, perNaira: r.perNaira })),
        ...(await rankedPaves(world)).map((r) => ({ action: r.action as ActionSpec, price: r.price, perNaira: r.perNaira })),
      ].filter((o) => o.perNaira > 0);
      options.sort((x, y) => y.perNaira - x.perNaira);
      // Its money forecast too (2 days, as the player sees it): it buys
      // only moves that keep its net a day at or above zero.
      const top = options.slice(0, 16);
      const money = await forecastAll(measuring, top.map((o) => o.action));
      top.forEach((o, i) => (o.money = money[i] ?? null));
      ranked = { key, list: top };
      if (process.env.BOTS_VERBOSE) log(`trips-greedy day ${Math.round((world.economy.elapsedSeconds - world.startSeconds) / SECONDS_PER_GAME_DAY) + 1}: ${vehicles.length} candidates, ${world.simulation.vehicles.length} vehicles on the map, ranked in ${((performance.now() - t0) / 1000).toFixed(1)} s, funds ₦${Math.round(world.economy.funds)}`);
    }
    // It buys down its list -- the best trips per naira that keeps the
    // budget balanced (today's net, 5-day average, plus the forecasts of
    // what it buys today) -- for as long as it can afford the next move.
    // One move a day hid the constraint M10 asks about: never short of
    // money at that pace, unlimited money bought exactly the same trips.
    let net = averageNet(world);
    for (;;) {
      const index = ranked.list.findIndex((o) => o.money !== null && o.money !== undefined && net + o.money >= 0);
      if (index < 0) return;
      const best = ranked.list[index]!;
      if (best.price > world.economy.funds) return "blocked";
      if (!applyAction(world, best.action).ok) return "blocked";
      net += best.money!;
      ranked.list.splice(index, 1);
    }
  };
}

/** Greedy's move: the best forecast ₦/day it can afford, if it pays at all. */
async function greedyMove(world: SliceWorld): Promise<void> {
  const affordable = (m: { price: number }) => m.price <= world.economy.funds;
  const actions: ActionSpec[] = [
    ...shortlistVehicles(world).filter(affordable).map((m) => m.action),
    // Roads: each cut-off town's best by trips per naira, not all of them:
    // forecasting every candidate road every day took 15 minutes.
    ...bestRoadPerTown(await rankedRoads(world)).filter(affordable).map((m) => m.action),
    ...(await rankedPaves(world)).filter(affordable).map((m) => m.action),
  ];
  if (actions.length === 0) return;
  const money = await forecastAll(world, actions);
  let best = -1;
  for (const [i, value] of money.entries()) if (value !== null && value > 0 && (best < 0 || value > money[best]!)) best = i;
  if (best >= 0) applyAction(world, actions[best]!);
}

/**
 * An opening: spend the starting money on one kind of move, the best each
 * time, until none of that kind is affordable. Vehicles by forecast ₦/day
 * (what the best-moves list would put first), bought even when it's
 * negative: the opening is the plan, not a judgement on it. Roads and
 * paving by trips added per naira (they forecast no fares of their own).
 */
async function spendOpening(world: SliceWorld, kind: "bus" | "minibus" | "road" | "pave"): Promise<void> {
  for (let guard = 0; guard < 20; guard += 1) {
    if (kind === "road" || kind === "pave") {
      const ranked = kind === "road" ? bestRoadPerTown(await rankedRoads(world)) : await rankedPaves(world);
      const best = ranked.filter((m) => m.perNaira > 0).find((m) => m.price <= world.economy.funds);
      if (!best || !applyAction(world, best.action).ok) return;
      continue;
    }
    const actions = shortlistVehicles(world)
      .filter((m) => m.action.kind === kind && m.price <= world.economy.funds)
      .map((m) => m.action);
    if (actions.length === 0) return;
    const money = await forecastAll(world, actions);
    let best = -1;
    for (const [i, value] of money.entries()) if (value !== null && (best < 0 || value > money[best]!)) best = i;
    if (best < 0 || !applyAction(world, actions[best]!).ok) return;
  }
}

function pairOf(pair: [string, string] | null): { a: string; b: string } {
  return pair ? { a: pair[0], b: pair[1] } : { a: "", b: "" };
}

// --- Running a persona ----------------------------------------------------

interface Sample {
  day: number;
  headline: Headline;
  /** The headline as shown: the engine's 5-day average (history.ts), filled from the warm-up on day 1. */
  average: Headline;
  funds: number;
  net: number;
  /** Routine upkeep and all running costs over the last day: upkeep's share is a step 5 target. */
  upkeep: number;
  cost: number;
  /** Money in since day 1, by line (budget.ts). */
  budget: BudgetTally;
  population: number;
  informalShare: number;
}

interface Run {
  persona: Persona;
  samples: Sample[];
  /** Roads it has paved by day 40 (step 5: the strongest strategy still paves its trunk). */
  paved?: string[];
  /** Per-route net a day at day 20, for the step 5 guard on builder's minibuses. */
  routesDay20?: Array<{ id: string; net: number }>;
  /** Days (from 1) it wanted a move it couldn't afford. */
  blocked: Set<number>;
}

function sample(world: SliceWorld): Sample {
  return {
    day: (world.economy.elapsedSeconds - world.startSeconds) / SECONDS_PER_GAME_DAY,
    headline: headline(world),
    average: averageHeadline(world),
    funds: world.economy.funds,
    net: lastDay(world.ledger).net,
    upkeep: totalRoutineUpkeepPerDay(world),
    cost: lastDay(world.ledger).cost,
    budget: { ...world.budget },
    population: population(world),
    informalShare: networkShare(world).informal,
  };
}

async function play(persona: Persona): Promise<Run> {
  const world = newWorld();
  const samples: Sample[] = [];
  const blocked = new Set<number>();
  let routesDay20: Array<{ id: string; net: number }> | undefined;
  let paved: string[] | undefined;
  const started = performance.now();
  for (let d = 0; d < (persona.days ?? DAYS); d += 1) {
    if ((await persona.decide(world, d)) === "blocked") blocked.add(d + 1);
    runDays(world, 1);
    samples.push(sample(world));
    if (d === 19) routesDay20 = routeSummaries(world).map((r) => ({ id: r.id, net: r.netPerDay }));
    if (d === 39) paved = pavedRoads(world);
  }
  log(`${persona.name}: ${((performance.now() - started) / 1000).toFixed(0)} s`);
  return { persona, samples, blocked, routesDay20, paved };
}

const at = (run: Run, d: number) => run.samples[d - 1]!;
/** The headline as the brief reads it: the engine's 5-day average (history.ts). */
const avgHeadline = (run: Run, d: number): Headline => at(run, d).average;
/**
 * Mean net per day over days from..to: the money a strategy makes, before
 * capital. One day's net is too noisy to rank by -- five buses' swings
 * between -₦2 and -₦255 from one day to the next -- and funds rank whoever
 * spends least first.
 */
const meanNet = (run: Run, from: number, to: number) => run.samples.slice(from - 1, to).reduce((sum, s) => sum + s.net, 0) / (to - from + 1);
const n = (x: number) => String(Math.round(x)).padStart(6);
const money = (x: number) => `₦${Math.round(x)}`.padStart(8);

// --- Main -----------------------------------------------------------------

const only = process.env.BOTS?.split(",");
const chosen = personas.filter((p) => !only || only.includes(p.name));
const runs: Run[] = [];
for (const persona of chosen) runs.push(await play(persona));

console.log(`\nHeadline per game day, 5-day average (trips made / no road / no seat / your riders), funds, mean net over the same 5 days`);
console.log(`${"persona".padEnd(12)} ${[10, 20, 40].map((d) => `day ${d}`.padEnd(42)).join("")}`);
for (const run of runs) {
  const cells = [10, 20, 40].map((d) => {
    if (run.samples.length < d) return "".padEnd(42);
    const s = at(run, d);
    const h = avgHeadline(run, d);
    return `${n(h.tripsPerDay)}${n(h.noRoadPerDay)}${n(h.noSeatPerDay)}${n(h.yourRidersPerDay)}${money(s.funds)}${money(meanNet(run, d - 4, d))}`.padEnd(42);
  });
  console.log(`${run.persona.name.padEnd(12)} ${cells.join("")}`);
}
const openingRuns = runs.filter((r) => r.persona.opening);
if (openingRuns.length > 0) {
  const marks = [10, 20, 30, 40, 50, 60].filter((d) => openingRuns.every((r) => r.samples.length >= d));
  console.log(`\nThe openings' curves: net a day (5-day mean) / trips made a day (5-day average)`);
  console.log(`${"opening".padEnd(14)} ${marks.map((d) => `day ${d}`.padEnd(16)).join("")}`);
  for (const run of openingRuns) {
    console.log(`${run.persona.name.padEnd(14)} ${marks.map((d) => `${money(meanNet(run, d - 4, d)).trim()} / ${Math.round(avgHeadline(run, d).tripsPerDay)}`.padEnd(16)).join("")}`);
  }
}
const builderRun = runs.find((r) => r.persona.name === "builder");
if (builderRun?.routesDay20) {
  const minis = builderRun.routesDay20.filter((r) => r.id.startsWith("mini:"));
  console.log(`\nBuilder's minibuses to the towns it connected, net a day at day 20 (guard: at least break even): ${minis.map((r) => `${r.id.slice(5)} ${money(r.net).trim()}`).join(", ") || "none bought"}`);
}
console.log(`\nIncome a day by line, days 31-40: fares / tolls / levies (agberos kept) / allocation, the allocation's share, and remitted to the treasury`);
for (const run of runs) {
  if (run.samples.length < 40) continue;
  const a = at(run, 30).budget, b = at(run, 40).budget;
  const per = (k: keyof BudgetTally) => (b[k] - a[k]) / 10;
  const income = per("fares") + per("tolls") + per("levies") + per("allocation");
  console.log(`${run.persona.name.padEnd(12)} ${money(per("fares"))} ${money(per("tolls"))} ${money(per("levies"))} (${money(per("agberos")).trim()}) ${money(per("allocation"))}   ${String(income > 0 ? Math.round((per("allocation") / income) * 100) : 0).padStart(3)}%  ${money(per("remitted"))}`);
}
console.log(`\nPaved by day 40 (the strongest strategy should still pave its trunk, Ilase-Owode):`);
for (const run of runs) if (run.paved) console.log(`${run.persona.name.padEnd(12)} ${run.paved.join(", ") || "nothing"}`);
console.log(`\nRoutine upkeep, day 40: per day, and its share of running costs (no share target: a quiet road costs more than it returns -- M3 -- and the strongest strategy still paves its trunk, above)`);
for (const run of runs) {
  if (run.samples.length < 40) continue;
  const s = at(run, 40);
  if (s.cost > 0) console.log(`${run.persona.name.padEnd(12)} ${money(s.upkeep)}  ${String(Math.round((s.upkeep / s.cost) * 100)).padStart(3)}% of ${money(s.cost).trim()}`);
}

if (process.env.CHECKS !== "0") await checks();
for (const worker of workers) worker.terminate();

// --- The measured checks (docs/brief.md, Pass/fail checks) -----------------

async function checks(): Promise<void> {
  const results: Array<[string, boolean | null, string]> = [];
  const byName = new Map(runs.map((run) => [run.persona.name, run]));
  // Players: the strategies, not M1's openings or M10's unlimited-money comparison.
  const players = runs.filter((run) => run.persona.verbs.length > 0 && !run.persona.opening && run.persona.name !== "trips-greedy unlimited");
  const openings = runs.filter((run) => run.persona.opening);
  const idle = byName.get("idle");

  // M1: at least 3 plans end day 20 within 25% of the best plan's net (days
  // 16-20). The plans: the four openings, equal in skill, differing only in
  // their first move.
  if (openings.length >= 3) {
    const nets = openings
      .map((run) => ({ name: run.persona.name, net: meanNet(run, 16, 20), trips: avgHeadline(run, 20).tripsPerDay }))
      .sort((x, y) => y.net - x.net);
    const best = nets[0]!.net;
    const close = nets.filter((x) => best > 0 && x.net >= best * 0.75);
    results.push(["M1 opening variety", close.length >= 3, nets.map((x) => `${x.name} ${money(x.net).trim()}/day, ${Math.round(x.trips)} trips`).join("; ")]);
  }

  // M1, as proposed (brief, 2026-10-18): vehicles-first may lead at day 20,
  // but infrastructure-first (road or pave first) catches up or overtakes on
  // trips made by day 60 and is within 25% of the best net by then.
  if (openings.length >= 4 && openings.every((run) => run.samples.length >= 60)) {
    const at60 = openings.map((run) => ({ name: run.persona.name, net: meanNet(run, 56, 60), trips: avgHeadline(run, 60).tripsPerDay }));
    const vehicles = at60.filter((x) => x.name === "bus first" || x.name === "minibus first");
    const infra = at60.filter((x) => x.name === "road first" || x.name === "pave first");
    const bestTrips = Math.max(...vehicles.map((x) => x.trips));
    const bestNet = Math.max(...at60.map((x) => x.net));
    const best = [...infra].sort((x, y) => y.trips - x.trips)[0]!;
    const pass = best.trips >= bestTrips && best.net >= 0.75 * bestNet;
    results.push([
      "M1 (proposed, day 60)",
      pass,
      at60.map((x) => `${x.name} ${money(x.net).trim()}/day, ${Math.round(x.trips)} trips`).join("; "),
    ]);
  }

  // M2 (proposed, 2026-10-18): a road to a cut-off town plus one vehicle
  // pays in trips. It passes if its added trips cost about what other good
  // moves' do (naira per added trip a day, within 1.5x the mean of the best
  // vehicle's and the best paving's) and its running loss is affordable on
  // a balanced budget (at most a fifth of trips-greedy's net a day, days
  // 16-20). Busy roads pay in money (M3); lifeline roads pay in trips. The
  // road: each cut-off town's best by trips unlocked per naira, the one a
  // player reading the desire lines would build.
  // M3: paving the busiest road pays back in 10-30 days; a quiet one not within 60.
  // All against the same do-nothing twin, sampled daily for 60 days.
  log("M2/M3: twins over 60 days");
  const base = newWorld();
  type TwinCheck = "M2" | "M2good" | "M3busy" | "M3quiet";
  const twins: Array<{ label: string; world: SliceWorld; check: TwinCheck; price: number }> = [];
  const spent = (world: SliceWorld) => base.economy.funds - world.economy.funds;
  for (const road of bestRoadPerTown(await rankedRoads(base))) {
    for (const kind of ["bus", "minibus"] as const) {
      const world = newWorld();
      if (buildRoad(world, road.action.a, road.action.b).ok && applyAction(world, { kind, a: road.action.a, b: road.action.b }).ok) {
        twins.push({ label: `road ${road.action.a}-${road.action.b} + ${kind}`, world, check: "M2", price: spent(world) });
      }
    }
  }
  // The good moves M2 is priced against: the best vehicle by forecast, the
  // best paving by trips per naira, both bought on day 1 like the lifeline.
  {
    const vehicles = vehicleMoves(base).map((m) => m.action);
    const forecasts = await forecastAll(base, vehicles);
    const bestVehicle = forecasts.reduce<number>((best, v, i) => (v !== null && (best < 0 || v > forecasts[best]!) ? i : best), -1);
    const bestPave = (await rankedPaves(base))[0];
    for (const action of [bestVehicle >= 0 ? vehicles[bestVehicle]! : null, bestPave?.action ?? null]) {
      if (!action) continue;
      const world = newWorld();
      if (applyAction(world, action).ok) twins.push({ label: `${action.kind} ${"a" in action ? `${action.a}-${action.b}` : ""}`, world, check: "M2good", price: spent(world) });
    }
  }
  const flows = probeRoadFlows();
  for (const [check, segmentId] of [["M3busy", flows.busiest], ["M3quiet", flows.quietest]] as const) {
    const chain = chainOf(base, segmentId);
    const world = newWorld();
    if (chain && paveRoad(world, chain.a, chain.b).ok) twins.push({ label: `pave ${chain.a}-${chain.b}`, world, check, price: spent(world) });
  }
  const payback = new Map<string, number | null>(twins.map((t) => [t.label, null]));
  // Trips made a day added over the twin, summed over the 60 days.
  const addedTrips = new Map<string, number>(twins.map((t) => [t.label, 0]));
  // Payback on net before the remittance (funds plus what was remitted):
  // the treasury takes most of a surplus, so funds alone pay back ~5x
  // slower. Below the reserve the two agree.
  const before = (w: SliceWorld) => w.economy.funds + w.budget.remitted;
  for (let d = 1; d <= 60; d += 1) {
    runDays(base, 1);
    const baseTrips = headline(base).tripsPerDay;
    for (const twin of twins) {
      runDays(twin.world, 1);
      addedTrips.set(twin.label, addedTrips.get(twin.label)! + headline(twin.world).tripsPerDay - baseTrips);
      if (payback.get(twin.label) === null && before(twin.world) >= before(base)) payback.set(twin.label, d);
    }
  }
  const days = (label: string) => payback.get(label) ?? Infinity;
  const show = (t: { label: string }) => `${t.label}: ${Number.isFinite(days(t.label)) ? `${days(t.label)} days` : "not in 60"}`;
  // Naira per added trip a day (the price over the 60-day mean added), and
  // the running net a day once bought (before the remittance).
  const perTrip = (t: (typeof twins)[number]) => t.price / Math.max(1e-9, addedTrips.get(t.label)! / 60);
  const runningNet = (t: (typeof twins)[number]) => (before(t.world) - before(base) + t.price) / 60;
  // A "good move" that added no trips over the 60 days isn't one: the best
  // paving by trips per naira on days 6-10 (Ado-Ogbe) lost 39 trips a day
  // over 60, and its per-trip price swamped the mean.
  const good = twins.filter((t) => t.check === "M2good" && addedTrips.get(t.label)! > 0);
  const goodPerTrip = good.reduce((sum, t) => sum + perTrip(t), 0) / Math.max(1, good.length);
  const tripsGreedyForM2 = byName.get("trips-greedy");
  const affordable = tripsGreedyForM2 && tripsGreedyForM2.samples.length >= 20 ? 0.2 * meanNet(tripsGreedyForM2, 16, 20) : null;
  const m2 = twins.filter((t) => t.check === "M2");
  const m2Pass = (t: (typeof twins)[number]) => perTrip(t) <= 1.5 * goodPerTrip && affordable !== null && -runningNet(t) <= affordable;
  const describe = (t: (typeof twins)[number]) =>
    `${t.label}: +${Math.round(addedTrips.get(t.label)! / 60)} trips/day at ${money(perTrip(t)).trim()}/trip, net ${money(runningNet(t)).trim()}/day`;
  results.push([
    "M2 lifelines pay in trips",
    good.length === 0 || affordable === null ? null : m2.some(m2Pass),
    `${m2.map(describe).join("; ")}. Good moves ${money(goodPerTrip).trim()}/trip (${twins.filter((t) => t.check === "M2good").map(describe).join("; ")}); affordable loss ${affordable === null ? "n/a (no trips-greedy run)" : `${money(affordable).trim()}/day`}`,
  ]);
  const busy = twins.find((t) => t.check === "M3busy");
  const quiet = twins.find((t) => t.check === "M3quiet");
  if (busy && quiet) {
    const pass = days(busy.label) >= 10 && days(busy.label) <= 30 && days(quiet.label) > 60;
    results.push(["M3 paving isn't a no-brainer", pass, `${show(busy)}; ${show(quiet)} (no vehicles of yours)`]);
  }

  // M4: the best strategy halves "no road" and lifts trips made 25% above doing nothing.
  if (idle && players.length > 0) {
    const i40 = avgHeadline(idle, 40);
    const best = [...players].sort((x, y) => avgHeadline(y, 40).tripsPerDay - avgHeadline(x, 40).tripsPerDay)[0]!;
    const b40 = avgHeadline(best, 40);
    const pass = b40.noRoadPerDay <= i40.noRoadPerDay / 2 && b40.tripsPerDay >= i40.tripsPerDay * 1.25;
    results.push([
      "M4 the headline moves",
      pass,
      `best ${best.persona.name}: trips ${n(b40.tripsPerDay).trim()} vs idle ${n(i40.tripsPerDay).trim()} (${pct(b40.tripsPerDay / i40.tripsPerDay - 1)}), no road ${n(b40.noRoadPerDay).trim()} vs ${n(i40.noRoadPerDay).trim()}`,
    ]);
  }

  // M5: the strategy carrying the most riders is not the one making the most money (net, days 31-40).
  if (players.length >= 2) {
    const riders = [...players].sort((x, y) => avgHeadline(y, 40).yourRidersPerDay - avgHeadline(x, 40).yourRidersPerDay)[0]!;
    const rich = [...players].sort((x, y) => meanNet(y, 31, 40) - meanNet(x, 31, 40))[0]!;
    results.push(["M5 the tension is real", riders !== rich, `most riders: ${riders.persona.name}; most money: ${rich.persona.name} (${money(meanNet(rich, 31, 40)).trim()}/day)`]);
  }

  // M6: no single-verb strategy is in the top three on both trips made and money.
  if (players.length >= 3) {
    const top = (score: (run: Run) => number) => new Set([...players].sort((x, y) => score(y) - score(x)).slice(0, 3));
    const topTrips = top((run) => avgHeadline(run, 40).tripsPerDay);
    const topMoney = top((run) => meanNet(run, 31, 40));
    const winners = players.filter((run) => run.persona.verbs.length === 1 && topTrips.has(run) && topMoney.has(run));
    results.push(["M6 no one-verb win", winners.length === 0, winners.length ? `one-verb in both top threes: ${winners.map((r) => r.persona.name).join(", ")}` : "none"]);
  }

  // M7: on day 1 the informal share is within 5 points of its day-10 value.
  // "Day 1" is the first moment a player reads the panel: 3 seconds in,
  // after the warm-up.
  {
    const world = newWorld();
    runDays(world, 0.1);
    const early = networkShare(world).informal;
    runDays(world, 9.9);
    const later = networkShare(world).informal;
    results.push(["M7 warm start", Math.abs(early - later) <= 0.05, `informal share ${pct(early)} at the start, ${pct(later)} on day 10`]);
  }

  // M8: a good action moves the number it acts on by at least twice that
  // number's jitter, both as shown (the 5-day average). A vehicle acts on
  // your riders: the best vehicle forecast on day 10 of doing nothing,
  // against the jitter of naive's riders (a network that has some). A road
  // or paving acts on trips made: the best by trips per naira, against
  // idle's jitter. Jitter: the standard deviation, days 14-40, around a
  // straight-line fit. Effect: the 5-day average over the five days after
  // the move, against the twin's.
  const naive = byName.get("naive");
  if (idle && naive) {
    const sd = (run: Run, pick: (h: Headline) => number) =>
      residualSd(run.samples.filter((s) => s.day >= 14).map((s) => [s.day, pick(avgHeadline(run, Math.round(s.day)))] as const));
    const world = newWorld();
    runDays(world, 10);
    const candidates = vehicleMoves(world).map((m) => m.action);
    const forecasts = await forecastAll(world, candidates);
    const bestIndex = forecasts.reduce<number>((best, v, i) => (v !== null && (best < 0 || v > forecasts[best]!) ? i : best), -1);
    const vehicle = candidates[bestIndex]!;
    const ridersJitter = sd(naive, (h) => h.yourRidersPerDay);
    const [byVehicle] = await addedOver(world, [vehicle], 5);
    const ridersEffect = byVehicle?.riders ?? 0;
    const roads = [...bestRoadPerTown(await rankedRoads(world)), ...(await rankedPaves(world))].sort((x, y) => y.perNaira - x.perNaira);
    const infra = roads[0]!.action;
    const tripsJitter = sd(idle, (h) => h.tripsPerDay);
    const measuring = structuredClone(world);
    measuring.economy.funds = 1e9;
    const [byInfra] = await addedOver(measuring, [infra], 10, 5);
    const tripsEffect = byInfra?.trips ?? 0;
    const label = (a: ActionSpec) => `${a.kind} ${"a" in a ? `${a.a}-${a.b}` : ""}`;
    results.push([
      "M8 signal over noise",
      ridersEffect >= 2 * ridersJitter && tripsEffect >= 2 * tripsJitter,
      `${label(vehicle)}: your riders +${ridersEffect.toFixed(1)}/day, jitter ${ridersJitter.toFixed(1)}; ${label(infra)}: trips made +${tripsEffect.toFixed(1)}/day (days 6-10), jitter ${tripsJitter.toFixed(1)}`,
    ]);
  }

  // M10: money limits the score. Trips-greedy (budget-balancing, the most
  // trips per naira) against the same policy with unlimited funds: if money
  // is the constraint, unlimited money makes ~15%+ more trips by day 20.
  // Within the noise (±50 trips a day) is a fail. Day 20, in the build-out:
  // by day 40 both fill the map's demand and the comparison measures the
  // map, not money (unlimited +15% at day 20, -2% at day 60).
  const tripsGreedyRun = byName.get("trips-greedy");
  const unlimitedRun = byName.get("trips-greedy unlimited");
  if (tripsGreedyRun && unlimitedRun) {
    const limited = avgHeadline(tripsGreedyRun, 20).tripsPerDay;
    const free = avgHeadline(unlimitedRun, 20).tripsPerDay;
    const gain = free / limited - 1;
    const waiting = Array.from({ length: 46 }, (_, i) => i + 15).filter((d) => tripsGreedyRun.blocked.has(d)).length;
    results.push([
      "M10 money limits the score",
      gain >= 0.15 && free - limited > 50,
      `trips made day 20: unlimited ${Math.round(free)} against ${Math.round(limited)} (${gain >= 0 ? "+" : ""}${Math.round(gain * 100)}%); trips-greedy waited on money ${waiting} of 46 days, funds ${money(at(tripsGreedyRun, 60).funds).trim()}`,
    ]);
  }

  // M9: no strategy that grows towns shows a falling headline while it does.
  {
    const fallers: string[] = [];
    for (const run of runs.filter((r) => r.samples.length >= 40)) {
      const marks = [10, 20, 40];
      const grew = at(run, 40).population > at(run, 10).population;
      // A fall counts only above the noise: over 50 trips a day, or 10%.
      const fell = marks.some((d, i) => {
        if (i === 0) return false;
        const before = avgHeadline(run, marks[i - 1]!).tripsPerDay;
        const drop = before - avgHeadline(run, d).tripsPerDay;
        return drop > Math.max(50, 0.1 * before);
      });
      if (grew && fell) fallers.push(run.persona.name);
    }
    results.push(["M9 success reads as success", fallers.length === 0, fallers.length ? `towns grew but trips fell: ${fallers.join(", ")}` : "none"]);
  }

  console.log(`\nMeasured checks (docs/brief.md)`);
  for (const [name, pass, detail] of results) console.log(`${pass === null ? "SKIP" : pass ? "PASS" : "FAIL"}  ${name.padEnd(30)} ${detail}`);
}

/** The busiest and quietest roads joining two towns, by traffic on day 10 of doing nothing. */
function probeRoadFlows(): { busiest: string; quietest: string } {
  const world = newWorld();
  runDays(world, 10);
  const roads = world.simulation.map.segments.filter((s) => s.type === "road");
  const flow = (id: string) => world.roadFlowEMA.get(id) ?? 0;
  const sorted = [...roads].sort((x, y) => flow(y.id) - flow(x.id));
  return { busiest: sorted[0]!.id, quietest: sorted[sorted.length - 1]!.id };
}

function residualSd(points: ReadonlyArray<readonly [number, number]>): number {
  const count = points.length;
  const mx = points.reduce((s, [x]) => s + x, 0) / count;
  const my = points.reduce((s, [, y]) => s + y, 0) / count;
  const sxy = points.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0);
  const sxx = points.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  const slope = sxx > 0 ? sxy / sxx : 0;
  const variance = points.reduce((s, [x, y]) => s + (y - (my + slope * (x - mx))) ** 2, 0) / Math.max(1, count - 2);
  return Math.sqrt(variance);
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
