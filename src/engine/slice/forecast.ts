import type { SliceWorld } from "./types";
import { sliceTick } from "./tick";
import { SIM_DT } from "../loop";
import { applyAction, type ActionSpec } from "./actions";
import { createReceiptBook, perform, tickReceipts, RECEIPT_SECONDS, type Receipt, type ReceiptSpec } from "./receipts";

// The forecast: a receipt before the action instead of after.
//
// A playtester sank to day 31 on a long bus route and two new roads; the
// receipts said so, but only after the money was gone. The sim is
// deterministic, so what an action will do over the next two days -- if
// nothing else changes -- can be measured before committing: copy the
// world, perform the action on the copy exactly as a receipt would (which
// copies it again, without the action), run both two days, read the
// receipt. Same machinery, same numbers, so the forecast and the receipt
// that follows can't disagree about what they measure -- only about what
// happened in between.
//
// Costs two worlds run for two game days (~1 s of CPU): the page runs it
// in a worker, never on the frame.

export function forecast(world: SliceWorld, action: ActionSpec, spec: ReceiptSpec): Receipt | null {
  const copy = structuredClone(world);
  const book = createReceiptBook();
  if (!perform(copy, book, (w) => applyAction(w, action).ok, spec)) return null;
  const ticks = Math.ceil(RECEIPT_SECONDS / SIM_DT) + 1;
  for (let i = 0; i < ticks; i += 1) {
    sliceTick(copy, SIM_DT);
    const [receipt] = tickReceipts(copy, book, SIM_DT);
    if (receipt) return receipt;
  }
  return null;
}
