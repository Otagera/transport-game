import type { DemandPair } from "../simulation/types";
import type { GameTown, GameWorld } from "./types";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import type { GameEvent } from "./settlement";
import { siteScale } from "./expand";

// Sites need people (docs/brief.md, Revision 3, step 2b; asked for in the
// step 1 playtest: "people have to go to the refinery too"). A working site
// is a workplace: it employs people by its kind, and they commute from the
// towns around it -- trips like any other, that your buses and the danfos
// and okadas compete for. And its workers are an input: a site whose
// workers can't get there (no road, a jammed one, danfos parked for want of
// fuel) makes less, as a refinery short of crude does.
//
//   - Jobs (thousands) by kind, when working; an idle site keeps a few
//     watchmen (`jobsIdle`). A site's trips are its commutes only: it isn't a
//     town, so it's out of the towns' gravity demand (settlement.ts).
//   - Commutes: `commutePerThousandJobs` trips a day each way per thousand
//     jobs, from the towns within `commuteReachCells`, by size over
//     distance as gravity weighs any trip (the nearest town, if none is that
//     close).
//   - Staffing: of the trips to it, the share made (yours and informal) over
//     `staffFullShare` -- informal carriage at its usual share is a full
//     shift. Output scales from `staffFloor` (some live on site or walk) at
//     none to all at full.

/** Thousands of jobs at a site now: by kind, working; a few if it's idle. */
export function siteJobs(world: GameWorld, town: GameTown): number {
  const t = world.tuning;
  const idle = t.jobsIdle;
  switch (town.industry) {
    case "refinery":
      return world.fuel?.restored ? t.jobsRefinery * siteScale(world, town.id) : idle;
    case "newrefinery":
      // Private, and working from the day it opens.
      return t.jobsRefinery;
    case "oilfield":
    case "terminal":
      // Oil workers live at the wells, in camps, brought in by boat or air;
      // a pipeline terminal runs itself. Measured: with them commuting, a
      // crude source on track and no road starved the refinery to a quarter.
      return 0;
    case "works":
      return world.cement?.working ? t.jobsWorks * siteScale(world, town.id) : idle;
    case "quarry":
      return t.jobsQuarry;
    case "depot":
      return t.jobsDepot;
    case "silo":
      return t.jobsSilo;
    // The steel chain (steel.ts): an idle works and its mine keep a caretaker's few.
    case "steelworks":
      return world.steel?.working ? t.jobsSteelworks * siteScale(world, town.id) : idle;
    case "ironmine":
      return world.steel?.working ? t.jobsMine : idle;
    case "steelport":
      return t.jobsSilo;
    case "mill":
      return t.jobsMill * siteScale(world, town.id);
    case "flourmill":
      return t.jobsFlourMill * siteScale(world, town.id);
    default:
      return 0;
  }
}

/** Where a site's workers live: each town's share of them, 0..1 -- the towns within reach, by size over distance. */
export function workforceShares(world: GameWorld, site: GameTown): Map<string, number> {
  const shares = new Map<string, number>();
  const from = commuterTowns(world, site);
  if (from.length === 0) return shares;
  // By live populations (they drift every tick), summed in the towns' order, as always.
  let sum = 0;
  for (const { town, distance } of from) sum += town.population / distance;
  for (const { town, distance } of from) shares.set(town.id, town.population / distance / sum);
  return shares;
}

// Which towns a site draws on, and how far: fixed while no town is founded
// or retired, so kept until one is (profiled: rebuilding it for every town's
// growth, every tick, was an eighth of a tick). Kept off the world, which is
// plain data the forecasts clone.
const commuters = new WeakMap<GameWorld, { key: string; bySite: Map<string, Array<{ town: GameTown; distance: number }>> }>();

function commuterTowns(world: GameWorld, site: GameTown): Array<{ town: GameTown; distance: number }> {
  const key = `${world.towns.size}:${world.ruins.size}:${world.nextId}:${world.tuning.commuteReachCells}`;
  let cache = commuters.get(world);
  if (!cache || cache.key !== key) commuters.set(world, (cache = { key, bySite: new Map() }));
  let list = cache.bySite.get(site.id);
  if (list) return list;
  const towns = [...world.towns.values()].filter((town) => !town.industry);
  const distance = (town: GameTown) => Math.max(1, Math.hypot(town.x - site.x, town.y - site.y));
  let from = towns.filter((town) => distance(town) <= world.tuning.commuteReachCells);
  if (from.length === 0 && towns.length > 0) from = [[...towns].sort((p, q) => distance(p) - distance(q))[0]!];
  list = from.map((town) => ({ town, distance: distance(town) }));
  cache.bySite.set(site.id, list);
  return list;
}

