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
import { addBus, buildRoad, chainOf, demandAlong, headline, networkShare, paveRoad, roadChain, type Headline } from "../src/engine/slice/world";
import { sliceTick } from "../src/engine/slice/tick";
import { applyAction, type ActionSpec } from "../src/engine/slice/actions";
import { paveMoves, roadMoves, vehicleMoves, type PaveMove, type RoadMove, type VehicleMove } from "../src/engine/slice/moves";
import { lastDay } from "../src/engine/slice/ledger";
import { averageHeadline } from "../src/engine/slice/history";
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
  const jobs = [null, ...actions].map((action, index) => {
    const id = nextId++;
    const job = new Promise<Trajectory>((resolve) => waiting.set(id, resolve));
    workers[index % workers.length]!.postMessage({ id, world, action, tripDays: days });
    return job;
  });
  const [twin, ...moves] = await Promise.all(jobs);
  const mean = (trips: number[]) => trips.slice(skip).reduce((sum, x) => sum + x, 0) / (trips.length - skip);
  return moves.map((move) => (move.trips ? mean(move.trips) - mean(twin!.trips!) : null));
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
  /** Days it plays; DAYS unless a check needs longer. */
  days?: number;
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
    decide: async (world) => {
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
    },
  },
  {
    // Each day, the move that adds the most trips made per naira -- vehicles
    // measured against a twin, roads from the ranking -- losses allowed. If
    // it can't afford that move it saves for it rather than settling for a
    // lesser one: how often it's waiting on money is M10. Played 60 days,
    // for M10's window.
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
    decide: (() => {
      type Option = { action: ActionSpec; price: number; perNaira: number };
      let ranked: { key: string; list: Option[] } = { key: "", list: [] };
      return async (world: SliceWorld): Promise<void | "blocked"> => {
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
          ranked = { key, list: options.sort((x, y) => y.perNaira - x.perNaira) };
          if (process.env.BOTS_VERBOSE) log(`trips-greedy day ${Math.round((world.economy.elapsedSeconds - world.startSeconds) / SECONDS_PER_GAME_DAY) + 1}: ${vehicles.length} candidates, ${world.simulation.vehicles.length} vehicles on the map, ranked in ${((performance.now() - t0) / 1000).toFixed(1)} s, funds ₦${Math.round(world.economy.funds)}`);
        }
        const best = ranked.list[0];
        if (!best) return;
        if (best.price > world.economy.funds) return "blocked";
        if (!applyAction(world, best.action).ok) return "blocked";
        ranked.list.shift();
      };
    })(),
  },
];

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
  population: number;
  informalShare: number;
}

interface Run {
  persona: Persona;
  samples: Sample[];
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
    population: population(world),
    informalShare: networkShare(world).informal,
  };
}

async function play(persona: Persona): Promise<Run> {
  const world = newWorld();
  const samples: Sample[] = [];
  const blocked = new Set<number>();
  const started = performance.now();
  for (let d = 0; d < (persona.days ?? DAYS); d += 1) {
    if ((await persona.decide(world, d)) === "blocked") blocked.add(d + 1);
    runDays(world, 1);
    samples.push(sample(world));
  }
  log(`${persona.name}: ${((performance.now() - started) / 1000).toFixed(0)} s`);
  return { persona, samples, blocked };
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
    const s = at(run, d);
    const h = avgHeadline(run, d);
    return `${n(h.tripsPerDay)}${n(h.noRoadPerDay)}${n(h.noSeatPerDay)}${n(h.yourRidersPerDay)}${money(s.funds)}${money(meanNet(run, d - 4, d))}`.padEnd(42);
  });
  console.log(`${run.persona.name.padEnd(12)} ${cells.join("")}`);
}

if (process.env.CHECKS !== "0") await checks();
for (const worker of workers) worker.terminate();

// --- The measured checks (docs/brief.md, Pass/fail checks) -----------------

