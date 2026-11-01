import type { GameHillDef, GameMapDef, GameRiverDef, GameRoadDef, GameTown, LandFeatures, ReliefDef } from "./types";
import type { TerrainField } from "../map/types";
import { createRng, type Rng } from "../map/random";
import { UnionFind } from "../map/connectivity";
import { planCorridor } from "../pathing/plan";
import { buildGameTerrain } from "./terrain";
import { withFictionalNames } from "./names";
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
/**
 * Map version 7 (2026-10-30, Chains: convergent, Room for them): each cluster centre the best of
 * this many spots that fit, not 12, by how much land it reaches that nothing yet does (not by how
 * far it is from the rest: that pushed clusters into the corners, half their reach off the frame);
 * and a cluster's towns a little wider round it. Map 3218's right third and south-east sat bare.
 */
const SPREAD_FITS = 60;
const SPREAD_RADIUS = 26;
/** A place "reaches" land this near it, cells; the reach is sampled on a grid this fine. */
const REACH = 28;
const REACH_STEP = 6;
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
export function gameMap(base: GameMapDef, seed: number, tuning: { regionEnabled?: boolean; riverValleys?: boolean; mapVersion?: number }): GameMapDef {
  // Map version 2 (2026-10-28): rivers that wind, and an old railway that follows the land.
  const version = tuning.mapVersion ?? 1;
  // Version 7: the clusters spread over the frame (drawRegion, `spread`).
  const spread = version >= 7;
  let map = tuning.regionEnabled ? regionInfo(base, seed, STANDARD, spread).map : generatedMapInfo(base, seed).map;
  // Version 5: a southern region's coast is its south -- drawn on its side, then turned.
  let turn = false;
  if (version >= 5 && tuning.regionEnabled && seed !== 0 && SOUTHERN.has(generatedMapInfo(base, seed).region)) {
    const sideways = regionInfo(base, seed, { w: REGION_HEIGHT, h: REGION_WIDTH }, spread);
    if (sideways.rejected < MAX_DRAWS) [map, turn] = [sideways.map, true];
  }
  if (version >= 2 && seed !== 0) {
    map = naturalWater(map, seed);
    // Version 4: the land by region and its coast, on the smoothed water, before the railway is laid over it.
    if (version >= 4) map = regionalLand(map, seed);
    if (turn) map = coastToSouth(map);
    // Version 6: the north landlocked -- its sea trade comes up the coast road (border.ts placeCoastRoad).
    if (version >= 6 && !SOUTHERN.has(generatedMapInfo(base, seed).region) && map.home) map = landlocked(map);
    // Version 8: the land first -- a relief its rivers lie in, and rivers that join as rivers do.
    if (version >= 8 && map.home) map = landFirst(map, seed, version >= 10 ? generatedMapInfo(base, seed).trunk : null);
    // Version 11: the old roads beyond the home cluster laid again over that land, their corners eased.
    if (version >= 11 && map.home) map = roadsByTheLand(map, generatedMapInfo(base, seed).map.roads.length);
    // Version 12: the land's hamlets, where people would live -- drawn, not simulated.
    // Version 13: more kinds of land -- lakes (water), and swamps, dry beds and dunes (scenery) -- before the hamlets settle round them.
    if (version >= 13 && map.home) map = landForms(map, seed);
    if (version >= 12 && map.home) map = withHamlets(map, seed);
    map = laidOverLand(map);
    // Version 9: fictional names, true to the region (names.ts) -- never real towns in places they aren't.
    if (version >= 9) map = withFictionalNames(map, seed);
  }
  // The rivers' valleys (terrain.ts): on the map a game plays, not in the drawing's own checks.
  return tuning.riverValleys ? { ...map, terrain: { ...map.terrain, valleys: true } } : map;
}

export function regionMap(base: GameMapDef, seed: number): GameMapDef {
  return regionInfo(base, seed).map;
}

export function regionInfo(base: GameMapDef, seed: number, frame: Frame = STANDARD, spread = false): RegionInfo {
  const home = generatedMapInfo(base, seed);
  if (seed === 0) return { map: home.map, home, hubs: [home.trunk[0]], seaport: home.map.port!, rejected: 0 };
  const rng = createRng(seed + 3_000_017);
  for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
    const result = drawRegion(rng, home, frame, spread);
    if (result) return { ...result, home, rejected: draw };
  }
  return { map: home.map, home, hubs: [home.trunk[0]], seaport: home.map.port!, rejected: MAX_DRAWS };
}

