import type { CargoKind, DeliveryEvent, Vehicle } from "../simulation/types";
import { createVehicle, freeSeats, nodesAhead, type Loader } from "../simulation/vehicle";
import { canAfford, registerPurchase, resaleValue, sellVehicle } from "../economy/state";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import type { SliceRoute, SliceWorld } from "./types";
import { cycleFraction, largestGapMidpoint, placeAtCycleFraction, roadPath, routeKey, type ActionResult } from "./world";

// Goods (docs/principles.md §6, step 4: depth, one at a time -- goods
// third, the user's pick: produce and supplies, freight fares only, no
// growth link yet). Rules from §3, Findings:
//
//   - Goods stay one-way (Demand): produce leaves farm towns for the
//     nearest market and never comes back; supplies leave the port city for
//     every town. A lorry runs full both ways only where both flows meet --
//     that is the decision: which routes carry goods each way.
//   - Paratransit is passengers-only: no one else carries freight. Goods
//     nobody carries wait at the yard and spoil -- lost, not poached, and
//     never counted against your passenger share.
//
// Lorries are their own routes (world.lorryRoutes), not buses: every
// passenger system reads world.routes. What they share is the road -- road
// space for congestion, and heavier wear (wear.ts) -- and the money.

export const LORRY_DEF_ID = "slice-lorry";

export type GoodsKind = Extract<CargoKind, "produce" | "supplies">;

/** One one-way goods flow: tonnes per second wanting to go from one town to another. */
export interface GoodsFlow {
  from: string;
  to: string;
  kind: GoodsKind;
  rate: number;
}

/** Where a flow's goods ended up, rolling tonnes per second. */
export interface GoodsOutcome {
  delivered: number;
  spoiled: number;
}

export interface GoodsState {
  /** town -> `to|kind` -> tonnes waiting at its yard. */
  yards: Map<string, Map<string, number>>;
  /** `from:to:kind` -> rolling outcome. */
  outcomes: Map<string, GoodsOutcome>;
}

export function createGoodsState(): GoodsState {
  return { yards: new Map(), outcomes: new Map() };
}

export function flowKey(flow: { from: string; to: string; kind: GoodsKind }): string {
  return `${flow.from}:${flow.to}:${flow.kind}`;
}

function yardKey(to: string, kind: GoodsKind): string {
  return `${to}|${kind}`;
}

function parseYardKey(key: string): { to: string; kind: GoodsKind } {
  const bar = key.indexOf("|");
  return { to: key.slice(0, bar), kind: key.slice(bar + 1) as GoodsKind };
}

/**
 * The goods flows, from the towns as they are now (so a growing town makes
 * more). Produce: every original town below market size sends it to the
 * nearest market town (a tie goes to the bigger market). Supplies: the
 * port sends them to every other town, roadside ones included. Roadside
 * towns grow no produce -- they're markets on the way, not farms.
 */
export function goodsFlows(world: SliceWorld): GoodsFlow[] {
  const { tuning } = world;
  const perSecond = (perThousandPerDay: number, population: number) => (perThousandPerDay * population) / SECONDS_PER_GAME_DAY;
  const towns = [...world.towns.values()];
  const markets = towns.filter((town) => town.population >= tuning.marketPopulation && world.basePopulation.has(town.id));
  const flows: GoodsFlow[] = [];
  for (const town of towns) {
    if (!world.basePopulation.has(town.id) || town.population >= tuning.marketPopulation || town.id === world.port) continue;
    const market = [...markets].sort(
      (p, q) => Math.hypot(p.x - town.x, p.y - town.y) - Math.hypot(q.x - town.x, q.y - town.y) || q.population - p.population,
    )[0];
    if (market) flows.push({ from: town.id, to: market.id, kind: "produce", rate: perSecond(tuning.producePerThousandPerDay, town.population) });
  }
  const port = world.port ? world.towns.get(world.port) : undefined;
  if (port) {
    for (const town of towns) {
      if (town.id === port.id) continue;
      flows.push({ from: port.id, to: town.id, kind: "supplies", rate: perSecond(tuning.suppliesPerThousandPerDay, town.population) });
    }
  }
  return flows;
}

