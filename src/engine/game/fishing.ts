import { SECONDS_PER_GAME_DAY, canAfford } from "../economy/state";
import { addSite, dry, nearestDistance } from "./fuel";
import { inheritedRoad } from "./cement";
import { rebuildNetworks } from "./rail";
import { refreshDemand } from "./settlement";
import { flowKey, type GoodsFlow } from "./goods";
import { landing, waterway as wayOf } from "./waterways";
import { roadPath, type ActionResult } from "./world";
import type { GameWorld } from "./types";
import { SWITCHED_OFF } from "./tuning";

// Fishing (docs/water.md, Step 4; agreed 2026-11-09): water's own trade. Every town at the water's
// edge has a landing, a site on its bank, where its fishermen land a catch -- more from wide water
// than a narrow river; the rains don't change it.
//
//   - Every town you started with eats fish. Fresh fish fetches a premium (fishFreshRate on its
//     fare) and spoils within a day where it waits, so it goes only to the towns near its landing
//     (fishFreshReach by road), the landing's own town among them.
//   - Build a smokehouse at a landing and the rest of its catch is smoked: it keeps, as milled food
//     does, and goes to the towns wanting most further off -- the hauliers' tail, a barge, a train.
//     Without one the rest has no buyer.
//   - Fish only adds (principles §3, Economy: a second source must only add): a town's fish adds
//     to its growth room (fishCapShare), on top of its food basket, which it never makes short.
//
// Plain data on the world (world.fishing), changed here and by the `smokehouse` action, so a run file
// replays it. Absent, and off, in runs played before it (no fishingEnabled).

export interface FishLanding {
  /** The landing's site. */
  siteId: string;
  /** The town whose fishermen use it. */
  townId: string;
  /** Tonnes a day it lands. */
  catchPerDay: number;
  smokehouse: boolean;
}

export interface FishingState {
  landings: FishLanding[];
}

export const LANDING_PREFIX = "landing-";

export function fishingOn(world: GameWorld): boolean {
  return !!world.tuning.fishingEnabled && !!world.fishing && world.tuning.goodsEnabled;
}

/** The landing a site is, if it's one. */
export function landingAt(world: GameWorld, siteId: string): FishLanding | undefined {
  return world.fishing?.landings.find((l) => l.siteId === siteId);
}

/**
 * At the start (start.ts, after every other site): a landing on the bank of each town at the
 * water's edge -- within `fishLandingEdge` cells of water a boat can use -- between the town and
 * the water, on an old track to the town.
 */
export function placeLandings(world: GameWorld): void {
  const t = world.tuning;
  if (!t.fishingEnabled || !t.goodsEnabled || world.fishing || !world.waterLines?.length) return;
  const landings: FishLanding[] = [];
  const edge = t.fishLandingEdge ?? 3;
  for (const town of [...world.towns.values()]) {
    if (town.industry) continue;
    const at = landing(world, town.id, t.waterBusMinWidth ?? 1.5, edge);
    if (!at) continue;
    const spot = bankSpot(world, town.x, town.y, at.node);
    if (!spot) continue;
    const id = `${LANDING_PREFIX}${town.id}`;
    addSite(world, id, `${town.name} Landing`, "landing", spot);
    inheritedRoad(world, `${id}-road`, id, town.id);
    const node = wayOf(world).nodes[at.node]!;
    const wide = node.sea || node.width >= (t.fishBigWidth ?? 4);
    landings.push({ siteId: id, townId: town.id, catchPerDay: wide ? t.fishCatchBig ?? 16 : t.fishCatchRiver ?? 8, smokehouse: false });
  }
  world.fishing = { landings };
  if (landings.length === 0) return;
  rebuildNetworks(world);
  world.plans = null;
  refreshDemand(world);
}

/** A dry spot between a town and its water, 1.5-3.5 cells off the town, clear of other places. */
function bankSpot(world: GameWorld, x: number, y: number, node: number): { x: number; y: number } | null {
  const n = wayOf(world).nodes[node]!;
  const dx = n.x - x, dy = n.y - y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  for (const r of [2, 2.5, 1.5, 3, 3.5]) {
    for (const turn of [0, 0.4, -0.4, 0.8, -0.8]) {
      const c = Math.cos(turn), s = Math.sin(turn);
      const px = x + (ux * c - uy * s) * r, py = y + (ux * s + uy * c) * r;
      if (dry(world, px, py, 0.5) && nearestDistance(world, px, py) >= 1.4) return { x: px, y: py };
    }
  }
  return null;
}

