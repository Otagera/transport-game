import type { GameTown, GameWorld } from "./types";
import { flowKey, type GoodsFlow } from "./goods";
import { refreshDemand, type GameEvent } from "./settlement";
import { addRoadToMap, isCutOff, roadPath, type ActionResult } from "./world";
import { rebuildNetworks } from "./rail";
import { isWater } from "../pathing/terrainAStar";
import { canAfford } from "../economy/state";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";
import { staffFactor } from "./workers";
import { siteScale } from "./expand";

// The fuel chain (docs/brief.md, Revision 3, step 1): goods that feel real,
// in chains. One site's output is another's input, and a site makes nothing
// without its input -- so a shortage travels down the chain to the towns at
// its end, where you see it.
//
//   crude source --crude--> refinery --fuel--> every town
//   tank farm (by the port) --imported fuel--> every town
//
// All three sites are there from the start (brownfield, principles §1):
//   - the tank farm imports fuel through the port, but only fuelImportShare
//     of what the towns need, joined to the port by an old road;
//   - the refinery is old and idle until you restore it (refineryRestoreCost),
//     then makes up to refineryShare of the need -- from crude actually
//     delivered to it, none without;
//   - crude comes from an oilfield on a south-south map, elsewhere from a
//     pipeline terminal at the map's edge (crude reaches the rest of the
//     country by pipeline).
//
// Every town burns fuel by its size. Fuel is goods like any other (goods.ts):
// it waits at a yard, your lorries and freight trains and the truckers' tankers
// carry it, it pays per tonne per cell, and what nobody moves is lost. Each
// cargo is named by the kind of site it leaves (crude from a source, fuel from
// the tank farm or the refinery), not a new cargo kind, so the engine's cargo
// types stay as the original game has them.
//
// Revision 4, step 4, a second refinery: mid-game (between newRefineryDayMin
// and newRefineryDayMax) a privately owned refinery opens by the port, already
// built (the Dangote story). Nobody restores it: it wants crude from the same
// source -- the long leg, where freight rail pays -- and its fuel has to get
// out. It fills what imports and the old refinery leave short, nearest it
// first; what no town needs leaves through the port. It arrives with no road:
// connecting it is the problem it brings, and its opening is announced loudly
// (playtest 2026-10-21: late changes went unseen).
//
// Step 1b, what a shortage does (a town's shortage: 1 - its fuel supplied,
// rolling; none where no road reaches): its danfos charge more, as a toll
// makes them (fuelFarePremium of the fare at a total shortage, so riders
// priced out stay home -- tick.ts sendInformal); some danfos park (the
// informal road budget on roads into it shrinks by fuelParked); its riders
// wait longer for your vehicles before giving up (fuelPatience); and your
// vehicles pay above the pump price on routes through it (fuelCostPremium,
// less than the danfos': the state buys fuel in bulk). Roadside sellers
// show where it's worst (render.ts).

export interface FuelState {
  depotId: string;
  refineryId: string;
  sourceId: string;
  restored: boolean;
  /** The second, private refinery: when it opens (economy seconds; 0, never), and its site once open. */
  newRefineryAt: number;
  newRefineryId: string | null;
  /** Tonnes a second the towns needed at the start: imports, the refinery and crude are sized from it. */
  baseDemand: number;
  /** Each town's shortage now, 0..1 (updateFuelShortage, every tick): what step 1b's effects read. */
  shortage: Map<string, number>;
}

const FUEL_SITES = new Set(["depot", "refinery", "newrefinery", "oilfield", "terminal"]);

export function isFuelSite(town: GameTown | undefined): boolean {
  return town?.industry !== undefined && FUEL_SITES.has(town.industry);
}

/** The towns that burn fuel: every town and roadside town, never a site. */
function burners(world: GameWorld): GameTown[] {
  return [...world.towns.values()].filter((town) => !town.industry);
}

