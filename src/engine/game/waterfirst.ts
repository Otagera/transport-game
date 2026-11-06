import type { GameHillDef, GameMapDef, GameRiverDef, GameRoadDef, GameTown } from "./types";
import { createRng, type Rng } from "../map/random";
import { UnionFind } from "../map/connectivity";
import { planCorridor } from "../pathing/plan";
import { buildGameTerrain } from "./terrain";
import { varyTownSizes } from "./variation";
import {
  EDGE_MARGIN, MIN_SPACING, ROAD_CLEARANCE, SIZES, TRUNK_LEGS, TRUNK_LENGTH_TOLERANCE, TRUNK_STRAIGHTNESS, WATER_CLEARANCE,
  between, crosses, distance, shuffle, toSegment, type Point,
} from "./generate";
import {
  CLUSTERS, CLUSTER_GAP, CLUSTER_TOWNS, HOME_GAP, HUB_SIZES, MIN_CLUSTER, REACH, REACH_STEP, REGION_HEIGHT, REGION_WIDTH, RELIEF,
  SMALL_TOWN, SPREAD_FITS, SPREAD_RADIUS, chaikin, dryOf, hashed, straightened, toBox, withHomeLand,
} from "./region";

// Map version 16: water first (docs/water.md, Step 1, redrawn; agreed 2026-11-06). Every map before
// it had one skeleton -- the sea along one edge, a big river across to it above or below the home
// box, the home river joined to it -- because each version added to the last and moved nothing
// ("the shape of the water was the same"). Here the water is drawn first, by region, varied by seed;
// the home city is placed on it (mostly: now and then inland); the home cluster is drawn round the
// home city by the slice map's rules (its trunk's legs guarded as before, so the ladder's prices land
// near as measured) but no longer is the slice map (C21 re-measured); the far clusters, their
// regional towns on the water where it is; river towns and fishing villages on the banks. Then the
// later passes as before (gameMap). Its own streams: no earlier version's map changes.
//
// The water's characters, Nigeria's, one a region (drawn with the sea, if any, at the frame's foot,
// then turned so it lies on any side, and mirrored):
//   - south-west: a coast with a lagoon behind it, an inlet to the sea, rivers down to the lagoon;
//   - south-south: a delta, its trunk in from inland, its arms fanning to the sea, creeks between;
//   - south-east: one big river the map's length to an estuary, tributaries joining it;
//   - Middle Belt: two big rivers meeting in a Y and running on as one; no sea;
//   - north: a dry plain, a river or two; no sea;
//   - north-east: a lake basin, a river or two feeding it; no sea.
// Rivers are a tree: a tributary ends on the river it joins, and none crosses another.

// The region's frame (region.ts REGION_WIDTH, REGION_HEIGHT), written out: the two modules import each
// other, and region.ts's constants aren't there yet when this one loads. waterFirstMap checks they agree.
const W = 250;
const H = 160;
const HOME_W = 100;
const HOME_H = 64;
const MAX_DRAWS = 200;
/** A town on the water stands this clear of its edge, cells (the dry rule's 3, eased for the waterside). */
const BANK_CLEARANCE = 1.5;
/** A boat needs this much river, cells (water.md). */
const NAVIGABLE = 2.5;

export type WaterRegion = "southwest" | "southSouth" | "southeast" | "middleBelt" | "north" | "northeast";
const REGIONS: WaterRegion[] = ["southwest", "southSouth", "southeast", "middleBelt", "north", "northeast"];

/** The region, evenly (the old draw sent 47% to the south-west: ten of twelve on a sheet). */
export function waterRegion(seed: number): WaterRegion {
  return REGIONS[Math.floor(hashed(seed, 16_000_001) * REGIONS.length)]!;
}

type Pt = [number, number];
interface Drawn { rivers: GameRiverDef[]; sea: GameRiverDef | null; homes: Array<{ at: Pt; why: string }> }

/** A river from a to b: a meander every few cells, swinging smoothly, `w0` to `w1` wide. */
function meander(rng: Rng, a: Pt, b: Pt, w0: number, w1: number, swing = 0.06): GameRiverDef {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n = Math.max(3, Math.round(len / 6));
  const [nx, ny] = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  const phase = rng() * 6.28, f1 = between(rng, 1.5, 3.5), f2 = between(rng, 4, 8), amp2 = between(rng, 0.2, 0.5);
  const points: Pt[] = [], widths: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n, env = Math.sin(Math.PI * t);
    const off = swing * len * env * (Math.sin(phase + f1 * 6.28 * t) + amp2 * Math.sin(phase * 2 + f2 * 6.28 * t));
    points.push([a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off]);
    widths.push(w0 + (w1 - w0) * t);
  }
  const eased = chaikin(points, widths, 2);
  return { points: eased.points.map(([x, y]): Pt => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]), widths: eased.widths.map((w) => Math.round(w * 100) / 100), width: Math.max(w0, w1) };
}

