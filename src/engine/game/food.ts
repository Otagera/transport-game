import { inFarmBelt } from "./clusters";
import { exportGateway, importsArriving } from "./gateways";
import type { GameTown, GameWorld } from "./types";
import { flowKey, type GoodsFlow } from "./goods";
import { refreshDemand } from "./settlement";
import { isCutOff, roadPath } from "./world";
import { rebuildNetworks } from "./rail";
import { addSite, dry, homeBox, inHome, nearestDistance, ringSpot } from "./fuel";
import { inheritedRoad } from "./cement";
import { staffFactor } from "./workers";
import { siteScale } from "./expand";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// The food chain (docs/brief.md, Revision 3, step 3). Farm towns -- every
// original town below market size but the port -- grow the region's staple
// and its cash crop. The staple goes to one mill, always working, among the
// farm towns, which makes the region's food from it (none without it) for
// the market towns. The cash crop goes straight to the port, for export:
// you earn its freight and, from the state, an export payment a tonne
// (tick.ts). A market town's food draws market trade (3b, settlement.ts
// refreshDemand: more trips to it) and some room to grow (growth.ts).
//
//   farm towns --staple--> mill --food--> market towns
//   farm towns --cash crop--> the port (export)
//   the port --imported wheat--> flour mill --flour--> market towns (3c)
//
// A market's food basket is the region's food and flour together
// (`flourWeight` of it flour): market trade and room to grow read the basket
// (`marketFed`).
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
  // Sorghum and millet, milled into meal where they're grown. Wheat flour
  // isn't the north's: Nigeria's flour mills are at the ports, on imported
  // wheat (the flour mill, below, on every map).
  north: { staple: "sorghum", food: "grain meal", mill: "Grain Mill", cash: "groundnuts" },
  northeast: { staple: "sorghum", food: "grain meal", mill: "Grain Mill", cash: "groundnuts" },
};

export interface FoodState {
  millId: string;
  crops: Crops;
  /** Tonnes a second of food the markets wanted at the start: the mill is sized from it. */
  baseWant: number;
  /** The flour mill by the port, on imported wheat (step 3c); null where no port, or it wouldn't fit. */
  flourMillId: string | null;
  /** Tonnes a second of flour the markets wanted at the start: the wheat imports and the flour mill are sized from it. */
  baseFlourWant: number;
}

export function cropsFor(region: string | undefined): Crops {
  return CROPS[region ?? "southwest"] ?? CROPS.southwest!;
}

export function foodActive(world: GameWorld): boolean {
  return !!world.food && world.tuning.foodEnabled && world.tuning.goodsEnabled;
}

/**
 * Original towns that started below market size, not the port: they farm,
 * and keep farming as they grow -- a town of 60k still farms its hinterland,
 * and a grown one can be a market too. Judged by their size now (before
 * `farmsByStart`), the region farmed less the more you grew it: map 2411's
 * mill made nothing by day 122, five of its eight farm towns grown past 40k.
 */
export function farmTowns(world: GameWorld): GameTown[] {
  const size = (town: GameTown) => (world.tuning.farmsByStart ? world.basePopulation.get(town.id)! : town.population);
  return [...world.towns.values()].filter((town) => !town.industry && world.basePopulation.has(town.id) && size(town) < world.tuning.marketPopulation && town.id !== world.port);
}

/** Thousands of people a farm town's land feeds: its start (its farmland doesn't grow with it), or its size before `farmsByStart`. */
export function farmland(world: GameWorld, town: GameTown): number {
  const land = world.tuning.farmsByStart ? (world.basePopulation.get(town.id) ?? town.population) : town.population;
  // A far cluster's farm belt grows more (clusters.ts).
  return land * (inFarmBelt(world, town.id) ? world.tuning.farmBeltScale ?? 1 : 1);
}

/** Original towns at market size: they eat what the mill makes, and draw market trade. */
export function marketTowns(world: GameWorld): GameTown[] {
  return [...world.towns.values()].filter((town) => !town.industry && world.basePopulation.has(town.id) && town.population >= world.tuning.marketPopulation);
}

/** Tonnes a second of food a market town wants. */
export function foodWant(world: GameWorld, townId: string): number {
  const town = world.towns.get(townId);
  if (!town || town.industry || !world.basePopulation.has(townId) || town.population < world.tuning.marketPopulation) return 0;
  return (world.tuning.foodPerThousandPerDay * town.population) / SECONDS_PER_GAME_DAY;
}

