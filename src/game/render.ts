import { privateLoad } from "@engine/game/private";
import { labelOf, routeLabelKey } from "@engine/game/labels";
import type { GameTown, GameWorld } from "@engine/game/types";
import type { RoutingContext, Vehicle } from "@engine/simulation/types";
import { routingFor } from "@engine/game/rail";
import { gameDay, roadChain, townShare } from "@engine/game/world";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import { growthTrend } from "@engine/game/growth";
import { corridorChanges, corridorSummaries } from "@engine/game/corridors";
import { noSeatPairs, seatMove } from "@engine/game/problems";
import { polylineLength, segmentPolyline, splitPolyline, type Point } from "@engine/game/roads";
import { roadCapacity } from "@engine/game/congestion";
import { flowKey, goodsFlows, type GoodsFlow } from "@engine/game/goods";
import { legReach, nextStop, relayed } from "@engine/game/haulage";
import { stationOpen } from "@engine/game/stations";
import { cargoName } from "@engine/game/fuel";
import { farmTowns } from "@engine/game/food";
import { GLYPHS, drawBadge, drawSite as drawSiteIcon, drawTown as drawTownIcon, tierOf, tierRadius, type Badge, type Glyph, type SiteState, type Tier } from "./icons";
import { steadySite } from "./steady";
import { congestionColor, junctionPlates, offsetPolyline, overloaded } from "./corridor";
import { segmentRung } from "@engine/game/roads";
import { PRIORITY, Placer, drawsAt, tierOf as zoomTierOf, type Box, type Chip, type Tier as ZoomTier } from "./density";

// The game's map, ported from the information lab (since discarded; brief, the carry-over plan:
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

/** A design token (styles/tokens.css): the page and the map read the same colours. */
function token(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) throw new Error(`render.ts: ${name} isn't in styles/tokens.css`);
  return value;
}

export const COLORS = {
  ground: token("--map-ground"),
  groundEdge: token("--line"),
  water: token("--map-water"),
  hill: token("--map-hill"),
  surface: token("--surface"),
  kept: token("--surface"),
  onFill: token("--on-fill"),
  ink: token("--ink"),
  ink2: token("--ink-2"),
  muted: token("--muted"),
  rail: token("--rail"),
  player: token("--you"),
  danfo: token("--informal"),
  goods: token("--goods"),
  home: token("--home"),
  grow: token("--good"),
  free: token("--road-free"),
  busy: token("--road-busy"),
  jammed: token("--road-jammed"),
  warn: token("--warn"),
  shadow: token("--shadow"),
  flood: token("--flood"),
  // Kept names the page and the previews use.
  label: token("--ink"),
  labelMuted: token("--muted"),
  selection: token("--ink"),
  ghostOk: token("--ink"),
  ghostBad: token("--bad"),
  forecastGood: token("--good"),
  strike: token("--bad"),
  slow: token("--road-busy"),
  // The goods overlay, by chain (the lab's validated categorical slots).
  fuel: token("--s5"),
  building: token("--s4"),
  food: token("--s3"),
};

/** The type steps (tokens.css --fs-*, look.md §3), for the map's own text; `tiny`, a badge's letter, scaled from the caption. */
const FS = {
  headline: token("--fs-headline"),
  body: token("--fs-body"),
  dense: token("--fs-dense"),
  caption: token("--fs-caption"),
  tiny: `${Math.round(parseFloat(token("--fs-caption")) * 0.64)}px`,
};
/** A colour token at an opacity, for the canvas (which can't mix a CSS variable). */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The page's route swatches: every route is your blue on the map now; the list keeps a hue each to tell them apart. */
const ROUTE_COLORS = Array.from({ length: 8 }, (_, k) => token(`--route-${k + 1}`));
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
  /** Towns and sites on Waiting on you (screen.ts waitingTargets): each gets the amber mark. */
  problems?: ReadonlySet<string>;
  /** The overlay on the map, one at a time. */
  overlay?: Overlay;
  /** Places a card's button is about, for a few seconds after it's pressed (main.ts pointAt): a pulsing ring. */
  pointed?: ReadonlySet<string>;
}

// --- Frame state ------------------------------------------------------------------

/** How much bigger marks draw than at the whole-map view (the square root of the zoom). */
let markScale = 1;
const FADED = 0.18;
export interface Focus { segments: Set<string>; routes: Set<string>; towns: Set<string> }
let focus: Focus | null = null;
/** This frame's zoom tier (density.ts): what draws at all. */
let zoomTier: ZoomTier = "far";
/** This frame's placed labels (density.ts Placer), by id: `town:`, `site:`, `icon:`, `ruin:`, and the passes' own. */
let placed = new Set<string>();
/** This frame's chips ("3 taken"), for a click on one (main.ts chipAt). */
let chips: Chip[] = [];
/** The chip under a screen point, if any. */
export function chipAt(x: number, y: number): Chip | undefined {
  return chips.find((c) => x >= c.box.x0 && x <= c.box.x1 && y >= c.box.y0 && y <= c.box.y1);
}
/** The tiers' zoom thresholds (tokens.css --tier-*). */
const TIERS = { mid: parseFloat(token("--tier-mid")), near: parseFloat(token("--tier-near")) };
/** The town you point at, picked on the map, or picked in the panel (focusTown): always named. */
const isLit = (state: DrawState, id: string) => state.selectedTown === id || state.hoverTown === id || state.focusTown === id;

