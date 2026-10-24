import { aWeekOnText, termVerdictText, pledgeProgress, MAX_COMMITTED } from "@engine/game/term";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";
import type { GameWorld } from "@engine/game/types";
import { diagnoseRoute, gameDay, roadPath, routeSummaries, townShare } from "@engine/game/world";
import { growthTrend, roadFull, townGrowth } from "@engine/game/growth";
import { averageHeadline, averageNet } from "@engine/game/history";
import { goodsFlows, flowKey, lorrySummaries } from "@engine/game/goods";
import { siteProduction } from "@engine/game/production";
import { corridorSummaries } from "@engine/game/corridors";
import { cargoName, fuelSupply } from "@engine/game/fuel";
import { cementBreak, cementServed } from "@engine/game/cement";
import { steelBreak, steelServed } from "@engine/game/steel";
import { railPath } from "@engine/game/rail";
import { roadCapacity } from "@engine/game/congestion";
import { townNoSeat, shrinkCause, wornRoadAt, type NamedMove } from "@engine/game/problems";
import type { RunDay, RunRecorder } from "@engine/game/runlog";
import type { GameEvent } from "@engine/game/settlement";

// The information lab's three layers (info-lab.html, agreed 2026-10-23), on the live game:
//
//   - the strip: a few numbers that move, each with its last ten days and a sparkline;
//   - the log: what happened, kept, filterable, a click shows what it's about;
//   - the side panel: lists that sort (routes, towns, sites), and one layout for whatever
//     you pick -- a town, a route, a site, a road -- with a chart of it over the days and
//     its problem in one line, with the move that answers it as a real button;
//   - the revenue screen: the money, over the days.
//
// The lab drew a saved run; this draws the world as it runs, and the days the run
// recorder keeps (runlog.ts), so the charts are the same data. The old cards keep
// everything the lab didn't show (trips, industry controls, strikes, bonds...) under
// a "More" fold: the page passes them in (ScreenHooks), and their buttons work as before.

export type Selection = { kind: "town" | "route" | "site" | "segment"; id: string } | null;

export interface ScreenHooks {
  /** The old town or site card, whole. */
  townMore(id: string): string;
  /** The old route card. */
  routeMore(id: string): string;
  /** Under the routes list: lorries, corridors, your share (the old routes wing's rest). */
  routesMore(): string;
  /** The debt advice when you're in debt: shown over the routes list, not folded. */
  moneyNote(): string;
  /** The old Treasury drawer: bonds, chains, the named project, the budget lines. */
  treasuryMore(): string;
  /** A bond for a restore, when you can't pay for it (main.ts bondButton); "" when none's on offer. */
  bond(purpose: "works" | "refinery" | "steel"): string;
}

// --- Formatting ------------------------------------------------------------

const naira = (n: number) => `${n < 0 ? "−" : ""}₦${Math.abs(Math.round(n)).toLocaleString()}`;
const nairaK = (n: number) => (Math.abs(n) >= 10000 ? `${n < 0 ? "−" : ""}₦${Math.round(Math.abs(n) / 1000).toLocaleString()}k` : naira(n));
const int = (n: number) => Math.round(n).toLocaleString();
const pct = (x: number) => `${Math.round(x * 100)}%`;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const KIND_COLOR: Record<string, string> = { bus: "--you", minibus: "--s3", brt: "--s4", train: "--rail" };

