import type { DeliveryEvent, PathResult, Vehicle } from "../simulation/types";
import { createOneShotVehicle, freeSeats, hasCompletedTrip, nodesAhead, tickVehicle, type Loader } from "../simulation/vehicle";
import { applyOperatingCosts, recordDeliveryRevenue, updateIncomeRateEMA } from "../economy/state";
import type { InformalMode, SliceRoute, SliceTuning, SliceWorld } from "./types";
import { pairKey, roadPath } from "./world";
import { updateSettlements, type SliceEvent } from "./settlement";
import { recordMoney } from "./ledger";
import { recordDay } from "./history";
import { tripPlans } from "./transfers";
import { updateRoadSpeeds } from "./congestion";
import { chargeRoughRoads, segmentConditions, updateRoadWear } from "./wear";
import { routingFor } from "./rail";
import { goodsLoader, produceAndSpoil, recordGoodsDelivered, updateGoodsOutcomes } from "./goods";

// How much longer people wait at a motor park for a danfo to fill than
// they wait for your bus before giving up.
const PARK_PATIENCE_MULTIPLIER = 3;

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
    for (const [key, amount] of queue) {
      if (amount <= 0) continue;
      const leaving = amount * leaveFraction;
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
  const routeOf = new Map<string, string>();
  for (const route of [...world.routes, ...world.lorryRoutes]) for (const id of route.vehicleIds) routeOf.set(id, route.id);
  const goodsDelivered = new Map<string, number>();
  const boardings = new Map<string, number>();
  const routeRevenue = new Map<string, number>();
  const plans = tripPlans(world);

  const busLoader: Loader = (vehicle, at, index) => {
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
  const lorryLoader = goodsLoader(world, boardings, routeOf);

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
      vehicle.carries === "goods" ? lorryLoader : isDanfo ? danfoLoader : busLoader,
      world.segmentSpeed,
    );
    if (deliveries.length === 0) continue;
    if (isDanfo) {
      // Informal fares are the informal sector's, never the player's.
      for (const delivery of deliveries) informal.earnings += delivery.amount * tuning.fare;
      continue;
    }
    // Each leg pays a fare, on getting off (revenue on unload) -- per
    // rider, or per tonne for a lorry.
    const revenue = recordDeliveryRevenue(economy, vehicle.id, deliveries);
    revenueThisTick += revenue;
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

  updateGoodsOutcomes(world, goodsDelivered, dt);

  // 4. The informal sector: danfos, then kekes and okadas.
  dispatchInformal(world, dt, lost, gaveUp);
  reapInformal(world);

  // Roads wear with the traffic that just ran on them; maintained ones are
  // repaired as they go, and that upkeep is a running cost like a bus's.
  const upkeep = tuning.wearEnabled ? updateRoadWear(world, dt) : 0;
  // ...and your road vehicles pay more to run on worn roads (wear.ts).
  const rough = tuning.wearEnabled ? chargeRoughRoads(world, dt, routeOf) : { total: 0, byRoute: new Map<string, number>() };

  // Money. Running cost is whatever left the funds this tick that fares
  // didn't bring in -- buses, lorries, trains and road upkeep alike --
  // so the ledger never has to know every way money is spent.
  applyOperatingCosts(economy, dt, 1, upkeep);
  updateIncomeRateEMA(economy, revenueThisTick, dt);
  recordMoney(world.ledger, revenueThisTick, revenueThisTick - (economy.funds - fundsAtStart), routeRevenue, dt, rough.byRoute);

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

  const events = updateSettlements(world, dt);
  recordDay(world);
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
    total += edge ? (world.segmentSpeed.get(edge.segmentId) ?? 1) : 1;
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
): boolean {
  const { simulation, tuning, informal } = world;
  const spec = informalSpec(tuning, mode);
  // One road, one budget: your vehicles' road space counts against it too
  // (brief, step 5b). Released per segment, danfos otherwise filled the
  // trunk around your buses -- 8 trunk buses carried 180 riders a day
  // instead of 289, the trunk below half speed 94% of the time; counted,
  // 225 and 34%, and the danfos on Ilase-Owode fall as you add buses.
  const space = run.path.segmentIds.map((id) => (informal.segmentSpace.get(id) ?? 0) + (yours.get(id) ?? 0));
  if (space.some((used) => used + spec.weight > tuning.informalRoadSpace)) return false;
  // A real operator does not join a jam that pays nothing (principles §3).
  if (run.path.segmentIds.some((id) => (world.segmentSpeed.get(id) ?? 1) < tuning.informalMinSpeed)) return false;

  const id = `${mode}-${world.nextId++}`;
  // An empty queue map: it leaves with the people who gave up on you, it
  // doesn't also sweep the queue that's still waiting for you.
  const vehicle = createOneShotVehicle(id, group.at, run.destination, simulation.routing, spec.speed, spec.capacity, spec.weight, new Map());
  if (!vehicle) return false;

  const share = Math.min(1, spec.capacity / load);
  vehicle.cargo = aboard.map((rider) => {
    const pooled = pool.get(rider.key) ?? 0;
    pool.set(rider.key, pooled * (1 - share));
    bump(gaveUp, pairKey(rider.origin, rider.destination), pooled * share);
    return { from: group.at, to: rider.destination, kind: "passengers" as const, amount: pooled * share, trip: { origin: rider.origin, destination: rider.destination } };
  });
  simulation.vehicles.push(vehicle);
  informal.active.set(id, { segmentIds: run.path.segmentIds, weight: spec.weight, mode, released: 0 });
  for (const segmentId of run.path.segmentIds) bump(informal.segmentSpace, segmentId, spec.weight);
  return true;
}

