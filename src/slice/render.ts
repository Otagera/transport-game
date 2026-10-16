import type { InformalMode, SliceTown, SliceWorld } from "@engine/slice/types";
import type { Vehicle } from "@engine/simulation/types";
import { isCutOff, townShare, tripsFrom, waitingAt } from "@engine/slice/world";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import { overWater, polylineLength, segmentPolyline, splitPolyline, type Point } from "@engine/slice/roads";

// Flat, top-down, legibility first (docs/principles.md §6): every fact the
// loop runs on is drawn, not hidden behind an overlay -- who is waiting,
// where they ended up, which roads you run buses on, and the informal
// sector (danfos, kekes, okadas).

export const COLORS = {
  ground: "#efe7d4",
  water: "#a9cbd9",
  waterEdge: "#8bb6c8",
  hill: "#b5a27a",
  bridge: "#7d7466",
  groundEdge: "#d9ccae",
  dirtRoad: "#c4ab7c",
  builtRoad: "#5d5a55",
  town: "#fffdf8",
  townEdge: "#2b2925",
  label: "#2b2925",
  labelMuted: "#7a7368",
  player: "#2f6fdb",
  danfo: "#f2c200",
  danfoStripe: "#1d1b18",
  keke: "#2b8a3e",
  slow: "#f08c00",
  jam: "#d9480f",
  home: "#a59d90",
  waiting: "#2b2925",
  selection: "#d9480f",
  ghostOk: "#2b2925",
  ghostBad: "#c92a2a",
};

const ROUTE_COLORS = ["#2f6fdb", "#0b8f6a", "#a33ea1", "#d9480f", "#1c7ed6", "#5f3dc4", "#c2255c", "#2b8a3e"];

export interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function fitView(world: SliceWorld, width: number, height: number, padding: number, topInset: number): View {
  const usableH = height - topInset - padding * 2;
  const usableW = width - padding * 2;
  const scale = Math.min(usableW / world.width, usableH / world.height);
  return {
    scale,
    offsetX: (width - world.width * scale) / 2,
    offsetY: topInset + padding + (usableH - world.height * scale) / 2,
  };
}

export function toScreen(view: View, x: number, y: number): { x: number; y: number } {
  return { x: view.offsetX + x * view.scale, y: view.offsetY + y * view.scale };
}

export function townRadius(town: SliceTown, view: View): number {
  return Math.max(7, Math.sqrt(town.population) * view.scale * 0.22);
}

export function routeColor(index: number): string {
  return ROUTE_COLORS[index % ROUTE_COLORS.length]!;
}

export interface Ghost {
  from: string;
  to: { x: number; y: number };
  ok: boolean;
  label: string;
  /** The planned road, map cells -- drawn instead of a straight line when there is one. */
  line?: Point[];
}

export interface DrawState {
  selectedTown: string | null;
  hoverTown: string | null;
  /** The town whose trips are drawn as desire lines (hovered, else selected). */
  focusTown: string | null;
  ghost: Ghost | null;
}

export function draw(ctx: CanvasRenderingContext2D, world: SliceWorld, view: View, state: DrawState): void {
  const { width, height } = ctx.canvas;
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  drawGround(ctx, world, view);
  drawRoads(ctx, world, view);
  drawRouteLines(ctx, world, view);
  if (state.focusTown) drawDesireLines(ctx, world, view, state.focusTown);
  if (state.ghost) drawGhostLine(ctx, world, view, state.ghost);
  drawVehicles(ctx, world, view);
  for (const ruin of world.ruins.values()) drawRuin(ctx, view, ruin);
  for (const town of world.towns.values()) drawTown(ctx, world, view, town, state);
  // Last, so nothing on the map draws through the price.
  if (state.ghost) drawGhostLabel(ctx, state.ghost);

  ctx.restore();
}

// --- Geometry: every road is a polyline (principles §3, one geometry
// representation), straight or bent round the terrain. Roads, route lines,
// traffic and vehicles all draw along the same one.

