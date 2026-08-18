import type { RoutingContext, SimulationState, Vehicle } from "../simulation/types";
import { findPath } from "../simulation/routing";
import { createOneShotVehicle, hasCompletedTrip } from "../simulation/vehicle";
import { congestionFactor } from "../simulation/congestion";
import type { ParatransitState } from "./types";

export const SPAWN_EMA_THRESHOLD = 4;
export const SPAWN_EMA_TIME_CONSTANT_SECONDS = 8;
export const PAIR_CAP = 2;
// Cap per corridor, not only per demand pair (docs/rebuild-plan.md §5):
// many pairs route over one corridor; without this, 20+ informal
// vehicles accumulate on one link and collapse throughput to ~10%.
export const CORRIDOR_CAP = 6;
export const SPAWN_COOLDOWN_SECONDS = 5;
// A real operator does not join a jam that pays nothing.
export const MIN_SPAWN_CONGESTION_FACTOR = 0.25;

export const PARATRANSIT_SPEED = 5;
export const PARATRANSIT_CAPACITY = 1;
export const PARATRANSIT_CONGESTION_WEIGHT = 0.4;

function pairKey(from: string, to: string): string {
  return `${from}:${to}`;
}

function emaUpdate(previous: number, instantaneous: number, dt: number, tau: number): number {
  const alpha = 1 - Math.exp(-dt / tau);
  return previous + (instantaneous - previous) * alpha;
}

// Sustained state gates decisions (docs/rebuild-plan.md §5): a rolling
// EMA of queue depth per passengers-only pair, not a single-tick check.
export function updateUnservedEMA(paratransit: ParatransitState, state: SimulationState, dt: number): void {
  paratransit.elapsedSeconds += dt;
  for (const pair of state.demand) {
    if (pair.kind !== "passengers") continue;
    const key = pairKey(pair.from, pair.to);
    const queued = state.queues.get(pair.from)?.get(`${pair.to}:passengers`) ?? 0;
    const previous = paratransit.pairUnservedEMA.get(key) ?? 0;
    paratransit.pairUnservedEMA.set(key, emaUpdate(previous, queued, dt, SPAWN_EMA_TIME_CONSTANT_SECONDS));
  }
}

function segmentIdsAlongPath(path: string[], context: RoutingContext): string[] | null {
  const segmentIds: string[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const edge = context.graph.get(path[i - 1]!)?.find((candidate) => candidate.to === path[i]!);
    if (!edge) return null;
    segmentIds.push(edge.segmentId);
  }
  return segmentIds;
}

// One-shot spawning on sustained unserved demand (docs/rebuild-plan.md
// §6 Module 7). At most one spawn per call -- called once per tick, this
// naturally rate-limits spawning even if several pairs cross threshold
// in the same tick, rather than stampeding.
export function trySpawnParatransit(
  paratransit: ParatransitState,
  state: SimulationState,
  segmentLoads: Map<string, number>,
): Vehicle | null {
  for (const pair of state.demand) {
    if (pair.kind !== "passengers") continue;

    const key = pairKey(pair.from, pair.to);
    const ema = paratransit.pairUnservedEMA.get(key) ?? 0;
    if (ema < SPAWN_EMA_THRESHOLD) continue;

    const lastSpawn = paratransit.pairLastSpawnSeconds.get(key) ?? -Infinity;
    if (paratransit.elapsedSeconds - lastSpawn < SPAWN_COOLDOWN_SECONDS) continue;

    const pairCount = paratransit.pairCounts.get(key) ?? 0;
    if (pairCount >= PAIR_CAP) continue;

    const result = findPath(state.routing, pair.from, pair.to);
    if (!result || result.nodeIds.length < 2) continue;

    const segmentIds = segmentIdsAlongPath(result.nodeIds, state.routing);
    if (!segmentIds) continue;

    const overCorridorCap = segmentIds.some((id) => (paratransit.segmentCounts.get(id) ?? 0) >= CORRIDOR_CAP);
    if (overCorridorCap) continue;

    const tooJammed = segmentIds.some(
      (id) => congestionFactor(segmentLoads.get(id) ?? 0) < MIN_SPAWN_CONGESTION_FACTOR,
    );
    if (tooJammed) continue;

    const vehicleId = `paratransit-${key}-${Math.round(paratransit.elapsedSeconds * 1000)}`;
    const vehicle = createOneShotVehicle(
      vehicleId,
      pair.from,
      pair.to,
      state.routing,
      PARATRANSIT_SPEED,
      PARATRANSIT_CAPACITY,
      PARATRANSIT_CONGESTION_WEIGHT,
      state.queues,
    );
    if (!vehicle) continue;

    state.vehicles.push(vehicle);
    paratransit.active.set(vehicleId, { pairKey: key, segmentIds });
    paratransit.pairCounts.set(key, pairCount + 1);
    for (const id of segmentIds) {
      paratransit.segmentCounts.set(id, (paratransit.segmentCounts.get(id) ?? 0) + 1);
    }
    paratransit.pairLastSpawnSeconds.set(key, paratransit.elapsedSeconds);

    return vehicle;
  }

  return null;
}

// The loop needs an exit (docs/rebuild-plan.md §6 Module 7 "Done when"):
// a completed one-shot vehicle is removed and its cap slots freed, so a
// pair that's actually being served can spawn again once its EMA rises
// again rather than staying permanently capped out.
export function reapCompletedParatransit(paratransit: ParatransitState, state: SimulationState): void {
  const stillActive: Vehicle[] = [];
  for (const vehicle of state.vehicles) {
    if (!hasCompletedTrip(vehicle)) {
      stillActive.push(vehicle);
      continue;
    }

    const info = paratransit.active.get(vehicle.id);
    if (info) {
      for (const segmentId of info.segmentIds) {
        const count = paratransit.segmentCounts.get(segmentId) ?? 0;
        paratransit.segmentCounts.set(segmentId, Math.max(0, count - 1));
      }
      const pairCount = paratransit.pairCounts.get(info.pairKey) ?? 0;
      paratransit.pairCounts.set(info.pairKey, Math.max(0, pairCount - 1));
      paratransit.active.delete(vehicle.id);
    }
  }
  state.vehicles = stillActive;
}
