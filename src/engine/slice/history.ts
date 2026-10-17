import type { SliceWorld } from "./types";
import { headline, type Headline } from "./world";
import { lastDay } from "./ledger";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

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
}

export interface DayHistory {
  days: DaySample[];
  nextDayAtSeconds: number;
}

export function createDayHistory(): DayHistory {
  return { days: [], nextDayAtSeconds: SECONDS_PER_GAME_DAY };
}

/** Called every tick; takes a sample when a game day ends. */
export function recordDay(world: SliceWorld): void {
  const { history } = world;
  if (world.economy.elapsedSeconds < history.nextDayAtSeconds - 1e-6) return;
  history.days.push({ atSeconds: world.economy.elapsedSeconds, headline: headline(world), net: lastDay(world.ledger).net });
  if (history.days.length > AVERAGE_DAYS) history.days.shift();
  history.nextDayAtSeconds += SECONDS_PER_GAME_DAY;
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
