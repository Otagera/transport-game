import type { GameWorld } from "./types";
import type { ActionResult, RouteVerdict } from "./world";
import { diagnoseRoute, routeSummaries } from "./world";
import { routeStops } from "./transfers";
import { canAfford, SECONDS_PER_GAME_DAY } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";

// Your bus stations (docs/brief.md, Your bus station; agreed 2026-11-04, from the map 5059
// playtest). The motor park is the danfos'; a bus station is yours, one a town. Riders already
// change between your lines (transfers.ts), each leg paying its fare -- but a rider changing
// waited at the roadside like anyone else and gave up at the same rate: measured on four saved
// games, at two to four hub towns about half of those changing gave up there, after paying for
// their first leg (Odun on 5059: 270 lost against 407 changed). At a station:
//
//   - riders changing lines wait under cover: `busStationPatience` times as long before they give
//     up (tick.ts, giving up). Riders starting their trip there wait as they would anyway;
//   - it's the depot: your vehicles on a line with an end there are serviced there, and
//     `busStationDepotShare` of what rough roads add to their running cost comes back (wear.ts
//     chargeRoughRoads).
//
// So where your lines meet is the choice: at a hub it keeps the riders who change there and
// services the lines ending there; at a town no two lines meet, only the depot.

/** Riders a day giving up changing lines at a town before Waiting on you and its card offer a station there. */
export const STATION_OFFER_PER_DAY = 80;

export function busStationsOn(world: GameWorld): boolean {
  return !!world.tuning.busStationsEnabled && !!world.busStations && world.busStations.size > 0;
}

export function hasBusStation(world: GameWorld, townId: string): boolean {
  return !!world.tuning.busStationsEnabled && !!world.busStations?.has(townId);
}

export function checkBusStation(world: GameWorld, townId: string): ActionResult {
  if (!world.tuning.busStationsEnabled) return { ok: false, reason: SWITCHED_OFF };
  const town = world.towns.get(townId);
  if (!town) return { ok: false, reason: "no town there" };
  if (town.industry) return { ok: false, reason: "a bus station goes in a town" };
  if (world.busStations?.has(townId)) return { ok: false, reason: "it already has your bus station" };
  if (!canAfford(world.economy, world.tuning.busStationCost ?? 0)) return { ok: false, reason: "can't afford a bus station" };
  return { ok: true };
}

export function buildBusStation(world: GameWorld, townId: string): ActionResult & { charged?: number } {
  const check = checkBusStation(world, townId);
  if (!check.ok) return check;
  const cost = world.tuning.busStationCost ?? 0;
  world.economy.funds -= cost;
  (world.busStations ??= new Set()).add(townId);
  return { ok: true, charged: cost };
}

/** How many times longer a rider changing lines at this town waits before giving up: 1 with no station. */
export function changePatience(world: GameWorld, townId: string): number {
  return hasBusStation(world, townId) ? world.tuning.busStationPatience ?? 1 : 1;
}

/** The share of a line's rough-road running cost it still pays: less if an end of it has your station. */
export function depotFactor(world: GameWorld, a: string, b: string): number {
  if (!busStationsOn(world)) return 1;
  return hasBusStation(world, a) || hasBusStation(world, b) ? 1 - (world.tuning.busStationDepotShare ?? 0) : 1;
}

/** One line on a station's board: what it makes or loses a day, and what's wrong with it. */
export interface BoardLine {
  routeId: string;
  a: string;
  b: string;
  vehicles: number;
  netPerDay: number;
  verdict: RouteVerdict | null;
  /** Whether it ends here (serviced at the depot) or passes through. */
  ends: boolean;
}

/** A town's board (a station's card, and the Station tool's quote): your lines through it, riders changing there, and those giving up changing. Null with none of your lines there. */
export interface StationBoard {
  lines: BoardLine[];
  changingPerDay: number;
  givingUpPerDay: number;
}

export function stationBoard(world: GameWorld, townId: string): StationBoard | null {
  const summaries = new Map(routeSummaries(world).map((r) => [r.id, r]));
  const lines: BoardLine[] = [];
  for (const route of world.routes) {
    if (route.vehicleIds.length === 0) continue;
    const ends = route.a === townId || route.b === townId;
    if (!ends && !routeStops(world, route.id).includes(townId)) continue;
    const s = summaries.get(route.id);
    lines.push({ routeId: route.id, a: route.a, b: route.b, vehicles: route.vehicleIds.length, netPerDay: s?.netPerDay ?? 0, verdict: diagnoseRoute(world, route.id)?.verdict ?? null, ends });
  }
  if (lines.length === 0) return null;
  // Losing first: the board's job is the line to look at.
  lines.sort((p, q) => p.netPerDay - q.netPerDay);
  return {
    lines,
    changingPerDay: (world.transferRateEMA.get(townId) ?? 0) * SECONDS_PER_GAME_DAY,
    givingUpPerDay: (world.changeGiveUpEMA?.get(townId) ?? 0) * SECONDS_PER_GAME_DAY,
  };
}