/** The point a share of the way down a river's line. */
function along(r: GameRiverDef, t: number): Pt {
  const k = Math.max(0, Math.min(r.points.length - 1, Math.round(t * (r.points.length - 1))));
  return r.points[k]!;
}

/** Whether a new river crosses any drawn one -- its last `spare` segments may touch the river it joins. */
function crossesAny(river: GameRiverDef, others: GameRiverDef[], spareEnd: number, spareStart = 0): boolean {
  const seg = (r: GameRiverDef, k: number) => [{ x: r.points[k - 1]![0], y: r.points[k - 1]![1] }, { x: r.points[k]![0], y: r.points[k]![1] }] as const;
  for (let k = 1 + spareStart; k < river.points.length - spareEnd; k += 1) {
    const [a, b] = seg(river, k);
    for (const o of others) for (let j = 1; j < o.points.length; j += 1) {
      const [c, d] = seg(o, j);
      if (crosses(a, b, c, d)) return true;
    }
  }
  return false;
}

/** The sea along the frame's foot, drawn as a very wide river off it (as every version draws the sea): its shore wanders. */
function drawSea(rng: Rng, fw: number, fh: number, depth: [number, number]): GameRiverDef {
  const off = 8;
  const points: Pt[] = [], widths: number[] = [];
  let d = between(rng, depth[0], depth[1]);
  for (let x = -10; x <= fw + 10; x += 10) {
    d = Math.max(depth[0] - 2, Math.min(depth[1] + 4, d + between(rng, -2.5, 2.5)));
    points.push([x, fh - 1 + off]);
    widths.push(2 * (off + d));
  }
  return { points, widths, width: 2 * (off + depth[0]) };
}
/** The shore's row at column x: the first dry row up from the sea. */
function shoreAt(sea: GameRiverDef, x: number): number {
  const k = Math.max(1, Math.min(sea.points.length - 1, sea.points.findIndex((p) => p[0] >= x)));
  const [ax] = sea.points[k - 1]!, [bx] = sea.points[k]!;
  const t = Math.max(0, Math.min(1, (x - ax) / (bx - ax || 1)));
  const w = sea.widths![k - 1]! + (sea.widths![k]! - sea.widths![k - 1]!) * t;
  return sea.points[k]![1] - w / 2;
}

/** Tributaries into `host` from sources in the upper part of the frame, none crossing any river drawn. */
function tributaries(rng: Rng, rivers: GameRiverDef[], host: GameRiverDef, count: number, fw: number, fh: number, w: [number, number], tRange: [number, number] = [0.25, 0.8]): void {
  for (let k = 0, tries = 0; k < count && tries < 40; tries += 1) {
    const mouth = along(host, between(rng, tRange[0], tRange[1]));
    const source: Pt = [between(rng, 0.05, 0.95) * fw, between(rng, 0, 0.55) * fh];
    if (Math.hypot(source[0] - mouth[0], source[1] - mouth[1]) < 40) continue;
    const trib = meander(rng, source, mouth, w[0], w[1], 0.07);
    if (crossesAny(trib, rivers, 3)) continue;
    rivers.push(trib);
    k += 1;
  }
}

// --- The characters ------------------------------------------------------------------------

function southwest(rng: Rng, fw: number, fh: number): Drawn {
  const sea = drawSea(rng, fw, fh, [4, 8]);
  // The lagoon: a band of water parallel to the shore, a few cells inland, open to the sea by an inlet.
  const gap = between(rng, 6, 9);
  const lagoonW = between(rng, 2.6, 3.6);
  const lagoonPts: Pt[] = [], lagoonWs: number[] = [];
  for (let x = -6; x <= fw + 6; x += 6) { lagoonPts.push([x, shoreAt(sea, x) - gap + between(rng, -0.8, 0.8)]); lagoonWs.push(lagoonW); }
  const eased = chaikin(lagoonPts, lagoonWs, 2);
  const lagoon: GameRiverDef = { points: eased.points, widths: eased.widths, width: lagoonW };
  const rivers: GameRiverDef[] = [sea, lagoon];
  const inletX = between(rng, 0.2, 0.8) * fw;
  const inletTop = along(lagoon, inletX / fw);
  rivers.push({ points: [inletTop, [inletTop[0] + between(rng, -2, 2), shoreAt(sea, inletTop[0]) + 2]], widths: [1.8, 2.2], width: 2.2 });
  const big = meander(rng, [between(rng, 0.15, 0.85) * fw, -4], along(lagoon, between(rng, 0.25, 0.75)), 1.5, 3.2, 0.06);
  if (!crossesAny(big, rivers, 3)) rivers.push(big);
  tributaries(rng, rivers, lagoon, 1 + Math.floor(rng() * 2), fw, fh, [1.1, 2.2], [0.1, 0.9]);
  const homes = [
    { at: along(lagoon, between(rng, 0.3, 0.7)), why: "on the lagoon" },
    { at: along(big, 0.8), why: "on a river near the coast" },
    { at: along(big, between(rng, 0.35, 0.55)), why: "inland, on a river" },
  ];
  return { rivers, sea, homes: rng() < 0.5 ? homes : rng() < 0.6 ? [homes[1]!, homes[0]!, homes[2]!] : [homes[2]!, homes[1]!, homes[0]!] };
}

