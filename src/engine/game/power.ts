import type { ClusterDef, GameTown, GameWorld } from "./types";
import { flowKey, type GoodsFlow } from "./goods";
import { refreshDemand } from "./settlement";
import { isCutOff, type ActionResult } from "./world";
import { rebuildNetworks } from "./rail";
import { addSite, dry, inHome, nearestDistance } from "./fuel";
import { inheritedRoad } from "./cement";
import { canAfford, SECONDS_PER_GAME_DAY } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";
import { staffFactor } from "./workers";

// Coal and power (docs/brief.md, The remit opens, "A chain at each opening, first: coal and
// power", agreed 2026-11-02). The first chain an opening brings, and the one that changes how
// the industries you already have feel: an interlock, not one more line beside the others.
//
//   coal mine (a far cluster) --coal--> power station (home, idle at the start)
//   power station ~~grid~~> every processing site within `powerReachCells`: up to +`powerBoost`
//
// The station is the Oji River story: Nigeria's coal-fired station, shut down and left. Restored
// like the steel works (`powerRestoreCost`), it wants coal; the mine digs only while it does.
// The mine sits in the far cluster nearest home that isn't the limestone one, past the hauliers'
// reach from your sites, so reaching it is the opening's corridor -- and rail's long haul.
//
// Power is a share: the coal arriving over the coal wanted, times the station's shift. A site in
// reach makes 1 + powerBoost x that share of what it would from the same input (production.ts
// reads it; the output functions multiply by it): kilns, furnaces and mills on the grid, not on
// diesel generators half the day. Coal is goods like any other (goods.ts), told apart by the site
// it leaves (fuel.ts cargoName). Behind `coalEnabled`; absent in older runs.

export interface PowerState {
  stationId: string;
  mineId: string;
  /** The far cluster the mine is in, by its regional town. */
  clusterHub: string;
  working: boolean;
}

/** The sites power lifts: those that make something from an input. */
const POWERED = new Set(["works", "steelworks", "refinery", "newrefinery", "mill", "flourmill"]);

/** The chain runs: placed, and switched on. */
export function powerActive(world: GameWorld): boolean {
  return !!world.power && !!world.tuning.coalEnabled && world.tuning.goodsEnabled && world.tuning.industriesEnabled;
}

/** Coal the working station burns at full power, tonnes a second. */
export function coalWanted(world: GameWorld): number {
  return powerActive(world) && world.power!.working ? (world.tuning.powerCoalPerDay ?? 0) / SECONDS_PER_GAME_DAY : 0;
}

/** What the mine digs, tonnes a second: nothing while the station is idle (nobody wants coal). */
export function coalOutput(world: GameWorld): number {
  if (!powerActive(world) || !world.power!.working) return 0;
  return coalWanted(world) * staffFactor(world, world.power!.mineId);
}

