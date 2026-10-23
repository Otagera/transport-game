import type { GameTown, GameWorld } from "@engine/game/types";
import type { RoutingContext, Vehicle } from "@engine/simulation/types";
import { routingFor } from "@engine/game/rail";
import { gameDay, roadChain, townShare } from "@engine/game/world";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import { growthTrend } from "@engine/game/growth";
import { corridorChanges, corridorSummaries } from "@engine/game/corridors";
import { noSeatPairs } from "@engine/game/problems";
import { polylineLength, segmentPolyline, splitPolyline, type Point } from "@engine/game/roads";
import { roadCapacity } from "@engine/game/congestion";
import { siteProduction } from "@engine/game/production";
import { flowKey, goodsFlows } from "@engine/game/goods";
import { cargoName } from "@engine/game/fuel";
import { farmTowns } from "@engine/game/food";
import { GLYPHS, drawBadge, drawSite as drawSiteIcon, drawTown as drawTownIcon, tierOf, tierRadius, type Badge, type Glyph, type SiteState, type Tier } from "./icons";

// The game's map, ported from the information lab (info-lab.html; brief, the carry-over plan:
// information design, settled 2026-10-23). The map answers "where": roads by their traffic and
// how full they run, your service as one blue line along them and your vehicles filled as full as
// their route runs, the other side as bands beside each road with its vehicles drawn on top when
// there's room, towns with a ring of who carries their trips, a trend and a problem mark, and one
// overlay at a time (demand, no seat, the informal share, goods). Focus fades what isn't part of
// what you point at; zoom spreads marks apart.
//
// What the lab had no need to show and the game does -- the preview of what you're building, the
// fix tool's road, strike tags, wardens, a yard/park/metro mark, an emptied town -- is drawn in
// the lab's style. Everything else the old map drew (per-route colours, surface dashes and cracks,
// bridge decks, contours and ground names, waiting dots, fuel cans, milestone tags, desire lines)
// is gone from the map: the cards, the overlays and the log carry it.

export const COLORS = {
  ground: "#f4f6f3",
  groundEdge: "#dde3ea",
  water: "#b7d4e8",
  hill: "#6e786e",
  surface: "#ffffff",
  kept: "#ffffff",
  ink: "#1b2129",
  ink2: "#4a5563",
  muted: "#7b8694",
  rail: "#3f4852",
  player: "#2a78d6",
  danfo: "#e0a400",
  goods: "#8a5a2b",
  home: "#a3abb5",
  grow: "#2b8a3e",
  free: "#c3cbd4",
  busy: "#e8742c",
  jammed: "#c92a2a",
  warn: "#c77700",
  // Kept names the page and the previews use.
  label: "#1b2129",
  labelMuted: "#7b8694",
  selection: "#1b2129",
  ghostOk: "#1b2129",
  ghostBad: "#c92a2a",
  forecastGood: "#2b8a3e",
  strike: "#c92a2a",
  slow: "#e8742c",
  // The goods overlay, by chain (the lab's validated categorical slots).
  fuel: "#e34948",
  building: "#6250d6",
  food: "#1baf7a",
};

/** The page's route swatches: every route is your blue on the map now; the list keeps a hue each to tell them apart. */
const ROUTE_COLORS = ["#2a78d6", "#1baf7a", "#6250d6", "#eb6834", "#1c7ed6", "#5f3dc4", "#c2255c", "#2b8a3e"];
export function routeColor(index: number): string {
  return ROUTE_COLORS[index % ROUTE_COLORS.length]!;
}

export interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** The scale that shows the whole map (fitView sets it); zoomed in, `scale` is bigger. */
  fit?: number;
}

export function fitView(world: GameWorld, width: number, height: number, padding: number, topInset: number, bottomInset = 0, leftInset = 0, rightInset = leftInset): View {
  const usableH = height - topInset - bottomInset - padding * 2;
  const usableW = width - padding * 2 - leftInset - rightInset;
  const scale = Math.min(usableW / world.width, usableH / world.height);
  return { scale, offsetX: leftInset + padding + (usableW - world.width * scale) / 2, offsetY: topInset + padding + (usableH - world.height * scale) / 2, fit: scale };
}

export function toScreen(view: View, x: number, y: number): { x: number; y: number } {
  return { x: view.offsetX + x * view.scale, y: view.offsetY + y * view.scale };
}

/** Marks grow with the zoom, but slower than the map (its square root): room opens between them. */
const growOf = (view: View) => (view.fit ? Math.sqrt(view.scale / view.fit) : 1);

