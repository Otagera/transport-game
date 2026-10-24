import type { GameHillDef, GameMapDef, GameRiverDef, GameRoadDef, GameTown } from "./types";
import type { TerrainField } from "../map/types";
import { createRng, type Rng } from "../map/random";
import { UnionFind } from "../map/connectivity";
import { planCorridor } from "../pathing/plan";
import { buildGameTerrain } from "./terrain";
import {
  EDGE_MARGIN,
  MIN_SPACING,
  NAMES,
  REGION_NAMES,
  ROAD_CLEARANCE,
  WATER_CLEARANCE,
  between,
  crosses,
  distance,
  generatedMapInfo,
  shuffle,
  toSegment,
  townId,
  type GeneratedMapInfo,
  type Point,
} from "./generate";

// The region (docs/brief.md, The region): the full game's map. The slice's map
// "felt like a metropolitan area" -- every town a bus ride from every other, and
// the end game came early -- so the region keeps the same cell and the same
// prices per cell and adds distance: clusters of towns, far apart.
//
//   - The home cluster is the seed's slice map, exactly (generate.ts), placed
//     against the region's west or east edge. You start there and the camera
//     frames it, so it reads like the map you know (C21), and the ladder's
//     prices, guarded on its trunk, land as measured.
//   - Three more clusters across the rest of the region, each a regional
//     town and a handful round it, 60+ cells apart: inside one, the game you
//     know; between them, long roads -- the work of highways, coaches and rail.
//   - A coastline along one edge, all the way down: the home city's own sea
//     when the seed put it on the coast, else the far edge, with the port in
//     the cluster on it -- imports then come from the far side of the region.
//   - The home river runs on, top to bottom; one or two more rivers cross the
//     region; a range of hills between two clusters.
//   - The inherited network: each cluster's roads (a few towns left cut off),
//     and old highways joining the clusters -- straight, dirt, built for
//     another age -- and an old railway from the home city to another cluster.
//
// The rest of the region is drawn from a stream of its own, so the home
// cluster is the seed's slice map whatever the region draws round it. Guards
// as generate.ts's: towns clear of water and of each other, roads clear of
// towns and each other, and every town reachable by building roads.
//
// Seed 0 stays the hand-made map, alone.

/** Cells: about 2.5 times the slice map each way. */
export const REGION_WIDTH = 250;
export const REGION_HEIGHT = 160;
/** The home cluster's box: the slice map's size. */
const HOME_WIDTH = 100;
const HOME_HEIGHT = 64;
/** Clusters beyond the home one. */
const CLUSTERS = 3;
/** A cluster's towns sit within this of its regional town, cells. */
const CLUSTER_RADIUS = 20;
/** Towns in a cluster, its regional town included (fewer when the names run out, never under MIN_CLUSTER). */
const CLUSTER_TOWNS = 6;
const MIN_CLUSTER = 4;
/** Cluster centres at least this far apart, and this far from the home box, cells. */
const CLUSTER_GAP = 62;
const HOME_GAP = 40;
/** The regional towns, thousands: all well under the home city (100k+), so it stays dominant. */
const HUB_SIZES = [70, 55, 45];
/** The rest of a cluster's towns, thousands (log-uniform between). */
const SMALL_TOWN: [number, number] = [8, 26];
/** How deep the sea comes in from the coast edge, cells. */
const SEA_DEPTH: [number, number] = [4, 7];
/** Draws of the region round the home cluster before giving up on the region (never seen in tests). */
const MAX_DRAWS = 300;

export interface RegionInfo {
  map: GameMapDef;
  /** The seed's slice map, which is the home cluster. */
  home: GeneratedMapInfo;
  /** Each cluster's regional town, the home city first. */
  hubs: string[];
  /** Where imports land from the sea: the home city on a coast, else the coast cluster's regional town (the home city is then a dry port). */
  seaport: string;
  /** How many draws the guards rejected. */
  rejected: number;
}

