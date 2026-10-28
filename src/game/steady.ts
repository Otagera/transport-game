// Readings the screen shows, steadied. Goods arrive in loads -- a tanker, a lorry of rice --
// so what a town has had rolls up and down between them: a town's fuel ran 100% -> 72% ->
// 100% in a game day, the card's "Danfo fares here +x" sentence came and went with it (the
// panel's layout jumped in 26 of 59 redraws at 4x, buttons moving from under the pointer),
// a mill's ⚠ flipped at its 60% line, the 3D sellers set up and packed away with each
// tanker. Shown here as the average over the last couple of game days.
//
// For the screen only: the simulation still runs on the moment's numbers (fares, parked
// danfos and your costs follow each tanker), and nothing here goes into the world, so
// replays are untouched (as production.ts keeps "carried away"). Sampled for every town
// and site as the panel redraws (keepSteady), so a card opened mid-swing shows the
// average, not the moment.

import type { GameWorld } from "@engine/game/types";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import { fuelSupply, shortageAt } from "@engine/game/fuel";
import { flourServed, foodServed, marketFed } from "@engine/game/food";
import { goodsFlows, type GoodsFlow } from "@engine/game/goods";
import { siteProduction, type SiteProduction } from "@engine/game/production";

/** How long a reading averages over: longer than the time between a town's tankers. */
const STEADY_DAYS = 2;

const readings = new WeakMap<GameWorld, Map<string, { value: number; at: number }>>();

/** `raw`, averaged over the last `days` of game time under `key`. */
export function steady(world: GameWorld, key: string, raw: number, days = STEADY_DAYS): number {
  let byKey = readings.get(world);
  if (!byKey) readings.set(world, (byKey = new Map()));
  const now = world.economy.elapsedSeconds;
  const seen = byKey.get(key);
  const tau = days * SECONDS_PER_GAME_DAY;
  // New, or not read for a long while (or time ran backwards: a replay): start from the moment.
  if (!seen || now < seen.at || now - seen.at > 3 * tau) {
    byKey.set(key, { value: raw, at: now });
    return raw;
  }
  seen.value += (raw - seen.value) * (1 - Math.exp(-(now - seen.at) / tau));
  seen.at = now;
  return seen.value;
}

/**
 * fuelSupply, steadied. Where it comes from is told as shares of what's supplied: what
 * arrives is capped at what the town wants moment by moment, so its sources averaged
 * apart read more than the whole ("75% supplied (86% imported)").
 */
export function steadyFuel(world: GameWorld, townId: string): { supplied: number; imported: number; refined: number } | null {
  const supply = fuelSupply(world, townId);
  if (!supply) return null;
  const supplied = steady(world, `fuel:${townId}`, supply.supplied);
  const imported = steady(world, `fuel-imported:${townId}`, supply.imported);
  const refined = steady(world, `fuel-refined:${townId}`, supply.refined);
  const both = imported + refined;
  return { supplied, imported: both > 0 ? (supplied * imported) / both : 0, refined: both > 0 ? (supplied * refined) / both : 0 };
}

/** shortageAt, steadied: what the card and the 3D sellers show. */
export function steadyShortage(world: GameWorld, townId: string): number {
  return steady(world, `short:${townId}`, shortageAt(world, townId));
}

const over = new WeakMap<GameWorld, Map<string, boolean>>();
/**
 * Whether `value` is past `line`, with a band below it: once past, it stays past until it
 * falls `band` under the line. A steadied reading resting on a line (a town's fuel shortage
 * at the card's 10%) still crossed it back and forth, and its sentence came and went.
 */
export function steadyOver(world: GameWorld, key: string, value: number, line: number, band = 0.03): boolean {
  let byKey = over.get(world);
  if (!byKey) over.set(world, (byKey = new Map()));
  const was = byKey.get(key) ?? false;
  const now = was ? value >= line - band : value >= line;
  byKey.set(key, now);
  return now;
}

/** A market town's food, flour and the two together (food.ts), steadied. */
export function steadyFood(world: GameWorld, townId: string): { food: number; flour: number; market: number } {
  return {
    food: steady(world, `food:${townId}`, foodServed(world, townId)),
    flour: steady(world, `flour:${townId}`, flourServed(world, townId)),
    market: steady(world, `market:${townId}`, marketFed(world, townId)),
  };
}

/** siteProduction with what it makes and what arrives steadied (a mill fed by the lorry-load). */
export function steadySite(world: GameWorld, siteId: string, flows: GoodsFlow[] = goodsFlows(world)): SiteProduction | null {
  const p = siteProduction(world, siteId, flows);
  if (!p) return null;
  return {
    ...p,
    made: steady(world, `made:${siteId}`, p.made),
    inputs: p.inputs.map((input) => ({ ...input, arriving: steady(world, `in:${siteId}:${input.name}`, input.arriving) })),
  };
}

/** Samples every steadied reading, so each is warm before a card shows it. */
export function keepSteady(world: GameWorld): void {
  const flows = goodsFlows(world);
  for (const town of world.towns.values()) {
    if (town.industry) {
      steadySite(world, town.id, flows);
      continue;
    }
    steadyFuel(world, town.id);
    steadyShortage(world, town.id);
    if (world.food && world.basePopulation.has(town.id)) steadyFood(world, town.id);
  }
}