/** A town's roads and the routes that stop there; or a route and the roads it runs on. */
function focusOf(world: GameWorld, state: DrawState): Focus | null {
  return focusFor(world, state.focusTown, state.focusRoute ?? null);
}

/** The same focus, for the 3D view too: what a selected town or route is connected to. */
export function focusFor(world: GameWorld, focusTown: string | null, focusRoute: string | null): Focus | null {
  const state = { focusTown, focusRoute };
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

/** The road or track piece a vehicle is on now. */
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
  zoomTier = zoomTierOf(zoom, TIERS);
  // The other side's vehicles one by one zoomed in (look.md, Map density: near), and further out
  // too unless the game runs at 4x: since the corridor dropped its yellow band, the danfos' own
  // capsules are where the informal sector shows on the map, and a day-2 map without them was empty.
  const oneByOne = drawsAt(zoomTier, "vehiclesOneByOne") || (state.gameSpeed ?? 1) < 4;
  const overlay = state.overlay ?? "none";

  drawGround(ctx, world, view);
  drawRoads(ctx, world, view, overlay !== "none");
  if (state.road) drawRoadHighlight(ctx, world, view, state.road.segmentId);
  drawOverlay(ctx, world, view, overlay);
  if (state.ghost) drawGhostLine(ctx, world, view, state.ghost);
  drawVehicles(ctx, world, view, oneByOne, overlay !== "none");
  cityId = [...world.towns.values()].filter((t) => !t.industry).reduce<GameTown | null>((big, t) => (!big || t.population > big.population ? t : big), null)?.id ?? null;
  farms = world.food ? new Set(farmTowns(world).map((t) => t.id)) : new Set();
  // Every label claims its place first, by priority, and only then does anything paint (density.ts).
  const paints = claimLabels(ctx, world, view, state);
  // The goods flows once a frame, for every site's gauge: worked out per site, they were half of drawing the map.
  const flows = goodsFlows(world);
  for (const town of [...world.towns.values()].sort((p, q) => p.population - q.population)) {
    if (town.industry) drawSite(ctx, world, view, town, state, flows);
    else drawTown(ctx, world, view, town, state);
  }
  for (const ruin of world.ruins.values()) if (placed.has(`ruin:${ruin.id}`)) drawRuin(ctx, view, ruin);
  if (drawsAt(zoomTier, "wardens")) drawWardens(ctx, world, view);
  // The rest, the least important first, so the most important paints on top.
  for (const p of paints.filter((x) => placed.has(x.id)).sort((a, b) => b.priority - a.priority)) p.paint();
  for (const chip of chips) drawChip(ctx, chip);
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

function strokeLine(ctx: CanvasRenderingContext2D, view: View, line: Point[]): void {
  ctx.beginPath();
  line.forEach((p, i) => {
    const s = toScreen(view, p.x, p.y);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.stroke();
}

/** A polyline moved sideways by `d` screen pixels, mitred (corridor.ts offsetPolyline: no pinching at a bend). */
export function strokeOffset(ctx: CanvasRenderingContext2D, view: View, line: Point[], d: number): void {
  ctx.beginPath();
  offsetPolyline(line.map((p) => toScreen(view, p.x, p.y)), d).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
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
      // Each channel written straight in (three arrays made a pixel was most of a ~1 s first frame).
      const o = (py * c.width + px) * 4, a = 1 - k - l;
      img.data[o] = land[0]! * a + hill[0]! * k + lit[0]! * l;
      img.data[o + 1] = land[1]! * a + hill[1]! * k + lit[1]! * l;
      img.data[o + 2] = land[2]! * a + hill[2]! * k + lit[2]! * l;
      img.data[o + 3] = 255;
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

/** A corridor's body width by its rung, in map-scale units (tokens.css --corridor-*): the rung shows on the road. */
const RUNG_WIDTH = {
  dirt: parseFloat(token("--corridor-dirt")),
  paved: parseFloat(token("--corridor-paved")),
  lane: parseFloat(token("--corridor-lane")),
  rail: parseFloat(token("--corridor-rail")),
};
const CASING = parseFloat(token("--corridor-casing"));
const RUNG_ORDER = { dirt: 0, paved: 1, lane: 2, rail: 3 } as const;

/**
 * The roads and track (docs/architecture/look.md, Corridor encoding and Corridor geometry): one
 * meaning per channel -- width the rung, colour the congestion (a ramp with headroom: past 150% a
 * dash over the jammed body), the centreline core your service; the informal sector and trucks are
 * on the vehicles, the overlays and the card, not bands beside the road (they read as two lanes).
 * One object a road, in passes sorted by rung: every casing (--line), every body, the junction
 * plates, then the cores, bus-lane stripes and ties.
 */
function drawRoads(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, dim: boolean): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const map = world.simulation.map;
  const yours = yourRidersOnRoads(world);
  const maxYours = Math.max(1, ...yours.values());
  // Under an overlay the network steps back, so the overlay is what you see (outside review,
  // 2026-10-26: switching modes barely changed a map whose roads stayed at full strength).
  const alphaFor = (id: string) => (focus && !focus.segments.has(id) ? FADED : dim ? OVERLAY_BACKDROP : 1);
  const colors = { free: COLORS.free, busy: COLORS.busy, jammed: COLORS.jammed };
  const items = map.segments.map((s) => {
    const rung = segmentRung(s);
    const rail = s.type === "rail";
    const load = rail ? 0 : ((world.roadFlowEMA.get(s.id) ?? 0) + privateLoad(world, s.id)) / Math.max(1e-6, roadCapacity(world, s.id));
    const speed = world.segmentSpeed.get(s.id) ?? 1;
    const alpha = alphaFor(s.id) * (rail && world.railOutOfService.has(s.id) ? 0.45 : 1);
    return { s, rung, rail, load, speed, alpha, line: segmentPolyline(map, s), width: RUNG_WIDTH[rung] * markScale, color: rail ? COLORS.rail : congestionColor(load, speed, colors), retired: s.retiredAt !== undefined };
  }).sort((p, q) => RUNG_ORDER[p.rung] - RUNG_ORDER[q.rung]);
  const live = items.filter((x) => !x.retired);

  // A road retired (retire.ts): faded and broken until it's gone, under everything.
  for (const x of items.filter((i) => i.retired)) {
    ctx.globalAlpha = x.alpha * 0.45;
    ctx.strokeStyle = COLORS.free;
    ctx.lineWidth = 2 * markScale;
    ctx.setLineDash([3 * markScale, 6 * markScale]);
    strokeLine(ctx, view, x.line);
  }
  // Pass A: every casing, so a crossing reads as two roads; a dirt road's dashed, unfinished.
  for (const x of live) {
    ctx.globalAlpha = x.alpha;
    ctx.strokeStyle = COLORS.groundEdge;
    ctx.lineWidth = x.width + CASING * markScale;
    ctx.setLineDash(x.rung === "dirt" ? [4 * markScale, 2 * markScale] : []);
    strokeLine(ctx, view, x.line);
  }
  ctx.setLineDash([]);
  // Pass B: every body, by its rung's width, in its congestion's colour.
  for (const x of live) {
    ctx.globalAlpha = x.alpha;
    ctx.strokeStyle = x.color;
    ctx.lineWidth = x.width;
    strokeLine(ctx, view, x.line);
    // Past the ramp's top, a dash over the jammed body: 150% and 400% aren't the same road.
    if (!x.rail && overloaded(x.load)) {
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = x.width * 0.4;
      ctx.setLineDash([2 * markScale, 3 * markScale]);
      strokeLine(ctx, view, x.line);
      ctx.setLineDash([]);
    }
  }
  // Pass C: the junction plates -- where two or more meet, one disc in the most congested one's colour.
  const bySegment = new Map(live.map((x) => [x.s.id, x]));
  for (const plate of junctionPlates(world, (s) => s.retiredAt === undefined, (s) => RUNG_WIDTH[segmentRung(s)] * markScale)) {
    const p = toScreen(view, plate.x, plate.y);
    const meeting = [...bySegment.values()].filter((x) => x.s.fromNodeId === plate.node || x.s.toNodeId === plate.node);
    const roads = meeting.filter((x) => !x.rail);
    const worst = roads.reduce<(typeof roads)[number] | null>((w, x) => (!w || x.load > w.load || x.speed < w.speed ? x : w), null);
    ctx.globalAlpha = Math.max(...meeting.map((x) => x.alpha));
    ctx.fillStyle = COLORS.groundEdge;
    ctx.beginPath();
    ctx.arc(p.x, p.y, plate.radius + (CASING / 2) * markScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = plate.rail || !worst ? COLORS.rail : worst.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, plate.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  // Pass D: on the centreline -- a lane's stripe, track's ties, your riders' core.
  for (const x of live) {
    ctx.globalAlpha = x.alpha;
    if (x.rung === "lane") {
      ctx.strokeStyle = COLORS.player;
      ctx.lineWidth = 1.5 * markScale;
      ctx.setLineDash([6 * markScale, 4 * markScale]);
      strokeLine(ctx, view, x.line);
    } else if (x.rail) {
      ctx.strokeStyle = COLORS.ground;
      ctx.lineWidth = 1.2 * markScale;
      ctx.setLineDash([2 * markScale, 4 * markScale]);
      strokeLine(ctx, view, x.line);
    }
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = COLORS.player;
  for (const x of live) {
    const riders = yours.get(x.s.id) ?? 0;
    if (riders <= 0) continue;
    ctx.globalAlpha = x.alpha;
    ctx.lineWidth = Math.min(x.width * 0.8, (1.5 + (riders / maxYours) * 4) * markScale);
    strokeLine(ctx, view, x.line);
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
    for (const p of top) marks.push({ a: town(p.a)!, b: town(p.b)!, width: 1 + (p.v / max) * 12, color: COLORS.ink2, alpha: 0.55 });
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
    // Cement, steel and fuel go in legs, town to town (haulage.ts): drawn by their legs, the
    // legs they share added together, so a town they change trucks at shows as the hub it is.
    const legs = new Map<string, { a: string; b: string; perDay: number; color: string }>();
    const leg = (a: string, b: string, perDay: number, color: string) => {
      const key = `${a}|${b}|${color}`;
      const e = legs.get(key) ?? { a, b, perDay: 0, color };
      e.perDay += perDay;
      legs.set(key, e);
    };
    for (const { f, perDay } of flows) {
      if (!town(f.from) || !town(f.to)) continue;
      const cargo = cargoName(world, f.from, f.kind, f.to);
      const color = cargo === "fuel" || cargo === "crude" ? COLORS.fuel : cargo === "cement" || cargo === "limestone" || cargo === "stone" ? COLORS.building : COLORS.food;
      void flowKey;
      if (!relayed(world, f.from, f.kind)) {
        leg(f.from, f.to, perDay, color);
        continue;
      }
      let at = f.from;
      for (let hop = 0; hop < 12 && at !== f.to; hop += 1) {
        const stop = nextStop(world, at, f.to, legReach(world, at, f.kind));
        if (!stop) break; // a gap: the card names the yard that bridges it
        leg(at, stop, perDay, color);
        at = stop;
      }
    }
    const max = Math.max(1, ...[...legs.values()].map((x) => x.perDay));
    for (const l of legs.values()) marks.push({ a: town(l.a)!, b: town(l.b)!, width: 1 + (l.perDay / max) * 10, color: l.color, alpha: 0.7 });
  }
  overlayCache = { at: now, world, overlay, marks };
  return marks;
}

/** How much of the roads and vehicles shows under an overlay. */
const OVERLAY_BACKDROP = 0.2;

/**
 * An overlay's headline in a line, for the caption under the mode buttons: the total it
 * shows and its biggest mark, by name -- and on No seat, the move for the worst (the
 * review: "No seat should expose underserved towns and overloaded corridors").
 */
export function overlayCaption(world: GameWorld, overlay: Overlay): string {
  const name = (id: string) => world.towns.get(id)?.name ?? id;
  const int = (x: number) => Math.round(x).toLocaleString();
  if (overlay === "demand") {
    let total = 0;
    const pairs = new Map<string, { a: string; b: string; v: number }>();
    for (const [key, r] of world.pairOutcomes) {
      const i = key.indexOf(":");
      const [x, y] = [key.slice(0, i), key.slice(i + 1)];
      const [a, b] = x < y ? [x, y] : [y, x];
      const v = (r.player + r.poached + r.gaveUp + r.lost) * SECONDS_PER_GAME_DAY;
      total += v;
      const p = pairs.get(`${a}~${b}`) ?? { a, b, v: 0 };
      p.v += v;
      pairs.set(`${a}~${b}`, p);
    }
    const top = [...pairs.values()].sort((p, q) => q.v - p.v)[0];
    return top ? `${int(total)} trips wanted a day, the thicker the more. The most: ${name(top.a)} ↔ ${name(top.b)}, ${int(top.v)} a day.` : "No trips wanted yet.";
  }
  if (overlay === "noseat") {
    const pairs = noSeatPairs(world);
    const total = pairs.reduce((sum, p) => sum + p.perDay, 0);
    const worst = pairs[0];
    if (!worst || total < 1) return "Everyone with a road finds a seat.";
    const move = seatMove(world, worst.a, worst.b);
    const answer = Number.isFinite(move.price) ? ` The move: ${move.label.replace(/\s*\([^)]*\)$/, "")}, ₦${int(move.price)}.` : "";
    return `${int(total)} a day have a road but find no seat. The worst: ${name(worst.a)} ↔ ${name(worst.b)}, ${int(worst.perDay)} a day.${answer}`;
  }
  if (overlay === "informal") {
    const corridors = corridorSummaries(world).filter((c) => world.towns.has(c.a) && world.towns.has(c.b));
    const top = [...corridors].sort((p, q) => q.informal * (q.perDay.poached + q.perDay.gaveUp + q.perDay.player + q.perDay.lost) - p.informal * (p.perDay.poached + p.perDay.gaveUp + p.perDay.player + p.perDay.lost))[0];
    return top ? `The danfos' share of each corridor's trips: the bolder, the more theirs. Their biggest: ${name(top.a)}–${name(top.b)}, ${Math.round(top.informal * 100)}% theirs, ${Math.round(top.you * 100)}% yours.` : "No corridors yet.";
  }
  if (overlay === "goods") {
    const flows = goodsFlows(world).map((f) => ({ f, perDay: f.rate * SECONDS_PER_GAME_DAY })).sort((x, y) => y.perDay - x.perDay);
    const top = flows[0];
    return top ? `The biggest goods flows: fuel and crude red, cement and stone purple, food green${world.tuning.goodsRelay ? "; cement, steel and fuel by their legs, town to town" : ""}. The most: ${cargoName(world, top.f.from, top.f.kind, top.f.to)} ${name(top.f.from)} → ${name(top.f.to)}, ${int(top.perDay)} t a day.` : "No goods moving yet.";
  }
  return "";
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

function drawVehicles(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, oneByOne: boolean, dim = false): void {
  const colourOf = (route: string | undefined) => (route && labelOf(world, routeLabelKey(route))?.colour) || COLORS.player;
  const routeOf = new Map<string, string>();
  for (const route of [...world.routes, ...world.lorryRoutes]) for (const id of route.vehicleIds) routeOf.set(id, route.id);
  for (const vehicle of world.simulation.vehicles) {
    const informal = vehicle.lifecycle === "one-shot";
    if (informal && !oneByOne) continue;
    const pose = vehiclePose(world, view, vehicle);
    if (!pose) continue;
    const route = routeOf.get(vehicle.id);
    ctx.globalAlpha = (!focus ? 1 : route ? (focus.routes.has(route) ? 1 : FADED) : focus.segments.has(segmentOfVehicle(world, vehicle) ?? "") ? 1 : FADED) * (dim ? OVERLAY_BACKDROP : 1);
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
      pill(ctx, pose, 20, 5, colourOf(route), COLORS.rail, full);
    } else {
      // In its route's colour, where you've given it one (labels.ts): your network as lines.
      const len = vehicle.id.startsWith("minibus-") ? 8 : vehicle.id.startsWith("brt-") ? 15 : 11;
      pill(ctx, pose, len, vehicle.id.startsWith("minibus-") ? 4.5 : vehicle.id.startsWith("brt-") ? 5.5 : 5, colourOf(route), colourOf(route), full);
    }
  }
  ctx.globalAlpha = 1;
}

// --- Towns and sites (the lab's) ------------------------------------------------------------

let farms = new Set<string>();


function drawTown(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, town: GameTown, state: DrawState): void {
  const p = toScreen(view, town.x, town.y);
  const r = townRadius(town, view);
  const lit = isLit(state, town.id);
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
  // Waiting on you here: an amber mark on its top-right.
  if (state.problems?.has(town.id)) drawWaitingMark(ctx, p.x + r * 0.8, p.y - r * 0.8);
  if (state.pointed?.has(town.id)) drawPointedRing(ctx, p.x, p.y, r);
  // Name and size, where the placer gave it room (claimLabels).
  if (placed.has(`town:${town.id}`)) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    // A white halo under each label, so a road under it doesn't make it hard to read.
    ctx.lineJoin = "round";
    ctx.strokeStyle = COLORS.surface;
    ctx.lineWidth = 3.5;
    ctx.font = tier === "city" || tier === "regional" ? `700 ${FS.body} system-ui, sans-serif` : `600 ${FS.dense} system-ui, sans-serif`;
    ctx.strokeText(town.name, p.x, p.y + r + 7);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(town.name, p.x, p.y + r + 7);
    const trend = growthTrend(world, town.id);
    const arrow = trend === "growing" ? "▲" : trend === "shrinking" ? "▼" : "";
    ctx.font = `${FS.caption} system-ui, sans-serif`;
    ctx.strokeText(`${Math.round(town.population)}k ${arrow}`, p.x, p.y + r + 21);
    ctx.fillStyle = trend === "growing" ? COLORS.grow : trend === "shrinking" ? COLORS.jammed : COLORS.muted;
    ctx.fillText(`${Math.round(town.population)}k ${arrow}`, p.x, p.y + r + 21);
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}

/** The amber "!" on a town or site that's on Waiting on you (screen.ts): only those, so it means something. */
function drawWaitingMark(ctx: CanvasRenderingContext2D, mx: number, my: number): void {
  ctx.fillStyle = COLORS.warn;
  ctx.beginPath();
  ctx.arc(mx, my, 6 * markScale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.onFill;
  ctx.font = `700 ${Math.round(9 * markScale)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", mx, my + 0.5);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

/** A ring round a place a card's button is about (DrawState.pointed): "here" -- steady, for the plate never animates (look.md §7). */
function drawPointedRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.strokeStyle = COLORS.warn;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, r + 12 * markScale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSite(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, site: GameTown, state: DrawState, flows: GoodsFlow[]): void {
  const p = toScreen(view, site.x, site.y);
  const r = townRadius(site, view);
  const lit = isLit(state, site.id);
  ctx.globalAlpha = focus && !focus.towns.has(site.id) ? 0.3 : 1;
  // Its tile and glyph (icons.ts): solid working, hollow idle, an amber corner held back.
  const made = steadySite(world, site.id, flows);
  const perDay = (x: number) => x * SECONDS_PER_GAME_DAY;
  // A border crossing makes nothing: it's open (border.ts).
  // A station: open where the line to it is restored, else hollow (stations.ts).
  const siteState: SiteState = site.industry === "station" ? (stationOpen(world, site.id) ? "working" : "idle") : site.industry === "border" || site.industry === "gateway" ? "working" : !made || made.capacity <= 0 || perDay(made.made) < 0.5 ? "idle" : made.made < 0.6 * made.capacity ? "short" : "working";
  const glyph = (site.industry && site.industry in GLYPHS ? site.industry : "quarry") as Glyph;
  // Zoomed out, a site draws where it fits or where the panel points at it (look.md, Map density).
  if (zoomTier === "far" && !lit && !state.problems?.has(site.id) && !state.pointed?.has(site.id) && !placed.has(`icon:${site.id}`)) {
    ctx.globalAlpha = 1;
    return;
  }
  drawSiteIcon(ctx, p.x, p.y, r * 2, glyph, siteState, COLORS.surface);
  if (lit) {
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - r - 4, p.y - r - 4, r * 2 + 8, r * 2 + 8);
  }
  if (world.yards.has(site.id)) drawYardMark(ctx, p.x - r - 6, p.y - r - 6);
  if (state.problems?.has(site.id)) drawWaitingMark(ctx, p.x + r, p.y - r);
  if (state.pointed?.has(site.id)) drawPointedRing(ctx, p.x, p.y, r);
  // Its name, where the placer gave it room (claimLabels).
  if (placed.has(`site:${site.id}`)) {
    ctx.font = `600 ${FS.caption} system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
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
    ctx.strokeStyle = COLORS.onFill;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mid.x - 16, mid.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.onFill;
    ctx.font = `700 ${FS.caption} ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("W", mid.x - 16, mid.y + 0.5);
  }
}

/** A pill tag's box and painter: `loud` for an event (look.md, Map density: events loud, state quiet). */
function tagPill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, ink: string, loud: boolean): { box: Box; paint: () => void } {
  ctx.font = `700 ${FS.caption} ui-monospace, monospace`;
  const width = ctx.measureText(text).width + 10;
  const box = { x0: x, y0: y - 9, x1: x + width, y1: y + 9 };
  return {
    box,
    paint: () => {
      ctx.save();
      ctx.font = `700 ${FS.caption} ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // The map's only drop shadow is an event's: what's happening now stands off what stands.
      if (loud) {
        ctx.shadowColor = COLORS.shadow;
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
      }
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(box.x0, box.y0, width, 18, 4);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = ink;
      ctx.fillText(text, x + width / 2, y);
      ctx.restore();
    },
  };
}

/** Where a road between two towns runs, its middle (or a third along) on screen. */
function alongRoad(world: GameWorld, view: View, a: string, b: string, share: number): { at: Point; line: Point[] } | null {
  const line = (roadChain(world, a, b) ?? []).flatMap((piece) => segmentPolyline(world.simulation.map, piece));
  if (line.length < 2) return null;
  const [, rest] = splitPolyline(line, polylineLength(line) * share);
  return { at: toScreen(view, rest[0]!.x, rest[0]!.y), line };
}

/**
 * Every label on the map claims a box, by priority (density.ts PRIORITY), before anything paints: the
 * price label, events (strikes, floods, fords closing), what you asked for, TAKEN tags (three or more in
 * one place a chip), town names largest first, site names, road and crossing names, ruins, and -- zoomed
 * out -- site icons. Resolved together, so a road name gives way to a strike whatever order they come
 * in. Sets `placed` and `chips`; returns the painters for the passes' own labels.
 */
function claimLabels(ctx: CanvasRenderingContext2D, world: GameWorld, view: View, state: DrawState): Array<{ id: string; priority: number; paint: () => void }> {
  const placer = new Placer();
  const paints: Array<{ id: string; priority: number; paint: () => void }> = [];
  const add = (id: string, kind: string, priority: number, box: Box, at: { x: number; y: number }, paint?: () => void) => {
    placer.claim({ id, kind, priority, box, at });
    if (paint) paints.push({ id, priority, paint });
  };
  const now = world.economy.elapsedSeconds;
  // 1. The price label: an action in progress.
  if (state.ghost) add("ghost", "ghost", PRIORITY.ghost, { x0: state.ghost.to.x - 12, y0: state.ghost.to.y - 90, x1: state.ghost.to.x + 280, y1: state.ghost.to.y + 12 }, state.ghost.to);
  // 2. Events: strikes called or on, a ford named for the rains or under them.
  for (const lane of world.lanes) {
    const last = lane.lastStrike;
    const event = lane.strikeUntil > now ? { text: "STRIKE", fill: COLORS.strike } : lane.strikeAt > now ? { text: `STRIKE DAY ${gameDay(world, lane.strikeAt)}`, fill: COLORS.slow } : null;
    const past = !event && last && now - last.endedAt < STRIKE_MARK_DAYS * SECONDS_PER_GAME_DAY
      ? `struck day ${gameDay(world, last.startedAt)}${last.cost === null ? "" : last.cost < 1 ? " · no loss" : ` · ₦${Math.round(last.cost).toLocaleString()}`}` : null;
    if (!event && !past) continue;
    const where = alongRoad(world, view, lane.a, lane.b, 0.5);
    if (!where) continue;
    const tag = event ? tagPill(ctx, where.at.x + 14, where.at.y, event.text, event.fill, COLORS.onFill, true) : tagPill(ctx, where.at.x + 14, where.at.y, past!, withAlpha(COLORS.jammed, 0.14), COLORS.strike, false);
    // A strike past is a note, not an event: it ranks with a change of hands.
    add(`strike:${lane.a}|${lane.b}`, event ? "event" : "taken-note", event ? PRIORITY.event : PRIORITY.taken, tag.box, where.at, tag.paint);
  }
  const floods = world.floods;
  for (const ford of floods?.fords ?? []) {
    const coming = floods!.phase === "warned" && floods!.coming.includes(ford.id);
    const under = floods!.phase === "flood" && floods!.under.includes(ford.id);
    const p = toScreen(view, ford.x, ford.y);
    if (under || coming) {
      const text = under ? `${ford.name} · FLOODED` : `${ford.name} · floods day ${gameDay(world, floods!.riseAt) - 1}`;
      const fill = under ? COLORS.flood : COLORS.slow;
      ctx.font = `700 ${FS.caption} ui-monospace, monospace`;
      const width = ctx.measureText(text).width + 10;
      const tag = tagPill(ctx, p.x - width / 2, p.y + 10 * markScale + 9, text, fill, COLORS.onFill, true);
      add(`ford:${ford.id}`, "event", PRIORITY.event, tag.box, p, () => {
        // The crossing itself, ringed.
        ctx.strokeStyle = fill;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 * markScale, 0, Math.PI * 2);
        ctx.stroke();
        tag.paint();
      });
      continue;
    }
    // Quiet otherwise: a town's crossing named well zoomed in, a site's short road's not at all.
    const site = world.towns.get(ford.a)?.industry || world.towns.get(ford.b)?.industry;
    if (site || !drawsAt(zoomTier, "roadName") || markScale * markScale < 4) continue;
    const name = ford.bridged ? ford.name.replace(/(ford|causeway)$/, "bridge") : ford.name;
    ctx.font = `italic ${FS.caption} system-ui, sans-serif`;
    const half = ctx.measureText(name).width / 2 + 2;
    const y = p.y + 12 * markScale;
    add(`fordname:${ford.id}`, "roadName", PRIORITY.roadName, { x0: p.x - half, y0: y - 7, x1: p.x + half, y1: y + 7 }, p, () => {
      ctx.save();
      ctx.font = `italic ${FS.caption} system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = COLORS.labelMuted;
      ctx.fillText(name, p.x, y);
      ctx.restore();
    });
  }
  // The rivers' named crossings (crossings.ts): named zoomed in, a tick on each bank.
  if (world.crossings && drawsAt(zoomTier, "roadName")) {
    for (const c of world.crossings) {
      const p = toScreen(view, c.x, c.y);
      ctx.font = `italic ${FS.caption} system-ui, sans-serif`;
      const half = ctx.measureText(c.name).width / 2 + 2;
      const y = p.y - 10 * markScale;
      add(`crossing:${c.name}`, "roadName", PRIORITY.roadName, { x0: p.x - half, y0: y - 7, x1: p.x + half, y1: y + 7 }, p, () => {
        ctx.save();
        ctx.strokeStyle = COLORS.labelMuted;
        ctx.lineWidth = 1.5;
        for (const b of c.banks) {
          const q = toScreen(view, b.x, b.y);
          ctx.beginPath();
          ctx.arc(q.x, q.y, 2, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.font = `italic ${FS.caption} system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = COLORS.labelMuted;
        ctx.fillText(c.name, p.x, y);
        ctx.restore();
      });
    }
  }
  // 4. A change of hands: TAKEN or LOST, a few days, and a crowd of them a chip.
  if (drawsAt(zoomTier, "taken")) {
    for (const corridor of corridorChanges(world)) {
      const where = alongRoad(world, view, corridor.a, corridor.b, 1 / 3);
      if (!where) continue;
      const taken = corridor.change === "taken";
      const text = taken ? "TAKEN" : "LOST";
      ctx.font = `700 ${FS.caption} ui-monospace, monospace`;
      const width = ctx.measureText(text).width + 10;
      const tag = tagPill(ctx, where.at.x - 14 - width, where.at.y, text, taken ? COLORS.player : COLORS.home, COLORS.onFill, false);
      add(`taken:${corridor.a}|${corridor.b}`, "taken", PRIORITY.taken, tag.box, where.at, tag.paint);
    }
  }
  // 3 and 5. Town names: what you asked for first, then the largest first.
  const lit = (id: string) => isLit(state, id);
  const towns = [...world.towns.values()].filter((t) => !t.industry).sort((p, q) => q.population - p.population);
  for (const town of towns) {
    const isVillage = tierOfTown(town) === "village";
    if (!drawsAt(zoomTier, isVillage ? "villageName" : "townName", lit(town.id))) continue;
    const p = toScreen(view, town.x, town.y);
    const r = townRadius(town, view);
    const half = Math.max(24, town.name.length * 3.6);
    add(`town:${town.id}`, "townName", lit(town.id) ? PRIORITY.lit : PRIORITY.townName, { x0: p.x - half, y0: p.y - r - 2, x1: p.x + half, y1: p.y + r + 34 }, p);
  }
  // 6. Site names zoomed in; and zoomed out, the site icons themselves only where they fit.
  for (const site of [...world.towns.values()].filter((t) => t.industry)) {
    const p = toScreen(view, site.x, site.y);
    const r = townRadius(site, view);
    if (drawsAt(zoomTier, "siteName", lit(site.id))) {
      ctx.font = `600 ${FS.caption} system-ui, sans-serif`;
      const half = ctx.measureText(site.name).width / 2 + 2;
      add(`site:${site.id}`, "siteName", lit(site.id) ? PRIORITY.lit : PRIORITY.siteName, { x0: p.x - half, y0: p.y + r + 4, x1: p.x + half, y1: p.y + r + 18 }, p);
    }
    if (zoomTier === "far") add(`icon:${site.id}`, "siteIcon", PRIORITY.siteIcon, { x0: p.x - r - 2, y0: p.y - r - 2, x1: p.x + r + 2, y1: p.y + r + 2 }, p);
  }
  // 7. The roads you've named, along them at their middle.
  if (world.labels && drawsAt(zoomTier, "roadName")) {
    for (const [key, label] of Object.entries(world.labels)) {
      if (!key.startsWith("road:") || !label.name) continue;
      const [a, b] = key.slice(5).split("|") as [string, string];
      const line = (roadChain(world, a, b) ?? []).flatMap((piece) => segmentPolyline(world.simulation.map, piece));
      if (line.length < 2) continue;
      const [before, rest] = splitPolyline(line, polylineLength(line) / 2);
      const p = rest[0]!, q = rest.find((r) => Math.hypot(r.x - p.x, r.y - p.y) > 1e-6) ?? before[before.length - 2] ?? line[0]!;
      let angle = Math.atan2(q.y - p.y, q.x - p.x);
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI; // never upside down
      const at = toScreen(view, p.x, p.y);
      ctx.font = `italic 600 ${FS.dense} system-ui, sans-serif`;
      const half = ctx.measureText(label.name).width / 2;
      // Its box: the rotated text's bounds.
      const corners = [[-half, -16], [half, -16], [half, -2], [-half, -2]].map(([x, y]) => ({ x: at.x + x! * Math.cos(angle) - y! * Math.sin(angle), y: at.y + x! * Math.sin(angle) + y! * Math.cos(angle) }));
      const box = { x0: Math.min(...corners.map((c) => c.x)), y0: Math.min(...corners.map((c) => c.y)), x1: Math.max(...corners.map((c) => c.x)), y1: Math.max(...corners.map((c) => c.y)) };
      add(`road:${key}`, "roadName", PRIORITY.roadName, box, at, () => {
        ctx.save();
        ctx.font = `italic 600 ${FS.dense} system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.translate(at.x, at.y);
        ctx.rotate(angle);
        ctx.lineWidth = 4;
        ctx.strokeStyle = COLORS.surface;
        ctx.strokeText(label.name!, 0, -9);
        ctx.fillStyle = COLORS.ink;
        ctx.fillText(label.name!, 0, -9);
        ctx.restore();
      });
    }
  }
  // 8. Ruins, zoomed in.
  if (drawsAt(zoomTier, "ruin")) {
    for (const ruin of world.ruins.values()) {
      const p = toScreen(view, ruin.x, ruin.y);
      ctx.font = `italic ${FS.caption} system-ui, sans-serif`;
      const half = ctx.measureText(`${ruin.name} (${ruin.industry ? "closed" : "empty"})`).width / 2 + 2;
      add(`ruin:${ruin.id}`, "ruin", PRIORITY.ruin, { x0: p.x - half, y0: p.y + 6, x1: p.x + half, y1: p.y + 20 }, p);
    }
  }
  const resolved = placer.resolve([{
    kind: "taken",
    radius: 40 * markScale,
    min: 3,
    chipBox: (at, count) => {
      ctx.font = `700 ${FS.caption} ui-monospace, monospace`;
      const width = ctx.measureText(`${count} taken`).width + 10;
      return { x0: at.x - width / 2, y0: at.y - 9, x1: at.x + width / 2, y1: at.y + 9 };
    },
  }]);
  placed = resolved.placed;
  chips = resolved.chips;
  return paints;
}

/** A crowd of TAKEN tags as one chip: "3 taken" (click: the log's Corridors). */
function drawChip(ctx: CanvasRenderingContext2D, chip: Chip): void {
  const tag = tagPill(ctx, chip.box.x0, (chip.box.y0 + chip.box.y1) / 2, `${chip.count} taken`, COLORS.player, COLORS.onFill, false);
  tag.paint();
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
const LABEL_WIDTH = 420;
function drawLabel(ctx: CanvasRenderingContext2D, to: { x: number; y: number }, label: string, ok: boolean, forecast?: ForecastLine): void {
  const ghost = { to, label, ok };
  if (ghost.label) {
    // Laid out from the left edge: say so, whatever drew before (a centred tag once shifted the text off its box).
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `${FS.dense} system-ui, sans-serif`;
    const subWidth = forecast ? ctx.measureText(forecast.text).width : 0;
    ctx.font = `600 ${FS.body} system-ui, sans-serif`;
    // Wrapped at its " · " breaks to a readable width: a road's quote had grown past the map's
    // width (price, why, the crossing, the other way, riders), and ran off both edges.
    const lines: string[] = [];
    for (const part of ghost.label.split(" · ")) {
      const last = lines[lines.length - 1];
      if (last !== undefined && ctx.measureText(`${last} · ${part}`).width <= LABEL_WIDTH) lines[lines.length - 1] = `${last} · ${part}`;
      else lines.push(part);
    }
    const w = Math.max(...lines.map((line) => ctx.measureText(line).width), subWidth) + 12;
    const h = lines.length * 17 + 5 + (forecast ? 18 : 0);
    // Flip left of the cursor rather than run under the side panels (main.ts fitView leaves
    // them their width when the window is wide enough to have them).
    const wide = window.innerWidth > 900;
    const right = wide ? window.innerWidth - 300 : window.innerWidth;
    const left = wide ? 240 : 0;
    const x = ghost.to.x + 12 + w > right - 8 ? Math.max(left + 8, ghost.to.x - 12 - w) : ghost.to.x + 12;
    const y = Math.max(8, ghost.to.y - 4 - h);
    ctx.fillStyle = COLORS.surface;
    ctx.strokeStyle = ghost.ok ? COLORS.ghostOk : COLORS.ghostBad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ghost.ok ? COLORS.label : COLORS.ghostBad;
    lines.forEach((line, i) => ctx.fillText(line, x + 6, y + 15 + i * 17));
    if (forecast) {
      ctx.font = forecast.tone === "pending" ? `italic ${FS.dense} system-ui, sans-serif` : `600 ${FS.dense} system-ui, sans-serif`;
      ctx.fillStyle = forecast.tone === "good" ? COLORS.forecastGood : forecast.tone === "bad" ? COLORS.ghostBad : COLORS.labelMuted;
      ctx.fillText(forecast.text, x + 6, y + 15 + lines.length * 17);
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
  // Placed by claimLabels: zoomed in, and only where it clears the living (map 949: three
  // "Limestone (closed)" lay over Ikire's name and each other).
  const text = `${town.name} (${town.industry ? "closed" : "empty"})`;
  ctx.font = `italic ${FS.caption} system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.labelMuted;
  ctx.fillText(text, p.x, p.y + 16);
  ctx.textAlign = "left";
}
function drawMetroMark(ctx: CanvasRenderingContext2D, x: number, y: number, lines: number): void {
  ctx.fillStyle = COLORS.player;
  ctx.beginPath();
  ctx.arc(x + 5, y + 5, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLORS.onFill;
  ctx.font = `700 ${FS.tiny} ui-monospace, monospace`;
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
  ctx.font = `700 ${FS.tiny} ui-monospace, monospace`;
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