/** The map a game is played on: the region when its tuning says so, else the seed's slice map. */
export function gameMap(base: GameMapDef, seed: number, tuning: { regionEnabled?: boolean }): GameMapDef {
  return tuning.regionEnabled ? regionMap(base, seed) : generatedMapInfo(base, seed).map;
}

export function regionMap(base: GameMapDef, seed: number): GameMapDef {
  return regionInfo(base, seed).map;
}

export function regionInfo(base: GameMapDef, seed: number): RegionInfo {
  const home = generatedMapInfo(base, seed);
  if (seed === 0) return { map: home.map, home, hubs: [home.trunk[0]], seaport: home.map.port!, rejected: 0 };
  const rng = createRng(seed + 3_000_017);
  for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
    const result = drawRegion(rng, home);
    if (result) return { ...result, home, rejected: draw };
  }
  return { map: home.map, home, hubs: [home.trunk[0]], seaport: home.map.port!, rejected: MAX_DRAWS };
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * Clear of the water by `clearance`, each river as wide as the terrain draws it
 * at that point (generate.ts's isDryAround takes a river's widest, which on a
 * coast that comes and goes would hold towns far off the shore).
 */
function dryOf(water: GameRiverDef[], p: Point, clearance: number): boolean {
  for (const river of water) {
    for (let k = 1; k < river.points.length; k += 1) {
      const [ax, ay] = river.points[k - 1]!;
      const [bx, by] = river.points[k]!;
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / lengthSq));
      const width = river.widths ? river.widths[k - 1]! + (river.widths[k]! - river.widths[k - 1]!) * t : river.width;
      if (Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy)) <= width / 2 + clearance) return false;
    }
  }
  return true;
}

/** A polyline's value along its run: x at row y (`across` false) or y at column x (true), between its points. */
function along(points: Array<[number, number]>, at: number, across: boolean): number {
  const [u, v] = across ? [0, 1] : [1, 0];
  const sorted = [...points].sort((a, b) => a[u]! - b[u]!);
  if (at <= sorted[0]![u]!) return sorted[0]![v]!;
  for (let k = 1; k < sorted.length; k += 1) {
    const a = sorted[k - 1]!;
    const b = sorted[k]!;
    if (at <= b[u]!) return a[v]! + ((b[v]! - a[v]!) * (at - a[u]!)) / (b[u]! - a[u]! || 1);
  }
  return sorted[sorted.length - 1]![v]!;
}

/**
 * The sea along the west or east edge, drawn as a very wide river off the
 * edge: its coast wanders 3-14 cells in, row by row, so the shore has bays
 * and headlands. A coast home city's own sea is kept as the slice map drew it
 * where the home box is.
 */
function drawCoast(rng: Rng, side: -1 | 1, depth: number, keep?: GameRiverDef): GameRiverDef {
  const offMap = 8;
  const edgeX = side < 0 ? -offMap : REGION_WIDTH - 1 + offMap;
  const out = keep ? keep.points.map((p, i) => ({ p, w: keep.widths?.[i] ?? keep.width })) : [];
  const top = out.length > 0 ? Math.min(...out.map((o) => o.p[1])) - 8 : Infinity;
  const bottom = out.length > 0 ? Math.max(...out.map((o) => o.p[1])) + 8 : -Infinity;
  let d = depth;
  for (let y = -2; y <= REGION_HEIGHT + 2; y += 10) {
    if (y >= top && y <= bottom) continue;
    d = Math.max(3, Math.min(14, d + between(rng, -3.5, 3.5)));
    out.push({ p: [Math.round(edgeX + side * between(rng, -1, 1)), y], w: 2 * (offMap + d) });
  }
  out.sort((a, b) => a.p[1] - b.p[1]);
  return { points: out.map((o) => o.p), width: 2 * (offMap + depth), widths: out.map((o) => o.w) };
}

/** The coast's line at row y: the first dry column in from the sea's edge. */
function coastAt(coast: GameRiverDef, side: -1 | 1, y: number): number {
  const centre = along(coast.points, y, false);
  const width = along(coast.points.map(([, py], i): [number, number] => [coast.widths?.[i] ?? coast.width, py]), y, false);
  return centre - (side * width) / 2;
}

