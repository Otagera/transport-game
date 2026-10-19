import type { SliceWorld } from "./types";
import type { SliceEvent } from "./settlement";
import { roadChain } from "./world";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// Pushback, one form (docs/brief.md, Revision 1: "pushback arrives with the
// bus lane"; The informal sector, candidate (c)): a strike. A bus lane takes
// a corridor's road from the danfos, and the drivers on it answer: a few
// days after the lane opens they stop running that corridor for a day, and
// again every so often while the lane stands. On a strike day no danfo sets
// off along the corridor (tick.ts sendInformal), so no tolls or levies from
// them, and their riders wait for you or stay home. Kekes and okadas, not
// the union's, keep running. Shown where it happens: the corridor draws as
// struck (render.ts), never a dialog or a meter.

/** A corridor with a bus lane, and the union's answer to it. */
export interface Pushback {
  a: string;
  b: string;
  /** When the next strike begins (sim seconds). */
  nextStrikeAt: number;
  /** While a strike runs: when it ends, and the road pieces it covers. */
  strikeUntil: number;
  segmentIds: string[];
}

/** Starts the union's clock on a corridor that just got a bus lane. */
export function answerBusLane(world: SliceWorld, a: string, b: string): void {
  if (world.pushback.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))) return;
  world.pushback.push({ a, b, nextStrikeAt: world.economy.elapsedSeconds + world.tuning.strikeDelayDays * SECONDS_PER_GAME_DAY, strikeUntil: 0, segmentIds: [] });
}

/** Road pieces danfos won't run on today. */
export function struckSegments(world: SliceWorld): Set<string> {
  const struck = new Set<string>();
  for (const p of world.pushback) if (p.strikeUntil > world.economy.elapsedSeconds) for (const id of p.segmentIds) struck.add(id);
  return struck;
}

/** Called every tick: begins and ends strikes, and says so. */
export function updatePushback(world: SliceWorld): SliceEvent[] {
  const events: SliceEvent[] = [];
  const now = world.economy.elapsedSeconds;
  const day = SECONDS_PER_GAME_DAY;
  for (const p of world.pushback) {
    if (p.segmentIds.length > 0 && now >= p.strikeUntil) {
      p.segmentIds = [];
      events.push({ kind: "strike-over", a: p.a, b: p.b });
    }
    if (now < p.nextStrikeAt) continue;
    const chain = roadChain(world, p.a, p.b);
    p.nextStrikeAt = now + world.tuning.strikeEveryDays * day;
    // The lane's gone (or the road): nothing to strike over.
    if (!chain || !chain.some((piece) => piece.busLane)) continue;
    p.segmentIds = chain.map((piece) => piece.id);
    p.strikeUntil = now + world.tuning.strikeDays * day;
    events.push({ kind: "strike", a: p.a, b: p.b });
  }
  return events;
}
