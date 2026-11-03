// A rail town's station in 3D (view3d.ts), laid out from the network: where it stands, which way
// it lies, a platform track for each line through it, and the throats that bring each line's
// track in to its own platform. No three.js here -- the layout, and where a train on it is drawn.
//
// The game's trains have no platforms: a line's track runs to the town's node, every line's to
// the same point, and a train loads the moment it gets there (no dwell). Drawn as it ran, the
// trains of a hub met in one heap in the middle of the town (your playtest, map 8703 day 482:
// Otido, six lines and the freight). Drawn here, each line has its own track through the town,
// so they fan out into the station and stand beside each other at its platforms.
//
// Positions are map cells, as the map's; lengths metres (M a cell), as the 3D view's.

import type { GameWorld } from "@engine/game/types";
import { polylineLength, segmentPolyline, splitPolyline, type Point } from "@engine/game/roads";
import { railPath } from "@engine/game/rail";
import { isFreightRoute } from "@engine/game/goods";

const M = 8;
/** Between the platform's end and where its throat leaves the open line, metres. */
export const THROAT = 44;
/** A track's centre to the next one's, across an island platform and between pairs, metres. */
const ACROSS_ISLAND = 9;
const BETWEEN_PAIRS = 5.5;
const FREIGHT_GAP = 5;
export const PLATFORM_WIDTH = 6;

export interface StationTrack {
  /** The line it's for; "" where no line runs yet. */
  routeId: string;
  freight: boolean;
  /** Across the station from its centre line, metres (+ toward `normal`). */
  offset: number;
  /** An island platform's centre beside it, metres across, if it has one (a freight loop hasn't). */
  platform: number | null;
}
export interface StationEnd {
  segmentId: string;
  /** Which end of the station the track comes in at: +1 along `axis`, -1 against it. */
  side: 1 | -1;
  /** From the town's node along the open line, metres, where its throat begins. */
  reach: number;
  /** From the station's centre along its axis, metres, where the throat meets the platform track. */
  join: number;
  /** The open line's point at `reach`, and its heading there toward the town (radians, map frame). */
  outer: Point;
  inward: number;
}
export interface Station {
  id: string;
  node: Point;
  centre: Point;
  /** Which way its tracks run (radians, map frame), and across them. */
  axis: number;
  /** Half its platforms' length, metres. */
  half: number;
  tracks: StationTrack[];
  ends: Map<string, StationEnd>;
  /** Across all its tracks and platforms, metres: its footprint is 2*half+margin by width. */
  width: number;
  /** Which tracks each segment's throats lead to (indices into `tracks`). */
  throats: Map<string, number[]>;
  key: string;
}

/** Half a platform by the town's size at the station's first drawing, kept: re-cut track flickers. */
const halves = new WeakMap<GameWorld, Map<string, number>>();
function halfFor(world: GameWorld, id: string): number {
  const known = halves.get(world) ?? halves.set(world, new Map()).get(world)!;
  if (!known.has(id)) {
    const people = world.towns.get(id)?.population ?? 0;
    known.set(id, people < 25 ? 34 : people < 80 ? 44 : 52);
  }
  return known.get(id)!;
}

/** The town nodes with track, each a station: live rail segments only, sites aside (their sidings are the site's). */
export function stationNodes(world: GameWorld): Set<string> {
  const out = new Set<string>();
  for (const s of world.simulation.map.segments) {
    if (s.type !== "rail" || s.retiredAt !== undefined) continue;
    for (const id of [s.fromNodeId, s.toNodeId]) if (world.towns.has(id) && !world.towns.get(id)!.industry) out.add(id);
  }
  return out;
}

/** How far from a station's node its throat reaches along a segment, metres (0 off a station). */
export function reachAlong(world: GameWorld, node: string, segmentLengthCells: number, stations: Set<string>): number {
  if (!stations.has(node)) return 0;
  return Math.min(halfFor(world, node) + THROAT, 0.45 * segmentLengthCells * M);
}

/** A segment's polyline from `node` outward. */
function outward(world: GameWorld, segmentId: string, node: string): Point[] | null {
  const segment = world.simulation.map.segments.find((s) => s.id === segmentId);
  if (!segment) return null;
  const line = segmentPolyline(world.simulation.map, segment);
  return segment.fromNodeId === node ? line : [...line].reverse();
}

