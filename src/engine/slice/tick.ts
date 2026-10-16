import type { DeliveryEvent, PathResult, Vehicle } from "../simulation/types";
import { computeSegmentLoads } from "../simulation/congestion";
import { createOneShotVehicle, freeSeats, hasCompletedTrip, nodesAhead, tickVehicle, type Loader } from "../simulation/vehicle";
import { applyOperatingCosts, recordDeliveryRevenue, updateIncomeRateEMA } from "../economy/state";
import type { SliceWorld } from "./types";
import { pairKey, roadPath } from "./world";
import { updateSettlements, type SliceEvent } from "./settlement";
import { tripPlans } from "./transfers";

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
//      leaves if a road exists and the caps allow; with no road, they stay
//      home.
//   5. Towns grow along busy roads, and rarely fade (settlement.ts).
//
// Every rider is counted exactly once, when their trip resolves: arrived
// on your buses, taken by a danfo, or stayed home.
export function sliceTick(world: SliceWorld, dt: number): SliceEvent[] {
  const { simulation, tuning, informal, economy } = world;
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

  // 3. Movement. Loads are computed once, before anything moves, so every
  // vehicle sees the same road this tick.
  const loads = tuning.congestion ? computeSegmentLoads(simulation.vehicles, simulation.routing) : new Map<string, number>();
  const routeOf = new Map<string, string>();
  for (const route of world.routes) for (const id of route.vehicleIds) routeOf.set(id, route.id);
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

  let revenueThisTick = 0;
  for (const vehicle of simulation.vehicles) {
    const isDanfo = vehicle.lifecycle === "one-shot";
    const deliveries: DeliveryEvent[] = tickVehicle(
      vehicle,
      simulation.queues,
      simulation.routing,
      simulation.segmentTraffic,
      loads,
      dt,
      undefined,
      undefined,
      isDanfo ? danfoLoader : busLoader,
    );
    if (deliveries.length === 0) continue;
    if (isDanfo) {
      // Danfo fares are the informal sector's, never the player's.
      for (const delivery of deliveries) informal.earnings += delivery.amount * tuning.fare;
      continue;
    }
    // Each leg pays a fare, on getting off (revenue on unload).
    const revenue = recordDeliveryRevenue(economy, vehicle.id, deliveries);
    revenueThisTick += revenue;
    bump(routeRevenue, routeOf.get(vehicle.id) ?? "", revenue);
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

  // 4. Danfos.
  dispatchDanfos(world, dt, lost, gaveUp);
  reapDanfos(world);

  // Money.
  applyOperatingCosts(economy, dt);
  updateIncomeRateEMA(economy, revenueThisTick, dt);

  // Rolling rates, each updated exactly once per tick (architecture hard
  // rule 7).
  const alpha = emaAlpha(dt, tuning.outcomeTauSeconds);
  for (const route of world.routes) {
    route.revenueRateEMA += ((routeRevenue.get(route.id) ?? 0) / dt - route.revenueRateEMA) * alpha;
    route.boardingRateEMA += ((boardings.get(route.id) ?? 0) / dt - route.boardingRateEMA) * alpha;
    route.loadFactorEMA += (routeLoadFactor(world, route.vehicleIds) - route.loadFactorEMA) * alpha;
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

  return updateSettlements(world, dt);
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

interface PooledRider {
  key: string;
  origin: string;
  destination: string;
  path: PathResult;
}

// Danfos run corridors, not pairs. Riders who gave up are grouped by where
// they are and the first town they'd pass through; within a group, a danfo
// heads for the destination whose path collects the most waiting riders,
// and takes everyone whose stop is on the way. Dispatching per (origin,
// destination) pair instead -- the first version -- split demand so thin
// that most danfos never filled: measured, uncapping every danfo limit
// barely moved the stayed-home share, while one-seat danfos cut it from
// 53% to 33%.
function dispatchDanfos(world: SliceWorld, dt: number, lost: Map<string, number>, gaveUp: Map<string, number>): void {
  const { simulation, tuning, informal } = world;
  const cap = tuning.danfoCapacity;
  const drift = emaAlpha(dt, tuning.patienceSeconds * PARK_PATIENCE_MULTIPLIER);
  const groups = new Map<string, { at: string; riders: PooledRider[] }>();

  for (const [key, pooled] of informal.pool) {
    if (pooled <= 0) continue;
    const { at, origin, destination } = parsePoolKey(key);
    const trip = pairKey(origin, destination);
    const path = roadPath(world, at, destination);

    // No road: nobody can take them. They stay home.
    if (!path || path.nodeIds.length < 2) {
      bump(lost, trip, pooled);
      informal.pool.set(key, 0);
      continue;
    }

    // People waiting at the park for a danfo to fill drift home too, more
    // slowly than they gave up on you. This is also what bounds the pool
    // when every danfo on a run is already out.
    const drifting = pooled * drift;
    informal.pool.set(key, pooled - drifting);
    bump(lost, trip, drifting);

    const groupKey = `${at}>${path.nodeIds[1]}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { at, riders: [] };
      groups.set(groupKey, group);
    }
    group.riders.push({ key, origin, destination, path });
  }

  for (const { at, riders } of groups.values()) {
    let best: PooledRider | null = null;
    let bestAboard: PooledRider[] = [];
    let bestLoad = 0;
    for (const candidate of riders) {
      const stops = new Set(candidate.path.nodeIds);
      const aboard = riders.filter((rider) => stops.has(rider.destination));
      const load = aboard.reduce((sum, rider) => sum + (informal.pool.get(rider.key) ?? 0), 0);
      if (load > bestLoad) {
        best = candidate;
        bestAboard = aboard;
        bestLoad = load;
      }
    }
    if (!best || bestLoad < cap) continue;
    if (best.path.segmentIds.some((id) => (informal.segmentCounts.get(id) ?? 0) >= tuning.danfoCorridorCap)) continue;

    const id = `danfo-${world.nextId++}`;
    // An empty queue map: a danfo leaves with the people who gave up on
    // you, it doesn't also sweep the queue that's still waiting for you.
    const danfo = createOneShotVehicle(id, at, best.destination, simulation.routing, tuning.danfoSpeed, cap, 1, new Map());
    if (!danfo) continue;

    const share = cap / bestLoad;
    danfo.cargo = bestAboard.map((rider) => {
      const pooled = informal.pool.get(rider.key) ?? 0;
      informal.pool.set(rider.key, pooled * (1 - share));
      bump(gaveUp, pairKey(rider.origin, rider.destination), pooled * share);
      return { from: at, to: rider.destination, kind: "passengers" as const, amount: pooled * share, trip: { origin: rider.origin, destination: rider.destination } };
    });
    simulation.vehicles.push(danfo);
    informal.active.set(id, { segmentIds: best.path.segmentIds });
    for (const segmentId of best.path.segmentIds) bump(informal.segmentCounts, segmentId, 1);
  }
}

function reapDanfos(world: SliceWorld): void {
  const { simulation, informal } = world;
  simulation.vehicles = simulation.vehicles.filter((vehicle: Vehicle) => {
    if (!hasCompletedTrip(vehicle)) return true;
    const info = informal.active.get(vehicle.id);
    if (info) {
      for (const segmentId of info.segmentIds) bump(informal.segmentCounts, segmentId, -1);
      informal.active.delete(vehicle.id);
    }
    return false;
  });
}
