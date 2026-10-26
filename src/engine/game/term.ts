import { rainsNow } from "./floods";
import { clusterOf, clusterOfferShare } from "./clusters";
import type { GameWorld } from "./types";
import type { GameEvent } from "./settlement";
import type { ActionSpec } from "./actions";
import { SECONDS_PER_GAME_DAY as D } from "../economy/state";
import { isCutOff, pairKey } from "./world";
import { townGrowth } from "./growth";
import { serviceMove, townNoSeat, type NamedMove } from "./problems";
import { cementBreak, cementServed } from "./cement";
import { fuelPlanned, fuelReachable, fuelSupply, inHome } from "./fuel";
import { roadMoves } from "./moves";
import { fieldId } from "./clusters";

// Terms and pledges (docs/brief.md, Revision 5, step 2: the probe). Play runs in terms
// of `termDays`; at each term's start the state offers three pledges, each made from a
// problem the world already has -- a town no road reaches, cement or fuel short, riders
// left without a seat, a town expecting more of you, a town to grow -- never from a
// script (principles §2, amended 2026-10-24). You commit to up to two. The probe has no
// grant and no penalty: it asks whether a goal on screen changes a session. At a term's
// end, a verdict: what you kept. The first term's pledges come from the home cluster;
// from the second, anywhere (the region's far clusters, reached through pledges).
//
// Alongside, "a week on" (the review's receipts): a week after something you build, what
// it did -- trips between its towns, their growth -- so a move's effect lands as an event.
//
// The mandate (Revision 5, step 3, behind `mandateEnabled`): a term's verdict sets the next
// term's capital grant -- a base, more for each pledge kept and for the people grown -- paid
// in at the term's start, any debt cleared from it first (a running deficit eats into it).
// A term fails when no pledge is kept or the towns shrink; two failed terms in a row and the
// state replaces you. The save goes on (a long save, as agreed), with the record kept.
//
// Plain data on the world, changed only here and by the `pledge` and `console` actions, so
// a run file replays it. Off (and absent) when the run's tuning has no `pledgesEnabled`.

export type PledgeKind = "connect" | "cement" | "fuel" | "seats" | "service" | "grow" | "reach";

export interface Pledge {
  id: string;
  kind: PledgeKind;
  townId: string;
  /** What it says, in the strip. */
  text: string;
  /** The measure when it was offered, and the one that keeps it. */
  from: number;
  target: number;
  committed: boolean;
  /** Set the day a committed pledge is met, and at the term's end for the rest. */
  kept: boolean | null;
}

export interface TermRecord {
  number: number;
  kept: string[];
  missed: string[];
  /** The missed pledges' kind and town (`kind:townId`): not offered again the very next term. */
  missedKeys?: string[];
  /** Thousands of people in the original towns at its end, against its start. */
  peopleFrom: number;
  peopleTo: number;
  /** The mandate: no pledge kept or the towns shrank; and the grant this verdict set for the next term (debt it cleared included). */
  failed?: boolean;
  grant?: number;
}

export interface TermState {
  number: number;
  startedAtSeconds: number;
  endsAtSeconds: number;
  pledges: Pledge[];
  peopleAtStart: number;
  history: TermRecord[];
  /** Builds waiting for their week (a week on). */
  watching: Array<{ label: string; towns: string[]; atSeconds: number; people: number[]; trips: number }>;
  nextCheckAtSeconds: number;
  /** The mandate: failed terms in a row; when the state replaced you (absent: it hasn't). */
  failedInRow?: number;
  replacedAtSeconds?: number;
}

export const MAX_COMMITTED = 2;
const OFFERED = 3;

const people = (world: GameWorld) => [...world.basePopulation.keys()].reduce((sum, id) => sum + (world.towns.get(id)?.population ?? 0), 0);
const nameOf = (world: GameWorld, id: string) => world.towns.get(id)?.name ?? id;
const lowerIsBetter = (kind: PledgeKind) => kind === "seats";

