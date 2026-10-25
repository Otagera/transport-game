import { laneMood } from "./union";
import type { GameWorld } from "./types";
import type { GameEvent } from "./settlement";
import { roadChain } from "./world";
import { segmentLength } from "./roads";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// A bus lane's politics (docs/brief.md, Revision 1: "pushback arrives with
// the bus lane"; Decisions log, lane encroachment). A lane takes a
// corridor's road from the danfos, and how hard you hold it is a choice,
// made per lane:
//
//   - Strict enforcement (wardens, paid daily): the lane stays clear and
//     fast, and the union's grievance builds quickly -- strikes come often.
//   - Lax enforcement (free): danfos and okadas creep into the lane day by
//     day, wearing its speed advantage away, and the union keeps the peace
//     -- strikes come rarely.
//
// A strike: announced `strikeNoticeDays` ahead (relax enforcement before
// then and it's called off -- Decisions log, proposed); then for
// `strikeDays` no danfo sets off along the corridor (tick.ts sendInformal),
// and the strikers block the lane, so your buses are back in general traffic
// (congestion.ts). Its riders wait or stay home: "no seat" spikes on the
// corridor. Kekes and okadas, not the union's, keep running. What it cost
// is estimated against the corridor's income on the days before (your fares
// on routes along it, plus its tolls and levies) and kept as a mark on the
// road and a budget line ("Lost to strikes"). Shown where it happens (the
// map, the route and town cards), never a dialog or a meter.

export type Enforcement = "strict" | "lax";

/** A corridor with a bus lane: how it's enforced, how far danfos have taken it, the union's mood. */
export interface LaneState {
  a: string;
  b: string;
  enforcement: Enforcement;
  /** 0..1: how much of the lane the danfos and okadas have taken. */
  encroachment: number;
  /** 0..1: the union's grievance; a strike at 1. */
  grievance: number;
  /** A strike announced: when it begins (0: none), and whether the lane was strictly enforced then. */
  strikeAt: number;
  announcedStrict: boolean;
  /** While a strike runs: when it ends, and the road pieces it covers. */
  strikeUntil: number;
  segmentIds: string[];
  /** The corridor's income (your fares along it, its tolls and levies): today so far, and the last few days'. */
  incomeToday: number;
  incomeDays: number[];
  dayEndsAt: number;
  /** During a strike: the income the days before would have brought, and what came in. */
  strikeExpected: number;
  strikeIncome: number;
  /** The last strike: when it began and ended, and what it cost you (estimated; null without normal days to measure against). */
  lastStrike: { startedAt: number; endedAt: number; cost: number | null } | null;
  /** Normal days measured when the strike began: too few, and there's no estimate. */
  strikeBaselineDays: number;
}

const sameCorridor = (lane: LaneState, a: string, b: string) => (lane.a === a && lane.b === b) || (lane.a === b && lane.b === a);

/**
 * Opens a lane laxly enforced -- no wardens until you choose them (playtest:
 * "I did not put restrictions") -- with the union's answer to the lane
 * itself coming strikeDelayDays later, each new lane a few days after the
 * last so they don't all strike at once. Settling (settleStrike) or, once
 * you enforce, relaxing, calls an announced strike off.
 */
export function openLane(world: GameWorld, a: string, b: string): void {
  if (world.lanes.some((lane) => sameCorridor(lane, a, b))) return;
  const t = world.tuning;
  // The first strike lands strikeDelayDays after the lane opens (staggered
  // by STAGGER_DAYS a lane), announced strikeNoticeDays before that: the
  // grievance starts where the lax pace reaches 1 at the announcement.
  const delay = t.strikeDelayDays + STAGGER_DAYS * world.lanes.length;
  const grievance = Math.max(0, 1 - Math.max(0, delay - t.strikeNoticeDays) / t.strikeEveryLaxDays);
  const now = world.economy.elapsedSeconds;
  world.lanes.push({
    a, b, enforcement: "lax", encroachment: 0, grievance, strikeAt: 0, announcedStrict: false, strikeUntil: 0, segmentIds: [],
    incomeToday: 0, incomeDays: [], dayEndsAt: now + SECONDS_PER_GAME_DAY, strikeExpected: 0, strikeIncome: 0, lastStrike: null, strikeBaselineDays: 0,
  });
}

