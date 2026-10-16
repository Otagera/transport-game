import { Accumulator, SIM_DT } from "@engine/loop";
import { lastDay } from "@engine/slice/ledger";
import { sliceTick } from "@engine/slice/tick";
import {
  addBus,
  buildRoad,
  checkBus,
  checkPave,
  checkRoad,
  createSliceWorld,
  debtAdvice,
  demandAlong,
  diagnoseRoute,
  chainOf,
  findRoute,
  roadChain,
  routeKey,
  dirtRoadsOn,
  wornRoadsOn,
  isCutOff,
  localTravel,
  networkShare,
  pairDemand,
  paveRoad,
  removeBus,
  paveCost,
  roadCost,
  roadPath,
  routeSummaries,
  throughRoute,
  townShare,
  tripsFrom,
} from "@engine/slice/world";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import { planRoad, segmentPolyline, type Alignment, type RoadPlan } from "@engine/slice/roads";
import { setRoadMaintained, upkeepPerDay, wearSpeed } from "@engine/slice/wear";
import { createReceiptBook, perform, tickReceipts, RECEIPT_SECONDS, type Receipt, type ReceiptSpec } from "@engine/slice/receipts";
import type { SliceWorld } from "@engine/slice/types";
import { growthTrend, townGrowth } from "@engine/slice/growth";
import { addTrain, buildTrack, checkTrack, checkTrain, isRailRoute, planRail, railPath, railRouteId, restoreCost, trackAction } from "@engine/slice/rail";
import { addFreightTrain, checkFreight, findLorryRoute, freightRouteId, isFreightRoute, lorryRouteId } from "@engine/slice/goods";
import { addLorry, checkLorry, diagnoseLorryRoute, goodsAlong, isLorryRoute, lorrySummaries, removeLorry, townGoods, type LorryDiagnosis } from "@engine/slice/goods";
import type { RouteDiagnosis } from "@engine/slice/world";
import type { SliceEvent } from "@engine/slice/settlement";
import { SLICE_MAP } from "./map";
import { draw, fitView, routeColor, toScreen, townRadius, type Ghost, type View } from "./render";

// The slice's bootstrap (docs/principles.md §6, step 1). Two tools, one
// list, one strip:
//   R  road tool -- click a town, then another: build a straight road, or
//      pave the dirt road already joining them.
//   B  bus tool  -- click a town, then another: buy a bus running between them.
//   L  lorry tool -- click a town, then another: buy a lorry running goods between them.
//   K  track tool -- click a town, then another: restore the old line there, or lay new track.
//   T  train tool -- click a town, then another joined by track: buy a train between them.
//   G  freight tool -- click a town, then another joined by track: buy a freight train between them.
//   F  fix tool  -- click a road: start (or stop) maintaining it.
//   Space pause, 1/2/3 speed, Esc cancel.

type Tool = "road" | "bus" | "lorry" | "track" | "train" | "freight" | "fix";

const world = createSliceWorld(SLICE_MAP);
const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
const ctx = canvas.getContext("2d")!;
const strip = document.querySelector<HTMLDivElement>("#strip")!;
const routesEl = document.querySelector<HTMLDivElement>("#routes")!;
const toolbar = document.querySelector<HTMLDivElement>("#toolbar")!;
const toast = document.querySelector<HTMLDivElement>("#toast")!;

let tool: Tool = "bus";
// Road and Track tools: bend round the terrain where it's cheaper, or hold the straight line and pay (A).
let alignment: Alignment = "cheapest";
let selectedTown: string | null = null;
let hoverTown: string | null = null;
let mouse: { x: number; y: number } | null = null;
let speed = 1;
let paused = false;
let view: View = { scale: 1, offsetX: 0, offsetY: 0 };

const naira = (n: number) => `${n < 0 ? "−" : ""}₦${Math.abs(Math.round(n)).toLocaleString()}`;
const townName = (id: string) => world.towns.get(id)?.name ?? world.ruins.get(id)?.name ?? id;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  const sidePanel = window.innerWidth > 900 ? 300 : 0;
  // Keep the map clear of the strip above and of whatever sits below it --
  // the toolbar, and the key when it's open -- measured, not guessed: a
  // fixed inset left the open key over the map's corner (playtest).
  // (getClientRects, not offsetParent: both are position: fixed, whose offsetParent is always null.)
  const below = (el: HTMLElement | null) => (el && el.getClientRects().length > 0 ? window.innerHeight - el.getBoundingClientRect().top : 0);
  // On a window too narrow for the open key beside the toolbar, the key sits above it.
  const keyEl = document.querySelector<HTMLElement>("#key");
  if (keyEl) {
    keyEl.style.bottom = "";
    if (toolbar && keyEl.getClientRects().length > 0 && keyEl.getBoundingClientRect().right > toolbar.getBoundingClientRect().left - 8) {
      keyEl.style.bottom = `${below(toolbar) + 8}px`;
    }
  }
  const bottomInset = Math.max(56, below(toolbar), below(keyEl)) + 8;
  view = fitView(world, window.innerWidth - sidePanel, window.innerHeight, 24, 64, bottomInset);
}
window.addEventListener("resize", resize);

// The key opens only when there's room beside the toolbar (ten tools); on a
// narrower window it starts closed, one click away, instead of covering the map.
const key = document.querySelector<HTMLDetailsElement>("#key");
if (key) {
  key.open = window.innerWidth >= 1560;
  key.addEventListener("toggle", resize); // opening it takes room from the map
}
resize();

// Every action goes through the receipt book: it happens now, and two days
// later a receipt says exactly what it did (receipts.ts).
const book = createReceiptBook();

/** Does an action and starts measuring it. The result is the real world's. */
function act<T extends { ok: boolean }>(spec: ReceiptSpec, run: (w: SliceWorld) => T): T {
  let result: T | undefined;
  perform(world, book, (w) => {
    const r = run(w);
    if (w === world) result = r;
    return r.ok;
  }, spec);
  return result!;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const pair = (a: string, b: string) => `${townName(a)} ↔ ${townName(b)}`;

/** "a 3rd bus on Ilase ↔ Owode", or "a new bus route Ilase ↔ Owode". */
function addLabel(vehicle: string, count: number, a: string, b: string): string {
  return count <= 1 ? `a new ${vehicle} route ${pair(a, b)}` : `a ${ordinal(count)} ${vehicle} on ${pair(a, b)}`;
}

let toastTimer = 0;
function say(message: string, bad = false, seconds = 2.6): void {
  toast.textContent = message;
  toast.dataset.bad = String(bad);
  toast.style.opacity = "1";
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.style.opacity = "0"), seconds * 1000);
}

