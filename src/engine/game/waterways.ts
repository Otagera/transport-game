import type { GameRiverDef, GameWorld } from "./types";

// The waterway (docs/water.md, Step 2): what a boat can use, drawn from the map's water as the
// probe drew it (scripts/water-probe.ts). One node every couple of cells along each drawn river's
// centre line, with the river's width there standing for its depth; a tributary joined where its
// end lies in another line's water; the sea (a line 9+ cells wide) one water, any boat's. A reach
// takes a boat where both its ends are at least the boat's width.
//
// It isn't on the map's segments: roads and track never see it, and nothing that drives can route
// over it (principles §3, Two networks: every all-segments loop asks which network it means).
// Derived from the map's water alone, which never changes in a game: built once a world, kept
// off it.

export interface WaterNode {
  x: number;
  y: number;
  /** Cells: the river's width here, its depth for a boat. */
  width: number;
  sea: boolean;
}

export interface Waterway {
  nodes: WaterNode[];
  edges: Array<Array<{ to: number; len: number }>>;
}

/** A line this wide or wider is the sea (or a lagoon open to it): any boat's water. */
const SEA_WIDTH = 9;
/** Cells between nodes along a line, at most: a jetty's landing is the nearest node. */
const STEP = 2;

const built = new WeakMap<object, Waterway>();

/** The world's waterway, built on first use from its water lines. */
export function waterway(world: GameWorld): Waterway {
  const lines = world.waterLines ?? [];
  let way = built.get(lines);
  if (!way) built.set(lines, (way = buildWaterway(lines)));
  return way;
}

export function buildWaterway(rivers: readonly GameRiverDef[]): Waterway {
  const nodes: WaterNode[] = [];
  const edges: Array<Array<{ to: number; len: number }>> = [];
  const lineOf: number[] = [];
  const ends: Array<{ node: number; line: number }> = [];
  const link = (a: number, b: number, len: number) => {
    edges[a]!.push({ to: b, len });
    edges[b]!.push({ to: a, len });
  };
  rivers.forEach((river, line) => {
    if (river.lake || river.points.length < 2) return; // a lake is drawn as an outline, not a channel
    const sea = Math.max(river.width, ...(river.widths ?? [])) >= SEA_WIDTH;
    const widthAt = (k: number) => river.widths?.[k] ?? river.width;
    let last = -1;
    for (let k = 0; k < river.points.length; k += 1) {
      const [x, y] = river.points[k]!;
      if (k > 0) {
        // Points between, so no two nodes are more than STEP apart, the width eased between.
        const [px, py] = river.points[k - 1]!;
        const span = Math.hypot(x - px, y - py);
        const parts = Math.max(1, Math.ceil(span / STEP));
        for (let j = 1; j < parts; j += 1) {
          const t = j / parts;
          nodes.push({ x: px + (x - px) * t, y: py + (y - py) * t, width: widthAt(k - 1) + (widthAt(k) - widthAt(k - 1)) * t, sea });
          edges.push([]);
          lineOf.push(line);
          link(last, nodes.length - 1, span / parts);
          last = nodes.length - 1;
        }
      }
      nodes.push({ x, y, width: widthAt(k), sea });
      edges.push([]);
      lineOf.push(line);
      if (last >= 0) {
        const prev = nodes[last]!;
        link(last, nodes.length - 1, Math.hypot(x - prev.x, y - prev.y));
      }
      if (k === 0 || k === river.points.length - 1) ends.push({ node: nodes.length - 1, line });
      last = nodes.length - 1;
    }
  });
  // Joins: a line's end within another line's water (a tributary on its river, a mouth on the sea).
  for (const end of ends) {
    const e = nodes[end.node]!;
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < nodes.length; j += 1) {
      if (lineOf[j] === end.line) continue;
      const d = Math.hypot(nodes[j]!.x - e.x, nodes[j]!.y - e.y);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best >= 0 && bestD <= nodes[best]!.width / 2 + e.width / 2 + 2) link(end.node, best, bestD);
  }
  return { nodes, edges };
}

/** Whether a boat needing `width` cells can pass between two nodes. */
function passes(way: Waterway, a: number, b: number, width: number): boolean {
  const p = way.nodes[a]!;
  const q = way.nodes[b]!;
  return (p.sea && q.sea) || Math.min(p.width, q.width) >= width;
}

/**
 * Where a town's jetty would land: the nearest node of water a boat needing `width` can use,
 * within `reach` cells of its edge; null if there's none. Ties go to the lower index (the drawing's
 * order), so the same map lands the same way.
 */
const landings = new WeakMap<GameWorld, Map<string, { node: number; edge: number } | null>>();

