import { aWeekOnText, termVerdictText } from "@engine/game/term";
import { Accumulator, SIM_DT } from "@engine/loop";
import { gameTick } from "@engine/game/tick";
import {
  checkBus,
  checkPave,
  checkRoad,
  gameDay,
  debtAdvice,
  demandAlong,
  diagnoseRoute,
  checkBrt,
  brtRouteId,
  isBrtRoute,
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
  paveCost,
  roadCost,
  roadPath,
  routeSummaries,
  throughRoute,
  townShare,
  tripsFrom,
} from "@engine/game/world";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import { planRoad, segmentPolyline, type Alignment, type RoadPlan } from "@engine/game/roads";
import { corridorWear, roughCostPerDay, upkeepPerDay, wearSpeed } from "@engine/game/wear";
import { createReceiptBook, perform, tickReceipts, RECEIPT_SECONDS, type Receipt, type ReceiptSpec } from "@engine/game/receipts";
import { growthTrend, roadFull, townGrowth } from "@engine/game/growth";
import { checkHalt, checkTrack, checkTrain, haltCost, haltSite, isRailRoute, planRail, railPath, railRouteId, restoreCost, trackAction, lineSlots, onRoadCost, trackCost } from "@engine/game/rail";
import { checkFreight, findLorryRoute, freightRouteId, isFreightRoute, lorryRouteId } from "@engine/game/goods";
import { checkLorry, diagnoseLorryRoute, flowKey, goodsAlong, goodsFlows, isLorryRoute, lorryEstimate, lorrySummaries, townGoods, type LorryDiagnosis } from "@engine/game/goods";
import type { RouteDiagnosis } from "@engine/game/world";
import type { GameEvent } from "@engine/game/settlement";
import { GAME_MAP } from "./map";
import { DEFAULT_GAME_TUNING } from "@engine/game/tuning";
import type { ForecastLine } from "./render";
import { applyAction, type ActionOutcome, type ActionSpec } from "@engine/game/actions";
import { createRunRecorder, recordAction, recordTick, runFile, startRunSteps, type RunSwitches } from "@engine/game/runlog";
import { vehicleMoves } from "@engine/game/moves";
import { paveUpkeepPerDay, upkeepFor } from "@engine/game/upkeep";
import { isDirt } from "@engine/game/congestion";
import { heldForProject, projectLapsesAt, rungPrice, type ProjectRung } from "@engine/game/project";
import { remittanceExpected } from "@engine/game/budget";
import { carryOver, sweepDue } from "@engine/game/sweep";
import { checkYard, hasYard, yardGain } from "@engine/game/yards";
import { yardWouldBring } from "@engine/game/haulage";
import { checkPark, parkLevyGain, parkReport } from "@engine/game/parks";
import { checkMetro, metroLines, metroPrice, metroRiders } from "@engine/game/metro";
import { freightLineSplit, freightRate, type FreightRate } from "@engine/game/freightrates";
import { corridorSummaries } from "@engine/game/corridors";
import { industryFlows, stoneServed } from "@engine/game/industries";
import { exportGateway, nextPortRung, portScale, seaportLink } from "@engine/game/gateways";
import { cargoName, crudeArriving, fuelReach, fuelSupply, isFuelSite, newRefinery, newRefineryCapacity, newRefineryCrude, newRefineryOutput, refineryCapacity, refineryOutput } from "@engine/game/fuel";
import { checkExpand, expandCost, expandLevel, siteScale } from "@engine/game/expand";
import { bondAmount, bondPerDay, checkBond, type BondPurpose } from "@engine/game/bonds";
import type { SiteLimit } from "@engine/game/production";
import { borderCountry } from "@engine/game/border";
import { exportsArriving, exportsBy, farmland, farmTowns, flourCapacity, flourOutput, flourWant, foodActive, foodWant, marketFed, millCapacity, millOutput, stapleArriving, wheatArriving } from "@engine/game/food";
import { jobsGrowth, siteJobs, staffFactor, staffing, workforceShares } from "@engine/game/workers";
import { cementActive, cementImports, cementServed, isCementSite, limestoneArriving, worksCapacity, worksOutput, cementBreak } from "@engine/game/cement";
import { isSteelSite, mineOutput, oreArriving, steelBreak, steelCapacity, steelImports, steelOutput, steelServed } from "@engine/game/steel";
import { isYourRoad } from "@engine/game/upkeep";
import { goneAt, restoreCost as restoreRoadCost } from "@engine/game/retire";
import { NO_SEAT_MIN_PER_DAY, corridorNoSeat, shrinkCause, townNoSeat, wornRoadAt, type NamedMove } from "@engine/game/problems";
import { enforcementPerDay, laneOn, lanesBySegment, settlementPrice, type LaneState } from "@engine/game/pushback";
import { averageBudget, averageNet } from "@engine/game/history";
import { draw, fitView, focusFor, overlayCaption, routeColor, toScreen, townRadius, type Ghost, type Overlay, type View } from "./render";
import { createHintState, dismissHint, updateHints } from "./hints";
import { keepSteady, steadyFood, steadyFuel, steadyOver, steadyShortage, steadySite } from "./steady";
import { createScreen } from "./screen";
import { shortVerdict } from "./verdicts";
import { waysFor } from "@engine/game/crossings";
import { labelOf } from "@engine/game/labels";
import { highBridgeCost } from "@engine/game/floods";
import type { View3D } from "./view3d";

// The slice's bootstrap (docs/principles.md §6, step 1). Two tools, one
// list, one strip:
//   R  road tool -- click a town, then another: build a straight road, or
//      pave the dirt road already joining them.
//   B  bus tool  -- click a town, then another: buy a bus running between them.
//   L  lorry tool -- click a town, then another: buy a lorry running goods between them.
//   Y  yard tool  -- click a town or site: build a haulage yard, and private
//      hauliers reach further from it (yards.ts).
//   K  track tool -- click a town, then another: restore the old line there, or lay new track.
//   T  train tool -- click a town, then another joined by track: buy a train between them.
//   G  freight tool -- click a town, then another joined by track: buy a freight train between them.
//   F  fix tool  -- click a road: start (or stop) maintaining it.
//   Space pause, 1/2/3 speed, Esc cancel.

type Tool = "road" | "bus" | "minibus" | "brt" | "lorry" | "yard" | "park" | "track" | "train" | "freight" | "fix";

// Which systems run (tuning.ts). `?systems=all` turns every one on, for
// comparing; `?goods=off` and `?wear=off` turn those off, so a playtest can
// tell what Revision 2's goods and wear add over its problems made visible
// (status.md, Revision 2's playtest). Goods off takes quarries, truckers and
// the goods tools with it.
const params = new URLSearchParams(location.search);
const allSystems = params.get("systems") === "all";
const switchedOff = (["goods", "wear"] as const).filter((system) => params.get(system) === "off");
// The developer view (docs/brief.md, Information design): forecasts on
// previews, receipts, best next moves -- you, calibrating; never the player.
// Without it none of them runs: no forecast workers, no shadow worlds.
const dev = params.get("dev") === "1";
// The best-moves forecasts (dev only) run up to three workers, each copying the world and
// playing ahead every move, every 3 game days: on the region at 4x, nearly non-stop (a
// playtest's machine at 285% CPU, 2026-10-24). Asked for apart from dev (?moves=1), so the
// design console doesn't bring them.
const forecasting = dev && params.get("moves") === "1";
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
const switches: RunSwitches = { all: allSystems, goodsOff: switchedOff.includes("goods"), wearOff: switchedOff.includes("wear") };
// A developer start (?dev=1&funds=20000): enough money to reach a late rung
// in a minute, for screenshots and checks. Ignored without ?dev=1.
const fundsParam = Number(params.get("funds"));
const devFunds = dev && params.has("funds") && Number.isFinite(fundsParam) ? fundsParam : null;
// Started as a replay would start it (runlog.ts), and recorded as it goes:
// "Save run" writes the file a script can read or replay.
// The world runs its week before you arrive (start.ts) -- on a region, seconds of work: a
// loading screen says so and shows how far it's got, the warm-up run a slice at a time
// between frames (startRunSteps: the same world, tick for tick).
const world = await (async () => {
  const loading = document.querySelector<HTMLElement>("#loading")!;
  loading.querySelector<HTMLElement>(".map")!.textContent = `Map ${seed}`;
  const bar = loading.querySelector<HTMLElement>(".bar i")!;
  // A vehicle rides the bar, in the map's look (its pills): your bus, a danfo, or your train on track.
  const ride = (["bus", "danfo", "train"] as const)[Math.floor(Math.random() * 3)]!;
  const pill = (x: number, w: number, fill: string) => `<rect x="${x}" y="2" width="${w}" height="12" rx="5" style="fill:${fill}" stroke="#fff" stroke-width="1.5"/>${Array.from({ length: Math.floor((w - 8) / 6) }, (_, k) => `<rect x="${x + 4 + k * 6}" y="5" width="4" height="3.5" rx="1" fill="#fff" opacity="0.85"/>`).join("")}`;
  const vehicle = ride === "train"
    ? `<svg width="111" height="24" viewBox="0 0 74 16">${pill(1, 34, "var(--you)")}${pill(38, 34, "var(--you)")}</svg>`
    : `<svg width="54" height="24" viewBox="0 0 36 16">${pill(1, ride === "bus" ? 34 : 26, ride === "bus" ? "var(--you)" : "var(--informal)")}</svg>`;
  const rider = loading.querySelector<HTMLElement>(".bar .vehicle")!;
  rider.innerHTML = vehicle;
  loading.querySelector<HTMLElement>(".bar")!.classList.toggle("rail", ride === "train");
  if (ride === "danfo") bar.style.background = "var(--informal)";
  const label = loading.querySelector<HTMLElement>(".progress")!;
  const days = DEFAULT_GAME_TUNING.warmUpDays;
  const steps = startRunSteps(GAME_MAP, seed, switches, devFunds);
  let since = performance.now();
  for (;;) {
    const step = steps.next();
    if (step.done) {
      loading.remove();
      return step.value;
    }
    if (performance.now() - since > 40) {
      bar.style.width = `${Math.round(step.value * 100)}%`;
      rider.style.left = `${step.value * 100}%`;
      label.textContent = `Day ${Math.min(days, 1 + Math.floor(step.value * days))} of ${days} before you arrive`;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      since = performance.now();
    }
  }
})();
const recorder = createRunRecorder(world, seed, switches, devFunds, String(import.meta.env.VITE_GAME_BUILD ?? "unknown"));
const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
const ctx = canvas.getContext("2d")!;
// The old cards render into these, off the page: the screen (screen.ts, the information
// lab's) shows them whole under its "More" folds, and the treasury on the revenue screen.
const routesEl = document.createElement("div");
const townEl = document.createElement("div");
const screen = createScreen(world, recorder, {
  townMore: (id) => {
    renderTown(id);
    return townEl.innerHTML;
  },
  routeMore: (id) => {
    const summary = routeSummaries(world).find((s) => s.id === id);
    return summary ? routeCard(summary) : "";
  },
  routesMore: () => (forecasting ? bestMovesHtml() + resultsHtml() : "") + lorryRows(false) + corridorsHtml() + shareHtml(),
  bond: (purpose) => bondButton(purpose),
  dev,
  moneyNote: () => moneyNote(),
  treasuryMore: () => treasuryHtml(),
});
const panelEl = document.querySelector<HTMLElement>("#panel")!;
const logEl = document.querySelector<HTMLElement>("#log")!;
const revenueEl = document.querySelector<HTMLElement>("#revenue")!;
const stripEl = document.querySelector<HTMLElement>("#strip")!;
const toolbar = document.querySelector<HTMLDivElement>("#toolbar")!;
const toast = document.querySelector<HTMLDivElement>("#toast")!;
const hintEl = document.querySelector<HTMLDivElement>("#hint")!;
// Which map this is, and a new one: the same address without its seed draws another.
let mapLine = "";
{
  const fresh = new URLSearchParams(params);
  fresh.delete("seed");
  const query = fresh.toString();
  // A new map keeps the switches: the next game of a playtest runs the same systems.
  const off = switchedOff.map((system) => ` · ${system} off`).join("");
  mapLine =
    `Map ${seed}${off}${world.cement && cementActive(world) ? ` · cement works ${world.cement.working ? "working" : "idle"} at the start` : ""} · <a href="${location.pathname}${query ? `?${query}` : ""}">New map</a> · <a href="#" id="save-run">Save run</a>`;
}
// The run so far as a file (runlog.ts): what you did and what each day looked
// like, for reading by hand or with scripts/game-run.ts.
document.addEventListener("click", (event) => {
  if (!(event.target as HTMLElement).closest("#save-run")) return;
  event.preventDefault();
  const file = runFile(recorder);
  const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `run-map${seed}-day${gameDay(world)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  say(`Saved: ${link.download} (${file.actions.length} actions, ${file.days.length} days).`);
});

let tool: Tool = "bus";
// Road and Track tools: bend round the terrain where it's cheaper, or hold the straight line and pay (A).
let alignment: Alignment = "cheapest";
// A new road over water: a causeway (floods with the rains) or a high bridge (C; floods.ts).
let highBridge = false;
let selectedTown: string | null = null;
let hoverTown: string | null = null;
let mouse: { x: number; y: number } | null = null;
let speed = 1;
let paused = false;
// The watch-only 3D view (view3d.ts): three.js loads the first time you switch to it.
let view3d: View3D | null = null;
// 3D by day or by night: the viewer's choice, kept in this browser.
const NIGHT_3D_KEY = "game:night-3d";
let night3d = (() => { try { return localStorage.getItem(NIGHT_3D_KEY) === "1"; } catch { return false; } })();
let in3d = false;
async function toggle3d(): Promise<void> {
  in3d = !in3d;
  if (in3d && !view3d) view3d = (await import("./view3d")).createView3D((id) => {
    // A town or site clicked in 3D: its panel, as a click on the map would.
    screen.select({ kind: world.towns.get(id)?.industry ? "site" : "town", id });
  });
  if (in3d) {
    view3d?.setNight(night3d);
    view3d?.show(world);
  }
  else view3d?.hide();
  // The overlays, key and hints are the 2D map's (index.html hides them under body.in3d).
  document.body.classList.toggle("in3d", in3d);
  renderZoomControl();
}
let view: View = { scale: 1, offsetX: 0, offsetY: 0 };

const naira = (n: number) => `${n < 0 ? "−" : ""}₦${Math.abs(Math.round(n)).toLocaleString()}`;
const townName = (id: string) => world.towns.get(id)?.name ?? world.ruins.get(id)?.name ?? id;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  // The map takes the room between the log (left) and the panel (right), under the strip.
  const root = document.documentElement;
  root.style.setProperty("--top", `${stripEl.offsetHeight}px`);
  const cssPx = (name: string) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;
  const left = cssPx("--left");
  const right = cssPx("--right");
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
  const bottomInset = Math.max(56, below(toolbar)) + 8;
  fitted = fitView(world, window.innerWidth, window.innerHeight, 24, stripEl.offsetHeight, bottomInset, left, right);
  applyZoom();
}
window.addEventListener("resize", resize);

// Zoom and pan (the information lab, 2026-10-23): the wheel zooms toward the cursor, up to
// MAX_ZOOM times the whole map; a drag pans once zoomed in; 0 or the Fit button shows it all.
// The view keeps a zoom and the map point at the middle of the fitted map, so a resize (the
// key opening, the window) keeps where you were looking.
const MAX_ZOOM = 6;
let fitted: View = { scale: 1, offsetX: 0, offsetY: 0, fit: 1 };
let zoom = 1;
let lookAt: { x: number; y: number } | null = null;
function fittedMiddle(): { x: number; y: number } {
  return { x: fitted.offsetX + (world.width * fitted.scale) / 2, y: fitted.offsetY + (world.height * fitted.scale) / 2 };
}
function applyZoom(): void {
  if (zoom <= 1.0001 || !lookAt) {
    zoom = 1;
    lookAt = null;
    view = fitted;
  } else {
    const scale = fitted.scale * zoom;
    const middle = fittedMiddle();
    view = { scale, fit: fitted.scale, offsetX: middle.x - lookAt.x * scale, offsetY: middle.y - lookAt.y * scale };
  }
  renderZoomControl();
}
/**
 * A card's button pressed: the map framed on the places it's about, and a ring round each for a
 * few seconds (render.ts drawPointedRing) -- "a yard at Ilugun would carry it on" left you to
 * find Ilugun yourself. Zooms in no further than 3x, and never out past the whole map.
 */
let pointed: { ids: Set<string>; until: number } | null = null;
function pointAt(ids: string[]): void {
  const places = ids.map((id) => world.towns.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
  if (places.length === 0) return;
  const xs = places.map((t) => t.x);
  const ys = places.map((t) => t.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pad = 30;
  zoom = Math.max(1, Math.min(3, world.width / (x1 - x0 + pad * 2), world.height / (y1 - y0 + pad * 2)));
  lookAt = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  applyZoom();
  pointed = { ids: new Set(places.map((t) => t.id)), until: performance.now() + 5000 };
}
/** Zoom by `factor` keeping the map point under (sx, sy) where it is on screen. */
function zoomAt(sx: number, sy: number, factor: number): void {
  const next = Math.max(1, Math.min(MAX_ZOOM, zoom * factor));
  const under = { x: (sx - view.offsetX) / view.scale, y: (sy - view.offsetY) / view.scale };
  const scale = fitted.scale * next;
  const offsetX = sx - under.x * scale;
  const offsetY = sy - under.y * scale;
  const middle = fittedMiddle();
  zoom = next;
  lookAt = { x: (middle.x - offsetX) / scale, y: (middle.y - offsetY) / scale };
  applyZoom();
}
function panBy(dx: number, dy: number): void {
  if (zoom <= 1.0001 || !lookAt) return;
  const scale = fitted.scale * zoom;
  lookAt = { x: lookAt.x - dx / scale, y: lookAt.y - dy / scale };
  applyZoom();
}
function renderZoomControl(): void {
  let el = document.querySelector<HTMLDivElement>("#zoom-control");
  if (!el) {
    el = document.createElement("div");
    el.id = "zoom-control";
    document.body.appendChild(el);
    el.addEventListener("click", (event) => {
      const z = (event.target as HTMLElement).dataset.zoom;
      if (z === "3d") void toggle3d();
      // 3D's camera from buttons too (right-drag is awkward on a trackpad), and day or night.
      else if (z === "turn-left" || z === "turn-right") view3d?.turn(z === "turn-left" ? Math.PI / 8 : -Math.PI / 8);
      else if (z === "tilt-down" || z === "tilt-up") view3d?.tilt(z === "tilt-down" ? 0.18 : -0.18);
      else if (z === "night") {
        night3d = !night3d;
        try { localStorage.setItem(NIGHT_3D_KEY, night3d ? "1" : "0"); } catch { /* the choice just isn't kept */ }
        view3d?.setNight(night3d);
        renderZoomControl();
      }
      else if (z === "fit") { zoom = 1; applyZoom(); }
      else if (z) zoomAt(window.innerWidth / 2, window.innerHeight / 2, z === "in" ? 1.5 : 1 / 1.5);
    });
  }
  const toggle = `<button data-zoom="3d" title="${in3d ? "Back to the map, to build" : "Watch your game in 3D (drag to pan, right- or shift-drag to turn and tilt, wheel to zoom)"}">${in3d ? "Map" : "3D"}</button>`;
  const camera3d = `<button data-zoom="turn-left" title="Turn left">⟲</button><button data-zoom="turn-right" title="Turn right">⟳</button>`
    + `<button data-zoom="tilt-down" title="Tilt toward the horizon">▼</button><button data-zoom="tilt-up" title="Tilt to look down">▲</button>`
    + `<button data-zoom="night" title="${night3d ? "Daylight" : "Night: the towns' windows lit"}">${night3d ? "Day" : "Night"}</button>`;
  el.innerHTML = in3d ? camera3d + toggle : `<button data-zoom="in" title="Zoom in (or the wheel)">+</button><button data-zoom="out" title="Zoom out">−</button>${zoom > 1.0001 ? `<button data-zoom="fit" title="The whole map (0)">Fit · ${zoom.toFixed(1)}×</button>` : ""}${toggle}`;
}
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0015));
}, { passive: false });
let dragging: { x: number; y: number; moved: boolean } | null = null;
/** A drag that panned isn't also a click on whatever it ended over. */
let suppressClick = false;
canvas.addEventListener("mousedown", (event) => {
  if (event.button === 0) dragging = { x: event.clientX, y: event.clientY, moved: false };
});
window.addEventListener("mousemove", (event) => {
  if (!dragging || zoom <= 1.0001) return;
  const dx = event.clientX - dragging.x;
  const dy = event.clientY - dragging.y;
  if (!dragging.moved && Math.hypot(dx, dy) < 5) return;
  dragging = { x: event.clientX, y: event.clientY, moved: true };
  canvas.style.cursor = "grabbing";
  panBy(dx, dy);
});
window.addEventListener("mouseup", () => {
  if (dragging?.moved) suppressClick = true;
  dragging = null;
});

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
function act(spec: ReceiptSpec, action: ActionSpec): ActionOutcome {
  actionVersion += 1; // every forecast was of the world before this
  // As data, never a closure: what the run file records is exactly what ran.
  let result: ActionOutcome;
  if (!dev) result = applyAction(world, action);
  else {
    let real: ActionOutcome | undefined;
    perform(world, book, (w) => {
      const r = applyAction(w, action);
      if (w === world) real = r;
      return r.ok;
    }, spec);
    result = real!;
  }
  if (result.ok) recordAction(recorder, world, action);
  return result;
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
      if (!chain) {
        const way = wayBetween("road", a, b).way;
        const plan = planRoad(world, a, b, way);
        return { kind: "road", a, b, alignment: way, high: highBridge && !!plan && highBridgeCost(world, plan.polyline) > 0 };
      }
      if (chain.some(isDirt)) return { kind: "pave", a, b };
      // A lane already: the Road tool switches its enforcement, strict <-> lax.
      const lane = chain.every((piece) => piece.busLane) ? laneOn(world, a, b) : undefined;
      if (lane) return { kind: "enforce", a, b, enforcement: lane.enforcement === "strict" ? "lax" : "strict" };
      return { kind: "lane", a, b };
    }
    case "track":
      return { kind: "track", a, b, alignment: trackAction(world, a, b) === "build" ? wayBetween("track", a, b).way : "cheapest" };
    case "bus":
    case "minibus":
    case "brt":
    case "lorry":
    case "train":
    case "freight":
      return { kind: current, a, b };
    case "fix":
    case "yard":
    case "park":
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