/** Every site's commutes, both ways (settlement.ts refreshDemand adds them to the towns' demand). */
export function commuteDemand(world: GameWorld): DemandPair[] {
  const t = world.tuning;
  if (!t.workersEnabled) return [];
  const pairs: DemandPair[] = [];
  for (const site of world.towns.values()) {
    if (!site.industry) continue;
    const total = (t.commutePerThousandJobs * siteJobs(world, site)) / SECONDS_PER_GAME_DAY;
    if (total <= 0) continue;
    for (const [townId, share] of workforceShares(world, site)) {
      const rate = total * share;
      pairs.push({ from: townId, to: site.id, kind: "passengers", rate });
      pairs.push({ from: site.id, to: townId, kind: "passengers", rate });
    }
  }
  return pairs;
}

/** Of a site's workers, the share getting there, 0..1: the trips to it made, over `staffFullShare`. None measured yet: full. */
export function staffing(world: GameWorld, siteId: string): number {
  if (!world.tuning.workersEnabled) return 1;
  let made = 0;
  let total = 0;
  const indexed = world.outcomeIndex?.to.get(siteId);
  if (world.outcomeIndex) {
    made = indexed?.made ?? 0;
    total = indexed?.total ?? 0;
  } else for (const [key, rates] of world.pairOutcomes) {
    if (key.slice(key.indexOf(":") + 1) !== siteId) continue;
    made += rates.player + rates.poached + rates.gaveUp;
    total += rates.player + rates.poached + rates.gaveUp + rates.lost;
  }
  if (total <= 1e-9) return 1;
  return Math.min(1, made / total / world.tuning.staffFullShare);
}

/** What a site makes of what it could, by its staffing: `staffFloor` with nobody arriving, all at full. A site with no commuters runs regardless. */
export function staffFactor(world: GameWorld, siteId: string): number {
  const site = world.towns.get(siteId);
  if (!world.tuning.workersEnabled || !site || siteJobs(world, site) <= 0) return 1;
  const floor = world.tuning.staffFloor;
  return floor + (1 - floor) * staffing(world, siteId);
}

// Towns grow around them (brief, Revision 3, step 2c). Jobs draw people:
// a town's room to grow rises by the jobs its people hold at sites they get
// to (staffed jobs only: unreachable jobs draw nobody), `peoplePerJob` each
// (their households and the trade they bring), bounded by a share of its
// start like every other share (principles §3, Growth). And a site that has
// worked, staffed, for `gateTownDays` grows a camp at its gate -- a roadside
// town on its road (settlement.ts), growing and fading with the commuters
// passing, as any roadside town does: Eleme by Port Harcourt's refinery.

/** Thousands of people a town's room to grow gains from the jobs its people hold at sites they reach. */
export function jobsGrowth(world: GameWorld, townId: string): number {
  const t = world.tuning;
  const base = world.basePopulation.get(townId);
  if (!t.workersEnabled || base === undefined) return 0;
  let jobs = 0;
  for (const site of world.towns.values()) {
    if (!site.industry) continue;
    const share = workforceShares(world, site).get(townId);
    if (share) jobs += siteJobs(world, site) * share * staffing(world, site.id);
  }
  return Math.min(base * t.jobsCapShare, jobs * t.peoplePerJob);
}

/** Days each site has worked staffed (at least half its shift), and the camp at its gate if it's grown one. */
export interface SitesState {
  workedDays: Map<string, number>;
  gates: Map<string, string>;
}

export function createSitesState(): SitesState {
  return { workedDays: new Map(), gates: new Map() };
}

/** Every tick: counts each big site's staffed days, and grows a camp at the gate of one that's worked long enough. */
export function updateSites(world: GameWorld, dt: number, foundGate: (world: GameWorld, siteId: string) => GameEvent | null): GameEvent[] {
  const t = world.tuning;
  if (!t.workersEnabled) return [];
  const events: GameEvent[] = [];
  for (const site of world.towns.values()) {
    if (!site.industry || siteJobs(world, site) < t.gateTownMinJobs) {
      world.sites.workedDays.delete(site.id);
      continue;
    }
    const days = staffing(world, site.id) >= 0.5 ? (world.sites.workedDays.get(site.id) ?? 0) + dt / SECONDS_PER_GAME_DAY : 0;
    world.sites.workedDays.set(site.id, days);
    const gate = world.sites.gates.get(site.id);
    if (gate && world.towns.has(gate)) continue;
    if (days < t.gateTownDays) continue;
    const founded = foundGate(world, site.id);
    if (founded?.kind === "founded") {
      world.sites.gates.set(site.id, founded.townId);
      events.push(founded);
    }
  }
  return events;
}
