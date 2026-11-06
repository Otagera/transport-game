import type { GameWorld } from "./types";
import type { ActionSpec } from "./actions";
import { canTravel, demandAlong, diagnoseRoute, findRoute, roadChain, routeSegments, isBrtRoute, isMinibusRoute, laneCost, pairDemand, paveCost, roadPath, routeSummaries } from "./world";
import { growthTrend, nextRungRoom, roadFull, townGrowth } from "./growth";
import { corridorsAlong } from "./corridors";
import { laneEncroachment, lanesBySegment } from "./pushback";
import { isRailRoute, railPath } from "./rail";
import { rungPrice } from "./project";
import { averageNet } from "./history";
import { corridorWear } from "./wear";
import { chainOf } from "./world";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import { vehiclePrice } from "./assembly";
import { routesOnTrip } from "./transfers";
import { epoch } from "./epoch";

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
    return rungMove(world, full.next, full.road);
  }
  const pair = `${nameOf(world, a)} ↔ ${nameOf(world, b)}`;
  const t = world.tuning;
  // A route you run between them, of any vehicle: one more of it.
  const route = world.routes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a)) ?? findRoute(world, a, b);
  if (route) {
    const kind = isRailRoute(route.id) ? "train" : isMinibusRoute(route.id) ? "minibus" : isBrtRoute(route.id) ? "brt" : "bus";
    const price = vehiclePrice(world, kind);
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
      return { action: { kind, a: route.a, b: route.b, ...(route.via?.length ? { via: route.via } : {}) }, price: Infinity, label: `${pair}: another ${noun} wouldn't pay (each earns ₦${Math.round(d.incomePerVehicle)} a day against ₦${Math.round(d.costPerVehicle)} to run)` };
    }
    return { action: { kind, a: route.a, b: route.b, ...(route.via?.length ? { via: route.via } : {}) }, price, label: `Add a ${noun} to ${pair} (+)` };
  }
  if (!path && railPath(world, a, b)) return { action: { kind: "train", a, b }, price: t.trainPurchaseCost, label: `Run a train ${pair} (T)` };
  const thin = pairDemand(world, a, b) * SECONDS_PER_GAME_DAY < MINIBUS_BELOW_PER_DAY;
  return thin
    ? { action: { kind: "minibus", a, b }, price: vehiclePrice(world, "minibus"), label: `Run a minibus ${pair} (M)` }
    : { action: { kind: "bus", a, b }, price: vehiclePrice(world, "bus"), label: `Run a bus ${pair} (B)` };
}

