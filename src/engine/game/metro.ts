import type { GameWorld, UrbanKind, UrbanRung } from "./types";
import type { ActionResult } from "./world";
import { canAfford, SECONDS_PER_GAME_DAY } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";
import { insideTrips } from "./inside";
import { struckSegments } from "./pushback";

// City lines: the urban ladder (docs/PROMPT-urban-ladder.md, its reason rewritten on the inside
// scale; brief, Scales). The city is a card, not a map: a town's own journeys are decided on its
// card and change its aggregate (inside.ts) -- no streets, no second map.
//
// Three rungs, one kind a town, a line at a time:
//
//   - **Light rail** (80k+): trams on the street. Cheap, and the rung most towns can take, but it
//     shares the street: each line takes `roadCapacityPerLine` of its town's approach roads
//     (congestion.ts roadCapacity), a strike on those roads stops it with everything else, and its
//     riders come mostly out of the kekes and okadas, not the cars.
//   - **Monorail** (150k+): elevated, on piers. No street cost, no strike, a real price; more of its
//     riders out of the cars.
//   - **Metro** (200k+): underground, the dearest; the most out of the cars. Its numbers are the
//     metro's as it always was (the `metro*` tuning), so existing runs and checks still compare.
//
// What a line is for (the inside scale): only a town's cars load its approach roads, and a city
// line takes its riders out of the cars and the okadas in its rung's ratio (`carDraw`). So the
// rungs differ, above all, in how many cars each takes off your roads -- and light rail can leave
// them worse, its trams in the lanes the cars it took left.
//
//   - Riders a day: each line carries `lineShare` of the town's inside trips -- people still walk,
//     and the keke still takes them to the station. Each line is its own decision (at first the
//     share was capped across the metro, and a second line in a town under ~430k carried nobody).
//   - Money: `fare` a rider, `runningPerLine` a day a line -- charged in a strike, too.
//   - Growth (growth.ts): a town whose lines carry its inside trips grows past its road's limit,
//     like a station town: `capShare` of its start with every line built, in proportion.
//
// Its riders stay out of the trips-made headline, which counts trips between towns.
//
// The state is the metro's, kept as it was so saves and run files from before the ladder load
// and replay: `world.metros` the lines a town has, `world.urbanKinds` its kind (absent: a metro).
// The other two rungs are in a game only when its tuning has them (`urbanRungs`).

export const URBAN_KINDS: readonly UrbanKind[] = ["lightrail", "monorail", "metro"];

const NAMES: Record<UrbanKind, string> = { lightrail: "light rail", monorail: "a monorail", metro: "a metro" };
/** "light rail", "a monorail", "a metro": for a sentence. */
export function urbanName(kind: UrbanKind): string {
  return NAMES[kind];
}

/** A rung's numbers in this game, or null when the game hasn't the rung (or the ladder is off). */
export function urbanRung(world: GameWorld, kind: UrbanKind): UrbanRung | null {
  const t = world.tuning;
  if (!t.metroEnabled) return null;
  if (kind !== "metro") return t.urbanRungs?.[kind] ?? null;
  return {
    minPopulation: t.metroMinPopulation, firstCost: t.metroCost, lineCost: t.metroLineCost, maxLines: t.metroMaxLines,
    lineShare: t.metroLineShare, fare: t.metroFare, runningPerLine: t.metroRunningPerLine, capShare: t.metroCapShare,
    roadCapacityPerLine: 0, stoppedByStrikes: false, carDraw: t.cityLineCarDraw ?? 0.5,
  };
}

/** Lines built at a town, whatever their kind. */
export function metroLines(world: GameWorld, townId: string): number {
  return world.tuning.metroEnabled ? (world.metros.get(townId) ?? 0) : 0;
}

/** The kind a town has built, or null with none. */
export function urbanKind(world: GameWorld, townId: string): UrbanKind | null {
  if (metroLines(world, townId) <= 0) return null;
  return world.urbanKinds?.get(townId) ?? "metro";
}

/** A town's built rung and its lines, or null with none. */
export function urbanAt(world: GameWorld, townId: string): { kind: UrbanKind; lines: number; rung: UrbanRung } | null {
  const kind = urbanKind(world, townId);
  const rung = kind ? urbanRung(world, kind) : null;
  return kind && rung ? { kind, lines: metroLines(world, townId), rung } : null;
}

/** Whether a strike blocks a road into the town today (the lanes' strikes, pushback.ts). */
export function townStruck(world: GameWorld, townId: string): boolean {
  const now = world.economy.elapsedSeconds;
  if (!world.lanes.some((lane) => lane.strikeUntil > now)) return false;
  const struck = struckSegments(world);
  return world.simulation.map.segments.some((s) => struck.has(s.id) && (s.fromNodeId === townId || s.toNodeId === townId));
}

