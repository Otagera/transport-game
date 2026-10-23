import { buildGameTerrain } from "@engine/game/terrain";
import { gameMap } from "@engine/game/region";
import { GAME_MAP } from "../game/map";
import { BADGE_NAME, FAMILY_COLOR, FAMILY_NAME, GLYPHS, TIER_NAME, drawBadge, drawSite, drawTown, tierOf, tierRadius, type Badge, type Family, type Glyph, type SiteState, type Tier } from "../game/icons";

// The information lab (docs/brief.md, the carry-over plan: information
// design). A mock of the full game's three layers, on a game you played (a
// run file, through scripts/info-snapshot.ts), so the look is judged on real
// numbers:
//
//   1. at a glance -- the map answers "where": roads by what they carry and
//      how full, your service drawn on them, towns with their shares, trend
//      and problems, and overlays you switch on one at a time;
//   2. side panels -- the numbers answer "how much": lists that sort, and one
//      layout for every town, route, site or road you click, with a chart of
//      it over time and its problem in one line;
//   3. the revenue screen -- the money answers "how am I doing".
//
// Plus a log of what happened, kept. Started fresh beside the design lab
// (design-lab.html), which picked the slice's tokens; this one is about what
// the screen says, not how it's styled. Dev-only, never a build input.

// --- Data ------------------------------------------------------------------

interface Town {
  id: string; name: string; x: number; y: number; population: number; base: number | null; industry: string | null; roadside: boolean;
  trend: string; target: number | null; cap: number | null; cementHeld: number; expected: number;
  share: { you: number; informal: number; lost: number }; fuel: number | null; cement: number | null;
  roadFull: { next: string; thin: boolean } | null;
}
interface Segment { id: string; a: string; b: string; type: string; surface: string | null; busLane: boolean; points: [number, number][]; load: number; speed: number; condition: number }
interface Route { id: string; a: string; b: string; kind: string; vehicles: number; incomePerDay: number; costPerDay: number; netPerDay: number; ridersPerDay: number; loadFactor: number; verdict: string | null; stops: string[] }
interface Flow { from: string; to: string; cargo: string; perDay: number; yours: number; hauliers: number; spoiled: number }
interface Site { id: string; product: string | null; made: number; capacity: number; limit: string | null; staffing: number | null; shipped: number | null }
interface Pair { a: string; b: string; you: number; informal: number; noSeat: number; noRoad: number }
interface Corridor { a: string; b: string; you: number; informal: number; lost: number; taken: boolean }
interface Day {
  day: number; funds: number; netPerDay: number; tripsMade: number; yourRiders: number; informal: number; noRoad: number; noSeat: number; people: number;
  budget: Record<string, number>; routes: Array<{ id: string; netPerDay: number; vehicles: number; verdict: string }>;
  towns: Array<{ id: string; name: string; population: number }>; events?: Array<Record<string, unknown> & { kind: string }>;
}
interface Snapshot {
  seed: number; regionEnabled?: boolean; farms?: string[]; day: number; width: number; height: number; port: string | null; towns: Town[]; segments: Segment[]; routes: Route[];
  goodsLines: Array<{ id: string; a: string; b: string; vehicles: number; netPerDay: number; stops: string[] }>;
  flows: Flow[]; sites: Site[]; demand: Pair[]; corridors: Corridor[]; noSeatPairs: Array<{ a: string; b: string; perDay: number }>;
  moves: Array<{ label: string; price: number }>; cementBreak: { kind: string; nextDay?: number; quarryId?: string } | null; days: Day[];
  /** Vehicles on each road piece at the last tick, by kind (the game's real crowding). */
  traffic?: Record<string, { danfo: number; keke: number; okada: number; truck: number; yours: number }>;
}
// Fetched, not imported: the snapshot is generated and kept out of git, so an import broke
// the typecheck on any fresh checkout (CI included).
const response = await fetch("/src/info-lab/snapshot.json");
if (!response.ok) {
  document.body.innerHTML = `<p style="padding:24px;font:14px system-ui">No snapshot yet. Make one from a saved run: <code>bun scripts/info-snapshot.ts run.json</code>, then reload.</p>`;
  throw new Error("info-lab: src/info-lab/snapshot.json is missing");
}
const S = (await response.json()) as Snapshot;
const townById = new Map(S.towns.map((t) => [t.id, t]));
const siteById = new Map(S.sites.map((s) => [s.id, s]));
const nameOf = (id: string) => townById.get(id)?.name ?? id;
const lastDay = S.days[S.days.length - 1]!;

// --- Formatting ------------------------------------------------------------

