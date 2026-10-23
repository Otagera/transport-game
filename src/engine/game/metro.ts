import type { GameWorld } from "./types";
import type { ActionResult } from "./world";
import { canAfford, SECONDS_PER_GAME_DAY } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";

// A metro (docs/brief.md, Revision 4, 6: "a new mode for the biggest
// towns"). Every other mode you run carries trips between towns; inside a
// town, the short trips have been the kekes' and okadas' for good
// (world.ts localTravel: "not counted against you"). A metro is the one thing
// that takes a share of them:
//
//   - Built at a town of `metroMinPopulation` thousand or more, a line at a
//     time: the first `metroCost`, each more `metroLineCost`, up to
//     `metroMaxLines`.
//   - Riders a day: each line carries `metroLineShare` of the town's inside
//     trips (three lines, 45%) -- people still walk, and the keke still takes
//     them to the station. Each line is its own decision: at first the share
//     was capped across the metro, and in a town under ~430k a second line
//     carried nobody more (the strategist never bought one).
//   - Money: `metroFare` a rider, `metroRunningPerLine` a day a line.
//   - Growth (growth.ts): a town whose metro carries its inside trips grows
//     past its road's limit, like a station town: `metroCapShare` of its
//     start with every line built, in proportion to the lines.
//
// Its riders stay out of the trips-made headline, which counts trips between
// towns: every check measured on it still compares.

/** Lines built at each town. */
export function metroLines(world: GameWorld, townId: string): number {
  return world.tuning.metroEnabled ? (world.metros.get(townId) ?? 0) : 0;
}

/** A town's inside trips a day (world.ts localTravel's figure). */
function insideTrips(world: GameWorld, townId: string): number {
  const town = world.towns.get(townId);
  return town ? town.population * world.tuning.localTripsPerThousandPerDay : 0;
}

/** Riders a day the metro at a town carries now, and the share of the town's inside trips. */
export function metroRiders(world: GameWorld, townId: string): { riders: number; share: number } {
  const lines = metroLines(world, townId);
  const inside = insideTrips(world, townId);
  if (lines <= 0 || inside <= 0) return { riders: 0, share: 0 };
  const share = lines * world.tuning.metroLineShare;
  return { riders: share * inside, share };
}

/** What the next line at a town costs: the first, or another. */
export function metroPrice(world: GameWorld, townId: string): number {
  return metroLines(world, townId) === 0 ? world.tuning.metroCost : world.tuning.metroLineCost;
}

export function checkMetro(world: GameWorld, townId: string): ActionResult {
  const t = world.tuning;
  if (!t.metroEnabled) return { ok: false, reason: SWITCHED_OFF };
  const town = world.towns.get(townId);
  if (!town || town.industry) return { ok: false, reason: "no town there" };
  if (town.population < t.metroMinPopulation) return { ok: false, reason: `a metro needs a town of ${t.metroMinPopulation}k` };
  if (metroLines(world, townId) >= t.metroMaxLines) return { ok: false, reason: `it has all ${t.metroMaxLines} lines` };
  if (!canAfford(world.economy, metroPrice(world, townId))) return { ok: false, reason: "can't afford it" };
  return { ok: true };
}

/** Builds a town's metro, or another line of it. */
export function buildMetro(world: GameWorld, townId: string): ActionResult & { charged?: number } {
  const check = checkMetro(world, townId);
  if (!check.ok) return check;
  const price = metroPrice(world, townId);
  world.economy.funds -= price;
  world.metros.set(townId, metroLines(world, townId) + 1);
  return { ok: true, charged: price };
}

/** Every tick (tick.ts): the metros' fares in and running costs out. Returns both, for the ledger. */
export function runMetros(world: GameWorld, dt: number): { fares: number; running: number } {
  const t = world.tuning;
  let fares = 0;
  let running = 0;
  if (!t.metroEnabled) return { fares, running };
  for (const [townId, lines] of world.metros) {
    if (!world.towns.has(townId)) continue;
    fares += (metroRiders(world, townId).riders * t.metroFare * dt) / SECONDS_PER_GAME_DAY;
    running += (lines * t.metroRunningPerLine * dt) / SECONDS_PER_GAME_DAY;
  }
  world.economy.funds += fares - running;
  world.budget.metro += fares;
  return { fares, running };
}

/** How far a town's metro lifts its growth limit, as a share of its start (growth.ts). */
export function metroGrowthShare(world: GameWorld, townId: string): number {
  const t = world.tuning;
  if (!t.metroEnabled || metroLines(world, townId) === 0) return 0;
  return (t.metroCapShare * metroLines(world, townId)) / t.metroMaxLines;
}
