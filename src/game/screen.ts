import { projectName } from "@engine/game/project";
import { isTrunk, trunkPrice } from "@engine/game/trunks";
import { airportStranded, airportSummary } from "@engine/game/airport";
import { pipeSummaries } from "@engine/game/pipelines";
import { routeAlong, stanceWord, unionOf } from "@engine/game/union";
import { fordBridgeCost, fordById } from "@engine/game/floods";
import { LINE_COLOURS, labelOf, roadLabelKeyOf, routeLabelKey } from "@engine/game/labels";
import { clusterOf, clusterOfferShare } from "@engine/game/clusters";
import { privateLoad } from "@engine/game/private";
import { closedClusterOf, clusterBrings, inRemit, remitOffers } from "@engine/game/remit";
import { aWeekOnText, termVerdictText, pledgeMove, pledgeNow, pledgeProgress, MAX_COMMITTED, type Pledge } from "@engine/game/term";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";
import type { GameWorld } from "@engine/game/types";
import { diagnoseRoute, gameDay, networkShare, roadPath, routeSummaries, townShare } from "@engine/game/world";
import { growthTrend, roadFull, townGrowth } from "@engine/game/growth";
import { averageBudget, averageHeadline, averageNet } from "@engine/game/history";
import { diagnoseLorryRoute, goodsFlows, flowKey } from "@engine/game/goods";
import { corridorWear } from "@engine/game/wear";
import { goneAt, restoreCost as restoreRoadCost } from "@engine/game/retire";
import { corridorSummaries } from "@engine/game/corridors";
import { cargoName, fuelPlanned, fuelReach, fuelReachable } from "@engine/game/fuel";
import { hasYard } from "@engine/game/yards";
import { siteFigure, type FigureData } from "./seethrough";
import { exportsBy, farmTowns } from "@engine/game/food";
import { borderCountry } from "@engine/game/border";
import { exportGateway, nextPortRung, portScale, seaportLink } from "@engine/game/gateways";
import { patchHtml } from "./patch";
import { GROUPS, KIND_NAME, VERDICT_WORDS, lines, ways, waysOf, type Line, type Way } from "./lines";
import { steadyFuel, steadySite } from "./steady";
import { cementBreak, cementServed } from "@engine/game/cement";
import { steelBreak, steelDemand, steelImports, steelServed } from "@engine/game/steel";
import { goodsOnTheWay, haulBreak, longHaul } from "@engine/game/haulage";
import { stationOf, stationOpen } from "@engine/game/stations";
import { handoverNote, termLetter, type Letter } from "./correspondent";
import { thenAndNowSvg } from "./thenandnow";
import { railPath } from "@engine/game/rail";
import { STATION_OFFER_PER_DAY, hasBusStation, stationBoard } from "@engine/game/busstations";
import { NO_SEAT_MIN_PER_DAY, airportAdvice, corridorNoSeat, townNoSeat, shrinkCause, whereNext, wornRoadAt, type NamedMove, type Opening } from "@engine/game/problems";
import type { RunDay, RunRecorder } from "@engine/game/runlog";
import type { GameEvent } from "@engine/game/settlement";
import { assemblyGeneration } from "@engine/game/assembly";
import { siteChain, siteProduction } from "@engine/game/production";

// The information lab's three layers (agreed 2026-10-23; the lab since discarded), on the live game:
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

export type Selection = { kind: "town" | "route" | "site" | "segment" | "pipe"; id: string } | null;

export interface ScreenHooks {
  /** The old town or site card, whole. */
  townMore(id: string): string;
  /** The old route card. */
  routeMore(id: string): string;
  /** Under the network: the developer's forecasts and receipts, when they're on. */
  routesMore(): string;
  /** A goods line's reason and its freight rate, for its card. */
  goodsWhy(id: string): string;
  /** A rail line's cars (main.ts carsRow): how many a train, and a carriage or wagon more; "" off rail. */
  cars(id: string): string;
  /** The debt advice when you're in debt: shown over the routes list, not folded. */
  moneyNote(): string;
  /** The old Treasury drawer: bonds, chains, the named project, the budget lines. */
  treasuryMore(): string;
  /** Current chain state, for the Revenue screen's opening empty state. */
  chainsSummary(): string;
  /** A bond for a restore, when you can't pay for it (main.ts bondButton); "" when none's on offer. */
  bond(purpose: "works" | "refinery" | "steel"): string;
  /** The page is in dev mode (?dev=1): the term stat names the design console's key. */
  dev: boolean;
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
  const verdictEl = document.querySelector<HTMLElement>("#verdict")!;
  const tip = document.querySelector<HTMLDivElement>("#tip")!;

  let selected: Selection = null;
  /** Picked by pointing at it on the map (not a click): shown, but the map isn't faded for it. */
  let selectedFromMap = false;
  /** A row hovered in the panel or the log: the map fades the rest (focus). */
  let hover: Selection = null;
  type Tab = "network" | "towns" | "sites";
  let tab: Tab = "network";
  const sorts: Record<string, { key: string; dir: 1 | -1 }> = {
    network: { key: "net", dir: 1 }, towns: { key: "pop", dir: -1 }, sites: { key: "use", dir: 1 }, revenue: { key: "net", dir: 1 },
  };
  const TABS: Tab[] = ["network", "towns", "sites"];
  const TAB_NAME: Record<Tab, string> = { network: "Network", towns: "Towns", sites: "Sites" };
  let logFilter = "all";
  let range = 0; // the revenue screen: 0 = all days
  /** Which "More" folds are open, by key: kept across the panel's redraws. */
  const openFolds = new Set<string>();
  /**
   * The moves the panel's problem lines offer, by their action: a click does the one it names.
   * Not by position in a list remade each redraw: a panel held under the pointer (patch.ts)
   * shows the last redraw's buttons, and the one pressed must still buy what it says.
   */
  const named = new Map<string, NamedMove>();

  const days = (): RunDay[] => recorder.file.days;
  const nameOf = (id: string) => world.towns.get(id)?.name ?? world.ruins.get(id)?.name ?? id;
  // Yours to name and colour (labels.ts): the name you gave it, else its towns.
  const routeName = (r: { id?: string; a: string; b: string }) => (r.id && labelOf(world, routeLabelKey(r.id))?.name) || `${nameOf(r.a)} ↔ ${nameOf(r.b)}`;
  const swatchOf = (r: { id: string; kind: string }) => labelOf(world, routeLabelKey(r.id))?.colour ?? `var(${KIND_COLOR[r.kind] ?? "--you"})`;
  /** The route or road being named, its field open in the panel. */
  let renaming: string | null = null;
  /** A name, and for a route its colour: the field while naming, else a button and the swatches. */
  // A rail line's trains lengthened (main.ts carsRow, rail.ts addCar), under its vehicles.
  function carsHtml(id: string): string {
    const cars = hooks.cars(id);
    return cars ? `<p class="why">${cars}</p>` : "";
  }

