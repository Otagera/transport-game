import type { GameWorld } from "./types";
import type { ActionSpec } from "./actions";
import { diagnoseRoute, findRoute, isBrtRoute, isMinibusRoute, laneCost, pairDemand, paveCost, roadPath, routeSummaries } from "./world";
import { growthTrend, roadFull, townGrowth } from "./growth";
import { corridorsAlong } from "./corridors";
import { laneEncroachment, lanesBySegment } from "./pushback";
import { isRailRoute, railPath } from "./rail";
import { rungPrice } from "./project";
import { averageNet } from "./history";
import { corridorWear } from "./wear";
import { chainOf } from "./world";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// Revision 2, step 1 (docs/brief.md, agreed 2026-10-19): show the problems
// the late game already has. At day 210 of the R1 7 playtest, 2,865 trips a
// day found no seat and three towns were shrinking, and the game read as
// "nothing more to build": the town card said "N% of its trips have a road
// but no seat: nobody carried them" (no corridor, no move) and "shrinking
// toward 31k" (no cause). Here, each problem names its cause and one move,
// with a price, so the screen can say what to do and C5 can count the days
// it does.

/** A move the screen names to fix a problem: what it is, what it costs, and how it reads. */
export interface NamedMove {
  action: ActionSpec;
  price: number;
  /** "Add a bus to Ikire ↔ Ido (+)", "Pave Ikire–Okeho (R)". */
  label: string;
}

/** A town's day, kept to say why it's shrinking: what it was heading for, and why. */
export interface TownSample {
  atSeconds: number;
  target: number;
  cap: number;
  service: number;
  playerShare: number;
}

/** How long each town's days are kept, and how far back "it was heading for more" looks. */
export const TOWN_SAMPLE_DAYS = 30;
/** A corridor or town with fewer trips a day than this finding no seat isn't a problem worth a line. */
export const NO_SEAT_MIN_PER_DAY = 20;
/** C5: a move counts as affordable if it costs no more than funds plus this many days of net. */
export const AFFORDABLE_DAYS = 10;
/** Below this many trips a day wanted between two towns, the move is a minibus, not a bus (the minibus is for thin routes). */
const MINIBUS_BELOW_PER_DAY = 100;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const nameOf = (world: GameWorld, id: string) => world.towns.get(id)?.name ?? id;

/** Called with each day's sample (history.ts recordDay): every original town's growth, kept TOWN_SAMPLE_DAYS. */
export function sampleTowns(world: GameWorld): void {
  for (const townId of world.basePopulation.keys()) {
    const growth = townGrowth(world, townId);
    if (!growth) continue;
    const samples = world.history.towns.get(townId) ?? [];
    samples.push({ atSeconds: world.economy.elapsedSeconds, target: growth.target, cap: growth.cap, service: growth.service, playerShare: growth.playerShare });
    if (samples.length > TOWN_SAMPLE_DAYS) samples.shift();
    world.history.towns.set(townId, samples);
  }
}

const dayOf = (world: GameWorld, seconds: number) => Math.max(1, Math.floor((seconds - world.startSeconds) / SECONDS_PER_GAME_DAY) + 1);

/**
 * The move that would carry more of the trips between two towns a road or
 * track joins: the next rung if a town at either end has grown to all its
 * road allows on the road they share; else another vehicle on a route you
 * already run between them; else a new one -- a minibus where the pair is
 * thin, a bus where it isn't.
 */
