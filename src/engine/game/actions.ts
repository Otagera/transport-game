import { answerDemand, unionAfterAction } from "./union";
import { upgradePort } from "./gateways";
import { commitPledge, consoleMove, noteAction } from "./term";
import type { GameWorld } from "./types";
import { addBrt, addBus, addBusLane, addMinibus, buildRoad, paveRoad, removeBus } from "./world";
import { addLorry, addFreightTrain, isLorryRoute, removeLorry } from "./goods";
import { addTrain, buildHalt, buildTrack } from "./rail";
import { fixRoadNow, setRoadMaintained } from "./wear";
import type { Alignment } from "./roads";
import { setEnforcement, settleStrike, type Enforcement } from "./pushback";
import { dropProject, nameProject, type ProjectRung } from "./project";
import { restoreRoad, retireRoad } from "./retire";
import { restoreRefinery } from "./fuel";
import { restoreWorks } from "./cement";
import { restoreSteel } from "./steel";
import { expandSite } from "./expand";
import { buildYard } from "./yards";
import { buildPark } from "./parks";
import { buildMetro } from "./metro";
import { setFreightRate } from "./freightrates";
import { issueBond, type BondPurpose } from "./bonds";
import { bridgeFord } from "./floods";
import { setLabel } from "./labels";

// Every player action as plain data. Data, not a closure, so it can be
// sent to a worker and replayed there: the forecast (forecast.ts) runs an
// action on a copy of the world before the player commits to it, and a
// run file (runlog.ts) records them so a whole game can be replayed.

export type ActionSpec =
  | { kind: "bus" | "minibus" | "brt" | "lorry" | "train" | "freight"; a: string; b: string }
  | { kind: "road"; a: string; b: string; alignment: Alignment; high?: boolean }
  | { kind: "pave"; a: string; b: string }
  | { kind: "lane"; a: string; b: string }
  | { kind: "enforce"; a: string; b: string; enforcement: Enforcement }
  | { kind: "settle"; a: string; b: string }
  | { kind: "project"; a: string; b: string; rung: ProjectRung }
  | { kind: "track"; a: string; b: string; alignment: Alignment }
  | { kind: "halt"; town: string }
  | { kind: "fix"; segmentId: string; on: boolean }
  | { kind: "retire" | "restore" | "repair"; segmentId: string }
  | { kind: "dropProject" }
  | { kind: "restoreRefinery" }
  | { kind: "upgradePort" }
  | { kind: "restoreWorks" }
  | { kind: "restoreSteel" }
  | { kind: "expand"; siteId: string }
  | { kind: "yard"; townId: string }
  | { kind: "park"; townId: string }
  | { kind: "metro"; townId: string }
  | { kind: "freightRate"; routeId: string; rate: "cheap" | "standard" | "dear" }
  | { kind: "bond"; purpose: BondPurpose }
  | { kind: "sell"; routeId: string }
  | { kind: "pledge"; id: string }
  | { kind: "console"; op: "end-term" | "funds" | "rains"; amount?: number }
  | { kind: "union"; unionId: string; answer: "pay" | "concede" | "coop" | "refuse" }
  | { kind: "bridgeFord"; fordId: string }
  | { kind: "label"; key: string; name?: string; colour?: string };

/** `amount`: money charged (a repair) or returned (a sale), where the caller wants to say it. */
export interface ActionOutcome {
  ok: boolean;
  reason?: string;
  amount?: number;
}

export function applyAction(world: GameWorld, spec: ActionSpec): ActionOutcome {
  const outcome = apply(world, spec);
  // A build starts its week, to say what it did (term.ts).
  if (outcome.ok) {
    noteAction(world, spec);
    unionAfterAction(world, spec); // lanes and BRT anger the union; parks please it (union.ts)
  }
  return outcome;
}

