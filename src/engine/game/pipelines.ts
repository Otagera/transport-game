import type { GameWorld } from "./types";
import type { GameEvent } from "./settlement";
import { SECONDS_PER_GAME_DAY as D, canAfford } from "../economy/state";
import { goodsFlows, relayKey, flowKey } from "./goods";
import { roadPath, type ActionResult } from "./world";
import { segmentPolyline, polylineLength, type Point } from "./roads";
import { haulCostFrom, haulDistance } from "./haulage";
import { pipeDrift, pipeMoves } from "./union";

// Pipelines (docs/brief.md, Decisions log, 2026-11-03, five modes scoped: the pipeline first).
// A fixed link that carries refined fuel from a fuel source -- the tank farm, a refinery -- to a
// town, and nothing else: no vehicles, enormous to build, almost free to run. The only thing in the
// game that takes traffic off your roads instead of adding room to them.
//
//   - It carries up to a cap (pipeCapPerDay). Above the cap the rest still goes by tanker, so the
//     fuel chain stays alive: quieter, not solved.
//   - You set what share of its flow goes by pipe (the dial, in tenths); the rest by tanker. The
//     fuel bound for the town at its end is delivered there; fuel bound past it waits there and
//     hauliers take it on (haulage.ts), as it would off a freight train.
//   - The union's temperature follows the dial, not the build (union.ts pipeMoves): every tonne
//     through the pipe is a tonne of work taken off its tanker drivers. Raising the dial brings a
//     demand; refused or ignored, they strike and the pipe stops.
//   - The trap: the hauliers working its corridor follow the work (`tankers`, 0..1 of a full
//     fleet): run everything through the pipe and they drift away over a few weeks; when a strike
//     or a tap stops it, the fuel falls back on tankers that aren't there, and come back as slowly.
//     The one mechanic whose right answer may be to run something inefficiently on purpose.
//   - Taps (illegal tapping, vandalism): now and then a pipe is broken into and shut for repair --
//     a long pipe more, one not kept up three times as often. Losses on the way: 2% kept up,
//     rising to 10% as it's neglected.
//   - Brownfield: one inherited products line, broken, from the tank farm up the old railway to
//     the town at its end -- where the colonial economy wanted fuel, not necessarily where you do.
//     Restoring it is cheaper than laying new.
//
// Plain data on the world (world.pipelines), changed here and by the pipe actions, so a run file
// replays it. Behind `pipelinesEnabled`; absent in runs played before it.

export interface Pipeline {
  id: string;
  /** The fuel source it leaves: the tank farm, a refinery. */
  a: string;
  /** The town it reaches. */
  b: string;
  /** Its line, map cells, a to b: beside the road, or up the old railway (the inherited one). */
  line: Point[];
  cells: number;
  inherited: boolean;
  /** Broken (the inherited line until restored). */
  working: boolean;
  /** The share of its flow sent by pipe, 0..1 in tenths. */
  dial: number;
  /** Kept up (its upkeep paid): else its condition falls, and losses and taps rise. */
  kept: boolean;
  condition: number;
  /** Shut until (economy seconds): a strike or a tap; 0 when running. */
  outUntil: number;
  outReason: "strike" | "tap" | null;
  /** The hauliers on its corridor, as a share of a fleet for its whole flow: they follow the work. */
  tankers: number;
  /** Rolling, tonnes a second: through it, lost on the way, and what it could have taken. */
  carried: number;
  lost: number;
  wanted: number;
  /** The last game day checked for a tap. */
  tapDay: number;
}

const FUEL_SOURCES = new Set(["depot", "refinery", "newrefinery"]);
const on = (world: GameWorld) => !!world.tuning.pipelinesEnabled && !!world.tuning.fuelEnabled && !!world.tuning.goodsEnabled;
const nameOf = (world: GameWorld, id: string) => world.towns.get(id)?.name ?? id;
const dayOf = (world: GameWorld) => Math.floor((world.economy.elapsedSeconds - world.startSeconds) / D) + 1;
export const pipeId = (a: string, b: string) => `pipe:${a}~${b}`;

export function pipelinesOn(world: GameWorld): boolean {
  return on(world) && !!world.pipelines;
}

