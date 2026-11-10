import { SECONDS_PER_GAME_DAY } from "../economy/state";
import { landing, waterRoute, type WaterRoute } from "./waterways";
import { flowKey } from "./goods";
import { haulShare } from "./truckers";
import { legFare } from "./fares";
import { pairKey } from "./world";
import type { GameWorld } from "./types";

// The informal canoes (docs/water.md, Step 5; brief, Open item 4: "the informal sector there too
// (canoe and boat operators)"; agreed 2026-11-10): water's own informal sector, as the danfos are
// the road's. They carry people and fish, on any water -- the creeks and tributaries no boat of
// yours can use among it -- and stand against your lines as the danfos do.
//
//   - People. Riders who gave up on you and would go home -- out-waiting even the okadas (the rains
//     on a ford: none sets off on a road that slow), or with no road at all -- take a canoe wherever
//     the water joins them. A canoe takes a share of those waiting each
//     moment, short crossings fastest; each stretch of water carries at most canoeRidersPerDay;
//     whoever out-waits the canoes goes home. Counted the informal sector's, as a danfo's riders.
//   - Fish. Canoe traders take a share of the fish waiting at each landing for a town on the water,
//     short trips fastest, after the hauliers; it arrives when the canoe does, as the hauliers'
//     does (anyone's -- it's the town's fish, and the landing's trade).
//
// Plain data on the world (world.canoes), so a run file replays it. Absent, and off, in runs played
// before it (no canoesEnabled).

export interface CanoeState {
  /** Pool key (at>origin>destination, `>r` if relayed) -> riders waiting for a canoe. */
  pool: Map<string, number>;
  /** `from|to|kind|second` -> tonnes of fish on the water, arriving that second. */
  loads: Map<string, number>;
  /** Stretch (`a~b`, sorted) -> riders a second carried, rolling: the map's canoes. */
  riders: Map<string, number>;
  /** Stretch -> tonnes of fish a second carried, rolling. */
  fish: Map<string, number>;
  /** Seconds since the canoes last set off (they go every CANOE_STEP: dispatchCanoes). */
  since?: number;
}

export function canoesOn(world: GameWorld): boolean {
  return !!world.tuning.canoesEnabled && !!world.canoes && !!world.waterLines?.length;
}

/** At the start (start.ts): the canoes' state, where the map has water. */
export function placeCanoes(world: GameWorld): void {
  if (!world.tuning.canoesEnabled || world.canoes || !world.waterLines?.length) return;
  world.canoes = { pool: new Map(), loads: new Map(), riders: new Map(), fish: new Map() };
}

/**
 * The water a canoe takes between two places, any width; null where the water doesn't join them.
 * Kept a world, by the pair: asked for every rider leaving a park, every tick (profiled: the
 * lookups through landing() and waterRoute()'s keys made ticks half as slow again).
 */
export function canoeWay(world: GameWorld, a: string, b: string): WaterRoute | null {
  let held = ways.get(world);
  if (!held) ways.set(world, (held = new Map()));
  const key = a + ">" + b;
  let way = held.get(key);
  if (way === undefined) {
    const t = world.tuning;
    const width = t.canoeMinWidth ?? 0, reach = t.canoeLandingReach ?? 8;
    way = a === b || !landing(world, a, width, reach) || !landing(world, b, width, reach) ? null : waterRoute(world, a, b, width, reach);
    held.set(key, way);
  }
  return way;
}
const ways = new WeakMap<GameWorld, Map<string, WaterRoute | null>>();

export const stretchKey = (a: string, b: string) => (a < b ? `${a}~${b}` : `${b}~${a}`);

/** Seconds between the canoes' departures, all at once (dispatchCanoes). */
const CANOE_STEP = 1;

/** A pool key's reading for the canoes, kept a world: its canoe-pool key, trip, stretch, water and fare -- or null, no water. */
interface Reading { key: string; at: string; destination: string; trip: string; stretch: string; way: WaterRoute; fare: number; relayed: boolean }
const readings = new WeakMap<GameWorld, Map<string, Reading | null>>();
function reading(world: GameWorld, poolKey: string): Reading | null {
  let held = readings.get(world);
  if (!held) readings.set(world, (held = new Map()));
  let r = held.get(poolKey);
  if (r === undefined) {
    const [at, origin, destination] = poolKey.split(">") as [string, string, string];
    const relayed = poolKey.endsWith(">r") || poolKey.endsWith(">rt");
    const way = canoeWay(world, at, destination);
    r = way ? { key: `${at}>${origin}>${destination}${relayed ? ">r" : ""}`, at, destination, trip: pairKey(origin, destination), stretch: stretchKey(at, destination), way, fare: legFare(world, at, destination), relayed } : null;
    held.set(poolKey, r);
  }
  return r;
}

/**
 * Riders who'd go home (tick.ts dispatchInformal) -- with no road, or out-waiting even the okadas
 * (the rains on a ford: none sets off on a road that slow) -- offered a canoe, wherever the water
 * joins them. True if they took it. Only those: offered to everyone who wouldn't wait for a danfo,
 * where the water was shorter, more went home on 3218 (74.2% to 74.6%) -- those who out-waited the
 * canoes, whom an okada would have taken. Last, they can only add.
 */
