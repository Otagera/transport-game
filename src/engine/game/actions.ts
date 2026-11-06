import { answerDemand, unionAfterAction } from "./union";
import { nextEpoch } from "./epoch";
import { upgradePort } from "./gateways";
import { commitPledge, consoleMove, noteAction, type ConsoleOp } from "./term";
import type { GameWorld, UrbanKind } from "./types";
import { addBus, addBusLane, buildRoad, paveRoad, removeBus } from "./world";
import { addLorry, addFreightTrain, isLorryRoute, removeLorry } from "./goods";
import { addCar, addTrain, buildHalt, buildTrack } from "./rail";
import { fixRoadNow, setRoadMaintained } from "./wear";
import { setTrunk, trunksOn } from "./trunks";
import { SWITCHED_OFF } from "./tuning";
import type { Alignment } from "./roads";
import { setEnforcement, settleStrike, type Enforcement } from "./pushback";
import { dropProject, nameProject, type ProjectRung } from "./project";
import { restoreRoad, retireRoad } from "./retire";
import { restoreRefinery } from "./fuel";
import { buildPipe, restorePipe, setPipeDial, setPipeKept } from "./pipelines";
import { restoreWorks } from "./cement";
import { restoreSteel } from "./steel";
import { restorePower } from "./power";
import { restoreTextile } from "./textile";
import { expandSite } from "./expand";
import { buildYard } from "./yards";
import { buildBusStation } from "./busstations";
import { addBoat, buildJetty } from "./boats";
import { buildPark } from "./parks";
import { buildUrban } from "./metro";
import { setFreightRate } from "./freightrates";
import { issueBond, type BondPurpose } from "./bonds";
import { bridgeFord } from "./floods";
import { setLabel } from "./labels";
import { openCluster, remitRefusal } from "./remit";
export { remitRefusal } from "./remit";

// Every player action as plain data. Data, not a closure, so it can be
// sent to a worker and replayed there: the forecast (forecast.ts) runs an
// action on a copy of the world before the player commits to it, and a
// run file (runlog.ts) records them so a whole game can be replayed.

export type ActionSpec =
  | { kind: "bus" | "minibus" | "brt" | "lorry" | "train" | "freight"; a: string; b: string; via?: string[] }
  | { kind: "road"; a: string; b: string; alignment: Alignment; high?: boolean; trunk?: boolean; via?: Array<{ x: number; y: number }> }
  | { kind: "pave"; a: string; b: string }
  | { kind: "lane"; a: string; b: string }
  | { kind: "enforce"; a: string; b: string; enforcement: Enforcement }
  | { kind: "settle"; a: string; b: string }
  | { kind: "project"; a: string; b: string; rung: ProjectRung }
  | { kind: "track"; a: string; b: string; alignment: Alignment }
  | { kind: "halt"; town: string }
  /** A jetty at a waterside town; a water bus or a barge between two jetties (boats.ts). */
  | { kind: "jetty"; townId: string }
  | { kind: "boat" | "barge"; a: string; b: string }
  | { kind: "fix"; segmentId: string; on: boolean }
  // A road declared a trunk (on), or made a feeder again (trunks.ts).
  | { kind: "trunk"; segmentId: string; on: boolean }
  | { kind: "retire" | "restore" | "repair"; segmentId: string }
  | { kind: "dropProject" }
  | { kind: "restoreRefinery" }
  | { kind: "pipe"; a: string; b: string }
  | { kind: "restorePipe"; id: string }
  | { kind: "pipeDial"; id: string; dial: number }
  | { kind: "pipeKeep"; id: string; on: boolean }
  | { kind: "upgradePort" }
  | { kind: "restoreWorks" }
  | { kind: "restoreSteel" }
  | { kind: "restorePower" }
  | { kind: "restoreTextile" }
  | { kind: "expand"; siteId: string }
  | { kind: "yard"; townId: string }
  | { kind: "park"; townId: string }
  | { kind: "busStation"; townId: string }
  /** A city line; `mode` its rung on the urban ladder (metro.ts), absent a metro, so run files before it replay unchanged. */
  | { kind: "metro"; townId: string; mode?: UrbanKind }
  | { kind: "freightRate"; routeId: string; rate: "cheap" | "standard" | "dear" }
  | { kind: "bond"; purpose: BondPurpose }
  | { kind: "sell"; routeId: string }
  | { kind: "car"; routeId: string }
  | { kind: "pledge"; id: string }
  | { kind: "console"; op: ConsoleOp; amount?: number; key?: string; value?: number | boolean }
  | { kind: "union"; unionId: string; answer: "pay" | "concede" | "coop" | "refuse" }
  | { kind: "bridgeFord"; fordId: string }
  | { kind: "label"; key: string; name?: string; colour?: string }
  | { kind: "open"; hub: string };