/**
 * Every station, laid out: its lines' tracks across it, ordered so each line's comes in on the
 * side its track arrives from; its axis the way most of its track runs; its centre on the town's
 * node, or beside it -- where the fewest roads cross it, nothing's in its way (`blocked`: water, a
 * site's yard, the quay), and its lines come in shortest. `roads` the live roads' lines.
 */
export function layStations(world: GameWorld, roads: Point[][], blocked: (x: number, y: number) => boolean = () => false): Map<string, Station> {
  const nodes = stationNodes(world);
  const out = new Map<string, Station>();
  // Each line through each station, by the segments it uses there.
  const lines = [...world.routes.filter((r) => r.id.startsWith("rail:")), ...world.lorryRoutes.filter((r) => isFreightRoute(r.id))];
  const using = new Map<string, Array<{ routeId: string; freight: boolean; segments: string[] }>>();
  for (const line of lines) {
    const path = railPath(world, line.a, line.b);
    if (!path) continue;
    path.nodeIds.forEach((id, i) => {
      if (!nodes.has(id)) return;
      const segments = [path.segmentIds[i - 1], path.segmentIds[i]].filter((s): s is string => !!s);
      (using.get(id) ?? using.set(id, []).get(id)!).push({ routeId: line.id, freight: isFreightRoute(line.id), segments });
    });
  }
  for (const id of nodes) {
    const town = world.towns.get(id)!;
    const node = world.railRouting.positions.get(id) ?? { x: town.x, y: town.y };
    const half = halfFor(world, id);
    const segments = world.simulation.map.segments.filter((s) => s.type === "rail" && s.retiredAt === undefined && (s.fromNodeId === id || s.toNodeId === id));
    // Each segment's way out: its point a throat's length along.
    const out0 = new Map<string, { theta: number; line: Point[]; length: number }>();
    for (const s of segments) {
      const line = outward(world, s.id, id);
      if (!line) continue;
      const length = polylineLength(line);
      const [, rest] = splitPolyline(line, Math.min(length * 0.45, (half + THROAT) / M));
      const p = rest[0] ?? line[line.length - 1]!;
      out0.set(s.id, { theta: Math.atan2(p.y - node.y, p.x - node.x), line, length });
    }
    if (out0.size === 0) continue;
    // The axis: the way most of its track runs (angles doubled, so in and out count the same).
    let sx = 0, sy = 0;
    for (const { theta } of out0.values()) { sx += Math.cos(2 * theta); sy += Math.sin(2 * theta); }
    const axis = out0.size === 1 ? [...out0.values()][0]!.theta : 0.5 * Math.atan2(sy, sx);
    const along = { x: Math.cos(axis), y: Math.sin(axis) }, across = { x: -Math.sin(axis), y: Math.cos(axis) };
    const sideOf = (theta: number): 1 | -1 => (Math.cos(theta - axis) >= 0 ? 1 : -1);
    const lateral = (theta: number) => Math.sin(theta - axis);
    // Its lines, each to the side its track comes in from; passenger lines in the middle at the
    // platforms, freight on loops outside them.
    const here = using.get(id) ?? [];
    const pref = (u: { segments: string[] }) => {
      const ts = u.segments.map((s) => out0.get(s)?.theta).filter((t): t is number => t !== undefined);
      return ts.length ? ts.reduce((sum, t) => sum + lateral(t), 0) / ts.length : 0;
    };
    const passengers = here.filter((u) => !u.freight).sort((a, b) => pref(a) - pref(b) || a.routeId.localeCompare(b.routeId));
    const freight = here.filter((u) => u.freight).sort((a, b) => pref(a) - pref(b) || a.routeId.localeCompare(b.routeId));
    const tracks: StationTrack[] = [];
    const pax = passengers.length ? passengers : freight.length ? [] : [{ routeId: "", freight: false, segments: [...out0.keys()] }];
    // Island platforms between pairs: track, platform, track; then the next pair.
    let x = 0;
    pax.forEach((u, i) => {
      const second = i % 2 === 1;
      if (i > 0 && !second) x += BETWEEN_PAIRS;
      if (second) x += ACROSS_ISLAND;
      tracks.push({ routeId: u.routeId, freight: false, offset: x, platform: null });
    });
    for (let i = 0; i < tracks.length; i += 2) {
      const a = tracks[i]!, b = tracks[i + 1];
      const centre = b ? (a.offset + b.offset) / 2 : a.offset + ACROSS_ISLAND / 2;
      a.platform = centre;
      if (b) b.platform = centre;
    }
    const left = freight.filter((u) => pref(u) < 0), right = freight.filter((u) => pref(u) >= 0);
    const lo = tracks.length ? Math.min(...tracks.map((t) => t.offset)) : 0;
    const hi = tracks.length ? Math.max(...tracks.map((t) => t.offset), ...tracks.map((t) => (t.platform ?? -Infinity) + PLATFORM_WIDTH / 2 + 2)) : 0;
    left.reverse().forEach((u, i) => tracks.unshift({ routeId: u.routeId, freight: true, offset: lo - FREIGHT_GAP * (i + 1), platform: null }));
    right.forEach((u, i) => tracks.push({ routeId: u.routeId, freight: true, offset: hi + FREIGHT_GAP * (i + 1), platform: null }));
    // Centred on the station's centre line.
    const min = Math.min(...tracks.map((t) => t.offset), ...tracks.map((t) => (t.platform ?? Infinity) - PLATFORM_WIDTH / 2));
    const max = Math.max(...tracks.map((t) => t.offset), ...tracks.map((t) => (t.platform ?? -Infinity) + PLATFORM_WIDTH / 2));
    const mid = (min + max) / 2;
    for (const t of tracks) {
      t.offset -= mid;
      if (t.platform !== null) t.platform -= mid;
    }
    const width = max - min + 6;
    // Its centre: on the node, or beside it -- wherever the fewest roads cross it, nothing is in
    // its way, and its lines' throats run shortest (a station off to one side, the lines from
    // the other side crossed the whole town to reach it: Otido, the first try).
    const ways = [...out0].map(([segmentId, o]) => {
      const reach = Math.min(half + THROAT, 0.45 * o.length * M);
      const [, rest] = splitPolyline(o.line, reach / M);
      return { segmentId, side: sideOf(o.theta), p: rest[0] ?? o.line[o.line.length - 1]! };
    });
    const score = (k: number, shift: number) => {
      let n = 0;
      for (const road of roads) {
        if (!road.some((p) => Math.hypot(p.x - node.x, p.y - node.y) * M < half + width + 80)) continue;
        for (let i = 1; i < road.length; i += 1) {
          const a = road[i - 1]!, b = road[i]!;
          const steps = Math.max(1, Math.ceil((Math.hypot(b.x - a.x, b.y - a.y) * M) / 3));
          for (let j = 0; j <= steps; j += 1) {
            const px = (a.x + ((b.x - a.x) * j) / steps - node.x) * M, py = (a.y + ((b.y - a.y) * j) / steps - node.y) * M;
            const u = px * along.x + py * along.y - shift, v = px * across.x + py * across.y - k;
            if (Math.abs(u) < half + 4 && Math.abs(v) < width / 2 + 3) n += 1;
          }
        }
      }
      for (let u = -half; u <= half; u += 6) for (let v = -width / 2 - 14; v <= width / 2 + 14; v += 6) {
        const x = node.x + (along.x * (u + shift) + across.x * (v + k)) / M, y = node.y + (along.y * (u + shift) + across.y * (v + k)) / M;
        if (blocked(x, y)) n += 4;
      }
      // Each line's way in: from the open line to its end of the platforms, metres.
      let throats = 0;
      for (const w of ways) {
        const end = { x: node.x + (along.x * (w.side * half + shift) + across.x * k) / M, y: node.y + (along.y * (w.side * half + shift) + across.y * k) / M };
        throats += Math.hypot(end.x - w.p.x, end.y - w.p.y) * M;
      }
      return n + throats * 0.25;
    };
    let best = { k: 0, shift: 0, score: Infinity };
    for (const k of [0, width / 2 + 10, -(width / 2 + 10), width / 2 + 24, -(width / 2 + 24), width / 2 + 40, -(width / 2 + 40)]) {
      for (const shift of [0, half * 0.35, -half * 0.35]) {
        const s = score(k, shift);
        if (s < best.score) best = { k, shift, score: s };
      }
    }
    const centre = { x: node.x + (across.x * best.k + along.x * best.shift) / M, y: node.y + (across.y * best.k + along.y * best.shift) / M };
    // Each segment's throat: from its point `reach` out, in to its tracks' end of the platforms.
    const ends = new Map<string, StationEnd>();
    for (const [segmentId, o] of out0) {
      const reach = Math.min(half + THROAT, 0.45 * o.length * M);
      const [, rest] = splitPolyline(o.line, reach / M);
      const p = rest[0] ?? o.line[o.line.length - 1]!;
      const q = rest[1] ?? p;
      const before = o.line[0]!;
      // Toward the town: the line's own heading at that point, reversed.
      const inward = q === p ? Math.atan2(before.y - p.y, before.x - p.x) : Math.atan2(p.y - q.y, p.x - q.x);
      ends.set(segmentId, { segmentId, side: sideOf(o.theta), reach, join: Math.max(6, Math.min(half, reach - 14)), outer: p, inward });
    }
    // Which tracks each segment leads to: its lines'; a segment no line uses, the nearest track on its side.
    const throats = new Map<string, number[]>();
    tracks.forEach((t, i) => {
      const u = here.find((x) => x.routeId === t.routeId) ?? (t.routeId === "" ? { segments: [...out0.keys()] } : null);
      for (const s of u?.segments ?? []) if (ends.has(s)) (throats.get(s) ?? throats.set(s, []).get(s)!).push(i);
    });
    for (const [segmentId, o] of out0) {
      if (throats.has(segmentId) || !tracks.length) continue;
      const l = lateral(o.theta);
      const nearest = tracks.reduce((b, t, i) => (Math.abs(t.offset - l * 50) < Math.abs(tracks[b]!.offset - l * 50) ? i : b), 0);
      throats.set(segmentId, [nearest]);
    }
    const key = `${id}|${axis.toFixed(3)}|${best.k.toFixed(1)}|${best.shift.toFixed(1)}|${half}|${tracks.map((t) => `${t.routeId}:${t.offset.toFixed(1)}`).join(",")}|${[...ends.values()].map((e) => `${e.segmentId}:${e.reach.toFixed(1)}`).join(",")}`;
    out.set(id, { id, node, centre, axis, half, tracks, ends, width, throats, key });
  }
  return out;
}