export function intoCanoes(world: GameWorld, key: string, amount: number): boolean {
  if (amount <= 0 || !canoesOn(world)) return false;
  const r = reading(world, key);
  if (!r) return false;
  const pool = world.canoes!.pool;
  pool.set(r.key, (pool.get(r.key) ?? 0) + amount);
  return true;
}

/**
 * Each tick, after the danfos (tick.ts): canoes take their share of those waiting, short crossings
 * fastest, each stretch to its cap; whoever out-waits them goes home (`drift`, the park's patience).
 */
export function dispatchCanoes(world: GameWorld, tickDt: number, patience: number, lost: Map<string, number>, gaveUp: Map<string, number>): void {
  if (!canoesOn(world)) return;
  const t = world.tuning, canoes = world.canoes!;
  // Every CANOE_STEP seconds, for all of them: the same riders taken and sent home, a tenth of the
  // work (profiled, map 949: run every tick, the canoes were a sixth of it).
  canoes.since = (canoes.since ?? 0) + tickDt;
  if (canoes.since < CANOE_STEP) return;
  const dt = canoes.since;
  canoes.since = 0;
  const drift = 1 - Math.exp(-dt / patience);
  const pickup = 1 - Math.exp(-dt / (t.canoePickupSeconds ?? 20));
  const alpha = 1 - Math.exp(-dt / t.outcomeTauSeconds);
  const room = ((t.canoeRidersPerDay ?? 150) * dt) / SECONDS_PER_GAME_DAY;
  const used = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, v: number) => v !== 0 && m.set(k, (m.get(k) ?? 0) + v);
  for (const [key, pooled] of canoes.pool) {
    const r = reading(world, key);
    if (!r) {
      canoes.pool.delete(key); // no water (a town gone): nobody to take them
      continue;
    }
    const home = pooled * drift;
    const take = Math.max(0, Math.min(pooled - home, room - (used.get(r.stretch) ?? 0), (pooled - home) * pickup * haulShare(world, r.way.length, t.canoeReachCells ?? 80)));
    canoes.pool.set(key, pooled - home - take);
    // Home: a relayed rider was counted the informal sector's when they set off -- moved to the lost.
    bump(lost, r.trip, home);
    if (r.relayed) bump(gaveUp, r.trip, -home);
    else bump(gaveUp, r.trip, take);
    if (take <= 0) continue;
    bump(used, r.stretch, take);
    world.informal.earnings += take * r.fare;
  }
  roll(canoes.riders, used, dt, alpha);
}

/**
 * Each tick, after the hauliers (tick.ts): canoe traders take a share of the fish waiting at each
 * landing for a town on the water, short trips fastest; what arrives this tick goes to `trucked`
 * (goods.ts updateGoodsOutcomes), anyone's, as the hauliers' does.
 */
export function canoeFish(world: GameWorld, dt: number, trucked: Map<string, number>): void {
  if (!canoesOn(world) || !world.fishing) return;
  const t = world.tuning, canoes = world.canoes!;
  const pickup = 1 - Math.exp(-dt / (t.canoePickupSeconds ?? 20));
  const alpha = 1 - Math.exp(-dt / t.outcomeTauSeconds);
  const now = world.economy.elapsedSeconds;
  const speed = t.canoeSpeed ?? 2;
  for (const l of world.fishing.landings) {
    const yard = world.goods.yards.get(l.siteId);
    if (!yard) continue;
    for (const [key, amount] of yard) {
      if (amount <= 0) continue;
      const bar = key.indexOf("|");
      const to = key.slice(0, bar), kind = key.slice(bar + 1);
      const way = canoeWay(world, l.siteId, to);
      if (!way) continue;
      const take = amount * pickup * haulShare(world, way.length, t.canoeFishReachCells ?? 50);
      if (take <= 0) continue;
      yard.set(key, amount - take);
      const k = `${l.siteId}|${to}|${kind}|${Math.ceil(now + way.length / speed)}`;
      canoes.loads.set(k, (canoes.loads.get(k) ?? 0) + take);
    }
  }
  const landed = new Map<string, number>();
  for (const [k, amount] of canoes.loads) {
    const [from, to, kind, second] = k.split("|") as [string, string, string, string];
    if (Number(second) > now) continue;
    canoes.loads.delete(k);
    const flow = flowKey({ from, to, kind: kind as "produce" | "supplies" });
    trucked.set(flow, (trucked.get(flow) ?? 0) + amount);
    const stretch = stretchKey(from, to);
    landed.set(stretch, (landed.get(stretch) ?? 0) + amount);
  }
  roll(canoes.fish, landed, dt, alpha);
}

/** Rolls each stretch's carried rate toward this tick's (a second), dropping the ones gone quiet. */
function roll(rates: Map<string, number>, now: Map<string, number>, dt: number, alpha: number): void {
  for (const k of now.keys()) if (!rates.has(k)) rates.set(k, 0);
  for (const [k, rate] of rates) {
    const next = rate + ((now.get(k) ?? 0) / dt - rate) * alpha;
    if (next < 1e-6 && !now.has(k)) rates.delete(k);
    else rates.set(k, next);
  }
}

/** Riders and tonnes of fish a day the canoes carry, the map over: the informal sector's on the water. */
export function canoeTotals(world: GameWorld): { riders: number; fish: number } {
  if (!world.canoes) return { riders: 0, fish: 0 };
  const sum = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0) * SECONDS_PER_GAME_DAY;
  return { riders: sum(world.canoes.riders), fish: sum(world.canoes.fish) };
}
