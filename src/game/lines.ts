// Everything you run, as one kind of row (the info layer, 2026-11-02). Buses and minibuses,
// BRT, passenger trains, lorries and freight trains had each their own list and words: the
// routes a table, the lorries a table you couldn't click and again as older cards under More,
// freight trains among the lorries. Your playtest: "the difference between roads (corridors),
// routes and the trains, freight and track ... need harmonization". A line is a line: what it
// carries (people or goods), on what (road or rail), how many vehicles, how much it carries
// a day, how full, its money, and what's wrong with it, the same words for every kind.
//
// Read off the world now, as the panels are (render-and-ui.md): nothing here is kept.

import type { GameWorld } from "@engine/game/types";
import type { Segment } from "@engine/map/types";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import { chainOf, diagnoseRoute, roadPath, routeSummaries } from "@engine/game/world";
import { diagnoseLorryRoute, isFreightRoute, lorrySummaries } from "@engine/game/goods";
import { railPath } from "@engine/game/rail";
import { roadCapacity } from "@engine/game/congestion";
import { privateLoad } from "@engine/game/private";
import { upkeepPerDay } from "@engine/game/wear";
import { isYourRoad } from "@engine/game/upkeep";

export type LineKind = "bus" | "minibus" | "brt" | "train" | "lorry" | "freight" | "boat" | "barge";
export type Family = "people" | "goods";
export type Mode = "road" | "rail" | "water";

export interface Line {
  id: string;
  kind: LineKind;
  family: Family;
  mode: Mode;
  a: string;
  b: string;
  vehicles: number;
  /** Riders a day, or tonnes a day, carried. */
  carried: number;
  /** How full its vehicles run, 0..1. */
  full: number;
  incomePerDay: number;
  costPerDay: number;
  netPerDay: number;
  /** What's wrong with it in a word ("thin", "spoiling"), or null when it runs well. */
  verdict: string | null;
}

export const KIND_NAME: Record<LineKind, { one: string; many: string; vehicle: string; vehicles: string }> = {
  bus: { one: "Bus", many: "Buses", vehicle: "bus", vehicles: "buses" },
  minibus: { one: "Minibus", many: "Minibuses", vehicle: "minibus", vehicles: "minibuses" },
  brt: { one: "BRT", many: "BRT", vehicle: "BRT bus", vehicles: "BRT buses" },
  train: { one: "Train", many: "Trains", vehicle: "train", vehicles: "trains" },
  lorry: { one: "Lorries", many: "Lorries", vehicle: "lorry", vehicles: "lorries" },
  freight: { one: "Freight", many: "Freight", vehicle: "freight train", vehicles: "freight trains" },
  boat: { one: "Water bus", many: "Water buses", vehicle: "water bus", vehicles: "water buses" },
  barge: { one: "Barges", many: "Barges", vehicle: "barge", vehicles: "barges" },
};

/** The families of line, in the order the panels show them. */
export const GROUPS: Array<{ id: `${Family}-${Mode}`; name: string; family: Family; mode: Mode }> = [
  { id: "people-road", name: "People by road", family: "people", mode: "road" },
  { id: "people-rail", name: "People by rail", family: "people", mode: "rail" },
  { id: "goods-road", name: "Goods by road", family: "goods", mode: "road" },
  { id: "goods-rail", name: "Goods by rail", family: "goods", mode: "rail" },
  { id: "people-water", name: "People by water", family: "people", mode: "water" },
  { id: "goods-water", name: "Goods by water", family: "goods", mode: "water" },
];

const passengerKind = (id: string): LineKind => (id.startsWith("boat:") ? "boat" : id.startsWith("rail:") ? "train" : id.startsWith("mini:") ? "minibus" : id.startsWith("brt:") ? "brt" : "bus");

export function lines(world: GameWorld): Line[] {
  const D = SECONDS_PER_GAME_DAY;
  const people = routeSummaries(world).map((r): Line => {
    const route = world.routes.find((x) => x.id === r.id);
    const kind = passengerKind(r.id);
    const verdict = diagnoseRoute(world, r.id)?.verdict ?? null;
    return {
      id: r.id, kind, family: "people", mode: kind === "train" ? "rail" : kind === "boat" ? "water" : "road", a: r.a, b: r.b, vehicles: r.buses,
      carried: (route?.boardingRateEMA ?? 0) * D, full: route?.loadFactorEMA ?? 0,
      incomePerDay: r.incomePerDay, costPerDay: r.costPerDay, netPerDay: r.netPerDay,
      verdict: verdict === "healthy" ? null : verdict,
    };
  });
  const goods = lorrySummaries(world).map((g): Line => {
    const d = diagnoseLorryRoute(world, g.id);
    const freight = isFreightRoute(g.id);
    const barge = g.id.startsWith("barge:");
    return {
      id: g.id, kind: barge ? "barge" : freight ? "freight" : "lorry", family: "goods", mode: barge ? "water" : freight ? "rail" : "road", a: g.a, b: g.b, vehicles: g.lorries,
      carried: d ? (d.outbound + d.inbound) * d.delivered : 0, full: d?.loadFactor ?? 0,
      incomePerDay: g.incomePerDay, costPerDay: g.costPerDay, netPerDay: g.netPerDay,
      verdict: !d || d.verdict === "healthy" ? null : d.verdict,
    };
  });
  return [...people, ...goods];
}

