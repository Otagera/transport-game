import type { Segment } from "../map/types";
import type { GameWorld } from "./types";
import type { GameEvent } from "./settlement";
import { SECONDS_PER_GAME_DAY as D, canAfford } from "../economy/state";
import { overWater, polylineLength, segmentPolyline, splitPolyline, type Point } from "./roads";
import type { ActionResult } from "./world";

// The rains: the first shock (docs/brief.md, Revision 5, step 6: "fords close in the flood
// season, as the first shock"; shocks are "seeded, announced in advance, with a deadline, and
// costly to ignore. The second refinery is the template").
//
// Every old road that crosses a river does it at a ford -- a causeway, dirt, low on the water
// (measured: 3-7 a map, the home trunk's always among them). Each is named for the town it's
// nearer. Twice a year the rains come: two weeks ahead, the season's fords are named (the
// busiest first) and the price of raising a bridge at each. Raise it before the water does, and
// it never floods again. Leave it, and for the flood's days everything on that road waits at the
// bank: it runs at `floodSpeed` -- passable by waiting and canoe, not by timetable. The towns it
// joins feel it as any cut road: your routes over it fall behind, the danfos' too.
//
// A road you build has its bridge priced in (roads.ts): only the old roads have fords.
//
// Plain data on the world, changed here and by the `bridgeFord` action, so a run file replays it.
// Off, and absent, in runs played before it (no floodsEnabled).

export interface Ford {
  id: string;
  name: string;
  /** Where the road crosses: the middle of its wet run, map cells. */
  x: number;
  y: number;
  /** The water it crosses, cells. */
  span: number;
  /** The towns its road joins. */
  a: string;
  b: string;
  bridged: boolean;
}

export interface FloodState {
  fords: Ford[];
  /** Which rains these are, from 0: what's drawn for each season comes from it. */
  season: number;
  /** Dry; the season's fords named; under water. */
  phase: "dry" | "warned" | "flood";
  /** When the season's fords are named, when the water rises, and when it falls. */
  warnAt: number;
  riseAt: number;
  fallAt: number;
  /** The season's fords (named at warnAt). */
  coming: string[];
  /** Fords under water now. */
  under: string[];
  /** Road pieces under water now (refreshed daily while it lasts: a town can split a road). */
  flooded: Set<string>;
  nextCheckAt: number;
}

const on = (world: GameWorld) => !!world.tuning.floodsEnabled && !!world.floods;

/** A small seeded hash, for what each season draws. */
function hash(...parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) h = Math.imul(h ^ (p | 0), 16777619) >>> 0;
  return h >>> 0;
}

/** The wet runs of a road: where along it each crossing lies, and how wide. */
function crossings(world: GameWorld, segment: Segment): Array<{ at: Point; span: number }> {
  const line = segmentPolyline(world.simulation.map, segment);
  const length = polylineLength(line);
  const out: Array<{ at: Point; span: number }> = [];
  let start = -1;
  for (let d = 0.25; d <= length + 0.25; d += 0.5) {
    const wet = d < length && overWater(world, splitPolyline(line, d)[1][0]!);
    if (wet && start < 0) start = d;
    if (!wet && start >= 0) {
      out.push({ at: splitPolyline(line, (start + d - 0.5) / 2)[1][0]!, span: Math.max(1, d - start) });
      start = -1;
    }
  }
  return out;
}