/**
 * Tonnes a second of fish a town wants: every town you started with eats fish (agreed 2026-11-09:
 * kept to the 40k market towns, fresh fish reached none on two of five maps, and 0-23% of the want
 * on the rest).
 */
export function fishWant(world: GameWorld, townId: string): number {
  if (!fishingOn(world)) return 0;
  const town = world.towns.get(townId);
  if (!town || town.industry || !world.basePopulation.has(townId)) return 0;
  return wantOf(world, town.population);
}
/** The towns that eat fish: every one you started with. */
function eaters(world: GameWorld) {
  return [...world.towns.values()].filter((t) => !t.industry && world.basePopulation.has(t.id));
}
/** Smoked fish goes to this many towns a landing, those wanting most: to every town it would multiply the goods a tick carries. */
const SMOKED_TOWNS = 8;
const wantOf = (world: GameWorld, population: number) => ((world.tuning.fishPerThousandPerDay ?? 0.25) * population) / SECONDS_PER_GAME_DAY;

/**
 * The catch's flows (goods.ts adds them): fresh fish ("produce") to the markets near each landing
 * by want, and with a smokehouse the rest smoked ("supplies") to every market by what's left of its
 * want. A landing is a new site, so its flows never share a key with a town's produce or supplies.
 */
export function fishFlows(world: GameWorld): GoodsFlow[] {
  if (!fishingOn(world)) return [];
  const reach = world.tuning.fishFreshReachCells ?? 40;
  const markets = eaters(world);
  const flows: GoodsFlow[] = [];
  for (const l of world.fishing!.landings) {
    if (!world.towns.has(l.siteId)) continue;
    const caught = l.catchPerDay / SECONDS_PER_GAME_DAY;
    const want = new Map(markets.map((m) => [m.id, wantOf(world, m.population)]));
    const near = markets.filter((m) => (roadPath(world, l.siteId, m.id)?.distance ?? Infinity) <= reach);
    const nearWant = near.reduce((sum, m) => sum + want.get(m.id)!, 0);
    // With a smokehouse most of the catch is smoked (smokeShare), the rest still fresh at its premium:
    // fresh fish mostly spoiled before a haulier lifted it (8703: 61 t a day sent, ~5 arriving), and
    // a smokehouse that smoked only what the near towns had no room for smoked almost nothing.
    const freshShare = l.smokehouse ? 1 - (world.tuning.smokeShare ?? 0.7) : 1;
    const fresh = Math.min(caught * freshShare, nearWant);
    for (const m of near) {
      const rate = nearWant > 0 ? (want.get(m.id)! * fresh) / nearWant : 0;
      if (rate <= 0) continue;
      flows.push({ from: l.siteId, to: m.id, kind: "produce", rate });
      want.set(m.id, want.get(m.id)! - rate);
    }
    if (!l.smokehouse) continue;
    const rest = caught - fresh;
    // Smoked keeps: the near towns' want left first (fresh couldn't reach them in time), then the far ones wanting most.
    const nearIds = new Set(near.map((m) => m.id));
    const takers = markets.filter((m) => want.get(m.id)! > 0).sort((p, q) => Number(nearIds.has(q.id)) - Number(nearIds.has(p.id)) || want.get(q.id)! - want.get(p.id)! || (p.id < q.id ? -1 : 1)).slice(0, SMOKED_TOWNS);
    const left = takers.reduce((sum, m) => sum + want.get(m.id)!, 0);
    if (rest <= 0 || left <= 0) continue;
    const smoked = Math.min(rest, left);
    for (const m of takers) flows.push({ from: l.siteId, to: m.id, kind: "supplies", rate: (want.get(m.id)! * smoked) / left });
  }
  return flows;
}

/** Whether goods from a place are fresh fish: a landing's produce (goods.ts spoils it fast; fares.ts adds the premium). */
export function isFreshFish(world: GameWorld, fromId: string, kind: string): boolean {
  return kind === "produce" && fromId.startsWith(LANDING_PREFIX) && !!landingAt(world, fromId);
}

