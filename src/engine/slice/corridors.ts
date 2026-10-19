import type { SliceWorld } from "./types";
import type { SliceEvent } from "./settlement";
import type { OutcomeRates } from "./types";
import { chainOf, emptyOutcome, roadPath, routeKey } from "./world";
import { laneOn } from "./pushback";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// Each corridor's informal share, and "corridor taken" as a visible state
// (docs/brief.md, After the ladder's playtest, 3; principles.md §6: "whether
// paratransit can be pushed off a corridor, and what that costs, isn't
// something the game shows"). A corridor is a whole road between two towns,
// through any roadside towns on it (world.ts chainOf) -- the unit of the
// story.
//
//   - Its share: of the trips whose road path runs along it, who carried
//     them -- you, the informal sector, or nobody.
//   - Taken: you carry at least `corridorTakenShare` of them (the brief's
//     pushback threshold, ~40%). Judged once a game day, and let go only
//     below `corridorReleaseShare`, so a corridor near the line doesn't
//     flicker; the day it was taken is kept for the story.
//   - Its costs: the park levies the danfos along it no longer pay you --
//     what reaches you from departures along it now, against the day you
//     started running along it -- and, where it has a bus lane, the union's strikes
//     (pushback.ts). Taking a corridor without a lane brings no pushback
//     yet: the union answers lanes, not shares.

export interface CorridorState {
  a: string;
  b: string;
  /** Park levies reaching you from informal departures along it, ₦ a second (rolling over LEVY_TAU_DAYS). */
  levyRateEMA: number;
  /**
   * levyRateEMA the first day you ran along it (since day 1): the levies
   * before you. Against a peak instead, a day's lumpy departures read as ₦3-10
   * a day "lost" on corridors you'd never touched (probe).
   */
  levyBefore: number | null;
  /** When you took it; null while you haven't. */
  takenSince: number | null;
  /** The last time it was taken or lost, and which: the map tags a change, not a state (corridorChanges). */
  changedAt: number | null;
  change: "taken" | "lost" | null;
}

export interface CorridorSummary {
  key: string;
  a: string;
  b: string;
  /** Trips along it a day, by outcome. */
  perDay: OutcomeRates;
  /** Shares of the trips along it, 0..1: you, the informal sector, stayed home. */
  you: number;
  informal: number;
  lost: number;
  takenSince: number | null;
  /** Park levies a day you've lost on it since you started running along it. */
  leviesLostPerDay: number;
  /** What the union's strikes on its bus lane cost you, the last one; null without a lane or a strike. */
  lastStrikeCost: number | null;
  hasLane: boolean;
}

// segmentId -> corridor key, rebuilt when the roads change (a road built, or
// split by a town growing on it).
const keyCache = new WeakMap<SliceWorld, { signature: string; keys: Map<string, string> }>();

function signature(world: SliceWorld): string {
  return `${world.simulation.map.segments.length}:${world.settlement.emergent.size}:${world.ruins.size}`;
}

function corridorKeys(world: SliceWorld): Map<string, string> {
  const sig = signature(world);
  const cached = keyCache.get(world);
  if (cached?.signature === sig) return cached.keys;
  const keys = new Map<string, string>();
  for (const segment of world.simulation.map.segments) {
    if (segment.type !== "road" || keys.has(segment.id)) continue;
    const chain = chainOf(world, segment.id);
    if (!chain) continue;
    const key = routeKey(chain.a, chain.b);
    for (const piece of chain.pieces) keys.set(piece.id, key);
    if (!world.corridors.has(key)) world.corridors.set(key, { a: chain.a, b: chain.b, levyRateEMA: 0, levyBefore: null, takenSince: null, changedAt: null, change: null });
  }
  keyCache.set(world, { signature: sig, keys });
  return keys;
}

/** The corridors a path runs along, each once. */
export function corridorsAlong(world: SliceWorld, segmentIds: readonly string[]): Set<string> {
  const keys = corridorKeys(world);
  const along = new Set<string>();
  for (const id of segmentIds) {
    const key = keys.get(id);
    if (key) along.add(key);
  }
  return along;
}

/** Trips along each corridor, by outcome (per second): every pair whose road path runs along it. */
function outcomesByCorridor(world: SliceWorld): Map<string, OutcomeRates> {
  corridorKeys(world);
  const result = new Map<string, OutcomeRates>();
  for (const key of world.corridors.keys()) result.set(key, emptyOutcome());
  for (const [pair, rates] of world.pairOutcomes) {
    const separator = pair.indexOf(":");
    const path = roadPath(world, pair.slice(0, separator), pair.slice(separator + 1));
    if (!path) continue;
    for (const key of corridorsAlong(world, path.segmentIds)) {
      const sum = result.get(key);
      if (!sum) continue;
      sum.player += rates.player;
      sum.poached += rates.poached;
      sum.gaveUp += rates.gaveUp;
      sum.lost += rates.lost;
    }
  }
  return result;
}

