// Shared corridors drawn side by side (render.ts; your word, 2026-11-04: "start with the core").
// In a busy core the roads, track and pipes you've built between the same towns run along almost
// the same ground -- each routed on its own, a cell or two apart -- and drawn where they run they
// braided over and under each other into one tangle. Drawn here, where two run alongside (near
// parallel, closer than their widths) each is moved sideways until they lie side by side, a couple
// of pixels apart, like a transit map's lines; they come back to their own line toward either end,
// so they still meet at the town; lines that only cross are left as they are. Screen pixels, so
// the lanes stay apart at any zoom. No canvas here: lines in, lines out (map cells).

import type { Point } from "@engine/game/roads";

export interface BundleItem {
  id: string;
  /** Its line, map cells. */
  line: Point[];
  /** How wide it's drawn, screen px (its casing too). */
  width: number;
  /** Which way it goes in a bundle, lowest to the left (of the map's left-to-right): roads, then track, then pipes. */
  rank: number;
}

/** Between two lines side by side, screen px. */
const GAP = 1.5;
/** How far apart the points it works on are, screen px. */
const STEP = 4;
/** Two lines this near parallel (radians) run alongside; steeper, they cross. */
const PARALLEL = Math.cos((28 * Math.PI) / 180);

interface Sample { x: number; y: number; tx: number; ty: number; nx: number; ny: number; end: number; o: number }

/** A line's points every `step` cells, each with its heading's unit vector and normal, and how far (cells) from its nearer end. */
function resample(line: Point[], step: number): Sample[] {
  const out: Sample[] = [];
  if (line.length < 2) return out;
  const cum = [0];
  for (let k = 1; k < line.length; k += 1) cum.push(cum[k - 1]! + Math.hypot(line[k]!.x - line[k - 1]!.x, line[k]!.y - line[k - 1]!.y));
  const total = cum[cum.length - 1]!;
  if (total <= 0) return out;
  let k = 1, tx = 1, ty = 0;
  for (let d = 0; ; d += step) {
    const along = Math.min(d, total);
    while (k < line.length - 1 && cum[k]! < along) k += 1;
    const a = line[k - 1]!, b = line[k]!, len = cum[k]! - cum[k - 1]!;
    if (len > 1e-9) { tx = (b.x - a.x) / len; ty = (b.y - a.y) / len; }
    const u = len > 1e-9 ? (along - cum[k - 1]!) / len : 0;
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, tx, ty, nx: -ty, ny: tx, end: Math.min(along, total - along), o: 0 });
    if (along >= total) break;
  }
  return out;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Each line moved sideways where it runs alongside another, at `scale` screen px a map cell: side
 * by side, `GAP` px apart, back on its own line within `endPx` of either end. Lines in no bundle
 * come back as they were (the same array).
 */
export function bundleLines(items: readonly BundleItem[], scale: number, endPx = 14): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  if (scale <= 0 || items.length === 0) return out;
  // Every STEP px, but no closer than a quarter cell: zoomed in, the cost stays down.
  const step = Math.max(STEP / scale, 0.25);
  const samples = items.map((item) => resample(item.line, step));
  const widest = Math.max(...items.map((i) => i.width));
  const reach = (widest + GAP) / scale;
  // Where each sample is, by a grid a reach across: its neighbours are in the cells round it.
  const cell = reach * 1.5;
  const grid = new Map<number, Array<[number, number]>>();
  const at = (gx: number, gy: number) => (gx + 4096) * 8192 + (gy + 4096);
  samples.forEach((list, item) => list.forEach((s, k) => {
    const key = at(Math.floor(s.x / cell), Math.floor(s.y / cell));
    (grid.get(key) ?? grid.set(key, []).get(key)!).push([item, k]);
  }));
  // Which of two goes to which side when they lie exactly on one another: by rank, then id, on a
  // side fixed for the map (a normal turned to point east, or south), so every pair agrees.
  const before = (a: number, b: number) => items[a]!.rank < items[b]!.rank || (items[a]!.rank === items[b]!.rank && items[a]!.id < items[b]!.id);
  const canonical = (s: Sample) => (s.nx > 1e-9 || (Math.abs(s.nx) <= 1e-9 && s.ny > 0) ? 1 : -1);
  const fadeAt = (s: Sample) => smoothstep(endPx, endPx * 2.5, s.end * scale);
  const limit = (reach * 4);
  let moved = false;
  for (let round = 0; round < 5; round += 1) {
    const deltas = samples.map((list) => new Float64Array(list.length));
    let any = false;
    samples.forEach((list, item) => list.forEach((s, k) => {
      if (fadeAt(s) <= 0) return;
      const sx = s.x + s.nx * s.o, sy = s.y + s.ny * s.o;
      const cx = Math.floor(s.x / cell), cy = Math.floor(s.y / cell);
      let sum = 0, n = 0;
      for (let gy = cy - 1; gy <= cy + 1; gy += 1) for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
        for (const [other, j] of grid.get(at(gx, gy)) ?? []) {
          if (other === item) continue;
          const t = samples[other]![j]!;
          if (Math.abs(s.tx * t.tx + s.ty * t.ty) < PARALLEL) continue;
          const dx = t.x + t.nx * t.o - sx, dy = t.y + t.ny * t.o - sy;
          if (Math.abs(dx * s.tx + dy * s.ty) > step * 1.2) continue;
          const across = dx * s.nx + dy * s.ny;
          const gap = ((items[item]!.width + items[other]!.width) / 2 + GAP) / scale;
          if (Math.abs(across) >= gap) continue;
          const away = Math.abs(across) > 1e-6 ? -Math.sign(across) : (before(item, other) ? 1 : -1) * canonical(s);
          sum += (away * (gap - Math.abs(across))) / 2;
          n += 1;
        }
      }
      if (n) {
        deltas[item]![k] = sum / n;
        any = true;
      }
    }));
    if (!any) break;
    moved = true;
    // Moved all at once; then eased along each line (no kinks), back toward its ends, held in reach.
    samples.forEach((list, item) => {
      const d = deltas[item]!;
      const next = list.map((s, k) => s.o + d[k]!);
      list.forEach((s, k) => {
        let sum = 0, n = 0;
        for (let m = Math.max(0, k - 4); m <= Math.min(list.length - 1, k + 4); m += 1) { sum += next[m]!; n += 1; }
        s.o = Math.max(-limit, Math.min(limit, (sum / n) * fadeAt(s)));
      });
    });
  }
  items.forEach((item, k) => {
    const list = samples[k]!;
    if (!moved || list.every((s) => Math.abs(s.o) < 1e-6)) {
      out.set(item.id, item.line);
      return;
    }
    out.set(item.id, list.map((s) => ({ x: s.x + s.nx * s.o, y: s.y + s.ny * s.o })));
  });
  return out;
}