function announce(event: SliceEvent): void {
  if (event.kind === "founded") {
    say(`${event.name} has grown on the ${townName(event.between[0])}–${townName(event.between[1])} road. Your buses there stop at it.`, false, 6);
  } else {
    say(`${event.name} has emptied out: not enough traffic passes any more.`, true, 6);
  }
}

function townAt(x: number, y: number): string | null {
  for (const town of world.towns.values()) {
    const p = toScreen(view, town.x, town.y);
    if (Math.hypot(p.x - x, p.y - y) <= townRadius(town, view) + 8) return town.id;
  }
  return null;
}

/** The road under the cursor (screen px), for the fix tool: nearest within a few pixels. */
function roadAt(x: number, y: number): string | null {
  let best: { id: string; d: number } | null = null;
  for (const segment of world.simulation.map.segments) {
    if (world.railOutOfService.has(segment.id)) continue; // disused track: restore it first (K)
    const line = segmentPolyline(world.simulation.map, segment).map((p) => toScreen(view, p.x, p.y));
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1]!;
      const b = line[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
      if (d <= 10 && (!best || d < best.d)) best = { id: segment.id, d };
    }
  }
  return best?.id ?? null;
}

/** "Track Ilase – Ipaja" opens a label; mid-sentence it's "track Ilase – Ipaja". */
function midSentence(name: string): string {
  return name.startsWith("Track ") ? `t${name.slice(1)}` : name;
}

// A road is named by its end towns even where roadside towns have split it
// into pieces: the player thinks of "the Owode-Ado road" (lever audit).
function roadName(segmentId: string): string {
  const segment = world.simulation.map.segments.find((s) => s.id === segmentId)!;
  const whole = segment.type === "road" ? chainOf(world, segmentId) : null;
  const [a, b] = whole ? [whole.a, whole.b] : [segment.fromNodeId, segment.toNodeId];
  return `${segment.type === "rail" ? "Track " : ""}${townName(a)} – ${townName(b)}`;
}

/** Every piece of the road a segment belongs to (just itself for track). */
function roadPieces(segmentId: string) {
  return chainOf(world, segmentId)?.pieces ?? world.simulation.map.segments.filter((s) => s.id === segmentId);
}

function setTool(next: Tool): void {
  tool = next;
  selectedTown = null;
  renderToolbar();
}

canvas.addEventListener("mousemove", (event) => {
  mouse = { x: event.clientX, y: event.clientY };
  const next = townAt(event.clientX, event.clientY);
  canvas.style.cursor = next || (tool === "fix" && roadAt(event.clientX, event.clientY)) ? "pointer" : "default";
  if (next !== hoverTown) {
    hoverTown = next;
    renderPanel();
  }
});

canvas.addEventListener("mouseleave", () => {
  mouse = null;
  hoverTown = null;
  renderPanel();
});

/** Hovered town wins, so you can look around while a town is selected. */
function focusTown(): string | null {
  return hoverTown ?? selectedTown;
}

canvas.addEventListener("click", (event) => {
  if (tool === "fix") {
    const road = roadAt(event.clientX, event.clientY);
    if (!road) return;
    const on = !world.maintained.has(road);
    const name = midSentence(roadName(road));
    const pieces = roadPieces(road);
    const ends = chainOf(world, road);
    const towns = ends ? [ends.a, ends.b] : [pieces[0]!.fromNodeId, pieces[0]!.toNodeId];
    const result = act({ label: on ? `maintaining ${name}` : `letting ${name} wear`, towns }, (w) => setRoadMaintained(w, road, on));
    if (!result.ok) say(`Can't maintain: ${result.reason}`, true);
    else if (on) {
      const upkeep = pieces.reduce((sum, piece) => sum + upkeepPerDay(world, piece), 0);
      say(`Maintaining ${name}: repaired for ${naira(result.charged)}, about ${naira(upkeep)}/day to keep at this traffic. Result in two days.`);
    } else say(`Stopped maintaining ${name}: it will wear again`);
    renderPanel();
    return;
  }
  const town = townAt(event.clientX, event.clientY);
  if (!town) {
    selectedTown = null;
    return;
  }
  if (!selectedTown || selectedTown === town) {
    selectedTown = selectedTown === town ? null : town;
    return;
  }
  const from = selectedTown;
  const towns = [from, town];
  const later = " Result in two days.";
  if (tool === "road" && roadChain(world, from, town)) {
    const cost = paveCost(world, from, town);
    const result = act({ label: `paving ${townName(from)} – ${townName(town)}`, towns }, (w) => paveRoad(w, from, town));
    if (result.ok) say(`Paved ${townName(from)} – ${townName(town)} for ${naira(cost)}: it now carries ${paveGain()}× the traffic.${later}`);
    else say(`Can't pave: ${result.reason}`, true);
  } else if (tool === "road") {
    const cost = roadCost(world, from, town, alignment);
    const result = act({ label: `the ${townName(from)} – ${townName(town)} road`, towns }, (w) => buildRoad(w, from, town, alignment));
    if (result.ok) say(`Built road ${townName(from)} – ${townName(town)} for ${naira(cost)}.${later}`);
    else say(`Can't build: ${result.reason}`, true);
  } else if (tool === "track") {
    const restoring = trackAction(world, from, town) === "restore";
    const cost = restoring ? restoreCost(world, from, town) : (planRail(world, from, town, alignment)?.cost ?? 0);
    const label = restoring ? `restoring the old line ${townName(from)} – ${townName(town)}` : `track ${townName(from)} – ${townName(town)}`;
    const result = act({ label, towns }, (w) => buildTrack(w, from, town, alignment));
    if (result.ok) say(restoring ? `Restored the old line ${townName(from)} – ${townName(town)} for ${naira(cost)}: trains can run on it` : `Laid track ${townName(from)} – ${townName(town)} for ${naira(cost)}`);
    else say(`Can't lay track: ${result.reason}`, true);
  } else if (tool === "freight") {
    const count = (world.lorryRoutes.find((r) => r.id === freightRouteId(from, town))?.vehicleIds.length ?? 0) + 1;
    const result = act({ label: addLabel("freight train", count, from, town), towns, routeId: freightRouteId(from, town) }, (w) => addFreightTrain(w, from, town));
    if (result.ok) say(`Freight train added: ${pair(from, town)}.${later}`);
    else say(`Can't add freight train (${naira(world.tuning.freightPurchaseCost)}): ${result.reason}`, true);
  } else if (tool === "train") {
    const count = (world.routes.find((r) => r.id === railRouteId(from, town))?.vehicleIds.length ?? 0) + 1;
    const result = act({ label: addLabel("train", count, from, town), towns, routeId: railRouteId(from, town) }, (w) => addTrain(w, from, town));
    if (result.ok) say(`Train added: ${pair(from, town)}.${later}`);
    else say(`Can't add train (${naira(world.tuning.trainPurchaseCost)}): ${result.reason}`, true);
  } else if (tool === "lorry") {
    const route = findLorryRoute(world, from, town);
    const result = act({ label: addLabel("lorry", (route?.vehicleIds.length ?? 0) + 1, from, town), towns, routeId: route?.id ?? lorryRouteId(from, town) }, (w) => addLorry(w, from, town));
    if (result.ok) say(`Lorry added: ${pair(from, town)}.${later}`);
    else say(`Can't add lorry (${naira(world.tuning.lorryPurchaseCost)}): ${result.reason}`, true);
  } else {
    const count = (findRoute(world, from, town)?.vehicleIds.length ?? 0) + 1;
    const result = act({ label: addLabel("bus", count, from, town), towns, routeId: routeKey(from, town) }, (w) => addBus(w, from, town));
    if (result.ok) say(`Bus added: ${pair(from, town)}.${later}`);
    else say(`Can't add bus (${naira(world.tuning.busPurchaseCost)}): ${result.reason}`, true);
  }
  // Shift keeps the first town selected: fanning roads or routes out of
  // one hub is the common case.
  selectedTown = event.shiftKey ? from : null;
  renderPanel();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "r" || event.key === "R") setTool("road");
  else if (event.key === "b" || event.key === "B") setTool("bus");
  else if (event.key === "f" || event.key === "F") setTool("fix");
  else if (event.key === "l" || event.key === "L") setTool("lorry");
  else if (event.key === "k" || event.key === "K") setTool("track");
  else if (event.key === "t" || event.key === "T") setTool("train");
  else if (event.key === "g" || event.key === "G") setTool("freight");
  else if (event.key === "a" || event.key === "A") {
    alignment = alignment === "cheapest" ? "direct" : "cheapest";
    renderToolbar();
  }
  else if (event.key === "Escape") selectedTown = null;
  else if (event.key === " ") {
    paused = !paused;
    event.preventDefault();
    renderToolbar();
  } else if (event.key === "1" || event.key === "2" || event.key === "3") {
    speed = [1, 2, 4][Number(event.key) - 1]!;
    paused = false;
    renderToolbar();
  }
});

