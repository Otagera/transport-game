import type { SliceTown, SliceWorld } from "./types";
import { flowKey, type GoodsFlow } from "./goods";
import { refreshDemand } from "./settlement";
import { addRoadToMap, type ActionResult } from "./world";
import { rebuildNetworks } from "./rail";
import { isWater } from "../pathing/terrainAStar";
import { canAfford } from "../economy/state";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";

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
// Step 1a is supply only: how well each town is supplied, and from where.
// What a shortage does to the danfos and your running costs is step 1b.

export interface FuelState {
  depotId: string;
  refineryId: string;
  sourceId: string;
  restored: boolean;
  /** Tonnes a second the towns needed at the start: imports, the refinery and crude are sized from it. */
  baseDemand: number;
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
  return Math.min(world.tuning.refineryShare * fuel.baseDemand, crudeArriving(world));
}

/**
 * The chain's flows (goods.ts adds them to everything else). Each town's
 * need is split between the tank farm's imports and the refinery's output,
 * imports first; crude flows to the refinery only once it's restored.
 */
export function fuelFlows(world: SliceWorld): GoodsFlow[] {
  const fuel = world.fuel;
  if (!fuel || !world.tuning.fuelEnabled || !world.tuning.goodsEnabled) return [];
  const flows: GoodsFlow[] = [];
  const need = totalDemand(world);
  if (need > 0) {
    const imported = Math.min(1, (world.tuning.fuelImportShare * fuel.baseDemand) / need);
    const refined = Math.min(1 - imported, refineryOutput(world) / need);
    for (const town of burners(world)) {
      const demand = fuelDemand(world, town.id);
      if (imported > 0) flows.push({ from: fuel.depotId, to: town.id, kind: "supplies", rate: demand * imported });
      if (refined > 0) flows.push({ from: fuel.refineryId, to: town.id, kind: "supplies", rate: demand * refined });
    }
  }
  if (fuel.restored) flows.push({ from: fuel.sourceId, to: fuel.refineryId, kind: "supplies", rate: world.tuning.crudeShare * fuel.baseDemand });
  return flows;
}

/** What a goods flow carries, named by the kind of site it leaves. */
export function cargoName(world: SliceWorld, from: string, kind: "produce" | "supplies"): string {
  const site = world.towns.get(from)?.industry;
  if (site === "oilfield" || site === "terminal") return "crude";
  if (site === "depot" || site === "refinery") return "fuel";
  if (site === "quarry") return "stone";
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
  return { ok: true, charged: cost };
}

// --- Placing the sites ---------------------------------------------------------

function dry(world: SliceWorld, x: number, y: number, clearance: number): boolean {
  const { terrain } = world.simulation.map;
  if (x < 3 || y < 3 || x > world.width - 4 || y > world.height - 4) return false;
  for (let dy = -clearance; dy <= clearance; dy += 1) for (let dx = -clearance; dx <= clearance; dx += 1) if (isWater(terrain, x + dx, y + dy)) return false;
  return true;
}

function nearestDistance(world: SliceWorld, x: number, y: number): number {
  return Math.min(...[...world.towns.values()].map((town) => Math.hypot(town.x - x, town.y - y)));
}

/** A dry spot `minR`-`maxR` cells from (cx, cy) and at least `clear` from every town and site; the one scoring best. */
function ringSpot(world: SliceWorld, cx: number, cy: number, minR: number, maxR: number, clear: number, score: (x: number, y: number) => number): { x: number; y: number } | null {
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

function addSite(world: SliceWorld, id: string, name: string, kind: SliceTown["industry"], at: { x: number; y: number }): SliceTown {
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
  world.fuel = { depotId: "fuel-depot", refineryId: "fuel-refinery", sourceId: "fuel-source", restored: false, baseDemand };
  world.plans = null;
  rebuildNetworks(world);
  refreshDemand(world);
}