/** A point of a station, `u` metres along its axis and `v` across, in map cells. */
export function stationAt(st: Station, u: number, v: number): Point {
  const c = Math.cos(st.axis), s = Math.sin(st.axis);
  return { x: st.centre.x + (u * c - v * s) / M, y: st.centre.y + (u * s + v * c) / M };
}

/** A throat's curve, from the open line (t = 0) to its platform track (t = 1). */
export function throatAt(st: Station, end: StationEnd, offset: number, t: number): Point {
  const p0 = end.outer;
  const p3 = stationAt(st, end.side * end.join, offset);
  const span = Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3;
  const p1 = { x: p0.x + Math.cos(end.inward) * span, y: p0.y + Math.sin(end.inward) * span };
  const back = st.axis + (end.side === 1 ? 0 : Math.PI);
  const p2 = { x: p3.x + Math.cos(back) * span, y: p3.y + Math.sin(back) * span };
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** A throat as a line, cells, from the open line to the platform track. */
export function throatLine(st: Station, end: StationEnd, offset: number, steps = 16): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => throatAt(st, end, offset, i / steps));
}

/**
 * Where a point of a train is drawn, if it's at a station: on segment `segmentId`, `d` metres
 * from the station's node, on line `routeId`. In the throat it follows its curve; within the
 * platforms it runs straight along its own track. Null where the open line is drawn as it is.
 */
export function onStation(st: Station, segmentId: string, d: number, routeId: string | undefined): Point | null {
  const end = st.ends.get(segmentId);
  if (!end || d >= end.reach) return null;
  const track = st.tracks.find((t) => t.routeId === routeId) ?? st.tracks[(st.throats.get(segmentId) ?? [0])[0]!] ?? st.tracks[0];
  if (!track) return null;
  if (d <= end.join) return stationAt(st, end.side * d, track.offset);
  return throatAt(st, end, track.offset, (end.reach - d) / (end.reach - end.join));
}
