import type { GameWorld } from "./types";
import type { Point, RoadPlan } from "./roads";
import { MAX_BRIDGE_SPAN } from "../pathing/cost";
import { isWater } from "../pathing/terrainAStar";
import { homeBox, addSite, nearestDistance } from "./fuel";
import { inheritedRoad, cementActive } from "./cement";

// Named crossings, and the way a road goes (docs/brief.md, Revision 5, step 6: "Each big river
// has four or five named crossing points: a ford, a narrows, a dear bridge beside a town";
// "Straight-or-round comes back, but only at rivers and ridges"; "Minerals sit in the hills").
//
// The designer's review: the geography was scenery with a price on it, not a decision -- the
// pathfinder laid every road the cheapest way, and the choice of straight or round was off. Now:
//
//   - Each river's crossing points have names: its **narrows** (where it's narrowest: a short,
//     cheap bridge, usually off the straight line) and a **crossing beside a town** (on the line
//     a road would take, but wide: a dear bridge). The fords (floods.ts) are the third kind.
//   - Drawing a road or track, you choose the way where a river or a ridge makes it a choice:
//     the cheapest, or straight across (over the ridge, or the wider water) -- shorter, dearer.
//     Each priced by the one planner (roads.ts planAlignment): the quote is the road you get.
//   - The hill range between two clusters holds a limestone field on its heights: a quarry that
//     never works out, for your cement works -- over the ridge, or round it.
//
// Off, and absent, in runs played before it (no crossingsEnabled / ridgeFieldEnabled).

export interface Crossing {
  id: string;
  name: string;
  kind: "narrows" | "town";
  /** The river's middle there, and its two banks (dry cells), map cells. */
  x: number;
  y: number;
  banks: [Point, Point];
  /** Water between the banks, cells. */
  span: number;
}

export type Way = "cheapest" | "direct";

const MIN_GAP = 18; // cells between two named crossings on a river

/** The rivers worth naming crossings on: not the sea (drawn as a very wide river off the map's edge). */
function rivers(world: GameWorld) {
  return (world.waterLines ?? []).filter((river) => Math.max(river.width, ...(river.widths ?? [])) < 9);
}

/** From the middle of the river at `p`, along `n`, to the first dry cell. */
function bank(world: GameWorld, p: Point, n: Point): Point | null {
  const { terrain } = world.simulation.map;
  for (let s = 0.5; s <= MAX_BRIDGE_SPAN; s += 0.5) {
    const x = Math.round(p.x + n.x * s), y = Math.round(p.y + n.y * s);
    if (x < 1 || y < 1 || x >= terrain.width - 1 || y >= terrain.height - 1) return null;
    if (!isWater(terrain, x, y)) return { x, y };
  }
  return null;
}

/** At a new game's start (start.ts): each river's narrows and its crossings beside towns. */
export function placeCrossings(world: GameWorld): void {
  if (!world.tuning.crossingsEnabled) return;
  const out: Crossing[] = [];
  const names = new Set<string>();
  const people = [...world.towns.values()].filter((t) => !t.industry);
  const nearest = (p: Point) => people.reduce((best, t) => (Math.hypot(t.x - p.x, t.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y) ? t : best));
  const fords = world.floods?.fords ?? [];
  rivers(world).forEach((river) => {
    // The river sampled a cell at a time: where, which way it runs, how wide.
    const samples: Array<{ p: Point; t: Point; w: number }> = [];
    for (let k = 1; k < river.points.length; k += 1) {
      const [ax, ay] = river.points[k - 1]!, [bx, by] = river.points[k]!;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const wa = river.widths?.[k - 1] ?? river.width, wb = river.widths?.[k] ?? river.width;
      for (let s = 0; s < len; s += 1) samples.push({ p: { x: ax + ((bx - ax) * s) / len, y: ay + ((by - ay) * s) / len }, t: { x: (bx - ax) / len, y: (by - ay) / len }, w: wa + ((wb - wa) * s) / len });
    }
    const taken: Point[] = [];
    const free = (p: Point) => taken.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= MIN_GAP) && fords.every((f) => Math.hypot(f.x - p.x, f.y - p.y) >= 8);
    const add = (kind: Crossing["kind"], at: { p: Point; t: Point }, name: string): boolean => {
      const n = { x: -at.t.y, y: at.t.x };
      const one = bank(world, at.p, n), two = bank(world, at.p, { x: -n.x, y: -n.y });
      if (!one || !two) return false;
      const span = Math.hypot(one.x - two.x, one.y - two.y) - 1;
      if (span > MAX_BRIDGE_SPAN - 1 || span < 1) return false;
      for (let k = 2; names.has(name); k += 1) name = `${name.replace(/ \(\d+\)$/, "")} (${k})`;
      names.add(name);
      taken.push(at.p);
      out.push({ id: `crossing-${out.length}`, name, kind, x: at.p.x, y: at.p.y, banks: [one, two], span: Math.round(span) });
      return true;
    };
    // Its narrows: the narrowest places, at most two.
    let narrows = 0;
    for (const s of [...samples].filter((s) => s.w <= 1.8).sort((p, q) => p.w - q.w)) {
      if (narrows >= 2) break;
      if (!free(s.p) || Math.hypot(nearest(s.p).x - s.p.x, nearest(s.p).y - s.p.y) > 45) continue;
      if (add("narrows", s, `${nearest(s.p).name} narrows`)) narrows += 1;
    }
    // Beside its towns: where a town of some size stands near the river, the biggest first.
    let beside = 0;
    for (const town of [...people].filter((t) => t.population >= 15).sort((p, q) => q.population - p.population)) {
      if (beside >= 2) break;
      const s = samples.reduce<{ p: Point; t: Point; w: number } | null>((best, s) => (!best || Math.hypot(s.p.x - town.x, s.p.y - town.y) < Math.hypot(best.p.x - town.x, best.p.y - town.y) ? s : best), null);
      if (!s || Math.hypot(s.p.x - town.x, s.p.y - town.y) > 9 || !free(s.p)) continue;
      if (add("town", s, `${town.name} crossing`)) beside += 1;
    }
  });
  world.crossings = out;
}