/** Whether a place can be a pipeline's source: the tank farm or a refinery. */
export function isPipeSource(world: GameWorld, id: string): boolean {
  return FUEL_SOURCES.has(world.towns.get(id)?.industry ?? "");
}

/** Running now: built or restored, not shut. */
export function pipeRunning(world: GameWorld, p: Pipeline): boolean {
  return p.working && p.outUntil <= world.economy.elapsedSeconds;
}

/** A road route's line, cells, from a to b: a new pipe is laid beside the road. */
function lineAlongRoad(world: GameWorld, a: string, b: string): Point[] | null {
  const path = roadPath(world, a, b);
  if (!path) return null;
  const map = world.simulation.map;
  const line: Point[] = [];
  path.segmentIds.forEach((id, i) => {
    const segment = map.segments.find((s) => s.id === id);
    if (!segment) return;
    const pts = segmentPolyline(map, segment);
    const piece = segment.fromNodeId === path.nodeIds[i] ? pts : [...pts].reverse();
    line.push(...(line.length ? piece.slice(1) : piece));
  });
  return line.length >= 2 ? line : null;
}

/** What a new pipe a to b would cost, and its line; null with why not. */
export function pipePlan(world: GameWorld, a: string, b: string): { line: Point[]; cells: number; price: number } | { reason: string } {
  if (!on(world)) return { reason: "pipelines are off" };
  if (!isPipeSource(world, a)) return { reason: "a pipeline starts at the tank farm or a refinery" };
  const town = world.towns.get(b);
  if (!town || town.industry) return { reason: "a pipeline ends at a town" };
  if ((world.pipelines ?? []).some((p) => p.a === a && p.b === b)) return { reason: "there's a pipeline there already" };
  const line = lineAlongRoad(world, a, b);
  if (!line) return { reason: "no road to lay it beside" };
  const cells = polylineLength(line);
  return { line, cells, price: Math.round(cells * (world.tuning.pipeCostPerCell ?? 2000)) };
}

export function checkPipe(world: GameWorld, a: string, b: string): ActionResult & { amount?: number } {
  const plan = pipePlan(world, a, b);
  if ("reason" in plan) return { ok: false, reason: plan.reason };
  if (!canAfford(world.economy, plan.price)) return { ok: false, reason: `it costs ₦${plan.price.toLocaleString()}` };
  return { ok: true, amount: plan.price };
}

function newPipe(id: string, a: string, b: string, line: Point[], cells: number, inherited: boolean, working: boolean): Pipeline {
  return { id, a, b, line, cells, inherited, working, dial: 0, kept: true, condition: 1, outUntil: 0, outReason: null, tankers: 1, carried: 0, lost: 0, wanted: 0, tapDay: 0 };
}

/** A new pipe, its dial at nothing: building it costs money; using it -- the dial -- costs you the chairman. */
export function buildPipe(world: GameWorld, a: string, b: string): ActionResult & { amount?: number } {
  const check = checkPipe(world, a, b);
  if (!check.ok) return check;
  const plan = pipePlan(world, a, b) as { line: Point[]; cells: number; price: number };
  world.economy.funds -= plan.price;
  (world.pipelines ??= []).push(newPipe(pipeId(a, b), a, b, plan.line, plan.cells, false, true));
  world.plans = null; // fuel's reach changed (fuelFlows)
  return { ok: true, amount: plan.price };
}

export function restorePipeCost(world: GameWorld, p: Pipeline): number {
  return Math.round(p.cells * (world.tuning.pipeRestorePerCell ?? 700));
}

export function restorePipe(world: GameWorld, id: string): ActionResult & { amount?: number } {
  const p = world.pipelines?.find((x) => x.id === id);
  if (!p) return { ok: false, reason: "no such pipeline" };
  if (p.working) return { ok: false, reason: "it's running" };
  const price = restorePipeCost(world, p);
  if (!canAfford(world.economy, price)) return { ok: false, reason: `it costs ₦${price.toLocaleString()}` };
  world.economy.funds -= price;
  p.working = true;
  p.condition = 1;
  p.dial = 0;
  world.plans = null;
  return { ok: true, amount: price };
}