/** The pledge's measure now. */
export function pledgeValue(world: GameWorld, pledge: Pledge): number {
  switch (pledge.kind) {
    case "connect": return isCutOff(world, pledge.townId) ? 0 : 1;
    case "cement": return cementServed(world, pledge.townId);
    case "fuel": return fuelSupply(world, pledge.townId)?.supplied ?? 1;
    case "seats": return townNoSeat(world, pledge.townId)?.perDay ?? 0;
    case "service": return townGrowth(world, pledge.townId)?.playerShare ?? 0;
    case "grow": return world.towns.get(pledge.townId)?.population ?? 0;
    case "reach": {
      const cluster = clusterOf(world, pledge.townId);
      return cluster ? clusterOfferShare(world, cluster)?.share ?? 0 : 0;
    }
  }
}

/**
 * Where a pledge stands now, as words ("now 14%"): read live, not kept in its text -- a
 * pledge offered at 0% still said "now 0%" with you at 14% (playtest, 2026-10-24).
 */
export function pledgeNow(world: GameWorld, pledge: Pledge): string {
  const value = pledgeValue(world, pledge);
  switch (pledge.kind) {
    case "connect": return value >= 1 ? "connected" : "";
    case "cement": case "fuel": case "service": return `now ${Math.round(value * 100)}%`;
    // Not while it's where it started: "from 220 a day (now 220 a day)" read as nothing done
    // (outside review, 2026-10-26).
    case "seats": return Math.round(value) === Math.round(pledge.from) ? "" : `now ${Math.round(value)} a day`;
    case "grow": return `now ${Math.round(value)}k`;
    case "reach": return `now ${Math.round(value * 100)}% arriving`;
  }
}

/**
 * The move that would most likely answer a pledge, with its price (outside review,
 * 2026-10-26: a pledge read as a task with no way in -- "Connect Ota by road" said nothing
 * of what a road there costs, the refinery's ₦60k sat apart from the fuel pledge it
 * answers). The same moves Waiting on you and the town panel name; null when nothing one
 * move does is the answer (a town to grow by service it already has).
 */
export function pledgeMove(world: GameWorld, pledge: Pledge): NamedMove | null {
  const t = world.tuning;
  const yard = (townId: string): NamedMove | null =>
    world.yards.has(townId) ? null : { action: { kind: "yard", townId }, price: t.yardCost, label: `A yard at ${nameOf(world, townId)} (Y)` };
  // The cheapest road that joins a cut-off place to a town on the network (not to a site:
  // "a road Epe–Ilugun Garri Mill" joined it to a mill, not to anyone's trips).
  const road = (townId: string): NamedMove | null => {
    const best = roadMoves(world).filter((m) => m.action.a === townId && !world.towns.get(m.action.b)?.industry).sort((p, q) => p.price - q.price)[0];
    return best ? { action: best.action, price: best.price, label: `A road ${nameOf(world, townId)}–${nameOf(world, best.action.b)} (R)` } : null;
  };
  const finite = (move: NamedMove | null | undefined) => (move && Number.isFinite(move.price) ? move : null);
  switch (pledge.kind) {
    case "connect": return road(pledge.townId);
    case "cement": {
      const b = cementBreak(world);
      if (!b || !world.cement) return null;
      if (b.kind === "idle") return { action: { kind: "restoreWorks" }, price: t.worksRestoreCost, label: "Restore the cement works" };
      if (b.kind === "quarry") return yard(b.quarryId);
      return b.kind === "carry" ? yard(world.cement.worksId) : null;
    }
    case "fuel": {
      const fuel = world.fuel;
      if (!fuel) return null;
      // A yard at the tank farm sends its tankers further: the answer where imports are there
      // but can't reach the town. Tried on the plan (fuelPlanned), not guessed; else the refinery.
      if (t.yardsEnabled && !world.yards.has(fuel.depotId)) {
        const before = fuelPlanned(world, pledge.townId) ?? 0;
        world.yards.add(fuel.depotId);
        const after = fuelPlanned(world, pledge.townId) ?? 0;
        world.yards.delete(fuel.depotId);
        if (after > before + 0.05) return yard(fuel.depotId);
      }
      if (!fuelReachable(world, pledge.townId, fuel.refineryId)) return null;
      if (!fuel.restored) return { action: { kind: "restoreRefinery" }, price: t.refineryRestoreCost, label: "Restore the refinery" };
      return yard(fuel.sourceId) ?? yard(fuel.refineryId);
    }
    case "seats": return finite(townNoSeat(world, pledge.townId)?.move);
    case "service": case "grow": return finite(serviceMove(world, pledge.townId));
    case "reach": {
      const cluster = clusterOf(world, pledge.townId);
      if (!cluster) return null;
      // Limestone comes from the field on the ridge, a farm belt's staple from its towns.
      const from = cluster.offer === "limestone" ? fieldId(cluster) : cluster.hub;
      return isCutOff(world, from) ? road(from) : yard(from);
    }
  }
}