const naira = (n: number) => `${n < 0 ? "−" : ""}₦${Math.abs(Math.round(n)).toLocaleString()}`;
const nairaK = (n: number) => (Math.abs(n) >= 10000 ? `${n < 0 ? "−" : ""}₦${Math.round(Math.abs(n) / 1000).toLocaleString()}k` : naira(n));
const int = (n: number) => Math.round(n).toLocaleString();
const pct = (x: number) => `${Math.round(x * 100)}%`;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A day's budget line from the cumulative tally: today less yesterday, rolled over five days. */
function dailyBudget(key: string | string[]): number[] {
  const keys = Array.isArray(key) ? key : [key];
  const raw = S.days.map((d, i) => {
    const prev = i > 0 ? S.days[i - 1]!.budget : null;
    return keys.reduce((sum, k) => sum + (d.budget[k] ?? 0) - (prev ? prev[k] ?? 0 : 0), 0);
  });
  return raw.map((_, i) => {
    const w = raw.slice(Math.max(0, i - 4), i + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
}

// --- Terrain ---------------------------------------------------------------

const mapDef = gameMap(GAME_MAP, S.seed, { regionEnabled: S.regionEnabled });
const terrain = buildGameTerrain(mapDef);
let terrainImage: HTMLCanvasElement | null = null;
function bakeTerrain(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = terrain.width;
  c.height = terrain.height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(c.width, c.height);
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const land = hex(css("--land"));
  const water = hex(css("--water"));
  const hill = css("--hill").split(" ").map(Number);
  const top = terrain.elevation.reduce((m, e) => Math.max(m, e), 0) || 1;
  for (let i = 0; i < terrain.width * terrain.height; i += 1) {
    const e = terrain.elevation[i]! / top;
    const base = terrain.water[i] ? water : land;
    const k = terrain.water[i] ? 0 : Math.min(0.35, e * 0.35);
    img.data.set([base[0]! * (1 - k) + hill[0]! * k, base[1]! * (1 - k) + hill[1]! * k, base[2]! * (1 - k) + hill[2]! * k, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// --- State -----------------------------------------------------------------

type Overlay = "none" | "demand" | "noseat" | "informal" | "chains";
type Selection = { kind: "town" | "route" | "site" | "segment"; id: string } | null;
let overlay: Overlay = "none";
let selected: Selection = null;
let hover: Selection = null;
let tab: "routes" | "towns" | "sites" = "routes";
const sorts: Record<string, { key: string; dir: 1 | -1 }> = { routes: { key: "net", dir: 1 }, towns: { key: "growth", dir: -1 }, sites: { key: "use", dir: 1 }, revenue: { key: "net", dir: -1 } };
let logFilter = "all";
let range = 0; // revenue screen: 0 = all days

// Your riders a day on each road piece: each route's riders along the pieces between its stops.
const segmentByEnds = new Map<string, Segment>();
for (const s of S.segments) {
  segmentByEnds.set(`${s.a}|${s.b}|${s.type}`, s);
  segmentByEnds.set(`${s.b}|${s.a}|${s.type}`, s);
}
const yoursOn = new Map<string, number>();
for (const r of S.routes) {
  const type = r.kind === "train" ? "rail" : "road";
  for (let i = 1; i < r.stops.length; i += 1) {
    const s = segmentByEnds.get(`${r.stops[i - 1]}|${r.stops[i]}|${type}`);
    if (s) yoursOn.set(s.id, (yoursOn.get(s.id) ?? 0) + r.ridersPerDay);
  }
}
const maxYours = Math.max(1, ...yoursOn.values());

// What's wrong at a town, in one line, and the move that answers it (mocked as a button).
function townProblem(t: Town): { text: string; move: string } | null {
  if (t.industry) return null;
  const noSeat = S.noSeatPairs.filter((p) => p.a === t.id || p.b === t.id).sort((x, y) => y.perDay - x.perDay)[0];
  if (t.roadFull && !t.roadFull.thin) return { text: `Can't grow: its road is full`, move: t.roadFull.next === "paved" ? "Pave its road" : t.roadFull.next === "lane" ? "A bus lane" : "Rail" };
  // Cement: past its first 40% a town needs cement to build. A problem only when it costs the
  // town 5% of its size or more -- 11k on a 346k town at 95% supplied read as an alarm (you, 2026-10-23).
  if (t.cementHeld >= Math.max(5, 0.05 * t.population)) {
    const b = S.cementBreak;
    const move = b?.kind === "no-quarry" ? `Next quarry ~day ${b.nextDay}` : b?.kind === "quarry" ? `Connect ${nameOf(b.quarryId ?? "")}` : b?.kind === "idle" ? "Restore the works" : "Yard at the works";
    return { text: `Short of cement (${pct(t.cement ?? 0)} of what it needs): ${int(t.cementHeld)}k fewer people than your service would grow it to`, move };
  }
  if (t.fuel !== null && t.fuel < 0.6) return { text: `Fuel short: ${pct(t.fuel)} supplied`, move: "Yard at the tank farm" };
  if (noSeat && noSeat.perDay >= 50) return { text: `${int(noSeat.perDay)} a day find no seat to ${nameOf(noSeat.a === t.id ? noSeat.b : noSeat.a)}`, move: "Add a bus" };
  if (t.expected > 0 && t.share.you < t.expected) return { text: `Expects you to carry ${pct(t.expected)}; you carry ${pct(t.share.you)}`, move: "More buses here" };
  return null;
}
function routeProblem(r: Route): { text: string; move: string } | null {
  switch (r.verdict) {
    case "full": return { text: "Full: riders are left waiting", move: "Add one" };
    case "overcapacity": return { text: "More vehicles than riders", move: "Sell one" };
    case "thin": return { text: "Too few riders to pay its way", move: "Sell one" };
    case "jammed": return { text: "Stuck in traffic", move: "Pave or a lane" };
    case "worn": return { text: "Its road is worn: it costs more to run", move: "Keep the road up" };
    case "waiting": return r.netPerDay < 0 ? { text: "Riders give up waiting, and it loses money", move: "Sell one" } : { text: "Riders give up waiting", move: "Add one" };
    default: return r.netPerDay < 0 ? { text: "Loses money", move: "Sell one" } : null;
  }
}

// --- The map ---------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
const ctx = canvas.getContext("2d")!;
const tip = document.querySelector<HTMLDivElement>("#tip")!;
let view = { scale: 1, ox: 0, oy: 0 };
/** The whole map in view (resize sets it); `zoom` is how far in from there, 1 = all of it. */
let fit = { scale: 1, ox: 0, oy: 0 };
const zoom = () => view.scale / fit.scale;
/** Marks grow with the zoom, but slower than the map (its square root): room opens between them. */
const grow = () => Math.sqrt(zoom());
const toScreen = (x: number, y: number) => ({ x: view.ox + x * view.scale, y: view.oy + y * view.scale });
// The icon mock (icons.ts): towns by tier, sites by glyph. Off shows the lab as agreed, to compare.
let iconsOn = true;
const cityId = S.towns.filter((t) => !t.industry).reduce((big, t) => (t.population > big.population ? t : big)).id;
const tierOfTown = (t: Town): Tier => tierOf(t.population, t.id === cityId);
const SITE_SIZE = 17;
const townRadius = (t: Town) => (t.industry ? (iconsOn ? SITE_SIZE / 2 : 6) : iconsOn ? tierRadius(tierOfTown(t), t.population) : Math.max(5, Math.sqrt(t.population) * 1.1)) * grow();
function siteState(id: string): SiteState {
  const s = siteById.get(id);
  if (!s || s.capacity <= 0 || s.made < 0.5) return "idle";
  return s.made < 0.6 * s.capacity ? "short" : "working";
}
/** The port always; a farm town only zoomed in or pointed at (most small towns farm: a badge on each was clutter). */
function badgesOf(t: Town, close: boolean): Badge[] {
  return [...(t.id === S.port ? ["port" as const] : []), ...(close && S.farms?.includes(t.id) ? ["farm" as const] : [])];
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pad = 30;
  const scale = Math.min((rect.width - pad * 2) / S.width, (rect.height - pad * 2) / S.height);
  fit = { scale, ox: (rect.width - S.width * scale) / 2, oy: (rect.height - S.height * scale) / 2 };
  view = { ...fit };
  draw();
}

// Zoom and pan: the wheel zooms toward the cursor (1x to 6x the whole map), a drag pans,
// a double-click or Fit shows it all again. Zoomed in to 2x or more, there's room to draw the
// danfos and trucks one by one even at 4x (fix 1 reads the zoom as well as the speed).
const MAX_ZOOM = 6;
function zoomAt(mx: number, my: number, factor: number): void {
  const next = Math.max(fit.scale, Math.min(fit.scale * MAX_ZOOM, view.scale * factor));
  const k = next / view.scale;
  view = { scale: next, ox: mx - (mx - view.ox) * k, oy: my - (my - view.oy) * k };
  if (next === fit.scale) view = { ...fit };
  renderLegend();
  renderZoom();
  draw();
}
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * 0.0015));
}, { passive: false });
let dragging: { x: number; y: number; moved: boolean } | null = null;
canvas.addEventListener("mousedown", (event) => {
  dragging = { x: event.clientX, y: event.clientY, moved: false };
});
window.addEventListener("mousemove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - dragging.x;
  const dy = event.clientY - dragging.y;
  if (!dragging.moved && Math.hypot(dx, dy) < 4) return;
  dragging = { x: event.clientX, y: event.clientY, moved: true };
  if (zoom() <= 1.0001) return; // the whole map is already in view
  view = { ...view, ox: view.ox + dx, oy: view.oy + dy };
  canvas.style.cursor = "grabbing";
  draw();
});
window.addEventListener("mouseup", () => {
  if (dragging?.moved) suppressClick = true;
  dragging = null;
});
let suppressClick = false;
canvas.addEventListener("dblclick", () => {
  view = { ...fit };
  renderLegend();
  renderZoom();
  draw();
});
function renderZoom(): void {
  let el = document.querySelector<HTMLDivElement>("#zoom");
  if (!el) {
    el = document.createElement("div");
    el.id = "zoom";
    el.style.cssText = "position:absolute;right:12px;top:12px;display:flex;gap:4px;background:var(--surface);padding:6px;border-radius:10px;box-shadow:0 2px 10px var(--shadow)";
    document.querySelector("#mapwrap")!.appendChild(el);
  }
  el.innerHTML = `<button data-z="in" title="Zoom in (or the wheel)">+</button><button data-z="out" title="Zoom out">−</button><button data-z="fit" title="The whole map (or double-click)">Fit</button><span class="muted" style="align-self:center;padding:0 4px">${zoom().toFixed(1)}×</span>`;
  el.querySelectorAll<HTMLButtonElement>("[data-z]").forEach((b) => b.addEventListener("click", () => {
    const rect = canvas.getBoundingClientRect();
    if (b.dataset.z === "fit") {
      view = { ...fit };
      renderLegend();
      renderZoom();
      draw();
    } else zoomAt(rect.width / 2, rect.height / 2, b.dataset.z === "in" ? 1.5 : 1 / 1.5);
  }));
}

function line(points: [number, number][], width: number, color: string, dash: number[] = []): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    const p = toScreen(x, y);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.lineWidth = width * grow();
  ctx.strokeStyle = color;
  ctx.setLineDash(dash.map((d) => d * grow()));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.setLineDash([]);
}

/** How full a road runs, as one of three steps: free, busy, jammed (by its speed). */
function fullness(s: Segment): string {
  return s.speed < 0.7 ? css("--load-2") : s.speed < 0.9 ? css("--load-1") : css("--load-0");
}

function arc(a: Town, b: Town, width: number, color: string, alpha = 0.75): void {
  const p = toScreen(a.x, a.y);
  const q = toScreen(b.x, b.y);
  const mx = (p.x + q.x) / 2 - (q.y - p.y) * 0.15;
  const my = (p.y + q.y) / 2 + (q.x - p.x) * 0.15;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.quadraticCurveTo(mx, my, q.x, q.y);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.globalAlpha = 1;
}

const CARGO_GROUPS: Array<{ name: string; color: string; cargos: (c: string) => boolean }> = [
  { name: "Fuel and crude", color: "--s5", cargos: (c) => c === "fuel" || c === "crude" },
  { name: "Limestone and cement", color: "--s4", cargos: (c) => c === "cement" || c === "limestone" || c === "stone" },
  { name: "Food", color: "--s3", cargos: () => true },
];

// --- Vehicles moving on the map (at a glance: a jam or a full bus seen before any number) ---
//
// A mock from the game's own figures: each route's vehicles (its count) run to and fro along
// it, filled as full as the route runs; danfos on every road by its traffic; all at the road's
// speed, so a jammed road crawls. Not the sim's vehicles -- the run file doesn't keep them.

interface Track { pts: Array<{ x: number; y: number }>; cum: number[]; len: number }
function track(points: Array<[number, number]>): Track {
  const pts = points.map(([x, y]) => ({ x, y }));
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  return { pts, cum, len: cum[cum.length - 1]! };
}
function along(t: Track, d: number): { x: number; y: number; angle: number } {
  let i = 1;
  while (i < t.cum.length - 1 && t.cum[i]! < d) i += 1;
  const a = t.pts[i - 1]!;
  const b = t.pts[i]!;
  const seg = Math.max(1e-6, t.cum[i]! - t.cum[i - 1]!);
  const k = Math.max(0, Math.min(1, (d - t.cum[i - 1]!) / seg));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}
const routeTracks = S.routes.map((r) => {
  const type = r.kind === "train" ? "rail" : "road";
  const pts: Array<[number, number]> = [];
  const speeds: number[] = [];
  for (let i = 1; i < r.stops.length; i += 1) {
    const seg = segmentByEnds.get(`${r.stops[i - 1]}|${r.stops[i]}|${type}`);
    if (!seg) continue;
    const piece = seg.a === r.stops[i - 1] ? seg.points : seg.points.slice().reverse();
    pts.push(...(pts.length ? piece.slice(1) : piece));
    speeds.push(seg.speed);
  }
  const speed = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 1;
  return { route: r, track: track(pts), speed };
}).filter((x) => x.track.len > 0);
// The other side's vehicles on each road: the game's real counts at the last tick where the
// snapshot has them (danfos, kekes, okadas, trucks), else a few by its traffic.
const otherTracks = S.segments.filter((s) => s.type === "road").map((s) => {
  const real = S.traffic?.[s.id];
  return {
    seg: s,
    track: track(s.points),
    danfo: real ? real.danfo : Math.round(Math.min(1.2, s.load) * 5),
    keke: real?.keke ?? 0,
    okada: real?.okada ?? 0,
    truck: real?.truck ?? 0,
  };
});
const maxOthers = Math.max(1, ...otherTracks.map((o) => o.danfo + o.keke + o.okada));
const maxTrucks = Math.max(1, ...otherTracks.map((o) => o.truck));
let vehiclesOn = true;
/** How fast the game runs: the speed you play at (the slice's 1x, 2x, 4x). */
let gameSpeed: 1 | 2 | 4 = 4;
/** Fix 1: at 4x, the other side's vehicles become bands on their road; yours stay. */
let detailBySpeed = true;
/** Fix 3: hover or select something and what isn't part of it fades. */
let focusOn = true;
/** Seconds of game motion, advanced by real time times the game's speed. */
let motion = 0;
let lastFrame = 0;
/** Bands at 4x unless zoomed in to 2x or more, where each vehicle has room again. */
const crowdAsBands = () => detailBySpeed && gameSpeed >= 4 && zoom() < 2;
const SIZE: Record<string, [number, number]> = { bus: [11, 5], minibus: [8, 4.5], brt: [15, 5.5], train: [20, 5] };
const CELLS_A_SECOND: Record<string, number> = { bus: 2.2, minibus: 2.6, brt: 3, train: 3.6 };

function vehicle(x: number, y: number, angle: number, side: number, len0: number, wid0: number, fill: string, edge: string, full: number | null): void {
  const p = toScreen(x, y);
  const len = len0 * grow();
  const wid = wid0 * grow();
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.translate(0, side * (wid / 2 + 1));
  ctx.beginPath();
  ctx.roundRect(-len / 2, -wid / 2, len, wid, wid / 2);
  ctx.fillStyle = full === null ? fill : css("--surface");
  ctx.fill();
  if (full !== null) {
    // How full it runs: the vehicle fills from the back.
    ctx.save();
    ctx.clip();
    ctx.fillStyle = fill;
    ctx.fillRect(-len / 2, -wid / 2, len * Math.max(0.08, Math.min(1, full)), wid);
    ctx.restore();
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.restore();
}

function drawVehicles(): void {
  if (!vehiclesOn) return;
  const t = motion;
  const danfo = css("--informal");
  const truck = css("--goods");
  const dark = css("--ink");
  const focus = focusSet();
  // The other side, one by one -- unless the game runs fast enough that they're a swarm (fix 1).
  if (!crowdAsBands()) {
    for (const o of otherTracks) {
      ctx.globalAlpha = focus && !focus.segments.has(o.seg.id) ? 0.15 : 1;
      const kinds: Array<[number, number, number, string, number]> = [
        [o.danfo, 6, 3.2, danfo, 2.6],
        [o.keke, 4, 3, danfo, 2.2],
        [o.okada, 2.6, 2.6, danfo, 3],
        [o.truck, 9, 4, truck, 2],
      ];
      kinds.forEach(([count, len, wid, color, cells], kind) => {
        for (let k = 0; k < count; k += 1) {
          const total = o.track.len * 2;
          const pos = (t * cells * o.seg.speed + (k / count) * total + o.seg.id.length * 7 + kind * 3) % total;
          const forward = pos < o.track.len;
          const at = along(o.track, forward ? pos : total - pos);
          vehicle(at.x, at.y, at.angle, forward ? -1 : 1, len, wid, color, dark, null);
        }
      });
    }
    ctx.globalAlpha = 1;
  }
  const you = css("--you");
  const rail = css("--rail");
  for (const { route, track: tr, speed } of routeTracks) {
    ctx.globalAlpha = focus && !focus.routes.has(route.id) ? 0.15 : 1;
    const [len, wid] = SIZE[route.kind] ?? SIZE.bus!;
    for (let k = 0; k < route.vehicles; k += 1) {
      const total = tr.len * 2;
      const pos = (t * (CELLS_A_SECOND[route.kind] ?? 2.2) * speed + (k / route.vehicles) * total) % total;
      const forward = pos < tr.len;
      const at = along(tr, forward ? pos : total - pos);
      vehicle(at.x, at.y, at.angle + (forward ? 0 : Math.PI), 1, len, wid, you, route.kind === "train" ? rail : you, route.loadFactor);
    }
  }
  ctx.globalAlpha = 1;
}

/** A polyline on screen, moved sideways by `d` pixels (for the bands beside a road). */
function offsetLine(points: Array<[number, number]>, d0: number, width: number, color: string): void {
  const sp = points.map(([x, y]) => toScreen(x, y));
  const d = d0 * grow();
  ctx.beginPath();
  sp.forEach((p, i) => {
    const a = sp[Math.max(0, i - 1)]!;
    const b = sp[Math.min(sp.length - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    if (i === 0) ctx.moveTo(p.x + nx * d, p.y + ny * d);
    else ctx.lineTo(p.x + nx * d, p.y + ny * d);
  });
  ctx.lineWidth = width * grow();
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

/**
 * What a hovered or selected thing is part of (fix 3): a town's roads and the routes that stop
 * there; a route's roads; a road and the routes along it. Null with nothing in focus.
 */
function focusSet(): { segments: Set<string>; routes: Set<string>; towns: Set<string> } | null {
  if (!focusOn) return null;
  const f = hover ?? selected;
  if (!f) return null;
  const segments = new Set<string>();
  const routes = new Set<string>();
  const towns = new Set<string>();
  const addRoute = (r: Route) => {
    routes.add(r.id);
    const type = r.kind === "train" ? "rail" : "road";
    r.stops.forEach((stop, i) => {
      towns.add(stop);
      const seg = i > 0 ? segmentByEnds.get(`${r.stops[i - 1]}|${stop}|${type}`) : undefined;
      if (seg) segments.add(seg.id);
    });
  };
  if (f.kind === "route") {
    const r = S.routes.find((x) => x.id === f.id);
    if (r) addRoute(r);
  } else if (f.kind === "segment") {
    segments.add(f.id);
    const seg = S.segments.find((x) => x.id === f.id)!;
    towns.add(seg.a);
    towns.add(seg.b);
    for (const r of routeTracks) if (r.route.stops.includes(seg.a) && r.route.stops.includes(seg.b)) addRoute(r.route);
  } else {
    towns.add(f.id);
    for (const seg of S.segments) if (seg.a === f.id || seg.b === f.id) {
      segments.add(seg.id);
      towns.add(seg.a);
      towns.add(seg.b);
    }
    for (const r of S.routes) if (r.stops.includes(f.id)) addRoute(r);
  }
  return { segments, routes, towns };
}

function draw(): void {
  const rect = canvas.getBoundingClientRect();
  ctx.fillStyle = css("--bg");
  ctx.fillRect(0, 0, rect.width, rect.height);
  terrainImage ??= bakeTerrain();
  // Smoothed: one pixel a map cell, so zoomed in it's the hills' shape, not blocks.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(terrainImage, view.ox, view.oy, S.width * view.scale, S.height * view.scale);

  // Roads by what they carry: width by load, colour by how full they run. Rail beneath your service.
  const dim = overlay !== "none";
  const focus = focusSet();
  const alphaFor = (id: string) => (focus && !focus.segments.has(id) ? 0.18 : dim ? 0.45 : 1);
  for (const s of S.segments) {
    ctx.globalAlpha = alphaFor(s.id);
    if (s.type === "rail") {
      line(s.points, 3, css("--rail"));
      line(s.points, 1, css("--land"), [2, 4]);
      continue;
    }
    const w = 2 + Math.min(1.2, s.load) * 7;
    line(s.points, w + 2, css("--surface"));
    line(s.points, w, fullness(s));
    if (s.busLane) line(s.points, 1.5, css("--you"), [6, 4]);
    // Fix 1: the danfos, kekes and okadas as a yellow band on one side, trucks brown on the
    // other, each as wide as how many there are -- the road says what the swarm did. Kept at
    // every zoom (zoomed in, the vehicles are drawn on top): at any one moment a road has a few,
    // and swapping the band for them lost the summary just when you looked closer (you, 2026-10-23).
    if (vehiclesOn && detailBySpeed) {
      const o = otherTracks.find((x) => x.seg.id === s.id);
      const informal = o ? o.danfo + o.keke + o.okada : 0;
      if (informal > 0) offsetLine(s.points, -(w / 2 + 2.5), 1.5 + (informal / maxOthers) * 5, css("--informal"));
      if (o && o.truck > 0) offsetLine(s.points, w / 2 + 2.5, 1.5 + (o.truck / maxTrucks) * 5, css("--goods"));
    }
  }
  // Your service on top: a blue core by your riders along each piece.
  for (const s of S.segments) {
    const riders = yoursOn.get(s.id) ?? 0;
    if (riders <= 0) continue;
    ctx.globalAlpha = alphaFor(s.id);
    line(s.points, 1.5 + (riders / maxYours) * 5, css("--you"));
  }
  ctx.globalAlpha = 1;

  // The overlay, one at a time.
  if (overlay === "demand" || overlay === "noseat") {
    const pairs = S.demand
      .map((p) => ({ p, v: overlay === "demand" ? p.you + p.informal + p.noSeat + p.noRoad : p.noSeat }))
      .filter((x) => x.v >= 10 && townById.has(x.p.a) && townById.has(x.p.b))
      .sort((x, y) => x.v - y.v);
    const top = Math.max(1, ...pairs.map((x) => x.v));
    for (const { p, v } of pairs.slice(-60)) arc(townById.get(p.a)!, townById.get(p.b)!, 1 + (v / top) * 12, overlay === "demand" ? css("--ink-2") : css("--bad"), overlay === "demand" ? 0.35 : 0.6);
  } else if (overlay === "informal") {
    for (const c of S.corridors) {
      const a = townById.get(c.a);
      const b = townById.get(c.b);
      if (!a || !b) continue;
      ctx.globalAlpha = 0.25 + c.informal * 0.75;
      const p = toScreen(a.x, a.y);
      const q = toScreen(b.x, b.y);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.lineWidth = 3 + c.informal * 12;
      ctx.strokeStyle = css("--informal");
      ctx.lineCap = "round";
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  } else if (overlay === "chains") {
    // The 25 biggest flows: every flow at once was a tangle.
    const shown = S.flows.slice().sort((x, y) => y.perDay - x.perDay).slice(0, 25);
    const top = Math.max(1, ...shown.map((f) => f.perDay));
    for (const f of shown) {
      const a = townById.get(f.from);
      const b = townById.get(f.to);
      if (!a || !b) continue;
      const group = CARGO_GROUPS.find((g) => g.cargos(f.cargo))!;
      arc(a, b, 1 + (f.perDay / top) * 10, css(group.color), 0.7);
    }
  }

  drawVehicles();

  // Towns and sites: size by people; a ring of who carries their trips; trend; a problem mark.
  const towns = focusSet()?.towns;
  for (const t of S.towns) {
    const p = toScreen(t.x, t.y);
    const r = townRadius(t);
    const isSel = selected?.id === t.id || hover?.id === t.id;
    ctx.globalAlpha = towns && !towns.has(t.id) ? 0.3 : 1;
    if (t.industry && iconsOn) {
      drawSite(ctx, p.x, p.y, r * 2, (t.industry in GLYPHS ? t.industry : "quarry") as Glyph, siteState(t.id), css("--surface"));
      if (isSel) {
        ctx.strokeStyle = css("--ink");
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x - r - 4, p.y - r - 4, r * 2 + 8, r * 2 + 8);
      }
      // A site's name on hover or zoomed in: what it is, without a label on every square.
      if (isSel || zoom() >= 2) {
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.font = "600 11px ui-sans-serif, system-ui";
        ctx.fillStyle = css("--ink-2");
        ctx.fillText(t.name, p.x, p.y + r + 5);
      }
      continue;
    }
    if (t.industry) {
      const site = siteById.get(t.id);
      ctx.fillStyle = css("--surface");
      ctx.strokeStyle = site && site.capacity > 0 && site.made < 0.6 * site.capacity ? css("--warn") : css("--goods");
      ctx.lineWidth = isSel ? 3 : 2;
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
      continue;
    }
    const tier = tierOfTown(t);
    if (iconsOn) {
      drawTown(ctx, p.x, p.y, r, tier, t.share, { surface: css("--surface"), ink: css("--ink"), you: css("--you"), informal: css("--informal"), home: css("--home") });
      badgesOf(t, isSel || zoom() >= 2).forEach((b, k) => drawBadge(ctx, p.x - r * 0.85 - k * 15, p.y + r * 0.85, 15, b, css("--surface")));
    }
    if (!iconsOn) {
    ctx.fillStyle = css("--surface");
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    }
    // The ring: you, informal, stayed home -- clockwise from the top.
    let start = -Math.PI / 2;
    for (const [share, color] of iconsOn ? [] : [[t.share.you, "--you"], [t.share.informal, "--informal"], [t.share.lost, "--home"]] as const) {
      const end = start + share * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2.5, start, end);
      ctx.lineWidth = 4;
      ctx.strokeStyle = css(color);
      ctx.stroke();
      start = end;
    }
    if (isSel) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = css("--ink");
      ctx.stroke();
    }
    // A problem: an amber mark on its top-right.
    if (townProblem(t)) {
      ctx.fillStyle = css("--warn");
      ctx.beginPath();
      ctx.arc(p.x + r * 0.8, p.y - r * 0.8, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "700 9px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", p.x + r * 0.8, p.y - r * 0.8 + 0.5);
    }
    // Name and size for the towns that matter; every name on hover. With icons, a village's
    // name waits for the zoom (or the pointer): the region's many small places stay quiet.
    const named = iconsOn ? (tier !== "village" || isSel || zoom() >= 2) : !t.roadside || isSel;
    if (named) {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.font = iconsOn && (tier === "city" || tier === "regional") ? "700 13px ui-sans-serif, system-ui" : "600 12px ui-sans-serif, system-ui";
      ctx.fillStyle = css("--ink");
      ctx.fillText(t.name, p.x, p.y + r + 7);
      const arrow = t.trend === "growing" ? "▲" : t.trend === "shrinking" ? "▼" : "";
      ctx.font = "11px ui-sans-serif, system-ui";
      ctx.fillStyle = t.trend === "growing" ? css("--good") : t.trend === "shrinking" ? css("--bad") : css("--muted");
      ctx.fillText(`${int(t.population)}k ${arrow}`, p.x, p.y + r + 21);
    }
  }
  ctx.globalAlpha = 1;
}

function renderLegend(): void {
  const el = document.querySelector<HTMLDivElement>("#legend")!;
  const base = `<div class="row"><span><i style="background:var(--load-0)"></i> free</span><span><i style="background:var(--load-1)"></i> busy</span><span><i style="background:var(--load-2)"></i> jammed</span><span class="muted">· width: traffic</span><span><i style="background:var(--you)"></i> your riders</span></div>
    ${vehiclesOn ? `<div class="row"><span><i style="background:var(--you);height:6px;width:12px"></i> your vehicle, filled as full as its route runs</span>${crowdAsBands() ? `<span><i style="background:var(--informal)"></i> danfos, kekes, okadas</span><span><i style="background:var(--goods)"></i> trucks</span><span class="muted">· at ${gameSpeed}×, as bands: wider, more (zoom in to see each on top)</span>` : `<span><i style="background:var(--informal);height:5px;width:8px"></i> danfo, keke, okada</span><span><i style="background:var(--goods);height:5px;width:10px"></i> truck</span><span class="muted">· at the road's speed${detailBySpeed ? "; the bands beside each road: how many are on it" : ""}</span>`}</div>` : ""}
    <div class="row"><span><b style="background:var(--you)"></b> you</span><span><b style="background:var(--informal)"></b> informal</span><span><b style="background:var(--home)"></b> stayed home</span><span class="muted">· ring: who carries a town's trips</span></div>`;
  const extra = overlay === "demand" ? `<div class="row muted">Arcs: trips a day between towns, by anyone (top 60)</div>`
    : overlay === "noseat" ? `<div class="row"><span><i style="background:var(--bad)"></i> trips a day that found no seat</span></div>`
    : overlay === "informal" ? `<div class="row"><span><i style="background:var(--informal)"></i> the informal share of each corridor (wider, more)</span></div>`
    : overlay === "chains" ? `<div class="row">${CARGO_GROUPS.map((g) => `<span><i style="background:var(${g.color})"></i> ${g.name}</span>`).join("")}<span class="muted">· width: t/day · the 25 biggest flows</span></div>`
    : "";
  const icons = iconsOn ? `<div class="row"><span class="muted">Icons:</span>${(Object.keys(FAMILY_COLOR) as Family[]).map((f) => `<span><i style="background:${FAMILY_COLOR[f]};width:10px;height:10px;border-radius:3px"></i> ${FAMILY_NAME[f]}</span>`).join("")}<span class="muted">· solid working, hollow idle, amber corner held back · Icon sheet for the rest</span></div>` : "";
  el.innerHTML = base + extra + icons;
}

// --- The icon sheet: every icon, at map size and large --------------------------------------

function openSheet(open: boolean): void {
  const el = document.querySelector<HTMLElement>("#sheet")!;
  el.classList.toggle("open", open);
  if (open) renderSheet();
}

function renderSheet(): void {
  const el = document.querySelector<HTMLElement>("#sheet")!;
  const cell = (id: string, label: string, note = "") => `<div class="icon"><canvas data-icon="${id}" width="132" height="56"></canvas><div class="name">${esc(label)}</div>${note ? `<div class="muted note">${esc(note)}</div>` : ""}</div>`;
  const glyphs = Object.entries(GLYPHS) as Array<[Glyph, (typeof GLYPHS)[Glyph]]>;
  const byFamily = (next: boolean) => (Object.keys(FAMILY_COLOR) as Family[]).map((f) => {
    const items = glyphs.filter(([, g]) => g.family === f && !!g.next === next);
    return items.length ? `<h3><i style="background:${FAMILY_COLOR[f]}"></i>${FAMILY_NAME[f]}</h3><div class="icons">${items.map(([id, g]) => cell(`site:${id}`, g.name)).join("")}</div>` : "";
  }).join("");
  el.innerHTML = `<div class="top"><div class="title">Icon sheet</div><button id="close-sheet">Back to the map ✕</button></div>
    <div class="cards">
      <div class="card"><h3>Towns, by tier</h3><div class="sub">Size still says how many people; the rim says what kind of place. The ring: who carries its trips.</div>
        <div class="icons">${(["village", "town", "regional", "city"] as Tier[]).map((t) => cell(`tier:${t}`, TIER_NAME[t])).join("")}</div>
        <h3 style="margin-top:12px">Badges</h3><div class="sub">What a town is besides a town.</div>
        <div class="icons">${(Object.keys(BADGE_NAME) as Badge[]).map((b) => cell(`badge:${b}`, BADGE_NAME[b], b === "border" ? "with the gateways" : "")).join("")}</div>
        <h3 style="margin-top:12px">A site's state</h3><div class="sub">The same glyph: running, idle (built for another age, not running), or held back (under 60% of what it could make).</div>
        <div class="icons">${(["working", "idle", "short"] as SiteState[]).map((st) => cell(`state:${st}`, st === "working" ? "Working" : st === "idle" ? "Idle" : "Held back")).join("")}</div>
      </div>
      <div class="card"><h3>Sites on the map today</h3><div class="sub">The glyph says what it is; the colour which family of chain.</div>${byFamily(false)}</div>
      <div class="card wide"><h3>The chains agreed next</h3><div class="sub">Steel, palm oil, cotton, cattle, cocoa, coal, general cargo: drawn now, so the language holds when they come.</div>${byFamily(true)}</div>
    </div>`;
  el.querySelector("#close-sheet")!.addEventListener("click", () => openSheet(false));
  const colors = { surface: css("--surface"), ink: css("--ink"), you: css("--you"), informal: css("--informal"), home: css("--home") };
  const share = { you: 0.35, informal: 0.45, lost: 0.2 };
  const dpr = window.devicePixelRatio || 1;
  el.querySelectorAll<HTMLCanvasElement>("canvas[data-icon]").forEach((c) => {
    c.style.width = `${c.width}px`;
    c.style.height = `${c.height}px`;
    c.width *= dpr;
    c.height *= dpr;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    const [kind, id] = c.dataset.icon!.split(":") as [string, string];
    // Left: as on the map at fit; right: large (as at 4x zoom).
    for (const [x, k] of [[30, 1], [92, 2]] as const) {
      if (kind === "site") drawSite(g, x, 28, SITE_SIZE * k, id as Glyph, "working", colors.surface);
      else if (kind === "state") drawSite(g, x, 28, SITE_SIZE * k, "refinery", id as SiteState, colors.surface);
      else if (kind === "badge") drawBadge(g, x, 28, 15 * k, id as Badge, colors.surface);
      else {
        const pop = id === "village" ? 9 : id === "town" ? 25 : id === "regional" ? 60 : 130;
        const r = tierRadius(id as Tier, pop) * (k === 1 ? 1 : 1.25);
        drawTown(g, x, 28, Math.min(r, 20), id as Tier, share, colors);
      }
    }
  });
}

function hitTest(mx: number, my: number): Selection {
  for (const t of [...S.towns].sort((a, b) => townRadius(a) - townRadius(b))) {
    const p = toScreen(t.x, t.y);
    if (Math.hypot(p.x - mx, p.y - my) <= townRadius(t) + 4) return { kind: t.industry ? "site" : "town", id: t.id };
  }
  let best: { id: string; d: number } | null = null;
  for (const s of S.segments) {
    for (let i = 1; i < s.points.length; i += 1) {
      const a = toScreen(...s.points[i - 1]!);
      const b = toScreen(...s.points[i]!);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = dx * dx + dy * dy;
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((mx - a.x) * dx + (my - a.y) * dy) / len));
      const d = Math.hypot(mx - (a.x + t * dx), my - (a.y + t * dy));
      if (d < 7 && (!best || d < best.d)) best = { id: s.id, d };
    }
  }
  return best ? { kind: "segment", id: best.id } : null;
}

function tipFor(sel: Selection): string {
  if (!sel) return "";
  if (sel.kind === "town" || sel.kind === "site") {
    const t = townById.get(sel.id)!;
    if (t.industry) {
      const s = siteById.get(t.id);
      return `<b>${esc(t.name)}</b><br>${s?.product ?? t.industry}: ${int(s?.made ?? 0)} of ${int(s?.capacity ?? 0)} t/day`;
    }
    const prob = townProblem(t);
    return `<b>${esc(t.name)}</b> · ${int(t.population)}k<br>you ${pct(t.share.you)} · informal ${pct(t.share.informal)} · stayed home ${pct(t.share.lost)}${prob ? `<br>⚠ ${esc(prob.text)}` : ""}`;
  }
  const s = S.segments.find((x) => x.id === sel.id)!;
  return `<b>${esc(nameOf(s.a))} – ${esc(nameOf(s.b))}</b> · ${s.type === "rail" ? "rail" : `${s.surface}${s.busLane ? ", bus lane" : ""}`}<br>${pct(s.load)} of what it carries before it jams · ${pct(s.speed)} speed${yoursOn.get(s.id) ? `<br>your riders along it: ${int(yoursOn.get(s.id)!)}/day` : ""}`;
}

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const next = hitTest(event.clientX - rect.left, event.clientY - rect.top);
  if (next?.id !== hover?.id) {
    hover = next;
    draw();
  }
  canvas.style.cursor = hover ? "pointer" : "default";
  if (hover) {
    tip.innerHTML = tipFor(hover);
    tip.style.display = "block";
    tip.style.left = `${event.clientX + 14}px`;
    tip.style.top = `${event.clientY + 12}px`;
  } else tip.style.display = "none";
});
canvas.addEventListener("mouseleave", () => {
  hover = null;
  tip.style.display = "none";
  draw();
});
canvas.addEventListener("click", () => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  select(hover);
});

