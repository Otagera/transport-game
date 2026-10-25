import type { GameWorld } from "./types";
import type { GameEvent } from "./settlement";
import type { ActionSpec } from "./actions";
import type { LaneState } from "./pushback";
import { laneOn, setEnforcement } from "./pushback";
import { SECONDS_PER_GAME_DAY as D } from "../economy/state";
import { inHome } from "./fuel";
import { clusterOf } from "./clusters";
import { removeBus, roadChain } from "./world";

// The union as a party (docs/brief.md, Revision 5, step 5; agreed 2026-10-25: "proceed").
// The designer's review: "the rival is weather, not a character". Each cluster's transport
// union now has a chairman with a name, a stance toward you and a memory: he works with you
// for his members' welfare, or he's against you ("if they are not with you then they are
// against you").
//
//   - His stance (-1 against .. +1 with you) moves with what you do: your lanes, BRT and
//     strict enforcement, corridors you take from his danfos, demands you ignore or refuse push
//     it down; paying his members' welfare, meeting a demand, motor parks, handing a route to a
//     union cooperative push it up. It fades back toward wary as the months pass.
//   - It drives the lanes' politics (pushback.ts): against you, grievance builds faster -- more
//     strikes -- and his danfos take a lax lane back sooner; with you, slower and later.
//   - Demands, each with a deadline: a lane or a taken corridor brings one at once, and a
//     chairman against you makes them now and then. Answer by paying, conceding (a lane eased),
//     handing him the route (a cooperative: it keeps running, the fares are his), or refusing.
//     Let the deadline pass and he strikes.
//
// Plain data on the world, changed here and by the `union` action, so a run file replays it.
// Off, and absent, in runs played before it (no unionEnabled).

export type DemandKind = "lane" | "corridor" | "welfare";
export type Answer = "pay" | "concede" | "coop" | "refuse";

export interface Demand {
  kind: DemandKind;
  a: string;
  b: string;
  text: string;
  price: number;
  deadlineAt: number;
}

export interface UnionState {
  /** "home", or a far cluster's hub. */
  id: string;
  chairman: string;
  /** The towns whose motor parks are his. */
  towns: string[];
  /** -1 against you .. +1 with you; 0 wary. */
  stance: number;
  /** What he remembers: the day, what happened, how it moved him. Newest last, a few kept. */
  memory: Array<{ day: number; text: string; delta: number }>;
  demand: Demand | null;
  nextDemandAt: number;
}

const CHAIRMEN = ["Alhaji Musa Bello", "Chief Emeka Obi", "Comrade Tunde Bakare", "Alhaji Sule Danjuma", "Mr Chinedu Okafor", "Comrade Yusuf Garba", "Chief Bayo Adeyemi", "Alhaji Ibrahim Lawal", "Mr Efe Okoro", "Comrade Nnamdi Eze"];
const MEMORY = 6;
export const WITH_YOU = 0.3;
export const AGAINST_YOU = -0.3;

const on = (world: GameWorld) => !!world.tuning.unionEnabled && !!world.unions;
const dayOf = (world: GameWorld) => Math.floor((world.economy.elapsedSeconds - world.startSeconds) / D) + 1;
const nameOf = (world: GameWorld, id: string) => world.towns.get(id)?.name ?? id;

export function stanceWord(stance: number): "with you" | "wary" | "against you" {
  return stance >= WITH_YOU ? "with you" : stance <= AGAINST_YOU ? "against you" : "wary";
}

/** The union whose motor parks a town's are. */
export function unionOf(world: GameWorld, townId: string): UnionState | undefined {
  if (!on(world)) return undefined;
  const cluster = clusterOf(world, townId);
  return world.unions!.find((u) => u.id === (cluster ? cluster.hub : "home"));
}

