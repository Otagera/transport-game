import { DEFAULT_GAME_TUNING } from "@engine/game/tuning";
import type { ActionOutcome, ActionSpec } from "@engine/game/actions";
import type { ConsoleOp } from "@engine/game/term";
import type { GameWorld } from "@engine/game/types";
import { townGrowth } from "@engine/game/growth";
import { fuelSupply } from "@engine/game/fuel";
import { siteProduction } from "@engine/game/production";
import { diagnoseRoute, routeSummaries } from "@engine/game/world";
import { clusterAt, inRemit } from "@engine/game/remit";
import type { Selection } from "./screen";
import type { WhatIfChange, WhatIfDay, WhatIfRun } from "@engine/game/whatif";
import type { WhatIfReply, WhatIfRequest } from "./whatif.worker";
import { graphEdges, moved, mountMapGraph, type GraphLayer, type MapGraph } from "./whatifgraph";

// The design console's drawer (docs/brief.md, Dev tools: the console and the what-if, step 1).
// Dev only: main.ts imports it on demand behind ?dev=1, so a player's page never loads it. Every
// move is a `console` action, recorded in the run file like any other, so a run with console
// moves still replays; inspecting only reads. Opened and closed with the ` key.

export interface ConsoleHooks {
  world: GameWorld;
  act(action: ActionSpec): ActionOutcome;
  say(message: string, bad?: boolean, seconds?: number): void;
  /** What the panel has picked: what Inspect shows. */
  selected(): Selection;
  /** After a move: the panel and the map redraw. */
  changed(): void;
  /** Today, the game's day. */
  day(): number;
  /** Fork this game from the start of a day into a new save, and open it; why not, else null. */
  fork(day: number): Promise<string | null>;
  /** The last move the toolbar previewed that could be made, for the what-if. */
  lastMove(): { action: ActionSpec; label: string } | null;
  /** A map cell to the page's pixels, as the map draws it now: where the map graph draws. */
  project(x: number, y: number): { x: number; y: number };
}

const MARK = "transport-game: console drawer";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const DEFAULTS = DEFAULT_GAME_TUNING as unknown as Record<string, unknown>;
/** The numbers the console may set: the defaults' numbers and switches. */
const KEYS = Object.keys(DEFAULTS).filter((k) => typeof DEFAULTS[k] === "number" || typeof DEFAULTS[k] === "boolean").sort();
/** At most this many numbers listed at once: the filter finds the rest. */
const LISTED = 40;

/** Maps and Sets as plain JSON, numbers to 4 places: the raw data, readable and copyable. */
function json(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v instanceof Map) return Object.fromEntries(v);
    if (v instanceof Set) return [...v];
    if (typeof v === "number" && !Number.isInteger(v)) return Math.round(v * 1e4) / 1e4;
    return v;
  }, 2);
}

/** Whatever's known about the picked thing, each read on its own so one that throws doesn't hide the rest. */
function inspect(world: GameWorld, sel: Selection): Record<string, unknown> | null {
  if (!sel) return null;
  const out: Record<string, unknown> = { selection: sel };
  const read = (name: string, f: () => unknown) => {
    try {
      out[name] = f();
    } catch (error) {
      out[name] = `(threw: ${(error as Error).message})`;
    }
  };
  if (sel.kind === "town" || sel.kind === "site") {
    read("town", () => world.towns.get(sel.id));
    read("basePopulation", () => world.basePopulation.get(sel.id));
    read("growth", () => townGrowth(world, sel.id));
    read("fuel", () => fuelSupply(world, sel.id));
    read("production", () => siteProduction(world, sel.id));
    read("yard", () => world.yards.has(sel.id));
    read("park", () => world.parks.has(sel.id));
    read("cluster", () => clusterAt(world, sel.id)?.hub ?? "home");
    read("inRemit", () => inRemit(world, sel.id));
    read("roads", () => world.simulation.map.segments.filter((s) => s.fromNodeId === sel.id || s.toNodeId === sel.id).map((s) => s.id));
  } else if (sel.kind === "route") {
    read("route", () => world.routes.find((r) => r.id === sel.id) ?? world.lorryRoutes.find((r) => r.id === sel.id));
    read("summary", () => routeSummaries(world).find((r) => r.id === sel.id));
    read("diagnosis", () => diagnoseRoute(world, sel.id));
  } else {
    read("segment", () => world.simulation.map.segments.find((s) => s.id === sel.id));
    read("speed", () => world.segmentSpeed.get(sel.id));
    read("maintained", () => world.maintained.has(sel.id));
  }
  return out;
}