export function informalSpec(tuning: SliceTuning, mode: InformalMode): { capacity: number; speed: number; weight: number } {
  switch (mode) {
    case "danfo":
      return { capacity: tuning.danfoCapacity, speed: tuning.danfoSpeed, weight: tuning.danfoRoadSpace };
    case "keke":
      return { capacity: tuning.kekeCapacity, speed: tuning.kekeSpeed, weight: tuning.kekeRoadSpace };
    case "okada":
      return { capacity: tuning.okadaCapacity, speed: tuning.okadaSpeed, weight: tuning.okadaRoadSpace };
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
function dispatchInformal(world: SliceWorld, dt: number, lost: Map<string, number>, gaveUp: Map<string, number>): void {
  const { tuning, informal } = world;
  const drift = emaAlpha(dt, tuning.patienceSeconds * PARK_PATIENCE_MULTIPLIER);
  // Road space your vehicles are using now, per segment.
  const yours = new Map<string, number>();
  for (const vehicle of world.simulation.vehicles) {
    if (informal.active.has(vehicle.id) || world.railVehicles.has(vehicle.id)) continue;
    const leg = world.vehicleSegment.get(vehicle.id);
    if (leg) bump(yours, leg.slice(0, leg.lastIndexOf("#")), vehicle.congestionWeight);
  }

  const danfoGroups = groupPool(world, informal.pool, drift, lost, (key, _trip, amount) => bump(informal.smallPool, key, amount));
  for (const group of danfoGroups) {
    const best = bestRun(group, informal.pool);
    if (best && best.load >= tuning.danfoCapacity) sendInformal(world, "danfo", group, best.run, best.aboard, best.load, informal.pool, gaveUp, yours);
  }

  const smallGroups = groupPool(world, informal.smallPool, drift, lost, (_key, trip, amount) => bump(lost, trip, amount));
  for (const group of smallGroups) {
    const best = bestRun(group, informal.smallPool);
    if (!best) continue;
    if (best.load >= tuning.kekeCapacity) {
      if (sendInformal(world, "keke", group, best.run, best.aboard, best.load, informal.smallPool, gaveUp, yours)) continue;
    }
    // An okada takes one rider, from whoever has waited in the biggest crowd.
    const single = group.riders.reduce<PooledRider | null>(
      (top, rider) => ((informal.smallPool.get(rider.key) ?? 0) > (top ? informal.smallPool.get(top.key) ?? 0 : 0) ? rider : top),
      null,
    );
    const waiting = single ? informal.smallPool.get(single.key) ?? 0 : 0;
    if (single && waiting >= tuning.okadaCapacity) sendInformal(world, "okada", group, single, [single], waiting, informal.smallPool, gaveUp, yours);
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
