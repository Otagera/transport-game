import type { GameWorld } from "./types";
import type { ActionResult } from "./world";
import { canAfford, SECONDS_PER_GAME_DAY } from "../economy/state";
import { flowKey, goodsFlows } from "./goods";
import { roadPath } from "./world";
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

export function hasYard(world: GameWorld, townId: string): boolean {
  return world.yards.has(townId);
}

export function checkYard(world: GameWorld, townId: string): ActionResult {
  if (!world.tuning.goodsEnabled || !world.tuning.yardsEnabled) return { ok: false, reason: SWITCHED_OFF };
  if (!world.towns.has(townId)) return { ok: false, reason: "no town there" };
  if (world.yards.has(townId)) return { ok: false, reason: "it already has a yard" };
  if (!canAfford(world.economy, world.tuning.yardCost)) return { ok: false, reason: "can't afford a yard" };
  return { ok: true };
}

export function buildYard(world: GameWorld, townId: string): ActionResult & { charged?: number } {
  const check = checkYard(world, townId);
  if (!check.ok) return check;
  world.economy.funds -= world.tuning.yardCost;
  world.yards.add(townId);
  return { ok: true, charged: world.tuning.yardCost };
}

/**
 * What a yard here would have to work with: tonnes a day of goods leaving this
 * place that nobody moves now, on roads within a yard's reach (the OpenCode
 * player: "haulage yards felt like noise" -- nothing said what one would do).
 * For the Yard tool's preview; an estimate, not a forecast.
 */
export function yardGain(world: GameWorld, townId: string): number {
  let tonnes = 0;
  for (const flow of goodsFlows(world)) {
    if (flow.from !== townId) continue;
    const path = roadPath(world, flow.from, flow.to);
    if (!path || path.distance > world.tuning.yardReachCells) continue;
    const outcome = world.goods.outcomes.get(flowKey(flow));
    tonnes += Math.max(0, flow.rate - (outcome?.delivered ?? 0) - (outcome?.trucked ?? 0)) * SECONDS_PER_GAME_DAY;
  }
  return tonnes;
}
