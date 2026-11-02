import type { WhatIfEnd } from "@engine/game/whatif";
import type { GameWorld } from "@engine/game/types";

// The what-if's map graph (docs/brief.md, Dev tools, step 4): the map's places as nodes and what
// flows between them as edges, each drawn by how much the change moved it -- grew green, shrank
// red, faint where it didn't move -- over the live map, so places stand where they are. Dev only
// (devconsole.ts imports it). A canvas in #plate-overlay that takes no pointer: the map under it
// still picks a town, and the drawer then gives its numbers before and after.

export type GraphLayer = "trips" | "goods";

export interface GraphEdge {
  a: string;
  b: string;
  base: number;
  with: number;
}

/** Below this a day, a pair isn't drawn at all (trips, or tonnes). */
const LEAST = 1;
/** A change smaller than this share of the pair's flow (and under one a day) reads as none. */
const STILL = 0.02;

const pairOf = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The edges of a layer, both directions of a pair together, goods of every kind summed. */
export function graphEdges(base: WhatIfEnd, after: WhatIfEnd, layer: GraphLayer): GraphEdge[] {
  const edges = new Map<string, GraphEdge>();
  const add = (key: string, side: "base" | "with", amount: number) => {
    const parts = key.split(":");
    const [a, b] = [parts[0]!, parts[1]!];
    const id = pairOf(a, b);
    const edge = edges.get(id) ?? { a: a < b ? a : b, b: a < b ? b : a, base: 0, with: 0 };
    edge[side] += amount;
    edges.set(id, edge);
  };
  const source = layer === "trips" ? [base.trips, after.trips] : [base.flows, after.flows];
  for (const [key, amount] of Object.entries(source[0]!)) add(key, "base", amount);
  for (const [key, amount] of Object.entries(source[1]!)) add(key, "with", amount);
  return [...edges.values()].filter((e) => Math.max(e.base, e.with) >= LEAST);
}

/** Moved enough to colour. */
export const moved = (base: number, after: number) => Math.abs(after - base) >= Math.max(0.5, STILL * Math.max(base, after));

export interface MapGraph {
  show(base: WhatIfEnd, after: WhatIfEnd, layer: GraphLayer): void;
  hide(): void;
}

export function mountMapGraph(world: GameWorld, project: (x: number, y: number) => { x: number; y: number }): MapGraph {
  const canvas = document.createElement("canvas");
  canvas.id = "whatif-graph";
  canvas.hidden = true;
  document.querySelector("#plate-overlay")!.prepend(canvas);
  const ctx = canvas.getContext("2d")!;
  let frame = 0;
  let edges: GraphEdge[] = [];
  let people: Array<{ id: string; delta: number }> = [];

  function draw(): void {
    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(box.width * ratio) || canvas.height !== Math.round(box.height * ratio)) {
      canvas.width = Math.round(box.width * ratio);
      canvas.height = Math.round(box.height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    const style = getComputedStyle(document.documentElement);
    const colour = { good: style.getPropertyValue("--good").trim(), bad: style.getPropertyValue("--bad").trim(), still: style.getPropertyValue("--muted").trim() };
    const at = (id: string) => {
      const town = world.towns.get(id);
      if (!town) return null;
      const p = project(town.x, town.y);
      return { x: p.x - box.left, y: p.y - box.top };
    };
    const biggest = Math.max(1e-9, ...edges.map((e) => Math.abs(e.with - e.base)));
    const line = (e: GraphEdge, stroke: string, width: number, alpha: number) => {
      const p = at(e.a);
      const q = at(e.b);
      if (!p || !q) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    };
    ctx.lineCap = "round";
    for (const e of edges) if (!moved(e.base, e.with)) line(e, colour.still, 1, 0.3);
    const changed = edges.filter((e) => moved(e.base, e.with)).sort((p, q) => Math.abs(p.with - p.base) - Math.abs(q.with - q.base));
    for (const e of changed) line(e, e.with > e.base ? colour.good : colour.bad, 1.5 + 5 * Math.sqrt(Math.abs(e.with - e.base) / biggest), 0.85);
    const most = Math.max(1e-9, ...people.map((t) => Math.abs(t.delta)));
    for (const t of people) {
      const p = at(t.id);
      if (!p) continue;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = t.delta > 0 ? colour.good : colour.bad;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 + 12 * Math.sqrt(Math.abs(t.delta) / most), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    frame = requestAnimationFrame(draw);
  }

  return {
    show(base, after, layer) {
      edges = graphEdges(base, after, layer);
      people = Object.keys({ ...base.people, ...after.people })
        .map((id) => ({ id, delta: (after.people[id] ?? 0) - (base.people[id] ?? 0) }))
        .filter((t) => Math.abs(t.delta) >= 0.05);
      canvas.hidden = false;
      cancelAnimationFrame(frame);
      // Redrawn each frame while shown: the map pans and zooms under it.
      frame = requestAnimationFrame(draw);
    },
    hide() {
      cancelAnimationFrame(frame);
      canvas.hidden = true;
    },
  };
}
