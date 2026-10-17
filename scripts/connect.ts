import { SLICE_MAP } from "../src/slice/map";
import { createSliceWorld, networkShare, addBus, addMinibus, buildRoad } from "../src/engine/slice/world";
import { sliceTick } from "../src/engine/slice/tick";
import { DEFAULT_SLICE_TUNING } from "../src/engine/slice/tuning";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY } from "../src/engine/economy/state";
const run = (w: any, days: number) => { const n = Math.round(days * SECONDS_PER_GAME_DAY / SIM_DT); for (let i = 0; i < n; i++) sliceTick(w, SIM_DT); };
const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
const strategies: [string, (w: any) => void][] = [
  ["nothing", () => {}],
  ["2 trunk buses", (w) => { addBus(w, "ilase", "owode"); addBus(w, "ilase", "owode"); }],
  ["roads to Ilaro + Ikole, no buses", (w) => { buildRoad(w, "ilaro", "ilase", "cheapest"); buildRoad(w, "kuto", "ikole", "cheapest"); }],
  ["roads + 2 trunk + minibus Ilaro-Owode + bus Ilase-Ikole", (w) => { buildRoad(w, "ilaro", "ilase", "cheapest"); buildRoad(w, "kuto", "ikole", "cheapest"); addBus(w, "ilase", "owode"); addBus(w, "ilase", "owode"); addMinibus(w, "ilaro", "owode"); addBus(w, "ilase", "ikole"); }],
];
for (const [name, act] of strategies) {
  const w = createSliceWorld(SLICE_MAP, { ...DEFAULT_SLICE_TUNING, startingFunds: 100000 });
  // createSliceWorld signature: (map, tuning?) -- merge defaults
  act(w); const f0 = w.economy.funds;
  const rows: string[] = [];
  for (const d of [10, 20, 40]) { run(w, d - [0, 10, 20][rows.length]); const s = networkShare(w); rows.push(`d${d}: you${pct(s.player)} inf${pct(s.informal)} home${pct(s.lost)}`); }
  console.log(name.padEnd(56), rows.join("  |  "), " money since start", Math.round(w.economy.funds - f0));
}