function southSouth(rng: Rng, fw: number, fh: number): Drawn {
  const sea = drawSea(rng, fw, fh, [3, 6]);
  const apex: Pt = [between(rng, 0.35, 0.65) * fw, between(rng, 0.38, 0.52) * fh];
  const trunk = meander(rng, [apex[0] + between(rng, -0.25, 0.25) * fw, -4], apex, 3.4, 5, 0.05);
  const rivers: GameRiverDef[] = [sea, trunk];
  const arms: GameRiverDef[] = [];
  const count = 3 + Math.floor(rng() * 3);
  const spread = between(rng, 0.65, 0.9) * fw;
  for (let k = 0; k < count; k += 1) {
    const x = Math.max(4, Math.min(fw - 5, apex[0] + (k / (count - 1) - 0.5) * spread));
    const arm = meander(rng, apex, [x, shoreAt(sea, x) + 3], 3, 2, 0.03);
    if (crossesAny(arm, [...arms], 2, 2)) continue;
    arms.push(arm);
  }
  rivers.push(...arms);
  // Creeks between neighbouring arms, low in the delta.
  for (let k = 1; k < arms.length; k += 1) {
    if (rng() < 0.4) continue;
    const t = between(rng, 0.55, 0.85);
    const creek = meander(rng, along(arms[k - 1]!, t), along(arms[k]!, t + between(rng, -0.05, 0.05)), 1.1, 1.1, 0.08);
    if (!crossesAny(creek, rivers.filter((r) => r !== arms[k - 1] && r !== arms[k]), 0)) rivers.push(creek);
  }
  const mid = arms[Math.floor(arms.length / 2)] ?? trunk;
  const homes = [{ at: along(mid, between(rng, 0.55, 0.75)), why: "in the delta, on a creek" }, { at: apex, why: "at the delta's head" }];
  return { rivers, sea, homes: rng() < 0.6 ? homes : [homes[1]!, homes[0]!] };
}

function southeast(rng: Rng, fw: number, fh: number): Drawn {
  const sea = drawSea(rng, fw, fh, [4, 7]);
  const fromSide = rng() < 0.5;
  const start: Pt = fromSide ? [rng() < 0.5 ? -4 : fw + 3, between(rng, 0.05, 0.35) * fh] : [between(rng, 0.1, 0.9) * fw, -4];
  const mouthX = between(rng, 0.3, 0.7) * fw;
  const big = meander(rng, start, [mouthX, shoreAt(sea, mouthX) + 4], 3.2, 6.5, 0.05);
  const rivers: GameRiverDef[] = [sea, big];
  tributaries(rng, rivers, big, 2 + Math.floor(rng() * 2), fw, fh, [1.2, 2.4]);
  const homes = [{ at: along(big, between(rng, 0.84, 0.9)), why: "on the estuary" }, { at: along(big, between(rng, 0.4, 0.6)), why: "a river port on the big river" }];
  return { rivers, sea, homes: rng() < 0.5 ? homes : [homes[1]!, homes[0]!] };
}

function middleBelt(rng: Rng, fw: number, fh: number): Drawn {
  const meet: Pt = [between(rng, 0.32, 0.68) * fw, between(rng, 0.32, 0.6) * fh];
  const a = meander(rng, [between(rng, 0.05, 0.4) * fw, -4], meet, 2.8, 4, 0.06);
  const b = meander(rng, [fw + 3, between(rng, 0.05, 0.6) * fh], meet, 2.8, 4, 0.06);
  const out: Pt = rng() < 0.5 ? [between(rng, 0.25, 0.75) * fw, fh + 3] : [-4, between(rng, 0.55, 0.95) * fh];
  const on = meander(rng, meet, out, 5, 5.5, 0.05);
  const rivers: GameRiverDef[] = [a, b, on];
  if (crossesAny(b, [a], 2) || crossesAny(on, [a, b], 0, 2)) return { rivers: [], sea: null, homes: [] };
  tributaries(rng, rivers, rng() < 0.5 ? on : b, 1 + Math.floor(rng() * 2), fw, fh, [1.1, 2.2]);
  const homes = [{ at: meet, why: "at the confluence" }, { at: along(b, between(rng, 0.4, 0.65)), why: "on one of the two rivers" }];
  return { rivers, sea: null, homes: rng() < 0.6 ? homes : [homes[1]!, homes[0]!] };
}

