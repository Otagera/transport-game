import type { SliceWorld } from "./types";
import { addBus, addBusLane, addMinibus, buildRoad, paveRoad, removeBus } from "./world";
import { addLorry, addFreightTrain, isLorryRoute, removeLorry } from "./goods";
import { addTrain, buildHalt, buildTrack } from "./rail";
import { setRoadMaintained } from "./wear";
import type { Alignment } from "./roads";

// Every player action as plain data. Data, not a closure, so it can be
// sent to a worker and replayed there: the forecast (forecast.ts) runs an
// action on a copy of the world before the player commits to it.

export type ActionSpec =
  | { kind: "bus" | "minibus" | "lorry" | "train" | "freight"; a: string; b: string }
  | { kind: "road"; a: string; b: string; alignment: Alignment }
  | { kind: "pave"; a: string; b: string }
  | { kind: "lane"; a: string; b: string }
  | { kind: "track"; a: string; b: string; alignment: Alignment }
  | { kind: "halt"; town: string }
  | { kind: "fix"; segmentId: string; on: boolean }
  | { kind: "sell"; routeId: string };

/** `amount`: money charged (a repair) or returned (a sale), where the caller wants to say it. */
export interface ActionOutcome {
  ok: boolean;
  reason?: string;
  amount?: number;
}

export function applyAction(world: SliceWorld, spec: ActionSpec): ActionOutcome {
  switch (spec.kind) {
    case "bus":
      return addBus(world, spec.a, spec.b);
    case "minibus":
      return addMinibus(world, spec.a, spec.b);
    case "lorry":
      return addLorry(world, spec.a, spec.b);
    case "train":
      return addTrain(world, spec.a, spec.b);
    case "freight":
      return addFreightTrain(world, spec.a, spec.b);
    case "road":
      return buildRoad(world, spec.a, spec.b, spec.alignment);
    case "pave":
      return paveRoad(world, spec.a, spec.b);
    case "lane":
      return addBusLane(world, spec.a, spec.b);
    case "track":
      return buildTrack(world, spec.a, spec.b, spec.alignment);
    case "halt":
      return buildHalt(world, spec.town);
    case "fix": {
      const result = setRoadMaintained(world, spec.segmentId, spec.on);
      return result.ok ? { ok: true, amount: result.charged } : { ok: false, reason: result.reason };
    }
    case "sell": {
      const refund = isLorryRoute(spec.routeId) ? removeLorry(world, spec.routeId) : removeBus(world, spec.routeId);
      return refund > 0 ? { ok: true, amount: refund } : { ok: false, reason: "nothing to sell" };
    }
  }
}
