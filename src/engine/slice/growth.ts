import type { SliceWorld } from "./types";
import { chainOf, demandAlong, townShare } from "./world";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import { isDirt } from "./congestion";
import { laneEncroachment } from "./pushback";
import { stoneServed } from "./industries";
import { cementActive, cementServed } from "./cement";
import { stationTowns } from "./rail";

// The original towns grow (docs/principles.md §6, step 4: depth, one at a
// time -- growth second, after decay). Served well, a town draws people;
// demand is gravity on population, so a bigger town makes more trips --
// which is the reward for serving it, and the queue you then have to keep up
// with. Rules from §3, Findings, Growth:
//
//   - Service is a town's trips that people actually make: your share, plus
//     the informal share at a discount -- informal service *sustains* a
//     place, yours *develops* it.
//   - Your service is a necessary condition, not a contributor: below
//     `growthMinPlayerShare` of a town's trips, it doesn't grow at all.
//     Otherwise everything grows on danfos alone.
//   - The cap is bounded independently of population: a multiple of the
//     town's starting size, never of its current one -- and, since
//     Revision 1 (docs/brief.md, the corridor's story), set by the rung of
//     its best corridor: a town on dirt roads can grow a little, one on a
//     paved road much more. So the rung you build lets its towns grow, and
//     their growth fills the rung again: the pressure that makes a corridor
//     climb. Capacity only, never current size (principles §3, Growth).
//   - Rolling, never instantaneous: population drifts toward its target
//     over `townGrowthTauSeconds`, so a good week grows a town and a good
//     hour doesn't.
//
// A town whose service falls away drifts back down -- but never below the
// size it started at. The map's original towns are permanent (settlement.ts);
// growth is what you add to them, and what you can lose.

/** Informal service counts at half (principles §3, Paratransit: "counts toward service at a discount"). */
const INFORMAL_SERVICE_WEIGHT = 0.5;

function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

export interface TownGrowth {
  /** Where the town started, thousands. */
  base: number;
  /** The most it can reach, thousands: its start, plus what its best corridor's rung allows. */
  cap: number;
  /** Its best corridor's rung: what sets the cap. */
  rung: CorridorRung;
  /** The size its service now supports, thousands. */
  target: number;
  /** Your share of its trips plus the discounted informal share, 0..1. */
  service: number;
  /** Your share of its trips, 0..1 -- below growthMinPlayerShare it can't grow. */
  playerShare: number;
  /** Thousands of people its service would grow it to that cement is holding back (cement.ts); 0 when none. */
  cementHeld: number;
}

/** The rungs of the ladder built so far (brief, Revision 1): a town with no road has none. */
export type CorridorRung = "none" | "dirt" | "paved" | "lane" | "rail";

/** The best rung among the roads at a town -- what its people can travel on. */
export function bestRung(world: SliceWorld, townId: string): CorridorRung {
  const order: CorridorRung[] = ["none", "dirt", "paved", "lane", "rail"];
  let best: CorridorRung = "none";
  for (const segment of world.simulation.map.segments) {
    if (segment.fromNodeId !== townId && segment.toNodeId !== townId) continue;
    // Track in service at the town (a station, or a halt's spur) is the top
    // rung; the old line out of service, or rail switched off, isn't.
    if (segment.type === "rail" && (!world.tuning.railEnabled || world.railOutOfService.has(segment.id))) continue;
    const rung: CorridorRung = segment.type === "rail" ? "rail" : segment.busLane ? "lane" : isDirt(segment) ? "dirt" : "paved";
    if (order.indexOf(rung) > order.indexOf(best)) best = rung;
  }
  return best;
}

/** How much of the growth cap (townGrowthCap) a rung allows. */
function rungShare(world: SliceWorld, rung: CorridorRung): number {
  const t = world.tuning;
  return rung === "rail" ? t.growthCapRailShare : rung === "lane" ? t.growthCapLaneShare : rung === "paved" ? 1 : rung === "dirt" ? t.growthCapDirtShare : 0;
}

