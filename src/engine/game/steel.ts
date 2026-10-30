import type { GameTown, GameWorld } from "./types";
import { importsArriving, portScale } from "./gateways";
import { flowKey, servedRate, type GoodsFlow } from "./goods";
import { refreshDemand } from "./settlement";
import { isCutOff, roadPath, type ActionResult } from "./world";
import { rebuildNetworks } from "./rail";
import { addSite, dry, nearestDistance, ringSpot } from "./fuel";
import { inheritedRoad } from "./cement";
import { canAfford, SECONDS_PER_GAME_DAY } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";
import { staffFactor } from "./workers";
import { siteScale } from "./expand";
import { assemblyActive, assemblyNeeds } from "./assembly";

// The steel chain (docs/brief.md, More industries, more chains: steel first).
// Cement lets a town build its first growth past its start; steel its last:
// past `steelFreeShare` of its start (+80%), a town's room is scaled by the
// steel it gets as well (growth.ts). The big towns' last growth -- towers,
// bridges, a city's frame -- needs both.
//
//   iron ore mine --ore--> steel works --steel--> the towns     (Middle Belt and South-South maps)
//   steel terminal by the port --imported steel--> the towns   (every map with a port)
//
// The works is the Ajaokuta story (Middle Belt), or Delta Steel at Aladja
// (South-South, fed Itakpe's ore by rail): built, barely run, idle at the
// start of every game that has it. Restoring it (`steelRestoreCost`) is a late-game
// project (C24); from then its mine's ore is wanted, a long haul from a mine
// far out on high ground -- the case for freight rail. Until then, and on
// maps without a works, steel comes in through the terminal by the port: a
// share of what the towns want, carried from the coast.
//
// Steel is goods like any other (goods.ts), told apart by the site it leaves
// (fuel.ts cargoName); like cement and fuel it keeps while it waits.

export interface SteelState {
  /** The steel works and its iron ore mine; null on a map without them (outside the Middle Belt and South-South). */
  worksId: string | null;
  mineId: string | null;
  /** The steel terminal by the port; null where the map has no port. */
  terminalId: string | null;
  working: boolean;
  /** Tonnes a second the towns wanted at the start: the works and imports are sized from it. */
  baseDemand: number;
}

const STEEL_SITES = new Set(["ironmine", "steelworks", "steelport"]);

export function isSteelSite(town: GameTown | undefined): boolean {
  return town?.industry !== undefined && STEEL_SITES.has(town.industry);
}

/** The steel chain runs: placed, and switched on. */
export function steelActive(world: GameWorld): boolean {
  return !!world.steel && !!world.tuning.steelEnabled && world.tuning.goodsEnabled && world.tuning.industriesEnabled;
}

/** The towns that build: the map's own towns (roadside towns grow from traffic, settlement.ts). */
function builders(world: GameWorld): GameTown[] {
  return [...world.towns.values()].filter((town) => !town.industry && world.basePopulation.has(town.id));
}

/** Tonnes a second of steel a town wants. */
export function steelDemand(world: GameWorld, townId: string): number {
  const town = world.towns.get(townId);
  if (!town || town.industry || !world.basePopulation.has(townId)) return 0;
  return (world.tuning.steelPerThousandPerDay * town.population) / SECONDS_PER_GAME_DAY;
}