/** Coal reaching the station now, tonnes a second: yours and the hauliers'. */
export function coalArriving(world: GameWorld): number {
  const power = world.power;
  if (!power) return 0;
  const outcome = world.goods.outcomes.get(flowKey({ from: power.mineId, to: power.stationId, kind: "supplies" }));
  return (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
}

/** How much power the station gives, 0..1: the coal it gets of what it wants, times its shift. */
export function powerShare(world: GameWorld): number {
  const wanted = coalWanted(world);
  if (wanted <= 0) return 0;
  return Math.min(1, coalArriving(world) / wanted) * staffFactor(world, world.power!.stationId);
}

/** A site the station would power: one that makes something, within its reach. */
export function inPowerReach(world: GameWorld, siteId: string): boolean {
  const power = world.power;
  if (!power || !world.tuning.coalEnabled) return false;
  const site = world.towns.get(siteId);
  const station = world.towns.get(power.stationId);
  if (!site?.industry || !station || !POWERED.has(site.industry)) return false;
  return Math.hypot(site.x - station.x, site.y - station.y) <= (world.tuning.powerReachCells ?? 0);
}

/** What power does for a site's output: 1, or more on the grid. */
export function powerLift(world: GameWorld, siteId: string): number {
  if (!powerActive(world) || !inPowerReach(world, siteId)) return 1;
  return 1 + (world.tuning.powerBoost ?? 0) * powerShare(world);
}

/** The sites in the station's reach, for its card and the map. */
export function poweredSites(world: GameWorld): GameTown[] {
  return [...world.towns.values()].filter((town) => inPowerReach(world, town.id));
}

/** Coal's flow (goods.ts adds it): from the mine to a working station. */
export function powerFlows(world: GameWorld): GoodsFlow[] {
  const power = world.power;
  if (!power || !powerActive(world) || !power.working) return [];
  return [{ from: power.mineId, to: power.stationId, kind: "supplies", rate: coalOutput(world) }];
}

/** Restores the idle power station: from now on it wants coal, and powers the sites in its reach. */
export function restorePower(world: GameWorld): ActionResult & { charged?: number } {
  const power = world.power;
  if (!powerActive(world)) return { ok: false, reason: SWITCHED_OFF };
  if (power!.working) return { ok: false, reason: "already working" };
  const cost = world.tuning.powerRestoreCost ?? 0;
  if (!canAfford(world.economy, cost)) return { ok: false, reason: "can't afford it" };
  world.economy.funds -= cost;
  power!.working = true;
  refreshDemand(world); // its workers come back (workers.ts)
  return { ok: true, charged: cost };
}

/** The far cluster the coal is in: the nearest home that isn't the limestone one (else the nearest). */
function coalCluster(world: GameWorld): ClusterDef | undefined {
  const box = world.home;
  const clusters = (world.clusters ?? []).filter((c) => world.towns.has(c.hub));
  if (!box || clusters.length === 0) return undefined;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const away = (c: ClusterDef) => { const hub = world.towns.get(c.hub)!; return Math.hypot(hub.x - cx, hub.y - cy); };
  const byNear = [...clusters].sort((a, b) => away(a) - away(b));
  return byNear.find((c) => c.offer !== "limestone") ?? byNear[0];
}

/**
 * Places coal and power on a new game's map, after every other site (start.ts), so they sit
 * where they always did:
 *   - the coal mine in the coal cluster's gaps: 8-18 cells from its regional town, on dry land,
 *     as far from any town as it can be, with an old road to that town;
 *   - the power station at home, where the most processing sites are within its reach, by water
 *     for cooling, 6+ cells from any town and within 16 of one on the network, with an old road.
 */
export function placePower(world: GameWorld): void {
  const t = world.tuning;
  if (!t.coalEnabled || !t.goodsEnabled || !t.industriesEnabled || world.power || !world.home) return;
  const cluster = coalCluster(world);
  const hub = cluster ? world.towns.get(cluster.hub) : undefined;
  if (!cluster || !hub) return;
  let mine: { x: number; y: number; s: number } | null = null;
  for (let r = 8; r <= 18; r += 1) {
    for (let k = 0; k < 36; k += 1) {
      const a = (k / 36) * Math.PI * 2;
      const x = Math.round(hub.x + r * Math.cos(a));
      const y = Math.round(hub.y + r * Math.sin(a));
      if (!dry(world, x, y, 2) || inHome(world, { x, y })) continue;
      const gap = nearestDistance(world, x, y);
      if (gap < 6) continue;
      const s = Math.min(gap, 14) - r * 0.05;
      if (!mine || s > mine.s) mine = { x, y, s };
    }
  }
  if (!mine) return;
  const reach = t.powerReachCells ?? 0;
  const sites = [...world.towns.values()].filter((town) => town.industry && POWERED.has(town.industry));
  const linked = [...world.towns.values()].filter((town) => !town.industry && !isCutOff(world, town.id));
  const box = world.home;
  let station: { x: number; y: number; s: number; town: GameTown } | null = null;
  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      if (!dry(world, x, y, 2) || nearestDistance(world, x, y) < 6) continue;
      let town: GameTown | null = null;
      let near = Infinity;
      for (const candidate of linked) {
        const d = Math.hypot(candidate.x - x, candidate.y - y);
        if (d < near) { near = d; town = candidate; }
      }
      if (!town || near > 16) continue;
      const powered = sites.filter((site) => Math.hypot(site.x - x, site.y - y) <= reach).length;
      const byWater = !dry(world, x, y, 6);
      const s = powered + (byWater ? 0.5 : 0) - near * 0.01;
      if (!station || s > station.s) station = { x, y, s, town };
    }
  }
  if (!station) return;
  addSite(world, "coal-mine", `${hub.name} Coal`, "coalmine", mine);
  inheritedRoad(world, "coal-mine-road", "coal-mine", hub.id);
  addSite(world, "power-station", `${station.town.name} Power Station`, "powerstation", station);
  inheritedRoad(world, "power-station-road", "power-station", station.town.id);
  world.power = { stationId: "power-station", mineId: "coal-mine", clusterHub: cluster.hub, working: false };
  world.plans = null;
  rebuildNetworks(world);
  refreshDemand(world);
}