function north(rng: Rng, fw: number, fh: number): Drawn {
  const main = meander(rng, [between(rng, 0.1, 0.9) * fw, -4], [between(rng, 0.1, 0.9) * fw, fh + 3], 1.6, 2.8, 0.07);
  const rivers: GameRiverDef[] = [main];
  tributaries(rng, rivers, main, 1 + Math.floor(rng() * 2), fw, fh, [1, 1.8]);
  const homes = [
    { at: along(main, between(rng, 0.35, 0.65)), why: "on the river" },
    { at: [between(rng, 0.3, 0.7) * fw, between(rng, 0.3, 0.7) * fh] as Pt, why: "inland, off the water" },
  ];
  return { rivers, sea: null, homes: rng() < 0.6 ? homes : [homes[1]!, homes[0]!] };
}

function northeast(rng: Rng, fw: number, fh: number): Drawn {
  // The lake: an ellipse in a corner, as a short capsule of very wide water (still, not flowing).
  const cx = rng() < 0.5 ? between(rng, 0.12, 0.25) * fw : between(rng, 0.75, 0.88) * fw;
  const cy = rng() < 0.5 ? between(rng, 0.15, 0.3) * fh : between(rng, 0.7, 0.85) * fh;
  const rx = between(rng, 13, 20), ry = between(rng, 9, 13);
  const lakePts: Pt[] = [], lakeWs: number[] = [];
  for (let k = 0; k <= 6; k += 1) { const t = k / 6 - 0.5; lakePts.push([cx + t * 2 * (rx - ry / 2), cy]); lakeWs.push(2 * ry * Math.sqrt(Math.max(0.3, 1 - 4 * t * t))); }
  const lake: GameRiverDef = { points: lakePts, widths: lakeWs, width: 2 * ry, lake: true };
  const rivers: GameRiverDef[] = [lake];
  const shore: Pt = [cx + (cx < fw / 2 ? rx : -rx) * 0.9, cy + (cy < fh / 2 ? ry : -ry) * 0.6];
  const feeder = meander(rng, [fw - cx + between(rng, -30, 30), cy < fh / 2 ? fh + 3 : -4], shore, 1.2, 2.6, 0.07);
  rivers.push(feeder);
  if (rng() < 0.6) tributaries(rng, rivers, feeder, 1, fw, fh, [1, 1.8]);
  const homes = [
    { at: [cx + (cx < fw / 2 ? 1 : -1) * (rx + 7), cy] as Pt, why: "by the lake" },
    { at: along(feeder, between(rng, 0.35, 0.6)), why: "on the river" },
    { at: [between(rng, 0.35, 0.65) * fw, between(rng, 0.35, 0.65) * fh] as Pt, why: "inland, off the water" },
  ];
  const pick = rng();
  return { rivers, sea: null, homes: pick < 0.45 ? homes : pick < 0.75 ? [homes[1]!, homes[0]!, homes[2]!] : [homes[2]!, homes[0]!, homes[1]!] };
}

const CHARACTERS: Record<WaterRegion, (rng: Rng, fw: number, fh: number) => Drawn> = { southwest, southSouth, southeast, middleBelt, north, northeast };

// --- The map ---------------------------------------------------------------------------------

export interface WaterFirstInfo {
  map: GameMapDef;
  trunk: [string, string, string];
  /** How many of the map's roads are the home cluster's (they keep their lines: roadsByTheLand). */
  homeRoads: number;
  /** Where the home city stands, in words (the sheet's caption). */
  homeWhy: string;
}

/** Version 16's first stage: the region drawn water first. Null only if every draw fails (never seen). */
export function waterFirstMap(seed: number): WaterFirstInfo | null {
  if (W !== REGION_WIDTH || H !== REGION_HEIGHT) throw new Error("waterfirst.ts: the region's frame changed");
  const region = waterRegion(seed);
  const rng = createRng(seed + 16_000_003);
  for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
    const result = drawWaterFirst(rng, region, seed);
    if (result) return result;
  }
  return null;
}

/** The frame turned so its foot (the sea's side) lies on the map's bottom, top, left or right, and mirrored at will. */
function orientation(rng: Rng): { fw: number; fh: number; toMap: (p: Pt) => Pt } {
  const side = (["bottom", "bottom", "left", "right", "top"] as const)[Math.floor(rng() * 5)]!;
  const mirror = rng() < 0.5;
  const [fw, fh] = side === "left" || side === "right" ? [H, W] : [W, H];
  const toMap = ([fx0, fy]: Pt): Pt => {
    const fx = mirror ? fw - 1 - fx0 : fx0;
    switch (side) {
      case "bottom": return [fx, fy];
      case "top": return [W - 1 - fx, H - 1 - fy];
      case "left": return [fh - 1 - fy, fx];
      case "right": return [fy, fw - 1 - fx];
    }
  };
  return { fw, fh, toMap };
}