/** Turn the dial (tenths, 0..1). The union hears of every tenth (union.ts pipeMoves). */
export function setPipeDial(world: GameWorld, id: string, dial: number): ActionResult {
  const p = world.pipelines?.find((x) => x.id === id);
  if (!p) return { ok: false, reason: "no such pipeline" };
  if (!p.working) return { ok: false, reason: "it's broken: restore it first" };
  const next = Math.max(0, Math.min(1, Math.round(dial * 10) / 10));
  if (next === p.dial) return { ok: false, reason: "it's there already" };
  const before = p.dial;
  p.dial = next;
  pipeMoves(world, p, before, next);
  return { ok: true };
}

export function setPipeKept(world: GameWorld, id: string, kept: boolean): ActionResult {
  const p = world.pipelines?.find((x) => x.id === id);
  if (!p) return { ok: false, reason: "no such pipeline" };
  if (p.kept === kept) return { ok: false, reason: kept ? "it's kept up already" : "it's not kept up already" };
  p.kept = kept;
  return { ok: true };
}

/**
 * Whether a working pipe from `site` brings its fuel within tankers' reach of `town` (fuel.ts
 * fuelFlows): the town at its end, or one hauliers reach from there. The road distance from its
 * end, for the order fuel fills in; null where it doesn't.
 */
export function pipeReach(world: GameWorld, site: string, town: string): number | null {
  if (!pipelinesOn(world)) return null;
  let best: number | null = null;
  for (const p of world.pipelines!) {
    // At nothing on the dial it changes nothing: not even where fuel is sent.
    if (p.a !== site || !p.working || p.dial <= 0) continue;
    const d = p.b === town ? 0 : haulDistance(world, p.b, town);
    if (Number.isFinite(d) && d <= world.tuning.tankerMaxHaulCells && (best === null || d < best)) best = d;
  }
  return best;
}

/**
 * Whether fuel at its source bound for `to` goes this pipe's way: to its town, or on from there
 * where hauliers get it to `to` quicker from the pipe's end than tankers from the source (its
 * legs from a town are short, a tanker's from a fuel site long: map 8703, a pipe to the port city
 * beside the tank farm took every town's fuel and left it waiting for 40-cell legs -- supplied
 * fell from 74% to 58%).
 */
export function pipeServes(world: GameWorld, p: Pipeline, to: string): boolean {
  if (to === p.b) return true;
  const fromEnd = haulCostFrom(world, p.b, to);
  return Number.isFinite(fromEnd) && fromEnd < haulCostFrom(world, p.a, to);
}

/**
 * How keen hauliers are on fuel at `from` bound for `to` (truckers.ts): 1, unless a pipe serves
 * it. There, the fleet on its corridor against the work left to it -- enough for what the pipe
 * leaves them, too few the day it stops.
 */
export function tankerFactor(world: GameWorld, from: string, to: string): number {
  if (!pipelinesOn(world)) return 1;
  for (const p of world.pipelines!) {
    if (p.a !== from || !p.working || !pipeServes(world, p, to)) continue;
    const left = pipeRunning(world, p) ? 1 - share(p) : 1;
    return Math.min(1, p.tankers / Math.max(0.05, left));
  }
  return 1;
}

/** The share of what it could take that it takes: the dial, or less where the cap bites. */
function share(p: Pipeline): number {
  return p.wanted > 1e-9 ? Math.min(1, p.carried / p.wanted) : p.dial;
}

/**
 * Every tick, after the goods arrive at their yards and before the hauliers pick up (tick.ts):
 * each running pipe takes its share of the fuel waiting at its source for the towns it serves,
 * up to its cap; delivers what's for its own town (counted yours, `delivered`), and leaves what's
 * bound beyond waiting there for hauliers. Then its hauliers follow the work, its condition its
 * upkeep, and the union the tonnes; and now and then a tap.
 */
