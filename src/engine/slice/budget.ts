import type { SliceWorld } from "./types";
import { isYourRoad } from "./upkeep";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// The budget's other income lines (docs/brief.md, Money: a budget, not a
// score). Fares are fares.ts. Here:
//
// - Tolls: every informal vehicle on a road you built or paved pays, by its
//   road space, and passes it on to its riders (tick.ts sendInformal: some
//   of them stay home). Your own vehicles don't pay.
// - Park levies: every informal departure pays by its seats; the agberos
//   keep their cut first (tick.ts).
// - The state's allocation: a small base a day, plus a share of the growth
//   you caused -- people added to the towns since day 1, and a new town
//   counts whole.

/** This tick's takings from the informal sector, to the funds and the tally. */
export interface Takings {
  tolls: number;
  levies: number;
  /** The agberos' cut of the levies: never yours, kept to be shown. */
  agberos: number;
}

/**
 * Money since day 1, by line: what came in, the agberos' cut (never yours,
 * kept to be shown), what went out, and what the treasury took. The panel's
 * budget breakdown (docs/brief.md, Information design) is its 5-day average
 * (history.ts averageBudget).
 */
export interface BudgetTally {
  /** Passenger fares. */
  fares: number;
  /** Goods carried (lorries, freight trains): off in slice zero. */
  goods: number;
  tolls: number;
  levies: number;
  agberos: number;
  allocation: number;
  /** Your vehicles' running costs, rough roads included. */
  running: number;
  /** Road upkeep: routine on the roads you built or paved, plus wear repairs when wear is on. */
  upkeep: number;
  /** Wardens keeping your bus lanes clear (pushback.ts, strict enforcement). */
  enforcement: number;
  /** Paid to the treasury (remittance): money out, but not a running cost. */
  remitted: number;
}

export function createBudgetTally(): BudgetTally {
  return { fares: 0, goods: 0, tolls: 0, levies: 0, agberos: 0, allocation: 0, running: 0, upkeep: 0, enforcement: 0, remitted: 0 };
}

/** The current remittance period: when it ends, and its net so far (income minus running costs). */
export interface RemittancePeriod {
  endsAtSeconds: number;
  net: number;
  /** What the last period's end took, and when; null before the first. */
  last: { amount: number; atSeconds: number } | null;
}

export function createRemittancePeriod(nowSeconds: number, tuning: { remittancePeriodDays: number }): RemittancePeriod {
  return { endsAtSeconds: nowSeconds + tuning.remittancePeriodDays * SECONDS_PER_GAME_DAY, net: 0, last: null };
}

/**
 * The treasury remittance (brief, Decisions log; as reported, Nigeria's
 * Fiscal Responsibility Act 2007: a corporation remits 80% of its operating
 * surplus and keeps 20%). Every period the state takes a share of your
 * funds above a reserve, never more than the period's net surplus; a
 * deficit pays nothing. So an opening is never touched, saving for a
 * project bigger than one period's surplus stays possible (it's the funds
 * above the reserve that are taxed, not each period's whole surplus), and
 * a fleet that pays for itself can't compound without limit -- the
 * snowball M10 measured. Returns what was taken this tick.
 */
export function remit(world: SliceWorld, netThisTick: number): number {
  const { tuning } = world;
  if (!tuning.remittanceEnabled) return 0;
  const period = world.remittance;
  period.net += netThisTick;
  if (world.economy.elapsedSeconds < period.endsAtSeconds - 1e-6) return 0;
  const above = world.economy.funds - tuning.remittanceReserve;
  const taken = Math.max(0, tuning.remittanceShare * Math.min(above, period.net));
  world.economy.funds -= taken;
  world.budget.remitted += taken;
  world.remittance = { ...createRemittancePeriod(period.endsAtSeconds, tuning), last: { amount: taken, atSeconds: world.economy.elapsedSeconds } };
  return taken;
}

/** The toll an informal vehicle of road space `weight` pays for a path: each road of yours on it. */
export function tollFor(world: SliceWorld, segmentIds: readonly string[], weight: number): number {
  let roads = 0;
  for (const id of segmentIds) {
    const segment = world.simulation.map.segments.find((candidate) => candidate.id === id);
    if (segment && isYourRoad(segment)) roads += 1;
  }
  return roads * world.tuning.tollPerRoad * weight;
}

/** Thousands of people the towns have gained since day 1; a town founded since counts whole. */
export function growthSinceStart(world: SliceWorld): number {
  let grown = 0;
  for (const town of world.towns.values()) grown += Math.max(0, town.population - (world.startPopulation.get(town.id) ?? 0));
  return grown;
}

/** The state's allocation a game day: the base, plus the growth you caused. */
export function allocationPerDay(world: SliceWorld): number {
  return world.tuning.allocationBase + world.tuning.allocationPerThousand * growthSinceStart(world);
}
