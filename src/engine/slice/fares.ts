import type { DeliveryEvent } from "../simulation/types";
import type { SliceTuning, SliceWorld } from "./types";
import { roadPath } from "./world";
import { railPath } from "./rail";

// Fares by distance (docs/brief.md, Fares): a boarding fare plus a price
// per stage, rounded up to the next stage -- danfo fares are called by
// stop, in steps. One schedule for everyone, you and the danfos, so riders
// still choose on waiting time. A flat ₦4 a leg left long routes unable to
// pay (the "long" verdict existed to explain it) and made changing buses
// cost a whole second fare; now a transfer costs one more boarding fare.
//
// Passengers only: goods keep their per-tonne fare (goods are off in slice
// zero; per tonne per cell comes back with them).

/** The fare for a ride of `cells` along the network. */
export function stageFare(tuning: SliceTuning, cells: number): number {
  return tuning.fareBoarding + tuning.farePerStage * Math.max(1, Math.ceil(cells / tuning.fareStageCells - 1e-9));
}

/** The fare for one leg, from stop to stop, by the road (or, for a train, the track) it rides. */
export function legFare(world: SliceWorld, from: string, to: string, rail = false): number {
  const path = rail ? railPath(world, from, to) : roadPath(world, from, to);
  const a = world.towns.get(from);
  const b = world.towns.get(to);
  const cells = path?.distance ?? (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);
  return stageFare(world.tuning, cells);
}

/** What a vehicle's passengers paid getting off this tick: each leg its own fare. */
export function passengerFares(world: SliceWorld, deliveries: DeliveryEvent[], rail = false): number {
  let total = 0;
  for (const { entry, amount } of deliveries) {
    if (entry && entry.kind === "passengers") total += amount * legFare(world, entry.from, entry.to, rail);
  }
  return total;
}

/**
 * Riders a second wanting trips along a path, times the fare each would
 * pay for the whole trip: what demandAlong is in money. `along`: the stops
 * of a path that isn't the road one (a train's, on track).
 */
export function faresAlong(world: SliceWorld, a: string, b: string, along?: string[]): number {
  const nodeIds = along ?? roadPath(world, a, b)?.nodeIds;
  if (!nodeIds) return 0;
  const stops = new Set(nodeIds);
  let total = 0;
  for (const pair of world.simulation.demand) {
    if (stops.has(pair.from) && stops.has(pair.to)) total += pair.rate * legFare(world, pair.from, pair.to, along !== undefined);
  }
  return total;
}