/** How far along, 0..1. */
export function pledgeProgress(world: GameWorld, pledge: Pledge): number {
  if (pledge.kept) return 1;
  const value = pledgeValue(world, pledge);
  const span = lowerIsBetter(pledge.kind) ? pledge.from - pledge.target : pledge.target - pledge.from;
  if (span <= 0) return 1;
  const done = lowerIsBetter(pledge.kind) ? pledge.from - value : value - pledge.from;
  return Math.max(0, Math.min(1, done / span));
}

/** The pledges the world's problems offer now: the most pressing of each kind, three kinds at most. */
function offerPledges(world: GameWorld, number: number, missedLast: Set<string>): Pledge[] {
  const towns = [...world.basePopulation.keys()]
    .map((id) => world.towns.get(id)!)
    .filter((town) => town && !town.industry && (number > 1 || inHome(world, town)));
  const candidates: Array<{ pledge: Omit<Pledge, "id" | "committed" | "kept">; weight: number }> = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  for (const town of towns) {
    const name = town.name;
    if (isCutOff(world, town.id)) {
      candidates.push({ pledge: { kind: "connect", townId: town.id, text: `Connect ${name} by road`, from: 0, target: 1 }, weight: town.population });
      continue;
    }
    const growth = townGrowth(world, town.id);
    if (world.cement && growth && growth.cementHeld >= Math.max(5, 0.05 * town.population)) {
      const now = cementServed(world, town.id);
      candidates.push({ pledge: { kind: "cement", townId: town.id, text: `Cement to ${name}: 80% of what it needs`, from: now, target: 0.8 }, weight: growth.cementHeld * 2 });
    }
    // Short by the network, not by this week's tankers (fuelPlanned).
    const fuel = fuelSupply(world, town.id)?.supplied;
    const planned = fuelPlanned(world, town.id);
    if (fuel !== undefined && fuel < 0.6 && planned !== null && planned < 0.6 && fuelReachable(world, town.id)) {
      candidates.push({ pledge: { kind: "fuel", townId: town.id, text: `Fuel in ${name}: 80% supplied`, from: fuel, target: 0.8 }, weight: town.population * (1 - fuel) });
    }
    const seat = townNoSeat(world, town.id);
    if (seat && seat.perDay >= 40) {
      candidates.push({ pledge: { kind: "seats", townId: town.id, text: `Halve those left without a seat at ${name}: ${Math.round(seat.perDay)} a day to ${Math.round(seat.perDay / 2)}`, from: seat.perDay, target: seat.perDay / 2 }, weight: seat.perDay / 4 });
    }
    if (growth && growth.expected > 0 && growth.playerShare < growth.expected) {
      // What it expects, and a good step past where you are: three buses met "16% of Kabba" in three days.
      const target = Math.min(0.9, Math.ceil(Math.max(growth.expected, growth.playerShare + 0.2) * 20) / 20);
      candidates.push({ pledge: { kind: "service", townId: town.id, text: `Carry ${pct(target)} of ${name}'s trips`, from: growth.playerShare, target }, weight: town.population * (growth.expected - growth.playerShare) * 2 });
    }
    const to = Math.ceil(town.population * 1.15);
    candidates.push({ pledge: { kind: "grow", townId: town.id, text: `${name} to ${to}k`, from: town.population, target: to }, weight: town.population * 0.05 });
  }
  // From term 2, a far cluster's offer (clusters.ts): bring half of it home. Weighted to lead:
  // it's the reason to go out to the region.
  if (number > 1) {
    for (const cluster of world.clusters ?? []) {
      const offer = clusterOfferShare(world, cluster);
      const hub = world.towns.get(cluster.hub);
      if (!offer || !hub || offer.share >= 0.5) continue;
      const text = cluster.offer === "limestone"
        ? `Bring ${hub.name}'s limestone to your cement works: half of its ${Math.round(offer.perDay)} t a day`
        : `Bring ${hub.name}'s farm belt to your mill: half of its ${Math.round(offer.perDay)} t a day`;
      candidates.push({ pledge: { kind: "reach", townId: hub.id, text, from: offer.share, target: 0.5 }, weight: 1e6 + hub.population });
    }
  }
  candidates.sort((p, q) => q.weight - p.weight);
  // A pledge just missed doesn't come straight back (Katsina-Ala's seats was offered three terms running).
  const kinds = new Set<PledgeKind>();
  const placesUsed = new Set<string>();
  const offered: Pledge[] = [];
  for (const { pledge } of candidates) {
    if (offered.length >= OFFERED) break;
    if (kinds.has(pledge.kind) || placesUsed.has(pledge.townId) || missedLast.has(`${pledge.kind}:${pledge.townId}`)) continue;
    kinds.add(pledge.kind);
    placesUsed.add(pledge.townId);
    offered.push({ ...pledge, id: `${number}:${pledge.kind}:${pledge.townId}`, committed: false, kept: null });
  }
  return offered;
}