/** Why draws were rejected, by guard (the probe and the tests read it). */
export const waterFirstRejects = new Map<string, number>();
function reject(why: string): null {
  waterFirstRejects.set(why, (waterFirstRejects.get(why) ?? 0) + 1);
  return null;
}

function drawWaterFirst(rng: Rng, region: WaterRegion, seed: number): WaterFirstInfo | null {
  const { fw, fh, toMap } = orientation(rng);
  const drawn = CHARACTERS[region](rng, fw, fh);
  if (drawn.rivers.length === 0) return reject("water");
  const turn = (r: GameRiverDef): GameRiverDef => ({ ...r, points: r.points.map((p) => toMap(p)) });
  const water = drawn.rivers.map(turn);
  const sea = drawn.sea ? water[drawn.rivers.indexOf(drawn.sea)]! : null;
  const inBounds = (p: Point) => p.x >= EDGE_MARGIN && p.x <= W - 1 - EDGE_MARGIN && p.y >= EDGE_MARGIN && p.y <= H - 1 - EDGE_MARGIN;
  const dry = (p: Point, clearance = WATER_CLEARANCE) => dryOf(water, p, clearance);
  const spaced = (p: Point, others: Point[]) => others.every((q) => distance(p, q) >= MIN_SPACING);

  // The home city: on the bank nearest the spot its character chose, else the next choice.
  let city: Point | null = null;
  let homeWhy = "";
  for (const home of drawn.homes) {
    const at = toMap(home.at);
    const inland = home.why.startsWith("inland");
    city = bankNear(rng, { x: at[0], y: at[1] }, inland ? WATER_CLEARANCE + 2 : BANK_CLEARANCE, inland ? 14 : 6, (p) => inBounds(p) && dry(p, inland ? WATER_CLEARANCE + 2 : BANK_CLEARANCE) && (inland || !dry(p, BANK_CLEARANCE + 2.5)));
    if (city) { homeWhy = home.why; break; }
  }
  if (!city) return reject("city");

  // The home box: the slice map's size, round the city, inside the frame.
  const box = {
    x: Math.round(Math.max(0, Math.min(W - HOME_W, city.x - between(rng, 30, 70)))),
    y: Math.round(Math.max(0, Math.min(H - HOME_H, city.y - between(rng, 18, 46)))),
    width: HOME_W, height: HOME_H,
  };
  const inBox = (p: Point) => p.x >= box.x + EDGE_MARGIN && p.x <= box.x + HOME_W - 1 - EDGE_MARGIN && p.y >= box.y + EDGE_MARGIN && p.y <= box.y + HOME_H - 1 - EDGE_MARGIN;

  // The home cluster by the slice map's rules: nine towns by spacing in the box; a trunk from the
  // city through a middle town to the second city, its legs within the hand-made map's (the
  // ladder's prices). The dry rule eased by the water (a waterside town 2 cells off it, not 3).
  // The trunk first, built rather than hoped for among random spots (on a delta, nine random spots
  // rarely held two legs of the right lengths running on): the middle town a first leg's length
  // from the city, the second city a second leg's on, turning at most 35 degrees.
  let trunkSpots: [Point, Point] | null = null;
  const ok = (p: Point, others: Point[]) => inBox(p) && inBounds(p) && dry(p, 2) && spaced(p, others);
  for (let attempt = 0; attempt < 300 && !trunkSpots; attempt += 1) {
    const a = rng() * Math.PI * 2;
    const l1 = TRUNK_LEGS[0] * between(rng, 0.88, 1.12), l2 = TRUNK_LEGS[1] * between(rng, 0.88, 1.12);
    const m = { x: Math.round(city.x + Math.cos(a) * l1), y: Math.round(city.y + Math.sin(a) * l1) };
    const b = a + between(rng, -0.6, 0.6);
    const s2 = { x: Math.round(m.x + Math.cos(b) * l2), y: Math.round(m.y + Math.sin(b) * l2) };
    const legs = [distance(city, m), distance(m, s2)];
    if (legs.some((leg, k) => Math.abs(leg - TRUNK_LEGS[k]!) > TRUNK_LEGS[k]! * TRUNK_LENGTH_TOLERANCE)) continue;
    if (distance(city, s2) < TRUNK_STRAIGHTNESS * (legs[0]! + legs[1]!)) continue;
    if (ok(m, [city]) && ok(s2, [city, m])) trunkSpots = [m, s2];
  }
  if (!trunkSpots) return reject("trunk");
  const spots: Point[] = [city, ...trunkSpots];
  for (let attempt = 0; attempt < 4000 && spots.length < SIZES.length; attempt += 1) {
    const p = { x: Math.round(between(rng, box.x, box.x + HOME_W - 1)), y: Math.round(between(rng, box.y, box.y + HOME_H - 1)) };
    if (ok(p, spots)) spots.push(p);
  }
  if (spots.length < SIZES.length) return reject("home towns");
  const [middle, second] = [1, 2];
  let serial = 0;
  const placeholder = () => { serial += 1; return { id: `wf${serial}`, name: `Wf ${serial}` }; };
  const order = [0, middle, second, ...shuffle(rng, spots.map((_, i) => i).filter((i) => i !== 0 && i !== middle && i !== second))];
  const sizes = new Map<number, number>([[0, SIZES[0]!], [second, SIZES[1]!], [middle, SIZES[2]!]]);
  order.slice(3).forEach((i, k) => sizes.set(i, SIZES[3 + k]!));
  const homeTowns: GameTown[] = spots.map((p, i) => ({ ...placeholder(), x: p.x, y: p.y, population: sizes.get(i)! }));
  const towns: GameTown[] = [...homeTowns];
  const roads: GameRoadDef[] = [{ a: homeTowns[0]!.id, b: homeTowns[middle]!.id }, { a: homeTowns[middle]!.id, b: homeTowns[second]!.id }];
  const at = (id: string) => towns.find((t) => t.id === id)!;
  const clearOfTowns = (a: GameTown, b: GameTown) => towns.every((t) => t === a || t === b || toSegment(t, a, b) >= ROAD_CLEARANCE);
  const clearOfRoads = (a: GameTown, b: GameTown) => roads.every((r) => !crosses(a, b, at(r.a), at(r.b)));
  if (!clearOfTowns(homeTowns[0]!, homeTowns[middle]!) || !clearOfTowns(homeTowns[middle]!, homeTowns[second]!)) return reject("trunk clear");
  // Spurs, Prim's way; 2-3 towns off the trunk left cut off.
  const offTrunk = order.slice(3).map((i) => homeTowns[i]!);
  const cutOff = new Set(shuffle(rng, offTrunk).slice(0, rng() < 0.5 ? 2 : 3));
  const joined = new Set([homeTowns[0]!, homeTowns[middle]!, homeTowns[second]!]);
  for (;;) {
    let best: [GameTown, GameTown, number] | null = null;
    for (const t of offTrunk) {
      if (joined.has(t) || cutOff.has(t)) continue;
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
  if (offTrunk.some((t) => !joined.has(t) && !cutOff.has(t))) return reject("spurs");
  const homeRoads = roads.length;
  // Sizes varied as the slice map's are; the city stays dominant.
  const sized: GameMapDef = { width: W, height: H, towns: homeTowns, roads };
  varyTownSizes(sized, rng);
  if (homeTowns.reduce((big, t) => (t.population > big.population ? t : big)) !== homeTowns[0]) return reject("dominant");

  // The far clusters: each centre the best of a few spots by the land it reaches that nothing yet
  // does (version 7's rule), a spot on the water counting a third more -- a region's towns stand on
  // its rivers. When the home city isn't on the sea and there is one, the first is on the coast.
  const homeOnSea = !!sea && !dryOf(sea ? [sea, ...water.filter((r) => r !== sea && !r.lake && r.points.some(([x, y]) => !dryOf([sea], { x, y }, 4)))] : [], city, 10);
  const nearWater = (p: Point, reach: number) => !dryOf(water.filter((r) => r !== sea && Math.max(...(r.widths ?? [r.width])) >= NAVIGABLE), p, reach);
  const land: Point[] = [];
  for (let y = REACH_STEP / 2; y < H; y += REACH_STEP) for (let x = REACH_STEP / 2; x < W; x += REACH_STEP) if (dryOf(water, { x, y }, 0)) land.push({ x, y });
  // What counts as the coast for a port: the sea, and water that reaches it within a few cells (a lagoon, a delta's arms, an estuary).
  const coastal = sea ? [sea, ...water.filter((r) => r !== sea && !r.lake && r.points.some(([x, y]) => !dryOf([sea], { x, y }, 4)))] : [];
  const centres: Point[] = [];
  const reached = (q: Point) => towns.some((t) => distance(t, q) <= REACH) || centres.some((c) => distance(c, q) <= SPREAD_RADIUS + REACH / 2);
  const unreached = (p: Point) => land.filter((q) => distance(p, q) <= SPREAD_RADIUS + REACH / 2 && !reached(q)).length * (nearWater(p, 6) ? 1.33 : 1);
  for (let attempt = 0; attempt < 3000 && centres.length < CLUSTERS; ) {
    const port = !!sea && !homeOnSea && centres.length === 0;
    let best: Point | null = null;
    for (let fits = 0; fits < SPREAD_FITS && attempt < 3000; attempt += 1) {
      const p = { x: Math.round(between(rng, 20, W - 21)), y: Math.round(between(rng, 18, H - 19)) };
      if (!inBounds(p) || !dry(p) || toBox(p, box) < HOME_GAP || centres.some((c) => distance(c, p) < CLUSTER_GAP)) continue;
      if (port && dryOf(coastal, p, WATER_CLEARANCE + 6)) continue; // a port is by the sea, a lagoon or a delta's arm near it
      fits += 1;
      if (!best || unreached(p) > unreached(best)) best = p;
    }
    if (best) centres.push(best);
  }
  if (centres.length < CLUSTERS) return reject("centres");
  const hubSizes = shuffle(rng, HUB_SIZES);
  const clusters: GameTown[][] = [];
  for (let c = 0; c < CLUSTERS; c += 1) {
    const centre = centres[c]!;
    const cspots: Point[] = [centre];
    for (let attempt = 0; attempt < 2000 && cspots.length < CLUSTER_TOWNS; attempt += 1) {
      const angle = rng() * Math.PI * 2;
      const r = between(rng, MIN_SPACING, SPREAD_RADIUS);
      const p = { x: Math.round(centre.x + Math.cos(angle) * r), y: Math.round(centre.y + Math.sin(angle) * r) };
      if (!inBounds(p) || !dry(p, 2) || !spaced(p, [...towns, ...cspots]) || toBox(p, box) < HOME_GAP / 2) continue;
      cspots.push(p);
    }
    if (cspots.length < MIN_CLUSTER) return reject("cluster towns");
    const cluster = cspots.map((p, i): GameTown => ({ ...placeholder(), x: p.x, y: p.y, population: i === 0 ? hubSizes[c]! : Math.round(Math.exp(between(rng, Math.log(SMALL_TOWN[0]), Math.log(SMALL_TOWN[1])))) }));
    towns.push(...cluster);
    clusters.push(cluster);
  }
  for (const cluster of clusters) {
    const cut = cluster[1 + Math.floor(rng() * (cluster.length - 1))]!;
    const linked = new Set<GameTown>([cluster[0]!]);
    for (;;) {
      let best: [GameTown, GameTown, number] | null = null;
      for (const t of cluster) {
        if (linked.has(t) || t === cut) continue;
        for (const j of linked) {
          if (!clearOfTowns(t, j) || !clearOfRoads(t, j)) continue;
          const d = distance(t, j);
          if (!best || d < best[2]) best = [t, j, d];
        }
      }
      if (!best) break;
      roads.push({ a: best[0].id, b: best[1].id });
      linked.add(best[0]);
    }
    if (cluster.some((t) => t !== cut && !linked.has(t))) return reject("cluster roads");
  }
  // Old highways: a spanning tree over the clusters, home included, shortest first.
  const hubs = clusters.map((c) => c[0]!);
  const groupOf = new Map<string, string>();
  for (const t of homeTowns) groupOf.set(t.id, "home");
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
  if (groups.componentCount() !== 1) return reject("highways");

  // River towns and fishing villages: places on the water, outside the home box, each joined by an old spur.
  const onTheWater = (count: number, sizes: [number, number], pick: (p: Point) => boolean) => {
    for (let k = 0, tries = 0; k < count && tries < 600; tries += 1) {
      const river = water[Math.floor(rng() * water.length)]!;
      const q = along(river, rng());
      const p = bankNear(rng, { x: q[0], y: q[1] }, BANK_CLEARANCE, 5, (s) => inBounds(s) && dry(s, BANK_CLEARANCE) && pick(s));
      if (!p || !spaced(p, towns) || toBox(p, box) < 8) continue;
      const town: GameTown = { ...placeholder(), x: p.x, y: p.y, population: Math.round(between(rng, sizes[0], sizes[1])) };
      const to = towns.filter((t) => roads.some((r) => r.a === t.id || r.b === t.id)).sort((a, b) => distance(p, a) - distance(p, b)).find((t) => distance(p, t) < 40 && clearOfTowns(town, t) && clearOfRoads(town, t));
      if (!to) continue;
      towns.push(town);
      roads.push({ a: town.id, b: to.id });
      k += 1;
    }
  };
  onTheWater(3 + Math.floor(rng() * 3), [8, 30], (p) => nearWater(p, 2.5));
  const still = water.filter((r) => r === sea || r.lake || (region === "southwest" && r === water[1]));
  if (still.length > 0) onTheWater(2 + Math.floor(rng() * 3), [3, 6], (p) => !dryOf(still, p, 3));

  // The seaport: the home city on the sea, else the coast cluster's regional town; a landlocked map's trade comes up the coast road (border.ts).
  const port = homeTowns[0]!.id;
  const seaport = sea ? (homeOnSea ? port : hubs[0]!.id) : port;
  // The old railway: from the home city to the port's cluster, else the nearest regional town; straight, through no town.
  const rails: GameRoadDef[] = [];
  const cityTown = homeTowns[0]!;
  const railTo = (sea && !homeOnSea ? [hubs[0]!, ...hubs.slice(1)] : [...hubs].sort((a, b) => distance(cityTown, a) - distance(cityTown, b)))
    .find((h) => towns.every((t) => t === cityTown || t === h || toSegment(t, cityTown, h) >= 2.5));
  if (railTo) rails.push({ a: cityTown.id, b: railTo.id });

  // A range of hills between two clusters, clear of every town and of the water.
  const hills: GameHillDef[] = [];
  let ridge: { a: readonly number[]; b: readonly number[] } | null = null;
  const pairs = shuffle(rng, [[box.x + HOME_W / 2, box.y + HOME_H / 2], ...centres.map((c) => [c.x, c.y])].flatMap((a, i, all) => all.slice(i + 1).map((b) => [a, b] as const)));
  for (const [a, b] of pairs) {
    const range: GameHillDef[] = [];
    const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) || 1;
    const [ux, uy] = [(b[0]! - a[0]!) / len, (b[1]! - a[1]!) / len];
    const [mx, my] = [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
    const span = Math.min(70, len * 0.9), bow = between(rng, -10, 10), tilt = between(rng, -0.35, 0.35);
    const count = Math.round(span / 6);
    for (let k = 0; k <= count; k += 1) {
      const t = k / count - 0.5, peak = Math.cos(Math.PI * t);
      const off = bow * (1 - 4 * t * t) + between(rng, -1.5, 1.5);
      const [dx, dy] = [-uy + ux * tilt, ux + uy * tilt];
      range.push({ x: Math.round(mx + dx * t * span + ux * off), y: Math.round(my + dy * t * span + uy * off), radius: Math.round(between(rng, 5, 7) + 3 * peak), height: Math.round((2.2 + 2.2 * peak) * between(rng, 8.5, 11.5)) / 10 });
    }
    if (range.every((h) => towns.every((t) => distance(t, h) >= h.radius + 2) && inBounds(h) && toBox(h, box) >= h.radius && dryOf(water, h, h.radius * 0.5))) {
      hills.push(...range);
      ridge = { a, b };
      break;
    }
  }
  const nearRidge = (c: Point) => (ridge ? Math.min(Math.hypot(c.x - ridge.a[0]!, c.y - ridge.a[1]!), Math.hypot(c.x - ridge.b[0]!, c.y - ridge.b[1]!)) : Infinity);
  const offers: Array<"limestone" | "farm"> = centres.map((c) => (nearRidge(c) < 1 ? "limestone" : "farm"));
  if (!offers.includes("limestone")) offers[centres.map(nearRidge).indexOf(Math.min(...centres.map(nearRidge)))] = "limestone";
  if (!offers.includes("farm") && offers.length > 1) offers[offers.length - 1] = "farm";

  const reliefSeed = Math.floor(hashed(seed, 7_000_003) * 2 ** 31);
  const relief = { seed: reliefSeed, ...(RELIEF[region] ?? RELIEF.southwest!) };
  let map: GameMapDef = {
    width: W, height: H, towns, roads, port, seaport, rails,
    terrain: { rivers: water, hills, relief }, region, home: box,
    clusters: clusters.map((cluster, k) => ({ hub: cluster[0]!.id, towns: cluster.map((t) => t.id), offer: offers[k]! })),
  };
  // The home cluster's land guarded by its trunk's prices (version 10's rule), then the roads beyond it over the land.
  const trunk: [string, string, string] = [homeTowns[0]!.id, homeTowns[middle]!.id, homeTowns[second]!.id];
  map = withHomeLand(map, trunk);
  const terrain = buildGameTerrain(map);
  for (const road of roads.slice(homeRoads)) {
    const plan = planCorridor(terrain, [at(road.a), at(road.b)], "auto", new Set([0, 1]));
    if (plan && plan.polyline.length > 2) road.via = straightened(terrain, plan.polyline).slice(1, -1).map((p): [number, number] => [p.x, p.y]);
  }
  // Every town reachable by building roads.
  const reach = new UnionFind(towns.map((t) => t.id));
  for (const road of roads) reach.union(road.a, road.b);
  for (const t of towns) {
    const nearest = towns.filter((o) => o !== t).sort((a, b) => distance(t, a) - distance(t, b)).slice(0, 3);
    for (const o of nearest) {
      if (reach.connected(t.id, o.id)) continue;
      if (planCorridor(terrain, [t, o], "auto", new Set([0, 1]))) reach.union(t.id, o.id);
    }
  }
  if (reach.componentCount() !== 1) return reject("reach");
  return { map, trunk, homeRoads, homeWhy };
}

/** A spot near `p` that passes `ok`: rings outward up to `radius` cells, a few tries a ring. */
function bankNear(rng: Rng, p: Point, _clearance: number, radius: number, ok: (q: Point) => boolean): Point | null {
  for (let r = 0; r <= radius; r += 0.75) {
    for (let k = 0; k < (r === 0 ? 1 : 10); k += 1) {
      const a = rng() * Math.PI * 2;
      const q = { x: Math.round(p.x + Math.cos(a) * r), y: Math.round(p.y + Math.sin(a) * r) };
      if (ok(q)) return q;
    }
  }
  return null;
}