export function laneOn(world: GameWorld, a: string, b: string): LaneState | undefined {
  return world.lanes.find((lane) => sameCorridor(lane, a, b));
}

/** Strict or lax, from now on. */
export function setEnforcement(world: GameWorld, a: string, b: string, enforcement: Enforcement): boolean {
  const lane = laneOn(world, a, b);
  if (!lane) return false;
  lane.enforcement = enforcement;
  return true;
}

/** What strict enforcement of a lane costs a day: wardens along its length. */
export function enforcementPerDay(world: GameWorld, lane: LaneState): number {
  const chain = roadChain(world, lane.a, lane.b) ?? [];
  const cells = chain.reduce((sum, piece) => sum + segmentLength(world, piece), 0);
  return cells * world.tuning.enforcementPerCellPerDay;
}

/** Road pieces danfos won't run on, and lanes the strikers block, today. */
export function struckSegments(world: GameWorld): Set<string> {
  const struck = new Set<string>();
  for (const lane of world.lanes) if (lane.strikeUntil > world.economy.elapsedSeconds) for (const id of lane.segmentIds) struck.add(id);
  return struck;
}

/** The lane a road piece belongs to, for every laned corridor. */
export function lanesBySegment(world: GameWorld): Map<string, LaneState> {
  const by = new Map<string, LaneState>();
  for (const lane of world.lanes) for (const piece of roadChain(world, lane.a, lane.b) ?? []) by.set(piece.id, lane);
  return by;
}

/** Credits a lane's corridor with income on a path that runs along it (each lane once). */
export function creditLanes(by: ReadonlyMap<string, LaneState>, segmentIds: readonly string[], amount: number): void {
  if (by.size === 0 || amount === 0) return;
  const credited = new Set<LaneState>();
  for (const id of segmentIds) {
    const lane = by.get(id);
    if (lane && !credited.has(lane)) {
      lane.incomeToday += amount;
      credited.add(lane);
    }
  }
}

/** How far danfos have taken the lane, by road piece, 0..1 (pieces with no lane absent). */
export function laneEncroachment(world: GameWorld): Map<string, number> {
  // Kept while nothing it reads has changed: the time, the roads and every lane's ends and
  // encroachment. It was rebuilt for every road the informal sector checked, every tick --
  // a fifth of a tick in a game with four lanes (map 2418, day 83). Same answer, once.
  const key = `${world.economy.elapsedSeconds}|${world.simulation.map.segments.length}|${world.lanes.map((lane) => `${lane.a}:${lane.b}:${lane.encroachment}`).join(",")}`;
  const kept = encroachmentKept.get(world);
  if (kept && kept.key === key) return kept.taken;
  const taken = new Map<string, number>();
  for (const lane of world.lanes) for (const piece of roadChain(world, lane.a, lane.b) ?? []) taken.set(piece.id, lane.encroachment);
  encroachmentKept.set(world, { key, taken });
  return taken;
}
/** laneEncroachment's last answer (off the world, which is plain data). Read only: callers don't change it. */
const encroachmentKept = new WeakMap<GameWorld, { key: string; taken: Map<string, number> }>();

/**
 * Called every tick, after the corridor's income was credited: encroachment
 * creeps in or is cleared, grievance builds at the enforcement's pace,
 * strikes are announced, called off, begun and ended. Returns strict
 * enforcement's cost this tick (billed with the running costs), what
 * strikes that just ended cost (estimated, for "Lost to strikes"), and events.
 */