function select(sel: Selection): void {
  selected = sel;
  renderPanel();
  draw();
}

// --- Small charts (SVG): a line or stacked area over days, with a hover crosshair ---

interface Series { name: string; color: string; values: number[] }

function chartSvg(series: Series[], opts: { height?: number; stacked?: boolean; format?: (n: number) => string; from?: number; zeroLine?: boolean } = {}): string {
  const h = opts.height ?? 120;
  const w = 600;
  const pad = { l: 46, r: 8, t: 6, b: 18 };
  const from = opts.from ?? 0;
  const n = series[0]?.values.length ?? 0;
  const xs = Array.from({ length: n - from }, (_, i) => i + from);
  const stack = (i: number, k: number) => series.slice(0, k + 1).reduce((s, x) => s + (x.values[i] ?? 0), 0);
  const tops = xs.map((i) => (opts.stacked ? stack(i, series.length - 1) : Math.max(...series.map((s) => s.values[i] ?? 0))));
  const lows = xs.map((i) => (opts.stacked ? 0 : Math.min(...series.map((s) => s.values[i] ?? 0))));
  const max = Math.max(1, ...tops);
  const min = Math.min(0, ...lows);
  const fx = (i: number) => pad.l + ((i - from) / Math.max(1, n - 1 - from)) * (w - pad.l - pad.r);
  const fy = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  const fmt = opts.format ?? ((v: number) => int(v));
  const grid = [0, 0.5, 1].map((k) => {
    const v = min + (max - min) * k;
    return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${fy(v)}" y2="${fy(v)}" stroke="var(--line)" stroke-width="1"/><text x="${pad.l - 6}" y="${fy(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${fmt(v)}</text>`;
  }).join("");
  const zero = opts.zeroLine && min < 0 ? `<line x1="${pad.l}" x2="${w - pad.r}" y1="${fy(0)}" y2="${fy(0)}" stroke="var(--ink-2)" stroke-width="1"/>` : "";
  const xticks = [from, Math.round((from + n - 1) / 2), n - 1].map((i, k) => `<text x="${fx(i)}" y="${h - 4}" text-anchor="${["start", "middle", "end"][k]}" font-size="10" fill="var(--muted)">day ${S.days[i]?.day ?? i + 1}</text>`).join("");
  let marks = "";
  if (opts.stacked) {
    // Areas, top first, with a 2px surface gap between bands.
    for (let k = series.length - 1; k >= 0; k -= 1) {
      const top = xs.map((i) => `${fx(i)},${fy(stack(i, k))}`);
      const bottom = xs.slice().reverse().map((i) => `${fx(i)},${fy(k > 0 ? stack(i, k - 1) : 0)}`);
      marks += `<polygon points="${[...top, ...bottom].join(" ")}" fill="${series[k]!.color}" stroke="var(--surface)" stroke-width="1"/>`;
    }
  } else {
    for (const s of series) marks += `<polyline points="${xs.map((i) => `${fx(i)},${fy(s.values[i] ?? 0)}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  const data = encodeURIComponent(JSON.stringify({ from, n, l: pad.l, r: pad.r, w, stacked: !!opts.stacked, series: series.map((s) => ({ name: s.name, color: s.color, values: s.values })) }));
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" class="viz" data-chart="${data}" data-fmt="${opts.format === nairaK ? "naira" : "int"}">${grid}${zero}${marks}${xticks}<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${h - pad.b}" stroke="var(--ink)" stroke-width="1" visibility="hidden"/></svg>`;
}

// One crosshair and tooltip for every chart on the page.
document.addEventListener("mousemove", (event) => {
  const svg = (event.target as Element).closest?.("svg.viz") as SVGSVGElement | null;
  document.querySelectorAll<SVGLineElement>("svg.viz .cross").forEach((c) => {
    if (!svg || !svg.contains(c)) c.setAttribute("visibility", "hidden");
  });
  if (!svg) {
    if (!(event.target as Element).closest?.("#map")) tip.style.display = "none";
    return;
  }
  const d = JSON.parse(decodeURIComponent(svg.dataset.chart!)) as { from: number; n: number; l: number; r: number; w: number; stacked: boolean; series: Series[] };
  const rect = svg.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * d.w;
  const i = Math.max(d.from, Math.min(d.n - 1, Math.round(d.from + ((x - d.l) / (d.w - d.l - d.r)) * (d.n - 1 - d.from))));
  const cx = d.l + ((i - d.from) / Math.max(1, d.n - 1 - d.from)) * (d.w - d.l - d.r);
  const cross = svg.querySelector<SVGLineElement>(".cross")!;
  cross.setAttribute("x1", String(cx));
  cross.setAttribute("x2", String(cx));
  cross.setAttribute("visibility", "visible");
  const fmt = svg.dataset.fmt === "naira" ? nairaK : (v: number) => int(v);
  tip.innerHTML = `<b>Day ${S.days[i]?.day ?? i + 1}</b>${d.series.map((s) => `<br><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}: ${fmt(s.values[i] ?? 0)}`).join("")}`;
  tip.style.display = "block";
  tip.style.left = `${event.clientX + 14}px`;
  tip.style.top = `${event.clientY + 12}px`;
});

function sparkline(values: number[], color: string): string {
  const w = 110;
  const h = 24;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - 2 - ((v - min) / Math.max(1, max - min)) * (h - 4)}`).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

// --- The strip: a few numbers that move, with their trend ---------------------

function renderStrip(): void {
  const recent = S.days.slice(-30);
  const ten = S.days[S.days.length - 11] ?? S.days[0]!;
  const stat = (k: string, v: string, now: number, then: number, values: number[], fmt: (n: number) => string, color = css("--ink-2")) => {
    const d = now - then;
    const cls = d > 0 ? "up" : d < 0 ? "down" : "muted";
    return `<div class="stat"><div class="k">${k}</div><div class="v num">${v}</div><div class="d ${cls}">${d >= 0 ? "▲" : "▼"} ${fmt(Math.abs(d))} in 10 days</div>${sparkline(values, color)}</div>`;
  };
  document.querySelector("#strip")!.innerHTML = `
    <div class="stat"><div class="k">Day</div><div class="v num">${lastDay.day}</div><div class="d muted">Map ${S.seed}</div></div>
    ${stat("Trips made a day", int(lastDay.tripsMade), lastDay.tripsMade, ten.tripsMade, recent.map((d) => d.tripsMade), int)}
    ${stat("Your riders a day", int(lastDay.yourRiders), lastDay.yourRiders, ten.yourRiders, recent.map((d) => d.yourRiders), int, css("--you"))}
    ${stat("No seat a day", int(lastDay.noSeat), lastDay.noSeat, ten.noSeat, recent.map((d) => d.noSeat), int, css("--bad"))}
    ${stat("Net a day", naira(lastDay.netPerDay), lastDay.netPerDay, ten.netPerDay, recent.map((d) => d.netPerDay), naira)}
    ${stat("Money", nairaK(lastDay.funds), lastDay.funds, ten.funds, recent.map((d) => d.funds), nairaK)}
    <div class="spacer"></div>
    <div class="actions"><button id="icons-on" class="${iconsOn ? "on" : ""}" title="The icon mock: towns by tier, sites by glyph (off: the lab as agreed)">Icons</button><button id="open-sheet" title="Every icon, at map size and large">Icon sheet</button><button id="open-revenue">Revenue ▸</button><button id="theme" title="Light or dark">◐</button></div>`;
  document.querySelector("#open-revenue")!.addEventListener("click", () => openRevenue(true));
  document.querySelector("#open-sheet")!.addEventListener("click", () => openSheet(true));
  document.querySelector("#icons-on")!.addEventListener("click", () => {
    iconsOn = !iconsOn;
    renderStrip();
    renderLegend();
    draw();
  });
  document.querySelector("#theme")!.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    terrainImage = null;
    renderStrip();
    draw();
    renderPanel();
  });
}

// --- Overlays ----------------------------------------------------------------

function renderOverlays(): void {
  const el = document.querySelector<HTMLDivElement>("#overlays")!;
  const opts: Array<[Overlay, string]> = [["none", "Traffic"], ["demand", "Demand"], ["noseat", "No seat"], ["informal", "Informal share"], ["chains", "Goods"]];
  el.innerHTML = opts.map(([id, label]) => `<button data-overlay="${id}" class="${overlay === id ? "on" : ""}">${label}</button>`).join("") + `<span style="width:10px"></span><button data-vehicles="1" class="${vehiclesOn ? "on" : ""}" title="Vehicles moving on the roads">Vehicles</button>`
    + ([1, 2, 4] as const).map((x) => `<button data-speed="${x}" class="${gameSpeed === x ? "on" : ""}" title="How fast the game runs">${x}×</button>`).join("")
    + `<span style="width:10px"></span><button data-fix="detail" class="${detailBySpeed ? "on" : ""}" title="Fix 1: at 4x the danfos and trucks become bands on their road">Detail by speed</button><button data-fix="focus" class="${focusOn ? "on" : ""}" title="Fix 3: hover or select something and the rest fades">Focus</button>`;
  el.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) => b.addEventListener("click", () => { gameSpeed = Number(b.dataset.speed) as 1 | 2 | 4; renderOverlays(); renderLegend(); draw(); }));
  el.querySelectorAll<HTMLButtonElement>("[data-fix]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.fix === "detail") detailBySpeed = !detailBySpeed;
    else focusOn = !focusOn;
    renderOverlays();
    renderLegend();
    draw();
  }));
  el.querySelector<HTMLButtonElement>("[data-vehicles]")!.addEventListener("click", () => {
    vehiclesOn = !vehiclesOn;
    renderOverlays();
    renderLegend();
    draw();
  });
  el.querySelectorAll<HTMLButtonElement>("button[data-overlay]").forEach((b) =>
    b.addEventListener("click", () => {
      overlay = b.dataset.overlay as Overlay;
      renderOverlays();
      renderLegend();
      draw();
    }),
  );
}