type Box = { x: number; y: number; width: number; height: number };
/** The frame a region is drawn in: 250 × 160, or on its side (160 × 250) to be turned so its coast is the south (version 5). */
type Frame = { w: number; h: number };
const STANDARD: Frame = { w: REGION_WIDTH, h: REGION_HEIGHT };

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
function drawCoast(rng: Rng, side: -1 | 1, depth: number, keep: GameRiverDef | undefined, frame: Frame): GameRiverDef {
  const offMap = 8;
  const edgeX = side < 0 ? -offMap : frame.w - 1 + offMap;
  const out = keep ? keep.points.map((p, i) => ({ p, w: keep.widths?.[i] ?? keep.width })) : [];
  const top = out.length > 0 ? Math.min(...out.map((o) => o.p[1])) - 8 : Infinity;
  const bottom = out.length > 0 ? Math.max(...out.map((o) => o.p[1])) + 8 : -Infinity;
  let d = depth;
  for (let y = -2; y <= frame.h + 2; y += 10) {
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
function drawMainRiver(rng: Rng, seaSide: -1 | 1, coast: GameRiverDef, box: Box, frame: Frame): GameRiverDef {
  const above: [number, number] = [12, box.y - 12];
  const below: [number, number] = [box.y + box.height + 12, frame.h - 12];
  const band = above[1] - above[0] >= below[1] - below[0] ? above : below;
  const nearBox = (x: number) => x >= box.x - 28 && x <= box.x + box.width + 28;
  const points: Array<[number, number]> = [];
  let y = between(rng, band[0], band[1]);
  for (let x = seaSide < 0 ? frame.w + 2 : -2; ; x += seaSide * 14) {
    y = Math.max(10, Math.min(frame.h - 10, y + between(rng, -9, 9)));
    if (nearBox(x)) y = Math.max(band[0], Math.min(band[1], y));
    const shore = coastAt(coast, seaSide, y);
    if (seaSide < 0 ? x <= shore : x >= shore) {
      points.push([Math.round(Math.max(0, Math.min(frame.w - 1, shore + seaSide * 6))), Math.round(y)]);
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

function drawRegion(rng: Rng, home: GeneratedMapInfo, frame: Frame = STANDARD, spread = false): Omit<RegionInfo, "home" | "rejected"> | null {
  const W = frame.w;
  const H = frame.h;
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
  const coast = drawCoast(rng, seaSide, seaDepth, homeSea ? shift(homeSea) : undefined, frame);
  const main = drawMainRiver(rng, seaSide, coast, { x: ox, y: oy, width: HOME_WIDTH, height: HOME_HEIGHT }, frame);
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
  // Version 7: the dry land within REACH of a spot that neither the home cluster's towns nor a
  // cluster already placed (its centre, out to its towns' radius) reaches.
  const land: Point[] = [];
  if (spread) for (let y = REACH_STEP / 2; y < H; y += REACH_STEP) for (let x = REACH_STEP / 2; x < W; x += REACH_STEP) if (dryOf(water, { x, y }, 0)) land.push({ x, y });
  const reached = (q: Point) => towns.some((t) => distance(t, q) <= REACH) || centres.some((c) => distance(c, q) <= SPREAD_RADIUS + REACH / 2);
  const unreached = (p: Point) => land.filter((q) => distance(p, q) <= SPREAD_RADIUS + REACH / 2 && !reached(q)).length;
  for (let attempt = 0; attempt < 3000 && centres.length < CLUSTERS; ) {
    const port = !homeSea && centres.length === 0;
    let best: Point | null = null;
    for (let fits = 0; fits < (spread ? SPREAD_FITS : 12) && attempt < 3000; attempt += 1) {
      const p = port
        ? ((y) => ({ x: Math.round(coastAt(coast, seaSide, y) - seaSide * between(rng, 6, 9)), y }))(Math.round(between(rng, 20, H - 20)))
        : { x: Math.round(between(rng, 20, W - 21)), y: Math.round(between(rng, 18, H - 19)) };
      if (!inBounds(p) || !dry(p) || toBox(p, homeBox) < HOME_GAP || centres.some((c) => distance(c, p) < CLUSTER_GAP)) continue;
      if (port && dryOf(water, p, WATER_CLEARANCE + 6)) continue; // a port is by the sea
      fits += 1;
      if (!best || (spread ? unreached(p) > unreached(best) : room(p) > room(best))) best = p;
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
      const r = between(rng, MIN_SPACING, spread ? SPREAD_RADIUS : CLUSTER_RADIUS);
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
  let ridge: { a: readonly number[]; b: readonly number[] } | null = null;
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
      ridge = { a, b };
      break;
    }
  }

  const map: GameMapDef = {
    width: W,
    height: H,
    towns,
    roads,
    port,
    seaport,
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

  // What each far cluster offers your chains (clusters.ts): a cluster the range runs to has
  // limestone in its hills; the rest are farm belts. At least one of each where there are two.
  const nearRidge = (c: Point) => (ridge ? Math.min(Math.hypot(c.x - ridge.a[0]!, c.y - ridge.a[1]!), Math.hypot(c.x - ridge.b[0]!, c.y - ridge.b[1]!)) : Infinity);
  const offers: Array<"limestone" | "farm"> = centres.map((c) => (nearRidge(c) < 1 ? "limestone" : "farm"));
  if (!offers.includes("limestone") && offers.length > 0) offers[centres.map(nearRidge).indexOf(Math.min(...centres.map(nearRidge)))] = "limestone";
  if (!offers.includes("farm") && offers.length > 1) offers[offers.length - 1] = "farm";
  map.clusters = clusters.map((cluster, k) => ({ hub: cluster[0]!.id, towns: cluster.map((t) => t.id), offer: offers[k]! }));

  return { map, hubs: [city.id, ...hubs.map((h) => h.id)], seaport };
}

// --- Map version 2: water that winds, a railway laid over the land ------------------------
// (2026-10-28, a contact sheet of twelve seeds: rivers ruled in straight runs with a corner
// every 10-14 cells, tributaries meeting at right angles, the old railway one straight line
// over rivers and ridge.) Both after the map is drawn and without drawing from its stream, so
// towns, roads and sites stay where they were; only the water's line and the railway's change.

/** A deterministic number in 0..1 from a seed and a key (no stream drawn from). */
function hashed(seed: number, key: number): number {
  let h = (seed * 2654435761) ^ (key * 2246822519);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Corner-cutting (Chaikin): each pass replaces a corner with two points a quarter in; the ends stay. */
function chaikin(points: Array<[number, number]>, widths: number[], passes: number): { points: Array<[number, number]>; widths: number[] } {
  let p = points, w = widths;
  for (let pass = 0; pass < passes; pass += 1) {
    const np: Array<[number, number]> = [p[0]!], nw = [w[0]!];
    for (let k = 1; k < p.length; k += 1) {
      const [ax, ay] = p[k - 1]!, [bx, by] = p[k]!;
      if (k > 1) { np.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]); nw.push(w[k - 1]! * 0.75 + w[k]! * 0.25); }
      if (k < p.length - 1) { np.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]); nw.push(w[k - 1]! * 0.25 + w[k]! * 0.75); }
    }
    np.push(p[p.length - 1]!);
    nw.push(w[w.length - 1]!);
    p = np;
    w = nw;
  }
  return { points: p, widths: w };
}

/**
 * Meanders: the line resampled every 1.5 cells and swung side to side, a wavelength of a
 * dozen cells or so (longer for a wider river), its swing rising and falling along it, and
 * nothing at either end (where it joins another river or leaves the map).
 */
function meandering(points: Array<[number, number]>, widths: number[], seed: number, key: number): { points: Array<[number, number]>; widths: number[] } {
  const lengths = [0];
  for (let k = 1; k < points.length; k += 1) lengths.push(lengths[k - 1]! + Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![1] - points[k - 1]![1]));
  const total = lengths[lengths.length - 1]!;
  if (total < 8) return { points, widths };
  const phase = hashed(seed, key) * Math.PI * 2, phase2 = hashed(seed, key + 101) * Math.PI * 2;
  const out: Array<[number, number]> = [], outW: number[] = [];
  let k = 1;
  for (let s = 0; s <= total + 1e-6; s = Math.min(total, s + 1.5)) {
    while (k < points.length - 1 && lengths[k]! < s) k += 1;
    const t = (s - lengths[k - 1]!) / (lengths[k]! - lengths[k - 1]! || 1);
    const [ax, ay] = points[k - 1]!, [bx, by] = points[k]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const width = widths[k - 1]! + (widths[k]! - widths[k - 1]!) * t;
    const wave = 10 + width * 2.5;
    const ends = Math.min(1, s / 6, (total - s) / 6);
    const swing = (0.7 + 0.25 * width) * (0.55 + 0.45 * Math.sin((s / (wave * 3.7)) * Math.PI * 2 + phase2)) * ends;
    const off = swing * Math.sin((s / wave) * Math.PI * 2 + phase);
    out.push([ax + (bx - ax) * t - ((by - ay) / len) * off, ay + (by - ay) * t + ((bx - ax) / len) * off]);
    outW.push(width);
    if (s >= total) break;
  }
  return { points: out, widths: outW };
}

/** Every river smoothed, the inland ones meandering -- each kept as drawn where that would bring water within a cell of a town. */
function naturalWater(map: GameMapDef, seed: number): GameMapDef {
  const rivers = map.terrain?.rivers;
  if (!rivers?.length) return map;
  const round = (points: Array<[number, number]>) => points.map(([x, y]): [number, number] => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  const clear = (river: GameRiverDef) => map.towns.every((t) => dryOf([river], t, 1));
  const next = rivers.map((river, i) => {
    const widths = river.widths ?? river.points.map(() => river.width);
    const smooth = chaikin(river.points, widths, 3);
    // The sea is drawn as a very wide river off the map's edge: its coast smoothed, not swung.
    const sea = Math.max(...widths) > 12;
    const wound = sea ? smooth : meandering(smooth.points, smooth.widths, seed, i + 1);
    // Each point as wide as the river as drawn at its nearest point: averaged instead, a ford's
    // narrow (1.2 cells at one point, a cheap crossing) spread to ~2.1 and was gone.
    const widthAt = ([x, y]: [number, number]) => {
      let best = Infinity, width = river.width;
      for (let k = 1; k < river.points.length; k += 1) {
        const [ax, ay] = river.points[k - 1]!, [bx, by] = river.points[k]!;
        const dx = bx - ax, dy = by - ay, lengthSq = dx * dx + dy * dy;
        const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq));
        const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
        if (d < best) [best, width] = [d, widths[k - 1]! + (widths[k]! - widths[k - 1]!) * t];
      }
      return width;
    };
    for (const tried of [wound, smooth]) {
      const candidate = { ...river, points: round(tried.points), widths: tried.points.map((p) => Math.round(widthAt(p) * 100) / 100) };
      if (clear(candidate)) return candidate;
    }
    return river;
  });
  return { ...map, terrain: { ...map.terrain, rivers: next } };
}

/** The old railway planned over the land, round the hills and over the rivers at their narrows, as a road you build is. */
function laidOverLand(map: GameMapDef): GameMapDef {
  if (!map.rails?.length) return map;
  const terrain = buildGameTerrain(map);
  const at = (id: string) => map.towns.find((t) => t.id === id)!;
  const rails = map.rails.map((rail) => {
    const plan = planCorridor(terrain, [at(rail.a), at(rail.b)], "auto", new Set([0, 1]));
    if (!plan || plan.polyline.length <= 2) return rail;
    // Its corners eased (a railway curves; planned, it ran in straight and 45° legs).
    const line = straightened(terrain, plan.polyline).map((p): [number, number] => [p.x, p.y]);
    const eased = chaikin(line, line.map(() => 0), 2).points;
    return { ...rail, via: eased.slice(1, -1).map(([x, y]): [number, number] => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]) };
  });
  return { ...map, rails };
}

