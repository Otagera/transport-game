// Headless calibration probe for the slice (docs/principles.md §6). Runs
// the real sliceTick with no renderer and prints what a player would feel:
// money, where passengers went, and per-route P&L. Calibration is the
// actual work in this project -- rerun this after touching tuning.ts.
//
//   bun scripts/slice-probe.ts            # built-in strategies
//   bun scripts/slice-probe.ts 40         # ...over 40 game days
import { SLICE_MAP } from "../src/slice/map";
import { addBus, buildRoad, createSliceWorld, diagnoseRoute, networkShare, routeSummaries, waitingAt } from "../src/engine/slice/world";
import { sliceTick } from "../src/engine/slice/tick";
import { DEFAULT_SLICE_TUNING } from "../src/engine/slice/tuning";
import type { SliceWorld } from "../src/engine/slice/types";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY } from "../src/engine/economy/state";

const days = Number(process.argv[2] ?? 20);
// SLICE_TUNING='{"demandK":0.008}' overrides individual tuning values.
const tuning = { ...DEFAULT_SLICE_TUNING, ...JSON.parse(process.env.SLICE_TUNING ?? "{}") };

interface Strategy {
  name: string;
  setup: (world: SliceWorld) => void;
}

function buses(a: string, b: string, n: number) {
  return (world: SliceWorld) => {
    for (let i = 0; i < n; i += 1) addBus(world, a, b);
  };
}

const strategies: Strategy[] = [
  { name: "do nothing", setup: () => {} },
  { name: "1 bus ilase-owode", setup: buses("ilase", "owode", 1) },
  { name: "2 buses ilase-owode", setup: buses("ilase", "owode", 2) },
  { name: "4 buses ilase-owode", setup: buses("ilase", "owode", 4) },
    { name: "12 buses ilase-owode", setup: (w) => { const f = w.economy.funds; w.economy.funds = 1e9; buses("ilase", "owode", 12)(w); w.economy.funds = f - 12 * w.tuning.busPurchaseCost; } },
  { name: "6 buses ilase-owode", setup: (w) => { const f = w.economy.funds; w.economy.funds = 1e9; buses("ilase", "owode", 6)(w); w.economy.funds = f - 6 * w.tuning.busPurchaseCost; } },
  { name: "1 bus ilase-ise (thin)", setup: buses("ilase", "ise", 1) },
  { name: "1 bus ilase-ado (long, via owode)", setup: buses("ilase", "ado", 1) },
  {
    name: "road ilase-ikole + 1 bus",
    setup: (w) => {
      buildRoad(w, "ilase", "ikole");
      buses("ilase", "ikole", 1)(w);
    },
  },
];

const fmt = (n: number) => n.toFixed(0).padStart(6);
const pct = (n: number) => `${(n * 100).toFixed(0).padStart(3)}%`;

for (const strategy of strategies) {
  const world = createSliceWorld(SLICE_MAP, tuning);
  strategy.setup(world);
  const startFunds = world.economy.funds;
  const ticks = Math.round((days * SECONDS_PER_GAME_DAY) / SIM_DT);
  const townEvents: string[] = [];
  for (let i = 0; i < ticks; i += 1) {
    for (const event of sliceTick(world, SIM_DT)) {
      const day = Math.floor((i * SIM_DT) / SECONDS_PER_GAME_DAY) + 1;
      townEvents.push(`day ${day} ${event.kind} ${event.name}`);
    }
  }

  const share = networkShare(world);
  const perDay = (world.economy.funds - startFunds) / days;
  const danfos = world.simulation.vehicles.filter((v) => v.lifecycle === "one-shot").length;
  console.log(
    `${strategy.name.padEnd(40)} funds ${fmt(world.economy.funds)}  net/day ${fmt(perDay)}  ` +
      `share you ${pct(share.player)} danfo ${pct(share.informal)} home ${pct(share.lost)}  ` +
      `danfos ${String(danfos).padStart(3)}  waiting@ilase ${fmt(waitingAt(world, "ilase"))}  informal ₦ ${fmt(world.informal.earnings)}`,
  );
  const flows = [...world.settlement.segmentFlowEMA].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(
    `    busiest roads (riders/s, yours): ${flows.map(([id, f]) => `${id} ${f.toFixed(2)} (${(world.settlement.segmentPlayerFlowEMA.get(id) ?? 0).toFixed(2)})`).join(", ")}`,
  );
  const emergent = [...world.settlement.emergent].map((id) => `${world.towns.get(id)!.name} ${world.towns.get(id)!.population.toFixed(1)}k`);
  if (townEvents.length > 0) console.log(`    towns: ${townEvents.join("; ")}  → now ${emergent.join(", ") || "none"}`);
  for (const route of routeSummaries(world)) {
    const d = diagnoseRoute(world, route.id)!;
    console.log(
      `    ${route.id.padEnd(16)} buses ${route.buses}  in ${fmt(route.incomePerDay)}  cost ${fmt(route.costPerDay)}  net ${fmt(route.netPerDay)}/day  ` +
        `→ ${d.verdict.padEnd(12)} carried ${pct(d.carried)} poached ${pct(d.poached)} gaveUp ${pct(d.gaveUp)} home ${pct(d.lost)} load ${pct(d.loadFactor)} ceiling ${fmt(d.ceilingPerDay)}`,
    );
  }
}