export function seatMove(world: GameWorld, a: string, b: string): NamedMove {
  const path = roadPath(world, a, b);
  for (const end of [a, b]) {
    const full = roadFull(world, end);
    if (!full?.road || full.thin || !path) continue;
    const along = corridorsAlong(world, path.segmentIds);
    if (![...corridorsAlong(world, roadPath(world, full.road.a, full.road.b)?.segmentIds ?? [])].some((key) => along.has(key))) continue;
    const road = `${nameOf(world, full.road.a)}–${nameOf(world, full.road.b)}`;
    if (full.next === "paved") return { action: { kind: "pave", a: full.road.a, b: full.road.b }, price: paveCost(world, full.road.a, full.road.b), label: `Pave ${road} (R)` };
    if (full.next === "lane") return { action: { kind: "lane", a: full.road.a, b: full.road.b }, price: laneCost(world, full.road.a, full.road.b), label: `A bus lane on ${road} (R)` };
    return { action: { kind: "track", a: full.road.a, b: full.road.b, alignment: "cheapest" }, price: rungPrice(world, full.road.a, full.road.b, "rail"), label: `Rail on ${road} (K)` };
  }
  const pair = `${nameOf(world, a)} ↔ ${nameOf(world, b)}`;
  const t = world.tuning;
  // A route you run between them, of any vehicle: one more of it.
  const route = world.routes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a)) ?? findRoute(world, a, b);
  if (route) {
    const kind = isRailRoute(route.id) ? "train" : isMinibusRoute(route.id) ? "minibus" : isBrtRoute(route.id) ? "brt" : "bus";
    const price = kind === "train" ? t.trainPurchaseCost : kind === "minibus" ? t.minibusPurchaseCost : kind === "brt" ? t.brtPurchaseCost : t.busPurchaseCost;
    const noun = kind === "brt" ? "BRT bus" : kind;
    // Only where one more would pay: a route losing money, or whose vehicles earn less than
    // they cost to run, loses more with another (the OpenCode player, day 95: following
    // "Add a minibus (+)" took its net from +₦905 to -₦442 a day). Then it's not a move:
    // an infinite price keeps it off namedMoves, and the label says why.
    // A route needs a few days running to be judged: new, it has earned nothing yet.
    const d = diagnoseRoute(world, route.id);
    const net = routeSummaries(world).find((r) => r.id === route.id)?.netPerDay ?? 0;
    const judged = world.economy.elapsedSeconds - route.openedAtSeconds >= 3 * SECONDS_PER_GAME_DAY;
    if (d && judged && (net < 0 || d.incomePerVehicle < d.costPerVehicle)) {
      return { action: { kind, a: route.a, b: route.b }, price: Infinity, label: `${pair}: another ${noun} wouldn't pay (each earns ₦${Math.round(d.incomePerVehicle)} a day against ₦${Math.round(d.costPerVehicle)} to run)` };
    }
    return { action: { kind, a: route.a, b: route.b }, price, label: `Add a ${noun} to ${pair} (+)` };
  }
  if (!path && railPath(world, a, b)) return { action: { kind: "train", a, b }, price: t.trainPurchaseCost, label: `Run a train ${pair} (T)` };
  const thin = pairDemand(world, a, b) * SECONDS_PER_GAME_DAY < MINIBUS_BELOW_PER_DAY;
  return thin
    ? { action: { kind: "minibus", a, b }, price: t.minibusPurchaseCost, label: `Run a minibus ${pair} (M)` }
    : { action: { kind: "bus", a, b }, price: t.busPurchaseCost, label: `Run a bus ${pair} (B)` };
}

export interface NoSeatPair {
  a: string;
  b: string;
  /** Trips a day between them, both ways, that a road or track joins but nobody carried. */
  perDay: number;
}

/** Every joined pair's no seat a day, both ways combined, worst first. */
export function noSeatPairs(world: GameWorld): NoSeatPair[] {
  const byPair = new Map<string, NoSeatPair>();
  for (const [key, rates] of world.pairOutcomes) {
    if (rates.lost <= 0) continue;
    const separator = key.indexOf(":");
    const from = key.slice(0, separator);
    const to = key.slice(separator + 1);
    if (!roadPath(world, from, to) && !railPath(world, from, to)) continue; // no road: not a seat problem
    const [a, b] = from < to ? [from, to] : [to, from];
    const pair = byPair.get(`${a}~${b}`) ?? { a, b, perDay: 0 };
    pair.perDay += rates.lost * SECONDS_PER_GAME_DAY;
    byPair.set(`${a}~${b}`, pair);
  }
  return [...byPair.values()].sort((x, y) => y.perDay - x.perDay);
}

export interface TownNoSeat {
  perDay: number;
  worst: NoSeatPair;
  /** The corridor the worst pair's trips leave the town on, by its end towns; null when they'd go by rail. */
  corridor: { a: string; b: string } | null;
  move: NamedMove;
}