export function createScreen(world: GameWorld, recorder: RunRecorder, hooks: ScreenHooks) {
  const stripEl = document.querySelector<HTMLElement>("#strip")!;
  const logEl = document.querySelector<HTMLElement>("#log")!;
  const panelEl = document.querySelector<HTMLElement>("#panel")!;
  const revenueEl = document.querySelector<HTMLElement>("#revenue")!;
  const tip = document.querySelector<HTMLDivElement>("#tip")!;

  let selected: Selection = null;
  /** Picked by pointing at it on the map (not a click): shown, but the map isn't faded for it. */
  let selectedFromMap = false;
  /** A row hovered in the panel or the log: the map fades the rest (focus). */
  let hover: Selection = null;
  let tab: "routes" | "towns" | "sites" = "routes";
  const sorts: Record<string, { key: string; dir: 1 | -1 }> = { routes: { key: "net", dir: 1 }, towns: { key: "growth", dir: -1 }, sites: { key: "use", dir: 1 }, revenue: { key: "net", dir: -1 } };
  let logFilter = "all";
  let range = 0; // the revenue screen: 0 = all days
  /** Which "More" folds are open, by key: kept across the panel's redraws. */
  const openFolds = new Set<string>();
  /** The moves the panel's problem lines offer, by index: a click does the one it names. */
  let named: NamedMove[] = [];

  const days = (): RunDay[] => recorder.file.days;
  const nameOf = (id: string) => world.towns.get(id)?.name ?? world.ruins.get(id)?.name ?? id;
  const routeName = (r: { a: string; b: string }) => `${nameOf(r.a)} ↔ ${nameOf(r.b)}`;
  const kindOf = (id: string) => (id.startsWith("rail:") ? "train" : id.startsWith("mini:") ? "minibus" : id.startsWith("brt:") ? "brt" : "bus");

  /** A day's budget line from the cumulative tally: today less yesterday, rolled over five days. */
  function dailyBudget(key: string | string[]): number[] {
    const keys = Array.isArray(key) ? key : [key];
    const ds = days();
    const raw = ds.map((d, i) => {
      const prev = i > 0 ? ds[i - 1]!.budget as Record<string, number> : null;
      const now = d.budget as Record<string, number>;
      return keys.reduce((sum, k) => sum + (now[k] ?? 0) - (prev ? prev[k] ?? 0 : 0), 0);
    });
    return raw.map((_, i) => {
      const w = raw.slice(Math.max(0, i - 4), i + 1);
      return w.reduce((a, b) => a + b, 0) / w.length;
    });
  }

  // --- The live data: what the lab's snapshot held, read off the world now ---------

  function routes() {
    return routeSummaries(world).map((r) => {
      const route = world.routes.find((x) => x.id === r.id)!;
      const kind = kindOf(r.id);
      return {
        id: r.id, a: r.a, b: r.b, kind, vehicles: r.buses,
        incomePerDay: r.incomePerDay, costPerDay: r.costPerDay, netPerDay: r.netPerDay,
        ridersPerDay: (route?.boardingRateEMA ?? 0) * D, loadFactor: route?.loadFactorEMA ?? 0,
        verdict: diagnoseRoute(world, r.id)?.verdict ?? null,
        stops: (kind === "train" ? railPath(world, r.a, r.b) : roadPath(world, r.a, r.b))?.nodeIds ?? [r.a, r.b],
      };
    });
  }
  type Route = ReturnType<typeof routes>[number];

  function town(id: string) {
    const t = world.towns.get(id)!;
    const g = townGrowth(world, id);
    const share = townShare(world, id);
    const full = roadFull(world, id);
    return {
      id, name: t.name, population: t.population, base: world.basePopulation.get(id) ?? null, industry: t.industry ?? null,
      roadside: !t.industry && !world.basePopulation.has(id), trend: growthTrend(world, id), target: g?.target ?? null,
      cementHeld: g?.cementHeld ?? 0, steelHeld: g?.steelHeld ?? 0, expected: g?.expected ?? 0,
      share: { you: share.player, informal: share.informal, lost: share.lost },
      fuel: fuelSupply(world, id)?.supplied ?? null, cement: world.cement ? cementServed(world, id) : null, steel: world.steel ? steelServed(world, id) : null,
      roadFull: full && full.road ? { next: full.next, thin: !!full.thin } : null,
    };
  }
  type Town = ReturnType<typeof town>;
  const homeTowns = () => [...world.towns.keys()].filter((id) => !world.towns.get(id)!.industry).map(town);

  function site(id: string) {
    const p = siteProduction(world, id);
    return { id, product: p?.product ?? null, made: p ? p.made * D : 0, capacity: p ? p.capacity * D : 0, limit: p?.limit ?? null, staffing: p?.staffing ?? null, shipped: p?.shipped ?? null };
  }
  type Site = ReturnType<typeof site>;
  const sites = () => [...world.towns.values()].filter((t) => t.industry).map((t) => site(t.id));

  // --- Problems: one line each, and the move that answers it -------------------------

  type Problem = { text: string; button: string } | null;
  /** A real move (problems.ts) as a button the panel's click handler does. */
  const moveButton = (move: NamedMove | undefined, fallback: string): string => {
    if (!move) return fallback;
    named.push(move);
    return `<button data-named="${named.length - 1}" title="${esc(move.label)}">${esc(move.label.replace(/\s*\([^)]*\)$/, ""))} · ${nairaK(move.price)}</button>`;
  };
  const toolButton = (tool: string, label: string) => `<button data-tool="${tool}">${esc(label)}</button>`;

  /** A restore as a real button, with the bond beside it when you're short (the cement works' was under More). */
  function restoreButton(what: "works" | "refinery" | "steel"): string {
    const t = world.tuning;
    const cost = what === "works" ? t.worksRestoreCost : what === "refinery" ? t.refineryRestoreCost : t.steelRestoreCost;
    const name = what === "works" ? "the cement works" : what === "refinery" ? "the refinery" : "the steel works";
    return `<button data-restore-${what}="1">Restore ${name} · ${nairaK(cost)}</button>${world.economy.funds < cost ? hooks.bond(what) : ""}`;
  }

  // --- Waiting on you (brief, Revision 5, step 1) --------------------------------------
  // Every move with a consequence, pinned at the top of the panel: the chain breaks that hold
  // towns back, each with the move that answers it. Only these get the map's amber mark --
  // on every town from day 1, it meant nothing, and the one that mattered (an idle cement
  // works, its restore under More) went unseen for 482 days. Pledges and the union's demands
  // join this list (steps 2 and 5).

  type Waiting = { text: string; button: string; at: string[]; weight: number };
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  function waitingOnYou(): Waiting[] {
    const items: Waiting[] = [];
    const towns = homeTowns();
    const held = (by: (t: Town) => number) => {
      const hit = towns.filter((t) => by(t) >= Math.max(5, 0.05 * t.population));
      return { towns: hit, people: hit.reduce((sum, t) => sum + by(t), 0) };
    };
    const cement = held((t) => t.cementHeld);
    if (world.cement && cement.towns.length > 0) {
      const b = cementBreak(world);
      const who = `${int(cement.people)}k people held back in ${plural(cement.towns.length, "town")}`;
      if (b?.kind === "idle") items.push({ text: `The cement works is idle: ${who}`, button: restoreButton("works"), at: [world.cement.worksId], weight: cement.people });
      else if (b?.kind === "quarry") items.push({ text: `Cement short, ${who}: ${nameOf(b.quarryId)}'s limestone isn't reaching the works`, button: toolButton("yard", `Yard at ${nameOf(b.quarryId)} (Y)`), at: [b.quarryId], weight: cement.people });
      else if (b?.kind === "carry") items.push({ text: `Cement short, ${who}: the works' cement isn't reaching them`, button: toolButton("yard", "Yard at the works (Y)"), at: [world.cement.worksId], weight: cement.people });
    }
    const steel = held((t) => t.steelHeld);
    if (world.steel && steel.towns.length > 0) {
      const b = steelBreak(world);
      const who = `${int(steel.people)}k people held back in ${plural(steel.towns.length, "town")}`;
      const works = world.steel.worksId ?? world.steel.terminalId;
      if (b?.kind === "idle") items.push({ text: `The steel works is idle: ${who}`, button: restoreButton("steel"), at: works ? [works] : [], weight: steel.people });
      else if (b?.kind === "ore") items.push({ text: `Steel short, ${who}: ${nameOf(b.mineId)}'s ore isn't reaching the works`, button: toolButton("yard", `Yard at ${nameOf(b.mineId)} (Y)`), at: [b.mineId], weight: steel.people });
      else if (b?.kind === "carry") items.push({ text: `Steel short, ${who}: it isn't reaching them from ${nameOf(b.from)}`, button: toolButton("yard", `Yard at ${nameOf(b.from)} (Y)`), at: [b.from], weight: steel.people });
    }
    const fuelShort = towns.filter((t) => t.fuel !== null && t.fuel < 0.6);
    if (world.fuel && fuelShort.length > 0) {
      // Weighed as the people living short of fuel, by how short.
      const weight = fuelShort.reduce((sum, t) => sum + t.population * (1 - (t.fuel ?? 0)), 0) * 0.3;
      const where = `${plural(fuelShort.length, "town")} short of fuel`;
      if (!world.fuel.restored) items.push({ text: `${where}, and the refinery is idle`, button: restoreButton("refinery"), at: [world.fuel.refineryId], weight });
      else {
        // Restored but starved of crude: crude moves by road only from a source with a yard (truckers.ts).
        const refinery = site(world.fuel.refineryId);
        const source = world.fuel.sourceId;
        if (refinery.capacity > 0 && refinery.made < 0.6 * refinery.capacity && refinery.limit === "input" && !world.yards.has(source)) {
          items.push({ text: `${where}: the refinery gets no crude from ${nameOf(source)}`, button: toolButton("yard", `Yard at ${nameOf(source)} (Y)`), at: [source], weight });
        } else items.push({ text: `${where}: the tank farm's fuel isn't reaching them`, button: toolButton("yard", "Yard at the tank farm (Y)"), at: [world.fuel.depotId], weight });
      }
    }
    // Your pledges this term, not yet kept: first, with the town (its panel has the move).
    for (const p of world.term?.pledges ?? []) {
      if (!p.committed || p.kept) continue;
      const kind = world.towns.get(p.townId)?.industry ? "site" : "town";
      items.push({ text: `Your pledge: ${p.text} · ${pct(pledgeProgress(world, p))}`, button: `<button data-pick="${kind}|${esc(p.townId)}">Show ${esc(nameOf(p.townId))}</button>`, at: [p.townId], weight: Infinity });
    }
    return items.sort((p, q) => q.weight - p.weight).slice(0, 5);
  }
  function waitingHtml(): string {
    const items = waitingOnYou();
    if (items.length === 0) return "";
    return `<div class="pane waiting"><h2>Waiting on you · ${items.length}</h2>${items.map((item) => `<div class="problem"><span>${esc(item.text)}</span>${item.button}</div>`).join("")}</div>`;
  }

  function townProblem(t: Town): Problem {
    if (t.industry) return null;
    if (t.roadFull && !t.roadFull.thin) {
      const next = t.roadFull.next;
      return { text: "Can't grow: its road is full", button: next === "rail" ? toolButton("track", "Track (K)") : toolButton("road", next === "paved" ? "Pave its road (R)" : "A bus lane (R)") };
    }
    // Cement past its first 40%: a problem only when it costs the town 5% of its size or more.
    if (t.cementHeld >= Math.max(5, 0.05 * t.population)) {
      const b = cementBreak(world);
      const button = b?.kind === "no-quarry" ? `<span class="muted">Next quarry ~day ${b.nextDay}</span>`
        : b?.kind === "quarry" ? toolButton("yard", `Yard at ${nameOf(b.quarryId)} (Y)`)
        : b?.kind === "idle" ? restoreButton("works")
        : toolButton("yard", "Yard at the works (Y)");
      return { text: `Short of cement (${pct(t.cement ?? 0)} of what it needs): ${int(t.cementHeld)}k fewer people than your service would grow it to`, button };
    }
    // Steel past +80% (steel.ts): the big towns' last growth.
    if (t.steelHeld >= Math.max(5, 0.05 * t.population)) {
      const b = steelBreak(world);
      const button = b?.kind === "idle" ? `<button data-restore-steel="1">Restore the steel works · ${nairaK(world.tuning.steelRestoreCost)}</button>`
        : b?.kind === "ore" ? toolButton("yard", `Yard at ${nameOf(b.mineId)} (Y)`)
        : b?.kind === "carry" ? toolButton("yard", `Yard at ${nameOf(b.from)} (Y)`)
        : "";
      return { text: `Short of steel (${pct(t.steel ?? 0)} of what it needs): ${int(t.steelHeld)}k fewer people than your service would grow it to`, button };
    }
    if (t.fuel !== null && t.fuel < 0.6) return { text: `Fuel short: ${pct(t.fuel)} supplied`, button: toolButton("yard", "Yard at the tank farm (Y)") };
    const shrink = shrinkCause(world, t.id);
    if (shrink) return { text: `Shrinking: ${shrink.why}`, button: moveButton(shrink.move ?? undefined, "") };
    const worn = wornRoadAt(world, t.id);
    if (worn) return { text: `Its road ${nameOf(worn.a)}–${nameOf(worn.b)} is worn: ${pct(worn.speed)} speed, ${naira(worn.roughPerDay)}/day more for your vehicles`, button: moveButton(worn.move, "") };
    const seat = townNoSeat(world, t.id);
    if (seat) return { text: `${int(seat.perDay)} a day find no seat, most toward ${nameOf(seat.worst.a === t.id ? seat.worst.b : seat.worst.a)}`, button: moveButton(seat.move, toolButton("bus", "Bus (B)")) };
    if (t.expected > 0 && t.share.you < t.expected) return { text: `Expects you to carry ${pct(t.expected)}; you carry ${pct(t.share.you)}`, button: toolButton("bus", "More buses (B)") };
    return null;
  }
  function routeProblem(r: Route): Problem {
    const add = `<button data-add="${r.id}">Add one</button>`;
    const sell = r.vehicles > 1 ? `<button data-remove="${r.id}">Sell one</button>` : `<button data-remove="${r.id}">Sell it</button>`;
    switch (r.verdict) {
      case "full": return { text: "Full: riders are left waiting", button: add };
      case "overcapacity": return { text: "More vehicles than riders", button: sell };
      case "thin": return { text: "Too few riders to pay its way", button: sell };
      case "jammed": return { text: "Stuck in traffic", button: toolButton("road", "Pave or a lane (R)") };
      case "worn": return { text: "Its road is worn: it costs more to run", button: toolButton("fix", "Keep the road up (F)") };
      case "waiting": return r.netPerDay < 0 ? { text: "Riders give up waiting, and it loses money", button: sell } : { text: "Riders give up waiting", button: add };
      default: return r.netPerDay < 0 ? { text: "Loses money", button: sell } : null;
    }
  }
  function siteProblem(s: Site): Problem {
    if (world.towns.get(s.id)?.industry === "steelworks" && world.steel && !world.steel.working) {
      return { text: "Idle: built, never run. Restore it and its mine starts digging", button: `<button data-restore-steel="1">Restore it · ${nairaK(world.tuning.steelRestoreCost)}</button>` };
    }
    if (!(s.capacity > 0 && s.made < 0.6 * s.capacity)) return null;
    const button = s.limit === "workers" ? toolButton("bus", "A bus for its workers (B)") : s.limit === "input" ? toolButton("yard", "A yard, or a lorry (Y, L)") : `<span class="muted">See More</span>`;
    return { text: `Makes ${pct(s.made / s.capacity)} of what it could: held back by its ${s.limit}`, button };
  }
  const problemHtml = (problem: Problem) => problem
    ? `<div class="problem"><span>⚠ ${esc(problem.text)}</span>${problem.button}</div>`
    : `<div class="problem none"><span>Nothing wrong here</span></div>`;
  const tile = (k: string, v: string, note = "") => `<div class="tile"><div class="k">${k}</div><div class="v num">${v}</div>${note ? `<div class="k">${note}</div>` : ""}</div>`;
  const fold = (key: string, label: string, body: string) => body.trim()
    ? `<details class="more" data-fold="${key}"${openFolds.has(key) ? " open" : ""}><summary>${esc(label)}</summary><div class="panel-body">${body}</div></details>`
    : "";

  // --- Charts (SVG): a line or stacked area over days, with a hover crosshair --------

  interface Series { name: string; color: string; values: number[] }

  function chartSvg(series: Series[], opts: { height?: number; stacked?: boolean; format?: (n: number) => string; from?: number; zeroLine?: boolean } = {}): string {
    const h = opts.height ?? 120;
    const n = series[0]?.values.length ?? 0;
    if (n < 2) return `<div class="muted chart-empty">A chart after the first two days.</div>`;
    const w = 600;
    const pad = { l: 46, r: 8, t: 6, b: 18 };
    const from = Math.min(opts.from ?? 0, n - 2);
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
    const ds = days();
    const xticks = [from, Math.round((from + n - 1) / 2), n - 1].map((i, k) => `<text x="${fx(i)}" y="${h - 4}" text-anchor="${["start", "middle", "end"][k]}" font-size="10" fill="var(--muted)">day ${ds[i]?.day ?? i + 1}</text>`).join("");
    let marks = "";
    if (opts.stacked) {
      for (let k = series.length - 1; k >= 0; k -= 1) {
        const top = xs.map((i) => `${fx(i)},${fy(stack(i, k))}`);
        const bottom = xs.slice().reverse().map((i) => `${fx(i)},${fy(k > 0 ? stack(i, k - 1) : 0)}`);
        marks += `<polygon points="${[...top, ...bottom].join(" ")}" fill="${series[k]!.color}" stroke="var(--surface)" stroke-width="1"/>`;
      }
    } else {
      for (const s of series) marks += `<polyline points="${xs.map((i) => `${fx(i)},${fy(s.values[i] ?? 0)}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    }
    const data = encodeURIComponent(JSON.stringify({ from, n, l: pad.l, r: pad.r, w, days: ds.map((d) => d.day), series }));
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" class="viz" data-chart="${data}" data-fmt="${opts.format === nairaK ? "naira" : "int"}">${grid}${zero}${marks}${xticks}<line class="cross" x1="0" x2="0" y1="${pad.t}" y2="${h - pad.b}" stroke="var(--ink)" stroke-width="1" visibility="hidden"/></svg>`;
  }

  // One crosshair and tooltip for every chart on the page.
  document.addEventListener("mousemove", (event) => {
    const svg = (event.target as Element).closest?.("svg.viz") as SVGSVGElement | null;
    document.querySelectorAll<SVGLineElement>("svg.viz .cross").forEach((c) => {
      if (!svg || !svg.contains(c)) c.setAttribute("visibility", "hidden");
    });
    if (!svg) {
      tip.style.display = "none";
      return;
    }
    const d = JSON.parse(decodeURIComponent(svg.dataset.chart!)) as { from: number; n: number; l: number; r: number; w: number; days: number[]; series: Series[] };
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * d.w;
    const i = Math.max(d.from, Math.min(d.n - 1, Math.round(d.from + ((x - d.l) / (d.w - d.l - d.r)) * (d.n - 1 - d.from))));
    const cx = d.l + ((i - d.from) / Math.max(1, d.n - 1 - d.from)) * (d.w - d.l - d.r);
    const cross = svg.querySelector<SVGLineElement>(".cross")!;
    cross.setAttribute("x1", String(cx));
    cross.setAttribute("x2", String(cx));
    cross.setAttribute("visibility", "visible");
    const fmt = svg.dataset.fmt === "naira" ? nairaK : (v: number) => int(v);
    tip.innerHTML = `<b>Day ${d.days[i] ?? i + 1}</b>${d.series.map((s) => `<br><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}: ${fmt(s.values[i] ?? 0)}`).join("")}`;
    tip.style.display = "block";
    tip.style.left = `${event.clientX + 14}px`;
    tip.style.top = `${event.clientY + 12}px`;
  });

  function sparkline(values: number[], color: string): string {
    const w = 110;
    const h = 24;
    if (values.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - 2 - ((v - min) / Math.max(1, max - min)) * (h - 4)}`).join(" ");
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }

  // --- The strip ---------------------------------------------------------------------

  /** The strip's numbers now (5-day averages, as the game has always shown them). */
  function now() {
    const h = averageHeadline(world);
    return { day: gameDay(world), tripsMade: h.tripsPerDay, yourRiders: h.yourRidersPerDay, noSeat: h.noSeatPerDay, netPerDay: averageNet(world), funds: world.economy.funds };
  }

  /**
   * The term owns the strip's first block (brief, Revision 5, step 2): its day, and the
   * pledges on offer with how far each has got; pledge up to two. Without terms (a run
   * played before them), the day, as before.
   */
  function termHtml(day: number, mapLine: string): string {
    const term = world.term;
    if (!term) return `<div class="stat"><div class="k">Day</div><div class="v num">${day}</div><div class="d muted">${mapLine}</div></div>`;
    const length = world.tuning.termDays ?? 120;
    const termDay = Math.min(length, Math.floor((world.economy.elapsedSeconds - term.startedAtSeconds) / D) + 1);
    const committed = term.pledges.filter((p) => p.committed).length;
    const rows = term.pledges.map((p) => {
      const progress = pledgeProgress(world, p);
      const can = !p.committed && committed < MAX_COMMITTED;
      return `<div class="pledge${p.committed ? " on" : ""}${p.kept ? " kept" : ""}" title="${esc(p.text)}">
        <span class="t">${p.kept ? "✓ " : p.committed ? "★ " : ""}${esc(p.text)}</span>
        <i class="bar"><b style="width:${Math.round(progress * 100)}%"></b></i>
        ${can ? `<button data-pledge="${esc(p.id)}">Pledge</button>` : `<button data-pick="${world.towns.get(p.townId)?.industry ? "site" : "town"}|${esc(p.townId)}">Show</button>`}
      </div>`;
    }).join("");
    return `<div class="stat term"><div class="k">Day ${day} · Term ${term.number}, day ${termDay} of ${length}${committed < MAX_COMMITTED ? ` · pledge ${MAX_COMMITTED - committed}` : ""}</div>${rows || `<div class="d muted">Nothing to pledge this term</div>`}<div class="d muted">${mapLine}</div></div>`;
  }

  function renderStrip(mapLine: string): void {
    const ds = days();
    const recent = ds.slice(-30);
    const ten = ds[ds.length - 10] ?? ds[0];
    const n = now();
    const stat = (k: string, title: string, v: string, value: number, then: number | undefined, values: number[], fmt: (x: number) => string, color = css("--ink-2")) => {
      const d = then === undefined ? 0 : value - then;
      const cls = d > 0 ? "up" : d < 0 ? "down" : "muted";
      const change = then === undefined ? `<div class="d muted">from day 10</div>` : `<div class="d ${cls}">${d >= 0 ? "▲" : "▼"} ${fmt(Math.abs(d))} in 10 days</div>`;
      return `<div class="stat" title="${title}"><div class="k">${k}</div><div class="v num">${v}</div>${change}${sparkline(values, color)}</div>`;
    };
    // The original towns' people, the score (the review: it wasn't in the strip at all).
    const base = (towns: Array<{ id: string; population: number }>) => towns.reduce((sum, t) => sum + (world.basePopulation.has(t.id) ? t.population : 0), 0);
    const peopleNow = base([...world.towns.values()]);
    stripEl.innerHTML = `
      ${termHtml(n.day, mapLine)}
      ${stat("People", "The towns you started with: their people now, thousands", `${int(peopleNow)}k`, peopleNow, ten ? base(ten.towns) : undefined, recent.map((d) => base(d.towns)), (x) => `${int(x)}k`, css("--good"))}
      ${stat("Trips made a day", "Trips between towns that happened, by anyone, a day: 5-day average", int(n.tripsMade), n.tripsMade, ten?.tripsMade, recent.map((d) => d.tripsMade), int)}
      ${stat("Your riders a day", "Trips your vehicles carried, a day", int(n.yourRiders), n.yourRiders, ten?.yourRiders, recent.map((d) => d.yourRiders), int, css("--you"))}
      ${stat("No seat a day", "Stayed home: a road joins their towns, but nobody carried them", int(n.noSeat), n.noSeat, ten?.noSeat, recent.map((d) => d.noSeat), int, css("--bad"))}
      ${stat("Net a day", "Income less running costs and upkeep, a day, over the last 5 days", naira(n.netPerDay), n.netPerDay, ten?.netPerDay, recent.map((d) => d.netPerDay), naira)}
      ${stat("Money", "What you hold", nairaK(n.funds), n.funds, ten?.funds, recent.map((d) => d.funds), nairaK)}
      <div class="spacer"></div>
      <div class="actions"><button data-revenue="open">Revenue ▸</button></div>`;
  }

  // --- The side panel ----------------------------------------------------------------

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
    named = [];
    const scroll = panelEl.scrollTop;
    if (selected && !exists(selected)) selected = null;
    if (selected) {
      panelEl.innerHTML = `${waitingHtml()}<div class="pane"><button class="back" data-back="1">◂ All ${tab}</button>${detailHtml(selected)}</div>`;
    } else {
      const tabs = `<div class="tabs">${(["routes", "towns", "sites"] as const).map((t) => `<button data-tab="${t}" class="${tab === t ? "on" : ""}">${t[0]!.toUpperCase()}${t.slice(1)}</button>`).join("")}</div>`;
      panelEl.innerHTML = `${waitingHtml()}${tabs}<div class="pane">${tab === "routes" ? routesTable() : tab === "towns" ? townsTable() : sitesTable()}</div>`;
    }
    panelEl.scrollTop = scroll;
  }
  function exists(sel: NonNullable<Selection>): boolean {
    if (sel.kind === "town" || sel.kind === "site") return world.towns.has(sel.id);
    if (sel.kind === "route") return world.routes.some((r) => r.id === sel.id);
    return world.simulation.map.segments.some((s) => s.id === sel.id);
  }

  function routesTable(): string {
    const all = routes();
    const rows = sortRows(all, "routes", { name: (r) => routeName(r), vehicles: (r) => r.vehicles, riders: (r) => r.ridersPerDay, load: (r) => r.loadFactor, net: (r) => r.netPerDay });
    const losing = all.filter((r) => r.netPerDay < 0).length;
    const lines = lorrySummaries(world);
    return `${hooks.moneyNote()}<h2>Your routes · ${all.length}${all.length ? `, ${losing} losing money` : ""}</h2>
      ${all.length ? `<table><thead><tr>${th("routes", "name", "Route")}${th("routes", "vehicles", "Veh.")}${th("routes", "riders", "Riders/day")}${th("routes", "load", "Full")}${th("routes", "net", "Net/day")}</tr></thead><tbody>
      ${rows.map((r) => `<tr class="row" data-pick="route|${r.id}"><td><span class="swatch" style="background:var(${KIND_COLOR[r.kind] ?? "--you"})"></span>${esc(routeName(r))}</td><td>${r.vehicles}</td><td>${int(r.ridersPerDay)}</td><td>${pct(r.loadFactor)}</td><td class="${r.netPerDay < 0 ? "down" : ""}">${naira(r.netPerDay)}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted">No routes yet. Pick the bus tool (B), click a town, then another.</p>`}
      ${lines.length ? `<h2>Freight lines and lorries</h2><table><tbody>${lines.map((g) => `<tr><td><span class="swatch" style="background:var(--goods)"></span>${esc(routeName(g))}</td><td>${g.lorries}</td><td class="${g.netPerDay < 0 ? "down" : ""}">${naira(g.netPerDay)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${fold("routes-more", "More: lorries, corridors, your share", hooks.routesMore())}`;
  }

  function townsTable(): string {
    const towns = homeTowns();
    const base = (t: Town) => t.base ?? t.population;
    const growth = (t: Town) => (t.population - base(t)) / Math.max(1, base(t));
    const rows = sortRows(towns, "towns", { name: (t) => t.name, pop: (t) => t.population, growth, you: (t) => t.share.you });
    const problems = new Map(towns.map((t) => [t.id, townProblem(t)]));
    return `<h2>Towns · ${[...problems.values()].filter(Boolean).length} with a problem</h2>
      <table><thead><tr>${th("towns", "name", "Town")}${th("towns", "pop", "People")}${th("towns", "growth", "Since day 1")}${th("towns", "you", "You carry")}</tr></thead><tbody>
      ${rows.map((t) => `<tr class="row" data-pick="town|${t.id}"><td>${problems.get(t.id) ? "⚠ " : ""}${esc(t.name)}</td><td>${int(t.population)}k</td><td class="${growth(t) >= 0 ? "up" : "down"}">${t.base === null ? "new" : `${growth(t) >= 0 ? "+" : ""}${pct(growth(t))}`}</td><td>${pct(t.share.you)}</td></tr>`).join("")}
      </tbody></table>`;
  }

  function sitesTable(): string {
    const use = (s: Site) => (s.capacity > 0 ? s.made / s.capacity : 0);
    const rows = sortRows(sites().filter((s) => s.capacity > 0), "sites", { name: (s) => nameOf(s.id), use, made: (s) => s.made });
    return `<h2>Sites · what each makes of what it could</h2>
      ${rows.length ? `<table><thead><tr>${th("sites", "name", "Site")}${th("sites", "made", "t/day")}${th("sites", "use", "Of capacity")}</tr></thead><tbody>
      ${rows.map((s) => `<tr class="row" data-pick="site|${s.id}"><td>${use(s) < 0.6 ? "⚠ " : ""}${esc(nameOf(s.id))}</td><td>${int(s.made)}</td><td class="${use(s) < 0.6 ? "down" : ""}">${pct(use(s))}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted">No sites working.</p>`}`;
  }

  function detailHtml(sel: NonNullable<Selection>): string {
    if (sel.kind === "town" && world.towns.get(sel.id)?.industry) sel = { kind: "site", id: sel.id };
    if (sel.kind === "town") {
      const t = town(sel.id);
      const since = t.base ? (t.population - t.base) / t.base : 0;
      const pop = days().map((d) => d.towns.find((x) => x.id === t.id)?.population ?? 0);
      const here = routes().filter((r) => r.stops.includes(t.id));
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
        ${t.fuel !== null || t.cement !== null ? `<div class="tiles">${t.fuel !== null ? tile("Fuel supplied", pct(t.fuel)) : ""}${t.cement !== null ? tile("Cement supplied", pct(t.cement), t.cementHeld > 1 ? `${int(t.cementHeld)}k fewer people for it` : "") : ""}${t.steel !== null ? tile("Steel supplied", pct(t.steel), t.steelHeld > 1 ? `${int(t.steelHeld)}k fewer people for it` : "past +80% of its start") : ""}</div>` : ""}
        <h2>Your routes here · ${here.length}</h2>
        <table><tbody>${here.map((r) => `<tr class="row" data-pick="route|${r.id}"><td><span class="swatch" style="background:var(${KIND_COLOR[r.kind] ?? "--you"})"></span>${esc(routeName(r))}</td><td>${int(r.ridersPerDay)}/day</td><td class="${r.netPerDay < 0 ? "down" : ""}">${naira(r.netPerDay)}</td></tr>`).join("") || `<tr><td class="muted">None</td></tr>`}</tbody></table>
        ${fold("town", "More: its trips, parks, metro, strikes", hooks.townMore(t.id))}`;
    }
    if (sel.kind === "route") {
      const r = routes().find((x) => x.id === sel.id)!;
      const ds = days();
      const net = ds.map((d) => d.routes.find((x) => x.id === r.id)?.netPerDay ?? 0);
      const first = Math.max(0, ds.findIndex((d) => d.routes.some((x) => x.id === r.id)));
      return `<div class="kicker">${r.kind === "train" ? "Train" : r.kind === "brt" ? "BRT" : r.kind === "minibus" ? "Minibus" : "Bus"} route${r.verdict ? ` · ${r.verdict}` : ""}</div>
        <div class="head"><div class="title">${esc(routeName(r))}</div><div class="num ${r.netPerDay < 0 ? "down" : "up"}">${naira(r.netPerDay)}/day</div></div>
        ${problemHtml(routeProblem(r))}
        <div class="tiles">
          ${tile("Riders a day", int(r.ridersPerDay))}
          ${tile("How full", pct(r.loadFactor))}
          ${tile("Vehicles", `${r.vehicles} <button data-remove="${r.id}" title="Sell one">−</button> <button data-add="${r.id}" title="Add one">+</button>`)}
          ${tile("In / cost a day", `${nairaK(r.incomePerDay)} / ${nairaK(r.costPerDay)}`)}
        </div>
        <div class="chart"><div class="t"><span>Net a day</span><span>since day ${ds[first]?.day ?? gameDay(world)}</span></div>${chartSvg([{ name: "Net a day", color: css("--you"), values: net }], { height: 90, format: nairaK, from: first, zeroLine: true })}</div>
        <h2>Stops</h2><div>${r.stops.map((s) => esc(nameOf(s))).join(" → ")}</div>
        ${fold("route", "More: why, its road, freight", hooks.routeMore(r.id))}`;
    }
    if (sel.kind === "site") {
      const t = world.towns.get(sel.id)!;
      const s = site(sel.id);
      const flows = goodsFlows(world).map((f) => {
        const o = world.goods.outcomes.get(flowKey(f));
        return { from: f.from, to: f.to, cargo: cargoName(world, f.from, f.kind, f.to), perDay: f.rate * D, yours: (o?.delivered ?? 0) * D, hauliers: (o?.trucked ?? 0) * D, spoiled: (o?.spoiled ?? 0) * D };
      }).filter((f) => f.perDay >= 1);
      const out = flows.filter((f) => f.from === sel.id);
      const inn = flows.filter((f) => f.to === sel.id);
      const flowRows = (fs: typeof flows, other: (f: (typeof flows)[number]) => string) => fs.map((f) => {
        const tot = Math.max(1, f.yours + f.hauliers + f.spoiled);
        return `<tr><td>${esc(f.cargo)} · ${esc(nameOf(other(f)))}</td><td>${int(f.perDay)} t</td><td style="width:90px"><div class="bar3"><i style="width:${pct(f.yours / tot)};background:var(--goods)"></i><i style="width:${pct(f.hauliers / tot)};background:var(--informal)"></i><i style="width:${pct(f.spoiled / tot)};background:var(--home)"></i></div></td></tr>`;
      }).join("");
      return `<div class="kicker">Site · ${esc(t.industry ?? "")}</div>
        <div class="head"><div class="title">${esc(t.name)}</div></div>
        ${problemHtml(siteProblem(s))}
        <div class="tiles">
          ${tile("Makes a day", `${int(s.made)} t`, s.product ?? "")}
          ${tile("Of capacity", s.capacity > 0 ? pct(s.made / s.capacity) : "—", `${int(s.capacity)} t/day`)}
          ${tile("Workers", s.staffing !== null ? pct(s.staffing) : "—")}
          ${tile("Carried away", s.shipped !== null ? pct(s.shipped) : "—")}
        </div>
        ${out.length ? `<h2>Out · yours / hauliers' / spoiling</h2><table><tbody>${flowRows(out, (f) => f.to)}</tbody></table>` : ""}
        ${inn.length ? `<h2>In</h2><table><tbody>${flowRows(inn, (f) => f.from)}</tbody></table>` : ""}
        ${fold("site", "More: what it makes, expand, restore", hooks.townMore(t.id))}`;
    }
    const s = world.simulation.map.segments.find((x) => x.id === sel.id)!;
    const a = s.fromNodeId;
    const b = s.toNodeId;
    const cap = s.type === "rail" ? Infinity : roadCapacity(world, s.id);
    const flow = world.roadFlowEMA.get(s.id) ?? 0;
    const load = Number.isFinite(cap) && cap > 0 ? flow / cap : 0;
    const speed = world.segmentSpeed.get(s.id) ?? 1;
    const condition = s.condition ?? 1;
    const yours = routes().filter((r) => r.stops.some((x, i) => i > 0 && ((r.stops[i - 1] === a && x === b) || (r.stops[i - 1] === b && x === a)))).reduce((sum, r) => sum + r.ridersPerDay, 0);
    const corridor = corridorSummaries(world).find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
    const problem: Problem = speed < 0.7
      ? { text: `Jammed: traffic at ${pct(speed)} of free speed`, button: toolButton("road", s.surface === "dirt" ? "Pave it (R)" : "A bus lane (R)") }
      : condition < 0.5 ? { text: "Worn: vehicles pay more on it", button: toolButton("fix", "Keep it up (F)") } : null;
    return `<div class="kicker">${s.type === "rail" ? "Track" : `Road · ${s.surface ?? ""}${s.busLane ? " · bus lane" : ""}`}</div>
      <div class="head"><div class="title">${esc(nameOf(a))} – ${esc(nameOf(b))}</div></div>
      ${problemHtml(problem)}
      <div class="tiles">
        ${tile("Traffic", pct(load), "of what it carries before it jams")}
        ${tile("Speed", pct(speed))}
        ${tile("Your riders along it", int(yours))}
        ${tile("Condition", pct(condition))}
      </div>
      ${corridor ? `<h2>Who carries its trips${corridor.takenSince !== null ? " · taken" : ""}</h2><div class="bar3"><i style="width:${pct(corridor.you)};background:var(--you)"></i><i style="width:${pct(corridor.informal)};background:var(--informal)"></i><i style="width:${pct(corridor.lost)};background:var(--home)"></i></div><div class="muted">you ${pct(corridor.you)} · informal ${pct(corridor.informal)} · stayed home ${pct(corridor.lost)}</div>` : ""}`;
  }

  // --- The log -----------------------------------------------------------------------

  interface LogEntry { day: number; text: string; tone: "good" | "bad" | ""; group: string; select: Selection }
  function logEntry(e: GameEvent): Omit<LogEntry, "day"> | null {
    const ab = (x: { a: string; b: string }) => `${nameOf(x.a)}–${nameOf(x.b)}`;
    switch (e.kind) {
      case "strike-announced": return { text: `Strike called on ${ab(e)}`, tone: "bad", group: "trouble", select: { kind: "town", id: e.a } };
      case "strike-called-off": return { text: `Strike called off on ${ab(e)}`, tone: "good", group: "trouble", select: { kind: "town", id: e.a } };
      case "strike": return { text: `Strike on ${ab(e)}: danfos stop, your lane blocked`, tone: "bad", group: "trouble", select: { kind: "town", id: e.a } };
      case "strike-over": return { text: `Strike over on ${ab(e)}${typeof e.cost === "number" ? `, cost ${naira(e.cost)}` : ""}`, tone: "", group: "trouble", select: { kind: "town", id: e.a } };
      case "industry-opened": return { text: `${e.name} opened`, tone: "good", group: "sites", select: { kind: "site", id: e.townId } };
      case "industry-closed": return { text: `${e.name} closed (${e.reason})`, tone: "bad", group: "sites", select: null };
      case "refinery-opened": return { text: `${e.name} opened: a private refinery`, tone: "good", group: "sites", select: { kind: "site", id: e.townId } };
      case "founded": return { text: `${e.name} grew up on the road`, tone: "good", group: "growth", select: { kind: "town", id: e.townId } };
      case "abandoned": return { text: `${e.name} emptied out`, tone: "bad", group: "growth", select: null };
      case "milestone": return { text: `${e.name} ${["grew by a quarter", "grew by half", "doubled", "tripled"][e.index] ?? "grew"}: ${int(e.to)}k`, tone: "good", group: "growth", select: { kind: "town", id: e.townId } };
      case "corridor-taken": return { text: `You took ${ab(e)} from the danfos`, tone: "good", group: "corridors", select: { kind: "town", id: e.a } };
      case "corridor-released": return { text: `The danfos took ${ab(e)} back`, tone: "bad", group: "corridors", select: { kind: "town", id: e.a } };
      case "swept": return e.amount >= 1 ? { text: `The treasury swept ${nairaK(e.amount)}`, tone: "bad", group: "money", select: null } : null;
      case "project-affordable": return { text: `${ab(e)}: the ${e.rung === "lane" ? "bus lane" : "rail"} is affordable now`, tone: "good", group: "money", select: { kind: "town", id: e.a } };
      case "project-lapse-warning": return { text: `${ab(e)}: the project money lapses soon`, tone: "bad", group: "money", select: { kind: "town", id: e.a } };
      case "project-lapsed": return { text: `${ab(e)}: the project lapsed, the treasury took ${nairaK(e.taken)}`, tone: "bad", group: "money", select: null };
      case "project-done": return { text: `${ab(e)}: the ${e.rung === "lane" ? "bus lane" : "rail"} is built`, tone: "good", group: "money", select: { kind: "town", id: e.a } };
      case "term-started": return { text: `Term ${e.number} began: ${e.pledges.length} pledges on offer`, tone: "", group: "growth", select: null };
      case "pledge-kept": return { text: `Pledge kept: ${e.text}`, tone: "good", group: "growth", select: { kind: "town", id: e.townId } };
      case "term-ended": return { text: termVerdictText(e), tone: e.missed.length > e.kept.length ? "bad" : "good", group: "growth", select: null };
      case "a-week-on": return { text: aWeekOnText(world, e), tone: e.tripsBy >= 1 ? "good" : "", group: "growth", select: e.towns[0] ? { kind: world.towns.get(e.towns[0])?.industry ? "site" : "town", id: e.towns[0] } : null };
      case "road-gone": return { text: `The road ${ab(e)} is gone${e.sold ? `: ${e.sold} routes sold` : ""}`, tone: "bad", group: "trouble", select: null };
      default: return null;
    }
  }
  let logShown: LogEntry[] = [];
  let logSize = -1;
  function renderLog(force = false): void {
    const entries: LogEntry[] = [];
    for (const d of days()) for (const e of d.events) {
      const x = logEntry(e);
      if (x) entries.push({ day: d.day, ...x });
    }
    for (const e of recorder.pending) {
      const x = logEntry(e);
      if (x) entries.push({ day: gameDay(world), ...x });
    }
    // Only when something new happened: a redraw under the pointer swallows a click.
    if (!force && entries.length === logSize) return;
    logSize = entries.length;
    const groups: Array<[string, string]> = [["all", "All"], ["trouble", "Strikes"], ["sites", "Sites"], ["growth", "Growth"], ["corridors", "Corridors"], ["money", "Money"]];
    logShown = entries.filter((e) => logFilter === "all" || e.group === logFilter).reverse();
    logEl.innerHTML = `<h2>What happened</h2><div id="logfilter">${groups.map(([id, label]) => `<button data-log="${id}" class="${logFilter === id ? "on" : ""}">${label}</button>`).join("")}</div>
      ${logShown.map((e, i) => `<div class="event ${e.tone}" data-event="${i}"><span class="day">${e.day}</span><span class="what">${esc(e.text)}</span></div>`).join("") || `<div class="muted">Nothing yet.</div>`}`;
  }

  // --- The revenue screen ------------------------------------------------------------

  const revenueOpen = () => revenueEl.classList.contains("open");
  function openRevenue(open: boolean): void {
    revenueEl.classList.toggle("open", open);
    if (open) renderRevenue();
  }

  function renderRevenue(): void {
    const ds = days();
    const last = ds[ds.length - 1];
    const from = range > 0 ? Math.max(0, ds.length - range) : 0;
    const c = (v: string) => css(v);
    const income: Series[] = [
      { name: "Fares", color: c("--s1"), values: dailyBudget(["fares", "metro"]) },
      { name: "Tolls", color: c("--s2"), values: dailyBudget("tolls") },
      { name: "State allocation", color: c("--s3"), values: dailyBudget("allocation") },
      { name: "Goods, levies, exports", color: c("--s4"), values: dailyBudget(["goods", "levies", "loading", "exports"]) },
    ];
    // Running costs only: what the treasury takes isn't a cost of running anything.
    const costs: Series[] = [
      { name: "Running", color: c("--s1"), values: dailyBudget("running") },
      { name: "Road upkeep", color: c("--s2"), values: dailyBudget(["upkeep", "enforcement"]) },
      { name: "Fuel above the pump", color: c("--s3"), values: dailyBudget("fuel") },
      { name: "Bonds and settlements", color: c("--s4"), values: dailyBudget(["bonds", "settlements"]) },
    ];
    const swept = (d: RunDay) => (d.budget as Record<string, number>).swept ?? 0;
    const treasury: Series[] = [
      { name: "Treasury levy", color: c("--s1"), values: dailyBudget("remitted") },
      { name: "Swept at year end", color: c("--s2"), values: ds.map((d, i) => swept(d) - (i > 0 ? swept(ds[i - 1]!) : 0)) },
    ];
    const lastOf = (s: Series[]) => s.reduce((sum, x) => sum + (x.values[x.values.length - 1] ?? 0), 0);
    const key = (s: Series[]) => `<div class="keyrow">${s.map((x) => `<span><i style="background:${x.color}"></i>${esc(x.name)} ${nairaK(x.values[x.values.length - 1] ?? 0)}</span>`).join("")}</div>`;
    const rows = sortRows(routes(), "revenue", { name: (r) => routeName(r), income: (r) => r.incomePerDay, cost: (r) => r.costPerDay, net: (r) => r.netPerDay, riders: (r) => r.ridersPerDay });
    const total = (k: string) => ((last?.budget ?? {}) as Record<string, number>)[k] ?? 0;
    const n = now();
    const scroll = revenueEl.scrollTop;
    revenueEl.innerHTML = `
      <div class="top"><div class="title">Revenue · day ${n.day}</div>
        <div class="ranges">${[[0, "All"], [60, "60 days"], [30, "30 days"]].map(([k, label]) => `<button data-range="${k}" class="${range === k ? "on" : ""}">${label}</button>`).join("")}<button data-revenue="close">Back to the map ✕</button></div></div>
      <div class="heroes">
        <div class="hero"><div class="k">Net a day</div><div class="v num ${n.netPerDay < 0 ? "down" : "up"}">${naira(n.netPerDay)}</div></div>
        <div class="hero"><div class="k">Income a day</div><div class="v num">${naira(lastOf(income))}</div></div>
        <div class="hero"><div class="k">Costs a day</div><div class="v num">${naira(lastOf(costs))}</div></div>
        <div class="hero"><div class="k">Money</div><div class="v num">${naira(n.funds)}</div></div>
      </div>
      <div class="cards">
        <div class="card"><h3>Income a day, by source</h3><div class="sub">5-day average, stacked</div>${key(income)}${chartSvg(income, { height: 200, stacked: true, format: nairaK, from })}</div>
        <div class="card"><h3>Costs a day, by kind</h3><div class="sub">5-day average, stacked</div>${key(costs)}${chartSvg(costs, { height: 200, stacked: true, format: nairaK, from })}</div>
        <div class="card"><h3>What the treasury took</h3><div class="sub">Its levy a day (5-day average), and each year-end sweep on its day</div><div class="keyrow">${treasury.map((x) => `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join("")}</div>${chartSvg(treasury, { height: 160, format: nairaK, from })}</div>
        <div class="card"><h3>Net a day and money held</h3><div class="sub">Net a day</div>${chartSvg([{ name: "Net a day", color: c("--you"), values: ds.map((d) => d.netPerDay) }], { height: 140, format: nairaK, from, zeroLine: true })}<div class="sub">Money held</div>${chartSvg([{ name: "Money", color: c("--ink-2"), values: ds.map((d) => d.funds) }], { height: 110, format: nairaK, from })}</div>
        <div class="card"><h3>Where the money went, all game</h3><div class="sub">Totals since day 1</div>
          <table><tbody>
            ${[["Fares", "fares"], ["Tolls", "tolls"], ["State allocation", "allocation"], ["Park levies (agberos kept " + nairaK(total("agberos")) + ")", "levies"], ["Goods", "goods"], ["Export payments", "exports"]].map(([l, k]) => `<tr><td>${l}</td><td class="up">+${nairaK(total(k!))}</td></tr>`).join("")}
            ${[["Running costs", "running"], ["Road upkeep", "upkeep"], ["Treasury levy", "remitted"], ["Swept at year end", "swept"], ["Fuel above the pump price", "fuel"]].map(([l, k]) => `<tr><td>${l}</td><td class="down">−${nairaK(total(k!))}</td></tr>`).join("")}
          </tbody></table></div>
        <div class="card wide treasury"><h3>The treasury</h3><div class="sub">Bonds, the named project, the chains, this period's budget</div><div class="panel-body">${hooks.treasuryMore()}</div></div>
        <div class="card wide"><h3>Your routes</h3><div class="sub">Click a column to sort · today's figures a day</div>
          <table><thead><tr>${th("revenue", "name", "Route")}${th("revenue", "riders", "Riders/day")}${th("revenue", "income", "Income")}${th("revenue", "cost", "Cost")}${th("revenue", "net", "Net")}</tr></thead><tbody>
          ${rows.map((r) => `<tr class="row" data-pick="route|${r.id}"><td><span class="swatch" style="background:var(${KIND_COLOR[r.kind] ?? "--you"})"></span>${esc(routeName(r))}</td><td>${int(r.ridersPerDay)}</td><td>${naira(r.incomePerDay)}</td><td>${naira(r.costPerDay)}</td><td class="${r.netPerDay < 0 ? "down" : "up"}">${naira(r.netPerDay)}</td></tr>`).join("")}
          </tbody></table></div>
      </div>`;
    revenueEl.scrollTop = scroll;
  }

  // --- Clicks and hovers: the screen's own (tabs, sorting, picking); the rest is the page's ---

  function select(sel: Selection, fromMap = false): void {
    selected = sel;
    selectedFromMap = fromMap;
    renderPanel();
  }

  /** A click the screen handles itself: true when it did. Moves and old-card buttons are the page's. */
  function onClick(target: HTMLElement): boolean {
    const el = target.closest<HTMLElement>("[data-tab],[data-back],[data-sort],[data-pick],[data-log],[data-event],[data-range],[data-revenue]");
    if (!el || el.closest("details.more .panel-body")) return false;
    if (el.dataset.tab) { tab = el.dataset.tab as typeof tab; renderPanel(); return true; }
    if (el.dataset.back) { select(null); return true; }
    if (el.dataset.sort) {
      const [table, key] = el.dataset.sort.split(":") as [string, string];
      const s = sorts[table]!;
      sorts[table] = s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 };
      if (table === "revenue") renderRevenue();
      else renderPanel();
      return true;
    }
    if (el.dataset.pick) {
      const [kind, id] = el.dataset.pick.split("|") as [NonNullable<Selection>["kind"], string];
      if (revenueOpen()) openRevenue(false);
      select({ kind, id });
      return true;
    }
    if (el.dataset.log) { logFilter = el.dataset.log; renderLog(true); return true; }
    if (el.dataset.event !== undefined) {
      const e = logShown[Number(el.dataset.event)];
      if (e?.select && world.towns.has(e.select.id)) select(e.select);
      return true;
    }
    if (el.dataset.range !== undefined) { range = Number(el.dataset.range); renderRevenue(); return true; }
    if (el.dataset.revenue) { openRevenue(el.dataset.revenue === "open"); return true; }
    return false;
  }

  for (const el of [panelEl, logEl, revenueEl]) {
    el.addEventListener("mouseover", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-pick],[data-event]");
      if (row?.dataset.pick) {
        const [kind, id] = row.dataset.pick.split("|") as [NonNullable<Selection>["kind"], string];
        hover = { kind, id };
      } else if (row?.dataset.event !== undefined) hover = logShown[Number(row.dataset.event)]?.select ?? null;
      else hover = null;
    });
    el.addEventListener("mouseleave", () => (hover = null));
  }
  // A "More" fold stays open (or shut) across the panel's redraws.
  panelEl.addEventListener("toggle", (event) => {
    const d = event.target as HTMLDetailsElement;
    if (!d.dataset?.fold) return;
    if (d.open) openFolds.add(d.dataset.fold);
    else openFolds.delete(d.dataset.fold);
  }, true);

  return {
    renderStrip,
    renderPanel,
    renderLog,
    renderRevenue,
    openRevenue,
    revenueOpen,
    onClick,
    select,
    /** The named move a problem line's button offers. */
    namedMove: (i: number): NamedMove | undefined => named[i],
    /** The towns and sites on Waiting on you: the map marks these, and only these. */
    waitingTargets: (): Set<string> => new Set(waitingOnYou().flatMap((item) => item.at)),
    get selected() { return selected; },
    /** What the map focuses: a row hovered, else the thing picked. */
    get focus(): Selection { return hover ?? (selectedFromMap ? null : selected); },
  };
}
export type Screen = ReturnType<typeof createScreen>;
