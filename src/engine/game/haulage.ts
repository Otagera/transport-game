import type { GameWorld } from "./types";
import { isFuelSite } from "./fuel";
import { isCementSite } from "./cement";
import { isSteelSite } from "./steel";
import { borderFuelSite } from "./gateways";
import { hasYard } from "./yards";
import type { GoodsKind } from "./goods";

// Goods relayed town to town (docs/brief.md, Gateways, "Goods get there over
// connected roads"; your playtest, map 949 day 244: "as long as roads are
// connected the goods will eventually get there and direct connections would
// be faster like roads with passengers"). Hauliers reach 40 cells, 120 from
// a yard, and past that goods had nowhere to go: 17 of 26 towns got no cement
// or steel at all, the works' yard 125-190 cells away, ~600 t rotting there.
//
// Now a load bound past a leg's reach goes in legs, as riders change buses:
// hauliers carry it to a town on the way, it waits at that town, and hauliers
// from there take it on. A yard at a town lets its legs run 120 cells: it
// bridges the gaps between clusters. A freight train carries goods to the
// station nearest where they're going and hauliers take them on from there
// (goods.ts goodsLoader), so rail is the long leg and road the last.
//
// Each leg costs a wait for a truck to fill -- slower the longer the leg
// (truckers.ts haulShare) -- and what waits leaks or spoils; so a load goes
// the way of fewest, quickest legs, and a direct haul or a train is faster
// than a chain of hops. Aggregate, as trip plans are (transfers.ts): a lookup
// from (where it is, where it's going) to the next stop, rebuilt when the
// roads, the towns or the yards change.

export interface HaulPlans {
  /** What it was built for: the road graph (rebuilt, never edited, on every road change: rail.ts), the towns and the yards. */
  routing: unknown;
  stamp: string;
  /** Places goods may wait between legs: the towns, and any site with a yard. */
  relays: string[];
  /** from -> to -> road distance, cells (absent: not connected). */
  dist: Map<string, Map<string, number>>;
  /** destination -> place -> cost of the quickest way there by hauliers' legs from that place. */
  toward: Map<string, Map<string, number>>;
  /** `at|to|reach` -> the next stop, memoised. */
  next: Map<string, string | null>;
}

const stampOf = (world: GameWorld) => `${world.towns.size}|${[...world.yards].join(",")}`;

/** Road distances from one place to every place, cells (Dijkstra over the built roads, as roadPath measures them). */
function distancesFrom(world: GameWorld, from: string, places: Set<string>): Map<string, number> {
  const { graph } = world.simulation.routing;
  const best = new Map<string, number>([[from, 0]]);
  const done = new Set<string>();
  const out = new Map<string, number>();
  const open = [from];
  while (open.length > 0) {
    let at = 0;
    for (let k = 1; k < open.length; k += 1) if (best.get(open[k]!)! < best.get(open[at]!)!) at = k;
    const node = open.splice(at, 1)[0]!;
    if (done.has(node)) continue;
    done.add(node);
    const d = best.get(node)!;
    if (places.has(node)) out.set(node, d);
    for (const edge of graph.get(node) ?? []) {
      const next = d + edge.weight;
      if (next < (best.get(edge.to) ?? Infinity)) {
        best.set(edge.to, next);
        open.push(edge.to);
      }
    }
  }
  return out;
}

export function haulPlans(world: GameWorld): HaulPlans {
  const stamp = stampOf(world);
  const routing = world.simulation.routing;
  if (world.haulPlans && world.haulPlans.routing === routing && world.haulPlans.stamp === stamp) return world.haulPlans;
  const relays = [...world.towns.values()].filter((town) => !town.industry || hasYard(world, town.id)).map((town) => town.id);
  const places = new Set(world.towns.keys());
  const dist = new Map<string, Map<string, number>>();
  for (const id of places) dist.set(id, distancesFrom(world, id, places));
  world.haulPlans = { routing, stamp, relays, dist, toward: new Map(), next: new Map() };
  return world.haulPlans;
}

/**
 * Goods that go in legs: what a town waits on to grow -- cement, steel, fuel. Relaying every
 * load (cash crops to the port, the port's general supplies) put 550-870 trucks on map 949's
 * roads against ~300, and cut trips made 19% by day 241 (2,354 -> 1,917), people grown 138k
 * -> 106k: the cement and steel that were missing were 15 of those trucks. Those still go
 * straight, within reach, or by your trains.
 */
export function relayed(world: GameWorld, origin: string, kind: GoodsKind): boolean {
  if (!world.tuning.goodsRelay) return false;
  const site = world.towns.get(origin);
  return isCementSite(site) || isSteelSite(site) || isFuelSite(site) || (kind === "supplies" && origin === borderFuelSite(world));
}

