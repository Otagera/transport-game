import type { GameTown, GameWorld } from "./types";
import { flowKey, type GoodsFlow } from "./goods";
import { refreshDemand } from "./settlement";
import { isCutOff, type ActionResult } from "./world";
import { rebuildNetworks } from "./rail";
import { addSite, dry, nearestDistance } from "./fuel";
import { inheritedRoad } from "./cement";
import { canAfford, SECONDS_PER_GAME_DAY } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";
import { landOf } from "./remit";
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
// The mine sits in the far cluster whose land comes nearest the station (not the limestone one,
// unless that's much nearer), 45-75 cells out: past the hauliers' reach -- coal is bulk, a yard
// doesn't stretch it (haulage.ts legReach) -- and within a line you can save for: reaching it is
// the opening's corridor, and your freight train's.
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

/**
 * Places coal and power on a new game's map, after every other site (start.ts), so they sit
 * where they always did:
 *   - the power station at home, where the most processing sites are within its reach, by water
 *     for cooling, 6+ cells from any town and within 16 of one on the network, with an old road;
 *     among equals, the side facing the coal;
 *   - the coal mine in the coal cluster's land, on the side facing the station: `coalMinCells` to
 *     `coalMaxCells` from it in a straight line (past the hauliers' reach, within a line you can
 *     save for), dry, 6+ cells from any town, with an old road to the cluster's nearest town.
 * Reworked 2026-11-03: in the cluster's far gaps, the coal sat 139-244 road cells out, ₦600k+ of
 * track, and no line was ever laid (brief, the measured results).
 */
export function placePower(world: GameWorld): void {
  const t = world.tuning;
  if (!t.coalEnabled || !t.goodsEnabled || !t.industriesEnabled || world.power || !world.home) return;
  const clusters = (world.clusters ?? []).filter((c) => world.towns.has(c.hub));
  if (clusters.length === 0) return;
  const reach = t.powerReachCells ?? 0;
  const sites = [...world.towns.values()].filter((town) => town.industry && POWERED.has(town.industry));
  const linked = [...world.towns.values()].filter((town) => !town.industry && !isCutOff(world, town.id));
  const box = world.home;
  // The far clusters' dry land, every few cells: among spots that power as many sites, the station
  // takes the one nearest it, so the coal's line is as short as it can be.
  const far: Array<{ x: number; y: number }> = [];
  for (let y = 3; y < world.height - 3; y += 3) for (let x = 3; x < world.width - 3; x += 3) if (landOf(world, { x, y }) && dry(world, x, y, 1)) far.push({ x, y });
  const toFar = (x: number, y: number) => far.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.y - y)), Infinity);
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
      if (station && powered + 0.5 < station.s - 0.5) continue; // can't win: skip the land search
      const s = powered + (byWater ? 0.5 : 0) - near * 0.01 - Math.min(toFar(x, y), 100) * 0.004;
      if (!station || s > station.s) station = { x, y, s, town };
    }
  }
  if (!station) return;
  // The mine: in a far cluster's land, as near the station as the band lets it, clear of towns --
  // the nearest such spot in each cluster, scored within the band, so a cluster whose land starts
  // further out offers its nearest (maps 2411, 543, 949: 45-75 found none). The cluster: the
  // nearest that isn't the limestone one, unless the limestone one is 20+ cells nearer (map 2411:
  // its other clusters' coal would be 104 cells out, ₦600k of track).
  const min = t.coalMinCells ?? 45;
  const max = t.coalMaxCells ?? 75;
  const best = new Map<string, { x: number; y: number; s: number; d: number }>();
  for (let y = 3; y < world.height - 3; y += 1) {
    for (let x = 3; x < world.width - 3; x += 1) {
      const d = Math.hypot(x - station.x, y - station.y);
      if (d < min) continue;
      const land = landOf(world, { x, y });
      if (!land || !dry(world, x, y, 2)) continue;
      const gap = nearestDistance(world, x, y);
      if (gap < 6) continue;
      const s = -Math.max(d, max) * 2 - d + Math.min(gap, 10) * 0.2;
      const known = best.get(land.hub);
      if (!known || s > known.s) best.set(land.hub, { x, y, s, d });
    }
  }
  const spots = clusters.filter((c) => best.has(c.hub)).sort((a, b) => best.get(a.hub)!.d - best.get(b.hub)!.d);
  const other = spots.find((c) => c.offer !== "limestone");
  const cluster = other && spots[0] && best.get(other.hub)!.d - best.get(spots[0].hub)!.d < 20 ? other : spots[0];
  const hub = cluster ? world.towns.get(cluster.hub) : undefined;
  if (!cluster || !hub) return;
  const mine = best.get(cluster.hub)!;
  const mineTown = cluster.towns.map((id) => world.towns.get(id)).filter((town): town is GameTown => !!town)
    .reduce<GameTown>((best, town) => (Math.hypot(town.x - mine!.x, town.y - mine!.y) < Math.hypot(best.x - mine!.x, best.y - mine!.y) ? town : best), hub);
  addSite(world, "coal-mine", `${mineTown.name} Coal`, "coalmine", mine);
  inheritedRoad(world, "coal-mine-road", "coal-mine", mineTown.id);
  addSite(world, "power-station", `${station.town.name} Power Station`, "powerstation", station);
  inheritedRoad(world, "power-station-road", "power-station", station.town.id);
  world.power = { stationId: "power-station", mineId: "coal-mine", clusterHub: cluster.hub, working: false };
  world.plans = null;
  rebuildNetworks(world);
  refreshDemand(world);
}
