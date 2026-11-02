import { playAhead, type WhatIfChange, type WhatIfRun } from "@engine/game/whatif";
import type { GameWorld } from "@engine/game/types";
import { measureSystems } from "./systems";

// The what-if, off the frame (whatif.ts; brief, Dev tools, step 3). One worker, made when you
// first ask and doing nothing between questions. It keeps the world as you took it and the run
// without a change for each horizon asked, so a second question from the same day plays only its
// own run. It yields between game days, so a new question or Cancel gets through.

export type WhatIfRequest =
  | { type: "take"; world: GameWorld }
  | { type: "ask"; id: number; change: WhatIfChange; days: number }
  | { type: "cancel" };

export type WhatIfReply =
  | { type: "progress"; id: number; done: number; of: number }
  | { type: "answer"; id: number; base: WhatIfRun; with: WhatIfRun }
  | { type: "stopped"; id: number };

const scope = self as unknown as { onmessage: ((event: MessageEvent<WhatIfRequest>) => void) | null; postMessage(message: WhatIfReply): void };
let taken: GameWorld | null = null;
const baselines = new Map<number, WhatIfRun>();
/** The question being answered; a newer one, or Cancel, ends it at the next day. */
let current = 0;

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Run one to its end, reporting each day; null if it was overtaken. */
async function run(id: number, change: WhatIfChange | null, days: number, done: number, of: number): Promise<WhatIfRun | null> {
  // At the last day, the systems graph's measures too (systems.ts).
  const steps = playAhead(taken!, change, days, measureSystems);
  for (let d = 0; ; d += 1) {
    const step = steps.next();
    if (step.done) return step.value;
    scope.postMessage({ type: "progress", id, done: done + d + 1, of });
    await nextTurn();
    if (current !== id) return null;
  }
}

scope.onmessage = async (event) => {
  const message = event.data;
  if (message.type === "take") {
    taken = message.world;
    baselines.clear();
    current = 0;
    return;
  }
  if (message.type === "cancel") {
    current = 0;
    return;
  }
  const { id, change, days } = message;
  current = id;
  if (!taken) return;
  const cached = baselines.get(days);
  const of = cached ? days : 2 * days;
  scope.postMessage({ type: "progress", id, done: 0, of });
  const base = cached ?? (await run(id, null, days, 0, of));
  if (!base) return scope.postMessage({ type: "stopped", id });
  baselines.set(days, base);
  const changed = await run(id, change, days, cached ? 0 : days, of);
  if (!changed) return scope.postMessage({ type: "stopped", id });
  scope.postMessage({ type: "answer", id, base, with: changed });
};
