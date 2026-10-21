import type { SliceWorld } from "./types";
import type { ActionResult } from "./world";
import { canAfford } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";

// Haulage yards (docs/brief.md, Revision 4, 1). Road freight is private
// hauliers', as it is here: the state builds roads and runs freight rail; it
// doesn't run lorry fleets (and the player's lorries, measured, netted ~₦0 a
// day between them across 105-165 bought a game). You build a yard at a town
// or a site; from it, hauliers reach `yardReachCells` instead of their usual
// short hauls, and load `yardPickupBoost` times as fast -- so a chain's
// middle legs move without you, as far as the yard's reach and the roads
// allow -- crude included, from a yard at the oilfield or terminal (nobody
// trucks it otherwise). You collect `yardLevyPerTonne` on every load lifted there, the touts
// taking `yardToutShare` of it (a yard is run properly; a roadside park
// isn't). The long legs past a yard's reach stay rail's, and yours.

export function hasYard(world: SliceWorld, townId: string): boolean {
  return world.yards.has(townId);
}

export function checkYard(world: SliceWorld, townId: string): ActionResult {
  if (!world.tuning.goodsEnabled || !world.tuning.yardsEnabled) return { ok: false, reason: SWITCHED_OFF };
  if (!world.towns.has(townId)) return { ok: false, reason: "no town there" };
  if (world.yards.has(townId)) return { ok: false, reason: "it already has a yard" };
  if (!canAfford(world.economy, world.tuning.yardCost)) return { ok: false, reason: "can't afford a yard" };
  return { ok: true };
}

export function buildYard(world: SliceWorld, townId: string): ActionResult & { charged?: number } {
  const check = checkYard(world, townId);
  if (!check.ok) return check;
  world.economy.funds -= world.tuning.yardCost;
  world.yards.add(townId);
  return { ok: true, charged: world.tuning.yardCost };
}