function openTerm(world: GameWorld, number: number, at: number, history: TermRecord[], watching: TermState["watching"]): GameEvent {
  const days = world.tuning.termDays ?? 120;
  const pledges = offerPledges(world, number, new Set(history.at(-1)?.missedKeys ?? []));
  world.term = { number, startedAtSeconds: at, endsAtSeconds: at + days * D, pledges, peopleAtStart: people(world), history, watching, nextCheckAtSeconds: at + D };
  return { kind: "term-started", number, pledges: pledges.map((p) => p.text) };
}

/** The first term, as play begins (start.ts, after the warm-up). */
export function startTerms(world: GameWorld): void {
  if (!world.tuning.pledgesEnabled || world.term) return;
  openTerm(world, 1, world.economy.elapsedSeconds, [], []);
  // The mandate's opening grant: term 1 begins with money to build with, as each later term
  // does (three games running, the first hundred days were a slide from ₦2.7k into debt).
  const opening = world.tuning.mandateEnabled ? world.tuning.termOpeningGrant ?? 0 : 0;
  if (opening > 0) {
    world.economy.funds += opening;
    world.budget.grant = (world.budget.grant ?? 0) + opening;
  }
}

/** Once a game day: pledges met, builds a week on, and a term's end. */
export function updateTerm(world: GameWorld): GameEvent[] {
  const term = world.term;
  if (!world.tuning.pledgesEnabled || !term) return [];
  const now = world.economy.elapsedSeconds;
  if (now < term.nextCheckAtSeconds) return [];
  term.nextCheckAtSeconds = now + D;
  const events: GameEvent[] = [];
  for (const pledge of term.pledges) {
    if (pledge.committed && pledge.kept === null && pledgeProgress(world, pledge) >= 1) {
      pledge.kept = true;
      events.push({ kind: "pledge-kept", number: term.number, text: pledge.text, townId: pledge.townId });
    }
  }
  // A week on: what each build did.
  term.watching = term.watching.filter((watch) => {
    if (now < watch.atSeconds + 7 * D) return true;
    const grew = watch.towns.map((id, i) => ({ id, by: (world.towns.get(id)?.population ?? 0) - watch.people[i]! }));
    events.push({ kind: "a-week-on", label: watch.label, towns: watch.towns, tripsBy: tripsBetween(world, watch.towns) - watch.trips, grew });
    return false;
  });
  if (now >= term.endsAtSeconds) {
    const kept = term.pledges.filter((p) => p.committed && (p.kept || pledgeProgress(world, p) >= 1));
    const missed = term.pledges.filter((p) => p.committed && !kept.includes(p));
    for (const p of term.pledges) p.kept = kept.includes(p);
    const record: TermRecord = { number: term.number, kept: kept.map((p) => p.text), missed: missed.map((p) => p.text), missedKeys: missed.map((p) => `${p.kind}:${p.townId}`), peopleFrom: term.peopleAtStart, peopleTo: people(world) };
    let failedInRow = 0;
    let replacedAtSeconds = term.replacedAtSeconds;
    if (world.tuning.mandateEnabled) {
      const t = world.tuning;
      record.failed = kept.length === 0 || record.peopleTo < record.peopleFrom;
      record.grant = (t.termGrantBase ?? 0) + (t.termGrantPerPledge ?? 0) * kept.length + (t.termGrantPerThousand ?? 0) * Math.max(0, record.peopleTo - record.peopleFrom);
      failedInRow = record.failed ? (term.failedInRow ?? 0) + 1 : 0;
    }
    events.push({ kind: "term-ended", number: record.number, kept: record.kept, missed: record.missed, peopleFrom: record.peopleFrom, peopleTo: record.peopleTo, ...(record.failed !== undefined ? { failed: record.failed, grant: record.grant!, failedInRow } : {}) });
    if (world.tuning.mandateEnabled && failedInRow >= 2 && replacedAtSeconds === undefined) {
      replacedAtSeconds = now;
      events.push({ kind: "replaced", number: record.number, terms: [...term.history, record].length });
    }
    events.push(openTerm(world, term.number + 1, now, [...term.history, record], term.watching));
    world.term!.failedInRow = failedInRow;
    if (replacedAtSeconds !== undefined) world.term!.replacedAtSeconds = replacedAtSeconds;
    // The grant, paid in as the new term starts.
    if (record.grant) {
      world.economy.funds += record.grant;
      world.budget.grant = (world.budget.grant ?? 0) + record.grant;
    }
  }
  return events;
}