/** A town's trips a day that find no seat, the pair most of them want, the road they'd take out, and the move. */
export function townNoSeat(world: GameWorld, townId: string): TownNoSeat | null {
  const pairs = noSeatPairs(world).filter((p) => p.a === townId || p.b === townId);
  const perDay = pairs.reduce((sum, p) => sum + p.perDay, 0);
  if (perDay < NO_SEAT_MIN_PER_DAY || pairs.length === 0) return null;
  const worst = pairs[0]!;
  const path = roadPath(world, worst.a, worst.b);
  const firstKey = path ? [...corridorsAlong(world, path.segmentIds.slice(0, 1))][0] : undefined;
  const first = firstKey ? world.corridors.get(firstKey) : undefined;
  return { perDay, worst, corridor: first ? { a: first.a, b: first.b } : null, move: seatMove(world, worst.a, worst.b) };
}

/** Each corridor's no seat a day (trips along it nobody carried), with the pair most of them want and its move; worst first. */
export function corridorNoSeat(world: GameWorld): Map<string, { perDay: number; worst: NoSeatPair; move: NamedMove }> {
  const byCorridor = new Map<string, { perDay: number; worst: NoSeatPair }>();
  for (const pair of noSeatPairs(world)) {
    const path = roadPath(world, pair.a, pair.b);
    if (!path) continue;
    for (const key of corridorsAlong(world, path.segmentIds)) {
      const entry = byCorridor.get(key);
      if (!entry) byCorridor.set(key, { perDay: pair.perDay, worst: pair });
      else entry.perDay += pair.perDay; // pairs come worst first, so the first one stays the worst
    }
  }
  const result = new Map<string, { perDay: number; worst: NoSeatPair; move: NamedMove }>();
  for (const [key, entry] of [...byCorridor].sort((x, y) => y[1].perDay - x[1].perDay)) {
    result.set(key, { ...entry, move: seatMove(world, entry.worst.a, entry.worst.b) });
  }
  return result;
}

export interface ShrinkCause {
  /** "you carry 6% of its trips, down from 14% on day 120: it grows only above 10%". */
  why: string;
  move: NamedMove | null;
}

/**
 * Why a shrinking town is shrinking, against what it was heading for at its
 * recent peak (the highest target in the last TOWN_SAMPLE_DAYS): your share
 * fell below the floor growth needs; its road allows less (a lane the danfos
 * have taken, worn track); or its service fell. Null when it isn't shrinking.
 */
export function shrinkCause(world: GameWorld, townId: string): ShrinkCause | null {
  if (growthTrend(world, townId) !== "shrinking") return null;
  const now = townGrowth(world, townId);
  if (!now) return null;
  const samples = world.history.towns.get(townId) ?? [];
  const peak = samples.reduce<TownSample | null>((best, s) => (!best || s.target > best.target ? s : best), null);
  const min = world.tuning.growthMinPlayerShare;
  const worst = townNoSeat(world, townId);
  const serviceMove = worst?.move ?? biggestPairMove(world, townId);
  if (peak && now.playerShare < min && peak.playerShare >= min) {
    return { why: `you carry ${pct(now.playerShare)} of its trips, down from ${pct(peak.playerShare)} on day ${dayOf(world, peak.atSeconds)}; it grows only above ${pct(min)}`, move: serviceMove };
  }
  if (now.playerShare < min) return { why: `you carry ${pct(now.playerShare)} of its trips; it grows only above ${pct(min)}`, move: serviceMove };
  if (peak && peak.cap - now.cap > 0.03 * now.base) {
    const lane = laneAtTown(world, townId);
    if (lane && lane.taken > 0.1) {
      return {
        why: `its bus lane on ${nameOf(world, lane.a)}–${nameOf(world, lane.b)} is ${pct(lane.taken)} taken by danfos, so its road allows less`,
        move: { action: { kind: "enforce", a: lane.a, b: lane.b, enforcement: "strict" }, price: 0, label: `Enforce the lane strictly (R on it)` },
      };
    }
    return { why: `its road allows less than on day ${dayOf(world, peak.atSeconds)}`, move: null };
  }
  if (peak && peak.service - now.service > 0.02) {
    return { why: `its service fell from ${pct(peak.service)} to ${pct(now.service)} since day ${dayOf(world, peak.atSeconds)} (yours ${pct(now.playerShare)})`, move: serviceMove };
  }
  return { why: `its service is ${pct(now.service)} (yours ${pct(now.playerShare)}): not enough to hold its size`, move: serviceMove };
}