// The fix tool's preview: the road under the cursor, how worn it is, and
// what keeping it up would cost -- or what it's costing now.
function roadHover(): { segmentId: string; at: { x: number; y: number }; label: string } | null {
  if (tool !== "fix" || !mouse) return null;
  const id = roadAt(mouse.x, mouse.y);
  if (!id) return null;
  // The whole road, through any roadside towns: its worst piece, its total upkeep.
  const pieces = roadPieces(id);
  const worst = pieces.reduce((low, piece) => (piece.condition < low.condition ? piece : low), pieces[0]!);
  const state = `${pct(worst.condition)} condition${pieces.length > 1 ? " at worst" : ""}, ${worst.type === "rail" ? "trains" : "traffic"} at ${pct(wearSpeed(world, worst))} speed`;
  const upkeep = naira(pieces.reduce((sum, piece) => sum + upkeepPerDay(world, piece), 0));
  const label = world.maintained.has(id)
    ? `${roadName(id)} · maintained, ${upkeep}/day · click to stop`
    : `${roadName(id)} · ${state} · maintain for ~${upkeep}/day`;
  return { segmentId: id, at: mouse, label };
}

// The other alignment, when it's a different road: the choice made legible
// (principles §1: round, or over -- say what each costs).
function otherWay(plan: RoadPlan, other: RoadPlan | null): string {
  if (!other || Math.abs(other.cost - plan.cost) < 1) return "";
  if (alignment === "direct") {
    const longer = other.length / plan.length - 1;
    return ` · round it ${naira(other.cost)}${longer >= 0.05 ? `, ${pct(longer)} longer` : ""} (A)`;
  }
  return ` · straight ${naira(other.cost)}, ${pct(1 - other.length / plan.length)} shorter (A)`;
}

