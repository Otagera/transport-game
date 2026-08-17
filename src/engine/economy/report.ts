import { SECONDS_PER_GAME_DAY } from "./state";
import type { EconomyState, RouteLedgerEntry } from "./types";

export interface RoutePnL extends RouteLedgerEntry {
  net: number;
}

// Per-route P&L, worst-first sorted (docs/rebuild-plan.md §6 Module 6):
// "you can tell which route is bleeding in under ten seconds." Cost here
// is ongoing operating cost only, not the one-time purchase price -- a
// route's day-to-day burn is a different question than whether buying
// the vehicle was a good capital decision.
export function computeRoutePnL(state: EconomyState): RoutePnL[] {
  const rows: RoutePnL[] = [];
  for (const entry of state.ledger.values()) {
    rows.push({ ...entry, net: entry.revenue - entry.cost });
  }
  rows.sort((a, b) => a.net - b.net);
  return rows;
}

export interface BurnRate {
  incomePerDay: number;
  costPerDay: number;
  netPerDay: number;
}

export function computeBurnRate(state: EconomyState): BurnRate {
  const incomePerDay = state.incomeRateEMA * SECONDS_PER_GAME_DAY;
  const costPerDay = state.costRateEMA * SECONDS_PER_GAME_DAY;
  return { incomePerDay, costPerDay, netPerDay: incomePerDay - costPerDay };
}