const shareOf = (rates: OutcomeRates) => {
  const informal = rates.poached + rates.gaveUp;
  const total = rates.player + informal + rates.lost;
  return total > 0 ? { you: rates.player / total, informal: informal / total, lost: rates.lost / total } : { you: 0, informal: 0, lost: 0 };
};

/** Departures are lumpy: a corridor's levies roll over a few days. */
const LEVY_TAU_DAYS = 3;
/** Your share of its trips above which you run along a corridor. */
const RUNNING_ALONG = 0.005;

const nextJudgedAt = new WeakMap<SliceWorld, number>();

/**
 * Called every tick with the levies reaching you this tick by corridor:
 * rolls each corridor's levy rate, and once a game day judges which are
 * taken. Returns the takings and losings as events.
 */
export function updateCorridors(world: SliceWorld, dt: number, levies: ReadonlyMap<string, number>): SliceEvent[] {
  corridorKeys(world);
  const alpha = 1 - Math.exp(-dt / (LEVY_TAU_DAYS * SECONDS_PER_GAME_DAY));
  for (const [key, corridor] of world.corridors) corridor.levyRateEMA += ((levies.get(key) ?? 0) / dt - corridor.levyRateEMA) * alpha;
  const due = nextJudgedAt.get(world) ?? 0;
  if (world.economy.elapsedSeconds < due - 1e-6) return [];
  nextJudgedAt.set(world, world.economy.elapsedSeconds + SECONDS_PER_GAME_DAY);
  const { corridorTakenShare, corridorReleaseShare } = world.tuning;
  const events: SliceEvent[] = [];
  for (const [key, rates] of outcomesByCorridor(world)) {
    const corridor = world.corridors.get(key)!;
    const you = shareOf(rates).you;
    if (corridor.levyBefore === null && you >= RUNNING_ALONG) corridor.levyBefore = corridor.levyRateEMA;
    if (corridor.takenSince === null && you >= corridorTakenShare) {
      corridor.takenSince = world.economy.elapsedSeconds;
      corridor.changedAt = world.economy.elapsedSeconds;
      corridor.change = "taken";
      events.push({ kind: "corridor-taken", a: corridor.a, b: corridor.b, share: you });
    } else if (corridor.takenSince !== null && you < corridorReleaseShare) {
      corridor.takenSince = null;
      corridor.changedAt = world.economy.elapsedSeconds;
      corridor.change = "lost";
      events.push({ kind: "corridor-released", a: corridor.a, b: corridor.b, share: you });
    }
  }
  return events;
}

/** Day 1: the warm-up's peaks and judgements aren't yours. */
export function resetCorridors(world: SliceWorld): void {
  for (const corridor of world.corridors.values()) {
    corridor.levyBefore = null;
    corridor.takenSince = null;
    corridor.changedAt = null;
    corridor.change = null;
  }
  nextJudgedAt.set(world, world.economy.elapsedSeconds + SECONDS_PER_GAME_DAY);
}

/** Every corridor with trips along it, the ones you've taken or run along first, then by your share. */
export function corridorSummaries(world: SliceWorld): CorridorSummary[] {
  const result: CorridorSummary[] = [];
  for (const [key, rates] of outcomesByCorridor(world)) {
    const corridor = world.corridors.get(key)!;
    const share = shareOf(rates);
    const lane = laneOn(world, corridor.a, corridor.b);
    result.push({
      key,
      a: corridor.a,
      b: corridor.b,
      perDay: { player: rates.player * SECONDS_PER_GAME_DAY, poached: rates.poached * SECONDS_PER_GAME_DAY, gaveUp: rates.gaveUp * SECONDS_PER_GAME_DAY, lost: rates.lost * SECONDS_PER_GAME_DAY },
      ...share,
      takenSince: corridor.takenSince,
      leviesLostPerDay: corridor.levyBefore === null ? 0 : Math.max(0, corridor.levyBefore - corridor.levyRateEMA) * SECONDS_PER_GAME_DAY,
      lastStrikeCost: lane?.lastStrike?.cost ?? null,
      hasLane: lane !== undefined,
    });
  }
  return result.sort((x, y) => Number(y.takenSince !== null) - Number(x.takenSince !== null) || y.you - x.you);
}

/** The corridors you've taken. */
export function takenCorridors(world: SliceWorld): CorridorState[] {
  return [...world.corridors.values()].filter((corridor) => corridor.takenSince !== null);
}

/** How long the map tags a corridor taken or lost, game days. */
export const CORRIDOR_TAG_DAYS = 3;

/**
 * Corridors taken or lost in the last CORRIDOR_TAG_DAYS, for the map's tag:
 * a change, not a state. Tagging every taken corridor for good put about 17
 * tags on a day-300 map, some over town names (playtest, R1 4-6); the ones
 * that stay taken are in the panel's Corridors section.
 */
export function corridorChanges(world: SliceWorld): CorridorState[] {
  const now = world.economy.elapsedSeconds;
  return [...world.corridors.values()].filter((c) => c.changedAt !== null && now - c.changedAt <= CORRIDOR_TAG_DAYS * SECONDS_PER_GAME_DAY);
}
