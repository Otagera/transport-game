import type { GameTown, GameWorld } from "./types";
import { importsArriving, portScale } from "./gateways";
import { flowKey, servedRate, type GoodsFlow } from "./goods";
import { refreshDemand } from "./settlement";
import { addRoadToMap, isCutOff, roadPath, type ActionResult } from "./world";
import { rebuildNetworks } from "./rail";
import { addSite, dry, homeBox, inHome, nearestDistance, ringSpot } from "./fuel";
import { canAfford, SECONDS_PER_GAME_DAY } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";
import { planRoad } from "./roads";
import { staffFactor } from "./workers";
import { siteScale } from "./expand";

// The building chain (docs/brief.md, Revision 3, step 2a): limestone ->
// cement -> the towns that grow. It replaces stone's growth bonus with a
// limit: a town grows its first stretch (cementFreeShare of its start) with
// local materials, and past that only as far as the cement it gets lets it
// (growth.ts). Scarcity comes with success, as fuel's does (principles §3,
// Economy): no town is short on day 1, a grown one is.
//
//   limestone quarries --limestone--> cement works --cement--> the towns
//   (idle works only) cement terminal by the port --imported cement--> the towns
//
// One works per map, near the ridge, owned by a company. The map's seed
// decides how it starts (brief: randomized, so maps differ):
//   - working: with a quarry of its own and old roads between them and to
//     the nearest town; your job is keeping limestone coming as quarries
//     work out, and getting cement to the towns truckers don't reach;
//   - idle: restore it (worksRestoreCost); until then a little cement
//     comes in through a terminal by the port, and no quarry opens -- nobody
//     wants limestone until the works runs (industries.ts).
//
// Cement is goods like any other (goods.ts), told apart by the site it
// leaves (fuel.ts cargoName). Truckers take it on short hauls only, as they
// do stone: on a long leg it's yours or nobody's, the case for freight rail.

export interface CementState {
  worksId: string;
  /** The cement terminal by the port, on a map whose works starts idle; null where it starts working. */
  siloId: string | null;
  working: boolean;
  /** Tonnes a second the towns wanted at the start: the works and imports are sized from it. */
  baseDemand: number;
}

const CEMENT_SITES = new Set(["works", "silo"]);

export function isCementSite(town: GameTown | undefined): boolean {
  return town?.industry !== undefined && CEMENT_SITES.has(town.industry);
}

/** The building chain runs: placed, and switched on. */
export function cementActive(world: GameWorld): boolean {
  return !!world.cement && world.tuning.cementEnabled && world.tuning.goodsEnabled && world.tuning.industriesEnabled;
}

/** The towns that build: the map's own towns (roadside towns grow from traffic, settlement.ts). */
function builders(world: GameWorld): GameTown[] {
  return [...world.towns.values()].filter((town) => !town.industry && world.basePopulation.has(town.id));
}

/** Tonnes a second of cement a town wants. */
export function cementDemand(world: GameWorld, townId: string): number {
  const town = world.towns.get(townId);
  if (!town || town.industry || !world.basePopulation.has(townId)) return 0;
  return (world.tuning.cementPerThousandPerDay * town.population) / SECONDS_PER_GAME_DAY;
}

