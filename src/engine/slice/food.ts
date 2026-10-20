import type { SliceTown, SliceWorld } from "./types";
import { flowKey, type GoodsFlow } from "./goods";
import { refreshDemand } from "./settlement";
import { isCutOff, roadPath } from "./world";
import { rebuildNetworks } from "./rail";
import { addSite, dry, nearestDistance } from "./fuel";
import { inheritedRoad } from "./cement";
import { staffFactor } from "./workers";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// The food chain (docs/brief.md, Revision 3, step 3). Farm towns -- every
// original town below market size but the port -- grow the region's staple
// and its cash crop. The staple goes to one mill, always working, among the
// farm towns, which makes the region's food from it (none without it) for
// the market towns. The cash crop goes straight to the port, for export:
// you earn its freight and, from the state, an export payment a tonne
// (tick.ts). A market town's food draws its market days (3b, settlement.ts
// refreshDemand: more trips to it) and some room to grow (growth.ts).
//
//   farm towns --staple--> mill --food--> market towns
//   farm towns --cash crop--> the port (export)
//
// Replaces, with food on, the produce each farm town sent its nearest
// market and the share markets sent on to the port (goods.ts). Cargo is
// named by where it goes and comes from (fuel.ts cargoName), not a new
// cargo kind.

export interface Crops {
  staple: string;
  food: string;
  mill: string;
  cash: string;
}

/** What each part of the country grows and makes (brief, Real cargo, by region; general knowledge, to check). */
const CROPS: Record<string, Crops> = {
  southwest: { staple: "cassava", food: "garri", mill: "Garri Mill", cash: "cocoa" },
  southSouth: { staple: "cassava", food: "garri", mill: "Garri Mill", cash: "palm oil" },
  southeast: { staple: "cassava", food: "garri", mill: "Garri Mill", cash: "palm oil" },
  middleBelt: { staple: "rice", food: "milled rice", mill: "Rice Mill", cash: "sesame" },
  north: { staple: "grain", food: "flour", mill: "Flour Mill", cash: "groundnuts" },
  northeast: { staple: "grain", food: "flour", mill: "Flour Mill", cash: "groundnuts" },
};

export interface FoodState {
  millId: string;
  crops: Crops;
  /** Tonnes a second of food the markets wanted at the start: the mill is sized from it. */
  baseWant: number;
}

export function cropsFor(region: string | undefined): Crops {
  return CROPS[region ?? "southwest"] ?? CROPS.southwest!;
}

export function foodActive(world: SliceWorld): boolean {
  return !!world.food && world.tuning.foodEnabled && world.tuning.goodsEnabled;
}

/** Original towns below market size, not the port: they farm. */
export function farmTowns(world: SliceWorld): SliceTown[] {
  return [...world.towns.values()].filter((town) => !town.industry && world.basePopulation.has(town.id) && town.population < world.tuning.marketPopulation && town.id !== world.port);
}

/** Original towns at market size: they eat what the mill makes, and hold the market days. */
export function marketTowns(world: SliceWorld): SliceTown[] {
  return [...world.towns.values()].filter((town) => !town.industry && world.basePopulation.has(town.id) && town.population >= world.tuning.marketPopulation);
}

/** Tonnes a second of food a market town wants. */
export function foodWant(world: SliceWorld, townId: string): number {
  const town = world.towns.get(townId);
  if (!town || town.industry || !world.basePopulation.has(townId) || town.population < world.tuning.marketPopulation) return 0;
  return (world.tuning.foodPerThousandPerDay * town.population) / SECONDS_PER_GAME_DAY;
}

