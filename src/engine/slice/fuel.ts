import type { SliceTown, SliceWorld } from "./types";
import { flowKey, type GoodsFlow } from "./goods";
import { refreshDemand } from "./settlement";
import { addRoadToMap, isCutOff, roadPath, type ActionResult } from "./world";
import { rebuildNetworks } from "./rail";
import { isWater } from "../pathing/terrainAStar";
import { canAfford } from "../economy/state";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";
import { staffFactor } from "./workers";

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
  /** Tonnes a second the towns needed at the start: imports, the refinery and crude are sized from it. */
  baseDemand: number;
  /** Each town's shortage now, 0..1 (updateFuelShortage, every tick): what step 1b's effects read. */
  shortage: Map<string, number>;
}

const FUEL_SITES = new Set(["depot", "refinery", "oilfield", "terminal"]);

export function isFuelSite(town: SliceTown | undefined): boolean {
  return town?.industry !== undefined && FUEL_SITES.has(town.industry);
}

/** The towns that burn fuel: every town and roadside town, never a site. */
function burners(world: SliceWorld): SliceTown[] {
  return [...world.towns.values()].filter((town) => !town.industry);
}

/** Tonnes a second a town burns. */
export function fuelDemand(world: SliceWorld, townId: string): number {
  const town = world.towns.get(townId);
  if (!town || town.industry) return 0;
  return (world.tuning.fuelPerThousandPerDay * town.population) / SECONDS_PER_GAME_DAY;
}

function totalDemand(world: SliceWorld): number {
  return burners(world).reduce((sum, town) => sum + fuelDemand(world, town.id), 0);
}

