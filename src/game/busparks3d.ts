// A town's bus park in 3D (view3d.ts), laid out from your routes (your word, 2026-11-04: "a bus
// park like the rail stations"): where a road route of yours ends at a town, a motor park beside
// the town's heart -- its own lane in from the town's junction, a drive round an island under a
// canopy, a bay at the island's edge for each route ending there, that route's riders waiting at
// it. No three.js here: the layout, and the way a bus goes through it.
//
// The game's buses have no park: a route's buses run to the town's point and straight back, and
// load the moment they get there (vehicle.ts, no dwell). Drawn as it ran, a bus drove into the
// middle of the town, jumped across the road and spun round there. Drawn here, it comes off the
// road down the park's lane, round the island to its bay, stands there a moment, and goes back out
// the way it came -- a little faster than on the road either side, to make up the time.
//
// Positions are map cells, as the map's; lengths metres (M a cell), as the 3D view's. A park's own
// frame (metres): `s` along its island (across the lane), `o` out from the town along the lane.

import type { GameWorld } from "@engine/game/types";
import { segmentPolyline, type Point } from "@engine/game/roads";

const M = 8;
/**
 * A park's measures, metres: the drive round the island (its radius at the ends, its distance
 * from the island's centre line along the sides), the island's half-width, the paving's
 * half-depth, a bay's length (a bus, drawn, is 19 m), the lane's width, and how far right of its
 * line a bus keeps on the lane (view3d.ts KEEP_RIGHT).
 */
export const BUS_PARK = { drive: 8, island: 4.2, pave: 13, bay: 22, lane: 8, keep: 2.4 };
/** At most this many bays, two a side; more routes share them. */
const BAYS = 4;

export interface BusPark {
  /** The town (or the site: a lorry park before its gate, the airport's bus park before its terminal). */
  id: string;
  /** A bus park (a town's, the airport's) or a lorry park (a site's): what it's drawn as. */
  kind: "bus" | "lorry";
  /**
   * Your bus station built here (the other session's busstations.ts; brief, Your bus station): the
   * park drawn as the station -- its terminal and concourse, its depot behind -- on more ground.
   */
  station: boolean;
  /** What it was laid from: a change lays it again (and the town round it builds anew). */
  key: string;
  node: Point;
  /** The way from the town's point out along its lane (radians, map frame). */
  axis: number;
  /** From the town's point to the park's mouth, metres. */
  gap: number;
  /** The island's straight sides, metres: a bay a side, or two. */
  straight: number;
  /** The island's centre (cells). */
  centre: Point;
  /** Each route ending here, its bay: where along the island (s), which side (o: + far, - near), metres. */
  bays: Map<string, { s: number; o: number }>;
  /** Every bay it has, in that frame: a haulier's lorry takes one by its number. */
  spots: Array<{ s: number; o: number }>;
}

/** A park's own frame (metres) to the map (cells). */
export function parkPoint(park: BusPark, s: number, o: number): Point {
  const ca = Math.cos(park.axis), sa = Math.sin(park.axis);
  return { x: park.centre.x + (-sa * s + ca * o) / M, y: park.centre.y + (ca * s + sa * o) / M };
}

/** The towns where a road route of yours ends, each with its routes -- and the airport (its park before its terminal); no other site. */
export function parkEnds(world: GameWorld): Map<string, string[]> {
  const ends = new Map<string, string[]>();
  for (const route of world.routes) {
    const v = route.vehicleIds[0];
    if (!v || world.railVehicles.has(v)) continue;
    for (const id of [route.a, route.b]) {
      const t = world.towns.get(id);
      if (!t || (t.industry && t.industry !== "airport")) continue;
      (ends.get(id) ?? ends.set(id, []).get(id)!).push(route.id);
    }
  }
  return ends;
}

/**
 * Each route end's park: turned whichever of 24 ways keeps it off the roads into the town and off
 * what's `blocked` (water, yards, stations, other parks), `gap` metres out from the town's point --
 * further where a roundabout stands there (`ringed`).
 */