/** The move for a town's biggest trip with a road: what would carry more of its people. */
function biggestPairMove(world: GameWorld, townId: string): NamedMove | null {
  let best: { other: string; demand: number } | null = null;
  for (const other of world.towns.keys()) {
    if (other === townId || (!roadPath(world, townId, other) && !railPath(world, townId, other))) continue;
    const demand = pairDemand(world, townId, other);
    if (!best || demand > best.demand) best = { other, demand };
  }
  return best ? seatMove(world, townId, best.other) : null;
}

/** A bus lane on a road at the town, with how much of it the danfos have taken. */
function laneAtTown(world: GameWorld, townId: string): { a: string; b: string; taken: number } | null {
  if (world.lanes.length === 0) return null;
  const by = lanesBySegment(world);
  const taken = laneEncroachment(world);
  for (const segment of world.simulation.map.segments) {
    if (segment.fromNodeId !== townId && segment.toNodeId !== townId) continue;
    const lane = by.get(segment.id);
    if (lane) return { a: lane.a, b: lane.b, taken: taken.get(segment.id) ?? 0 };
  }
  return null;
}

/** Below this speed, a road your vehicles use is worn enough to name. */
export const WORN_SPEED = 0.85;

export interface WornRoad {
  a: string;
  b: string;
  speed: number;
  roughPerDay: number;
  move: NamedMove;
}

/**
 * The most worn road at a town that your vehicles pay for (brief, Revision
 * 2: the town card says why), with the move: keep it up, its catch-up repair
 * as the price. Null when wear is off, or no road of yours there is worn.
 */
export function wornRoadAt(world: GameWorld, townId: string): WornRoad | null {
  if (!world.tuning.wearEnabled) return null;
  let worst: WornRoad | null = null;
  const seen = new Set<string>();
  for (const segment of world.simulation.map.segments) {
    if (segment.type !== "road" || (segment.fromNodeId !== townId && segment.toNodeId !== townId)) continue;
    const chain = chainOf(world, segment.id);
    if (!chain || seen.has(`${chain.a}~${chain.b}`)) continue;
    seen.add(`${chain.a}~${chain.b}`);
    const wear = corridorWear(world, chain.a, chain.b);
    if (!wear || wear.kept || wear.speed >= WORN_SPEED || wear.roughPerDay < 1) continue;
    if (worst && wear.speed >= worst.speed) continue;
    worst = {
      a: chain.a,
      b: chain.b,
      speed: wear.speed,
      roughPerDay: wear.roughPerDay,
      move: { action: { kind: "fix", segmentId: wear.pieceIds[0]!, on: true }, price: wear.repair, label: `Keep ${nameOf(world, chain.a)}–${nameOf(world, chain.b)} up (${Math.round(wear.upkeepPerDay)}/day after)` },
    };
  }
  return worst;
}

/**
 * Every move the screen names now -- each town's no seat and shrink cause,
 * each corridor's no seat -- once each. C5 counts the days one of them is
 * affordable (price within funds plus AFFORDABLE_DAYS of the 5-day net).
 */
export function namedMoves(world: GameWorld): NamedMove[] {
  const moves = new Map<string, NamedMove>();
  const add = (move: NamedMove | null | undefined) => {
    if (move && Number.isFinite(move.price)) moves.set(move.label, move);
  };
  for (const townId of world.towns.keys()) {
    add(townNoSeat(world, townId)?.move);
    add(shrinkCause(world, townId)?.move);
    add(wornRoadAt(world, townId)?.move);
  }
  for (const entry of corridorNoSeat(world).values()) if (entry.perDay >= NO_SEAT_MIN_PER_DAY) add(entry.move);
  return [...moves.values()];
}

/** Whether a named move is affordable now: within funds plus AFFORDABLE_DAYS of the 5-day net. */
export function affordable(world: GameWorld, move: NamedMove): boolean {
  return move.price <= world.economy.funds + AFFORDABLE_DAYS * Math.max(0, averageNet(world));
}
