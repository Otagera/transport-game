import { SECONDS_PER_GAME_DAY } from "../economy/state";

// The money numbers the player reads: exact totals over the last game day,
// not exponential averages.
//
// Fares arrive in lumps -- a bus unloads twenty riders at once, a lorry
// thirty tonnes -- so a short average swings with every arrival. The lever
// audit (scripts/game-lever-audit.ts) measured the strip's net/day
// jittering ±₦135 a day on its own, more than any single action moved it:
// the player could not see whether anything they did had worked. A rolling
// one-day total holds still between lumps, lags by exactly one day, and
// means what it says -- "this is what you made yesterday".

const SLOT_SECONDS = 1;
const SLOTS = SECONDS_PER_GAME_DAY / SLOT_SECONDS;

interface Slot {
  income: number;
  cost: number;
  byRoute: Map<string, number>;
  /** Running cost a route ran up beyond its vehicles' own (rough roads). */
  extraCostByRoute: Map<string, number>;
}

export interface DayLedger {
  slots: Slot[];
  cursor: number;
  slotElapsed: number;
  /** How much of the day the ledger has seen, up to a full day. */
  seenSeconds: number;
}

function emptySlot(): Slot {
  return { income: 0, cost: 0, byRoute: new Map(), extraCostByRoute: new Map() };
}

export function createDayLedger(): DayLedger {
  return { slots: Array.from({ length: SLOTS }, emptySlot), cursor: 0, slotElapsed: 0, seenSeconds: 0 };
}

/** One tick's money: running income and cost (never purchases or sales), and fares per route. */
export function recordMoney(
  ledger: DayLedger,
  income: number,
  cost: number,
  byRoute: ReadonlyMap<string, number>,
  dt: number,
  extraCostByRoute: ReadonlyMap<string, number> = new Map(),
): void {
  const slot = ledger.slots[ledger.cursor]!;
  slot.income += income;
  slot.cost += cost;
  for (const [routeId, amount] of byRoute) slot.byRoute.set(routeId, (slot.byRoute.get(routeId) ?? 0) + amount);
  for (const [routeId, amount] of extraCostByRoute) slot.extraCostByRoute.set(routeId, (slot.extraCostByRoute.get(routeId) ?? 0) + amount);
  ledger.slotElapsed += dt;
  ledger.seenSeconds = Math.min(SECONDS_PER_GAME_DAY, ledger.seenSeconds + dt);
  while (ledger.slotElapsed >= SLOT_SECONDS) {
    ledger.slotElapsed -= SLOT_SECONDS;
    ledger.cursor = (ledger.cursor + 1) % SLOTS;
    ledger.slots[ledger.cursor] = emptySlot();
  }
}

export interface LastDay {
  income: number;
  cost: number;
  net: number;
}

/**
 * Totals over the last game day. Before a full day has passed, scaled up
 * from what has been seen, so day one doesn't read as a loss.
 */
export function lastDay(ledger: DayLedger): LastDay {
  let income = 0;
  let cost = 0;
  for (const slot of ledger.slots) {
    income += slot.income;
    cost += slot.cost;
  }
  const scale = ledger.seenSeconds > 0 ? SECONDS_PER_GAME_DAY / ledger.seenSeconds : 0;
  return { income: income * scale, cost: cost * scale, net: (income - cost) * scale };
}

/**
 * A route's fares over the last game day. A route younger than a day is
 * scaled up from its own age, so a new route reads at its real rate rather
 * than ramping up from zero.
 */
export function routeIncomeLastDay(ledger: DayLedger, routeId: string, ageSeconds: number): number {
  let total = 0;
  for (const slot of ledger.slots) total += slot.byRoute.get(routeId) ?? 0;
  const seen = Math.min(ledger.seenSeconds, Math.max(SLOT_SECONDS, ageSeconds));
  return seen > 0 ? total * (SECONDS_PER_GAME_DAY / seen) : 0;
}

/** A route's extra running cost (rough roads) over the last day, scaled like its fares. */
export function routeExtraCostLastDay(ledger: DayLedger, routeId: string, ageSeconds: number): number {
  let total = 0;
  for (const slot of ledger.slots) total += slot.extraCostByRoute.get(routeId) ?? 0;
  const seen = Math.min(ledger.seenSeconds, Math.max(SLOT_SECONDS, ageSeconds));
  return seen > 0 ? total * (SECONDS_PER_GAME_DAY / seen) : 0;
}

/** A route opened under an id that ran before: its old money is not its own. */
export function forgetRoute(ledger: DayLedger, routeId: string): void {
  for (const slot of ledger.slots) {
    slot.byRoute.delete(routeId);
    slot.extraCostByRoute.delete(routeId);
  }
}
