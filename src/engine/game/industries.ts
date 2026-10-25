import type { IndustryKind, GameTown, GameWorld } from "./types";
import type { GameEvent } from "./settlement";
import { refreshDemand, retireNode } from "./settlement";
import { flowKey, type GoodsFlow } from "./goods";
import { isWater } from "../pathing/terrainAStar";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import { cementActive } from "./cement";
import { staffFactor } from "./workers";
import { expandLevel } from "./expand";
import { homeBox } from "./fuel";

// Industries that open and close (docs/brief.md, Revision 2: the second
// economy). A site, not a town: a few workers of its own, and goods it wants
// moved. They come and go, so the map keeps asking after every town is
// connected -- the R1 7 playtest ended at "nothing more to build".
//
// One kind first, the quarry (the brief's order): no input, so it plays
// without a chain. Its stone goes to the towns nearest it and to the port,
// and feeds construction: a town getting the stone it wants can grow more
// (growth.ts). A quarry opens near the ridge where the map has one.
//
//   - Opening: the first on day `industryFirstDay`, then one every
//     `industryEveryMinDays`-`industryEveryMaxDays`, at most
//     `industryMaxOpen` at once; announced as an event with what it wants.
//   - Closing: one nothing is moved from in its first `industryGraceDays`
//     closes (nobody came); a quarry works out after its life
//     (`quarryLifeMinDays`-`quarryLifeMaxDays`). Its site stays on the map
//     as a ruin, as an emptied town's does, and its line goes quiet.
//
// Industries are towns with an `industry` kind, so roads, routing, yards
// and lorries treat them like any stop; what makes them a site is kept out
// of growth (no base population), markets and supplies (goods.ts), and the
// people counts (budget.ts, score.ts).

export interface IndustryState {
  id: string;
  kind: IndustryKind;
  openedAtSeconds: number;
  /** When it works out and closes, whatever's moved. */
  closesAtSeconds: number;
  /** Rolling tonnes a second of its output delivered (any vehicle): what keeps it open past its grace. */
  deliveredEMA: number;
  /** A far cluster's limestone field (clusters.ts): never works out or closes, makes more, and doesn't count against the quarries that open. */
  field?: boolean;
}

/** Stone: building supplies, carried as the supplies cargo kind, told apart by where it comes from. */
export const STONE = "stone";