/** As play begins (start.ts): a chairman for the home cluster and each far one. */
export function startUnions(world: GameWorld): void {
  if (!world.tuning.unionEnabled || world.unions) return;
  const towns = [...world.towns.values()].filter((t) => !t.industry);
  const groups: Array<{ id: string; towns: string[] }> = [
    { id: "home", towns: towns.filter((t) => !clusterOf(world, t.id) && (inHome(world, t) || !world.clusters)).map((t) => t.id) },
    ...(world.clusters ?? []).map((c) => ({ id: c.hub, towns: c.towns })),
  ];
  const seed = [...(world.port ?? "x")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const now = world.economy.elapsedSeconds;
  world.unions = groups.map((g, k) => ({
    id: g.id, chairman: CHAIRMEN[(seed + k * 3) % CHAIRMEN.length]!, towns: g.towns, stance: 0, memory: [], demand: null,
    nextDemandAt: now + (world.tuning.unionDemandEveryDays ?? 20) * D,
  }));
}

function move(world: GameWorld, union: UnionState, delta: number, text: string, events: GameEvent[]): void {
  const before = stanceWord(union.stance);
  union.stance = Math.max(-1, Math.min(1, union.stance + delta));
  union.memory.push({ day: dayOf(world), text, delta });
  if (union.memory.length > MEMORY) union.memory.shift();
  const after = stanceWord(union.stance);
  if (after !== before) events.push({ kind: "union-stance", union: union.id, chairman: union.chairman, stance: after });
}

/** How fast a lane's grievance builds, and its danfos take it back, against what it would: by its chairman's stance. */
export function laneMood(world: GameWorld, lane: LaneState): { grievance: number; encroachment: number } {
  const union = unionOf(world, lane.a);
  if (!union) return { grievance: 1, encroachment: 1 };
  const s = union.stance;
  return s < 0 ? { grievance: 1 + 2 * -s, encroachment: 1 + -s } : { grievance: 1 - 0.6 * s, encroachment: 1 - 0.5 * s };
}

/** What a demand costs to meet by paying: a few days of the corridor's worth to his members, more for a bigger cluster. */
function priceFor(world: GameWorld, union: UnionState, kind: DemandKind): number {
  const t = world.tuning;
  const people = union.towns.reduce((sum, id) => sum + (world.towns.get(id)?.population ?? 0), 0);
  return Math.round((t.unionPriceBase ?? 400) + (t.unionPricePerThousand ?? 4) * people * (kind === "welfare" ? 0.5 : 1));
}

function demand(world: GameWorld, union: UnionState, kind: DemandKind, a: string, b: string, events: GameEvent[]): void {
  if (union.demand) return; // one at a time: the one on the table first
  const ab = `${nameOf(world, a)}–${nameOf(world, b)}`;
  const text = kind === "lane" ? `Our drivers lost their road on ${ab} to your lane. Ease it, or see to our members.`
    : kind === "corridor" ? `You've taken ${ab} from our members. Leave us the run, or see to them.`
    : `Our members are suffering. See to their welfare.`;
  const days = world.tuning.unionDemandDays ?? 7;
  union.demand = { kind, a, b, text, price: priceFor(world, union, kind), deadlineAt: world.economy.elapsedSeconds + days * D };
  events.push({ kind: "union-demand", union: union.id, chairman: union.chairman, text, deadlineAt: union.demand.deadlineAt });
}

/** After an action went through (actions.ts): lanes and BRT anger him and bring a demand; a motor park pleases him. */
export function unionAfterAction(world: GameWorld, spec: ActionSpec): void {
  if (!on(world)) return;
  const events: GameEvent[] = [];
  if (spec.kind === "lane" || spec.kind === "brt") {
    const union = unionOf(world, spec.a);
    if (union) {
      move(world, union, spec.kind === "lane" ? -0.25 : -0.1, spec.kind === "lane" ? `a bus lane on ${nameOf(world, spec.a)}–${nameOf(world, spec.b)}` : `BRT on ${nameOf(world, spec.a)}–${nameOf(world, spec.b)}`, events);
      if (spec.kind === "lane") demand(world, union, "lane", spec.a, spec.b, events);
    }
  } else if (spec.kind === "enforce" && spec.enforcement === "strict") {
    const union = unionOf(world, spec.a);
    if (union) move(world, union, -0.15, `wardens on ${nameOf(world, spec.a)}–${nameOf(world, spec.b)}`, events);
  } else if (spec.kind === "park") {
    const union = unionOf(world, spec.townId);
    if (union) move(world, union, 0.12, `a motor park at ${nameOf(world, spec.townId)}`, events);
  } else if (spec.kind === "settle") {
    const union = unionOf(world, spec.a);
    if (union) move(world, union, 0.12, `you paid off the strike on ${nameOf(world, spec.a)}–${nameOf(world, spec.b)}`, events);
  }
  // Reported with the next tick's events (updateUnions).
  world.union = { events: [...(world.union?.events ?? []), ...events] };
}

/** Your answer to the demand on the table. */
export function answerDemand(world: GameWorld, unionId: string, answer: Answer): { ok: boolean; reason?: string; amount?: number } {
  const union = world.unions?.find((u) => u.id === unionId);
  const d = union?.demand;
  if (!union || !d) return { ok: false, reason: "no demand on the table" };
  const events: GameEvent[] = [];
  const ab = `${nameOf(world, d.a)}–${nameOf(world, d.b)}`;
  if (answer === "pay") {
    if (world.economy.funds < d.price) return { ok: false, reason: "can't afford it" };
    world.economy.funds -= d.price;
    world.budget.settlements += d.price;
    move(world, union, 0.2, `you saw to his members (₦${d.price.toLocaleString()})`, events);
  } else if (answer === "concede") {
    const lane = d.kind === "lane" ? laneOn(world, d.a, d.b) : undefined;
    if (!lane) return { ok: false, reason: "nothing to concede there" };
    setEnforcement(world, d.a, d.b, "lax");
    lane.encroachment = Math.max(lane.encroachment, 0.5);
    move(world, union, 0.25, `you eased the lane on ${ab}`, events);
  } else if (answer === "coop") {
    const route = routeAlong(world, d.a, d.b);
    if (!route) return { ok: false, reason: "you run no route there" };
    // Handed over, not sold: what selling would return stays with the cooperative.
    for (let n = route.vehicleIds.length; n > 0; n -= 1) world.economy.funds -= removeBus(world, route.id);
    move(world, union, 0.35, `you handed the ${ab} route to his cooperative`, events);
  } else {
    move(world, union, -0.2, `you refused him on ${ab}`, events);
    strikeNow(world, d);
  }
  union.demand = null;
  world.union = { events: [...(world.union?.events ?? []), ...events, { kind: "union-answered", union: union.id, chairman: union.chairman, answer }] };
  return { ok: true, amount: answer === "pay" ? d.price : undefined };
}

/** A route of yours that runs the corridor (either way). */
export function routeAlong(world: GameWorld, a: string, b: string): { id: string; vehicleIds: string[] } | undefined {
  return world.routes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
}

/** Refused or ignored on a laned corridor: the grievance is full, a strike is announced (pushback.ts). */
function strikeNow(world: GameWorld, d: Demand): void {
  const lane = laneOn(world, d.a, d.b);
  if (lane && lane.strikeAt === 0 && lane.strikeUntil <= world.economy.elapsedSeconds) lane.grievance = 1;
}

/** Every tick (tick.ts, after the lanes): corridors taken, a demand's deadline, his memory fading, a demand when he's against you. */
export function updateUnions(world: GameWorld, dt: number, happened: readonly GameEvent[]): GameEvent[] {
  if (!on(world)) return [];
  const events: GameEvent[] = [...(world.union?.events ?? [])];
  world.union = { events: [] };
  const now = world.economy.elapsedSeconds;
  for (const e of happened) {
    if (e.kind !== "corridor-taken" && e.kind !== "corridor-released") continue;
    const union = unionOf(world, e.a);
    if (!union) continue;
    if (e.kind === "corridor-taken") {
      move(world, union, -0.1, `you took ${nameOf(world, e.a)}–${nameOf(world, e.b)} from his danfos`, events);
      demand(world, union, "corridor", e.a, e.b, events);
    } else move(world, union, 0.05, `his danfos have ${nameOf(world, e.a)}–${nameOf(world, e.b)} back`, events);
  }
  const fade = Math.exp(-dt / ((world.tuning.unionMemoryDays ?? 120) * D));
  for (const union of world.unions!) {
    union.stance *= fade;
    const d = union.demand;
    if (d && now >= d.deadlineAt) {
      union.demand = null;
      move(world, union, -0.3, `you ignored him on ${nameOf(world, d.a)}–${nameOf(world, d.b)}`, events);
      strikeNow(world, d);
      events.push({ kind: "union-answered", union: union.id, chairman: union.chairman, answer: "ignored" });
    }
    if (!union.demand && now >= union.nextDemandAt) {
      union.nextDemandAt = now + (world.tuning.unionDemandEveryDays ?? 20) * D;
      // Against you, he asks for his members' welfare now and then.
      if (union.stance <= AGAINST_YOU) {
        const lane = world.lanes.find((l) => union.towns.includes(l.a));
        const [a, b] = lane ? [lane.a, lane.b] : [union.towns[0]!, union.towns[1] ?? union.towns[0]!];
        demand(world, union, "welfare", a, b, events);
      }
    }
  }
  return events;
}

/** Roads a refused chairman's strike would cover (for the panel): the lane's chain. */
export function demandRoad(world: GameWorld, d: Demand): string[] {
  return (roadChain(world, d.a, d.b) ?? []).map((piece) => piece.id);
}
