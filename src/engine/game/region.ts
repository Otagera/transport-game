import type { GameHillDef, GameMapDef, GameRiverDef, GameRoadDef, GameTown } from "./types";
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
  isDryAround,
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
const CLUSTER_RADIUS = 24;
/** Towns in a cluster, its regional town included (fewer when the names run out, never under MIN_CLUSTER). */
const CLUSTER_TOWNS = 6;
const MIN_CLUSTER = 4;
/** Cluster centres at least this far apart, and this far from the home box, cells. */
const CLUSTER_GAP = 62;
const HOME_GAP = 36;
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
  if (seed === 0) return { map: home.map, home, hubs: [home.trunk[0]], rejected: 0 };
  const rng = createRng(seed + 3_000_017);
  for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
    const result = drawRegion(rng, home);
    if (result) return { ...result, home, rejected: draw };
  }
  return { map: home.map, home, hubs: [home.trunk[0]], rejected: MAX_DRAWS };
}

/** A river or sea carried on top to bottom past the box it was drawn in. */
function runOn(river: GameRiverDef, ox: number, oy: number): GameRiverDef {
  const points = river.points.map(([x, y]): [number, number] => [x + ox, y + oy]);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const widths = river.widths ? [river.widths[0]!, ...river.widths, river.widths[river.widths.length - 1]!] : undefined;
  return { ...river, points: [[first[0], -2], ...points, [last[0], REGION_HEIGHT + 2]], ...(widths ? { widths } : {}) };
}

/** A river from the region's top to its bottom, meandering about x = cx, with one ford. */
function drawRiver(rng: Rng, cx: number): GameRiverDef {
  const rows = [-2, 18, 38, 58, 78, 98, 118, 138, REGION_HEIGHT + 2];
  let x = cx;
  const points = rows.map((y): [number, number] => {
    x = Math.round(Math.max(cx - 14, Math.min(cx + 14, x + between(rng, -7, 7))));
    return [x, y];
  });
  const widths = rows.map(() => between(rng, 2.5, 5));
  widths[1 + Math.floor(rng() * (rows.length - 2))] = 1.2;
  return { points, width: 3, widths };
}

/** The sea along the west or east edge of the region, `depth` cells in. */
function drawSea(rng: Rng, side: -1 | 1, depth: number): GameRiverDef {
  const offMap = 8;
  const edgeX = side < 0 ? -offMap : REGION_WIDTH - 1 + offMap;
  const rows = [-2, 30, 60, 90, 120, REGION_HEIGHT + 2];
  return { points: rows.map((y): [number, number] => [Math.round(edgeX + side * between(rng, -1.5, 1.5)), y]), width: 2 * (offMap + depth) };
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
  const water: GameRiverDef[] = homeRivers.map((r) => runOn(r, ox, oy));
  const seaDepth = Math.round(between(rng, ...SEA_DEPTH));
  if (!homeSea) water.push(drawSea(rng, seaSide, seaDepth));
  // One or two more rivers, in the region beyond the home box.
  const far = homeSide < 0 ? [HOME_WIDTH + 20, W - 40] : [40, W - HOME_WIDTH - 20];
  const extra = rng() < 0.5 ? 1 : 2;
  for (let k = 0; k < extra; k += 1) water.push(drawRiver(rng, Math.round(far[0]! + ((far[1]! - far[0]!) * (k + 0.5 + between(rng, -0.25, 0.25))) / extra)));

  const at = (id: string) => towns.find((t) => t.id === id)!;
  const inBounds = (p: Point) => p.x >= EDGE_MARGIN && p.x <= W - 1 - EDGE_MARGIN && p.y >= EDGE_MARGIN && p.y <= H - 1 - EDGE_MARGIN;
  const dry = (p: Point) => isDryAround(water, p, WATER_CLEARANCE);
  const spaced = (p: Point, others: Point[]) => others.every((q) => distance(p, q) >= MIN_SPACING);

  // Names: the rest of the home map's region's list, none the home cluster uses.
  const used = new Set(towns.map((t) => t.name));
  const list = home.region === "southwest" ? NAMES : REGION_NAMES[home.region];
  const names = shuffle(rng, list.filter((n) => !used.has(n)));
  const perCluster = Math.max(MIN_CLUSTER, Math.min(CLUSTER_TOWNS, Math.floor(names.length / CLUSTERS)));

  // Cluster centres, each its regional town. When the home city isn't on the coast,
  // the first cluster is on it, and its regional town is the port.
  const centres: Point[] = [];
  const seaInner = seaSide < 0 ? seaDepth : W - 1 - seaDepth; // the coast line, roughly
  for (let attempt = 0; attempt < 3000 && centres.length < CLUSTERS; attempt += 1) {
    const port = !homeSea && centres.length === 0;
    const p = port
      ? { x: Math.round(seaInner - seaSide * between(rng, 6, 9)), y: Math.round(between(rng, 20, H - 20)) }
      : { x: Math.round(between(rng, 20, W - 21)), y: Math.round(between(rng, 18, H - 19)) };
    if (!inBounds(p) || !dry(p) || toBox(p, homeBox) < HOME_GAP || centres.some((c) => distance(c, p) < CLUSTER_GAP)) continue;
    if (port && isDryAround(water, p, WATER_CLEARANCE + 6)) continue; // a port is by the sea
    centres.push(p);
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

  // The port: the home city's on a coast, else the coast cluster's regional town.
  const port = homeSea ? home.map.port! : hubs[0]!.id;

  // The old railway on: from the home city to the port's cluster (imports by rail), else
  // to the nearest regional town; straight, and through no town.
  const city = at(home.trunk[0]);
  const railTo = (homeSea ? [...hubs].sort((a, b) => distance(city, a) - distance(city, b)) : [hubs[0]!, ...hubs.slice(1)])
    .find((h) => towns.every((t) => t === city || t === h || toSegment(t, city, h) >= 2.5));
  if (railTo) rails.push({ a: city.id, b: railTo.id });

  // A range of hills between two clusters, clear of every town.
  const pairs = shuffle(rng, [[homeBox.x + HOME_WIDTH / 2, homeBox.y + HOME_HEIGHT / 2], ...centres.map((c) => [c.x, c.y])].flatMap((a, i, all) => all.slice(i + 1).map((b) => [a, b] as const)));
  for (const [a, b] of pairs) {
    const range: GameHillDef[] = [];
    for (let k = 0; k < 5; k += 1) {
      const t = 0.32 + k * 0.09;
      const side = between(rng, -5, 5);
      const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) || 1;
      range.push({
        x: Math.round(a[0]! + (b[0]! - a[0]!) * t + (-(b[1]! - a[1]!) / len) * side),
        y: Math.round(a[1]! + (b[1]! - a[1]!) * t + ((b[0]! - a[0]!) / len) * side),
        radius: Math.round(between(rng, 7, 10)),
        height: Math.round(between(rng, 30, 42)) / 10,
      });
    }
    if (range.every((h) => towns.every((t) => distance(t, h) >= h.radius + 2) && inBounds(h))) {
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

  // Every town reachable by building roads: the inherited roads, plus every road
  // pathing can plan from a town to one of its three nearest.
  const terrain = buildGameTerrain(map);
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

  return { map, hubs: [city.id, ...hubs.map((h) => h.id)] };
}
