import type { SliceWorld } from "./types";
import { headline, type Headline } from "./world";
import { lastDay } from "./ledger";
import { createBudgetTally, type BudgetTally } from "./budget";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import type { TownSample } from "./problems";

// The headline as the player reads it: 5-day averages (docs/brief.md, What
// doing well means). One day's trips made jitter by about what a good move
// adds, and one day's net swings from -₦2 to -₦255 on the same five buses
// (bots baseline), so neither is shown raw.
//
// A sample is taken at the end of every game day, warm-up days included:
// trips made averages the last five, so on day 1 it's already filled from
// the world that was running before you arrived (start.ts). Money averages
// only days since day 1 -- the warm-up isn't yours.

export const AVERAGE_DAYS = 5;

export interface DaySample {
  /** Sim time the day ended. */
  atSeconds: number;
  headline: Headline;
  /** Fares minus running costs over the day (ledger.ts). */
  net: number;
  /** The day's money by line (budget.ts): the tally's change over the day. */
  budget: BudgetTally;
}

export interface DayHistory {
  days: DaySample[];
  nextDayAtSeconds: number;
  /** The budget tally when the last day ended, to take the next day's lines from. */
  tallyAtLastDay: BudgetTally;
  /** Trips made a day (5-day average) at each day's end, for the strip's trend (score.ts); the last TRIPS_KEPT days. */
  trips: Array<{ atSeconds: number; trips: number }>;
  /** Each original town's days, to say why it's shrinking (problems.ts sampleTowns). */
  towns: Map<string, TownSample[]>;
}

const TRIPS_KEPT = 120;

export function createDayHistory(): DayHistory {
  return { days: [], nextDayAtSeconds: SECONDS_PER_GAME_DAY, tallyAtLastDay: createBudgetTally(), trips: [], towns: new Map() };
}

function tallyDifference(now: BudgetTally, then: BudgetTally): BudgetTally {
  const result = createBudgetTally();
  for (const key of Object.keys(result) as Array<keyof BudgetTally>) result[key] = now[key] - then[key];
  return result;
}

/** Called every tick; takes a sample when a game day ends, and says whether it did. */
export function recordDay(world: SliceWorld): boolean {
  const { history } = world;
  if (world.economy.elapsedSeconds < history.nextDayAtSeconds - 1e-6) return false;
  const budget = tallyDifference(world.budget, history.tallyAtLastDay);
  history.tallyAtLastDay = { ...world.budget };
  history.days.push({ atSeconds: world.economy.elapsedSeconds, headline: headline(world), net: lastDay(world.ledger).net, budget });
  if (history.days.length > AVERAGE_DAYS) history.days.shift();
  history.trips.push({ atSeconds: world.economy.elapsedSeconds, trips: averageHeadline(world).tripsPerDay });
  if (history.trips.length > TRIPS_KEPT) history.trips.shift();
  history.nextDayAtSeconds += SECONDS_PER_GAME_DAY;
  return true;
}

/** The headline averaged over the last five days; before a day has ended, as it is now. */
export function averageHeadline(world: SliceWorld): Headline {
  const days = world.history.days;
  if (days.length === 0) return headline(world);
  const mean = (pick: (h: Headline) => number) => days.reduce((sum, day) => sum + pick(day.headline), 0) / days.length;
  return {
    tripsPerDay: mean((h) => h.tripsPerDay),
    noRoadPerDay: mean((h) => h.noRoadPerDay),
    noSeatPerDay: mean((h) => h.noSeatPerDay),
    yourRidersPerDay: mean((h) => h.yourRidersPerDay),
  };
}

/** Net per day over the last five days since day 1; before day 1 has ended, the day so far. */
export function averageNet(world: SliceWorld): number {
  const yours = world.history.days.filter((day) => day.atSeconds > world.startSeconds + 1e-6);
  if (yours.length === 0) return lastDay(world.ledger).net;
  return yours.reduce((sum, day) => sum + day.net, 0) / yours.length;
}

/**
 * The budget by line, a day, averaged over the last five days since day 1
 * (the panel's breakdown): the same days as averageNet, so its lines sum to
 * the strip's net -- fares, goods, tolls, levies and allocation, less running
 * costs and upkeep. Before day 1 has ended, the day so far scaled to a day.
 */
export function averageBudget(world: SliceWorld): BudgetTally {
  const yours = world.history.days.filter((day) => day.atSeconds > world.startSeconds + 1e-6);
  const result = createBudgetTally();
  const keys = Object.keys(result) as Array<keyof BudgetTally>;
  if (yours.length === 0) {
    const seen = world.economy.elapsedSeconds - world.startSeconds;
    const scale = seen > 0 ? SECONDS_PER_GAME_DAY / seen : 0;
    for (const key of keys) result[key] = world.budget[key] * scale;
    return result;
  }
  for (const key of keys) result[key] = yours.reduce((sum, day) => sum + day.budget[key], 0) / yours.length;
  return result;
}