export function runPipelines(world: GameWorld, dt: number, delivered: Map<string, number>): GameEvent[] {
  if (!pipelinesOn(world)) return [];
  const t = world.tuning;
  const events: GameEvent[] = [];
  const now = world.economy.elapsedSeconds;
  const alpha = 1 - Math.exp(-dt / t.outcomeTauSeconds);
  const flows = goodsFlows(world);
  for (const p of world.pipelines!) {
    // Back from a strike or a tap.
    if (p.outReason && now >= p.outUntil) {
      events.push({ kind: "pipe-back", pipe: p.id, a: p.a, b: p.b, reason: p.outReason });
      p.outReason = null;
      p.outUntil = 0;
    }
    let carried = 0, lost = 0, wanted = 0;
    if (pipeRunning(world, p) && p.dial > 0) {
      const yard = world.goods.yards.get(p.a);
      const mine = flows.filter((f) => f.from === p.a && f.kind === "supplies" && pipeServes(world, p, f.to));
      wanted = mine.reduce((sum, f) => sum + f.rate, 0);
      const cap = (t.pipeCapPerDay ?? 250) / D;
      const rate = Math.min(cap, p.dial * wanted);
      const lossShare = (t.pipeLossKept ?? 0.02) + ((t.pipeLossNeglected ?? 0.1) - (t.pipeLossKept ?? 0.02)) * (1 - p.condition);
      for (const f of mine) {
        if (!yard || wanted <= 0) break;
        const key = `${f.to}|supplies`;
        const waiting = yard.get(key) ?? 0;
        const take = Math.min(waiting, rate * dt * (f.rate / wanted));
        if (take <= 0) continue;
        yard.set(key, waiting - take);
        const arrive = take * (1 - lossShare);
        carried += take / dt;
        lost += (take - arrive) / dt;
        if (f.to === p.b) {
          const k = flowKey({ from: p.a, to: p.b, kind: "supplies" });
          delivered.set(k, (delivered.get(k) ?? 0) + arrive);
        } else {
          // Bound beyond: it waits at the pipe's end for hauliers (haulage.ts), as off a train.
          const relay = (world.goods.relay ??= new Map());
          if (!relay.has(p.b)) relay.set(p.b, new Map());
          const waits = relay.get(p.b)!;
          const rk = relayKey(f.to, "supplies", p.a);
          waits.set(rk, (waits.get(rk) ?? 0) + arrive);
        }
      }
    }
    p.carried += (carried - p.carried) * alpha;
    p.lost += (lost - p.lost) * alpha;
    p.wanted += (wanted - p.wanted) * alpha;
    // Its hauliers follow the work left to them, over weeks; a few always stay.
    const left = pipeRunning(world, p) ? 1 - share(p) : 1;
    const target = Math.max(t.pipeTankerFloor ?? 0.15, left);
    p.tankers += (target - p.tankers) * (1 - Math.exp(-dt / ((t.pipeTankerDays ?? 20) * D)));
    // Kept up, it mends; neglected, it falls to nothing in pipeNeglectDays.
    if (p.working) p.condition = p.kept ? p.condition + (1 - p.condition) * (1 - Math.exp(-dt / (20 * D))) : Math.max(0, p.condition - dt / ((t.pipeNeglectDays ?? 60) * D));
    // A tap, checked once a game day while it runs: a long pipe more often, a neglected one three times.
    const day = dayOf(world);
    if (pipeRunning(world, p) && p.dial > 0 && day !== p.tapDay) {
      p.tapDay = day;
      const chance = (t.pipeTapPer100Cells ?? 0.01) * (p.cells / 100) * (p.kept ? 1 : 3);
      if (unit(`${p.id}|${day}`) < chance) {
        const days = t.pipeTapDays ?? 5;
        p.outUntil = now + days * D;
        p.outReason = "tap";
        events.push({ kind: "pipe-out", pipe: p.id, a: p.a, b: p.b, reason: "tap", days });
      }
    }
  }
  pipeDrift(world, dt, events);
  return events;
}

/** Upkeep a tick, ₦: each working pipe kept up (tick.ts adds it to the roads'). */
export function pipeUpkeep(world: GameWorld, dt: number): number {
  if (!pipelinesOn(world)) return 0;
  const perDay = world.tuning.pipeUpkeepPerDay ?? 400;
  return world.pipelines!.filter((p) => p.working && p.kept).length * (perDay * dt) / D;
}

