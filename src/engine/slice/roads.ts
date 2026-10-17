import type { GeneratedMap, Segment, TerrainField } from "../map/types";
import { planCorridor } from "../pathing/plan";
import { BASE_COST_PER_CELL, BRIDGE_PREMIUM_PER_CELL, MAX_BRIDGE_SPAN, bridgeStepCost, stepCost, sumStepCosts, type CostBreakdown, type StepCost } from "../pathing/cost";
import { walkCellsAlongSegment } from "../pathing/supercover";
import { cellIndex, isWater } from "../pathing/terrainAStar";
import type { SliceWorld } from "./types";

// Roads over terrain (docs/principles.md §6, step 3). A road is planned and
// priced by engine/pathing -- the terrain A*, the water rule, and cost.ts --
// so the price you're quoted, the price you pay, and the road you get are
// one computation (architecture hard rule 3). What the slice adds is the
// exchange rate and the "why" (principles §1: a quote must break down as
// "bridge · hills", not just a bigger number).

export type Point = { x: number; y: number };

export interface RoadPlan {
  polyline: Point[];
  /** Travel length along the polyline, cells. Longer than the straight line when it bends. */
  length: number;
  /** What it costs, all in. */
  cost: number;
  /** The parts of `cost` worth naming. */
  hillsCost: number;
  bridgeCost: number;
  /** Cells of water crossed by bridge. */
  bridgeCells: number;
}

/**
 * pathing/cost.ts prices in its own units (BASE_COST_PER_CELL a flat
 * cell); the slice's money prices a flat cell at `roadCostPerCell`. One
 * exchange rate for every term, so the breakdown still sums to the total.
 */
export function costRate(world: SliceWorld): number {
  return exchangeRate(world);
}

function exchangeRate(world: SliceWorld): number {
  return world.tuning.roadCostPerCell / BASE_COST_PER_CELL;
}

export function polylineLength(points: Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return length;
}

/**
 * Splits a polyline at a distance along it, returning both halves; both
 * contain the split point. Used to found a town partway along a road.
 */
export function splitPolyline(points: Point[], at: number): [Point[], Point[]] {
  let travelled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const step = Math.hypot(b.x - a.x, b.y - a.y);
    if (travelled + step >= at && step > 0) {
      const t = (at - travelled) / step;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      return [[...points.slice(0, i), p], [p, ...points.slice(i)]];
    }
    travelled += step;
  }
  const last = points[points.length - 1]!;
  return [[...points], [last, last]];
}

/** Where a point a distance along a polyline lies. */
export function pointAlong(points: Point[], at: number): Point {
  return splitPolyline(points, at)[1][0]!;
}

/** A segment's corridor polyline, oriented from its fromNode to its toNode. */
export function segmentPolyline(map: GeneratedMap, segment: Segment): Point[] {
  const corridor = map.corridors.find((candidate) => candidate.id === segment.corridorId);
  if (corridor && corridor.polyline.length >= 2) return corridor.polyline;
  const a = map.nodes.find((node) => node.id === segment.fromNodeId)!;
  const b = map.nodes.find((node) => node.id === segment.toNodeId)!;
  return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
}

/** Travel length of a road segment: along its alignment, straight if it has none. */
export function segmentLength(world: SliceWorld, segment: Segment): number {
  return segment.length ?? polylineLength(segmentPolyline(world.simulation.map, segment));
}

/**
 * Plans the cheapest road between two towns over the terrain: it bends
 * round a ridge or to a narrower crossing when that costs less than going
 * through, and the bend is a longer trip. Null when no road can be built
 * -- the water is wider than a bridge can span (pathing/cost.ts
 * MAX_BRIDGE_SPAN). Cached per pair: terrain never changes, and new towns
 * bring new pairs rather than changing old ones.
 *
 * Only the cheapest alignment, for now. engine/pathing's "straight" mode
 * prices the supercover staircase of cells, not the line -- on flat ground
 * a straight Ilase-Owode quoted 943 against 382 for the same road -- so
 * "hold the line and pay for it" waits on pricing a line as a line.
 */
/**
 * "cheapest" bends round hills and to narrow crossings when that costs
 * less; "direct" holds the straight line and pays for what's on it -- the
 * climb, the bridge (principles §1: a mountain in the way is a real choice,
 * around or over).
 */
export type Alignment = "cheapest" | "direct";

export function planRoad(world: SliceWorld, a: string, b: string, alignment: Alignment = "cheapest"): RoadPlan | null {
  return planAlignment(world, a, b, world.simulation.map.terrain, exchangeRate(world), world.roadPlans, alignment);
}

// Sample spacing along a direct line, cells.
const DIRECT_SAMPLE = 0.5;

/**
 * Prices a straight line *as a line* (pathing/plan.ts's "straight" mode
 * prices the staircase of cells it touches: on flat ground a straight
 * Ilase-Owode quoted 943 against 382 for the same road). Water is found
 * with the supercover walk (principles §3: never by sampling, which misses
 * corner clips) and each crossing is one bridge, bank to bank, refused past
 * MAX_BRIDGE_SPAN. Ground between crossings is priced by stepping along the
 * true line through cost.ts's stepCost, so its length is the line's and its
 * climbs are the line's. Every term still comes from cost.ts (hard rule 3).
 */