// --- Map version 4: the land by region, and its coast ----------------------------------------
// (2026-10-28: every map had the same bones -- a big river across, the sea down one edge, one
// ridge, the home cluster boxed in a corner -- whatever its region.) The land beyond the home
// cluster drawn as its region is: rolling hills and a lagoon in the south-west, steeper hills in
// the south-east, a delta in the south-south, a plateau and rocks in the Middle Belt, rocks on a
// drier plain in the north; on every coast an estuary, bays and headlands. Nothing new in the
// home cluster's box (its trunk's prices are as measured: brief, The region), every feature clear
// of the towns, and the map kept only if every town can still be reached -- else version 3's.

/** The region's map with its land and coast drawn in (version 4). */
function regionalLand(map: GameMapDef, seed: number): GameMapDef {
  const rivers = map.terrain?.rivers;
  const box = map.home;
  if (!rivers?.length || !box) return map;
  const rng = createRng(seed + 4_000_037);
  const W = map.width, H = map.height;
  const water: Array<GameRiverDef & { widths: number[] }> = rivers.map((r) => ({ ...r, points: [...r.points], widths: [...(r.widths ?? r.points.map(() => r.width))] }));
  const hills: GameHillDef[] = [...(map.terrain?.hills ?? [])];
  const sea = water.find((r) => Math.max(...r.widths!) > 12);
  const seaSide: -1 | 1 | null = sea ? (sea.points[0]![0] < W / 2 ? -1 : 1) : null;
  const main = water.filter((r) => r !== sea).sort((a, b) => Math.max(...b.widths!) - Math.max(...a.widths!))[0];
  const nearHome = (x: number, y: number, pad: number) => toBox({ x, y }, box) < pad;
  const inside = (x: number, y: number, pad: number) => x >= pad && y >= pad && x <= W - 1 - pad && y <= H - 1 - pad;
  // A hill is free where it stands clear of every town and of the home box.
  const hillFree = (h: GameHillDef) => inside(h.x, h.y, 4) && !nearHome(h.x, h.y, h.radius + 4) && map.towns.every((t) => distance(t, h) >= h.radius + 2);
  // A river is free where every point is clear of the towns by WATER_CLEARANCE and of the home box.
  const riverFree = (r: GameRiverDef) => map.towns.every((t) => dryOf([r], t, WATER_CLEARANCE)) && r.points.every(([x, y]) => !nearHome(x, y, 4));
  const addHills = (count: number, radius: [number, number], height: [number, number]) => {
    for (let n = 0, tries = 0; n < count && tries < count * 30; tries += 1) {
      const h = { x: Math.round(between(rng, 6, W - 7)), y: Math.round(between(rng, 6, H - 7)), radius: Math.round(between(rng, ...radius)), height: Math.round(between(rng, ...height) * 10) / 10 };
      if (!hillFree(h) || !dryOf(water, h, 1)) continue;
      hills.push(h);
      n += 1;
    }
  };
  const wind = (r: GameRiverDef, key: number): GameRiverDef & { widths: number[] } => {
    const s = chaikin(r.points, r.widths ?? r.points.map(() => r.width), 2);
    const m = meandering(s.points, s.widths, seed, key);
    return { ...r, points: m.points.map(([x, y]): [number, number] => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]), widths: m.widths.map((w) => Math.round(w * 100) / 100) };
  };

  switch (map.region) {
    case "southwest":
      addHills(14, [7, 11], [1, 1.8]);
      break;
    case "southeast":
      addHills(18, [6, 10], [1.6, 2.8]);
      break;
    case "middleBelt": {
      // A plateau: hills overlapping on a grid inside an ellipse, its edge broken where a hill
      // would stand on a town; then rocks about the plain.
      for (let tries = 0; tries < 40; tries += 1) {
        const cx = between(rng, 30, W - 30), cy = between(rng, 25, H - 25);
        const rx = between(rng, 18, 26), ry = between(rng, 11, 16), turn = rng() * Math.PI;
        if (nearHome(cx, cy, rx + 6)) continue;
        const top: GameHillDef[] = [];
        for (let gy = -ry; gy <= ry; gy += 8) for (let gx = -rx; gx <= rx; gx += 8) {
          if ((gx / rx) ** 2 + (gy / ry) ** 2 > 1) continue;
          const h = { x: Math.round(cx + gx * Math.cos(turn) - gy * Math.sin(turn) + between(rng, -1.5, 1.5)), y: Math.round(cy + gx * Math.sin(turn) + gy * Math.cos(turn) + between(rng, -1.5, 1.5)), radius: 8, height: Math.round(between(rng, 1.4, 1.8) * 10) / 10 };
          if (hillFree(h)) top.push(h);
        }
        if (top.length >= 6) { hills.push(...top); break; }
      }
      addHills(6, [3, 4], [3, 4.5]);
      break;
    }
    case "north":
    case "northeast":
      // A drier plain: rocks standing out of it, and its rivers thinner (a ford's narrow kept).
      addHills(12, [2.5, 4], [4, 6]);
      for (const r of water) if (r !== sea) r.widths = r.widths!.map((w) => Math.max(Math.min(w, 1.2), w * 0.7));
      break;
    case "southSouth": {
      // A delta: two or three creeks leave the big river some 30 cells above its mouth and wind to the sea.
      if (!main || !sea || seaSide === null) break;
      const pts = main.points;
      let along = 0, k = pts.length - 1;
      while (k > 1 && along < 30) { along += Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]); k -= 1; }
      const fork = { x: pts[k]![0], y: pts[k]![1] };
      const mouthY = pts[pts.length - 1]![1];
      const creeks = 2 + (rng() < 0.5 ? 1 : 0);
      for (let c = 0, tries = 0; c < creeks && tries < 24; tries += 1) {
        const y = Math.round(Math.max(8, Math.min(H - 9, mouthY + (rng() < 0.5 ? -1 : 1) * between(rng, 10, 28))));
        const to = { x: Math.round(coastAt(sea, seaSide, y) + seaSide * 3), y };
        if (!inside(to.x, to.y, 0) && (to.x < 0 || to.x > W - 1)) to.x = Math.max(0, Math.min(W - 1, to.x));
        const creek = wind(meander(rng, fork, to, 1.8, 3), 900 + c);
        if (!riverFree(creek)) continue;
        water.push(creek);
        c += 1;
      }
      break;
    }
  }

  // The coast: an estuary where the big river meets the sea, then bays and headlands.
  if (sea && seaSide !== null) {
    if (main) {
      const before = main.widths!;
      let along = 0;
      const widened = [...before];
      for (let k = main.points.length - 1; k > 0 && along < 18; k -= 1) {
        widened[k] = before[k]! * (1 + 1.6 * (1 - along / 18));
        along += Math.hypot(main.points[k]![0] - main.points[k - 1]![0], main.points[k]![1] - main.points[k - 1]![1]);
      }
      if (map.towns.every((t) => dryOf([{ ...main, widths: widened }], t, WATER_CLEARANCE))) main.widths = widened;
    }
    const shoreWidths = sea.widths!;
    for (let b = 0, tries = 0, bays = 1 + Math.floor(rng() * 3); b < bays && tries < 20; tries += 1) {
      const y0 = between(rng, 10, H - 10), span = between(rng, 8, 16), depth = (rng() < 0.7 ? 1 : -0.6) * between(rng, 6, 12);
      if (nearHome(coastAt(sea, seaSide, y0), y0, span + 8)) continue;
      const tried = shoreWidths.map((w, i) => {
        const d = Math.abs(sea.points[i]![1] - y0) / span;
        return d < 1 ? Math.max(18, w + depth * Math.cos((d * Math.PI) / 2) ** 2) : w;
      });
      if (!map.towns.every((t) => dryOf([{ ...sea, widths: tried }], t, WATER_CLEARANCE))) continue;
      sea.widths = tried;
      shoreWidths.splice(0, shoreWidths.length, ...tried);
      b += 1;
    }
    // A lagoon behind the shore (the south-west's: Lagos's), joined to the sea by a channel.
    if (map.region === "southwest") {
      for (let tries = 0; tries < 16; tries += 1) {
        const y0 = between(rng, 12, H - 60), length = between(rng, 35, 55), inset = between(rng, 5, 8);
        const points: Array<[number, number]> = [];
        for (let y = y0; y <= y0 + length; y += 4) points.push([Math.round(coastAt(sea, seaSide, y) - seaSide * (inset + between(rng, -1, 1))), Math.round(y)]);
        const lagoon = wind({ points, width: 3, widths: points.map((_, i) => 2 + 1.6 * Math.sin((i / (points.length - 1)) * Math.PI)) }, 950);
        const mid = points[Math.floor(points.length / 2)]!;
        const channel: GameRiverDef & { widths: number[] } = { points: [mid, [Math.round(coastAt(sea, seaSide, mid[1]) + seaSide * 3), mid[1]]], width: 1.6, widths: [1.6, 1.6] };
        if (!riverFree(lagoon) || !riverFree(channel)) continue;
        water.push(lagoon, channel);
        break;
      }
    }
  }

  const next: GameMapDef = { ...map, terrain: { ...map.terrain, rivers: water, hills } };
  // The generator's guards, again: no town in the water, and every town reachable by building roads.
  let terrain: TerrainField;
  try { terrain = buildGameTerrain(next); } catch { return map; }
  const reach = new UnionFind(next.towns.map((t) => t.id));
  for (const road of next.roads) reach.union(road.a, road.b);
  for (const t of next.towns) {
    const nearest = next.towns.filter((o) => o !== t).sort((a, b) => distance(t, a) - distance(t, b)).slice(0, 3);
    for (const o of nearest) if (!reach.connected(t.id, o.id) && planCorridor(terrain, [t, o], "auto", new Set([0, 1]))) reach.union(t.id, o.id);
  }
  return reach.componentCount() === 1 ? next : map;
}