/** How far hauliers go from here on one leg, before your freight line's pull: a yard's reach, a tanker's from a fuel site, else a short haul. */
export function legReach(world: GameWorld, at: string, kind: GoodsKind): number {
  const t = world.tuning;
  const tanker = isFuelSite(world.towns.get(at)) || (kind === "supplies" && at === borderFuelSite(world));
  return Math.max(tanker ? t.tankerMaxHaulCells : t.truckerMaxHaulCells, t.yardsEnabled && hasYard(world, at) ? t.yardReachCells : 0);
}

/** One leg's cost: a truck's wait to fill, longer as the leg nears its reach (truckers.ts haulShare), and the drive. */
function legCost(cells: number, reach: number): number {
  if (cells >= reach) return Infinity;
  return 1 / (1 - cells / reach) + cells / reach;
}

/** Cost of the quickest way to `to` from every place, by hauliers' legs between relays (Dijkstra back from `to`). */
function toward(world: GameWorld, plans: HaulPlans, to: string): Map<string, number> {
  const known = plans.toward.get(to);
  if (known) return known;
  const cost = new Map<string, number>([[to, 0]]);
  const done = new Set<string>();
  const reach = new Map(plans.relays.map((id) => [id, legReach(world, id, "supplies")]));
  for (;;) {
    let node: string | null = null;
    for (const [id, c] of cost) if (!done.has(id) && (node === null || c < cost.get(node)!)) node = id;
    if (node === null) break;
    done.add(node);
    const base = cost.get(node)!;
    // A relay that can reach `node` in one leg.
    for (const id of plans.relays) {
      if (done.has(id)) continue;
      const cells = plans.dist.get(id)?.get(node);
      if (cells === undefined) continue;
      const c = base + legCost(cells, reach.get(id)!);
      if (c < (cost.get(id) ?? Infinity)) cost.set(id, c);
    }
  }
  plans.toward.set(to, cost);
  return cost;
}

/**
 * Where hauliers take a load from `at` bound for `to` on this leg: `to`
 * itself if that's quickest, else the relay town on the quickest way; null
 * if the roads (and yards) don't get it there at all. `reach` is this leg's,
 * from `at` (legReach, a source's own).
 */
export function nextStop(world: GameWorld, at: string, to: string, reach: number): string | null {
  const plans = haulPlans(world);
  const key = `${at}|${to}|${reach}`;
  const memo = plans.next.get(key);
  if (memo !== undefined) return memo;
  const ahead = toward(world, plans, to);
  const from = plans.dist.get(at);
  let best: string | null = null;
  let bestCost = Infinity;
  for (const [id, rest] of ahead) {
    if (id === at) continue;
    const cells = from?.get(id);
    if (cells === undefined) continue;
    const c = legCost(cells, reach) + rest;
    if (c < bestCost) {
      best = id;
      bestCost = c;
    }
  }
  plans.next.set(key, best);
  return best;
}

/** Cost of hauliers' quickest way to `to` from `at` (legs from relays); Infinity if none. */
export function haulCost(world: GameWorld, at: string, to: string): number {
  return toward(world, haulPlans(world), to).get(at) ?? Infinity;
}

/** Road distance between two places, cells; Infinity if not connected. */
export function haulDistance(world: GameWorld, a: string, b: string): number {
  return haulPlans(world).dist.get(a)?.get(b) ?? Infinity;
}

/**
 * What stands between a source's goods and a town (for the cards, screen.ts):
 *   - road: no road joins them;
 *   - gap: no chain of legs gets there -- a yard at `yardAt`, the nearest place to it hauliers
 *     do reach, would stretch its legs to 120 cells;
 *   - legs: they get there, in `legs` legs (a direct haul is 1) -- many, and freight rail is quicker;
 * null if relaying is off (a load past reach waits, as before).
 */
export type HaulBreak = { kind: "road" } | { kind: "gap"; yardAt: string | null } | { kind: "legs"; legs: number };

export function haulBreak(world: GameWorld, from: string, to: string, kind: GoodsKind = "supplies"): HaulBreak | null {
  if (!relayed(world, from, kind)) return null;
  if (!Number.isFinite(haulDistance(world, from, to))) return { kind: "road" };
  let at = from;
  for (let legs = 1; legs <= 12; legs += 1) {
    const stop = nextStop(world, at, to, legReach(world, at, kind));
    if (!stop) break;
    if (stop === to) return { kind: "legs", legs };
    at = stop;
  }
  // Every place hauliers reach from the source, leg by leg; the yardless one nearest the town.
  const plans = haulPlans(world);
  const reached = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const here = queue.shift()!;
    const reach = legReach(world, here, kind);
    for (const id of plans.relays) {
      if (reached.has(id) || (plans.dist.get(here)?.get(id) ?? Infinity) >= reach) continue;
      reached.add(id);
      queue.push(id);
    }
  }
  let yardAt: string | null = null;
  for (const id of reached) {
    if (hasYard(world, id) || !plans.relays.includes(id)) continue;
    if (!yardAt || haulDistance(world, id, to) < haulDistance(world, yardAt, to)) yardAt = id;
  }
  return { kind: "gap", yardAt };
}