/** Whether goods from a place are smoked fish: a landing's supplies, which keep. */
export function isSmokedFish(world: GameWorld, fromId: string, kind: string): boolean {
  return kind === "supplies" && fromId.startsWith(LANDING_PREFIX) && !!landingAt(world, fromId);
}

/** Of the fish a town wants, the share reaching it (fresh and smoked, anyone's), 0..1. */
export function fishServed(world: GameWorld, townId: string): number {
  const want = fishWant(world, townId);
  if (want <= 0) return 0;
  let got = 0;
  for (const l of world.fishing!.landings) {
    for (const kind of ["produce", "supplies"] as const) {
      const o = world.goods.outcomes.get(flowKey({ from: l.siteId, to: townId, kind }));
      got += (o?.delivered ?? 0) + (o?.trucked ?? 0);
    }
  }
  return Math.min(1, got / want);
}

/** Of a landing's catch, the share carried away and sold (fresh and smoked, anyone's), 0..1: its trade. */
export function fishSold(world: GameWorld, l: FishLanding): number {
  if (l.catchPerDay <= 0) return 0;
  // Its own flows only, a lookup a town and kind: growth reads this every tick, and a scan of every
  // outcome in the world would undo the fix that kept fishing to 4% of a tick.
  let carried = 0;
  for (const town of eaters(world)) {
    for (const kind of ["produce", "supplies"] as const) {
      const o = world.goods.outcomes.get(flowKey({ from: l.siteId, to: town.id, kind }));
      if (o) carried += (o.delivered ?? 0) + (o.trucked ?? 0);
    }
  }
  return Math.min(1, (carried * SECONDS_PER_GAME_DAY) / l.catchPerDay);
}

/**
 * Thousands of people of room fish gives a town (growth.ts), on top of its food, never instead:
 * what it eats (fishCapShare of its start at full want), and for a fishing town what it sells
 * (fishTradeCap of its start when its whole catch is carried away) -- its catch is its trade.
 */
export function fishGrowth(world: GameWorld, townId: string): number {
  if (!fishingOn(world)) return 0;
  const base = world.basePopulation.get(townId);
  if (base === undefined) return 0;
  const eaten = base * (world.tuning.fishCapShare ?? 0.08) * fishServed(world, townId);
  const landing = world.fishing!.landings.find((l) => l.townId === townId);
  const traded = landing ? base * (world.tuning.fishTradeCap ?? 0.25) * fishSold(world, landing) : 0;
  return eaten + traded;
}

/** Tonnes a day a landing lands, sends fresh, and smokes (its card). */
export function landingSplit(world: GameWorld, siteId: string): { caught: number; fresh: number; smoked: number; wasted: number } | null {
  const l = landingAt(world, siteId);
  if (!l) return null;
  const flows = fishFlows(world).filter((f) => f.from === siteId);
  const D = SECONDS_PER_GAME_DAY;
  const fresh = flows.filter((f) => f.kind === "produce").reduce((s, f) => s + f.rate, 0) * D;
  const smoked = flows.filter((f) => f.kind === "supplies").reduce((s, f) => s + f.rate, 0) * D;
  return { caught: l.catchPerDay, fresh, smoked, wasted: Math.max(0, l.catchPerDay - fresh - smoked) };
}

export function checkSmokehouse(world: GameWorld, siteId: string): ActionResult {
  if (!fishingOn(world)) return { ok: false, reason: SWITCHED_OFF };
  const l = landingAt(world, siteId);
  if (!l) return { ok: false, reason: "a smokehouse goes at a landing" };
  if (l.smokehouse) return { ok: false, reason: "it has a smokehouse" };
  if (!canAfford(world.economy, world.tuning.smokehouseCost ?? 0)) return { ok: false, reason: "can't afford a smokehouse" };
  return { ok: true };
}

/** The `smokehouse` action: the landing's spare catch smoked, to keep and travel. */
export function buildSmokehouse(world: GameWorld, siteId: string): ActionResult & { charged?: number } {
  const check = checkSmokehouse(world, siteId);
  if (!check.ok) return check;
  const cost = world.tuning.smokehouseCost ?? 0;
  world.economy.funds -= cost;
  landingAt(world, siteId)!.smokehouse = true;
  return { ok: true, charged: cost };
}
