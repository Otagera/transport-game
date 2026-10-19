import { applyAction, type ActionSpec } from "./actions";
import { corridorSummaries } from "./corridors";
import { generatedSliceMap } from "./generate";
import { lorrySummaries } from "./goods";
import { averageHeadline, averageNet } from "./history";
import { peopleSinceStart } from "./score";
import type { SliceEvent } from "./settlement";
import { startSliceGame } from "./start";
import { sliceTick } from "./tick";
import { ALL_SYSTEMS_ON, DEFAULT_SLICE_TUNING } from "./tuning";
import type { SliceMapDef, SliceTuning, SliceWorld } from "./types";
import { diagnoseRoute, gameDay, routeSummaries } from "./world";
import { SIM_DT } from "../loop";

// A run file: one played game, saved from the page ("Save run") so it can
// be read by hand or by a script (scripts/slice-run.ts) when answering a
// playtest's questions. Two halves:
//
//   - what you did: the seed, the systems switched on or off, and every
//     action as plain data with the tick it happened after. The sim is
//     deterministic (the only randomness is the seed, generate.ts), so
//     replayRun rebuilds the world at any tick -- exactly, as the receipts
//     and forecasts already rely on;
//   - what it looked like: one row a game day of the numbers the screen
//     shows (strip, routes, towns, corridors, lanes, quarries, events), so a
//     question about day 120 needs no replay at all.
//
// Every action the page takes goes through act() as an ActionSpec, so
// what's recorded is exactly what ran.

export const RUN_FORMAT = "transport-slice-run";

/** Which systems run, as the page's address set them (?systems=all, ?goods=off, ?wear=off). */
export interface RunSwitches {
  all: boolean;
  goodsOff: boolean;
  wearOff: boolean;
}

export interface RunAction {
  /** Sim ticks run since the game started (after the warm-up) when it was taken. */
  tick: number;
  day: number;
  action: ActionSpec;
}

export interface RunDay {
  day: number;
  funds: number;
  /** The strip's numbers: net and the headline are 5-day averages, a day. */
  netPerDay: number;
  tripsMade: number;
  yourRiders: number;
  informal: number;
  noRoad: number;
  noSeat: number;
  /** People the towns have gained since day 1, thousands. */
  people: number;
  /** The budget's running totals since day 1 (budget.ts). */
  budget: Record<string, number>;
  routes: Array<{ id: string; a: string; b: string; vehicles: number; netPerDay: number; verdict: string | null }>;
  lorries: Array<{ id: string; a: string; b: string; vehicles: number; netPerDay: number }>;
  towns: Array<{ id: string; name: string; population: number }>;
  corridors: Array<{ a: string; b: string; you: number; informal: number; lost: number; taken: boolean; lane: boolean }>;
  lanes: Array<{ a: string; b: string; enforcement: string; encroachment: number }>;
  industries: Array<{ id: string; kind: string }>;
  /** What the game announced that day (founded towns, strikes, quarries, the treasury...). */
  events: SliceEvent[];
}

export interface RunFile {
  format: typeof RUN_FORMAT;
  version: 1;
  savedAt: string;
  seed: number;
  switches: RunSwitches;
  /** ?dev=1&funds=: the starting money it set, else null. */
  devFunds: number | null;
  /** Ticks run when saved. */
  ticks: number;
  actions: RunAction[];
  days: RunDay[];
}

/** The tuning a run's switches give: the page's rule, kept in one place so a replay can't disagree. */
export function runTuning(switches: RunSwitches): SliceTuning {
  return {
    ...DEFAULT_SLICE_TUNING,
    ...(switches.all ? ALL_SYSTEMS_ON : {}),
    ...(switches.goodsOff ? { goodsEnabled: false } : {}),
    ...(switches.wearOff ? { wearEnabled: false } : {}),
  };
}

/** A new game as the page starts it: the seed's map, the switches, the warm-up, any dev funds. */
export function startRun(base: SliceMapDef, seed: number, switches: RunSwitches, devFunds: number | null): SliceWorld {
  const world = startSliceGame(generatedSliceMap(base, seed), runTuning(switches));
  if (devFunds !== null) world.economy.funds = devFunds;
  return world;
}

