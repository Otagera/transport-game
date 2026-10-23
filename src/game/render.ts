import type { InformalMode, GameTown, GameWorld } from "@engine/game/types";
import type { RoutingContext, Vehicle } from "@engine/simulation/types";
import { routingFor } from "@engine/game/rail";
import { gameDay, isCutOff, roadChain, townShare, tripsFrom, waitingAt } from "@engine/game/world";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import { growthTrend } from "@engine/game/growth";
import { freshMilestone } from "@engine/game/score";
import { corridorChanges } from "@engine/game/corridors";
import { NO_SEAT_MIN_PER_DAY, corridorNoSeat } from "@engine/game/problems";
import { overWater, polylineLength, segmentPolyline, splitPolyline, type Point } from "@engine/game/roads";
import { isDirt, roadCapacity } from "@engine/game/congestion";
import { laneEncroachment, struckSegments } from "@engine/game/pushback";
import { newRefineryOutput, refineryOutput, shortageAt } from "@engine/game/fuel";
import { cementActive, cementImports, worksCapacity, worksOutput } from "@engine/game/cement";
import { flourCapacity, flourOutput, millCapacity, millOutput } from "@engine/game/food";
import { siteProduction } from "@engine/game/production";
import { goodsFlows, type GoodsFlow } from "@engine/game/goods";

/**
 * How much bigger marks draw than at the whole-map view: the square root of the zoom, so
 * zoomed in they spread apart rather than shrink to specks (the information lab). Set by
 * draw() each frame from the view.
 */
let markScale = 1;

/**
 * Focus (the information lab): hover or select a town, or hover a route's card, and what
 * isn't part of it draws faded. `fadeNow` is the fade of whatever is being drawn; every
 * transparency the map sets goes through alpha() so it fades with it.
 */
let fadeNow = 1;
const alpha = (x: number) => x * fadeNow;
const FADED = 0.22;
interface Focus { segments: Set<string>; routes: Set<string> }
let focus: Focus | null = null;

/** A town's roads and the routes that stop there; or a route and the roads it runs on. */
function focusOf(world: GameWorld, state: DrawState): Focus | null {
  if (!state.focusTown && !state.focusRoute) return null;
  const segments = new Set<string>();
  const routes = new Set<string>();
  const addRoute = (route: { id: string; vehicleIds: string[] }) => {
    routes.add(route.id);
    const vehicle = world.simulation.vehicles.find((v) => v.id === route.vehicleIds[0]);
    if (!vehicle) return;
    const routing = routingFor(world, vehicle);
    vehicle.path.forEach((to, i) => {
      const from = vehicle.path[(i - 1 + vehicle.path.length) % vehicle.path.length]!;
      const id = routing.graph.get(from)?.find((edge) => edge.to === to)?.segmentId;
      if (id) segments.add(id);
    });
  };
  const all = [...world.routes, ...world.lorryRoutes];
  if (state.focusRoute) {
    const route = all.find((r) => r.id === state.focusRoute);
    if (route) addRoute(route);
  } else if (state.focusTown) {
    const town = state.focusTown;
    for (const seg of world.simulation.map.segments) if (seg.fromNodeId === town || seg.toNodeId === town) segments.add(seg.id);
    for (const route of all) {
      const vehicle = world.simulation.vehicles.find((v) => v.id === route.vehicleIds[0]);
      if (vehicle?.path.includes(town)) addRoute(route);
    }
  }
  return { segments, routes };
}
const segmentFade = (id: string) => (focus && !focus.segments.has(id) ? FADED : 1);

// Flat, top-down, legibility first (docs/principles.md §6): every fact the
// loop runs on is drawn, not hidden behind an overlay -- who is waiting,
// where they ended up, which roads you run buses on, and the informal
// sector (danfos, kekes, okadas).

export const COLORS = {
  ground: "#f4f6f3",
  water: "#a9cbd9",
  waterEdge: "#8bb6c8",
  hill: "#8f99a3",
  bridge: "#6f7782",
  crack: "#3d4652",
  rail: "#3f4852",
  grow: "#2b8a3e",
  goods: "#8a5a2b",
  kept: "#ffffff",
  groundEdge: "#dde3ea",
  dirtRoad: "#c4ab7c",
  builtRoad: "#5f6874",
  town: "#ffffff",
  townEdge: "#1b2129",
  label: "#1b2129",
  labelMuted: "#7b8694",
  player: "#2f6fdb",
  danfo: "#f2c200",
  danfoStripe: "#1d1b18",
  keke: "#2b8a3e",
  forecastGood: "#2b8a3e",
  slow: "#e8742c",
  jam: "#c92a2a",
  /** A road running free: a pale grey casing, as wide as its traffic. */
  free: "#c3cbd4",
  home: "#a3abb5",
  waiting: "#1b2129",
  selection: "#d9480f",
  ghostOk: "#1b2129",
  ghostBad: "#c92a2a",
  strike: "#c92a2a",
};

const ROUTE_COLORS = ["#2f6fdb", "#0b8f6a", "#a33ea1", "#d9480f", "#1c7ed6", "#5f3dc4", "#c2255c", "#2b8a3e"];

export interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** The scale that shows the whole map (fitView sets it); zoomed in, `scale` is bigger. */
  fit?: number;
}

export function fitView(world: GameWorld, width: number, height: number, padding: number, topInset: number, bottomInset = 0, sideInset = 0): View {
  const usableH = height - topInset - bottomInset - padding * 2;
  const usableW = width - padding * 2 - sideInset * 2;
  const scale = Math.min(usableW / world.width, usableH / world.height);
  return {
    scale,
    offsetX: (width - world.width * scale) / 2,
    offsetY: topInset + padding + (usableH - world.height * scale) / 2,
    fit: scale,
  };
}

export function toScreen(view: View, x: number, y: number): { x: number; y: number } {
  return { x: view.offsetX + x * view.scale, y: view.offsetY + y * view.scale };
}

export function townRadius(town: GameTown, view: View): number {
  // Sized at the whole-map scale, then grown by the square root of the zoom, as every mark is.
  const fit = view.fit ?? view.scale;
  return Math.max(7, Math.sqrt(town.population) * fit * 0.22) * Math.sqrt(view.scale / fit);
}

export function routeColor(index: number): string {
  return ROUTE_COLORS[index % ROUTE_COLORS.length]!;
}

/** A second line under a preview: what the action is forecast to do (forecast.ts). */
export interface ForecastLine {
  text: string;
  tone: "good" | "bad" | "neutral" | "pending";
}

export interface Ghost {
  from: string;
  to: { x: number; y: number };
  ok: boolean;
  label: string;
  forecast?: ForecastLine;
  /** The planned road, map cells -- drawn instead of a straight line when there is one. */
  line?: Point[];
  /** Or the towns a bus would run through, drawn along their roads. */
  path?: string[];
  /** `path` runs on track (a train), not roads. */
  rail?: boolean;
}

export interface DrawState {
  selectedTown: string | null;
  hoverTown: string | null;
  /** The town whose trips are drawn as desire lines (hovered, else selected). */
  focusTown: string | null;
  ghost: Ghost | null;
  /** The fix tool's hovered road, and what to say about it. */
  road?: { segmentId: string; at: { x: number; y: number }; label: string; forecast?: ForecastLine } | null;
  /** How fast the game runs (1, 2, 4): at 4x and zoomed out, the other side's vehicles are drawn as bands only. */
  gameSpeed?: number;
  /** A route whose card is hovered: it and its roads in focus, the rest faded. */
  focusRoute?: string | null;
  /** Towns whose card names a problem: an amber mark on the map (the information lab). */
  problems?: ReadonlySet<string>;
}