export function mountConsole(hooks: ConsoleHooks): { toggle(): void } {
  const { world } = hooks;
  const el = document.createElement("div");
  el.id = "dev-console";
  el.hidden = true;
  el.dataset.mark = MARK;
  document.querySelector("#plate-overlay")!.append(el);
  let filter = "";
  let timer = 0;

  // The what-if (whatif.ts, whatif.worker.ts; brief, Dev tools, step 3): the worker made on the
  // first question, never before (D1), the game taken as it stands and kept there until taken again.
  let worker: Worker | null = null;
  let taken: number | null = null;
  let asked = 0;
  let asking: { id: number; label: string; days: number; done: number; of: number } | null = null;
  let answer: { label: string; days: number; base: WhatIfRun; with: WhatIfRun } | null = null;
  let failed = "";
  // The map graph (step 4): off until asked for, an answer's trips or goods.
  let graph: MapGraph | null = null;
  let layer: GraphLayer | "off" = "off";
  function showGraph(): void {
    if (layer === "off" || !answer || !answer.with.ok) return graph?.hide();
    graph ??= mountMapGraph(world, hooks.project);
    graph.show(answer.base.end, answer.with.end, layer);
  }
  const send = (message: WhatIfRequest) => worker!.postMessage(message);
  function take(): void {
    if (!worker) {
      worker = new Worker(new URL("./whatif.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WhatIfReply>) => {
        const reply = event.data;
        if (!asking || reply.id !== asking.id) return;
        if (reply.type === "progress") Object.assign(asking, { done: reply.done, of: reply.of });
        else if (reply.type === "answer") {
          answer = { label: asking.label, days: reply.with.days.length || reply.base.days.length, base: reply.base, with: reply.with };
          failed = reply.with.ok ? "" : `it can't be done: ${reply.with.reason}`;
          asking = null;
          showGraph();
        } else asking = null;
        showWhatIf();
      };
    }
    send({ type: "take", world });
    taken = hooks.day();
    answer = null;
    graph?.hide();
  }

  const move = (op: ConsoleOp, extra: { amount?: number; key?: string; value?: number | boolean }, done: string): void => {
    const result = hooks.act({ kind: "console", op, ...extra });
    hooks.say(result.ok ? `Console: ${done}` : `Console: ${result.reason}`, !result.ok, 5);
    if (result.ok) hooks.changed();
  };

  function numbers(): string {
    const tuning = world.tuning as unknown as Record<string, unknown>;
    const changed = (k: string) => tuning[k] !== DEFAULTS[k];
    const shown = KEYS.filter((k) => k.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => Number(changed(b)) - Number(changed(a)));
    const rows = shown.slice(0, LISTED).map((k) => {
      const now = tuning[k] ?? DEFAULTS[k];
      const field = typeof DEFAULTS[k] === "boolean"
        ? `<input type="checkbox" data-tune="${k}" ${now ? "checked" : ""} />`
        : `<input type="number" step="any" data-tune="${k}" value="${now}" />`;
      return `<tr class="${changed(k) ? "changed" : ""}"><td>${k}</td><td>${field}</td><td class="muted">${changed(k) ? `default ${DEFAULTS[k]}` : ""}</td></tr>`;
    });
    const more = shown.length > LISTED ? `<div class="muted">${shown.length - LISTED} more: narrow the filter</div>` : "";
    return `<table>${rows.join("")}</table>${more}`;
  }

  /** The change the what-if's fields name, or why not. */
  function change(): { change: WhatIfChange; label: string } | string {
    const kind = el.querySelector<HTMLInputElement>("input[name=wi]:checked")?.value;
    if (kind === "move") {
      const last = hooks.lastMove();
      return last ? { change: { kind: "move", action: last.action, label: last.label }, label: last.label } : "preview a move with a tool first";
    }
    const key = el.querySelector<HTMLInputElement>("[data-wi-key]")!.value.trim();
    const text = el.querySelector<HTMLInputElement>("[data-wi-value]")!.value.trim();
    if (!(key in DEFAULTS)) return `no tuning number "${key}"`;
    const value = typeof DEFAULTS[key] === "boolean" ? text === "true" : Number(text);
    if (typeof value === "number" && (!text || !Number.isFinite(value))) return `${key} takes a number`;
    const now = (world.tuning as unknown as Record<string, unknown>)[key];
    return { change: { kind: "tune", key, value }, label: `${key} ${now} → ${value}` };
  }

  function whatIfOut(): string {
    const status = asking
      ? `<div>${asking.of === 0 ? "Starting…" : `Playing on: day ${asking.done} of ${asking.of}${asking.of === 2 * asking.days ? (asking.done < asking.days ? " (without the change first)" : " (now with it)") : " (with it: the run without is kept from before)"}`} <button class="quiet" data-cancel>Cancel</button></div>`
      : "";
    if (failed) return `${status}<div class="bad">${esc(failed)}</div>`;
    if (!answer) return status || `<div class="muted">${taken === null ? "Take the game, then ask: it plays on in a worker, without and with the change." : `Asking about day ${taken} as it stood.`}</div>`;
    const { base, with: w } = answer;
    const last = (r: WhatIfRun) => r.days.at(-1)!;
    const sum = (r: WhatIfRun, f: (d: WhatIfDay) => number) => r.days.reduce((t, d) => t + f(d), 0);
    const int = (x: number) => Math.round(x).toLocaleString();
    const k = (x: number) => `${x.toFixed(1)}k`;
    const rows: Array<[string, number, number, (x: number) => string]> = [
      ["Money at the end", last(base).funds, last(w).funds, (x) => `₦${int(x)}`],
      [`Net over the ${answer.days} days`, sum(base, (d) => d.net), sum(w, (d) => d.net), (x) => `₦${int(x)}`],
      ["Net, the last day", last(base).net, last(w).net, (x) => `₦${int(x)}`],
      ["People", last(base).people, last(w).people, k],
      ["Trips made a day", last(base).trips, last(w).trips, int],
      ["On your vehicles a day", last(base).yourRiders, last(w).yourRiders, int],
      ["Goods arriving a day", last(base).goods, last(w).goods, (x) => `${int(x)} t`],
    ];
    const diff = (a: number, b: number, f: (x: number) => string) => {
      const d = b - a;
      const tone = Math.abs(d) < 1e-6 ? "muted" : d > 0 ? "good" : "bad";
      return `<td class="${tone}">${d > 0 ? "+" : d < 0 ? "−" : ""}${f(Math.abs(d))}</td>`;
    };
    const daily = base.days.map((d, i) => {
      const x = w.days[i]!;
      return `<tr><td>${d.day}</td><td>₦${int(d.net)}</td><td>₦${int(x.net)}</td><td>${k(d.people)}</td><td>${k(x.people)}</td><td>${int(d.yourRiders)}</td><td>${int(x.yourRiders)}</td></tr>`;
    });
    const moved = taken !== null && hooks.day() !== taken ? ` (it's day ${hooks.day()} now)` : "";
    return `${status}<div><b>${esc(answer.label)}</b>, from day ${base.from}${moved}, ${answer.days} days on:</div>
      <table class="whatif"><tr><th></th><th>without</th><th>with</th><th>difference</th></tr>
      ${rows.map(([name, a, b, f]) => `<tr><td>${name}</td><td>${f(a)}</td><td>${f(b)}</td>${diff(a, b, f)}</tr>`).join("")}</table>
      <div class="moves">On the map: ${(["off", "trips", "goods"] as const).map((l) => `<label><input type="radio" name="wi-graph" value="${l}" ${layer === l ? "checked" : ""} /> ${l === "off" ? "off" : l === "trips" ? "trips between towns" : "goods between places"}</label>`).join(" ")}</div>
      <div data-whatif-node>${picked()}</div>
      <details><summary>Day by day</summary><table class="whatif"><tr><th>day</th><th>net without</th><th>with</th><th>people without</th><th>with</th><th>your riders without</th><th>with</th></tr>${daily.join("")}</table></details>`;
  }

  /** The town picked on the map, by the answer: its people, and the edges at it that moved most. */
  function picked(): string {
    const sel = hooks.selected();
    if (!answer || !answer.with.ok || layer === "off") return "";
    if (!sel || (sel.kind !== "town" && sel.kind !== "site")) return `<div class="muted">Pick a town on the map for its numbers before and after.</div>`;
    const name = (id: string) => world.towns.get(id)?.name ?? id;
    const { end: a } = answer.base;
    const { end: b } = answer.with;
    const people = a.people[sel.id] !== undefined ? `people ${(a.people[sel.id] ?? 0).toFixed(1)}k → ${(b.people[sel.id] ?? 0).toFixed(1)}k` : "";
    const unit = layer === "trips" ? "a day" : "t a day";
    const edges = graphEdges(a, b, layer).filter((e) => e.a === sel.id || e.b === sel.id).sort((p, q) => Math.abs(q.with - q.base) - Math.abs(p.with - p.base)).slice(0, 6);
    const rows = edges.map((e) => {
      const other = e.a === sel.id ? e.b : e.a;
      const d = e.with - e.base;
      const tone = !moved(e.base, e.with) ? "muted" : d > 0 ? "good" : "bad";
      return `<tr><td>${esc(name(other))}</td><td>${Math.round(e.base)}</td><td>${Math.round(e.with)}</td><td class="${tone}">${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.round(Math.abs(d))}</td></tr>`;
    });
    return `<div><b>${esc(name(sel.id))}</b> ${people}</div>${rows.length ? `<table class="whatif"><tr><th>${layer} ${unit} with</th><th>without</th><th>with</th><th>difference</th></tr>${rows.join("")}</table>` : `<div class="muted">No ${layer} at it.</div>`}`;
  }

  function showWhatIf(): void {
    const out = el.querySelector("[data-whatif-out]");
    if (out) out.innerHTML = whatIfOut();
    const move = el.querySelector("[data-wi-move]");
    if (move) move.textContent = hooks.lastMove()?.label ?? "none yet: preview one with a tool";
  }

  function inspected(): string {
    const data = inspect(world, hooks.selected());
    return data ? esc(json(data)) : "Pick a town, site, route or road in the panel or on the map.";
  }

  function render(): void {
    const opening = world.remit ? ` (${world.remit.toOpen} waiting)` : "";
    el.innerHTML = `
      <div class="top"><b>Console</b> <span class="muted">dev · every move is in the run file · <kbd>\`</kbd> closes</span></div>
      <div class="moves">
        <button class="quiet" data-op="end-term">End the term</button>
        <button class="quiet" data-op="rains">Rains now</button>
        <button class="quiet" data-op="pledges">Offer pledges now</button>
        <button class="quiet" data-op="open">Open a cluster now${opening}</button>
        <span class="money">₦ <input type="number" data-money value="100000" /> <button class="quiet" data-op="funds">Set money</button></span>
        <span class="money">day <input type="number" data-fork-day min="1" max="${hooks.day()}" value="${Math.max(1, hooks.day() - 10)}" /> <button class="quiet" data-fork>Fork from this day</button></span>
      </div>
      <div class="muted">A fork keeps this game and opens a new save of it from that day's start, replayed to there.</div>
      <details open><summary>Numbers (${KEYS.length})</summary>
        <input type="search" data-filter placeholder="filter: yard, term, cost…" value="${esc(filter)}" />
        <div data-numbers>${numbers()}</div>
      </details>
      <details open><summary>What if</summary>
        <div class="moves"><button class="quiet" data-take>Take the game now</button></div>
        <div><label><input type="radio" name="wi" value="tune" checked /> the number</label>
          <input list="wi-keys" data-wi-key placeholder="yardReachCells" /> = <input data-wi-value size="6" placeholder="value" /></div>
        <div><label><input type="radio" name="wi" value="move" /> the move last previewed: <span data-wi-move></span></label></div>
        <div class="moves">for <input type="number" data-wi-days value="10" min="1" max="30" /> days <button class="quiet" data-ask>Ask</button></div>
        <datalist id="wi-keys">${KEYS.map((key) => `<option value="${key}"></option>`).join("")}</datalist>
        <div data-whatif-out></div>
      </details>
      <details open><summary>Inspect</summary>
        <button class="quiet" data-copy>Copy JSON</button>
        <pre data-inspect>${inspected()}</pre>
      </details>`;
    showWhatIf();
  }

  el.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    const op = button.dataset.op as ConsoleOp | undefined;
    if (op === "funds") {
      const amount = Number(el.querySelector<HTMLInputElement>("[data-money]")!.value);
      if (Number.isFinite(amount)) move("funds", { amount }, `money set to ₦${Math.round(amount).toLocaleString()}.`);
    } else if (op === "end-term") move(op, {}, "the term ends at the next day's check.");
    else if (op === "rains") move(op, {}, "the rains are named now.");
    else if (op === "pledges") move(op, {}, "the term's pledges are offered again from today's problems.");
    else if (op === "open") move(op, {}, "an opening waits for you: choose its cluster on Waiting on you.");
    else if (button.dataset.fork !== undefined) {
      const day = Number(el.querySelector<HTMLInputElement>("[data-fork-day]")!.value);
      hooks.say(`Console: forking from day ${day}…`, false, 30);
      void hooks.fork(day).then((why) => { if (why) hooks.say(`Console: ${why}`, true, 5); });
    } else if (button.dataset.take !== undefined) {
      take();
      showWhatIf();
    } else if (button.dataset.ask !== undefined) {
      const picked = change();
      if (typeof picked === "string") return hooks.say(`What if: ${picked}`, true, 5);
      const days = Math.max(1, Math.min(30, Math.round(Number(el.querySelector<HTMLInputElement>("[data-wi-days]")!.value) || 10)));
      if (taken === null) take();
      asked += 1;
      asking = { id: asked, label: picked.label, days, done: 0, of: 0 };
      failed = "";
      send({ type: "ask", id: asked, change: picked.change, days });
      showWhatIf();
    } else if (button.dataset.cancel !== undefined) {
      send({ type: "cancel" });
      asking = null;
      showWhatIf();
    } else if (button.dataset.copy !== undefined) {
      const data = inspect(world, hooks.selected());
      if (data) void navigator.clipboard?.writeText(json(data)).then(() => hooks.say("Console: copied.", false, 2));
    }
    if (op) render();
  });
  el.addEventListener("input", (event) => {
    const field = event.target as HTMLInputElement;
    if (field.dataset.filter === undefined) return;
    filter = field.value;
    el.querySelector("[data-numbers]")!.innerHTML = numbers();
  });
  // A number is set when it's left or Enter is pressed; a switch when it's ticked.
  el.addEventListener("change", (event) => {
    const field = event.target as HTMLInputElement;
    if (field.name === "wi-graph") {
      layer = field.value as GraphLayer | "off";
      showGraph();
      const node = el.querySelector("[data-whatif-node]");
      if (node) node.innerHTML = picked();
      return;
    }
    const key = field.dataset.tune;
    if (!key) return;
    const value = field.type === "checkbox" ? field.checked : Number(field.value);
    move("tune", { key, value }, `${key} = ${value}.`);
    el.querySelector("[data-numbers]")!.innerHTML = numbers();
  });

  return {
    toggle() {
      el.hidden = !el.hidden;
      window.clearInterval(timer);
      if (el.hidden) return;
      render();
      // Inspect follows the pick and the game; the rest is redrawn only by a move, so a field
      // being typed in keeps its focus.
      timer = window.setInterval(() => {
        const pre = el.querySelector("[data-inspect]");
        if (pre) pre.innerHTML = inspected();
        const move = el.querySelector("[data-wi-move]");
        if (move) move.textContent = hooks.lastMove()?.label ?? "none yet: preview one with a tool";
        const node = el.querySelector("[data-whatif-node]");
        if (node) node.innerHTML = picked();
      }, 1000);
    },
  };
}