/** At a new game's start, after the warm-up (start.ts): the fords, and the first rains drawn. */
export function startFloods(world: GameWorld): void {
  if (!world.tuning.floodsEnabled) return;
  const fords: Ford[] = [];
  const used = new Set<string>();
  for (const segment of world.simulation.map.segments) {
    if (segment.type !== "road" || segment.provenance !== "inherited" || segment.retiredAt !== undefined) continue;
    for (const { at, span } of crossings(world, segment)) {
      const a = world.towns.get(segment.fromNodeId);
      const b = world.towns.get(segment.toNodeId);
      if (!a || !b) continue;
      // Named for the town it's nearer -- or, on a site's road, for the site.
      const site = [a, b].find((t) => t.industry);
      const [near, far] = [a, b].sort((p, q) => Math.hypot(p.x - at.x, p.y - at.y) - Math.hypot(q.x - at.x, q.y - at.y));
      let name = site ? `${site.name} ford` : `${near!.name} ford`;
      if (used.has(name) && !site) name = `${near!.name}–${far!.name} ford`;
      for (let k = 2; used.has(name); k += 1) name = `${name.replace(/ \(\d+\)$/, "")} (${k})`;
      used.add(name);
      fords.push({ id: `ford-${fords.length}`, name, x: at.x, y: at.y, span, a: segment.fromNodeId, b: segment.toNodeId, bridged: false });
    }
  }
  const t = world.tuning;
  const now = world.economy.elapsedSeconds;
  const first = (t.floodFirstDayMin ?? 45) + (hash(fords.length, Math.round((fords[0]?.x ?? 0) * 10)) % 1000) / 1000 * ((t.floodFirstDayMax ?? 75) - (t.floodFirstDayMin ?? 45));
  const riseAt = world.startSeconds + first * D;
  world.floods = { fords, season: 0, phase: "dry", warnAt: riseAt - (t.floodWarnDays ?? 14) * D, riseAt, fallAt: riseAt + (t.floodDays ?? 20) * D, coming: [], under: [], flooded: new Set(), nextCheckAt: now };
}

/** The price of raising a bridge at a ford: its span, at the all-weather bridge's price a cell. */
export function fordBridgeCost(world: GameWorld, ford: Ford): number {
  return Math.round(Math.max(1, ford.span) * (world.tuning.fordBridgePerCell ?? 1200));
}

export function fordById(world: GameWorld, id: string): Ford | undefined {
  return world.floods?.fords.find((ford) => ford.id === id);
}

/** The road pieces at a ford: the old road's, wherever it's been split since. */
function piecesAt(world: GameWorld, ford: Ford): string[] {
  const out: string[] = [];
  for (const segment of world.simulation.map.segments) {
    if (segment.type !== "road" || segment.provenance !== "inherited" || segment.retiredAt !== undefined) continue;
    const line = segmentPolyline(world.simulation.map, segment);
    const near = line.some((p, k) => k > 0 && distToSegment(ford, line[k - 1]!, p) < 0.9);
    if (near) out.push(segment.id);
  }
  return out;
}
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Whether a road piece is under the flood now (congestion.ts slows it to floodSpeed). */
export function isFlooded(world: GameWorld, segmentId: string): boolean {
  return on(world) && world.floods!.flooded.has(segmentId);
}

const fordIndex = (ford: Ford) => Number(ford.id.slice("ford-".length));

/**
 * How much a ford's road matters: your vehicles over it first (a shock is one that lands on
 * your network), then all its traffic. Measured: by traffic alone the first rains took a tank
 * farm's road and a far town's, and the trunk ford three of your buses crossed stayed dry.
 */
function busy(world: GameWorld, ford: Ford): number {
  const pieces = new Set(piecesAt(world, ford));
  const ends = new Set(world.simulation.map.segments.filter((s) => pieces.has(s.id)).map((s) => `${s.fromNodeId}|${s.toNodeId}`));
  const crosses = (path: string[]) => path.some((node, k) => k > 0 && (ends.has(`${path[k - 1]}|${node}`) || ends.has(`${node}|${path[k - 1]}`)));
  const yours = world.simulation.vehicles.filter((v) => v.lifecycle !== "one-shot" && crosses(v.path)).length;
  const flow = [...pieces].reduce((sum, id) => sum + (world.roadFlowEMA.get(id) ?? 0), 0);
  return yours * 1000 + flow;
}