/** The icons (icons.ts, agreed in the information lab 2026-10-23): a site's tile, this many px across at fit. */
const SITE_SIZE = 17;
/** The region's biggest town, the city (icons.ts tiers): set each draw. */
let cityId: string | null = null;
const tierOfTown = (town: GameTown): Tier => tierOf(town.population, town.id === cityId);

/** The lab's sizes: a town by its tier and people, a site its tile; both grow with the zoom's square root. */
export function townRadius(town: GameTown, view: View): number {
  return (town.industry ? SITE_SIZE / 2 : tierRadius(tierOfTown(town), town.population)) * growOf(view);
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

export type Overlay = "none" | "demand" | "noseat" | "informal" | "goods";

export interface DrawState {
  selectedTown: string | null;
  hoverTown: string | null;
  /** The town in focus (hovered, else selected). */
  focusTown: string | null;
  ghost: Ghost | null;
  /** The fix tool's hovered road, and what to say about it. */
  road?: { segmentId: string; at: { x: number; y: number }; label: string; forecast?: ForecastLine } | null;
  /** How fast the game runs (1, 2, 4): at 4x and zoomed out, the other side is drawn as bands only. */
  gameSpeed?: number;
  /** A route whose card is hovered: it and its roads in focus, the rest faded. */
  focusRoute?: string | null;
  /** Towns whose card names a problem: an amber mark. */
  problems?: ReadonlySet<string>;
  /** The overlay on the map, one at a time. */
  overlay?: Overlay;
}

// --- Frame state ------------------------------------------------------------------

/** How much bigger marks draw than at the whole-map view (the square root of the zoom). */
let markScale = 1;
const FADED = 0.18;
interface Focus { segments: Set<string>; routes: Set<string>; towns: Set<string> }
let focus: Focus | null = null;
/** The towns whose name fits this frame (labelled, below). */
let labelled = new Set<string>();

/** A town's roads and the routes that stop there; or a route and the roads it runs on. */
function focusOf(world: GameWorld, state: DrawState): Focus | null {
  if (!state.focusTown && !state.focusRoute) return null;
  const segments = new Set<string>();
  const routes = new Set<string>();
  const towns = new Set<string>();
  const addRoute = (route: { id: string; vehicleIds: string[] }) => {
    routes.add(route.id);
    const vehicle = world.simulation.vehicles.find((v) => v.id === route.vehicleIds[0]);
    if (!vehicle) return;
    const routing = routingFor(world, vehicle);
    vehicle.path.forEach((to, i) => {
      towns.add(to);
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
    towns.add(town);
    for (const seg of world.simulation.map.segments) if (seg.fromNodeId === town || seg.toNodeId === town) {
      segments.add(seg.id);
      towns.add(seg.fromNodeId);
      towns.add(seg.toNodeId);
    }
    for (const route of all) {
      const vehicle = world.simulation.vehicles.find((v) => v.id === route.vehicleIds[0]);
      if (vehicle?.path.includes(town)) addRoute(route);
    }
  }
  return { segments, routes, towns };
}

/** The other side on each road now (danfos, kekes, okadas; trucks), rolled a little frame to frame so a band doesn't jump. */
const band = new Map<string, { informal: number; trucks: number }>();
function otherSideOnRoads(world: GameWorld): Map<string, { informal: number; trucks: number }> {
  const now = new Map<string, { informal: number; trucks: number }>();
  for (const vehicle of world.simulation.vehicles) {
    if (vehicle.lifecycle !== "one-shot") continue;
    const id = segmentOfVehicle(world, vehicle);
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

function segmentOfVehicle(world: GameWorld, vehicle: Vehicle): string | undefined {
  const length = vehicle.path.length;
  if (length < 2 || vehicle.pathIndex >= length) return undefined;
  const from = vehicle.path[(vehicle.pathIndex - 1 + length) % length]!;
  return routingFor(world, vehicle).graph.get(from)?.find((edge) => edge.to === vehicle.path[vehicle.pathIndex])?.segmentId;
}

/** Your riders a day along each road piece: each route's riders on every piece of its path. */
function yourRidersOnRoads(world: GameWorld): Map<string, number> {
  const on = new Map<string, number>();
  for (const route of world.routes) {
    const vehicle = world.simulation.vehicles.find((v) => v.id === route.vehicleIds[0]);
    if (!vehicle) continue;
    const routing = routingFor(world, vehicle);
    const riders = route.boardingRateEMA * SECONDS_PER_GAME_DAY;
    const seen = new Set<string>();
    vehicle.path.forEach((to, i) => {
      const from = vehicle.path[(i - 1 + vehicle.path.length) % vehicle.path.length]!;
      const id = routing.graph.get(from)?.find((edge) => edge.to === to)?.segmentId;
      if (id && !seen.has(id)) {
        seen.add(id);
        on.set(id, (on.get(id) ?? 0) + riders);
      }
    });
  }
  return on;
}

// --- Drawing ------------------------------------------------------------------------

export function draw(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, state: DrawState): void {
  const { width, height } = ctx.canvas;
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  markScale = growOf(view);
  focus = focusOf(world, state);
  const zoom = markScale * markScale;
  // The other side's vehicles one by one only when there's room: below 4x, or zoomed in to 2x.
  const oneByOne = (state.gameSpeed ?? 1) < 4 || zoom >= 2;
  const overlay = state.overlay ?? "none";

  drawGround(ctx, world, view);
  drawRoads(ctx, world, view, otherSideOnRoads(world), overlay !== "none");
  if (state.road) drawRoadHighlight(ctx, world, view, state.road.segmentId);
  drawOverlay(ctx, world, view, overlay);
  if (state.ghost) drawGhostLine(ctx, world, view, state.ghost);
  drawVehicles(ctx, world, view, oneByOne);
  for (const ruin of world.ruins.values()) drawRuin(ctx, view, ruin);
  cityId = [...world.towns.values()].filter((t) => !t.industry).reduce<GameTown | null>((big, t) => (!big || t.population > big.population ? t : big), null)?.id ?? null;
  farms = world.food ? new Set(farmTowns(world).map((t) => t.id)) : new Set();
  labelled = labelledTowns(world, view, state);
  for (const town of [...world.towns.values()].sort((p, q) => p.population - q.population)) {
    if (town.industry) drawSite(ctx, world, view, town, state);
    else drawTown(ctx, world, view, town, state);
  }
  drawWardens(ctx, world, view);
  drawStrikeLabels(ctx, world, view);
  drawTakenLabels(ctx, world, view);
  // Last, so nothing on the map draws through the price.
  if (state.ghost) drawLabel(ctx, state.ghost.to, state.ghost.label, state.ghost.ok, state.ghost.forecast);
  if (state.road) drawLabel(ctx, state.road.at, state.road.label, true, state.road.forecast);
  ctx.restore();
}

// --- Geometry --------------------------------------------------------------------------

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

/** A polyline moved sideways by `d` screen pixels (the lab's offsetLine). */
function strokeOffset(ctx: CanvasRenderingContext2D, view: View, line: Point[], d: number): void {
  const sp = line.map((p) => toScreen(view, p.x, p.y));
  ctx.beginPath();
  sp.forEach((p, i) => {
    const a = sp[Math.max(0, i - 1)]!;
    const b = sp[Math.min(sp.length - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const x = p.x - ((b.y - a.y) / len) * d;
    const y = p.y + ((b.x - a.x) / len) * d;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// --- Ground ------------------------------------------------------------------------------

// The terrain, drawn once a world at TERRAIN_PX pixels a cell. The water from the map's own
// river and sea lines (each a width from point to point, as terrain.ts makes its cells), so its
// edge is a smooth curve at any zoom: interpolating the cells drew their staircase on the
// region's long rivers (playtest, 2026-10-23). The hills in relief, lit from the north-west, so a
// range reads as ground rising and falling, not a grey wash ("the hills too are not clear").
const TERRAIN_PX = 12;
let terrainImage: { world: GameWorld; canvas: HTMLCanvasElement } | null = null;
function terrainCanvas(world: GameWorld): HTMLCanvasElement {
  if (terrainImage?.world === world) return terrainImage.canvas;
  const { terrain } = world.simulation.map;
  const W = terrain.width;
  const H = terrain.height;
  const c = document.createElement("canvas");
  c.width = W * TERRAIN_PX;
  c.height = H * TERRAIN_PX;
  const g = c.getContext("2d")!;
  const img = g.createImageData(c.width, c.height);
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const land = hex(COLORS.ground);
  const water = hex(COLORS.water);
  const hill = hex(COLORS.hill);
  const at = (field: ArrayLike<number>, x: number, y: number) => field[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))]!;
  const bilinear = (field: ArrayLike<number>, fx: number, fy: number) => {
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const top0 = at(field, x0, y0) * (1 - tx) + at(field, x0 + 1, y0) * tx;
    const bot0 = at(field, x0, y0 + 1) * (1 - tx) + at(field, x0 + 1, y0 + 1) * tx;
    return top0 * (1 - ty) + bot0 * ty;
  };
  // Relief a cell at a time, then interpolated: the slope facing the light (north-west) is lit,
  // the far side shaded; scaled so the map's steepest slope is full shade.
  const top = terrain.elevation.reduce((m, e) => Math.max(m, e), 0) || 1;
  const relief = new Float32Array(W * H);
  const slope = new Float32Array(W * H);
  let steepest = 0;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = (at(terrain.elevation, x + 1, y) - at(terrain.elevation, x - 1, y)) / 2;
      const dy = (at(terrain.elevation, x, y + 1) - at(terrain.elevation, x, y - 1)) / 2;
      relief[y * W + x] = dx + dy;
      slope[y * W + x] = Math.hypot(dx, dy);
      steepest = Math.max(steepest, Math.abs(dx + dy));
    }
  }
  // Contours: five to the highest hill, a line a pixel wide wherever the ground crosses one.
  const interval = top / 5;
  const lit = [255, 255, 255];
  for (let py = 0; py < c.height; py += 1) {
    for (let px = 0; px < c.width; px += 1) {
      // Cell centres sit on integer coordinates, the canvas cell's middle.
      const fx = (px + 0.5) / TERRAIN_PX - 0.5;
      const fy = (py + 0.5) / TERRAIN_PX - 0.5;
      const height = bilinear(terrain.elevation, fx, fy) / top;
      const shade = steepest > 0 ? Math.max(-1, Math.min(1, bilinear(relief, fx, fy) / steepest)) : 0;
      // Darker the higher it is; lit faces toward white, shaded ones toward the hill grey.
      const e = height * top;
      const level = e / interval;
      const toLine = (Math.abs(level - Math.round(level)) * interval) / Math.max(1e-6, bilinear(slope, fx, fy) / TERRAIN_PX);
      const contour = level > 0.5 && toLine < 1 ? 0.35 * (1 - toLine) : 0;
      const k = Math.min(0.2, height * 0.2) + (shade < 0 ? -shade * 0.35 : 0) + contour;
      const l = shade > 0 ? shade * 0.5 : 0;
      img.data.set([0, 1, 2].map((i) => land[i]! * (1 - k - l) + hill[i]! * k + lit[i]! * l).concat(255), (py * c.width + px) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  const lines = world.waterLines;
  if (lines) {
    // Each stretch a tapered capsule, as terrain.ts's cells are made: a disc at each point, the
    // band between two widths, all one fill.
    g.save();
    g.scale(TERRAIN_PX, TERRAIN_PX);
    g.translate(0.5, 0.5);
    g.fillStyle = COLORS.water;
    for (const river of lines) {
      const widthAt = (k: number) => river.widths?.[k] ?? river.width;
      river.points.forEach(([x, y], k) => {
        g.beginPath();
        g.arc(x, y, widthAt(k) / 2, 0, Math.PI * 2);
        g.fill();
      });
      for (let k = 1; k < river.points.length; k += 1) {
        const [ax, ay] = river.points[k - 1]!;
        const [bx, by] = river.points[k]!;
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
        const [ra, rb] = [widthAt(k - 1) / 2, widthAt(k) / 2];
        g.beginPath();
        g.moveTo(ax + nx * ra, ay + ny * ra);
        g.lineTo(bx + nx * rb, by + ny * rb);
        g.lineTo(bx - nx * rb, by - ny * rb);
        g.lineTo(ax - nx * ra, ay - ny * ra);
        g.closePath();
        g.fill();
      }
    }
    g.restore();
  } else {
    // A world made without its lines (the run recorder's older snapshots): the cells, as before.
    const cells = g.getImageData(0, 0, c.width, c.height);
    for (let py = 0; py < c.height; py += 1) {
      for (let px = 0; px < c.width; px += 1) {
        const wet = bilinear(terrain.water, (px + 0.5) / TERRAIN_PX - 0.5, (py + 0.5) / TERRAIN_PX - 0.5);
        const m = Math.max(0, Math.min(1, (wet - 0.5) * TERRAIN_PX * 0.5 + 0.5));
        if (m <= 0) continue;
        const o = (py * c.width + px) * 4;
        for (let i = 0; i < 3; i += 1) cells.data[o + i] = cells.data[o + i]! * (1 - m) + water[i]! * m;
      }
    }
    g.putImageData(cells, 0, 0);
  }
  terrainImage = { world, canvas: c };
  return c;
}

function drawGround(ctx: CanvasRenderingContext2D, world: GameWorld, view: View): void {
  const tl = toScreen(view, -0.5, -0.5);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(terrainCanvas(world), tl.x, tl.y, world.width * view.scale, world.height * view.scale);
  ctx.restore();
}

// --- Roads: traffic, the other side, your service -------------------------------------------

const SLOW_ROAD_SPEED = 0.9;
/** Below this a road reads as jammed (red); between it and SLOW_ROAD_SPEED, busy (orange). */
const JAMMED_ROAD_SPEED = 0.7;

function drawRoads(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, crowd: ReadonlyMap<string, { informal: number; trucks: number }>, dim: boolean): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const yours = yourRidersOnRoads(world);
  const maxYours = Math.max(1, ...yours.values());
  const alphaFor = (id: string) => (focus && !focus.segments.has(id) ? FADED : dim ? 0.45 : 1);
  for (const segment of world.simulation.map.segments) {
    const line = segmentPolyline(world.simulation.map, segment);
    ctx.globalAlpha = alphaFor(segment.id);
    if (segment.type === "rail") {
      // Track: dark, with the lab's light ties; disused, faded.
      if (world.railOutOfService.has(segment.id)) ctx.globalAlpha *= 0.45;
      ctx.setLineDash([]);
      ctx.strokeStyle = COLORS.rail;
      ctx.lineWidth = 3 * markScale;
      strokeLine(ctx, view, line);
      ctx.strokeStyle = COLORS.ground;
      ctx.lineWidth = 1 * markScale;
      ctx.setLineDash([2 * markScale, 4 * markScale]);
      strokeLine(ctx, view, line);
      ctx.setLineDash([]);
      continue;
    }
    // A road retired (retire.ts): faded and broken until it's gone.
    if (segment.retiredAt !== undefined) {
      ctx.globalAlpha *= 0.45;
      ctx.strokeStyle = COLORS.free;
      ctx.lineWidth = 2 * markScale;
      ctx.setLineDash([3 * markScale, 6 * markScale]);
      strokeLine(ctx, view, line);
      ctx.setLineDash([]);
      continue;
    }
    // By what it carries (width) and how full it runs (colour): the lab's road.
    const speed = world.segmentSpeed.get(segment.id) ?? 1;
    const load = Math.min(1.2, (world.roadFlowEMA.get(segment.id) ?? 0) / Math.max(1e-6, roadCapacity(world, segment.id)));
    const w = (2 + load * 7) * markScale;
    ctx.strokeStyle = COLORS.surface;
    ctx.lineWidth = w + 2 * markScale;
    strokeLine(ctx, view, line);
    ctx.strokeStyle = speed < JAMMED_ROAD_SPEED ? COLORS.jammed : speed < SLOW_ROAD_SPEED ? COLORS.busy : COLORS.free;
    ctx.lineWidth = w;
    strokeLine(ctx, view, line);
    if (segment.busLane) {
      ctx.strokeStyle = COLORS.player;
      ctx.lineWidth = 1.5 * markScale;
      ctx.setLineDash([6 * markScale, 4 * markScale]);
      strokeLine(ctx, view, line);
      ctx.setLineDash([]);
    }
    // The other side as bands: the informal sector yellow on one side, trucks brown on the other.
    const crowded = crowd.get(segment.id);
    if (crowded) {
      if (crowded.informal >= 0.3) {
        ctx.strokeStyle = COLORS.danfo;
        ctx.lineWidth = Math.min(6.5, 1.5 + crowded.informal * 0.5) * markScale;
        strokeOffset(ctx, view, line, -(w / 2 + 2.5 * markScale));
      }
      if (crowded.trucks >= 0.3) {
        ctx.strokeStyle = COLORS.goods;
        ctx.lineWidth = Math.min(6.5, 1.5 + crowded.trucks * 0.5) * markScale;
        strokeOffset(ctx, view, line, w / 2 + 2.5 * markScale);
      }
    }
  }
  // Your service on top: a blue core by your riders along each piece.
  ctx.strokeStyle = COLORS.player;
  for (const segment of world.simulation.map.segments) {
    const riders = yours.get(segment.id) ?? 0;
    if (riders <= 0) continue;
    ctx.globalAlpha = alphaFor(segment.id);
    ctx.lineWidth = (1.5 + (riders / maxYours) * 5) * markScale;
    strokeLine(ctx, view, segmentPolyline(world.simulation.map, segment));
  }
  ctx.globalAlpha = 1;
}

// --- Overlays: one at a time (the lab's Demand, No seat, Informal share, Goods) ------------------

let overlayCache: { at: number; world: GameWorld; overlay: Overlay; marks: Array<{ a: GameTown; b: GameTown; width: number; color: string; alpha: number; straight?: boolean }> } | null = null;
function overlayMarks(world: GameWorld, overlay: Overlay) {
  const now = world.economy.elapsedSeconds;
  if (overlayCache && overlayCache.world === world && overlayCache.overlay === overlay && Math.abs(now - overlayCache.at) < 1) return overlayCache.marks;
  const marks: Array<{ a: GameTown; b: GameTown; width: number; color: string; alpha: number; straight?: boolean }> = [];
  const town = (id: string) => world.towns.get(id);
  if (overlay === "demand") {
    const pairs = new Map<string, { a: string; b: string; v: number }>();
    for (const [key, r] of world.pairOutcomes) {
      const i = key.indexOf(":");
      const [x, y] = [key.slice(0, i), key.slice(i + 1)];
      const [a, b] = x < y ? [x, y] : [y, x];
      const p = pairs.get(`${a}~${b}`) ?? { a, b, v: 0 };
      p.v += (r.player + r.poached + r.gaveUp + r.lost) * SECONDS_PER_GAME_DAY;
      pairs.set(`${a}~${b}`, p);
    }
    const top = [...pairs.values()].filter((p) => p.v >= 10 && town(p.a) && town(p.b)).sort((p, q) => q.v - p.v).slice(0, 60);
    const max = Math.max(1, ...top.map((p) => p.v));
    for (const p of top) marks.push({ a: town(p.a)!, b: town(p.b)!, width: 1 + (p.v / max) * 12, color: COLORS.ink2, alpha: 0.35 });
  } else if (overlay === "noseat") {
    const pairs = noSeatPairs(world).filter((p) => p.perDay >= 10 && town(p.a) && town(p.b));
    const max = Math.max(1, ...pairs.map((p) => p.perDay));
    for (const p of pairs) marks.push({ a: town(p.a)!, b: town(p.b)!, width: 1 + (p.perDay / max) * 12, color: COLORS.jammed, alpha: 0.6 });
  } else if (overlay === "informal") {
    for (const c of corridorSummaries(world)) {
      if (!town(c.a) || !town(c.b)) continue;
      marks.push({ a: town(c.a)!, b: town(c.b)!, width: 3 + c.informal * 12, color: COLORS.danfo, alpha: 0.25 + c.informal * 0.75, straight: true });
    }
  } else if (overlay === "goods") {
    const flows = goodsFlows(world).map((f) => ({ f, perDay: f.rate * SECONDS_PER_GAME_DAY })).sort((x, y) => y.perDay - x.perDay).slice(0, 25);
    const max = Math.max(1, ...flows.map((x) => x.perDay));
    for (const { f, perDay } of flows) {
      if (!town(f.from) || !town(f.to)) continue;
      const cargo = cargoName(world, f.from, f.kind, f.to);
      const color = cargo === "fuel" || cargo === "crude" ? COLORS.fuel : cargo === "cement" || cargo === "limestone" || cargo === "stone" ? COLORS.building : COLORS.food;
      void flowKey;
      marks.push({ a: town(f.from)!, b: town(f.to)!, width: 1 + (perDay / max) * 10, color, alpha: 0.7 });
    }
  }
  overlayCache = { at: now, world, overlay, marks };
  return marks;
}

function drawOverlay(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, overlay: Overlay): void {
  if (overlay === "none") return;
  ctx.lineCap = "round";
  for (const m of overlayMarks(world, overlay)) {
    const p = toScreen(view, m.a.x, m.a.y);
    const q = toScreen(view, m.b.x, m.b.y);
    ctx.globalAlpha = m.alpha;
    ctx.strokeStyle = m.color;
    ctx.lineWidth = m.width * markScale;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (m.straight) ctx.lineTo(q.x, q.y);
    else ctx.quadraticCurveTo((p.x + q.x) / 2 - (q.y - p.y) * 0.15, (p.y + q.y) / 2 + (q.x - p.x) * 0.15, q.x, q.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// --- Vehicles (the lab's pills, at the sim's own positions) -----------------------------------

function pill(ctx: CanvasRenderingContext2D, pose: { x: number; y: number; angle: number }, len: number, wid: number, fill: string, edge: string, full: number | null): void {
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.angle);
  const l = len * markScale;
  const w = wid * markScale;
  ctx.beginPath();
  ctx.roundRect(-l / 2, -w / 2, l, w, w / 2);
  ctx.fillStyle = full === null ? fill : COLORS.surface;
  ctx.fill();
  if (full !== null) {
    // How full it runs: the vehicle fills from the back.
    ctx.save();
    ctx.clip();
    ctx.fillStyle = fill;
    ctx.fillRect(-l / 2, -w / 2, l * Math.max(0.08, Math.min(1, full)), w);
    ctx.restore();
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.restore();
}

function drawVehicles(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, oneByOne: boolean): void {
  const routeOf = new Map<string, string>();
  for (const route of [...world.routes, ...world.lorryRoutes]) for (const id of route.vehicleIds) routeOf.set(id, route.id);
  for (const vehicle of world.simulation.vehicles) {
    const informal = vehicle.lifecycle === "one-shot";
    if (informal && !oneByOne) continue;
    const pose = vehiclePose(world, view, vehicle);
    if (!pose) continue;
    const route = routeOf.get(vehicle.id);
    ctx.globalAlpha = !focus ? 1 : route ? (focus.routes.has(route) ? 1 : FADED) : focus.segments.has(segmentOfVehicle(world, vehicle) ?? "") ? 1 : FADED;
    const full = vehicle.cargo.reduce((sum, entry) => sum + entry.amount, 0) / Math.max(1, vehicle.capacity);
    if (informal) {
      const mode = world.informal.active.get(vehicle.id)?.mode ?? (vehicle.id.startsWith("truck-") ? "truck" : "danfo");
      if (mode === "truck") pill(ctx, pose, 9, 4, COLORS.goods, COLORS.ink, null);
      else if (mode === "keke") pill(ctx, pose, 4, 3, COLORS.danfo, COLORS.ink, null);
      else if (mode === "okada") pill(ctx, pose, 2.6, 2.6, COLORS.danfo, COLORS.ink, null);
      else pill(ctx, pose, 6, 3.2, COLORS.danfo, COLORS.ink, null);
    } else if (vehicle.carries === "goods") {
      // Your freight: brown, filled by its load (a freight train longer).
      pill(ctx, pose, world.railVehicles.has(vehicle.id) ? 20 : 12, 5, COLORS.goods, COLORS.goods, full);
    } else if (world.railVehicles.has(vehicle.id)) {
      pill(ctx, pose, 20, 5, COLORS.player, COLORS.rail, full);
    } else {
      const len = vehicle.id.startsWith("minibus-") ? 8 : vehicle.id.startsWith("brt-") ? 15 : 11;
      pill(ctx, pose, len, vehicle.id.startsWith("minibus-") ? 4.5 : vehicle.id.startsWith("brt-") ? 5.5 : 5, COLORS.player, COLORS.player, full);
    }
  }
  ctx.globalAlpha = 1;
}

// --- Towns and sites (the lab's) ------------------------------------------------------------

let farms = new Set<string>();

/**
 * Which towns get their name and size this frame: a village only zoomed in, the rest biggest
 * first, each only where its label clears the ones already placed -- zoomed out over the
 * region, names sat on each other (Auchi on Bonny). The town you point at or picked always.
 */
function labelledTowns(world: GameWorld, view: View, state: DrawState): Set<string> {
  const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const out = new Set<string>();
  const towns = [...world.towns.values()].filter((t) => !t.industry);
  const lit = (t: GameTown) => state.selectedTown === t.id || state.hoverTown === t.id;
  for (const town of towns.sort((p, q) => Number(lit(q)) - Number(lit(p)) || q.population - p.population)) {
    if (tierOfTown(town) === "village" && !lit(town) && markScale * markScale < 2) continue;
    const p = toScreen(view, town.x, town.y);
    const r = townRadius(town, view);
    const half = Math.max(24, town.name.length * 3.6);
    const box = { x0: p.x - half, y0: p.y - r - 2, x1: p.x + half, y1: p.y + r + 34 };
    if (!lit(town) && placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
    placed.push(box);
    out.add(town.id);
  }
  return out;
}

function drawTown(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, town: GameTown, state: DrawState): void {
  const p = toScreen(view, town.x, town.y);
  const r = townRadius(town, view);
  const lit = state.selectedTown === town.id || state.hoverTown === town.id;
  const tier = tierOfTown(town);
  const close = lit || markScale * markScale >= 2;
  ctx.globalAlpha = focus && !focus.towns.has(town.id) ? 0.3 : 1;
  // The town by its tier (icons.ts): body, the ring of who carries its trips, its rim.
  const share = townShare(world, town.id);
  drawTownIcon(ctx, p.x, p.y, r, tier, { you: share.player, informal: share.informal, lost: share.lost }, { surface: COLORS.surface, ink: COLORS.ink, you: COLORS.player, informal: COLORS.danfo, home: COLORS.home });
  // Badges: the port always; a farm town zoomed in or pointed at.
  const badges: Badge[] = [...(town.id === world.port ? ["port" as const] : []), ...(close && farms.has(town.id) ? ["farm" as const] : [])];
  badges.forEach((b, k) => drawBadge(ctx, p.x - r * 0.85 - k * 15, p.y + r * 0.85, 15, b, COLORS.surface));
  if (lit) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 7 * markScale, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.ink;
    ctx.stroke();
  }
  // Additions the lab had no need of: a yard, a park, a metro (small marks at the town's edge).
  if (world.yards.has(town.id)) drawYardMark(ctx, p.x - r - 6, p.y - r - 6);
  if (world.parks.has(town.id)) drawParkMark(ctx, p.x + r - 1, p.y - r - 6);
  if ((world.metros.get(town.id) ?? 0) > 0) drawMetroMark(ctx, p.x - r - 7, p.y + r - 3, world.metros.get(town.id)!);
  // A problem here: an amber mark on its top-right.
  if (state.problems?.has(town.id)) {
    const mx = p.x + r * 0.8;
    const my = p.y - r * 0.8;
    ctx.fillStyle = COLORS.warn;
    ctx.beginPath();
    ctx.arc(mx, my, 6 * markScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.round(9 * markScale)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", mx, my + 0.5);
  }
  // Name and size for towns; a village's when zoomed in or pointed at (the region's small places
  // stay quiet), and none where it would sit on a bigger town's (labelledTowns).
  if (labelled.has(town.id)) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    // A white halo under each label, so a road under it doesn't make it hard to read.
    ctx.lineJoin = "round";
    ctx.strokeStyle = COLORS.surface;
    ctx.lineWidth = 3.5;
    ctx.font = tier === "city" || tier === "regional" ? "700 13px system-ui, sans-serif" : "600 12px system-ui, sans-serif";
    ctx.strokeText(town.name, p.x, p.y + r + 7);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(town.name, p.x, p.y + r + 7);
    const trend = growthTrend(world, town.id);
    const arrow = trend === "growing" ? "▲" : trend === "shrinking" ? "▼" : "";
    ctx.font = "11px system-ui, sans-serif";
    ctx.strokeText(`${Math.round(town.population)}k ${arrow}`, p.x, p.y + r + 21);
    ctx.fillStyle = trend === "growing" ? COLORS.grow : trend === "shrinking" ? COLORS.jammed : COLORS.muted;
    ctx.fillText(`${Math.round(town.population)}k ${arrow}`, p.x, p.y + r + 21);
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}

function drawSite(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, site: GameTown, state: DrawState): void {
  const p = toScreen(view, site.x, site.y);
  const r = townRadius(site, view);
  const lit = state.selectedTown === site.id || state.hoverTown === site.id;
  ctx.globalAlpha = focus && !focus.towns.has(site.id) ? 0.3 : 1;
  // Its tile and glyph (icons.ts): solid working, hollow idle, an amber corner held back.
  const made = siteProduction(world, site.id);
  const perDay = (x: number) => x * SECONDS_PER_GAME_DAY;
  const siteState: SiteState = !made || made.capacity <= 0 || perDay(made.made) < 0.5 ? "idle" : made.made < 0.6 * made.capacity ? "short" : "working";
  const glyph = (site.industry && site.industry in GLYPHS ? site.industry : "quarry") as Glyph;
  drawSiteIcon(ctx, p.x, p.y, r * 2, glyph, siteState, COLORS.surface);
  if (lit) {
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - r - 4, p.y - r - 4, r * 2 + 8, r * 2 + 8);
  }
  if (world.yards.has(site.id)) drawYardMark(ctx, p.x - r - 6, p.y - r - 6);
  // Its name when you point at it, or zoomed in.
  if (lit || markScale * markScale >= 2) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.lineJoin = "round";
    ctx.strokeStyle = COLORS.surface;
    ctx.lineWidth = 3.5;
    ctx.strokeText(site.name, p.x, p.y + r + 5);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(site.name, p.x, p.y + r + 5);
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
  }
  ctx.globalAlpha = 1;
}

// --- Kept from the game (additions the lab had no need to show), in its style ---------------------

const STRIKE_MARK_DAYS = 5;

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
function drawYardMark(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = COLORS.goods;
  ctx.strokeStyle = COLORS.kept;
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, 7, 7);
  ctx.strokeRect(x + 0.5, y + 0.5, 6, 6);
}
