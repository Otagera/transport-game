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
//
// Greedy forecasts every move it could afford, every day, in a worker pool:
// it's the slow one (a few minutes).
import { availableParallelism } from "node:os";
import { SLICE_MAP } from "../src/slice/map";
import { addBus, buildRoad, chainOf, createSliceWorld, headline, networkShare, paveRoad, roadChain, type Headline } from "../src/engine/slice/world";
import { sliceTick } from "../src/engine/slice/tick";
import { applyAction, type ActionSpec } from "../src/engine/slice/actions";
import { roadMoves, vehicleMoves } from "../src/engine/slice/moves";
import { lastDay } from "../src/engine/slice/ledger";
import { DEFAULT_SLICE_TUNING } from "../src/engine/slice/tuning";
import type { SliceWorld } from "../src/engine/slice/types";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY } from "../src/engine/economy/state";
import type { Trajectory } from "./slice-bots-worker";

const DAYS = 40;
const tuning = { ...DEFAULT_SLICE_TUNING, ...JSON.parse(process.env.SLICE_TUNING ?? "{}") };
const newWorld = () => createSliceWorld(SLICE_MAP, tuning);
const log = (message: string) => process.stderr.write(`  ${message}\n`);

function runDays(world: SliceWorld, days: number): void {
  const ticks = Math.round((days * SECONDS_PER_GAME_DAY) / SIM_DT);
  for (let i = 0; i < ticks; i += 1) sliceTick(world, SIM_DT);
}

const population = (world: SliceWorld) => [...world.towns.values()].reduce((sum, town) => sum + town.population, 0);

// --- Forecasts, in a worker pool ------------------------------------------

const workers = Array.from({ length: Math.max(1, availableParallelism() - 1) }, () => new Worker(new URL("./slice-bots-worker.ts", import.meta.url)));
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

// --- Personas -------------------------------------------------------------