/** Each tick (tick.ts): the season's warning, its rising and its falling. Checked twice a game day. */
export function updateFloods(world: GameWorld): GameEvent[] {
  if (!on(world)) return [];
  const floods = world.floods!;
  const now = world.economy.elapsedSeconds;
  if (now < floods.nextCheckAt) return [];
  floods.nextCheckAt = now + D / 2;
  const t = world.tuning;
  const events: GameEvent[] = [];
  const named = (ids: string[]) => ids.map((id) => fordById(world, id)!).filter(Boolean).map((ford) => ({ id: ford.id, name: ford.name }));

  // Two weeks ahead: which fords this season takes -- the busiest unbridged one, and others drawn.
  if (floods.phase === "dry" && now >= floods.warnAt) {
    const open = floods.fords.filter((ford) => !ford.bridged);
    if (open.length === 0) {
      // Every ford bridged: the rains no longer close anything.
      floods.warnAt = floods.riseAt = floods.fallAt = Infinity;
      return events;
    }
    const score = new Map(open.map((ford) => [ford.id, busy(world, ford)]));
    const busiest = open.reduce((top, ford) => (score.get(ford.id)! > score.get(top.id)! ? ford : top));
    const rest = open.filter((ford) => ford !== busiest).sort((p, q) => hash(floods.season, fordIndex(p)) - hash(floods.season, fordIndex(q)));
    floods.coming = [busiest, ...rest].slice(0, Math.max(1, t.floodFordsPerSeason ?? 2)).map((ford) => ford.id);
    floods.phase = "warned";
    events.push({ kind: "flood-warning", fords: named(floods.coming), inDays: Math.max(1, Math.round((floods.riseAt - now) / D)), days: Math.round((floods.fallAt - floods.riseAt) / D) });
  }
  // The water rises over the fords still low.
  if (floods.phase === "warned" && now >= floods.riseAt) {
    floods.under = floods.coming.filter((id) => !fordById(world, id)?.bridged);
    floods.coming = [];
    floods.phase = "flood";
    if (floods.under.length > 0) events.push({ kind: "flood-rose", fords: named(floods.under), days: Math.round((floods.fallAt - now) / D) });
  }
  if (floods.phase === "flood" && now < floods.fallAt) {
    floods.flooded = new Set(floods.under.flatMap((id) => piecesAt(world, fordById(world, id)!)));
  }
  // And falls; the next rains drawn.
  if (floods.phase === "flood" && now >= floods.fallAt) {
    if (floods.under.length > 0) events.push({ kind: "flood-fell", fords: named(floods.under) });
    floods.under = [];
    floods.flooded = new Set();
    floods.phase = "dry";
    floods.season += 1;
    floods.riseAt += (t.floodEveryDays ?? 180) * D;
    floods.warnAt = floods.riseAt - (t.floodWarnDays ?? 14) * D;
    floods.fallAt = floods.riseAt + (t.floodDays ?? 20) * D;
  }
  return events;
}

/** The design console's "rains now" (term.ts consoleMove): this season's fords named at the next check. */
export function rainsNow(world: GameWorld): { ok: boolean; reason?: string } {
  if (!on(world)) return { ok: false, reason: "no fords in this game" };
  const floods = world.floods!;
  if (floods.phase !== "dry") return { ok: false, reason: "the rains are already here" };
  const now = world.economy.elapsedSeconds;
  const t = world.tuning;
  floods.riseAt = now + (t.floodWarnDays ?? 14) * D;
  floods.warnAt = now;
  floods.fallAt = floods.riseAt + (t.floodDays ?? 20) * D;
  floods.nextCheckAt = now;
  return { ok: true };
}

/** The `bridgeFord` action: an all-weather bridge at a ford. Under water now, the road opens. */
export function bridgeFord(world: GameWorld, fordId: string): ActionResult & { charged?: number } {
  if (!on(world)) return { ok: false, reason: "no fords in this game" };
  const ford = fordById(world, fordId);
  if (!ford) return { ok: false, reason: "no such ford" };
  if (ford.bridged) return { ok: false, reason: "it's bridged already" };
  const cost = fordBridgeCost(world, ford);
  if (!canAfford(world.economy, cost)) return { ok: false, reason: "can't afford the bridge" };
  world.economy.funds -= cost;
  ford.bridged = true;
  const floods = world.floods!;
  floods.coming = floods.coming.filter((id) => id !== fordId);
  if (floods.under.includes(fordId)) {
    floods.under = floods.under.filter((id) => id !== fordId);
    floods.flooded = new Set(floods.under.flatMap((id) => piecesAt(world, fordById(world, id)!)));
  }
  return { ok: true, charged: cost };
}