/** Goods arrive at their yards, and some of what's waiting spoils. Before the lorries move. */
export function produceAndSpoil(world: SliceWorld, dt: number): void {
  const { goods, tuning } = world;
  const spoil = 1 - Math.exp(-dt / tuning.goodsSpoilSeconds);
  const alpha = 1 - Math.exp(-dt / tuning.outcomeTauSeconds);
  const spoiled = new Map<string, number>();
  for (const flow of goodsFlows(world)) {
    if (!goods.yards.has(flow.from)) goods.yards.set(flow.from, new Map());
    const yard = goods.yards.get(flow.from)!;
    const key = yardKey(flow.to, flow.kind);
    const waiting = (yard.get(key) ?? 0) + flow.rate * dt;
    const lost = waiting * spoil;
    yard.set(key, waiting - lost);
    spoiled.set(flowKey(flow), lost);
  }
  for (const [key, lost] of spoiled) {
    const outcome = goods.outcomes.get(key) ?? { delivered: 0, spoiled: 0 };
    outcome.spoiled += (lost / dt - outcome.spoiled) * alpha;
    goods.outcomes.set(key, outcome);
  }
}

/** A lorry loads goods bound for anywhere ahead on its route. No transfers: freight goes straight. */
export function goodsLoader(world: SliceWorld, loaded: Map<string, number>, routeOf: Map<string, string>): Loader {
  return (vehicle, at, index) => {
    const yard = world.goods.yards.get(at);
    if (!yard) return;
    const ahead = nodesAhead(vehicle, index);
    let free = freeSeats(vehicle);
    for (const [key, amount] of yard) {
      if (free <= 0) break;
      if (amount <= 0) continue;
      const { to, kind } = parseYardKey(key);
      if (!ahead.has(to)) continue;
      const take = Math.min(amount, free);
      vehicle.cargo.push({ from: at, to, kind, amount: take });
      yard.set(key, amount - take);
      free -= take;
      const routeId = routeOf.get(vehicle.id);
      if (routeId) loaded.set(routeId, (loaded.get(routeId) ?? 0) + take);
    }
  };
}

/** Records goods delivered this tick against their flows' outcomes. */
export function recordGoodsDelivered(deliveries: DeliveryEvent[], delivered: Map<string, number>): void {
  for (const { entry, amount } of deliveries) {
    if (!entry || entry.kind === "passengers") continue;
    const key = flowKey({ from: entry.from, to: entry.to, kind: entry.kind });
    delivered.set(key, (delivered.get(key) ?? 0) + amount);
  }
}

/** Once per tick, after the lorries move: roll each flow's delivered rate. */
export function updateGoodsOutcomes(world: SliceWorld, delivered: Map<string, number>, dt: number): void {
  const alpha = 1 - Math.exp(-dt / world.tuning.outcomeTauSeconds);
  for (const flow of goodsFlows(world)) {
    const key = flowKey(flow);
    const outcome = world.goods.outcomes.get(key) ?? { delivered: 0, spoiled: 0 };
    outcome.delivered += ((delivered.get(key) ?? 0) / dt - outcome.delivered) * alpha;
    world.goods.outcomes.set(key, outcome);
  }
}

// --- Lorry routes -----------------------------------------------------------

function lorryRouteId(a: string, b: string): string {
  return `lorry:${routeKey(a, b)}`;
}

export function isLorryRoute(routeId: string): boolean {
  return routeId.startsWith("lorry:");
}

export function findLorryRoute(world: SliceWorld, a: string, b: string): SliceRoute | undefined {
  return world.lorryRoutes.find((route) => route.id === lorryRouteId(a, b));
}

export function checkLorry(world: SliceWorld, a: string, b: string): ActionResult {
  if (a === b) return { ok: false, reason: "pick two different towns" };
  if (!roadPath(world, a, b)) return { ok: false, reason: "no road between them" };
  if (!canAfford(world.economy, world.tuning.lorryPurchaseCost)) return { ok: false, reason: "can't afford a lorry" };
  return { ok: true };
}