// --- Ways: what the lines run on ------------------------------------------------------
// A road as you think of it -- the whole of it between two towns, through any roadside town
// grown on it (world.ts chainOf), which is also what a corridor is (corridors.ts) -- and a
// stretch of track. Roads had no list (the corridors under More, a road's card only from
// the map) and track had none at all.

export interface Way {
  /** Its first piece's id: what its card opens. */
  id: string;
  mode: Mode;
  a: string;
  b: string;
  pieces: Segment[];
  surface: "dirt" | "paved" | "mixed" | null;
  lane: boolean;
  /** Its worst piece's condition, 0..1. */
  condition: number;
  /** Its busiest piece's traffic against what it carries before it jams, 0..1+. */
  load: number;
  /** Its slowest piece's speed, 0..1 of free. */
  speed: number;
  yours: boolean;
  kept: boolean;
  upkeepPerDay: number;
  retired: boolean;
  /** Track of the old line, not yet back in service (stations.ts): the state's, not yours to mend. */
  outOfService: boolean;
}

export function ways(world: GameWorld): Way[] {
  const seen = new Set<string>();
  const out: Way[] = [];
  for (const segment of world.simulation.map.segments) {
    if (seen.has(segment.id)) continue;
    const road = segment.type === "road";
    const chain = road ? chainOf(world, segment.id) : null;
    const pieces = chain?.pieces ?? [segment];
    for (const piece of pieces) seen.add(piece.id);
    const surfaces = new Set(pieces.map((p) => p.surface ?? "dirt"));
    const load = road
      ? Math.max(...pieces.map((p) => {
          const cap = roadCapacity(world, p.id);
          return cap > 0 ? ((world.roadFlowEMA.get(p.id) ?? 0) + privateLoad(world, p.id)) / cap : 0;
        }))
      : 0;
    out.push({
      id: pieces[0]!.id, mode: road ? "road" : "rail",
      a: chain?.a ?? segment.fromNodeId, b: chain?.b ?? segment.toNodeId, pieces,
      surface: road ? (surfaces.size > 1 ? "mixed" : surfaces.has("paved") ? "paved" : "dirt") : null,
      lane: road && pieces.every((p) => p.busLane),
      condition: Math.min(...pieces.map((p) => p.condition ?? 1)),
      load,
      speed: Math.min(...pieces.map((p) => world.segmentSpeed.get(p.id) ?? 1)),
      yours: road ? pieces.every((p) => isYourRoad(p)) : true,
      kept: pieces.every((p) => world.maintained.has(p.id)),
      upkeepPerDay: world.tuning.wearEnabled && road ? pieces.reduce((sum, p) => sum + (world.maintained.has(p.id) ? upkeepPerDay(world, p) : 0), 0) : 0,
      retired: pieces.some((p) => p.retiredAt !== undefined),
      outOfService: !road && pieces.some((p) => world.railOutOfService.has(p.id)),
    });
  }
  return out;
}

/** The ways each line runs along, by the pieces of its path: a line is on every way it uses. */
export function waysOf(world: GameWorld, all: Line[], allWays: Way[]): Map<string, string[]> {
  const wayOf = new Map<string, string>();
  for (const way of allWays) for (const piece of way.pieces) wayOf.set(piece.id, way.id);
  const result = new Map<string, string[]>();
  for (const line of all) {
    // A boat's line is on no road or track (boats.ts): no ways.
    const path = line.mode === "water" ? null : line.mode === "rail" ? railPath(world, line.a, line.b) : roadPath(world, line.a, line.b);
    const on: string[] = [];
    for (const id of path?.segmentIds ?? []) {
      const way = wayOf.get(id);
      if (way && !on.includes(way)) on.push(way);
    }
    result.set(line.id, on);
  }
  return result;
}

/** A line's verdict as a few words for a list (the card says the whole of it). */
export const VERDICT_WORDS: Record<string, string> = {
  thin: "Thin", overcapacity: "More seats than riders", jammed: "Jammed", long: "Too long", worn: "Worn roads",
  full: "Full", poached: "Danfos take its riders", waiting: "Riders give up waiting", "one-way": "One-way", spoiling: "Goods spoil",
};
