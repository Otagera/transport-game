import type { GameTown, GameWorld } from "./types";
import { flowKey, servedRate, type GoodsFlow } from "./goods";
import { refreshDemand } from "./settlement";
import { isCutOff, roadPath, type ActionResult } from "./world";
import { rebuildNetworks } from "./rail";
import { addSite, builtUp, dry, homeBox, inHome, nearestDistance } from "./fuel";
import { inheritedRoad } from "./cement";
import { farmland, farmTowns, marketTowns } from "./food";
import { exportGateway, importsArriving, portScale } from "./gateways";
import { canAfford, SECONDS_PER_GAME_DAY } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";
import { staffFactor } from "./workers";
import { siteScale } from "./expand";
import { powerLift } from "./power";

// Cotton and the textile mill (docs/brief.md, Cotton and the textile mill, agreed 2026-11-03).
//
//   (north) the far clusters' farm towns --cotton--> textile mill --cloth--> market towns
//   (elsewhere) the border crossing, or the port --cotton--> textile mill
//   textile mill --cloth the markets don't take--> its way out, for export pay
//
// The mill is the Kaduna story: built, run down, shut. Idle at the start of every game, in the
// home cluster near its biggest towns, with an old road; restored (`textileRestoreCost`, or a
// bond) it wants cotton and employs more than any site (`jobsTextile`). On a northern map cotton
// is grown by the far clusters' farm towns -- opening one brings it home, a long haul that's yours;
// elsewhere a share of what the mill can use comes over the border crossing (as fuel comes to the
// north), or through the port where there's none. Cloth goes to the market towns its road reaches,
// split by want, and a market with cloth draws more trade (trips to it, as food's do). What the
// markets don't take goes out by the mill's way out, paid a tonne (your rule: everything is
// exportable, given locals have no use for it or can't get to it).

export interface TextileState {
  millId: string;
  working: boolean;
  /** Where its cotton comes from: the far clusters' farm towns (a northern map), the border crossing, or the port. */
  source: "farms" | "border" | "port";
  /** Tonnes a second of cloth the markets wanted at the start: the mill is sized from it. */
  baseWant: number;
}

export const TEXTILE_MILL_ID = "textile-mill";

/** The chain runs: placed, and switched on (absent in older runs: off, as played). */
export function textileActive(world: GameWorld): boolean {
  return !!world.textile && !!world.tuning.textileEnabled && world.tuning.goodsEnabled;
}

/** Tonnes a second of cloth a market town wants. */
export function clothWant(world: GameWorld, townId: string): number {
  const town = world.towns.get(townId);
  if (!town || town.industry || !world.basePopulation.has(townId) || town.population < world.tuning.marketPopulation) return 0;
  return ((world.tuning.clothPerThousandPerDay ?? 0) * town.population) / SECONDS_PER_GAME_DAY;
}

/** The most the mill can make, tonnes of cloth a second. */
export function textileCapacity(world: GameWorld): number {
  const textile = world.textile;
  return textile ? (world.tuning.textileMillShare ?? 0) * textile.baseWant * siteScale(world, textile.millId) : 0;
}

/** The farm towns that grow cotton: a northern map's, outside the home cluster. None elsewhere. */
export function cottonTowns(world: GameWorld): GameTown[] {
  if (world.textile?.source !== "farms") return [];
  return farmTowns(world).filter((town) => !inHome(world, town));
}

/** Tonnes a second of cotton a farm town grows (working mill only: nobody buys it otherwise). */
function cottonGrown(world: GameWorld, town: GameTown): number {
  return world.textile?.working ? ((world.tuning.cottonPerThousandPerDay ?? 0) * farmland(world, town)) / SECONDS_PER_GAME_DAY : 0;
}