// What a road's price is made of (principles §1: a quote must say *why*,
// not just be a bigger number) and how much longer the trip is than the
// straight line, when it bends round the terrain.
function roadWhy(plan: NonNullable<ReturnType<typeof planRoad>>, a: string, b: string): string {
  const parts: string[] = [];
  if (plan.bridgeCells > 0) parts.push(`bridge ${plan.bridgeCells} cells ${naira(plan.bridgeCost)}`);
  if (plan.hillsCost >= 20) parts.push(`hills ${naira(plan.hillsCost)}`);
  const ta = world.towns.get(a)!;
  const tb = world.towns.get(b)!;
  const longer = plan.length / Math.hypot(ta.x - tb.x, ta.y - tb.y) - 1;
  if (longer >= 0.08) parts.push(`bends round: ${pct(longer)} longer trip`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** How much more traffic a paved road carries than dirt, e.g. "1.7". */
function paveGain(): string {
  return (1 / world.tuning.dirtRoadCapacity).toFixed(1);
}

function ghost(): Ghost | null {
  if (!selectedTown || !mouse) return null;
  const to = hoverTown && hoverTown !== selectedTown ? hoverTown : null;
  const end = to ? toScreen(view, world.towns.get(to)!.x, world.towns.get(to)!.y) : mouse;
  if (!to) return { from: selectedTown, to: end, ok: true, label: "" };
  // The trip's demand rides along on every preview: what you'd be building for.
  const riders = `${Math.round(pairDemand(world, selectedTown, to) * SECONDS_PER_GAME_DAY)} riders/day want this trip`;
  if (tool === "road" && roadChain(world, selectedTown, to)) {
    const check = checkPave(world, selectedTown, to);
    const cost = naira(paveCost(world, selectedTown, to));
    return { from: selectedTown, to: end, ok: check.ok, label: check.ok ? `Pave ${cost} · carries ${paveGain()}× the traffic` : `${cost} · ${check.reason}` };
  }
  if (tool === "road") {
    const check = checkRoad(world, selectedTown, to, alignment);
    const plan = planRoad(world, selectedTown, to, alignment);
    if (!plan) return { from: selectedTown, to: end, ok: false, label: check.ok ? "" : check.reason };
    const other = planRoad(world, selectedTown, to, alignment === "direct" ? "cheapest" : "direct");
    const label = `${alignment === "direct" ? "Direct road" : "Road"} ${naira(plan.cost)}${roadWhy(plan, selectedTown, to)}${otherWay(plan, other)} · ${riders}`;
    return { from: selectedTown, to: end, ok: check.ok, line: plan.polyline, label: check.ok ? label : `${naira(plan.cost)} · ${check.reason}` };
  }
  if (tool === "track") {
    const check = checkTrack(world, selectedTown, to, alignment);
    if (trackAction(world, selectedTown, to) === "restore") {
      const label = `Restore the old line ${naira(restoreCost(world, selectedTown, to))} · built for export: it stops nowhere between`;
      return { from: selectedTown, to: end, ok: check.ok, label: check.ok ? label : check.reason };
    }
    const plan = planRail(world, selectedTown, to, alignment);
    if (!plan) return { from: selectedTown, to: end, ok: false, label: check.ok ? "" : check.reason };
    const other = planRail(world, selectedTown, to, alignment === "direct" ? "cheapest" : "direct");
    const label = `${alignment === "direct" ? "Direct track" : "Track"} ${naira(plan.cost)}${roadWhy(plan, selectedTown, to)}${otherWay(plan, other)} · ${riders}`;
    return { from: selectedTown, to: end, ok: check.ok, line: plan.polyline, label: check.ok ? label : `${naira(plan.cost)} · ${check.reason}` };
  }
  if (tool === "train") {
    const check = checkTrain(world, selectedTown, to);
    const path = railPath(world, selectedTown, to)?.nodeIds;
    const along = path ? `${Math.round(demandAlong(world, selectedTown, to, path) * SECONDS_PER_GAME_DAY)} riders/day want trips along it` : "";
    const label = `Train ${naira(world.tuning.trainPurchaseCost)} · ${along}`;
    return { from: selectedTown, to: end, ok: check.ok, path: shownPath(check, path), rail: true, label: refusedOr(check, label, `Train ${naira(world.tuning.trainPurchaseCost)}`) };
  }
  if (tool === "freight") {
    const check = checkFreight(world, selectedTown, to);
    const goods = goodsAlong(world, selectedTown, to, true);
    const label = `Freight train ${naira(world.tuning.freightPurchaseCost)} · goods along the track: ${Math.round(goods.outbound)} t/day out, ${Math.round(goods.inbound)} back`;
    const path = shownPath(check, railPath(world, selectedTown, to)?.nodeIds);
    return { from: selectedTown, to: end, ok: check.ok, path, rail: true, label: refusedOr(check, label, `Freight train ${naira(world.tuning.freightPurchaseCost)}`) };
  }
  if (tool === "lorry") {
    const check = checkLorry(world, selectedTown, to);
    // Both ways, because that's the decision: a lorry runs full only where goods go each way.
    const goods = goodsAlong(world, selectedTown, to);
    const label = `Lorry ${naira(world.tuning.lorryPurchaseCost)} · goods along it: ${Math.round(goods.outbound)} t/day out, ${Math.round(goods.inbound)} back`;
    const path = shownPath(check, roadPath(world, selectedTown, to)?.nodeIds);
    return { from: selectedTown, to: end, ok: check.ok, path, label: refusedOr(check, label, `Lorry ${naira(world.tuning.lorryPurchaseCost)}`) };
  }
  const check = checkBus(world, selectedTown, to);
  const price = naira(world.tuning.busPurchaseCost);
  // Every trip along its road, not just the two towns clicked: a bus from
  // Ilase to Ikole carries Ilase-Kuto and Kuto-Ikole riders too.
  const along = `${Math.round(demandAlong(world, selectedTown, to) * SECONDS_PER_GAME_DAY)} riders/day want trips along it`;
  // Drawn along the road it would take, not straight across: a bus to Ikole
  // from Ilase goes through Kuto.
  const path = shownPath(check, roadPath(world, selectedTown, to)?.nodeIds);
  return { from: selectedTown, to: end, ok: check.ok, path, label: refusedOr(check, `Bus ${price} · ${along}`, `Bus ${price}`) };
}

// A refusal never hides the price (playtest: "I can't see the price for
// train, it just says I can't afford it"). Short of money, the whole
// preview stays -- route, riders, price -- with what you have; any other
// refusal keeps the price and says why.
function refusedOr(check: { ok: boolean; reason?: string }, label: string, priced: string): string {
  if (check.ok) return label;
  const reason = (check as { reason: string }).reason;
  if (reason.startsWith("can't afford")) return `${label} · can't afford it yet (you have ${naira(world.economy.funds)})`;
  return `${priced} · ${reason}`;
}

/** The route to draw: shown whenever the vehicle could run it, even if you can't pay for it yet. */
function shownPath(check: { ok: boolean; reason?: string }, path: string[] | undefined): string[] | undefined {
  return check.ok || (check as { reason?: string }).reason?.startsWith("can't afford") ? path : undefined;
}

// --- DOM panels -------------------------------------------------------

function renderToolbar(): void {
  const button = (label: string, key: string, active: boolean, onClick: () => void) => {
    const el = document.createElement("button");
    el.innerHTML = `${label} <kbd>${key}</kbd>`;
    el.className = active ? "active" : "";
    el.onclick = onClick;
    return el;
  };
  // Grouped by what each is for (playtest: "bus and lorry are for road,
  // freight and train for rail; road and rail are infrastructure; fix and
  // the cheapest toggle are their own thing") -- a caption over each group,
  // road vehicles on the road's tan, rail vehicles on the track's dark.
  const group = (caption: string, kind: string, ...children: HTMLElement[]) => {
    const el = document.createElement("div");
    el.className = `group ${kind}`;
    const cap = document.createElement("span");
    cap.className = "cap";
    cap.textContent = caption;
    const row = document.createElement("div");
    row.className = "row";
    row.append(...children);
    el.append(cap, row);
    return el;
  };
  // The line is a setting for the two build tools, not a tool: a switch.
  const lineSwitch = document.createElement("div");
  lineSwitch.className = "switch";
  for (const [value, label] of [["cheapest", "Cheapest"], ["direct", "Straight"]] as const) {
    const el = document.createElement("button");
    el.textContent = label;
    el.className = alignment === value ? "on" : "";
    el.onclick = () => {
      alignment = value;
      renderToolbar();
    };
    lineSwitch.append(el);
  }
  lineSwitch.append(Object.assign(document.createElement("kbd"), { textContent: "A" }));
  toolbar.replaceChildren(
    group("On roads", "road", button("Bus", "B", tool === "bus", () => setTool("bus")), button("Lorry", "L", tool === "lorry", () => setTool("lorry"))),
    group("On rail", "rail", button("Train", "T", tool === "train", () => setTool("train")), button("Freight", "G", tool === "freight", () => setTool("freight"))),
    group("Build", "build", button("Road", "R", tool === "road", () => setTool("road")), button("Track", "K", tool === "track", () => setTool("track"))),
    group("Line (road, track)", "setting", lineSwitch),
    group("Upkeep", "setting", button("Fix", "F", tool === "fix", () => setTool("fix"))),
    group(
      "Time",
      "time",
      button(paused ? "Paused" : "Pause", "Space", paused, () => {
        paused = !paused;
        renderToolbar();
      }),
      ...[1, 2, 4].map((s, i) =>
        button(`${s}×`, String(i + 1), !paused && speed === s, () => {
          speed = s;
          paused = false;
          renderToolbar();
        }),
      ),
    ),
  );
}

function renderStrip(): void {
  const burn = { netPerDay: lastDay(world.ledger).net };
  const share = networkShare(world);
  const day = Math.floor(world.economy.elapsedSeconds / 30) + 1;
  strip.innerHTML = `
    <div class="stat"><span class="k">Day</span><span class="v">${day}</span></div>
    <div class="stat"><span class="k">Funds</span><span class="v ${world.economy.funds < 0 ? "bad" : ""}">${naira(world.economy.funds)}</span></div>
    <div class="stat"><span class="k" title="Fares minus running costs over the last game day">Net, last day</span><span class="v ${burn.netPerDay < 0 ? "bad" : "good"}">${naira(burn.netPerDay)}</span></div>
    <div class="stat share">
      <span class="k">Trips between towns: who carried them</span>
      <div class="bar">
        <i style="width:${pct(share.player)};background:var(--player)"></i>
        <i style="width:${pct(share.informal)};background:var(--danfo)"></i>
        <i style="width:${pct(share.lost)};background:var(--home)"></i>
      </div>
      <span class="legend"><b style="color:var(--player)">You ${pct(share.player)}</b> · <b class="danfo-text">Informal ${pct(share.informal)}</b> · <b style="color:var(--home-text)">Stayed home ${pct(share.lost)}</b></span>
    </div>
    <div class="stat"><span class="k">Informal sector earned</span><span class="v">${naira(world.informal.earnings)}</span></div>
  `;
}

// The panel shows the focused town's trips when there is one, otherwise
// your routes -- one home at a time, not both stacked.
function renderPanel(): void {
  const town = focusTown();
  if (town) renderTown(town);
  else renderRoutes();
}

function changingText(townId: string): string {
  const perDay = Math.round((world.transferRateEMA.get(townId) ?? 0) * SECONDS_PER_GAME_DAY);
  return perDay > 0 ? ` <b>${perDay} riders/day change buses here.</b>` : "";
}

// Says outright when a town's trips have no road -- the wish-lines alone
// were read as "nowhere to go" (playtest, day 17).
function reachNote(townId: string): string {
  const trips = tripsFrom(world, townId);
  const stranded = trips.filter((trip) => !trip.reachable);
  if (stranded.length === 0) return "";
  const perDay = (n: number) => Math.round(n * SECONDS_PER_GAME_DAY);
  const biggest = stranded[0]!;
  if (isCutOff(world, townId)) {
    const total = perDay(stranded.reduce((sum, trip) => sum + trip.demand, 0));
    return `<p class="callout">No road reaches ${townName(townId)}. Its people want to make ${total} trips a day and every one stays home. Build a road (<kbd>R</kbd>): the biggest trip is to ${townName(biggest.to)}, ${perDay(biggest.demand)}/day.</p>`;
  }
  return `<p class="callout">${stranded.length} of ${townName(townId)}'s trips have no road at all (dashed lines). The biggest is to ${townName(biggest.to)}, ${perDay(biggest.demand)}/day.</p>`;
}

// Why a town is growing or not, in the terms that move it: your share, the
// informal share at half, and the floor your share has to clear.
function growthText(townId: string, name: string): string {
  const growth = townGrowth(world, townId);
  if (!growth) return "";
  const town = world.towns.get(townId)!;
  const k = (n: number) => `${Math.round(n)}k`;
  const trend = growthTrend(world, townId);
  const heading = trend === "growing" ? `growing toward ${k(growth.target)}` : trend === "shrinking" ? `shrinking toward ${k(growth.target)}` : `steady at ${k(town.population)}`;
  const min = world.tuning.growthMinPlayerShare;
  const why = isCutOff(world, townId)
    ? "No road reaches it, so nothing can grow it."
    : growth.playerShare < min
    ? `It only grows once you carry at least ${pct(min)} of its trips (now ${pct(growth.playerShare)}); danfos alone keep it as it is.`
    : `Service ${pct(growth.service)} (yours ${pct(growth.playerShare)}, plus informal at half). The better served, the bigger: up to ${k(growth.cap)}.`;
  return `<p class="townshare"><b>${name} is ${heading}.</b> ${why}</p>`;
}

// Inside the town: informal's own ground, said as such so a permanent
// informal share doesn't read as failure (principles.md §5). Kept out of
// every share bar and all money.
function insideText(townId: string, name: string): string {
  const local = localTravel(world, townId);
  const feeder = Math.round(local.feederPerDay);
  const reach = feeder > 0
    ? `They also carry ~${feeder} of your riders a day to and from your buses (${pct(local.firstMileShare)} of them here).`
    : `Once you run buses here, about ${pct(local.firstMileShare)} of your riders will reach them by keke or okada.`;
  return `<p class="inside"><b>Inside ${name}:</b> ~${Math.round(local.tripsPerDay).toLocaleString()} short trips a day, all by keke and okada. Nothing you run reaches that finely, and it isn't counted against you. ${reach}</p>`;
}

function renderTown(townId: string): void {
  const town = world.towns.get(townId)!;
  const share = townShare(world, townId);
  const rows = tripsFrom(world, townId)
    .map((trip) => {
      const s = trip.share;
      const bar = s.player + s.informal + s.lost > 0
        ? `<i style="width:${pct(s.player)};background:var(--player)"></i><i style="width:${pct(s.informal)};background:var(--danfo)"></i><i style="width:${pct(s.lost)};background:var(--home)"></i>`
        : "";
      return `
        <div class="trip">
          <span class="name">${townName(trip.to)}</span>
          <span class="num">${Math.round(trip.demand * SECONDS_PER_GAME_DAY)}/day</span>
          <div class="bar">${bar}</div>
        </div>`;
    })
    .join("");
  routesEl.innerHTML = `
    ${reachNote(townId)}
    <h2>${town.name} <span class="muted">· ${Math.round(town.population)}k people${world.settlement.emergent.has(townId) ? " · grew on the road" : ""}</span></h2>
    <p class="hint">Trips to and from ${town.name}, both directions, biggest first. Bar: <b style="color:var(--player)">you</b> · <b class="danfo-text">informal</b> · <b style="color:var(--home-text)">stayed home</b>.</p>
    <p class="townshare">Of everyone leaving ${town.name} for another town: you ${pct(share.player)}, informal ${pct(share.informal)}, stayed home ${pct(share.lost)}.${changingText(townId)}</p>
    ${growthText(townId, town.name)}
    ${goodsText(townId)}
    ${insideText(townId, town.name)}
    ${rows}`;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

// A train route's reasons are a bus route's with the vehicle renamed: the
// diagnosis is the same passenger model (rail.ts), only the vehicle differs.
function forVehicle(text: string, routeId: string): string {
  if (!isRailRoute(routeId)) return text;
  return text.replace(/\bBuses\b/g, "Trains").replace(/\bbuses\b/g, "trains").replace(/\bbus\b/g, "train");
}

// One sentence: the biggest reason this route earns what it does, and the
// lever that would change it. The engine picks the verdict; this says it.
// A thin shuttle that would carry far more run on to the next town says
// so first (playtest, day 14: the Ikole bridge got a Kuto shuttle).
function throughText(routeId: string): string {
  const through = throughRoute(world, routeId);
  if (!through) return "";
  const via = through.via.length > 0 ? ` (via ${through.via.map(townName).join(", ")})` : "";
  return `<b>Run it through:</b> a bus ${townName(through.a)} ↔ ${townName(through.b)}${via} reaches ${naira(through.reachPerDay)}/day of trips, against ${naira(through.currentReachPerDay)} on this one. Sell this bus (−) and buy that one (Bus tool). `;
}

function reasonText(d: RouteDiagnosis, buses: number, costPerDay: number, netPerDay: number): string {
  const dirt = dirtRoadsOn(world, d.routeId);
  switch (d.verdict) {
    case "thin":
      return `${throughText(d.routeId)}Thin: only ${Math.round(d.demand * SECONDS_PER_GAME_DAY)} riders/day want these trips. Carrying every one would earn ${naira(d.ceilingPerDay)}/day, but one bus catches only about half, not enough to cover its running cost (${naira(costPerDay / buses)}/day).`;
    case "overcapacity":
      return `Buses run ${pct(d.loadFactor)} full and already carry ${pct(d.carried)} of riders here: the last bus mostly carries empty seats. Selling one saves ${naira(costPerDay / buses)}/day.`;
    case "jammed":
      return `Jammed: traffic holds your buses to ${pct(d.speed)} of free speed, so each makes fewer trips a day. ${pct(d.informalTraffic)} of the traffic is informal; every rider you take back is one fewer okada. Too many buses of your own add to it too.${dirt.length > 0 ? ` It runs on dirt: paving ${dirt.map((r) => `${townName(r.a)}–${townName(r.b)}`).join(", ")} (Road tool, click both towns) carries ${paveGain()}× the traffic.` : ""}`;
    case "worn": {
      const worn = wornRoadsOn(world, d.routeId).filter((r) => !r.maintained);
      if (isRailRoute(d.routeId)) {
        const stretches = worn.map((r) => `${townName(r.a)}–${townName(r.b)}`).join(", ");
        const upkeep = worn.reduce((sum, r) => sum + r.upkeepPerDay, 0);
        return `Worn track holds your trains to ${pct(d.wornSpeed)} speed${stretches ? ` (${stretches})` : ""}. Maintain it (Fix tool, F) for about ${naira(upkeep)}/day at this traffic.`;
      }
      const roads = worn.map((r) => `${townName(r.a)}–${townName(r.b)}`).join(", ");
      const upkeep = worn.reduce((sum, r) => sum + r.upkeepPerDay, 0);
      return `Worn roads hold your buses to ${pct(d.wornSpeed)} speed${roads ? ` (${roads})` : ""}. Maintain them (Fix tool, F) for about ${naira(upkeep)}/day, or pave the dirt ones: paved roads wear a third as fast.`;
    }
    case "full":
      return `Buses leave ${pct(d.loadFactor)} full: more riders than seats. Another bus would carry the ones left behind.`;
    case "poached":
      return `Danfos, kekes and okadas passing through take ${pct(d.poached)} of this route's riders before your bus arrives. A more frequent service leaves less for them, if the extra fares cover another bus.`;
    case "waiting":
      return `${pct(d.gaveUp + d.lost)} give up waiting before your bus comes. Another bus would catch more of them, if their fares cover its cost.`;
    case "healthy":
      // No leak dominates, but that isn't the same as paying: with most
      // riders already carried, a loss means more buses than they fill.
      if (netPerDay < 0) {
        return `You carry ${pct(d.carried)} of the riders who want these trips, but their fares don't cover ${buses} bus${buses === 1 ? "" : "es"}. Selling ${buses === 1 ? "it" : "one"} saves ${naira(costPerDay / buses)}/day.`;
      }
      return `Earning well: you carry ${pct(d.carried)} of the riders who want these trips.`;
  }
}

function renderRoutes(): void {
  const summaries = routeSummaries(world);
  const header = `<h2>Your routes</h2><p class="hint">Worst first. Net is fares minus running cost. Bar: who carried this route's riders.</p>`;
  if (summaries.length === 0 && world.lorryRoutes.length === 0) {
    routesEl.innerHTML = `${resultsHtml()}${header}<p class="empty">No buses yet. Hover a town to see where its people want to go. Then pick the <b>Bus</b> tool, click a town, then another town joined to it by road.</p>`;
    return;
  }
  const rows = summaries.map((s) => {
    const index = world.routes.findIndex((route) => route.id === s.id);
    const d = diagnoseRoute(world, s.id);
    const detail = d
      ? `
        <div class="bar" title="you / informal took them from your stop / gave up, then informal / stayed home">
          <i style="width:${pct(d.carried)};background:var(--player)"></i>
          <i style="width:${pct(d.poached)};background:var(--danfo)"></i>
          <i style="width:${pct(d.gaveUp)};background:var(--danfo-light)"></i>
          <i style="width:${pct(d.lost)};background:var(--home)"></i>
        </div>
        <div class="why why-${d.verdict}">${forVehicle(reasonText(d, s.buses, s.costPerDay, s.netPerDay), s.id)}</div>
        <small>${forVehicle(`${Math.round(d.boardingsPerDay)} riders/day · buses ${pct(d.loadFactor)} full · ${pct(d.speed)} speed · ceiling ${naira(d.ceilingPerDay)}/day`, s.id)}</small>`
      : "";
    return `
      <div class="route">
        <span class="swatch" style="background:${routeColor(index)}"></span>
        <div class="name">${townName(s.a)} ↔ ${townName(s.b)}${isRailRoute(s.id) ? " <span class=\"muted\">by rail</span>" : ""}<small>${s.buses} ${isRailRoute(s.id) ? `train${s.buses === 1 ? "" : "s"}` : `bus${s.buses === 1 ? "" : "es"}`} · in ${naira(s.incomePerDay)} · cost ${naira(s.costPerDay)}</small></div>
        <span class="net ${s.netPerDay < 0 ? "bad" : "good"}">${naira(s.netPerDay)}</span>
        <button data-add="${s.id}" title="Add a bus">+</button>
        <button data-remove="${s.id}" title="Sell a bus">−</button>
        <div class="detail">${detail}</div>
      </div>`;
  });
  routesEl.innerHTML = moneyNote() + resultsHtml() + (rows.length > 0 ? header + rows.join("") : "") + lorryRows(rows.length > 0);
}

// --- Results: what each action did --------------------------------------

const pp = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))}pp`;
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** One receipt as a sentence: money first, then who it moved. */
function receiptLine(r: Receipt): string {
  const sale = r.capital < 0;
  const level = Math.abs(r.moneyPerDay) < 5;
  const money = level
    ? "about level on money"
    : r.moneyPerDay > 0
    ? sale ? `saves you ${naira(r.moneyPerDay)}/day` : `earns you ${naira(r.moneyPerDay)}/day more`
    : sale ? `costs you ${naira(-r.moneyPerDay)}/day in lost fares` : `costs you ${naira(-r.moneyPerDay)}/day`;
  const capital = r.capital > 0
    ? r.paybackDays !== null ? `, paying back its ${naira(r.capital)} in ~${Math.ceil(r.paybackDays)} days` : `; its ${naira(r.capital)} isn't paid back at this rate`
    : sale ? ` (you got ${naira(-r.capital)} for it)` : "";
  const moved: string[] = [];
  if (Math.abs(r.you) >= 0.5) moved.push(`your share of all trips ${pp(r.you)}`);
  for (const t of r.towns) {
    const bits: string[] = [];
    if (Math.abs(t.you) >= 1) bits.push(`you ${pp(t.you)}`);
    if (Math.abs(t.informal) >= 1) bits.push(`informal ${pp(t.informal)}`);
    if (Math.abs(t.home) >= 1) bits.push(`stayed home ${pp(t.home)}`);
    if (bits.length > 0) moved.push(`${townName(t.townId)}: ${bits.join(", ")}`);
  }
  const early = r.measuredDays < 0.95 ? " (measured early: you acted again before it settled)" : "";
  return `${capitalise(r.spec.label)} ${money}${capital}.${moved.length > 0 ? ` ${capitalise(moved.join("; "))}.` : ""}${early}`;
}

