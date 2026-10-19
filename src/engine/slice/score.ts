import type { SliceWorld } from "./types";
import type { SliceEvent } from "./settlement";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// The score as visible as money (docs/brief.md, After the ladder's playtest,
// 2; principles.md §6: "money is the score you see, so money is the game you
// play"). The brief's score -- trips made, and the towns you grow -- sat in
// the strip with nothing marking it, while money moved every second. Two
// marks:
//
//   - Town-growth milestones: a town passing a quarter, a half, double and
//     triple its day-1 size is an event (a toast, and a badge on the map for
//     a few days). Each fires once a game: a town that shrinks and regrows
//     doesn't earn it twice.
//   - The trips-made trend: the strip's trips made a day, against itself
//     TREND_DAYS ago, both 5-day averages (history.ts keeps the series).

/** Growth since day 1, as a fraction of the day-1 size, that counts as a milestone. */
export const MILESTONES = [0.25, 0.5, 1, 2] as const;
/** How far back the strip's trend compares, game days. */
export const TREND_DAYS = 10;
/** How long a milestone's badge stays on the map, game days. */
export const MILESTONE_BADGE_DAYS = 3;

export interface MilestoneState {
  /** How many of MILESTONES the town has passed. */
  reached: number;
  /** When it passed the last one. */
  atSeconds: number;
}

/** "+25%", "+50%", "×2", "×3". */
export function milestoneLabel(index: number): string {
  const fraction = MILESTONES[index]!;
  return fraction < 1 ? `+${Math.round(fraction * 100)}%` : `×${fraction + 1}`;
}

/** Called every tick, after the towns grow: each original town passing its next milestone. */
export function updateMilestones(world: SliceWorld): SliceEvent[] {
  const events: SliceEvent[] = [];
  for (const [townId, start] of world.startPopulation) {
    const town = world.towns.get(townId);
    if (!town || start <= 0) continue;
    const state = world.milestones.get(townId) ?? { reached: 0, atSeconds: 0 };
    let reached = state.reached;
    while (reached < MILESTONES.length && town.population >= start * (1 + MILESTONES[reached]!)) reached += 1;
    if (reached === state.reached) continue;
    world.milestones.set(townId, { reached, atSeconds: world.economy.elapsedSeconds });
    events.push({ kind: "milestone", townId, name: town.name, index: reached - 1, from: start, to: town.population });
  }
  return events;
}

/** A town's milestone badge for the map, while it's fresh: its label, else null. */
export function freshMilestone(world: SliceWorld, townId: string): string | null {
  const state = world.milestones.get(townId);
  if (!state || state.reached === 0) return null;
  if (world.economy.elapsedSeconds - state.atSeconds > MILESTONE_BADGE_DAYS * SECONDS_PER_GAME_DAY) return null;
  return milestoneLabel(state.reached - 1);
}

/**
 * People the region has gained since day 1, thousands: every town's change,
 * shrinking ones included (the strip's number, unlike the allocation's
 * growthSinceStart, which only pays on growth); a town founded since counts
 * whole and one emptied out counts its loss.
 */
export function peopleSinceStart(world: SliceWorld): number {
  let now = 0;
  for (const town of world.towns.values()) now += town.population;
  let then = 0;
  for (const population of world.startPopulation.values()) then += population;
  return now - then;
}

export interface TripsTrend {
  /** Trips made a day now (5-day average). */
  now: number;
  /** Its change since TREND_DAYS ago (or since day 1, if sooner). */
  change: number;
  /** The 5-day average at each day's end since day 1, oldest first, ending with now. */
  series: number[];
}

/** The strip's trend: trips made against TREND_DAYS ago. Null before a day has ended since day 1. */
export function tripsTrend(world: SliceWorld): TripsTrend | null {
  // From the last sample at or before day 1 (the world as you found it) on.
  const all = world.history.trips;
  let first = all.findIndex((sample) => sample.atSeconds > world.startSeconds + 1e-6);
  if (first === -1) return null;
  first = Math.max(0, first - 1);
  const series = all.slice(first).map((sample) => sample.trips);
  if (series.length < 2) return null;
  const now = series[series.length - 1]!;
  const then = series[Math.max(0, series.length - 1 - TREND_DAYS)]!;
  return { now, change: now - then, series };
}
