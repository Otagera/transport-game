import type { SliceWorld } from "./types";
import { isYourRoad } from "./upkeep";
import { heldForProject } from "./project";
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
  /** The levies reaching you, by the corridors the departure runs along (corridors.ts). */
  leviesByCorridor: Map<string, number>;
  /** Loading levies on truckers' loads at markets and the port (truckers.ts): yours, and the touts' cut. */
  loading: number;
  touts: number;
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
  /** Fuel above the pump price where towns are short (fuel.ts): part of running, kept apart to be shown. */
  fuel: number;
  /** Road upkeep: routine on the roads you built or paved, plus wear repairs when wear is on. */
  upkeep: number;
  /** Wardens keeping your bus lanes clear (pushback.ts, strict enforcement). */
  enforcement: number;
  /** Paid to the union to call strikes off (pushback.ts settleStrike): a one-off, like a purchase. */
  settlements: number;
  /** What strikes cost you, estimated against the days before (pushback.ts): not money moved -- the fares and takings that didn't come. */
  struck: number;
  /** Paid to the treasury (remittance): money out, but not a running cost. */
  remitted: number;
  /** Lent you by bonds, and repaid on them (bonds.ts): neither is income or a running cost. */
  borrowed: number;
  bonds: number;
  /** Loading levies on truckers' loads (truckers.ts), and the touts' cut (never yours, kept to be shown). */
  loading: number;
  touts: number;
}

export function createBudgetTally(): BudgetTally {
  return { fares: 0, goods: 0, tolls: 0, levies: 0, agberos: 0, allocation: 0, running: 0, fuel: 0, upkeep: 0, enforcement: 0, settlements: 0, struck: 0, remitted: 0, borrowed: 0, bonds: 0, loading: 0, touts: 0 };
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
 * snowball M10 measured. Returns what was taken when a period ends this
 * tick (0 included: the treasury came and found nothing), null otherwise.
 */
export function remit(world: SliceWorld, netThisTick: number): number | null {
  const { tuning } = world;
  if (!tuning.remittanceEnabled) return null;
  const period = world.remittance;
  period.net += netThisTick;
  if (world.economy.elapsedSeconds < period.endsAtSeconds - 1e-6) return null;
  const taken = remittanceDue(world);
  world.economy.funds -= taken;
  world.budget.remitted += taken;
  world.remittance = { ...createRemittancePeriod(period.endsAtSeconds, tuning), last: { amount: taken, atSeconds: world.economy.elapsedSeconds } };
  return taken;
}

/**
 * The treasury's levy (brief, Revision 3, money, from the step 2 playtest):
 * a steady share of what you earn -- fares, goods, tolls, park and loading
 * levies; not the state's own allocation -- taken as you earn it, in place
 * of the remittance's 80% of the surplus. The remittance took nearly every
 * naira above the reserve, so a project bigger than a period's surplus
 * could never be saved for (map 2791: ₦31,861 the most held, the refinery
 * ₦60,000). A share of income still holds the snowball (M10) -- it grows
 * with the network -- and it's on every naira, so it's read, not suffered.
 * Returns what it took this tick.
 */
export function treasuryLevy(world: SliceWorld, earned: number): number {
  const { tuning } = world;
  if (!tuning.levyEnabled || earned <= 0) return 0;
  const taken = tuning.levyShare * earned;
  world.economy.funds -= taken;
  world.budget.remitted += taken;
  return taken;
}

/**
 * What the treasury would take if the period ended now: its share of the
 * funds above the reserve, never more than the period's net so far, and
 * never money held toward a named project (project.ts). The countdown in
 * the panel shows it (brief, After the ladder's playtest: "the treasury
 * visible").
 */
export function remittanceDue(world: SliceWorld): number {
  const { tuning } = world;
  if (!tuning.remittanceEnabled) return 0;
  const above = world.economy.funds - tuning.remittanceReserve - heldForProject(world);
  return Math.max(0, tuning.remittanceShare * Math.min(above, world.remittance.net));
}

/**
 * What the period's end will take if the money keeps coming as it does:
 * remittanceDue with the funds and the period's net carried forward to the
 * end at `netPerDay` (the strip's 5-day net). Read in the middle of a period,
 * remittanceDue alone named a fraction of what went -- ₦17 on day 11, then
 * ₦8,383 taken on day 20 (browser check) -- so the countdown says this.
 */
export function remittanceExpected(world: SliceWorld, netPerDay: number): number {
  const { tuning } = world;
  if (!tuning.remittanceEnabled) return 0;
  const days = Math.max(0, (world.remittance.endsAtSeconds - world.economy.elapsedSeconds) / SECONDS_PER_GAME_DAY);
  const gain = netPerDay * days;
  const funds = world.economy.funds + gain;
  // What a project holds at the end: as much of its price as the funds above the reserve will cover then.
  const held = world.project ? Math.max(0, Math.min(world.project.price, funds - tuning.remittanceReserve)) : 0;
  return Math.max(0, tuning.remittanceShare * Math.min(funds - tuning.remittanceReserve - held, world.remittance.net + gain));
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
  for (const town of world.towns.values()) if (!town.industry) grown += Math.max(0, town.population - (world.startPopulation.get(town.id) ?? 0));
  return grown;
}

/** The state's allocation a game day: the base, plus the growth you caused. */
export function allocationPerDay(world: SliceWorld): number {
  return world.tuning.allocationBase + world.tuning.allocationPerThousand * growthSinceStart(world);
}