interface Persona {
  name: string;
  /** The verbs it ever uses: one verb is a candidate for M6's one-verb win. */
  verbs: string[];
  /** Called at the start of each game day, before the day runs. */
  decide: (world: SliceWorld, day: number) => Promise<void> | void;
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

function buildCheapestRoad(world: SliceWorld): boolean {
  const affordable = roadMoves(world)
    .filter((move) => move.price <= world.economy.funds)
    .sort((x, y) => x.price - y.price);
  return affordable.length > 0 && applyAction(world, affordable[0]!.action).ok;
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
    // Roads to every cut-off town first, cheapest first; then a minibus to
    // each town it reached, then buses as naive does.
    name: "builder",
    verbs: ["road", "minibus", "bus"],
    decide: (() => {
      const built: Array<[string, string]> = [];
      return (world: SliceWorld, d: number) => {
        const moves = roadMoves(world);
        if (moves.length > 0) {
          const cheapest = [...moves].sort((x, y) => x.price - y.price)[0]!;
          if (cheapest.price <= world.economy.funds && applyAction(world, cheapest.action).ok) built.push([cheapest.action.a, cheapest.action.b]);
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
  { name: "roads only", verbs: ["road"], decide: (world) => void buildCheapestRoad(world) },
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
    verbs: ["bus", "minibus", "road"],
    decide: async (world) => {
      const actions: ActionSpec[] = [
        ...vehicleMoves(world).filter((m) => m.price <= world.economy.funds).map((m) => m.action),
        ...roadMoves(world).filter((m) => m.price <= world.economy.funds).map((m) => m.action),
      ];
      if (actions.length === 0) return;
      const money = await forecastAll(world, actions);
      let best = -1;
      for (const [i, value] of money.entries()) if (value !== null && value > 0 && (best < 0 || value > money[best]!)) best = i;
      if (best >= 0) applyAction(world, actions[best]!);
    },
  },
];

function pairOf(pair: [string, string] | null): { a: string; b: string } {
  return pair ? { a: pair[0], b: pair[1] } : { a: "", b: "" };
}

// --- Running a persona ----------------------------------------------------

interface Sample {
  day: number;
  headline: Headline;
  funds: number;
  net: number;
  population: number;
  informalShare: number;
}

interface Run {
  persona: Persona;
  samples: Sample[];
}

function sample(world: SliceWorld): Sample {
  return {
    day: world.economy.elapsedSeconds / SECONDS_PER_GAME_DAY,
    headline: headline(world),
    funds: world.economy.funds,
    net: lastDay(world.ledger).net,
    population: population(world),
    informalShare: networkShare(world).informal,
  };
}

async function play(persona: Persona): Promise<Run> {
  const world = newWorld();
  const samples: Sample[] = [];
  const started = performance.now();
  for (let d = 0; d < DAYS; d += 1) {
    await persona.decide(world, d);
    runDays(world, 1);
    samples.push(sample(world));
  }
  log(`${persona.name}: ${((performance.now() - started) / 1000).toFixed(0)} s`);
  return { persona, samples };
}

const at = (run: Run, d: number) => run.samples[d - 1]!;
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

console.log(`\nHeadline per game day (trips made / no road / no seat / your riders), funds, mean net over the 5 days before`);
console.log(`${"persona".padEnd(12)} ${[10, 20, 40].map((d) => `day ${d}`.padEnd(42)).join("")}`);
for (const run of runs) {
  const cells = [10, 20, 40].map((d) => {
    const s = at(run, d);
    const h = s.headline;
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
  // M3: paving the busiest road pays back in 10-30 days; a quiet one not within 60.
  // Both against the same do-nothing twin, sampled daily for 60 days.
  log("M2/M3: twins over 60 days");
  const base = newWorld();
  const twins: Array<{ label: string; world: SliceWorld; check: "M2" | "M3busy" | "M3quiet" }> = [];
  for (const road of roadMoves(base)) {
    for (const kind of ["bus", "minibus"] as const) {
      const world = newWorld();
      if (buildRoad(world, road.action.a, road.action.b).ok && applyAction(world, { kind, a: road.action.a, b: road.action.b }).ok) {
        twins.push({ label: `road ${road.action.a}-${road.action.b} + ${kind}`, world, check: "M2" });
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
    const i40 = at(idle, 40).headline;
    const best = [...players].sort((x, y) => at(y, 40).headline.tripsPerDay - at(x, 40).headline.tripsPerDay)[0]!;
    const b40 = at(best, 40).headline;
    const pass = b40.noRoadPerDay <= i40.noRoadPerDay / 2 && b40.tripsPerDay >= i40.tripsPerDay * 1.25;
    results.push([
      "M4 the headline moves",
      pass,
      `best ${best.persona.name}: trips ${n(b40.tripsPerDay).trim()} vs idle ${n(i40.tripsPerDay).trim()} (${pct(b40.tripsPerDay / i40.tripsPerDay - 1)}), no road ${n(b40.noRoadPerDay).trim()} vs ${n(i40.noRoadPerDay).trim()}`,
    ]);
  }

  // M5: the strategy carrying the most riders is not the one making the most money (net, days 31-40).
  if (players.length >= 2) {
    const riders = [...players].sort((x, y) => at(y, 40).headline.yourRidersPerDay - at(x, 40).headline.yourRidersPerDay)[0]!;
    const rich = [...players].sort((x, y) => meanNet(y, 31, 40) - meanNet(x, 31, 40))[0]!;
    results.push(["M5 the tension is real", riders !== rich, `most riders: ${riders.persona.name}; most money: ${rich.persona.name} (${money(meanNet(rich, 31, 40)).trim()}/day)`]);
  }

  // M6: no single-verb strategy is in the top three on both trips made and money.
  if (players.length >= 3) {
    const top = (score: (run: Run) => number) => new Set([...players].sort((x, y) => score(y) - score(x)).slice(0, 3));
    const topTrips = top((run) => at(run, 40).headline.tripsPerDay);
    const topMoney = top((run) => meanNet(run, 31, 40));
    const winners = players.filter((run) => run.persona.verbs.length === 1 && topTrips.has(run) && topMoney.has(run));
    results.push(["M6 no one-verb win", winners.length === 0, winners.length ? `one-verb in both top threes: ${winners.map((r) => r.persona.name).join(", ")}` : "none"]);
  }

  // M7: on day 1 the informal share is within 5 points of its day-10 value.
  // "Day 1" is the first moment a player reads the panel: 3 seconds in.
  {
    const world = newWorld();
    runDays(world, 0.1);
    const early = networkShare(world).informal;
    runDays(world, 9.9);
    const later = networkShare(world).informal;
    results.push(["M7 warm start", Math.abs(early - later) <= 0.05, `informal share ${pct(early)} at the start, ${pct(later)} on day 10`]);
  }

  // M8: a good action moves trips made a day by at least twice its daily jitter.
  // Jitter: the standard deviation, days 10-40, of doing nothing's trips made
  // around a straight-line fit. The action: the best first move forecast on
  // day 10 of doing nothing, measured as trips made 3 days later against the twin.
  if (idle) {
    const points = idle.samples.filter((s) => s.day >= 10).map((s) => [s.day, s.headline.tripsPerDay] as const);
    const jitter = residualSd(points);
    const world = newWorld();
    runDays(world, 10);
    const candidates = vehicleMoves(world).map((m) => m.action);
    const forecasts = await forecastAll(world, candidates);
    const bestIndex = forecasts.reduce<number>((best, v, i) => (v !== null && (best < 0 || v > forecasts[best]!) ? i : best), -1);
    const twin = structuredClone(world);
    const action = candidates[bestIndex]!;
    applyAction(world, action);
    runDays(world, 3);
    runDays(twin, 3);
    const effect = headline(world).tripsPerDay - headline(twin).tripsPerDay;
    results.push([
      "M8 signal over noise",
      effect >= 2 * jitter,
      `${action.kind} ${"a" in action ? `${action.a}-${action.b}` : ""}: +${effect.toFixed(1)} trips/day; jitter ${jitter.toFixed(1)}`,
    ]);
  }

  // M9: no strategy that grows towns shows a falling headline while it does.
  {
    const fallers: string[] = [];
    for (const run of runs) {
      const marks = [10, 20, 40].map((d) => at(run, d));
      const grew = marks[2]!.population > marks[0]!.population;
      const fell = marks.some((s, i) => i > 0 && s.headline.tripsPerDay < marks[i - 1]!.headline.tripsPerDay);
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
