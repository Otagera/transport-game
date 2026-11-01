import type { GameWorld } from "./types";
import { corridorsDueAt, setCorridorsDueAt } from "./corridors";

// A world to keep and come back to (saved games, src/game/saves.ts). The world is plain data --
// structured-cloneable, as the receipts' and forecasts' copies already rely on -- and the
// simulation deterministic, but for what's kept off the world that the simulation reads. The
// caches keyed on a world (epoch.ts, gateways.ts, workers.ts...) are refilled the same; one thing
// isn't a cache: when the corridors are next judged (corridors.ts). Without it a restored world
// judged them at once and drifted a fraction of a tick a day off the run it came from, so a run
// file saved after a load stopped replaying as played. A snapshot carries it.

export interface Snapshot {
  world: GameWorld;
  /** corridors.ts: when the corridors are next judged; null before they first are. */
  corridorsDue: number | null;
}

/** The world as it stands, for keeping: not copied here (IndexedDB, or structuredClone, copies it). */
export function snapshotOf(world: GameWorld): Snapshot {
  return { world, corridorsDue: corridorsDueAt(world) };
}

/** A kept world, ready to run on exactly as it would have. */
export function restoreSnapshot(snapshot: Snapshot): GameWorld {
  if (snapshot.corridorsDue !== null) setCorridorsDueAt(snapshot.world, snapshot.corridorsDue);
  return snapshot.world;
}