/** Tonnes a second a town burns. */
export function fuelDemand(world: GameWorld, townId: string): number {
  const town = world.towns.get(townId);
  if (!town || town.industry) return 0;
  return (world.tuning.fuelPerThousandPerDay * town.population) / SECONDS_PER_GAME_DAY;
}

function totalDemand(world: GameWorld): number {
  return burners(world).reduce((sum, town) => sum + fuelDemand(world, town.id), 0);
}

/** Crude reaching a refinery now (the old one unless named), tonnes a second: yours and the truckers'. */
export function crudeArriving(world: GameWorld, refineryId = world.fuel?.refineryId): number {
  const fuel = world.fuel;
  if (!fuel || !refineryId) return 0;
  const outcome = world.goods.outcomes.get(flowKey({ from: fuel.sourceId, to: refineryId, kind: "supplies" }));
  return (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
}

/** The second refinery's site, once it's open (and the switch is on). */
export function newRefinery(world: GameWorld): GameTown | null {
  const id = world.fuel?.newRefineryId;
  return id && world.tuning.newRefineryEnabled ? (world.towns.get(id) ?? null) : null;
}

/** The most the second refinery can make, and the crude it wants, tonnes a second (0 before it opens). */
export function newRefineryCapacity(world: GameWorld): number {
  return world.fuel && newRefinery(world) ? world.tuning.newRefineryShare * world.fuel.baseDemand : 0;
}

export function newRefineryCrude(world: GameWorld): number {
  return world.fuel && newRefinery(world) ? world.tuning.newRefineryCrudeShare * world.fuel.baseDemand * staffFactor(world, world.fuel.sourceId) : 0;
}

/** What the second refinery makes now: its capacity or the crude it gets (crude to fuel at its own ratio), whichever is less. */
export function newRefineryOutput(world: GameWorld): number {
  const site = newRefinery(world);
  if (!site) return 0;
  const t = world.tuning;
  return Math.min(newRefineryCapacity(world), (crudeArriving(world, site.id) * t.newRefineryShare) / t.newRefineryCrudeShare) * staffFactor(world, site.id);
}

/** The most the refinery can make, tonnes a second, as built and expanded (expand.ts). */
export function refineryCapacity(world: GameWorld): number {
  const fuel = world.fuel;
  return fuel ? world.tuning.refineryShare * fuel.baseDemand * siteScale(world, fuel.refineryId) : 0;
}

/** What the refinery makes now, tonnes a second: its capacity, or the crude it gets, whichever is less. */
export function refineryOutput(world: GameWorld): number {
  const fuel = world.fuel;
  if (!fuel?.restored) return 0;
  return Math.min(refineryCapacity(world), crudeArriving(world)) * staffFactor(world, fuel.refineryId);
}

/**
 * The chain's flows (goods.ts adds them to everything else). Imports go
 * first, to the towns nearest the tank farm (by road, as tankers go); the
 * refinery then fills whatever's still short, nearest it first. Imports run
 * out on the far side of the map, which is where the refinery is, so a
 * working refinery reaches the towns the port's tankers barely do -- and it
 * can only add: split by one share everywhere, or refinery first, restoring
 * it lowered supply (90% -> 72%, 80%) by sending refinery fuel across the
 * map to towns next door to the tank farm. Crude flows to the refinery only
 * once it's restored.
 */
export function fuelFlows(world: GameWorld): GoodsFlow[] {
  const fuel = world.fuel;
  if (!fuel || !world.tuning.fuelEnabled || !world.tuning.goodsEnabled) return [];
  const depot = world.towns.get(fuel.depotId);
  const refinery = world.towns.get(fuel.refineryId);
  if (!depot || !refinery) return [];
  // By road, as the tankers go: a town that looks near the refinery may be a long drive from it.
  const byRoad = (from: string, to: string) => roadPath(world, from, to)?.distance ?? Infinity;
  const second = newRefinery(world);
  const towns = burners(world).map((town) => ({ town, need: fuelDemand(world, town.id), fromRefinery: 0, fromDepot: 0, fromNew: 0, dr: byRoad(refinery.id, town.id), dd: byRoad(depot.id, town.id), dn: second ? byRoad(second.id, town.id) : Infinity }));
  let refined = refineryOutput(world);
  let made = newRefineryOutput(world);
  // Each site makes what its workers let it (workers.ts).
  let imported = world.tuning.fuelImportShare * fuel.baseDemand * staffFactor(world, fuel.depotId);
  const unmet = (x: (typeof towns)[number]) => x.need - x.fromRefinery - x.fromDepot - x.fromNew;
  const fill = (source: "refinery" | "depot" | "new", order: typeof towns) => {
    for (const x of order) {
      const left = source === "refinery" ? refined : source === "new" ? made : imported;
      const take = Math.min(unmet(x), left);
      if (take <= 0) continue;
      if (source === "refinery") {
        x.fromRefinery += take;
        refined -= take;
      } else if (source === "new") {
        x.fromNew += take;
        made -= take;
      } else {
        x.fromDepot += take;
        imported -= take;
      }
    }
  };
  const byRefinery = [...towns].sort((p, q) => p.dr - q.dr);
  const byDepot = [...towns].sort((p, q) => p.dd - q.dd);
  // Imports first, nearest the tank farm first (a town no road reaches still
  // gets its share: it waits for one, and its card says so); then the
  // refinery fills what's still short, nearest it first -- the far side.
  fill("depot", byDepot);
  fill("refinery", byRefinery.filter((x) => Number.isFinite(x.dr)));
  // The second refinery last, nearest it first; by road only, as the old one.
  if (second) fill("new", [...towns].filter((x) => Number.isFinite(x.dn)).sort((p, q) => p.dn - q.dn));
  const flows: GoodsFlow[] = [];
  for (const x of towns) {
    if (x.fromRefinery > 0) flows.push({ from: fuel.refineryId, to: x.town.id, kind: "supplies", rate: x.fromRefinery });
    if (x.fromDepot > 0) flows.push({ from: fuel.depotId, to: x.town.id, kind: "supplies", rate: x.fromDepot });
    if (second && x.fromNew > 0) flows.push({ from: second.id, to: x.town.id, kind: "supplies", rate: x.fromNew });
  }
  if (fuel.restored) flows.push({ from: fuel.sourceId, to: fuel.refineryId, kind: "supplies", rate: world.tuning.crudeShare * fuel.baseDemand * siteScale(world, fuel.refineryId) * staffFactor(world, fuel.sourceId) });
  if (second) {
    // What no town needs leaves through the port: its fuel always has somewhere to go.
    if (made > 0 && world.port && world.towns.has(world.port)) flows.push({ from: second.id, to: world.port, kind: "supplies", rate: made });
    flows.push({ from: fuel.sourceId, to: second.id, kind: "supplies", rate: newRefineryCrude(world) });
  }
  return flows;
}

/** What a goods flow carries, named by the kind of site it leaves. */
export function cargoName(world: GameWorld, from: string, kind: "produce" | "supplies", to?: string): string {
  const site = world.towns.get(from)?.industry;
  // The food chain (food.ts): a farm town's staple to the mill, its cash crop to the port; the mill's food.
  const food = world.food && world.tuning.foodEnabled ? world.food : null;
  if (food && site === "mill") return food.crops.food;
  if (food && site === "flourmill") return "flour";
  if (food && to !== undefined && to === food.flourMillId) return "wheat";
  if (food && !site && kind === "produce") return to === world.port ? food.crops.cash : to === food.millId ? food.crops.staple : `${food.crops.staple} and ${food.crops.cash}`;
  if (site === "oilfield" || site === "terminal") return "crude";
  if (site === "depot" || site === "refinery" || site === "newrefinery") return "fuel";
  if (site === "works" || site === "silo") return "cement";
  if (site === "quarry") return world.cement && world.tuning.cementEnabled ? "limestone" : "stone";
  return kind;
}

/** How well a town is supplied with fuel, 0..1, and the share from each source (refined: both refineries; second: the private one's part). */
export function fuelSupply(world: GameWorld, townId: string): { supplied: number; imported: number; refined: number; second: number } | null {
  const fuel = world.fuel;
  const demand = fuelDemand(world, townId);
  if (!fuel || demand <= 0) return null;
  const got = (from: string) => {
    const outcome = world.goods.outcomes.get(flowKey({ from, to: townId, kind: "supplies" }));
    return ((outcome?.delivered ?? 0) + (outcome?.trucked ?? 0)) / demand;
  };
  const imported = got(fuel.depotId);
  const second = fuel.newRefineryId && world.tuning.newRefineryEnabled ? got(fuel.newRefineryId) : 0;
  const refined = got(fuel.refineryId) + second;
  return { supplied: Math.min(1, imported + refined), imported, refined, second };
}

/** Recomputes every town's shortage, once a tick (tick.ts), from the rolling fuel supplied. No road, no traffic: none counted. */
export function updateFuelShortage(world: GameWorld): void {
  const fuel = world.fuel;
  if (!fuel) return;
  fuel.shortage.clear();
  if (!world.tuning.fuelEnabled || !world.tuning.goodsEnabled) return;
  for (const town of burners(world)) {
    if (isCutOff(world, town.id)) continue;
    const supply = fuelSupply(world, town.id);
    if (supply) fuel.shortage.set(town.id, 1 - supply.supplied);
  }
}

/** A town's shortage, 0..1: 0 with fuel off, no fuel chain, or a site. */
export function shortageAt(world: GameWorld, townId: string): number {
  return world.fuel?.shortage.get(townId) ?? 0;
}

/** Your vehicles' fuel above the pump price this tick, by route: on a route, the mean shortage of the towns it stops at. */
export function chargeFuelPremium(world: GameWorld, dt: number, routeOf: ReadonlyMap<string, string>): { total: number; byRoute: Map<string, number> } {
  const byRoute = new Map<string, number>();
  let total = 0;
  if (!world.fuel || world.fuel.shortage.size === 0) return { total, byRoute };
  const premium = world.tuning.fuelCostPremium;
  const routeShortage = new Map<string, number>();
  for (const vehicle of world.simulation.vehicles) {
    const routeId = routeOf.get(vehicle.id);
    const econ = world.economy.vehicleEconomics.get(vehicle.id);
    if (!routeId || !econ) continue;
    let shortage = routeShortage.get(routeId);
    if (shortage === undefined) {
      const stops = [...new Set(vehicle.path)].filter((id) => !world.towns.get(id)?.industry);
      shortage = stops.length > 0 ? stops.reduce((sum, id) => sum + shortageAt(world, id), 0) / stops.length : 0;
      routeShortage.set(routeId, shortage);
    }
    const extra = econ.operatingCostPerSecond * premium * shortage * dt;
    if (extra <= 0) continue;
    total += extra;
    byRoute.set(routeId, (byRoute.get(routeId) ?? 0) + extra);
  }
  world.economy.funds -= total;
  return { total, byRoute };
}

/** Restores the old refinery: from now on it turns crude delivered to it into fuel. */
export function restoreRefinery(world: GameWorld): ActionResult & { charged?: number } {
  const fuel = world.fuel;
  if (!world.tuning.fuelEnabled || !world.tuning.goodsEnabled) return { ok: false, reason: SWITCHED_OFF };
  if (!fuel) return { ok: false, reason: "no refinery on this map" };
  if (fuel.restored) return { ok: false, reason: "already working" };
  const cost = world.tuning.refineryRestoreCost;
  if (!canAfford(world.economy, cost)) return { ok: false, reason: "can't afford it" };
  world.economy.funds -= cost;
  fuel.restored = true;
  refreshDemand(world); // its workers come back (workers.ts)
  return { ok: true, charged: cost };
}

// --- Placing the sites ---------------------------------------------------------

export function dry(world: GameWorld, x: number, y: number, clearance: number): boolean {
  const { terrain } = world.simulation.map;
  if (x < 3 || y < 3 || x > world.width - 4 || y > world.height - 4) return false;
  for (let dy = -clearance; dy <= clearance; dy += 1) for (let dx = -clearance; dx <= clearance; dx += 1) if (isWater(terrain, x + dx, y + dy)) return false;
  return true;
}

export function nearestDistance(world: GameWorld, x: number, y: number): number {
  return Math.min(...[...world.towns.values()].map((town) => Math.hypot(town.x - x, town.y - y)));
}

/** A dry spot `minR`-`maxR` cells from (cx, cy) and at least `clear` from every town and site; the one scoring best. */
export function ringSpot(world: GameWorld, cx: number, cy: number, minR: number, maxR: number, clear: number, score: (x: number, y: number) => number): { x: number; y: number } | null {
  let best: { x: number; y: number; s: number } | null = null;
  for (let r = minR; r <= maxR; r += 1) {
    for (let k = 0; k < 24; k += 1) {
      const angle = (k / 24) * Math.PI * 2;
      const x = Math.round(cx + r * Math.cos(angle));
      const y = Math.round(cy + r * Math.sin(angle));
      if (!dry(world, x, y, 1) || nearestDistance(world, x, y) < clear) continue;
      const s = score(x, y);
      if (!best || s > best.s) best = { x, y, s };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

export function addSite(world: GameWorld, id: string, name: string, kind: GameTown["industry"], at: { x: number; y: number }): GameTown {
  const site: GameTown = { id, name, x: at.x, y: at.y, population: world.tuning.industryWorkers, industry: kind };
  world.simulation.map.nodes.push({ id, kind: "settlement", x: site.x, y: site.y });
  world.towns.set(id, site);
  world.simulation.queues.set(id, new Map());
  return site;
}

/**
 * Places the chain's three sites on a new game's map, before the warm-up
 * (start.ts): the tank farm 7-9 cells from the port with an old road to it;
 * the idle refinery 9-13 cells from the second city, on its side away from
 * the port, so fuel has somewhere to go; the crude source on the map's edge
 * as far from the refinery as it can be (at least 30 cells: the long leg,
 * rail's). None if fuel's off or a site won't fit.
 */
export function placeFuelSites(world: GameWorld, region: string | undefined): void {
  if (!world.tuning.fuelEnabled || !world.tuning.goodsEnabled || world.fuel) return;
  const port = world.port ? world.towns.get(world.port) : undefined;
  if (!port) return;
  const second = [...world.towns.values()].filter((town) => town.id !== port.id && !town.industry).sort((p, q) => q.population - p.population)[0];
  if (!second) return;
  const fromPort = (x: number, y: number) => Math.hypot(x - port.x, y - port.y);
  // Far enough from the port that their names don't sit on each other.
  const depotAt = ringSpot(world, port.x, port.y, 7, 9, 6, (x, y) => -Math.hypot(x - second.x, y - second.y));
  if (!depotAt) return;
  const refineryAt = ringSpot(world, second.x, second.y, 9, 13, 8, fromPort);
  if (!refineryAt) return;
  let sourceAt: { x: number; y: number; s: number } | null = null;
  for (let x = 3; x <= world.width - 4; x += 2) {
    for (const y of [3, world.height - 4]) {
      if (!dry(world, x, y, 1) || nearestDistance(world, x, y) < 8) continue;
      const s = Math.hypot(x - refineryAt.x, y - refineryAt.y);
      if (!sourceAt || s > sourceAt.s) sourceAt = { x, y, s };
    }
  }
  for (let y = 3; y <= world.height - 4; y += 2) {
    for (const x of [3, world.width - 4]) {
      if (!dry(world, x, y, 1) || nearestDistance(world, x, y) < 8) continue;
      const s = Math.hypot(x - refineryAt.x, y - refineryAt.y);
      if (!sourceAt || s > sourceAt.s) sourceAt = { x, y, s };
    }
  }
  // The crude leg is the long one, the leg freight rail is for.
  if (!sourceAt || sourceAt.s < 30) return;
  const nearestTown = (x: number, y: number) =>
    [...world.towns.values()].filter((town) => !town.industry).sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y))[0]!;
  const oil = region === "southSouth";
  const baseDemand = totalDemand(world);
  addSite(world, "fuel-depot", `${port.name} Tank Farm`, "depot", depotAt);
  addSite(world, "fuel-refinery", `${second.name} Refinery`, "refinery", refineryAt);
  addSite(world, "fuel-source", `${nearestTown(sourceAt.x, sourceAt.y).name} ${oil ? "Oilfield" : "Terminal"}`, oil ? "oilfield" : "terminal", sourceAt);
  // The tank farm's old road to the port: imports have always come this way.
  addRoadToMap(world.simulation.map, "fuel-depot-road", "fuel-depot", port.id, "inherited");
  const road = world.simulation.map.segments.find((segment) => segment.id === "fuel-depot-road")!;
  road.condition = world.tuning.wearEnabled ? world.tuning.inheritedRoadCondition : 1;
  // The second refinery's day, drawn from where the sites fell (a seed of its
  // own: drawing from the industries' would move every quarry of a game).
  const t = world.tuning;
  const hash = (Math.imul(depotAt.x * 73 + refineryAt.y, 2654435761) ^ Math.imul(sourceAt.x * 31 + sourceAt.y, 40503)) >>> 0;
  const day = t.newRefineryDayMin + ((hash % 1000) / 1000) * (t.newRefineryDayMax - t.newRefineryDayMin);
  const newRefineryAt = t.newRefineryEnabled ? day * SECONDS_PER_GAME_DAY : 0;
  world.fuel = { depotId: "fuel-depot", refineryId: "fuel-refinery", sourceId: "fuel-source", restored: false, newRefineryAt, newRefineryId: null, baseDemand, shortage: new Map() };
  world.plans = null;
  rebuildNetworks(world);
  refreshDemand(world);
}

/**
 * Opens the second refinery when its day comes (tick.ts, every tick): by the
 * port, 10-16 cells from it on dry ground clear of the towns, as far from the
 * crude source as fits -- crude's leg the long one. No road: connecting it is
 * the problem it brings. Null until then, or if it's off or nothing fits.
 */
export function updateNewRefinery(world: GameWorld): GameEvent | null {
  const fuel = world.fuel;
  const t = world.tuning;
  if (!fuel || fuel.newRefineryId || !fuel.newRefineryAt || !t.newRefineryEnabled || !t.fuelEnabled || !t.goodsEnabled) return null;
  if (world.economy.elapsedSeconds < fuel.newRefineryAt) return null;
  fuel.newRefineryAt = 0; // once: if nothing fits, it never opens
  const port = world.port ? world.towns.get(world.port) : undefined;
  const source = world.towns.get(fuel.sourceId);
  if (!port || !source) return null;
  const at = ringSpot(world, port.x, port.y, 10, 16, 8, (x, y) => Math.hypot(x - source.x, y - source.y));
  if (!at) return null;
  const near = [...world.towns.values()].filter((town) => !town.industry).sort((p, q) => Math.hypot(p.x - at.x, p.y - at.y) - Math.hypot(q.x - at.x, q.y - at.y))[0]!;
  const taken = new Set([...world.towns.values(), ...world.ruins.values()].map((town) => town.name));
  const name = [`${near.name} Refinery`, `${near.name} New Refinery`].find((n) => !taken.has(n)) ?? `${near.name} Refinery (${world.nextId})`;
  addSite(world, "fuel-newrefinery", name, "newrefinery", at);
  fuel.newRefineryId = "fuel-newrefinery";
  world.plans = null;
  rebuildNetworks(world);
  refreshDemand(world);
  return { kind: "refinery-opened", townId: fuel.newRefineryId, name, near: near.id, crude: newRefineryCrude(world) * SECONDS_PER_GAME_DAY, fuel: newRefineryCapacity(world) * SECONDS_PER_GAME_DAY };
}