/** The next rung on a whole road, priced: paved, a lane, or rail. */
function rungMove(world: GameWorld, next: "paved" | "lane" | "rail", on: { a: string; b: string }): NamedMove {
  const road = `${nameOf(world, on.a)}–${nameOf(world, on.b)}`;
  if (next === "paved") return { action: { kind: "pave", a: on.a, b: on.b }, price: paveCost(world, on.a, on.b), label: `Pave ${road} (R)` };
  if (next === "lane") return { action: { kind: "lane", a: on.a, b: on.b }, price: laneCost(world, on.a, on.b), label: `A bus lane on ${road} (R)` };
  return { action: { kind: "track", a: on.a, b: on.b, alignment: "cheapest" }, price: rungPrice(world, on.a, on.b, "rail"), label: `Rail on ${road} (K)` };
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
// Read once an epoch (epoch.ts): the screen's road rows each asked for the whole map's, every
// frame -- diagnosing every line once per road -- and a phone at day 481 drew a frame in 5 seconds
// with the game paused (render-and-ui.md, On a phone). The epoch moves with every tick and action.
const corridorNoSeatCache = new WeakMap<GameWorld, { epoch: number; value: Map<string, { perDay: number; worst: NoSeatPair; move: NamedMove }> }>();

export function corridorNoSeat(world: GameWorld): Map<string, { perDay: number; worst: NoSeatPair; move: NamedMove }> {
  const now = epoch(world);
  const cached = corridorNoSeatCache.get(world);
  if (cached && cached.epoch === now) return cached.value;
  const value = corridorNoSeatFresh(world);
  corridorNoSeatCache.set(world, { epoch: now, value });
  return value;
}

function corridorNoSeatFresh(world: GameWorld): Map<string, { perDay: number; worst: NoSeatPair; move: NamedMove }> {
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
  // Your share fell as it grew: a bigger town makes more trips than your lines carry
  // (map 8703: Eligo 48% -> 36% over days 360-400 with two lines into it full).
  if (peak && peak.playerShare - now.playerShare > 0.05) {
    return { why: `you carry ${pct(now.playerShare)} of its trips, down from ${pct(peak.playerShare)} on day ${dayOf(world, peak.atSeconds)}: grown, it makes more trips than your lines take`, move: serviceMove };
  }
  if (peak && peak.service - now.service > 0.02) {
    return { why: `its service fell from ${pct(peak.service)} to ${pct(now.service)} since day ${dayOf(world, peak.atSeconds)} (yours ${pct(now.playerShare)})`, move: serviceMove };
  }
  return { why: `its service is ${pct(now.service)} (yours ${pct(now.playerShare)}): not enough to hold its size`, move: serviceMove };
}

/** The move that would carry more of a town's people: its worst no seat's, else its biggest trip's. */
export function serviceMove(world: GameWorld, townId: string): NamedMove | null {
  return townNoSeat(world, townId)?.move ?? biggestPairMove(world, townId);
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

/** A town with people to gain, what's in the way, and the move that answers it (brief, Where next). */
export interface Opening {
  townId: string;
  /** Thousands of people it has room for, past where it's heading now. */
  people: number;
  /** unserved: you carry under growthMinPlayerShare; service: more of its trips carried; road: its rung's limit. */
  kind: "unserved" | "service" | "road";
  why: string;
  /** Null where nothing can be bought for it yet (a town no road reaches: build one). */
  move: NamedMove | null;
}

/** Below this many thousand people to gain, or this share of its size, a town isn't listed. */
const OPENING_MIN_PEOPLE = 3;
const OPENING_MIN_SHARE = 0.05;

/**
 * Where next (brief, Where next; map 8703: "difficult knowing what to connect"): every original
 * town `inScope` (your remit) with room to grow, by what stops it -- its road at its rung's limit,
 * else your share of its trips -- most people first. Room is a town's growth target at the best
 * service against where it's heading now (townGrowth), so it's what better service can win, not a
 * forecast; cement and steel aren't here (Waiting on you has them, with their people).
 */
export function whereNext(world: GameWorld, inScope: (townId: string) => boolean = () => true): Opening[] {
  const openings: Opening[] = [];
  const min = world.tuning.growthMinPlayerShare;
  for (const townId of world.basePopulation.keys()) {
    const town = world.towns.get(townId);
    if (!town || town.industry || !inScope(townId)) continue;
    const growth = townGrowth(world, townId);
    if (!growth) continue;
    const enough = (people: number) => people >= OPENING_MIN_PEOPLE && people >= OPENING_MIN_SHARE * town.population;
    const k = (people: number) => `+${Math.round(people)}k`;
    const rung = nextRungRoom(world, townId);
    const full = roadFull(world, townId);
    if (full?.road && enough(rung)) {
      const now = full.rung === "dirt" ? "dirt road" : full.rung === "paved" ? "paved road" : "bus lane";
      openings.push({ townId, people: rung, kind: "road", why: `its ${now} is full: ${full.next === "paved" ? "paving" : full.next === "lane" ? "a bus lane" : "rail"} makes room for ${k(rung)}`, move: rungMove(world, full.next, full.road) });
      continue;
    }
    const room = growth.cap - growth.target;
    if (!enough(room)) continue;
    // The trip most of its people make that you don't carry: where more service wins most.
    const trip = mostUncarried(world, townId);
    const move = trip ? openingMove(world, townId, trip.other, trip.perDay) : null;
    const toward = trip ? `, most toward ${nameOf(world, trip.other)} (${Math.round(trip.perDay)} a day)` : "";
    // Below where growth starts -- your share under growthMinPlayerShare, or its service (yours
    // and half the danfos') under growthServiceFloor -- a move is only a step until it's past:
    // say how many more trips a day get it there (map 8703: Oshidi's one minibus took you from
    // 7% to 12-15%, its service to 14%, and it didn't grow).
    const t = world.tuning;
    const trips = tripsBetweenTowns(world, townId);
    // Half again over the gap: what you carry takes some riders from the danfos (half a point of
    // service each), and carried, more set out (Oshidi: 18 a day short, a minibus's ~19 left it at 14%).
    const short = 1.5 * Math.max((t.growthServiceFloor - growth.service) * trips, (min - growth.playerShare) * trips, 0);
    if (!trip) {
      openings.push({ townId, people: room, kind: "unserved", why: `no road reaches it; served, room for ${k(room)}`, move: null });
    } else if (short > 0) {
      openings.push({ townId, people: room, kind: "unserved", why: `you carry ${pct(growth.playerShare)} of its trips${toward}: carry about ${Math.max(5, Math.ceil(short / 5) * 5)} more a day and it starts to grow, room for ${k(room)}`, move });
    } else {
      openings.push({ townId, people: room, kind: "service", why: `you carry ${pct(growth.playerShare)} of its trips${toward}; carrying more makes room for ${k(room)}`, move });
    }
  }
  // Most people first; a row with nothing to buy (another vehicle wouldn't pay) after those with a move.
  const buyable = (o: Opening) => (o.move && Number.isFinite(o.move.price) ? 1 : 0);
  return openings.sort((p, q) => buyable(q) - buyable(p) || q.people - p.people);
}

/** Below this many uncarried trips a day, a trip is a road vehicle's, not a train's. */
const TRAIN_TRIPS_PER_DAY = 150;

/**
 * Where next's move for a trip: a train where track joins the two, no line of yours runs between
 * them and the trip could fill one (a bus the length of Olono-Otido loses), else the seat move.
 */
function openingMove(world: GameWorld, a: string, b: string, perDay: number): NamedMove {
  const route = world.routes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a)) ?? findRoute(world, a, b);
  if (!route && perDay >= TRAIN_TRIPS_PER_DAY && railPath(world, a, b)) {
    return { action: { kind: "train", a, b }, price: vehiclePrice(world, "train"), label: `Run a train ${nameOf(world, a)} ↔ ${nameOf(world, b)} (T)` };
  }
  return seatMove(world, a, b);
}