export function landing(world: GameWorld, townId: string, width: number, reach: number): { node: number; edge: number } | null {
  // Kept a world: the map draws every jetty every frame, and a town never moves.
  let held = landings.get(world);
  if (!held) landings.set(world, (held = new Map()));
  const key = `${townId}|${width}|${reach}`;
  if (!held.has(key)) held.set(key, findLanding(world, townId, width, reach));
  return held.get(key)!;
}

function findLanding(world: GameWorld, townId: string, width: number, reach: number): { node: number; edge: number } | null {
  const town = world.towns.get(townId);
  if (!town) return null;
  const way = waterway(world);
  let best: { node: number; edge: number } | null = null;
  for (let j = 0; j < way.nodes.length; j += 1) {
    const n = way.nodes[j]!;
    if (!n.sea && n.width < width) continue;
    // A navigable node with no navigable reach out of it is a dead end: no boat leaves from there.
    if (!way.edges[j]!.some(({ to }) => passes(way, j, to, width))) continue;
    const edge = Math.max(0, Math.hypot(n.x - town.x, n.y - town.y) - n.width / 2);
    if (edge <= reach && (!best || edge < best.edge)) best = { node: j, edge };
  }
  return best;
}

export interface WaterRoute {
  /** Cells, along the water, from the town to the town (the walks to the landings included). */
  length: number;
  /** The way, town to town, for drawing. */
  points: Array<[number, number]>;
}

const routes = new WeakMap<GameWorld, Map<string, WaterRoute | null>>();

/**
 * The water route between two towns' landings for a boat needing `width` cells; null if the water
 * doesn't join them. `blocked`: nodes no boat of this kind passes (a ford or causeway on the water,
 * boats.ts blockers), with `signature` naming them for the cache.
 */
export function waterRoute(world: GameWorld, a: string, b: string, width: number, reach: number, blocked: ReadonlySet<number> = NONE, signature = ""): WaterRoute | null {
  let cache = routes.get(world);
  if (!cache) routes.set(world, (cache = new Map()));
  const key = `${a}|${b}|${width}|${reach}|${signature}`;
  if (cache.has(key)) return cache.get(key)!;
  const route = findWaterRoute(world, a, b, width, reach, blocked);
  cache.set(key, route);
  return route;
}

const NONE: ReadonlySet<number> = new Set();

/** The node a point lies on: the nearest, for a ford's place on the water (and a route's points, which are nodes). */
export function nodeNear(world: GameWorld, x: number, y: number): { node: number; distance: number } {
  const way = waterway(world);
  let node = -1;
  let distance = Infinity;
  for (let j = 0; j < way.nodes.length; j += 1) {
    const d = Math.hypot(way.nodes[j]!.x - x, way.nodes[j]!.y - y);
    if (d < distance) {
      distance = d;
      node = j;
    }
  }
  return { node, distance };
}

function findWaterRoute(world: GameWorld, a: string, b: string, width: number, reach: number, blocked: ReadonlySet<number>): WaterRoute | null {
  if (a === b) return null;
  const from = landing(world, a, width, reach);
  const to = landing(world, b, width, reach);
  const ta = world.towns.get(a);
  const tb = world.towns.get(b);
  if (!from || !to || !ta || !tb) return null;
  const way = waterway(world);
  const n = way.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  // Dijkstra on a binary heap of [distance, node].
  const heap: Array<[number, number]> = [[0, from.node]];
  dist[from.node] = 0;
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent]![0] <= heap[i]![0]) break;
      [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
      i = parent;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [d, u] = pop();
    if (d > dist[u]!) continue;
    if (u === to.node) break;
    for (const { to: v, len } of way.edges[u]!) {
      if (!passes(way, u, v, width)) continue;
      if (blocked.has(v) && v !== to.node) continue; // a crossing this boat can't pass
      const nd = d + len;
      if (nd < dist[v]!) {
        dist[v] = nd;
        prev[v] = u;
        push([nd, v]);
      }
    }
  }
  if (!Number.isFinite(dist[to.node]!)) return null;
  const chain: number[] = [];
  for (let v = to.node; v >= 0; v = prev[v]!) chain.push(v);
  chain.reverse();
  const first = way.nodes[from.node]!;
  const last = way.nodes[to.node]!;
  const walkA = Math.hypot(first.x - ta.x, first.y - ta.y);
  const walkB = Math.hypot(last.x - tb.x, last.y - tb.y);
  return {
    length: walkA + dist[to.node]! + walkB,
    points: [[ta.x, ta.y], ...chain.map((v) => [way.nodes[v]!.x, way.nodes[v]!.y] as [number, number]), [tb.x, tb.y]],
  };
}
