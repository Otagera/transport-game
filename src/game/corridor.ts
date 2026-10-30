import type { GameWorld } from "@engine/game/types";
import type { Segment } from "@engine/map/types";

// The corridor's geometry and encoding, kept apart from the canvas so it can be tested
// (docs/architecture/look.md, Corridor encoding and Corridor geometry): one meaning per channel --
// width the rung, colour the congestion, the centreline core your service -- and a road drawn as
// one object, its offsets mitred, meeting its neighbours at a filled junction plate.

export interface P { x: number; y: number }

/** How far a mitred offset may reach past `d` at a sharp bend (a hairpin would send it to infinity). */
export const MITER_LIMIT = 4;

/** The unit normal to the left of a -> b. */
function normal(a: P, b: P): P {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
}

/**
 * A vertex moved `d` to the left of its line, along the bisector of its two segments' normals and
 * by `d / cos(θ/2)`, so the offset runs parallel through a bend instead of pinching toward the
 * centreline (central differences pinched 30% at a right angle). Capped at MITER_LIMIT × d.
 */
export function offsetPoint(prev: P, p: P, next: P, d: number): P {
  const n1 = normal(prev, p);
  const n2 = normal(p, next);
  let mx = n1.x + n2.x;
  let my = n1.y + n2.y;
  const m = Math.hypot(mx, my) || 1;
  mx /= m;
  my /= m;
  const cos = mx * n1.x + my * n1.y; // cos(θ/2)
  const scale = Math.min(MITER_LIMIT, 1 / Math.max(1 / MITER_LIMIT, cos));
  return { x: p.x + mx * d * scale, y: p.y + my * d * scale };
}

/** A polyline offset `d` to its left, mitred; its ends by their one segment's normal. */
export function offsetPolyline(points: P[], d: number): P[] {
  if (points.length < 2) return points.slice();
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) {
      const [a, b] = i === 0 ? [p, points[1]!] : [points[i - 1]!, p];
      const n = normal(a, b);
      return { x: p.x + n.x * d, y: p.y + n.y * d };
    }
    return offsetPoint(points[i - 1]!, p, points[i + 1]!, d);
  });
}

// --- Congestion -> colour, with headroom ----------------------------------------------------------

/** The ramp's stops over load (flow and private cars over capacity): look.md, Corridor encoding. */
export interface RampStops { freeBelow: number; busyFrom: number; busyTo: number; jammedAt: number }
export const RAMP: RampStops = { freeBelow: 0.5, busyFrom: 0.85, busyTo: 1, jammedAt: 1.5 };

/** Below this speed a road reads jammed whatever its load (a low-capacity road at a crawl). */
export const JAMMED_SPEED = 0.7;

/**
 * Where a load sits on the ramp: the two colours either side and how far between them (0..1).
 * Free to 0.5; free into busy to 0.85; busy to 1; busy into jammed by 1.5; jammed past it.
 */
export function congestionStop(load: number, speed = 1, stops: RampStops = RAMP): { from: "free" | "busy" | "jammed"; to: "free" | "busy" | "jammed"; t: number } {
  if (speed < JAMMED_SPEED) return { from: "jammed", to: "jammed", t: 0 };
  if (load <= stops.freeBelow) return { from: "free", to: "free", t: 0 };
  if (load < stops.busyFrom) return { from: "free", to: "busy", t: (load - stops.freeBelow) / (stops.busyFrom - stops.freeBelow) };
  if (load <= stops.busyTo) return { from: "busy", to: "busy", t: 0 };
  if (load < stops.jammedAt) return { from: "busy", to: "jammed", t: (load - stops.busyTo) / (stops.jammedAt - stops.busyTo) };
  return { from: "jammed", to: "jammed", t: 0 };
}

/** Past the ramp's top: drawn with a dash over the jammed body, so 150% and 400% differ (look.md §7: still, not moving). */
export function overloaded(load: number, stops: RampStops = RAMP): boolean {
  return load > stops.jammedAt;
}

/** Two "#rrggbb" colours mixed, t from a toward b. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.replace("#", ""), 16);
  const pb = parseInt(b.replace("#", ""), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) + ((((pb >> shift) & 255) - ((pa >> shift) & 255)) * t));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** The body's colour for a load, from the three road tokens. */
export function congestionColor(load: number, speed: number, colors: { free: string; busy: string; jammed: string }, stops: RampStops = RAMP): string {
  const s = congestionStop(load, speed, stops);
  return s.from === s.to ? colors[s.from] : mixHex(colors[s.from], colors[s.to], s.t);
}

// --- Junction plates ------------------------------------------------------------------------

export interface Plate {
  node: string;
  x: number;
  y: number;
  /** Half the widest body meeting here, map-scale units (the casing is added when drawn). */
  radius: number;
  /** The live roads meeting here (none: a rail junction). */
  roads: string[];
  rail: boolean;
}

/**
 * Every node where two or more live pieces meet: one plate each, as wide as the widest of them, so
 * a junction reads as one place instead of N round caps at N points. A dead end keeps its cap.
 * `live` says which pieces count (not retired); `width`, a piece's body width.
 */
export function junctionPlates(world: GameWorld, live: (s: Segment) => boolean, width: (s: Segment) => number): Plate[] {
  const at = new Map<string, Segment[]>();
  for (const s of world.simulation.map.segments) {
    if (!live(s)) continue;
    for (const n of [s.fromNodeId, s.toNodeId]) at.set(n, [...(at.get(n) ?? []), s]);
  }
  const position = new Map(world.simulation.map.nodes.map((n) => [n.id, n]));
  const plates: Plate[] = [];
  for (const [node, pieces] of at) {
    if (pieces.length < 2) continue;
    const p = position.get(node);
    if (!p) continue;
    const roads = pieces.filter((s) => s.type !== "rail");
    plates.push({ node, x: p.x, y: p.y, radius: Math.max(...pieces.map(width)) / 2, roads: roads.map((s) => s.id), rail: roads.length === 0 });
  }
  return plates;
}
