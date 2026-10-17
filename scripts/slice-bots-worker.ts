// Runs one world two game days for scripts/slice-bots.ts, off the main
// thread, recording funds where a receipt reads them (receipts.ts): when the
// first day has settled, and at the end. With no action it's the shared
// do-nothing twin; with one, the world the action makes. The difference is
// the engine's forecast (forecast.ts) without running the twin once per move.
import { applyAction, type ActionSpec } from "../src/engine/slice/actions";
import { sliceTick } from "../src/engine/slice/tick";
import { RECEIPT_SECONDS, SETTLE_SECONDS } from "../src/engine/slice/receipts";
import type { SliceWorld } from "../src/engine/slice/types";
import { SIM_DT } from "../src/engine/loop";

declare const self: Worker;

export interface Trajectory {
  id: number;
  /** Null if the action was refused. */
  settled: number | null;
  end: number | null;
  /** Seconds measured after settling. */
  measured: number;
}

self.onmessage = (event: MessageEvent<{ id: number; world: SliceWorld; action: ActionSpec | null }>) => {
  const { id, world, action } = event.data;
  const result: Trajectory = { id, settled: null, end: null, measured: 0 };
  if (action && !applyAction(world, action).ok) {
    self.postMessage(result);
    return;
  }
  const startedAt = world.economy.elapsedSeconds;
  for (;;) {
    sliceTick(world, SIM_DT);
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
