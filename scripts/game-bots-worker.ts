// Runs one world two game days for scripts/game-bots.ts, off the main
// thread, recording funds where a receipt reads them (receipts.ts): when the
// first day has settled, and at the end. With no action it's the shared
// do-nothing twin; with one, the world the action makes. The difference is
// the engine's forecast (forecast.ts) without running the twin once per move.
//
// With `tripDays`, it measures trips instead: runs that many days and
// returns trips made a day (the headline) at the end of each -- how the bots
// rank roads by trips unlocked per naira.
import { applyAction, type ActionSpec } from "../src/engine/game/actions";
import { gameTick } from "../src/engine/game/tick";
import { RECEIPT_SECONDS, SETTLE_SECONDS } from "../src/engine/game/receipts";
import type { GameWorld } from "../src/engine/game/types";
import { SIM_DT } from "../src/engine/loop";
import { headline } from "../src/engine/game/world";
import { SECONDS_PER_GAME_DAY } from "../src/engine/economy/state";

declare const self: Worker;

export interface Trajectory {
  id: number;
  /** Null if the action was refused. */
  settled: number | null;
  end: number | null;
  /** Seconds measured after settling. */
  measured: number;
  /** With `tripDays`: trips made a day at the end of each day. */
  trips?: number[];
  /** With `tripDays`: your riders a day at the end of each day. */
  riders?: number[];
}

self.onmessage = (event: MessageEvent<{ id: number; world: GameWorld; action: ActionSpec | null; tripDays?: number }>) => {
  const { id, world, action, tripDays } = event.data;
  const result: Trajectory = { id, settled: null, end: null, measured: 0 };
  if (action && !applyAction(world, action).ok) {
    self.postMessage(result);
    return;
  }
  if (tripDays) {
    result.trips = [];
    result.riders = [];
    const ticks = Math.round(SECONDS_PER_GAME_DAY / SIM_DT);
    for (let d = 0; d < tripDays; d += 1) {
      for (let i = 0; i < ticks; i += 1) gameTick(world, SIM_DT);
      const h = headline(world);
      result.trips.push(h.tripsPerDay);
      result.riders.push(h.yourRidersPerDay);
    }
    self.postMessage(result);
    return;
  }
  const startedAt = world.economy.elapsedSeconds;
  for (;;) {
    gameTick(world, SIM_DT);
    const age = world.economy.elapsedSeconds - startedAt;
    if (result.settled === null && age >= SETTLE_SECONDS) result.settled = world.economy.funds;
    if (age >= RECEIPT_SECONDS) {
      result.end = world.economy.funds;
      result.measured = age - SETTLE_SECONDS;
      break;
    }
  }
  self.postMessage(result);
};