// --- Map version 5: the sea to the south --------------------------------------------------
// (2026-10-28, "in all of them, why is the ocean to the side?") The region grew round the seed's
// slice map, whose sea is down its west or east edge, and carried that coast on down the same
// edge -- so every map had its ocean to one side, the north's too. Nigeria's coast is its south.
// A southern region (south-west, south-east, south-south) is drawn on its side, 160 × 250, with
// the generator as it is, then turned a quarter so its coast lies along the bottom. A turn keeps
// every distance, so the home cluster's prices land as measured. The north keeps its side coast
// for now: inland, its trade should come through the gateways (brief, The region, step 3).

const SOUTHERN = new Set(["southwest", "southeast", "southSouth"]);

/** A map drawn on its side (coast down its west or east edge) turned a quarter, that coast to the south. */
function coastToSouth(map: GameMapDef): GameMapDef {
  const sea = map.terrain?.rivers?.find((r) => Math.max(...(r.widths ?? [r.width])) > 12);
  const west = sea ? sea.points[0]![0] < map.width / 2 : true;
  const W = map.width, H = map.height;
  // West edge to the south: (x, y) -> (y, W - 1 - x); east edge: (x, y) -> (H - 1 - y, x). Both turns, not mirrors.
  const at = (x: number, y: number): [number, number] => (west ? [y, W - 1 - x] : [H - 1 - y, x]);
  const point = ([x, y]: [number, number]): [number, number] => at(x, y);
  const town = <T extends { x: number; y: number }>(t: T): T => { const [x, y] = at(t.x, t.y); return { ...t, x, y }; };
  const road = (r: GameRoadDef): GameRoadDef => (r.via ? { ...r, via: r.via.map(point) } : r);
  const box = map.home && (() => {
    const corners = [at(map.home!.x, map.home!.y), at(map.home!.x + map.home!.width, map.home!.y + map.home!.height)];
    const x = Math.min(corners[0]![0], corners[1]![0]), y = Math.min(corners[0]![1], corners[1]![1]);
    return { x, y, width: map.home!.height, height: map.home!.width };
  })();
  return {
    ...map,
    width: H,
    height: W,
    towns: map.towns.map(town),
    roads: map.roads.map(road),
    rails: map.rails?.map(road),
    terrain: { ...map.terrain, rivers: map.terrain?.rivers?.map((r) => ({ ...r, points: r.points.map(point) })), hills: map.terrain?.hills?.map(town) },
    home: box,
  };
}

// --- Map version 6: the north landlocked ----------------------------------------------------
// (brief, The gateways, step 3; your word, 2026-10-28: "it gives variety".) A north, north-east or
// Middle Belt map loses the sea down its side -- Kano is a thousand kilometres from the coast --
// and its big river runs on off the map's edge toward the Niger and the Benue. Its sea trade comes
// up a road from the south (border.ts placeCoastRoad), its border is on a land edge. The towns
// stood clear of the sea, so nothing moves but the water.