// --- Side panel: lists that sort; one layout for whatever you click ------------

const KIND_COLOR: Record<string, string> = { bus: "--you", minibus: "--s3", brt: "--s4", train: "--rail" };
const routeName = (r: { a: string; b: string }) => `${nameOf(r.a)} ↔ ${nameOf(r.b)}`;

function sortRows<T>(rows: T[], table: string, keys: Record<string, (row: T) => number | string>): T[] {
  const { key, dir } = sorts[table]!;
  const get = keys[key]!;
  return rows.slice().sort((x, y) => {
    const a = get(x);
    const b = get(y);
    return (typeof a === "string" ? a.localeCompare(b as string) : (a as number) - (b as number)) * dir;
  });
}
function th(table: string, key: string, label: string): string {
  const s = sorts[table]!;
  return `<th data-sort="${table}:${key}" class="${s.key === key ? "sorted" : ""}">${label}${s.key === key ? (s.dir === 1 ? " ▲" : " ▼") : ""}</th>`;
}

function renderPanel(): void {
  const el = document.querySelector<HTMLDivElement>("#panel")!;
  if (selected) {
    el.innerHTML = `<div class="pane"><button class="back" data-back="1">◂ All ${tab}</button>${detailHtml(selected)}</div>`;
  } else {
    const tabs = `<div class="tabs">${(["routes", "towns", "sites"] as const).map((t) => `<button data-tab="${t}" class="${tab === t ? "on" : ""}">${t[0]!.toUpperCase()}${t.slice(1)}</button>`).join("")}</div>`;
    el.innerHTML = `${tabs}<div class="pane">${tab === "routes" ? routesTable() : tab === "towns" ? townsTable() : sitesTable()}</div>`;
  }
  el.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab as typeof tab; renderPanel(); }));
  el.querySelectorAll<HTMLElement>("[data-back]").forEach((b) => b.addEventListener("click", () => select(null)));
  el.querySelectorAll<HTMLElement>("[data-sort]").forEach((b) =>
    b.addEventListener("click", () => {
      const [table, key] = b.dataset.sort!.split(":") as [string, string];
      const s = sorts[table]!;
      sorts[table] = s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 };
      if (table === "revenue") renderRevenue();
      else renderPanel();
    }),
  );
  el.querySelectorAll<HTMLElement>("[data-select]").forEach((row) => {
    // Hovering a row focuses it on the map (fix 3).
    row.addEventListener("mouseenter", () => {
      const [kind, id] = row.dataset.select!.split("|") as [NonNullable<Selection>["kind"], string];
      hover = { kind, id };
      draw();
    });
    row.addEventListener("mouseleave", () => {
      hover = null;
      draw();
    });
  });
  el.querySelectorAll<HTMLElement>("[data-select]").forEach((row) =>
    row.addEventListener("click", () => {
      const [kind, id] = row.dataset.select!.split("|") as [NonNullable<Selection>["kind"], string];
      select({ kind, id });
    }),
  );
  el.querySelectorAll<HTMLElement>("[data-move]").forEach((b) => b.addEventListener("click", () => b.replaceWith(Object.assign(document.createElement("span"), { className: "muted", textContent: "(a mock: in the game this does it)" }))));
}

