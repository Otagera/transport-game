import { chargeFuelPremium, shortageAt, updateFuelShortage } from "./fuel";
import type { DeliveryEvent, PathResult, Vehicle } from "../simulation/types";
import { createOneShotVehicle, freeSeats, hasCompletedTrip, nodesAhead, tickVehicle, type Loader } from "../simulation/vehicle";
import { applyOperatingCosts, updateIncomeRateEMA } from "../economy/state";
import type { InformalMode, SliceRoute, SliceTuning, SliceWorld } from "./types";
import { pairKey, roadPath, takeShortestRoad } from "./world";
import { foundGateTown, updateSettlements, type SliceEvent } from "./settlement";
import { updateSites } from "./workers";
import { updateMilestones } from "./score";
import { sampleTowns } from "./problems";
import { dispatchTrucks, truckersPickUp } from "./truckers";
import { updateRetired } from "./retire";
import { updateIndustries } from "./industries";
import { corridorsAlong, updateCorridors } from "./corridors";
import { recordMoney } from "./ledger";
import { recordDay } from "./history";
import { goodsFares, legFare, passengerFares } from "./fares";
import { allocationPerDay, remit, tollFor, type Takings } from "./budget";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import { chargeRoutineUpkeep } from "./upkeep";
import { tripPlans } from "./transfers";
import { isDirt, updateRoadSpeeds, yourSpeeds } from "./congestion";
import { creditLanes, laneEncroachment, lanesBySegment, struckSegments, updateLanes } from "./pushback";
import { updateProject } from "./project";
import { chargeRoughRoads, segmentConditions, updateRoadWear } from "./wear";
import { routingFor } from "./rail";
import { goodsLoader, produceAndSpoil, recordGoodsDelivered, updateGoodsOutcomes } from "./goods";

// How much longer people wait at a motor park for a danfo to fill than
// they wait for your bus before giving up.
const PARK_PATIENCE_MULTIPLIER = 3;

/** Money in from fares: to the funds and the vehicle's own ledger, as recordDeliveryRevenue does. */
function recordFares(world: SliceWorld, vehicleId: string, revenue: number): number {
  if (revenue === 0) return 0;
  world.economy.funds += revenue;
  const entry = world.economy.ledger.get(vehicleId);
  if (entry) entry.revenue += revenue;
  return revenue;
}

/** At most this share of a danfo's riders priced out by a toll: some always pay. */
const MAX_PRICED_OUT = 0.9;

