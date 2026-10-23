import { forecast } from "@engine/game/forecast";
import type { ActionSpec } from "@engine/game/actions";
import type { ReceiptSpec } from "@engine/game/receipts";
import type { GameWorld } from "@engine/game/types";

// Runs forecasts off the frame (forecast.ts): two worlds for two game days
// is about a second of work, too long to do while the map animates.

interface Request {
  key: string;
  world: GameWorld;
  action: ActionSpec;
  spec: ReceiptSpec;
}

const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: unknown): void };
scope.onmessage = (event) => {
  const { key, world, action, spec } = event.data;
  scope.postMessage({ key, receipt: forecast(world, action, spec) });
};