function landlocked(map: GameMapDef): GameMapDef {
  const rivers = map.terrain?.rivers ?? [];
  const sea = rivers.find((r) => Math.max(...(r.widths ?? [r.width])) > 12);
  if (!sea) return map;
  const west = sea.points[0]![0] < map.width / 2;
  const edge = west ? -2 : map.width + 1;
  const kept = rivers.filter((r) => r !== sea).map((r) => {
    // A river that met the sea runs on to the edge, as wide as its mouth.
    const end = r.points[r.points.length - 1]!, start = r.points[0]!;
    const near = (p: [number, number]) => (west ? p[0] < 16 : p[0] > map.width - 17);
    const widths = r.widths ?? r.points.map(() => r.width);
    if (near(end)) return { ...r, points: [...r.points, [edge, end[1]] as [number, number]], widths: [...widths, widths[widths.length - 1]!] };
    if (near(start)) return { ...r, points: [[edge, start[1]] as [number, number], ...r.points], widths: [widths[0]!, ...widths] };
    return r;
  });
  return { ...map, terrain: { ...map.terrain, rivers: kept } };
}

// --- Map version 8: the land first ---------------------------------------------------------
// (The scope of 2026-10-30, A1-A2: "rivers aren't shaped by the land; tributaries as wide as the
// main river and joining at right angles; the land between them says nothing".) Beyond the home
// cluster, a relief shaped by the water (terrain.ts addRelief): low along the rivers, rising
// between them, by region -- rolling in the south-west, ridged in the south-east, nearly flat in
// the delta, a plateau behind its escarpment in the Middle Belt, a low plain in the north. And the
// rivers as a system: a tributary narrow at its source and widening to its mouth, never as wide as
// the river it joins, meeting it at a slant going downstream rather than square on. Nothing drawn
// from the map's stream (the relief from a seed of its own), so towns, roads and sites stay put;
// a river's change kept only where it stays clear of every town.

const RELIEF: Record<string, Omit<ReliefDef, "seed" | "plateaus">> = {
  southwest: { amplitude: 1.8, scale: 34 },
  southeast: { amplitude: 2.1, scale: 30, ridged: true },
  southSouth: { amplitude: 0.35, scale: 40 },
  middleBelt: { amplitude: 1.6, scale: 30 },
  north: { amplitude: 0.9, scale: 40 },
  northeast: { amplitude: 1, scale: 40 },
};

/** `trunk` (map version 10): the home cluster's trunk, whose prices guard how much land its box gets. */
function landFirst(map: GameMapDef, seed: number, trunk: readonly string[] | null): GameMapDef {
  const box = map.home!;
  const rivers = (map.terrain?.rivers ?? []).map((r) => {
    const widths = r.widths ?? r.points.map(() => r.width);
    const own = { ...r, points: [...r.points], widths: [...widths] };
    // A river that never comes near the home box has its sharp bends eased (a V where it met a
    // tributary read as a kink, not a river): two more passes of corner-cutting, kept only where
    // every town stays clear of it. The sea's coast is left as drawn.
    if ([...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)]! > 12 || r.points.some(([x, y]) => toBox({ x, y }, map.home!) < 3)) return own;
    const eased = chaikin(r.points, widths, 2);
    // Eased everywhere but near a town: there each point goes back to the drawn line's nearest
    // (the corner-cutting draws a bend's line inward, toward a town on its inside).
    const nearest = ([x, y]: [number, number]) => r.points.reduce((best, p) => (Math.hypot(p[0] - x, p[1] - y) < Math.hypot(best[0] - x, best[1] - y) ? p : best));
    const points = eased.points.map((p, i): [number, number] => {
      const close = map.towns.some((t) => Math.hypot(t.x - p[0], t.y - p[1]) < eased.widths[i]! / 2 + WATER_CLEARANCE + 3);
      const q = close ? nearest(p) : p;
      return [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100];
    });
    const candidate = { ...r, points, widths: eased.widths.map((w) => Math.round(w * 100) / 100) };
    // The same test version 2 smoothed the water by: no water within a cell of a town.
    return map.towns.every((t) => dryOf([candidate], t, 1)) ? candidate : own;
  });
  const reliefSeed = Math.floor(hashed(seed, 7_000_003) * 2 ** 31);
  const relief: ReliefDef = { seed: reliefSeed, ...(RELIEF[map.region ?? "southwest"] ?? RELIEF.southwest!) };
  // The Middle Belt's plateau: an ellipse standing clear of every town and of the home box.
  if (map.region === "middleBelt") {
    for (let k = 0; k < 40; k += 1) {
      const p = { x: 30 + hashed(reliefSeed, 10 + k) * (map.width - 60), y: 25 + hashed(reliefSeed, 60 + k) * (map.height - 50), rx: 16 + 8 * hashed(reliefSeed, 110 + k), ry: 10 + 5 * hashed(reliefSeed, 160 + k), turn: hashed(reliefSeed, 210 + k) * Math.PI, height: 4 };
      const inside = (t: { x: number; y: number }, pad: number) => {
        const c = Math.cos(p.turn), sn = Math.sin(p.turn);
        const u = ((t.x - p.x) * c + (t.y - p.y) * sn) / (p.rx + pad), v = (-(t.x - p.x) * sn + (t.y - p.y) * c) / (p.ry + pad);
        return u * u + v * v <= 1;
      };
      // Clear of the towns and of the water: a river through it cut it in two (seed 2418).
      const wet = rivers.some((r) => r.points.some(([x, y]) => inside({ x, y }, 3 + Math.max(...r.widths) / 2)));
      if (toBox(p, box) < Math.max(p.rx, p.ry) + 12 || map.towns.some((t) => inside(t, 6)) || wet) continue;
      relief.plateaus = [p];
      break;
    }
  }

  // The rivers as a system: which join which, downstream.
  // The sea: wide along its length (its typical width), not a river with one wide mouth.
  const typical = (ws: number[]) => [...ws].sort((a, b) => a - b)[Math.floor(ws.length / 2)]!;
  const sea = rivers.find((r) => typical(r.widths) > 12);
  const widthNear = (r: (typeof rivers)[number], [x, y]: [number, number]) => {
    let best = Infinity, at = 0, w = r.width, along = 0;
    for (let k = 1; k < r.points.length; k += 1) {
      const [ax, ay] = r.points[k - 1]!, [bx, by] = r.points[k]!;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d < best) [best, at, w, along] = [d, k, r.widths[k - 1]! + (r.widths[k]! - r.widths[k - 1]!) * t, t];
    }
    return { distance: best, segment: at, width: w, t: along };
  };
  const heads: Array<{ x: number; y: number }> = [];
  /** The point `along` cells down a river's line from the start of segment `k`, and its direction there. */
  const down = (r: (typeof rivers)[number], k: number, t: number, along: number): { at: [number, number]; dir: [number, number] } => {
    let seg = Math.max(1, k), [ax, ay] = r.points[seg - 1]!, [bx, by] = r.points[seg]!;
    let left = along + t * Math.hypot(bx - ax, by - ay);
    for (;;) {
      [ax, ay] = r.points[seg - 1]!; [bx, by] = r.points[seg]!;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      if (left <= len || seg === r.points.length - 1) {
        const f = Math.min(1, left / len);
        return { at: [ax + (bx - ax) * f, ay + (by - ay) * f], dir: [(bx - ax) / len, (by - ay) / len] };
      }
      left -= len;
      seg += 1;
    }
  };
  // No sea, no estuary: a landlocked map's rivers (version 6) had kept the mouth widened for a sea
  // that's gone -- a 14-cell blob at the map's edge. Without a sea a river keeps a river's width.
  if (!sea) for (const r of rivers) r.widths = r.widths.map((w) => Math.min(w, 5.5));
  const reshaped = rivers.map((river) => {
    if (river === sea) return river;
    // Its mouth: the end that meets another river (not the sea's: an estuary keeps its width).
    const ends: Array<{ end: number; host: (typeof rivers)[number]; near: ReturnType<typeof widthNear> }> = [];
    for (const end of [0, river.points.length - 1]) {
      for (const host of rivers) {
        if (host === river || host === sea) continue;
        const near = widthNear(host, river.points[end]!);
        // Within 4 cells, not touching: version 2's meanders swung some hosts off their tributaries'
        // mouths, leaving a gap of land (your look: "the flow is weird"). The mouth goes in below.
        if (near.distance <= near.width / 2 + 4) ends.push({ end, host, near });
      }
    }
    const join = ends[0];
    if (!join) return river;
    // A creek that leaves a river for the sea (the delta's), or a lagoon's channel: it runs out, not in.
    const other = river.points[join.end === 0 ? river.points.length - 1 : 0]!;
    if (sea) { const s2 = widthNear(sea, other); if (s2.distance <= s2.width / 2 + 2) return river; }
    // Order it source to mouth.
    const points = join.end === 0 ? [...river.points].reverse() : [...river.points];
    let widths = join.end === 0 ? [...river.widths].reverse() : [...river.widths];
    const n = points.length;
    // Narrow at its source, widening to its mouth, at most 0.6 of the river it joins; a ford's narrow kept.
    const cap = Math.max(1.2, join.near.width * 0.6);
    // Only beyond the home box: the home river's crossings there are the trunk's, as measured.
    // And it rises as a stream: its first cells thin (0.7) widening to its own width.
    const lengths = [0];
    for (let k = 1; k < n; k += 1) lengths.push(lengths[k - 1]! + Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![1] - points[k - 1]![1]));
    widths = widths.map((w, k) => {
      if (toBox({ x: points[k]![0], y: points[k]![1] }, box) < 2) return w;
      const t = k / Math.max(1, n - 1);
      const tapered = Math.min(cap, w) * (0.5 + 0.5 * t);
      const body = w <= 1.25 ? w : Math.max(1.2, tapered);
      const spring = Math.min(1, lengths[k]! / 10);
      return Math.round((0.7 + (body - 0.7) * spring) * 100) / 100;
    });
    const source = points[0]!;
    if (toBox({ x: source[0], y: source[1] }, box) > 6) heads.push({ x: source[0], y: source[1] });
    // Meeting its host at a slant, downstream: the mouth moved some cells down the host's line,
    // and the last stretch bent toward it, more the nearer the mouth.
    // The mouth on the host's own line (not its bank: slid along the bank, it stopped short of the
    // water with sand between -- your look, 2026-10-30), a few cells downstream of where it met.
    const mouth = points[n - 1]!;
    const slide = Math.min(6, Math.max(2, join.near.width * 1.5));
    const target = down(join.host, join.near.segment, join.near.t, slide).at;
    const reach = Math.min(n - 1, 8);
    const bent = points.map((p, i): [number, number] => {
      const from = n - 1 - reach;
      if (i < from || toBox({ x: p[0], y: p[1] }, box) < 2) return p;
      const f = ((i - from) / reach) ** 2;
      return [Math.round((p[0] + (target[0] - mouth[0]) * f) * 100) / 100, Math.round((p[1] + (target[1] - mouth[1]) * f) * 100) / 100];
    });
    const tried = { ...river, points: join.end === 0 ? bent.reverse() : bent, widths: join.end === 0 ? widths.reverse() : widths };
    const plain = { ...river, points: join.end === 0 ? [...points].reverse() : points, widths: tried.widths };
    for (const candidate of [tried, plain]) if (map.towns.every((t) => dryOf([candidate], t, 1))) return candidate;
    return river;
  });
  if (heads.length) relief.heads = heads;
  const next: GameMapDef = { ...map, terrain: { ...map.terrain, rivers: reshaped, relief } };
  return trunk ? withHomeLand(next, trunk) : next;
}

