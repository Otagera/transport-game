import type { SliceWorld } from "./types";
import { townShare } from "./world";

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
//   - The cap is bounded independently of population: a fixed multiple of
//     the town's starting size, never of its current one.
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
  /** The most it can reach, thousands. */
  cap: number;
  /** The size its service now supports, thousands. */
  target: number;
  /** Your share of its trips plus the discounted informal share, 0..1. */
  service: number;
  /** Your share of its trips, 0..1 -- below growthMinPlayerShare it can't grow. */
  playerShare: number;
}

export function townGrowth(world: SliceWorld, townId: string): TownGrowth | null {
  const base = world.basePopulation.get(townId);
  if (base === undefined) return null; // emergent towns grow from traffic (settlement.ts)
  const { tuning } = world;
  const share = townShare(world, townId);
  const service = share.player + INFORMAL_SERVICE_WEIGHT * share.informal;
  const cap = base * (1 + tuning.townGrowthCap);
  const developed = share.player >= tuning.growthMinPlayerShare
    ? smoothstep((service - tuning.growthServiceFloor) / (tuning.growthServiceFull - tuning.growthServiceFloor))
    : 0;
  return { base, cap, target: base + (cap - base) * developed, service, playerShare: share.player };
}

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