/** Crude reaching the refinery now, tonnes a second: yours and the truckers'. */
function crudeArriving(world: SliceWorld): number {
  const fuel = world.fuel;
  if (!fuel) return 0;
  const outcome = world.goods.outcomes.get(flowKey({ from: fuel.sourceId, to: fuel.refineryId, kind: "supplies" }));
  return (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
}

/** What the refinery makes now, tonnes a second: its capacity, or the crude it gets, whichever is less. */
export function refineryOutput(world: SliceWorld): number {
  const fuel = world.fuel;
  if (!fuel?.restored) return 0;
  return Math.min(world.tuning.refineryShare * fuel.baseDemand, crudeArriving(world)) * staffFactor(world, fuel.refineryId);
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
export function fuelFlows(world: SliceWorld): GoodsFlow[] {
  const fuel = world.fuel;
  if (!fuel || !world.tuning.fuelEnabled || !world.tuning.goodsEnabled) return [];
  const depot = world.towns.get(fuel.depotId);
  const refinery = world.towns.get(fuel.refineryId);
  if (!depot || !refinery) return [];
  // By road, as the tankers go: a town that looks near the refinery may be a long drive from it.
  const byRoad = (from: string, to: string) => roadPath(world, from, to)?.distance ?? Infinity;
  const towns = burners(world).map((town) => ({ town, need: fuelDemand(world, town.id), fromRefinery: 0, fromDepot: 0, dr: byRoad(refinery.id, town.id), dd: byRoad(depot.id, town.id) }));
  let refined = refineryOutput(world);
  // Each site makes what its workers let it (workers.ts).
  let imported = world.tuning.fuelImportShare * fuel.baseDemand * staffFactor(world, fuel.depotId);
  const unmet = (x: (typeof towns)[number]) => x.need - x.fromRefinery - x.fromDepot;
  const fill = (source: "refinery" | "depot", order: typeof towns) => {
    for (const x of order) {
      const left = source === "refinery" ? refined : imported;
      const take = Math.min(unmet(x), left);
      if (take <= 0) continue;
      if (source === "refinery") {
        x.fromRefinery += take;
        refined -= take;
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
  const flows: GoodsFlow[] = [];
  for (const x of towns) {
    if (x.fromRefinery > 0) flows.push({ from: fuel.refineryId, to: x.town.id, kind: "supplies", rate: x.fromRefinery });
    if (x.fromDepot > 0) flows.push({ from: fuel.depotId, to: x.town.id, kind: "supplies", rate: x.fromDepot });
  }
  if (fuel.restored) flows.push({ from: fuel.sourceId, to: fuel.refineryId, kind: "supplies", rate: world.tuning.crudeShare * fuel.baseDemand * staffFactor(world, fuel.sourceId) });
  return flows;
}

/** What a goods flow carries, named by the kind of site it leaves. */
export function cargoName(world: SliceWorld, from: string, kind: "produce" | "supplies", to?: string): string {
  const site = world.towns.get(from)?.industry;
  // The food chain (food.ts): a farm town's staple to the mill, its cash crop to the port; the mill's food.
  const food = world.food && world.tuning.foodEnabled ? world.food : null;
  if (food && site === "mill") return food.crops.food;
  if (food && site === "flourmill") return "flour";
  if (food && to !== undefined && to === food.flourMillId) return "wheat";
  if (food && !site && kind === "produce") return to === world.port ? food.crops.cash : to === food.millId ? food.crops.staple : `${food.crops.staple} and ${food.crops.cash}`;
  if (site === "oilfield" || site === "terminal") return "crude";
  if (site === "depot" || site === "refinery") return "fuel";
  if (site === "works" || site === "silo") return "cement";
  if (site === "quarry") return world.cement && world.tuning.cementEnabled ? "limestone" : "stone";
  return kind;
}

/** How well a town is supplied with fuel, 0..1, and the share from each source. */
export function fuelSupply(world: SliceWorld, townId: string): { supplied: number; imported: number; refined: number } | null {
  const fuel = world.fuel;
  const demand = fuelDemand(world, townId);
  if (!fuel || demand <= 0) return null;
  const got = (from: string) => {
    const outcome = world.goods.outcomes.get(flowKey({ from, to: townId, kind: "supplies" }));
    return ((outcome?.delivered ?? 0) + (outcome?.trucked ?? 0)) / demand;
  };
  const imported = got(fuel.depotId);
  const refined = got(fuel.refineryId);
  return { supplied: Math.min(1, imported + refined), imported, refined };
}

/** Recomputes every town's shortage, once a tick (tick.ts), from the rolling fuel supplied. No road, no traffic: none counted. */
export function updateFuelShortage(world: SliceWorld): void {
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
export function shortageAt(world: SliceWorld, townId: string): number {
  return world.fuel?.shortage.get(townId) ?? 0;
}

/** Your vehicles' fuel above the pump price this tick, by route: on a route, the mean shortage of the towns it stops at. */
export function chargeFuelPremium(world: SliceWorld, dt: number, routeOf: ReadonlyMap<string, string>): { total: number; byRoute: Map<string, number> } {
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
export function restoreRefinery(world: SliceWorld): ActionResult & { charged?: number } {
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

export function dry(world: SliceWorld, x: number, y: number, clearance: number): boolean {
  const { terrain } = world.simulation.map;
  if (x < 3 || y < 3 || x > world.width - 4 || y > world.height - 4) return false;
  for (let dy = -clearance; dy <= clearance; dy += 1) for (let dx = -clearance; dx <= clearance; dx += 1) if (isWater(terrain, x + dx, y + dy)) return false;
  return true;
}

export function nearestDistance(world: SliceWorld, x: number, y: number): number {
  return Math.min(...[...world.towns.values()].map((town) => Math.hypot(town.x - x, town.y - y)));
}

/** A dry spot `minR`-`maxR` cells from (cx, cy) and at least `clear` from every town and site; the one scoring best. */
export function ringSpot(world: SliceWorld, cx: number, cy: number, minR: number, maxR: number, clear: number, score: (x: number, y: number) => number): { x: number; y: number } | null {
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

export function addSite(world: SliceWorld, id: string, name: string, kind: SliceTown["industry"], at: { x: number; y: number }): SliceTown {
  const site: SliceTown = { id, name, x: at.x, y: at.y, population: world.tuning.industryWorkers, industry: kind };
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
export function placeFuelSites(world: SliceWorld, region: string | undefined): void {
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
  world.fuel = { depotId: "fuel-depot", refineryId: "fuel-refinery", sourceId: "fuel-source", restored: false, baseDemand, shortage: new Map() };
  world.plans = null;
  rebuildNetworks(world);
  refreshDemand(world);
}