const POOL_SIZE = forecasting ? Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)) : 0;
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
/** How much slower a paved road wears than dirt, in words, from the tuning (so the text can't drift from it). */
function pavedWear(): string {
  const share = 1 / world.tuning.dirtWearMultiplier;
  const words: Array<[number, string]> = [[1 / 3, "a third as fast"], [1 / 2, "half as fast"], [2 / 3, "two-thirds as fast"]];
  const near = words.find(([value]) => Math.abs(value - share) < 0.02);
  return near ? near[1] : `${Math.round(share * 100)}% as fast as dirt`;
}

function say(message: string, bad = false, seconds = 2.6): void {
  toast.textContent = message;
  toast.dataset.bad = String(bad);
  toast.style.opacity = "1";
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.style.opacity = "0"), seconds * 1000);
}

function announce(event: GameEvent): void {
  const corridor = "a" in event ? `${townName(event.a)} – ${townName(event.b)}` : "";
  if (event.kind === "strike-announced") {
    const lane = laneOn(world, event.a, event.b);
    const relax = lane?.enforcement === "strict" ? " Relax its enforcement, or settle with the union, to call it off: buttons on its route card." : " Settle with the union to call it off: the button is on its route card.";
    say(`The danfo union calls a strike on ${corridor} from day ${gameDay(world, event.atSeconds)} over your bus lane.${relax}`, true, 10);
    pauseForStrike();
  } else if (event.kind === "project-done") {
    say(`Your project is built: the ${event.rung === "lane" ? "bus lane" : "rail line"} on ${corridor}. The treasury goes back to its usual share.`, false, 6);
  } else if (event.kind === "project-affordable") {
    say(Number.isFinite(event.lapsesAt)
      ? `You can afford the ${event.rung === "lane" ? "bus lane" : "rail line"} on ${corridor}: build it by day ${gameDay(world, event.lapsesAt)}, or the savings lapse to the treasury.`
      : `You can afford the ${event.rung === "lane" ? "bus lane" : "rail line"} on ${corridor} now.`, false, 9);
  } else if (event.kind === "project-lapse-warning") {
    say(`Your ${event.rung === "lane" ? "bus lane" : "rail"} savings for ${corridor} lapse on day ${gameDay(world, event.lapsesAt)}: build it before then, or the treasury takes them.`, true, 9);
    pauseForStrike();
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
  } else if (event.kind === "road-gone") {
    say(`The retired road ${townName(event.a)} – ${townName(event.b)} is gone.${event.sold > 0 ? ` ${event.sold} vehicle${event.sold === 1 ? "" : "s"} that had no other way were sold for ${naira(event.refund)}.` : ""}`, true, 8);
  } else if (event.kind === "industry-opened") {
    // A new problem arriving (brief, Revision 2: industries that open and close).
    const buyers = industryFlows(world).filter((flow) => flow.from === event.townId).map((flow) => townName(flow.to));
    say(cementActive(world)
      ? `A limestone quarry has opened near ${townName(event.near)}: ${world.tuning.quarryOutputPerDay} t a day for ${townName(world.cement!.worksId)}. Nothing moves it until you do, or truckers if it's near.`
      : `A quarry has opened near ${townName(event.near)}: ${world.tuning.quarryOutputPerDay} t of stone a day for ${[...new Set(buyers)].join(", ")}. Nothing moves it until you do.`, false, 9);
  } else if (event.kind === "refinery-opened") {
    // Once a game, and big: it pauses at any speed (playtest 2026-10-21: late changes went unseen).
    say(`A private refinery has opened near ${townName(event.near)}: ${event.name}. It wants ${Math.round(event.crude)} t of crude a day from ${world.fuel ? townName(world.fuel.sourceId) : "the oil"} and can make ${Math.round(event.fuel)} t of fuel. No road reaches it yet: connect it, and get crude to it -- by freight train on track, or hauliers from a yard.`, false, 16);
    if (!paused) {
      paused = true;
      renderToolbar();
    }
  } else if (event.kind === "industry-closed") {
    say(`${event.name} has closed: ${event.reason === "worked out" ? "it's worked out" : "nothing was moved from it"}.`, true, 7);
  } else if (event.kind === "founded" && event.site) {
    say(`${event.name} has grown at the gate of ${townName(event.site)}: its workers live there now, and your buses on its road stop at it.`, false, 7);
  } else if (event.kind === "swept") {
    // The budget year's end (sweep.ts): only said when it took something.
    if (event.amount >= 1) say(`The budget year ended: ${naira(event.amount)} above what you may carry over went back to the treasury. Name a project to keep money for it.`, true, 9);
  } else if (event.kind === "flood-warning") {
    // A shock with a window (floods.ts): named ahead, paused at any speed, like the refinery.
    const names = event.fords.map((f) => f.name).join(" and ");
    say(`The rains are coming: in ${event.inDays} days ${names} ${event.fords.length === 1 ? "floods" : "flood"} for ${event.days} days, and everything on ${event.fords.length === 1 ? "that road" : "those roads"} waits at the bank. Raise a bridge before then: it's in Waiting on you.`, true, 14);
    if (!paused) {
      paused = true;
      renderToolbar();
    }
  } else if (event.kind === "flood-rose") {
    say(`The water's over ${event.fords.map((f) => f.name).join(" and ")}: for ${event.days} days, the road waits at the bank. A bridge still opens it.`, true, 10);
  } else if (event.kind === "flood-fell") {
    say(`The water's down at ${event.fords.map((f) => f.name).join(" and ")}: the road's open. The rains come again in half a year.`, false, 8);
  } else if (event.kind === "union-demand") {
    say(`${event.chairman} demands: "${event.text}" Answer by day ${gameDay(world, event.deadlineAt) - 1}: it's in Waiting on you.`, true, 12);
  } else if (event.kind === "union-answered") {
    if (event.answer === "ignored") say(`${event.chairman}: you ignored him. His drivers strike.`, true, 9);
  } else if (event.kind === "union-stance") {
    say(`${event.chairman}'s union is ${event.stance} now.`, event.stance === "against you", 8);
  } else if (event.kind === "term-started") {
    say(`Term ${event.number} begins: the state offers ${event.pledges.length} pledges, from what your towns need now. Pledge up to two, in the strip.`, false, 10);
  } else if (event.kind === "pledge-kept") {
    say(`Pledge kept: ${event.text}.`, false, 8);
  } else if (event.kind === "term-ended") {
    say(`${termVerdictText(event)}.`, event.missed.length > event.kept.length, 12);
    // The verdict takes the screen, the game paused under it.
    screen.openVerdict("term");
    paused = true;
    renderToolbar();
  } else if (event.kind === "replaced") {
    say(`Two failed terms in a row: the state has replaced you.`, true, 14);
    screen.openVerdict("replaced");
    paused = true;
    renderToolbar();
  } else if (event.kind === "a-week-on") {
    say(`${aWeekOnText(world, event)}.`, false, 8);
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
  if (candidate === "lorry") return t.goodsEnabled && !t.noPlayerLorries;
  if (candidate === "yard") return t.goodsEnabled && t.yardsEnabled;
  if (candidate === "park") return t.parksEnabled;
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
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (tool === "fix") {
    const road = roadAt(event.clientX, event.clientY);
    if (!road) return;
    const on = !world.maintained.has(road);
    const name = midSentence(roadName(road));
    const pieces = roadPieces(road);
    const ends = chainOf(world, road);
    const towns = ends ? [ends.a, ends.b] : [pieces[0]!.fromNodeId, pieces[0]!.toNodeId];
    const result = act({ label: on ? `maintaining ${name}` : `letting ${name} wear`, towns }, { kind: "fix", segmentId: road, on });
    if (!result.ok) say(`Can't maintain: ${result.reason}`, true);
    else if (on) {
      const upkeep = pieces.reduce((sum, piece) => sum + upkeepPerDay(world, piece), 0);
      say(`Maintaining ${name}: repaired for ${naira(result.amount ?? 0)}, about ${naira(upkeep)}/day to keep at this traffic.${later}`);
    } else say(`Stopped maintaining ${name}: it will wear again`);
    renderPanel();
    return;
  }
  const town = townAt(event.clientX, event.clientY);
  if (!town) {
    // Nothing but a road under the click: the road in the panel (the information lab).
    const road = selectedTown === null ? roadAt(event.clientX, event.clientY) : null;
    if (road && world.simulation.map.segments.some((s) => s.id === road)) screen.select({ kind: "segment", id: road });
    selectedTown = null;
    return;
  }
  // A yard needs one town, not two (yards.ts): click it, and hauliers reach further.
  if (tool === "yard") {
    const result = act({ label: "a haulage yard", towns: [town] }, { kind: "yard", townId: town });
    if (result.ok) say(`Haulage yard built at ${townName(town)} for ${naira(result.amount ?? world.tuning.yardCost)}: hauliers now reach ${world.tuning.yardReachCells} cells from here, and you take a levy on what they load.`);
    else say(`Can't build a yard: ${result.reason}`, true);
    selectedTown = null;
    renderPanel();
    return;
  }
  // A motor park is one click on a town (parks.ts): its danfos load off the road, and pay you properly.
  if (tool === "park") {
    const result = act({ label: "a motor park", towns: [town] }, { kind: "park", townId: town });
    if (result.ok) say(`Motor park built at ${townName(town)} for ${naira(result.amount ?? world.tuning.parkCost)}: its danfos load there, not on the road -- the roads into it carry ${pct(world.tuning.parkCapacityBoost)} more -- and the agberos keep ${pct(world.tuning.parkAgberoCut)} of their levy, not ${pct(world.tuning.agberoCut)}.`);
    else say(`Can't build a park: ${result.reason}`, true);
    selectedTown = null;
    renderPanel();
    return;
  }
  // Track tool, the same town twice: a halt where a line passes it by.
  if (tool === "track" && selectedTown === town && haltSite(world, town)) {
    const site = haltSite(world, town)!;
    const cost = haltCost(world, site);
    const result = act({ label: `a halt at ${townName(town)}`, towns: [town] }, { kind: "halt", town });
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
    act({ label: `${strict ? "enforcing" : "relaxing"} the ${townName(from)} – ${townName(town)} lane`, towns }, intended);
    say(strict
      ? `Wardens on the ${townName(from)} – ${townName(town)} lane, ${naira(enforcementPerDay(world, lane))}/day: they'll clear it, and the union will strike more often.${later}`
      : `Wardens off the ${townName(from)} – ${townName(town)} lane: danfos will creep into it, and the union will keep the peace.${later}`);
  } else if (tool === "road" && intended?.kind === "lane") {
    const cost = laneCost(world, from, town);
    const result = act({ label: `a bus lane on ${townName(from)} – ${townName(town)}`, towns }, { kind: "lane", a: from, b: town });
    if (result.ok) {
      // A BRT fills only where enough travel along it (laneMinTripsPerDay): two OpenCode players ran them 5-10% full.
      const wanted = demandAlong(world, from, town) * SECONDS_PER_GAME_DAY;
      const brt = wanted >= world.tuning.laneMinTripsPerDay ? "BRT buses (X) can run in it" : `BRT buses (X) can run in it, but only ${Math.round(wanted)} riders a day want trips along it -- too few to fill an 80-seat bus`;
      say(`Bus lane on ${townName(from)} – ${townName(town)} for ${naira(cost)}: your vehicles skip the traffic, and ${brt}. No wardens yet (Road tool on it to enforce). The danfo union will answer the lane within days.${later}`, false, 8);
      renderToolbar();
    }
    else say(`Can't add a bus lane (${naira(cost)}): ${result.reason}`, true);
  } else if (tool === "road" && roadChain(world, from, town)) {
    const cost = paveCost(world, from, town);
    const result = act({ label: `paving ${townName(from)} – ${townName(town)}`, towns }, { kind: "pave", a: from, b: town });
    if (result.ok) say(`Paved ${townName(from)} – ${townName(town)} for ${naira(cost)}: it now carries ${paveGain()}× the traffic.${later}`);
    else say(`Can't pave: ${result.reason}`, true);
  } else if (tool === "road") {
    const { way } = wayBetween("road", from, town);
    const plan = planRoad(world, from, town, way);
    const high = highBridge && !!plan && highBridgeCost(world, plan.polyline) > 0;
    const wet = !!plan && highBridgeCost(world, plan.polyline) > 0;
    const cost = roadCost(world, from, town, way, high);
    const result = act({ label: `the ${townName(from)} – ${townName(town)} road`, towns }, { kind: "road", a: from, b: town, alignment: way, high });
    if (result.ok) say(`Built road ${townName(from)} – ${townName(town)}${way === "direct" ? ", the straight way" : ""}${!wet ? "" : high ? ", on a high bridge" : ", over a causeway that floods in the rains (C for a high bridge)"}, for ${naira(cost)}.${later}`);
    else say(`Can't build: ${result.reason}`, true);
  } else if (tool === "track") {
    const action = trackAction(world, from, town);
    const restoring = action === "restore";
    const way = action === "build" ? wayBetween("track", from, town).way : "cheapest";
    const cost = trackCost(world, from, town, way);
    const label = restoring ? `restoring the old line ${townName(from)} – ${townName(town)}` : `track ${townName(from)} – ${townName(town)}`;
    const result = act({ label, towns }, { kind: "track", a: from, b: town, alignment: way });
    if (result.ok) say(restoring ? `Restored the old line ${townName(from)} – ${townName(town)} for ${naira(cost)}: trains can run on it` : action === "onroad" ? `The road ${townName(from)} – ${townName(town)} became the railway, for ${naira(cost)}.` : `Laid track ${townName(from)} – ${townName(town)} for ${naira(cost)}`);
    else say(`Can't lay track: ${result.reason}`, true);
  } else if (tool === "freight") {
    const count = (world.lorryRoutes.find((r) => r.id === freightRouteId(from, town))?.vehicleIds.length ?? 0) + 1;
    const result = act({ label: addLabel("freight train", count, from, town), towns, routeId: freightRouteId(from, town) }, { kind: "freight", a: from, b: town });
    if (result.ok) say(`Freight train added: ${pair(from, town)}.${later}`);
    else say(`Can't add freight train (${naira(world.tuning.freightPurchaseCost)}): ${result.reason}`, true);
  } else if (tool === "train") {
    const count = (world.routes.find((r) => r.id === railRouteId(from, town))?.vehicleIds.length ?? 0) + 1;
    const result = act({ label: addLabel("train", count, from, town), towns, routeId: railRouteId(from, town) }, { kind: "train", a: from, b: town });
    if (result.ok) say(`Train added: ${pair(from, town)}.${later}`);
    else say(`Can't add train (${naira(world.tuning.trainPurchaseCost)}): ${result.reason}`, true);
  } else if (tool === "lorry") {
    const route = findLorryRoute(world, from, town);
    const result = act({ label: addLabel("lorry", (route?.vehicleIds.length ?? 0) + 1, from, town), towns, routeId: route?.id ?? lorryRouteId(from, town) }, { kind: "lorry", a: from, b: town });
    if (result.ok) say(`Lorry added: ${pair(from, town)}.${later}`);
    else say(`Can't add lorry (${naira(world.tuning.lorryPurchaseCost)}): ${result.reason}`, true);
  } else if (tool === "brt") {
    const routeId = brtRouteId(from, town);
    const count = (world.routes.find((r) => r.id === routeId)?.vehicleIds.length ?? 0) + 1;
    const result = act({ label: addLabel("BRT bus", count, from, town), towns, routeId }, { kind: "brt", a: from, b: town });
    if (result.ok) say(`BRT bus added: ${pair(from, town)}, in its lane.${later}`);
    else say(`Can't add a BRT bus (${naira(world.tuning.brtPurchaseCost)}): ${result.reason}`, true);
  } else if (tool === "minibus") {
    const routeId = minibusRouteId(from, town);
    const count = (world.routes.find((r) => r.id === routeId)?.vehicleIds.length ?? 0) + 1;
    const result = act({ label: addLabel("minibus", count, from, town), towns, routeId }, { kind: "minibus", a: from, b: town });
    if (result.ok) say(`Minibus added: ${pair(from, town)}.${later}`);
    else say(`Can't add minibus (${naira(world.tuning.minibusPurchaseCost)}): ${result.reason}`, true);
  } else {
    const count = (findRoute(world, from, town)?.vehicleIds.length ?? 0) + 1;
    const result = act({ label: addLabel("bus", count, from, town), towns, routeId: routeKey(from, town) }, { kind: "bus", a: from, b: town });
    if (result.ok) say(`Bus added: ${pair(from, town)}.${later}`);
    else say(`Can't add bus (${naira(world.tuning.busPurchaseCost)}): ${result.reason}`, true);
  }
  // Shift keeps the first town selected: fanning roads or routes out of
  // one hub is the common case.
  selectedTown = event.shiftKey ? from : null;
  renderPanel();
});