  function nameRow(key: string, colours: boolean): string {
    const label = labelOf(world, key);
    if (renaming === key) {
      return `<div class="namerow"><input class="namein" data-name-input="${esc(key)}" maxlength="32" placeholder="A name" value="${esc(label?.name ?? "")}"> <span class="muted">Enter to keep · Esc</span></div>`;
    }
    const swatches = colours ? LINE_COLOURS.map((c) => `<button class="sw${label?.colour === c ? " on" : ""}" data-colour="${esc(key)}|${c}" style="background:${c}" title="Its colour on the map"></button>`).join("") : "";
    return `<div class="namerow"><button data-rename="${esc(key)}">${label?.name ? "Rename" : "Name it"}</button>${swatches}</div>`;
  }
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
      fuel: steadyFuel(world, id)?.supplied ?? null, cement: world.cement ? cementServed(world, id) : null, steel: world.steel ? steelServed(world, id) : null,
      roadFull: full && full.road ? { next: full.next, thin: !!full.thin } : null,
    };
  }
  type Town = ReturnType<typeof town>;
  const homeTowns = () => [...world.towns.keys()].filter((id) => !world.towns.get(id)!.industry).map(town);

  function site(id: string) {
    const p = steadySite(world, id);
    return { id, product: p?.product ?? null, made: p ? p.made * D : 0, capacity: p ? p.capacity * D : 0, limit: p?.limit ?? null, staffing: p?.staffing ?? null, shipped: p?.shipped ?? null };
  }
  type Site = ReturnType<typeof site>;

  /** A town's union: its chairman, how he stands with you, and what he last remembers (union.ts). */
  function unionHtml(townId: string): string {
    const union = unionOf(world, townId);
    if (!union) return "";
    const last = union.memory.at(-1);
    const mood = stanceWord(union.stance);
    return `<p class="muted">Union: <b>${esc(union.chairman)}</b>, ${mood}${last ? `. He remembers ${esc(last.text)} (day ${last.day})` : ""}.</p>`;
  }

  /** A far cluster's regional town: what the cluster offers your chains, and how much reaches you (clusters.ts). */
  function offerHtml(townId: string): string {
    const cluster = clusterOf(world, townId);
    if (!cluster || cluster.hub !== townId) return "";
    const offer = clusterOfferShare(world, cluster);
    if (!offer) return "";
    if (cluster.offer === "limestone" && world.cement && !world.cement.working) {
      return `<div class="problem"><span>This cluster offers limestone for your cement works, from ${esc(nameOf(`field-${cluster.hub}`))}: twice a quarry's, and it never works out. Your works is idle: restore it, and the field's limestone wants carrying here.</span></div>`;
    }
    const what = cluster.offer === "limestone"
      ? `limestone for your cement works: ${int(offer.perDay)} t a day from ${esc(nameOf(`field-${cluster.hub}`))}`
      : `its farm belt's staple for your mill: ${int(offer.perDay)} t a day from ${cluster.towns.length} towns`;
    return `<div class="problem ${offer.share >= 0.5 ? "none" : ""}"><span>This cluster offers ${what}. ${pct(offer.share)} reaches you${offer.share < 0.5 ? ": it's past the hauliers' reach. A yard here, a long road or rail brings it" : ""}.</span></div>`;
  }

  /**
   * The site see-through (seethrough.ts): its inputs, the plant and its shift, a lane to each
   * town it sends to, from the numbers the panel already shows -- and, in a line, what's stuck.
   */
  function seeThrough(id: string, out: Array<{ to: string; perDay: number; yours: number; hauliers: number }>, inn: Array<{ from: string }>): string {
    const p = steadySite(world, id);
    const t = world.towns.get(id)!;
    if (!p || p.capacity <= 0) return "";
    const fuelSite = t.industry === "refinery" || t.industry === "newrefinery" || t.industry === "depot";
    const reach = fuelSite ? fuelReach(world, id) : Math.max(world.tuning.truckerMaxHaulCells, hasYard(world, id) ? world.tuning.yardReachCells : 0);
    const outputs = out.map((f) => {
      const carried = Math.min(1, (f.yours + f.hauliers) / Math.max(1e-6, f.perDay));
      const road = roadPath(world, id, f.to);
      const rail = railPath(world, id, f.to);
      const past = (road?.distance ?? Infinity) > reach && !rail;
      const state: "moving" | "waiting" | "far" | "long" | "noroad" = carried >= 0.3 ? "moving" : !road && !rail ? "noroad" : past && longHaul(world, id, f.to, "supplies") ? "long" : past ? "far" : "waiting";
      return { to: nameOf(f.to), perDay: f.perDay, carried, state };
    }).sort((a, b) => b.perDay - a.perDay);
    const source = inn[0] ? nameOf(inn[0].from) : "";
    const inputs = p.inputs.map((input) => ({ name: input.name, from: source, share: input.needed > 0 ? Math.min(1, input.arriving / input.needed) : 1 }));
    const names = (list: typeof outputs) => list.slice(0, 3).map((o) => o.to).join(", ") + (list.length > 3 ? ` and ${list.length - 3} more` : "");
    const far = outputs.filter((o) => o.state === "far");
    const noRoad = outputs.filter((o) => o.state === "noroad");
    const waiting = outputs.filter((o) => o.state === "waiting");
    const long = outputs.filter((o) => o.state === "long");
    const stuck = p.limit === "idle" ? "Idle: restore it, and it starts."
      : p.limit === "input" && inputs[0] ? `Short of ${inputs[0].name}: ${pct(inputs[0].share)} of what it can use arrives${source ? ` from ${source}` : ""}.`
      : p.limit === "workers" ? `Short-staffed: ${pct(p.staffing ?? 0)} of a shift gets here. A bus for its workers.`
      : far.length ? `${names(far)}: past the ${fuelSite ? "tankers'" : "hauliers'"} reach (${Math.round(reach)} cells by road). Only a freight train gets it there.`
      : long.length ? `${names(long)}: a long haul by road, past the hauliers' reach (${Math.round(reach)} cells): they take a little of it. A freight train takes the rest.`
      : noRoad.length ? `No road to ${names(noRoad)}.`
      : waiting.length ? `${names(waiting)}: its ${p.product} waits for hauliers.` : "";
    const data: FigureData = {
      product: p.product, running: p.capacity > 0 ? Math.min(1, p.made / p.capacity) : 0, madePerDay: p.made * D,
      staffing: p.staffing, limit: p.limit, inputs, outputs: outputs.map((o) => ({ ...o, state: o.state === "long" ? "waiting" as const : o.state })), stuck, kind: fuelSite ? "refinery" : "works",
    };
    return siteFigure(data, performance.now());
  }
  const sites = () => [...world.towns.values()].filter((t) => t.industry).map((t) => site(t.id));

  // --- Problems: one line each, and the move that answers it -------------------------

  type Problem = { text: string; button: string } | null;
  /** A real move (problems.ts) as a button the panel's click handler does. */
  const moveButton = (move: NamedMove | undefined, fallback: string): string => {
    if (!move) return fallback;
    const key = JSON.stringify(move.action);
    named.delete(key);
    named.set(key, move);
    if (named.size > 200) named.delete(named.keys().next().value!);
    return `<button data-named="${esc(key)}" title="${esc(move.label)}">${esc(move.label.replace(/\s*\([^)]*\)$/, ""))} · ${nairaK(move.price)}</button>`;
  };
  /** A tool's button; `at`, the places it's about, which the map frames and rings when it's pressed (main.ts pointAt). */
  // Its key in a <kbd> (look.md §5), the rest of the label escaped.
  const toolButton = (tool: string, label: string, at: string[] = []) => `<button data-tool="${tool}"${at.length > 0 ? ` data-at="${esc(at.join(","))}"` : ""}>${esc(label).replace(/&lt;kbd&gt;(.*?)&lt;\/kbd&gt;/g, "<kbd>$1</kbd>")}</button>`;

  /**
   * Why goods from `from` aren't reaching a town, and the move that answers it (haulage.ts
   * haulBreak) -- never a yard that's already built (map 949: "Yard at the works" offered for
   * 170 days at a works with a yard, its cement unable to reach 17 towns past any yard's reach).
   */
  function carryWhy(what: string, from: string, townId: string): { why: string; button: string; at: string[] } {
    const to = nameOf(townId);
    const b = haulBreak(world, from, townId);
    if (b?.kind === "road") return { why: `no road joins ${to} to ${nameOf(from)}`, button: toolButton("road", "Road <kbd>R</kbd>", [townId]), at: [townId] };
    if (b?.kind === "gap" && b.yardAt) return { why: `hauliers can't get ${what} as far as ${to}; a yard at ${nameOf(b.yardAt)} would carry it on`, button: toolButton("yard", `Yard at ${nameOf(b.yardAt)} <kbd>Y</kbd>`, [b.yardAt, townId]), at: [b.yardAt, townId] };
    if (b?.kind === "gap") return { why: `hauliers can't get ${what} as far as ${to}, even from your yards; freight track can`, button: toolButton("track", "Track <kbd>K</kbd>", [from, townId]), at: [from, townId] };
    if (!hasYard(world, from)) return { why: `it isn't reaching ${to} from ${nameOf(from)}`, button: toolButton("yard", `Yard at ${nameOf(from)} <kbd>Y</kbd>`, [from]), at: [from] };
    if (b?.kind === "legs" && b.legs >= 3) return { why: `it reaches ${to} in ${b.legs} legs by road, slowly; freight track is quicker`, button: toolButton("track", "Track <kbd>K</kbd>", [from, townId]), at: [from, townId] };
    return { why: `it's on its way to ${to} by road, slower than ${to} grows; freight track is quicker`, button: toolButton("track", "Track <kbd>K</kbd>", [from, townId]), at: [from, townId] };
  }
  /**
   * Its cement, steel and fuel on their way (haulage.ts goodsOnTheWay): hauled in legs, the
   * goods were invisible between the source and the town -- "they don't get there" (map 949).
   */
  function onTheWayHtml(townId: string): string {
    const parts = goodsOnTheWay(world, townId).filter((x) => x.tonnes >= 1).map((x) => {
      const legs = x.legs && x.legs > 1 ? `, ${x.legs} legs` : "";
      const at = x.waitingAt.length > 0 ? `, waiting at ${x.waitingAt.slice(0, 2).map(nameOf).join(" and ")}` : "";
      return `${int(x.tonnes)} t of ${esc(cargoName(world, x.origin, "supplies"))} from ${esc(nameOf(x.origin))}${legs}${at}`;
    });
    return parts.length > 0 ? `<p class="onway"><b>On the way:</b> ${parts.join(" · ")}</p>` : "";
  }

  const mostHeld = (towns: Town[], by: (t: Town) => number) => [...towns].sort((p, q) => by(q) - by(p))[0]!;

  /** The port lands too little steel for what the towns want (steel.ts steelImports): its next rung, if it has one. */
  function steelPortShort(): { text: string; button: string } | null {
    const steel = world.steel;
    if (!steel?.terminalId || steel.worksId) return null;
    const wanted = homeTowns().reduce((sum, t) => sum + steelDemand(world, t.id), 0);
    const landed = steelImports(world);
    const next = nextPortRung(world);
    if (wanted <= 0 || landed >= 0.9 * wanted || !next) return null;
    return { text: `the port lands ${int(landed * D)} t of steel a day for the ${int(wanted * D)} t the towns want; ${next.name} would land ${int((landed * D * next.scale) / portScale(world))} t`, button: `<button data-upgrade-port="1">Build ${esc(next.name)} · ${nairaK(next.price)}</button>` };
  }

  /** A restore as a real button, with the bond beside it when you're short (the cement works' was under More). */
  function restoreButton(what: "works" | "refinery" | "steel"): string {
    const t = world.tuning;
    const cost = what === "works" ? t.worksRestoreCost : what === "refinery" ? t.refineryRestoreCost : t.steelRestoreCost;
    const name = what === "works" ? "the cement works" : what === "refinery" ? "the refinery" : "the steel works";
    return `<button data-restore-${what}="1">Restore ${name} · ${nairaK(cost)}</button>${world.economy.funds < cost ? hooks.bond(what) : ""}`;
  }
  /** The works makes all it can (cement.ts cementBreak "capacity"): what it makes against what's wanted, and its expansion. */
  function worksFull(b: { made: number; wanted: number; expandCost: number | null }): { why: string; button: string } {
    const works = nameOf(world.cement!.worksId);
    const why = `${works} makes all it can: ${int(b.made * D)} t a day with imports, of ${int(b.wanted * D)} wanted`;
    const button = b.expandCost === null ? `<span class="muted">Expanded as far as it goes</span>`
      : `<button data-expand="${world.cement!.worksId}">Expand ${esc(works)} · ${nairaK(b.expandCost)}</button>`;
    return { why, button };
  }

  // --- Waiting on you (brief, Revision 5, step 1) --------------------------------------
  // Every move with a consequence, pinned at the top of the panel: the chain breaks that hold
  // towns back, each with the move that answers it. Only these get the map's amber mark --
  // on every town from day 1, it meant nothing, and the one that mattered (an idle cement
  // works, its restore under More) went unseen for 482 days. Pledges and the union's demands
  // join this list (steps 2 and 5).

  /** `id`: what it is about, kept as its words and numbers move ("cement", "union:home"). */
  type Waiting = { id: string; text: string; button: string; at: string[]; weight: number };
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  function waitingOnYou(): Waiting[] {
    const items: Waiting[] = [];
    // Only towns in your remit (remit.ts): a closed cluster's shortages aren't yours to answer yet.
    const towns = homeTowns().filter((t) => inRemit(world, t.id));
    const held = (by: (t: Town) => number) => {
      const hit = towns.filter((t) => by(t) >= Math.max(5, 0.05 * t.population));
      return { towns: hit, people: hit.reduce((sum, t) => sum + by(t), 0) };
    };
    const cement = held((t) => t.cementHeld);
    if (world.cement && cement.towns.length > 0) {
      const b = cementBreak(world);
      const who = `${int(cement.people)}k people held back in ${plural(cement.towns.length, "town")}`;
      if (b?.kind === "idle") items.push({ id: "cement", text: `The cement works is idle: ${who}`, button: restoreButton("works"), at: [world.cement.worksId], weight: cement.people });
      else if (b?.kind === "quarry") items.push({ id: "cement", text: `Cement short, ${who}: ${nameOf(b.quarryId)}'s limestone isn't reaching the works`, button: toolButton("yard", `Yard at ${nameOf(b.quarryId)} <kbd>Y</kbd>`), at: [b.quarryId], weight: cement.people });
      else if (b?.kind === "capacity") {
        const f = worksFull(b);
        items.push({ id: "cement", text: `Cement short, ${who}: ${f.why}`, button: f.button, at: [world.cement.worksId], weight: cement.people });
      }
      else if (b?.kind === "carry") {
        const c = carryWhy("cement", world.cement.worksId, mostHeld(cement.towns, (t) => t.cementHeld).id);
        items.push({ id: "cement", text: `Cement short, ${who}: ${c.why}`, button: c.button, at: c.at, weight: cement.people });
      }
    }
    const steel = held((t) => t.steelHeld);
    if (world.steel && steel.towns.length > 0) {
      const b = steelBreak(world);
      const who = `${int(steel.people)}k people held back in ${plural(steel.towns.length, "town")}`;
      const works = world.steel.worksId ?? world.steel.terminalId;
      if (b?.kind === "idle") items.push({ id: "steel", text: `The steel works is idle: ${who}`, button: restoreButton("steel"), at: works ? [works] : [], weight: steel.people });
      else if (b?.kind === "ore") items.push({ id: "steel", text: `Steel short, ${who}: ${nameOf(b.mineId)}'s ore isn't reaching the works`, button: toolButton("yard", `Yard at ${nameOf(b.mineId)} <kbd>Y</kbd>`), at: [b.mineId], weight: steel.people });
      else if (b?.kind === "carry") {
        const port = steelPortShort();
        const c = carryWhy("steel", b.from, mostHeld(steel.towns, (t) => t.steelHeld).id);
        items.push(port ? { id: "steel", text: `Steel short, ${who}: ${port.text}`, button: port.button, at: [b.from], weight: steel.people } : { id: "steel", text: `Steel short, ${who}: ${c.why}`, button: c.button, at: c.at, weight: steel.people });
      }
    }
    // Short by the network, not by this week's tankers (fuel.ts fuelPlanned): just after the
    // warm-up, towns planned full read short, and the idle refinery was named for them.
    const fuelShort = towns.filter((t) => t.fuel !== null && t.fuel < 0.6 && (fuelPlanned(world, t.id) ?? 1) < 0.6 && fuelReachable(world, t.id));
    if (world.fuel && fuelShort.length > 0) {
      // Weighed as the people living short of fuel, by how short.
      const weight = fuelShort.reduce((sum, t) => sum + t.population * (1 - (t.fuel ?? 0)), 0) * 0.3;
      const where = `${plural(fuelShort.length, "town")} short of fuel`;
      if (!world.fuel.restored) items.push({ id: "fuel", text: `${where}, and the refinery is idle`, button: restoreButton("refinery"), at: [world.fuel.refineryId], weight });
      else {
        // Restored but starved of crude: crude moves by road only from a source with a yard (truckers.ts).
        const refinery = site(world.fuel.refineryId);
        const source = world.fuel.sourceId;
        if (refinery.capacity > 0 && refinery.made < 0.6 * refinery.capacity && refinery.limit === "input" && !world.yards.has(source)) {
          items.push({ id: "fuel", text: `${where}: the refinery gets no crude from ${nameOf(source)}`, button: toolButton("yard", `Yard at ${nameOf(source)} <kbd>Y</kbd>`), at: [source], weight });
        } else items.push({ id: "fuel", text: `${where}: the tank farm's fuel isn't reaching them`, button: toolButton("yard", "Yard at the tank farm <kbd>Y</kbd>"), at: [world.fuel.depotId], weight });
      }
    }
    // In debt, or losing money: what's draining it, by name (a game ran to −₦71k with 17 roads'
    // upkeep, a bond and five losing routes never pointed at). After the pledges, before the rest.
    const net = averageNet(world);
    if (world.economy.funds < 0 || net < 0) {
      const last = (key: string) => dailyBudget(key).at(-1) ?? 0;
      // Every line losing money, goods lines too (lines.ts).
      const losing = linesNow().filter((l) => l.netPerDay < 0);
      const drains = [
        last("upkeep") >= 1 ? `road upkeep ${naira(last("upkeep"))}` : "",
        losing.length ? `${plural(losing.length, "line")} losing ${naira(-losing.reduce((sum, l) => sum + l.netPerDay, 0))}` : "",
        last("bonds") >= 1 ? `bond repayments ${naira(last("bonds"))}` : "",
      ].filter(Boolean);
      const where = world.economy.funds < 0 ? `In debt: ${nairaK(world.economy.funds)}` : "Losing money";
      const flow = net < 0 ? `, ${naira(-net)} a day more out than in` : "";
      const buttons = (losing.length ? `<button data-tab="routes" title="Your lines, the worst first">Losing lines</button>` : "") + (last("upkeep") >= 1 ? toolButton("fix", "Road upkeep <kbd>F</kbd>") : "");
      items.push({ id: "money", text: `${where}${flow}${drains.length ? `. A day: ${drains.join(" · ")}` : ""}`, button: buttons, at: [], weight: world.economy.funds < 0 ? 1e8 : 1e6 });
    }
    // Pledges left to make this term: the strip alone was missed (a game ran 115 days with none).
    const term = world.term;
    const left = term ? MAX_COMMITTED - term.pledges.filter((p) => p.committed).length : 0;
    if (term && left > 0 && term.pledges.some((p) => !p.committed)) {
      items.push({ id: "pledges", text: `Term ${term.number}: ${left === MAX_COMMITTED ? "you've made no pledges" : "one more pledge to make"}. Keep none and it's a failed term.`, button: `<button class="primary" data-verdict="pledges">Choose your pledges</button>`, at: [], weight: 5e7 });
    }
    // The rains (floods.ts): the fords named for this season, and those under water now.
    const floods = world.floods;
    if (floods && (floods.phase === "warned" || floods.phase === "flood")) {
      for (const id of floods.phase === "warned" ? floods.coming : floods.under) {
        const ford = fordById(world, id);
        if (!ford || ford.bridged) continue;
        const when = floods.phase === "warned" ? `floods on day ${gameDay(world, floods.riseAt) - 1}, for ${Math.round((floods.fallAt - floods.riseAt) / D)} days` : `is under water until day ${gameDay(world, floods.fallAt) - 1}`;
        const named = [ford.a, ford.b].find((id) => ford.name.startsWith(nameOf(id)));
        const road = named ? `the road to ${nameOf(named === ford.a ? ford.b : ford.a)}` : `the ${nameOf(ford.a)} – ${nameOf(ford.b)} road`;
        items.push({ id: `ford:${ford.id}`, text: `${ford.name} ${when}: everything on ${road} waits at the bank`, button: `<button data-ford="${ford.id}">Raise a bridge · ${nairaK(fordBridgeCost(world, ford))}</button>`, at: [ford.a, ford.b], weight: 8e7 });
      }
    }
    // Your remit (remit.ts): a verdict's opening, the clusters on offer, each with what it brings.
    const offers = remitOffers(world);
    if (offers.length > 0) {
      const buttons = offers.map((c) => `<button data-open-cluster="${esc(c.hub)}" title="${esc(clusterBrings(world, c).join(", "))}">Open ${esc(nameOf(c.hub))}'s cluster</button>`).join("");
      const what = offers.map((c) => `${nameOf(c.hub)}'s brings ${clusterBrings(world, c).join(", ")}`).join("; ");
      items.push({ id: "remit", text: `The state extends your remit: choose a cluster to open. ${what}`, button: buttons, at: offers.map((c) => c.hub), weight: 9.5e7 });
    }
    // The unions' demands (union.ts): who's asking, how he stands, his words, the deadline, and your answers.
    for (const union of world.unions ?? []) {
      const d = union.demand;
      if (!d) continue;
      const where = union.id === "home" ? "your home cluster's" : `${nameOf(union.id)}'s`;
      const buttons = [
        `<button data-union="${union.id}|pay">Pay his members · ${nairaK(d.price)}</button>`,
        d.kind === "lane" && world.lanes.some((l) => (l.a === d.a && l.b === d.b) || (l.a === d.b && l.b === d.a)) ? `<button data-union="${union.id}|concede">Ease the lane</button>` : "",
        d.kind === "pipeline" && world.pipelines?.some((p) => p.a === d.a && p.b === d.b && p.dial > 0) ? `<button data-union="${union.id}|concede">Turn the pipe down to ${pct(Math.floor((world.pipelines.find((p) => p.a === d.a && p.b === d.b)?.dial ?? 0) * 5) / 10)}</button>` : "",
        d.kind === "trunk" ? `<button data-union="${union.id}|concede">Make it a feeder again</button>` : "",
        d.kind !== "trunk" && d.kind !== "pipeline" && routeAlong(world, d.a, d.b) ? `<button data-union="${union.id}|coop">Hand him the route</button>` : "",
        `<button data-union="${union.id}|refuse">Refuse</button>`,
      ].join("");
      items.push({ id: `union:${union.id}`, text: `${union.chairman}, ${where} union (${stanceWord(union.stance)}): "${d.text}" By day ${gameDay(world, d.deadlineAt) - 1}, or he strikes.`, button: buttons, at: [d.a], weight: 9e7 });
    }
    // The airport's travellers stranded (airport.ts): demand at a point with no people, there to be reached.
    // Split by why (problems.ts airportAdvice): no way on, or no seat on lines that lose -- and the move for that.
    const stranded = airportStranded(world);
    const advice = world.airport && stranded >= 50 ? airportAdvice(world) : null;
    if (world.airport && advice) items.push({ id: "airport", text: `${int(stranded)} travellers a day to or from ${nameOf(world.airport)} aren't carried: ${advice.why}.`, button: `${advice.move && Number.isFinite(advice.move.price) ? moveButton(advice.move, "") : ""}<button data-pick="site|${world.airport}">Its card</button>`, at: [world.airport], weight: 2e6 + stranded });
    // Riders giving up changing lines at a town with no station of yours (busstations.ts): the worst two.
    if (world.tuning.busStationsEnabled) {
      // From the rolling rate alone (a board diagnoses every line through a town: only for the two shown).
      const hubs = [...(world.changeGiveUpEMA ?? new Map<string, number>())]
        .filter(([id, rate]) => rate * D >= STATION_OFFER_PER_DAY && world.towns.has(id) && !world.towns.get(id)!.industry && !hasBusStation(world, id))
        .sort((p, q) => q[1] - p[1])
        .slice(0, 2)
        .map(([id, rate]) => ({ id, board: { givingUpPerDay: rate * D, changingPerDay: (world.transferRateEMA.get(id) ?? 0) * D } }));
      for (const h of hubs) items.push({ id: `station:${h.id}`, text: `${int(h.board!.givingUpPerDay)} a day give up changing lines at ${nameOf(h.id)}, with nowhere to wait (${int(h.board!.changingPerDay)} change there).`, button: `${moveButton(stationMove(h.id), "")}<button data-pick="town|${h.id}">Show ${esc(nameOf(h.id))}</button>`, at: [h.id], weight: 2e6 + h.board!.givingUpPerDay });
    }
    // A pipeline shut by a strike or a tap (pipelines.ts): its fuel back on its tankers, as many as its dial kept.
    for (const p of pipeSummaries(world)) {
      if (!p.working || !p.outReason) continue;
      items.push({ id: `pipe:${p.id}`, text: `Your pipeline ${p.name} is shut by ${p.outReason === "tap" ? "a tap" : "a strike"}, back in ${plural(p.backInDays, "day")}: its fuel waits on tankers, ${pct(p.tankers)} of a fleet for it.`, button: `<button data-pick="pipe|${p.id}">Its card</button>`, at: [p.b], weight: 8.5e7 });
    }
    // Your pledges this term, not yet kept: first, with the town (its panel has the move).
    for (const p of world.term?.pledges ?? []) {
      if (!p.committed || p.kept) continue;
      const kind = world.towns.get(p.townId)?.industry ? "site" : "town";
      // The move that answers it, bought from here (C29), with a bond beside a restore you can't pay for.
      const move = pledgeMove(world, p);
      const restore = move?.action.kind === "restoreRefinery" ? "refinery" : move?.action.kind === "restoreWorks" ? "works" : null;
      const bond = restore && move && world.economy.funds < move.price ? hooks.bond(restore) : "";
      items.push({ id: `pledge:${p.id}`, text: `Your pledge: ${pledgeLine(p)} · ${pct(pledgeProgress(world, p))} of the way`, button: `${moveButton(move ?? undefined, "")}${bond}<button data-pick="${kind}|${esc(p.townId)}">Show ${esc(nameOf(p.townId))}</button>`, at: [p.townId], weight: Infinity });
    }
    return items.sort((p, q) => q.weight - p.weight);
  }
  // The five shown hold still through a game day. Ranked afresh every redraw, they swapped
  // places and came and went as their weights crossed and their lines were crossed (2026-11-02,
  // map 2418 at 4x: "Restore the refinery" in and out, everything under it moving with it). Now
  // they're ranked as a day begins or when you make a move; between, each keeps its place with
  // its words kept up to date, one gone stays till the next ranking, and a new one joins at the
  // foot while there's room.
  let waitingRanked = "";
  let waitingShown: Waiting[] = [];
  function steadyWaiting(): Waiting[] {
    const all = waitingOnYou();
    const at = `${gameDay(world)}|${recorder.file.actions.length}`;
    if (at !== waitingRanked) {
      waitingRanked = at;
      return (waitingShown = all.slice(0, 5));
    }
    const now = new Map(all.map((item) => [item.id, item]));
    const kept = waitingShown.map((item) => now.get(item.id) ?? item);
    for (const item of all) if (kept.length < 5 && !kept.some((k) => k.id === item.id)) kept.push(item);
    return (waitingShown = kept);
  }
  // When each waiting item was first seen, by what it's about. Map 949's steel card stood ~120
  // days and nothing said so. Dropped when it goes; back, it starts again.
  const waitingSince = new Map<string, number>();
  function waitingHtml(): string {
    const items = steadyWaiting();
    const today = gameDay(world);
    const ids = new Set(items.map((item) => item.id));
    for (const id of [...waitingSince.keys()]) if (!ids.has(id)) waitingSince.delete(id);
    for (const id of ids) if (!waitingSince.has(id)) waitingSince.set(id, today);
    if (items.length === 0) return "";
    const age = (item: Waiting) => {
      const days = today - (waitingSince.get(item.id) ?? today);
      return days >= 10 ? ` <span class="age">· ${days} days now</span>` : "";
    };
    return `<div class="pane waiting"><h2>Waiting on you · ${items.length}</h2>${items.map((item) => `<div class="problem"${item.at.length > 0 ? ` data-at="${esc(item.at.join(","))}"` : ""}><span>${esc(item.text)}${age(item)}</span>${item.button}</div>`).join("")}</div>`;
  }

  // --- Where next (brief, Where next; map 8703: "difficult knowing what to connect") ---------
  // The towns in your remit with the most people to gain, each with what's in the way and its
  // move (problems.ts whereNext). Ranked as a day begins or when you make a move, as Waiting on
  // you is: whereNext walks every pair's outcomes, and a list that reshuffled under the pointer
  // couldn't be clicked.
  let nextRanked = "";
  let nextShown: Opening[] = [];
  function whereNextHtml(): string {
    const at = `${gameDay(world)}|${recorder.file.actions.length}`;
    if (at !== nextRanked) {
      nextRanked = at;
      nextShown = whereNext(world, (id) => inRemit(world, id)).slice(0, 4);
    }
    if (nextShown.length === 0) return "";
    const rows = nextShown.map((o) => {
      const name = nameOf(o.townId);
      const show = `<button data-pick="town|${esc(o.townId)}">Show ${esc(name)}</button>`;
      const move = !o.move ? toolButton("road", "Road <kbd>R</kbd>", [o.townId])
        : Number.isFinite(o.move.price) ? moveButton(o.move, "")
        : `<span class="muted">${esc(o.move.label)}</span>`;
      return `<div class="problem" data-at="${esc(o.townId)}"><span><b>${esc(name)}</b> · +${int(o.people)}k: ${esc(o.why.replace(/(; (served|carrying more)[^;]*|,? room for \+\d+k|: [^:]* makes room for \+\d+k)$/, ""))}</span>${move}${show}</div>`;
    });
    return `<div class="pane waiting where-next"><h2>Where next · people to gain</h2>${rows.join("")}</div>`;
  }

  // Your bus station (busstations.ts; brief, Your bus station): riders changing lines there, and
  // those giving up changing; without one, the offer where enough change to matter.
  function stationHtml(townId: string): string {
    if (!world.tuning.busStationsEnabled) return "";
    const board = stationBoard(world, townId);
    if (hasBusStation(world, townId)) {
      const depot = board?.lines.filter((l) => l.ends).length ?? 0;
      return `<h2>Your bus station</h2><div class="tiles">
        ${tile("Change lines here", `${int(board?.changingPerDay ?? 0)}/day`, `${world.tuning.busStationPatience ?? 1}x as patient under cover`)}
        ${tile("Give up changing", `${int(board?.givingUpPerDay ?? 0)}/day`)}
        ${tile("Its depot", plural(depot, "line"), `ending here pay ${pct(world.tuning.busStationDepotShare ?? 0)} less for rough roads`)}
      </div>`;
    }
    if (!board || board.givingUpPerDay < STATION_OFFER_PER_DAY) return "";
    const move = stationMove(townId);
    return `<div class="problem"><span>${int(board.givingUpPerDay)} a day give up changing lines here, with nowhere to wait (${int(board.changingPerDay)} change)</span>${moveButton(move, "")}</div>`;
  }
  function stationMove(townId: string): NamedMove {
    return { action: { kind: "busStation", townId }, price: world.tuning.busStationCost ?? 0, label: `A bus station at ${nameOf(townId)} (S)` };
  }
  // A line on a town's card; with your station there, the board's row: its problem, and Sell where it loses.
  function boardRow(townId: string, r: ReturnType<typeof routes>[number]): string {
    const station = hasBusStation(world, townId);
    const verdict = station ? diagnoseRoute(world, r.id)?.verdict : undefined;
    const word = verdict && verdict !== "healthy" ? ` <span class="warnword">${esc(VERDICT_WORDS[verdict] ?? verdict)}</span>` : "";
    const sell = station && r.netPerDay < 0 ? `<button data-remove="${esc(r.id)}" title="Sell one of its vehicles">Sell one</button>` : "";
    return `<tr class="row" data-pick="route|${r.id}"><td><span class="swatch" style="background:${swatchOf(r)}"></span>${esc(routeName(r))}${word}</td><td>${int(r.ridersPerDay)}/day</td><td class="${r.netPerDay < 0 ? "down" : ""}">${naira(r.netPerDay)}</td>${station ? `<td>${sell}</td>` : ""}</tr>`;
  }
  function townProblem(t: Town): Problem {
    // Outside your remit (remit.ts): running without you until a verdict opens its cluster.
    const closed = closedClusterOf(world, t.id);
    if (closed) return { text: `Outside your remit: ${nameOf(closed.hub)}'s cluster opens at a term's verdict that keeps its pledges`, button: "" };
    if (t.industry) return null;
    if (t.roadFull && !t.roadFull.thin) {
      const next = t.roadFull.next;
      return { text: "Can't grow: its road is full", button: next === "rail" ? toolButton("track", "Track <kbd>K</kbd>") : toolButton("road", next === "paved" ? "Pave its road <kbd>R</kbd>" : "A bus lane <kbd>R</kbd>") };
    }
    // Losing people comes first: a town short of cement that is shrinking is shrinking for
    // another reason (map 8703, day 400: Eligo's card said cement while your share fell 48% -> 36%).
    const shrink = shrinkCause(world, t.id);
    if (shrink) return { text: `Shrinking: ${shrink.why}`, button: moveButton(shrink.move ?? undefined, "") };
    // Cement past its first 40%: a problem only when it costs the town 5% of its size or more.
    if (t.cementHeld >= Math.max(5, 0.05 * t.population)) {
      const b = cementBreak(world);
      const full = b?.kind === "capacity" ? worksFull(b) : null;
      const button = b?.kind === "no-quarry" ? `<span class="muted">Next quarry ~day ${b.nextDay}</span>`
        : b?.kind === "quarry" ? toolButton("yard", `Yard at ${nameOf(b.quarryId)} <kbd>Y</kbd>`)
        : b?.kind === "idle" ? restoreButton("works")
        : full ? full.button
        : carryWhy("cement", world.cement!.worksId, t.id).button;
      return { text: `Short of cement (${pct(t.cement ?? 0)} of what it needs): ${int(t.cementHeld)}k fewer people than your service would grow it to${full ? `. ${full.why}` : ""}`, button };
    }
    // Steel past +80% (steel.ts): the big towns' last growth.
    if (t.steelHeld >= Math.max(5, 0.05 * t.population)) {
      const b = steelBreak(world);
      const button = b?.kind === "idle" ? `<button data-restore-steel="1">Restore the steel works · ${nairaK(world.tuning.steelRestoreCost)}</button>`
        : b?.kind === "ore" ? toolButton("yard", `Yard at ${nameOf(b.mineId)} <kbd>Y</kbd>`)
        : b?.kind === "carry" ? (steelPortShort()?.button ?? carryWhy("steel", b.from, t.id).button)
        : "";
      return { text: `Short of steel (${pct(t.steel ?? 0)} of what it needs): ${int(t.steelHeld)}k fewer people than your service would grow it to`, button };
    }
    // Short by the network and within a source's reach: else a yard at the tank farm does nothing
    // for it (Ota, with no road at all, was sent there).
    if (t.fuel !== null && t.fuel < 0.6 && (fuelPlanned(world, t.id) ?? 1) < 0.6 && fuelReachable(world, t.id)) return { text: `Fuel short: ${pct(t.fuel)} supplied`, button: toolButton("yard", "Yard at the tank farm <kbd>Y</kbd>") };
    const worn = wornRoadAt(world, t.id);
    if (worn) return { text: `Its road ${nameOf(worn.a)}–${nameOf(worn.b)} is worn: ${pct(worn.speed)} speed, ${naira(worn.roughPerDay)}/day more for your vehicles`, button: moveButton(worn.move, "") };
    const seat = townNoSeat(world, t.id);
    if (seat) return { text: `${int(seat.perDay)} a day find no seat, most toward ${nameOf(seat.worst.a === t.id ? seat.worst.b : seat.worst.a)}`, button: moveButton(seat.move, toolButton("bus", "Bus <kbd>B</kbd>")) };
    if (t.expected > 0 && t.share.you < t.expected) return { text: `Expects you to carry ${pct(t.expected)}; you carry ${pct(t.share.you)}`, button: toolButton("bus", "More buses <kbd>B</kbd>") };
    return null;
  }
  function routeProblem(r: Route): Problem {
    const add = `<button data-add="${r.id}">Add one</button>`;
    const sell = r.vehicles > 1 ? `<button data-remove="${r.id}">Sell one</button>` : `<button data-remove="${r.id}">Sell it</button>`;
    switch (r.verdict) {
      case "full": return { text: "Full: riders are left waiting", button: add };
      case "overcapacity": return { text: "More vehicles than riders", button: sell };
      case "thin": return { text: "Too few riders to pay its way", button: sell };
      case "jammed": return { text: "Stuck in traffic", button: toolButton("road", "Pave or a lane <kbd>R</kbd>") };
      case "worn": return { text: "Its road is worn: it costs more to run", button: toolButton("fix", "Keep the road up <kbd>F</kbd>") };
      case "waiting": return r.netPerDay < 0 ? { text: "Riders give up waiting, and it loses money", button: sell } : { text: "Riders give up waiting", button: add };
      default: return r.netPerDay < 0 ? { text: "Loses money", button: sell } : null;
    }
  }
  function siteProblem(s: Site): Problem {
    // The airport (airport.ts): its travellers stranded, and the move -- a line from it to a town.
    if (world.towns.get(s.id)?.industry === "airport") {
      const a = airportSummary(world);
      if (!a || a.stranded < 0.3) return null;
      const advice = airportAdvice(world);
      if (!advice) return null;
      const move = advice.move;
      return { text: `${pct(a.stranded)} of its travellers aren't carried: ${advice.why}${move && !Number.isFinite(move.price) ? `. ${move.label}` : ""}`, button: move && Number.isFinite(move.price) ? moveButton(move, "") : "" };
    }
    if (world.towns.get(s.id)?.industry === "steelworks" && world.steel && !world.steel.working) {
      return { text: "Idle: built, never run. Restore it and its mine starts digging", button: `<button data-restore-steel="1">Restore it · ${nairaK(world.tuning.steelRestoreCost)}</button>` };
    }
    if (world.towns.get(s.id)?.industry === "powerstation" && world.power && !world.power.working) {
      return { text: "Idle: shut down and left. Restore it and the works in its reach make more", button: `<button data-restore-power="1">Restore it · ${nairaK(world.tuning.powerRestoreCost ?? 0)}</button>` };
    }
    if (world.towns.get(s.id)?.industry === "textile" && world.textile && !world.textile.working) {
      return { text: `Idle: run down and shut. Restore it: ${int((world.tuning.jobsTextile ?? 0) * 1000)} jobs, cloth for the markets, the rest exported`, button: `<button data-restore-textile="1">Restore it · ${nairaK(world.tuning.textileRestoreCost ?? 0)}</button>` };
    }
    if (!(s.capacity > 0 && s.made < 0.6 * s.capacity)) return null;
    const button = s.limit === "workers" ? toolButton("bus", "A bus for its workers <kbd>B</kbd>") : s.limit === "input" ? toolButton("yard", "A yard where it comes from <kbd>Y</kbd>") : `<span class="muted">See More</span>`;
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
  /** A pledge's words with where it stands now (live). */
  const pledgeLine = (p: Pledge) => {
    const now = p.kept ? "" : pledgeNow(world, p);
    return `${p.text}${now ? ` (${now})` : ""}`;
  };
  function termHtml(day: number, mapLine: string): string {
    const term = world.term;
    if (!term) return `<div class="stat"><div class="k">Day</div><div class="v num">${day}</div><div class="d muted">${mapLine}</div></div>`;
    const length = world.tuning.termDays ?? 120;
    const termDay = Math.min(length, Math.floor((world.economy.elapsedSeconds - term.startedAtSeconds) / D) + 1);
    const committed = term.pledges.filter((p) => p.committed).length;
    const standing = term.replacedAtSeconds !== undefined ? ` · <b class="down">replaced</b>` : (term.failedInRow ?? 0) > 0 ? ` · <span class="down">a failed term behind you</span>` : "";
    // The design console's moves are in its drawer (devconsole.ts), opened with the ` key.
    // A link as well as the key: on a layout where ` is a dead key, the key alone can't be relied on.
    const console = hooks.dev ? `<div class="d muted"><a href="#" data-open-console>Console</a> <kbd>\`</kbd></div>` : "";
    // The pledges themselves are in the panel (look.md §6: the strip cut them at thirty characters).
    return `<div class="stat term"><div class="k">Term ${term.number}${standing}</div><div class="v num">Day ${termDay} of ${length}</div><div class="d muted">Day ${day}${committed < MAX_COMMITTED ? ` · ${MAX_COMMITTED - committed} to pledge` : ""} · ${mapLine}</div>${console}</div>`;
  }

  /**
   * The term's pledges, in the panel under what's waiting (look.md §6: moved out of the strip,
   * where they were cut at thirty characters -- "the most important sentence on the screen"):
   * each whole, how far it's got, and its button.
   */
  function pledgesHtml(): string {
    const term = world.term;
    if (!term || term.pledges.length === 0) return "";
    const committed = term.pledges.filter((p) => p.committed).length;
    const rows = term.pledges.map((p) => {
      const progress = pledgeProgress(world, p);
      const can = !p.committed && committed < MAX_COMMITTED;
      return `<div class="pledge${p.committed ? " on" : ""}${p.kept ? " kept" : ""}" data-key="pledge-${esc(p.id)}">
        <span class="t">${p.kept ? "✓ " : p.committed ? "★ " : ""}${esc(pledgeLine(p))}</span>
        <span class="row"><i class="bar"><b style="width:${Math.round(progress * 100)}%"></b></i>
        ${can ? `<button class="primary" data-pledge="${esc(p.id)}">Pledge</button>` : `<button data-pick="${world.towns.get(p.townId)?.industry ? "site" : "town"}|${esc(p.townId)}">Show</button>`}</span>
      </div>`;
    }).join("");
    return `<div class="pane pledges-pane"><h2>Term ${term.number}'s pledges${committed < MAX_COMMITTED ? ` · pledge ${MAX_COMMITTED - committed} more` : ""}</h2>${rows}</div>`;
  }

  function renderStrip(mapLine: string): void {
    const ds = days();
    const recent = ds.slice(-30);
    const ten = ds[ds.length - 10] ?? ds[0];
    const n = now();
    const stat = (k: string, title: string, v: string, value: number, then: number | undefined, values: number[], fmt: (x: number) => string, color = css("--ink-2"), overlay?: string) => {
      const d = then === undefined ? 0 : value - then;
      const cls = d > 0 ? "up" : d < 0 ? "down" : "muted";
      const change = then === undefined ? `<div class="d muted">10-day change from day 10</div>` : `<div class="d ${cls}">${d >= 0 ? "▲" : "▼"} ${fmt(Math.abs(d))} in 10 days</div>`;
      // One that opens its overlay, to show where (No seat: the playtest's 2,590 a day, more than your riders, said nowhere where).
      const opens = overlay ? ` data-show-overlay="${overlay}" role="button"` : "";
      return `<div class="stat${overlay ? " opens" : ""}" title="${title}${overlay ? " -- click to see where" : ""}"${opens}><div class="k">${k}</div><div class="v num">${v}</div>${change}${sparkline(values, color)}</div>`;
    };
    // The original towns' people, the score (the review: it wasn't in the strip at all).
    const base = (towns: Array<{ id: string; population: number }>) => towns.reduce((sum, t) => sum + (world.basePopulation.has(t.id) ? t.population : 0), 0);
    const peopleNow = base([...world.towns.values()]);
    patchHtml(stripEl, `
      ${termHtml(n.day, mapLine)}
      ${stat("People", "The towns you started with: their people now, thousands", `${int(peopleNow)}k`, peopleNow, ten ? base(ten.towns) : undefined, recent.map((d) => base(d.towns)), (x) => `${int(x)}k`, css("--good"))}
      ${stat("Trips made a day", "Trips between towns that happened, by anyone, a day: 5-day average", int(n.tripsMade), n.tripsMade, ten?.tripsMade, recent.map((d) => d.tripsMade), int, css("--muted"))}
      ${stat("Money", "What you hold", nairaK(n.funds), n.funds, ten?.funds, recent.map((d) => d.funds), nairaK, css("--muted"))}
      <div class="spacer"></div>
      <div class="actions">${world.term?.history.length ? `<button data-verdict="record">Your record ▸</button> ` : ""}<button data-revenue="open">Revenue ▸</button></div>`);
  }

  // --- The side panel ----------------------------------------------------------------

  // A table's order is kept through a game day: ranked as the day begins, when you sort it, or
  // when you make a move, and between, its figures move and its rows don't. Ranked afresh every
  // redraw, two routes close in net swapped places four times a second (2026-11-02, map 2418 at
  // 4x: the revenue screen's routes re-sorted under the pointer in 37 of 43 changes).
  const ranked = new Map<string, { at: string; ids: string[] }>();
  /** `group`: rows ranked apart under one table's sort (the network's lines, way by way). */
  function sortRows<T extends { id: string }>(rows: T[], table: string, keys: Record<string, (row: T) => number | string>, group = table): T[] {
    // A table with no sort of its own yet: by its first key, highest first.
    const { key, dir } = (sorts[table] ??= { key: Object.keys(keys)[0]!, dir: -1 });
    const at = `${gameDay(world)}|${recorder.file.actions.length}|${key}|${dir}`;
    const was = ranked.get(group);
    const place = new Map(was?.ids.map((id, i) => [id, i]));
    // The same rows as when ranked: in that order.
    if (was?.at === at && rows.length === was.ids.length && rows.every((r) => place.has(r.id))) {
      return rows.slice().sort((x, y) => place.get(x.id)! - place.get(y.id)!);
    }
    const get = keys[key]!;
    const sorted = rows.slice().sort((x, y) => {
      const a = get(x);
      const b = get(y);
      return (typeof a === "string" ? a.localeCompare(b as string) : (a as number) - (b as number)) * dir;
    });
    ranked.set(group, { at, ids: sorted.map((r) => r.id) });
    return sorted;
  }
  function th(table: string, key: string, label: string): string {
    const s = sorts[table]!;
    return `<th data-sort="${table}:${key}" class="${s.key === key ? "sorted" : ""}">${label}${s.key === key ? (s.dir === 1 ? " ▲" : " ▼") : ""}</th>`;
  }

  function renderPanel(): void {
    const scroll = panelEl.scrollTop;
    if (selected && !exists(selected)) selected = null;
    if (selected) {
      patchHtml(panelEl, `${waitingHtml()}${pledgesHtml()}<div class="pane"><button data-back="1">◂ ${TAB_NAME[tab]}</button>${detailHtml(selected)}</div>`);
    } else {
      const tabs = `<div class="tabs">${TABS.map((t) => `<button data-tab="${t}" class="${tab === t ? "on" : ""}">${TAB_NAME[t]}</button>`).join("")}</div>`;
      const list = tab === "network" ? hooks.moneyNote() + networkList() + pipesList() + fold("forecasts", "More: the forecasts", hooks.routesMore()) : tab === "towns" ? townsTable() : sitesTable();
      patchHtml(panelEl, `${waitingHtml()}${pledgesHtml()}${whereNextHtml()}${tabs}<div class="pane">${list}</div>`);
    }
    panelEl.scrollTop = scroll;
  }
  function exists(sel: NonNullable<Selection>): boolean {
    if (sel.kind === "town" || sel.kind === "site") return world.towns.has(sel.id);
    if (sel.kind === "pipe") return !!world.pipelines?.some((p) => p.id === sel.id);
    if (sel.kind === "route") return world.routes.some((r) => r.id === sel.id) || world.lorryRoutes.some((r) => r.id === sel.id);
    return world.simulation.map.segments.some((s) => s.id === sel.id);
  }

  // --- The network (lines.ts): everything you run, under what it runs on ----------------
  // Each road (as a corridor is: the whole of it between two towns) and each stretch of track,
  // with every line that runs along it -- a line through three towns under each road it uses,
  // the buses and lorries and trains that share a road together. Your playtest (2026-11-02),
  // of three lists tried: one table was cleaner, the network's pairing better; this is both.

  // One reading of the lines and ways per moment of the game, however many lists and charts ask.
  let linesAt = "";
  let linesCache: Line[] = [];
  let waysCache: Way[] = [];
  const freshAt = () => `${world.economy.elapsedSeconds}|${recorder.file.actions.length}`;
  function linesNow(): Line[] {
    if (linesAt !== freshAt()) {
      linesAt = freshAt();
      linesCache = lines(world);
      waysCache = [];
    }
    return linesCache;
  }
  function waysNow(): Way[] {
    linesNow();
    if (waysCache.length === 0) waysCache = ways(world);
    return waysCache;
  }
  const lineName = (l: Line) => routeName(l);
  const lineSwatch = (l: Line) => (l.family === "goods" ? labelOf(world, routeLabelKey(l.id))?.colour ?? "var(--goods)" : swatchOf(l));
  const carriedText = (l: Line) => (l.family === "goods" ? `${int(l.carried)} t` : int(l.carried));
  const filterOf = (l: Line, f: string) => f === "all" || l.family === f || l.mode === f;
  let lineFilter = "all";
  /** The roads and track nothing of yours runs on: listed only when asked. */
  let showIdle = false;
  const chips = (name: string, on: string, options: Array<[string, string, number]>) =>
    `<div class="chips">${options.filter(([, , n], i) => i === 0 || n > 0).map(([id, label, n]) => `<button class="toggle${on === id ? " on" : ""}" data-chip="${name}|${id}">${label} <span class="muted">${n}</span></button>`).join("")}</div>`;
  const verdictWord = (l: Line) => (l.verdict ? ` · <span class="warnword">${esc(VERDICT_WORDS[l.verdict] ?? l.verdict)}</span>` : "");
  const lineKeys = { name: (l: Line) => lineName(l), vehicles: (l: Line) => l.vehicles, carried: (l: Line) => l.carried, full: (l: Line) => l.full, net: (l: Line) => l.netPerDay };

  /** The ways in your remit: either end yours to answer for. */
  const remitWays = () => waysNow().filter((w) => inRemit(world, w.a) || inRemit(world, w.b));
  const wayKind = (w: Way) => (w.mode === "rail" ? (w.outOfService ? "Track · the old line, out of service" : "Track") : w.retired ? "Retired" : `${w.surface === "paved" ? "Paved" : w.surface === "mixed" ? "Part paved" : "Dirt"}${w.lane ? " · bus lane" : ""}`);
  // Roads wear and jam (wear.ts, congestion.ts); track does neither, so only a road is flagged.
  const wayTrouble = (w: Way) => (w.mode !== "road" || w.retired ? null : w.load > 0.9 && w.speed < 0.7 ? "Jammed" : w.condition < 0.5 ? "Worn" : null);
  const wayName = (w: Way) => {
    const key = w.mode === "road" ? roadLabelKeyOf(world, w.id) : null;
    return (key && labelOf(world, key)?.name) || `${nameOf(w.a)} – ${nameOf(w.b)}`;
  };
  const corridorOf = (w: Way) => (w.mode === "road" ? corridorSummaries(world).find((c) => (c.a === w.a && c.b === w.b) || (c.a === w.b && c.b === w.a)) ?? null : null);
  const noSeatOn = (w: Way) => {
    const c = corridorOf(w);
    const seat = c ? corridorNoSeat(world).get(c.key) : undefined;
    return seat && seat.perDay >= NO_SEAT_MIN_PER_DAY ? seat : null;
  };
  /** A way in a line: what it is, how it's holding up, who carries its trips. */
  function wayFacts(w: Way): string {
    const c = corridorOf(w);
    const trouble = wayTrouble(w);
    const seat = noSeatOn(w);
    return [
      wayKind(w),
      `${pct(w.condition)} condition`,
      w.mode === "road" ? `traffic ${pct(w.load)}` : "",
      trouble ? `<span class="warnword">${trouble}</span>` : "",
      c ? `${c.takenSince !== null ? "<b>taken</b>, " : ""}you carry ${pct(c.you)}` : "",
      seat ? `<span class="warnword">no seat ${int(seat.perDay)} a day</span>` : "",
    ].filter(Boolean).join(" · ");
  }

  function networkList(): string {
    const all = remitWays();
    const ls = linesNow();
    if (ls.length === 0) return `<p class="muted">No lines yet. Pick the bus tool <kbd>B</kbd>, click a town, then another.</p>`;
    const on = waysOf(world, ls, all);
    const shown = ls.filter((l) => filterOf(l, lineFilter));
    const linesOn = new Map<string, Line[]>();
    for (const l of shown) for (const id of on.get(l.id) ?? []) linesOn.set(id, [...(linesOn.get(id) ?? []), l]);
    const used = sortRows(all.filter((w) => linesOn.has(w.id)), "network", { net: (w: Way) => (linesOn.get(w.id) ?? []).reduce((sum, l) => sum + l.netPerDay, 0) }, "network:ways");
    const idle = all.filter((w) => !ls.some((l) => on.get(l.id)?.includes(w.id)));
    const losing = ls.filter((l) => l.netPerDay < 0).length;
    const count = (f: string) => ls.filter((l) => filterOf(l, f)).length;
    const share = networkShare(world);
    const wayRow = (w: Way) => `<tr class="wayrow" data-pick="segment|${w.id}"><td colspan="5">${wayTrouble(w) ? "⚠ " : ""}${esc(wayName(w))}<span class="kind">${wayFacts(w)}</span></td></tr>`;
    const lineRow = (l: Line) => `<tr class="row" data-pick="route|${l.id}"><td><span class="swatch" style="background:${lineSwatch(l)}"></span>${esc(lineName(l))}<span class="kind">${KIND_NAME[l.kind].one}${verdictWord(l)}</span></td><td>${l.vehicles}</td><td>${carriedText(l)}</td><td>${pct(l.full)}</td><td class="${l.netPerDay < 0 ? "down" : ""}">${naira(l.netPerDay)}</td></tr>`;
    const total = shown.reduce((sum, l) => sum + l.netPerDay, 0);
    return `<h2>Your network · ${ls.length} ${ls.length === 1 ? "line" : "lines"}${losing ? `, ${losing} losing money` : ""}</h2>
      <div class="bar3" title="Who carried trips between towns: you, the informal sector, stayed home"><i style="width:${pct(share.player)};background:var(--you)"></i><i style="width:${pct(share.informal)};background:var(--informal)"></i><i style="width:${pct(share.lost)};background:var(--home)"></i></div>
      <p class="muted sharenote">Trips between towns: you carry ${pct(share.player)}, informal ${pct(share.informal)}, ${pct(share.lost)} stay home</p>
      ${chips("lines", lineFilter, [["all", "All", ls.length], ["people", "People", count("people")], ["goods", "Goods", count("goods")], ["road", "Road", count("road")], ["rail", "Rail", count("rail")]])}
      <table class="network"><thead><tr>${th("network", "name", "Line")}${th("network", "vehicles", "Veh.")}${th("network", "carried", "A day")}${th("network", "full", "Full")}${th("network", "net", "Net/day")}</tr></thead>
      <tbody>${used.map((w) => wayRow(w) + sortRows(linesOn.get(w.id) ?? [], "network", lineKeys, `network:${w.id}`).map(lineRow).join("")).join("")}</tbody>
      <tfoot><tr><td>${shown.length} ${shown.length === 1 ? "line" : "lines"}</td><td>${shown.reduce((sum, l) => sum + l.vehicles, 0)}</td><td></td><td></td><td class="${total < 0 ? "down" : ""}">${naira(total)}</td></tr></tfoot></table>
      ${idle.length ? `<table class="network idle"><tbody><tr class="sec"><td colspan="5">Nothing of yours on them · ${idle.length} <button class="quiet" data-chip="idle|">${showIdle ? "Hide" : "Show"}</button></td></tr>${showIdle ? idle.map(wayRow).join("") : ""}</tbody></table>` : ""}`;
  }

  // Your pipelines (pipelines.ts), and the inherited one: under the network, each to its card.
  function pipesList(): string {
    const ps = pipeSummaries(world);
    if (!ps.length) return "";
    const state = (p: (typeof ps)[number]) => (!p.working ? "broken" : p.outReason ? `shut · ${p.outReason === "tap" ? "tapped" : "a strike"}` : p.dial === 0 ? "idle" : `${pct(p.dial)} by pipe`);
    return `<h2>Pipelines · ${ps.length}</h2>
      <table class="network"><tbody>${ps.map((p) => `<tr class="row" data-pick="pipe|${p.id}"><td>${p.outReason ? "⚠ " : ""}${esc(p.name)}<span class="kind">${state(p)}${p.inherited ? " · inherited" : ""}</span></td><td>${int(p.perDay)} t/day</td></tr>`).join("")}</tbody></table>`;
  }

  function townsTable(): string {
    const towns = homeTowns();
    const base = (t: Town) => t.base ?? t.population;
    const growth = (t: Town) => (t.population - base(t)) / Math.max(1, base(t));
    const rows = sortRows(towns, "towns", { name: (t) => t.name, pop: (t) => t.population, growth, you: (t) => t.share.you });
    // A closed cluster's towns (remit.ts) carry no ⚠: nothing there is yours to answer yet.
    const problems = new Map(towns.map((t) => [t.id, inRemit(world, t.id) ? townProblem(t) : null]));
    return `<h2>Towns · ${[...problems.values()].filter(Boolean).length} with a problem</h2>
      <table><thead><tr>${th("towns", "name", "Town")}${th("towns", "pop", "People")}${th("towns", "growth", "Since day 1")}${th("towns", "you", "You carry")}</tr></thead><tbody>
      ${rows.map((t) => `<tr class="row" data-pick="town|${t.id}"><td>${problems.get(t.id) ? "⚠ " : ""}${esc(t.name)}</td><td>${int(t.population)}k</td><td class="${growth(t) >= 0 ? "up" : "down"}">${t.base === null ? "new" : `${growth(t) >= 0 ? "+" : ""}${pct(growth(t))}`}</td><td>${pct(t.share.you)}</td></tr>`).join("")}
      </tbody></table>`;
  }

  function sitesTable(): string {
    const use = (s: Site) => (s.capacity > 0 ? s.made / s.capacity : 0);
    // The border crossing too (border.ts): it makes nothing, but its card is where to see what crosses.
    const isBorder = (s: Site) => world.towns.get(s.id)?.industry === "border" || world.towns.get(s.id)?.industry === "gateway";
    // And the old line's stations (stations.ts): open or not, and how many change trains there.
    const isStation = (s: Site) => world.towns.get(s.id)?.industry === "station";
    // And the airport (airport.ts): its travellers and how many of them you carry.
    const isAirport = (s: Site) => world.towns.get(s.id)?.industry === "airport";
    const rows = sortRows(sites().filter((s) => s.capacity > 0 || isBorder(s) || isStation(s) || isAirport(s)), "sites", { name: (s) => nameOf(s.id), use, made: (s) => s.made });
    return `<h2>Sites · what each makes of what it could</h2>
      ${rows.length ? `<table><thead><tr>${th("sites", "name", "Site")}${th("sites", "made", "t/day")}${th("sites", "use", "Of capacity")}</tr></thead><tbody>
      ${rows.map((s) => isAirport(s)
        ? `<tr class="row" data-pick="site|${s.id}"><td>${esc(nameOf(s.id))}</td><td>${int(airportSummary(world)?.tripsPerDay ?? 0)} travel</td><td>you ${pct(airportSummary(world)?.you ?? 0)}</td></tr>`
        : isStation(s)
        ? `<tr class="row" data-pick="site|${s.id}"><td>${esc(nameOf(s.id))}</td><td>${int((world.transferRateEMA.get(s.id) ?? 0) * D)} change</td><td>${stationOpen(world, s.id) ? "open" : "closed"}</td></tr>`
        : isBorder(s)
        ? `<tr class="row" data-pick="site|${s.id}"><td>${esc(nameOf(s.id))}</td><td>${int((exportsBy(world).find((e) => e.to === s.id)?.tonnes ?? 0) * D)}</td><td>open</td></tr>`
        : `<tr class="row" data-pick="site|${s.id}"><td>${use(s) < 0.6 ? "⚠ " : ""}${esc(nameOf(s.id))}</td><td>${int(s.made)}</td><td class="${use(s) < 0.6 ? "down" : ""}">${pct(use(s))}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted">No sites working.</p>`}`;
  }

  /**
   * The chain strip (brief, Chains: convergent): the whole chain as one line of boxes -- each input from
   * where it comes, the site, what it makes and where that goes -- two inputs forking into one box, and
   * the one broken link marked (production.ts siteChain). "The ore is arriving, the steel isn't moving"
   * without opening three sites.
   */
  function chainStripHtml(siteId: string): string {
    const c = siteChain(world, siteId);
    if (!c || (c.inputs.length === 0 && c.output.places.length === 0)) return "";
    const state = (link: { share: number; broken: boolean }) => (link.broken ? "broken" : link.share < 0.8 ? "short" : "ok");
    const from = (places: string[]) => (places.length === 0 ? "nowhere yet" : places.length <= 2 ? places.map(nameOf).join(", ") : `${nameOf(places[0]!)} +${places.length - 1}`);
    const ins = c.inputs.map((i) => `<span class="cbox ${state(i)}">${esc(i.name)}<small>${esc(from(i.places))} · ${pct(i.share)}</small></span>`).join("");
    const to = c.output.places.length === 0 ? "" : c.output.places.length === 1 ? nameOf(c.output.places[0]!) : `${c.output.places.length} places`;
    // The assembly plant's product is yours: the chain ends in what it takes off a bus.
    const yours = world.towns.get(siteId)?.industry === "assembly" ? `<span class="arrow">→</span><span class="cbox ${c.inputs.some((i) => i.broken) ? "short" : "ok"}">your buses<small>${pct(world.assembly?.discount ?? 0)} off</small></span>` : "";
    return `<div class="chainstrip">${ins ? `<span class="ins${c.inputs.length > 1 ? " fork" : ""}">${ins}</span><span class="arrow">→</span>` : ""}<span class="cbox site">${esc(nameOf(siteId))}</span>${c.output.places.length ? `<span class="arrow">→</span><span class="cbox ${state(c.output)}">${esc(c.output.name)}<small>${esc(to)} · ${pct(c.output.share)} away</small></span>` : yours}</div>`;
  }

  /**
   * The recipe card (brief, Chains: convergent): why is this idle? Each input arriving against what full
   * output takes, the short one marked and, for it, where it's stuck -- waiting at its source, on the
   * way and where, or the gap no haulier crosses; what it makes against what it could; how much of
   * that gets away. The map says where, the card says why.
   */
  function recipeHtml(siteId: string): string {
    const p = siteProduction(world, siteId);
    if (!p || p.inputs.length === 0) return "";
    const chain = siteChain(world, siteId);
    const rows = p.inputs.map((i) => {
      const share = i.needed > 0 ? Math.min(1, i.arriving / i.needed) : 1;
      const binding = p.limit === "input" && p.binding === i.name;
      return `<div class="rrow${binding ? " binding" : ""}"><span class="n">${esc(i.name)}${binding ? " · short" : ""}</span><span class="v num">${int(i.arriving * D)} of ${int(i.needed * D)} t</span><i class="rbar"><b style="width:${pct(share)}"></b></i></div>`;
    }).join("");
    // Where the short one is stuck, source by source.
    const stuck = (() => {
      const link = chain?.inputs.find((i) => i.broken);
      if (!link) return "";
      if (link.places.length === 0) return `Nothing sends it ${esc(link.name)} yet.`;
      const way = goodsOnTheWay(world, siteId);
      return link.places.map((src) => {
        const waiting = [...(world.goods.yards.get(src) ?? [])].filter(([k]) => k.startsWith(`${siteId}|`)).reduce((sum, [, a]) => sum + a, 0);
        const moving = way.find((x) => x.origin === src);
        const b = haulBreak(world, src, siteId);
        const parts = [
          waiting >= 1 ? `${int(waiting)} t waiting at ${esc(nameOf(src))}` : "",
          moving && moving.tonnes >= 1 ? `${int(moving.tonnes)} t on the way${moving.waitingAt.length ? `, waiting at ${moving.waitingAt.slice(0, 2).map((id) => esc(nameOf(id))).join(" and ")}` : ""}` : "",
          b?.kind === "road" ? `no road joins it to ${esc(nameOf(src))}` : b?.kind === "gap" ? (b.yardAt ? `hauliers can't get it past ${esc(nameOf(b.yardAt))}: a yard there would carry it on` : "hauliers can't get it here, even from your yards: freight track can") : b?.kind === "legs" && b.legs >= 3 ? `${b.legs} legs by road, slowly` : "",
        ].filter(Boolean);
        return parts.length ? `From ${esc(nameOf(src))}: ${parts.join("; ")}.` : "";
      }).filter(Boolean).join(" ") || `Its ${esc(link.name)} is slow coming: more hauliers from a yard at the source, or a freight line.`;
    })();
    return `<div class="recipe"><h2>Its recipe</h2>${rows}
      ${stuck ? `<p class="stuck">${stuck}</p>` : ""}
      <div class="rfoot muted">Makes ${int(p.made * D)} of ${int(p.capacity * D)} t a day${p.limit === "workers" ? " · short of workers" : ""} · ${pct(p.shipped)} of it gets away</div></div>`;
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
        ${offerHtml(t.id)}
        ${unionHtml(t.id)}
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
        ${onTheWayHtml(t.id)}
        ${stationHtml(t.id)}
        <h2>${hasBusStation(world, t.id) ? "The board: your lines here" : "Your routes here"} · ${here.length}</h2>
        <table><tbody>${here.map((r) => boardRow(t.id, r)).join("") || `<tr><td class="muted">None</td></tr>`}</tbody></table>
        ${fold("town", "More: its trips, parks, metro, strikes", hooks.townMore(t.id))}`;
    }
    if (sel.kind === "route" && world.lorryRoutes.some((x) => x.id === sel.id)) {
      // A goods line: the same card as a passenger line's, its figures in tonnes.
      const l = linesNow().find((x) => x.id === sel.id)!;
      const ds = days();
      const net = ds.map((d) => d.lorries.find((x) => x.id === l.id)?.netPerDay ?? 0);
      const first = Math.max(0, ds.findIndex((d) => d.lorries.some((x) => x.id === l.id)));
      const d = diagnoseLorryRoute(world, l.id);
      const stops = (l.mode === "rail" ? railPath(world, l.a, l.b) : roadPath(world, l.a, l.b))?.nodeIds ?? [l.a, l.b];
      return `<div class="kicker">${l.kind === "freight" ? "Freight trains" : "Lorries"}${l.verdict ? ` · ${esc(VERDICT_WORDS[l.verdict] ?? l.verdict)}` : ""}</div>
        <div class="head"><div class="title">${esc(lineName(l))}</div><div class="num ${l.netPerDay < 0 ? "down" : "up"}">${naira(l.netPerDay)}/day</div></div>
        ${hooks.goodsWhy(l.id)}
        <div class="tiles">
          ${tile("Carried a day", `${int(l.carried)} t`, d ? `${int(d.outbound)} t want to go out, ${int(d.inbound)} t back` : "")}
          ${tile("How full", pct(l.full))}
          ${tile(l.kind === "freight" ? "Freight trains" : "Lorries", `${l.vehicles} <button data-remove="${l.id}" title="Sell one">−</button> <button data-add="${l.id}" title="Add one">+</button>`)}
          ${tile("In / cost a day", `${nairaK(l.incomePerDay)} / ${nairaK(l.costPerDay)}`)}
        </div>
        ${carsHtml(l.id)}
        ${d ? `<div class="chart"><div class="t"><span>The goods along it</span><span>carried ${pct(d.delivered)} · spoiled ${pct(d.spoiled)}</span></div><div class="bar3"><i style="width:${pct(d.delivered)};background:var(--goods)"></i><i style="width:${pct(d.spoiled)};background:var(--home)"></i></div></div>` : ""}
        <div class="chart"><div class="t"><span>Net a day</span><span>since day ${ds[first]?.day ?? gameDay(world)}</span></div>${chartSvg([{ name: "Net a day", color: css("--goods"), values: net }], { height: 90, format: nairaK, from: first, zeroLine: true })}</div>
        <h2>Stops</h2><div>${stops.map((x) => esc(nameOf(x))).join(" → ")}</div>`;
    }
    if (sel.kind === "route") {
      const r = routes().find((x) => x.id === sel.id)!;
      const ds = days();
      const net = ds.map((d) => d.routes.find((x) => x.id === r.id)?.netPerDay ?? 0);
      const first = Math.max(0, ds.findIndex((d) => d.routes.some((x) => x.id === r.id)));
      return `<div class="kicker">${r.kind === "train" ? "Train" : r.kind === "brt" ? "BRT" : r.kind === "minibus" ? "Minibus" : "Bus"} route${r.verdict ? ` · ${r.verdict}` : ""}</div>
        <div class="head"><div class="title">${esc(routeName(r))}</div><div class="num ${r.netPerDay < 0 ? "down" : "up"}">${naira(r.netPerDay)}/day</div></div>
        ${labelOf(world, routeLabelKey(r.id))?.name ? `<div class="muted">${esc(nameOf(r.a))} ↔ ${esc(nameOf(r.b))}</div>` : ""}
        ${nameRow(routeLabelKey(r.id), true)}
        ${problemHtml(routeProblem(r))}
        <div class="tiles">
          ${tile("Riders a day", int(r.ridersPerDay))}
          ${tile("How full", pct(r.loadFactor))}
          ${tile("Vehicles", `${r.vehicles} <button data-remove="${r.id}" title="Sell one">−</button> <button data-add="${r.id}" title="Add one">+</button>`)}
          ${tile("In / cost a day", `${nairaK(r.incomePerDay)} / ${nairaK(r.costPerDay)}`)}
        </div>
        ${carsHtml(r.id)}
        <div class="chart"><div class="t"><span>Net a day</span><span>since day ${ds[first]?.day ?? gameDay(world)}</span></div>${chartSvg([{ name: "Net a day", color: css("--you"), values: net }], { height: 90, format: nairaK, from: first, zeroLine: true })}</div>
        <h2>Stops</h2><div>${r.stops.map((s) => esc(nameOf(s))).join(" → ")}</div>
        ${fold("route", "More: why, its road, freight", hooks.routeMore(r.id))}`;
    }
    if (sel.kind === "pipe") {
      // A pipeline (pipelines.ts): what it carries, the dial, its tankers, its union, its state.
      const p = pipeSummaries(world).find((x) => x.id === sel.id)!;
      const union = unionOf(world, p.a);
      const upkeep = world.tuning.pipeUpkeepPerDay ?? 400;
      const tenths = Math.round(p.dial * 10);
      const dial = `${pct(p.dial)} <button data-pipe-dial="${p.id}|${Math.max(0, tenths - 1) / 10}" title="Less by pipe"${tenths <= 0 || !p.working ? " disabled" : ""}>−</button> <button data-pipe-dial="${p.id}|${Math.min(10, tenths + 1) / 10}" title="More by pipe"${tenths >= 10 || !p.working ? " disabled" : ""}>+</button>`;
      const problem: Problem = !p.working
        ? { text: `Broken since the old days${p.inherited ? ": it runs where the colonial economy wanted fuel" : ""}. Restore it, and it carries what you send it`, button: `<button data-restore-pipe="${p.id}">Restore it · ${nairaK(p.restoreCost)}</button>` }
        : p.outReason
          ? { text: `Shut by ${p.outReason === "tap" ? "a tap: thieves broke into it" : "the tanker drivers' strike"}, back in ${plural(p.backInDays, "day")}. Its fuel goes by tanker meanwhile, and ${pct(p.tankers)} of a fleet for it are still working its corridor`, button: "" }
          : p.dial === 0
            ? { text: "Carrying nothing: turn its dial up to send fuel by pipe", button: "" }
            : !p.kept && p.condition < 0.7
              ? { text: `Neglected: ${pct(p.lossShare)} of what it carries is lost, and thieves tap it more`, button: `<button data-pipe-keep="${p.id}|1">Keep it up · ${naira(upkeep)}/day</button>` }
              : null;
      return `<div class="kicker">Pipeline · fuel${p.inherited ? " · inherited" : ""} · ${!p.working ? "broken" : p.outReason ? "shut" : p.dial === 0 ? "idle" : "running"}</div>
        <div class="head"><div class="title">${esc(p.name)}</div><div class="num">${int(p.perDay)} t/day</div></div>
        ${problemHtml(problem)}
        <div class="tiles">
          ${tile("By pipe", dial, "the rest goes by tanker")}
          ${tile("Through it", `${int(p.perDay)} t/day`, `of ${int(p.capPerDay)} it can carry; ${int(p.wantedPerDay)} goes its way`)}
          ${tile("Tankers on it", pct(p.tankers), "of a fleet for all its fuel")}
          ${tile("Lost on the way", pct(p.lossShare), p.kept ? `kept up, ${naira(upkeep)}/day` : "not kept up")}
        </div>
        <p class="why">${union ? `${esc(union.chairman)}'s union (${stanceWord(union.stance)}) loads its tankers at ${esc(nameOf(p.a))}: every tonne through the pipe is work off his drivers, and moves him against you. ` : ""}Its tankers follow the work: send it all by pipe and they drift away over weeks, and the day a strike or a tap stops it, its fuel waits for tankers that aren't there.</p>
        ${p.working ? `<p><button data-pipe-keep="${p.id}|${p.kept ? 0 : 1}">${p.kept ? "Stop keeping it up" : `Keep it up · ${naira(upkeep)}/day`}</button></p>` : ""}
        <h2>Where it runs</h2><div>${esc(nameOf(p.a))} → ${esc(nameOf(p.b))}, ${int(p.cells)} cells${p.inherited ? ", up the old railway" : ", beside the road"}</div>`;
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
        ${chainStripHtml(sel.id)}
        ${recipeHtml(sel.id)}
        ${problemHtml(siteProblem(s))}
        ${seeThrough(sel.id, out, inn)}
        <div class="tiles">
          ${t.industry === "assembly"
            // The assembly plant (assembly.ts): two inputs, the short one marked; what it does for you.
            ? (() => {
                const p = siteProduction(world, t.id);
                const [steel, fuel] = p?.inputs ?? [];
                const share = (i?: { arriving: number; needed: number }) => (i && i.needed > 0 ? Math.min(1, i.arriving / i.needed) : 1);
                const short = share(steel) <= share(fuel) ? "steel" : "fuel";
                const mark = (name: string) => (p && p.limit === "input" && short === name ? " · short" : "");
                return `${tile("Steel in", `${int((steel?.arriving ?? 0) * D)} t`, `of ${int((steel?.needed ?? 0) * D)} t a day${mark("steel")}`)}
                  ${tile("Fuel in", `${int((fuel?.arriving ?? 0) * D)} t`, `of ${int((fuel?.needed ?? 0) * D)} t a day${mark("fuel")}`)}
                  ${tile("Buses and minibuses", `${pct(world.assembly?.discount ?? 0)} off`, "while it runs")}
                  ${tile("Its line", `generation ${assemblyGeneration(world) + 1}`, `${int(world.assembly?.fullDays ?? 0)} days at full output`)}`;
              })()
            : t.industry === "airport"
            // The airport (airport.ts): its travellers, who carries them, its air freight.
            ? (() => {
                const a = airportSummary(world);
                if (!a) return "";
                return `${tile("Travellers a day", int(a.tripsPerDay), `${int(a.travellersPerDay)} in, as many out`)}
                  ${tile("You carry", pct(a.you), `danfos ${pct(a.informal)}`)}
                  ${tile("Not carried", pct(a.stranded), a.stranded > 0.3 ? ((airportAdvice(world)?.noWayPerDay ?? 0) > a.tripsPerDay * a.stranded / 2 ? "no way on from it" : "no seat on your lines") : "")}
                  ${tile("Air freight", `${a.freightPerDay.toFixed(1)} t/day`, `hauliers ${a.freightHauliers.toFixed(1)}, yours ${a.freightYours.toFixed(1)} (${world.tuning.airFreightRate ?? 8}× the rate)`)}`;
              })()
            : t.industry === "station"
            // A station on the old line (stations.ts): open or not, what it was built for, who changes trains here.
            ? (() => {
                const info = stationOf(world, t.id);
                const served = info ? world.towns.get(info.serves) ?? world.ruins.get(info.serves) : undefined;
                const site = world.towns.get(t.id)!;
                const away = served ? Math.round(Math.hypot(served.x - site.x, served.y - site.y)) : 0;
                return `${tile("The line here", stationOpen(world, t.id) ? "open" : "closed", stationOpen(world, t.id) ? "trains stop" : "restore it to open it")}
                  ${tile("Built for", esc(served?.name ?? "—"), info?.kind === "gone" ? "a town that's gone" : `${away} cells off`)}
                  ${tile("Change trains here", `${int((world.transferRateEMA.get(t.id) ?? 0) * D)}/day`, world.tuning.stationTownRiders ? `a town grows at ${world.tuning.stationTownRiders}` : "")}`;
              })()
            : t.industry === "gateway"
            // The coast road (border.ts): the map's way to the sea -- how much gets through, and how.
            ? `${tile("Imports arriving", pct(seaportLink(world).share), "of what lands at the coast")}
               ${tile("By", seaportLink(world).by === "rail" ? "rail" : "road", seaportLink(world).by === "road" ? `${pct(seaportLink(world).paved)} paved` : "")}`
            : t.industry === "border"
            // A border crossing makes nothing: what crosses it, from how many farms, and its pay (border.ts).
            ? `${tile("Out a day", `${int((exportsBy(world).find((e) => e.to === t.id)?.tonnes ?? 0) * D)} t`, world.food?.crops.cash ?? "")}
               ${tile("To", borderCountry(world))}
               ${tile("Farm towns", int(farmTowns(world).filter((f) => exportGateway(world, f.id)?.to === t.id).length))}
               ${tile("Paid a tonne", `₦${Math.round(world.tuning.exportPayPerTonne * (world.tuning.borderPayShare ?? 0.7))}`, `₦${Math.round(world.tuning.exportPayPerTonne * seaportLink(world).share)} at the sea`)}`
            : `${tile("Makes a day", `${int(s.made)} t`, s.product ?? "")}
               ${tile("Of capacity", s.capacity > 0 ? pct(s.made / s.capacity) : "—", `${int(s.capacity)} t/day`)}
               ${tile("Workers", s.staffing !== null ? pct(s.staffing) : "—")}
               ${tile("Carried away", s.shipped !== null ? pct(s.shipped) : "—")}`}
        </div>
        ${out.length ? `<h2>Out · yours / hauliers' / spoiling</h2><table><tbody>${flowRows(out, (f) => f.to)}</tbody></table>` : ""}
        ${inn.length ? `<h2>In</h2><table><tbody>${flowRows(inn, (f) => f.from)}</tbody></table>` : ""}
        ${fold("site", "More: what it makes, expand, restore", hooks.townMore(t.id))}`;
    }
    // A road or a stretch of track, whole (lines.ts Way): what it is, how it's holding up, the
    // lines on it, who carries its trips -- the corridor under More, folded into its card.
    const piece = world.simulation.map.segments.find((x) => x.id === sel.id)!;
    const w = waysNow().find((x) => x.pieces.some((p) => p.id === piece.id)) ?? null;
    if (!w) return "";
    const roadKey = w.mode === "road" ? roadLabelKeyOf(world, w.id) : null;
    const named = roadKey ? labelOf(world, roadKey)?.name : undefined;
    const busiest = w.pieces.reduce((best, p) => ((world.roadFlowEMA.get(p.id) ?? 0) > (world.roadFlowEMA.get(best.id) ?? 0) ? p : best), w.pieces[0]!);
    const cars = w.mode === "road" ? privateLoad(world, busiest.id) : 0;
    const flow = (world.roadFlowEMA.get(busiest.id) ?? 0) + cars;
    const ls = linesNow();
    const on = waysOf(world, ls, [w]);
    const here = ls.filter((l) => on.get(l.id)?.includes(w.id));
    const c = corridorOf(w);
    const seat = noSeatOn(w);
    const problem: Problem = w.outOfService ? null
      : w.mode === "road" && w.speed < 0.7 && w.load > 0.9 ? { text: `Jammed: traffic at ${pct(w.speed)} of free speed`, button: toolButton("road", w.surface === "dirt" ? "Pave it <kbd>R</kbd>" : "A bus lane <kbd>R</kbd>", [w.a, w.b]) }
      : seat ? { text: `No seat for ${int(seat.perDay)} a day, most between ${nameOf(seat.worst.a)} and ${nameOf(seat.worst.b)}`, button: moveButton(seat.move, "") }
      : null;
    // Its wear, as one decision (brief, Revision 2: wear per corridor, never per piece).
    const wear = w.mode === "road" && world.tuning.wearEnabled ? corridorWear(world, w.a, w.b) : null;
    const first = w.pieces[0]!;
    const retire = w.yours ? `<button data-retire="${first.id}" title="Stop its upkeep and tolls now; it decays and is gone in ${world.tuning.retireGoneDays} days. Towns it joined can be cut off; your lines on it go round, or are sold if nothing else joins their towns. Track can then be laid on its line for less (K).">Retire</button>` : "";
    const wearHtml = !wear ? ""
      : first.retiredAt !== undefined ? `<div class="problem"><span>Retired day ${gameDay(world, first.retiredAt)}: gone on day ${gameDay(world, goneAt(world, first))}</span><button data-restore="${first.id}" title="Repair it to new and keep it">Restore · ${nairaK(restoreRoadCost(world, first.id))}</button></div>`
      : wear.kept ? `<div class="problem none"><span>Kept up: ${naira(wear.upkeepPerDay)} a day</span><span class="actions"><button data-keep="${first.id}|0" title="Stop paying to keep it up: it starts wearing again">Stop</button>${retire}</span></div>`
      : `<div class="problem${wear.condition >= 0.97 ? " none" : ""}"><span>${wear.condition >= 0.97 ? "Sound" : `Worn: ${pct(wear.speed)} speed${wear.roughPerDay >= 1 ? `, costs your vehicles ${naira(wear.roughPerDay)} a day` : ""}`}</span><span class="actions"><button data-keep="${first.id}|1" title="Repair it as it wears, billed as it goes${wear.repair >= 1 ? `; the catch-up repair (${naira(wear.repair)}) is charged now` : ""}">Keep it up · ${nairaK(wear.upkeepPerDay)}/day</button>${wear.repair >= 1 ? `<button data-fixnow="${first.id}" title="Repair all of it to new, once">Fix now · ${nairaK(wear.repair)}</button>` : ""}${retire}</span></div>`;
    // Its class (trunks.ts): a trunk keeps the okadas and kekes off it; a feeder is theirs.
    const trunk = w.mode === "road" && world.tuning.trunksEnabled && first.retiredAt === undefined ? isTrunk(world, first.id) : null;
    const classHtml = trunk === null ? ""
      : trunk ? `<div class="problem none"><span>A trunk: no okadas or kekes on it, danfos pay its toll</span><span class="actions"><button data-trunk="${first.id}|0" title="The informal sector's ground again: okadas and kekes back on it">Make it a feeder</button></span></div>`
      : `<div class="problem none"><span>A feeder: the informal sector's ground</span><span class="actions"><button data-trunk="${first.id}|1" title="No okadas or kekes on it; danfos pay its toll, and run it end to end -- the last mile off it by okada. The union will want it back.">Make it a trunk · ${nairaK(trunkPrice(world, first.id))}</button></span></div>`;
    const costs = c ? [c.leviesLostPerDay >= 1 ? `park levies ${naira(-c.leviesLostPerDay)} a day since you came` : "", c.lastStrikeCost !== null ? (c.lastStrikeCost < 1 ? "the last strike cost nothing" : `the last strike cost ${naira(c.lastStrikeCost)}`) : c.takenSince !== null && !c.hasLane ? "no pushback without a lane" : ""].filter(Boolean) : [];
    return `<div class="kicker">${w.mode === "rail" ? "Track" : "Road"} · ${wayKind(w).replace(/^Track( · )?/, "") || "in service"}${w.pieces.length > 1 ? ` · ${w.pieces.length} stretches` : ""}</div>
      <div class="head"><div class="title">${esc(named || `${nameOf(w.a)} – ${nameOf(w.b)}`)}</div></div>
      ${named ? `<div class="muted">${esc(nameOf(w.a))} – ${esc(nameOf(w.b))}</div>` : ""}
      ${roadKey ? nameRow(roadKey, false) : ""}
      ${problemHtml(problem)}
      ${wearHtml}
      ${classHtml}
      <div class="tiles">
        ${w.mode === "road" ? tile("Traffic", pct(w.load), "of what it carries before it jams") : ""}
        ${cars > 0 && flow > 0 ? tile("Private cars", pct(cars / flow), "of its traffic") : ""}
        ${w.mode === "road" ? tile("Speed", pct(w.speed)) : ""}
        ${tile("Condition", pct(w.condition), w.kept ? "kept up" : "")}
        ${w.upkeepPerDay >= 1 ? tile("Upkeep", `${nairaK(w.upkeepPerDay)}/day`) : ""}
      </div>
      ${c ? `<h2>Who carries its trips${c.takenSince !== null ? ` · taken day ${gameDay(world, c.takenSince)}` : ` · taken at ${pct(world.tuning.corridorTakenShare)}`}</h2><div class="bar3"><i style="width:${pct(c.you)};background:var(--you)"></i><i style="width:${pct(c.informal)};background:var(--informal)"></i><i style="width:${pct(c.lost)};background:var(--home)"></i></div><div class="muted">you ${pct(c.you)} · informal ${pct(c.informal)} · stayed home ${pct(c.lost)}${costs.length ? ` · ${costs.join(" · ")}` : ""}</div>` : ""}
      <h2>Your lines on it · ${here.length}</h2>
      <table><tbody>${here.map((l) => `<tr class="row" data-pick="route|${l.id}"><td><span class="swatch" style="background:${lineSwatch(l)}"></span>${esc(lineName(l))}<span class="kind">${KIND_NAME[l.kind].one}${verdictWord(l)}</span></td><td>${l.vehicles}</td><td class="${l.netPerDay < 0 ? "down" : ""}">${naira(l.netPerDay)}</td></tr>`).join("") || `<tr><td class="muted">None</td></tr>`}</tbody></table>`;
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
      case "founded": return { text: e.site && e.site === e.townId ? `${e.name} grew up at the station` : `${e.name} grew up on the road`, tone: "good", group: "growth", select: { kind: "town", id: e.townId } };
      case "abandoned": return { text: `${e.name} emptied out`, tone: "bad", group: "growth", select: null };
      case "milestone": return { text: `${e.name} ${["grew by a quarter", "grew by half", "doubled", "tripled"][e.index] ?? "grew"}: ${int(e.to)}k`, tone: "good", group: "growth", select: { kind: "town", id: e.townId } };
      case "corridor-taken": return { text: `You took ${ab(e)} from the danfos`, tone: "good", group: "corridors", select: { kind: "town", id: e.a } };
      case "corridor-released": return { text: `The danfos took ${ab(e)} back`, tone: "bad", group: "corridors", select: { kind: "town", id: e.a } };
      case "swept": return e.amount >= 1 ? { text: `The treasury swept ${nairaK(e.amount)}`, tone: "bad", group: "money", select: null } : null;
      case "project-affordable": return { text: `${ab(e)}: the ${projectName(e.rung)} is affordable now`, tone: "good", group: "money", select: { kind: "town", id: e.a } };
      case "project-lapse-warning": return { text: `${ab(e)}: the project money lapses soon`, tone: "bad", group: "money", select: { kind: "town", id: e.a } };
      case "project-lapsed": return { text: `${ab(e)}: the project lapsed, the treasury took ${nairaK(e.taken)}`, tone: "bad", group: "money", select: null };
      case "project-done": return { text: `${ab(e)}: the ${projectName(e.rung)} is built`, tone: "good", group: "money", select: { kind: "town", id: e.a } };
      case "flood-warning": return { text: `The rains in ${e.inDays} days: ${e.fords.map((f) => f.name).join(", ")} will flood`, tone: "bad", group: "trouble", select: null };
      case "flood-rose": return { text: `Flooded: ${e.fords.map((f) => f.name).join(", ")}, for ${e.days} days`, tone: "bad", group: "trouble", select: null };
      case "flood-fell": return { text: `The water's down at ${e.fords.map((f) => f.name).join(", ")}`, tone: "good", group: "trouble", select: null };
      case "union-demand": return { text: `${e.chairman}: "${e.text}"`, tone: "bad", group: "trouble", select: null };
      case "pipe-out": return { text: `${ab(e)}: the pipeline ${e.reason === "tap" ? "tapped" : "shut by a strike"}, ${e.days} days`, tone: "bad", group: "trouble", select: { kind: "town", id: e.b } };
      case "pipe-back": return { text: `${ab(e)}: the pipeline running again`, tone: "good", group: "trouble", select: { kind: "town", id: e.b } };
      case "union-answered": return { text: `${e.chairman}: ${{ pay: "you paid his members", concede: "you eased the lane", coop: "you handed him the route", refuse: "you refused him", ignored: "you ignored him: he strikes" }[e.answer]}`, tone: e.answer === "refuse" || e.answer === "ignored" ? "bad" : "good", group: "trouble", select: null };
      case "union-stance": return { text: `${e.chairman}'s union is ${e.stance} now`, tone: e.stance === "with you" ? "good" : e.stance === "against you" ? "bad" : "", group: "trouble", select: null };
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
    const groups: Array<[string, string]> = [["all", "All"], ["trouble", "Strikes"], ["sites", "Sites"], ["growth", "Growth"], ["corridors", "Corridors"], ["money", "Money"]];
    // Each line by its place in the whole log, which only grows: a log held under the pointer
    // (patch.ts) still opens the line clicked.
    logShown = entries;
    const shown = entries.map((e, i) => ({ e, i })).filter(({ e }) => logFilter === "all" || e.group === logFilter).reverse();
    const drawn = patchHtml(logEl, `<h2>What happened</h2><div id="logfilter">${groups.map(([id, label]) => `<button data-log="${id}" class="${logFilter === id ? "on" : ""}">${label}</button>`).join("")}</div>
      ${shown.map(({ e, i }) => `<div class="event ${e.tone}" data-event="${i}"><span class="day">${e.day}</span><span class="what">${esc(e.text)}</span></div>`).join("") || `<div class="muted">Nothing yet.</div>`}`);
    // Held under the pointer, it's drawn again once the pointer leaves.
    if (drawn) logSize = entries.length;
  }

  // --- The term's verdict and your record (brief, Revision 5, step 3) -----------------
  // At a term's end the verdict takes the screen: what you pledged and kept, what grew, the
  // grant it set, your standing; under it, every term so far -- the career record, the story
  // of the save. "Your record" in the strip opens it any time.

  const verdictOpen = () => verdictEl.classList.contains("open");
  type VerdictMode = "term" | "record" | "replaced" | "pledges" | "handover";
  /** The correspondent's letter (correspondent.ts), signed. */
  function letterHtml(letter: Letter): string {
    return `<div class="letter">${letter.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}<p class="sig">${esc(letter.from)}<span>Permanent Secretary, Ministry of Transportation</span></p></div>`;
  }
  let verdictMode: VerdictMode = "term";
  let enterTimer = 0;
  function openVerdict(mode: VerdictMode | null): void {
    const fresh = mode !== null && (!verdictOpen() || mode !== verdictMode);
    verdictEl.classList.toggle("open", mode !== null);
    if (!mode) return;
    verdictEl.dataset.mode = mode;
    renderVerdict((verdictMode = mode));
    // Opened, or a new page of it: its content lifts in (fullscreen.css), for a moment only, so a
    // redraw within the page doesn't replay it.
    if (fresh) {
      verdictEl.classList.remove("enter");
      void verdictEl.offsetWidth;
      verdictEl.classList.add("enter");
      clearTimeout(enterTimer);
      enterTimer = window.setTimeout(() => verdictEl.classList.remove("enter"), 700);
      verdictEl.scrollTop = 0;
    }
  }
  /** The term's pledges on offer, each with its Pledge button while you've pledges left. */
  function pledgeChoices(): string {
    const term = world.term;
    if (!term) return "";
    const committed = term.pledges.filter((p) => p.committed).length;
    return `<ul class="pledges choose">${term.pledges.map((p) => `<li><div class="line">${p.committed ? "★ " : ""}${esc(pledgeLine(p))} ${!p.committed && committed < MAX_COMMITTED ? `<button class="primary" data-pledge="${esc(p.id)}">Pledge</button>` : ""}</div>${p.kept ? "" : pledgeMoveLine(p)}</li>`).join("")}</ul>`;
  }
  /**
   * A pledge's likely first move and its price against what you have (outside review,
   * 2026-10-26: "which problem can I realistically solve with the money and time I have?").
   */
  function pledgeMoveLine(p: Pledge): string {
    const move = pledgeMove(world, p);
    if (!move) return "";
    const short = move.price - world.economy.funds;
    const afford = short > 0 ? `<span class="bad">${nairaK(short)} more than you have</span>` : `<span class="good">within your ${nairaK(world.economy.funds)}</span>`;
    // A restore beyond your money: the bond that pays for it now, beside it (the refinery's ₦60k
    // against ₦23k read as a wall, with the way round it two clicks away under More).
    const restore = move.action.kind === "restoreRefinery" ? "refinery" : move.action.kind === "restoreWorks" ? "works" : null;
    const bond = restore && short > 0 ? hooks.bond(restore) : "";
    return `<div class="move muted">The likely move: ${esc(move.label.replace(/\s*\([^)]*\)$/, ""))} · ${nairaK(move.price)}, ${afford}${bond ? ` ${bond}` : ""}</div>`;
  }
  /** What keeping pledges is worth: the next term's grant by how many you keep (the mandate). */
  function grantLine(): string {
    const t = world.tuning;
    if (!t.mandateEnabled) return "";
    const by = (kept: number) => nairaK((t.termGrantBase ?? 0) + (t.termGrantPerPledge ?? 0) * kept);
    return `<p class="muted">You have ${nairaK(world.economy.funds)}. The next term's grant: ${by(0)} if you keep none (a failed term), ${by(1)} with one kept, ${by(MAX_COMMITTED)} with both, and ${naira(t.termGrantPerThousand ?? 0)} more for every thousand people the towns grow. A move beyond your money waits for it, or a bond pays for a restore now.</p>`;
  }

  function renderVerdict(mode: VerdictMode): void {
    const term = world.term;
    if (!term) return;
    if (mode === "handover") {
      // Day 1 (brief, Revision 5, step 4): what the state inherited and what you answer to, from the seed.
      const first = term.number === 1 && !term.pledges.some((p) => p.committed);
      verdictEl.innerHTML = `<div class="top"><div class="title">From the Ministry</div>${first ? `<button class="primary" data-verdict="pledges">To your pledges ▸</button>` : `<button data-verdict="record">Your record ▸</button>`}</div>
        ${letterHtml(handoverNote(world))}`;
      return;
    }
    if (mode === "pledges") {
      // A term's start (the first included): what the state asks this term, chosen here.
      const length = world.tuning.termDays ?? 120;
      const committed = term.pledges.filter((p) => p.committed).length;
      const grant = term.number === 1 && world.tuning.termOpeningGrant ? ` It opens with a grant of ${nairaK(world.tuning.termOpeningGrant)} to build with.` : "";
      verdictEl.innerHTML = `<div class="top"><div class="title">Term ${term.number}: your pledges</div><button${committed > 0 ? ' class="primary"' : ""} data-verdict="close">${committed > 0 ? "Begin ▸" : "Later"}</button></div>
        <p class="lede">You run the state's transport for ${length} days a term.${grant} The state offers these, from what your towns need now. Pledge up to ${MAX_COMMITTED}: keep them and the next term's grant grows; keep none, or let the towns shrink, and it's a failed term. Two failed terms in a row and you're replaced.</p>
        ${pledgeChoices()}
        ${grantLine()}
        <p class="muted">Pledged: ${committed} of ${MAX_COMMITTED}. They stay in the panel, with how far each has got.</p>`;
      return;
    }
    const history = term.history;
    const last = history.at(-1);
    const grown = (r: { peopleFrom: number; peopleTo: number }) => r.peopleTo - r.peopleFrom;
    const signed = (x: number) => `${x >= 0 ? "+" : "−"}${int(Math.abs(x))}k`;
    const record = history.length ? `<h2>Your record</h2><table><thead><tr><th>Term</th><th>Pledges kept</th><th>The towns</th><th>Grant set</th><th></th></tr></thead><tbody>
      ${history.map((r) => `<tr><td>${r.number}</td><td>${r.kept.length} of ${r.kept.length + r.missed.length}</td><td>${int(r.peopleFrom)}k → ${int(r.peopleTo)}k (${signed(grown(r))})</td><td>${r.grant !== undefined ? nairaK(r.grant) : "—"}</td><td class="${r.failed ? "down" : "up"}">${r.failed === undefined ? "" : r.failed ? "failed" : "good"}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted">No term has ended yet.</p>`;
    if (mode === "record" || !last) {
      verdictEl.innerHTML = `<div class="top"><div class="title">Your record</div><span><button data-verdict="handover">The handover note</button> <button data-verdict="close">Back to the map ✕</button></span></div>${record}`;
      return;
    }
    const pledges = [...last.kept.map((t) => `<li class="kept">${esc(t)}</li>`), ...last.missed.map((t) => `<li class="missed">${esc(t)}</li>`)].join("");
    const standing = mode === "replaced" || term.replacedAtSeconds !== undefined ? "Replaced"
      : last.failed ? "One failed term: another and you're replaced" : last.failed === false ? "In good standing" : "";
    const lede = mode === "replaced"
      ? `Two failed terms in a row: the state has replaced you. Your record stands below. The save goes on if you keep playing, but the region is someone else's to run now.`
      : last.failed ? `A failed term: ${last.kept.length === 0 ? "no pledge kept" : "the towns shrank"}. Keep a pledge and grow the towns this term, or the state replaces you.`
      : `The state's verdict on term ${last.number}.`;
    verdictEl.innerHTML = `<div class="top"><div class="title">${mode === "replaced" ? "The state has replaced you" : `Term ${last.number}: the verdict`}</div>
      <button class="primary" data-verdict="close">${mode === "replaced" ? "Keep playing ▸" : `Begin term ${term.number} ▸`}</button></div>
      <div class="letterwith">${letterHtml(termLetter(world, last))}${thenAndNowSvg(world, (last.towns ?? []).map((t) => t.id))}</div>
      <p class="lede muted">${esc(lede)}</p>
      <div class="heroes">
        <div class="hero"><div class="k">Pledges kept</div><div class="v num">${last.kept.length} of ${last.kept.length + last.missed.length}</div></div>
        <div class="hero"><div class="k">The towns</div><div class="v num">${signed(grown(last))}</div><div class="k">${int(last.peopleFrom)}k → ${int(last.peopleTo)}k</div></div>
        <div class="hero"><div class="k">Grant for term ${term.number}</div><div class="v num">${last.grant !== undefined ? nairaK(last.grant) : "—"}</div></div>
        <div class="hero"><div class="k">Standing</div><div class="v" style="font-size:var(--fs-body)">${esc(standing)}</div></div>
      </div>
      <h2>Your pledges</h2>${pledges ? `<ul class="pledges">${pledges}</ul>` : `<p class="muted">You made none this term.</p>`}
      <h2>Term ${term.number}'s pledges on offer: pledge up to ${MAX_COMMITTED}</h2>${pledgeChoices()}${grantLine()}
      ${record}`;
  }

  // --- The revenue screen ------------------------------------------------------------

  const revenueOpen = () => revenueEl.classList.contains("open");
  function openRevenue(open: boolean): void {
    revenueEl.classList.toggle("open", open);
    if (open) renderRevenue();
  }

  /**
   * A day's money as one statement, over the same days as the strip's net (history.ts
   * averageBudget), so its net is the strip's: your lines in their four families -- passenger
   * fares and goods takings shared out by what each line takes, running costs and fuel above the
   * pump by what each costs -- then the roads, the state, the rest. What the treasury takes,
   * the year-end sweep and bonds aren't running costs (budget.ts): after the net, not in it.
   */
  interface MoneyRow { name: string; value: number; history: number[]; note?: string; income?: number; cost?: number }
  interface MoneySection { name: string; rows: MoneyRow[]; note?: string }
  function moneyStatement(): { sections: MoneySection[]; net: number; netHistory: number[]; after: MoneyRow[]; kept: number } {
    const avg = averageBudget(world) as unknown as Record<string, number>;
    const last = (k: string | string[]) => (Array.isArray(k) ? k : [k]).reduce((sum, key) => sum + (avg[key] ?? 0), 0);
    const ls = linesNow();
    const shareOf = (inGroup: (l: Line) => boolean, among: (l: Line) => boolean, of: (l: Line) => number) => {
      const total = ls.filter(among).reduce((sum, l) => sum + Math.max(0, of(l)), 0);
      return total > 0 ? ls.filter((l) => among(l) && inGroup(l)).reduce((sum, l) => sum + Math.max(0, of(l)), 0) / total : 0;
    };
    const ds = days();
    const families: MoneyRow[] = [];
    for (const g of GROUPS) {
      const inGroup = (l: Line) => l.family === g.family && l.mode === g.mode;
      if (!ls.some(inGroup)) continue;
      const income = last(g.family === "people" ? "fares" : "goods") * shareOf(inGroup, (l) => l.family === g.family, (l) => l.incomePerDay);
      const cost = last(["running", "fuel"]) * shareOf(inGroup, () => true, (l) => l.costPerDay);
      const history = ds.map((d) => [...d.routes, ...d.lorries].filter((x) => {
        const l = ls.find((y) => y.id === x.id);
        return l ? inGroup(l) : false;
      }).reduce((sum, x) => sum + x.netPerDay, 0));
      families.push({ name: g.name, value: income - cost, history, income, cost, note: `in ${nairaK(income)} · running ${nairaK(cost)}` });
    }
    const fuel = last("fuel");
    const row = (name: string, keys: string | string[], sign: 1 | -1, note?: string): MoneyRow => ({ name, value: sign * last(keys), history: dailyBudget(keys).map((v) => sign * v), note });
    const keep = (rows: MoneyRow[]) => rows.filter((r) => Math.abs(r.value) >= 1 || r.history.some((v) => Math.abs(v) >= 1));
    const sections: MoneySection[] = [
      { name: "Your lines", rows: [...families, ...keep([row("Metro fares", "metro", 1)])], note: fuel >= 1 ? `their running includes ${nairaK(fuel)} of fuel above the pump` : undefined },
      { name: "Roads", rows: keep([row("Tolls", "tolls", 1), row("Upkeep", ["upkeep", "enforcement"], -1)]) },
      { name: "The state", rows: keep([row("Allocation", "allocation", 1)]) },
      { name: "The rest", rows: keep([row("Park levies", "levies", 1, `the agberos kept ${nairaK(last("agberos"))}`), row("Loading levies", "loading", 1), row("Export payments", "exports", 1)]) },
    ].filter((sec) => sec.rows.length > 0);
    const net = sections.reduce((sum, sec) => sum + sec.rows.reduce((t, r) => t + r.value, 0), 0);
    const after = keep([row("Treasury levy", "remitted", -1), row("Year-end sweep", "swept", -1), row("Bonds and settlements", ["bonds", "settlements"], -1)]);
    const ins = dailyBudget(["fares", "goods", "metro", "tolls", "allocation", "levies", "loading", "exports"]);
    const outs = dailyBudget(["running", "fuel", "upkeep", "enforcement"]);
    return { sections, net, netHistory: ins.map((v, i) => v - (outs[i] ?? 0)), after, kept: net + after.reduce((sum, r) => sum + r.value, 0) };
  }

  /** The statement: a day's money, line by line of the budget. */
  function statementHtml(from: number): string {
    const m = moneyStatement();
    const spark = (values: number[]) => sparkline(values.slice(Math.max(from, values.length - 30)), css("--ink-2"));
    const sign = (v: number) => `<td class="num ${v < 0 ? "down" : v > 0 ? "up" : ""}">${v > 0 ? "+" : ""}${naira(v)}</td>`;
    return `<div class="card"><h3>A day's money</h3><div class="sub">5-day averages · the last 30 days beside each</div>
        <table class="statement"><tbody>
        ${m.sections.map((sec) => `<tr class="sec"><td colspan="3">${sec.name}${sec.note ? ` <span class="muted">· ${esc(sec.note)}</span>` : ""}</td></tr>${sec.rows.map((r) => `<tr><td>${esc(r.name)}${r.note ? `<span class="kind">${esc(r.note)}</span>` : ""}</td>${sign(r.value)}<td class="spark">${spark(r.history)}</td></tr>`).join("")}`).join("")}
        <tr class="total"><td>Net a day<span class="kind">as the strip shows it</span></td>${sign(m.net)}<td class="spark">${spark(m.netHistory)}</td></tr>
        ${m.after.length ? `<tr class="sec"><td colspan="3">Then, not running costs</td></tr>${m.after.map((r) => `<tr><td>${esc(r.name)}</td>${sign(r.value)}<td class="spark">${spark(r.history)}</td></tr>`).join("")}<tr class="total"><td>Kept a day</td>${sign(m.kept)}<td></td></tr>` : ""}
        </tbody></table></div>`;
  }

  /**
   * Every line's money, in its family: what it carried, took and cost a day, and its net as a
   * bar from a zero line -- earners right, bleeders left -- so the one bleeding shows at a look.
   */
  function linesMoneyHtml(): string {
    const ls = linesNow();
    if (ls.length === 0) return "";
    const most = Math.max(1, ...ls.map((l) => Math.abs(l.netPerDay)));
    const keys = { name: (l: Line) => lineName(l), carried: (l: Line) => l.carried, income: (l: Line) => l.incomePerDay, cost: (l: Line) => l.costPerDay, net: (l: Line) => l.netPerDay };
    const groups = GROUPS.map((g) => {
      const mine = ls.filter((l) => l.family === g.family && l.mode === g.mode);
      if (mine.length === 0) return "";
      return `<tr class="sec"><td colspan="6">${g.name}</td></tr>${sortRows(mine, "revenue", keys, `revenue:${g.id}`).map((l) => {
        const w = (Math.abs(l.netPerDay) / most) * 50;
        return `<tr class="row" data-pick="route|${l.id}"><td><span class="swatch" style="background:${lineSwatch(l)}"></span>${esc(lineName(l))} <span class="muted">${KIND_NAME[l.kind].one}</span></td><td>${carriedText(l)}</td><td>${naira(l.incomePerDay)}</td><td>${naira(l.costPerDay)}</td><td class="${l.netPerDay < 0 ? "down" : "up"}">${naira(l.netPerDay)}</td><td class="dcell"><span class="dbar"><i class="${l.netPerDay < 0 ? "neg" : "pos"}" style="${l.netPerDay < 0 ? "right:50%" : "left:50%"};width:${w}%"></i></span></td></tr>`;
      }).join("")}`;
    }).join("");
    return `<div class="card wide"><h3>Your lines</h3><div class="sub">Their figures today, a day · earning right of the line, losing left · click a column to sort, a line to open it</div>
      <table class="linesmoney"><thead><tr>${th("revenue", "name", "Line")}${th("revenue", "carried", "Carried")}${th("revenue", "income", "Income")}${th("revenue", "cost", "Cost")}${th("revenue", "net", "Net")}<th></th></tr></thead><tbody>${groups}</tbody></table></div>`;
  }

  /** Where a day's money comes from and where it goes, as a flow. */
  function flowHtml(): string {
    const m = moneyStatement();
    // A family's takings in and its running out, apart; the rest by its sign; then the treasury and bonds.
    const all = [...m.sections.flatMap((sec) => sec.rows), ...m.after];
    const ins = all.flatMap((r) => (r.income !== undefined ? (r.income >= 1 ? [{ name: `${r.name}: takings`, value: r.income }] : []) : r.value > 0 ? [{ name: r.name, value: r.value }] : []));
    const outs = all.flatMap((r) => (r.cost !== undefined ? (r.cost >= 1 ? [{ name: `${r.name}: running`, value: r.cost }] : []) : r.value < 0 ? [{ name: r.name, value: -r.value }] : []));
    if (m.kept > 0) outs.push({ name: "Kept", value: m.kept });
    else if (m.kept < 0) ins.push({ name: "From your savings", value: -m.kept });
    const total = Math.max(1, ins.reduce((sum, x) => sum + x.value, 0));
    const W = 1000;
    const rowGap = 8;
    const H = Math.max(200, 30 * Math.max(ins.length, outs.length) + 24);
    const usable = H - 24 - rowGap * Math.max(ins.length, outs.length);
    const scale = usable / total;
    const col = (items: Array<{ name: string; value: number }>, x: number, anchor: "start" | "end", colour: (name: string) => string) => {
      let y = 12;
      let mid = (H - total * scale) / 2;
      return items.map((it) => {
        const h = Math.max(2, it.value * scale);
        const out = { ...it, y, h, mid, x, anchor, colour: colour(it.name) };
        // Room for its label however small it is.
        y += Math.max(h + rowGap, 18);
        mid += it.value * scale;
        return out;
      });
    };
    const left = col(ins, 0, "start", (n) => (n === "From your savings" ? css("--bad") : css("--good")));
    const right = col(outs, W, "end", (n) => (n === "Kept" ? css("--you") : css("--warn")));
    const bx = W / 2 - 8;
    const band = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, colour: string) => {
      const c = (x0 + x1) / 2;
      return `<path d="M${x0},${y0} C${c},${y0} ${c},${y1} ${x1},${y1} L${x1},${y1 + h1} C${c},${y1 + h1} ${c},${y0 + h0} ${x0},${y0 + h0} Z" fill="${colour}" fill-opacity="0.28"/>`;
    };
    const svg = `<svg class="flow" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      ${left.map((it) => band(240, it.y, it.h, bx, it.mid, it.value * scale, it.colour)).join("")}
      ${right.map((it) => band(bx + 16, it.mid, it.value * scale, W - 240, it.y, it.h, it.colour)).join("")}
      <rect x="${bx}" y="${(H - total * scale) / 2}" width="16" height="${total * scale}" rx="3" fill="${css("--ink-2")}"/>
      ${left.map((it) => `<rect x="234" y="${it.y}" width="6" height="${it.h}" fill="${it.colour}"/><text x="228" y="${it.y + it.h / 2 + 4}" text-anchor="end" class="fl">${esc(it.name)} <tspan class="fv">${nairaK(it.value)}</tspan></text>`).join("")}
      ${right.map((it) => `<rect x="${W - 240}" y="${it.y}" width="6" height="${it.h}" fill="${it.colour}"/><text x="${W - 228}" y="${it.y + it.h / 2 + 4}" class="fl">${esc(it.name)} <tspan class="fv">${nairaK(it.value)}</tspan></text>`).join("")}
    </svg>`;
    return `<div class="card wide"><h3>Where a day's money comes from, and where it goes</h3><div class="sub">5-day averages, the strip's${m.kept < 0 ? " · more goes out than comes in: the difference comes from your savings" : ""}</div>${svg}</div>`;
  }

  function renderRevenue(): void {
    const ds = days();
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
    const total = (k: string) => ((ds[ds.length - 1]?.budget ?? {}) as Record<string, number>)[k] ?? 0;
    const n = now();
    const scroll = revenueEl.scrollTop;
    const netAndMoney = `<div class="card"><h3>Net a day and money held</h3><div class="sub">Net a day</div>${chartSvg([{ name: "Net a day", color: c("--you"), values: ds.map((d) => d.netPerDay) }], { height: 140, format: nairaK, from, zeroLine: true })}<div class="sub">Money held</div>${chartSvg([{ name: "Money", color: c("--ink-2"), values: ds.map((d) => d.funds) }], { height: 110, format: nairaK, from })}</div>`;
    const charts = `
        <div class="card"><h3>Income a day, by source</h3><div class="sub">5-day average, stacked</div>${key(income)}${chartSvg(income, { height: 200, stacked: true, format: nairaK, from })}</div>
        <div class="card"><h3>Costs a day, by kind</h3><div class="sub">5-day average, stacked</div>${key(costs)}${chartSvg(costs, { height: 200, stacked: true, format: nairaK, from })}</div>
        <div class="card"><h3>What the treasury took</h3><div class="sub">Its levy a day (5-day average), and each year-end sweep on its day</div><div class="keyrow">${treasury.map((x) => `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join("")}</div>${chartSvg(treasury, { height: 160, format: nairaK, from })}</div>
        <div class="card"><h3>Where the money went, all game</h3><div class="sub">Totals since day 1</div>
          <table><tbody>
            ${[["Fares", "fares"], ["Tolls", "tolls"], ["State allocation", "allocation"], ["Park levies (agberos kept " + nairaK(total("agberos")) + ")", "levies"], ["Goods", "goods"], ["Export payments", "exports"]].map(([l, k]) => `<tr><td>${l}</td><td class="up">+${nairaK(total(k!))}</td></tr>`).join("")}
            ${[["Running costs", "running"], ["Road upkeep", "upkeep"], ["Treasury levy", "remitted"], ["Swept at year end", "swept"], ["Fuel above the pump price", "fuel"]].map(([l, k]) => `<tr><td>${l}</td><td class="down">−${nairaK(total(k!))}</td></tr>`).join("")}
          </tbody></table></div>
        <div class="card wide treasury"><h3>The treasury</h3><div class="sub">Bonds, the named project, the chains, this period's budget</div><div class="panel-body">${hooks.treasuryMore()}</div></div>`;
    const ledgerStart = ds.length < 3 ? `<div class="card wide"><h3>The region is already moving</h3><div class="sub">Revenue charts begin after two days of records. Until then, here is what the region needs.</div>${hooks.chainsSummary()}</div>` : "";
    patchHtml(revenueEl, `
      <div class="top"><div class="title">Revenue · day ${n.day}</div>
        <div class="ranges">${[[0, "All"], [60, "60 days"], [30, "30 days"]].map(([k, label]) => `<button data-range="${k}" class="${range === k ? "on" : ""}">${label}</button>`).join("")}<button data-revenue="close">Back to the map ✕</button></div></div>
      ${ledgerStart}
      <div class="heroes">
        <div class="hero"><div class="k">Net a day</div><div class="v num ${n.netPerDay < 0 ? "down" : "up"}">${naira(n.netPerDay)}</div></div>
        <div class="hero"><div class="k">Your riders a day</div><div class="v num">${int(n.yourRiders)}</div></div>
        <div class="hero opens" data-show-overlay="noseat" role="button" title="Close this to see where on the No seat overlay"><div class="k">No seat a day ›</div><div class="v num">${int(n.noSeat)}</div></div>
        <div class="hero"><div class="k">Income a day</div><div class="v num">${naira(lastOf(income))}</div></div>
        <div class="hero"><div class="k">Costs a day</div><div class="v num">${naira(lastOf(costs))}</div></div>
        <div class="hero"><div class="k">Money</div><div class="v num">${naira(n.funds)}</div></div>
      </div>
      <div class="cards">${flowHtml()}${statementHtml(from)}${netAndMoney}${linesMoneyHtml()}${charts}</div>`);
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
    // A button inside a pickable row (the board's Sell) is its own: main.ts takes it.
    if (target.closest("[data-remove]")) return false;
    const el = target.closest<HTMLElement>("[data-tab],[data-back],[data-sort],[data-pick],[data-log],[data-event],[data-range],[data-revenue],[data-verdict],[data-rename],[data-chip]");
    if (!el || el.closest("details.more .panel-body")) return false;
    if (el.dataset.rename) {
      renaming = el.dataset.rename;
      renderPanel();
      document.querySelector<HTMLInputElement>("#panel .namein")?.focus();
      return true;
    }
    if (el.dataset.tab) {
      // The old "routes" (a Waiting on you button): the network.
      tab = el.dataset.tab === "routes" ? "network" : (el.dataset.tab as Tab);
      selected = null;
      renderPanel();
      return true;
    }
    if (el.dataset.chip) {
      const [name, value] = el.dataset.chip.split("|") as [string, string];
      if (name === "lines") lineFilter = value;
      else showIdle = !showIdle;
      renderPanel();
      return true;
    }
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
    if (el.dataset.verdict) { openVerdict(el.dataset.verdict === "close" ? null : (el.dataset.verdict as VerdictMode)); return true; }
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
    openVerdict,
    verdictOpen,
    /** Redraws the open verdict or pledge card (a pledge made from it). */
    refreshVerdict: () => { if (verdictOpen()) renderVerdict(verdictMode); },
    onClick,
    select,
    /** Naming done (kept or dropped): the field closes. */
    stopRenaming: () => { renaming = null; renderPanel(); },
    /** The named move a problem line's button offers. */
    namedMove: (key: string): NamedMove | undefined => named.get(key),
    /** The towns and sites on Waiting on you: the map marks these, and only these. */
    waitingTargets: (): Set<string> => new Set(waitingShown.flatMap((item) => item.at)),
    get selected() { return selected; },
    /** What the map focuses: a row hovered, else the thing picked. */
    get focus(): Selection { return hover ?? (selectedFromMap ? null : selected); },
  };
}
export type Screen = ReturnType<typeof createScreen>;
