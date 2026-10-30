import type { TerrainField } from "../map/types";
import type { GameMapDef, ReliefDef } from "./types";

// The slice's terrain (docs/principles.md §6, step 3): authored, like the
// rest of its hand-made map, rather than generated -- a river and a ridge
// placed where they make a road a decision. Same TerrainField shape as
// engine/map, so engine/pathing plans and prices over it unchanged.
//
// Cells are sampled at their integer coordinates, the same points towns
// and the terrain A* use.

/** Distance from a point to a segment, and how far along the segment (0..1) the nearest point is. */
function nearestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { distance: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return { distance: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

export function buildGameTerrain(def: GameMapDef): TerrainField {
  const { width, height } = def;
  const elevation = new Float32Array(width * height);
  const water = new Uint8Array(width * height);
  const rivers = def.terrain?.rivers ?? [];
  const hills = def.terrain?.hills ?? [];

  // Rivers cut their valleys (your playtest, 2026-10-26: "the river through the mountain" --
  // a river ran over the range, in 2D and 3D): the ground falls to the water's level at its
  // banks, back to the hill's own height VALLEY cells out. A range a river crosses has a gorge.
  const valleys = !!def.terrain?.valleys;
  const VALLEY = 5;
  // Each river segment marks only the cells within its half-width and a valley's reach of it:
  // past that a cell is dry and its valley factor 1 whatever the distance, so the result is the
  // same as checking every cell against every segment -- which, once rivers were smoothed into
  // hundreds of segments (map version 2), took 2 s a map (2026-10-28).
  const bankOf = new Float64Array(width * height).fill(Infinity);
  for (const river of rivers) {
    for (let k = 1; k < river.points.length; k += 1) {
      const [ax, ay] = river.points[k - 1]!;
      const [bx, by] = river.points[k]!;
      const widest = river.widths ? Math.max(river.widths[k - 1]!, river.widths[k]!) : river.width;
      const reach = widest / 2 + VALLEY + 1;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach)), x1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + reach));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - reach)), y1 = Math.min(height - 1, Math.ceil(Math.max(ay, by) + reach));
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const i = y * width + x;
          const { distance, t } = nearestOnSegment(x, y, ax, ay, bx, by);
          // A river narrows and widens between its points: a narrow stretch is a cheap crossing.
          const w = river.widths ? river.widths[k - 1]! + (river.widths[k]! - river.widths[k - 1]!) * t : river.width;
          if (distance <= w / 2) water[i] = 1;
          if (distance - w / 2 < bankOf[i]!) bankOf[i] = distance - w / 2;
        }
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const bank = bankOf[i]!;
      // A hill is a smooth bump: full height at its centre, zero at its
      // radius. Elevation isn't bounded to 0..1 here -- the slice decides
      // water explicitly, so a hill is as high as its climb should cost.
      for (const hill of hills) {
        const d = Math.hypot(x - hill.x, y - hill.y) / hill.radius;
        if (d < 1) elevation[i] += hill.height * (1 - d * d) ** 2;
      }
      if (valleys && elevation[i]! > 0) {
        const v = Math.max(0, Math.min(1, bank / VALLEY));
        elevation[i] = elevation[i]! * v * v * (3 - 2 * v);
      }
    }
  }

  if (def.terrain?.relief) addRelief(def, def.terrain.relief, elevation, water);

  for (const town of def.towns) {
    if (water[Math.round(town.y) * width + Math.round(town.x)] === 1) throw new Error(`slice map: town ${town.id} is in water`);
  }
  return { width, height, elevation, water, settlementDensity: new Float32Array(width * height) };
}

// --- The land first (map version 7; the scope of 2026-10-30, A1-A2) --------------------------
// Beyond the home cluster the land was a plain with hills set on it, and the rivers drawn across
// it on their own -- so they ran over rises, and the land between them said nothing. Now a relief
// shaped by the water: lowest along the rivers and the coast, swelling between them into the
// country that drains to them, by region (rolling, ridged, a plateau behind its escarpment). It
// is nothing in the home cluster's box (its trunk's prices are as measured), fading in over ten
// cells past it; it lies flat round every town; and it eases where the old roads and the railway
// run, so they keep to their valleys. Pure: a seed and a few numbers on the map, the same land
// whenever the map is drawn, so a run file replays it.

const BASIN = 14; // cells from the water to the full height of the land between rivers
const HOME_FADE = 24;
const TOWN_FLAT = 8;
const ROAD_EASE = 3;
const HEAD_REACH = 13;
const HEAD_HEIGHT = 1.6;

function smooth01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Hashed value noise, 0..1, on a lattice of `scale` cells -- each octave `k` on its own turned and
 * shifted lattice, so stacked octaves don't line up into straight bands (they did, axis-aligned).
 */
function valueNoise(seed: number, px: number, py: number, scale: number, k: number): number {
  const turn = 0.6 + k * 1.13;
  const c = Math.cos(turn), sn = Math.sin(turn);
  const x = px * c - py * sn + k * 31.7, y = px * sn + py * c + k * 17.3;
  const hash = (ix: number, iy: number) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed + k * 7919, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const gx = x / scale, gy = y / scale, x0 = Math.floor(gx), y0 = Math.floor(gy);
  const tx = smooth01(gx - x0), ty = smooth01(gy - y0);
  return (hash(x0, y0) * (1 - tx) + hash(x0 + 1, y0) * tx) * (1 - ty) + (hash(x0, y0 + 1) * (1 - tx) + hash(x0 + 1, y0 + 1) * tx) * ty;
}