/**
 * The growth cap's share a town's roads and track allow: the best of them,
 * each by what it carries now. A bus lane carries a lane's worth only while
 * it's kept clear -- as danfos encroach, it slides back toward a paved
 * road's share, and fully taken it is one (principles §3, Growth: the size
 * limit follows what the corridors carry; a lax lane kept the lane's cap
 * while the danfos paid tolls again in it, its benefit without its cost).
 */
function carriedShare(world: SliceWorld, townId: string): number {
  const encroached = world.lanes.length > 0 ? laneEncroachment(world) : null;
  let best = 0;
  for (const segment of world.simulation.map.segments) {
    if (segment.fromNodeId !== townId && segment.toNodeId !== townId) continue;
    if (segment.type === "rail" && (!world.tuning.railEnabled || world.railOutOfService.has(segment.id))) continue;
    const rung: CorridorRung = segment.type === "rail" ? "rail" : segment.busLane ? "lane" : isDirt(segment) ? "dirt" : "paved";
    let share = rungShare(world, rung);
    if (rung === "lane") {
      const taken = encroached?.get(segment.id) ?? 0;
      share -= (share - rungShare(world, "paved")) * taken;
    }
    best = Math.max(best, share);
  }
  return best;
}

export function townGrowth(world: SliceWorld, townId: string): TownGrowth | null {
  const base = world.basePopulation.get(townId);
  if (base === undefined) return null; // emergent towns grow from traffic (settlement.ts)
  const { tuning } = world;
  const share = townShare(world, townId);
  const service = share.player + INFORMAL_SERVICE_WEIGHT * share.informal;
  const rung = bestRung(world, townId);
  // Stone feeds construction (brief, Revision 2): the stone delivered from
  // quarries raises the cap, by a share of it bounded by the town's start --
  // never its current size (principles §3, Growth).
  // With the building chain on, cement does that job instead, as a limit (below).
  const building = cementActive(world);
  const stone = !building && tuning.goodsEnabled && tuning.industriesEnabled && world.industries.size > 0 ? stoneServed(world, townId) : 0;
  // A town a passenger train stops at grows past its rail rung (brief,
  // Revision 2: station towns grow) -- bounded, like every share, by its start.
  const station = tuning.railEnabled && stationTowns(world).has(townId) ? tuning.stationCapShare : 0;
  const roadCap = base * (1 + tuning.townGrowthCap * (carriedShare(world, townId) + tuning.stoneCapShare * stone + station));
  // Cement holds growth back past a free stretch (brief, Revision 3, step
  // 2a): a town builds its first `cementFreeShare` of its start with local
  // materials; above that, its room is scaled by the cement it gets.
  const free = base * (1 + tuning.cementFreeShare);
  const cap = building && roadCap > free ? free + (roadCap - free) * cementServed(world, townId) : roadCap;
  const developed = share.player >= tuning.growthMinPlayerShare
    ? smoothstep((service - tuning.growthServiceFloor) / (tuning.growthServiceFull - tuning.growthServiceFloor))
    : 0;
  const target = base + (cap - base) * developed;
  // What it would grow to with all the cement it wants: the gap is what cement is holding back.
  const cementHeld = base + (roadCap - base) * developed - target;
  return { base, cap, rung, target, service, playerShare: share.player, cementHeld };
}

/**
 * A town that has grown to all its best road allows at the service it gets
 * (brief, Revision 1): it has reached its target, and that target is above
 * its start -- your service is growing it -- so the rung's cap is what stops
 * it: a better road raises the target. A dirt or paved corridor never
 * visibly jams (its towns just stop), so the panel says so and names the
 * next rung. Null while the town still has room, when nothing you run grows
 * it, or when there's no rung above (rail is switched off).
 */
