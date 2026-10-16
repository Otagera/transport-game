import { Accumulator, SIM_DT } from "@engine/loop";
import { computeBurnRate } from "@engine/economy/report";
import { sliceTick } from "@engine/slice/tick";
import {
  addBus,
  buildRoad,
  checkBus,
  checkRoad,
  createSliceWorld,
  networkShare,
  removeBus,
  roadCost,
  routeSummaries,
} from "@engine/slice/world";
import { SLICE_MAP } from "./map";
import { draw, fitView, routeColor, toScreen, townRadius, type Ghost, type View } from "./render";

// The slice's bootstrap (docs/principles.md §6, step 1). Two tools, one
// list, one strip:
//   R  road tool -- click a town, then another: build a straight road.
//   B  bus tool  -- click a town, then another: buy a bus running between them.
//   Space pause, 1/2/3 speed, Esc cancel.

type Tool = "road" | "bus";

const world = createSliceWorld(SLICE_MAP);
const canvas = document.querySelector<HTMLCanvasElement>("#map")!;
const ctx = canvas.getContext("2d")!;
const strip = document.querySelector<HTMLDivElement>("#strip")!;
const routesEl = document.querySelector<HTMLDivElement>("#routes")!;
const toolbar = document.querySelector<HTMLDivElement>("#toolbar")!;
const toast = document.querySelector<HTMLDivElement>("#toast")!;

let tool: Tool = "bus";
let selectedTown: string | null = null;
let hoverTown: string | null = null;
let mouse: { x: number; y: number } | null = null;
let speed = 1;
let paused = false;
let view: View = { scale: 1, offsetX: 0, offsetY: 0 };

const naira = (n: number) => `${n < 0 ? "−" : ""}₦${Math.abs(Math.round(n)).toLocaleString()}`;
const townName = (id: string) => world.towns.get(id)?.name ?? id;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  const sidePanel = window.innerWidth > 900 ? 300 : 0;
  view = fitView(world, window.innerWidth - sidePanel, window.innerHeight, 24, 64);
}
window.addEventListener("resize", resize);
resize();

let toastTimer = 0;
function say(message: string, bad = false): void {
  toast.textContent = message;
  toast.dataset.bad = String(bad);
  toast.style.opacity = "1";
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.style.opacity = "0"), 2600);
}

function townAt(x: number, y: number): string | null {
  for (const town of world.towns.values()) {
    const p = toScreen(view, town.x, town.y);
    if (Math.hypot(p.x - x, p.y - y) <= townRadius(town, view) + 8) return town.id;
  }
  return null;
}

function setTool(next: Tool): void {
  tool = next;
  selectedTown = null;
  renderToolbar();
}

canvas.addEventListener("mousemove", (event) => {
  mouse = { x: event.clientX, y: event.clientY };
  hoverTown = townAt(event.clientX, event.clientY);
  canvas.style.cursor = hoverTown ? "pointer" : "default";
});

canvas.addEventListener("mouseleave", () => {
  mouse = null;
  hoverTown = null;
});