// What's being measured, and the latest receipts -- compared against the
// same world without the action, so the number is the action's own.
function resultsHtml(): string {
  if (book.pending.length === 0 && book.done.length === 0) return "";
  const dayOf = (seconds: number) => Math.floor(seconds / SECONDS_PER_GAME_DAY) + 1;
  const pending = book.pending
    .map((p) => `<li class="pending">Measuring ${p.spec.label}: result on day ${dayOf(p.startedAt + RECEIPT_SECONDS)}</li>`)
    .join("");
  const done = book.done
    .slice(0, 3)
    .map((r) => `<li class="${r.moneyPerDay < -5 ? "bad" : "good"}"><small>Day ${r.day}</small> ${receiptLine(r)}</li>`)
    .join("");
  return `<h2>Results</h2><p class="hint">Each action against the same world without it: the difference is its own.</p><ul class="results">${pending}${done}</ul>`;
}

// Lorries, after the buses: what goods go each way along the route, and
// the one reason it earns what it does (goods.ts diagnoseLorryRoute).
function lorryRows(afterBuses: boolean): string {
  const summaries = lorrySummaries(world);
  if (summaries.length === 0) return "";
  const rows = summaries.map((s) => {
    const d = diagnoseLorryRoute(world, s.id);
    const detail = d
      ? `
        <div class="bar" title="goods along it: delivered / spoiled">
          <i style="width:${pct(d.delivered)};background:var(--goods)"></i>
          <i style="width:${pct(d.spoiled)};background:var(--home)"></i>
        </div>
        <div class="why why-${d.verdict === "healthy" ? "healthy" : d.verdict === "full" ? "full" : "thin"}">${forGoodsVehicle(lorryReason(d, s.costPerDay / s.lorries), s.id)}</div>
        <small>${forGoodsVehicle(`goods along it: ${Math.round(d.outbound)} t/day ${townName(s.a)}→${townName(s.b)}, ${Math.round(d.inbound)} back · lorries ${pct(d.loadFactor)} full`, s.id)}</small>`
      : "";
    return `
      <div class="route">
        <span class="swatch" style="background:var(--goods)"></span>
        <div class="name">${townName(s.a)} ↔ ${townName(s.b)}${isFreightRoute(s.id) ? ' <span class="muted">by rail</span>' : ""}<small>${s.lorries} ${isFreightRoute(s.id) ? `freight train${s.lorries === 1 ? "" : "s"}` : `lorr${s.lorries === 1 ? "y" : "ies"}`} · in ${naira(s.incomePerDay)} · cost ${naira(s.costPerDay)}</small></div>
        <span class="net ${s.netPerDay < 0 ? "bad" : "good"}">${naira(s.netPerDay)}</span>
        <button data-add="${s.id}" title="Add a lorry">+</button>
        <button data-remove="${s.id}" title="Sell a lorry">−</button>
        <div class="detail">${detail}</div>
      </div>`;
  });
  const port = world.port ? `, supplies from ${townName(world.port)}, export to it` : "";
  return `<h2${afterBuses ? ' class="section"' : ""}>Your goods</h2><p class="hint">Goods go one way each: produce to market${port}. Bar: delivered · spoiled.</p>${rows.join("")}`;
}

