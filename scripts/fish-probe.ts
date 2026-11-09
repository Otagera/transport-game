// Fishing measured (docs/water.md, Step 4): on one map, 40 days three ways -- fishing off, on, and on
// with a smokehouse at the landing wasting most -- the catch, what reaches the markets fresh and
// smoked, and what it does to the markets' food and room to grow (it must only add).
//   SEED=8703 bun scripts/fish-probe.ts
import { GAME_MAP } from "../src/game/map";
import { startRun } from "../src/engine/game/runlog";
import { applyAction } from "../src/engine/game/actions";
import { gameTick } from "../src/engine/game/tick";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "../src/engine/economy/state";
import { marketFed, marketTowns } from "../src/engine/game/food";
import { fishServed, landingSplit } from "../src/engine/game/fishing";
import { townGrowth } from "../src/engine/game/growth";
import type { GameWorld } from "../src/engine/game/types";

const seed = Number(process.env.SEED ?? 8703);
const DAYS = Number(process.env.DAYS ?? 40);
const play = (fishing: boolean, smoke: boolean) => {
  const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, fishing ? {} : { fishingEnabled: undefined });
  w.economy.funds = 1e7;
  let smoked = "";
  if (smoke && w.fishing?.landings.length) {
    const worst = [...w.fishing.landings].sort((p, q) => (landingSplit(w, q.siteId)?.wasted ?? 0) - (landingSplit(w, p.siteId)?.wasted ?? 0))[0]!;
    smoked = w.towns.get(worst.siteId)!.name;
    applyAction(w, { kind: "smokehouse", siteId: worst.siteId });
  }
  const t0 = performance.now();
  for (let i = 0; i < Math.round((DAYS * D) / SIM_DT); i += 1) gameTick(w, SIM_DT);
  return { w, smoked, ms: performance.now() - t0 };
};
const read = (w: GameWorld) => {
  const markets = marketTowns(w);
  const eaters = [...w.towns.values()].filter((t) => !t.industry && w.basePopulation.has(t.id));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  return {
    fed: mean(markets.map((m) => marketFed(w, m.id))),
    fish: mean(eaters.map((t) => fishServed(w, t.id))),
    reached: eaters.filter((t) => fishServed(w, t.id) > 0.01).length,
    eaters: eaters.length,
    room: eaters.reduce((s, t) => s + (townGrowth(w, t.id)?.cap ?? 0), 0),
    people: eaters.reduce((s, t) => s + t.population, 0),
  };
};
const off = play(false, false), on = play(true, false), smoked = play(true, true);
const landings = on.w.fishing?.landings ?? [];
const split = landings.map((l) => landingSplit(on.w, l.siteId)!);
const sum = (k: "caught" | "fresh" | "smoked" | "wasted") => Math.round(split.reduce((s, x) => s + x[k], 0));
const [a, b, c] = [read(off.w), read(on.w), read(smoked.w)];
console.log(`map ${seed}: ${landings.length} landings (${landings.map((l) => on.w.towns.get(l.townId)!.name).join(", ")}): catch ${sum("caught")} t/day, fresh ${sum("fresh")}, no buyer ${sum("wasted")}`);
console.log(`  day ${DAYS}: markets fed ${(a.fed * 100).toFixed(1)}% off, ${(b.fed * 100).toFixed(1)}% on; fish served ${(b.fish * 100).toFixed(0)}% on average, ${b.reached} of ${b.eaters} towns getting some (smokehouse at ${smoked.smoked || "none"}: ${(c.fish * 100).toFixed(0)}%, ${c.reached} towns); room to grow ${Math.round(a.room)}k off, ${Math.round(b.room)}k on, ${Math.round(c.room)}k smoked; people ${Math.round(a.people)}k / ${Math.round(b.people)}k / ${Math.round(c.people)}k; ticks ${Math.round(off.ms / 1000)} s / ${Math.round(on.ms / 1000)} s`);