/** Trips a day a town's people set out on to other towns (not commutes to sites), made or not. */
function tripsBetweenTowns(world: GameWorld, townId: string): number {
  let total = 0;
  for (const [key, rates] of world.pairOutcomes) {
    const at = key.indexOf(":");
    const from = key.slice(0, at);
    const to = key.slice(at + 1);
    const other = from === townId ? to : to === townId ? from : null;
    if (!other || world.towns.get(other)?.industry) continue;
    total += rates.player + rates.poached + rates.gaveUp + rates.lost;
  }
  return total * SECONDS_PER_GAME_DAY;
}

/**
 * The town a town's people travel to that you carry least of, by trips a day not yours (both
 * ways, between towns a road or track joins): where more service makes the most difference.
 */
export function mostUncarried(world: GameWorld, townId: string): { other: string; perDay: number } | null {
  const byOther = new Map<string, number>();
  for (const [key, rates] of world.pairOutcomes) {
    const at = key.indexOf(":");
    const from = key.slice(0, at);
    const to = key.slice(at + 1);
    const other = from === townId ? to : to === townId ? from : null;
    if (!other || world.towns.get(other)?.industry || !world.towns.has(other)) continue;
    const notYours = rates.poached + rates.gaveUp + rates.lost;
    byOther.set(other, (byOther.get(other) ?? 0) + notYours);
  }
  let best: { other: string; perDay: number } | null = null;
  for (const [other, rate] of byOther) {
    if (best && rate * SECONDS_PER_GAME_DAY <= best.perDay) continue;
    if (!roadPath(world, townId, other) && !railPath(world, townId, other)) continue;
    best = { other, perDay: rate * SECONDS_PER_GAME_DAY };
  }
  return best;
}

// The airport's card (playtest, map 5059, day 653): "468 travellers a day can't get to or from
// the airport: a bus or a train carries them on" stood for 247 days over 18 buses on seven lines
// to it, four of them losing money. Every lost trip read as no way on, so the card kept asking
// for the one thing that was losing: more buses. The trips had a road; they found no seat, on
// buses worn, jammed or too long to pay -- and track already reached the airport, for freight.
// So the card splits the lost by why, says what the lines to it make, and names the move that
// answers that: a train where track reaches it; the road kept up where it's worn; another
// vehicle only where one would pay; else track.

export interface AirportAdvice {
  /** Trips a day to or from the airport that weren't made. */
  lostPerDay: number;
  /** Of those, with no road or track to the town at the other end. */
  noWayPerDay: number;
  /** Your passenger lines with an end at it: vehicles, how many lines lose money, their net a day. */
  lines: number;
  vehicles: number;
  losing: number;
  netPerDay: number;
  /** Why they're lost, in a clause: "no way on from it", "no seat: your 18 buses to it lose ₦807 a day". */
  why: string;
  move: NamedMove | null;
}

