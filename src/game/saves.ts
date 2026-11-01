// Saved games (2026-11-01: "save and load game because people might not play all at once"). The
// game saves itself -- each game day, and whenever you pause or leave the tab -- one save a map,
// the five most recent kept, in this browser (IndexedDB). A save is the world as it stands
// (snapshot.ts) and the run so far (runlog.ts's recorder: what "Save run" writes, and the days the
// charts read). Opened by the build that saved it, it resumes at once; by another (the game moved
// on in between), the run replays from its start (a run file replays as played), the loading card
// counting the days. Storage refused (a private window): nothing is kept, and nothing breaks.
import type { RunRecorder } from "@engine/game/runlog";
import type { Snapshot } from "@engine/game/snapshot";

/** What the loading card lists, without opening the world. */
export interface SaveSummary {
  seed: number;
  /** Date.now() when kept. */
  savedAt: number;
  day: number;
  term: number | null;
  /** People in the region, thousands; and your money. */
  people: number;
  funds: number;
  /** The largest town, to know the map by. */
  city: string;
  /** The build that saved it (main.ts's VITE_GAME_BUILD): another build replays the run. */
  build: string;
}

export interface SavedGame {
  summary: SaveSummary;
  snapshot: Snapshot;
  recorder: RunRecorder;
}

const DB = "transport-game";
const GAMES = "games";
const SUMMARIES = "summaries";
const KEEP = 5;

let opening: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(GAMES);
        request.result.createObjectStore(SUMMARIES);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}
const done = (tx: IDBTransaction) => new Promise<boolean>((resolve) => {
  tx.oncomplete = () => resolve(true);
  tx.onerror = () => resolve(false);
  tx.onabort = () => resolve(false);
});
const read = <T>(request: IDBRequest<T>) => new Promise<T | null>((resolve) => {
  request.onsuccess = () => resolve(request.result ?? null);
  request.onerror = () => resolve(null);
});

/** Every kept game, the latest first. */
export async function listSaves(): Promise<SaveSummary[]> {
  const base = await db();
  if (!base) return [];
  try {
    const all = await read(base.transaction(SUMMARIES).objectStore(SUMMARIES).getAll() as IDBRequest<SaveSummary[]>);
    return (all ?? []).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function loadSave(seed: number): Promise<SavedGame | null> {
  const base = await db();
  if (!base) return null;
  try {
    return await read(base.transaction(GAMES).objectStore(GAMES).get(seed) as IDBRequest<SavedGame>);
  } catch {
    return null;
  }
}

/** Keep a game (copied as it's written: the world can run on at once), then drop all but the latest few. */
export async function writeSave(game: SavedGame): Promise<boolean> {
  const base = await db();
  if (!base) return false;
  try {
    const tx = base.transaction([GAMES, SUMMARIES], "readwrite");
    tx.objectStore(GAMES).put(game, game.summary.seed);
    tx.objectStore(SUMMARIES).put(game.summary, game.summary.seed);
    if (!(await done(tx))) return false;
    const old = (await listSaves()).slice(KEEP);
    for (const summary of old) await deleteSave(summary.seed);
    return true;
  } catch {
    return false;
  }
}

export async function deleteSave(seed: number): Promise<void> {
  const base = await db();
  if (!base) return;
  try {
    const tx = base.transaction([GAMES, SUMMARIES], "readwrite");
    tx.objectStore(GAMES).delete(seed);
    tx.objectStore(SUMMARIES).delete(seed);
    await done(tx);
  } catch {
    // Nothing to do: it stays, and the next save may drop it.
  }
}

/** "2 hours ago", for the loading card. */
export function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