function routesTable(): string {
  const rows = sortRows(S.routes, "routes", { name: (r) => routeName(r), vehicles: (r) => r.vehicles, riders: (r) => r.ridersPerDay, load: (r) => r.loadFactor, net: (r) => r.netPerDay });
  const losing = S.routes.filter((r) => r.netPerDay < 0).length;
  return `<h2>Your routes · ${S.routes.length}, ${losing} losing money</h2>
    <table><thead><tr>${th("routes", "name", "Route")}${th("routes", "vehicles", "Veh.")}${th("routes", "riders", "Riders/day")}${th("routes", "load", "Full")}${th("routes", "net", "Net/day")}</tr></thead><tbody>
    ${rows.map((r) => `<tr class="row" data-select="route|${r.id}"><td><span class="swatch" style="background:var(${KIND_COLOR[r.kind] ?? "--you"})"></span>${esc(routeName(r))}</td><td>${r.vehicles}</td><td>${int(r.ridersPerDay)}</td><td>${pct(r.loadFactor)}</td><td class="${r.netPerDay < 0 ? "down" : ""}">${naira(r.netPerDay)}</td></tr>`).join("")}
    </tbody></table>
    ${S.goodsLines.length ? `<h2>Freight lines</h2><table><tbody>${S.goodsLines.map((g) => `<tr><td><span class="swatch" style="background:var(--goods)"></span>${esc(routeName(g))}</td><td>${g.vehicles} trains</td><td class="${g.netPerDay < 0 ? "down" : ""}">${naira(g.netPerDay)}</td></tr>`).join("")}</tbody></table>` : ""}`;
}