// --- Map version 10: the home cluster's land ---------------------------------------------------
// (The fidelity scope, step 4: "the flat box round your start".) Versions 8-9 left the home box as
// the seed drew it, so its prices -- the ladder's, measured on its trunk -- land as measured; the
// relief faded in past it, and the box read as a flat patch in the land. Now the box gets the same
// land at a share, as much as its trunk allows: a road along each leg of the trunk, planned as you'd
// plan one, may cost at most HOME_GUARD more than on the flat box. Tried from most land to least.

const HOME_SHARES = [0.85, 0.65, 0.45, 0.3, 0.15];
const HOME_GUARD = 0.08;

function withHomeLand(map: GameMapDef, trunk: readonly string[]): GameMapDef {
  const relief = map.terrain?.relief;
  const at = (id: string) => map.towns.find((t) => t.id === id);
  const legs = trunk.slice(1).map((id, k) => [at(trunk[k]!), at(id)] as const).filter((l): l is readonly [GameTown, GameTown] => !!l[0] && !!l[1]);
  if (!relief || legs.length === 0) return map;
  const cost = (m: GameMapDef) => {
    const terrain = buildGameTerrain(m);
    return legs.map(([a, b]) => planCorridor(terrain, [{ x: Math.round(a.x), y: Math.round(a.y) }, { x: Math.round(b.x), y: Math.round(b.y) }], "auto", new Set([0, 1]))?.breakdown.total ?? Infinity);
  };
  const flat = cost(map);
  for (const share of HOME_SHARES) {
    const tried: GameMapDef = { ...map, terrain: { ...map.terrain, relief: { ...relief, home: share } } };
    if (cost(tried).every((c, k) => c <= flat[k]! * (1 + HOME_GUARD))) return tried;
  }
  return map;
}

// --- Map version 11: old roads by the land ---------------------------------------------------
// (The fidelity scope, A4: "old roads have hard right-angle bends".) The region's old highways were
// laid when the region was drawn, over its land as it then was -- before the relief (version 8) --
// and straightened into long runs meeting at hard corners. Now each is planned again over the land
// as it is, as a road you build is (round the hills, over the rivers at their narrows), its grid
// kinks taken out, and its corners eased (three passes of corner-cutting), so it bends as a road
// does. Kept only where it stays clear of every town it doesn't serve, crosses no other road, and
// crosses the water no more times than the old line; else the eased old line, else as it was. The
// home cluster's roads are its own (their prices are the trunk's), and keep their lines.

