import { applyAction, type ActionSpec } from "./actions";
import { gameTick } from "./tick";
import { SIM_DT } from "../loop";
import { SECONDS_PER_GAME_DAY as D } from "../economy/state";
import { gameDay, headline } from "./world";
import type { GameWorld } from "./types";

// The what-if (docs/brief.md, Dev tools: the console and the what-if, step 3). The world as it
// stood when you asked, played on a number of days, without and with one change -- a move, or a
// tuning number -- and the headline read at each day's end, so the two can be laid side by side.
// Plain engine code, run in a worker (src/game/whatif.worker.ts) off the frame: about 1.5 s of one
// core a game day on the region. Each run plays its own copy; the world given is never touched,
// so the same question asked twice gives the same numbers (D2).

/** One change to try: a move as the toolbar would make it, or a tuning number set. */
export type WhatIfChange =
  | { kind: "move"; action: ActionSpec; label: string }
  | { kind: "tune"; key: string; value: number | boolean };

/** The headline at a day's end. */
export interface WhatIfDay {
  day: number;
  funds: number;
  /** The money made that day, every cost and income in it (a purchase lands on its day). */
  net: number;
  /** People in the towns, thousands. */
  people: number;
  /** Trips made a day, and those on your vehicles. */
  trips: number;
  yourRiders: number;
  /** Goods arriving a day, tonnes: yours and the hauliers'. */
  goods: number;
}

/** Where things stood at the last day's end, by place: what the map graph reads (step 4). */
export interface WhatIfEnd {
  /** People by town, thousands. */
  people: Record<string, number>;
  /** Goods arriving a day by flow (goods.ts flowKey), tonnes. */
  flows: Record<string, number>;
  /** Trips made a day by town pair (pairOutcomes' key). */
  trips: Record<string, number>;
  /** Whatever the caller measured at the end (`playAhead`'s `measureEnd`): the systems graph's nodes. */
  measured?: Record<string, number>;
}

export interface WhatIfRun {
  /** The day asked from, and the change's outcome (a move can be refused). */
  from: number;
  ok: boolean;
  reason?: string;
  days: WhatIfDay[];
  end: WhatIfEnd;
}

function measure(world: GameWorld, fundsBefore: number): WhatIfDay {
  const h = headline(world);
  let people = 0;
  for (const town of world.towns.values()) if (!town.industry) people += town.population;
  let goods = 0;
  for (const outcome of world.goods.outcomes.values()) goods += (outcome.delivered + (outcome.trucked ?? 0)) * D;
  // At a day's end gameDay is already the next one: this row is the day just ended.
  return { day: gameDay(world) - 1, funds: world.economy.funds, net: world.economy.funds - fundsBefore, people, trips: h.tripsPerDay, yourRiders: h.yourRidersPerDay, goods };
}

function endOf(world: GameWorld): WhatIfEnd {
  const people: Record<string, number> = {};
  for (const town of world.towns.values()) if (!town.industry) people[town.id] = town.population;
  const flows: Record<string, number> = {};
  for (const [key, outcome] of world.goods.outcomes) flows[key] = (outcome.delivered + (outcome.trucked ?? 0)) * D;
  const trips: Record<string, number> = {};
  for (const [key, rates] of world.pairOutcomes) trips[key] = (rates.player + rates.poached + rates.gaveUp) * D;
  return { people, flows, trips };
}

/** Make the change on a world (a copy): a tuning number as the console sets it, a move as you would. */
function makeChange(world: GameWorld, change: WhatIfChange | null): { ok: boolean; reason?: string } {
  if (!change) return { ok: true };
  if (change.kind === "tune") return applyAction(world, { kind: "console", op: "tune", key: change.key, value: change.value });
  return applyAction(world, change.action);
}

/**
 * Play a copy of `world` on to the end of `days` more days, with the change (null: as it is).
 * Generator: yields after each day (the worker reports progress and can stop between days).
 */
export function* playAhead(
  world: GameWorld,
  change: WhatIfChange | null,
  days: number,
  measureEnd?: (world: GameWorld) => Record<string, number>,
): Generator<WhatIfDay, WhatIfRun, void> {
  const copy = structuredClone(world);
  const from = gameDay(copy);
  const made = makeChange(copy, change);
  const run: WhatIfRun = { from, ok: made.ok, reason: made.reason, days: [], end: { people: {}, flows: {}, trips: {} } };
  if (!made.ok) return run;
  for (let d = 0; d < days; d += 1) {
    const fundsBefore = d === 0 ? world.economy.funds : run.days[d - 1]!.funds;
    // To the end of the day: the first, from wherever in it you asked.
    const target = from + d + 1;
    while (gameDay(copy) < target) gameTick(copy, SIM_DT);
    const row = measure(copy, fundsBefore);
    run.days.push(row);
    yield row;
  }
  run.end = { ...endOf(copy), ...(measureEnd ? { measured: measureEnd(copy) } : {}) };
  return run;
}

/** playAhead run through, for a script or a test. */
export function whatIf(world: GameWorld, change: WhatIfChange | null, days: number): WhatIfRun {
  const steps = playAhead(world, change, days);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