/**
 * The big river (the Niger, the Benue): in from the region's inland edge,
 * meandering across to the sea, beside the home box rather than through it
 * (the home map's water is its own), widening as it goes, with two fords.
 */
function drawMainRiver(rng: Rng, seaSide: -1 | 1, coast: GameRiverDef, box: Box): GameRiverDef {
  const above: [number, number] = [12, box.y - 12];
  const below: [number, number] = [box.y + box.height + 12, REGION_HEIGHT - 12];
  const band = above[1] - above[0] >= below[1] - below[0] ? above : below;
  const nearBox = (x: number) => x >= box.x - 28 && x <= box.x + box.width + 28;
  const points: Array<[number, number]> = [];
  let y = between(rng, band[0], band[1]);
  for (let x = seaSide < 0 ? REGION_WIDTH + 2 : -2; ; x += seaSide * 14) {
    y = Math.max(10, Math.min(REGION_HEIGHT - 10, y + between(rng, -9, 9)));
    if (nearBox(x)) y = Math.max(band[0], Math.min(band[1], y));
    const shore = coastAt(coast, seaSide, y);
    if (seaSide < 0 ? x <= shore : x >= shore) {
      points.push([Math.round(Math.max(0, Math.min(REGION_WIDTH - 1, shore + seaSide * 6))), Math.round(y)]);
      break;
    }
    points.push([Math.round(x), Math.round(y)]);
  }
  const widths = points.map((_, i) => 2.5 + (3 * i) / Math.max(1, points.length - 1));
  for (const k of shuffle(rng, points.map((_, i) => i).slice(1, -2)).slice(0, 2)) widths[k] = 1.2;
  return { points, width: 4, widths };
}

/** A river's run from one point to another: a meander every ~10 cells, `from` to `to` wide. */
function meander(rng: Rng, a: Point, b: Point, from: number, to: number): GameRiverDef {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(2, Math.round(length / 10));
  const [nx, ny] = [-(b.y - a.y) / (length || 1), (b.x - a.x) / (length || 1)];
  const points: Array<[number, number]> = [];
  const widths: number[] = [];
  let off = 0;
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    off = k === 0 || k === steps ? 0 : Math.max(-6, Math.min(6, off + between(rng, -3, 3)));
    points.push([Math.round(a.x + (b.x - a.x) * t + nx * off), Math.round(a.y + (b.y - a.y) * t + ny * off)]);
    widths.push(from + (to - from) * t);
  }
  return { points, width: to, widths };
}

/** Water cells a line from a to b passes over, sampled four times a cell. */
function wetAlong(terrain: TerrainField, a: Point, b: Point): number {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4));
  let wet = 0;
  for (let k = 0; k <= steps; k += 1) {
    const x = Math.round(a.x + ((b.x - a.x) * k) / steps);
    const y = Math.round(a.y + ((b.y - a.y) * k) / steps);
    if (terrain.water[y * terrain.width + x] === 1) wet += 1;
  }
  return wet;
}

/**
 * A planned road's line with the grid's kinks taken out (A* steps in eight
 * directions, so a long road zigzags every few cells; playtest, 2026-10-23,
 * "see this road"): points within ROAD_STRAIGHTEN cells of a straighter line
 * are dropped, unless the straighter line would cross more water than the
 * road did -- it still crosses where it was planned to.
 */
const ROAD_STRAIGHTEN = 2.5;
function straightened(terrain: TerrainField, line: Point[]): Point[] {
  if (line.length <= 2) return line;
  const a = line[0]!;
  const b = line[line.length - 1]!;
  let far = 0;
  let at = 1;
  for (let k = 1; k < line.length - 1; k += 1) {
    const d = toSegment(line[k]!, a, b);
    if (d > far) [far, at] = [d, k];
  }
  let wetBefore = 0;
  for (let k = 1; k < line.length; k += 1) wetBefore += wetAlong(terrain, line[k - 1]!, line[k]!);
  if (far <= ROAD_STRAIGHTEN && wetAlong(terrain, a, b) <= wetBefore) return [a, b];
  return [...straightened(terrain, line.slice(0, at + 1)), ...straightened(terrain, line.slice(at)).slice(1)];
}

