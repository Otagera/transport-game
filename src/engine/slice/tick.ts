import type { DeliveryEvent, PathResult, PickupEvent } from "../simulation/types";
import { computeSegmentLoads } from "../simulation/congestion";
import { createOneShotVehicle, hasCompletedTrip, tickVehicle } from "../simulation/vehicle";
import { applyOperatingCosts, recordDeliveryRevenue, updateIncomeRateEMA } from "../economy/state";
import type { SliceWorld } from "./types";
import { pairKey, roadPath } from "./world";
import { updateSettlements, type SliceEvent } from "./settlement";

// How much longer people wait at a motor park for a danfo to fill than
// they wait for your bus before giving up.
const PARK_PATIENCE_MULTIPLIER = 3;

function emaAlpha(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

function bump(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

// One slice tick. The order matters and is the whole model:
//
//   1. Passengers arrive at each town's queue (gravity demand).
//   2. Some of every queue gives up. Mean patience is `patienceSeconds`, so
//      a queue settles at rate x patience instead of growing without
//      bound -- and how much gives up depends on how often a bus comes,
//      which is what makes frequency worth paying for.
//   3. Buses and danfos move; buses load opportunistically and earn fares.
//   4. People who gave up gather per (origin, destination). A full danfo's
//      worth leaves as a one-shot danfo if a road exists and the caps
//      allow; with no road, they stay home.
//   5. Towns grow along busy roads, and rarely fade (settlement.ts).
//      Returned as events so the page can say so.
//
// So the informal sector is not a parallel spawner reading queue depth --
// it is, literally, where the passengers you failed to carry went
// (docs/principles.md §1: it fills every gap you leave).
export function sliceTick(world: SliceWorld, dt: number): SliceEvent[] {
  const { simulation, tuning, informal, economy } = world;
  const lostByPair = new Map<string, number>();
  const gaveUpByPair = new Map<string, number>();

  // 1. Arrivals.
  for (const pair of simulation.demand) {
    const queue = simulation.queues.get(pair.from);
    if (!queue) continue;
    const key = `${pair.to}:${pair.kind}`;
    queue.set(key, (queue.get(key) ?? 0) + pair.rate * dt);
  }

  // 2. Giving up.
  const leaveFraction = emaAlpha(dt, tuning.patienceSeconds);
  for (const [townId, queue] of simulation.queues) {
    for (const [key, amount] of queue) {
      if (amount <= 0) continue;
      const leaving = amount * leaveFraction;
      queue.set(key, amount - leaving);
      const destination = key.slice(0, key.indexOf(":"));
      bump(informal.pool, pairKey(townId, destination), leaving);
    }
  }

  // 3. Movement. Loads are computed once, before anything moves, so every
  // vehicle sees the same road this tick.
  const loads = tuning.congestion ? computeSegmentLoads(simulation.vehicles, simulation.routing) : new Map<string, number>();
  const pickups: PickupEvent[] = [];
  const routeRevenue = new Map<string, number>();
  let revenueThisTick = 0;
  for (const vehicle of simulation.vehicles) {
    const deliveries: DeliveryEvent[] = tickVehicle(
      vehicle,
      simulation.queues,
      simulation.routing,
      simulation.segmentTraffic,
      loads,
      dt,
      undefined,
      pickups,
    );
    if (deliveries.length === 0) continue;
    if (vehicle.lifecycle === "one-shot") {
      // Danfo fares are the informal sector's, never the player's.
      for (const delivery of deliveries) informal.earnings += delivery.amount * tuning.fare;
      continue;
    }
    const revenue = recordDeliveryRevenue(economy, vehicle.id, deliveries);
    revenueThisTick += revenue;
    bump(routeRevenue, routeIdOf(world, vehicle.id), revenue);
  }

  // 4. Danfos.
  dispatchDanfos(world, dt, lostByPair, gaveUpByPair);
  reapDanfos(world);

  // Money.
  applyOperatingCosts(economy, dt);
  updateIncomeRateEMA(economy, revenueThisTick, dt);

  // Rolling rates, each updated exactly once per tick (architecture hard
  // rule 7).
  const alpha = emaAlpha(dt, tuning.outcomeTauSeconds);
  const playerByPair = new Map<string, number>();
  const poachedByPair = new Map<string, number>();
  const boardingsByRoute = new Map<string, number>();
  for (const pickup of pickups) {
    const key = pairKey(pickup.nodeId, pickup.to);
    if (pickup.lifecycle === "cyclic") {
      bump(playerByPair, key, pickup.amount);
      bump(boardingsByRoute, routeIdOf(world, pickup.vehicleId), pickup.amount);
    } else {
      // A danfo passing through a town picks up your waiting passengers
      // along the way (tickVehicle loads one-shot vehicles at intermediate
      // stops). That is the competition, not a leak.
      bump(poachedByPair, key, pickup.amount);
    }
  }
  for (const route of world.routes) {
    const revenueRate = (routeRevenue.get(route.id) ?? 0) / dt;
    route.revenueRateEMA += (revenueRate - route.revenueRateEMA) * alpha;
    const boardingRate = (boardingsByRoute.get(route.id) ?? 0) / dt;
    route.boardingRateEMA += (boardingRate - route.boardingRateEMA) * alpha;
    route.loadFactorEMA += (routeLoadFactor(world, route.vehicleIds) - route.loadFactorEMA) * alpha;
  }
  for (const [key, rates] of world.pairOutcomes) {
    rates.player += ((playerByPair.get(key) ?? 0) / dt - rates.player) * alpha;
    rates.poached += ((poachedByPair.get(key) ?? 0) / dt - rates.poached) * alpha;
    rates.gaveUp += ((gaveUpByPair.get(key) ?? 0) / dt - rates.gaveUp) * alpha;
    rates.lost += ((lostByPair.get(key) ?? 0) / dt - rates.lost) * alpha;
  }

  return updateSettlements(world, dt);
}

function routeLoadFactor(world: SliceWorld, vehicleIds: string[]): number {
  let total = 0;
  let count = 0;
  for (const vehicle of world.simulation.vehicles) {
    if (!vehicleIds.includes(vehicle.id)) continue;
    total += vehicle.cargo.reduce((sum, entry) => sum + entry.amount, 0) / vehicle.capacity;
    count += 1;
  }
  return count > 0 ? total / count : 0;
}

function routeIdOf(world: SliceWorld, vehicleId: string): string {
  return world.routes.find((route) => route.vehicleIds.includes(vehicleId))?.id ?? "";
}

interface PooledRider {
  key: string;
  to: string;
  path: PathResult;
}

// Danfos run corridors, not pairs. Riders who gave up are grouped by origin
// and the first town they'd pass through; within a group, a danfo heads for
// the destination whose path collects the most waiting riders, and takes
// everyone whose stop is on the way. Dispatching per (origin, destination)
// pair instead -- the first version -- split demand so thin that most danfos
// never filled: measured, uncapping every danfo limit barely moved the
// stayed-home share, while one-seat danfos cut it from 53% to 33%.
function dispatchDanfos(world: SliceWorld, dt: number, lostByPair: Map<string, number>, gaveUpByPair: Map<string, number>): void {
  const { simulation, tuning, informal } = world;
  const cap = tuning.danfoCapacity;
  const drift = emaAlpha(dt, tuning.patienceSeconds * PARK_PATIENCE_MULTIPLIER);
  const groups = new Map<string, { from: string; riders: PooledRider[] }>();

  for (const [key, pooled] of informal.pool) {
    if (pooled <= 0) continue;
    const separator = key.indexOf(":");
    const from = key.slice(0, separator);
    const to = key.slice(separator + 1);
    const path = roadPath(world, from, to);

    // No road: nobody can take them. They stay home.
    if (!path || path.nodeIds.length < 2) {
      bump(lostByPair, key, pooled);
      informal.pool.set(key, 0);
      continue;
    }

    // People waiting at the park for a danfo to fill drift home too, more
    // slowly than they gave up on you. This is also what bounds the pool
    // when every danfo on a run is already out.
    const drifting = pooled * drift;
    informal.pool.set(key, pooled - drifting);
    bump(lostByPair, key, drifting);

    const groupKey = `${from}>${path.nodeIds[1]}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { from, riders: [] };
      groups.set(groupKey, group);
    }
    group.riders.push({ key, to, path });
  }

  for (const { from, riders } of groups.values()) {
    let best: PooledRider | null = null;
    let bestAboard: PooledRider[] = [];
    let bestLoad = 0;
    for (const candidate of riders) {
      const stops = new Set(candidate.path.nodeIds);
      const aboard = riders.filter((rider) => stops.has(rider.to));
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
    const danfo = createOneShotVehicle(id, from, best.to, simulation.routing, tuning.danfoSpeed, cap, 1, new Map());
    if (!danfo) continue;

    const share = cap / bestLoad;
    danfo.cargo = bestAboard.map((rider) => {
      const pooled = informal.pool.get(rider.key) ?? 0;
      informal.pool.set(rider.key, pooled * (1 - share));
      bump(gaveUpByPair, rider.key, pooled * share);
      return { from, to: rider.to, kind: "passengers" as const, amount: pooled * share };
    });
    simulation.vehicles.push(danfo);
    informal.active.set(id, { segmentIds: best.path.segmentIds });
    for (const segmentId of best.path.segmentIds) bump(informal.segmentCounts, segmentId, 1);
  }
}

function reapDanfos(world: SliceWorld): void {
  const { simulation, informal } = world;
  simulation.vehicles = simulation.vehicles.filter((vehicle) => {
    if (!hasCompletedTrip(vehicle)) return true;
    const info = informal.active.get(vehicle.id);
    if (info) {
      for (const segmentId of info.segmentIds) bump(informal.segmentCounts, segmentId, -1);
      informal.active.delete(vehicle.id);
    }
    return false;
  });
}
