import type { GameWorld } from "./types";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// The budget-year sweep (docs/brief.md, Revision 4, 3 -- a trial). Unspent
// budget lapses to the treasury at the end of the year, as it does here.
// Every `sweepPeriodDays`, cash above your carry-over goes back: the carry-
// over is the larger of `sweepCarryMin` and your named project's price, plus
// whatever you borrowed this year (a bond's money is for its purpose). Played
// well it never takes a naira -- it stops hoarding (the strategist held
// ₦150-590k by day 250 with nothing to buy). *If it plays like the 80% cut
// did, a confusing tax on progress, it comes out.*

export interface SweepState {
  /** When this budget year ends. */
  endsAtSeconds: number;
  /** Lent by bonds this year: safe from the sweep. */
  borrowed: number;
  /** The last sweep: what went, and when. */
  last: { amount: number; atSeconds: number } | null;
}

export function createSweepState(nowSeconds: number, periodDays: number): SweepState {
  return { endsAtSeconds: nowSeconds + periodDays * SECONDS_PER_GAME_DAY, borrowed: 0, last: null };
}

/** What you may hold past the year's end. */
export function carryOver(world: GameWorld): number {
  const t = world.tuning;
  return Math.max(t.sweepCarryMin, world.project?.price ?? 0) + world.sweep.borrowed;
}

/** What would go back if the year ended now. */
export function sweepDue(world: GameWorld): number {
  if (!world.tuning.sweepEnabled) return 0;
  return Math.max(0, world.economy.funds - carryOver(world));
}

/** Every tick: at the year's end, the cash above the carry-over goes back. Returns what went (0 included) when a year ends this tick, else null. */
export function updateSweep(world: GameWorld): number | null {
  const t = world.tuning;
  if (!t.sweepEnabled || world.economy.elapsedSeconds < world.sweep.endsAtSeconds - 1e-6) return null;
  const taken = sweepDue(world);
  world.economy.funds -= taken;
  world.budget.swept += taken;
  world.sweep = { ...createSweepState(world.sweep.endsAtSeconds, t.sweepPeriodDays), last: { amount: taken, atSeconds: world.economy.elapsedSeconds } };
  return taken;
}