window.addEventListener("keydown", (event) => {
  // Typing a name (labels.ts): Enter keeps it, Esc drops it; no key is a tool's while you type.
  const field = event.target as HTMLElement;
  if (field instanceof HTMLInputElement) {
    const key = field.dataset.nameInput;
    if (key && event.key === "Enter") {
      const result = act({ label: "a name", towns: [] }, { kind: "label", key, name: field.value });
      if (!result.ok) say(`Can't name it: ${result.reason}`, true, 5);
      screen.stopRenaming();
    } else if (key && event.key === "Escape") screen.stopRenaming();
    return;
  }
  if (event.key === "r" || event.key === "R") setTool("road");
  else if (event.key === "b" || event.key === "B") setTool("bus");
  else if (event.key === "m" || event.key === "M") setTool("minibus");
  else if (event.key === "x" || event.key === "X") setTool("brt");
  else if (event.key === "f" || event.key === "F") setTool("fix");
  else if (event.key === "l" || event.key === "L") {
    if (!world.tuning.noPlayerLorries) setTool("lorry");
  }
  else if (event.key === "y" || event.key === "Y") setTool("yard");
  else if (event.key === "o" || event.key === "O") {
    if (world.tuning.parksEnabled) setTool("park");
  }
  else if (event.key === "k" || event.key === "K") setTool("track");
  else if (event.key === "t" || event.key === "T") setTool("train");
  else if (event.key === "g" || event.key === "G") setTool("freight");
  else if ((event.key === "c" || event.key === "C") && world.tuning.causewaysEnabled && world.floods) {
    highBridge = !highBridge;
    say(highBridge ? "Roads over water: a high bridge, open in the rains." : "Roads over water: a causeway, cheap -- it floods in the rains.", false, 4);
  }
  else if ((event.key === "a" || event.key === "A") && (world.tuning.straightAlignmentEnabled || world.tuning.crossingsEnabled)) {
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
  else if (event.key === "0") {
    zoom = 1;
    applyZoom();
  }
  else if (event.key === "h" || event.key === "H") {
    hints.off = !hints.off;
    try {
      localStorage.setItem(HINTS_OFF_KEY, hints.off ? "1" : "0");
    } catch {
      // Remembered for this game only.
    }
  }
  else if (event.key === "Escape") {
    // Esc: the revenue screen shut, else a half-made build dropped, else back to the lists.
    if (screen.verdictOpen()) screen.openVerdict(null);
    else if (screen.revenueOpen()) screen.openRevenue(false);
    else if (selectedTown) selectedTown = null;
    else {
      panelTown = null;
      screen.select(null);
    }
  }
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
  // Each road's upkeep is small; the total isn't (eighteen roads came to ₦300 a day, and debt).
  const all = [...world.maintained].reduce((sum, mid) => {
    const segment = world.simulation.map.segments.find((s) => s.id === mid);
    return sum + (segment ? upkeepPerDay(world, segment) : 0);
  }, 0);
  const adding = pieces.reduce((sum, piece) => sum + upkeepPerDay(world, piece), 0);
  const net = averageNet(world);
  const total = world.maintained.has(id) ? "" : ` · all your roads' upkeep then ${naira(all + adding)}/day${net - adding < 0 ? `: more than you clear (${naira(net)}/day)` : ""}`;
  const label = world.maintained.has(id)
    ? `${roadName(id)} · maintained, ${upkeep}/day of ${naira(all)}/day on all your roads · click to stop`
    : `${roadName(id)} · ${state}${costing} · maintain for ~${upkeep}/day${total}`;
  const ends = chainOf(world, id);
  const towns = ends ? [ends.a, ends.b] : [worst.fromNodeId, worst.toNodeId];
  const forecast = dev ? forecastLine({ kind: "fix", segmentId: id, on: !world.maintained.has(id) }, { label: "maintaining", towns }) : undefined;
  return { segmentId: id, at: mouse, label, forecast };
}

/**
 * The way a road or track between two towns goes: the one you've picked (A) where it's a choice
 * there -- where a river or a ridge makes straight a different road (crossings.ts) -- or else
 * the cheapest. And the other way, if there is one.
 */
function wayBetween(kind: "road" | "track", a: string, b: string): { way: Alignment; other: Alignment | null } {
  const plan = (way: Alignment) => (kind === "road" ? planRoad(world, a, b, way) : planRail(world, a, b, way));
  const ways = waysFor(world, plan);
  const way = ways.includes(alignment) ? alignment : "cheapest";
  return { way, other: ways.find((w) => w !== way) ?? null };
}

/** Over a ridge or across the water: what the straight way takes on. */
const straightWord = (plan: RoadPlan) => (plan.hillsCost >= 20 && plan.hillsCost >= plan.bridgeCost ? "over the hills" : "across the water");

// The other way, when it's a choice: the choice made legible
// (principles §1: round, or over -- say what each costs).
function otherWay(plan: RoadPlan, other: RoadPlan | null, way: Alignment): string {
  if (!other || Math.abs(other.cost - plan.cost) < 1) return "";
  if (way === "direct") {
    const longer = other.length / plan.length - 1;
    return ` · round it ${naira(other.cost)}${longer >= 0.05 ? `, ${pct(longer)} longer` : ""} (A)`;
  }
  return ` · straight ${straightWord(other)} ${naira(other.cost)}, ${pct(1 - other.length / plan.length)} shorter (A)`;
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

// What a yard at a town would bring (haulage.ts yardWouldBring), for the Yard tool's label:
// the towns its cement, steel or fuel would reach that nothing reaches now. Once a town a day.
let yardBringsMemo: { key: string; text: string | null } | null = null;
function yardBrings(townId: string): string | null {
  const key = `${townId}|${gameDay(world)}|${world.yards.size}|${world.towns.size}`;
  if (yardBringsMemo?.key === key) return yardBringsMemo.text;
  const { reached, quicker } = yardWouldBring(world, townId);
  const byCargo = new Map<string, string[]>();
  for (const r of reached) {
    const cargo = cargoName(world, r.origin, "supplies");
    const towns = byCargo.get(cargo) ?? [];
    if (!towns.includes(townName(r.to))) towns.push(townName(r.to));
    byCargo.set(cargo, towns);
  }
  // Goods bound for the same towns named together: "cement and steel to Ilora, Ipetu (+7)".
  const byTowns = new Map<string, string[]>();
  for (const [cargo, towns] of byCargo) byTowns.set(towns.join(","), [...(byTowns.get(towns.join(",")) ?? []), cargo]);
  const named = [...byTowns].map(([list, cargos]) => {
    const towns = list.split(",");
    const what = cargos.length > 1 ? `${cargos.slice(0, -1).join(", ")} and ${cargos.at(-1)}` : cargos[0];
    return `${what} to ${towns.slice(0, 3).join(", ")}${towns.length > 3 ? ` (+${towns.length - 3})` : ""}`;
  });
  const text = named.length > 0 ? `would bring ${named.join("; ")}${quicker > 0 ? `, and get it to ${quicker} more in fewer legs` : ""}`
    : quicker > 0 ? `would get cement, steel or fuel to ${quicker} town${quicker === 1 ? "" : "s"} in fewer legs`
    : null;
  yardBringsMemo = { key, text };
  return text;
}

function ghost(): Ghost | null {
  // A yard is one click on a town or site, not a pair: say what it does over it.
  if (tool === "yard") {
    if (!hoverTown) return null;
    const check = checkYard(world, hoverTown);
    const at = toScreen(view, world.towns.get(hoverTown)!.x, world.towns.get(hoverTown)!.y);
    // What it would have to work with (yards.ts yardGain): goods waiting here, within its reach.
    const waiting = yardGain(world, hoverTown);
    const work = waiting >= 5 ? `~${Math.round(waiting)} t/day wait here within its reach · levy ~${naira(waiting * world.tuning.yardLevyPerTonne * (1 - world.tuning.yardToutShare))}/day` : "little waits here for hauliers";
    const label = `Haulage yard ${naira(world.tuning.yardCost)} · ${yardBrings(hoverTown) ?? work}`;
    return { from: hoverTown, to: at, ok: check.ok, label: refusedOr(check, label, `Haulage yard ${naira(world.tuning.yardCost)}`) };
  }
  if (tool === "park") {
    if (!hoverTown) return null;
    const check = checkPark(world, hoverTown);
    const at = toScreen(view, world.towns.get(hoverTown)!.x, world.towns.get(hoverTown)!.y);
    const label = `Motor park ${naira(world.tuning.parkCost)} · roads into it +${pct(world.tuning.parkCapacityBoost)} · levies ~+${naira(parkLevyGain(world, hoverTown))}/day`;
    return { from: hoverTown, to: at, ok: check.ok, label: refusedOr(check, label, `Motor park ${naira(world.tuning.parkCost)}`) };
  }
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
    const { way, other: otherWayKind } = wayBetween("road", selectedTown, to);
    const plan = planRoad(world, selectedTown, to, way);
    const raise = plan ? highBridgeCost(world, plan.polyline) : 0;
    const high = highBridge && raise > 0;
    const check = checkRoad(world, selectedTown, to, way, high);
    if (!plan) return { from: selectedTown, to: end, ok: false, label: check.ok ? "" : check.reason };
    const otherPlan = otherWayKind ? planRoad(world, selectedTown, to, otherWayKind) : null;
    // The other way priced as this one's built: high, its crossings high too.
    const other = otherPlan && highBridge ? { ...otherPlan, cost: otherPlan.cost + highBridgeCost(world, otherPlan.polyline) } : otherPlan;
    // Said up front: a road takes no fares, and costs its upkeep every day
    // (step 5). It pays in who it lets travel -- and only in money once you
    // run something on it (playtest, day 31: two roads drained the funds
    // and earned nothing).
    const keep = naira(upkeepFor(world.tuning, plan.length, plan.bridgeCells, false));
    // Over water: which kind of crossing, and the other's price (C).
    const crossing = raise <= 0 ? "" : high ? ` · a high bridge, open in the rains (a causeway ${naira(raise)} less, C)` : ` · a causeway: floods in the rains (a high bridge +${naira(raise)}, C)`;
    const label = `${way === "direct" ? `Road straight ${straightWord(plan)}` : "Road"} ${naira(plan.cost + (high ? raise : 0))} + ${keep}/day to keep${roadWhy(plan, selectedTown, to)}${crossing}${otherWay(plan, other, way)} · ${riders} · earns no fares itself: run a bus on it`;
    const ghost = { from: selectedTown, to: end, ok: check.ok, line: plan.polyline, label: check.ok ? label : `${naira(plan.cost + (high ? raise : 0))} · ${check.reason}` };
    return withForecast(ghost, { kind: "road", a: selectedTown, b: to, alignment: way, high }, { label: "the road", towns: [selectedTown, to] });
  }
  if (tool === "track") {
    const check = checkTrack(world, selectedTown, to, "cheapest");
    if (trackAction(world, selectedTown, to) === "onroad") {
      const label = `Track on the retired road ${naira(onRoadCost(world, selectedTown, to))} · its earthworks are done; the road goes · ${riders}`;
      const ghost = { from: selectedTown, to: end, ok: check.ok, label: check.ok ? label : `${naira(onRoadCost(world, selectedTown, to))} · ${check.reason}` };
      return withForecast(ghost, { kind: "track", a: selectedTown, b: to, alignment }, { label: "track on the old road", towns: [selectedTown, to] });
    }
    if (trackAction(world, selectedTown, to) === "restore") {
      const label = `Restore the old line ${naira(restoreCost(world, selectedTown, to))} · built for export: it stops nowhere between`;
      const ghost = { from: selectedTown, to: end, ok: check.ok, label: check.ok ? label : check.reason };
      return withForecast(ghost, { kind: "track", a: selectedTown, b: to, alignment }, { label: "restoring", towns: [selectedTown, to] });
    }
    const { way, other: otherWayKind } = wayBetween("track", selectedTown, to);
    const wayCheck = checkTrack(world, selectedTown, to, way);
    const plan = planRail(world, selectedTown, to, way);
    if (!plan) return { from: selectedTown, to: end, ok: false, label: wayCheck.ok ? "" : wayCheck.reason };
    const other = otherWayKind ? planRail(world, selectedTown, to, otherWayKind) : null;
    const label = `${way === "direct" ? `Track straight ${straightWord(plan)}` : "Track"} ${naira(plan.cost)}${roadWhy(plan, selectedTown, to)}${otherWay(plan, other, way)} · ${riders}`;
    const ghost = { from: selectedTown, to: end, ok: wayCheck.ok, line: plan.polyline, label: wayCheck.ok ? label : `${naira(plan.cost)} · ${wayCheck.reason}` };
    return withForecast(ghost, { kind: "track", a: selectedTown, b: to, alignment: way }, { label: "track", towns: [selectedTown, to] });
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
    // And what one more would earn, roughly: whether it pays, before you buy it.
    const estimate = lorryEstimate(world, selectedTown, to);
    const truckers = estimate && estimate.truckersTake >= 1 ? `, truckers take ${Math.round(estimate.truckersTake)}` : "";
    const verdict = !estimate ? ""
      : estimate.tonnesPerDay < 1 ? " · another lorry here would find nothing to carry"
      : ` · another lorry carries ~${Math.round(estimate.tonnesPerDay)} t/day, earning ~${naira(estimate.incomePerDay)}/day against ${naira(estimate.costPerDay)} to run${estimate.incomePerDay < estimate.costPerDay ? ": it would lose money" : ""}`;
    const label = `Lorry ${naira(world.tuning.lorryPurchaseCost)} · goods along it: ${Math.round(goods.outbound)} t/day out, ${Math.round(goods.inbound)} back${truckers}${verdict}`;
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
  const wanted = demandAlong(world, selectedTown, to) * SECONDS_PER_GAME_DAY;
  // An 80-seat bus fills only on a busy corridor (the lane's own bar, laneMinTripsPerDay): say so before it's bought.
  const thinForBrt = brt && wanted < world.tuning.laneMinTripsPerDay ? ` -- too few to fill an 80-seat bus: it would run mostly empty; a bus or minibus suits` : "";
  const along = `${Math.round(wanted)} riders/day want trips along it${thinForBrt}`;
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
      ...on(t.goodsEnabled && !t.noPlayerLorries, button("Lorry", "L", tool === "lorry", () => setTool("lorry"))),
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
    group("Build", "build", button("Road", "R", tool === "road", () => setTool("road")), ...on(t.goodsEnabled && t.yardsEnabled, button("Yard", "Y", tool === "yard", () => setTool("yard"))), ...on(t.parksEnabled, button("Park", "O", tool === "park", () => setTool("park"))), ...on(t.railEnabled, button("Track", "K", tool === "track", () => setTool("track")))),
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
  screen.renderStrip(mapLine);
}


// The side panel (screen.ts): its lists, or the one thing picked. A town pointed at on the
// map shows there, and stays when the pointer leaves for the panel -- except mid-action, the
// first town of a road or route clicked: the panel stays on what it showed.
let panelTown: string | null = null;
function renderPanel(): void {
  const town = hoverTown ?? null;
  const placing = selectedTown !== null && tool !== "fix" && tool !== "yard" && tool !== "park";
  if (town && town !== panelTown && !placing && world.towns.has(town)) {
    panelTown = town;
    screen.select({ kind: world.towns.get(town)!.industry ? "site" : "town", id: town }, true);
    return;
  }
  screen.renderPanel();
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

// What the town expects of you, and what you carry (growth.ts): the shortfall
// is why a town stops growing, so it sits right under the growth line.
function serviceText(townId: string, name: string): string {
  const growth = townGrowth(world, townId);
  if (!growth || growth.expected <= 0) return "";
  const short = growth.playerShare < growth.expected ? " Short of it, it grows less: more buses, a lane or BRT here." : "";
  return `<p class="townshare"><b>Service:</b> ${name} expects you to carry ${pct(growth.expected)} of its trips; you carry ${pct(growth.playerShare)}.${short}</p>`;
}

/** A named move as the screen says it: what, and its price. Named, not bought: the player does it (brief, Information design). */
function moveText(move: NamedMove): string {
  // Not a move (problems.ts seatMove: another vehicle wouldn't pay): said plainly, no price.
  if (!Number.isFinite(move.price)) return `<span class="muted">${move.label}.</span>`;
  return `<b>${move.label}</b>${move.price > 0 ? ` · ${naira(move.price)}` : ""}`;
}

// How goods get carried further: your lorries, or private hauliers from a yard
// (yards.ts). Both wordings live here, so the cards can't drift from the rules.
function haulierMove(lorries: string, yard: string): string {
  return world.tuning.noPlayerLorries ? yard : lorries;
}

// The town card (design lab, "the brief, step 8"): a kicker, the name, three
// lines, the one problem here, then its trips. Its first screen fits without
// scrolling (brief, text budget).
// The coast road's card (border.ts placeCoastRoad; brief, The gateways, step 3): a landlocked map's way
// to the sea -- its imports come up it and its exports go down it.
function renderCoastRoad(townId: string): void {
  const site = world.towns.get(townId)!;
  townEl.innerHTML = `
    <div class="town-card">
      <div class="k">Gateway · to the coast</div>
      <div class="title">${site.name}</div>
      <p class="townshare">No sea here: the region's imports come up from the ports in the south, and its exports go down to them, this way.</p>
      ${seaportText()}
      ${portHtml()}
    </div>`;
}

// The border crossing's card (border.ts; brief, The gateways, step 2): what crosses it, from which
// farm towns, what it's paid against the sea, and why each crop goes the way it does.
function renderBorder(townId: string): void {
  const site = world.towns.get(townId)!;
  const perDay = (rate: number) => Math.round(rate * SECONDS_PER_GAME_DAY);
  const food = world.food;
  const using = food ? farmTowns(world).filter((t) => exportGateway(world, t.id)?.to === townId) : [];
  const here = exportsBy(world).find((e) => e.to === townId);
  const sea = exportsBy(world).find((e) => e.to === world.port);
  const t = world.tuning;
  const crop = food?.crops.cash ?? "cash crops";
  townEl.innerHTML = `
    <div class="town-card">
      <div class="k">Border crossing · to ${borderCountry(world)}</div>
      <div class="title">${site.name}</div>
      <p class="townshare"><b>Out this way:</b> ${perDay(here?.tonnes ?? 0)} t of ${crop} a day, from ${using.length} farm town${using.length === 1 ? "" : "s"}${using.length ? ` (${using.slice(0, 5).map((u) => townName(u.id)).join(", ")}${using.length > 5 ? `, ${using.length - 5} more` : ""})` : ""}; ${perDay(sea?.tonnes ?? 0)} t a day go to the coast.</p>
      <p class="townshare">The state pays ₦${Math.round(t.exportPayPerTonne * (t.borderPayShare ?? 0.7))} a tonne over the border, against ₦${Math.round(t.exportPayPerTonne * seaportLink(world).share)} for what reaches the sea. Each farm town's crop goes whichever way nets more a tonne by road: a better road here, or to the coast, moves it.</p>
      ${seaportText()}
      <ul>
        <li>${t.truckersEnabled ? "Hauliers carry what's close enough; what's far waits for your lorries or trains." : "Nobody else carries it: what you don't move doesn't leave."}</li>
      </ul>
    </div>`;
}

// An industrial site's card (brief, Revision 2): what it is and for how
// long, where its stone goes and how much of it arrives, and the one
// problem with it -- no road, or nothing moved and the day it closes.
function renderIndustry(townId: string): void {
  if (isFuelSite(world.towns.get(townId))) return renderFuelSite(townId);
  if (isCementSite(world.towns.get(townId))) return renderCementSite(townId);
  if (isSteelSite(world.towns.get(townId))) return renderSteelSite(townId);
  if (world.towns.get(townId)?.industry === "mill") return renderMillSite(townId);
  if (world.towns.get(townId)?.industry === "flourmill") return renderFlourMillSite(townId);
  if (world.towns.get(townId)?.industry === "border") return renderBorder(townId);
  if (world.towns.get(townId)?.industry === "gateway") return renderCoastRoad(townId);
  const limestone = cementActive(world);
  const cargo = limestone ? "limestone" : "stone";
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
      return `<div class="trip"><span class="name">${townName(flow.to)}${flow.to === world.port ? " <span class=\"muted\">· the port</span>" : ""}</span><span class="num">${perDay(flow.rate)} t/day</span><div class="bar"><i style="width:${pct(delivered)};background:var(--goods)"></i><i style="width:${pct(trucked)};background:var(--informal)"></i></div></div>`;
    })
    .join("");
  const now = world.economy.elapsedSeconds;
  const opened = industry && industry.openedAtSeconds >= world.startSeconds ? `opened day ${gameDay(world, industry.openedAtSeconds)}` : "working before you came";
  const kicker = industry ? `Quarry · ${opened} · works out about day ${gameDay(world, industry.closesAtSeconds)}` : "Quarry";
  const biggest = [...flows].sort((p, q) => q.rate - p.rate)[0];
  let problem = "";
  if (isCutOff(world, townId)) {
    // From the nearest town a road already reaches: a spur from a cut-off town connects nothing.
    const near = [...world.towns.values()].filter((t) => !t.industry && !isCutOff(world, t.id)).sort((p, q) => Math.hypot(p.x - site.x, p.y - site.y) - Math.hypot(q.x - site.x, q.y - site.y))[0];
    problem = `No road reaches it. Build one (<kbd>R</kbd>)${near ? ` from ${townName(near.id)}` : ""} and its ${cargo} can move.`;
  } else if (industry && industry.deliveredEMA * SECONDS_PER_GAME_DAY < world.tuning.industryMinDeliveredPerDay) {
    const closes = industry.openedAtSeconds + world.tuning.industryGraceDays * SECONDS_PER_GAME_DAY;
    problem = siteProblem(townId) || `Nothing is moving its ${cargo}${closes > now ? `: it closes on day ${gameDay(world, closes)} unless something does` : ""}. ${haulierMove(`Run a lorry (<kbd>L</kbd>)${biggest ? ` to ${townName(biggest.to)}` : ""}, or a freight train on track.`, `Build a haulage yard (<kbd>Y</kbd>) at ${site.name}${biggest ? ` so hauliers reach ${townName(biggest.to)}` : ""}, or a freight train on track.`)}`;
  }
  townEl.innerHTML = `
    <div class="town-card">
      <div class="k">${kicker}</div>
      <div class="title">${site.name}</div>
      ${productionHtml(townId)}
      <ul>
        <li>${limestone
          ? `${world.tuning.quarryOutputPerDay} t of limestone a day for ${townName(world.cement!.worksId)}: ${world.tuning.limestonePerCement} t makes a tonne of cement, and towns past their first growth need cement to grow.`
          : `${world.tuning.quarryOutputPerDay} t of stone a day. Stone feeds construction: a town that gets the stone it wants can grow more.`}</li>
        <li>${world.tuning.truckersEnabled ? "Truckers take what you don't on short hauls (yellow on each bar); the rest is lost." : "Nobody else carries it: what isn't moved is lost."}</li>
        ${workersItem(townId)}
      </ul>
      ${problem ? `<p class="callout hook"><span class="k">The problem here</span>${problem}</p>` : ""}
      ${rows}
    </div>`;
}

// A bond for a purpose (bonds.ts): the button, its terms, or why not.
function bondButton(purpose: BondPurpose): string {
  const lent = bondAmount(world, purpose);
  if (lent === null || !world.tuning.bondsEnabled) return "";
  const check = checkBond(world, purpose);
  const terms = `repay ${naira(bondPerDay(world, lent))}/day for ${world.tuning.bondTermDays} days`;
  return check.ok
    ? `<button data-bond="${purpose}" title="${pct(world.tuning.bondInterest)} interest over the term">Borrow ${naira(lent)}: ${terms}</button>`
    : `<span class="muted">A bond: ${check.reason}.</span>`;
}

// A site's workers (workers.ts, step 2b): how many, where from, how many
// get there -- and, short, the problem: a site short of workers makes less.
function workersItem(siteId: string): string {
  const site = world.towns.get(siteId)!;
  const jobs = siteJobs(world, site);
  // An idle site's few watchmen aren't a workforce to report.
  if (!world.tuning.workersEnabled || jobs <= world.tuning.jobsIdle + 1e-9) return "";
  const from = [...workforceShares(world, site)].sort((p, q) => q[1] - p[1]).slice(0, 3).map(([id, share]) => `${townName(id)} ${pct(share)}`).join(", ");
  return `<li>Employs ${Math.round(jobs * 1000).toLocaleString()}, from ${from}; ${pct(staffing(world, siteId))} of a full shift gets here, so it makes ${pct(staffFactor(world, siteId))} of what it could.</li>`;
}

// A site's production (production.ts): what it makes against what it could,
// each input against what full output takes, its shift, what gets away --
// and what's holding it back, marked (playtest, map 2411: "we need
// indications for the factories in terms of production").
function productionHtml(siteId: string): string {
  const p = steadySite(world, siteId);
  if (!p || p.capacity <= 0) return "";
  const perDay = (rate: number) => Math.round(rate * SECONDS_PER_GAME_DAY);
  const tone = (share: number) => (share >= 0.8 ? "var(--good)" : share >= 0.4 ? "var(--informal)" : "var(--bad)");
  const gauge = (share: number) => `<div class="bar"><i style="width:${pct(Math.min(1, share))};background:${tone(share)}"></i></div>`;
  const held = (what: SiteLimit) => (p.limit === what ? ` <span class="held">holding it back</span>` : "");
  const made = p.made / p.capacity;
  const rows = [
    `<div class="prow main"><span>${p.limit === "idle" ? "Idle" : `Makes ${perDay(p.made)} of ${perDay(p.capacity)} t of ${p.product} a day`}</span><span class="num">${pct(made)}</span>${gauge(made)}</div>`,
    ...p.inputs.map((input) => {
      const share = input.needed > 0 ? input.arriving / input.needed : 1;
      return `<div class="prow"><span>${capitalise(input.name)} in: ${perDay(input.arriving)} of ${perDay(input.needed)} t a day${held("input")}</span><span class="num">${pct(Math.min(1, share))}</span>${gauge(share)}</div>`;
    }),
    ...(p.staffing === null ? [] : [`<div class="prow"><span>Workers: ${pct(p.staffing)} of a full shift${held("workers")}</span><span class="num">${pct(p.staffing)}</span>${gauge(p.staffing)}</div>`]),
    ...(p.made * SECONDS_PER_GAME_DAY >= 1 ? [`<div class="prow"><span>Carried away: ${pct(p.shipped)} of it${p.shipped < 0.5 ? ` <span class="held">the rest waits</span>` : ""}</span><span class="num">${pct(p.shipped)}</span>${gauge(p.shipped)}</div>`] : []),
  ];
  // An import's site: where its imports land, and how much of them gets here (gateways.ts).
  const imports = ["depot", "silo", "steelport", "flourmill"].includes(world.towns.get(siteId)?.industry ?? "") ? seaportText() + portHtml() : "";
  return `${imports}<div class="production">${rows.join("")}${expandHtml(siteId)}</div>`;
}

// The port's rungs (gateways.ts): what it lands of day 1's need, and the next rung with its button.
function portHtml(): string {
  if (!world.tuning.portRungs || !world.port) return "";
  const scale = portScale(world);
  const next = nextPortRung(world);
  const now = `<b>The port:</b> lands ${pct(scale)} of what the towns needed on day 1.`;
  if (!next) return `<p class="townshare">${now} As big as it gets.</p>`;
  return `<p class="townshare">${now} As they grow, ${next.name} lands ${pct(next.scale)} -- the other answer to a shortage, beside the refinery. <button data-upgrade-port="1">Build ${next.name} · ${naira(next.price)}</button></p>`;
}

// The seaport (gateways.ts, brief: The gateways): where imports land when the home city isn't on
// the coast, how much of them reaches it and how, and the move that brings more.
function seaportText(): string {
  const link = seaportLink(world);
  if (link.by === "here" || !world.port) return "";
  const home = world.towns.get(world.port)!, sea = world.towns.get(link.seaport)!;
  const away = Math.round(Math.hypot(home.x - sea.x, home.y - sea.y));
  const t = world.tuning;
  const ends = [world.port, link.seaport].sort().join();
  const oldLine = world.simulation.map.segments.some((s) => s.type === "rail" && [s.fromNodeId, s.toNodeId].sort().join() === ends);
  const there = sea.industry === "gateway" ? `the ${townName(link.seaport)}` : townName(link.seaport);
  const rail = oldLine ? `restore the old railway to ${there} (K)` : `lay track to ${there} (K)`;
  const how = link.by === "rail" ? "by the railway" : link.by === "none" ? "-- no road joins them" : link.paved >= 0.99 ? "up a road paved all the way" : `up the old highway${link.paved > 0.01 ? `, ${pct(link.paved)} of it paved` : ""}`;
  const more = link.by === "rail" ? "" : link.paved < 0.99 && link.by === "road" ? ` Pave it for up to ${pct(t.importsOverPaved ?? 0.9)}, or ${rail} for all of it.` : ` To get all of it, ${rail}.`;
  const where = sea.industry === "gateway" ? `come up from the coast by the ${townName(link.seaport)}, ${away} cells off` : `land at ${townName(link.seaport)}, the seaport, ${away} cells off`;
  return `<p class="townshare"><b>Imports:</b> they ${where}; ${pct(link.share)} reach ${townName(world.port)} ${how}, and as much of what's exported reaches the coast.${more}</p>`;
}

// Expanding it (expand.ts): another line, more capacity -- offered once it's working, said why not when it can't.
function expandHtml(siteId: string): string {
  const cost = expandCost(world, siteId);
  const level = expandLevel(world, siteId);
  const t = world.tuning;
  if (!t.expandEnabled || (cost === null && level === 0)) return "";
  const done = level > 0 ? `Expanded ${level === 1 ? "once" : `${level} times`}: ${pct(siteScale(world, siteId))} of what it was built to make. ` : "";
  if (cost === null) return `<p class="hint">${done}As big as it gets.</p>`;
  // Offered when it's near capacity: expanding a site that makes little adds nothing.
  const p = steadySite(world, siteId);
  if (!p || p.made < 0.8 * p.capacity) return done ? `<p class="hint">${done}</p>` : "";
  const check = checkExpand(world, siteId);
  return `<p class="hint">${done}<span class="actions"><button data-expand="${siteId}" ${check.ok ? "" : `disabled title="${check.reason}"`}>Expand it: +${pct(t.expandStep)} capacity · ${naira(cost)}</button></span>${check.ok ? "" : ` <span class="muted">${check.reason}</span>`}</p>`;
}

/** The problem a site's production names, when nothing more pressing does: its short input, its shift, or its goods waiting. */
function siteProblem(siteId: string): string {
  const workers = workersProblem(siteId);
  if (workers) return workers;
  const p = steadySite(world, siteId);
  if (!p || p.capacity <= 0 || p.limit === "idle") return "";
  const perDay = (rate: number) => Math.round(rate * SECONDS_PER_GAME_DAY);
  const site = world.towns.get(siteId)!;
  if (p.limit === "input" && p.made < 0.8 * p.capacity) {
    const input = p.inputs[0]!;
    const from = (site.industry === "refinery" || site.industry === "newrefinery") && world.fuel ? `from ${townName(world.fuel.sourceId)}` : site.industry === "works" ? "from the limestone quarries" : site.industry === "mill" ? "in from the farm towns" : site.industry === "flourmill" ? "from the port" : "";
    return `Short of ${input.name}: ${perDay(input.arriving)} of the ${perDay(input.needed)} t a day it could use, so it makes ${pct(p.made / p.capacity)} of what it could. Carry more ${from}: ${haulierMove(`lorries (<kbd>L</kbd>) on a road`, `build a haulage yard (<kbd>Y</kbd>) where it leaves from so hauliers reach this site`)}, or a freight train on track.`;
  }
  if (p.shipped < 0.5 && p.made * SECONDS_PER_GAME_DAY >= 5) {
    // Waiting for towns past any tanker or haulier: only rail gets it there (a yard here already
    // or not, it won't help -- the card said "build a yard" to a refinery that had one).
    const fuelSite = site.industry === "refinery" || site.industry === "newrefinery" || site.industry === "depot";
    const reach = fuelSite ? fuelReach(world, siteId) : Math.max(world.tuning.truckerMaxHaulCells, hasYard(world, siteId) ? world.tuning.yardReachCells : 0);
    const far = [...(world.goods.yards.get(siteId) ?? [])].filter(([, amount]) => amount > 0).map(([key]) => key.slice(0, key.indexOf("|")))
      .filter((to) => (roadPath(world, siteId, to)?.distance ?? Infinity) > reach && !railPath(world, siteId, to));
    if (far.length > 0) {
      const names = far.slice(0, 4).map(townName).join(", ") + (far.length > 4 ? ` and ${far.length - 4} more` : "");
      return `Most of its ${p.product} is waiting for towns past the ${fuelSite ? "tankers'" : "hauliers'"} reach (${Math.round(reach)} cells by road): ${names}. Only a freight train gets it there: lay track (<kbd>K</kbd>) from ${site.name} and run freight (<kbd>G</kbd>).`;
    }
    if (hasYard(world, siteId)) return `Most of its ${p.product} is waiting: ${pct(p.shipped)} gets carried away, even from its yard. A freight train (<kbd>G</kbd>) on track takes more.`;
    return `Most of its ${p.product} is waiting: ${pct(p.shipped)} gets carried away. Truckers take the short hauls; ${haulierMove(`run lorries (<kbd>L</kbd>) to the towns further off.`, `build a haulage yard (<kbd>Y</kbd>) at ${site.name} so hauliers reach the towns further off.`)}`;
  }
  return "";
}

function workersProblem(siteId: string): string {
  const site = world.towns.get(siteId)!;
  if (!world.tuning.workersEnabled || siteJobs(world, site) < 0.2 || staffing(world, siteId) >= 0.8) return "";
  const why = isCutOff(world, siteId) ? "no road reaches it" : "the danfos don't carry enough of them";
  return `Its workers can't get here: ${why}, so it makes ${pct(staffFactor(world, siteId))} of what it could. ${isCutOff(world, siteId) ? "Build a road (<kbd>R</kbd>) to it." : "Run a bus (<kbd>B</kbd>) from the town most of them live in."}`;
}

// A town's motor park on its card (parks.ts): what it's doing, in numbers -- a park
// that said nothing read as money wasted (OpenCode playtest, 2026-10-23).
function parkItem(townId: string): string {
  const report = parkReport(world, townId);
  if (!report) return "";
  const t = world.tuning;
  return `<li>Motor park: its danfos load there, not on the road, so the roads into it carry ${pct(t.parkCapacityBoost)} more before they jam (the slowest runs at ${pct(report.roadSpeed)} of free speed). Levy here ${naira(report.yours)}/day to you, ${naira(report.agberos)} to the agberos; without the park they'd keep ${naira(report.agberosWithout)}.</li>`;
}

// A town's metro on its card (metro.ts, brief Revision 4, 6): what it carries and earns, and
// the button for the first line or the next. Nothing on a town too small for one.
function metroItem(townId: string): string {
  const t = world.tuning;
  const town = world.towns.get(townId);
  if (!t.metroEnabled || !town || town.population < t.metroMinPopulation) return "";
  const lines = metroLines(world, townId);
  const check = checkMetro(world, townId);
  const price = metroPrice(world, townId);
  const button = lines < t.metroMaxLines ? ` <button data-metro="${townId}" ${check.ok ? "" : `disabled title="${check.reason}"`}>${lines === 0 ? "Build a metro" : "Add a line"}: ${naira(price)}</button>` : "";
  const perLine = Math.round(t.metroLineShare * town.population * t.localTripsPerThousandPerDay);
  if (lines === 0) return `<li>Big enough for a metro: a line would carry ~${perLine.toLocaleString()} of its inside trips a day at ${naira(t.metroFare)} each, and let it grow further.${button}</li>`;
  const { riders, share } = metroRiders(world, townId);
  return `<li>Metro: ${lines} line${lines > 1 ? "s" : ""}, ${Math.round(riders).toLocaleString()} riders a day (${pct(share)} of its inside trips), ${naira(riders * t.metroFare - lines * t.metroRunningPerLine)}/day after running costs.${lines < t.metroMaxLines ? ` Another line: ~${perLine.toLocaleString()} more.` : ""}${button}</li>`;
}

// A fuel site's card (brief, Revision 3, the fuel chain): what it does, what
// it needs, and the one thing holding it back -- idle, no crude, no road out.
function renderFuelSite(townId: string): void {
  const fuel = world.fuel!;
  const site = world.towns.get(townId)!;
  const t = world.tuning;
  const perDay = (rate: number) => Math.round(rate * SECONDS_PER_GAME_DAY);
  const source = world.towns.get(fuel.sourceId)!;
  const refinery = world.towns.get(fuel.refineryId)!;
  const flows = goodsFlows(world).filter((flow) => flow.from === townId);
  const rows = flows
    .map((flow) => {
      const outcome = world.goods.outcomes.get(flowKey(flow));
      const total = (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0) + (outcome?.spoiled ?? 0);
      const delivered = total > 0 ? (outcome?.delivered ?? 0) / total : 0;
      const trucked = total > 0 ? (outcome?.trucked ?? 0) / total : 0;
      return `<div class="trip"><span class="name">${townName(flow.to)}</span><span class="num">${perDay(flow.rate)} t/day</span><div class="bar"><i style="width:${pct(delivered)};background:var(--goods)"></i><i style="width:${pct(trucked)};background:var(--informal)"></i></div></div>`;
    })
    .join("");
  const nearestTown = [...world.towns.values()].filter((other) => !other.industry && !isCutOff(world, other.id)).sort((p, q) => Math.hypot(p.x - site.x, p.y - site.y) - Math.hypot(q.x - site.x, q.y - site.y))[0];
  const capacity = perDay(refineryCapacity(world));
  const crude = perDay(t.crudeShare * fuel.baseDemand * siteScale(world, fuel.refineryId));
  let kicker = "";
  let lines: string[] = [];
  let problem = "";
  let action = "";
  if (site.industry === "depot") {
    kicker = "Tank farm · fuel imports";
    lines = [
      `Imports ${perDay(t.fuelImportShare * fuel.baseDemand)} t of fuel a day through the port: ${pct(t.fuelImportShare)} of what the towns burnt on day 1.`,
      "Road tankers carry it to the towns, nearest first (yellow on each bar); your lorries can too. Towns too far for the tankers run short.",
    ];
  } else if (site.industry === "refinery") {
    const out = perDay(refineryOutput(world));
    kicker = fuel.restored ? `Refinery · ${out} of ${capacity} t of fuel a day` : "Refinery · idle for years";
    lines = [
      `Turns crude into fuel: up to ${capacity} t a day, enough with the imports to supply every town.`,
      haulierMove(
        `Its crude comes from ${source.name}. Tankers don't carry crude: only your lorries (on a road) or freight trains (on track) do. Track is dear on a leg this long; full lorries pay too.`,
        `Its crude comes from ${source.name}: by freight train on track, or by hauliers on a road from a haulage yard (<kbd>Y</kbd>) at ${source.name}. Track is dear on a leg this long.`,
      ),
      "Its fuel goes to the towns by road tanker, so it needs a road out.",
    ];
    if (fuel.restored && isCutOff(world, townId)) {
      // No road at all comes first: no crude in, no fuel out, and its workers can't get there.
      problem = `No road reaches it: no crude can come in, no fuel go out, and its workers can't get there. Build one (<kbd>R</kbd>)${nearestTown ? ` to ${townName(nearestTown.id)}` : ""}.`;
    } else if (!fuel.restored) {
      problem = `Idle. Restore it, then get crude to it from ${source.name}.`;
      action = `<span class="actions"><button data-restore-refinery="1">Restore it: ${naira(t.refineryRestoreCost)}</button>${world.economy.funds < t.refineryRestoreCost ? bondButton("refinery") : ""}</span>`;
    } else if (refineryOutput(world) * SECONDS_PER_GAME_DAY < 1) {
      problem = `No crude arriving. Run a freight train (<kbd>G</kbd>) on track from ${source.name}, or ${haulierMove(`lorries (<kbd>L</kbd>) on a road.`, `build a haulage yard (<kbd>Y</kbd>) at ${source.name} so hauliers reach it by road.`)}`;
    } else if (isCutOff(world, townId)) {
      problem = `No road out: its fuel can't leave. Build one (<kbd>R</kbd>)${nearestTown ? ` to ${townName(nearestTown.id)}` : ""}.`;
    }
  } else if (site.industry === "newrefinery") {
    const cap = perDay(newRefineryCapacity(world));
    kicker = `Private refinery · ${perDay(newRefineryOutput(world))} of ${cap} t of fuel a day`;
    lines = [
      `Built and run privately; it opened ready to work. Up to ${cap} t of fuel a day, from ${perDay(newRefineryCrude(world))} t of crude.`,
      `Its crude comes from ${source.name}: by freight train on track, or by hauliers on a road from a haulage yard (<kbd>Y</kbd>) at ${source.name}. The leg is long: rail's.`,
      "Its fuel fills what the imports and the old refinery leave short, nearest it first; the rest leaves through the port.",
    ];
    if (isCutOff(world, townId)) problem = `No road reaches it: no crude can come in, no fuel go out, and its workers can't get there. Build one (<kbd>R</kbd>)${nearestTown ? ` to ${townName(nearestTown.id)}` : ""}.`;
    else if (crudeArriving(world, townId) * SECONDS_PER_GAME_DAY < 1) problem = `No crude arriving. Run a freight train (<kbd>G</kbd>) on track from ${source.name}, or build a haulage yard (<kbd>Y</kbd>) at ${source.name} so hauliers reach it by road.`;
  } else {
    const second = newRefinery(world);
    kicker = site.industry === "oilfield" ? "Oilfield · crude" : "Pipeline terminal · crude from the south";
    lines = [
      `${crude} t of crude a day for ${refinery.name}${fuel.restored ? "" : ", once it's restored"}.`,
      ...(second ? [`${perDay(newRefineryCrude(world))} t of crude a day for ${second.name}, the private refinery.`] : []),
      haulierMove(
        "Only you carry crude: by lorry on a road, or by freight train on track. Full lorries pay; track is dear on a leg this long.",
        "Nobody trucks crude unless you build a haulage yard (<kbd>Y</kbd>) here: then hauliers take it by road. Or a freight train on track.",
      ),
    ];
    if (!fuel.restored && !second) problem = `Waiting on ${refinery.name}: until it's restored, nobody wants this crude.`;
    else if (!fuel.restored && second && !railPath(world, townId, second.id) && !roadPath(world, townId, second.id)) problem = `No way to ${second.name}: lay track (<kbd>K</kbd>) for a freight train, or build a road (<kbd>R</kbd>) and a haulage yard (<kbd>Y</kbd>) here.`;
    else if (!fuel.restored) problem = "";
    else if (!railPath(world, townId, fuel.refineryId) && !roadPath(world, townId, fuel.refineryId)) problem = `No way to ${refinery.name}: lay track (<kbd>K</kbd>) for a freight train, or build a road (<kbd>R</kbd>)${world.tuning.noPlayerLorries ? " and a haulage yard (<kbd>Y</kbd>) here" : ""}.`;
    else if (world.tuning.noPlayerLorries && world.tuning.yardsEnabled && !world.yards.has(townId) && !railPath(world, townId, fuel.refineryId)) problem = `A road reaches ${refinery.name}, but nobody trucks crude: build a haulage yard (<kbd>Y</kbd>) here, or run a freight train on track.`;
  }
  if (!problem) problem = siteProblem(townId);
  townEl.innerHTML = `
    <div class="town-card">
      <div class="k">${kicker}</div>
      <div class="title">${site.name}</div>
      ${productionHtml(townId)}
      <ul>${lines.map((line) => `<li>${line}</li>`).join("")}${workersItem(townId)}</ul>
      ${problem ? `<p class="callout hook"><span class="k">The problem here</span>${problem}${action}</p>` : action}
      ${rows}
    </div>`;
}

// The cement works' or terminal's card (brief, Revision 3, step 2a): what it
// makes, from what, and the one thing holding it back.
function renderCementSite(townId: string): void {
  const cement = world.cement!;
  const site = world.towns.get(townId)!;
  const t = world.tuning;
  const perDay = (rate: number) => Math.round(rate * SECONDS_PER_GAME_DAY);
  const flows = goodsFlows(world).filter((flow) => flow.from === townId).sort((p, q) => q.rate - p.rate);
  const rows = flows
    .map((flow) => {
      const outcome = world.goods.outcomes.get(flowKey(flow));
      const total = (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0) + (outcome?.spoiled ?? 0);
      const delivered = total > 0 ? (outcome?.delivered ?? 0) / total : 0;
      const trucked = total > 0 ? (outcome?.trucked ?? 0) / total : 0;
      return `<div class="trip"><span class="name">${townName(flow.to)}</span><span class="num">${perDay(flow.rate)} t/day</span><div class="bar"><i style="width:${pct(delivered)};background:var(--goods)"></i><i style="width:${pct(trucked)};background:var(--informal)"></i></div></div>`;
    })
    .join("");
  const capacity = perDay(worksCapacity(world));
  let kicker = "";
  let lines: string[] = [];
  let problem = "";
  let action = "";
  if (site.industry === "silo") {
    kicker = "Cement terminal · imports";
    lines = [
      `Imports ${perDay(cementImports(world))} t of cement a day through the port, a share of what the towns want, split between them.`,
      "Truckers take it on short hauls (yellow on each bar); further than that, it's yours to carry or it waits.",
    ];
  } else {
    const out = perDay(worksOutput(world));
    kicker = cement.working ? `Cement works · ${out} of ${capacity} t a day` : "Cement works · idle";
    lines = [
      `Makes up to ${capacity} t of cement a day, from ${t.limestonePerCement} t of limestone a tonne: ${perDay(limestoneArriving(world))} t of limestone a day is reaching it.`,
      `Towns grow their first ${pct(t.cementFreeShare)} with local materials; past that, only as far as their cement lets them.`,
      `Its cement is split between the towns by what they want. Truckers take it on short hauls; the far towns' share waits for ${haulierMove("your lorries or freight trains", "a haulage yard here (<kbd>Y</kbd>: hauliers reach further) or freight trains")}.`,
    ];
    if (!cement.working) {
      problem = "Idle. Restore it, and limestone quarries open for it; until then the towns get only imports.";
      action = `<span class="actions"><button data-restore-works="1">Restore it: ${naira(t.worksRestoreCost)}</button>${world.economy.funds < t.worksRestoreCost ? bondButton("works") : ""}</span>`;
    } else if (world.industries.size === 0) {
      problem = "No quarry is open: it makes nothing until the next one opens. Connect it when it does.";
    } else if (![...world.industries.keys()].some((id) => roadPath(world, id, cement.worksId) || railPath(world, id, cement.worksId))) {
      const quarry = [...world.industries.keys()][0]!;
      problem = `No way to it from ${townName(quarry)}: build a road (<kbd>R</kbd>) or lay track (<kbd>K</kbd>) between them, and the limestone can come.`;
    } else if (limestoneArriving(world) * SECONDS_PER_GAME_DAY < 1) {
      problem = `No limestone arriving. Carry it from a quarry: ${haulierMove("a lorry (<kbd>L</kbd>) on a road", "build a haulage yard (<kbd>Y</kbd>) at the quarry so hauliers reach the works")}, or a freight train on track.`;
    } else if (out < capacity * 0.6) {
      problem = `Short of limestone: ${perDay(limestoneArriving(world))} of ${Math.round(capacity * t.limestonePerCement)} t a day. Carry more from a quarry, or connect another when one opens.`;
    }
  }
  if (!problem) problem = siteProblem(townId);
  townEl.innerHTML = `
    <div class="town-card">
      <div class="k">${kicker}</div>
      <div class="title">${site.name}</div>
      ${productionHtml(townId)}
      <ul>${lines.map((line) => `<li>${line}</li>`).join("")}${workersItem(townId)}</ul>
      ${problem ? `<p class="callout hook"><span class="k">The problem here</span>${problem}${action}</p>` : action}
      ${rows}
    </div>`;
}

// The steel chain's cards (steel.ts): the works, its mine, the port's terminal -- what each
// makes, from what, and the one thing holding it back, as the cement works' card does.
function renderSteelSite(townId: string): void {
  const steel = world.steel!;
  const site = world.towns.get(townId)!;
  const t = world.tuning;
  const perDay = (rate: number) => Math.round(rate * SECONDS_PER_GAME_DAY);
  const flows = goodsFlows(world).filter((flow) => flow.from === townId).sort((p, q) => q.rate - p.rate);
  const rows = flows
    .map((flow) => {
      const outcome = world.goods.outcomes.get(flowKey(flow));
      const total = (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0) + (outcome?.spoiled ?? 0);
      const delivered = total > 0 ? (outcome?.delivered ?? 0) / total : 0;
      const trucked = total > 0 ? (outcome?.trucked ?? 0) / total : 0;
      return `<div class="trip"><span class="name">${townName(flow.to)} <span class="muted">· ${cargoName(world, flow.from, flow.kind, flow.to)}</span></span><span class="num">${perDay(flow.rate)} t/day</span><div class="bar"><i style="width:${pct(delivered)};background:var(--goods)"></i><i style="width:${pct(trucked)};background:var(--informal)"></i></div></div>`;
    })
    .join("");
  let kicker = "";
  let lines: string[] = [];
  let problem = "";
  let action = "";
  if (site.industry === "steelport") {
    kicker = "Steel terminal · imports";
    lines = [
      `Imports ${perDay(steelImports(world))} t of steel a day through the port, a share of what the towns want, split between them.`,
      `Towns grow past ${pct(t.steelFreeShare)} of their start only as far as their steel lets them (cement takes them to ${pct(t.cementFreeShare)}).`,
      "Truckers take it on short hauls; further than that, it's yours to carry or it waits.",
    ];
  } else if (site.industry === "ironmine") {
    kicker = steel.working ? `Iron ore mine · ${perDay(mineOutput(world))} t a day` : "Iron ore mine · waiting on the works";
    lines = [
      `Digs ${t.mineOutputPerDay} t of ore a day for ${steel.worksId ? townName(steel.worksId) : "the steel works"} once it runs: ${t.orePerSteel} t makes a tonne of steel.`,
      "A long haul from the works, and no road between them: the ore's way there is yours to build -- a road and a haulage yard, or track and freight trains.",
    ];
    if (!steel.working) problem = `Nobody wants its ore while ${steel.worksId ? townName(steel.worksId) : "the works"} is idle. Restore the works first.`;
    else if (steel.worksId && !roadPath(world, townId, steel.worksId) && !railPath(world, townId, steel.worksId)) problem = `No way from here to ${townName(steel.worksId)}: build a road (<kbd>R</kbd>) or lay track (<kbd>K</kbd>), and the ore can go.`;
  } else {
    const capacity = perDay(steelCapacity(world));
    const out = perDay(steelOutput(world));
    kicker = steel.working ? `Steel works · ${out} of ${capacity} t a day` : "Steel works · idle";
    lines = [
      `Makes up to ${capacity} t of steel a day, from ${t.orePerSteel} t of iron ore a tonne: ${perDay(oreArriving(world))} t of ore a day is reaching it.`,
      `Towns grow past ${pct(t.steelFreeShare)} of their start only as far as their steel lets them: the big towns' last growth.`,
      `Built, never run (Ajaokuta). Its steel is split between the towns its roads reach; the far towns' share waits for ${haulierMove("your lorries or freight trains", "a haulage yard here (<kbd>Y</kbd>) or freight trains")}.`,
    ];
    if (!steel.working) {
      problem = `Idle. Restore it, and its mine${steel.mineId ? ` at ${townName(steel.mineId)}` : ""} starts digging; until then the towns get only the port's imports.`;
      action = `<span class="actions"><button data-restore-steel="1">Restore it: ${naira(t.steelRestoreCost)}</button>${world.economy.funds < t.steelRestoreCost ? bondButton("steel") : ""}</span>`;
    } else if (steel.mineId && !roadPath(world, steel.mineId, townId) && !railPath(world, steel.mineId, townId)) {
      problem = `No way to it from ${townName(steel.mineId)}: build a road (<kbd>R</kbd>) or lay track (<kbd>K</kbd>) between them, and the ore can come.`;
    } else if (out < capacity * 0.6) {
      problem = `Short of ore: ${perDay(oreArriving(world))} of ${Math.round(capacity * t.orePerSteel)} t a day. Carry it from the mine: a haulage yard there (<kbd>Y</kbd>), or a freight train on track.`;
    }
  }
  if (!problem) problem = siteProblem(townId);
  townEl.innerHTML = `
    <div class="town-card">
      <div class="k">${kicker}</div>
      <div class="title">${site.name}</div>
      ${productionHtml(townId)}
      <ul>${lines.map((line) => `<li>${line}</li>`).join("")}${workersItem(townId)}</ul>
      ${problem ? `<p class="callout hook"><span class="k">The problem here</span>${problem}${action}</p>` : action}
      ${rows}
    </div>`;
}

// Jobs at sites a town's people reach (workers.ts, step 2c): room to grow.
function jobsText(townId: string): string {
  const room = jobsGrowth(world, townId);
  if (room < 0.3) return "";
  const at = [...world.towns.values()].filter((site) => site.industry && (workforceShares(world, site).get(townId) ?? 0) * siteJobs(world, site) >= 0.05).map((site) => site.name);
  return `<p class="townshare"><b>Jobs:</b> its people work at ${at.join(", ")}: room for ${Math.round(room)}k more people while they get there.</p>`;
}

// The mill's card (food.ts, step 3): what it makes, from what, for whom, and what holds it back.
function renderMillSite(townId: string): void {
  const food = world.food!;
  const site = world.towns.get(townId)!;
  const t = world.tuning;
  const perDay = (rate: number) => Math.round(rate * SECONDS_PER_GAME_DAY);
  const flows = goodsFlows(world).filter((flow) => flow.from === townId || flow.to === townId).sort((p, q) => q.rate - p.rate);
  const rows = flows
    .map((flow) => {
      const outcome = world.goods.outcomes.get(flowKey(flow));
      const total = (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0) + (outcome?.spoiled ?? 0);
      const delivered = total > 0 ? (outcome?.delivered ?? 0) / total : 0;
      const trucked = total > 0 ? (outcome?.trucked ?? 0) / total : 0;
      const other = flow.from === townId ? flow.to : flow.from;
      return `<div class="trip"><span class="name">${flow.from === townId ? "→" : "←"} ${townName(other)} <span class="muted">· ${cargoName(world, flow.from, flow.kind, flow.to)}</span></span><span class="num">${perDay(flow.rate)} t/day</span><div class="bar"><i style="width:${pct(delivered)};background:var(--goods)"></i><i style="width:${pct(trucked)};background:var(--informal)"></i></div></div>`;
    })
    .join("");
  const out = perDay(millOutput(world));
  const cap = perDay(millCapacity(world));
  let problem = "";
  if (stapleArriving(world) * SECONDS_PER_GAME_DAY < 1) problem = `No ${food.crops.staple} arriving. Carry it in from the farm towns: ${haulierMove(`lorries (<kbd>L</kbd>)`, `build a haulage yard (<kbd>Y</kbd>) at a farm town so hauliers reach the mill`)}, or truckers will on the short hauls once a road joins them.`;
  else if (out < cap * 0.6) {
    // Name the farm town whose staple is most stuck, with no yard yet (map 2418: "carry more
    // in from the farm towns further off" didn't say which, or how).
    const stuck = goodsFlows(world)
      .filter((flow) => flow.to === food.millId && !world.yards.has(flow.from))
      .map((flow) => {
        const o = world.goods.outcomes.get(flowKey(flow));
        return { from: flow.from, left: Math.max(0, flow.rate - (o?.delivered ?? 0) - (o?.trucked ?? 0)) };
      })
      .sort((p, q) => q.left - p.left)[0];
    const where = stuck && perDay(stuck.left) >= 3 ? `: ${perDay(stuck.left)} t a day of ${townName(stuck.from)}'s waits there` : "";
    problem = `Short of ${food.crops.staple}: ${perDay(stapleArriving(world))} of ${Math.round(cap * t.staplePerFood)} t a day. ${haulierMove(
      "Carry more in from the farm towns further off.",
      stuck && where ? `Build a haulage yard (<kbd>Y</kbd>) at ${townName(stuck.from)}${where}, so hauliers reach the mill.` : "Build haulage yards (<kbd>Y</kbd>) at the farm towns further off, so hauliers reach the mill.",
    )}`;
  }
  if (!problem) problem = siteProblem(townId);
  townEl.innerHTML = `
    <div class="town-card">
      <div class="k">Mill · ${out} of ${cap} t of ${food.crops.food} a day</div>
      <div class="title">${site.name}</div>
      ${productionHtml(townId)}
      <ul>
        <li>Makes ${food.crops.food} from the farm towns' ${food.crops.staple}: ${t.staplePerFood} t makes a tonne. ${perDay(stapleArriving(world))} t a day is reaching it.</li>
        <li>Its ${food.crops.food} is split between the market towns by what they want. A fed market draws trade: more trips, and room to grow.</li>
        <li>Truckers take short hauls (yellow on each bar); the far markets' share waits for ${haulierMove("your lorries or freight trains", "a haulage yard here (<kbd>Y</kbd>) or freight trains")}.</li>
        ${workersItem(townId)}
      </ul>
      ${problem ? `<p class="callout hook"><span class="k">The problem here</span>${problem}</p>` : ""}
      ${rows}
    </div>`;
}

// The flour mill's card (food.ts, step 3c): imported wheat in from the port, flour out to the markets.
function renderFlourMillSite(townId: string): void {
  const site = world.towns.get(townId)!;
  const t = world.tuning;
  const perDay = (rate: number) => Math.round(rate * SECONDS_PER_GAME_DAY);
  const flows = goodsFlows(world).filter((flow) => flow.from === townId || flow.to === townId).sort((p, q) => q.rate - p.rate);
  const rows = flows
    .map((flow) => {
      const outcome = world.goods.outcomes.get(flowKey(flow));
      const total = (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0) + (outcome?.spoiled ?? 0);
      const delivered = total > 0 ? (outcome?.delivered ?? 0) / total : 0;
      const trucked = total > 0 ? (outcome?.trucked ?? 0) / total : 0;
      const other = flow.from === townId ? flow.to : flow.from;
      return `<div class="trip"><span class="name">${flow.from === townId ? "→" : "←"} ${townName(other)} <span class="muted">· ${cargoName(world, flow.from, flow.kind, flow.to)}</span></span><span class="num">${perDay(flow.rate)} t/day</span><div class="bar"><i style="width:${pct(delivered)};background:var(--goods)"></i><i style="width:${pct(trucked)};background:var(--informal)"></i></div></div>`;
    })
    .join("");
  const out = perDay(flourOutput(world));
  const cap = perDay(flourCapacity(world));
  let problem = "";
  if (isCutOff(world, townId) || !roadPath(world, townId, world.port ?? townId)) problem = "No road to the port: the wheat can't come in. Build one (<kbd>R</kbd>).";
  else if (wheatArriving(world) * SECONDS_PER_GAME_DAY < 1) problem = `No wheat arriving from the port yet: truckers bring it on its short road, or ${haulierMove("run a lorry (<kbd>L</kbd>).", "build a haulage yard (<kbd>Y</kbd>) at the port so hauliers reach the mill.")}`;
  if (!problem) problem = siteProblem(townId);
  townEl.innerHTML = `
    <div class="town-card">
      <div class="k">Flour mill · ${out} of ${cap} t of flour a day</div>
      <div class="title">${site.name}</div>
      ${productionHtml(townId)}
      <ul>
        <li>Mills imported wheat into flour: ${t.wheatPerFlour} t makes a tonne. ${perDay(wheatArriving(world))} t a day is reaching it from the port.</li>
        <li>Its flour goes to the market towns, split by what they want: ${pct(t.flourWeight)} of a market's food. Truckers take short hauls; the far markets' share waits for ${haulierMove("your lorries or freight trains", "a haulage yard here (<kbd>Y</kbd>) or freight trains")}.</li>
        ${workersItem(townId)}
      </ul>
      ${problem ? `<p class="callout hook"><span class="k">The problem here</span>${problem}</p>` : ""}
      ${rows}
    </div>`;
}

// A town's food (food.ts): a market's supply and the trade it draws; a farm town's crops.
function foodText(townId: string): string {
  const food = world.food;
  if (!food || !foodActive(world) || !world.basePopulation.has(townId)) return "";
  const perDay = (rate: number) => Math.round(rate * SECONDS_PER_GAME_DAY);
  let out = "";
  if (foodWant(world, townId) > 0) {
    // The basket: the region's food, and flour from the port's mill where there is one.
    const served = steadyFood(world, townId).market;
    const flour = food.flourMillId ? `, ${pct(steadyFood(world, townId).flour)} of its ${perDay(flourWant(world, townId))} t of flour` : "";
    const extra = Math.round(world.tuning.marketTripBoost * 100);
    const state = served >= 0.8 ? `Its market is busy: trade draws ${pct(world.tuning.marketTripBoost * served)} more trips to it.`
      : served >= 0.2 ? `Its market is ${served >= 0.5 ? "short" : "half empty"}: trade draws ${pct(world.tuning.marketTripBoost * served)} more trips to it, of a possible ${extra}%.`
      : `Its market is empty: fed, its trade would draw up to ${extra}% more trips. Carry ${food.crops.food} from ${townName(food.millId)}.`;
    out += `<p class="townshare"><b>Food:</b> ${pct(steadyFood(world, townId).food)} of the ${perDay(foodWant(world, townId))} t of ${food.crops.food} it wants a day${flour}. ${state}</p>`;
  }
  if (farmTowns(world).some((town) => town.id === townId)) {
    const town = world.towns.get(townId)!;
    const land = farmland(world, town);
    out += `<p class="townshare"><b>Farms:</b> ${Math.round(world.tuning.producePerThousandPerDay * land)} t of ${food.crops.staple} a day for ${townName(food.millId)}, and ${Math.round(world.tuning.cashCropPerThousandPerDay * land)} t of ${food.crops.cash} for export through the port.</p>`;
  }
  return out;
}

// A town's cement (cement.ts): how well supplied, and what that's holding back.
function cementText(townId: string): string {
  if (!world.cement || !cementActive(world) || !world.basePopulation.has(townId)) return "";
  const served = cementServed(world, townId);
  const growth = townGrowth(world, townId);
  const held = growth && growth.cementHeld > growth.base * 0.02 ? ` Short, it holds ${Math.round(growth.cementHeld)}k people of growth back.` : "";
  return `<p class="townshare"><b>Cement:</b> ${pct(served)} of what it wants. It grows its first ${pct(world.tuning.cementFreeShare)} without; past that, only as far as its cement lets it.${held}</p>`;
}

// A town's fuel (fuel.ts): how well supplied, from where, and why not more.
function fuelText(townId: string): string {
  const supply = steadyFuel(world, townId);
  if (!supply || !world.fuel) return "";
  const sources = [`${pct(Math.min(1, supply.imported))} imported`, ...(supply.refined > 0.005 ? [`${pct(supply.refined)} from the refinery`] : [])].join(", ");
  const why = isCutOff(world, townId)
    ? " No road reaches it, so no fuel does."
    : supply.supplied < 0.6
      ? world.fuel.restored ? " Short: carry fuel to it, or get more crude to the refinery." : " Short: the tankers barely reach it. A working refinery would make up the rest."
      : "";
  // What the shortage is doing here (fuel.ts, step 1b).
  const short = steadyShortage(world, townId);
  const t = world.tuning;
  const effects = steadyOver(world, `fuel-effects:${townId}`, short, 0.1)
    ? ` Danfo fares here +${pct(t.fuelFarePremium * short)}, ${pct(t.fuelParked * short)} of their road space parked; your vehicles pay +${pct(t.fuelCostPremium * short)} to run here, and riders wait longer for you.${steadyOver(world, `sellers:${townId}`, short, 0.35) ? " Roadside sellers sell fuel at a premium." : ""}`
    : "";
  return `<p class="townshare"><b>Fuel:</b> ${pct(supply.supplied)} supplied (${sources}).${why}${effects}</p>`;
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
        ? `<i style="width:${pct(s.player)};background:var(--you)"></i><i style="width:${pct(s.informal)};background:var(--informal)"></i><i style="width:${pct(s.lost)};background:var(--home)"></i>`
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
  townEl.innerHTML = `
    <div class="town-card">
      <div class="k">${kicker}</div>
      <div class="title">${town.name}</div>
      <ul>
        ${biggestLine ? `<li>${biggestLine}</li>` : ""}
        <li>Of its trips: you ${pct(share.player)}, informal ${pct(share.informal)}, stayed home ${pct(share.lost)}.${changingText(townId)}</li>
        <li>Inside: ~${Math.round(local.tripsPerDay).toLocaleString()} short trips a day by keke and okada, not counted against you.</li>
        ${metroItem(townId)}
        ${parkItem(townId)}
      </ul>
      ${strikeBadge(laneAtTown(townId))}
      ${problemText(townId)}
      ${growthText(townId, town.name)}
      ${serviceText(townId, town.name)}
      ${world.tuning.railEnabled ? haltText(townId, town.name) : ""}
      ${world.tuning.goodsEnabled && (townId === world.port || townId === world.seaport) ? seaportText() + portHtml() : ""}
      ${world.tuning.goodsEnabled ? fuelText(townId) : ""}
      ${world.tuning.goodsEnabled ? cementText(townId) : ""}
      ${world.tuning.goodsEnabled ? foodText(townId) : ""}
      ${jobsText(townId)}
      ${world.tuning.goodsEnabled ? goodsText(townId) : ""}
      ${rows}
      <div class="pager">
        <button data-select="${prev}">‹ ${townName(prev)}</button>
        <span class="count">${index + 1} of ${pagerTowns.length}</span>
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
  return `<span class="actions"><button data-project="${full.road.a}|${full.road.b}|${rung}" title="${world.tuning.remittanceEnabled ? `The treasury leaves what you hold toward it alone for ${world.tuning.projectLapseDays} days` : "Name it as what you're saving for"}">Save for it: ${naira(price)}</button></span>`;
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
  // Grown as far as its cement lets it (cement.ts): the road isn't what's stopping it.
  const growth = townGrowth(world, townId);
  const town = world.towns.get(townId);
  if (growth && town && world.cement && growth.cementHeld > growth.base * 0.05 && town.population >= growth.target * 0.97) {
    const works = townName(world.cement.worksId);
    // The move depends on where the chain is broken (cement.ts cementBreak).
    const broken = cementBreak(world);
    const move =
      broken?.kind === "idle" ? `Restore ${works}, then bring it limestone.`
      : broken?.kind === "no-quarry" ? `No quarry is working, so ${works} has no limestone: the next opens about day ${broken.nextDay} -- give it a road and a haulage yard (<kbd>Y</kbd>) when it does.${broken.siloId ? ` Meanwhile imported cement comes through ${townName(broken.siloId)}: a yard there lets hauliers reach further.` : ""}`
      : broken?.kind === "quarry" ? `${works} is short of limestone: ${townName(broken.quarryId)} is working but little reaches it. Give the quarry a road (<kbd>R</kbd>) and a haulage yard (<kbd>Y</kbd>), or track for a freight train.`
      : `Carry cement from ${works}: ${haulierMove("a lorry (<kbd>L</kbd>), or a freight train on track.", `build a haulage yard (<kbd>Y</kbd>) at ${works} so hauliers reach it, or a freight train on track.`)}`;
    return `<p class="callout hook"><span class="k">The problem here</span>${townName(townId)} can't grow: no cement. It gets ${pct(cementServed(world, townId))} of what it wants; all of it would grow it ${Math.round(growth.cementHeld)}k more. ${move}</p>`;
  }
  // Grown as far as its steel lets it (steel.ts): past +80%, the big towns' last growth.
  if (growth && town && world.steel && growth.steelHeld > growth.base * 0.05 && town.population >= growth.target * 0.97) {
    const broken = steelBreak(world);
    const move = broken?.kind === "idle" ? `Restore ${townName(world.steel.worksId!)} (its card), and bring it ore.`
      : broken?.kind === "ore" ? `${townName(world.steel.worksId!)} is short of ore: connect ${townName(broken.mineId)} -- a haulage yard (<kbd>Y</kbd>), or track and a freight train.`
      : broken?.kind === "carry" ? `Carry steel from ${townName(broken.from)}: ${haulierMove("a freight train on track, or a lorry", `a haulage yard (<kbd>Y</kbd>) at ${townName(broken.from)} so hauliers reach further, or a freight train on track`)}.`
      : "";
    return `<p class="callout hook"><span class="k">The problem here</span>${townName(townId)} can't grow: no steel. It gets ${pct(steelServed(world, townId))} of what it wants; all of it would grow it ${Math.round(growth.steelHeld)}k more. ${move}</p>`;
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
      return `Worn roads${roads ? ` (${roads})` : ""} cost your buses ${naira(rough)}/day extra to run and hold them to ${pct(d.wornSpeed)} speed. Maintaining them (Fix tool, F) costs about ${naira(upkeep)}/day: ${verdict}. Paved roads wear ${pavedWear()}.`;
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
        <i style="width:${pct(d.carried)};background:var(--you)"></i>
        <i style="width:${pct(d.poached)};background:var(--informal)"></i>
        <i style="width:${pct(d.gaveUp)};background:var(--informal-light)"></i>
        <i style="width:${pct(d.lost)};background:var(--home)"></i>
      </div>`
    : "";
  const signed = `${s.netPerDay < 0 ? "−" : "+"}₦${Math.abs(Math.round(s.netPerDay)).toLocaleString()}`;
  return `
    <div class="route-card" data-route="${s.id}" title="${long.replace(/"/g, "&quot;")}">
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

function budgetParts() {
  const b = averageBudget(world);
  const signed = (x: number) => `${x < 0 ? "−" : "+"}₦${Math.abs(Math.round(x)).toLocaleString()}`;
  const lines: Array<[string, number]> = [
    ["Fares", b.fares],
    ...(world.tuning.goodsEnabled ? [["Goods", b.goods] as [string, number]] : []),
    ["Tolls", b.tolls],
    [`Park levies <span class="muted">(agberos kept ${naira(b.agberos)})</span>`, b.levies],
    ...(world.tuning.truckersEnabled && world.tuning.goodsEnabled ? [[`Loading levies <span class="muted">(touts kept ${naira(b.touts)})</span>`, b.loading] as [string, number]] : []),
    ["State allocation", b.allocation],
    ...(world.food && world.tuning.foodEnabled ? [["Export payments", b.exports] as [string, number]] : []),
    ...(world.metros.size > 0 ? [["Metro fares", b.metro] as [string, number]] : []),
    ["Running costs", -b.running],
    ...(world.fuel && world.tuning.fuelEnabled ? [["Fuel above the pump price", -b.fuel] as [string, number]] : []),
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
  const took = t.levyEnabled
    ? `<span class="muted">Treasury levy, ${pct(t.levyShare)} of earnings</span><span class="num ${b.remitted >= 0.5 ? "bad" : ""}">${b.remitted >= 0.5 ? signed(-b.remitted) : "₦0"}</span>`
    : t.remittanceEnabled
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
  // The budget year's end (sweep.ts): what would go back, and what you may keep.
  const sweep = t.sweepEnabled
    ? sweepDue(world) >= 1
      ? `<p class="callout hook treasury"><span class="k">Budget year</span>It ends day ${gameDay(world, world.sweep.endsAtSeconds)}: ${naira(sweepDue(world))} above what you may carry over (${naira(carryOver(world))}) goes back to the treasury unless you spend it or name a project.</p>`
      : `<p class="hint">Budget year ends day ${gameDay(world, world.sweep.endsAtSeconds)}; you may carry over ${naira(carryOver(world))}.</p>`
    : "";
  const project = world.project;
  const held = project ? heldForProject(world) : 0;
  const saving = project
    ? `<p class="callout hook"><span class="k">Saving for</span>The ${project.rung === "lane" ? "bus lane" : "rail line"} on ${townName(project.a)} – ${townName(project.b)}: ${naira(held)} of ${naira(project.price)} set aside${!world.tuning.remittanceEnabled ? `${project.affordableAt === null ? "." : ": you can afford it now."}` : `, safe from the treasury`}${!world.tuning.remittanceEnabled ? "" : project.affordableAt === null ? ` while you save. Once you can afford it, you have ${world.tuning.projectLapseDays} days to build it` : `: you can afford it, so build it by day ${gameDay(world, projectLapsesAt(world, project))} or the savings lapse`}.
        <span class="bar project-bar" title="${pct(held / project.price)} set aside"><i style="width:${pct(Math.min(1, held / project.price))};background:var(--you)"></i></span>
        <span class="actions">${bondButton("project")}<button data-drop-project="1">Drop it</button></span></p>`
    : "";
  const costs = ["Running costs", "Fuel above the pump price", "Road upkeep", "Lane enforcement"];
  const income = lines.filter(([label]) => !costs.includes(label));
  const spending = lines.filter(([label]) => costs.includes(label));
  const row = ([label, x]: [string, number]) => `<span>${label}</span><span class="num ${x < 0 ? "bad" : ""}">${signed(x)}</span>`;
  const bondsLine = b.bonds >= 0.5 ? `<span class="muted">Bond repayments</span><span class="num bad">${signed(-b.bonds)}</span>` : "";
  const kept = net - b.remitted - b.bonds;
  const levyHint = t.levyEnabled ? `<p class="hint">The treasury takes ${pct(t.levyShare)} of what you earn, as you earn it: fares, goods, tolls and levies, not the state's allocation. What you keep, you keep.</p>` : "";
  const remitHint = t.remittanceEnabled ? `<p class="hint">Every ${t.remittancePeriodDays} days the treasury takes ${pct(t.remittanceShare)} of funds above ${naira(t.remittanceReserve)}, never more than the period's surplus. Money set aside for a project is safe.</p>` : "";
  return { b, signed, lines, income, spending, row, net, kept, took, bondsLine, struck, countdown, sweep, saving, levyHint, remitHint };
}

// The Treasury drawer (brief, Revision 3, Money, 5; the design lab pick,
// 2026-10-20: "treasury=drawer"): a one-line tab above the toolbar, out on
// hover into four columns -- where money comes from, where it goes, what
// the treasury and your bonds take and what you keep, and each chain in a
// line -- so the side panel is your routes and towns again.
function treasuryHtml(): string {
  const p = budgetParts();
  const chains = chainLines();
  const worst = chains.find((chain) => chain.state === "bad") ?? chains.find((chain) => chain.state === "warn");
  const tab = `<div class="tab"><span class="k">Treasury</span> <span class="num ${p.kept < 0 ? "bad" : "good"}">${p.signed(p.kept)}/day kept</span>${p.b.remitted >= 0.5 ? ` · levy <span class="num bad">${p.signed(-p.b.remitted)}</span>` : ""}${p.b.bonds >= 0.5 ? ` · bonds <span class="num bad">${p.signed(-p.b.bonds)}</span>` : ""}${world.tuning.sweepEnabled && sweepDue(world) >= 1 ? ` · year ends day ${gameDay(world, world.sweep.endsAtSeconds)}: <span class="num bad">−${naira(sweepDue(world))}</span> to go` : ""}${worst ? ` · <span class="chain ${worst.state}"><b>${worst.name}</b> ${worst.short}</span>` : ""}<span class="more">▴</span></div>`;
  const income = p.income.reduce((sum, [, x]) => sum + x, 0);
  const spent = p.spending.reduce((sum, [, x]) => sum + x, 0);
  const col = (title: string, inner: string) => `<div class="tcol"><h3>${title}</h3>${inner}</div>`;
  return `${tab}<div class="drawer-body">
    <p class="hint">A day, 5-day average.</p>
    <div class="tgrid">
      ${col("Income", `<div class="budget">${p.income.map(p.row).join("")}<span class="total">In</span><span class="total num">${p.signed(income)}</span></div>`)}
      ${col("Spending", `<div class="budget">${p.spending.map(p.row).join("")}<span class="total">Out</span><span class="total num bad">${p.signed(spent)}</span>${p.struck}</div>`)}
      ${col("Treasury and bonds", `<div class="budget"><span class="muted">Net</span><span class="num ${p.net < 0 ? "bad" : ""}">${p.signed(p.net)}</span>${p.took}${p.bondsLine}<span class="total">You keep</span><span class="total num ${p.kept < 0 ? "bad" : "good"}">${p.signed(p.kept)}</span></div>${p.countdown}${p.sweep}${bondsHtml(p.b.bonds)}${p.saving}${p.levyHint}${p.remitHint}`)}
      ${col("Chains", chains.length > 0 ? chains.map((chain) => `<p class="chain ${chain.state}"><b>${chain.name}</b> ${chain.line}</p>`).join("") : `<p class="hint">No chains on this map.</p>`)}
    </div></div>`;
}

/** Each chain in a line (fuel.ts, cement.ts, workers.ts): how it stands, and what it's costing you. */
function chainLines(): Array<{ name: string; state: "good" | "warn" | "bad"; line: string; short: string }> {
  const out: Array<{ name: string; state: "good" | "warn" | "bad"; line: string; short: string }> = [];
  const perDay = (rate: number) => Math.round(rate * SECONDS_PER_GAME_DAY);
  if (world.fuel && world.tuning.fuelEnabled && world.tuning.goodsEnabled) {
    const towns = [...world.towns.values()].filter((town) => !town.industry && !isCutOff(world, town.id));
    const short = towns.map((town) => ({ town, s: fuelSupply(world, town.id)?.supplied ?? 1 })).filter((x) => x.s < 0.6).sort((p, q) => p.s - q.s);
    const premium = averageBudget(world).fuel;
    const refinery = world.fuel.restored ? `the refinery makes ${perDay(refineryOutput(world))} t/day` : "the refinery is idle";
    out.push(short.length === 0
      ? { name: "Fuel", state: "good", line: `Every town supplied; ${refinery}.`, short: "supplied" }
      : { name: "Fuel", state: short.length >= 3 ? "bad" : "warn", line: `${short.slice(0, 3).map((x) => `${x.town.name} ${pct(x.s)}`).join(", ")}${short.length > 3 ? ` and ${short.length - 3} more` : ""} supplied: ${naira(premium)}/day above the pump price; ${refinery}.`, short: `short in ${short.length} town${short.length === 1 ? "" : "s"}` });
  }
  if (world.cement && cementActive(world)) {
    const held = [...world.basePopulation.keys()].map((id) => ({ id, held: townGrowth(world, id)?.cementHeld ?? 0 })).filter((x) => x.held > 1).sort((p, q) => q.held - p.held);
    const full = world.cement.working && worksOutput(world) >= 0.95 * worksCapacity(world) && expandCost(world, world.cement.worksId) !== null;
    const works = world.cement.working ? `Works at ${perDay(worksOutput(world))} of ${perDay(worksCapacity(world))} t/day${full ? ` -- at capacity: expand it (${naira(expandCost(world, world.cement.worksId)!)})` : ""}` : "The works is idle";
    out.push(held.length === 0
      ? { name: "Cement", state: world.cement.working ? "good" : "warn", line: `${works}; no town held back.`, short: "enough" }
      : { name: "Cement", state: held.length >= 3 ? "bad" : "warn", line: `${works}; ${held.slice(0, 2).map((x) => `${townName(x.id)} held back ${Math.round(x.held)}k`).join(", ")}${held.length > 2 ? ` and ${held.length - 2} more` : ""}.`, short: `${held.length} town${held.length === 1 ? "" : "s"} held back` });
  }
  if (world.food && foodActive(world)) {
    const food = world.food;
    const markets = [...world.basePopulation.keys()].filter((id) => foodWant(world, id) > 0).map((id) => ({ id, s: marketFed(world, id) })).sort((p, q) => p.s - q.s);
    const short = markets.filter((x) => x.s < 0.5);
    const exports = perDay(exportsArriving(world));
    const mill = `the mill makes ${perDay(millOutput(world))} of ${perDay(millCapacity(world))} t/day${food.flourMillId ? `, the flour mill ${perDay(flourOutput(world))} of ${perDay(flourCapacity(world))}` : ""}`;
    const exportLine = `${exports} t/day of ${food.crops.cash} exported`;
    out.push(short.length === 0
      ? { name: "Food", state: "good", line: `Every market fed; ${mill}; ${exportLine}.`, short: "markets fed" }
      : { name: "Food", state: short.length === markets.length ? "bad" : "warn", line: `${short.slice(0, 3).map((x) => `${townName(x.id)} ${pct(x.s)}`).join(", ")} fed: market trade thin; ${mill}; ${exportLine}.`, short: `${short.length} market${short.length === 1 ? "" : "s"} short` });
  }
  if (world.tuning.workersEnabled) {
    const sites = [...world.towns.values()].filter((site) => site.industry && siteJobs(world, site) > world.tuning.jobsIdle + 1e-9);
    const short = sites.filter((site) => staffing(world, site.id) < 0.8);
    if (sites.length > 0) out.push(short.length === 0
      ? { name: "Workers", state: "good", line: "Every working site fully staffed.", short: "staffed" }
      : { name: "Workers", state: "warn", line: `${short.map((site) => `${site.name} ${pct(staffing(world, site.id))}`).join(", ")} of a full shift.`, short: `${short.length} site${short.length === 1 ? "" : "s"} short` });
  }
  return out;
}

// The bonds you owe on (bonds.ts): what for, what's left, what it costs a day.
function bondsHtml(_repaidPerDay: number): string {
  const owing = world.bonds.filter((bond) => bond.owed > 0.5);
  if (owing.length === 0) return "";
  const rows = owing
    .map((bond) => `<li>${bond.label}: ${naira(bond.owed)} left, ${naira(bond.perDay)}/day for ${Math.ceil(bond.owed / bond.perDay)} more days</li>`)
    .join("");
  return `<p class="hint"><b>Bonds</b></p><ul class="hint">${rows}</ul>`;
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
    .filter((c) => c.takenSince !== null || c.you >= 0.005 || seatOf(c.key) >= NO_SEAT_MIN_PER_DAY || (roadChain(world, c.a, c.b) ?? []).some((p) => p.retiredAt !== undefined))
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
          <div class="bar" title="you / informal / stayed home"><i style="width:${pct(c.you)};background:var(--you)"></i><i style="width:${pct(c.informal)};background:var(--informal)"></i><i style="width:${pct(c.lost)};background:var(--home)"></i></div>
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
  // Retired (retire.ts): when it goes, and the way back.
  const piece = world.simulation.map.segments.find((segment) => segment.id === id);
  if (piece?.retiredAt !== undefined) {
    return `<div class="wear">Retired day ${gameDay(world, piece.retiredAt)} · gone day ${gameDay(world, goneAt(world, piece))} <span class="actions"><button data-restore="${id}" title="Repair it to new and keep it">Restore ${naira(restoreRoadCost(world, id))}</button></span></div>`;
  }
  const yours = (roadChain(world, a, b) ?? []).every((p) => isYourRoad(p));
  const retire = yours ? `<button data-retire="${id}" title="Stop its upkeep and tolls now; it decays and is gone in ${world.tuning.retireGoneDays} days. Towns it joined can be cut off; your routes on it go round, or are sold if nothing else joins their towns. Track can then be laid on its line for less (K).">Retire</button>` : "";
  if (wear.kept) return `<div class="wear">Kept up · ${naira(wear.upkeepPerDay)}/day <span class="actions"><button data-keep="${id}|0" title="Stop paying to keep it up: it starts wearing again">Stop</button>${retire}</span></div>`;
  const state = wear.condition >= 0.97 ? "Sound" : `Worn: ${pct(wear.speed)} speed${wear.roughPerDay >= 1 ? ` · costs your vehicles ${naira(wear.roughPerDay)}/day` : ""}`;
  const fix = wear.repair >= 1 ? `<button data-fixnow="${id}" title="Repair all of it to new, once">Fix now ${naira(wear.repair)}</button>` : "";
  return `<div class="wear">${state} <span class="actions"><button data-keep="${id}|1" title="Repair it as it wears, billed as it goes${wear.repair >= 1 ? `; the catch-up repair (${naira(wear.repair)}) is charged now` : ""}">Keep it up ${naira(wear.upkeepPerDay)}/day</button>${fix}${retire}</span></div>`;
}

// Your share of trips between towns: one click down, not the headline
// (brief: as a headline it falls exactly when you grow towns).
function shareHtml(): string {
  const share = networkShare(world);
  return `<h2 class="section">Who carried trips between towns</h2>
    <div class="bar share-bar"><i style="width:${pct(share.player)};background:var(--you)"></i><i style="width:${pct(share.informal)};background:var(--informal)"></i><i style="width:${pct(share.lost)};background:var(--home)"></i></div>
    <p class="hint">You ${pct(share.player)} · informal ${pct(share.informal)} · stayed home ${pct(share.lost)}</p>`;
}

function renderRoutes(): void {
  const summaries = routeSummaries(world);
  const advice = forecasting ? bestMovesHtml() + resultsHtml() : "";
  const header = `<h2>Your routes</h2><p class="hint">Worst first. Net over the last day; hover a card for why.</p>`;
  const routes = summaries.length === 0 && world.lorryRoutes.length === 0
    ? `${header}<p class="empty">No buses yet. Hover a town to see where its people want to go.</p>`
    : (summaries.length > 0 ? header + summaries.map(routeCard).join("") : "") + lorryRows(summaries.length > 0);
  // The budget lives in the Treasury drawer now (renderTreasury), not under the routes.
  routesEl.innerHTML = moneyNote() + advice + routes + corridorsHtml() + shareHtml();
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
        <small>${forGoodsVehicle(`goods along it: ${Math.round(d.outbound)} t/day ${townName(s.a)}→${townName(s.b)}, ${Math.round(d.inbound)} back · lorries ${pct(d.loadFactor)} full`, s.id)}</small>${freightRateRow(s.id)}`
      : "";
    return `
      <div class="route" data-route="${s.id}">
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

// A freight line's rate (freightrates.ts): cheap, standard or dear, and what it's doing --
// who carries the goods along the line, and what spoils.
function freightRateRow(routeId: string): string {
  if (!isFreightRoute(routeId) || !world.tuning.freightRatesEnabled) return "";
  const rate = freightRate(world, routeId);
  const t = world.tuning;
  const split = freightLineSplit(world, routeId);
  const button = (r: FreightRate, label: string) => `<button data-freight-rate="${routeId}|${r}" ${r === rate ? 'class="on" disabled' : ""}>${label}</button>`;
  const effect = rate === "dear" ? `earns ×${t.freightRateDear} a tonne; hauliers reach ${pct(t.freightHaulierPull)} further for its goods` : rate === "cheap" ? `earns ×${t.freightRateCheap} a tonne; hauliers leave more of its goods to you` : "the standard goods fare";
  return `<small>Rate: ${button("cheap", "Cheap")}${button("standard", "Standard")}${button("dear", "Dear")} -- ${effect}. Along it: your trains ${Math.round(split.yours)} t/day, hauliers' trucks ${Math.round(split.hauliers)}${split.spoiled >= 1 ? `, ${Math.round(split.spoiled)} spoiling` : ""}.</small>`;
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
      const pave = dirt.length > 0 ? ` Pave ${dirt.map((r) => `${townName(r.a)}–${townName(r.b)}`).join(", ")} (Road tool, click both towns): paved roads wear ${pavedWear()}.` : "";
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
  for (const g of out) parts.push(`${Math.round(g.perDay)} t/day of ${cargoName(world, townId, g.kind, g.other)} to ${townName(g.other)} (${pct(g.delivered)} delivered)`);
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

// The panel's, the log's and the revenue screen's clicks: the screen's own first (tabs,
// sorting, picking), then the old cards' buttons and the problem lines' moves, one handler.
// A press held on a panel holds it still until it's released (frame(): a redraw mid-click
// swallowed the click).
let panelPressed = false;
for (const panel of [panelEl, logEl, revenueEl, stripEl, document.querySelector<HTMLElement>("#verdict")!]) {
  panel.addEventListener("pointerdown", () => (panelPressed = true));
  panel.addEventListener("click", (event) => {
    if (!screen.onClick(event.target as HTMLElement)) onPanelClick(event);
  });
}
window.addEventListener("pointerup", () => (panelPressed = false));
window.addEventListener("pointercancel", () => (panelPressed = false));
// Focus (the information lab): a route's card or row hovered, or picked, fades the rest of the map.
let focusRoute: string | null = null;
panelEl.addEventListener("mouseover", (event) => {
  focusRoute = (event.target as HTMLElement).closest<HTMLElement>("[data-route]")?.dataset.route ?? null;
});
panelEl.addEventListener("mouseleave", () => {
  focusRoute = null;
});
function onPanelClick(event: MouseEvent): void {
  // A headline that opens its overlay (screen.ts: No seat a day -> where they are).
  const shows = (event.target as HTMLElement).closest<HTMLElement>("[data-show-overlay]");
  if (shows) {
    overlay = shows.dataset.showOverlay as Overlay;
    renderOverlays();
    return;
  }
  const target = (event.target as HTMLElement).closest<HTMLElement>("button, a, [data-select]") ?? (event.target as HTMLElement);
  // A problem line's move (screen.ts): the named move itself, bought.
  if (target.dataset.named !== undefined) {
    const move = screen.namedMove(Number(target.dataset.named));
    if (!move) return;
    const towns = "a" in move.action && "b" in move.action ? [String(move.action.a), String(move.action.b)] : [];
    const result = act({ label: move.label, towns }, move.action);
    say(result.ok ? `${move.label.replace(/\s*\([^)]*\)$/, "")}: done, ${naira(move.price)}.${later}` : `Can't: ${result.reason}`, !result.ok);
    renderPanel();
    return;
  }
  // ...or the tool that does it: picked, for you to click on the map.
  if (target.dataset.tool) {
    tool = target.dataset.tool as Tool;
    selectedTown = null;
    renderToolbar();
    // ...and the map shown where: the places the button or its card names.
    const at = target.dataset.at ?? target.closest<HTMLElement>("[data-at]")?.dataset.at;
    if (at && !in3d) pointAt(at.split(","));
    say(`${target.textContent?.trim()}: click on the map.`);
    return;
  }
  // The named project: name it from a town's road-full line, or drop it.
  if (target.dataset.project) {
    const [a, b, rung] = target.dataset.project.split("|") as [string, string, ProjectRung];
    const result = act({ label: `saving for the ${rung === "lane" ? "bus lane" : "rail line"} on ${townName(a)} – ${townName(b)}`, towns: [a, b] }, { kind: "project", a, b, rung });
    say(result.ok ? `Saving for the ${rung === "lane" ? "bus lane" : "rail line"} on ${townName(a)} – ${townName(b)}: the treasury leaves it alone while you save. Once you can afford it, build it within ${world.tuning.projectLapseDays} days, or it lapses.` : `Can't: ${result.reason}`, !result.ok, 8);
    renderPanel();
    return;
  }
  if (target.dataset.freightRate) {
    const [routeId, rate] = target.dataset.freightRate.split("|") as [string, FreightRate];
    const result = act({ label: `freight at the ${rate} rate`, towns: [], routeId }, { kind: "freightRate", routeId, rate });
    say(result.ok ? `Freight on that line now at the ${rate} rate${rate === "dear" ? ": more a tonne, and hauliers will take more of its goods by road" : rate === "cheap" ? ": less a tonne, more of its goods by your trains, fewer trucks on the roads" : ""}.` : `Can't set the rate: ${result.reason}`, !result.ok, 7);
    renderPanel();
    return;
  }
  if (target.dataset.ford) {
    const ford = world.floods?.fords.find((f) => f.id === target.dataset.ford);
    const result = act({ label: "a bridge at a ford", towns: ford ? [ford.a, ford.b] : [] }, { kind: "bridgeFord", fordId: target.dataset.ford });
    say(result.ok ? `A bridge at ${ford?.name ?? "the ford"}, for ${naira(result.amount ?? 0)}: that road stays open through the rains, now and every year.` : `Can't: ${result.reason}`, !result.ok, 8);
    renderPanel();
    return;
  }
  if (target.dataset.colour) {
    const bar = target.dataset.colour.lastIndexOf("|");
    const [key, colour] = [target.dataset.colour.slice(0, bar), target.dataset.colour.slice(bar + 1)];
    // The colour it has already: a second click clears it.
    const result = act({ label: "a colour", towns: [] }, { kind: "label", key, colour: labelOf(world, key)?.colour === colour ? "" : colour });
    if (!result.ok) say(`Can't: ${result.reason}`, true, 5);
    renderPanel();
    return;
  }
  if (target.dataset.union) {
    const [unionId, answer] = target.dataset.union.split("|") as [string, "pay" | "concede" | "coop" | "refuse"];
    const result = act({ label: "an answer to the union", towns: [] }, { kind: "union", unionId, answer });
    const chairman = world.unions?.find((u) => u.id === unionId)?.chairman ?? "The chairman";
    say(result.ok ? `${chairman}: ${{ pay: `you paid his members ${naira(result.amount ?? 0)}. He'll remember it.`, concede: "you eased the lane. His danfos are back in it, and he'll remember it.", coop: "you handed him the route: his cooperative runs it now, the fares are his. He won't forget it.", refuse: "you refused him. Expect a strike." }[answer]}` : `Can't: ${result.reason}`, !result.ok || answer === "refuse", 9);
    renderPanel();
    return;
  }
  if (target.dataset.console) {
    // The design console (dev only): recorded in the run file as console moves.
    const op = target.dataset.console as "end-term" | "funds" | "rains";
    const result = act({ label: "a console move", towns: [] }, op === "funds" ? { kind: "console", op, amount: 100000 } : { kind: "console", op });
    say(result.ok ? (op === "funds" ? "Console: money set to ₦100,000." : op === "rains" ? "Console: the rains are named now." : "Console: the term ends at the next day's check.") : `Console: ${result.reason}`, !result.ok, 5);
    return;
  }
  if (target.dataset.pledge) {
    const result = act({ label: "a pledge", towns: [] }, { kind: "pledge", id: target.dataset.pledge });
    const pledge = world.term?.pledges.find((p) => p.id === target.dataset.pledge);
    screen.refreshVerdict();
    say(result.ok ? `Pledged: ${pledge?.text ?? ""}. It's on Waiting on you until it's kept; the term runs to day ${world.term ? gameDay(world, world.term.endsAtSeconds) - 1 : "?"}.` : `Can't pledge: ${result.reason}`, !result.ok, 8);
    renderPanel();
    return;
  }
  if (target.dataset.metro) {
    const town = target.dataset.metro;
    const first = metroLines(world, town) === 0;
    const result = act({ label: first ? "a metro" : "another metro line", towns: [town] }, { kind: "metro", townId: town });
    say(result.ok
      ? `${first ? "Metro opened" : "Another metro line"} in ${townName(town)} for ${naira(result.amount ?? 0)}: it carries ${Math.round(metroRiders(world, town).riders).toLocaleString()} of the town's inside trips a day, at ${naira(world.tuning.metroFare)} each.`
      : `Can't build it: ${result.reason}`, !result.ok, 8);
    renderPanel();
    return;
  }
  if (target.dataset.upgradePort) {
    const next = nextPortRung(world);
    const result = act({ label: `building ${next?.name ?? "the port"}`, towns: world.seaport ? [world.seaport] : [] }, { kind: "upgradePort" });
    say(result.ok ? `${next?.name ? next.name[0]!.toUpperCase() + next.name.slice(1) : "The port"} built for ${naira(result.amount ?? 0)}: the port now lands ${pct(portScale(world))} of day 1's need.` : `Can't build it: ${result.reason}`, !result.ok, 8);
    renderPanel();
    return;
  }
  if (target.dataset.restoreRefinery) {
    const result = act({ label: "restoring the refinery", towns: world.fuel ? [world.fuel.refineryId] : [] }, { kind: "restoreRefinery" });
    say(result.ok ? `Refinery restored for ${naira(result.amount ?? 0)}. Now get crude to it, and give it a road out.` : `Can't restore it: ${result.reason}`, !result.ok, 8);
    renderPanel();
    return;
  }
  if (target.dataset.bond) {
    const purpose = target.dataset.bond as BondPurpose;
    const lent = bondAmount(world, purpose) ?? 0;
    const towns = purpose === "refinery" && world.fuel ? [world.fuel.refineryId] : purpose === "works" && world.cement ? [world.cement.worksId] : world.project ? [world.project.a, world.project.b] : [];
    const result = act({ label: `a bond for ${purpose === "project" ? "your project" : purpose === "works" ? "the cement works" : "the refinery"}`, towns }, { kind: "bond", purpose });
    say(result.ok
      ? `Borrowed ${naira(lent)}${purpose === "project" ? " toward your project: build it" : ", and it's restored"}. You repay ${naira(bondPerDay(world, lent))} a day for ${world.tuning.bondTermDays} days.`
      : `Can't borrow: ${result.reason}`, !result.ok, 9);
    renderPanel();
    return;
  }
  if (target.dataset.expand) {
    const siteId = target.dataset.expand;
    const result = act({ label: `expanding ${townName(siteId)}`, towns: [siteId] }, { kind: "expand", siteId });
    say(result.ok ? `${townName(siteId)} expanded for ${naira(result.amount ?? 0)}: it can make ${pct(siteScale(world, siteId))} of what it was built to, if its input and workers keep up.` : `Can't expand it: ${result.reason}`, !result.ok, 8);
    renderPanel();
    return;
  }
  if (target.dataset.restoreWorks) {
    const result = act({ label: "restoring the cement works", towns: world.cement ? [world.cement.worksId] : [] }, { kind: "restoreWorks" });
    say(result.ok ? `Cement works restored for ${naira(result.amount ?? 0)}. A limestone quarry opens for it within days: connect it.` : `Can't restore it: ${result.reason}`, !result.ok, 8);
    renderPanel();
    return;
  }
  if (target.dataset.restoreSteel) {
    const result = act({ label: "restoring the steel works", towns: world.steel?.worksId ? [world.steel.worksId] : [] }, { kind: "restoreSteel" });
    say(result.ok ? `Steel works restored for ${naira(result.amount ?? 0)}. Its mine starts digging: get the ore to it.` : `Can't restore it: ${result.reason}`, !result.ok, 8);
    renderPanel();
    return;
  }
  if (target.dataset.dropProject) {
    act({ label: "dropping the named project", towns: [] }, { kind: "dropProject" });
    say("Project dropped: the treasury takes its usual share again.");
    renderPanel();
    return;
  }
  // A corridor's wear, from its row in the Corridors section.
  if (target.dataset.keep) {
    const [id, on] = target.dataset.keep.split("|") as [string, string];
    const name = roadName(id);
    const result = act({ label: on === "1" ? `keeping up ${name}` : `letting ${name} wear`, towns: roadTowns(id) }, { kind: "fix", segmentId: id, on: on === "1" });
    say(result.ok ? (on === "1" ? `Keeping up ${name}${(result.amount ?? 0) > 0 ? `: ${naira(result.amount ?? 0)} to repair it first` : ""}.` : `${capitalise(name)} will wear again.`) : `Can't: ${result.reason}`, !result.ok);
    renderPanel();
    return;
  }
  if (target.dataset.retire) {
    const id = target.dataset.retire;
    const name = roadName(id);
    const result = act({ label: `retiring ${name}`, towns: roadTowns(id) }, { kind: "retire", segmentId: id });
    say(result.ok ? `Retired ${name}: no upkeep or tolls from today, and it's gone in ${world.tuning.retireGoneDays} days unless you restore it.` : `Can't: ${result.reason}`, !result.ok, 7);
    renderPanel();
    return;
  }
  if (target.dataset.restore) {
    const id = target.dataset.restore;
    const name = roadName(id);
    const result = act({ label: `restoring ${name}`, towns: roadTowns(id) }, { kind: "restore", segmentId: id });
    say(result.ok ? `Restored ${name}.` : `Can't: ${result.reason}`, !result.ok);
    renderPanel();
    return;
  }
  if (target.dataset.fixnow) {
    const id = target.dataset.fixnow;
    const name = roadName(id);
    const result = act({ label: `repairing ${name}`, towns: roadTowns(id) }, { kind: "repair", segmentId: id });
    say(result.ok ? `Repaired ${name} to new for ${naira(result.amount ?? 0)}. It wears again from here.` : `Can't: ${result.reason}`, !result.ok);
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
      const result = act({ label: `settling with the union on ${townName(a)} – ${townName(b)}`, towns: [a, b] }, { kind: "settle", a, b });
      say(result.ok ? `Paid the union ${naira(price)}: the strike on ${townName(a)} – ${townName(b)} is off.` : `Can't settle (${naira(price)}): ${result.reason}`, !result.ok);
    } else {
      act({ label: `relaxing the ${townName(a)} – ${townName(b)} lane`, towns: [a, b] }, { kind: "enforce", a, b, enforcement: "lax" });
      say(`Wardens off the ${townName(a)} – ${townName(b)} lane: the strike will be called off, and danfos will creep back into it.`);
    }
    renderPanel();
    return;
  }
  // The town card's pager: the next town along, as if you'd clicked it.
  if (target.dataset.select) {
    const id = target.dataset.select;
    screen.select({ kind: world.towns.get(id)?.industry ? "site" : "town", id });
    return;
  }
  const moveIndex = target.dataset.move;
  if (moveIndex !== undefined) {
    const move = moves.list[Number(moveIndex)];
    if (!move) return;
    const result = act(move.spec, move.action);
    if (result.ok) say(`${move.title}: bought for ${naira(move.price)}.${later}`);
    else say(`Can't: ${result.reason}`, true);
    renderPanel();
    return;
  }
  const addId = target.dataset.add;
  const removeId = target.dataset.remove;
  const sell = (routeId: string, vehicle: string) => {
    const route = [...world.routes, ...world.lorryRoutes].find((candidate) => candidate.id === routeId);
    if (!route) return;
    const result = act({ label: `selling a ${vehicle} on ${pair(route.a, route.b)}`, towns: [route.a, route.b], routeId }, { kind: "sell", routeId });
    if (result.ok) say(`Sold a ${vehicle} for ${naira(result.amount ?? 0)}.${later}`);
  };
  if (addId && isLorryRoute(addId)) {
    const route = world.lorryRoutes.find((candidate) => candidate.id === addId);
    if (!route) return;
    const freight = isFreightRoute(addId);
    const vehicle = freight ? "freight train" : "lorry";
    const spec = { label: addLabel(vehicle, route.vehicleIds.length + 1, route.a, route.b), towns: [route.a, route.b], routeId: addId };
    const result = act(spec, { kind: freight ? "freight" : "lorry", a: route.a, b: route.b });
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
    const result = act(spec, { kind: train ? "train" : mini ? "minibus" : brt ? "brt" : "bus", a: route.a, b: route.b });
    const price = train ? world.tuning.trainPurchaseCost : mini ? world.tuning.minibusPurchaseCost : brt ? world.tuning.brtPurchaseCost : world.tuning.busPurchaseCost;
    if (!result.ok) say(`Can't add ${vehicle} (${naira(price)}): ${result.reason}`, true);
  } else if (removeId && isLorryRoute(removeId)) {
    sell(removeId, isFreightRoute(removeId) ? "freight train" : "lorry");
  } else if (removeId) {
    sell(removeId, isRailRoute(removeId) ? "train" : isMinibusRoute(removeId) ? "minibus" : isBrtRoute(removeId) ? "BRT bus" : "bus");
  }
  renderRoutes();
}


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
// The first term's pledges: asked for as play begins (the strip alone was missed).
let askedFirstPledges = false;
let panelTimer = 0;

// The map's overlays, one at a time (the information lab): the traffic map, or demand between
// towns, trips with no seat, each corridor's informal share, or the biggest goods flows.
let overlay: Overlay = "none";
const overlaysEl = document.querySelector<HTMLDivElement>("#overlays")!;
const captionEl = document.querySelector<HTMLDivElement>("#overlay-caption")!;
function renderOverlays(): void {
  const opts: Array<[Overlay, string]> = [["none", "Traffic"], ["demand", "Demand"], ["noseat", "No seat"], ["informal", "Informal share"], ["goods", "Goods"]];
  overlaysEl.innerHTML = opts.map(([id, label]) => `<button data-overlay="${id}" class="${overlay === id ? "on" : ""}">${label}</button>`).join("");
  renderCaption();
}
// What the overlay says, in a line under its buttons: read twice a second, not every frame.
let captionAt = -Infinity;
let captionFor: Overlay | null = null;
function renderCaption(now = performance.now()): void {
  if (now - captionAt < 500 && captionFor === overlay) return;
  captionAt = now;
  captionFor = overlay;
  const text = overlay === "none" ? "" : overlayCaption(world, overlay);
  captionEl.hidden = !text;
  if (captionEl.textContent !== text) captionEl.textContent = text;
}
overlaysEl.addEventListener("click", (event) => {
  const id = (event.target as HTMLElement).dataset.overlay as Overlay | undefined;
  if (!id) return;
  overlay = id;
  renderOverlays();
});
renderOverlays();

// The places on Waiting on you, for the map's mark. Rechecked twice a second, not every
// frame -- the list reads a good deal of the world.
let problemTowns = new Set<string>();
let problemsAt = -Infinity;
function townsWithProblems(now: number): Set<string> {
  if (now - problemsAt < 500) return problemTowns;
  problemsAt = now;
  // Waiting on you's places (screen.ts), and only those: at day 482 nearly every town had a
  // mark, and the idle cement works -- the one that mattered -- had none (brief, Revision 5).
  problemTowns = screen.waitingTargets();
  return problemTowns;
}

let revenueTimer = 0;
function frame(now: number): void {
  if (!askedFirstPledges && world.term) {
    askedFirstPledges = true;
    if (world.term.number === 1 && world.term.pledges.length > 0 && !world.term.pledges.some((p) => p.committed)) {
      screen.openVerdict("pledges");
      paused = true;
      renderToolbar();
    }
  }
  const elapsed = (now - last) / 1000;
  last = now;
  if (!paused) {
    // Each speed step runs its own bounded advance, so 4x stays 4x rather
    // than being clipped by the accumulator's per-frame catch-up cap.
    for (let i = 0; i < speed; i += 1) {
      accumulator.advance(elapsed, (dt) => {
        const events = gameTick(world, dt);
        recordTick(recorder, world, events);
        for (const event of events) announce(event);
        if (dev) for (const receipt of tickReceipts(world, book, dt)) say(receiptLine(receipt), receipt.moneyPerDay < -5, 8);
      });
    }
  }
  const picked = screen.focus;
  if (!in3d) renderCaption(now);
  const focusOn = { town: focusTown() ?? (picked && picked.kind !== "route" && picked.kind !== "segment" ? picked.id : null), route: focusRoute ?? (picked?.kind === "route" ? picked.id : null) };
  // In 3D the same focus: a selected town's or route's connections lit, the town ringed.
  if (in3d && view3d) view3d.frame(world, focusFor(world, focusOn.town, focusOn.route), focusOn.route ? null : focusOn.town);
  else draw(ctx, world, view, {
    selectedTown, hoverTown, ghost: ghost(), road: roadHover(), gameSpeed: speed, problems: townsWithProblems(now), overlay,
    pointed: pointed && performance.now() < pointed.until ? pointed.ids : undefined,
    focusTown: focusOn.town,
    focusRoute: focusOn.route,
  });

  panelTimer += elapsed;
  if (panelTimer > 0.25) {
    panelTimer = 0;
    keepSteady(world);
    renderStrip();
    // Not while a button in a panel is pressed: redrawing replaces the button under
    // the pointer, and a click needs the same one pressed and released (playtest:
    // "Keep it up" took several clicks -- the panel redraws every quarter second).
    // Nor while you type a name in it: a redraw would take the field from under you.
    if (!panelPressed && !(document.activeElement instanceof HTMLInputElement)) {
      renderPanel();
      screen.renderLog();
      // The revenue screen's charts are the days': once a second is plenty.
      revenueTimer += 1;
      if (screen.revenueOpen() && revenueTimer % 4 === 0) screen.renderRevenue();
    }
  }
  // Every frame: a hint pinned to a town follows it, and hovering dismisses hint 1 at once.
  renderHint();
  requestAnimationFrame(frame);
}

renderToolbar();
renderStrip();
resize(); // again, now the toolbar and the strip exist to be measured
// On a region (region.ts), the camera starts framed on the home cluster: the rest of the
// region is there, a zoom out (0, or Fit), running without you (brief, The region).
if (world.home) {
  // A little short of the box, so towns at its edge sit clear of the panels and the toolbar.
  zoom = 0.9 * Math.min(MAX_ZOOM, world.width / world.home.width, world.height / world.home.height);
  lookAt = { x: world.home.x + world.home.width / 2, y: world.home.y + world.home.height / 2 };
  applyZoom();
}
renderPanel();
screen.renderLog(true);
// The hints take the start from here (hint 1); the developer view keeps the old line.
if (dev) say("Danfos, kekes and okadas are already carrying your passengers. Click a town, then another, to run a bus.");
requestAnimationFrame(frame);