/**
 * The ways a road (or track) from a to b can go, cheapest first: straight across when a river
 * or a ridge makes it a different road (not where the land's open: there the cheapest is the
 * line). Only a real choice: a way the other beats on both price and length isn't offered.
 *
 * Not "by a named crossing" too: tried, and measured over 136 unjoined pairs on three maps, one
 * such way was ever worth offering (₦50 dearer for the same length) -- the planner already takes
 * the best crossing, and a bridge (₦40 a cell of water) barely costs more than the land.
 */
export function waysFor(world: GameWorld, plan: (way: Way) => RoadPlan | null): Way[] {
  const ways: Way[] = ["cheapest"];
  if (!world.tuning.crossingsEnabled && !world.tuning.straightAlignmentEnabled) return ways;
  const cheapest = plan("cheapest");
  const direct = plan("direct");
  const obstacle = (p: RoadPlan | null) => !!p && (p.bridgeCells > 0 || p.hillsCost > 0);
  if (world.tuning.straightAlignmentEnabled || (direct && cheapest && (obstacle(direct) || obstacle(cheapest)) && Math.abs(direct.cost - cheapest.cost) >= 1)) ways.push("direct");
  const plans = new Map(ways.map((way) => [way, plan(way)!]));
  const beaten = (way: Way) => {
    const p = plans.get(way)!;
    return ways.some((other) => other !== way && plans.get(other)!.cost <= p.cost && plans.get(other)!.length <= p.length - 0.5);
  };
  return ways.filter((way) => way === "cheapest" || !beaten(way));
}

/** A way, in words. */
export function wayName(way: Way): string {
  return way === "cheapest" ? "the cheapest way" : "straight across";
}

/**
 * At a new game's start, after the other sites (start.ts): a limestone field on the hill range
 * between two clusters, on its heights, with an old track up to it from the nearest town. Its
 * limestone is for your works; over the ridge or round it is your choice.
 */
export function placeRidgeField(world: GameWorld): void {
  if (!world.tuning.ridgeFieldEnabled || !world.tuning.industriesEnabled || !cementActive(world) || world.towns.has("ridge-field")) return;
  const { terrain } = world.simulation.map;
  const box = homeBox(world);
  let best: { x: number; y: number; e: number } | null = null;
  for (let y = 4; y < terrain.height - 4; y += 1) {
    for (let x = 4; x < terrain.width - 4; x += 1) {
      if (x >= box.x - 4 && x < box.x + box.width + 4 && y >= box.y - 4 && y < box.y + box.height + 4) continue;
      const e = terrain.elevation[y * terrain.width + x]!;
      if (best && e <= best.e) continue;
      let wet = false;
      for (let dy = -2; dy <= 2 && !wet; dy += 1) for (let dx = -2; dx <= 2 && !wet; dx += 1) wet = isWater(terrain, x + dx, y + dy);
      if (wet || nearestDistance(world, x, y) < 8) continue;
      best = { x, y, e };
    }
  }
  if (!best || best.e < 1) return; // no range on this map
  const town = [...world.towns.values()].filter((t) => !t.industry).sort((p, q) => Math.hypot(p.x - best!.x, p.y - best!.y) - Math.hypot(q.x - best!.x, q.y - best!.y))[0]!;
  addSite(world, "ridge-field", `${town.name} Hills Limestone`, "quarry", best);
  inheritedRoad(world, "ridge-field-road", "ridge-field", town.id);
  world.industries.set("ridge-field", { id: "ridge-field", kind: "quarry", openedAtSeconds: world.economy.elapsedSeconds, closesAtSeconds: Infinity, deliveredEMA: 0, field: true });
}
