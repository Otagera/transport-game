import { SLICE_MAP } from "../src/slice/map";
// The brief's Evidence, measured with every system on (before slice zero).
import { ALL_SYSTEMS_ON, DEFAULT_SLICE_TUNING } from "../src/engine/slice/tuning";
import { createSliceWorld, networkShare } from "../src/engine/slice/world";
import { sliceTick } from "../src/engine/slice/tick";
import { startSliceGame } from "../src/engine/slice/start";
import { forecast } from "../src/engine/slice/forecast";
import { applyAction, type ActionSpec } from "../src/engine/slice/actions";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY } from "../src/engine/economy/state";
const run = (w: any, days: number) => { const n = Math.round(days * SECONDS_PER_GAME_DAY / SIM_DT); for (let i = 0; i < n; i++) sliceTick(w, SIM_DT); };
const cands: ActionSpec[] = [
  { kind: "bus", a: "kuto", b: "ipaja" }, { kind: "minibus", a: "kuto", b: "ipaja" }, { kind: "bus", a: "ise", b: "ipaja" },
  { kind: "bus", a: "ilase", b: "owode" }, { kind: "minibus", a: "ilase", b: "ise" }, { kind: "bus", a: "owode", b: "ise" },
];
// START=warm buys on day 1 of the warmed-up world (start.ts) instead of a
// cold one; SYSTEMS=zero uses slice zero's tuning instead of every system on.
const tuning = { ...DEFAULT_SLICE_TUNING, ...(process.env.SYSTEMS === "zero" ? {} : ALL_SYSTEMS_ON) };
const warmStart = process.env.START === "warm";
for (const warm of warmStart ? [0] : [0, 3, 8]) {
  const base = warmStart ? startSliceGame(SLICE_MAP, tuning) : createSliceWorld(SLICE_MAP, tuning); run(base, warm);
  console.log(`\n--- bought at day ${warm + 1}; share now`, JSON.stringify(networkShare(base)));
  console.log("action                 forecast2d   days0-10   days10-20   days20-30");
  for (const c of cands) {
    const f = forecast(base, c, { label: "x", towns: [] });
    const real = structuredClone(base), shadow = structuredClone(base);
    applyAction(real, c);
    const out: number[] = []; let prev = real.economy.funds - shadow.economy.funds;
    for (let k = 0; k < 3; k++) { run(real, 10); run(shadow, 10); const gap = real.economy.funds - shadow.economy.funds; out.push((gap - prev) / 10); prev = gap; }
    console.log(`${(c.kind + " " + (c as any).a + "-" + (c as any).b).padEnd(22)} ${String(Math.round(f?.moneyPerDay ?? NaN)).padStart(9)} ${out.map((x) => String(Math.round(x)).padStart(11)).join(" ")}`);
  }
}