canvas.addEventListener("click", (event) => {
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
  if (tool === "road") {
    const cost = roadCost(world, from, town);
    const result = buildRoad(world, from, town);
    if (result.ok) say(`Built road ${townName(from)} – ${townName(town)} for ${naira(cost)}`);
    else say(`Can't build: ${result.reason}`, true);
  } else {
    const result = addBus(world, from, town);
    if (result.ok) say(`Bus added: ${townName(from)} ↔ ${townName(town)}`);
    else say(`Can't add bus: ${result.reason}`, true);
  }
  // Shift keeps the first town selected: fanning roads or routes out of
  // one hub is the common case.
  selectedTown = event.shiftKey ? from : null;
  renderRoutes();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "r" || event.key === "R") setTool("road");
  else if (event.key === "b" || event.key === "B") setTool("bus");
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

function ghost(): Ghost | null {
  if (!selectedTown || !mouse) return null;
  const to = hoverTown && hoverTown !== selectedTown ? hoverTown : null;
  const end = to ? toScreen(view, world.towns.get(to)!.x, world.towns.get(to)!.y) : mouse;
  if (tool === "road") {
    if (!to) return { from: selectedTown, to: end, ok: true, label: "" };
    const check = checkRoad(world, selectedTown, to);
    const cost = naira(roadCost(world, selectedTown, to));
    return { from: selectedTown, to: end, ok: check.ok, label: check.ok ? `Road ${cost}` : `${cost} · ${check.reason}` };
  }
  if (!to) return { from: selectedTown, to: end, ok: true, label: "" };
  const check = checkBus(world, selectedTown, to);
  const price = naira(world.tuning.busPurchaseCost);
  return { from: selectedTown, to: end, ok: check.ok, label: check.ok ? `Bus ${price}` : check.reason };
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
  toolbar.replaceChildren(
    button("Bus", "B", tool === "bus", () => setTool("bus")),
    button("Road", "R", tool === "road", () => setTool("road")),
    Object.assign(document.createElement("span"), { className: "sep" }),
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
  );
}

function renderStrip(): void {
  const burn = computeBurnRate(world.economy);
  const share = networkShare(world);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const day = Math.floor(world.economy.elapsedSeconds / 30) + 1;
  strip.innerHTML = `
    <div class="stat"><span class="k">Day</span><span class="v">${day}</span></div>
    <div class="stat"><span class="k">Funds</span><span class="v ${world.economy.funds < 0 ? "bad" : ""}">${naira(world.economy.funds)}</span></div>
    <div class="stat"><span class="k">Net / day</span><span class="v ${burn.netPerDay < 0 ? "bad" : "good"}">${naira(burn.netPerDay)}</span></div>
    <div class="stat share">
      <span class="k">Where passengers went</span>
      <div class="bar">
        <i style="width:${pct(share.player)};background:var(--player)"></i>
        <i style="width:${pct(share.informal)};background:var(--danfo)"></i>
        <i style="width:${pct(share.lost)};background:var(--home)"></i>
      </div>
      <span class="legend"><b style="color:var(--player)">You ${pct(share.player)}</b> · <b class="danfo-text">Danfo ${pct(share.informal)}</b> · <b style="color:var(--home-text)">Stayed home ${pct(share.lost)}</b></span>
    </div>
    <div class="stat"><span class="k">Danfos earned</span><span class="v">${naira(world.informal.earnings)}</span></div>
  `;
}

function renderRoutes(): void {
  const summaries = routeSummaries(world);
  const header = `<h2>Your routes</h2><p class="hint">Worst first. Net is fares minus running cost.</p>`;
  if (summaries.length === 0) {
    routesEl.innerHTML = `${header}<p class="empty">No buses yet. Pick the <b>Bus</b> tool, click a town, then another town joined to it by road.</p>`;
    return;
  }
  const rows = summaries.map((s) => {
    const index = world.routes.findIndex((route) => route.id === s.id);
    return `
      <div class="route">
        <span class="swatch" style="background:${routeColor(index)}"></span>
        <div class="name">${townName(s.a)} ↔ ${townName(s.b)}<small>${s.buses} bus${s.buses === 1 ? "" : "es"} · in ${naira(s.incomePerDay)} · cost ${naira(s.costPerDay)}</small></div>
        <span class="net ${s.netPerDay < 0 ? "bad" : "good"}">${naira(s.netPerDay)}</span>
        <button data-add="${s.id}" title="Add a bus">+</button>
        <button data-remove="${s.id}" title="Sell a bus">−</button>
      </div>`;
  });
  routesEl.innerHTML = header + rows.join("");
}

routesEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const addId = target.dataset.add;
  const removeId = target.dataset.remove;
  if (addId) {
    const route = world.routes.find((candidate) => candidate.id === addId);
    if (!route) return;
    const result = addBus(world, route.a, route.b);
    if (!result.ok) say(`Can't add bus: ${result.reason}`, true);
  } else if (removeId) {
    const refund = removeBus(world, removeId);
    if (refund > 0) say(`Sold a bus for ${naira(refund)}`);
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
    for (let i = 0; i < speed; i += 1) accumulator.advance(elapsed, (dt) => sliceTick(world, dt));
  }
  draw(ctx, world, view, { selectedTown, hoverTown, ghost: ghost() });

  panelTimer += elapsed;
  if (panelTimer > 0.25) {
    panelTimer = 0;
    renderStrip();
    renderRoutes();
  }
  requestAnimationFrame(frame);
}

renderToolbar();
renderStrip();
renderRoutes();
say("Danfos are already carrying your passengers. Click a town, then another, to run a bus.");
requestAnimationFrame(frame);