function roadsByTheLand(map: GameMapDef, homeRoads: number): GameMapDef {
  const terrain = buildGameTerrain(map);
  const at = new Map(map.towns.map((t) => [t.id, t]));
  const lineOf = (r: GameRoadDef): Point[] => [at.get(r.a)!, ...(r.via ?? []).map(([x, y]) => ({ x, y })), at.get(r.b)!];
  const roads = [...map.roads];
  // How many times a line goes into the water: its crossings, however wide each is.
  const wetOn = (line: Point[]) => {
    let crossings = 0, wet = false;
    for (let k = 1; k < line.length; k += 1) {
      const a = line[k - 1]!, b = line[k]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4));
      for (let i = 0; i <= n; i += 1) {
        const x = Math.round(a.x + ((b.x - a.x) * i) / n), y = Math.round(a.y + ((b.y - a.y) * i) / n);
        const now = terrain.water[y * terrain.width + x] === 1;
        if (now && !wet) crossings += 1;
        wet = now;
      }
    }
    return crossings;
  };
  const fits = (line: Point[], index: number, wet: number) => {
    const road = roads[index]!;
    for (const t of map.towns) {
      if (t.id === road.a || t.id === road.b) continue;
      if (line.slice(1).some((p, k) => toSegment(t, line[k]!, p) < ROAD_CLEARANCE)) return false;
    }
    for (let j = 0; j < roads.length; j += 1) {
      if (j === index) continue;
      const other = lineOf(roads[j]!);
      for (let k = 1; k < line.length; k += 1) for (let m = 1; m < other.length; m += 1) if (crosses(line[k - 1]!, line[k]!, other[m - 1]!, other[m]!)) return false;
    }
    return wetOn(line) <= wet;
  };
  const eased = (line: Point[]) => chaikin(line.map((p): [number, number] => [p.x, p.y]), line.map(() => 0), 3).points.map(([x, y]) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }));
  for (let index = homeRoads; index < roads.length; index += 1) {
    const road = roads[index]!;
    const a = at.get(road.a), b = at.get(road.b);
    if (!a || !b) continue;
    const old = lineOf(road);
    const plan = planCorridor(terrain, [{ x: Math.round(a.x), y: Math.round(a.y) }, { x: Math.round(b.x), y: Math.round(b.y) }], "auto", new Set([0, 1]));
    const planned = plan ? straightened(terrain, plan.polyline.map((p, k, all) => (k === 0 ? a : k === all.length - 1 ? b : p))) : null;
    const wet = wetOn(old);
    for (const candidate of [planned && eased(planned), eased(old)]) {
      if (!candidate || !fits(candidate, index, wet)) continue;
      roads[index] = { ...road, via: candidate.slice(1, -1).map((p): [number, number] => [p.x, p.y]) };
      break;
    }
  }
  return { ...map, roads };
}

// --- Map version 12: hamlets ----------------------------------------------------------------
// (The fidelity scope, A3: "the middle of the region is empty".) A region had its clusters and
// little between them, where the country is full of villages: by the rivers, along the roads, on
// the lower ground. Now the land's hamlets -- a few hundred people each, a handful of compounds and
// their fields -- placed where people would live: a cell's worth scored by water within reach (not
// in it), a road nearby, low and level ground; none within a town's reach or on the water. Drawn
// (the 3D view), not simulated: no demand, no trips, nothing a tick reads, so play is unchanged.
// Whether some should be towns of their own is a balance question, for later.

const HAMLET_SPACING = 7; // cells between candidate spots
const HAMLET_CLEAR = 9; // cells from any town

function withHamlets(map: GameMapDef, seed: number): GameMapDef {
  const terrain = buildGameTerrain(map);
  const W = map.width, H = map.height;
  const top = terrain.elevation.reduce((m, e) => Math.max(m, e), 0) || 1;
  // Distance to the nearest water and the nearest old road, coarse: every spot is a cell.
  const near = (x: number, y: number, reach: number, hit: (i: number) => boolean) => {
    for (let r = 0; r <= reach; r += 1) for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && hit(yy * W + xx)) return r;
    }
    return Infinity;
  };
  const roadCells = new Uint8Array(W * H);
  const at = new Map(map.towns.map((t) => [t.id, t]));
  for (const road of map.roads) {
    const line = [at.get(road.a)!, ...(road.via ?? []).map(([x, y]) => ({ x, y })), at.get(road.b)!];
    for (let k = 1; k < line.length; k += 1) {
      const a = line[k - 1]!, b = line[k]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
      for (let i = 0; i <= n; i += 1) roadCells[Math.round(a.y + ((b.y - a.y) * i) / n) * W + Math.round(a.x + ((b.x - a.x) * i) / n)] = 1;
    }
  }
  const hamlets: Array<{ x: number; y: number; size: number }> = [];
  let k = 0;
  for (let gy = HAMLET_SPACING / 2; gy < H - 3; gy += HAMLET_SPACING) {
    for (let gx = HAMLET_SPACING / 2; gx < W - 3; gx += HAMLET_SPACING) {
      k += 1;
      const x = Math.round(gx + (hashed(seed, k * 3) - 0.5) * HAMLET_SPACING * 0.8);
      const y = Math.round(gy + (hashed(seed, k * 3 + 1) - 0.5) * HAMLET_SPACING * 0.8);
      if (x < 3 || y < 3 || x > W - 4 || y > H - 4 || terrain.water[y * W + x] === 1) continue;
      if (map.towns.some((t) => Math.hypot(t.x - x, t.y - y) < HAMLET_CLEAR)) continue;
      const toWater = near(x, y, 10, (i) => terrain.water[i] === 1);
      if (toWater < 2) continue;
      const toRoad = near(x, y, 6, (i) => roadCells[i] === 1);
      const height = terrain.elevation[y * W + x]! / top;
      // Where people would live: water within reach, a road nearby, low ground.
      const score = (toWater <= 8 ? 0.45 : 0.1) + (toRoad <= 3 ? 0.35 : toRoad <= 6 ? 0.15 : 0) + 0.25 * (1 - height);
      if (hashed(seed, k * 3 + 2) > score) continue;
      hamlets.push({ x, y, size: Math.round((1 + 3 * hashed(seed, k * 7 + 5) * score) * 10) / 10 });
    }
  }
  return { ...map, hamlets };
}

// --- Map version 13: more kinds of land ---------------------------------------------------------
// (The fidelity scope, 2026-10-31: "swamps in the delta, lakes, dry riverbeds and dunes in the far
// north".) Lakes are water, like a river: drawn as a river's capsules round a short axis, wide in the
// middle, the terrain's water cells from them -- so a road goes round or bridges one, and that is the
// one change to play. Placed on low ground clear of the home box, 10 cells from any town, 2 from any
// road's line, the map kept only if every town can still be reached. The rest is scenery (drawn, never
// priced): swamp by the water on low ground (most in the delta), the sandy beds of seasonal streams in
// the north, running downhill to a river or the map's edge, and a field of dunes in the far north.

const FORMS: Record<string, { lakes: number; lakeSize: [number, number]; wet: number; beds: number; dunes: number }> = {
  southwest: { lakes: 1, lakeSize: [3, 5], wet: 0.25, beds: 0, dunes: 0 },
  southeast: { lakes: 1, lakeSize: [2.5, 4], wet: 0.2, beds: 0, dunes: 0 },
  southSouth: { lakes: 2, lakeSize: [2.5, 4.5], wet: 1, beds: 0, dunes: 0 },
  middleBelt: { lakes: 2, lakeSize: [3, 6], wet: 0.15, beds: 2, dunes: 0 },
  north: { lakes: 1, lakeSize: [3, 5], wet: 0.1, beds: 5, dunes: 1 },
  northeast: { lakes: 1, lakeSize: [5, 8], wet: 0.3, beds: 4, dunes: 1 },
};