/** The staple reaching the mill now, tonnes a second: yours and the truckers'. */
export function stapleArriving(world: GameWorld): number {
  const food = world.food;
  if (!food) return 0;
  let total = 0;
  for (const town of farmTowns(world)) {
    const outcome = world.goods.outcomes.get(flowKey({ from: town.id, to: food.millId, kind: "produce" }));
    total += (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
  }
  return total;
}

export function millCapacity(world: GameWorld): number {
  return world.food ? world.tuning.millShare * world.food.baseWant * siteScale(world, world.food.millId) : 0;
}

/** What the mill makes now: its capacity, or what the staple arriving makes, whichever is less, by its staffing. */
export function millOutput(world: GameWorld): number {
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
export function foodFlows(world: GameWorld): GoodsFlow[] {
  const food = world.food;
  if (!food || !foodActive(world)) return [];
  const t = world.tuning;
  const perSecond = (perThousandPerDay: number, population: number) => (perThousandPerDay * population) / SECONDS_PER_GAME_DAY;
  const flows: GoodsFlow[] = [];
  for (const town of farmTowns(world)) {
    flows.push({ from: town.id, to: food.millId, kind: "produce", rate: perSecond(t.producePerThousandPerDay, farmland(world, town)) });
    // Its cash crop to the gateway that nets more a tonne: the home city (on to the seaport) or the border (gateways.ts).
    const out = exportGateway(world, town.id);
    if (out && world.towns.has(out.to)) flows.push({ from: town.id, to: out.to, kind: "produce", rate: perSecond(t.cashCropPerThousandPerDay, farmland(world, town)) });
  }
  const split = (from: string, made: number, want: (id: string) => number) => {
    const takers = marketTowns(world).filter((town) => roadPath(world, from, town.id));
    const wanted = takers.reduce((sum, town) => sum + want(town.id), 0);
    if (made <= 0 || wanted <= 0) return;
    const share = Math.min(1, made / wanted);
    for (const town of takers) flows.push({ from, to: town.id, kind: "supplies", rate: want(town.id) * share });
  };
  split(food.millId, millOutput(world), (id) => foodWant(world, id));
  // The flour chain (3c): imported wheat from the port to the flour mill, its flour to the markets.
  if (food.flourMillId && world.port && world.towns.has(world.port)) {
    flows.push({ from: world.port, to: food.flourMillId, kind: "supplies", rate: t.wheatImportShare * t.wheatPerFlour * food.baseFlourWant * siteScale(world, food.flourMillId) * importsArriving(world) });
    split(food.flourMillId, flourOutput(world), (id) => flourWant(world, id));
  }
  return flows;
}

/** Tonnes a second of flour a market town wants. */
export function flourWant(world: GameWorld, townId: string): number {
  return foodWant(world, townId) > 0 ? (world.tuning.flourPerThousandPerDay * world.towns.get(townId)!.population) / SECONDS_PER_GAME_DAY : 0;
}

/** Imported wheat reaching the flour mill now, tonnes a second (anyone's). */
export function wheatArriving(world: GameWorld): number {
  const food = world.food;
  if (!food?.flourMillId || !world.port) return 0;
  const outcome = world.goods.outcomes.get(flowKey({ from: world.port, to: food.flourMillId, kind: "supplies" }));
  return (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
}

export function flourCapacity(world: GameWorld): number {
  return world.food?.flourMillId ? world.tuning.flourMillShare * world.food.baseFlourWant * siteScale(world, world.food.flourMillId) : 0;
}

/** What the flour mill makes now: its capacity, or what the wheat arriving makes, by its staffing. */
export function flourOutput(world: GameWorld): number {
  const food = world.food;
  if (!food?.flourMillId) return 0;
  return Math.min(flourCapacity(world), wheatArriving(world) / world.tuning.wheatPerFlour) * staffFactor(world, food.flourMillId);
}

/** Of the flour a market town wants, the share delivered, 0..1. */
export function flourServed(world: GameWorld, townId: string): number {
  const food = world.food;
  const want = flourWant(world, townId);
  if (!food?.flourMillId || want <= 0) return 0;
  const outcome = world.goods.outcomes.get(flowKey({ from: food.flourMillId, to: townId, kind: "supplies" }));
  return Math.min(1, ((outcome?.delivered ?? 0) + (outcome?.trucked ?? 0)) / want);
}

/** A market's food basket, 0..1: the region's food and, `flourWeight` of it, flour (none where there's no flour mill). */
export function marketFed(world: GameWorld, townId: string): number {
  const weight = world.food?.flourMillId ? world.tuning.flourWeight : 0;
  return (1 - weight) * foodServed(world, townId) + weight * flourServed(world, townId);
}

/** Of the food a market town wants, the share delivered (yours and the truckers'), 0..1. */
export function foodServed(world: GameWorld, townId: string): number {
  const food = world.food;
  const want = foodWant(world, townId);
  if (!food || want <= 0) return 0;
  const outcome = world.goods.outcomes.get(flowKey({ from: food.millId, to: townId, kind: "supplies" }));
  return Math.min(1, ((outcome?.delivered ?? 0) + (outcome?.trucked ?? 0)) / want);
}

/** Cash crop reaching a gateway now, tonnes a second (anyone's), and what it's paid: by each farm town's way out (gateways.ts). */
export function exportsBy(world: GameWorld): Array<{ to: string; tonnes: number; pay: number }> {
  if (!foodActive(world) || !world.port) return [];
  const by = new Map<string, { to: string; tonnes: number; pay: number }>();
  for (const town of farmTowns(world)) {
    const out = exportGateway(world, town.id);
    if (!out) continue;
    const outcome = world.goods.outcomes.get(flowKey({ from: town.id, to: out.to, kind: "produce" }));
    const entry = by.get(out.to) ?? { to: out.to, tonnes: 0, pay: out.pay };
    entry.tonnes += (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
    by.set(out.to, entry);
  }
  return [...by.values()];
}

/** Cash crop reaching its gateways now, tonnes a second (anyone's). */
export function exportsArriving(world: GameWorld): number {
  return exportsBy(world).reduce((sum, e) => sum + e.tonnes, 0);
}

/** The state's export payment this tick (tick.ts): a sum a tonne of cash crop that reaches the port. */
export function payExports(world: GameWorld, dt: number): number {
  // Off, nothing -- and never 0 times a rate a run file from before food doesn't have (NaN).
  if (!foodActive(world)) return 0;
  // Paid on what reaches each gateway at its rate: the coast's a share where the seaport is a haul
  // away, the border's less (gateways.ts). Without a border, every tonne at the home city as before.
  // (Without one, the sum as it always was, to the last bit: a run file replays as played.)
  const paid = world.border ? exportsBy(world).reduce((sum, e) => sum + e.tonnes * e.pay, 0) * dt : exportsArriving(world) * dt * world.tuning.exportPayPerTonne * importsArriving(world);
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
export function placeMill(world: GameWorld, region: string | undefined): void {
  if (!world.tuning.foodEnabled || !world.tuning.goodsEnabled || world.food) return;
  const farms = farmTowns(world).filter((town) => inHome(world, town));
  if (farms.length === 0) return;
  const weight = farms.reduce((sum, town) => sum + town.population, 0);
  const cx = farms.reduce((sum, town) => sum + town.x * town.population, 0) / weight;
  const cy = farms.reduce((sum, town) => sum + town.y * town.population, 0) / weight;
  const linked = [...world.towns.values()].filter((town) => !town.industry && !isCutOff(world, town.id) && inHome(world, town));
  if (linked.length === 0) return;
  const nearLinked = (x: number, y: number) => Math.min(...linked.map((town) => Math.hypot(town.x - x, town.y - y)));
  const box = homeBox(world);
  let best: { x: number; y: number; s: number } | null = null;
  for (let y = box.y + 4; y < box.y + box.height - 4; y += 1) {
    for (let x = box.x + 4; x < box.x + box.width - 4; x += 1) {
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
  world.food = { millId: "food-mill", crops, baseWant, flourMillId: null, baseFlourWant: marketTowns(world).reduce((sum, town) => sum + flourWant(world, town.id), 0) };
  // The flour mill (3c): 6-9 cells from the port, as clear of the other sites as it can be, with
  // its old road there; imported wheat comes that way (Apapa's mills sit on the docks).
  const port = world.port ? world.towns.get(world.port) : undefined;
  const flourAt = port && world.tuning.flourEnabled ? ringSpot(world, port.x, port.y, 6, 9, 5, (x, y) => nearestDistance(world, x, y)) : null;
  if (port && flourAt) {
    addSite(world, "flour-mill", `${port.name} Flour Mills`, "flourmill", flourAt);
    inheritedRoad(world, "flour-mill-road", "flour-mill", port.id);
    world.food.flourMillId = "flour-mill";
  }
  world.plans = null;
  rebuildNetworks(world);
  refreshDemand(world);
}

/**
 * Market trade (brief, Revision 3, step 3b): a market town with food draws
 * trade from the towns around it -- every trip to or from it grows by
 * `marketTripBoost` at full food, less as it runs short (both ways: trips
 * are reciprocal, principles §3). Riders for you and the danfos: short of
 * food, a market's trips shrink, and you see it in its fares. Called from
 * refreshDemand, once a day, after the rail's induced trips.
 */
export function applyMarketTrade(world: GameWorld): void {
  if (!foodActive(world) || world.tuning.marketTripBoost <= 0) return;
  const boost = new Map(marketTowns(world).map((town) => [town.id, world.tuning.marketTripBoost * marketFed(world, town.id)]));
  for (const pair of world.simulation.demand) {
    const extra = Math.max(boost.get(pair.from) ?? 0, boost.get(pair.to) ?? 0);
    if (extra > 0) pair.rate *= 1 + extra;
  }
}

/** Thousands of people of room a fed market gains (growth.ts): up to `foodCapShare` of its start at full food. */
export function foodGrowth(world: GameWorld, townId: string): number {
  const base = world.basePopulation.get(townId);
  if (!foodActive(world) || base === undefined || foodWant(world, townId) <= 0) return 0;
  return base * world.tuning.foodCapShare * marketFed(world, townId);
}