export function updateLanes(world: GameWorld, dt: number): { cost: number; lost: number; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const { tuning } = world;
  const now = world.economy.elapsedSeconds;
  const days = dt / SECONDS_PER_GAME_DAY;
  const day = SECONDS_PER_GAME_DAY;
  let cost = 0;
  let lost = 0;
  for (const lane of world.lanes) {
    const chain = roadChain(world, lane.a, lane.b);
    // The lane's gone (or the road): nothing to hold or strike over.
    if (!chain || !chain.some((piece) => piece.busLane)) continue;
    const strict = lane.enforcement === "strict";
    // The chairman's stance (union.ts): against you, his danfos take a lane back sooner and his grievance builds faster.
    const mood = laneMood(world, lane);
    lane.encroachment = strict
      ? Math.max(0, lane.encroachment - tuning.encroachmentClearPerDay * days)
      : Math.min(1, lane.encroachment + tuning.encroachmentPerDay * days * mood.encroachment);
    if (strict) cost += enforcementPerDay(world, lane) * days;
    const striking = lane.strikeUntil > now;
    // The corridor's income, a day at a time: a strike's cost is measured
    // against the days before it, so strike days don't count as normal ones.
    if (striking) {
      lane.strikeIncome += lane.incomeToday;
      lane.incomeToday = 0;
    } else if (now >= lane.dayEndsAt) {
      lane.incomeDays.push(lane.incomeToday);
      if (lane.incomeDays.length > INCOME_DAYS) lane.incomeDays.shift();
      lane.incomeToday = 0;
      lane.dayEndsAt = now + day;
    }
    if (lane.segmentIds.length > 0 && now >= lane.strikeUntil) {
      // Fewer than two normal days before it (a new lane): no honest estimate.
      const strikeCost = lane.strikeBaselineDays >= 2 ? Math.max(0, lane.strikeExpected - lane.strikeIncome) : null;
      lane.lastStrike = { startedAt: lane.strikeUntil - tuning.strikeDays * day, endedAt: now, cost: strikeCost };
      lost += strikeCost ?? 0;
      lane.segmentIds = [];
      lane.dayEndsAt = now + day;
      lane.incomeToday = 0;
      events.push({ kind: "strike-over", a: lane.a, b: lane.b, cost: strikeCost });
    }
    if (striking) continue; // no grievance builds mid-strike
    if (lane.strikeAt > 0) {
      // Announced while strict: relaxing enforcement before the day calls it off.
      if (!strict && lane.announcedStrict) {
        lane.strikeAt = 0;
        lane.grievance = 0;
        events.push({ kind: "strike-called-off", a: lane.a, b: lane.b });
      } else if (now >= lane.strikeAt) {
        lane.strikeAt = 0;
        lane.segmentIds = chain.map((piece) => piece.id);
        lane.strikeUntil = now + tuning.strikeDays * day;
        const normal = lane.incomeDays.length > 0 ? lane.incomeDays.reduce((sum, x) => sum + x, 0) / lane.incomeDays.length : 0;
        lane.strikeExpected = normal * tuning.strikeDays;
        lane.strikeBaselineDays = lane.incomeDays.length;
        lane.strikeIncome = 0;
        lane.incomeToday = 0;
        events.push({ kind: "strike", a: lane.a, b: lane.b });
      }
      continue;
    }
    lane.grievance += (days / (strict ? tuning.strikeEveryStrictDays : tuning.strikeEveryLaxDays)) * mood.grievance;
    if (lane.grievance < 1) continue;
    // Announced under lax enforcement there's nothing left to relax: that strike goes ahead.
    lane.grievance = 0;
    lane.strikeAt = now + tuning.strikeNoticeDays * day;
    lane.announcedStrict = strict;
    events.push({ kind: "strike-announced", a: lane.a, b: lane.b, atSeconds: lane.strikeAt });
  }
  return { cost, lost, events };
}

/** Days of corridor income a strike's cost is measured against. */
const INCOME_DAYS = 3;
/** Days between new lanes' first strikes. */
const STAGGER_DAYS = 3;

/** What the union asks to call off an announced strike: a share of what the strike would cost you (at least settlementMin). */
export function settlementPrice(world: GameWorld, lane: LaneState): number {
  const normal = lane.incomeDays.length > 0 ? lane.incomeDays.reduce((sum, x) => sum + x, 0) / lane.incomeDays.length : 0;
  return Math.round(Math.max(world.tuning.settlementMin, world.tuning.settlementShare * normal * world.tuning.strikeDays));
}

/**
 * Pays the union to call off an announced strike (docs/brief.md, The
 * informal sector, pushback form (a), a settlement): always open to you,
 * lax or strict. The grievance starts again from nothing.
 */
export function settleStrike(world: GameWorld, a: string, b: string): { ok: boolean; reason?: string; amount?: number } {
  const lane = laneOn(world, a, b);
  if (!lane || lane.strikeAt <= world.economy.elapsedSeconds) return { ok: false, reason: "no strike called there" };
  const price = settlementPrice(world, lane);
  if (world.economy.funds < price) return { ok: false, reason: "can't afford it" };
  world.economy.funds -= price;
  lane.strikeAt = 0;
  lane.grievance = 0;
  world.budget.settlements += price;
  return { ok: true, amount: price };
}
