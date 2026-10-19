import type { Segment } from "../map/types";
import type { SliceTuning, SliceWorld } from "./types";
import { roadChain } from "./world";
import { isDirt } from "./congestion";
import { segmentLength } from "./roads";
import { bridgeCellsOn } from "./wear";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// Routine upkeep (docs/brief.md, Money; step 5): the road agency's standing
// bill -- verges, drains, patching -- per cell per day on every road you
// built or paved, wear or no wear. It's what makes a road a commitment:
// a busy road earns it back through the vehicles on it (and, from step 6,
// tolls); a quiet one is a standing loss. Inherited dirt roads are the
// state's old network and cost you nothing until you pave them. More on
// paved roads, more again on bridges.

/** Whether this road is yours to keep: you built it, or you paved it. */
export function isYourRoad(segment: Segment): boolean {
  // A retired road is no longer yours to keep, or to toll (retire.ts).
  return segment.type === "road" && segment.retiredAt === undefined && (segment.provenance === "built" || !isDirt(segment));
}

/** Upkeep a game day for a stretch of road: `cells` long, `bridgeCells` of them bridge. */
export function upkeepFor(tuning: SliceTuning, cells: number, bridgeCells: number, paved: boolean): number {
  const perCell = paved ? tuning.routineUpkeepPavedPerCell : tuning.routineUpkeepDirtPerCell;
  return perCell * (cells - bridgeCells + bridgeCells * tuning.routineUpkeepBridgeMultiplier);
}

/** What a road costs you a game day to keep, wear aside. */
export function routineUpkeepPerDay(world: SliceWorld, segment: Segment): number {
  if (!isYourRoad(segment)) return 0;
  return upkeepFor(world.tuning, segmentLength(world, segment), bridgeCellsOn(world, segment), !isDirt(segment));
}

/** What paving the road from a to b adds to your upkeep a game day (the dirt pieces you'd pave). */
export function paveUpkeepPerDay(world: SliceWorld, a: string, b: string): number {
  const chain = roadChain(world, a, b);
  if (!chain) return 0;
  let added = 0;
  for (const piece of chain.filter(isDirt)) {
    added += upkeepFor(world.tuning, segmentLength(world, piece), bridgeCellsOn(world, piece), true) - routineUpkeepPerDay(world, piece);
  }
  return added;
}

/** Every road you keep, per game day. */
export function totalRoutineUpkeepPerDay(world: SliceWorld): number {
  let total = 0;
  for (const segment of world.simulation.map.segments) total += routineUpkeepPerDay(world, segment);
  return total;
}

/** This tick's routine upkeep, for the funds (tick.ts). */
export function chargeRoutineUpkeep(world: SliceWorld, dt: number): number {
  return (totalRoutineUpkeepPerDay(world) * dt) / SECONDS_PER_GAME_DAY;
}
