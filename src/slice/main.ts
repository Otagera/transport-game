import { Accumulator, SIM_DT } from "@engine/loop";
import { sliceTick } from "@engine/slice/tick";
import {
  addBus,
  buildRoad,
  checkBus,
  checkPave,
  checkRoad,
  gameDay,
  debtAdvice,
  demandAlong,
  diagnoseRoute,
  addMinibus,
  addBrt,
  checkBrt,
  brtRouteId,
  isBrtRoute,
  addBusLane,
  checkLane,
  laneCost,
  checkMinibus,
  chainOf,
  findRoute,
  isMinibusRoute,
  minibusRouteId,
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
import { corridorWear, fixRoadNow, roughCostPerDay, setRoadMaintained, upkeepPerDay, wearSpeed } from "@engine/slice/wear";
import { createReceiptBook, perform, tickReceipts, RECEIPT_SECONDS, type Receipt, type ReceiptSpec } from "@engine/slice/receipts";
import type { SliceWorld } from "@engine/slice/types";
import { growthTrend, roadFull, townGrowth } from "@engine/slice/growth";
import { addTrain, buildHalt, buildTrack, checkHalt, checkTrack, checkTrain, haltCost, haltSite, isRailRoute, planRail, railPath, railRouteId, restoreCost, trackAction, lineSlots } from "@engine/slice/rail";
import { addFreightTrain, checkFreight, findLorryRoute, freightRouteId, isFreightRoute, lorryRouteId } from "@engine/slice/goods";
import { addLorry, checkLorry, diagnoseLorryRoute, flowKey, goodsAlong, isLorryRoute, lorrySummaries, removeLorry, townGoods, type LorryDiagnosis } from "@engine/slice/goods";
import type { RouteDiagnosis } from "@engine/slice/world";
import type { SliceEvent } from "@engine/slice/settlement";
import { SLICE_MAP } from "./map";
import type { ForecastLine } from "./render";
import { applyAction, type ActionSpec } from "@engine/slice/actions";
import { vehicleMoves } from "@engine/slice/moves";
import { ALL_SYSTEMS_ON, DEFAULT_SLICE_TUNING } from "@engine/slice/tuning";
import { startSliceGame } from "@engine/slice/start";
import { generatedSliceMap } from "@engine/slice/generate";
import { paveUpkeepPerDay, upkeepFor } from "@engine/slice/upkeep";
import { isDirt } from "@engine/slice/congestion";
import { dropProject, heldForProject, nameProject, projectLapsesAt, rungPrice, type ProjectRung } from "@engine/slice/project";
import { remittanceExpected } from "@engine/slice/budget";
import { TREND_DAYS, peopleSinceStart, tripsTrend } from "@engine/slice/score";
import { corridorSummaries } from "@engine/slice/corridors";
import { industryFlows, stoneServed } from "@engine/slice/industries";
import { NO_SEAT_MIN_PER_DAY, corridorNoSeat, shrinkCause, townNoSeat, wornRoadAt, type NamedMove } from "@engine/slice/problems";
import { enforcementPerDay, laneOn, lanesBySegment, setEnforcement, settleStrike, settlementPrice, type LaneState } from "@engine/slice/pushback";
import { averageBudget, averageHeadline, averageNet } from "@engine/slice/history";
import { draw, fitView, routeColor, toScreen, townRadius, type Ghost, type View } from "./render";
import { createHintState, dismissHint, updateHints } from "./hints";
import { shortVerdict } from "./verdicts";

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

type Tool = "road" | "bus" | "minibus" | "brt" | "lorry" | "track" | "train" | "freight" | "fix";

// Slice zero (docs/brief.md): wear, goods, rail and the straight alignment
// are off. `?systems=all` turns them back on, for comparing.
const params = new URLSearchParams(location.search);
const allSystems = params.get("systems") === "all";
// The developer view (docs/brief.md, Information design): forecasts on
// previews, receipts, best next moves -- you, calibrating; never the player.
// Without it none of them runs: no forecast workers, no shadow worlds.
const dev = params.get("dev") === "1";
document.body.dataset.dev = String(dev);
// Each game is a generated map (generate.ts; the brief's P8, After the
// ladder's playtest, 5): a new game draws a seed, kept in the address so a
// reload plays the same map; ?seed=0 is the hand-made map itself.
const seedParam = Number(params.get("seed"));
const seed = params.has("seed") && Number.isInteger(seedParam) && seedParam >= 0 ? seedParam : 1 + Math.floor(Math.random() * 9999);
if (!params.has("seed")) {
  params.set("seed", String(seed));
  history.replaceState(null, "", `${location.pathname}?${params}`);
}
// The world has already run five days when you arrive (start.ts).
const world = startSliceGame(generatedSliceMap(SLICE_MAP, seed), { ...DEFAULT_SLICE_TUNING, ...(allSystems ? ALL_SYSTEMS_ON : {}) });
// A developer start (?dev=1&funds=20000): enough money to reach a late rung
// in a minute, for screenshots and checks. Ignored without ?dev=1.
const devFunds = dev ? Number(params.get("funds")) : NaN;
if (Number.isFinite(devFunds) && params.has("funds")) world.economy.funds = devFunds;
const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
const ctx = canvas.getContext("2d")!;
const strip = document.querySelector<HTMLDivElement>("#strip")!;
const routesEl = document.querySelector<HTMLDivElement>("#routes")!;
const toolbar = document.querySelector<HTMLDivElement>("#toolbar")!;
const toast = document.querySelector<HTMLDivElement>("#toast")!;
const hintEl = document.querySelector<HTMLDivElement>("#hint")!;
const controlsEl = document.querySelector<HTMLDivElement>("#controls")!;
// Which map this is, and a new one: the same address without its seed draws another.
{
  const fresh = new URLSearchParams(params);
  fresh.delete("seed");
  const query = fresh.toString();
  document.querySelector<HTMLSpanElement>("#map-seed")!.innerHTML = `Map ${seed} · <a href="${location.pathname}${query ? `?${query}` : ""}">New map</a>`;
}

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
  const bottomInset = Math.max(56, below(toolbar), below(keyEl), below(controlsEl)) + 8;
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

/**
 * Does an action and, in the developer view, starts measuring it. The result
 * is the real world's. Outside it there are no receipts, so no shadow world
 * to step every frame.
 */
function act<T extends { ok: boolean }>(spec: ReceiptSpec, run: (w: SliceWorld) => T): T {
  actionVersion += 1; // every forecast was of the world before this
  if (!dev) return run(world);
  let result: T | undefined;
  perform(world, book, (w) => {
    const r = run(w);
    if (w === world) result = r;
    return r.ok;
  }, spec);
  return result!;
}

// --- Forecasts: a receipt before the action (forecast.ts) ----------------
// When a build is previewed, a worker runs the world two days on with and
// without it; the preview's second line says what it would do. Cached per
// action, game day and how many actions you've taken, so a forecast is
// redone once the world it described has moved on.

const forecaster = dev ? new Worker(new URL("./forecast.worker.ts", import.meta.url), { type: "module" }) : null;
let actionVersion = 0;
const forecasts = new Map<string, Receipt | null | "pending">();
let inFlight = false;
let queued: { key: string; action: ActionSpec; spec: ReceiptSpec } | null = null;

function sendForecast(key: string, action: ActionSpec, spec: ReceiptSpec): void {
  inFlight = true;
  forecaster?.postMessage({ key, world, action, spec });
}

if (forecaster) forecaster.onmessage = (event: MessageEvent<{ key: string; receipt: Receipt | null }>) => {
  forecasts.set(event.data.key, event.data.receipt);
  inFlight = false;
  if (queued) {
    const next = queued;
    queued = null;
    sendForecast(next.key, next.action, next.spec);
  }
};

function forecastLine(action: ActionSpec, spec: ReceiptSpec): ForecastLine {
  const day = Math.floor(world.economy.elapsedSeconds / SECONDS_PER_GAME_DAY);
  const key = `${actionVersion}|${day}|${JSON.stringify(action)}`;
  if (!forecasts.has(key)) {
    if (forecasts.size > 64) forecasts.clear();
    forecasts.set(key, "pending");
    // Only the latest preview matters: a queued one you've moved off is dropped.
    if (inFlight) {
      if (queued) forecasts.delete(queued.key);
      queued = { key, action, spec };
    } else sendForecast(key, action, spec);
  }
  const entry = forecasts.get(key);
  if (entry === "pending") return { text: "Forecasting the next two days…", tone: "pending" };
  if (!entry) return { text: "Forecast: it can't be done", tone: "bad" };
  return describeForecast(entry);
}

/** One line: money first, then the share or town it moves most. */
function describeForecast(r: Receipt): ForecastLine {
  const level = Math.abs(r.moneyPerDay) < 5;
  const parts: string[] = [];
  parts.push(level ? "no change in money" : `${r.moneyPerDay > 0 ? "+" : "−"}₦${Math.abs(Math.round(r.moneyPerDay)).toLocaleString()}/day`);
  if (r.capital > 0 && !level) parts.push(r.paybackDays !== null ? `pays back in ~${Math.ceil(r.paybackDays)} days` : "never pays back");
  if (Math.abs(r.you) >= 0.5) parts.push(`your share ${pp(r.you)}`);
  else {
    const moves = r.towns.flatMap((t) => [
      { text: `${townName(t.townId)}: you ${pp(t.you)}`, size: Math.abs(t.you) },
      { text: `${townName(t.townId)}: informal ${pp(t.informal)}`, size: Math.abs(t.informal) },
      { text: `${townName(t.townId)}: stayed home ${pp(t.home)}`, size: Math.abs(t.home) },
    ]);
    const biggest = moves.sort((p, q) => q.size - p.size)[0];
    if (biggest && biggest.size >= 1) parts.push(biggest.text);
  }
  const tone = level ? "neutral" : r.moneyPerDay > 0 ? "good" : "bad";
  return { text: `Forecast, two days on: ${parts.join(", ")}`, tone };
}

/** The action a tool would take between two towns -- what the preview forecasts and a click does. */
function actionFor(current: Tool, a: string, b: string): ActionSpec | null {
  switch (current) {
    case "road": {
      const chain = roadChain(world, a, b);
      if (!chain) return { kind: "road", a, b, alignment };
      if (chain.some(isDirt)) return { kind: "pave", a, b };
      // A lane already: the Road tool switches its enforcement, strict <-> lax.
      const lane = chain.every((piece) => piece.busLane) ? laneOn(world, a, b) : undefined;
      if (lane) return { kind: "enforce", a, b, enforcement: lane.enforcement === "strict" ? "lax" : "strict" };
      return { kind: "lane", a, b };
    }
    case "track":
      return { kind: "track", a, b, alignment };
    case "bus":
    case "minibus":
    case "brt":
    case "lorry":
    case "train":
    case "freight":
      return { kind: current, a, b };
    case "fix":
      return null;
  }
}

/** The move waiting for a second click to confirm it despite its forecast. */
let confirming: string | null = null;

/** A finished forecast for an action, if there is one for the world as it is now. */
function knownForecast(action: ActionSpec): Receipt | null | undefined {
  const day = Math.floor(world.economy.elapsedSeconds / SECONDS_PER_GAME_DAY);
  const entry = forecasts.get(`${actionVersion}|${day}|${JSON.stringify(action)}`);
  return entry === "pending" ? undefined : entry;
}

// --- Best next moves ------------------------------------------------------
// The playtester's aim was "put the bus on the best available path", and
// the best ones weren't the obvious ones: a first bus on Owode <-> Ise (a
// through-route via Ilase) forecast +₦93/day while most neighbour-to-
// neighbour routes lost money. So the panel keeps a ranked list, forecast
// in a small worker pool: one more vehicle on each route you run, and new
// buses and minibuses on the pairs with the most trips along them.

const POOL_SIZE = dev ? Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)) : 0;
const pool = Array.from({ length: POOL_SIZE }, () => new Worker(new URL("./forecast.worker.ts", import.meta.url), { type: "module" }));
const idle: Worker[] = [...pool];

