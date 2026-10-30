import type { GameWorld } from "./types";

// The world's epoch: a count that moves on at the start of every tick and with every action, for
// the caches that hold a reading "once a tick" (gateways.ts). Keyed on the game clock alone, such
// a cache was filled by whatever read it first at that time -- and the screen reads the world
// between ticks, at the clock the next tick starts at. A road paved in between, and the next
// tick ran on the link from before it: the live game parted from its replay by ₦1 on day 40
// (map 3218's day-433 run), which no replay without a screen could reproduce. Kept off the world
// (plain data), as the caches are.

const epochs = new WeakMap<GameWorld, number>();

export function epoch(world: GameWorld): number {
  return epochs.get(world) ?? 0;
}

/** A tick begins, or an action changes the world: every "once a tick" reading is read again. */
export function nextEpoch(world: GameWorld): void {
  epochs.set(world, epoch(world) + 1);
}