/** Ore reaching the works now, tonnes a second: yours and the truckers'. */
export function oreArriving(world: GameWorld): number {
  const steel = world.steel;
  if (!steel?.worksId || !steel.mineId) return 0;
  const outcome = world.goods.outcomes.get(flowKey({ from: steel.mineId, to: steel.worksId, kind: "supplies" }));
  return (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
}

/** The most the works can make, tonnes a second. */
export function steelCapacity(world: GameWorld): number {
  const steel = world.steel;
  return steel?.worksId ? world.tuning.steelWorksShare * steel.baseDemand * siteScale(world, steel.worksId) : 0;
}

/** What the works makes now: its capacity, or what the ore arriving makes, whichever is less. */
export function steelOutput(world: GameWorld): number {
  const steel = world.steel;
  if (!steel?.working || !steel.worksId) return 0;
  return Math.min(steelCapacity(world), oreArriving(world) / world.tuning.orePerSteel) * staffFactor(world, steel.worksId);
}

/** What the mine digs, tonnes a second: nothing while the works is idle (nobody wants ore). */
export function mineOutput(world: GameWorld): number {
  const steel = world.steel;
  if (!steel?.working || !steel.mineId) return 0;
  return (world.tuning.mineOutputPerDay / SECONDS_PER_GAME_DAY) * staffFactor(world, steel.mineId);
}

/**
 * Imported steel through the terminal, tonnes a second. On a map without a works
 * (steelImportsFollowTowns), a share of what the towns want now: sized from day 1's
 * towns, it was all the steel there would ever be -- map 949, day 244, 20 t a day for 73
 * wanted, no move but the port's rungs to lift it; the port's rungs are now the decision.
 */
export function steelImports(world: GameWorld): number {
  const steel = world.steel;
  if (!steel?.terminalId) return 0;
  const t = world.tuning;
  const following = !!t.steelImportsFollowTowns && !steel.worksId;
  const wanted = following ? builders(world).reduce((sum, town) => sum + steelDemand(world, town.id), 0) : steel.baseDemand;
  const share = following ? t.steelImportShareNow ?? t.steelImportShare : t.steelImportShare;
  return share * wanted * staffFactor(world, steel.terminalId) * importsArriving(world) * portScale(world);
}

/**
 * Steel's flows (goods.ts adds them): ore from the mine to a working works;
 * then each source's steel split over the towns by what they still want --
 * imports first, then the works to towns a road from it reaches -- as
 * cement's are (cement.ts: split, not nearest first).
 */
export function steelFlows(world: GameWorld): GoodsFlow[] {
  const steel = world.steel;
  if (!steel || !steelActive(world)) return [];
  const flows: GoodsFlow[] = [];
  if (steel.mineId && steel.worksId && steel.working) flows.push({ from: steel.mineId, to: steel.worksId, kind: "supplies", rate: mineOutput(world) });
  const towns = builders(world).map((town) => ({ town, left: steelDemand(world, town.id) }));
  // The assembly plant takes steel too (assembly.ts), from the port's and the works' as a town does.
  const plant = world.assembly && assemblyActive(world) ? world.towns.get(world.assembly.siteId) : undefined;
  if (plant) towns.push({ town: plant, left: assemblyNeeds(world).steel });
  const fill = (from: string, supply: number, reachedOnly: boolean) => {
    const takers = towns.filter((x) => x.left > 0 && (!reachedOnly || roadPath(world, from, x.town.id)));
    const wanted = takers.reduce((sum, x) => sum + x.left, 0);
    if (supply <= 0 || wanted <= 0) return;
    const share = Math.min(1, supply / wanted);
    for (const x of takers) {
      const take = x.left * share;
      x.left -= take;
      flows.push({ from, to: x.town.id, kind: "supplies", rate: take });
    }
  };
  if (steel.terminalId) fill(steel.terminalId, steelImports(world), false);
  if (steel.worksId) fill(steel.worksId, steelOutput(world), true);
  return flows;
}

/** Of the steel a town wants, the share delivered (yours and the truckers'), 0..1 (growth.ts). */
export function steelServed(world: GameWorld, townId: string): number {
  const steel = world.steel;
  const wanted = steelDemand(world, townId);
  if (!steel || wanted <= 0) return 0;
  let got = 0;
  for (const from of [steel.worksId, steel.terminalId]) {
    if (!from) continue;
    const outcome = world.goods.outcomes.get(flowKey({ from, to: townId, kind: "supplies" }));
    got += servedRate(world, outcome);
  }
  return Math.min(1, got / wanted);
}

/** Restores the idle steel works: from now on it wants ore, and makes steel from it. */
export function restoreSteel(world: GameWorld): ActionResult & { charged?: number } {
  const steel = world.steel;
  if (!steelActive(world)) return { ok: false, reason: SWITCHED_OFF };
  if (!steel?.worksId) return { ok: false, reason: "no steel works on this map" };
  if (steel.working) return { ok: false, reason: "already working" };
  const cost = world.tuning.steelRestoreCost;
  if (!canAfford(world.economy, cost)) return { ok: false, reason: "can't afford it" };
  world.economy.funds -= cost;
  steel.working = true;
  refreshDemand(world); // its workers come back (workers.ts)
  return { ok: true, charged: cost };
}

/**
 * Places the steel chain on a new game's map, before the warm-up (start.ts), after every
 * other chain's sites (so they sit where they always did):
 *   - every map with a port: a steel terminal 9-12 cells from it, with its old road;
 *   - a Middle Belt or South-South map: the works by water (Ajaokuta is on the Niger), 8+ cells from any
 *     town and within 16 of one on the network, with its old road; and the iron ore mine on
 *     the highest dry ground 40-90 cells from the works (Itakpe is a long haul from it), 6+
 *     from any town and within 20 of one on the network, with its old road to that town --
 *     never to the works: the ore's way there is yours to build.
 */
export function placeSteel(world: GameWorld, region: string | undefined): void {
  const t = world.tuning;
  if (!t.steelEnabled || !t.goodsEnabled || !t.industriesEnabled || world.steel) return;
  const baseDemand = builders(world).reduce((sum, town) => sum + steelDemand(world, town.id), 0);
  const linked = [...world.towns.values()].filter((town) => !town.industry && !isCutOff(world, town.id));
  const nearest = (x: number, y: number) => linked.reduce<GameTown | null>((best, town) => (!best || Math.hypot(town.x - x, town.y - y) < Math.hypot(best.x - x, best.y - y) ? town : best), null);
  let terminalId: string | null = null;
  const port = world.port ? world.towns.get(world.port) : undefined;
  if (port) {
    const at = ringSpot(world, port.x, port.y, 9, 12, 6, (x, y) => -Math.abs(Math.hypot(x - port.x, y - port.y) - 10));
    if (at) {
      addSite(world, "steel-terminal", `${port.name} Steel Terminal`, "steelport", at);
      inheritedRoad(world, "steel-terminal-road", "steel-terminal", port.id);
      terminalId = "steel-terminal";
    }
  }
  let worksId: string | null = null;
  let mineId: string | null = null;
  if (region === "middleBelt" || region === "southSouth") {
    const { terrain } = world.simulation.map;
    // The works: by water, near the network.
    let works: { x: number; y: number; s: number } | null = null;
    for (let y = 4; y < world.height - 4; y += 1) {
      for (let x = 4; x < world.width - 4; x += 1) {
        if (!dry(world, x, y, 2) || nearestDistance(world, x, y) < 8) continue;
        const town = nearest(x, y);
        if (!town || Math.hypot(town.x - x, town.y - y) > 16) continue;
        const byWater = !dry(world, x, y, 6);
        const s = (byWater ? 1 : 0) - Math.hypot(town.x - x, town.y - y) * 0.01;
        if (!works || s > works.s) works = { x, y, s };
      }
    }
    if (works) {
      const highest = terrain.elevation.reduce((top, e) => Math.max(top, e), 0);
      let mine: { x: number; y: number; s: number } | null = null;
      for (let y = 4; y < world.height - 4; y += 1) {
        for (let x = 4; x < world.width - 4; x += 1) {
          const far = Math.hypot(x - works.x, y - works.y);
          if (far < 40 || far > 90 || !dry(world, x, y, 2) || nearestDistance(world, x, y) < 6) continue;
          const town = nearest(x, y);
          if (!town || Math.hypot(town.x - x, town.y - y) > 20) continue;
          const s = (highest > 0 ? terrain.elevation[y * terrain.width + x]! / highest : 0) - Math.hypot(town.x - x, town.y - y) * 0.01;
          if (!mine || s > mine.s) mine = { x, y, s };
        }
      }
      const worksTown = nearest(works.x, works.y);
      const mineTown = mine ? nearest(mine.x, mine.y) : null;
      if (mine && worksTown && mineTown) {
        addSite(world, "steel-works", `${worksTown.name} Steel`, "steelworks", works);
        inheritedRoad(world, "steel-works-road", "steel-works", worksTown.id);
        addSite(world, "iron-mine", `${mineTown.name} Iron Ore`, "ironmine", mine);
        inheritedRoad(world, "iron-mine-road", "iron-mine", mineTown.id);
        worksId = "steel-works";
        mineId = "iron-mine";
      }
    }
  }
  if (!terminalId && !worksId) return;
  world.steel = { worksId, mineId, terminalId, working: false, baseDemand };
  world.plans = null;
  rebuildNetworks(world);
  refreshDemand(world);
}

/**
 * Where the steel chain is broken, for a town short of steel (as cement.ts cementBreak):
 *   - idle: a works on the map, not restored;
 *   - ore: the works runs but little ore reaches it -- connect the mine (road and yard, or track);
 *   - carry: there's steel to have; it isn't reaching the town (from the works, or the port's terminal).
 */
export type SteelBreak = { kind: "idle" } | { kind: "ore"; mineId: string } | { kind: "carry"; from: string };

export function steelBreak(world: GameWorld): SteelBreak | null {
  const steel = world.steel;
  if (!steel) return null;
  if (steel.worksId && !steel.working) return { kind: "idle" };
  if (steel.worksId && steel.mineId) {
    const capacity = steelCapacity(world);
    if (capacity > 0 && steelOutput(world) < 0.6 * capacity) return { kind: "ore", mineId: steel.mineId };
    return { kind: "carry", from: steel.worksId };
  }
  return steel.terminalId ? { kind: "carry", from: steel.terminalId } : null;
}