export function planDirect(terrain: TerrainField, from: Point, to: Point): { breakdown: CostBreakdown; length: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const along = (x: number, y: number) => Math.max(0, Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / (length * length)));
  const at = (t: number) => ({ x: from.x + dx * t, y: from.y + dy * t });
  const index = (p: Point) => cellIndex(terrain, Math.round(p.x), Math.round(p.y));

  // Water crossings, as intervals of the line from the last dry cell before
  // to the first dry cell after.
  const crossings: Array<[number, number]> = [];
  let lastDry = 0;
  let wetSince: number | null = null;
  for (const cell of walkCellsAlongSegment(from.x, from.y, to.x, to.y)) {
    const t = along(cell.x, cell.y);
    if (isWater(terrain, cell.x, cell.y)) {
      wetSince ??= lastDry;
    } else {
      if (wetSince !== null) crossings.push([wetSince, t]);
      wetSince = null;
      lastDry = t;
    }
  }
  if (wetSince !== null) return null; // ends in water

  const steps: StepCost[] = [];
  const ground = (t0: number, t1: number) => {
    const n = Math.max(1, Math.ceil(((t1 - t0) * length) / DIRECT_SAMPLE));
    for (let i = 0; i < n; i += 1) {
      const p = at(t0 + ((t1 - t0) * i) / n);
      const q = at(t0 + ((t1 - t0) * (i + 1)) / n);
      steps.push(stepCost(terrain, index(p), index(q), ((t1 - t0) * length) / n));
    }
  };
  let t = 0;
  for (const [wetFrom, wetTo] of crossings) {
    if (wetFrom > t) ground(t, wetFrom);
    const span = Math.max(1, Math.round((wetTo - wetFrom) * length));
    if (span > MAX_BRIDGE_SPAN) return null;
    steps.push(bridgeStepCost(span));
    t = wetTo;
  }
  if (t < 1) ground(t, 1);
  // Both ends are towns; each bridge adds two bank nodes, as in planCorridor.
  return { breakdown: sumStepCosts(steps, crossings.length * 2), length };
}

/**
 * The one planner for anything laid over the terrain between two towns --
 * roads (planRoad) and track (rail.ts planRail) -- over a given terrain at
 * a given exchange rate onto pathing/cost.ts, cached in `cache` per pair.
 */
export function planAlignment(
  world: SliceWorld,
  a: string,
  b: string,
  terrain: TerrainField,
  rate: number,
  cache: Map<string, RoadPlan | null>,
  alignment: Alignment = "cheapest",
): RoadPlan | null {
  const key = `${a}:${b}:${alignment}`;
  if (cache.has(key)) return cache.get(key)!;
  const townA = world.towns.get(a);
  const townB = world.towns.get(b);
  let plan: RoadPlan | null = null;
  if (townA && townB && alignment === "direct") {
    const direct = planDirect(terrain, { x: townA.x, y: townA.y }, { x: townB.x, y: townB.y });
    if (direct) plan = toPlan([{ x: townA.x, y: townA.y }, { x: townB.x, y: townB.y }], direct.breakdown, rate);
  } else if (townA && townB) {
    const from = { x: Math.round(townA.x), y: Math.round(townA.y) };
    const to = { x: Math.round(townB.x), y: Math.round(townB.y) };
    // Both ends are existing towns: only bridge banks are new nodes.
    const corridor = planCorridor(terrain, [from, to], "auto", new Set([0, 1]));
    if (corridor) {
      // The grid plans between whole cells; the road starts and ends at
      // the towns themselves (a roadside town can sit between cells).
      const polyline = corridor.polyline.map((p) => ({ x: p.x, y: p.y }));
      polyline[0] = { x: townA.x, y: townA.y };
      polyline[polyline.length - 1] = { x: townB.x, y: townB.y };
      plan = toPlan(polyline, corridor.breakdown, rate);
    }
    // "Cheapest" is the cheaper of the bend and the straight line: the grid
    // search prices its own path on grid steps (diagonals up to ~8% over),
    // so where nothing's in the way the line itself is cheaper -- measured,
    // Ado-Ikole 450 straight against 472 searched.
    const direct = planAlignment(world, a, b, terrain, rate, cache, "direct");
    if (direct && (!plan || direct.cost <= plan.cost)) plan = direct;
  }
  cache.set(key, plan);
  return plan;
}

function toPlan(polyline: Point[], breakdown: CostBreakdown, rate: number): RoadPlan {
  // A bridge's own deck is base cost too; name the whole crossing.
  const bridgeCells = breakdown.water / BRIDGE_PREMIUM_PER_CELL;
  return {
    polyline,
    length: polylineLength(polyline),
    cost: Math.round(breakdown.total * rate),
    hillsCost: Math.round(breakdown.gradient * rate),
    bridgeCost: Math.round((breakdown.water + bridgeCells * BASE_COST_PER_CELL + breakdown.nodes) * rate),
    bridgeCells: Math.round(bridgeCells),
  };
}

/** Which cells of a polyline sample lie over water -- where the map draws a bridge deck. */
export function overWater(world: SliceWorld, p: Point): boolean {
  const { terrain } = world.simulation.map;
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) return false;
  return terrain.water[y * terrain.width + x] === 1;
}