function emaAlpha(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

function bump(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

// --- Keys ---------------------------------------------------------------
// Every waiting rider remembers where their trip started, so that a rider
// changing buses at an interchange is still counted against the trip they
// are on, not as a new trip from the interchange.

/** Queue key at a stop: `destination|origin`. */
export function queueKey(destination: string, origin: string): string {
  return `${destination}|${origin}`;
}

export function parseQueueKey(key: string): { destination: string; origin: string } {
  const bar = key.indexOf("|");
  return { destination: key.slice(0, bar), origin: key.slice(bar + 1) };
}

/** Motor-park pool key: `at>origin>destination` -- where they are, and the trip they're on. */
function poolKey(at: string, origin: string, destination: string): string {
  return `${at}>${origin}>${destination}`;
}

export function parsePoolKey(key: string): { at: string; origin: string; destination: string } {
  const [at, origin, destination] = key.split(">") as [string, string, string];
  return { at, origin, destination };
}

// One slice tick. The order matters and is the whole model:
//
//   1. Passengers arrive at each town's queue (gravity demand).
//   2. Some of every queue gives up. Mean patience is `patienceSeconds`, so
//      a queue settles at rate x patience instead of growing without
//      bound -- and how much gives up depends on how often a bus comes,
//      which is what makes frequency worth paying for. Riders waiting at an
//      interchange give up the same way: a missed connection is a lost
//      rider.
//   3. Buses and danfos move. A bus boards riders whose *trip plan* gets
//      off at a stop ahead of it (transfers.ts); each leg pays a fare, as a
//      change of danfo does. A rider who gets off short of their
//      destination waits there for the next bus. A danfo passing through
//      picks up anyone whose destination is ahead of it.
//   4. People who gave up gather at a motor park. A full danfo's worth
//      leaves if a road exists and there's road space; people who won't
//      wait for one to fill take a keke or an okada; with no road, they stay
//      home (dispatchInformal).
//   5. Towns grow along busy roads, and rarely fade (settlement.ts).
//
// Every rider is counted exactly once, when their trip resolves: arrived
// on your buses, taken by a danfo, or stayed home.
export function sliceTick(world: SliceWorld, dt: number): SliceEvent[] {
  const { simulation, tuning, informal, economy } = world;
  const fundsAtStart = economy.funds;
  const arrived = new Map<string, number>();
  const poached = new Map<string, number>();
  const gaveUp = new Map<string, number>();
  const lost = new Map<string, number>();
  const changing = new Map<string, number>();

  // 1. Arrivals.
  for (const pair of simulation.demand) {
    const queue = simulation.queues.get(pair.from);
    if (queue) bump(queue, queueKey(pair.to, pair.from), pair.rate * dt);
  }

  // 2. Giving up.
  const leaveFraction = emaAlpha(dt, tuning.patienceSeconds);
  for (const [at, queue] of simulation.queues) {
    // Where fuel is short, danfos are dear and few: riders wait longer for you (fuel.ts).
    const short = shortageAt(world, at);
    const leaveFractionHere = short > 0 ? emaAlpha(dt, tuning.patienceSeconds * (1 + tuning.fuelPatience * short)) : leaveFraction;
    for (const [key, amount] of queue) {
      if (amount <= 0) continue;
      const leaving = amount * leaveFractionHere;
      queue.set(key, amount - leaving);
      const { destination, origin } = parseQueueKey(key);
      bump(informal.pool, poolKey(at, origin, destination), leaving);
    }
  }

  // 3. Movement. Road speeds are computed once, before anything moves, so
  // every vehicle sees the same road this tick (congestion.ts).
  updateRoadSpeeds(world, dt);
  // Goods arrive at their yards, and some of what's waiting spoils (goods.ts).
  if (tuning.goodsEnabled) produceAndSpoil(world, dt);
  // Truckers take some of what's waiting, short hauls fastest (truckers.ts).
  if (tuning.goodsEnabled) truckersPickUp(world, dt);
  const routeOf = new Map<string, string>();
  for (const route of [...world.routes, ...world.lorryRoutes]) for (const id of route.vehicleIds) routeOf.set(id, route.id);
  const routeById = new Map([...world.routes, ...world.lorryRoutes].map((route) => [route.id, route]));
  const goodsDelivered = new Map<string, number>();
  const goodsTrucked = new Map<string, number>();
  const boardings = new Map<string, number>();
  const routeRevenue = new Map<string, number>();
  const plans = tripPlans(world);

  // Arriving at the start of its route, a road vehicle takes a shorter road
  // built since it was bought -- before it loads, so riders board for the
  // stops it will make.
  const atStart = (vehicle: Vehicle, at: string, index: number) => {
    if (index !== 0 || world.railVehicles.has(vehicle.id)) return;
    const route = routeById.get(routeOf.get(vehicle.id) ?? "");
    if (route && at === route.a) takeShortestRoad(world, vehicle, route);
  };

  const busLoader: Loader = (vehicle, at, index) => {
    atStart(vehicle, at, index);
    const queue = simulation.queues.get(at);
    const routeId = routeOf.get(vehicle.id);
    if (!queue || !routeId) return;
    const ahead = nodesAhead(vehicle, index);
    let free = freeSeats(vehicle);
    for (const [key, amount] of queue) {
      if (free <= 0) break;
      if (amount <= 0) continue;
      const { destination, origin } = parseQueueKey(key);
      const getOff = plans.alight.get(at)?.get(destination)?.get(routeId);
      if (!getOff || !ahead.has(getOff)) continue;
      const take = Math.min(amount, free);
      vehicle.cargo.push({ from: at, to: getOff, kind: "passengers", amount: take, trip: { origin, destination } });
      queue.set(key, amount - take);
      free -= take;
      bump(boardings, routeId, take);
    }
  };

  // A lorry loads goods bound anywhere ahead on its route (goods.ts).
  const loadGoods = goodsLoader(world, boardings, routeOf);
  const lorryLoader: Loader = (vehicle, at, index) => {
    atStart(vehicle, at, index);
    loadGoods(vehicle, at, index);
  };

  // A danfo passing through takes anyone going its way -- your riders
  // included. That is the competition, not a leak.
  const danfoLoader: Loader = (vehicle, at, index) => {
    const queue = simulation.queues.get(at);
    if (!queue) return;
    const ahead = nodesAhead(vehicle, index);
    let free = freeSeats(vehicle);
    for (const [key, amount] of queue) {
      if (free <= 0) break;
      if (amount <= 0) continue;
      const { destination, origin } = parseQueueKey(key);
      if (!ahead.has(destination)) continue;
      const take = Math.min(amount, free);
      vehicle.cargo.push({ from: at, to: destination, kind: "passengers", amount: take, trip: { origin, destination } });
      queue.set(key, amount - take);
      free -= take;
      bump(poached, pairKey(origin, destination), take);
    }
  };

  // Worn roads slow everything on them (wear.ts), on top of traffic.
  const conditions = segmentConditions(world);
  // Your road vehicles run free on a bus lane (Revision 1); everyone else sees the traffic.
  const yourSpeed = yourSpeeds(world);
  let revenueThisTick = 0;
  for (const vehicle of simulation.vehicles) {
    const isDanfo = vehicle.lifecycle === "one-shot";
    const deliveries: DeliveryEvent[] = tickVehicle(
      vehicle,
      simulation.queues,
      routingFor(world, vehicle), // trains on track, everything else on roads (rail.ts)
      simulation.segmentTraffic,
      world.segmentLoad,
      dt,
      conditions,
      undefined,
      // A truck leaves loaded and stops for nothing on the way.
      vehicle.carries === "goods" ? (isDanfo ? () => {} : lorryLoader) : isDanfo ? danfoLoader : busLoader,
      isDanfo ? world.segmentSpeed : yourSpeed,
    );
    if (deliveries.length === 0) continue;
    if (isDanfo) {
      // Informal fares are the informal sector's, never the player's: a
      // trucker's at its undercut share of yours (truckers.ts).
      if (vehicle.carries === "goods") {
        informal.earnings += goodsFares(world, deliveries) * tuning.truckerFareShare;
        recordGoodsDelivered(deliveries, goodsTrucked);
      } else informal.earnings += passengerFares(world, deliveries);
      continue;
    }
    // Each leg pays a fare, on getting off (revenue on unload) -- per
    // rider, or per tonne for a lorry.
    // Passengers pay by distance (fares.ts); goods by the tonne and the cell.
    const rail = world.railVehicles.has(vehicle.id);
    const revenue = recordFares(world, vehicle.id, vehicle.carries === "goods" ? goodsFares(world, deliveries, rail) : passengerFares(world, deliveries, rail));
    revenueThisTick += revenue;
    if (vehicle.carries === "passengers") world.budget.fares += revenue;
    else world.budget.goods += revenue;
    bump(routeRevenue, routeOf.get(vehicle.id) ?? "", revenue);
    if (vehicle.carries === "goods") {
      recordGoodsDelivered(deliveries, goodsDelivered);
      continue;
    }
    for (const { entry, amount } of deliveries) {
      if (!entry) continue;
      const trip = entry.trip ?? { origin: entry.from, destination: entry.to };
      if (entry.to === trip.destination) bump(arrived, pairKey(trip.origin, trip.destination), amount);
      else {
        // Change buses here: back into this stop's queue, still on the same trip.
        bump(simulation.queues.get(entry.to)!, queueKey(trip.destination, trip.origin), amount);
        bump(changing, entry.to, amount);
      }
    }
  }

  updateGoodsOutcomes(world, goodsDelivered, dt, goodsTrucked);
  updateFuelShortage(world);

  // 4. The informal sector: danfos, then kekes and okadas.
  const takings: Takings = { tolls: 0, levies: 0, agberos: 0, leviesByCorridor: new Map(), loading: 0, touts: 0 };
  dispatchInformal(world, dt, lost, gaveUp, takings);
  // The state's allocation: a base, plus a share of the growth you caused (budget.ts).
  const allocation = (allocationPerDay(world) * dt) / SECONDS_PER_GAME_DAY;
  const otherIncome = takings.tolls + takings.levies + takings.loading + allocation;
  economy.funds += otherIncome;
  revenueThisTick += otherIncome;
  world.budget.tolls += takings.tolls;
  world.budget.levies += takings.levies;
  world.budget.agberos += takings.agberos;
  world.budget.loading += takings.loading;
  world.budget.touts += takings.touts;
  world.budget.allocation += allocation;
  reapInformal(world);

  // Roads wear with the traffic that just ran on them; maintained ones are
  // repaired as they go, and that upkeep is a running cost like a bus's.
  // Routine upkeep on the roads you built or paved, wear or no wear (upkeep.ts).
  const roadUpkeep = (tuning.wearEnabled ? updateRoadWear(world, dt) : 0) + chargeRoutineUpkeep(world, dt);
  // Bus lanes: encroachment, the union's grievance, and strict enforcement's
  // wardens (pushback.ts). First, credit each laned corridor with your fares
  // on the routes along it, so a strike's cost can be read against normal days.
  if (world.lanes.length > 0) {
    const by = lanesBySegment(world);
    for (const [routeId, revenue] of routeRevenue) {
      const route = world.routes.find((candidate) => candidate.id === routeId);
      const path = route ? roadPath(world, route.a, route.b) : null;
      if (path) creditLanes(by, path.segmentIds, revenue);
    }
  }
  const lanes = updateLanes(world, dt);
  const upkeep = roadUpkeep + lanes.cost;
  // ...and your road vehicles pay more to run on worn roads (wear.ts).
  const rough = tuning.wearEnabled ? chargeRoughRoads(world, dt, routeOf) : { total: 0, byRoute: new Map<string, number>() };
  // ...and above the pump price where towns are short of fuel (fuel.ts).
  const fuelPremium = chargeFuelPremium(world, dt, routeOf);
  for (const [routeId, extra] of fuelPremium.byRoute) rough.byRoute.set(routeId, (rough.byRoute.get(routeId) ?? 0) + extra);

  // Money. Running cost is whatever left the funds this tick that fares
  // didn't bring in -- buses, lorries, trains and road upkeep alike --
  // so the ledger never has to know every way money is spent.
  applyOperatingCosts(economy, dt, 1, upkeep);
  updateIncomeRateEMA(economy, revenueThisTick, dt);
  const runningCost = revenueThisTick - (economy.funds - fundsAtStart);
  recordMoney(world.ledger, revenueThisTick, runningCost, routeRevenue, dt, rough.byRoute);
  world.budget.running += runningCost - upkeep - fuelPremium.total;
  world.budget.fuel += fuelPremium.total;
  world.budget.upkeep += roadUpkeep;
  world.budget.enforcement += lanes.cost;
  world.budget.struck += lanes.lost;
  // A named project: done, or lapsed (project.ts) -- before the remittance reads what it holds.
  const projectEvents = updateProject(world);
  // The treasury's share of a surplus, once a period (budget.ts). After the
  // ledger: a remittance is neither income nor running cost.
  const remitted = remit(world, revenueThisTick - runningCost);

  // Rolling rates, each updated exactly once per tick (architecture hard
  // rule 7).
  const alpha = emaAlpha(dt, tuning.outcomeTauSeconds);
  // A lorry delivers in 30-tonne lumps a dozen seconds apart: its route's
  // rates roll over four times as long, or its net swung by more than it
  // earned (probe: +15/day shown against +66/day made).
  const lorryAlpha = emaAlpha(dt, tuning.outcomeTauSeconds * 4);
  for (const route of world.routes) updateRouteRates(route, alpha);
  for (const route of world.lorryRoutes) updateRouteRates(route, lorryAlpha);
  function updateRouteRates(route: SliceRoute, alpha: number): void {
    route.boardingRateEMA += ((boardings.get(route.id) ?? 0) / dt - route.boardingRateEMA) * alpha;
    route.loadFactorEMA += (routeLoadFactor(world, route.vehicleIds) - route.loadFactorEMA) * alpha;
    route.speedEMA += (routeSpeed(world, route.vehicleIds) - route.speedEMA) * alpha;
  }
  for (const townId of world.towns.keys()) {
    const previous = world.transferRateEMA.get(townId) ?? 0;
    world.transferRateEMA.set(townId, previous + ((changing.get(townId) ?? 0) / dt - previous) * alpha);
  }
  for (const [key, rates] of world.pairOutcomes) {
    rates.player += ((arrived.get(key) ?? 0) / dt - rates.player) * alpha;
    rates.poached += ((poached.get(key) ?? 0) / dt - rates.poached) * alpha;
    rates.gaveUp += ((gaveUp.get(key) ?? 0) / dt - rates.gaveUp) * alpha;
    rates.lost += ((lost.get(key) ?? 0) / dt - rates.lost) * alpha;
  }

  const events = [...updateSettlements(world, dt), ...lanes.events, ...projectEvents, ...updateMilestones(world), ...updateCorridors(world, dt, takings.leviesByCorridor), ...updateIndustries(world, dt), ...updateSites(world, dt, foundGateTown), ...updateRetired(world, dt)];
  if (remitted !== null) events.push({ kind: "remitted", amount: remitted });
  if (recordDay(world)) sampleTowns(world);
  return events;
}

function routeLoadFactor(world: SliceWorld, vehicleIds: string[]): number {
  let total = 0;
  let count = 0;
  for (const vehicle of world.simulation.vehicles) {
    if (!vehicleIds.includes(vehicle.id)) continue;
    total += 1 - freeSeats(vehicle) / vehicle.capacity;
    count += 1;
  }
  return count > 0 ? total / count : 0;
}

/** Mean speed factor of a route's buses on the segments they're on now. */
function routeSpeed(world: SliceWorld, vehicleIds: string[]): number {
  let total = 0;
  let count = 0;
  for (const vehicle of world.simulation.vehicles) {
    if (!vehicleIds.includes(vehicle.id)) continue;
    const length = vehicle.path.length;
    const from = vehicle.path[(vehicle.pathIndex - 1 + length) % length]!;
    const to = vehicle.path[vehicle.pathIndex % length]!;
    const edge = routingFor(world, vehicle).graph.get(from)?.find((candidate) => candidate.to === to);
    // Your vehicles on a bus lane go at the lane's speed, not general traffic's.
    total += edge ? (world.laneSpeed.get(edge.segmentId) ?? world.segmentSpeed.get(edge.segmentId) ?? 1) : 1;
    count += 1;
  }
  return count > 0 ? total / count : 1;
}

interface PooledRider {
  key: string;
  origin: string;
  destination: string;
  path: PathResult;
}

type Group = { at: string; riders: PooledRider[] };

/**
 * Sorts one motor-park pool into groups by where riders are and the first
 * town they'd pass through. Riders with no road go home at once; the rest
 * lose `drift` of themselves per tick to `onDrift` -- people who won't wait
 * any longer.
 */
function groupPool(
  world: SliceWorld,
  pool: Map<string, number>,
  drift: number,
  lost: Map<string, number>,
  onDrift: (key: string, trip: string, amount: number) => void,
): Group[] {
  const groups = new Map<string, Group>();
  for (const [key, pooled] of pool) {
    if (pooled <= 0) continue;
    const { at, origin, destination } = parsePoolKey(key);
    const trip = pairKey(origin, destination);
    const path = roadPath(world, at, destination);

    // No road: nobody can take them. They stay home.
    if (!path || path.nodeIds.length < 2) {
      bump(lost, trip, pooled);
      pool.set(key, 0);
      continue;
    }

    const drifting = pooled * drift;
    pool.set(key, pooled - drifting);
    onDrift(key, trip, drifting);

    const groupKey = `${at}>${path.nodeIds[1]}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { at, riders: [] };
      groups.set(groupKey, group);
    }
    group.riders.push({ key, origin, destination, path });
  }
  return [...groups.values()];
}

/** The destination in a group whose path collects the most waiting riders, and who'd be aboard. */
function bestRun(group: Group, pool: Map<string, number>): { run: PooledRider; aboard: PooledRider[]; load: number } | null {
  let best: { run: PooledRider; aboard: PooledRider[]; load: number } | null = null;
  for (const candidate of group.riders) {
    const stops = new Set(candidate.path.nodeIds);
    const aboard = group.riders.filter((rider) => stops.has(rider.destination));
    const load = aboard.reduce((sum, rider) => sum + (pool.get(rider.key) ?? 0), 0);
    if (!best || load > best.load) best = { run: candidate, aboard, load };
  }
  return best;
}

/**
 * Sends one informal vehicle of `mode` on `run`, taking `seats` riders
 * proportionally from everyone `aboard` -- if the road has space for it.
 * Road space is a budget in danfo-equivalents (each mode's congestion
 * weight), so a corridor holds a dozen danfos or forty okadas.
 */
function sendInformal(
  world: SliceWorld,
  mode: InformalMode,
  group: Group,
  run: PooledRider,
  aboard: PooledRider[],
  load: number,
  pool: Map<string, number>,
  gaveUp: Map<string, number>,
  yours: ReadonlyMap<string, number>,
  lost: Map<string, number>,
  takings: Takings,
): boolean {
  const { simulation, tuning, informal } = world;
  const spec = informalSpec(tuning, mode);
  // One road, one budget: your vehicles' road space counts against it too
  // (brief, step 5b). Released per segment, danfos otherwise filled the
  // trunk around your buses -- 8 trunk buses carried 180 riders a day
  // instead of 289, the trunk below half speed 94% of the time; counted,
  // 225 and 34%, and the danfos on Ilase-Owode fall as you add buses.
  // On strike (pushback.ts): no danfo sets off along a struck corridor. Kekes and okadas aren't the union's.
  if (mode === "danfo" && world.lanes.length > 0) {
    const struck = struckSegments(world);
    if (run.path.segmentIds.some((id) => struck.has(id))) return false;
  }
  const space = run.path.segmentIds.map((id) => (informal.segmentSpace.get(id) ?? 0) + (yours.get(id) ?? 0));
  if (space.some((used, i) => used + spec.weight > informalBudget(world, run.path.segmentIds[i]!))) return false;
  // A real operator does not join a jam that pays nothing (principles §3).
  if (run.path.segmentIds.some((id) => (world.segmentSpeed.get(id) ?? 1) < tuning.informalMinSpeed)) return false;

  const id = `${mode}-${world.nextId++}`;
  // An empty queue map: it leaves with the people who gave up on you, it
  // doesn't also sweep the queue that's still waiting for you.
  const vehicle = createOneShotVehicle(id, group.at, run.destination, simulation.routing, spec.speed, spec.capacity, spec.weight, new Map());
  if (!vehicle) return false;

  const share = Math.min(1, spec.capacity / load);
  // Tolls on the roads you built or paved, passed on to the riders
  // (brief, Money: riders must respond to price, or tolls are free money):
  // a share of those who'd board stay home instead, growing with the toll's
  // share of their fare. You're paid the toll as it sets off.
  const toll = tollFor(world, run.path.segmentIds, spec.weight);
  const riders = aboard.reduce((sum, rider) => sum + (pool.get(rider.key) ?? 0) * share, 0);
  const meanFare = riders > 0 ? aboard.reduce((sum, rider) => sum + (pool.get(rider.key) ?? 0) * share * legFare(world, group.at, rider.destination), 0) / riders : 1;
  // Where fuel is short, the danfo charges more too (fuel.ts), and that prices riders out the same way.
  const dearer = riders > 0 ? (toll > 0 ? toll / riders / meanFare : 0) + (mode === "danfo" ? tuning.fuelFarePremium * shortageAt(world, group.at) : 0) : 0;
  const stayHome = dearer > 0 ? Math.min(MAX_PRICED_OUT, tuning.priceElasticity * dearer) : 0;
  vehicle.cargo = aboard.map((rider) => {
    const pooled = pool.get(rider.key) ?? 0;
    pool.set(rider.key, pooled * (1 - share));
    const leaving = pooled * share;
    bump(gaveUp, pairKey(rider.origin, rider.destination), leaving * (1 - stayHome));
    bump(lost, pairKey(rider.origin, rider.destination), leaving * stayHome);
    return { from: group.at, to: rider.destination, kind: "passengers" as const, amount: leaving * (1 - stayHome), trip: { origin: rider.origin, destination: rider.destination } };
  });
  takings.tolls += toll;
  // The park levy, on every informal departure: the agberos keep their cut.
  const levy = tuning.levyPerSeat * spec.capacity;
  takings.levies += levy * (1 - tuning.agberoCut);
  takings.agberos += levy * tuning.agberoCut;
  for (const key of corridorsAlong(world, run.path.segmentIds)) bump(takings.leviesByCorridor, key, levy * (1 - tuning.agberoCut));
  if (world.lanes.length > 0) creditLanes(lanesBySegment(world), run.path.segmentIds, toll + levy * (1 - tuning.agberoCut));
  simulation.vehicles.push(vehicle);
  informal.active.set(id, { segmentIds: run.path.segmentIds, weight: spec.weight, mode, released: 0 });
  for (const segmentId of run.path.segmentIds) bump(informal.segmentSpace, segmentId, spec.weight);
  return true;
}

/**
 * A road's informal budget in danfo-equivalents, by surface (brief, step
 * 5b part 2): a paved road carries more than a dirt one, so paving lets
 * more danfos run -- and step 7's tolls collect from more of them.
 */
export function informalBudget(world: SliceWorld, segmentId: string): number {
  const segment = world.simulation.map.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) return world.tuning.informalRoadSpace;
  // A bus lane takes a lane from them (Revision 1) -- less what they've taken back by encroaching on it.
  if (segment.busLane) {
    const taken = laneEncroachment(world).get(segmentId) ?? 0;
    return world.tuning.informalRoadSpaceLane + (world.tuning.informalRoadSpace - world.tuning.informalRoadSpaceLane) * taken;
  }
  const surface = isDirt(segment) ? world.tuning.informalRoadSpaceDirt : world.tuning.informalRoadSpace;
  // Where fuel is short, some danfos are parked (fuel.ts): less of the road is theirs.
  const short = Math.max(shortageAt(world, segment.fromNodeId), shortageAt(world, segment.toNodeId));
  return short > 0 ? surface * (1 - world.tuning.fuelParked * short) : surface;
}

export function informalSpec(tuning: SliceTuning, mode: InformalMode): { capacity: number; speed: number; weight: number } {
  switch (mode) {
    case "danfo":
      return { capacity: tuning.danfoCapacity, speed: tuning.danfoSpeed, weight: tuning.danfoRoadSpace };
    case "keke":
      return { capacity: tuning.kekeCapacity, speed: tuning.kekeSpeed, weight: tuning.kekeRoadSpace };
    case "okada":
      return { capacity: tuning.okadaCapacity, speed: tuning.okadaSpeed, weight: tuning.okadaRoadSpace };
    case "truck":
      return { capacity: tuning.truckLoad, speed: tuning.truckSpeed, weight: tuning.lorryRoadSpace };
  }
}

// The informal sector, in two stages at each motor park:
//
// 1. Danfos. People who gave up on your bus wait for a danfo -- cheapest
//    per seat. Danfos run corridors, not pairs: a danfo heads where most
//    waiting riders are going and takes everyone whose stop is on the way.
//    (Dispatching per (origin, destination) pair split demand so thin that
//    most danfos never filled: measured, uncapping every limit barely moved
//    the stayed-home share, while one-seat danfos cut it from 53% to 33%.)
// 2. Kekes and okadas. People who won't wait any longer for a danfo to fill
//    take a keke (when three are going the same way) or an okada. This is
//    what keeps a thin gap informal instead of empty: a dense road network
//    splits leftover riders across so many directions that no danfo ever
//    fills, and before small vehicles existed those riders simply went
//    home -- measured on a 34-bus network, 38% stayed home and danfos fell
//    to 3% (playtest, day 91).
//
// Only people with no road, or who out-wait even the okadas (the road is
// out of space), stay home.
function dispatchInformal(world: SliceWorld, dt: number, lost: Map<string, number>, gaveUp: Map<string, number>, takings: Takings): void {
  const { tuning, informal } = world;
  const drift = emaAlpha(dt, tuning.patienceSeconds * PARK_PATIENCE_MULTIPLIER);
  // Road space your vehicles are using now, per segment.
  // On a bus lane they're in their own lane: not the danfos' road space.
  const laned = new Set(world.laneSpeed.keys()); // lanes in use today (not blocked by a strike)
  const yours = new Map<string, number>();
  for (const vehicle of world.simulation.vehicles) {
    if (informal.active.has(vehicle.id) || world.railVehicles.has(vehicle.id)) continue;
    const leg = world.vehicleSegment.get(vehicle.id);
    if (!leg) continue;
    const segmentId = leg.slice(0, leg.lastIndexOf("#"));
    if (!laned.has(segmentId)) bump(yours, segmentId, vehicle.congestionWeight);
  }

  const danfoGroups = groupPool(world, informal.pool, drift, lost, (key, _trip, amount) => bump(informal.smallPool, key, amount));
  for (const group of danfoGroups) {
    const best = bestRun(group, informal.pool);
    if (best && best.load >= tuning.danfoCapacity) sendInformal(world, "danfo", group, best.run, best.aboard, best.load, informal.pool, gaveUp, yours, lost, takings);
  }

  const smallGroups = groupPool(world, informal.smallPool, drift, lost, (_key, trip, amount) => bump(lost, trip, amount));
  for (const group of smallGroups) {
    const best = bestRun(group, informal.smallPool);
    if (!best) continue;
    if (best.load >= tuning.kekeCapacity) {
      if (sendInformal(world, "keke", group, best.run, best.aboard, best.load, informal.smallPool, gaveUp, yours, lost, takings)) continue;
    }
    // An okada takes one rider, from whoever has waited in the biggest crowd.
    const single = group.riders.reduce<PooledRider | null>(
      (top, rider) => ((informal.smallPool.get(rider.key) ?? 0) > (top ? informal.smallPool.get(top.key) ?? 0 : 0) ? rider : top),
      null,
    );
    const waiting = single ? informal.smallPool.get(single.key) ?? 0 : 0;
    if (single && waiting >= tuning.okadaCapacity) sendInformal(world, "okada", group, single, [single], waiting, informal.smallPool, gaveUp, yours, lost, takings);
  }

  // Truckers, on the same road budget (truckers.ts).
  if (tuning.goodsEnabled) {
    dispatchTrucks(world, takings, (segmentIds, weight) =>
      segmentIds.every((id) => (informal.segmentSpace.get(id) ?? 0) + (yours.get(id) ?? 0) + weight <= informalBudget(world, id)),
    );
  }
}

/**
 * Gives back the road space an informal vehicle holds on segments it has
 * left, and all of it once the trip is done. Space used to be held on the
 * whole path until the trip completed, so a long run (Ilaro-Ipaja) kept its
 * share of the trunk long after leaving it, and a new long road could lower
 * trips made across the network (brief, step 5b).
 */
function reapInformal(world: SliceWorld): void {
  const { simulation, informal } = world;
  const release = (info: { segmentIds: string[]; weight: number; released: number }, upTo: number) => {
    for (; info.released < upTo; info.released += 1) bump(informal.segmentSpace, info.segmentIds[info.released]!, -info.weight);
  };
  simulation.vehicles = simulation.vehicles.filter((vehicle: Vehicle) => {
    const info = informal.active.get(vehicle.id);
    if (!hasCompletedTrip(vehicle)) {
      // pathIndex is the node it's driving to, so it's on segment pathIndex - 1;
      // every segment before that one is behind it.
      if (info && vehicle.path.length === info.segmentIds.length + 1) release(info, Math.min(vehicle.pathIndex - 1, info.segmentIds.length));
      return true;
    }
    if (info) {
      release(info, info.segmentIds.length);
      informal.active.delete(vehicle.id);
    }
    return false;
  });
}