function townsTable(): string {
  const towns = S.towns.filter((t) => !t.industry && t.base !== null);
  const growth = (t: Town) => (t.population - t.base!) / t.base!;
  const rows = sortRows(towns, "towns", { name: (t) => t.name, pop: (t) => t.population, growth, you: (t) => t.share.you });
  return `<h2>Towns · ${towns.filter((t) => townProblem(t)).length} with a problem</h2>
    <table><thead><tr>${th("towns", "name", "Town")}${th("towns", "pop", "People")}${th("towns", "growth", "Since day 1")}${th("towns", "you", "You carry")}</tr></thead><tbody>
    ${rows.map((t) => `<tr class="row" data-select="town|${t.id}"><td>${townProblem(t) ? "⚠ " : ""}${esc(t.name)}</td><td>${int(t.population)}k</td><td class="${growth(t) >= 0 ? "up" : "down"}">${growth(t) >= 0 ? "+" : ""}${pct(growth(t))}</td><td>${pct(t.share.you)}</td></tr>`).join("")}
    </tbody></table>`;
}

function sitesTable(): string {
  const use = (s: Site) => (s.capacity > 0 ? s.made / s.capacity : 0);
  const rows = sortRows(S.sites.filter((s) => s.capacity > 0), "sites", { name: (s) => nameOf(s.id), use, made: (s) => s.made });
  return `<h2>Sites · what each makes of what it could</h2>
    <table><thead><tr>${th("sites", "name", "Site")}${th("sites", "made", "t/day")}${th("sites", "use", "Of capacity")}</tr></thead><tbody>
    ${rows.map((s) => `<tr class="row" data-select="site|${s.id}"><td>${use(s) < 0.6 ? "⚠ " : ""}${esc(nameOf(s.id))}</td><td>${int(s.made)}</td><td class="${use(s) < 0.6 ? "down" : ""}">${pct(use(s))}</td></tr>`).join("")}
    </tbody></table>`;
}