function apply(world: GameWorld, spec: ActionSpec): ActionOutcome {
  switch (spec.kind) {
    case "pledge":
      return commitPledge(world, spec.id);
    case "console":
      return consoleMove(world, spec.op, spec.amount);
    case "union":
      return answerDemand(world, spec.unionId, spec.answer);
    case "label":
      return setLabel(world, spec.key, spec.name, spec.colour);
    case "bridgeFord": {
      const result = bridgeFord(world, spec.fordId);
      return result.ok ? { ok: true, amount: result.charged } : { ok: false, reason: result.reason };
    }
    case "bus":
      return addBus(world, spec.a, spec.b);
    case "minibus":
      return addMinibus(world, spec.a, spec.b);
    case "brt":
      return addBrt(world, spec.a, spec.b);
    case "lorry":
      return addLorry(world, spec.a, spec.b);
    case "train":
      return addTrain(world, spec.a, spec.b);
    case "freight":
      return addFreightTrain(world, spec.a, spec.b);
    case "road":
      return buildRoad(world, spec.a, spec.b, spec.alignment, spec.high ?? false);
    case "pave":
      return paveRoad(world, spec.a, spec.b);
    case "lane":
      return addBusLane(world, spec.a, spec.b);
    case "project":
      return nameProject(world, spec.a, spec.b, spec.rung);
    case "settle":
      return settleStrike(world, spec.a, spec.b);
    case "enforce":
      return setEnforcement(world, spec.a, spec.b, spec.enforcement) ? { ok: true } : { ok: false, reason: "no bus lane there" };
    case "track":
      return buildTrack(world, spec.a, spec.b, spec.alignment);
    case "halt":
      return buildHalt(world, spec.town);
    case "fix": {
      const result = setRoadMaintained(world, spec.segmentId, spec.on);
      return result.ok ? { ok: true, amount: result.charged } : { ok: false, reason: result.reason };
    }
    case "retire":
      return retireRoad(world, spec.segmentId);
    case "restore": {
      const result = restoreRoad(world, spec.segmentId);
      return result.ok ? { ok: true, amount: result.charged ?? 0 } : { ok: false, reason: result.reason };
    }
    case "repair": {
      const result = fixRoadNow(world, spec.segmentId);
      return result.ok ? { ok: true, amount: result.charged } : { ok: false, reason: result.reason };
    }
    case "dropProject":
      dropProject(world);
      return { ok: true };
    case "upgradePort": {
      const result = upgradePort(world);
      return result.ok ? { ok: true, amount: result.charged ?? 0 } : { ok: false, reason: result.reason ?? "can't" };
    }
    case "restoreRefinery": {
      const result = restoreRefinery(world);
      return result.ok ? { ok: true, amount: result.charged ?? 0 } : { ok: false, reason: result.reason };
    }
    case "yard": {
      const result = buildYard(world, spec.townId);
      return result.ok ? { ok: true, amount: result.charged ?? 0 } : { ok: false, reason: result.reason };
    }
    case "park": {
      const result = buildPark(world, spec.townId);
      return result.ok ? { ok: true, amount: result.charged ?? 0 } : { ok: false, reason: result.reason };
    }
    case "freightRate":
      return setFreightRate(world, spec.routeId, spec.rate);
    case "metro": {
      const result = buildMetro(world, spec.townId);
      return result.ok ? { ok: true, amount: result.charged ?? 0 } : { ok: false, reason: result.reason };
    }
    case "expand": {
      const result = expandSite(world, spec.siteId);
      return result.ok ? { ok: true, amount: result.charged ?? 0 } : { ok: false, reason: result.reason };
    }
    case "restoreWorks": {
      const result = restoreWorks(world);
      return result.ok ? { ok: true, amount: result.charged ?? 0 } : { ok: false, reason: result.reason };
    }
    case "restoreSteel": {
      const result = restoreSteel(world);
      return result.ok ? { ok: true, amount: result.charged ?? 0 } : { ok: false, reason: result.reason };
    }
    case "bond": {
      const result = issueBond(world, spec.purpose);
      return result.ok ? { ok: true, amount: result.lent ?? 0 } : { ok: false, reason: result.reason };
    }
    case "sell": {
      const refund = isLorryRoute(spec.routeId) ? removeLorry(world, spec.routeId) : removeBus(world, spec.routeId);
      return refund > 0 ? { ok: true, amount: refund } : { ok: false, reason: "nothing to sell" };
    }
  }
}