// A freight route's reasons are a lorry route's with the vehicle renamed.
function forGoodsVehicle(text: string, routeId: string): string {
  if (!isFreightRoute(routeId)) return text;
  return text.replace(/\bLorries\b/g, "Freight trains").replace(/\blorries\b/g, "freight trains").replace(/\blorry's\b/g, "freight train's").replace(/\blorry\b/g, "freight train");
}

function lorryReason(d: LorryDiagnosis, onePerDay: number): string {
  switch (d.verdict) {
    case "thin":
      return `Thin: only ${Math.round(d.outbound + d.inbound)} t/day of goods go along it, not enough to pay one lorry's running cost (${naira(onePerDay)}/day).`;
    case "one-way":
      return `One-way: ${Math.round(Math.max(d.outbound, d.inbound))} t/day go one way and ${Math.round(Math.min(d.outbound, d.inbound))} the other, so lorries come back near empty. A route with goods both ways (produce in, supplies out) runs full both legs.`;
    case "full":
      return `Lorries leave full and ${pct(d.spoiled)} of the goods along it spoil waiting. Another lorry would carry them, if they pay its ${naira(onePerDay)}/day.`;
    case "spoiling":
      return `${pct(d.spoiled)} of the goods along it spoil before a lorry comes. Another lorry would catch more, if they pay its ${naira(onePerDay)}/day.`;
    case "healthy":
      return `Goods go both ways along it: you deliver ${pct(d.delivered)} of them.`;
  }
}

// What goods leave and reach a town, and how much of each you deliver.
function goodsText(townId: string): string {
  const goods = townGoods(world, townId);
  if (goods.length === 0) return "";
  const out = goods.filter((g) => g.outgoing);
  const inbound = goods.filter((g) => !g.outgoing);
  const parts: string[] = [];
  for (const g of out) parts.push(`${Math.round(g.perDay)} t/day of ${g.kind} to ${townName(g.other)} (${pct(g.delivered)} delivered)`);
  const into = inbound.reduce((sum, g) => sum + g.perDay, 0);
  if (into > 0) {
    const delivered = inbound.reduce((sum, g) => sum + g.perDay * g.delivered, 0) / into;
    parts.push(`${Math.round(into)} t/day of goods coming in (${pct(delivered)} delivered)`);
  }
  return `<p class="townshare"><b>Goods:</b> ${parts.slice(0, 3).join("; ")}. Nobody else carries freight: what lorries don't take, spoils.</p>`;
}

// The way out of debt, said outright (playtest, day 14: "felt stuck,
// didn't know how to get out of debt"). Shown in debt, or with under a
// week of money left.
function moneyNote(): string {
  const advice = debtAdvice(world);
  if (!advice) return "";
  const situation = advice.funds < 0
    ? `<b>In debt (${naira(advice.funds)}).</b> Buying and repairs are blocked until funds are back above zero; running costs still bill${advice.netPerDay < 0 ? `, ${naira(-advice.netPerDay)}/day more than you earn` : ""}.`
    : `<b>Money runs out in ~${Math.max(1, Math.round(advice.daysLeft))} days</b> at ${naira(advice.netPerDay)}/day.`;
  const upkeep = [...world.upkeepRateEMA.entries()].filter(([id]) => world.maintained.has(id)).reduce((sum, [, rate]) => sum + rate, 0) * SECONDS_PER_GAME_DAY;
  let exit: string;
  if (advice.sell.length > 0) {
    const list = advice.sell
      .map((s) => {
        const through = throughRoute(world, s.routeId);
        const rerun = through ? `, or run it through as ${townName(through.a)} ↔ ${townName(through.b)}` : "";
        return `${townName(s.a)} ↔ ${townName(s.b)} (${naira(-s.savesPerDay)}/day; sells for ${naira(s.refund)}${rerun})`;
      })
      .join(", ");
    const refund = advice.sell.reduce((sum, s) => sum + s.refund, 0);
    const saves = advice.sell.reduce((sum, s) => sum + s.savesPerDay, 0);
    const after = advice.funds + refund;
    exit = `The way out: sell the buses and lorries on routes losing money on their own fares (<b>−</b> on each): ${list}. All of them: ${naira(refund)} now${after >= 0 && advice.funds < 0 ? " (out of debt)" : ""} and ${naira(saves)}/day better.`;
  } else if (upkeep > 0) {
    exit = `No route loses money on its own; road upkeep costs ${naira(upkeep)}/day. Stop maintaining the quietest roads (Fix tool, F).`;
  } else {
    exit = advice.netPerDay > 0 ? `You're earning ${naira(advice.netPerDay)}/day: the debt clears on its own in ~${Math.ceil(-advice.funds / advice.netPerDay)} days.` : "Every route pays its way; the loss is the network's start-up. Give it a few days.";
  }
  return `<p class="callout">${situation} ${exit}</p>`;
}

routesEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const addId = target.dataset.add;
  const removeId = target.dataset.remove;
  const later = " Result in two days.";
  const sell = (routeId: string, vehicle: string, remove: (w: SliceWorld) => number) => {
    const route = [...world.routes, ...world.lorryRoutes].find((candidate) => candidate.id === routeId);
    if (!route) return;
    const result = act({ label: `selling a ${vehicle} on ${pair(route.a, route.b)}`, towns: [route.a, route.b], routeId }, (w) => {
      const refund = remove(w);
      return { ok: refund > 0, refund };
    });
    if (result.ok) say(`Sold a ${vehicle} for ${naira(result.refund)}.${later}`);
  };
  if (addId && isLorryRoute(addId)) {
    const route = world.lorryRoutes.find((candidate) => candidate.id === addId);
    if (!route) return;
    const freight = isFreightRoute(addId);
    const vehicle = freight ? "freight train" : "lorry";
    const spec = { label: addLabel(vehicle, route.vehicleIds.length + 1, route.a, route.b), towns: [route.a, route.b], routeId: addId };
    const result = act(spec, (w) => (freight ? addFreightTrain(w, route.a, route.b) : addLorry(w, route.a, route.b)));
    const price = freight ? world.tuning.freightPurchaseCost : world.tuning.lorryPurchaseCost;
    if (!result.ok) say(`Can't add ${vehicle} (${naira(price)}): ${result.reason}`, true);
  } else if (addId) {
    const route = world.routes.find((candidate) => candidate.id === addId);
    if (!route) return;
    const train = isRailRoute(addId);
    const spec = { label: addLabel(train ? "train" : "bus", route.vehicleIds.length + 1, route.a, route.b), towns: [route.a, route.b], routeId: addId };
    const result = act(spec, (w) => (train ? addTrain(w, route.a, route.b) : addBus(w, route.a, route.b)));
    const price = train ? world.tuning.trainPurchaseCost : world.tuning.busPurchaseCost;
    if (!result.ok) say(`Can't add ${train ? "train" : "bus"} (${naira(price)}): ${result.reason}`, true);
  } else if (removeId && isLorryRoute(removeId)) {
    sell(removeId, isFreightRoute(removeId) ? "freight train" : "lorry", (w) => removeLorry(w, removeId));
  } else if (removeId) {
    sell(removeId, isRailRoute(removeId) ? "train" : "bus", (w) => removeBus(w, removeId));
  }
  renderRoutes();
});