export function draw(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, state: DrawState): void {
  const { width, height } = ctx.canvas;
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  markScale = view.fit ? Math.sqrt(view.scale / view.fit) : 1;
  focus = focusOf(world, state);
  // The other side's vehicles -- danfos, kekes, okadas, the hauliers' trucks -- as bands
  // beside each road, always; drawn one by one too only when there's room for them: at 1x or
  // 2x, or zoomed in to 2x (the information lab: at 4x the swarm was unreadable in play).
  const zoom = markScale * markScale;
  const oneByOne = (state.gameSpeed ?? 1) < 4 || zoom >= 2;
  drawGround(ctx, world, view);
  drawNoSeat(ctx, world, view);
  drawRoads(ctx, world, view, otherSideOnRoads(world));
  if (state.road) drawRoadHighlight(ctx, world, view, state.road.segmentId);
  drawRouteLines(ctx, world, view);
  if (state.focusTown) drawDesireLines(ctx, world, view, state.focusTown);
  if (state.ghost) drawGhostLine(ctx, world, view, state.ghost);
  drawVehicles(ctx, world, view, oneByOne);
  for (const ruin of world.ruins.values()) drawRuin(ctx, view, ruin);
  // Towns first, biggest first, so their labels claim the space; then the
  // sites, whose names go where there's room (playtest, map 2411: "the
  // screen is getting too muddled" -- site labels on town labels).
  occupied = [];
  const towns = [...world.towns.values()];
  for (const town of towns.filter((t) => !t.industry).sort((p, q) => q.population - p.population)) drawTown(ctx, world, view, town, state);
  const flows = goodsFlows(world);
  for (const town of towns.filter((t) => t.industry)) drawIndustry(ctx, world, view, town, state, flows);
  drawWardens(ctx, world, view);
  drawStrikeLabels(ctx, world, view);
  drawTakenLabels(ctx, world, view);
  // Last, so nothing on the map draws through the price.
  if (state.ghost) drawLabel(ctx, state.ghost.to, state.ghost.label, state.ghost.ok, state.ghost.forecast);
  if (state.road) drawLabel(ctx, state.road.at, state.road.label, true, state.road.forecast);

  ctx.restore();
}

// --- Geometry: every road is a polyline (principles §3, one geometry
// representation), straight or bent round the terrain. Roads, route lines,
// traffic and vehicles all draw along the same one.

/** The road (or, on `routing` = the rail network, the track) between two adjacent nodes, oriented from `from` to `to`. */
function edgeLine(world: GameWorld, from: string, to: string, routing: RoutingContext = world.simulation.routing): Point[] {
  const edge = routing.graph.get(from)?.find((candidate) => candidate.to === to);
  const segment = edge && world.simulation.map.segments.find((candidate) => candidate.id === edge.segmentId);
  if (!segment) {
    const { positions } = world.simulation.routing;
    return [positions.get(from)!, positions.get(to)!];
  }
  const line = segmentPolyline(world.simulation.map, segment);
  return segment.fromNodeId === from ? line : [...line].reverse();
}

function strokeLine(ctx: CanvasRenderingContext2D, view: View, line: Point[], offset = 0): void {
  ctx.beginPath();
  line.forEach((p, i) => {
    const s = toScreen(view, p.x, p.y);
    if (i === 0) ctx.moveTo(s.x + offset, s.y + offset);
    else ctx.lineTo(s.x + offset, s.y + offset);
  });
  ctx.stroke();
}