/** Limestone reaching the works now, tonnes a second: yours and the truckers'. */
export function limestoneArriving(world: GameWorld): number {
  const cement = world.cement;
  if (!cement) return 0;
  let total = 0;
  for (const id of world.industries.keys()) {
    const outcome = world.goods.outcomes.get(flowKey({ from: id, to: cement.worksId, kind: "supplies" }));
    total += (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
  }
  return total;
}

/** The most the works can make, tonnes a second. */
export function worksCapacity(world: GameWorld): number {
  return world.cement ? world.tuning.cementWorksShare * world.cement.baseDemand * siteScale(world, world.cement.worksId) : 0;
}

/** What the works makes now, tonnes a second: its capacity, or what the limestone arriving makes, whichever is less. */
export function worksOutput(world: GameWorld): number {
  if (!world.cement?.working) return 0;
  return Math.min(worksCapacity(world), limestoneArriving(world) / world.tuning.limestonePerCement) * staffFactor(world, world.cement.worksId);
}

/** Imported cement through the terminal, tonnes a second (idle-works maps only). */
export function cementImports(world: GameWorld): number {
  return world.cement?.siloId ? world.tuning.cementImportShare * world.cement.baseDemand * staffFactor(world, world.cement.siloId) * importsArriving(world) * portScale(world) : 0;
}

/**
 * Cement's flows (goods.ts adds them). Each source splits what it has over
 * the towns by what they still want: imports first, then the works, to
 * towns a road from it reaches -- so the second source can only add (fuel.ts
 * found it). Split, not nearest first: short, nearest first left the far
 * cities no cement to carry at all, so carrying it couldn't help them; split,
 * their share waits at the works for you (truckers don't go that far).
 */
export function cementFlows(world: GameWorld): GoodsFlow[] {
  const cement = world.cement;
  if (!cement || !cementActive(world)) return [];
  const byRoad = (from: string, to: string) => roadPath(world, from, to)?.distance ?? Infinity;
  const towns = builders(world).map((town) => ({ town, left: cementDemand(world, town.id) }));
  const flows: GoodsFlow[] = [];
  const fill = (from: string, supply: number, reachedOnly: boolean) => {
    const takers = towns.filter((x) => x.left > 0 && (!reachedOnly || Number.isFinite(byRoad(from, x.town.id))));
    const wanted = takers.reduce((sum, x) => sum + x.left, 0);
    if (supply <= 0 || wanted <= 0) return;
    const share = Math.min(1, supply / wanted);
    for (const x of takers) {
      const take = x.left * share;
      x.left -= take;
      flows.push({ from, to: x.town.id, kind: "supplies", rate: take });
    }
  };
  if (cement.siloId) fill(cement.siloId, cementImports(world), false);
  fill(cement.worksId, worksOutput(world), true);
  return flows;
}

/** Of the cement a town wants, the share delivered (yours and the truckers'), 0..1 (growth.ts). */
export function cementServed(world: GameWorld, townId: string): number {
  const cement = world.cement;
  const wanted = cementDemand(world, townId);
  if (!cement || wanted <= 0) return 0;
  let got = 0;
  for (const from of [cement.worksId, cement.siloId]) {
    if (!from) continue;
    const outcome = world.goods.outcomes.get(flowKey({ from, to: townId, kind: "supplies" }));
    got += servedRate(world, outcome);
  }
  return Math.min(1, got / wanted);
}

/** Restores the idle works: from now on it turns limestone into cement, and quarries open for it. */
export function restoreWorks(world: GameWorld): ActionResult & { charged?: number } {
  const cement = world.cement;
  if (!cementActive(world)) return { ok: false, reason: SWITCHED_OFF };
  if (!cement) return { ok: false, reason: "no cement works on this map" };
  if (cement.working) return { ok: false, reason: "already working" };
  const cost = world.tuning.worksRestoreCost;
  if (!canAfford(world.economy, cost)) return { ok: false, reason: "can't afford it" };
  world.economy.funds -= cost;
  cement.working = true;
  refreshDemand(world); // its workers come back (workers.ts)
  // The first quarry for it opens within a few days.
  const soon = world.economy.elapsedSeconds + world.tuning.quarryAfterRestoreDays * SECONDS_PER_GAME_DAY;
  world.industrySchedule.nextAtSeconds = Math.min(world.industrySchedule.nextAtSeconds, soon);
  return { ok: true, charged: cost };
}

/** Whether a map's works starts idle: drawn from its towns, apart from every other draw, so each seed's geography stays as it was. */
export function worksStartsIdle(world: GameWorld): boolean {
  let h = [...world.towns.values()].filter((town) => !town.industry).reduce((sum, town) => (sum * 31 + Math.round(town.x * 11 + town.y * 17 + town.population)) | 0, 0x2545f491);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 < world.tuning.cementIdleChance;
}

/**
 * Places the works on a new game's map, before the warm-up (start.ts),
 * after the fuel sites (so they sit where they always did): on the highest
 * dry ground 8 cells or more from any town and within 16 of one on the
 * network, with an old road to that one.
 * Working, it gets its quarry (`openQuarry`, from start.ts) and an old road
 * to it; idle, a cement terminal 9-12 cells from the port with its old road.
 */
export function placeCementWorks(world: GameWorld): void {
  if (!world.tuning.cementEnabled || !world.tuning.goodsEnabled || !world.tuning.industriesEnabled || world.cement) return;
  const { terrain } = world.simulation.map;
  const highest = terrain.elevation.reduce((top, e) => Math.max(top, e), 0);
  // Its old road goes to a town on the network: one cut off would strand it.
  const linked = [...world.towns.values()].filter((town) => !town.industry && !isCutOff(world, town.id) && inHome(world, town));
  const nearLinked = (x: number, y: number) => Math.min(...linked.map((town) => Math.hypot(town.x - x, town.y - y)));
  const box = homeBox(world);
  let best: { x: number; y: number; s: number } | null = null;
  for (let y = box.y + 4; y < box.y + box.height - 4; y += 1) {
    for (let x = box.x + 4; x < box.x + box.width - 4; x += 1) {
      if (!dry(world, x, y, 2) || nearestDistance(world, x, y) < 8) continue;
      const near = nearLinked(x, y);
      if (near > 16) continue;
      // High ground (the limestone's there), then nearer a town.
      const s = (highest > 0 ? terrain.elevation[y * terrain.width + x]! / highest : 0) - near * 0.01;
      if (!best || s > best.s) best = { x, y, s };
    }
  }
  if (!best) return;
  const nearest = linked.sort((p, q) => Math.hypot(p.x - best!.x, p.y - best!.y) - Math.hypot(q.x - best!.x, q.y - best!.y))[0];
  if (!nearest) return;
  const baseDemand = builders(world).reduce((sum, town) => sum + cementDemand(world, town.id), 0);
  const idle = worksStartsIdle(world);
  let siloId: string | null = null;
  if (idle) {
    const port = world.port ? world.towns.get(world.port) : undefined;
    const siloAt = port ? ringSpot(world, port.x, port.y, 9, 12, 6, (x, y) => -Math.hypot(x - best!.x, y - best!.y)) : null;
    if (port && siloAt) {
      addSite(world, "cement-silo", `${port.name} Cement Terminal`, "silo", siloAt);
      inheritedRoad(world, "cement-silo-road", "cement-silo", port.id);
      siloId = "cement-silo";
    }
  }
  addSite(world, "cement-works", `${nearest.name} Cement`, "works", best);
  inheritedRoad(world, "cement-works-road", "cement-works", nearest.id);
  world.cement = { worksId: "cement-works", siloId, working: !idle, baseDemand };
  world.plans = null;
  rebuildNetworks(world);
  refreshDemand(world);
}

/** An old road between two sites or a site and a town, worn as the map's inherited roads are. */
export function inheritedRoad(world: GameWorld, id: string, a: string, b: string): void {
  // Along the ground, as roads are built (a straight line could cross the river).
  const plan = planRoad(world, a, b, "cheapest");
  addRoadToMap(world.simulation.map, id, a, b, "inherited", plan ?? undefined);
  const road = world.simulation.map.segments.find((segment) => segment.id === id)!;
  road.condition = world.tuning.wearEnabled ? world.tuning.inheritedRoadCondition : 1;
}

/**
 * Where the building chain is broken, for a town short of cement: the move
 * depends on it (OpenCode playtest, 2026-10-23: both quarries worked out,
 * cement fell to 2%, and the only advice was to carry cement from a works
 * that had none to give).
 *   - idle: the works hasn't been restored;
 *   - no-quarry: no quarry is working -- the next opens about `nextDay` (game
 *     day); imported cement comes through the silo where there is one;
 *   - quarry: a quarry is working but little of its limestone reaches the
 *     works -- connect it (road and yard, or track);
 *   - carry: the works makes enough; it isn't reaching the town.
 */
export type CementBreak =
  | { kind: "idle" }
  | { kind: "no-quarry"; nextDay: number; siloId: string | null }
  | { kind: "quarry"; quarryId: string }
  | { kind: "carry" };

export function cementBreak(world: GameWorld): CementBreak | null {
  const cement = world.cement;
  if (!cement) return null;
  if (!cement.working) return { kind: "idle" };
  const capacity = worksCapacity(world);
  if (capacity > 0 && worksOutput(world) >= 0.6 * capacity) return { kind: "carry" };
  const quarries = [...world.industries.values()].filter((industry) => industry.kind === "quarry" && world.towns.has(industry.id));
  if (quarries.length === 0) {
    const nextDay = Math.ceil((world.industrySchedule.nextAtSeconds - world.startSeconds) / SECONDS_PER_GAME_DAY) + 1;
    return { kind: "no-quarry", nextDay, siloId: cement.siloId };
  }
  // The quarry sending the works least of what it makes: the one to connect.
  const sent = (id: string) => {
    const outcome = world.goods.outcomes.get(flowKey({ from: id, to: cement.worksId, kind: "supplies" }));
    return (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
  };
  const worst = quarries.sort((p, q) => sent(p.id) - sent(q.id))[0]!;
  return { kind: "quarry", quarryId: worst.id };
}
