import type { DeliveryEvent } from "../simulation/types";
import { isAirCargo } from "./airport";
import type { GameTuning, GameWorld } from "./types";
import { roadPath } from "./world";
import { railPath } from "./rail";
import { waterLength, type BoatKind } from "./boats";
import { isFreshFish } from "./fishing";

// Fares by distance (docs/brief.md, Fares): a boarding fare plus a price
// per stage, rounded up to the next stage -- danfo fares are called by
// stop, in steps. One schedule for everyone, you and the danfos, so riders
// still choose on waiting time. A flat ₦4 a leg left long routes unable to
// pay (the "long" verdict existed to explain it) and made changing buses
// cost a whole second fare; now a transfer costs one more boarding fare.
//
// Goods pay per tonne per cell (brief, Fares; back with goods in Revision
// 2): a flat ₦4 a tonne left a long run unable to pay -- a lorry from a
// quarry through Owode to Ilase made under a round trip a day, ₦72-120
// against ₦108 of running cost -- and made rail's edge a side effect of
// the flat fare instead of speed and volume.

/** The fare for a ride of `cells` along the network. */
export function stageFare(tuning: GameTuning, cells: number): number {
  return tuning.fareBoarding + tuning.farePerStage * Math.max(1, Math.ceil(cells / tuning.fareStageCells - 1e-9));
}

/**
 * The way a leg is ridden, for its length: by road (false), by track (true), or on the water by a
 * kind of boat (boats.ts: its line's length over the water).
 */
export type FareWay = boolean | BoatKind;

function wayLength(world: GameWorld, from: string, to: string, way: FareWay): number | undefined {
  // By water, no more than the road would charge where there is one: riders don't choose a mode
  // here (they board what comes), so a winding river priced by its length made the same trip half
  // again dearer by boat -- the boat out-earned buses on a river longer than the road (8703's
  // Oboza-Yutoama, water 36 cells against the road's 23; water.md, Step 2).
  if (typeof way === "string") {
    const water = waterLength(world, from, to, way);
    const road = roadPath(world, from, to)?.distance;
    return water === null ? road : road === undefined ? water : Math.min(water, road);
  }
  return (way ? railPath(world, from, to) : roadPath(world, from, to))?.distance;
}

/** The fare for one leg, from stop to stop, by the road (or, for a train, the track; for a boat, the water) it rides. */
export function legFare(world: GameWorld, from: string, to: string, rail: FareWay = false): number {
  const a = world.towns.get(from);
  const b = world.towns.get(to);
  const cells = wayLength(world, from, to, rail) ?? (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);
  return stageFare(world.tuning, cells);
}

/** What a vehicle's passengers paid getting off this tick: each leg its own fare. */
export function passengerFares(world: GameWorld, deliveries: DeliveryEvent[], rail: FareWay = false): number {
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
export function faresAlong(world: GameWorld, a: string, b: string, along?: string[]): number {
  const nodeIds = along ?? roadPath(world, a, b)?.nodeIds;
  if (!nodeIds) return 0;
  const stops = new Set(nodeIds);
  let total = 0;
  for (const pair of world.simulation.demand) {
    if (stops.has(pair.from) && stops.has(pair.to)) total += pair.rate * legFare(world, pair.from, pair.to, along !== undefined);
  }
  return total;
}

/** What a goods vehicle's loads paid getting off this tick: tonnes x cells along the road (or track) x the rate. */
export function goodsFares(world: GameWorld, deliveries: DeliveryEvent[], rail: FareWay = false): number {
  let total = 0;
  for (const { entry, amount } of deliveries) {
    if (!entry || entry.kind === "passengers") continue;
    const a = world.towns.get(entry.from) ?? world.ruins.get(entry.from);
    const b = world.towns.get(entry.to) ?? world.ruins.get(entry.to);
    const cells = wayLength(world, entry.from, entry.to, rail) ?? (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);
    // Air freight is high value: its tonne pays airFreightRate times (airport.ts).
    const air = isAirCargo(world, entry.trip?.origin ?? entry.from) ? world.tuning.airFreightRate ?? 1 : 1;
    // Fresh fish fetches a premium (fishing.ts): it has to be there within a day.
    const fresh = isFreshFish(world, entry.trip?.origin ?? entry.from, entry.kind) ? world.tuning.fishFreshRate ?? 1 : 1;
    total += amount * cells * world.tuning.goodsFarePerTonneCell * air * fresh;
  }
  return total;
}