/** The road between two adjacent nodes, oriented from `from` to `to`. */
function edgeLine(world: SliceWorld, from: string, to: string): Point[] {
  const edge = world.simulation.routing.graph.get(from)?.find((candidate) => candidate.to === to);
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
function bridgeRuns(world: SliceWorld, line: Point[]): Point[][] {
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

function terrainLayer(world: SliceWorld, view: View, width: number, height: number): HTMLCanvasElement {
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
        // Hills: shaded by height, so a ridge reads as something a road climbs.
        ctx.fillStyle = COLORS.hill;
        ctx.globalAlpha = 0.45 * (terrain.elevation[i]! / peak);
        ctx.fillRect(s.x, s.y, cell + 0.5, cell + 0.5);
        ctx.globalAlpha = 1;
      }
    }
  }
  terrainCache = { key, canvas };
  return canvas;
}

function drawGround(ctx: CanvasRenderingContext2D, world: SliceWorld, view: View): void {
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

function drawRoads(ctx: CanvasRenderingContext2D, world: SliceWorld, view: View): void {
  ctx.lineCap = "round";
  for (const segment of world.simulation.map.segments) {
    const line = segmentPolyline(world.simulation.map, segment);
    // A bridge deck under the road where it crosses water.
    ctx.strokeStyle = COLORS.bridge;
    ctx.lineWidth = 13;
    ctx.lineCap = "butt";
    ctx.setLineDash([]);
    for (const run of bridgeRuns(world, line)) strokeLine(ctx, view, run);
    ctx.lineCap = "round";
    const built = segment.provenance === "built";
    // Traffic: a slowing road gets a casing from amber to red, under the
    // road itself -- the same speed that slows the buses on it.
    const speed = world.segmentSpeed.get(segment.id) ?? 1;
    if (speed < SLOW_ROAD_SPEED) {
      const severity = Math.min(1, (SLOW_ROAD_SPEED - speed) / (SLOW_ROAD_SPEED - 0.4));
      ctx.strokeStyle = severity > 0.5 ? COLORS.jam : COLORS.slow;
      ctx.globalAlpha = 0.35 + 0.55 * severity;
      ctx.lineWidth = 12 + 6 * severity;
      ctx.setLineDash([]);
      strokeLine(ctx, view, line);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = built ? COLORS.builtRoad : COLORS.dirtRoad;
    ctx.lineWidth = built ? 7 : 6;
    ctx.setLineDash(built ? [] : [10, 5]);
    strokeLine(ctx, view, line);
  }
  ctx.setLineDash([]);
}

/** Roads slower than this share of free flow draw a traffic casing. */
const SLOW_ROAD_SPEED = 0.9;

// Each route is drawn as a coloured line over the roads it runs on, offset
// a little per route so two routes sharing a road both stay visible.
function drawRouteLines(ctx: CanvasRenderingContext2D, world: SliceWorld, view: View): void {
  world.routes.forEach((route, index) => {
    const vehicle = world.simulation.vehicles.find((candidate) => candidate.id === route.vehicleIds[0]);
    if (!vehicle) return;
    const offset = (index % 4) * 2.5 - 3.75;
    ctx.strokeStyle = routeColor(index);
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.85;
    const half = halfPath(vehicle.path, route.a, route.b);
    const line: Point[] = [];
    for (let i = 1; i < half.length; i += 1) line.push(...edgeLine(world, half[i - 1]!, half[i]!));
    strokeLine(ctx, view, line, offset);
    ctx.globalAlpha = 1;
  });
}

// Desire lines: straight from the focused town to every town its people
// want to reach, thickness = how many want that trip, and the line itself a
// stacked bar of who carries them -- blue from your end, then informal, then
// stayed home. A thick yellow or grey line is a route waiting to be built
// (docs/principles.md §3: show relationships, not just state).
function drawDesireLines(ctx: CanvasRenderingContext2D, world: SliceWorld, view: View, focus: string): void {
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
    ctx.fillStyle = "rgba(255,253,248,0.9)";
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

function drawGhostLine(ctx: CanvasRenderingContext2D, world: SliceWorld, view: View, ghost: Ghost): void {
  ctx.strokeStyle = ghost.ok ? COLORS.ghostOk : COLORS.ghostBad;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  if (ghost.line) {
    // The road you'd get, bends and all: where it goes round, it's longer.
    ctx.lineWidth = 3;
    strokeLine(ctx, view, ghost.line);
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

function drawGhostLabel(ctx: CanvasRenderingContext2D, ghost: Ghost): void {
  if (ghost.label) {
    ctx.font = "600 13px system-ui, sans-serif";
    const w = ctx.measureText(ghost.label).width + 12;
    // Flip left of the cursor rather than run under the side panel (main.ts
    // fitView leaves it 300px when the window is wide enough to have one).
    const right = window.innerWidth > 900 ? window.innerWidth - 300 : window.innerWidth;
    const x = ghost.to.x + 12 + w > right - 8 ? Math.max(8, ghost.to.x - 12 - w) : ghost.to.x + 12;
    const y = ghost.to.y - 26;
    ctx.fillStyle = "rgba(255,253,248,0.95)";
    ctx.strokeStyle = ghost.ok ? COLORS.ghostOk : COLORS.ghostBad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 22, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ghost.ok ? COLORS.label : COLORS.ghostBad;
    ctx.fillText(ghost.label, x + 6, y + 15);
  }
}

function vehiclePose(world: SliceWorld, view: View, vehicle: Vehicle): { x: number; y: number; angle: number } | null {
  const length = vehicle.path.length;
  if (length < 2 || vehicle.pathIndex >= length) return null;
  const line = edgeLine(world, vehicle.path[(vehicle.pathIndex - 1 + length) % length]!, vehicle.path[vehicle.pathIndex]!);
  // Along the road as it runs, facing the way it's heading there.
  const [, ahead] = splitPolyline(line, polylineLength(line) * vehicle.edgeProgress);
  const here = ahead[0]!;
  const next = ahead.find((q) => Math.hypot(q.x - here.x, q.y - here.y) > 1e-6) ?? line[line.length - 1]!;
  const prev = line[0]!;
  const angle = next === here ? Math.atan2(here.y - prev.y, here.x - prev.x) : Math.atan2(next.y - here.y, next.x - here.x);
  const p = toScreen(view, here.x, here.y);
  // Keep right: opposite directions on one road don't overlap.
  const side = 5;
  return { x: p.x - Math.sin(angle) * side, y: p.y + Math.cos(angle) * side, angle };
}

function drawVehicles(ctx: CanvasRenderingContext2D, world: SliceWorld, view: View): void {
  const routeIndex = new Map<string, number>();
  world.routes.forEach((route, index) => route.vehicleIds.forEach((id) => routeIndex.set(id, index)));

  for (const vehicle of world.simulation.vehicles) {
    const pose = vehiclePose(world, view, vehicle);
    if (!pose) continue;
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.angle);
    if (vehicle.lifecycle === "one-shot") {
      drawInformal(ctx, world.informal.active.get(vehicle.id)?.mode ?? "danfo");
    } else {
      const color = routeColor(routeIndex.get(vehicle.id) ?? 0);
      const load = vehicle.cargo.reduce((sum, entry) => sum + entry.amount, 0) / vehicle.capacity;
      ctx.fillStyle = "#fffdf8";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-10, -5, 20, 10, 3);
      ctx.fill();
      ctx.stroke();
      // How full it is, as a fill from the back.
      ctx.fillStyle = color;
      ctx.fillRect(-9, -4, 18 * Math.min(1, load), 8);
    }
    ctx.restore();
  }
}

// The informal sector, at a glance: a danfo is a yellow minibus with a black
// stripe, a keke a small yellow tricycle with a green band, an okada a dark
// dot. Sizes follow road space, so a swarm of okadas reads as many small
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
function drawTown(ctx: CanvasRenderingContext2D, world: SliceWorld, view: View, town: SliceTown, state: DrawState): void {
  const p = toScreen(view, town.x, town.y);
  const r = townRadius(town, view);

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

  drawWaiting(ctx, p.x + ringR + 8, p.y - ringR + 2, waitingAt(world, town.id));

  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.label;
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillText(town.name, p.x, p.y + ringR + 16);
  ctx.fillStyle = COLORS.labelMuted;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(`${Math.round(town.population)}k`, p.x, p.y + ringR + 29);
  if (isCutOff(world, town.id)) {
    ctx.fillStyle = COLORS.ghostBad;
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillText("no road", p.x, p.y + ringR + 42);
  }
  ctx.textAlign = "left";
}

// A town that emptied out stays on the map as a name on a bend in the
// road -- the loss should read, not vanish.
function drawRuin(ctx: CanvasRenderingContext2D, view: View, town: SliceTown): void {
  const p = toScreen(view, town.x, town.y);
  ctx.fillStyle = COLORS.home;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.fillStyle = COLORS.labelMuted;
  ctx.font = "italic 11px system-ui, sans-serif";
  ctx.fillText(`${town.name} (empty)`, p.x, p.y + 16);
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