/** The staple reaching the mill now, tonnes a second: yours and the truckers'. */
export function stapleArriving(world: SliceWorld): number {
  const food = world.food;
  if (!food) return 0;
  let total = 0;
  for (const town of farmTowns(world)) {
    const outcome = world.goods.outcomes.get(flowKey({ from: town.id, to: food.millId, kind: "produce" }));
    total += (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
  }
  return total;
}

export function millCapacity(world: SliceWorld): number {
  return world.food ? world.tuning.millShare * world.food.baseWant : 0;
}

/** What the mill makes now: its capacity, or what the staple arriving makes, whichever is less, by its staffing. */
export function millOutput(world: SliceWorld): number {
  const food = world.food;
  if (!food) return 0;
  return Math.min(millCapacity(world), stapleArriving(world) / world.tuning.staplePerFood) * staffFactor(world, food.millId);
}

/**
 * The food chain's flows (goods.ts takes them in place of produce and its
 * exports): each farm town's staple to the mill and its cash crop to the
 * port, by its size; the mill's food split over the market towns its road
 * reaches by what each wants (split, not nearest first: principles §3,
 * Economy).
 */
export function foodFlows(world: SliceWorld): GoodsFlow[] {
  const food = world.food;
  if (!food || !foodActive(world)) return [];
  const t = world.tuning;
  const perSecond = (perThousandPerDay: number, population: number) => (perThousandPerDay * population) / SECONDS_PER_GAME_DAY;
  const flows: GoodsFlow[] = [];
  for (const town of farmTowns(world)) {
    flows.push({ from: town.id, to: food.millId, kind: "produce", rate: perSecond(t.producePerThousandPerDay, town.population) });
    if (world.port && world.towns.has(world.port)) flows.push({ from: town.id, to: world.port, kind: "produce", rate: perSecond(t.cashCropPerThousandPerDay, town.population) });
  }
  const takers = marketTowns(world).filter((town) => roadPath(world, food.millId, town.id));
  const wanted = takers.reduce((sum, town) => sum + foodWant(world, town.id), 0);
  const made = millOutput(world);
  if (made > 0 && wanted > 0) {
    const share = Math.min(1, made / wanted);
    for (const town of takers) flows.push({ from: food.millId, to: town.id, kind: "supplies", rate: foodWant(world, town.id) * share });
  }
  return flows;
}

/** Of the food a market town wants, the share delivered (yours and the truckers'), 0..1. */
export function foodServed(world: SliceWorld, townId: string): number {
  const food = world.food;
  const want = foodWant(world, townId);
  if (!food || want <= 0) return 0;
  const outcome = world.goods.outcomes.get(flowKey({ from: food.millId, to: townId, kind: "supplies" }));
  return Math.min(1, ((outcome?.delivered ?? 0) + (outcome?.trucked ?? 0)) / want);
}

/** Cash crop reaching the port now, tonnes a second (anyone's): what the export payment is paid on. */
export function exportsArriving(world: SliceWorld): number {
  if (!foodActive(world) || !world.port) return 0;
  let total = 0;
  for (const town of farmTowns(world)) {
    const outcome = world.goods.outcomes.get(flowKey({ from: town.id, to: world.port, kind: "produce" }));
    total += (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
  }
  return total;
}

/** The state's export payment this tick (tick.ts): a sum a tonne of cash crop that reaches the port. */
export function payExports(world: SliceWorld, dt: number): number {
  const paid = exportsArriving(world) * dt * world.tuning.exportPayPerTonne;
  if (paid <= 0) return 0;
  world.economy.funds += paid;
  world.budget.exports += paid;
  return paid;
}

/**
 * Places the mill on a new game's map, before the warm-up (start.ts), after
 * the fuel and cement sites: the dry spot nearest the farm towns' middle
 * (weighted by size) that's 8+ cells from any town and within 16 of one on
 * the network, with an old road to that one.
 */
export function placeMill(world: SliceWorld, region: string | undefined): void {
  if (!world.tuning.foodEnabled || !world.tuning.goodsEnabled || world.food) return;
  const farms = farmTowns(world);
  if (farms.length === 0) return;
  const weight = farms.reduce((sum, town) => sum + town.population, 0);
  const cx = farms.reduce((sum, town) => sum + town.x * town.population, 0) / weight;
  const cy = farms.reduce((sum, town) => sum + town.y * town.population, 0) / weight;
  const linked = [...world.towns.values()].filter((town) => !town.industry && !isCutOff(world, town.id));
  if (linked.length === 0) return;
  const nearLinked = (x: number, y: number) => Math.min(...linked.map((town) => Math.hypot(town.x - x, town.y - y)));
  let best: { x: number; y: number; s: number } | null = null;
  for (let y = 4; y < world.height - 4; y += 1) {
    for (let x = 4; x < world.width - 4; x += 1) {
      if (!dry(world, x, y, 2) || nearestDistance(world, x, y) < 8 || nearLinked(x, y) > 16) continue;
      const s = -Math.hypot(x - cx, y - cy);
      if (!best || s > best.s) best = { x, y, s };
    }
  }
  if (!best) return;
  const near = [...linked].sort((p, q) => Math.hypot(p.x - best!.x, p.y - best!.y) - Math.hypot(q.x - best!.x, q.y - best!.y))[0]!;
  const crops = cropsFor(region);
  const baseWant = marketTowns(world).reduce((sum, town) => sum + foodWant(world, town.id), 0);
  addSite(world, "food-mill", `${near.name} ${crops.mill}`, "mill", best);
  inheritedRoad(world, "food-mill-road", "food-mill", near.id);
  world.food = { millId: "food-mill", crops, baseWant };
  world.plans = null;
  rebuildNetworks(world);
  refreshDemand(world);
}

/**
 * Market days (brief, Revision 3, step 3b): a market town with food draws
 * market trips from the towns around it -- every trip to or from it grows by
 * `marketTripBoost` at full food, less as it runs short (both ways: trips
 * are reciprocal, principles §3). Riders for you and the danfos: short of
 * food, a market's trips shrink, and you see it in its fares. Called from
 * refreshDemand, once a day, after the rail's induced trips.
 */
export function applyMarketDays(world: SliceWorld): void {
  if (!foodActive(world) || world.tuning.marketTripBoost <= 0) return;
  const boost = new Map(marketTowns(world).map((town) => [town.id, world.tuning.marketTripBoost * foodServed(world, town.id)]));
  for (const pair of world.simulation.demand) {
    const extra = Math.max(boost.get(pair.from) ?? 0, boost.get(pair.to) ?? 0);
    if (extra > 0) pair.rate *= 1 + extra;
  }
}

/** Thousands of people of room a fed market gains (growth.ts): up to `foodCapShare` of its start at full food. */
export function foodGrowth(world: SliceWorld, townId: string): number {
  const base = world.basePopulation.get(townId);
  if (!foodActive(world) || base === undefined || foodWant(world, townId) <= 0) return 0;
  return base * world.tuning.foodCapShare * foodServed(world, townId);
}