/** The stretches of a road that cross water -- its bridges -- sampled every half cell. */
function bridgeRuns(world: GameWorld, line: Point[]): Point[][] {
  const length = polylineLength(line);
  const runs: Point[][] = [];
  let run: Point[] | null = null;
  for (let at = 0; at <= length; at += 0.5) {
    const p = splitPolyline(line, at)[1][0]!;
    if (overWater(world, p)) {
      run ??= [];
      run.push(p);
    } else if (run) {
      run.push(p);
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs;
}

// Terrain changes never, so it's drawn once per view into its own canvas.
let terrainCache: { key: string; canvas: HTMLCanvasElement } | null = null;

function terrainLayer(world: GameWorld, view: View, width: number, height: number): HTMLCanvasElement {
  const key = `${view.scale}:${view.offsetX}:${view.offsetY}:${width}:${height}`;
  if (terrainCache?.key === key) return terrainCache.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const { terrain } = world.simulation.map;
  const cell = view.scale;
  let peak = 0;
  for (const e of terrain.elevation) peak = Math.max(peak, e);
  for (let y = 0; y < terrain.height; y += 1) {
    for (let x = 0; x < terrain.width; x += 1) {
      const i = y * terrain.width + x;
      // Cells are sampled at their integer point, so each draws centred on it.
      const s = toScreen(view, x - 0.5, y - 0.5);
      if (terrain.water[i] === 1) {
        ctx.fillStyle = COLORS.water;
        ctx.fillRect(s.x, s.y, cell + 0.5, cell + 0.5);
      } else if (peak > 0 && terrain.elevation[i]! > 0.05) {
        // Hills: a light wash by height under the contours (the lab's pick, 2026-10-20).
        ctx.fillStyle = COLORS.hill;
        ctx.globalAlpha = 0.16 * (terrain.elevation[i]! / peak);
        ctx.fillRect(s.x, s.y, cell + 0.5, cell + 0.5);
        ctx.globalAlpha = 1;
      }
    }
  }
  if (peak > 0) drawContours(ctx, world, view, peak);
  drawGroundNames(ctx, world, view, peak);
  terrainCache = { key, canvas };
  return canvas;
}

// Contour lines (the design lab's "contours, with names on the ground",
// picked 2026-10-20): marching squares on the terrain's own elevation, seven
// levels up to its peak, every other one heavier, so the ridge reads as a
// climb the way a survey map draws it.
function drawContours(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, peak: number): void {
  const { terrain } = world.simulation.map;
  const { width, height } = terrain;
  const at = (x: number, y: number) => (terrain.water[y * width + x] === 1 ? 0 : terrain.elevation[y * width + x] ?? 0);
  // Corners: top-left 8, top-right 4, bottom-right 2, bottom-left 1. Edges: 0 top, 1 right, 2 bottom, 3 left.
  const CASES: number[][] = [[], [3, 2], [2, 1], [3, 1], [0, 1], [3, 0, 2, 1], [0, 2], [3, 0], [3, 0], [0, 2], [3, 2, 0, 1], [0, 1], [3, 1], [2, 1], [3, 2], []];
  ctx.save();
  ctx.strokeStyle = "rgba(80, 95, 110, 0.4)";
  for (let k = 1; k <= 7; k += 1) {
    const level = (peak * k) / 8;
    ctx.lineWidth = k % 2 === 0 ? 1.6 : 1;
    ctx.beginPath();
    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), e = at(x, y + 1);
        const edges = CASES[(a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (e > level ? 1 : 0)]!;
        const t = (p: number, q: number) => (level - p) / (q - p);
        const point = (edge: number) => {
          const [px, py] = edge === 0 ? [x + t(a, b), y] : edge === 1 ? [x + 1, y + t(b, c)] : edge === 2 ? [x + t(e, c), y + 1] : [x, y + t(a, e)];
          return toScreen(view, px, py);
        };
        for (let j = 0; j < edges.length; j += 2) {
          const p = point(edges[j]!);
          const q = point(edges[j + 1]!);
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
        }
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Names on the ground: "THE RIDGE" at the high point, "THE RIVER" along the
// water at its middle, turned to run with it (the video's "HAN RIVER").
function drawGroundNames(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, peak: number): void {
  const { terrain } = world.simulation.map;
  const { width, height } = terrain;
  ctx.save();
  ctx.fillStyle = "rgba(110, 120, 132, 0.85)";
  ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  const spaced = (text: string) => text.split("").join("\u2009");
  // Clear of every town and site, and of each other: a name on the ground, not on a label.
  const places = [...world.towns.values()].map((town) => ({ x: town.x, y: town.y }));
  const clearance = (x: number, y: number) => Math.min(...places.map((p) => Math.hypot(p.x - x, p.y - y)));
  let ridge: { x: number; y: number } | null = null;
  if (peak > 0) {
    // High ground, 6+ cells from anything: the highest such cell.
    let best = -1;
    for (let i = 0; i < terrain.elevation.length; i += 1) {
      const x = i % width, y = Math.floor(i / width);
      if (terrain.water[i] === 1 || x < 4 || y < 3 || x > width - 5 || y > height - 4 || terrain.elevation[i]! < 0.4 * peak) continue;
      // Its whole width clear, not just its middle: the name runs ~5 cells either side.
      if (clearance(x, y) < 6 || clearance(x - 5, y) < 4 || clearance(x + 5, y) < 4) continue;
      if (best < 0 || terrain.elevation[i]! > terrain.elevation[best]!) best = i;
    }
    if (best >= 0) {
      ridge = { x: best % width, y: Math.floor(best / width) };
      const p = toScreen(view, ridge.x, ridge.y);
      ctx.fillText(spaced("THE RIDGE"), p.x, p.y + 4);
      places.push(ridge);
    }
  }
  // The water cell with the most room around it, nearer the middle the better, and the way the water runs there.
  let mid = -1;
  let score = -Infinity;
  for (let y = 3; y < height - 3; y += 1) for (let x = 3; x < width - 3; x += 1) {
    if (terrain.water[y * width + x] !== 1) continue;
    const s = Math.min(clearance(x, y), 10) - 0.15 * Math.hypot(x - width / 2, y - height / 2);
    if (s > score) { score = s; mid = y * width + x; }
  }
  if (mid >= 0) {
    const mx = mid % width, my = Math.floor(mid / width);
    let sxx = 0, syy = 0, sxy = 0, n = 0;
    for (let y = Math.max(0, my - 8); y < Math.min(height, my + 9); y += 1) for (let x = Math.max(0, mx - 8); x < Math.min(width, mx + 9); x += 1) {
      if (terrain.water[y * width + x] !== 1) continue;
      sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); n += 1;
    }
    let angle = n > 2 ? 0.5 * Math.atan2(2 * sxy, sxx - syy) : 0;
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    const p = toScreen(view, mx, my);
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.fillStyle = "rgba(60, 100, 130, 0.75)";
    ctx.fillText(spaced("THE RIVER"), 0, 4);
  }
  ctx.restore();
}

function drawGround(ctx: CanvasRenderingContext2D, world: GameWorld, view: View): void {
  const tl = toScreen(view, 0, 0);
  const w = world.width * view.scale;
  const h = world.height * view.scale;
  ctx.fillStyle = COLORS.ground;
  ctx.strokeStyle = COLORS.groundEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(tl.x, tl.y, w, h, 12);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(tl.x, tl.y, w, h, 12);
  ctx.clip();
  const dpr = window.devicePixelRatio || 1;
  ctx.drawImage(terrainLayer(world, view, ctx.canvas.width / dpr, ctx.canvas.height / dpr), 0, 0);
  ctx.restore();
}

// Riders who find no seat, drawn on the corridor they'd travel (brief,
// Revision 2, step 1: "nothing is said only in text that the map could
// show"): a grey band beside the road, thicker the more trips a day nobody
// carried along it -- traffic's way of drawing, on one side. Recomputed once
// a sim second, not every frame.
let noSeatCache: { at: number; world: GameWorld; bands: Array<{ line: Point[]; perDay: number }> } | null = null;
function drawNoSeat(ctx: CanvasRenderingContext2D, world: GameWorld, view: View): void {
  const at = Math.floor(world.economy.elapsedSeconds);
  if (noSeatCache?.world !== world || noSeatCache.at !== at) {
    const bands: Array<{ line: Point[]; perDay: number }> = [];
    for (const [key, entry] of corridorNoSeat(world)) {
      if (entry.perDay < NO_SEAT_MIN_PER_DAY) continue;
      const corridor = world.corridors.get(key);
      const line = corridor ? (roadChain(world, corridor.a, corridor.b) ?? []).flatMap((piece) => segmentPolyline(world.simulation.map, piece)) : [];
      if (line.length >= 2) bands.push({ line, perDay: entry.perDay });
    }
    noSeatCache = { at, world, bands };
  }
  ctx.save();
  ctx.strokeStyle = COLORS.home;
  ctx.globalAlpha = 0.45;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  for (const band of noSeatCache.bands) {
    const width = Math.min(12, 2 + band.perDay / 40);
    ctx.lineWidth = width;
    strokeOffset(ctx, view, band.line, 8 + width / 2);
  }
  ctx.restore();
}

/** A polyline drawn `offset` screen pixels to its left, each vertex moved along the mean of its segments' normals. */
function strokeOffset(ctx: CanvasRenderingContext2D, view: View, line: Point[], offset: number): void {
  const pts = line.map((p) => toScreen(view, p.x, p.y));
  const normal = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  };
  ctx.beginPath();
  pts.forEach((p, i) => {
    const before = i > 0 ? normal(pts[i - 1]!, p) : null;
    const after = i < pts.length - 1 ? normal(p, pts[i + 1]!) : null;
    const n = before && after ? { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 } : (before ?? after)!;
    const x = p.x + n.x * offset;
    const y = p.y + n.y * offset;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/**
 * The other side's vehicles on each road now: danfos, kekes and okadas, and trucks -- rolled
 * a little frame to frame (`band`), so a band doesn't jump each time a danfo leaves a road.
 * The one piece of display state the renderer keeps; it's only how wide a band draws.
 */
const band = new Map<string, { informal: number; trucks: number }>();
function otherSideOnRoads(world: GameWorld): Map<string, { informal: number; trucks: number }> {
  const now = new Map<string, { informal: number; trucks: number }>();
  for (const vehicle of world.simulation.vehicles) {
    if (vehicle.lifecycle !== "one-shot") continue;
    const length = vehicle.path.length;
    if (length < 2 || vehicle.pathIndex >= length) continue;
    const from = vehicle.path[(vehicle.pathIndex - 1 + length) % length]!;
    const id = world.simulation.routing.graph.get(from)?.find((edge) => edge.to === vehicle.path[vehicle.pathIndex])?.segmentId;
    if (!id) continue;
    const mode = world.informal.active.get(vehicle.id)?.mode ?? (vehicle.id.startsWith("truck-") ? "truck" : "danfo");
    const count = now.get(id) ?? { informal: 0, trucks: 0 };
    if (mode === "truck") count.trucks += 1;
    else count.informal += 1;
    now.set(id, count);
  }
  for (const id of new Set([...band.keys(), ...now.keys()])) {
    const was = band.get(id) ?? { informal: 0, trucks: 0 };
    const is = now.get(id) ?? { informal: 0, trucks: 0 };
    band.set(id, { informal: was.informal + (is.informal - was.informal) * 0.08, trucks: was.trucks + (is.trucks - was.trucks) * 0.08 });
  }
  return band;
}

function drawRoads(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, crowd: ReadonlyMap<string, { informal: number; trucks: number }>): void {
  ctx.lineCap = "round";
  const struck = struckSegments(world);
  const encroached = laneEncroachment(world);
  for (const segment of world.simulation.map.segments) {
    const line = segmentPolyline(world.simulation.map, segment);
    fadeNow = segmentFade(segment.id);
    ctx.globalAlpha = fadeNow;
    if (segment.type === "rail") {
      const disused = world.railOutOfService.has(segment.id);
      const kept = !disused && world.maintained.has(segment.id);
      // Kept track sits on a clean pale bed under its sleepers (a centre
      // line, as roads get, vanished inside the rail at normal zoom).
      if (kept) {
        ctx.strokeStyle = COLORS.kept;
        ctx.lineWidth = 14;
        ctx.lineCap = "butt";
        strokeLine(ctx, view, line);
        ctx.lineCap = "round";
      }
      drawTrack(ctx, world, view, line, disused);
      // Worn track cracks like a road.
      if (!disused && !kept && segment.condition < 0.85) drawCracks(ctx, view, line, segment.condition);
      continue;
    }
    // A retired road (retire.ts): faded and broken, until it's gone.
    if (segment.retiredAt !== undefined) {
      ctx.strokeStyle = COLORS.dirtRoad;
      ctx.globalAlpha = alpha(0.45);
      ctx.lineWidth = 4;
      ctx.setLineDash([3, 6]);
      strokeLine(ctx, view, line);
      ctx.setLineDash([]);
      ctx.globalAlpha = alpha(1);
      continue;
    }
    // A bridge deck under the road where it crosses water.
    ctx.strokeStyle = COLORS.bridge;
    ctx.lineWidth = 13 * markScale;
    ctx.lineCap = "butt";
    ctx.setLineDash([]);
    for (const run of bridgeRuns(world, line)) strokeLine(ctx, view, run);
    ctx.lineCap = "round";
    // Paved roads drawn solid, dirt dashed -- by surface, not by who built
    // it: since step 5 the roads you build are born dirt.
    const built = !isDirt(segment);
    // Traffic, under the road (the information lab, 2026-10-23): a casing as wide as the
    // traffic it carries against what it can before it jams, coloured by how full it runs --
    // grey free, orange busy, red jammed: the same speed that slows the buses on it. Yellow
    // stays the informal sector's alone.
    const speed = world.segmentSpeed.get(segment.id) ?? 1;
    const load = Math.min(1.2, (world.roadFlowEMA.get(segment.id) ?? 0) / Math.max(1e-6, roadCapacity(world, segment.id)));
    ctx.strokeStyle = speed < JAMMED_ROAD_SPEED ? COLORS.jam : speed < SLOW_ROAD_SPEED ? COLORS.slow : COLORS.free;
    ctx.globalAlpha = alpha(speed < SLOW_ROAD_SPEED ? 0.85 : 0.7);
    ctx.lineWidth = (8 + load * 7) * markScale;
    ctx.setLineDash([]);
    strokeLine(ctx, view, line);
    ctx.globalAlpha = alpha(1);
    // A bus lane (Revision 1): a band of your colour under the road, wider
    // than a route line, so it reads as the road's, not a route's.
    // Encroachment fades it, and yellow dashes -- danfos in the lane -- grow
    // along it as they take it (pushback.ts).
    const taken = encroached.get(segment.id) ?? 0;
    if (segment.busLane) {
      ctx.strokeStyle = COLORS.player;
      ctx.globalAlpha = alpha(0.35 * (1 - 0.7 * taken));
      ctx.lineWidth = 16 * markScale;
      ctx.setLineDash([]);
      strokeLine(ctx, view, line);
      ctx.globalAlpha = alpha(1);
      if (taken > 0.05) {
        ctx.strokeStyle = COLORS.danfo;
        ctx.lineWidth = 5;
        ctx.setLineDash([4 + 10 * taken, 14 * (1 - taken) + 3]);
        strokeLine(ctx, view, line, 4);
        ctx.setLineDash([]);
      }
    }
    ctx.strokeStyle = built ? COLORS.builtRoad : COLORS.dirtRoad;
    ctx.lineWidth = (built ? 7 : 6) * markScale;
    ctx.setLineDash(built ? [] : [10 * markScale, 5 * markScale]);
    strokeLine(ctx, view, line);
    ctx.setLineDash([]);
    // The other side, as bands: the informal sector yellow on one side of the road, trucks
    // brown on the other, each as wide as how many are on it.
    const crowded = crowd.get(segment.id);
    if (crowded) {
      const edge = (8 + load * 7) * markScale / 2 + 1.5 * markScale;
      if (crowded.informal >= 0.3) {
        ctx.strokeStyle = COLORS.danfo;
        ctx.lineWidth = Math.min(5, 1 + crowded.informal * 0.35) * markScale;
        strokeOffset(ctx, view, line, -edge);
      }
      if (crowded.trucks >= 0.3) {
        ctx.strokeStyle = COLORS.goods;
        ctx.lineWidth = Math.min(5, 1 + crowded.trucks * 0.35) * markScale;
        strokeOffset(ctx, view, line, edge);
      }
    }
    // A strike (pushback.ts): the road struck through in red, named where it happens.
    if (struck.has(segment.id)) {
      ctx.strokeStyle = COLORS.strike;
      ctx.lineWidth = 3;
      ctx.setLineDash([3, 7]);
      strokeLine(ctx, view, line);
      ctx.setLineDash([]);
    }
    // Wear: cracks across the road, closer together the worse it is.
    // Maintained roads get a centre line instead -- someone keeps them.
    ctx.setLineDash([]);
    if (world.maintained.has(segment.id)) {
      ctx.strokeStyle = COLORS.kept;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      strokeLine(ctx, view, line);
      ctx.setLineDash([]);
    } else if (segment.condition < 0.85) {
      drawCracks(ctx, view, line, segment.condition);
    }
  }
  fadeNow = 1;
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

// A warden mark at the middle of each strictly enforced lane: someone is
// keeping it clear (pushback.ts).
function drawWardens(ctx: CanvasRenderingContext2D, world: GameWorld, view: View): void {
  for (const lane of world.lanes) {
    if (lane.enforcement !== "strict" || lane.strikeUntil > world.economy.elapsedSeconds) continue;
    const line = (roadChain(world, lane.a, lane.b) ?? []).flatMap((piece) => segmentPolyline(world.simulation.map, piece));
    if (line.length === 0) continue;
    const [, rest] = splitPolyline(line, polylineLength(line) / 2);
    const mid = toScreen(view, rest[0]!.x, rest[0]!.y);
    ctx.fillStyle = COLORS.player;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mid.x - 16, mid.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "700 9px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("W", mid.x - 16, mid.y + 0.5);
  }
}

// A strike on the map, where it happens (pushback.ts): a tag at the
// corridor's middle, drawn after the towns so nothing covers it -- amber
// when the union has called one ("STRIKE DAY 37"), red while it runs, and a
// faint mark for a few days after with what it cost (playtest: "did a
// strike land? I couldn't tell").
const STRIKE_MARK_DAYS = 5;
// A corridor just taken from the danfos, or lost back to them (corridors.ts
// corridorChanges): a tag for a few days, a third of the way along -- its
// middle is where a roadside town tends to sit, and where a strike's tag
// goes. One that stays taken is the panel's, not the map's.
function drawTakenLabels(ctx: CanvasRenderingContext2D, world: GameWorld, view: View): void {
  ctx.save(); // its centred text mustn't leak into what draws next (the price label)
  for (const corridor of corridorChanges(world)) {
    const line = (roadChain(world, corridor.a, corridor.b) ?? []).flatMap((piece) => segmentPolyline(world.simulation.map, piece));
    if (line.length === 0) continue;
    const [, rest] = splitPolyline(line, polylineLength(line) / 3);
    const mid = toScreen(view, rest[0]!.x, rest[0]!.y);
    const taken = corridor.change === "taken";
    const text = taken ? "TAKEN" : "LOST";
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const width = ctx.measureText(text).width + 10;
    ctx.fillStyle = taken ? COLORS.player : COLORS.home;
    ctx.beginPath();
    ctx.roundRect(mid.x - 14 - width, mid.y - 9, width, 18, 4);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(text, mid.x - 14 - width / 2, mid.y);
  }
  ctx.restore();
}

function drawStrikeLabels(ctx: CanvasRenderingContext2D, world: GameWorld, view: View): void {
  ctx.save();
  const now = world.economy.elapsedSeconds;
  for (const lane of world.lanes) {
    const last = lane.lastStrike;
    const tag =
      lane.strikeUntil > now ? { text: "STRIKE", fill: COLORS.strike, ink: "#fff" }
      : lane.strikeAt > now ? { text: `STRIKE DAY ${gameDay(world, lane.strikeAt)}`, fill: COLORS.slow, ink: "#fff" }
      : last && now - last.endedAt < STRIKE_MARK_DAYS * SECONDS_PER_GAME_DAY
        ? { text: `struck day ${gameDay(world, last.startedAt)}${last.cost === null ? "" : last.cost < 1 ? " · no loss" : ` · ₦${Math.round(last.cost).toLocaleString()}`}`, fill: "rgba(201, 42, 42, 0.14)", ink: COLORS.strike }
        : null;
    if (!tag) continue;
    const line = (roadChain(world, lane.a, lane.b) ?? []).flatMap((piece) => segmentPolyline(world.simulation.map, piece));
    if (line.length === 0) continue;
    const [, rest] = splitPolyline(line, polylineLength(line) / 2);
    const mid = toScreen(view, rest[0]!.x, rest[0]!.y);
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const width = ctx.measureText(tag.text).width + 10;
    ctx.fillStyle = tag.fill;
    ctx.beginPath();
    ctx.roundRect(mid.x + 14, mid.y - 9, width, 18, 4);
    ctx.fill();
    ctx.fillStyle = tag.ink;
    ctx.fillText(tag.text, mid.x + 14 + width / 2, mid.y);
  }
  ctx.restore();
}

// Track: a dark rail line with sleepers across it -- width and surface, not
// hue, tell road and rail apart (principles §3, Display). Derelict track is
// faded, its sleepers broken up: on the map, but nothing runs on it.
function drawTrack(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, line: Point[], derelict: boolean): void {
  ctx.globalAlpha = alpha(derelict ? 0.45 : 1);
  ctx.strokeStyle = COLORS.bridge;
  ctx.lineWidth = 11;
  ctx.lineCap = "butt";
  for (const run of bridgeRuns(world, line)) strokeLine(ctx, view, run);
  const length = polylineLength(line);
  ctx.strokeStyle = COLORS.rail;
  ctx.lineWidth = 1.5;
  for (let at = 0.4; at < length; at += 0.8) {
    if (derelict && Math.floor(at / 0.8) % 3 === 0) continue; // missing sleepers
    const [, rest] = splitPolyline(line, at);
    const p = rest[0]!;
    const q = rest.find((r) => Math.hypot(r.x - p.x, r.y - p.y) > 1e-6) ?? p;
    const angle = Math.atan2(q.y - p.y, q.x - p.x) + Math.PI / 2;
    const s = toScreen(view, p.x, p.y);
    ctx.beginPath();
    ctx.moveTo(s.x - Math.cos(angle) * 5, s.y - Math.sin(angle) * 5);
    ctx.lineTo(s.x + Math.cos(angle) * 5, s.y + Math.sin(angle) * 5);
    ctx.stroke();
  }
  ctx.lineWidth = 2.5;
  ctx.setLineDash(derelict ? [6, 6] : []);
  strokeLine(ctx, view, line);
  ctx.setLineDash([]);
  ctx.lineCap = "round";
  ctx.globalAlpha = alpha(1);
}

function drawCracks(ctx: CanvasRenderingContext2D, view: View, line: Point[], condition: number): void {
  const length = polylineLength(line);
  // From one crack every ~4 cells just below "fine" to one per cell at the floor.
  const wear = Math.min(1, (0.85 - condition) / 0.55);
  const spacing = 4 - 3 * wear;
  ctx.strokeStyle = COLORS.crack;
  ctx.globalAlpha = alpha(0.45 + 0.4 * wear);
  ctx.lineWidth = 1.5;
  for (let at = spacing / 2; at < length; at += spacing) {
    const [, rest] = splitPolyline(line, at);
    const p = rest[0]!;
    const q = rest.find((r) => Math.hypot(r.x - p.x, r.y - p.y) > 1e-6) ?? p;
    const angle = Math.atan2(q.y - p.y, q.x - p.x) + Math.PI / 2 + (at % 2 > 1 ? 0.35 : -0.35);
    const s = toScreen(view, p.x, p.y);
    ctx.beginPath();
    ctx.moveTo(s.x - Math.cos(angle) * 4, s.y - Math.sin(angle) * 4);
    ctx.lineTo(s.x + Math.cos(angle) * 4, s.y + Math.sin(angle) * 4);
    ctx.stroke();
  }
  ctx.globalAlpha = alpha(1);
}

function drawRoadHighlight(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, segmentId: string): void {
  const segment = world.simulation.map.segments.find((s) => s.id === segmentId);
  if (!segment) return;
  ctx.strokeStyle = COLORS.selection;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  strokeLine(ctx, view, segmentPolyline(world.simulation.map, segment));
  ctx.globalAlpha = 1;
}

/** Roads slower than this share of free flow draw a traffic casing. */
const SLOW_ROAD_SPEED = 0.9;
/** Below this a road reads as jammed (red); between it and SLOW_ROAD_SPEED, busy (orange). */
const JAMMED_ROAD_SPEED = 0.7;

// Each route is drawn as a coloured line over the roads it runs on, offset
// a little per route so two routes sharing a road both stay visible.
// Route lines, Mini Metro's way (the restyle, 2026-10-20; playtest, map
// 2411: lines piled into one thick bundle at Gusau): every road keeps a slot
// for each route on it, side by side across the road, and each route draws
// parallel to the road in its slot, road by road. Slots are counted in the
// road's own direction, so a route keeps its side whichever way it runs.
function drawRouteLines(ctx: CanvasRenderingContext2D, world: GameWorld, view: View): void {
  const SPACING = 4 * markScale;
  const lines: Array<{ id: string; edges: Array<{ from: string; to: string; routing: RoutingContext }>; color: string; dashed: boolean }> = [];
  world.routes.forEach((route, index) => {
    const vehicle = world.simulation.vehicles.find((candidate) => candidate.id === route.vehicleIds[0]);
    if (!vehicle) return;
    const half = halfPath(vehicle.path, route.a, route.b);
    const routing = routingFor(world, vehicle);
    lines.push({ id: route.id, edges: half.slice(1).map((to, i) => ({ from: half[i]!, to, routing })), color: routeColor(index), dashed: false });
  });
  for (const route of world.lorryRoutes) {
    const vehicle = world.simulation.vehicles.find((candidate) => candidate.id === route.vehicleIds[0]);
    if (!vehicle) continue;
    const half = halfPath(vehicle.path, route.a, route.b);
    const routing = routingFor(world, vehicle);
    lines.push({ id: route.id, edges: half.slice(1).map((to, i) => ({ from: half[i]!, to, routing })), color: COLORS.goods, dashed: true });
  }
  // Each road's routes, in the order they're drawn: their slots across it.
  const segmentOf = (from: string, to: string, routing: RoutingContext) => routing.graph.get(from)?.find((edge) => edge.to === to)?.segmentId ?? `${from}>${to}`;
  const onSegment = new Map<string, number[]>();
  lines.forEach((line, k) => {
    for (const edge of line.edges) {
      const id = segmentOf(edge.from, edge.to, edge.routing);
      const list = onSegment.get(id) ?? [];
      if (!list.includes(k)) list.push(k);
      onSegment.set(id, list);
    }
  });
  ctx.lineWidth = 3 * markScale;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  lines.forEach((line, k) => {
    fadeNow = focus && !focus.routes.has(line.id) ? FADED : 1;
    ctx.strokeStyle = line.color;
    ctx.globalAlpha = alpha(0.85);
    ctx.setLineDash(line.dashed ? [8, 5] : []);
    for (const edge of line.edges) {
      const id = segmentOf(edge.from, edge.to, edge.routing);
      const slots = onSegment.get(id)!;
      const offset = (slots.indexOf(k) - (slots.length - 1) / 2) * SPACING;
      const points = edgeLine(world, edge.from, edge.to, edge.routing).map((p) => toScreen(view, p.x, p.y));
      // Slots in the road's own direction: flip for a route running it the other way.
      const segment = world.simulation.map.segments.find((candidate) => candidate.id === id);
      const sign = segment && segment.fromNodeId !== edge.from ? -1 : 1;
      strokeParallel(ctx, points, offset * sign);
    }
  });
  fadeNow = 1;
  ctx.setLineDash([]);
  ctx.globalAlpha = alpha(1);
  ctx.lineCap = "butt";
}

/** A polyline drawn `offset` px to its left (screen space), each point moved along its corner's mean normal. */
function strokeParallel(ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>, offset: number): void {
  if (points.length < 2) return;
  const normal = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  };
  ctx.beginPath();
  points.forEach((p, i) => {
    const before = i > 0 ? normal(points[i - 1]!, p) : null;
    const after = i < points.length - 1 ? normal(p, points[i + 1]!) : null;
    const n = before && after ? { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 } : (before ?? after)!;
    const x = p.x + n.x * offset, y = p.y + n.y * offset;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// Desire lines: straight from the focused town to every town its people
// want to reach, thickness = how many want that trip, and the line itself a
// stacked bar of who carries them -- blue from your end, then informal, then
// stayed home. A thick yellow or grey line is a route waiting to be built
// (docs/principles.md §3: show relationships, not just state).
function drawDesireLines(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, focus: string): void {
  const from = world.towns.get(focus);
  if (!from) return;
  const trips = tripsFrom(world, focus);
  const maxDemand = Math.max(...trips.map((trip) => trip.demand), 1e-9);
  const a = toScreen(view, from.x, from.y);
  ctx.lineCap = "butt";
  for (const trip of trips) {
    const other = world.towns.get(trip.to);
    if (!other) continue;
    const b = toScreen(view, other.x, other.y);
    const width = 2 + 12 * Math.sqrt(trip.demand / maxDemand);
    const { player, informal, lost } = trip.share;
    const known = player + informal + lost;
    // Before any outcome has been measured, draw it as unserved.
    const parts: Array<[number, string]> = known > 0
      ? [[player, COLORS.player], [informal, COLORS.danfo], [lost, COLORS.home]]
      : [[1, COLORS.home]];
    let t0 = 0;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = width;
    // No road joins them: dashed, so it reads as "no way there", not as a
    // connection.
    ctx.setLineDash(trip.reachable ? [] : [Math.max(6, width), Math.max(5, width * 0.8)]);
    for (const [fraction, color] of parts) {
      if (fraction <= 0) continue;
      const t1 = t0 + fraction;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0);
      ctx.lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1);
      ctx.stroke();
      t0 = t1;
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const perDay = Math.round(trip.demand * SECONDS_PER_GAME_DAY);
    const mid = { x: a.x + (b.x - a.x) * 0.62, y: a.y + (b.y - a.y) * 0.62 };
    ctx.font = "600 11px system-ui, sans-serif";
    const label = `${perDay}/day`;
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.roundRect(mid.x - w / 2, mid.y - 9, w, 17, 4);
    ctx.fill();
    ctx.fillStyle = COLORS.label;
    ctx.textAlign = "center";
    ctx.fillText(label, mid.x, mid.y + 3);
    ctx.textAlign = "left";
  }
  ctx.lineCap = "round";
}

/** One direction of a shuttle's cyclic path: a ... b. */
function halfPath(path: string[], a: string, b: string): string[] {
  const start = path.indexOf(a);
  if (start === -1) return path;
  const nodes: string[] = [];
  for (let k = 0; k <= path.length; k += 1) {
    const nodeId = path[(start + k) % path.length]!;
    nodes.push(nodeId);
    if (nodeId === b) break;
  }
  return nodes;
}

function drawGhostLine(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, ghost: Ghost): void {
  // Green or red by what it's forecast to earn, once the forecast is in:
  // the colour is readable at 4x, the label's second line isn't.
  const tone = ghost.forecast?.tone;
  ctx.strokeStyle = !ghost.ok || tone === "bad" ? COLORS.ghostBad : tone === "good" ? COLORS.forecastGood : COLORS.ghostOk;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  const routing = ghost.rail ? world.railRouting : world.simulation.routing;
  const line = ghost.line ?? (ghost.path ? ghost.path.slice(1).flatMap((to, i) => edgeLine(world, ghost.path![i]!, to, routing)) : null);
  if (line) {
    // The road you'd get, bends and all: where it goes round, it's longer.
    ctx.lineWidth = 3;
    strokeLine(ctx, view, line);
  } else {
    const from = world.towns.get(ghost.from)!;
    const a = toScreen(view, from.x, from.y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(ghost.to.x, ghost.to.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawLabel(ctx: CanvasRenderingContext2D, to: { x: number; y: number }, label: string, ok: boolean, forecast?: ForecastLine): void {
  const ghost = { to, label, ok };
  if (ghost.label) {
    // Laid out from the left edge: say so, whatever drew before (a centred tag once shifted the text off its box).
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "12px system-ui, sans-serif";
    const subWidth = forecast ? ctx.measureText(forecast.text).width : 0;
    ctx.font = "600 13px system-ui, sans-serif";
    const w = Math.max(ctx.measureText(ghost.label).width, subWidth) + 12;
    const h = forecast ? 40 : 22;
    // Flip left of the cursor rather than run under the side panel (main.ts
    // fitView leaves it 300px when the window is wide enough to have one).
    const right = window.innerWidth > 900 ? window.innerWidth - 300 : window.innerWidth;
    const x = ghost.to.x + 12 + w > right - 8 ? Math.max(8, ghost.to.x - 12 - w) : ghost.to.x + 12;
    const y = ghost.to.y - 26 - (h - 22);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.strokeStyle = ghost.ok ? COLORS.ghostOk : COLORS.ghostBad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ghost.ok ? COLORS.label : COLORS.ghostBad;
    ctx.fillText(ghost.label, x + 6, y + 15);
    if (forecast) {
      ctx.font = forecast.tone === "pending" ? "italic 12px system-ui, sans-serif" : "600 12px system-ui, sans-serif";
      ctx.fillStyle = forecast.tone === "good" ? COLORS.forecastGood : forecast.tone === "bad" ? COLORS.ghostBad : COLORS.labelMuted;
      ctx.fillText(forecast.text, x + 6, y + 33);
    }
  }
}

function vehiclePose(world: GameWorld, view: View, vehicle: Vehicle): { x: number; y: number; angle: number } | null {
  const length = vehicle.path.length;
  if (length < 2 || vehicle.pathIndex >= length) return null;
  const line = edgeLine(world, vehicle.path[(vehicle.pathIndex - 1 + length) % length]!, vehicle.path[vehicle.pathIndex]!, routingFor(world, vehicle));
  // Along the road as it runs, facing the way it's heading there.
  const [, ahead] = splitPolyline(line, polylineLength(line) * vehicle.edgeProgress);
  const here = ahead[0]!;
  const next = ahead.find((q) => Math.hypot(q.x - here.x, q.y - here.y) > 1e-6) ?? line[line.length - 1]!;
  const prev = line[0]!;
  const angle = next === here ? Math.atan2(here.y - prev.y, here.x - prev.x) : Math.atan2(next.y - here.y, next.x - here.x);
  const p = toScreen(view, here.x, here.y);
  // Keep right: opposite directions on one road don't overlap.
  const side = 5 * markScale;
  return { x: p.x - Math.sin(angle) * side, y: p.y + Math.cos(angle) * side, angle };
}

function drawVehicles(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, oneByOne: boolean): void {
  const routeIndex = new Map<string, number>();
  world.routes.forEach((route, index) => route.vehicleIds.forEach((id) => routeIndex.set(id, index)));
  const routeOf = new Map<string, string>();
  for (const route of [...world.routes, ...world.lorryRoutes]) for (const id of route.vehicleIds) routeOf.set(id, route.id);
  // Focus: a vehicle of a route out of focus, or on a road out of focus, draws faded.
  const vehicleFade = (vehicle: Vehicle): number => {
    if (!focus) return 1;
    const route = routeOf.get(vehicle.id);
    if (route) return focus.routes.has(route) ? 1 : FADED;
    const length = vehicle.path.length;
    const from = vehicle.path[(vehicle.pathIndex - 1 + length) % length];
    const id = from ? world.simulation.routing.graph.get(from)?.find((edge) => edge.to === vehicle.path[vehicle.pathIndex])?.segmentId : undefined;
    return id && focus.segments.has(id) ? 1 : FADED;
  };

  for (const vehicle of world.simulation.vehicles) {
    // At 4x and zoomed out, the other side is its bands (drawRoads): only yours move.
    if (!oneByOne && vehicle.lifecycle === "one-shot") continue;
    const pose = vehiclePose(world, view, vehicle);
    if (!pose) continue;
    ctx.save();
    ctx.globalAlpha = vehicleFade(vehicle);
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.angle);
    ctx.scale(markScale, markScale);
    if (vehicle.lifecycle === "one-shot") {
      drawInformal(ctx, world.informal.active.get(vehicle.id)?.mode ?? "danfo");
    } else if (world.railVehicles.has(vehicle.id) && vehicle.carries === "goods") {
      // A freight train: dark engine, then brown wagons filled by load.
      const load = vehicle.cargo.reduce((sum, entry) => sum + entry.amount, 0) / vehicle.capacity;
      ctx.fillStyle = COLORS.rail;
      ctx.fillRect(12, -5, 8, 10);
      for (let i = 0; i < 3; i += 1) {
        const x = -22 + i * 11;
        ctx.strokeStyle = COLORS.goods;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, -4, 10, 8);
        ctx.fillStyle = COLORS.goods;
        ctx.fillRect(x, -4, 10 * Math.max(0, Math.min(1, load * 3 - i)), 8);
      }
    } else if (world.railVehicles.has(vehicle.id)) {
      // A train: long, dark, its route's colour along the side, filled by load.
      const color = routeColor(routeIndex.get(vehicle.id) ?? 0);
      const load = vehicle.cargo.reduce((sum, entry) => sum + entry.amount, 0) / vehicle.capacity;
      ctx.fillStyle = COLORS.rail;
      ctx.beginPath();
      ctx.roundRect(-18, -5, 36, 10, 3);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(-17, -3, 34 * Math.min(1, load), 6);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-17, -3, 34, 6);
    } else if (vehicle.carries === "goods") {
      // A lorry: longer than a bus, brown, filled from the back by its load.
      const load = vehicle.cargo.reduce((sum, entry) => sum + entry.amount, 0) / vehicle.capacity;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = COLORS.goods;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-13, -5, 26, 10, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.goods;
      ctx.fillRect(-12, -4, 24 * Math.min(1, load), 8);
      ctx.fillRect(9, -5, 4, 10); // cab
    } else {
      const color = routeColor(routeIndex.get(vehicle.id) ?? 0);
      const load = vehicle.cargo.reduce((sum, entry) => sum + entry.amount, 0) / vehicle.capacity;
      // A minibus is drawn smaller than a bus, a BRT bus longer (articulated): the size is the seats.
      const half = vehicle.id.startsWith("minibus-") ? 6.5 : vehicle.id.startsWith("brt-") ? 15 : 10;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-half, -5, half * 2, 10, 3);
      ctx.fill();
      ctx.stroke();
      // How full it is, as a fill from the back.
      ctx.fillStyle = color;
      ctx.fillRect(-half + 1, -4, (half * 2 - 2) * Math.min(1, load), 8);
    }
    ctx.restore();
  }
}

// The informal sector, at a glance: a danfo is a yellow minibus with a black
// stripe, a keke a small yellow tricycle with a green band, an okada a dark
// dot, a trucker's lorry brown with a yellow cab. Sizes follow road space, so a swarm of okadas reads as many small
// things, not as many danfos.
function drawInformal(ctx: CanvasRenderingContext2D, mode: InformalMode): void {
  ctx.strokeStyle = COLORS.danfoStripe;
  ctx.lineWidth = 1.2;
  if (mode === "danfo") {
    ctx.fillStyle = COLORS.danfo;
    ctx.beginPath();
    ctx.roundRect(-6, -3.5, 12, 7, 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.danfoStripe;
    ctx.fillRect(-6, -0.6, 12, 1.2);
  } else if (mode === "keke") {
    ctx.fillStyle = COLORS.danfo;
    ctx.beginPath();
    ctx.roundRect(-3.5, -3, 7, 6, 2.5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.keke;
    ctx.fillRect(-3.5, -1, 7, 2);
  } else if (mode === "truck") {
    // A trucker's lorry: your lorry's brown, in the informal sector's
    // outline and stripe -- freight, but not yours.
    ctx.fillStyle = COLORS.goods;
    ctx.beginPath();
    ctx.roundRect(-9, -3.5, 18, 7, 1.5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.danfo;
    ctx.fillRect(6, -3.5, 3, 7); // cab
  } else {
    ctx.fillStyle = COLORS.danfoStripe;
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Each town shows two things at a glance. The ring: where its passengers
// ended up (yours / informal / stayed home). The dots: who is waiting right
// now, one dot per few people.
// Screen boxes already taken this frame (towns and their labels, then site
// labels): where a site's name may not go.
interface Box { x: number; y: number; w: number; h: number }
let occupied: Box[] = [];
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// A metro (metro.ts): a small round M at a town's bottom-left, a dot a line beside it.
function drawMetroMark(ctx: CanvasRenderingContext2D, x: number, y: number, lines: number): void {
  ctx.fillStyle = COLORS.player;
  ctx.beginPath();
  ctx.arc(x + 5, y + 5, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "700 7px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("M", x + 5, y + 5.5);
  ctx.fillStyle = COLORS.player;
  for (let i = 0; i < lines; i += 1) ctx.fillRect(x + 12 + i * 4, y + 4, 2.5, 2.5);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

// A motor park (parks.ts): a small danfo-yellow square with a P, at a town's top-right.
function drawParkMark(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = COLORS.danfo;
  ctx.strokeStyle = COLORS.kept;
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, 9, 9);
  ctx.strokeRect(x + 0.5, y + 0.5, 8, 8);
  ctx.fillStyle = COLORS.kept;
  ctx.font = "700 7px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("P", x + 4.5, y + 5);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

// A haulage yard (yards.ts): a small brown square at a town's or site's
// top-left, where goods leave from and hauliers reach further.
function drawYardMark(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = COLORS.goods;
  ctx.strokeStyle = COLORS.kept;
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, 7, 7);
  ctx.strokeRect(x + 0.5, y + 0.5, 6, 6);
}

function drawTown(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, town: GameTown, state: DrawState): void {
  const p = toScreen(view, town.x, town.y);
  const r = townRadius(town, view);
  // The town, and its name and size below it, are taken.
  ctx.font = "600 13px system-ui, sans-serif";
  const nameW = Math.max(ctx.measureText(town.name).width, 30);
  occupied.push({ x: p.x - r - 6, y: p.y - r - 6, w: 2 * r + 12, h: 2 * r + 12 });
  occupied.push({ x: p.x - nameW / 2 - 2, y: p.y + r + 5, w: nameW + 4, h: isCutOff(world, town.id) ? 42 : 30 });

  const share = townShare(world, town.id);
  const ringR = r + 5;
  ctx.lineWidth = 5;
  if (share.player + share.informal + share.lost > 0) {
    let start = -Math.PI / 2;
    for (const [value, color] of [
      [share.player, COLORS.player],
      [share.informal, COLORS.danfo],
      [share.lost, COLORS.home],
    ] as const) {
      const sweep = value * Math.PI * 2;
      if (sweep <= 0) continue;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringR, start, start + sweep);
      ctx.stroke();
      start += sweep;
    }
  }

  const selected = state.selectedTown === town.id;
  const hovered = state.hoverTown === town.id;
  // An interchange -- riders changing buses here -- gets Mini Metro's
  // double outline: a second, inner ring.
  const changingPerDay = (world.transferRateEMA.get(town.id) ?? 0) * SECONDS_PER_GAME_DAY;
  const interchange = changingPerDay >= INTERCHANGE_RIDERS_PER_DAY;
  ctx.fillStyle = COLORS.town;
  ctx.strokeStyle = selected ? COLORS.selection : COLORS.townEdge;
  ctx.lineWidth = selected ? 3.5 : hovered ? 3 : 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (interchange && r > 6) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.townEdge;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r - 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (world.yards.has(town.id)) drawYardMark(ctx, p.x - r - 6, p.y - r - 6);
  if (world.parks.has(town.id)) drawParkMark(ctx, p.x + r - 1, p.y - r - 6);
  // A problem here (its card says what and the move): an amber mark at the town's top-right,
  // inside its ring -- the map says where before any card is read.
  if (state.problems?.has(town.id)) {
    const mx = p.x + r * 0.72;
    const my = p.y - r * 0.72;
    ctx.fillStyle = COLORS.slow;
    ctx.beginPath();
    ctx.arc(mx, my, 6.5 * markScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(10 * markScale)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", mx, my + 0.5);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
  }
  if ((world.metros.get(town.id) ?? 0) > 0) drawMetroMark(ctx, p.x - r - 7, p.y + r - 3, world.metros.get(town.id)!);

  drawWaiting(ctx, p.x + ringR + 8, p.y - ringR + 2, waitingAt(world, town.id));

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.label;
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillText(town.name, p.x, p.y + ringR + 16);
  ctx.fillStyle = COLORS.labelMuted;
  ctx.font = "11px system-ui, sans-serif";
  // Growing or shrinking, at a glance (principles §3: growth must be
  // visible without reading a number) -- the circle itself grows too.
  const heading = growthTrend(world, town.id);
  const trend = heading === "growing" ? " ▲" : heading === "shrinking" ? " ▼" : "";
  ctx.fillText(`${Math.round(town.population)}k`, p.x - (trend ? 5 : 0), p.y + ringR + 29);
  if (trend) {
    const w = ctx.measureText(`${Math.round(town.population)}k`).width;
    ctx.fillStyle = trend === " ▲" ? COLORS.grow : COLORS.ghostBad;
    ctx.textAlign = "left";
    ctx.fillText(trend.trim(), p.x - 5 + w / 2 + 3, p.y + ringR + 29);
    ctx.textAlign = "center";
  }
  // Short of fuel (fuel.ts): roadside sellers with jerrycans beside the town, more the worse it is.
  const short = shortageAt(world, town.id);
  if (short >= 0.35) {
    const cans = short >= 0.75 ? 3 : short >= 0.55 ? 2 : 1;
    for (let i = 0; i < cans; i += 1) {
      const x = p.x - ringR - 14 - i * 8;
      const y = p.y + 4 - (i % 2) * 6;
      ctx.fillStyle = "#e0901c";
      ctx.strokeStyle = "#7a4a0c";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x - 3, y - 4, 6, 8, 1.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(x - 1, y - 6, 2, 2); // the spout
    }
  }
  // A milestone just passed (score.ts): a green tag above the town for a few days.
  const milestone = freshMilestone(world, town.id);
  if (milestone) {
    ctx.font = "700 11px system-ui, sans-serif";
    const w = ctx.measureText(milestone).width + 10;
    const y = p.y - ringR - 20;
    ctx.fillStyle = COLORS.grow;
    ctx.beginPath();
    ctx.roundRect(p.x - w / 2, y - 8, w, 16, 8);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText(milestone, p.x, y + 4);
    ctx.font = "11px system-ui, sans-serif";
  }
  if (isCutOff(world, town.id)) {
    ctx.fillStyle = COLORS.ghostBad;
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText("no road", p.x, p.y + ringR + 42);
  }
  ctx.textAlign = "left";
}

// A town that emptied out stays on the map as a name on a bend in the
// road -- the loss should read, not vanish.
// An industrial site (industries.ts, brief Revision 2): a square, not a
// circle -- a place goods come from, not people -- with a peak for a quarry,
// its name and output, and "no road" while nothing reaches it.
function drawIndustry(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, town: GameTown, state: DrawState, flows: GoodsFlow[]): void {
  const p = toScreen(view, town.x, town.y);
  const half = 9;
  const selected = state.selectedTown === town.id;
  const fuel = world.fuel;
  // An idle refinery reads as out of action: greyed, like disused track.
  const idle = (town.industry === "refinery" && !fuel?.restored) || (town.industry === "works" && !world.cement?.working);
  ctx.fillStyle = idle ? COLORS.home : COLORS.goods;
  ctx.strokeStyle = selected ? COLORS.selection : COLORS.townEdge;
  ctx.lineWidth = selected ? 3 : 2;
  ctx.beginPath();
  ctx.rect(p.x - half, p.y - half, half * 2, half * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (town.industry === "depot") {
    // Two storage tanks.
    ctx.arc(p.x - 3, p.y + 1, 3.2, 0, Math.PI * 2);
    ctx.moveTo(p.x + 6.2, p.y + 1);
    ctx.arc(p.x + 3, p.y + 1, 3.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (town.industry === "refinery" || town.industry === "newrefinery") {
    // Two columns and a flare.
    ctx.rect(p.x - 5, p.y - 4, 3, 9);
    ctx.rect(p.x + 1, p.y - 6, 3, 11);
    ctx.fill();
  } else if (town.industry === "works") {
    // A kiln and its tall chimney.
    ctx.rect(p.x - 6, p.y, 9, 5);
    ctx.rect(p.x + 3, p.y - 6, 3, 11);
    ctx.fill();
  } else if (town.industry === "mill") {
    // A sack, tied at the neck.
    ctx.moveTo(p.x - 5, p.y + 6);
    ctx.lineTo(p.x - 4, p.y - 2);
    ctx.lineTo(p.x - 2, p.y - 5);
    ctx.lineTo(p.x + 2, p.y - 5);
    ctx.lineTo(p.x + 4, p.y - 2);
    ctx.lineTo(p.x + 5, p.y + 6);
    ctx.closePath();
    ctx.fill();
  } else if (town.industry === "flourmill") {
    // A wheat ear: a stalk and its grains.
    ctx.fillRect(p.x - 0.75, p.y - 2, 1.5, 8);
    for (const dy of [-5, -2, 1]) {
      ctx.moveTo(p.x - 3.5, p.y + dy);
      ctx.arc(p.x - 2, p.y + dy, 1.5, 0, Math.PI * 2);
      ctx.moveTo(p.x + 3.5, p.y + dy);
      ctx.arc(p.x + 2, p.y + dy, 1.5, 0, Math.PI * 2);
    }
    ctx.fill();
  } else if (town.industry === "silo") {
    // Two tall silos.
    ctx.rect(p.x - 5, p.y - 5, 4, 10);
    ctx.rect(p.x + 1, p.y - 5, 4, 10);
    ctx.fill();
  } else if (town.industry === "oilfield" || town.industry === "terminal") {
    // A derrick (oilfield) or a pipe and valve (terminal).
    if (town.industry === "oilfield") {
      ctx.moveTo(p.x - 5, p.y + 6);
      ctx.lineTo(p.x, p.y - 6);
      ctx.lineTo(p.x + 5, p.y + 6);
      ctx.moveTo(p.x - 3, p.y + 1);
      ctx.lineTo(p.x + 3, p.y + 1);
      ctx.stroke();
    } else {
      ctx.rect(p.x - 6, p.y - 1.5, 12, 3);
      ctx.rect(p.x - 1.5, p.y - 5, 3, 3.5);
      ctx.fill();
    }
  } else {
    // A quarry's peak.
    ctx.moveTo(p.x - 6, p.y + 5);
    ctx.lineTo(p.x - 1, p.y - 5);
    ctx.lineTo(p.x + 2, p.y);
    ctx.lineTo(p.x + 3.5, p.y - 2);
    ctx.lineTo(p.x + 6, p.y + 5);
    ctx.closePath();
    ctx.fill();
  }
  if (world.yards.has(town.id)) drawYardMark(ctx, p.x - half - 6, p.y - half - 6);
  const perDay = (rate: number) => Math.round(rate * SECONDS_PER_GAME_DAY);
  const label =
    town.industry === "depot" && fuel ? `fuel imports · ${perDay(world.tuning.fuelImportShare * fuel.baseDemand)} t/day`
    : town.industry === "refinery" && fuel ? (fuel.restored ? `fuel · ${perDay(refineryOutput(world))} t/day` : "idle · restore it")
    : town.industry === "newrefinery" ? `private · fuel ${perDay(newRefineryOutput(world))} t/day`
    : (town.industry === "oilfield" || town.industry === "terminal") && fuel ? `crude · ${fuel.restored ? `${perDay(world.tuning.crudeShare * fuel.baseDemand)} t/day` : "for the refinery"}`
    : town.industry === "works" ? (world.cement?.working ? `cement · ${perDay(worksOutput(world))} of ${perDay(worksCapacity(world))} t/day` : "idle · restore it")
    : town.industry === "silo" ? `cement imports · ${perDay(cementImports(world))} t/day`
    : town.industry === "mill" && world.food ? `${world.food.crops.food} · ${perDay(millOutput(world))} of ${perDay(millCapacity(world))} t/day`
    : town.industry === "flourmill" ? `flour · ${perDay(flourOutput(world))} of ${perDay(flourCapacity(world))} t/day`
    : `${cementActive(world) ? "limestone" : "stone"} · ${world.tuning.quarryOutputPerDay} t/day`;
  // A gauge under it: what it makes of what it could, green to red, so a
  // struggling factory shows without a click (playtest, map 2411).
  const production = siteProduction(world, town.id, flows);
  let below = 0;
  if (production && production.capacity > 0) {
    const share = Math.min(1, production.made / production.capacity);
    const gy = p.y + half + 3;
    ctx.fillStyle = "rgba(20, 30, 45, 0.18)";
    ctx.fillRect(p.x - half, gy, 2 * half, 3);
    ctx.fillStyle = production.limit === "idle" ? COLORS.home : share >= 0.8 ? COLORS.grow : share >= 0.4 ? COLORS.danfo : COLORS.ghostBad;
    ctx.fillRect(p.x - half, gy, 2 * half * Math.max(share, production.limit === "idle" ? 1 : 0.04), 3);
    below = 6;
  }
  // Its name at rest; what it makes only when you point at it (the card has
  // the rest). "No road" and "restore it" stay: they're the problem to fix.
  const focused = selected || state.hoverTown === town.id;
  const cut = isCutOff(world, town.id);
  const lines: Array<{ text: string; font: string; color: string }> = [{ text: town.name, font: "600 11px system-ui, sans-serif", color: focused ? COLORS.label : COLORS.labelMuted }];
  if (focused || label.startsWith("idle")) lines.push({ text: label, font: "11px system-ui, sans-serif", color: COLORS.labelMuted });
  if (cut) lines.push({ text: "no road", font: "600 11px system-ui, sans-serif", color: COLORS.ghostBad });
  const lineH = 13;
  const w = Math.max(...lines.map((line) => { ctx.font = line.font; return ctx.measureText(line.text).width; })) + 4;
  const h = lines.length * lineH;
  // Below, above, right, left: the first side that's free. None free: no label until you point at it.
  const spots: Array<{ box: Box; align: CanvasTextAlign; x: number }> = [
    { box: { x: p.x - w / 2, y: p.y + half + 3 + below, w, h }, align: "center", x: p.x },
    { box: { x: p.x - w / 2, y: p.y - half - 3 - h, w, h }, align: "center", x: p.x },
    { box: { x: p.x + half + 4, y: p.y - h / 2, w, h }, align: "left", x: p.x + half + 6 },
    { box: { x: p.x - half - 4 - w, y: p.y - h / 2, w, h }, align: "right", x: p.x - half - 6 },
  ];
  const spot = spots.find((s) => !occupied.some((box) => overlaps(box, s.box))) ?? (focused || cut ? spots[0] : undefined);
  occupied.push({ x: p.x - half, y: p.y - half, w: 2 * half, h: 2 * half + below });
  if (!spot) return;
  occupied.push(spot.box);
  ctx.textAlign = spot.align;
  lines.forEach((line, i) => {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, spot.x, spot.box.y + 10 + i * lineH);
  });
  ctx.textAlign = "left";
}

function drawRuin(ctx: CanvasRenderingContext2D, view: View, town: GameTown): void {
  const p = toScreen(view, town.x, town.y);
  ctx.fillStyle = COLORS.home;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.labelMuted;
  ctx.font = "italic 11px system-ui, sans-serif";
  ctx.fillText(`${town.name} (${town.industry ? "closed" : "empty"})`, p.x, p.y + 16);
  ctx.textAlign = "left";
}

/** Riders changing buses per day before a town draws as an interchange. */
const INTERCHANGE_RIDERS_PER_DAY = 3;

const PEOPLE_PER_DOT = 4;
const DOTS_PER_ROW = 6;
const MAX_DOTS = 30;

function drawWaiting(ctx: CanvasRenderingContext2D, x: number, y: number, waiting: number): void {
  const dots = Math.round(waiting / PEOPLE_PER_DOT);
  ctx.fillStyle = COLORS.waiting;
  for (let i = 0; i < Math.min(dots, MAX_DOTS); i += 1) {
    const col = i % DOTS_PER_ROW;
    const row = Math.floor(i / DOTS_PER_ROW);
    ctx.beginPath();
    ctx.arc(x + col * 5, y + row * 5, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  if (dots > MAX_DOTS) {
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText(`${Math.round(waiting)}`, x, y + Math.ceil(MAX_DOTS / DOTS_PER_ROW) * 5 + 10);
  }
}