// --- Loop -------------------------------------------------------------

const accumulator = new Accumulator(SIM_DT);
let last = performance.now();
let panelTimer = 0;

function frame(now: number): void {
  const elapsed = (now - last) / 1000;
  last = now;
  if (!paused) {
    // Each speed step runs its own bounded advance, so 4x stays 4x rather
    // than being clipped by the accumulator's per-frame catch-up cap.
    for (let i = 0; i < speed; i += 1) {
      accumulator.advance(elapsed, (dt) => {
        for (const event of sliceTick(world, dt)) announce(event);
        for (const receipt of tickReceipts(world, book, dt)) say(receiptLine(receipt), receipt.moneyPerDay < -5, 8);
      });
    }
  }
  draw(ctx, world, view, { selectedTown, hoverTown, focusTown: focusTown(), ghost: ghost(), road: roadHover() });

  panelTimer += elapsed;
  if (panelTimer > 0.25) {
    panelTimer = 0;
    renderStrip();
    renderPanel();
  }
  requestAnimationFrame(frame);
}

renderToolbar();
resize(); // again, now the toolbar exists to be measured
renderStrip();
renderPanel();
say("Danfos, kekes and okadas are already carrying your passengers. Click a town, then another, to run a bus.");
requestAnimationFrame(frame);