async function checks(): Promise<void> {
  const results: Array<[string, boolean | null, string]> = [];
  const byName = new Map(runs.map((run) => [run.persona.name, run]));
  const players = runs.filter((run) => run.persona.verbs.length > 0);
  const idle = byName.get("idle");

  // M1: at least 3 plans end day 20 within 25% of the best plan's net (days 16-20).
  if (players.length >= 3) {
    const nets = players.map((run) => ({ name: run.persona.name, net: meanNet(run, 16, 20) })).sort((x, y) => y.net - x.net);
    const best = nets[0]!.net;
    const close = nets.filter((x) => best > 0 && x.net >= best * 0.75);
    results.push(["M1 opening variety", close.length >= 3, nets.map((x) => `${x.name} ${money(x.net).trim()}`).join(", ")]);
  }

  // M2: a road to a cut-off town plus one vehicle pays back within 60 days.
  // The road: each cut-off town's best by trips unlocked per naira, the one
  // a player reading the desire lines would build.
  // M3: paving the busiest road pays back in 10-30 days; a quiet one not within 60.
  // Both against the same do-nothing twin, sampled daily for 60 days.
  log("M2/M3: twins over 60 days");
  const base = newWorld();
  const twins: Array<{ label: string; world: SliceWorld; check: "M2" | "M3busy" | "M3quiet" }> = [];
  for (const road of bestRoadPerTown(await rankedRoads(base))) {
    for (const kind of ["bus", "minibus"] as const) {
      const world = newWorld();
      if (buildRoad(world, road.action.a, road.action.b).ok && applyAction(world, { kind, a: road.action.a, b: road.action.b }).ok) {
        twins.push({ label: `road ${road.action.a}-${road.action.b} (+${Math.round(road.tripsAdded)} trips/day) + ${kind}`, world, check: "M2" });
      }
    }
  }
  const flows = probeRoadFlows();
  for (const [check, segmentId] of [["M3busy", flows.busiest], ["M3quiet", flows.quietest]] as const) {
    const chain = chainOf(base, segmentId);
    const world = newWorld();
    if (chain && paveRoad(world, chain.a, chain.b).ok) twins.push({ label: `pave ${chain.a}-${chain.b}`, world, check });
  }
  const payback = new Map<string, number | null>(twins.map((t) => [t.label, null]));
  for (let d = 1; d <= 60; d += 1) {
    runDays(base, 1);
    for (const twin of twins) {
      runDays(twin.world, 1);
      if (payback.get(twin.label) === null && twin.world.economy.funds >= base.economy.funds) payback.set(twin.label, d);
    }
  }
  const days = (label: string) => payback.get(label) ?? Infinity;
  const show = (t: { label: string }) => `${t.label}: ${Number.isFinite(days(t.label)) ? `${days(t.label)} days` : "not in 60"}`;
  const m2 = twins.filter((t) => t.check === "M2");
  results.push(["M2 building pays", m2.some((t) => days(t.label) <= 60), m2.map(show).join("; ")]);
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

  // M8: a good action moves trips made a day by at least twice its jitter,
  // both on the headline as shown: the 5-day average (docs/brief.md).
  // Jitter: the standard deviation, days 14-40, of doing nothing's 5-day
  // average around a straight-line fit. The action: the best first move
  // forecast on day 10 of doing nothing; its effect, the 5-day average of
  // trips made over the five days after it, against the twin's.
  if (idle) {
    const points = idle.samples.filter((s) => s.day >= 14).map((s) => [s.day, avgHeadline(idle, Math.round(s.day)).tripsPerDay] as const);
    const jitter = residualSd(points);
    const world = newWorld();
    runDays(world, 10);
    const candidates = vehicleMoves(world).map((m) => m.action);
    const forecasts = await forecastAll(world, candidates);
    const bestIndex = forecasts.reduce<number>((best, v, i) => (v !== null && (best < 0 || v > forecasts[best]!) ? i : best), -1);
    const action = candidates[bestIndex]!;
    const [added] = await tripsAddedOver(world, [action], 5);
    const effect = added ?? 0;
    results.push([
      "M8 signal over noise",
      effect >= 2 * jitter,
      `${action.kind} ${"a" in action ? `${action.a}-${action.b}` : ""}: +${effect.toFixed(1)} trips/day; jitter ${jitter.toFixed(1)}`,
    ]);
  }

  // M10: money limits the score -- trips-greedy, which buys whatever adds
  // the most trips per naira and doesn't mind losing money, can't afford
  // its next best move on most days, 15-60.
  const tripsGreedy = byName.get("trips-greedy");
  if (tripsGreedy) {
    const window = Array.from({ length: 46 }, (_, i) => i + 15);
    const waiting = window.filter((d) => tripsGreedy.blocked.has(d)).length;
    results.push(["M10 money limits the score", waiting > window.length / 2, `trips-greedy waited on money ${waiting} of ${window.length} days (15-60); funds day 60 ${money(at(tripsGreedy, 60).funds).trim()}`]);
  }

  // M9: no strategy that grows towns shows a falling headline while it does.
  {
    const fallers: string[] = [];
    for (const run of runs) {
      const marks = [10, 20, 40];
      const grew = at(run, 40).population > at(run, 10).population;
      const fell = marks.some((d, i) => i > 0 && avgHeadline(run, d).tripsPerDay < avgHeadline(run, marks[i - 1]!).tripsPerDay);
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