export function layBusParks(
  world: GameWorld,
  roads: Point[][],
  blocked: (x: number, y: number) => boolean,
  ringed: (id: string) => boolean,
  ringOuter: number,
  /**
   * The sites' parks, whose way out their yard has set (view3d.ts siteKit: the gate toward the
   * point, the park between): each laid that way, once it is, whether or not a route of yours ends
   * there -- the hauliers come anyway. The airport's is a bus park; the rest, lorry parks.
   */
  fixed: Map<string, number> = new Map(),
  /** The towns with your bus station: each has its park, a route of yours ending there or not. */
  stations: ReadonlySet<string> = new Set(),
): Map<string, BusPark> {
  const out = new Map<string, BusPark>();
  const laid: BusPark[] = [];
  const { positions } = world.simulation.routing;
  const ends = parkEnds(world);
  // Your road freight's lorries end at sites too: their bays as a bus route's.
  for (const route of world.lorryRoutes) {
    const v = route.vehicleIds[0];
    if (!v || world.railVehicles.has(v)) continue;
    for (const id of [route.a, route.b]) if (fixed.has(id)) (ends.get(id) ?? ends.set(id, []).get(id)!).push(route.id);
  }
  for (const id of fixed.keys()) if (!ends.has(id)) ends.set(id, []);
  for (const id of stations) if (!ends.has(id) && world.towns.get(id) && !world.towns.get(id)!.industry) ends.set(id, []);
  // The sites' first (their ground is set), then the towns'.
  const order = [...ends].sort(([a], [b]) => (fixed.has(a) !== fixed.has(b) ? (fixed.has(a) ? -1 : 1) : a < b ? -1 : 1));
  for (const [id, routes] of order) {
    const town = world.towns.get(id)!;
    if (town.industry && !fixed.has(id)) continue;
    const kind: BusPark["kind"] = town.industry && town.industry !== "airport" ? "lorry" : "bus";
    const station = kind === "bus" && !town.industry && stations.has(id);
    const node = positions.get(id) ?? { x: town.x, y: town.y };
    routes.sort();
    const straight = routes.length > 1 || town.industry || station ? BUS_PARK.bay * 2 : BUS_PARK.bay;
    const gap = ringed(id) ? ringOuter + 10 : 12;
    // The roads into the town, each by the way it leaves the point: the park's lane between them.
    const arms: number[] = [];
    for (const s of world.simulation.map.segments) {
      if (s.type !== "road" || s.retiredAt !== undefined || (s.fromNodeId !== id && s.toNodeId !== id)) continue;
      const line = segmentPolyline(world.simulation.map, s);
      const from = s.fromNodeId === id ? line : [...line].reverse();
      const p = pointAlong(from, 2.5);
      arms.push(Math.atan2(p.y - node.y, p.x - node.x));
    }
    const near = roads.filter((line) => line.some((p) => Math.hypot(p.x - node.x, p.y - node.y) < 20));
    const roadNear = (x: number, y: number, clear: number) => near.some((line) => line.some((p, k) => k > 0 && distToSegment(x, y, line[k - 1]!, p) < clear));
    let best: { axis: number; score: number } | null = fixed.has(id) ? { axis: fixed.get(id)!, score: 0 } : null;
    for (let k = 0; k < (fixed.has(id) ? 0 : 24); k += 1) {
      const axis = (k / 24) * Math.PI * 2;
      const trial: BusPark = { id, kind, station, key: "", node, axis, gap, straight, centre: { x: 0, y: 0 }, bays: new Map(), spots: [] };
      trial.centre = { x: node.x + (Math.cos(axis) * (gap + BUS_PARK.pave)) / M, y: node.y + (Math.sin(axis) * (gap + BUS_PARK.pave)) / M };
      let score = 0;
      // Its ground, sampled every 4 m (a station's, its terminal and depot too).
      const ground = groundOf(trial);
      for (let s = -ground.half; s <= ground.half; s += 4) for (let o = -BUS_PARK.pave; o <= ground.back; o += 4) {
        const p = parkPoint(trial, s, o);
        if (blocked(p.x, p.y)) score += 10;
        else if (roadNear(p.x, p.y, 5 / M)) score += 8;
        if (laid.some((other) => inPark(other, p, 4))) score += 20;
      }
      // Its lane, past the junction.
      for (let o = -BUS_PARK.pave - gap + 8; o < -BUS_PARK.pave; o += 3) {
        const p = parkPoint(trial, 0, o);
        if (blocked(p.x, p.y)) score += 6;
      }
      // Between the roads, not along one.
      for (const a of arms) {
        const off = Math.abs(Math.atan2(Math.sin(axis - a), Math.cos(axis - a)));
        if (off < 0.7) score += 40 * (0.7 - off);
      }
      if (!best || score < best.score - 1e-9) best = { axis, score };
    }
    if (!best) continue;
    const park: BusPark = { id, kind, station, key: "", node, axis: best.axis, gap, straight, centre: { x: 0, y: 0 }, bays: new Map(), spots: [] };
    park.centre = { x: node.x + (Math.cos(best.axis) * (gap + BUS_PARK.pave)) / M, y: node.y + (Math.sin(best.axis) * (gap + BUS_PARK.pave)) / M };
    // Bays: the far side first, then the near (either side of the lane's mouth).
    const spots = straight > BUS_PARK.bay
      ? [{ s: -BUS_PARK.bay / 2, o: 1 }, { s: BUS_PARK.bay / 2, o: 1 }, { s: -BUS_PARK.bay / 2 - 2, o: -1 }, { s: BUS_PARK.bay / 2 + 2, o: -1 }]
      : [{ s: 0, o: 1 }];
    park.spots = spots.map((spot) => ({ s: spot.s, o: spot.o * BUS_PARK.drive }));
    routes.forEach((r, i) => park.bays.set(r, park.spots[i % Math.min(BAYS, park.spots.length)]!));
    park.key = `${kind}${station ? "+station" : ""}|${best.axis.toFixed(3)}|${gap}|${routes.join(",")}`;
    out.set(id, park);
    laid.push(park);
  }
  return out;
}