export function addLorry(world: SliceWorld, a: string, b: string): ActionResult {
  const check = checkLorry(world, a, b);
  if (!check.ok) return check;
  let route = findLorryRoute(world, a, b);
  if (!route) {
    route = { id: lorryRouteId(a, b), a, b, vehicleIds: [], revenueRateEMA: 0, boardingRateEMA: 0, loadFactorEMA: 0, speedEMA: 1 };
    world.lorryRoutes.push(route);
  }
  const { tuning } = world;
  const id = `lorry-${world.nextId++}`;
  const vehicle = createVehicle(id, [route.a, route.b], world.simulation.routing, tuning.lorrySpeed, tuning.lorryCapacity, undefined, "goods", tuning.lorryRoadSpace);
  // Spread out like buses (world.ts addBus): a convoy serves no more often than one.
  const others = route.vehicleIds
    .map((otherId) => world.simulation.vehicles.find((candidate) => candidate.id === otherId))
    .filter((candidate): candidate is Vehicle => candidate !== undefined);
  placeAtCycleFraction(world, vehicle, largestGapMidpoint(others.map((other) => cycleFraction(world, other))));
  world.simulation.vehicles.push(vehicle);
  registerPurchase(world.economy, id, tuning.lorryPurchaseCost, tuning.lorryOperatingCostPerSecond, LORRY_DEF_ID);
  route.vehicleIds.push(id);
  return { ok: true };
}

/** Sells the route's most recently bought lorry, at depreciated value; what it carried is lost. */
export function removeLorry(world: SliceWorld, routeId: string): number {
  const route = world.lorryRoutes.find((candidate) => candidate.id === routeId);
  const id = route?.vehicleIds.pop();
  if (!route || !id) return 0;
  world.simulation.vehicles = world.simulation.vehicles.filter((vehicle) => vehicle.id !== id);
  const resale = sellVehicle(world.economy, id);
  if (route.vehicleIds.length === 0) world.lorryRoutes = world.lorryRoutes.filter((candidate) => candidate !== route);
  return resale;
}

export interface LorrySummary {
  id: string;
  a: string;
  b: string;
  lorries: number;
  incomePerDay: number;
  costPerDay: number;
  netPerDay: number;
}

/** Each lorry route's rolling P&L, worst first -- the routes panel's lorry rows. */
export function lorrySummaries(world: SliceWorld): LorrySummary[] {
  return world.lorryRoutes
    .map((route) => {
      const incomePerDay = route.revenueRateEMA * SECONDS_PER_GAME_DAY;
      const costPerDay = route.vehicleIds.length * world.tuning.lorryOperatingCostPerSecond * SECONDS_PER_GAME_DAY;
      return { id: route.id, a: route.a, b: route.b, lorries: route.vehicleIds.length, incomePerDay, costPerDay, netPerDay: incomePerDay - costPerDay };
    })
    .sort((p, q) => p.netPerDay - q.netPerDay);
}

export function lorryResale(world: SliceWorld, routeId: string): number {
  const route = world.lorryRoutes.find((candidate) => candidate.id === routeId);
  return route ? route.vehicleIds.reduce((sum, id) => sum + resaleValue(world.economy, id), 0) : 0;
}

// --- What a lorry route carries --------------------------------------------

/** Tonnes a day of goods wanting to go each way along the road from a to b: what a lorry there could carry. */
export function goodsAlong(world: SliceWorld, a: string, b: string): { outbound: number; inbound: number } {
  const path = roadPath(world, a, b);
  if (!path) return { outbound: 0, inbound: 0 };
  const order = new Map(path.nodeIds.map((id, i) => [id, i]));
  let outbound = 0;
  let inbound = 0;
  for (const flow of goodsFlows(world)) {
    const i = order.get(flow.from);
    const j = order.get(flow.to);
    if (i === undefined || j === undefined) continue;
    if (i < j) outbound += flow.rate;
    else inbound += flow.rate;
  }
  return { outbound: outbound * SECONDS_PER_GAME_DAY, inbound: inbound * SECONDS_PER_GAME_DAY };
}