/** Distance in cells to the nearest marked cell (a two-pass chamfer: 1 straight, 1.4 diagonal). */
function distanceFrom(marked: Uint8Array, width: number, height: number): Float32Array {
  const d = new Float32Array(width * height).fill(1e6);
  for (let i = 0; i < marked.length; i += 1) if (marked[i]) d[i] = 0;
  const pass = (x: number, y: number, dx: number, dy: number, cost: number) => {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
    const i = y * width + x, j = ny * width + nx;
    if (d[j]! + cost < d[i]!) d[i] = d[j]! + cost;
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    pass(x, y, -1, 0, 1); pass(x, y, 0, -1, 1); pass(x, y, -1, -1, 1.4); pass(x, y, 1, -1, 1.4);
  }
  for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
    pass(x, y, 1, 0, 1); pass(x, y, 0, 1, 1); pass(x, y, 1, 1, 1.4); pass(x, y, -1, 1, 1.4);
  }
  return d;
}

function addRelief(def: GameMapDef, relief: ReliefDef, elevation: Float32Array, water: Uint8Array): void {
  const { width, height } = def;
  const fromWater = distanceFrom(water, width, height);
  // The old roads and the railway, rasterised: the land eases where they run.
  const roadCells = new Uint8Array(width * height);
  const at = new Map(def.towns.map((t) => [t.id, t]));
  for (const road of [...def.roads, ...(def.rails ?? [])]) {
    const a = at.get(road.a), b = at.get(road.b);
    if (!a || !b) continue;
    const line: Array<[number, number]> = [[a.x, a.y], ...(road.via ?? []), [b.x, b.y]];
    for (let k = 1; k < line.length; k += 1) {
      const [ax, ay] = line[k - 1]!, [bx, by] = line[k]!;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
      for (let i = 0; i <= n; i += 1) {
        const x = Math.round(ax + ((bx - ax) * i) / n), y = Math.round(ay + ((by - ay) * i) / n);
        if (x >= 0 && y >= 0 && x < width && y < height) roadCells[y * width + x] = 1;
      }
    }
  }
  const fromRoad = distanceFrom(roadCells, width, height);
  const box = def.home;
  const towns = def.towns;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (water[i]) continue;
      // Nothing in the home cluster, fading in past it.
      let mask = 1;
      if (box) {
        const dx = Math.max(box.x - x, 0, x - (box.x + box.width - 1));
        const dy = Math.max(box.y - y, 0, y - (box.y + box.height - 1));
        mask = smooth01(Math.hypot(dx, dy) / HOME_FADE);
      }
      if (mask === 0) continue;
      // A town in a gentle dip, not a pit; a road a little eased, not a trench.
      for (const t of towns) {
        const d = Math.hypot(t.x - x, t.y - y);
        if (d < TOWN_FLAT) mask *= 0.35 + 0.65 * smooth01(d / TOWN_FLAT);
      }
      mask *= 0.8 + 0.2 * smooth01(fromRoad[i]! / ROAD_EASE);
      // The land between the rivers: four octaves on a slowly warped ground, ridged in steep country.
      const wx = x + (valueNoise(relief.seed, x, y, relief.scale * 1.7, 7) - 0.5) * relief.scale * 0.6;
      const wy = y + (valueNoise(relief.seed, x, y, relief.scale * 1.7, 8) - 0.5) * relief.scale * 0.6;
      let n = 0.45 * valueNoise(relief.seed, wx, wy, relief.scale, 1) + 0.28 * valueNoise(relief.seed, wx, wy, relief.scale / 2.1, 2) + 0.17 * valueNoise(relief.seed, wx, wy, relief.scale / 4.3, 3) + 0.1 * valueNoise(relief.seed, wx, wy, relief.scale / 9, 4);
      if (relief.ridged) n = 1 - Math.abs(2 * n - 1);
      let lift = relief.amplitude * (0.2 + 0.8 * n) * smooth01(fromWater[i]! / BASIN);
      // A plateau: its top level, its edge an escarpment two or three cells deep.
      for (const p of relief.plateaus ?? []) {
        const c = Math.cos(p.turn), s = Math.sin(p.turn);
        const u = ((x - p.x) * c + (y - p.y) * s) / p.rx, v = (-(x - p.x) * s + (y - p.y) * c) / p.ry;
        const r = Math.hypot(u, v);
        const edge = 2.5 / Math.min(p.rx, p.ry);
        if (r < 1 + edge) lift += p.height * smooth01((1 + edge - r) / edge) * smooth01(fromWater[i]! / 4);
      }
      // Headwaters: a river rises in hills, not out of the plain (your look, 2026-10-30: "the flow is weird").
      for (const h of relief.heads ?? []) {
        const d = Math.hypot(x - h.x, y - h.y);
        if (d < HEAD_REACH) lift += HEAD_HEIGHT * smooth01(1 - d / HEAD_REACH) * smooth01(fromWater[i]! / 3);
      }
      elevation[i] = elevation[i]! + lift * mask;
    }
  }
}