function problemHtml(problem: { text: string; move: string } | null): string {
  return problem
    ? `<div class="problem"><span>⚠ ${esc(problem.text)}</span><button data-move="1">${esc(problem.move)}</button></div>`
    : `<div class="problem none"><span>Nothing wrong here</span></div>`;
}
const tile = (k: string, v: string, note = "") => `<div class="tile"><div class="k">${k}</div><div class="v num">${v}</div>${note ? `<div class="k">${note}</div>` : ""}</div>`;

function detailHtml(sel: NonNullable<Selection>): string {
  if (sel.kind === "town") {
    const t = townById.get(sel.id)!;
    const since = t.base ? (t.population - t.base) / t.base : 0;
    const pop = S.days.map((d) => d.towns.find((x) => x.id === t.id)?.population ?? 0);
    const routesHere = S.routes.filter((r) => r.stops.includes(t.id));
    return `<div class="kicker">Town · ${t.trend}${t.roadside ? " · grew on the road" : ""}</div>
      <div class="head"><div class="title">${esc(t.name)}</div><div class="num">${int(t.population)}k</div></div>
      ${problemHtml(townProblem(t))}
      <div class="tiles">
        ${tile("People", `${int(t.population)}k`, t.base ? `${since >= 0 ? "+" : ""}${pct(since)} since day 1` : "")}
        ${tile("You carry", pct(t.share.you), t.expected > 0 ? `it expects ${pct(t.expected)}` : "")}
        ${tile("Informal", pct(t.share.informal))}
        ${tile("Stayed home", pct(t.share.lost))}
      </div>
      <div class="bar3"><i style="width:${pct(t.share.you)};background:var(--you)"></i><i style="width:${pct(t.share.informal)};background:var(--informal)"></i><i style="width:${pct(t.share.lost)};background:var(--home)"></i></div>
      <div class="chart"><div class="t"><span>People, thousands</span><span>${t.target ? `heading for ${int(t.target)}k` : ""}</span></div>${chartSvg([{ name: "People (k)", color: css("--ink-2"), values: pop }], { height: 90 })}</div>
      ${t.fuel !== null || t.cement !== null ? `<div class="tiles">${t.fuel !== null ? tile("Fuel supplied", pct(t.fuel)) : ""}${t.cement !== null ? tile("Cement supplied", pct(t.cement), t.cementHeld > 1 ? `${int(t.cementHeld)}k fewer people for it` : "") : ""}</div>` : ""}
      <h2>Your routes here · ${routesHere.length}</h2>
      <table><tbody>${routesHere.map((r) => `<tr class="row" data-select="route|${r.id}"><td><span class="swatch" style="background:var(${KIND_COLOR[r.kind] ?? "--you"})"></span>${esc(routeName(r))}</td><td>${int(r.ridersPerDay)}/day</td><td class="${r.netPerDay < 0 ? "down" : ""}">${naira(r.netPerDay)}</td></tr>`).join("") || `<tr><td class="muted">None</td></tr>`}</tbody></table>`;
  }
  if (sel.kind === "route") {
    const r = S.routes.find((x) => x.id === sel.id)!;
    const net = S.days.map((d) => d.routes.find((x) => x.id === r.id)?.netPerDay ?? 0);
    const first = S.days.findIndex((d) => d.routes.some((x) => x.id === r.id));
    return `<div class="kicker">${r.kind === "train" ? "Train" : r.kind === "brt" ? "BRT" : r.kind === "minibus" ? "Minibus" : "Bus"} route · ${r.verdict ?? ""}</div>
      <div class="head"><div class="title">${esc(routeName(r))}</div><div class="num ${r.netPerDay < 0 ? "down" : "up"}">${naira(r.netPerDay)}/day</div></div>
      ${problemHtml(routeProblem(r))}
      <div class="tiles">
        ${tile("Riders a day", int(r.ridersPerDay))}
        ${tile("How full", pct(r.loadFactor))}
        ${tile("Vehicles", String(r.vehicles))}
        ${tile("In / cost a day", `${nairaK(r.incomePerDay)} / ${nairaK(r.costPerDay)}`)}
      </div>
      <div class="chart"><div class="t"><span>Net a day</span><span>since day ${S.days[Math.max(0, first)]?.day ?? 1}</span></div>${chartSvg([{ name: "Net a day", color: css("--you"), values: net }], { height: 90, format: nairaK, from: Math.max(0, first), zeroLine: true })}</div>
      <h2>Stops</h2><div>${r.stops.map((s) => esc(nameOf(s))).join(" → ")}</div>`;
  }
  if (sel.kind === "site") {
    const t = townById.get(sel.id)!;
    const s = siteById.get(sel.id);
    const out = S.flows.filter((f) => f.from === sel.id);
    const inn = S.flows.filter((f) => f.to === sel.id);
    const problem = s && s.capacity > 0 && s.made < 0.6 * s.capacity ? { text: `Makes ${pct(s.made / s.capacity)} of what it could: held back by its ${s.limit}`, move: s.limit === "workers" ? "Run a bus for its workers" : s.limit === "input" ? "Bring it more input" : "Restore it" } : null;
    const flowRows = (fs: Flow[], other: (f: Flow) => string) => fs.map((f) => {
      const tot = Math.max(1, f.yours + f.hauliers + f.spoiled);
      return `<tr><td>${esc(f.cargo)} · ${esc(nameOf(other(f)))}</td><td>${int(f.perDay)} t</td><td style="width:90px"><div class="bar3"><i style="width:${pct(f.yours / tot)};background:var(--goods)"></i><i style="width:${pct(f.hauliers / tot)};background:var(--informal)"></i><i style="width:${pct(f.spoiled / tot)};background:var(--home)"></i></div></td></tr>`;
    }).join("");
    return `<div class="kicker">Site · ${esc(t.industry ?? "")}</div>
      <div class="head"><div class="title">${esc(t.name)}</div></div>
      ${problemHtml(problem)}
      <div class="tiles">
        ${tile("Makes a day", `${int(s?.made ?? 0)} t`, s?.product ?? "")}
        ${tile("Of capacity", s && s.capacity > 0 ? pct(s.made / s.capacity) : "—", `${int(s?.capacity ?? 0)} t/day`)}
        ${tile("Workers", s?.staffing !== null && s?.staffing !== undefined ? pct(s.staffing) : "—")}
        ${tile("Carried away", s?.shipped !== null && s?.shipped !== undefined ? pct(s.shipped) : "—")}
      </div>
      ${out.length ? `<h2>Out · yours / hauliers' / spoiling</h2><table><tbody>${flowRows(out, (f) => f.to)}</tbody></table>` : ""}
      ${inn.length ? `<h2>In</h2><table><tbody>${flowRows(inn, (f) => f.from)}</tbody></table>` : ""}`;
  }
  const s = S.segments.find((x) => x.id === sel.id)!;
  const corridor = S.corridors.find((c) => (c.a === s.a && c.b === s.b) || (c.a === s.b && c.b === s.a));
  return `<div class="kicker">${s.type === "rail" ? "Track" : `Road · ${s.surface}${s.busLane ? " · bus lane" : ""}`}</div>
    <div class="head"><div class="title">${esc(nameOf(s.a))} – ${esc(nameOf(s.b))}</div></div>
    ${problemHtml(s.speed < 0.7 ? { text: `Jammed: traffic at ${pct(s.speed)} of free speed`, move: s.surface === "dirt" ? "Pave it" : "A bus lane" } : s.condition < 0.5 ? { text: "Worn: vehicles pay more on it", move: "Keep it up" } : null)}
    <div class="tiles">
      ${tile("Traffic", pct(s.load), "of what it carries before it jams")}
      ${tile("Speed", pct(s.speed))}
      ${tile("Your riders along it", int(yoursOn.get(s.id) ?? 0))}
      ${tile("Condition", pct(s.condition))}
    </div>
    ${corridor ? `<h2>Who carries its trips${corridor.taken ? " · taken" : ""}</h2><div class="bar3"><i style="width:${pct(corridor.you)};background:var(--you)"></i><i style="width:${pct(corridor.informal)};background:var(--informal)"></i><i style="width:${pct(corridor.lost)};background:var(--home)"></i></div><div class="muted">you ${pct(corridor.you)} · informal ${pct(corridor.informal)} · stayed home ${pct(corridor.lost)}</div>` : ""}`;
}

// --- The log: what happened, kept ---------------------------------------------

interface LogEntry { day: number; text: string; tone: "good" | "bad" | ""; group: string; select: Selection }
const LOG: LogEntry[] = [];
for (const d of S.days) {
  for (const e of d.events ?? []) {
    const ab = () => `${nameOf(String(e.a))}–${nameOf(String(e.b))}`;
    const entry = ((): Omit<LogEntry, "day"> | null => {
      switch (e.kind) {
        case "strike-announced": return { text: `Strike called on ${ab()}`, tone: "bad", group: "trouble", select: null };
        case "strike": return { text: `Strike on ${ab()}: danfos stop, your lane blocked`, tone: "bad", group: "trouble", select: null };
        case "strike-over": return { text: `Strike over on ${ab()}${typeof e.cost === "number" ? `, cost ${naira(e.cost)}` : ""}`, tone: "", group: "trouble", select: null };
        case "industry-opened": return { text: `${String(e.name)} opened`, tone: "good", group: "sites", select: { kind: "site", id: String(e.townId) } };
        case "industry-closed": return { text: `${String(e.name)} closed (${String(e.reason)})`, tone: "bad", group: "sites", select: null };
        case "refinery-opened": return { text: `${String(e.name)} opened: a private refinery`, tone: "good", group: "sites", select: { kind: "site", id: String(e.townId) } };
        case "founded": return { text: `${String(e.name)} grew up on the road`, tone: "good", group: "growth", select: { kind: "town", id: String(e.townId) } };
        case "abandoned": return { text: `${String(e.name)} emptied out`, tone: "bad", group: "growth", select: null };
        case "milestone": return { text: `${String(e.name)} ${["grew by a quarter", "grew by half", "doubled", "tripled"][Number(e.index)] ?? "grew"}: ${int(Number(e.to))}k`, tone: "good", group: "growth", select: { kind: "town", id: String(e.townId) } };
        case "corridor-taken": return { text: `You took ${ab()} from the danfos`, tone: "good", group: "corridors", select: null };
        case "corridor-released": return { text: `The danfos took ${ab()} back`, tone: "bad", group: "corridors", select: null };
        case "swept": return Number(e.amount) >= 1 ? { text: `The treasury swept ${nairaK(Number(e.amount))}`, tone: "bad", group: "money", select: null } : null;
        default: return null;
      }
    })();
    if (entry) LOG.push({ day: d.day, ...entry });
  }
}

function renderLog(): void {
  const el = document.querySelector<HTMLElement>("#log")!;
  const groups: Array<[string, string]> = [["all", "All"], ["trouble", "Strikes"], ["sites", "Sites"], ["growth", "Growth"], ["corridors", "Corridors"], ["money", "Money"]];
  const shown = LOG.filter((e) => logFilter === "all" || e.group === logFilter).slice().reverse();
  el.innerHTML = `<h2>What happened</h2><div id="logfilter">${groups.map(([id, label]) => `<button data-log="${id}" class="${logFilter === id ? "on" : ""}">${label}</button>`).join("")}</div>
    ${shown.map((e, i) => `<div class="event ${e.tone}" data-i="${i}"><span class="day">${e.day}</span><span class="what">${esc(e.text)}</span></div>`).join("") || `<div class="muted">Nothing.</div>`}`;
  el.querySelectorAll<HTMLButtonElement>("[data-log]").forEach((b) => b.addEventListener("click", () => { logFilter = b.dataset.log!; renderLog(); }));
  el.querySelectorAll<HTMLElement>(".event").forEach((row) =>
    row.addEventListener("click", () => {
      const e = shown[Number(row.dataset.i)]!;
      if (e.select && townById.has(e.select.id)) select(e.select);
    }),
  );
}

// --- The revenue screen ----------------------------------------------------------

function openRevenue(open: boolean): void {
  document.querySelector("#revenue")!.classList.toggle("open", open);
  if (open) renderRevenue();
}

function renderRevenue(): void {
  const el = document.querySelector<HTMLElement>("#revenue")!;
  const from = range > 0 ? Math.max(0, S.days.length - range) : 0;
  const c = (v: string) => css(v);
  const income: Series[] = [
    { name: "Fares", color: c("--s1"), values: dailyBudget(["fares", "metro"]) },
    { name: "Tolls", color: c("--s2"), values: dailyBudget("tolls") },
    { name: "State allocation", color: c("--s3"), values: dailyBudget("allocation") },
    { name: "Goods, levies, exports", color: c("--s4"), values: dailyBudget(["goods", "levies", "loading", "exports"]) },
  ];
  // Running costs only: what the treasury takes isn't a cost of running anything, and its
  // year-end sweep (a lump) dwarfed every other line when it was stacked with them.
  const costs: Series[] = [
    { name: "Running", color: c("--s1"), values: dailyBudget("running") },
    { name: "Road upkeep", color: c("--s2"), values: dailyBudget(["upkeep", "enforcement"]) },
    { name: "Fuel above the pump", color: c("--s3"), values: dailyBudget("fuel") },
    { name: "Bonds and settlements", color: c("--s4"), values: dailyBudget(["bonds", "settlements"]) },
  ];
  const treasury: Series[] = [
    { name: "Treasury levy", color: c("--s1"), values: dailyBudget("remitted") },
    { name: "Swept at year end", color: c("--s2"), values: S.days.map((d, i) => (d.budget.swept ?? 0) - (i > 0 ? S.days[i - 1]!.budget.swept ?? 0 : 0)) },
  ];
  const last = (s: Series[]) => s.reduce((sum, x) => sum + (x.values[x.values.length - 1] ?? 0), 0);
  const key = (s: Series[]) => `<div class="keyrow">${s.map((x) => `<span><i style="background:${x.color}"></i>${esc(x.name)} ${nairaK(x.values[x.values.length - 1] ?? 0)}</span>`).join("")}</div>`;
  const rows = sortRows(S.routes, "revenue", { name: (r) => routeName(r), income: (r) => r.incomePerDay, cost: (r) => r.costPerDay, net: (r) => r.netPerDay, riders: (r) => r.ridersPerDay });
  const total = (k: string) => lastDay.budget[k] ?? 0;
  el.innerHTML = `
    <div class="top"><div class="title">Revenue · day ${lastDay.day}</div>
      <div class="ranges">${[[0, "All"], [60, "60 days"], [30, "30 days"]].map(([n, label]) => `<button data-range="${n}" class="${range === n ? "on" : ""}">${label}</button>`).join("")}<button id="close-revenue">Back to the map ✕</button></div></div>
    <div class="heroes">
      <div class="hero"><div class="k">Net a day</div><div class="v num ${lastDay.netPerDay < 0 ? "down" : "up"}">${naira(lastDay.netPerDay)}</div></div>
      <div class="hero"><div class="k">Income a day</div><div class="v num">${naira(last(income))}</div></div>
      <div class="hero"><div class="k">Costs a day</div><div class="v num">${naira(last(costs))}</div></div>
      <div class="hero"><div class="k">Money</div><div class="v num">${naira(lastDay.funds)}</div></div>
    </div>
    <div class="cards">
      <div class="card"><h3>Income a day, by source</h3><div class="sub">5-day average, stacked</div>${key(income)}${chartSvg(income, { height: 200, stacked: true, format: nairaK, from })}</div>
      <div class="card"><h3>Costs a day, by kind</h3><div class="sub">5-day average, stacked</div>${key(costs)}${chartSvg(costs, { height: 200, stacked: true, format: nairaK, from })}</div>
      <div class="card"><h3>What the treasury took</h3><div class="sub">Its levy a day (5-day average), and each year-end sweep on its day</div><div class="keyrow">${treasury.map((x) => `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join("")}</div>${chartSvg(treasury, { height: 160, format: nairaK, from })}</div>
      <div class="card"><h3>Net a day and money held</h3><div class="sub">Net a day</div>${chartSvg([{ name: "Net a day", color: c("--you"), values: S.days.map((d) => d.netPerDay) }], { height: 140, format: nairaK, from, zeroLine: true })}<div class="sub">Money held</div>${chartSvg([{ name: "Money", color: c("--ink-2"), values: S.days.map((d) => d.funds) }], { height: 110, format: nairaK, from })}</div>
      <div class="card"><h3>Where the money went, all game</h3><div class="sub">Totals since day 1</div>
        <table><tbody>
          ${[["Fares", "fares"], ["Tolls", "tolls"], ["State allocation", "allocation"], ["Park levies (agberos kept " + nairaK(total("agberos")) + ")", "levies"], ["Goods", "goods"], ["Export payments", "exports"]].map(([l, k]) => `<tr><td>${l}</td><td class="up">+${nairaK(total(k!))}</td></tr>`).join("")}
          ${[["Running costs", "running"], ["Road upkeep", "upkeep"], ["Treasury levy", "remitted"], ["Swept at year end", "swept"], ["Fuel above the pump price", "fuel"]].map(([l, k]) => `<tr><td>${l}</td><td class="down">−${nairaK(total(k!))}</td></tr>`).join("")}
        </tbody></table></div>
      <div class="card wide"><h3>Your routes</h3><div class="sub">Click a column to sort · today's figures a day</div>
        <table><thead><tr>${th("revenue", "name", "Route")}${th("revenue", "riders", "Riders/day")}${th("revenue", "income", "Income")}${th("revenue", "cost", "Cost")}${th("revenue", "net", "Net")}</tr></thead><tbody>
        ${rows.map((r) => `<tr><td><span class="swatch" style="background:var(${KIND_COLOR[r.kind] ?? "--you"})"></span>${esc(routeName(r))}</td><td>${int(r.ridersPerDay)}</td><td>${naira(r.incomePerDay)}</td><td>${naira(r.costPerDay)}</td><td class="${r.netPerDay < 0 ? "down" : "up"}">${naira(r.netPerDay)}</td></tr>`).join("")}
        </tbody></table></div>
    </div>`;
  el.querySelector("#close-revenue")!.addEventListener("click", () => openRevenue(false));
  el.querySelectorAll<HTMLButtonElement>("[data-range]").forEach((b) => b.addEventListener("click", () => { range = Number(b.dataset.range); renderRevenue(); }));
  el.querySelectorAll<HTMLElement>("[data-sort]").forEach((b) =>
    b.addEventListener("click", () => {
      const [, k] = b.dataset.sort!.split(":") as [string, string];
      const s = sorts.revenue!;
      sorts.revenue = s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: -1 };
      renderRevenue();
    }),
  );
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (document.querySelector("#sheet")!.classList.contains("open")) openSheet(false);
    else if (document.querySelector("#revenue")!.classList.contains("open")) openRevenue(false);
    else select(null);
  }
});

renderStrip();
renderOverlays();
renderLegend();
renderLog();
renderPanel();
window.addEventListener("resize", resize);
resize();
renderZoom();
// Vehicles move: redraw every frame while they're on (the terrain is one cached image).
function frame(now: number): void {
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  motion += dt * gameSpeed;
  if (vehiclesOn) draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