export interface LorryDiagnosis {
  routeId: string;
  /** Tonnes a day wanting to go each way along it (a -> b, b -> a): every flow with both ends on its path. */
  outbound: number;
  inbound: number;
  /** Of those, the share delivered by you (any lorry) and spoiled, 0..1. */
  delivered: number;
  spoiled: number;
  loadFactor: number;
  verdict: "thin" | "one-way" | "full" | "spoiling" | "healthy";
}

// A route whose weaker direction carries under this share of its stronger
// one runs half-empty -- one-way, the thing the goods rules warn about.
const ONE_WAY_SHARE = 0.3;
const FULL_LOAD = 0.85;
const SPOILING_SHARE = 0.3;

export function diagnoseLorryRoute(world: SliceWorld, routeId: string): LorryDiagnosis | null {
  const route = world.lorryRoutes.find((candidate) => candidate.id === routeId);
  const path = route && roadPath(world, route.a, route.b);
  if (!route || !path) return null;
  const order = new Map(path.nodeIds.map((id, i) => [id, i]));
  let outbound = 0;
  let inbound = 0;
  let delivered = 0;
  let spoiled = 0;
  for (const flow of goodsFlows(world)) {
    const i = order.get(flow.from);
    const j = order.get(flow.to);
    if (i === undefined || j === undefined) continue;
    if (i < j) outbound += flow.rate;
    else inbound += flow.rate;
    const outcome = world.goods.outcomes.get(flowKey(flow));
    delivered += outcome?.delivered ?? 0;
    spoiled += outcome?.spoiled ?? 0;
  }
  const total = delivered + spoiled;
  const perDay = (rate: number) => rate * SECONDS_PER_GAME_DAY;
  const diagnosis: LorryDiagnosis = {
    routeId,
    outbound: perDay(outbound),
    inbound: perDay(inbound),
    delivered: total > 0 ? delivered / total : 0,
    spoiled: total > 0 ? spoiled / total : 0,
    loadFactor: route.loadFactorEMA,
    verdict: "healthy",
  };
  const { tuning } = world;
  const fare = Math.min(tuning.produceFare, tuning.suppliesFare);
  const oneLorryPerDay = tuning.lorryOperatingCostPerSecond * SECONDS_PER_GAME_DAY;
  const weaker = Math.min(diagnosis.outbound, diagnosis.inbound);
  const stronger = Math.max(diagnosis.outbound, diagnosis.inbound);
  if ((diagnosis.outbound + diagnosis.inbound) * fare < oneLorryPerDay) diagnosis.verdict = "thin";
  else if (route.loadFactorEMA >= FULL_LOAD) diagnosis.verdict = "full";
  else if (weaker < stronger * ONE_WAY_SHARE) diagnosis.verdict = "one-way";
  else if (diagnosis.spoiled >= SPOILING_SHARE) diagnosis.verdict = "spoiling";
  return diagnosis;
}

/** Tonnes a day of goods leaving and arriving at a town, and how much of each is delivered. */
export function townGoods(world: SliceWorld, townId: string): Array<{ other: string; kind: GoodsKind; outgoing: boolean; perDay: number; delivered: number }> {
  return goodsFlows(world)
    .filter((flow) => flow.from === townId || flow.to === townId)
    .map((flow) => {
      const outcome = world.goods.outcomes.get(flowKey(flow));
      const total = (outcome?.delivered ?? 0) + (outcome?.spoiled ?? 0);
      return {
        other: flow.from === townId ? flow.to : flow.from,
        kind: flow.kind,
        outgoing: flow.from === townId,
        perDay: flow.rate * SECONDS_PER_GAME_DAY,
        delivered: total > 0 ? (outcome?.delivered ?? 0) / total : 0,
      };
    })
    .sort((p, q) => q.perDay - p.perDay);
}