/**
 * The ground a site's park will stand on, its yard set (view3d.ts siteKit): out from its point the
 * way its yard lies, a park of four bays -- what the next site placed keeps off.
 */
export function siteParkGround(id: string, node: Point, axis: number): BusPark {
  const gap = 12, straight = BUS_PARK.bay * 2;
  return {
    id, kind: "lorry", station: false, key: "", node, axis, gap, straight, bays: new Map(), spots: [],
    centre: { x: node.x + (Math.cos(axis) * (gap + BUS_PARK.pave)) / M, y: node.y + (Math.sin(axis) * (gap + BUS_PARK.pave)) / M },
  };
}

/**
 * A park's ground in its frame (metres): `half` along its island either way, `back` out beyond it
 * -- a station's further, its terminal at one end and its depot behind (STATION).
 */
export function groundOf(park: BusPark): { half: number; back: number } {
  const half = park.straight / 2 + BUS_PARK.pave;
  return park.station ? { half: half + STATION.terminal, back: BUS_PARK.pave + STATION.depot } : { half, back: BUS_PARK.pave };
}
/** A station's more ground (metres): its terminal beyond the island's end, its depot yard behind the park. */
export const STATION = { terminal: 22, depot: 28 };

/** Whether a point (cells) is on a park's ground or its lane, `pad` metres round. */
export function inPark(park: BusPark, p: Point, pad: number): boolean {
  const dx = (p.x - park.centre.x) * M, dy = (p.y - park.centre.y) * M;
  const ca = Math.cos(park.axis), sa = Math.sin(park.axis);
  const o = dx * ca + dy * sa, s = -dx * sa + dy * ca;
  const ground = groundOf(park);
  if (Math.abs(s) < ground.half + pad && o > -BUS_PARK.pave - pad && o < ground.back + pad) return true;
  return Math.abs(s) < BUS_PARK.lane / 2 + pad && o < 0 && o > -BUS_PARK.pave - park.gap - pad;
}

/**
 * A bus's way through the park, in the park's frame (metres): up the lane on its right from
 * `from` metres out of the town's point to the mouth, onto the near side turning right, round the
 * island keeping it on the left, along the far side (and its bays), round, back along the near
 * side, out of the mouth and down the lane to `from` again on the other side. Its corners eased.
 */
export function parkDrive(park: BusPark, from: number): Array<{ s: number; o: number }> {
  const R = BUS_PARK.drive, L = park.straight / 2, k = BUS_PARK.keep, mouth = -BUS_PARK.pave, start = -BUS_PARK.pave - park.gap + from;
  const way: Array<{ s: number; o: number }> = [];
  for (let o = start; o < -R; o += 1.5) way.push({ s: k, o });
  for (let s = k; s < L; s += 1.5) way.push({ s, o: -R });
  for (let i = 0; i <= 16; i += 1) { const t = (i / 16) * Math.PI; way.push({ s: L + R * Math.sin(t), o: -R * Math.cos(t) }); }
  for (let s = L - 1.5; s > -L; s -= 1.5) way.push({ s, o: R });
  for (let i = 0; i <= 16; i += 1) { const t = (i / 16) * Math.PI; way.push({ s: -L - R * Math.sin(t), o: R * Math.cos(t) }); }
  for (let s = -L + 1.5; s < -k; s += 1.5) way.push({ s, o: -R });
  for (let o = -R; o > start; o -= 1.5) way.push({ s: -k, o });
  way.push({ s: -k, o: start });
  void mouth;
  return ease(way, 3);
}

/** Corners cut, `rounds` times over (Chaikin): the ends stay. */
function ease(points: Array<{ s: number; o: number }>, rounds: number): Array<{ s: number; o: number }> {
  let pts = points;
  for (let r = 0; r < rounds; r += 1) {
    const next = [pts[0]!];
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const a = pts[i]!, b = pts[i + 1]!;
      next.push({ s: a.s * 0.75 + b.s * 0.25, o: a.o * 0.75 + b.o * 0.25 }, { s: a.s * 0.25 + b.s * 0.75, o: a.o * 0.25 + b.o * 0.75 });
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts;
}

function pointAlong(line: Point[], d: number): Point {
  let left = d;
  for (let k = 1; k < line.length; k += 1) {
    const a = line[k - 1]!, b = line[k]!, step = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= step) return { x: a.x + ((b.x - a.x) * left) / (step || 1), y: a.y + ((b.y - a.y) * left) / (step || 1) };
    left -= step;
  }
  return line[line.length - 1]!;
}
function distToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
}