/** Cotton over the border or through the port, tonnes a second: a share of what the mill can use, while it works. */
export function cottonImports(world: GameWorld): number {
  const textile = world.textile;
  if (!textile?.working || textile.source === "farms") return 0;
  const t = world.tuning;
  const need = textileCapacity(world) * (t.cottonPerCloth ?? 1);
  // Through the port, as any import: the share that reaches the home city, by the port's rung.
  return (t.cottonImportShare ?? 0) * need * (textile.source === "port" ? importsArriving(world) * portScale(world) : 1);
}

/** Where cotton comes into the mill from, outside the farms: the border crossing or the port. */
function cottonGate(world: GameWorld): string | null {
  const textile = world.textile;
  if (!textile) return null;
  if (textile.source === "border") return world.border && world.towns.has(world.border) ? world.border : null;
  if (textile.source === "port") return world.port && world.towns.has(world.port) ? world.port : null;
  return null;
}

/** Cotton reaching the mill now, tonnes a second: yours and the truckers'. */
export function cottonArriving(world: GameWorld): number {
  const textile = world.textile;
  if (!textile) return 0;
  const from = textile.source === "farms" ? cottonTowns(world).map((town) => town.id) : [cottonGate(world)].filter((id): id is string => !!id);
  let total = 0;
  for (const id of from) {
    const outcome = world.goods.outcomes.get(flowKey({ from: id, to: textile.millId, kind: "produce" }));
    total += (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
  }
  return total;
}

/** What the mill makes now: its capacity, or what the cotton arriving makes, by its staffing (and power). */
export function textileOutput(world: GameWorld): number {
  const textile = world.textile;
  if (!textile?.working) return 0;
  return Math.min(textileCapacity(world), cottonArriving(world) / (world.tuning.cottonPerCloth ?? 1)) * staffFactor(world, textile.millId) * powerLift(world, textile.millId);
}

/**
 * The chain's flows (goods.ts adds them): cotton to a working mill -- from each far farm town on a
 * northern map, by its land; else from the border crossing or the port -- and its cloth split over
 * the market towns its road reaches by what each wants, the rest to its way out for export.
 */
export function textileFlows(world: GameWorld): GoodsFlow[] {
  const textile = world.textile;
  if (!textile || !textileActive(world) || !textile.working) return [];
  const flows: GoodsFlow[] = [];
  if (textile.source === "farms") {
    for (const town of cottonTowns(world)) flows.push({ from: town.id, to: textile.millId, kind: "produce", rate: cottonGrown(world, town) });
  } else {
    const gate = cottonGate(world);
    if (gate) flows.push({ from: gate, to: textile.millId, kind: "produce", rate: cottonImports(world) });
  }
  const made = textileOutput(world);
  if (made <= 0) return flows;
  const takers = marketTowns(world).filter((town) => roadPath(world, textile.millId, town.id));
  const wanted = takers.reduce((sum, town) => sum + clothWant(world, town.id), 0);
  const share = wanted > 0 ? Math.min(1, made / wanted) : 0;
  for (const town of takers) {
    const rate = clothWant(world, town.id) * share;
    if (rate > 0) flows.push({ from: textile.millId, to: town.id, kind: "supplies", rate });
  }
  // The rest, out: everything is exportable. Where the way out is a market too (the home city on
  // the coast), one flow there: its want and the export together (clothExported takes its part).
  const out = clothWay(world);
  const left = made - wanted * share;
  if (out && left > 1e-12) {
    const there = flows.find((f) => f.from === textile.millId && f.to === out.to);
    if (there) there.rate += left;
    else flows.push({ from: textile.millId, to: out.to, kind: "supplies", rate: left });
  }
  return flows;
}

/** Tonnes a second of the mill's cloth bound out for export now (what the markets don't take). */
function clothForExport(world: GameWorld): number {
  const textile = world.textile;
  if (!textile) return 0;
  const made = textileOutput(world);
  const takers = marketTowns(world).filter((town) => roadPath(world, textile.millId, town.id));
  const wanted = takers.reduce((sum, town) => sum + clothWant(world, town.id), 0);
  return Math.max(0, made - wanted);
}

/** The mill's way out for cloth: the port or the border, whichever nets more a tonne by road (gateways.ts). */
function clothWay(world: GameWorld): { to: string; pay: number } | null {
  const textile = world.textile;
  if (!textile) return null;
  const way = exportGateway(world, textile.millId);
  if (!way || !world.towns.has(way.to) || !roadPath(world, textile.millId, way.to)) return null;
  // Cloth is worth more a tonne than a crop: the gateway's pay in its proportion.
  return { to: way.to, pay: way.pay * ((world.tuning.clothExportPay ?? 0) / world.tuning.exportPayPerTonne) };
}

/** Of the cloth a market town wants, the share delivered (yours and the truckers'), 0..1. */
export function clothServed(world: GameWorld, townId: string): number {
  const textile = world.textile;
  const want = clothWant(world, townId);
  if (!textile || want <= 0) return 0;
  return Math.min(1, servedRate(world, world.goods.outcomes.get(flowKey({ from: textile.millId, to: townId, kind: "supplies" }))) / want);
}

/** Cloth reaching the way out for export now, tonnes a second (anyone's): where the way out is a market too, the export's share of what arrives. */
export function clothExported(world: GameWorld): number {
  const textile = world.textile;
  const out = clothWay(world);
  if (!textile || !out) return 0;
  const forExport = clothForExport(world);
  if (forExport <= 0) return 0;
  const outcome = world.goods.outcomes.get(flowKey({ from: textile.millId, to: out.to, kind: "supplies" }));
  const arrived = (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
  // Exporting, every market is served in full: the flow there is its own want and the export.
  const ownWant = roadPath(world, textile.millId, out.to) ? clothWant(world, out.to) : 0;
  return arrived * (forExport / (forExport + ownWant));
}

/** The state's export payment for cloth this tick (tick.ts, with the crops'): a sum a tonne that gets out. */
export function payClothExports(world: GameWorld, dt: number): number {
  if (!textileActive(world)) return 0;
  const out = clothWay(world);
  if (!out) return 0;
  const paid = clothExported(world) * out.pay * dt;
  if (paid <= 0) return 0;
  world.economy.funds += paid;
  world.budget.exports += paid;
  return paid;
}

/**
 * Cloth trade (settlement.ts refreshDemand, after the food's): a market with cloth draws more --
 * every trip to or from it grows by `clothTripBoost` at all it wants, less as it runs short.
 */
export function applyClothTrade(world: GameWorld): void {
  const boost = world.tuning.clothTripBoost ?? 0;
  if (!textileActive(world) || boost <= 0 || !world.textile?.working) return;
  const by = new Map(marketTowns(world).map((town) => [town.id, boost * clothServed(world, town.id)]));
  for (const pair of world.simulation.demand) {
    const extra = Math.max(by.get(pair.from) ?? 0, by.get(pair.to) ?? 0);
    if (extra > 0) pair.rate *= 1 + extra;
  }
}

/** Restores the idle mill: from now on it wants cotton, employs its shift, and makes cloth. */
export function restoreTextile(world: GameWorld): ActionResult & { charged?: number } {
  const textile = world.textile;
  if (!textileActive(world) || !textile) return { ok: false, reason: SWITCHED_OFF };
  if (textile.working) return { ok: false, reason: "already working" };
  const cost = world.tuning.textileRestoreCost ?? 0;
  if (!canAfford(world.economy, cost)) return { ok: false, reason: "can't afford it" };
  world.economy.funds -= cost;
  textile.working = true;
  refreshDemand(world); // its shift comes back (workers.ts)
  return { ok: true, charged: cost };
}

/**
 * Places the idle mill on a new game's map, before the warm-up (start.ts), after every other site
 * (so they sit where they did): in the home cluster, the dry spot nearest its market towns' middle
 * (by size) that's 8+ cells from any town and within 16 of one on the network, with an old road to
 * that one. Its cotton: a northern map's far farm towns; else the border crossing; else the port.
 */
export function placeTextile(world: GameWorld, region: string | undefined): void {
  const t = world.tuning;
  if (!t.textileEnabled || !t.goodsEnabled || world.textile) return;
  const markets = marketTowns(world).filter((town) => inHome(world, town));
  const centre = markets.length > 0 ? markets : [...world.towns.values()].filter((town) => !town.industry && inHome(world, town));
  if (centre.length === 0) return;
  const weight = centre.reduce((sum, town) => sum + town.population, 0);
  const cx = centre.reduce((sum, town) => sum + town.x * town.population, 0) / weight;
  const cy = centre.reduce((sum, town) => sum + town.y * town.population, 0) / weight;
  const linked = [...world.towns.values()].filter((town) => !town.industry && !isCutOff(world, town.id) && inHome(world, town));
  if (linked.length === 0) return;
  const nearLinked = (x: number, y: number) => Math.min(...linked.map((town) => Math.hypot(town.x - x, town.y - y)));
  // Past where any town is built up (map version 3: the port's sites stand outside the city).
  const towns = [...world.towns.values()].filter((town) => !town.industry);
  const inTown = (x: number, y: number) => towns.some((town) => Math.hypot(town.x - x, town.y - y) < builtUp(town.population) + 2);
  const box = homeBox(world);
  let best: { x: number; y: number; s: number } | null = null;
  for (let y = box.y + 4; y < box.y + box.height - 4; y += 1) {
    for (let x = box.x + 4; x < box.x + box.width - 4; x += 1) {
      if (!dry(world, x, y, 2) || nearestDistance(world, x, y) < 8 || nearLinked(x, y) > 16 || inTown(x, y)) continue;
      const s = -Math.hypot(x - cx, y - cy);
      if (!best || s > best.s) best = { x, y, s };
    }
  }
  if (!best) return;
  const near = [...linked].sort((p, q) => Math.hypot(p.x - best!.x, p.y - best!.y) - Math.hypot(q.x - best!.x, q.y - best!.y))[0]!;
  const baseWant = marketTowns(world).reduce((sum, town) => sum + clothWant(world, town.id), 0);
  addSite(world, TEXTILE_MILL_ID, `${near.name} Textiles`, "textile", best);
  inheritedRoad(world, "textile-mill-road", TEXTILE_MILL_ID, near.id);
  const north = region === "north" || region === "northeast";
  const source: TextileState["source"] = north ? "farms" : world.border && world.towns.has(world.border) ? "border" : "port";
  world.textile = { millId: TEXTILE_MILL_ID, working: false, source, baseWant };
  world.plans = null;
  rebuildNetworks(world);
  refreshDemand(world);
}

/**
 * Where the chain is broken, for the mill's card and Waiting on you (as cement.ts cementBreak):
 *   - idle: not restored;
 *   - cotton: working, but little cotton arrives -- from the far farm towns (connect them), or the gateway;
 *   - carry: it makes cloth; the markets aren't getting it.
 */
export type TextileBreak = { kind: "idle" } | { kind: "cotton"; from: string[] } | { kind: "carry" };

export function textileBreak(world: GameWorld): TextileBreak | null {
  const textile = world.textile;
  if (!textile || !textileActive(world)) return null;
  if (!textile.working) return { kind: "idle" };
  const capacity = textileCapacity(world);
  if (capacity > 0 && cottonArriving(world) / (world.tuning.cottonPerCloth ?? 1) < 0.6 * capacity) {
    const from = textile.source === "farms" ? cottonTowns(world).map((town) => town.id) : [cottonGate(world)].filter((id): id is string => !!id);
    return { kind: "cotton", from };
  }
  return { kind: "carry" };
}