function landForms(map: GameMapDef, seed: number): GameMapDef {
  const forms = FORMS[map.region ?? "southwest"] ?? FORMS.southwest!;
  const rng = createRng(seed + 13_000_013);
  const box = map.home!;
  const W = map.width, H = map.height;
  let terrain = buildGameTerrain(map);
  const top = terrain.elevation.reduce((m, e) => Math.max(m, e), 0) || 1;
  const low = (x: number, y: number) => terrain.elevation[Math.round(y) * W + Math.round(x)]! / top;
  const wet = (x: number, y: number) => terrain.water[Math.round(y) * W + Math.round(x)] === 1;
  const at = new Map(map.towns.map((t) => [t.id, t]));
  const roadLines = [...map.roads, ...(map.rails ?? [])].map((r) => [at.get(r.a)!, ...(r.via ?? []).map(([x, y]) => ({ x, y })), at.get(r.b)!]);
  const nearRoad = (p: Point, clear: number) => roadLines.some((line) => line.slice(1).some((q, k) => toSegment(p, line[k]!, q) < clear));

  // Lakes: still water on the lowest ground that's free.
  const rivers = [...(map.terrain?.rivers ?? [])];
  const lakes: GameRiverDef[] = [];
  for (let n = 0, tries = 0; n < forms.lakes && tries < 300; tries += 1) {
    const c = { x: between(rng, 10, W - 11), y: between(rng, 10, H - 11) };
    const r = between(rng, ...forms.lakeSize);
    const len = r * between(rng, 1.4, 2.6), turn = rng() * Math.PI;
    if (low(c.x, c.y) > 0.35 || toBox(c, box) < len + r + 6) continue;
    if (map.towns.some((t) => distance(t, c) < len + r + 10) || nearRoad(c, len + r + 2)) continue;
    const points: Array<[number, number]> = [], widths: number[] = [];
    const steps = 6;
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps - 0.5;
      const wobble = between(rng, -0.6, 0.6);
      points.push([Math.round((c.x + Math.cos(turn) * t * 2 * len - Math.sin(turn) * wobble) * 100) / 100, Math.round((c.y + Math.sin(turn) * t * 2 * len + Math.cos(turn) * wobble) * 100) / 100]);
      widths.push(Math.round(Math.max(1.4, 2 * r * Math.cos(Math.PI * t) ** 0.6 * between(rng, 0.85, 1.1)) * 100) / 100);
    }
    const lake: GameRiverDef = { points, width: 2 * r, widths, lake: true };
    if (!map.towns.every((t) => dryOf([lake], t, 8)) || nearRoad(c, 0) || roadLines.some((line) => line.slice(1).some((q, k) => points.some(([px, py]) => toSegment({ x: px, y: py }, line[k]!, q) < r + 2)))) continue;
    if ([...rivers, ...lakes].some((o) => o.points.some(([ox, oy]) => points.some(([px, py]) => Math.hypot(ox - px, oy - py) < r + 4)))) continue;
    lakes.push(lake);
    n += 1;
  }
  let next: GameMapDef = map;
  if (lakes.length) {
    const tried: GameMapDef = { ...map, terrain: { ...map.terrain, rivers: [...rivers, ...lakes] } };
    // The generator's guards again: no town in the water, every town reachable by building roads.
    let ok = true;
    try { terrain = buildGameTerrain(tried); } catch { ok = false; }
    if (ok) {
      const reach = new UnionFind(tried.towns.map((t) => t.id));
      for (const road of tried.roads) reach.union(road.a, road.b);
      for (const t of tried.towns) {
        const nearest = tried.towns.filter((o) => o !== t).sort((a, b) => distance(t, a) - distance(t, b)).slice(0, 3);
        for (const o of nearest) if (!reach.connected(t.id, o.id) && planCorridor(terrain, [t, o], "auto", new Set([0, 1]))) reach.union(t.id, o.id);
      }
      ok = reach.componentCount() === 1;
    }
    if (ok) next = tried;
    else terrain = buildGameTerrain(map);
  }

  const features: LandFeatures = {};
  // Swamp: low ground by the water, in patches.
  if (forms.wet > 0) {
    const wetlands: Array<{ x: number; y: number; r: number }> = [];
    const water = terrain.water;
    for (let y = 4; y < H - 4; y += 4) for (let x = 4; x < W - 4; x += 4) {
      const jx = x + between(rng, -1.5, 1.5), jy = y + between(rng, -1.5, 1.5);
      if (wet(jx, jy) || low(jx, jy) > 0.25 || toBox({ x: jx, y: jy }, box) < 2) continue;
      let close = false;
      for (let dy = -4; dy <= 4 && !close; dy += 1) for (let dx = -4; dx <= 4 && !close; dx += 1) {
        const xx = Math.round(jx) + dx, yy = Math.round(jy) + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && water[yy * W + xx] === 1) close = true;
      }
      if (!close || rng() > forms.wet * 0.7) continue;
      if (map.towns.some((t) => distance(t, { x: jx, y: jy }) < 6)) continue;
      wetlands.push({ x: Math.round(jx * 10) / 10, y: Math.round(jy * 10) / 10, r: Math.round(between(rng, 2, 3.5 + forms.wet * 2) * 10) / 10 });
    }
    if (wetlands.length) features.wetlands = wetlands;
  }
  // Dry beds: from high ground downhill, until water, the edge or a town.
  if (forms.beds > 0) {
    const beds: Array<{ points: Array<[number, number]>; width: number }> = [];
    for (let n = 0, tries = 0; n < forms.beds && tries < 120; tries += 1) {
      let p = { x: between(rng, 8, W - 9), y: between(rng, 8, H - 9) };
      if (low(p.x, p.y) < 0.25 || toBox(p, box) < 6 || wet(p.x, p.y)) continue;
      const points: Array<[number, number]> = [[Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]];
      let heading = rng() * Math.PI * 2;
      for (let step = 0; step < 40; step += 1) {
        // Downhill, with a wander: try a fan of headings, take the lowest.
        let best = { e: Infinity, a: heading };
        for (const da of [-0.7, -0.35, 0, 0.35, 0.7]) {
          const a = heading + da, q = { x: p.x + Math.cos(a) * 1.5, y: p.y + Math.sin(a) * 1.5 };
          if (q.x < 1 || q.y < 1 || q.x > W - 2 || q.y > H - 2) continue;
          const e = low(q.x, q.y) + between(rng, 0, 0.02);
          if (e < best.e) best = { e, a };
        }
        if (best.e === Infinity) break;
        heading = best.a;
        p = { x: p.x + Math.cos(heading) * 1.5, y: p.y + Math.sin(heading) * 1.5 };
        if (wet(p.x, p.y) || map.towns.some((t) => distance(t, p) < 4) || toBox(p, box) < 2) break;
        points.push([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
      }
      if (points.length < 10) continue;
      beds.push({ points, width: Math.round(between(rng, 0.8, 1.4) * 10) / 10 });
      n += 1;
    }
    if (beds.length) features.dryBeds = beds;
  }
  // Dunes: a field in the far north, away from the towns and the home box.
  if (forms.dunes > 0) {
    for (let tries = 0; tries < 60; tries += 1) {
      const d = { x: between(rng, 30, W - 31), y: between(rng, 12, H * 0.35), rx: between(rng, 16, 26), ry: between(rng, 9, 14), turn: between(rng, -0.4, 0.4) };
      if (map.region === "northeast") d.x = between(rng, W * 0.55, W - 31);
      if (toBox(d, box) < d.rx + 6 || map.towns.some((t) => distance(t, d) < Math.max(d.rx, d.ry) + 4) || wet(d.x, d.y)) continue;
      features.dunes = [{ x: Math.round(d.x), y: Math.round(d.y), rx: Math.round(d.rx), ry: Math.round(d.ry), turn: Math.round(d.turn * 100) / 100 }];
      break;
    }
  }
  return Object.keys(features).length ? { ...next, features } : next;
}
