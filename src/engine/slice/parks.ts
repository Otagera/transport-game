import type { SliceWorld } from "./types";
import type { ActionResult } from "./world";
import { canAfford, SECONDS_PER_GAME_DAY } from "../economy/state";
import { townOutcomes } from "./world";
import { SWITCHED_OFF } from "./tuning";

// Motor parks for danfos (docs/brief.md, Revision 4, 5): the state's real
// role with danfos -- managed, not fought. You build a park at a town; its
// danfos, kekes and okadas load there, not at the roadside, so:
//
//   - the roads into it flow better: every road touching the town carries
//     `parkCapacityBoost` more before it jams (congestion.ts roadCapacity) --
//     your buses' roads too;
//   - their park levy reaches you properly: on every departure from it the
//     agberos keep `parkAgberoCut` of the levy, not the roadside's `agberoCut`
//     (tick.ts sendInformal).
//
// The choice it asks: a park makes the danfos better at what they do -- they
// load faster and the roads clear for them as for you -- and pays you more
// for it. Fighting them is a bus lane; managing them is a park.

export function hasPark(world: SliceWorld, townId: string): boolean {
  return world.parks.has(townId);
}

export function checkPark(world: SliceWorld, townId: string): ActionResult {
  if (!world.tuning.parksEnabled) return { ok: false, reason: SWITCHED_OFF };
  const town = world.towns.get(townId);
  if (!town) return { ok: false, reason: "no town there" };
  if (town.industry) return { ok: false, reason: "a site has no danfos to park" };
  if (world.parks.has(townId)) return { ok: false, reason: "it already has a park" };
  if (!canAfford(world.economy, world.tuning.parkCost)) return { ok: false, reason: "can't afford a park" };
  return { ok: true };
}

export function buildPark(world: SliceWorld, townId: string): ActionResult & { charged?: number } {
  const check = checkPark(world, townId);
  if (!check.ok) return check;
  world.economy.funds -= world.tuning.parkCost;
  world.parks.add(townId);
  return { ok: true, charged: world.tuning.parkCost };
}

/** How much more a road carries before it jams for the parks at its ends: 1 with none. */
export function parkCapacityFactor(world: SliceWorld, fromNodeId: string, toNodeId: string): number {
  if (world.parks.size === 0 || !world.tuning.parksEnabled) return 1;
  return world.parks.has(fromNodeId) || world.parks.has(toNodeId) ? 1 + world.tuning.parkCapacityBoost : 1;
}

/**
 * About what a park here would add to your levies a day: the riders danfos,
 * kekes and okadas carry out of the town now, at the levy a seat, times the
 * cut the agberos stop taking. An estimate for the Park tool's preview.
 */
export function parkLevyGain(world: SliceWorld, townId: string): number {
  const t = world.tuning;
  const out = townOutcomes(world, townId);
  return (out.poached + out.gaveUp) * SECONDS_PER_GAME_DAY * t.levyPerSeat * Math.max(0, t.agberoCut - t.parkAgberoCut);
}

/** The agberos' cut of the levy on a departure from this town. */
export function agberoCutAt(world: SliceWorld, townId: string): number {
  return world.tuning.parksEnabled && world.parks.has(townId) ? world.tuning.parkAgberoCut : world.tuning.agberoCut;
}
