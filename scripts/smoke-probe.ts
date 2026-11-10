// The smokehouse measured (docs/water.md, Step 4): on one map, the landings' fresh and smoked fish
// sent and carried, no smokehouse against one at every landing, with no lines of yours -- a
// smokehouse must never sell less fish than none.
//   SEED=3218 DAYS=60 [GAME_TUNING='{"smokeWhatSpoils":null}'] bun scripts/smoke-probe.ts
import { GAME_MAP } from "../src/game/map";
import { startRun } from "../src/engine/game/runlog";
import { applyAction } from "../src/engine/game/actions";
import { gameTick } from "../src/engine/game/tick";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "../src/engine/economy/state";
import { fishFlows, fishSold } from "../src/engine/game/fishing";
import { flowKey, servedRate } from "../src/engine/game/goods";
import type { GameWorld } from "../src/engine/game/types";

const seed = Number(process.env.SEED ?? 3218);
const DAYS = Number(process.env.DAYS ?? 60);
const tuning = process.env.GAME_TUNING ? JSON.parse(process.env.GAME_TUNING) : {};
for (const k of Object.keys(tuning)) if (tuning[k] === null) tuning[k] = undefined;
const read = (w: GameWorld) => {
  const sum = (kind: string, f: (o: { delivered: number; trucked?: number; spoiled: number } | undefined, rate: number) => number) => fishFlows(w).filter((x) => x.kind === kind).reduce((s, x) => s + f(w.goods.outcomes.get(flowKey(x)), x.rate), 0) * D;
  const sent = (kind: string) => sum(kind, (_, r) => r);
  const carried = (kind: string) => sum(kind, (o) => servedRate(w, o as never)); // the 10-day roll: fish comes in part loads
  const ls = w.fishing!.landings;
  return `fresh sent ${sent("produce").toFixed(0)} carried ${carried("produce").toFixed(1)} | smoked sent ${sent("supplies").toFixed(0)} carried ${carried("supplies").toFixed(1)} t/day | sold ${Math.round((ls.reduce((s, l) => s + fishSold(w, l), 0) / ls.length) * 100)}%`;
};
for (const smoke of [false, true]) {
  const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, tuning);
  w.economy.funds = 1e7;
  if (smoke) for (const l of w.fishing!.landings) applyAction(w, { kind: "smokehouse", siteId: l.siteId });
  const per = Math.round(D / SIM_DT);
  for (let d = 1; d <= DAYS; d += 1) {
    for (let i = 0; i < per; i += 1) gameTick(w, SIM_DT);
    if (d % 20 === 0) console.log(`map ${seed} ${smoke ? "smokehouses" : "none       "} day ${d}: ${read(w)}`);
  }
}