/** Trips a day made between the towns (both ways, each pair), or from the one town. */
function tripsBetween(world: GameWorld, towns: string[]): number {
  const made = (key: string) => {
    const r = world.pairOutcomes.get(key);
    return r ? (r.player + r.poached + r.gaveUp) * D : 0;
  };
  if (towns.length >= 2) return made(pairKey(towns[0]!, towns[1]!)) + made(pairKey(towns[1]!, towns[0]!));
  const from = world.outcomeIndex?.from.get(towns[0]!);
  return from ? (from.player + from.poached + from.gaveUp) * D : 0;
}

/** What a build is called a week on, and its towns; null for what isn't a build. */
function buildOf(world: GameWorld, spec: ActionSpec): { label: string; towns: string[] } | null {
  const ab = (a: string, b: string) => `${nameOf(world, a)}–${nameOf(world, b)}`;
  switch (spec.kind) {
    case "road": return { label: `the road ${ab(spec.a, spec.b)}`, towns: [spec.a, spec.b] };
    case "pave": return { label: `paving ${ab(spec.a, spec.b)}`, towns: [spec.a, spec.b] };
    case "lane": return { label: `the bus lane ${ab(spec.a, spec.b)}`, towns: [spec.a, spec.b] };
    case "track": return { label: `the track ${ab(spec.a, spec.b)}`, towns: [spec.a, spec.b] };
    case "bus": case "minibus": case "brt": case "train":
      return { label: `the ${spec.kind === "brt" ? "BRT" : spec.kind} ${ab(spec.a, spec.b)}`, towns: [spec.a, spec.b] };
    case "yard": return { label: `the yard at ${nameOf(world, spec.townId)}`, towns: [spec.townId] };
    case "park": return { label: `the motor park at ${nameOf(world, spec.townId)}`, towns: [spec.townId] };
    case "metro": return { label: `the metro in ${nameOf(world, spec.townId)}`, towns: [spec.townId] };
    default: return null;
  }
}