/** A refused or ignored pipeline demand (union.ts): its tanker drivers walk out, and the pipe stops with them. */
export function strikePipe(world: GameWorld, a: string, b: string): GameEvent | null {
  const p = world.pipelines?.find((x) => x.a === a && x.b === b);
  if (!p || !p.working) return null;
  const days = world.tuning.pipeStrikeDays ?? 7;
  p.outUntil = Math.max(p.outUntil, world.economy.elapsedSeconds + days * D);
  p.outReason = "strike";
  return { kind: "pipe-out", pipe: p.id, a: p.a, b: p.b, reason: "strike", days };
}

/** A deterministic draw in [0, 1) from a key: the same tap on the same day, however the frames fall. */
function unit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * At the start (start.ts), after the fuel sites: the inherited products line, broken, from the
 * tank farm to the port town and up the old railway to the town at its end. None where there's
 * no old railway.
 */
export function placeInheritedPipe(world: GameWorld): void {
  if (!on(world) || world.pipelines || !world.fuel || !world.port) return;
  world.pipelines = [];
  const old = world.simulation.map.segments.filter((s) => s.type === "rail" && world.railOutOfService.has(s.id));
  if (!old.length) return;
  // The old line's ends: where it touches one piece. It starts near the port (rarely at it), and
  // the pipe runs from the tank farm to that end and up the line to the other.
  const degree = new Map<string, number>();
  for (const s of old) for (const n of [s.fromNodeId, s.toNodeId]) degree.set(n, (degree.get(n) ?? 0) + 1);
  const port = world.towns.get(world.port)!;
  const ends = [...degree].filter(([, d]) => d === 1).map(([n]) => n).filter((n) => world.towns.has(n) && !world.towns.get(n)!.industry);
  if (ends.length < 2) return;
  ends.sort((x, y) => dist(world, x, port) - dist(world, y, port));
  const start = ends[0]!, far = ends[ends.length - 1]!;
  const line: Point[] = [];
  const depot = world.towns.get(world.fuel.depotId)!;
  line.push({ x: depot.x, y: depot.y });
  let at = start;
  const used = new Set<string>();
  for (let hop = 0; hop < old.length && at !== far; hop += 1) {
    const piece = old.find((s) => !used.has(s.id) && (s.fromNodeId === at || s.toNodeId === at));
    if (!piece) return;
    used.add(piece.id);
    const pts = segmentPolyline(world.simulation.map, piece);
    line.push(...(piece.fromNodeId === at ? pts : [...pts].reverse()));
    at = piece.fromNodeId === at ? piece.toNodeId : piece.fromNodeId;
  }
  if (at !== far) return;
  world.pipelines.push(newPipe(pipeId(world.fuel.depotId, far), world.fuel.depotId, far, line, polylineLength(line), true, false));
}

function dist(world: GameWorld, id: string, to: { x: number; y: number }): number {
  const t = world.towns.get(id);
  return t ? Math.hypot(t.x - to.x, t.y - to.y) : Infinity;
}

/** What fuel a new pipe a to b would find going its way now, tonnes a second (the build tool's preview). */
export function pipeWouldCarry(world: GameWorld, a: string, b: string): number {
  const probe = { a, b } as Pipeline;
  return goodsFlows(world).filter((f) => f.from === a && f.kind === "supplies" && pipeServes(world, probe, f.to)).reduce((sum, f) => sum + f.rate, 0);
}

/** The pipelines for the screen: each with what it does now. */
export function pipeSummaries(world: GameWorld) {
  if (!pipelinesOn(world)) return [];
  const now = world.economy.elapsedSeconds;
  return world.pipelines!.map((p) => ({
    ...p,
    name: `${nameOf(world, p.a)} – ${nameOf(world, p.b)}`,
    running: pipeRunning(world, p),
    perDay: p.carried * D,
    lostPerDay: p.lost * D,
    wantedPerDay: p.wanted * D,
    capPerDay: world.tuning.pipeCapPerDay ?? 250,
    lossShare: (world.tuning.pipeLossKept ?? 0.02) + ((world.tuning.pipeLossNeglected ?? 0.1) - (world.tuning.pipeLossKept ?? 0.02)) * (1 - p.condition),
    backInDays: p.outReason ? Math.max(0, Math.ceil((p.outUntil - now) / D)) : 0,
    restoreCost: p.working ? 0 : restorePipeCost(world, p),
  }));
}
