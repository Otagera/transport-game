// The informal canoes measured (docs/water.md, Step 5): on one map, canoes off and on, with no lines
// of yours -- the riders and fish they carry, the shares (yours, informal, home), fish sold, and the
// tick's cost.
//   SEED=3218 DAYS=40 bun scripts/canoe-probe.ts
import { GAME_MAP } from "../src/game/map";
import { startRun } from "../src/engine/game/runlog";
import { gameTick } from "../src/engine/game/tick";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "../src/engine/economy/state";
import { networkShare } from "../src/engine/game/world";
import { canoeTotals } from "../src/engine/game/canoes";
import { fishSold } from "../src/engine/game/fishing";
import type { GameWorld } from "../src/engine/game/types";

const seed = Number(process.env.SEED ?? 3218);
const DAYS = Number(process.env.DAYS ?? 40);
const play = (canoes: boolean) => {
  const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, canoes ? {} : { canoesEnabled: undefined });
  const t0 = performance.now();
  for (let i = 0; i < Math.round((DAYS * D) / SIM_DT); i += 1) gameTick(w, SIM_DT);
  return { w, ms: performance.now() - t0 };
};
const read = (w: GameWorld) => {
  const s = networkShare(w), c = canoeTotals(w), ls = w.fishing?.landings ?? [];
  const people = [...w.towns.values()].filter((t) => !t.industry).reduce((sum, t) => sum + t.population, 0);
  return `informal ${(s.informal * 100).toFixed(1)}%, home ${(s.lost * 100).toFixed(1)}% | canoes ${Math.round(c.riders)} riders/day, ${c.fish.toFixed(1)} t fish/day on ${w.canoes?.riders.size ?? 0} stretches | fish sold ${Math.round((ls.reduce((sum, l) => sum + fishSold(w, l), 0) / Math.max(1, ls.length)) * 100)}% | people ${Math.round(people)}k`;
};
const off = play(false), on = play(true);
console.log(`map ${seed} day ${DAYS}\n  off: ${read(off.w)} | ${Math.round(off.ms / 1000)} s\n  on:  ${read(on.w)} | ${Math.round(on.ms / 1000)} s`);