export function airportAdvice(world: GameWorld): AirportAdvice | null {
  const id = world.airport;
  if (!id || !world.towns.has(id)) return null;
  const D = SECONDS_PER_GAME_DAY;
  let lost = 0, noWay = 0;
  const lostWith = new Map<string, number>();
  for (const [key, rates] of world.pairOutcomes) {
    const at = key.indexOf(":");
    const from = key.slice(0, at), to = key.slice(at + 1);
    const other = from === id ? to : to === id ? from : null;
    if (!other || rates.lost <= 0) continue;
    lost += rates.lost;
    if (!canTravel(world, id, other)) noWay += rates.lost;
    lostWith.set(other, (lostWith.get(other) ?? 0) + rates.lost);
  }
  const summaries = routeSummaries(world).filter((r) => r.a === id || r.b === id);
  const lines = summaries.length;
  const vehicles = summaries.reduce((s, r) => s + r.buses, 0);
  const losing = summaries.filter((r) => r.netPerDay < 0).length;
  const netPerDay = summaries.reduce((s, r) => s + r.netPerDay, 0);
  const base = { lostPerDay: lost * D, noWayPerDay: noWay * D, lines, vehicles, losing, netPerDay };
  // The town at the other end with most lost, among those a road or track joins it to (or any).
  const ranked = [...lostWith.entries()].sort((p, q) => q[1] - p[1]);
  const top = (ok: (other: string) => boolean) => ranked.find(([other]) => world.towns.has(other) && !world.towns.get(other)!.industry && ok(other))?.[0] ?? null;
  const nameAt = nameOf(world, id);
  if (lines === 0) {
    const to = top(() => true) ?? world.port ?? null;
    return { ...base, why: "no line of yours runs from it", move: to ? openingMove(world, id, to, (lostWith.get(to) ?? 0) * D) : null };
  }
  const fleet = `your ${vehicles} vehicle${vehicles === 1 ? "" : "s"} on ${lines} line${lines === 1 ? "" : "s"} to it`;
  const verb = (many: string, one: string) => (vehicles === 1 ? one : many);
  const result = netPerDay < 0 ? `${fleet} ${verb("lose", "loses")} ₦${Math.round(-netPerDay)} a day` : `${fleet} ${verb("make", "makes")} ₦${Math.round(netPerDay)} a day`;
  const why = noWay > lost / 2 ? `most have no road or track to their town; ${result}` : `they have a road, but no seat: ${result}`;
  // Track reaches it, and no train of yours carries people from it: a train, to the town with most lost.
  // Travellers spread over the region, a few dozen to each town (map 8703: 296 lost, 40 the
  // most to any one), so a train is judged by all it could carry: the lost to the town at its
  // far end, and to the towns your lines run on to from there, changing. Measured on 8703 with
  // one bus out: a train to the home city, where no line of yours ran on, cut 295 lost to 286.
  const trained = world.routes.some((r) => isRailRoute(r.id) && (r.a === id || r.b === id));
  const carriedOnFrom = (end: string) => ranked.reduce((sum, [other, rate]) => sum + (other === end || routesOnTrip(world, end, other).size > 0 ? rate : 0), 0) * D;
  let byTrack: string | null = null, onTrack = 0;
  if (!trained) for (const t of world.towns.values()) {
    if (t.industry || railPath(world, id, t.id) === null) continue;
    const n = carriedOnFrom(t.id);
    if (n > onTrack) [byTrack, onTrack] = [t.id, n];
  }
  if (byTrack && onTrack >= TRAIN_TRIPS_PER_DAY / 3) {
    return { ...base, why, move: { action: { kind: "train", a: id, b: byTrack }, price: vehiclePrice(world, "train"), label: `Run a train ${nameAt} ↔ ${nameOf(world, byTrack)}: your track already reaches it (T)` } };
  }
  // Its road worn: kept up, the buses on it run faster and cheaper.
  const worn = wornRoadAt(world, id);
  if (worn && losing > 0) return { ...base, why, move: worn.move };
  // Another vehicle where one would pay (seatMove says when it wouldn't).
  const byRoad = top((other) => roadPath(world, id, other) !== null);
  const seat = byRoad ? seatMove(world, id, byRoad) : null;
  if (seat && Number.isFinite(seat.price)) return { ...base, why, move: seat };
  // More wouldn't pay: track, then a train, to the town with most lost.
  if (byRoad && (lostWith.get(byRoad) ?? 0) * D >= TRAIN_TRIPS_PER_DAY / 3) {
    return { ...base, why: `${why}; another wouldn't pay`, move: { action: { kind: "track", a: id, b: byRoad, alignment: "cheapest" }, price: rungPrice(world, id, byRoad, "rail"), label: `Track ${nameAt}–${nameOf(world, byRoad)}, then a train on it (K)` } };
  }
  return { ...base, why, move: seat };
}