/** `amount`: money charged (a repair) or returned (a sale), where the caller wants to say it. */
export interface ActionOutcome {
  ok: boolean;
  reason?: string;
  amount?: number;
}

export function applyAction(world: GameWorld, spec: ActionSpec): ActionOutcome {
  nextEpoch(world); // the world as it was before the action is read again after it (epoch.ts)
  const closed = remitRefusal(world, spec);
  const outcome = closed ? { ok: false, reason: closed } : apply(world, spec);
  // A build starts its week, to say what it did (term.ts).
  if (outcome.ok) {
    noteAction(world, spec);
    unionAfterAction(world, spec); // lanes and BRT anger the union; parks please it (union.ts)
  }
  return outcome;
}

function apply(world: GameWorld, spec: ActionSpec): ActionOutcome {
  switch (spec.kind) {
    case "open":
      return openCluster(world, spec.hub);
    case "pledge":
      return commitPledge(world, spec.id);
    case "console":
      return consoleMove(world, spec.op, spec.amount, spec.key, spec.value);
    case "union":
      return answerDemand(world, spec.unionId, spec.answer);
    case "label":
      return setLabel(world, spec.key, spec.name, spec.colour);
    case "bridgeFord": {
      const result = bridgeFord(world, spec.fordId);
      return result.ok ? { ok: true, amount: result.charged } : { ok: false, reason: result.reason };
    }
    case "bus":
      return addBus(world, spec.a, spec.b, "bus", spec.via);
    case "minibus":
      return addBus(world, spec.a, spec.b, "minibus", spec.via);
    case "brt":
      return addBus(world, spec.a, spec.b, "brt", spec.via);
    case "lorry":
      return addLorry(world, spec.a, spec.b);
    case "train":
      return addTrain(world, spec.a, spec.b);
    case "freight":
      return addFreightTrain(world, spec.a, spec.b);
    case "road": {
      // Declared a trunk as it's built (trunks.ts): one more choice on the verb; refused whole if it can't be.
      if (spec.trunk && !trunksOn(world)) return { ok: false, reason: SWITCHED_OFF };
      const built = buildRoad(world, spec.a, spec.b, spec.alignment, spec.high ?? false, spec.via);
      if (!built.ok || !spec.trunk) return built;
      const roads = world.simulation.map.segments.filter((s) => s.type === "road" && ((s.fromNodeId === spec.a && s.toNodeId === spec.b) || (s.fromNodeId === spec.b && s.toNodeId === spec.a)));
      const piece = roads[roads.length - 1];
      if (piece) setTrunk(world, piece.id, true);
      return built;
    }
    case "trunk": {
      const result = setTrunk(world, spec.segmentId, spec.on);
      return result.ok ? { ok: true, amount: result.charged } : { ok: false, reason: result.reason };
    }
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
    case "jetty": {
      const result = buildJetty(world, spec.townId);
      return result.ok ? { ok: true, amount: result.charged ?? 0 } : { ok: false, reason: result.reason };
    }
    case "boat":
    case "barge":
      return addBoat(world, spec.a, spec.b, spec.kind);
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
    case "busStation": {
      const result = buildBusStation(world, spec.townId);
      return result.ok ? { ok: true, amount: result.charged ?? 0 } : { ok: false, reason: result.reason };
    }
    case "freightRate":
      return setFreightRate(world, spec.routeId, spec.rate);
    case "metro": {
      const result = buildUrban(world, spec.townId, spec.mode ?? "metro");
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
    case "pipe":
      return buildPipe(world, spec.a, spec.b);
    case "restorePipe":
      return restorePipe(world, spec.id);
    case "pipeDial":
      return setPipeDial(world, spec.id, spec.dial);
    case "pipeKeep":
      return setPipeKept(world, spec.id, spec.on);
    case "restorePower": {
      const result = restorePower(world);
      return result.ok ? { ok: true, amount: result.charged } : { ok: false, reason: result.reason };
    }
    case "restoreTextile": {
      const result = restoreTextile(world);
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
    case "car":
      return addCar(world, spec.routeId);
    case "sell": {
      const refund = isLorryRoute(spec.routeId) ? removeLorry(world, spec.routeId) : removeBus(world, spec.routeId);
      return refund > 0 ? { ok: true, amount: refund } : { ok: false, reason: "nothing to sell" };
    }
  }
}