interface Move {
  action: ActionSpec;
  spec: ReceiptSpec;
  title: string;
  price: number;
  receipt?: Receipt | null;
}

let moves: { key: string; list: Move[]; next: number } = { key: "", list: [], next: 0 };

/** Refreshed after any action and every three game days. */
function movesKey(): string {
  return `${actionVersion}|${Math.floor(world.economy.elapsedSeconds / (3 * SECONDS_PER_GAME_DAY))}`;
}

function candidateMoves(): Move[] {
  return vehicleMoves(world).map(({ action, routeId, count, price }) => ({
    action,
    spec: { label: addLabel(action.kind, count, action.a, action.b), towns: [action.a, action.b], routeId },
    title: count > 1 ? `Another ${action.kind} on ${pair(action.a, action.b)}` : `New ${action.kind} route ${pair(action.a, action.b)}`,
    price,
  }));
}

function refreshMoves(): void {
  const key = movesKey();
  if (moves.key === key) return;
  moves = { key, list: candidateMoves(), next: 0 };
  while (idle.length > 0 && dispatchMove()) {}
}

function dispatchMove(): boolean {
  if (moves.next >= moves.list.length) return false;
  const worker = idle.pop()!;
  const index = moves.next++;
  const move = moves.list[index]!;
  worker.postMessage({ key: `${moves.key}#${index}`, world, action: move.action, spec: move.spec });
  return true;
}

for (const worker of pool) {
  worker.onmessage = (event: MessageEvent<{ key: string; receipt: Receipt | null }>) => {
    const [key, index] = event.data.key.split("#") as [string, string];
    if (key === moves.key) moves.list[Number(index)]!.receipt = event.data.receipt;
    idle.push(worker);
    dispatchMove();
  };
}

function bestMovesHtml(): string {
  refreshMoves();
  const done = moves.list.filter((m) => m.receipt);
  const waiting = moves.list.length - moves.list.filter((m) => m.receipt !== undefined).length;
  const best = done.sort((p, q) => q.receipt!.moneyPerDay - p.receipt!.moneyPerDay).slice(0, 4);
  const rows = best
    .map((move) => {
      const r = move.receipt!;
      const index = moves.list.indexOf(move);
      const money = `${r.moneyPerDay >= 0 ? "+" : "−"}₦${Math.abs(Math.round(r.moneyPerDay))}/day`;
      const back = r.paybackDays !== null ? `, pays back in ~${Math.ceil(r.paybackDays)} days` : r.moneyPerDay > 0 ? "" : ", loses money";
      const afford = world.economy.funds >= move.price;
      return `<li class="${r.moneyPerDay > 5 ? "good" : r.moneyPerDay < -5 ? "bad" : ""}">
        <span>${move.title} · ${naira(move.price)}<small>${money}${back}${Math.abs(r.you) >= 0.5 ? ` · your share ${pp(r.you)}` : ""}</small></span>
        <button data-move="${index}" ${afford ? "" : "disabled title=\"Can't afford it yet\""}>Buy</button></li>`;
    })
    .join("");
  const status = waiting > 0 ? `<p class="hint">Checking ${waiting} more…</p>` : "";
  const none = done.length > 0 && best[0]!.receipt!.moneyPerDay <= 0 ? `<p class="hint">Nothing on the roads pays right now. Look at fixing or paving, or wait for towns to grow.</p>` : "";
  return `<h2>Best next moves</h2><p class="hint">Forecast two days on, against the same world without them. Checked again every three days and after anything you do.</p><ul class="moves">${rows}</ul>${none}${status}`;
}