/** Distance from a point to a box (0 inside it). */
function toBox(p: Point, box: { x: number; y: number; width: number; height: number }): number {
  const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.width));
  const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.height));
  return Math.hypot(dx, dy);
}

function drawRegion(rng: Rng, home: GeneratedMapInfo): Omit<RegionInfo, "home" | "rejected"> | null {
  const W = REGION_WIDTH;
  const H = REGION_HEIGHT;
  const homeRivers = home.map.terrain?.rivers ?? [];
  // A coast city's sea is the second water: the region's coast is on its side.
  const homeSea = home.setting === "coast" ? homeRivers[1] : undefined;
  const homeSide: -1 | 1 = homeSea ? (homeSea.points[0]![0] < 0 ? -1 : 1) : rng() < 0.5 ? -1 : 1;
  const seaSide: -1 | 1 = homeSea ? homeSide : (-homeSide as -1 | 1);
  const ox = homeSide < 0 ? 0 : W - HOME_WIDTH;
  const oy = Math.round(between(rng, 0, H - HOME_HEIGHT));
  const homeBox = { x: ox, y: oy, width: HOME_WIDTH, height: HOME_HEIGHT };

  // The home cluster, moved into place.
  const towns: GameTown[] = home.map.towns.map((t) => ({ ...t, x: t.x + ox, y: t.y + oy }));
  const roads: GameRoadDef[] = home.map.roads.map((r) => ({ ...r }));
  const rails: GameRoadDef[] = (home.map.rails ?? []).map((r) => ({ ...r }));
  const hills: GameHillDef[] = (home.map.terrain?.hills ?? []).map((h) => ({ ...h, x: h.x + ox, y: h.y + oy }));
  // The water drains: the sea along one edge, its coast wandering; the big river in
  // from the inland edge and out to it; the home river joining the big river at one
  // end and rising just past the home box at the other; a tributary or two.
  const shift = (r: GameRiverDef): GameRiverDef => ({ ...r, points: r.points.map(([x, y]): [number, number] => [x + ox, y + oy]) });
  const seaDepth = Math.round(between(rng, ...SEA_DEPTH));
  const coast = drawCoast(rng, seaSide, seaDepth, homeSea ? shift(homeSea) : undefined);
  const main = drawMainRiver(rng, seaSide, coast, { x: ox, y: oy, width: HOME_WIDTH, height: HOME_HEIGHT });
  const water: GameRiverDef[] = [coast, main];
  const mainAt = (x: number) => along(main.points, x, true);
  for (const r of homeRivers.filter((r) => r !== homeSea)) {
    const run = shift(r);
    const widths = run.widths ?? run.points.map(() => run.width);
    const mouthAtBottom = mainAt(run.points[0]![0]) > oy;
    const [mouth, source] = mouthAtBottom ? [run.points.length - 1, 0] : [0, run.points.length - 1];
    const end = run.points[mouth]!;
    const join = meander(rng, { x: end[0], y: end[1] }, { x: end[0] + Math.round(between(rng, -6, 6)), y: Math.round(mainAt(end[0])) }, widths[mouth]!, widths[mouth]! + 0.5);
    const rise = run.points[source]!;
    const spring: [number, number] = [rise[0] + Math.round(between(rng, -3, 3)), rise[1] + (mouthAtBottom ? -10 : 10)];
    const onwards = join.points.slice(1);
    const points = mouthAtBottom ? [spring, ...run.points, ...onwards] : [...onwards.reverse(), ...run.points, spring];
    const joinWidths = join.widths!.slice(1);
    const allWidths = mouthAtBottom ? [1, ...widths, ...joinWidths] : [...joinWidths.reverse(), ...widths, 1];
    water.push({ ...run, points, widths: allWidths });
  }
  // One or two more rivers, in the region beyond the home box.
  const far = homeSide < 0 ? [HOME_WIDTH + 20, W - 40] : [40, W - HOME_WIDTH - 20];
  const extra = rng() < 0.5 ? 1 : 2;
  for (let k = 0, tries = 0; k < extra && tries < 60; tries += 1) {
    const s = { x: Math.round(between(rng, far[0]!, far[1]!)), y: Math.round(between(rng, 12, H - 12)) };
    const into = Math.round(Math.max(4, Math.min(W - 5, s.x + seaSide * between(rng, 5, 25))));
    const t = { x: into, y: Math.round(mainAt(into)) };
    if (Math.abs(s.y - t.y) < 35 || Math.abs(s.x - coastAt(coast, seaSide, s.y)) < 40) continue;
    const trib = meander(rng, s, t, 1.4, 3);
    if (trib.points.some(([x, y]) => toBox({ x, y }, homeBox) < 8)) continue;
    trib.widths![1 + Math.floor(rng() * (trib.points.length - 2))] = 1.2;
    water.push(trib);
    k += 1;
  }

  const at = (id: string) => towns.find((t) => t.id === id)!;
  const inBounds = (p: Point) => p.x >= EDGE_MARGIN && p.x <= W - 1 - EDGE_MARGIN && p.y >= EDGE_MARGIN && p.y <= H - 1 - EDGE_MARGIN;
  const dry = (p: Point) => dryOf(water, p, WATER_CLEARANCE);
  const spaced = (p: Point, others: Point[]) => others.every((q) => distance(p, q) >= MIN_SPACING);

  // Names: the rest of the home map's region's list, none the home cluster uses.
  const used = new Set(towns.map((t) => t.name));
  const list = home.region === "southwest" ? NAMES : REGION_NAMES[home.region];
  const names = shuffle(rng, list.filter((n) => !used.has(n)));
  const perCluster = Math.max(MIN_CLUSTER, Math.min(CLUSTER_TOWNS, Math.floor(names.length / CLUSTERS)));

  // Cluster centres, each its regional town. When the home city isn't on the coast,
  // the first cluster is on it, and its regional town is the port.
  // Each the best of a few spots that fit, the one farthest from the home box and the
  // clusters already placed, so they spread over the region instead of bunching and
  // leaving a quarter of it empty.
  const centres: Point[] = [];
  const room = (p: Point) => Math.min(toBox(p, homeBox) + CLUSTER_GAP - HOME_GAP, ...centres.map((c) => distance(c, p)));
  for (let attempt = 0; attempt < 3000 && centres.length < CLUSTERS; ) {
    const port = !homeSea && centres.length === 0;
    let best: Point | null = null;
    for (let fits = 0; fits < 12 && attempt < 3000; attempt += 1) {
      const p = port
        ? ((y) => ({ x: Math.round(coastAt(coast, seaSide, y) - seaSide * between(rng, 6, 9)), y }))(Math.round(between(rng, 20, H - 20)))
        : { x: Math.round(between(rng, 20, W - 21)), y: Math.round(between(rng, 18, H - 19)) };
      if (!inBounds(p) || !dry(p) || toBox(p, homeBox) < HOME_GAP || centres.some((c) => distance(c, p) < CLUSTER_GAP)) continue;
      if (port && dryOf(water, p, WATER_CLEARANCE + 6)) continue; // a port is by the sea
      fits += 1;
      if (!best || room(p) > room(best)) best = p;
    }
    if (best) centres.push(best);
  }
  if (centres.length < CLUSTERS) return null;

  // Each cluster's towns, by spacing round its regional town.
  const hubSizes = shuffle(rng, HUB_SIZES);
  const clusters: GameTown[][] = [];
  let next = 0;
  for (let c = 0; c < CLUSTERS; c += 1) {
    const centre = centres[c]!;
    const spots: Point[] = [centre];
    for (let attempt = 0; attempt < 2000 && spots.length < perCluster; attempt += 1) {
      const angle = rng() * Math.PI * 2;
      const r = between(rng, MIN_SPACING, CLUSTER_RADIUS);
      const p = { x: Math.round(centre.x + Math.cos(angle) * r), y: Math.round(centre.y + Math.sin(angle) * r) };
      if (!inBounds(p) || !dry(p) || !spaced(p, [...towns, ...spots]) || toBox(p, homeBox) < HOME_GAP / 2) continue;
      spots.push(p);
    }
    if (spots.length < MIN_CLUSTER || next + spots.length > names.length) return null;
    const cluster = spots.map((p, i): GameTown => {
      const name = names[next++]!;
      const population = i === 0 ? hubSizes[c]! : Math.round(Math.exp(between(rng, Math.log(SMALL_TOWN[0]), Math.log(SMALL_TOWN[1]))));
      return { id: townId(name), name, x: p.x, y: p.y, population };
    });
    towns.push(...cluster);
    clusters.push(cluster);
  }
  if (new Set(towns.map((t) => t.id)).size !== towns.length) return null;

  const clearOfTowns = (a: GameTown, b: GameTown) => towns.every((t) => t === a || t === b || toSegment(t, a, b) >= ROAD_CLEARANCE);
  const clearOfRoads = (a: GameTown, b: GameTown) => roads.every((r) => !crosses(a, b, at(r.a), at(r.b)));

  // Each cluster's inherited roads: Prim's way from its regional town; one town left cut off.
  for (const cluster of clusters) {
    const cutOff = cluster[1 + Math.floor(rng() * (cluster.length - 1))]!;
    const joined = new Set<GameTown>([cluster[0]!]);
    for (;;) {
      let best: [GameTown, GameTown, number] | null = null;
      for (const t of cluster) {
        if (joined.has(t) || t === cutOff) continue;
        for (const j of joined) {
          if (!clearOfTowns(t, j) || !clearOfRoads(t, j)) continue;
          const d = distance(t, j);
          if (!best || d < best[2]) best = [t, j, d];
        }
      }
      if (!best) break;
      roads.push({ a: best[0].id, b: best[1].id });
      joined.add(best[0]);
    }
    if (cluster.some((t) => t !== cutOff && !joined.has(t))) return null;
  }

  // Old highways joining the clusters: a spanning tree over the clusters (home included),
  // shortest first, each between two towns already on their cluster's roads.
  const hubs = clusters.map((c) => c[0]!);
  const groupOf = new Map<string, string>();
  for (const t of towns.slice(0, home.map.towns.length)) groupOf.set(t.id, "home");
  clusters.forEach((c, k) => c.forEach((t) => groupOf.set(t.id, `c${k}`)));
  const onRoads = towns.filter((t) => roads.some((r) => r.a === t.id || r.b === t.id) || hubs.includes(t));
  const groups = new UnionFind(["home", ...clusters.map((_, k) => `c${k}`)]);
  const candidates: Array<{ a: GameTown; b: GameTown; d: number }> = [];
  for (let i = 0; i < onRoads.length; i += 1) for (let j = i + 1; j < onRoads.length; j += 1) {
    if (groupOf.get(onRoads[i]!.id) !== groupOf.get(onRoads[j]!.id)) candidates.push({ a: onRoads[i]!, b: onRoads[j]!, d: distance(onRoads[i]!, onRoads[j]!) });
  }
  candidates.sort((x, y) => x.d - y.d);
  for (const c of candidates) {
    const [ga, gb] = [groupOf.get(c.a.id)!, groupOf.get(c.b.id)!];
    if (groups.connected(ga, gb) || !clearOfTowns(c.a, c.b) || !clearOfRoads(c.a, c.b)) continue;
    roads.push({ a: c.a.id, b: c.b.id });
    groups.union(ga, gb);
  }
  if (groups.componentCount() !== 1) return null;

  // The port the chains use is the home city's, as on the slice map: on the coast a
  // seaport, inland a dry port (Kaduna's, Ibadan's), its imports landing at the
  // seaport -- the coast cluster's regional town -- and coming up the old railway.
  const port = home.map.port!;
  const seaport = homeSea ? port : hubs[0]!.id;

  // The old railway on: from the home city to the port's cluster (imports by rail), else
  // to the nearest regional town; straight, and through no town.
  const city = at(home.trunk[0]);
  const railTo = (homeSea ? [...hubs].sort((a, b) => distance(city, a) - distance(city, b)) : [hubs[0]!, ...hubs.slice(1)])
    .find((h) => towns.every((t) => t === city || t === h || toSegment(t, city, h) >= 2.5));
  if (railTo) rails.push({ a: city.id, b: railTo.id });

  // A range of hills between two clusters, clear of every town.
  const pairs = shuffle(rng, [[homeBox.x + HOME_WIDTH / 2, homeBox.y + HOME_HEIGHT / 2], ...centres.map((c) => [c.x, c.y])].flatMap((a, i, all) => all.slice(i + 1).map((b) => [a, b] as const)));
  for (const [a, b] of pairs) {
    // A range, not a row of knolls: hills overlapping along a bowed spine across the
    // line between the two, highest in the middle, tapering at the ends.
    const range: GameHillDef[] = [];
    const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) || 1;
    const [ux, uy] = [(b[0]! - a[0]!) / len, (b[1]! - a[1]!) / len];
    const [mx, my] = [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
    const span = Math.min(70, len * 0.9);
    const bow = between(rng, -10, 10);
    const tilt = between(rng, -0.35, 0.35);
    const count = Math.round(span / 6);
    for (let k = 0; k <= count; k += 1) {
      const t = k / count - 0.5;
      // Across the line between the clusters (so a road or track between them meets it), tilted a little.
      const along = t * span;
      const off = bow * (1 - 4 * t * t) + between(rng, -1.5, 1.5);
      const [dx, dy] = [-uy + ux * tilt, ux + uy * tilt];
      const peak = Math.cos(Math.PI * t);
      range.push({
        x: Math.round(mx + dx * along + ux * off),
        y: Math.round(my + dy * along + uy * off),
        radius: Math.round(between(rng, 5, 7) + 3 * peak),
        height: Math.round((2.2 + 2.2 * peak) * between(rng, 8.5, 11.5)) / 10,
      });
    }
    if (range.every((h) => towns.every((t) => distance(t, h) >= h.radius + 2) && inBounds(h) && toBox(h, homeBox) >= h.radius)) {
      hills.push(...range);
      break;
    }
  }

  const map: GameMapDef = {
    width: W,
    height: H,
    towns,
    roads,
    port,
    rails,
    terrain: { rivers: water, hills },
    region: home.map.region,
    home: homeBox,
  };

  const terrain = buildGameTerrain(map);
  // The roads beyond the home cluster laid over the land, as a road you build is:
  // round the hills, over the rivers at their narrows -- not ruled straight across.
  for (const road of roads.slice(home.map.roads.length)) {
    const plan = planCorridor(terrain, [at(road.a), at(road.b)], "auto", new Set([0, 1]));
    if (plan && plan.polyline.length > 2) road.via = straightened(terrain, plan.polyline).slice(1, -1).map((p): [number, number] => [p.x, p.y]);
  }

  // Every town reachable by building roads: the inherited roads, plus every road
  // pathing can plan from a town to one of its three nearest.
  const reach = new UnionFind(towns.map((t) => t.id));
  for (const road of roads) reach.union(road.a, road.b);
  for (const t of towns) {
    const nearest = towns.filter((o) => o !== t).sort((a, b) => distance(t, a) - distance(t, b)).slice(0, 3);
    for (const o of nearest) {
      if (reach.connected(t.id, o.id)) continue;
      if (planCorridor(terrain, [t, o], "auto", new Set([0, 1]))) reach.union(t.id, o.id);
    }
  }
  if (reach.componentCount() !== 1) return null;

  return { map, hubs: [city.id, ...hubs.map((h) => h.id)], seaport };
}