/** A seeded draw kept as a number, so the world stays plain data (forecasts and probes clone it). */
function draw(world: GameWorld): number {
  // mulberry32
  let t = (world.industrySchedule.rngState = (world.industrySchedule.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createIndustrySchedule(tuning: { industryFirstDay: number }, seed: number): GameWorld["industrySchedule"] {
  return { nextAtSeconds: tuning.industryFirstDay * SECONDS_PER_GAME_DAY, rngState: seed | 0, opened: 0 };
}

export function isIndustry(town: GameTown | undefined): boolean {
  return town?.industry !== undefined;
}

/** Original towns (the map's own), the only ones a quarry ships to besides the port. */
function originalTowns(world: GameWorld): GameTown[] {
  return [...world.towns.values()].filter((town) => world.basePopulation.has(town.id));
}

/**
 * Each open quarry's stone flows: `quarryExportShare` of its output to the
 * port, the rest to its three nearest original towns by their size. One-way,
 * like all goods (principles.md §3, Demand); kind "supplies" -- building
 * supplies -- labelled stone by its source.
 */
export function industryFlows(world: GameWorld): GoodsFlow[] {
  const flows: GoodsFlow[] = [];
  const { tuning } = world;
  // With the building chain, a quarry is limestone for the works, all of it
  // (cement.ts): nobody wants it while the works is idle.
  if (cementActive(world)) {
    const cement = world.cement!;
    if (!cement.working) return flows;
    for (const industry of world.industries.values()) {
      const scale = industry.field ? tuning.fieldOutputScale ?? 1 : 1;
      if (world.towns.has(industry.id)) flows.push({ from: industry.id, to: cement.worksId, kind: "supplies", rate: (scale * tuning.quarryOutputPerDay * staffFactor(world, industry.id)) / SECONDS_PER_GAME_DAY });
    }
    return flows;
  }
  for (const industry of world.industries.values()) {
    const site = world.towns.get(industry.id);
    if (!site) continue;
    const output = (tuning.quarryOutputPerDay * staffFactor(world, industry.id)) / SECONDS_PER_GAME_DAY;
    const port = world.port && world.port !== site.id && world.towns.has(world.port) ? world.port : null;
    const toTowns = port ? 1 - tuning.quarryExportShare : 1;
    const nearest = originalTowns(world)
      .filter((town) => town.id !== port)
      .sort((p, q) => Math.hypot(p.x - site.x, p.y - site.y) - Math.hypot(q.x - site.x, q.y - site.y))
      .slice(0, 3);
    const weight = nearest.reduce((sum, town) => sum + town.population, 0);
    for (const town of nearest) flows.push({ from: site.id, to: town.id, kind: "supplies", rate: (output * toTowns * town.population) / weight });
    if (port) flows.push({ from: site.id, to: port, kind: "supplies", rate: output * tuning.quarryExportShare });
  }
  return flows;
}

/** Of the stone a town wants from every open quarry, the share delivered, 0..1 (growth.ts). */
export function stoneServed(world: GameWorld, townId: string): number {
  let wanted = 0;
  let delivered = 0;
  for (const flow of industryFlows(world)) {
    if (flow.to !== townId) continue;
    wanted += flow.rate;
    // Yours in full; truckers' at half -- informal service sustains, yours develops (principles §3).
    const outcome = world.goods.outcomes.get(flowKey(flow));
    delivered += (outcome?.delivered ?? 0) + 0.5 * (outcome?.trucked ?? 0);
  }
  return wanted > 0 ? Math.min(1, delivered / wanted) : 0;
}

/** Called every tick: rolls each site's deliveries, closes what's done, opens the next when it's due. */
export function updateIndustries(world: GameWorld, dt: number): GameEvent[] {
  const { tuning } = world;
  if (!tuning.goodsEnabled || !tuning.industriesEnabled) return [];
  const now = world.economy.elapsedSeconds;
  const events: GameEvent[] = [];
  const alpha = 1 - Math.exp(-dt / SECONDS_PER_GAME_DAY);
  const flows = industryFlows(world);
  for (const industry of [...world.industries.values()]) {
    // Moved by anyone keeps it open: an industry you ignore still ships, by trucker.
    const delivered = flows
      .filter((flow) => flow.from === industry.id)
      .reduce((sum, flow) => {
        const outcome = world.goods.outcomes.get(flowKey(flow));
        return sum + (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
      }, 0);
    industry.deliveredEMA += (delivered - industry.deliveredEMA) * alpha;
    const age = now - industry.openedAtSeconds;
    const unserved = age >= tuning.industryGraceDays * SECONDS_PER_GAME_DAY && industry.deliveredEMA * SECONDS_PER_GAME_DAY < tuning.industryMinDeliveredPerDay;
    const workedOut = now >= industry.closesAtSeconds;
    if (industry.field) continue; // a far cluster's field waits for you (clusters.ts)
    if (unserved || workedOut) events.push(closeIndustry(world, industry, workedOut ? "worked out" : "nothing moved"));
  }
  if (now >= world.industrySchedule.nextAtSeconds) {
    const gap = tuning.industryEveryMinDays + draw(world) * (tuning.industryEveryMaxDays - tuning.industryEveryMinDays);
    world.industrySchedule.nextAtSeconds = now + gap * SECONDS_PER_GAME_DAY;
    // An idle works wants no limestone: no quarry opens for it until it runs (cement.ts).
    // An expanded works lets one more quarry open for it at a time (expand.ts).
    const maxOpen = tuning.industryMaxOpen + (cementActive(world) ? expandLevel(world, world.cement!.worksId) : 0);
    const quarries = [...world.industries.values()].filter((industry) => !industry.field).length;
    if (quarries < maxOpen && (!cementActive(world) || world.cement!.working)) {
      const opened = openQuarry(world);
      if (opened) events.push(opened);
    }
  }
  return events;
}

/**
 * Opens a quarry where one fits: dry ground clear of water, 8-20 cells from
 * the nearest town (a spur's length, not on top of one), 12 from any other
 * site, near the ridge where the map has one -- and, with the building chain,
 * near the cement works it feeds (limestone is a short haul). Null when
 * nowhere fits.
 */
export function openQuarry(world: GameWorld): GameEvent | null {
  const works = cementActive(world) ? world.towns.get(world.cement!.worksId) : undefined;
  const { terrain } = world.simulation.map;
  const highest = terrain.elevation.reduce((top, e) => Math.max(top, e), 0);
  const sites = [...world.towns.values(), ...world.ruins.values()];
  let best: { x: number; y: number; score: number } | null = null;
  const box = homeBox(world);
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const x = Math.round(box.x + 4 + draw(world) * (box.width - 9));
    const y = Math.round(box.y + 4 + draw(world) * (box.height - 9));
    let wet = false;
    for (let dy = -2; dy <= 2 && !wet; dy += 1) for (let dx = -2; dx <= 2 && !wet; dx += 1) wet = isWater(terrain, x + dx, y + dy);
    if (wet) continue;
    const nearestTown = Math.min(...[...world.towns.values()].filter((t) => !isIndustry(t)).map((t) => Math.hypot(t.x - x, t.y - y)));
    if (nearestTown < 8 || nearestTown > 20) continue;
    if (sites.some((s) => Math.hypot(s.x - x, s.y - y) < (isIndustry(s) ? 12 : 6))) continue;
    // On the ridge's flanks where the map has one: higher ground scores better.
    const height = highest > 0 ? terrain.elevation[y * terrain.width + x]! / highest : 0;
    const toWorks = works ? Math.hypot(works.x - x, works.y - y) / 40 : 0;
    const score = -height + toWorks + draw(world) * 0.3;
    if (!best || score < best.score) best = { x, y, score };
  }
  if (!best) return null;
  const { tuning } = world;
  world.industrySchedule.opened += 1;
  const id = `site-${world.industrySchedule.opened}`;
  const near = [...world.towns.values()].filter((t) => !isIndustry(t)).sort((p, q) => Math.hypot(p.x - best!.x, p.y - best!.y) - Math.hypot(q.x - best!.x, q.y - best!.y))[0]!;
  const site: GameTown = { id, name: `${near.name} ${works ? "Limestone" : "Quarry"}`, x: best.x, y: best.y, population: tuning.industryWorkers, industry: "quarry" };
  world.simulation.map.nodes.push({ id, kind: "settlement", x: site.x, y: site.y });
  world.towns.set(id, site);
  world.simulation.queues.set(id, new Map());
  const now = world.economy.elapsedSeconds;
  const life = tuning.quarryLifeMinDays + draw(world) * (tuning.quarryLifeMaxDays - tuning.quarryLifeMinDays);
  world.industries.set(id, { id, kind: "quarry", openedAtSeconds: now, closesAtSeconds: now + life * SECONDS_PER_GAME_DAY, deliveredEMA: 0 });
  world.plans = null;
  refreshDemand(world);
  return { kind: "industry-opened", townId: id, name: site.name, industry: "quarry", near: near.id };
}

function closeIndustry(world: GameWorld, industry: IndustryState, reason: "worked out" | "nothing moved"): GameEvent {
  const site = world.towns.get(industry.id)!;
  world.industries.delete(industry.id);
  world.goods.yards.delete(industry.id);
  retireNode(world, industry.id);
  return { kind: "industry-closed", townId: industry.id, name: site.name, reason };
}
