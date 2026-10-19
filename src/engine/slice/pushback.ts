import type { SliceWorld } from "./types";
import type { SliceEvent } from "./settlement";
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
// A strike: for a day, no danfo sets off along the corridor (tick.ts
// sendInformal), and the strikers block the lane, so your buses are back in
// general traffic (congestion.ts). Its riders wait or stay home: "no seat"
// spikes on the corridor. Kekes and okadas, not the union's, keep running.
// Shown where it happens: the struck road and the lane's state on the map
// (render.ts), never a dialog or a meter.

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
  /** While a strike runs: when it ends, and the road pieces it covers. */
  strikeUntil: number;
  segmentIds: string[];
}

const sameCorridor = (lane: LaneState, a: string, b: string) => (lane.a === a && lane.b === b) || (lane.a === b && lane.b === a);

/** Starts a new lane strictly enforced, the union's clock set to strike `strikeDelayDays` later. */
export function openLane(world: SliceWorld, a: string, b: string): void {
  if (world.lanes.some((lane) => sameCorridor(lane, a, b))) return;
  const grievance = Math.max(0, 1 - world.tuning.strikeDelayDays / world.tuning.strikeEveryStrictDays);
  world.lanes.push({ a, b, enforcement: "strict", encroachment: 0, grievance, strikeUntil: 0, segmentIds: [] });
}

export function laneOn(world: SliceWorld, a: string, b: string): LaneState | undefined {
  return world.lanes.find((lane) => sameCorridor(lane, a, b));
}

/** Strict or lax, from now on. */
export function setEnforcement(world: SliceWorld, a: string, b: string, enforcement: Enforcement): boolean {
  const lane = laneOn(world, a, b);
  if (!lane) return false;
  lane.enforcement = enforcement;
  return true;
}

/** What strict enforcement of a lane costs a day: wardens along its length. */
export function enforcementPerDay(world: SliceWorld, lane: LaneState): number {
  const chain = roadChain(world, lane.a, lane.b) ?? [];
  const cells = chain.reduce((sum, piece) => sum + segmentLength(world, piece), 0);
  return cells * world.tuning.enforcementPerCellPerDay;
}

/** Road pieces danfos won't run on, and lanes the strikers block, today. */
export function struckSegments(world: SliceWorld): Set<string> {
  const struck = new Set<string>();
  for (const lane of world.lanes) if (lane.strikeUntil > world.economy.elapsedSeconds) for (const id of lane.segmentIds) struck.add(id);
  return struck;
}

/** How far danfos have taken the lane, by road piece, 0..1 (pieces with no lane absent). */
export function laneEncroachment(world: SliceWorld): Map<string, number> {
  const taken = new Map<string, number>();
  for (const lane of world.lanes) for (const piece of roadChain(world, lane.a, lane.b) ?? []) taken.set(piece.id, lane.encroachment);
  return taken;
}

/**
 * Called every tick: encroachment creeps in or is cleared, grievance builds
 * at the enforcement's pace, strikes begin and end. Returns strict
 * enforcement's cost this tick, to bill with the running costs, and events.
 */
export function updateLanes(world: SliceWorld, dt: number): { cost: number; events: SliceEvent[] } {
  const events: SliceEvent[] = [];
  const { tuning } = world;
  const now = world.economy.elapsedSeconds;
  const days = dt / SECONDS_PER_GAME_DAY;
  let cost = 0;
  for (const lane of world.lanes) {
    const chain = roadChain(world, lane.a, lane.b);
    // The lane's gone (or the road): nothing to hold or strike over.
    if (!chain || !chain.some((piece) => piece.busLane)) continue;
    const strict = lane.enforcement === "strict";
    lane.encroachment = strict
      ? Math.max(0, lane.encroachment - tuning.encroachmentClearPerDay * days)
      : Math.min(1, lane.encroachment + tuning.encroachmentPerDay * days);
    if (strict) cost += enforcementPerDay(world, lane) * days;
    if (lane.segmentIds.length > 0 && now >= lane.strikeUntil) {
      lane.segmentIds = [];
      events.push({ kind: "strike-over", a: lane.a, b: lane.b });
    }
    if (lane.strikeUntil > now) continue; // no grievance builds mid-strike
    lane.grievance += days / (strict ? tuning.strikeEveryStrictDays : tuning.strikeEveryLaxDays);
    if (lane.grievance < 1) continue;
    lane.grievance = 0;
    lane.segmentIds = chain.map((piece) => piece.id);
    lane.strikeUntil = now + tuning.strikeDays * SECONDS_PER_GAME_DAY;
    events.push({ kind: "strike", a: lane.a, b: lane.b });
  }
  return { cost, events };
}
