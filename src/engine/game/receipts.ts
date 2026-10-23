import { SECONDS_PER_GAME_DAY } from "../economy/state";
import type { GameWorld } from "./types";
import { gameTick } from "./tick";
import { gameDay, networkShare, townShare } from "./world";
import { routeIncomeLastDay } from "./ledger";

// Receipts: a day after each action, exactly what it did.
//
// The lever audit showed no network-wide number can show one action: the
// network's daily earnings genuinely vary ±₦75 from day to day, and a good
// bus adds ~₦90. Before-and-after comparisons drown in the same noise. So
// the receipt does what the audit does: just before the action, the world
// is copied (structuredClone; the sim is deterministic), and the copy runs
// alongside the real one without the action. A day later the difference
// between them is exactly what the action did -- nothing else changed.
//
// Later actions are replayed into every copy still measuring, so each copy
// stays "the real world minus one action": a second bus bought while the
// first is measured doesn't get credited to the first.

// Measured over the *second* day after the action. A new bus starts empty
// mid-route and takes about a day to settle in (lever audit: 63% of its
// effect at ~1 day), so a first-day receipt told a bus that settles at
// +₦70/day it had lost ₦30. The first day is let pass; the second is
// reported.
export const SETTLE_SECONDS = SECONDS_PER_GAME_DAY;
export const RECEIPT_SECONDS = 2 * SECONDS_PER_GAME_DAY;
/** Copies measured at once; a further action finishes the oldest early. */
const MAX_PENDING = 4;

export interface ReceiptSpec {
  /** What was done, as the player would say it: "a 3rd bus on Ilase–Owode". */
  label: string;
  /** Towns whose rings to report. */
  towns: string[];
  /** A route whose own fares to report (bus, train, lorry or freight route id). */
  routeId?: string;
}

/** An action against a world. True if it happened. */
export type Action = (world: GameWorld) => boolean;

interface Pending {
  spec: ReceiptSpec;
  shadow: GameWorld;
  startedAt: number;
  /** Money that left (+) or came in (−) at the moment of the action: a purchase, a sale's refund. */
  capital: number;
  /** Real funds minus the copy's, once the first day has passed: the start of the measured day. */
  gapAtSettled: number | null;
}

export interface TownEffect {
  townId: string;
  /** Percentage points of the town's trips, real minus without the action. */
  you: number;
  informal: number;
  home: number;
}

export interface Receipt {
  spec: ReceiptSpec;
  /** Game day the receipt was written. */
  day: number;
  /** How long its money was measured, in game days (under 1 if finished early). */
  measuredDays: number;
  capital: number;
  /** Running money over the measured time, real minus without -- fares in, costs out. Per day. */
  moneyPerDay: number;
  /** Days for the running gain to repay the capital; null if it doesn't. */
  paybackDays: number | null;
  /** Percentage points of all trips between towns. */
  you: number;
  informal: number;
  towns: TownEffect[];
  /** The route's own fares per day, if it has one -- which can exceed the network's gain when it takes riders from your other routes. */
  routeFaresPerDay: number | null;
}

export interface ReceiptBook {
  pending: Pending[];
  done: Receipt[];
}

export function createReceiptBook(): ReceiptBook {
  return { pending: [], done: [] };
}

/**
 * Does an action, and starts measuring it. Returns whether it happened;
 * an action that was refused leaves no receipt.
 */
export function perform(world: GameWorld, book: ReceiptBook, act: Action, spec: ReceiptSpec): boolean {
  const shadow = structuredClone(world);
  const fundsBefore = world.economy.funds;
  if (!act(world)) return false;
  for (const pending of book.pending) act(pending.shadow);
  if (book.pending.length >= MAX_PENDING) finish(world, book, book.pending[0]!);
  book.pending.push({ spec, shadow, startedAt: world.economy.elapsedSeconds, capital: fundsBefore - world.economy.funds, gapAtSettled: null });
  return true;
}

/** Steps every copy with the real world; returns the receipts that just finished. */
export function tickReceipts(world: GameWorld, book: ReceiptBook, dt: number): Receipt[] {
  const finished: Receipt[] = [];
  for (const pending of [...book.pending]) {
    gameTick(pending.shadow, dt);
    const age = world.economy.elapsedSeconds - pending.startedAt;
    if (pending.gapAtSettled === null && age >= SETTLE_SECONDS) pending.gapAtSettled = world.economy.funds - pending.shadow.economy.funds;
    if (age >= RECEIPT_SECONDS) finished.push(finish(world, book, pending));
  }
  return finished;
}

function finish(world: GameWorld, book: ReceiptBook, pending: Pending): Receipt {
  book.pending = book.pending.filter((candidate) => candidate !== pending);
  const { shadow, spec, capital } = pending;
  const age = world.economy.elapsedSeconds - pending.startedAt;
  const gap = world.economy.funds - shadow.economy.funds;
  // Running money only -- fares minus costs. Once settled, the change in
  // the gap over the measured day (the capital is in both ends and
  // cancels). Finished early, before settling: since the action, with the
  // capital added back.
  const settled = pending.gapAtSettled !== null;
  const measured = Math.max(1e-6, settled ? age - SETTLE_SECONDS : age);
  const measuredDays = measured / SECONDS_PER_GAME_DAY;
  const moneyPerDay = (settled ? gap - pending.gapAtSettled! : gap + capital) / measuredDays;
  const real = networkShare(world);
  const without = networkShare(shadow);
  const pp = (n: number) => n * 100;
  const route = spec.routeId ? [...world.routes, ...world.lorryRoutes].find((r) => r.id === spec.routeId) : undefined;

  const receipt: Receipt = {
    spec,
    day: gameDay(world),
    measuredDays,
    capital,
    moneyPerDay,
    paybackDays: capital > 0 && moneyPerDay > 0 ? capital / moneyPerDay : null,
    you: pp(real.player - without.player),
    informal: pp(real.informal - without.informal),
    towns: spec.towns
      .filter((townId) => world.towns.has(townId))
      .map((townId) => {
        const a = townShare(world, townId);
        const b = shadow.towns.has(townId) ? townShare(shadow, townId) : { player: 0, informal: 0, lost: 0 };
        return { townId, you: pp(a.player - b.player), informal: pp(a.informal - b.informal), home: pp(a.lost - b.lost) };
      }),
    routeFaresPerDay: route ? routeIncomeLastDay(world.ledger, route.id, world.economy.elapsedSeconds - route.openedAtSeconds) : null,
  };
  book.done.unshift(receipt);
  book.done = book.done.slice(0, 8);
  return receipt;
}