export function roadFull(world: SliceWorld, townId: string): { rung: CorridorRung; next: "paved" | "lane" | "rail"; thin?: boolean; road?: { a: string; b: string } } | null {
  const growth = townGrowth(world, townId);
  const town = world.towns.get(townId);
  if (!growth || !town || growth.cap <= growth.base) return null;
  // Held back by cement, not its road: a better road would add nothing (the town card says cement).
  if (growth.cementHeld > growth.base * 0.02) return null;
  const grown = growth.target > growth.base * (1 + ROAD_FULL_GROWN);
  const levelled = town.population >= growth.target * ROAD_FULL_SHARE;
  if (!grown || !levelled) return null;
  const road = busiestRoad(world, townId, growth.rung)?.road;
  if (growth.rung === "dirt") return { rung: "dirt", next: "paved", road };
  // A diagnosis, not a forecast: a lane only where the trips along the road
  // could fill a few BRT buses a day (laneMinTripsPerDay). Corridor probe:
  // the trunk carries 700-1,000 a day and a lane pays there; Ilase-Kuto 37,
  // and a lane loses money there however it's run.
  if (growth.rung === "paved") return { rung: "paved", next: "lane", thin: (busiestRoad(world, townId, "paved")?.trips ?? 0) < world.tuning.laneMinTripsPerDay, road };
  if (growth.rung === "lane" && world.tuning.railEnabled) return { rung: "lane", next: "rail", road };
  return null;
}

/**
 * The busiest whole road at a town on a given rung, by trips a day wanted
 * along it (both ends on it, through any roadside towns): the road its next
 * rung would go on.
 */
function busiestRoad(world: SliceWorld, townId: string, rung: CorridorRung): { road: { a: string; b: string }; trips: number } | null {
  let best: { road: { a: string; b: string }; trips: number } | null = null;
  for (const segment of world.simulation.map.segments) {
    if (segment.type !== "road" || (segment.fromNodeId !== townId && segment.toNodeId !== townId)) continue;
    const its: CorridorRung = segment.busLane ? "lane" : isDirt(segment) ? "dirt" : "paved";
    if (its !== rung) continue;
    const chain = chainOf(world, segment.id);
    if (!chain) continue;
    const trips = demandAlong(world, chain.a, chain.b) * SECONDS_PER_GAME_DAY;
    if (!best || trips > best.trips) best = { road: { a: chain.a, b: chain.b }, trips };
  }
  return best;
}

/** How close to its target counts as "can't grow" (the drift toward it slows near the end). */
const ROAD_FULL_SHARE = 0.97;
/** Grown at least this share above its start: your service is what's growing it. */
const ROAD_FULL_GROWN = 0.05;

// How far a town's target must be from its size, as a share of its
// *starting* size, before it reads as growing or shrinking. At 2% of its
// current size, a town drifting 1-3k back to its start flashed a down arrow
// while shares settled (playtest, day 14: Owode, and Ilase/Kuto/Ikole a
// little over their start) -- noise read as a loss.
const TREND_SHARE_OF_BASE = 0.05;

export type GrowthTrend = "growing" | "shrinking" | "steady";

/** Which way a town is heading, for the map's arrow and the panel's sentence -- one rule for both. */
export function growthTrend(world: SliceWorld, townId: string): GrowthTrend {
  const growth = townGrowth(world, townId);
  const town = world.towns.get(townId);
  if (!growth || !town) return "steady";
  const gap = growth.target - town.population;
  if (gap > growth.base * TREND_SHARE_OF_BASE) return "growing";
  if (-gap > growth.base * TREND_SHARE_OF_BASE) return "shrinking";
  return "steady";
}

/** Drifts every original town toward the size its service supports. Demand follows once a day (settlement.ts). */
export function growTowns(world: SliceWorld, dt: number): void {
  const alpha = 1 - Math.exp(-dt / world.tuning.townGrowthTauSeconds);
  for (const townId of world.basePopulation.keys()) {
    const town = world.towns.get(townId);
    const growth = townGrowth(world, townId);
    if (!town || !growth) continue;
    town.population += (growth.target - town.population) * alpha;
  }
}
