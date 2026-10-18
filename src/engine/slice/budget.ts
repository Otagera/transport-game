import type { SliceWorld } from "./types";
import { isYourRoad } from "./upkeep";

// The budget's other income lines (docs/brief.md, Money: a budget, not a
// score). Fares are fares.ts. Here:
//
// - Tolls: every informal vehicle on a road you built or paved pays, by its
//   road space, and passes it on to its riders (tick.ts sendInformal: some
//   of them stay home). Your own vehicles don't pay.
// - Park levies: every informal departure pays by its seats; the agberos
//   keep their cut first (tick.ts).
// - The state's allocation: a small base a day, plus a share of the growth
//   you caused -- people added to the towns since day 1, and a new town
//   counts whole.

/** This tick's takings from the informal sector, to the funds and the tally. */
export interface Takings {
  tolls: number;
  levies: number;
  /** The agberos' cut of the levies: never yours, kept to be shown. */
  agberos: number;
}

/** Money in since day 1, by line (and the agberos' cut, which isn't yours). */
export interface BudgetTally {
  fares: number;
  tolls: number;
  levies: number;
  agberos: number;
  allocation: number;
}

export function createBudgetTally(): BudgetTally {
  return { fares: 0, tolls: 0, levies: 0, agberos: 0, allocation: 0 };
}

/** The toll an informal vehicle of road space `weight` pays for a path: each road of yours on it. */
export function tollFor(world: SliceWorld, segmentIds: readonly string[], weight: number): number {
  let roads = 0;
  for (const id of segmentIds) {
    const segment = world.simulation.map.segments.find((candidate) => candidate.id === id);
    if (segment && isYourRoad(segment)) roads += 1;
  }
  return roads * world.tuning.tollPerRoad * weight;
}

/** Thousands of people the towns have gained since day 1; a town founded since counts whole. */
export function growthSinceStart(world: SliceWorld): number {
  let grown = 0;
  for (const town of world.towns.values()) grown += Math.max(0, town.population - (world.startPopulation.get(town.id) ?? 0));
  return grown;
}

/** The state's allocation a game day: the base, plus the growth you caused. */
export function allocationPerDay(world: SliceWorld): number {
  return world.tuning.allocationBase + world.tuning.allocationPerThousand * growthSinceStart(world);
}
