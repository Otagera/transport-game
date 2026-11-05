import { startGame as buildGame } from "@engine/game/start";
import { startRun as buildRun } from "@engine/game/runlog";
import { restoreSnapshot, snapshotOf, type Snapshot } from "@engine/game/snapshot";
import type { GameWorld } from "@engine/game/types";

// Worlds for the tests: each built once a test process and copied after. Most of the suite's time
// was the same worlds built again and again -- a region map's warm-up week is ten seconds, and the
// light-rail tests built twenty of them.
//
// `startGame` and `startRun` here are the engine's, with their signatures: the first call with
// some arguments builds the world (and returns it); a later call with arguments deep-equal to it
// gets a copy. A copy is the game's own save and load (snapshot.ts): the world structured-cloned,
// with the one thing kept off it carried -- and snapshot.test.ts holds that a world kept that way
// runs on exactly as the one it was kept from. So snapshot.test.ts builds its own fresh, as do the
// map's checks that the same seed draws the same land. TEST_WORLDS=fresh builds every world fresh.
//
// The arguments are copied before the build, so a test that changes its tuning object afterwards
// can't change what a later call matches; a test that changes the world it got changes only its own.

const FRESH = process.env.TEST_WORLDS === "fresh";
/** Worlds kept a process, the least recently used dropped: a region world is tens of megabytes. */
const MOST = 6;

interface Kept { kind: string; args: unknown[]; snapshot: Snapshot }
const kept: Kept[] = [];

function built<A extends unknown[]>(kind: string, build: (...args: A) => GameWorld, args: A): GameWorld {
  if (FRESH) return build(...args);
  const i = kept.findIndex((k) => k.kind === kind && Bun.deepEquals(k.args, args, true));
  if (i >= 0) {
    const [hit] = kept.splice(i, 1);
    kept.push(hit!);
    return restoreSnapshot(structuredClone(hit!.snapshot));
  }
  let copy: unknown[];
  try {
    copy = structuredClone(args);
  } catch {
    return build(...args); // arguments a clone can't hold (a function): built every time
  }
  const world = build(...args);
  kept.push({ kind, args: copy, snapshot: structuredClone(snapshotOf(world)) });
  if (kept.length > MOST) kept.shift();
  return world;
}

export const startGame: typeof buildGame = (...args) => built("game", buildGame, args);
export const startRun: typeof buildRun = (...args) => built("run", buildRun, args);