/** A preview with its forecast, when the action could be done (developer view only). */
function withForecast(ghost: Ghost, action: ActionSpec, spec: ReceiptSpec): Ghost {
  return ghost.ok && dev ? { ...ghost, forecast: forecastLine(action, spec) } : ghost;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const pair = (a: string, b: string) => `${townName(a)} ↔ ${townName(b)}`;

/** "a 3rd bus on Ilase ↔ Owode", or "a new bus route Ilase ↔ Owode". */
function addLabel(vehicle: string, count: number, a: string, b: string): string {
  return count <= 1 ? `a new ${vehicle} route ${pair(a, b)}` : `a ${ordinal(count)} ${vehicle} on ${pair(a, b)}`;
}

/** Toasts promise a receipt only where there are receipts. */
const later = dev ? " Result in two days." : "";

// Pause on a strike at 4x (a player option, P; remembered): at 4x a strike's
// two days pass in 15 seconds (playtest: "did a strike land? I couldn't tell").
const PAUSE_ON_STRIKE_KEY = "slice:pause-on-strike";
let pauseOnStrike = (() => {
  try {
    return localStorage.getItem(PAUSE_ON_STRIKE_KEY) !== "0";
  } catch {
    return true;
  }
})();
function pauseForStrike(): void {
  if (!pauseOnStrike || speed !== 4 || paused) return;
  paused = true;
  renderToolbar();
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
  const corridor = "a" in event ? `${townName(event.a)} – ${townName(event.b)}` : "";
  if (event.kind === "strike-announced") {
    const lane = laneOn(world, event.a, event.b);
    const relax = lane?.enforcement === "strict" ? " Relax its enforcement, or settle with the union, to call it off: buttons on its route card." : " Settle with the union to call it off: the button is on its route card.";
    say(`The danfo union calls a strike on ${corridor} from day ${gameDay(world, event.atSeconds)} over your bus lane.${relax}`, true, 10);
    pauseForStrike();
  } else if (event.kind === "project-done") {
    say(`Your project is built: the ${event.rung === "lane" ? "bus lane" : "rail line"} on ${corridor}. The treasury goes back to its usual share.`, false, 6);
  } else if (event.kind === "project-lapsed") {
    say(`Your project on ${corridor} lapsed unbuilt: the treasury took ${naira(event.taken)} of what you'd set aside.`, true, 8);
  } else if (event.kind === "remitted") {
    // The treasury as an event, not a leak (playtest: "the treasury unnoticed, felt as incidental loss").
    const next = `Next in ${world.tuning.remittancePeriodDays} days.`;
    say(event.amount >= 1 ? `The treasury took ${naira(event.amount)} of your surplus. ${next}` : `The treasury took nothing: no surplus over the reserve. ${next}`, event.amount >= 1, 6);
  } else if (event.kind === "strike-called-off") {
    say(`The union called off the strike on ${corridor}: you relaxed the lane.`, false, 6);
  } else if (event.kind === "strike") {
    say(`Danfo drivers on ${corridor} are on strike for ${world.tuning.strikeDays} days: they block your lane, no danfos run, no levies there.`, true, 10);
    pauseForStrike();
  } else if (event.kind === "strike-over") {
    say(`The strike on ${corridor} is over.${event.cost !== null ? ` It cost you about ${naira(event.cost)}.` : ""}`, true, 8);
  } else if (event.kind === "milestone") {
    // The score as an event, like the treasury's (brief, After the ladder's playtest, 2).
    const grown = ["has grown by a quarter", "has grown by half", "has doubled", "has tripled"][event.index] ?? "has grown";
    say(`${event.name} ${grown} since day 1: ${Math.round(event.from)}k → ${Math.round(event.to)}k people.`, false, 6);
  } else if (event.kind === "corridor-taken") {
    say(`You've taken ${corridor} from the danfos: you carry ${pct(event.share)} of its trips. Their park levies there fall.`, false, 8);
  } else if (event.kind === "corridor-released") {
    say(`The danfos have ${corridor} back: you carry ${pct(event.share)} of its trips.`, true, 6);
  } else if (event.kind === "industry-opened") {
    // A new problem arriving (brief, Revision 2: industries that open and close).
    const buyers = industryFlows(world).filter((flow) => flow.from === event.townId).map((flow) => townName(flow.to));
    say(`A quarry has opened near ${townName(event.near)}: ${world.tuning.quarryOutputPerDay} t of stone a day for ${[...new Set(buyers)].join(", ")}. Nothing moves it until you do.`, false, 9);
  } else if (event.kind === "industry-closed") {
    say(`${event.name} has closed: ${event.reason === "worked out" ? "it's worked out" : "nothing was moved from it"}.`, true, 7);
  } else if (event.kind === "founded") {
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

/** The two end towns of the road a segment belongs to. */
function roadTowns(segmentId: string): string[] {
  const whole = chainOf(world, segmentId);
  const segment = world.simulation.map.segments.find((s) => s.id === segmentId);
  return whole ? [whole.a, whole.b] : segment ? [segment.fromNodeId, segment.toNodeId] : [];
}

/** Every piece of the road a segment belongs to (just itself for track). */
function roadPieces(segmentId: string) {
  return chainOf(world, segmentId)?.pieces ?? world.simulation.map.segments.filter((s) => s.id === segmentId);
}

/** Whether a tool's system is on (slice zero switches some off). */
function toolOn(candidate: Tool): boolean {
  const t = world.tuning;
  if (candidate === "lorry") return t.goodsEnabled;
  if (candidate === "freight") return t.goodsEnabled && t.railEnabled;
  if (candidate === "track" || candidate === "train") return t.railEnabled;
  if (candidate === "fix") return t.wearEnabled;
  // The BRT bus runs only in a bus lane: its tool appears once you have one.
  if (candidate === "brt") return world.lanes.length > 0;
  return true;
}

function setTool(next: Tool): void {
  if (!toolOn(next)) return;
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
      say(`Maintaining ${name}: repaired for ${naira(result.charged)}, about ${naira(upkeep)}/day to keep at this traffic.${later}`);
    } else say(`Stopped maintaining ${name}: it will wear again`);
    renderPanel();
    return;
  }
  const town = townAt(event.clientX, event.clientY);
  if (!town) {
    selectedTown = null;
    return;
  }
  // Track tool, the same town twice: a halt where a line passes it by.
  if (tool === "track" && selectedTown === town && haltSite(world, town)) {
    const site = haltSite(world, town)!;
    const cost = haltCost(world, site);
    const result = act({ label: `a halt at ${townName(town)}`, towns: [town] }, (w) => buildHalt(w, town));
    if (result.ok) say(`Built a halt at ${townName(town)} for ${naira(cost)}: trains on the line now stop here. Result in two days.`);
    else say(`Can't build a halt (${naira(cost)}): ${result.reason}`, true);
    selectedTown = null;
    renderPanel();
    return;
  }
  if (!selectedTown || selectedTown === town) {
    selectedTown = selectedTown === town ? null : town;
    return;
  }
  const from = selectedTown;
  // A move forecast to lose money takes a second click: a red line is easy
  // to miss at 4x (playtest: "whatever the forecast says I don't really pay
  // attention"); a refusal you have to click past isn't.
  const intended = actionFor(tool, from, town);
  const known = intended ? knownForecast(intended) : undefined;
  const confirmAs = intended ? JSON.stringify(intended) : null;
  if (dev && known && known.moneyPerDay < -5 && confirming !== confirmAs) {
    confirming = confirmAs;
    say(`Forecast: this loses ${naira(-known.moneyPerDay)}/day. Click ${townName(town)} again to do it anyway.`, true, 5);
    return;
  }
  confirming = null;
  const towns = [from, town];
  if (tool === "road" && intended?.kind === "enforce") {
    const lane = laneOn(world, from, town)!;
    const strict = intended.enforcement === "strict";
    act({ label: `${strict ? "enforcing" : "relaxing"} the ${townName(from)} – ${townName(town)} lane`, towns }, (w) => ({ ok: setEnforcement(w, from, town, intended.enforcement) }));
    say(strict
      ? `Wardens on the ${townName(from)} – ${townName(town)} lane, ${naira(enforcementPerDay(world, lane))}/day: they'll clear it, and the union will strike more often.${later}`
      : `Wardens off the ${townName(from)} – ${townName(town)} lane: danfos will creep into it, and the union will keep the peace.${later}`);
  } else if (tool === "road" && intended?.kind === "lane") {
    const cost = laneCost(world, from, town);
    const result = act({ label: `a bus lane on ${townName(from)} – ${townName(town)}`, towns }, (w) => addBusLane(w, from, town));
    if (result.ok) {
      say(`Bus lane on ${townName(from)} – ${townName(town)} for ${naira(cost)}: your vehicles skip the traffic, and BRT buses (X) can run in it. No wardens yet (Road tool on it to enforce). The danfo union will answer the lane within days.${later}`, false, 8);
      renderToolbar();
    }
    else say(`Can't add a bus lane (${naira(cost)}): ${result.reason}`, true);
  } else if (tool === "road" && roadChain(world, from, town)) {
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
  } else if (tool === "brt") {
    const routeId = brtRouteId(from, town);
    const count = (world.routes.find((r) => r.id === routeId)?.vehicleIds.length ?? 0) + 1;
    const result = act({ label: addLabel("BRT bus", count, from, town), towns, routeId }, (w) => addBrt(w, from, town));
    if (result.ok) say(`BRT bus added: ${pair(from, town)}, in its lane.${later}`);
    else say(`Can't add a BRT bus (${naira(world.tuning.brtPurchaseCost)}): ${result.reason}`, true);
  } else if (tool === "minibus") {
    const routeId = minibusRouteId(from, town);
    const count = (world.routes.find((r) => r.id === routeId)?.vehicleIds.length ?? 0) + 1;
    const result = act({ label: addLabel("minibus", count, from, town), towns, routeId }, (w) => addMinibus(w, from, town));
    if (result.ok) say(`Minibus added: ${pair(from, town)}.${later}`);
    else say(`Can't add minibus (${naira(world.tuning.minibusPurchaseCost)}): ${result.reason}`, true);
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
  else if (event.key === "m" || event.key === "M") setTool("minibus");
  else if (event.key === "x" || event.key === "X") setTool("brt");
  else if (event.key === "f" || event.key === "F") setTool("fix");
  else if (event.key === "l" || event.key === "L") setTool("lorry");
  else if (event.key === "k" || event.key === "K") setTool("track");
  else if (event.key === "t" || event.key === "T") setTool("train");
  else if (event.key === "g" || event.key === "G") setTool("freight");
  else if ((event.key === "a" || event.key === "A") && world.tuning.straightAlignmentEnabled) {
    alignment = alignment === "cheapest" ? "direct" : "cheapest";
    renderToolbar();
  }
  else if (event.key === "p" || event.key === "P") {
    pauseOnStrike = !pauseOnStrike;
    try {
      localStorage.setItem(PAUSE_ON_STRIKE_KEY, pauseOnStrike ? "1" : "0");
    } catch {
      // Remembered for this game only.
    }
    say(pauseOnStrike ? "At 4×, the game pauses when a strike is called or begins." : "At 4×, strikes no longer pause the game.");
  }
  else if (event.key === "h" || event.key === "H") {
    hints.off = !hints.off;
    try {
      localStorage.setItem(HINTS_OFF_KEY, hints.off ? "1" : "0");
    } catch {
      // Remembered for this game only.
    }
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
function roadHover(): { segmentId: string; at: { x: number; y: number }; label: string; forecast?: ForecastLine } | null {
  if (tool !== "fix" || !mouse) return null;
  const id = roadAt(mouse.x, mouse.y);
  if (!id) return null;
  // The whole road, through any roadside towns: its worst piece, its total upkeep.
  const pieces = roadPieces(id);
  const worst = pieces.reduce((low, piece) => (piece.condition < low.condition ? piece : low), pieces[0]!);
  const state = `${pct(worst.condition)} condition${pieces.length > 1 ? " at worst" : ""}, ${worst.type === "rail" ? "trains" : "traffic"} at ${pct(wearSpeed(world, worst))} speed`;
  const upkeep = naira(pieces.reduce((sum, piece) => sum + upkeepPerDay(world, piece), 0));
  // What the wear is costing you now: your vehicles' extra running cost on it.
  const roughPerDay = pieces.reduce((sum, piece) => sum + roughCostPerDay(world, piece), 0);
  const costing = roughPerDay >= 1 ? ` · costs your vehicles ${naira(roughPerDay)}/day extra` : "";
  const label = world.maintained.has(id)
    ? `${roadName(id)} · maintained, ${upkeep}/day · click to stop`
    : `${roadName(id)} · ${state}${costing} · maintain for ~${upkeep}/day`;
  const ends = chainOf(world, id);
  const towns = ends ? [ends.a, ends.b] : [worst.fromNodeId, worst.toNodeId];
  const forecast = dev ? forecastLine({ kind: "fix", segmentId: id, on: !world.maintained.has(id) }, { label: "maintaining", towns }) : undefined;
  return { segmentId: id, at: mouse, label, forecast };
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
  // Track tool, back over the selected town: offer the halt if a line passes it.
  if (tool === "track" && hoverTown === selectedTown) {
    const site = haltSite(world, selectedTown);
    if (site) {
      const check = checkHalt(world, selectedTown);
      const at = toScreen(view, world.towns.get(selectedTown)!.x, world.towns.get(selectedTown)!.y);
      const cost = naira(haltCost(world, site));
      const ghost = { from: selectedTown, to: at, ok: check.ok, label: check.ok ? `Click again: a halt on the line ${site.distance.toFixed(0)} cells away, ${cost}` : refusedOr(check, "Halt", cost) };
      return withForecast(ghost, { kind: "halt", town: selectedTown }, { label: `a halt at ${townName(selectedTown)}`, towns: [selectedTown] });
    }
  }
  const to = hoverTown && hoverTown !== selectedTown ? hoverTown : null;
  const end = to ? toScreen(view, world.towns.get(to)!.x, world.towns.get(to)!.y) : mouse;
  if (!to) return { from: selectedTown, to: end, ok: true, label: "" };
  // The trip's demand rides along on every preview: what you'd be building for.
  const riders = `${Math.round(pairDemand(world, selectedTown, to) * SECONDS_PER_GAME_DAY)} riders/day want this trip`;
  const roadAction = tool === "road" ? actionFor("road", selectedTown, to) : null;
  if (roadAction?.kind === "enforce") {
    const lane = laneOn(world, selectedTown, to)!;
    const cost = naira(enforcementPerDay(world, lane));
    const taken = `${Math.round(lane.encroachment * 100)}% taken by danfos`;
    const label = roadAction.enforcement === "strict"
      ? `Enforce the lane strictly: ${cost}/day · clears it (${taken}) · the union strikes more often`
      : `Relax enforcement: saves ${cost}/day · danfos creep into the lane · the union keeps the peace`;
    return withForecast({ from: selectedTown, to: end, ok: true, label }, roadAction, { label: "enforcement", towns: [selectedTown, to] });
  }
  if (tool === "road" && roadAction?.kind === "lane") {
    const check = checkLane(world, selectedTown, to);
    const cost = naira(laneCost(world, selectedTown, to));
    const ghost = { from: selectedTown, to: end, ok: check.ok, label: check.ok ? `Bus lane ${cost} · your vehicles skip the traffic · danfos lose a lane, and their union will strike` : `Bus lane ${cost} · ${check.reason}` };
    return withForecast(ghost, { kind: "lane", a: selectedTown, b: to }, { label: "a bus lane", towns: [selectedTown, to] });
  }
  if (tool === "road" && roadChain(world, selectedTown, to)) {
    const check = checkPave(world, selectedTown, to);
    const cost = naira(paveCost(world, selectedTown, to));
    const keep = naira(paveUpkeepPerDay(world, selectedTown, to));
    const ghost = { from: selectedTown, to: end, ok: check.ok, label: check.ok ? `Pave ${cost} · carries ${paveGain()}× the traffic · +${keep}/day to keep` : `${cost} · ${check.reason}` };
    return withForecast(ghost, { kind: "pave", a: selectedTown, b: to }, { label: "paving", towns: [selectedTown, to] });
  }
  if (tool === "road") {
    const check = checkRoad(world, selectedTown, to, alignment);
    const plan = planRoad(world, selectedTown, to, alignment);
    if (!plan) return { from: selectedTown, to: end, ok: false, label: check.ok ? "" : check.reason };
    const other = planRoad(world, selectedTown, to, alignment === "direct" ? "cheapest" : "direct");
    // Said up front: a road takes no fares, and costs its upkeep every day
    // (step 5). It pays in who it lets travel -- and only in money once you
    // run something on it (playtest, day 31: two roads drained the funds
    // and earned nothing).
    const keep = naira(upkeepFor(world.tuning, plan.length, plan.bridgeCells, false));
    const label = `${alignment === "direct" ? "Direct road" : "Road"} ${naira(plan.cost)} + ${keep}/day to keep${roadWhy(plan, selectedTown, to)}${otherWay(plan, other)} · ${riders} · earns no fares itself: run a bus on it`;
    const ghost = { from: selectedTown, to: end, ok: check.ok, line: plan.polyline, label: check.ok ? label : `${naira(plan.cost)} · ${check.reason}` };
    return withForecast(ghost, { kind: "road", a: selectedTown, b: to, alignment }, { label: "the road", towns: [selectedTown, to] });
  }
  if (tool === "track") {
    const check = checkTrack(world, selectedTown, to, alignment);
    if (trackAction(world, selectedTown, to) === "restore") {
      const label = `Restore the old line ${naira(restoreCost(world, selectedTown, to))} · built for export: it stops nowhere between`;
      const ghost = { from: selectedTown, to: end, ok: check.ok, label: check.ok ? label : check.reason };
      return withForecast(ghost, { kind: "track", a: selectedTown, b: to, alignment }, { label: "restoring", towns: [selectedTown, to] });
    }
    const plan = planRail(world, selectedTown, to, alignment);
    if (!plan) return { from: selectedTown, to: end, ok: false, label: check.ok ? "" : check.reason };
    const other = planRail(world, selectedTown, to, alignment === "direct" ? "cheapest" : "direct");
    const label = `${alignment === "direct" ? "Direct track" : "Track"} ${naira(plan.cost)}${roadWhy(plan, selectedTown, to)}${otherWay(plan, other)} · ${riders}`;
    const ghost = { from: selectedTown, to: end, ok: check.ok, line: plan.polyline, label: check.ok ? label : `${naira(plan.cost)} · ${check.reason}` };
    return withForecast(ghost, { kind: "track", a: selectedTown, b: to, alignment }, { label: "track", towns: [selectedTown, to] });
  }
  if (tool === "train") {
    const check = checkTrain(world, selectedTown, to);
    const path = railPath(world, selectedTown, to)?.nodeIds;
    const along = path ? `${Math.round(demandAlong(world, selectedTown, to, path) * SECONDS_PER_GAME_DAY)} riders/day want trips along it` : "";
    const line = lineSlots(world, selectedTown, to);
    const slots = path ? ` · line ${line.used + 1} of ${line.slots} trains` : "";
    const label = `Train ${naira(world.tuning.trainPurchaseCost)} · ${along}${slots}`;
    const ghost = { from: selectedTown, to: end, ok: check.ok, path: shownPath(check, path), rail: true, label: refusedOr(check, label, `Train ${naira(world.tuning.trainPurchaseCost)}`) };
    return withForecast(ghost, { kind: "train", a: selectedTown, b: to }, { label: "a train", towns: [selectedTown, to] });
  }
  if (tool === "freight") {
    const check = checkFreight(world, selectedTown, to);
    const goods = goodsAlong(world, selectedTown, to, true);
    const line = lineSlots(world, selectedTown, to);
    const label = `Freight train ${naira(world.tuning.freightPurchaseCost)} · goods along the track: ${Math.round(goods.outbound)} t/day out, ${Math.round(goods.inbound)} back · line ${line.used + 1} of ${line.slots} trains`;
    const path = shownPath(check, railPath(world, selectedTown, to)?.nodeIds);
    const ghost = { from: selectedTown, to: end, ok: check.ok, path, rail: true, label: refusedOr(check, label, `Freight train ${naira(world.tuning.freightPurchaseCost)}`) };
    return withForecast(ghost, { kind: "freight", a: selectedTown, b: to }, { label: "a freight train", towns: [selectedTown, to] });
  }
  if (tool === "lorry") {
    const check = checkLorry(world, selectedTown, to);
    // Both ways, because that's the decision: a lorry runs full only where goods go each way.
    const goods = goodsAlong(world, selectedTown, to);
    const label = `Lorry ${naira(world.tuning.lorryPurchaseCost)} · goods along it: ${Math.round(goods.outbound)} t/day out, ${Math.round(goods.inbound)} back`;
    const path = shownPath(check, roadPath(world, selectedTown, to)?.nodeIds);
    const ghost = { from: selectedTown, to: end, ok: check.ok, path, label: refusedOr(check, label, `Lorry ${naira(world.tuning.lorryPurchaseCost)}`) };
    return withForecast(ghost, { kind: "lorry", a: selectedTown, b: to }, { label: "a lorry", towns: [selectedTown, to] });
  }
  // A bus, a minibus or a BRT bus: the same preview, the vehicle named and priced.
  const mini = tool === "minibus";
  const brt = tool === "brt";
  const vehicle = brt ? "BRT bus (80 seats, lane only)" : mini ? "Minibus" : "Bus";
  const check = brt ? checkBrt(world, selectedTown, to) : mini ? checkMinibus(world, selectedTown, to) : checkBus(world, selectedTown, to);
  const price = naira(brt ? world.tuning.brtPurchaseCost : mini ? world.tuning.minibusPurchaseCost : world.tuning.busPurchaseCost);
  // Every trip along its road, not just the two towns clicked: a bus from
  // Ilase to Ikole carries Ilase-Kuto and Kuto-Ikole riders too.
  const along = `${Math.round(demandAlong(world, selectedTown, to) * SECONDS_PER_GAME_DAY)} riders/day want trips along it`;
  // Drawn along the road it would take, not straight across: a bus to Ikole
  // from Ilase goes through Kuto.
  const path = shownPath(check, roadPath(world, selectedTown, to)?.nodeIds);
  const ghost = { from: selectedTown, to: end, ok: check.ok, path, label: refusedOr(check, `${vehicle} ${price} · ${along}`, `${vehicle} ${price}`) };
  return withForecast(ghost, { kind: brt ? "brt" : mini ? "minibus" : "bus", a: selectedTown, b: to }, { label: brt ? "a BRT bus" : mini ? "a minibus" : "a bus", towns: [selectedTown, to] });
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
  const t = world.tuning;
  const on = <T,>(enabled: boolean, ...items: T[]): T[] => (enabled ? items : []);
  toolbar.replaceChildren(
    group(
      "On roads",
      "road",
      button("Bus", "B", tool === "bus", () => setTool("bus")),
      button("Minibus", "M", tool === "minibus", () => setTool("minibus")),
      ...on(world.lanes.length > 0, button("BRT", "X", tool === "brt", () => setTool("brt"))),
      ...on(t.goodsEnabled, button("Lorry", "L", tool === "lorry", () => setTool("lorry"))),
    ),
    ...on(
      t.railEnabled,
      group(
        "On rail",
        "rail",
        button("Train", "T", tool === "train", () => setTool("train")),
        ...on(t.goodsEnabled, button("Freight", "G", tool === "freight", () => setTool("freight"))),
      ),
    ),
    group("Build", "build", button("Road", "R", tool === "road", () => setTool("road")), ...on(t.railEnabled, button("Track", "K", tool === "track", () => setTool("track")))),
    ...on(t.straightAlignmentEnabled, group(t.railEnabled ? "Line (road, track)" : "Line", "setting", lineSwitch)),
    ...on(t.wearEnabled, group("Upkeep", "setting", button("Fix", "F", tool === "fix", () => setTool("fix")))),
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

// The headline (docs/brief.md, What doing well means): trips made a day,
// stayed home split into no road and no seat, your riders, and the budget
// with its 5-day net. Chips with counts (design lab, "the brief, step 8"):
// each is its own key, and each carries one number.
function renderStrip(): void {
  const h = averageHeadline(world);
  const net = averageNet(world);
  const n = (x: number) => Math.round(x).toLocaleString();
  const signed = (x: number) => `${x < 0 ? "−" : "+"}₦${Math.abs(Math.round(x)).toLocaleString()}`;
  // The score beside the money, marked like it (brief, After the ladder's
  // playtest, 2): trips made with its trend over TREND_DAYS and a sparkline,
  // and the people the region has gained since day 1.
  const trend = tripsTrend(world);
  const change = trend && Math.abs(trend.change) >= 1
    ? `<span class="trend ${trend.change > 0 ? "good" : "bad"}" title="Change over the last ${TREND_DAYS} days (5-day averages)">${trend.change > 0 ? "▲" : "▼"} ${n(Math.abs(trend.change))}</span>`
    : "";
  const people = peopleSinceStart(world);
  const k = (x: number) => `${x < 0 ? "−" : "+"}${Math.abs(Math.round(x)).toLocaleString()}k`;
  strip.innerHTML = `
    <div class="stat"><span class="k">Day</span><span class="v">${gameDay(world)}</span></div>
    <div class="stat"><span class="k">Budget</span><span class="v ${world.economy.funds < 0 ? "bad" : ""}">${naira(world.economy.funds)}</span></div>
    <div class="stat"><span class="k" title="Income less running costs and upkeep, a day, over the last 5 days">Net, 5-day average</span><span class="v ${net < 0 ? "bad" : "good"}">${signed(net)}</span></div>
    <div class="stat"><span class="k" title="Trips between towns that happened, by anyone, a day: 5-day average">Trips made, a day</span><span class="v">${n(h.tripsPerDay)}${change}${trend ? sparkline(trend.series) : ""}</span></div>
    <div class="stat"><span class="k" title="People the towns have gained since day 1, thousands: towns that shrank count against it, new towns count whole">People, since day 1</span><span class="v ${people <= -0.5 ? "bad" : people >= 0.5 ? "good" : ""}">${k(people)}</span></div>
    <div class="chips">
      <span class="chip" title="Trips your vehicles carried, a day"><b style="background:var(--player)"></b>Your riders <span class="num">${n(h.yourRidersPerDay)}</span></span>
      <span class="chip" title="Trips danfos, kekes and okadas carried, a day"><b style="background:var(--danfo)"></b>Informal <span class="num">${n(h.tripsPerDay - h.yourRidersPerDay)}</span></span>
      <span class="chip hatch" title="Stayed home: no road joins their towns. Falls when you build."><b></b>No road <span class="num">${n(h.noRoadPerDay)}</span></span>
      <span class="chip" title="Stayed home: a road joins their towns, but nobody carried them. Falls when you run vehicles."><b style="background:var(--home)"></b>No seat <span class="num">${n(h.noSeatPerDay)}</span></span>
    </div>`;
}

/** Trips made since day 1, as a line the width of a word: the shape, not the numbers. */
function sparkline(series: number[]): string {
  const width = 56;
  const height = 18;
  const shown = series.slice(-60);
  const lo = Math.min(...shown);
  const hi = Math.max(...shown);
  const span = Math.max(hi - lo, hi * 0.05, 1); // a flat line stays flat, not stretched to fill
  const points = shown
    .map((value, i) => `${((i / Math.max(1, shown.length - 1)) * width).toFixed(1)},${(height - 2 - ((value - lo) / span) * (height - 4)).toFixed(1)}`)
    .join(" ");
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline points="${points}" /></svg>`;
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
    return `<p class="callout"><span class="k">The problem here</span>No road reaches ${townName(townId)}. Its people want to make ${total} trips a day and every one stays home. Build a road (<kbd>R</kbd>): the biggest trip is to ${townName(biggest.to)}, ${perDay(biggest.demand)}/day.</p>`;
  }
  return `<p class="callout"><span class="k">The problem here</span>${stranded.length} of ${townName(townId)}'s trips have no road at all (dashed lines). The biggest is to ${townName(biggest.to)}, ${perDay(biggest.demand)}/day.</p>`;
}

// A line that passes the town without stopping, said where the player looks
// at the town: what a halt would cost and how to build one.
function haltText(townId: string, name: string): string {
  const site = haltSite(world, townId);
  if (!site) return "";
  const out = world.railOutOfService.has(site.segmentId) ? "the old line, out of service, " : "a railway ";
  return `<p class="townshare"><b>Rail:</b> ${out}passes ${site.distance.toFixed(0)} cells from ${name} without stopping. A halt brings it in for ${naira(haltCost(world, site))} (Track tool, <kbd>K</kbd>: click ${name} twice).</p>`;
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
  // Shrinking, it says why and what would stop it (brief, Revision 2, step 1).
  const shrink = trend === "shrinking" ? shrinkCause(world, townId) : null;
  if (shrink) return `<p class="callout hook"><span class="k">Why it's shrinking</span><b>${name} is ${heading}:</b> ${shrink.why}.${shrink.move ? ` ${moveText(shrink.move)}` : ""}</p>`;
  return `<p class="townshare"><b>${name} is ${heading}.</b> ${why}</p>`;
}

/** A named move as the screen says it: what, and its price. Named, not bought: the player does it (brief, Information design). */
function moveText(move: NamedMove): string {
  return `<b>${move.label}</b>${move.price > 0 ? ` · ${naira(move.price)}` : ""}`;
}

// The town card (design lab, "the brief, step 8"): a kicker, the name, three
// lines, the one problem here, then its trips. Its first screen fits without
// scrolling (brief, text budget).
// An industrial site's card (brief, Revision 2): what it is and for how
// long, where its stone goes and how much of it arrives, and the one
// problem with it -- no road, or nothing moved and the day it closes.
function renderIndustry(townId: string): void {
  const site = world.towns.get(townId)!;
  const industry = world.industries.get(townId);
  const flows = industryFlows(world).filter((flow) => flow.from === townId);
  const perDay = (rate: number) => Math.round(rate * SECONDS_PER_GAME_DAY);
  const rows = flows
    .map((flow) => {
      const outcome = world.goods.outcomes.get(flowKey(flow));
      const total = (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0) + (outcome?.spoiled ?? 0);
      const delivered = total > 0 ? (outcome?.delivered ?? 0) / total : 0;
      const trucked = total > 0 ? (outcome?.trucked ?? 0) / total : 0;
      return `<div class="trip"><span class="name">${townName(flow.to)}${flow.to === world.port ? " <span class=\"muted\">· the port</span>" : ""}</span><span class="num">${perDay(flow.rate)} t/day</span><div class="bar"><i style="width:${pct(delivered)};background:var(--goods)"></i><i style="width:${pct(trucked)};background:var(--danfo)"></i></div></div>`;
    })
    .join("");
  const now = world.economy.elapsedSeconds;
  const kicker = industry ? `Quarry · opened day ${gameDay(world, industry.openedAtSeconds)} · works out about day ${gameDay(world, industry.closesAtSeconds)}` : "Quarry";
  const biggest = [...flows].sort((p, q) => q.rate - p.rate)[0];
  let problem = "";
  if (isCutOff(world, townId)) {
    // From the nearest town a road already reaches: a spur from a cut-off town connects nothing.
    const near = [...world.towns.values()].filter((t) => !t.industry && !isCutOff(world, t.id)).sort((p, q) => Math.hypot(p.x - site.x, p.y - site.y) - Math.hypot(q.x - site.x, q.y - site.y))[0];
    problem = `No road reaches it. Build one (<kbd>R</kbd>)${near ? ` from ${townName(near.id)}` : ""} and its stone can move.`;
  } else if (industry && industry.deliveredEMA * SECONDS_PER_GAME_DAY < world.tuning.industryMinDeliveredPerDay) {
    const closes = industry.openedAtSeconds + world.tuning.industryGraceDays * SECONDS_PER_GAME_DAY;
    problem = `Nothing is moving its stone${closes > now ? `: it closes on day ${gameDay(world, closes)} unless something does` : ""}. Run a lorry (<kbd>L</kbd>)${biggest ? ` to ${townName(biggest.to)}` : ""}, or a freight train on track.`;
  }
  routesEl.innerHTML = `
    <div class="town-card">
      <div class="k">${kicker}</div>
      <div class="title">${site.name}</div>
      <ul>
        <li>${world.tuning.quarryOutputPerDay} t of stone a day. Stone feeds construction: a town that gets the stone it wants can grow more.</li>
        <li>${world.tuning.truckersEnabled ? "Truckers take what you don't on short hauls (yellow on each bar); the rest is lost." : "Nobody else carries it: what isn't moved is lost."}</li>
      </ul>
      ${problem ? `<p class="callout hook"><span class="k">The problem here</span>${problem}</p>` : ""}
      ${rows}
    </div>`;
}

function renderTown(townId: string): void {
  const town = world.towns.get(townId)!;
  if (town.industry) return renderIndustry(townId);
  const share = townShare(world, townId);
  const trips = tripsFrom(world, townId);
  const perDay = (n: number) => Math.round(n * SECONDS_PER_GAME_DAY);
  const rows = trips
    .slice(0, 5)
    .map((trip) => {
      const s = trip.share;
      const bar = s.player + s.informal + s.lost > 0
        ? `<i style="width:${pct(s.player)};background:var(--player)"></i><i style="width:${pct(s.informal)};background:var(--danfo)"></i><i style="width:${pct(s.lost)};background:var(--home)"></i>`
        : "";
      return `
        <div class="trip${trip.reachable ? "" : " cut"}">
          <span class="name">${townName(trip.to)}${trip.reachable ? "" : " <span class=\"muted\">· no road</span>"}</span>
          <span class="num">${perDay(trip.demand)}/day</span>
          <div class="bar">${bar}</div>
        </div>`;
    })
    .join("");
  const role = world.settlement.emergent.has(townId) ? "Grew on the road" : townId === world.port && world.tuning.goodsEnabled ? "Port" : town.population >= world.tuning.marketPopulation ? "Market town" : "Farm town";
  const trend = growthTrend(world, townId);
  const kicker = `${role} · ${Math.round(town.population)}k people${trend === "growing" ? " · ▲ growing" : trend === "shrinking" ? " · ▼ shrinking" : ""}`;
  const biggest = trips[0];
  const biggestLine = biggest
    ? `Biggest trip: ${townName(biggest.to)}, ${perDay(biggest.demand)}/day${biggest.share.player >= 0.005 ? `; you carry ${pct(biggest.share.player)}` : ""}`
    : "";
  const local = localTravel(world, townId);
  const pagerTowns = [...world.towns.keys()];
  const index = pagerTowns.indexOf(townId);
  const prev = pagerTowns[(index - 1 + pagerTowns.length) % pagerTowns.length]!;
  const next = pagerTowns[(index + 1) % pagerTowns.length]!;
  routesEl.innerHTML = `
    <div class="town-card">
      <div class="k">${kicker}</div>
      <div class="title">${town.name}</div>
      <ul>
        ${biggestLine ? `<li>${biggestLine}</li>` : ""}
        <li>Of its trips: you ${pct(share.player)}, informal ${pct(share.informal)}, stayed home ${pct(share.lost)}.${changingText(townId)}</li>
        <li>Inside: ~${Math.round(local.tripsPerDay).toLocaleString()} short trips a day by keke and okada, not counted against you.</li>
      </ul>
      ${strikeBadge(laneAtTown(townId))}
      ${problemText(townId)}
      ${growthText(townId, town.name)}
      ${world.tuning.railEnabled ? haltText(townId, town.name) : ""}
      ${world.tuning.goodsEnabled ? goodsText(townId) : ""}
      ${rows}
      <div class="pager">
        <button data-select="${prev}">‹ ${townName(prev)}</button>
        <span class="dots">${pagerTowns.map((id) => `<i class="${id === townId ? "on" : ""}"></i>`).join("")}</span>
        <button data-select="${next}">${townName(next)} ›</button>
      </div>
    </div>`;
}

// A rung you can't afford yet: name it as your project, and the treasury
// leaves what you hold toward it alone for a while (project.ts).
function saveButton(full: { next: string; road?: { a: string; b: string } }): string {
  if ((full.next !== "lane" && full.next !== "rail") || !full.road) return "";
  const rung = full.next as ProjectRung;
  const price = rungPrice(world, full.road.a, full.road.b, rung);
  const p = world.project;
  if (p && p.a === full.road.a && p.b === full.road.b && p.rung === rung) return "";
  if (!Number.isFinite(price) || price <= world.economy.funds) return "";
  return `<span class="actions"><button data-project="${full.road.a}|${full.road.b}|${rung}" title="The treasury leaves what you hold toward it alone for ${world.tuning.projectLapseDays} days">Save for it: ${naira(price)}</button></span>`;
}

// The one problem here, named: no road reaches it, some of its trips have
// none, its road is full (it's grown to what its rung allows), or a road but
// no seat. Nothing when it's well served.
function problemText(townId: string): string {
  const stranded = reachNote(townId);
  if (stranded) return stranded;
  const full = roadFull(world, townId);
  if (full?.thin) {
    return `<p class="callout hook"><span class="k">The problem here</span>${townName(townId)} is as big as this road supports; traffic here is too thin for a bus lane.</p>`;
  }
  if (full) {
    const name = townName(townId);
    const next = full.next === "paved" ? "Pave its road (R)" : full.next === "lane" ? "A bus lane on its road (R)" : "Rail (K: restore the old line or lay track, then T for trains)";
    return `<p class="callout hook"><span class="k">The problem here</span>${name} can't grow: its road is full. ${next} to grow further.${saveButton(full)}</p>`;
  }
  // A worn road your vehicles pay for (brief, Revision 2: wear per corridor).
  const worn = wornRoadAt(world, townId);
  if (worn) {
    return `<p class="callout hook"><span class="k">The problem here</span>Its road ${townName(worn.a)}–${townName(worn.b)} is worn: ${pct(worn.speed)} speed, costing your vehicles ${naira(worn.roughPerDay)}/day. Keep it up from its row under Corridors (repair now ${naira(worn.move.price)}).</p>`;
  }
  // No seat, with where and the move (brief, Revision 2, step 1): it used to
  // say only "N% ... nobody carried them" -- no corridor, no move.
  const seat = townNoSeat(world, townId);
  if (!seat) return "";
  const other = seat.worst.a === townId ? seat.worst.b : seat.worst.a;
  const road = seat.corridor ? ` on the ${townName(seat.corridor.a)}–${townName(seat.corridor.b)} road` : " by rail";
  return `<p class="callout hook"><span class="k">The problem here</span>${Math.round(seat.perDay)} of its trips a day find no seat, most toward ${townName(other)}${road}. ${moveText(seat.move)}</p>`;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

// A train route's reasons are a bus route's with the vehicle renamed: the
// diagnosis is the same passenger model (rail.ts), only the vehicle differs.
function forVehicle(text: string, routeId: string): string {
  const [one, many] = isRailRoute(routeId) ? ["train", "trains"] : isMinibusRoute(routeId) ? ["minibus", "minibuses"] : isBrtRoute(routeId) ? ["BRT bus", "BRT buses"] : [null, null];
  if (!one || !many) return text;
  return text
    .replace(/\bBuses\b/g, many.charAt(0).toUpperCase() + many.slice(1))
    .replace(/\bbuses\b/g, many)
    .replace(/\bbus\b/g, one);
}

/** "2 buses", "1 minibus", "3 trains". */
function vehicleCount(routeId: string, n: number): string {
  if (isRailRoute(routeId)) return `${n} train${n === 1 ? "" : "s"}`;
  if (isMinibusRoute(routeId)) return `${n} minibus${n === 1 ? "" : "es"}`;
  if (isBrtRoute(routeId)) return `${n} BRT bus${n === 1 ? "" : "es"}`;
  return `${n} bus${n === 1 ? "" : "es"}`;
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
      const rough = worn.reduce((sum, r) => sum + r.roughPerDay, 0);
      // The decision in two numbers: what the wear costs you, what keeping it up would.
      const verdict = rough > upkeep ? "worth it" : "more than the wear costs you";
      return `Worn roads${roads ? ` (${roads})` : ""} cost your buses ${naira(rough)}/day extra to run and hold them to ${pct(d.wornSpeed)} speed. Maintaining them (Fix tool, F) costs about ${naira(upkeep)}/day: ${verdict}. Paved roads wear a third as fast.`;
    }
    case "long": {
      // Full, yet a full bus loses: another would too. Say why, and what to do instead.
      const shorter = d.shorter
        ? ` End it at ${townName(d.shorter.b)} instead (${townName(d.shorter.a)} ↔ ${townName(d.shorter.b)}): about ${d.shorter.roundTripsPerDay.toFixed(1)} round trips a day.`
        : " Sell it and put the bus on a shorter route.";
      return `Too long for its fares: even full, a bus here takes ${naira(d.incomePerVehicle)}/day against ${naira(d.costPerVehicle)} to run, because it makes only ${d.roundTripsPerDay.toFixed(1)} round trips a day. Another bus would lose money too.${shorter}`;
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

// Your routes as cards (design lab, "the brief, step 8"): what it runs and
// its money, the pair, a verdict of at most 12 words naming one lever
// (verdicts.ts; the long reason on hover), and where its riders went.
function routeCard(s: ReturnType<typeof routeSummaries>[number]): string {
  const index = world.routes.findIndex((route) => route.id === s.id);
  const d = diagnoseRoute(world, s.id);
  const vehicle = isRailRoute(s.id) ? "train" : isMinibusRoute(s.id) ? "minibus" : isBrtRoute(s.id) ? "BRT bus" : "bus";
  const dirt = d ? dirtRoadsOn(world, s.id)[0] : undefined;
  const through = d?.verdict === "thin" ? throughRoute(world, s.id) : null;
  const verdict = d
    ? shortVerdict({
        verdict: d.verdict,
        vehicle,
        netPerDay: s.netPerDay,
        dirtRoad: dirt ? `${townName(dirt.a)}–${townName(dirt.b)}` : null,
        throughTo: through ? townName([through.a, through.b].find((t) => t !== s.a && t !== s.b) ?? through.b) : null,
      })
    : "Just started: give it a day.";
  const long = d ? forVehicle(reasonText(d, s.buses, s.costPerDay, s.netPerDay), s.id).replace(/<[^>]+>/g, "") : "";
  const bar = d
    ? `<div class="bar" title="you / informal took them from your stop / gave up, then informal / stayed home">
        <i style="width:${pct(d.carried)};background:var(--player)"></i>
        <i style="width:${pct(d.poached)};background:var(--danfo)"></i>
        <i style="width:${pct(d.gaveUp)};background:var(--danfo-light)"></i>
        <i style="width:${pct(d.lost)};background:var(--home)"></i>
      </div>`
    : "";
  const signed = `${s.netPerDay < 0 ? "−" : "+"}₦${Math.abs(Math.round(s.netPerDay)).toLocaleString()}`;
  return `
    <div class="route-card" title="${long.replace(/"/g, "&quot;")}">
      <div class="top"><span class="k">${vehicleCount(s.id, s.buses)} · in ${naira(s.incomePerDay)} · cost ${naira(s.costPerDay)}</span><span class="net ${s.netPerDay < 0 ? "bad" : "good"}">${signed}/day</span></div>
      <div class="name"><span class="swatch" style="background:${routeColor(index)}"></span>${townName(s.a)} ↔ ${townName(s.b)}${isRailRoute(s.id) ? " <span class=\"muted\">by rail</span>" : ""}
        <span class="buttons"><button data-add="${s.id}" title="Add one">+</button><button data-remove="${s.id}" title="Sell one">−</button></span></div>
      ${strikeBadge(laneAlongRoute(s.a, s.b))}
      <div class="verdict why-${d?.verdict ?? "healthy"}">${verdict}</div>
      ${bar}
      ${dev && d ? `<small>${forVehicle(`${Math.round(d.boardingsPerDay)} riders/day · buses ${pct(d.loadFactor)} full · ${pct(d.speed)} speed · ceiling ${naira(d.ceilingPerDay)}/day`, s.id)}</small>` : ""}
    </div>`;
}

// A laned corridor's strike, as a badge on the cards that touch it (playtest:
// "did a strike land? I couldn't tell"): on strike; called for a day; or,
// for STRIKE_MARK_DAYS after, what the last one cost.
const STRIKE_MARK_DAYS = 5;
function strikeBadge(lane: LaneState | undefined): string {
  if (!lane) return "";
  const now = world.economy.elapsedSeconds;
  const corridor = `${townName(lane.a)} – ${townName(lane.b)}`;
  if (lane.strikeUntil > now) return `<div class="strike-badge on">On strike until day ${gameDay(world, lane.strikeUntil)} · ${corridor}</div>`;
  if (lane.strikeAt > now) {
    // Always a way out, right here (playtest: "I can't tell what I can do").
    const key = `${lane.a}|${lane.b}`;
    const relax = lane.enforcement === "strict" && lane.announcedStrict ? `<button data-relax="${key}" title="No wardens: danfos creep back into the lane, and the strike is off">Relax enforcement</button>` : "";
    const settle = `<button data-settle="${key}" title="Pay the union to call it off">Settle ${naira(settlementPrice(world, lane))}</button>`;
    return `<div class="strike-badge called">Strike called for day ${gameDay(world, lane.strikeAt)} · ${corridor}<span class="actions">${relax}${settle}</span></div>`;
  }
  const last = lane.lastStrike;
  if (last && now - last.endedAt < STRIKE_MARK_DAYS * SECONDS_PER_GAME_DAY) {
    return `<div class="strike-badge past">Struck day ${gameDay(world, last.startedAt)}${strikeCostText(last.cost)}</div>`;
  }
  return "";
}

/** " · cost ₦X", " · no loss to you", or nothing when there's no estimate. */
function strikeCostText(cost: number | null): string {
  if (cost === null) return "";
  return cost < 1 ? " · no loss to you" : ` · cost ${naira(cost)}`;
}

/** The laned corridor a route runs along, if any. */
function laneAlongRoute(a: string, b: string): LaneState | undefined {
  if (world.lanes.length === 0) return undefined;
  const by = lanesBySegment(world);
  return roadPath(world, a, b)?.segmentIds.map((id) => by.get(id)).find((lane) => lane !== undefined);
}

/** A laned corridor that runs through a town, if any. */
function laneAtTown(townId: string): LaneState | undefined {
  if (world.lanes.length === 0) return undefined;
  const by = lanesBySegment(world);
  for (const segment of world.simulation.map.segments) {
    if (segment.fromNodeId !== townId && segment.toNodeId !== townId) continue;
    const lane = by.get(segment.id);
    if (lane) return lane;
  }
  return undefined;
}

// The budget breakdown (docs/brief.md, Information design): each line a
// day, over the same 5 days as the strip's net, so the lines sum to it. Then
// the treasury, which takes its share every 10 days and isn't a running cost.
function budgetHtml(): string {
  const b = averageBudget(world);
  const signed = (x: number) => `${x < 0 ? "−" : "+"}₦${Math.abs(Math.round(x)).toLocaleString()}`;
  const lines: Array<[string, number]> = [
    ["Fares", b.fares],
    ...(world.tuning.goodsEnabled ? [["Goods", b.goods] as [string, number]] : []),
    ["Tolls", b.tolls],
    [`Park levies <span class="muted">(agberos kept ${naira(b.agberos)})</span>`, b.levies],
    ...(world.tuning.truckersEnabled && world.tuning.goodsEnabled ? [[`Loading levies <span class="muted">(touts kept ${naira(b.touts)})</span>`, b.loading] as [string, number]] : []),
    ["State allocation", b.allocation],
    ["Running costs", -b.running],
    ["Road upkeep", -b.upkeep],
    ...(world.lanes.length > 0 ? [["Lane enforcement", -b.enforcement] as [string, number]] : []),
  ];
  // Not money moved -- the fares and takings strikes kept from you -- so shown under the net, not in it.
  const struck = world.lanes.length > 0 ? `<span class="muted">Lost to strikes (estimated)</span><span class="num bad">${b.struck > 0.5 ? signed(-b.struck) : "₦0"}</span>` : "";
  const net = lines.reduce((sum, [, x]) => sum + x, 0);
  const t = world.tuning;
  const r = world.remittance;
  // The treasury inside the breakdown, no panel of its own (brief, After the
  // ladder's playtest, 1): what it last took, under the net (it isn't a
  // running cost), and what goes next unless you spend it or set it aside.
  const took = t.remittanceEnabled
    ? `<span class="muted">Treasury took${r.last ? `, day ${gameDay(world, r.last.atSeconds)}` : ""}</span><span class="num ${r.last && r.last.amount >= 1 ? "bad" : ""}">${r.last && r.last.amount >= 1 ? signed(-r.last.amount) : "₦0"}</span>`
    : "";
  const due = remittanceExpected(world, averageNet(world));
  const days = Math.max(0, Math.ceil((r.endsAtSeconds - world.economy.elapsedSeconds) / SECONDS_PER_GAME_DAY));
  const when = days <= 1 ? "tomorrow" : `in ${days} days`;
  const countdown = t.remittanceEnabled
    ? due >= 1
      ? `<p class="callout hook treasury"><span class="k">Treasury</span>About ${naira(due)} over the reserve goes to the treasury ${when}; spend it or set it aside.</p>`
      : `<p class="hint">Treasury: nothing over the ${naira(t.remittanceReserve)} reserve to take ${when}.</p>`
    : "";
  const project = world.project;
  const held = project ? heldForProject(world) : 0;
  const saving = project
    ? `<p class="callout hook"><span class="k">Saving for</span>The ${project.rung === "lane" ? "bus lane" : "rail line"} on ${townName(project.a)} – ${townName(project.b)}: ${naira(held)} of ${naira(project.price)} set aside, safe from the treasury until day ${gameDay(world, projectLapsesAt(world, project))}.
        <span class="bar project-bar" title="${pct(held / project.price)} set aside"><i style="width:${pct(Math.min(1, held / project.price))};background:var(--player)"></i></span>
        <span class="actions"><button data-drop-project="1">Drop it</button></span></p>`
    : "";
  return `${saving}<h2 class="section">Budget, a day</h2><p class="hint">5-day average.</p>
    <div class="budget">${lines.map(([label, x]) => `<span>${label}</span><span class="num ${x < 0 ? "bad" : ""}">${signed(x)}</span>`).join("")}
      <span class="total">Net</span><span class="total num ${net < 0 ? "bad" : "good"}">${signed(net)}</span>
      ${took}
      ${struck}
    </div>
    ${countdown}
    ${t.remittanceEnabled ? `<p class="hint">Every ${t.remittancePeriodDays} days the treasury takes ${pct(t.remittanceShare)} of funds above ${naira(t.remittanceReserve)}, never more than the period's surplus. Money set aside for a project is safe.</p>` : ""}`;
}

// Each corridor you run along: who carries its trips, and whether you've
// taken it from the informal sector, with what that cost (brief, After the
// ladder's playtest, 3). Corridors you don't run along stay off the list:
// the map's traffic already shows the danfos' roads.
function corridorsHtml(): string {
  // Where riders find no seat, worst first, each with the move that would
  // carry them (brief, Revision 2, step 1); then the rest you run along.
  const noSeat = corridorNoSeat(world);
  const seatOf = (key: string) => noSeat.get(key)?.perDay ?? 0;
  const shown = corridorSummaries(world)
    .filter((c) => c.takenSince !== null || c.you >= 0.005 || seatOf(c.key) >= NO_SEAT_MIN_PER_DAY)
    .sort((x, y) => seatOf(y.key) - seatOf(x.key) || Number(y.takenSince !== null) - Number(x.takenSince !== null) || y.you - x.you);
  if (shown.length === 0) return "";
  const target = world.tuning.corridorTakenShare;
  const rows = shown
    .map((c) => {
      const costs: string[] = [];
      if (c.leviesLostPerDay >= 1) costs.push(`levies ${naira(-c.leviesLostPerDay)}/day`);
      if (c.lastStrikeCost !== null) costs.push(c.lastStrikeCost < 1 ? "last strike no loss" : `last strike ${naira(-c.lastStrikeCost)}`);
      else if (c.takenSince !== null && !c.hasLane) costs.push("no pushback without a lane");
      const state = c.takenSince !== null
        ? `<span class="taken">Taken, day ${gameDay(world, c.takenSince)}</span>`
        : `<span class="muted">Taken at ${pct(target)}</span>`;
      const wear = world.tuning.wearEnabled ? wearLine(c.a, c.b) : "";
      const seat = noSeat.get(c.key);
      const seatLine = seat && seat.perDay >= NO_SEAT_MIN_PER_DAY
        ? `<div class="noseat">No seat ${Math.round(seat.perDay)}/day, most ${townName(seat.worst.a)} ↔ ${townName(seat.worst.b)}: ${moveText(seat.move)}</div>`
        : "";
      return `
        <div class="corridor">
          <div class="top"><span class="name">${townName(c.a)} – ${townName(c.b)}</span>${state}</div>
          <div class="bar" title="you / informal / stayed home"><i style="width:${pct(c.you)};background:var(--player)"></i><i style="width:${pct(c.informal)};background:var(--danfo)"></i><i style="width:${pct(c.lost)};background:var(--home)"></i></div>
          <div class="hint">You ${pct(c.you)} · informal ${pct(c.informal)}${costs.length > 0 ? ` · ${costs.join(" · ")}` : ""}</div>
          ${seatLine}
          ${wear}
        </div>`;
    })
    .join("");
  return `<h2 class="section">Corridors</h2><p class="hint">Where riders find no seat first, then the roads you run on.</p>${rows}`;
}

// A corridor's wear as one decision (brief, Revision 2: wear per corridor,
// never per piece): kept up, with what that costs a day; or how worn it is,
// what that costs your vehicles, and the two ways to answer it.
function wearLine(a: string, b: string): string {
  const wear = corridorWear(world, a, b);
  if (!wear) return "";
  const id = wear.pieceIds[0]!;
  if (wear.kept) return `<div class="wear">Kept up · ${naira(wear.upkeepPerDay)}/day <span class="actions"><button data-keep="${id}|0" title="Stop paying to keep it up: it starts wearing again">Stop</button></span></div>`;
  const state = wear.condition >= 0.97 ? "Sound" : `Worn: ${pct(wear.speed)} speed${wear.roughPerDay >= 1 ? ` · costs your vehicles ${naira(wear.roughPerDay)}/day` : ""}`;
  const fix = wear.repair >= 1 ? `<button data-fixnow="${id}" title="Repair all of it to new, once">Fix now ${naira(wear.repair)}</button>` : "";
  return `<div class="wear">${state} <span class="actions"><button data-keep="${id}|1" title="Repair it as it wears, billed as it goes${wear.repair >= 1 ? `; the catch-up repair (${naira(wear.repair)}) is charged now` : ""}">Keep it up ${naira(wear.upkeepPerDay)}/day</button>${fix}</span></div>`;
}

// Your share of trips between towns: one click down, not the headline
// (brief: as a headline it falls exactly when you grow towns).
function shareHtml(): string {
  const share = networkShare(world);
  return `<h2 class="section">Who carried trips between towns</h2>
    <div class="bar share-bar"><i style="width:${pct(share.player)};background:var(--player)"></i><i style="width:${pct(share.informal)};background:var(--danfo)"></i><i style="width:${pct(share.lost)};background:var(--home)"></i></div>
    <p class="hint">You ${pct(share.player)} · informal ${pct(share.informal)} · stayed home ${pct(share.lost)}</p>`;
}

function renderRoutes(): void {
  const summaries = routeSummaries(world);
  const advice = dev ? bestMovesHtml() + resultsHtml() : "";
  const header = `<h2>Your routes</h2><p class="hint">Worst first. Net over the last day; hover a card for why.</p>`;
  const routes = summaries.length === 0 && world.lorryRoutes.length === 0
    ? `${header}<p class="empty">No buses yet. Hover a town to see where its people want to go.</p>`
    : (summaries.length > 0 ? header + summaries.map(routeCard).join("") : "") + lorryRows(summaries.length > 0);
  routesEl.innerHTML = moneyNote() + advice + routes + corridorsHtml() + budgetHtml() + shareHtml();
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
  const dayOf = (seconds: number) => gameDay(world, seconds);
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
        <div class="why why-${d.verdict === "healthy" ? "healthy" : d.verdict === "full" ? "full" : d.verdict === "worn" ? "worn" : "thin"}">${forGoodsVehicle(lorryReason(d, s.costPerDay / s.lorries), s.id)}</div>
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
    case "worn": {
      const dirt = dirtRoadsOn(world, d.routeId);
      const pave = dirt.length > 0 ? ` Pave ${dirt.map((r) => `${townName(r.a)}–${townName(r.b)}`).join(", ")} (Road tool, click both towns): paved roads wear a third as fast.` : "";
      return `Worn roads cost your lorries ${naira(d.roughPerDay)}/day extra to run. Lorries wear roads hardest and pay most on worn ones; maintain them (Fix tool, F).${pave}`;
    }
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
/** "40 t/day of stone from Ilaro Quarry (35% delivered)", for a town a quarry ships to. */
function inboundStone(townId: string): string {
  const flows = industryFlows(world).filter((flow) => flow.to === townId);
  if (flows.length === 0) return "";
  const rate = flows.reduce((sum, flow) => sum + flow.rate, 0);
  return `${Math.round(rate * SECONDS_PER_GAME_DAY)} t/day of stone from ${flows.map((flow) => townName(flow.from)).join(", ")} (${pct(stoneServed(world, townId))} delivered)`;
}

function goodsText(townId: string): string {
  const goods = townGoods(world, townId);
  if (goods.length === 0) return "";
  const out = goods.filter((g) => g.outgoing);
  const inbound = goods.filter((g) => !g.outgoing && !world.towns.get(g.other)?.industry);
  const parts: string[] = [];
  for (const g of out) parts.push(`${Math.round(g.perDay)} t/day of ${g.kind} to ${townName(g.other)} (${pct(g.delivered)} delivered)`);
  const stone = inboundStone(townId);
  if (stone) parts.push(stone);
  const into = inbound.reduce((sum, g) => sum + g.perDay, 0);
  if (into > 0) {
    const delivered = inbound.reduce((sum, g) => sum + g.perDay * g.delivered, 0) / into;
    parts.push(`${Math.round(into)} t/day of goods coming in (${pct(delivered)} delivered)`);
  }
  return `<p class="townshare"><b>Goods:</b> ${parts.slice(0, 3).join("; ")}. ${world.tuning.truckersEnabled ? "Truckers take what you don't on short hauls; the rest spoils." : "Nobody else carries freight: what lorries don't take, spoils."}</p>`;
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
  // Mending first: a route that pays once its roads are kept up is worth keeping.
  const mend = advice.fix.length > 0
    ? ` First, mend before you sell: maintain the worn roads of ${advice.fix.map((f) => `${townName(f.a)} ↔ ${townName(f.b)}`).join(", ")} (Fix tool, F) — ${naira(advice.fix.reduce((sum, f) => sum + f.savesPerDay, 0))}/day better after upkeep, ${naira(advice.fix.reduce((sum, f) => sum + f.repair, 0))} to repair first.`
    : "";
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
  return `<p class="callout">${situation}${mend} ${exit}</p>`;
}

routesEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  // The named project: name it from a town's road-full line, or drop it.
  if (target.dataset.project) {
    const [a, b, rung] = target.dataset.project.split("|") as [string, string, ProjectRung];
    const result = act({ label: `saving for the ${rung === "lane" ? "bus lane" : "rail line"} on ${townName(a)} – ${townName(b)}`, towns: [a, b] }, (w) => nameProject(w, a, b, rung));
    say(result.ok ? `Saving for the ${rung === "lane" ? "bus lane" : "rail line"} on ${townName(a)} – ${townName(b)}: the treasury leaves it alone for ${world.tuning.projectLapseDays} days. Build it before then, or it lapses.` : `Can't: ${result.reason}`, !result.ok, 8);
    renderPanel();
    return;
  }
  if (target.dataset.dropProject) {
    dropProject(world);
    say("Project dropped: the treasury takes its usual share again.");
    renderPanel();
    return;
  }
  // A corridor's wear, from its row in the Corridors section.
  if (target.dataset.keep) {
    const [id, on] = target.dataset.keep.split("|") as [string, string];
    const name = roadName(id);
    const result = act({ label: on === "1" ? `keeping up ${name}` : `letting ${name} wear`, towns: roadTowns(id) }, (w) => setRoadMaintained(w, id, on === "1"));
    say(result.ok ? (on === "1" ? `Keeping up ${name}${result.charged > 0 ? `: ${naira(result.charged)} to repair it first` : ""}.` : `${capitalise(name)} will wear again.`) : `Can't: ${result.reason}`, !result.ok);
    renderPanel();
    return;
  }
  if (target.dataset.fixnow) {
    const id = target.dataset.fixnow;
    const name = roadName(id);
    const result = act({ label: `repairing ${name}`, towns: roadTowns(id) }, (w) => fixRoadNow(w, id));
    say(result.ok ? `Repaired ${name} to new for ${naira(result.charged)}. It wears again from here.` : `Can't: ${result.reason}`, !result.ok);
    renderPanel();
    return;
  }
  // A called strike's way out, from its badge.
  const settleKey = target.dataset.settle ?? target.dataset.relax;
  if (settleKey) {
    const [a, b] = settleKey.split("|") as [string, string];
    const lane = laneOn(world, a, b);
    if (!lane) return;
    if (target.dataset.settle) {
      const price = settlementPrice(world, lane);
      const result = act({ label: `settling with the union on ${townName(a)} – ${townName(b)}`, towns: [a, b] }, (w) => settleStrike(w, a, b));
      say(result.ok ? `Paid the union ${naira(price)}: the strike on ${townName(a)} – ${townName(b)} is off.` : `Can't settle (${naira(price)}): ${result.reason}`, !result.ok);
    } else {
      act({ label: `relaxing the ${townName(a)} – ${townName(b)} lane`, towns: [a, b] }, (w) => ({ ok: setEnforcement(w, a, b, "lax") }));
      say(`Wardens off the ${townName(a)} – ${townName(b)} lane: the strike will be called off, and danfos will creep back into it.`);
    }
    renderPanel();
    return;
  }
  // The town card's pager: the next town along, as if you'd clicked it.
  if (target.dataset.select) {
    selectedTown = target.dataset.select;
    hoverTown = null;
    renderPanel();
    return;
  }
  const moveIndex = target.dataset.move;
  if (moveIndex !== undefined) {
    const move = moves.list[Number(moveIndex)];
    if (!move) return;
    const result = act(move.spec, (w) => applyAction(w, move.action));
    if (result.ok) say(`${move.title}: bought for ${naira(move.price)}.${later}`);
    else say(`Can't: ${result.reason}`, true);
    renderPanel();
    return;
  }
  const addId = target.dataset.add;
  const removeId = target.dataset.remove;
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
    const mini = isMinibusRoute(addId);
    const brt = isBrtRoute(addId);
    const vehicle = train ? "train" : mini ? "minibus" : brt ? "BRT bus" : "bus";
    const spec = { label: addLabel(vehicle, route.vehicleIds.length + 1, route.a, route.b), towns: [route.a, route.b], routeId: addId };
    const result = act(spec, (w) => (train ? addTrain(w, route.a, route.b) : mini ? addMinibus(w, route.a, route.b) : brt ? addBrt(w, route.a, route.b) : addBus(w, route.a, route.b)));
    const price = train ? world.tuning.trainPurchaseCost : mini ? world.tuning.minibusPurchaseCost : brt ? world.tuning.brtPurchaseCost : world.tuning.busPurchaseCost;
    if (!result.ok) say(`Can't add ${vehicle} (${naira(price)}): ${result.reason}`, true);
  } else if (removeId && isLorryRoute(removeId)) {
    sell(removeId, isFreightRoute(removeId) ? "freight train" : "lorry", (w) => removeLorry(w, removeId));
  } else if (removeId) {
    sell(removeId, isRailRoute(removeId) ? "train" : isMinibusRoute(removeId) ? "minibus" : isBrtRoute(removeId) ? "BRT bus" : "bus", (w) => removeBus(w, removeId));
  }
  renderRoutes();
});

// --- Hints ---------------------------------------------------------------
// The six hints (hints.ts): one at a time, beside the town it's about, or
// over the toolbar when it's about no town. "Hints off" is remembered.

const HINTS_OFF_KEY = "slice:hints-off";
const hintsOff = (() => {
  try {
    return localStorage.getItem(HINTS_OFF_KEY) === "1";
  } catch {
    return false;
  }
})();
const hints = createHintState(hintsOff);

function renderHint(): void {
  const hint = updateHints(hints, world, hoverTown);
  if (!hint) {
    hintEl.hidden = true;
    return;
  }
  if (hintEl.dataset.id !== String(hint.id)) {
    hintEl.dataset.id = String(hint.id);
    hintEl.innerHTML = `<span>${hint.text}</span><button data-hint="close" title="Got it">×</button><button data-hint="off" title="No more hints">Hints off</button>`;
  }
  hintEl.hidden = false;
  const town = hint.town ? world.towns.get(hint.town) : undefined;
  if (town) {
    // Beside the town it's about: pointing at the map, not at a button.
    const p = toScreen(view, town.x, town.y);
    const r = townRadius(town, view);
    hintEl.classList.add("anchored");
    hintEl.style.left = `${Math.min(window.innerWidth - 340, p.x + r + 14)}px`;
    hintEl.style.top = `${Math.max(64, p.y - 18)}px`;
  } else {
    hintEl.classList.remove("anchored");
    hintEl.style.left = "";
    hintEl.style.top = "";
  }
}

hintEl.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).dataset.hint;
  if (action === "close") dismissHint(hints);
  else if (action === "off") {
    hints.off = true;
    try {
      localStorage.setItem(HINTS_OFF_KEY, "1");
    } catch {
      // Off for this game only.
    }
  }
  renderHint();
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
        if (dev) for (const receipt of tickReceipts(world, book, dt)) say(receiptLine(receipt), receipt.moneyPerDay < -5, 8);
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
  // Every frame: a hint pinned to a town follows it, and hovering dismisses hint 1 at once.
  renderHint();
  requestAnimationFrame(frame);
}

renderToolbar();
resize(); // again, now the toolbar exists to be measured
renderStrip();
renderPanel();
// The hints take the start from here (hint 1); the developer view keeps the old line.
if (dev) say("Danfos, kekes and okadas are already carrying your passengers. Click a town, then another, to run a bus.");
requestAnimationFrame(frame);