/** Called for every action that went through (actions.ts): commits a pledge, or starts a build's week. */
export function noteAction(world: GameWorld, spec: ActionSpec): void {
  const term = world.term;
  if (!world.tuning.pledgesEnabled || !term) return;
  const build = buildOf(world, spec);
  // One note a week for the same towns, whichever way round and whatever was built: a bus each
  // way, or a bus and its road, made two or three notes saying the same (36 in one game).
  const towns = [...build?.towns ?? []].sort().join("|");
  if (!build || term.watching.some((w) => [...w.towns].sort().join("|") === towns)) return;
  term.watching.push({ ...build, atSeconds: world.economy.elapsedSeconds, people: build.towns.map((id) => world.towns.get(id)?.population ?? 0), trips: tripsBetween(world, build.towns) });
}

/**
 * The design console's moves (behind ?dev=1 on the page; brief, Revision 5): end the term
 * now, or set the money. Actions like any other, so a run file records them as such.
 */
export function consoleMove(world: GameWorld, op: "end-term" | "funds" | "rains", amount = 0): { ok: boolean; reason?: string } {
  if (op === "rains") return rainsNow(world);
  if (op === "funds") {
    world.economy.funds = amount;
    return { ok: true };
  }
  const term = world.term;
  if (!term) return { ok: false, reason: "no term running" };
  term.endsAtSeconds = world.economy.elapsedSeconds;
  term.nextCheckAtSeconds = world.economy.elapsedSeconds;
  return { ok: true };
}

/** Commit to a pledge on offer this term: public, so not undone. */
export function commitPledge(world: GameWorld, id: string): { ok: boolean; reason?: string } {
  const term = world.term;
  if (!world.tuning.pledgesEnabled || !term) return { ok: false, reason: "no term running" };
  const pledge = term.pledges.find((p) => p.id === id);
  if (!pledge) return { ok: false, reason: "not on offer this term" };
  if (pledge.committed) return { ok: false, reason: "already pledged" };
  if (term.pledges.filter((p) => p.committed).length >= MAX_COMMITTED) return { ok: false, reason: `you've pledged ${MAX_COMMITTED} this term` };
  pledge.committed = true;
  return { ok: true };
}

/** "A week on" as a line: what the build did to trips between its towns, and their size. */
export function aWeekOnText(world: GameWorld, e: { label: string; tripsBy: number; grew: Array<{ id: string; by: number }> }): string {
  const sign = (x: number, unit = "") => `${x >= 0 ? "+" : "−"}${Math.abs(x) >= 10 ? Math.round(Math.abs(x)).toLocaleString() : Math.abs(x).toFixed(1)}${unit}`;
  const trips = Math.abs(e.tripsBy) >= 1 ? `${sign(e.tripsBy)} trips a day` : "no change in trips yet";
  const grew = e.grew.filter((g) => Math.abs(g.by) >= 0.1).map((g) => `${nameOf(world, g.id)} ${sign(g.by, "k")}`);
  return `A week on, ${e.label}: ${trips}${grew.length ? `; ${grew.join(", ")}` : ""}`;
}

/** A term's verdict as a line. */
export function termVerdictText(e: { number: number; kept: string[]; missed: string[]; peopleFrom: number; peopleTo: number; failed?: boolean; grant?: number }): string {
  const pledged = e.kept.length + e.missed.length;
  const grown = e.peopleTo - e.peopleFrom;
  const pledges = pledged === 0 ? "no pledges made" : `${e.kept.length} of ${pledged} pledge${pledged === 1 ? "" : "s"} kept`;
  const mandate = e.failed === undefined ? "" : `${e.failed ? " -- a failed term" : ""}; a grant of ₦${Math.round(e.grant ?? 0).toLocaleString()} for the next`;
  return `Term ${e.number} ended: ${pledges}; the towns ${grown >= 0 ? "grew" : "shrank"} by ${Math.abs(Math.round(grown))}k${mandate}`;
}