/** Riders a day a town's city lines carry now, and their share of its inside trips (none in a strike, for light rail). */
export function urbanRiders(world: GameWorld, townId: string): { riders: number; share: number } {
  const at = urbanAt(world, townId);
  const inside = insideTrips(world, townId);
  if (!at || inside <= 0) return { riders: 0, share: 0 };
  if (at.rung.stoppedByStrikes && townStruck(world, townId)) return { riders: 0, share: 0 };
  const share = at.lines * at.rung.lineShare;
  return { riders: share * inside, share };
}
/** The metro's old name for it, kept for its callers. */
export const metroRiders = urbanRiders;

/** What the next line of a kind at a town costs: the first, or another. */
export function urbanPrice(world: GameWorld, townId: string, kind: UrbanKind = urbanKind(world, townId) ?? "metro"): number {
  const rung = urbanRung(world, kind);
  if (!rung) return Infinity;
  return metroLines(world, townId) === 0 ? rung.firstCost : rung.lineCost;
}
export const metroPrice = (world: GameWorld, townId: string): number => urbanPrice(world, townId);

export function checkUrban(world: GameWorld, townId: string, kind: UrbanKind = "metro"): ActionResult {
  if (!world.tuning.metroEnabled) return { ok: false, reason: SWITCHED_OFF };
  const rung = urbanRung(world, kind);
  if (!rung) return { ok: false, reason: `there's no ${kind === "lightrail" ? "light rail" : kind} in this game` };
  const town = world.towns.get(townId);
  if (!town || town.industry) return { ok: false, reason: "no town there" };
  const has = urbanKind(world, townId);
  if (has && has !== kind) return { ok: false, reason: `${town.name} already has ${urbanName(has)}` };
  if (town.population < rung.minPopulation) return { ok: false, reason: `${urbanName(kind)} needs a town of ${rung.minPopulation}k` };
  if (metroLines(world, townId) >= rung.maxLines) return { ok: false, reason: `it has all ${rung.maxLines} lines` };
  if (!canAfford(world.economy, urbanPrice(world, townId, kind))) return { ok: false, reason: "can't afford it" };
  return { ok: true };
}
export const checkMetro = (world: GameWorld, townId: string): ActionResult => checkUrban(world, townId, "metro");

/** Builds a town's city line of a kind, or another line of it. */
export function buildUrban(world: GameWorld, townId: string, kind: UrbanKind = "metro"): ActionResult & { charged?: number } {
  const check = checkUrban(world, townId, kind);
  if (!check.ok) return check;
  const price = urbanPrice(world, townId, kind);
  world.economy.funds -= price;
  world.metros.set(townId, metroLines(world, townId) + 1);
  // Only a kind other than the metro is written down: a world without the record is all metros.
  if (kind !== "metro") (world.urbanKinds ??= new Map()).set(townId, kind);
  return { ok: true, charged: price };
}
export const buildMetro = (world: GameWorld, townId: string) => buildUrban(world, townId, "metro");

/** Every tick (tick.ts): the city lines' fares in and running costs out. Returns both, for the ledger. */
export function runMetros(world: GameWorld, dt: number): { fares: number; running: number } {
  let fares = 0;
  let running = 0;
  if (!world.tuning.metroEnabled) return { fares, running };
  for (const [townId] of world.metros) {
    if (!world.towns.has(townId)) continue;
    const at = urbanAt(world, townId);
    if (!at) continue;
    fares += (urbanRiders(world, townId).riders * at.rung.fare * dt) / SECONDS_PER_GAME_DAY;
    running += (at.lines * at.rung.runningPerLine * dt) / SECONDS_PER_GAME_DAY;
  }
  world.economy.funds += fares - running;
  world.budget.metro += fares;
  return { fares, running };
}

/** How far a town's city lines lift its growth limit, as a share of its start (growth.ts). */
export function urbanGrowthShare(world: GameWorld, townId: string): number {
  const at = urbanAt(world, townId);
  if (!at) return 0;
  return (at.rung.capShare * at.lines) / at.rung.maxLines;
}

/** The share of road capacity a town's city lines leave its approach roads (congestion.ts): light rail's trams in the street. */
export function urbanRoadFactor(world: GameWorld, townId: string): number {
  const at = urbanAt(world, townId);
  if (!at || at.rung.roadCapacityPerLine <= 0) return 1;
  return Math.max(0, 1 - at.rung.roadCapacityPerLine * at.lines);
}