// Upgrading where you're looking (your map 5059 playtest: "upgrading hurt more"). A rung was
// bought only with the Road tool, town to town, one road and one rung at a time: a jammed line's
// card said "Pave or a lane" and left you to find which of its roads, and click each. Now a road's
// card names its next rung, priced, and a line's card the rung its own roads need, all of them at
// once -- the same pave and lane actions, one per road, so a run file replays as before.

/** A road's next rung, priced, and what it gains -- or why there's none. */
export interface RoadUpgrade {
  move: NamedMove;
  gain: string;
}

/** The next rung on the whole road joining a and b (through roadside towns): paved, then a lane, then rail (the road becomes the railway). */
export function roadUpgrade(world: GameWorld, a: string, b: string): RoadUpgrade | null {
  const chain = roadChain(world, a, b);
  if (!chain) return null;
  const road = `${nameOf(world, a)}–${nameOf(world, b)}`;
  if (chain.some((s) => s.surface !== "paved")) {
    return { move: rungMove(world, "paved", { a, b }), gain: `carries ${(1 / world.tuning.dirtRoadCapacity).toFixed(1)}x the traffic, renewed, wearing slower` };
  }
  if (!chain.every((s) => s.busLane)) {
    const wanted = Math.round(demandAlong(world, a, b) * SECONDS_PER_GAME_DAY);
    const thin = wanted < world.tuning.laneMinTripsPerDay;
    return { move: rungMove(world, "lane", { a, b }), gain: `your vehicles skip the traffic on it${thin ? `; only ${wanted} a day travel along it, too few to fill BRT buses` : `; ${wanted} a day travel along it, enough for BRT`}` };
  }
  if (!world.tuning.railEnabled) return null;
  return { move: { ...rungMove(world, "rail", { a, b }), label: `Rail on ${road}: the road becomes the railway (K)` }, gain: "trains carry the most; the road and its lane are gone" };
}

/** A line's roads that want the same rung: paving its dirt ones, else a lane on its jammed line's roads. */
export interface LineUpgrade {
  rung: "paved" | "lane";
  roads: Array<{ a: string; b: string; price: number; action: ActionSpec }>;
  price: number;
  label: string;
}

export function lineUpgrade(world: GameWorld, routeId: string): LineUpgrade | null {
  if (isRailRoute(routeId)) return null;
  const chains = new Map<string, { a: string; b: string; dirt: boolean; laned: boolean }>();
  for (const id of routeSegments(world, routeId)) {
    const chain = chainOf(world, id);
    if (!chain) continue;
    const key = chain.a < chain.b ? `${chain.a}~${chain.b}` : `${chain.b}~${chain.a}`;
    if (chains.has(key)) continue;
    chains.set(key, { a: chain.a, b: chain.b, dirt: chain.pieces.some((s) => s.surface !== "paved"), laned: chain.pieces.every((s) => s.busLane) });
  }
  const dirt = [...chains.values()].filter((c) => c.dirt);
  const named = (list: Array<{ a: string; b: string }>) => list.slice(0, 3).map((c) => `${nameOf(world, c.a)}–${nameOf(world, c.b)}`).join(", ") + (list.length > 3 ? ` and ${list.length - 3} more` : "");
  if (dirt.length > 0) {
    const roads = dirt.map((c) => ({ a: c.a, b: c.b, price: paveCost(world, c.a, c.b), action: { kind: "pave", a: c.a, b: c.b } as ActionSpec }));
    const price = roads.reduce((s, r) => s + r.price, 0);
    return { rung: "paved", roads, price, label: dirt.length === 1 ? `Pave its dirt road ${named(dirt)}` : `Pave its ${dirt.length} dirt roads (${named(dirt)})` };
  }
  // Paved all the way: a lane, only where traffic is what slows it (a lane on a free road buys nothing).
  if (diagnoseRoute(world, routeId)?.verdict !== "jammed") return null;
  const open = [...chains.values()].filter((c) => !c.laned);
  if (open.length === 0) return null;
  const roads = open.map((c) => ({ a: c.a, b: c.b, price: laneCost(world, c.a, c.b), action: { kind: "lane", a: c.a, b: c.b } as ActionSpec }));
  const price = roads.reduce((s, r) => s + r.price, 0);
  return { rung: "lane", roads, price, label: open.length === 1 ? `A bus lane on ${named(open)}` : `Bus lanes on its ${open.length} roads (${named(open)})` };
}