export interface RunRecorder {
  file: RunFile;
  ticks: number;
  pending: SliceEvent[];
  lastDay: number;
}

export function createRunRecorder(world: SliceWorld, seed: number, switches: RunSwitches, devFunds: number | null): RunRecorder {
  return {
    file: { format: RUN_FORMAT, version: 1, savedAt: "", seed, switches, devFunds, ticks: 0, actions: [], days: [] },
    ticks: 0,
    pending: [],
    lastDay: gameDay(world),
  };
}

/** An action that happened: recorded after the ticks run so far. */
export function recordAction(recorder: RunRecorder, world: SliceWorld, action: ActionSpec): void {
  recorder.file.actions.push({ tick: recorder.ticks, day: gameDay(world), action: structuredClone(action) });
}

/** After each sim tick: its events, and a day's row whenever a day ends. */
export function recordTick(recorder: RunRecorder, world: SliceWorld, events: SliceEvent[]): void {
  recorder.ticks += 1;
  recorder.pending.push(...events);
  const day = gameDay(world);
  if (day === recorder.lastDay) return;
  recorder.file.days.push(daySummary(world, recorder.lastDay, recorder.pending));
  recorder.pending = [];
  recorder.lastDay = day;
}

/** The file to save: everything so far, stamped. */
export function runFile(recorder: RunRecorder): RunFile {
  return { ...recorder.file, savedAt: new Date().toISOString(), ticks: recorder.ticks };
}

/** One game day as the screen showed it at its end. */
export function daySummary(world: SliceWorld, day: number, events: SliceEvent[]): RunDay {
  const h = averageHeadline(world);
  const round = (x: number, places = 0) => Number(x.toFixed(places));
  return {
    day,
    funds: round(world.economy.funds),
    netPerDay: round(averageNet(world)),
    tripsMade: round(h.tripsPerDay),
    yourRiders: round(h.yourRidersPerDay),
    informal: round(h.tripsPerDay - h.yourRidersPerDay),
    noRoad: round(h.noRoadPerDay),
    noSeat: round(h.noSeatPerDay),
    people: round(peopleSinceStart(world), 1),
    budget: Object.fromEntries(Object.entries(world.budget).map(([key, value]) => [key, round(value)])),
    routes: routeSummaries(world).map((r) => ({ id: r.id, a: r.a, b: r.b, vehicles: r.buses, netPerDay: round(r.netPerDay), verdict: diagnoseRoute(world, r.id)?.verdict ?? null })),
    lorries: lorrySummaries(world).map((r) => ({ id: r.id, a: r.a, b: r.b, vehicles: r.lorries, netPerDay: round(r.netPerDay) })),
    towns: [...world.towns.values()].map((t) => ({ id: t.id, name: t.name, population: round(t.population, 1) })),
    corridors: corridorSummaries(world).map((c) => ({ a: c.a, b: c.b, you: round(c.you, 2), informal: round(c.informal, 2), lost: round(c.lost, 2), taken: c.takenSince !== null, lane: c.hasLane })),
    lanes: world.lanes.map((l) => ({ a: l.a, b: l.b, enforcement: l.enforcement, encroachment: round(l.encroachment, 2) })),
    industries: [...world.industries.values()].map((i) => ({ id: i.id, kind: i.kind })),
    events: structuredClone(events),
  };
}

/**
 * Rebuilds a run's world after `untilTick` ticks (all of it by default):
 * the same start, every recorded action after the same tick, the same
 * ticks. `onTick` sees the world after each tick, for a script that wants
 * to look along the way.
 */
export function replayRun(base: SliceMapDef, file: RunFile, untilTick = file.ticks, onTick?: (world: SliceWorld, tick: number) => void): SliceWorld {
  const world = startRun(base, file.seed, file.switches, file.devFunds);
  let next = 0;
  for (let tick = 0; ; tick += 1) {
    while (next < file.actions.length && file.actions[next]!.tick === tick) {
      applyAction(world, file.actions[next]!.action);
      next += 1;
    }
    if (tick >= untilTick) break;
    sliceTick(world, SIM_DT);
    onTick?.(world, tick + 1);
  }
  return world;
}
