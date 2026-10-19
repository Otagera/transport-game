import type { IndustryKind, SliceTown, SliceWorld } from "./types";
import type { SliceEvent } from "./settlement";
import { refreshDemand, retireNode } from "./settlement";
import { flowKey, type GoodsFlow } from "./goods";
import { isWater } from "../pathing/terrainAStar";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

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
}

/** Stone: building supplies, carried as the supplies cargo kind, told apart by where it comes from. */
export const STONE = "stone";

/** A seeded draw kept as a number, so the world stays plain data (forecasts and probes clone it). */
function draw(world: SliceWorld): number {
  // mulberry32
  let t = (world.industrySchedule.rngState = (world.industrySchedule.rngState + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function createIndustrySchedule(tuning: { industryFirstDay: number }, seed: number): SliceWorld["industrySchedule"] {
  return { nextAtSeconds: tuning.industryFirstDay * SECONDS_PER_GAME_DAY, rngState: seed | 0, opened: 0 };
}

export function isIndustry(town: SliceTown | undefined): boolean {
  return town?.industry !== undefined;
}

/** Original towns (the map's own), the only ones a quarry ships to besides the port. */
function originalTowns(world: SliceWorld): SliceTown[] {
  return [...world.towns.values()].filter((town) => world.basePopulation.has(town.id));
}

/**
 * Each open quarry's stone flows: `quarryExportShare` of its output to the
 * port, the rest to its three nearest original towns by their size. One-way,
 * like all goods (principles.md §3, Demand); kind "supplies" -- building
 * supplies -- labelled stone by its source.
 */
export function industryFlows(world: SliceWorld): GoodsFlow[] {
  const flows: GoodsFlow[] = [];
  const { tuning } = world;
  for (const industry of world.industries.values()) {
    const site = world.towns.get(industry.id);
    if (!site) continue;
    const output = tuning.quarryOutputPerDay / SECONDS_PER_GAME_DAY;
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
export function stoneServed(world: SliceWorld, townId: string): number {
  let wanted = 0;
  let delivered = 0;
  for (const flow of industryFlows(world)) {
    if (flow.to !== townId) continue;
    wanted += flow.rate;
    delivered += world.goods.outcomes.get(flowKey(flow))?.delivered ?? 0;
  }
  return wanted > 0 ? Math.min(1, delivered / wanted) : 0;
}

/** Called every tick: rolls each site's deliveries, closes what's done, opens the next when it's due. */
export function updateIndustries(world: SliceWorld, dt: number): SliceEvent[] {
  const { tuning } = world;
  if (!tuning.goodsEnabled || !tuning.industriesEnabled) return [];
  const now = world.economy.elapsedSeconds;
  const events: SliceEvent[] = [];
  const alpha = 1 - Math.exp(-dt / SECONDS_PER_GAME_DAY);
  const flows = industryFlows(world);
  for (const industry of [...world.industries.values()]) {
    const delivered = flows.filter((flow) => flow.from === industry.id).reduce((sum, flow) => sum + (world.goods.outcomes.get(flowKey(flow))?.delivered ?? 0), 0);
    industry.deliveredEMA += (delivered - industry.deliveredEMA) * alpha;
    const age = now - industry.openedAtSeconds;
    const unserved = age >= tuning.industryGraceDays * SECONDS_PER_GAME_DAY && industry.deliveredEMA * SECONDS_PER_GAME_DAY < tuning.industryMinDeliveredPerDay;
    const workedOut = now >= industry.closesAtSeconds;
    if (unserved || workedOut) events.push(closeIndustry(world, industry, workedOut ? "worked out" : "nothing moved"));
  }
  if (now >= world.industrySchedule.nextAtSeconds) {
    const gap = tuning.industryEveryMinDays + draw(world) * (tuning.industryEveryMaxDays - tuning.industryEveryMinDays);
    world.industrySchedule.nextAtSeconds = now + gap * SECONDS_PER_GAME_DAY;
    if (world.industries.size < tuning.industryMaxOpen) {
      const opened = openQuarry(world);
      if (opened) events.push(opened);
    }
  }
  return events;
}

/**
 * Opens a quarry where one fits: dry ground clear of water, 8-20 cells from
 * the nearest town (a spur's length, not on top of one), 12 from any other
 * site, near the ridge where the map has one. Null when nowhere fits.
 */
export function openQuarry(world: SliceWorld): SliceEvent | null {
  const { terrain } = world.simulation.map;
  const highest = terrain.elevation.reduce((top, e) => Math.max(top, e), 0);
  const sites = [...world.towns.values(), ...world.ruins.values()];
  let best: { x: number; y: number; score: number } | null = null;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const x = Math.round(4 + draw(world) * (terrain.width - 9));
    const y = Math.round(4 + draw(world) * (terrain.height - 9));
    let wet = false;
    for (let dy = -2; dy <= 2 && !wet; dy += 1) for (let dx = -2; dx <= 2 && !wet; dx += 1) wet = isWater(terrain, x + dx, y + dy);
    if (wet) continue;
    const nearestTown = Math.min(...[...world.towns.values()].filter((t) => !isIndustry(t)).map((t) => Math.hypot(t.x - x, t.y - y)));
    if (nearestTown < 8 || nearestTown > 20) continue;
    if (sites.some((s) => Math.hypot(s.x - x, s.y - y) < (isIndustry(s) ? 12 : 6))) continue;
    // On the ridge's flanks where the map has one: higher ground scores better.
    const height = highest > 0 ? terrain.elevation[y * terrain.width + x]! / highest : 0;
    const score = -height + draw(world) * 0.3;
    if (!best || score < best.score) best = { x, y, score };
  }
  if (!best) return null;
  const { tuning } = world;
  world.industrySchedule.opened += 1;
  const id = `site-${world.industrySchedule.opened}`;
  const near = [...world.towns.values()].filter((t) => !isIndustry(t)).sort((p, q) => Math.hypot(p.x - best!.x, p.y - best!.y) - Math.hypot(q.x - best!.x, q.y - best!.y))[0]!;
  const site: SliceTown = { id, name: `${near.name} Quarry`, x: best.x, y: best.y, population: tuning.industryWorkers, industry: "quarry" };
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

function closeIndustry(world: SliceWorld, industry: IndustryState, reason: "worked out" | "nothing moved"): SliceEvent {
  const site = world.towns.get(industry.id)!;
  world.industries.delete(industry.id);
  world.goods.yards.delete(industry.id);
  retireNode(world, industry.id);
  return { kind: "industry-closed", townId: industry.id, name: site.name, reason };
}
