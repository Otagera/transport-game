// Headless calibration probe for the slice (docs/principles.md §6). Runs
// the real sliceTick with no renderer and prints what a player would feel:
// money, where passengers went, and per-route P&L. Calibration is the
// actual work in this project -- rerun this after touching tuning.ts.
//
//   bun scripts/slice-probe.ts            # built-in strategies
//   bun scripts/slice-probe.ts 40         # ...over 40 game days
import { SLICE_MAP } from "../src/slice/map";
import { addBus, buildRoad, directRoad, paveRoad, paveCost, createSliceWorld, diagnoseRoute, networkShare, routeSummaries, waitingAt } from "../src/engine/slice/world";
import { sliceTick } from "../src/engine/slice/tick";
import { planRoad } from "../src/engine/slice/roads";
import { setMaintained, upkeepPerDay, wearSpeed } from "../src/engine/slice/wear";
import { addFreightTrain, addLorry, diagnoseLorryRoute, goodsFlows, goodsVehicleCostPerDay } from "../src/engine/slice/goods";
import { addTrain, buildTrack, trackCost } from "../src/engine/slice/rail";
import { ALL_SYSTEMS_ON, DEFAULT_SLICE_TUNING } from "../src/engine/slice/tuning";
import { lorrySummaries } from "../src/engine/slice/goods";
import type { SliceWorld } from "../src/engine/slice/types";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY } from "../src/engine/economy/state";

const days = Number(process.argv[2] ?? 20);
// SLICE_TUNING='{"demandK":0.008}' overrides individual tuning values.
// Every system on: the probe calibrates all of them, slice zero or not.
const tuning = { ...DEFAULT_SLICE_TUNING, ...ALL_SYSTEMS_ON, ...JSON.parse(process.env.SLICE_TUNING ?? "{}") };

interface Strategy {
  name: string;
  setup: (world: SliceWorld) => void;
}

function buses(a: string, b: string, n: number) {
  return (world: SliceWorld) => {
    for (let i = 0; i < n; i += 1) addBus(world, a, b);
  };
}

function rail(tracks: Array<[string, string]>, trains: Array<[string, string]>) {
  return (world: SliceWorld) => {
    const funds = world.economy.funds;
    world.economy.funds = 1e9;
    let spent = 0;
    for (const [a, b] of tracks) {
      spent += trackCost(world, a, b);
      buildTrack(world, a, b);
    }
    for (const [a, b] of trains) addTrain(world, a, b);
    spent += trains.length * world.tuning.trainPurchaseCost;
    console.log(`    (track and trains: ₦${spent.toFixed(0)})`);
    world.economy.funds = funds - spent;
  };
}

function freight(tracks: Array<[string, string]>, feeders: number) {
  return (world: SliceWorld) => {
    freightOn(tracks, ["ilase", "ado"])(world);
    const funds = world.economy.funds;
    world.economy.funds = 1e9;
    if (feeders > 0) lorries("ado", "ogbe", 1)(world);
    if (feeders > 1) lorries("ado", "ipaja", 1)(world);
    world.economy.funds = funds - feeders * world.tuning.lorryPurchaseCost;
  };
}

function freightOn(tracks: Array<[string, string]>, [a, b]: [string, string]) {
  return (world: SliceWorld) => {
    const funds = world.economy.funds;
    world.economy.funds = 1e9;
    let spent = 0;
    for (const [x, y] of tracks) {
      spent += trackCost(world, x, y);
      buildTrack(world, x, y);
    }
    addFreightTrain(world, a, b);
    spent += world.tuning.freightPurchaseCost;
    console.log(`    (track and freight train: ₦${spent.toFixed(0)})`);
    world.economy.funds = funds - spent;
  };
}

function keepTrack(world: SliceWorld) {
  // New track needs no catch-up repair, but setMaintained refuses in debt: lend it the funds.
  const funds = world.economy.funds;
  world.economy.funds = 1e9;
  for (const segment of world.simulation.map.segments) if (segment.type === "rail" && !world.railOutOfService.has(segment.id)) setMaintained(world, segment.id, true);
  world.economy.funds = funds;
}

function lorries(a: string, b: string, n: number) {
  return (world: SliceWorld) => {
    for (let i = 0; i < n; i += 1) addLorry(world, a, b);
  };
}

// SLICE_ONLY='pave' runs just the strategies whose name contains it.
const only = process.env.SLICE_ONLY;
const allStrategies: Strategy[] = [
  { name: "do nothing", setup: () => {} },
  { name: "1 bus ilase-owode", setup: buses("ilase", "owode", 1) },
  { name: "2 buses ilase-owode", setup: buses("ilase", "owode", 2) },
  { name: "4 buses ilase-owode", setup: buses("ilase", "owode", 4) },
    { name: "12 buses ilase-owode", setup: (w) => { const f = w.economy.funds; w.economy.funds = 1e9; buses("ilase", "owode", 12)(w); w.economy.funds = f - 12 * w.tuning.busPurchaseCost; } },
  { name: "6 buses ilase-owode", setup: (w) => { const f = w.economy.funds; w.economy.funds = 1e9; buses("ilase", "owode", 6)(w); w.economy.funds = f - 6 * w.tuning.busPurchaseCost; } },
  { name: "1 bus ilase-ise (thin)", setup: buses("ilase", "ise", 1) },
  { name: "1 bus ilase-ado (long, via owode)", setup: buses("ilase", "ado", 1) },
  {
    name: "chain: 2 ilase-owode + 2 owode-ado",
    setup: (w) => {
      w.economy.funds += 2000;
      buses("ilase", "owode", 2)(w);
      buses("owode", "ado", 2)(w);
      w.economy.funds -= 2000;
    },
  },
  {
    name: "hub: 2 ilase-owode, 1 ilase-kuto, 1 ilase-ise",
    setup: (w) => {
      buses("ilase", "owode", 2)(w);
      buses("ilase", "kuto", 1)(w);
      buses("ilase", "ise", 1)(w);
    },
  },
  // Paving (step 2c): the trunk is dirt, so it jams first. Pave cost is
  // charged before startFunds is read, so net/day here is running profit;
  // weigh it against the one-off price printed by the strategy.
  { name: "pave ilase-owode, no buses", setup: (w) => void paveRoad(w, "ilase", "owode") },
  {
    name: "2 buses ilase-owode, paved",
    setup: (w) => {
      paveRoad(w, "ilase", "owode");
      buses("ilase", "owode", 2)(w);
    },
  },
  {
    name: "4 buses ilase-owode, paved",
    setup: (w) => {
      w.economy.funds += 1000;
      paveRoad(w, "ilase", "owode");
      buses("ilase", "owode", 4)(w);
      w.economy.funds -= 1000;
    },
  },
  {
    name: "6 buses ilase-owode, paved",
    setup: (w) => {
      const f = w.economy.funds;
      w.economy.funds = 1e9;
      paveRoad(w, "ilase", "owode");
      buses("ilase", "owode", 6)(w);
      w.economy.funds = f - 6 * w.tuning.busPurchaseCost - paveCost(w, "ilase", "owode");
    },
  },
  // Step 4, wear: the same chain, keeping up none, the trunk, or every road
  // it runs on (setup charges the catch-up repair before net/day is read).
  {
    name: "wear: chain, maintain the trunk",
    setup: (w) => {
      w.economy.funds += 2500;
      buses("ilase", "owode", 2)(w);
      buses("owode", "ado", 2)(w);
      setMaintained(w, directRoad(w, "ilase", "owode")!.id, true);
      w.economy.funds -= 2500;
    },
  },
  {
    name: "wear: chain, maintain both its roads",
    setup: (w) => {
      w.economy.funds += 2500;
      buses("ilase", "owode", 2)(w);
      buses("owode", "ado", 2)(w);
      setMaintained(w, directRoad(w, "ilase", "owode")!.id, true);
      setMaintained(w, directRoad(w, "owode", "ado")!.id, true);
      w.economy.funds -= 2500;
    },
  },
  {
    name: "wear: chain, trunk paved and maintained",
    setup: (w) => {
      w.economy.funds += 2500;
      paveRoad(w, "ilase", "owode");
      buses("ilase", "owode", 2)(w);
      buses("owode", "ado", 2)(w);
      setMaintained(w, directRoad(w, "ilase", "owode")!.id, true);
      w.economy.funds -= 2500;
    },
  },
  {
    name: "chain, trunk paved",
    setup: (w) => {
      w.economy.funds += 2500;
      paveRoad(w, "ilase", "owode");
      buses("ilase", "owode", 2)(w);
      buses("owode", "ado", 2)(w);
      w.economy.funds -= 2500;
    },
  },
  // Rail (step 4d): restore the old export line, or lay track where people
  // travel. Track and train bought with extra money so net/day compares.
  { name: "rail: restore ilase-ipaja + 1 train", setup: rail([["ilase", "ipaja"]], [["ilase", "ipaja"]]) },
  { name: "rail: track ilase-owode + 1 train", setup: rail([["ilase", "owode"]], [["ilase", "owode"]]) },
  { name: "rail: track ilase-owode + 2 trains", setup: rail([["ilase", "owode"]], [["ilase", "owode"], ["ilase", "owode"]]) },
  { name: "rail: track ilase-ado + 1 train", setup: rail([["ilase", "ado"]], [["ilase", "ado"]]) },
  {
    name: "rail: track ilase-owode-ado + 1 train",
    setup: rail([["ilase", "owode"], ["owode", "ado"]], [["ilase", "ado"]]),
  },
  // Track wear: the two lines that pay, left alone or kept up from the start.
  { name: "track wear: ilase-owode, left alone", setup: rail([["ilase", "owode"]], [["ilase", "owode"]]) },
  { name: "track wear: ilase-owode, maintained", setup: (w) => { rail([["ilase", "owode"]], [["ilase", "owode"]])(w); keepTrack(w); } },
  { name: "track wear: ilase-owode-ado, left alone", setup: rail([["ilase", "owode"], ["owode", "ado"]], [["ilase", "ado"]]) },
  {
    name: "track wear: ilase-owode-ado, maintained",
    setup: (w) => {
      rail([["ilase", "owode"], ["owode", "ado"]], [["ilase", "ado"]])(w);
      keepTrack(w);
    },
  },
  // Alignment: Ilaro-Owode over the ridge (straight) or round it (cheapest).
  { name: "align: ilaro-owode round + 1 bus", setup: (w) => { buildRoad(w, "ilaro", "owode"); buses("ilaro", "owode", 1)(w); } },
  { name: "align: ilaro-owode straight + 1 bus", setup: (w) => { buildRoad(w, "ilaro", "owode", "direct"); buses("ilaro", "owode", 1)(w); } },
  { name: "align: ilaro-owode round + bus ilaro-ilase", setup: (w) => { buildRoad(w, "ilaro", "owode"); buses("ilaro", "ilase", 1)(w); } },
  { name: "align: ilaro-owode straight + bus ilaro-ilase", setup: (w) => { buildRoad(w, "ilaro", "owode", "direct"); buses("ilaro", "ilase", 1)(w); } },
  // Freight trains + export: a freight train on the trunk alone (no produce
  // reaches Ado, so nothing to export), with lorries feeding Ado (export
  // back to the port), and on the restored old line.
  { name: "freight: ilase-owode-ado track + freight alone", setup: freight([["ilase", "owode"], ["owode", "ado"]], 0) },
  { name: "freight: same + lorries feeding ado", setup: freight([["ilase", "owode"], ["owode", "ado"]], 2) },
  { name: "freight: lorries feeding ado only (no train)", setup: (w) => { w.economy.funds += 1100; lorries("ado", "ogbe", 1)(w); lorries("ado", "ipaja", 1)(w); w.economy.funds -= 1100; } },
  { name: "freight: restored ilase-ipaja + freight", setup: freightOn([["ilase", "ipaja"]], ["ilase", "ipaja"]) },
  // Goods (step 4c): lorries where goods flow both ways against one-way
  // routes. Produce: Kuto/Ise -> Ilase, Ogbe -> Ado; supplies: Ilase -> all.
  { name: "goods: lorry ilase-kuto (both ways)", setup: lorries("ilase", "kuto", 1) },
  { name: "goods: 2 lorries ilase-kuto", setup: (w) => { w.economy.funds += 1000; lorries("ilase", "kuto", 2)(w); w.economy.funds -= 1000; } },
  { name: "goods: lorry ilase-ise (both ways)", setup: lorries("ilase", "ise", 1) },
  { name: "goods: lorry ado-ogbe (produce only)", setup: lorries("ado", "ogbe", 1) },
  { name: "goods: lorry ilase-owode (supplies only)", setup: lorries("ilase", "owode", 1) },
  { name: "goods: lorry ilase-ado (supplies, long)", setup: lorries("ilase", "ado", 1) },
  {
    name: "goods: 2 buses ilase-owode + lorry ilase-kuto",
    setup: (w) => {
      buses("ilase", "owode", 2)(w);
      lorries("ilase", "kuto", 1)(w);
    },
  },
  // Through-routes (playtest day 14): each thin shuttle against the route
  // world.ts throughRoute suggests instead, one bus each.
  { name: "through: shuttle ado-ogbe", setup: buses("ado", "ogbe", 1) },
  { name: "through: run on owode-ogbe (via ado)", setup: buses("owode", "ogbe", 1) },
  { name: "through: shuttle ilase-ise", setup: buses("ilase", "ise", 1) },
  { name: "through: run on owode-ise (via ilase)", setup: buses("owode", "ise", 1) },
  {
    name: "through: shuttle kuto-ikole (bridged)",
    setup: (w) => {
      buildRoad(w, "kuto", "ikole");
      buses("kuto", "ikole", 1)(w);
    },
  },
  // Step 3: Ikole sits across the river. Bridge it from the west, or reach
  // it dry from Ado and let Ilase's riders go round.
  {
    name: "ikole: bridge ilase-ikole + 1 bus",
    setup: (w) => {
      buildRoad(w, "ilase", "ikole");
      buses("ilase", "ikole", 1)(w);
    },
  },
  {
    name: "ikole: bridge kuto-ikole + 1 bus ilase-ikole",
    setup: (w) => {
      buildRoad(w, "kuto", "ikole");
      buses("ilase", "ikole", 1)(w);
    },
  },
  {
    name: "ikole: dry road ado-ikole + 1 bus ado-ikole",
    setup: (w) => {
      buildRoad(w, "ado", "ikole");
      buses("ado", "ikole", 1)(w);
    },
  },
];

const fmt = (n: number) => n.toFixed(0).padStart(6);
const pct = (n: number) => `${(n * 100).toFixed(0).padStart(3)}%`;

for (const [a, b] of [["ilase", "ikole"], ["kuto", "ikole"], ["ado", "ikole"], ["ilaro", "owode"], ["ilaro", "ilase"]]) {
  const plan = planRoad(createSliceWorld(SLICE_MAP, tuning), a!, b!);
  console.log(`road ${a}-${b}: ` + (plan ? `₦${plan.cost} (bridge ${plan.bridgeCells} cells ₦${plan.bridgeCost}, hills ₦${plan.hillsCost}), ${plan.length.toFixed(1)} cells` : "can't be built"));
}
const strategies = only ? allStrategies.filter((s) => s.name.includes(only)) : allStrategies;
console.log(`pave ilase-owode costs ${paveCost(createSliceWorld(SLICE_MAP, tuning), "ilase", "owode")}`);
for (const strategy of strategies) {
  const world = createSliceWorld(SLICE_MAP, tuning);
  strategy.setup(world);
  const startFunds = world.economy.funds;
  const ticks = Math.round((days * SECONDS_PER_GAME_DAY) / SIM_DT);
  const townEvents: string[] = [];
  for (let i = 0; i < ticks; i += 1) {
    for (const event of sliceTick(world, SIM_DT)) {
      const day = Math.floor((i * SIM_DT) / SECONDS_PER_GAME_DAY) + 1;
      townEvents.push(`day ${day} ${event.kind} ${"name" in event ? event.name : "amount" in event ? Math.round(event.amount) : ""}`);
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
  // Export proper: produce leaving a market for the port (a farm town whose
  // nearest market is the port just sends produce there).
  const exports = goodsFlows(world).filter(
    (f) => f.to === world.port && f.kind === "produce" && world.towns.get(f.from)!.population >= world.tuning.marketPopulation,
  );
  if (exports.length > 0) console.log(`    export: ${exports.map((f) => `${f.from} ${(f.rate * SECONDS_PER_GAME_DAY).toFixed(0)} t/day`).join(", ")}`);
  for (const route of world.lorryRoutes) {
    const d = diagnoseLorryRoute(world, route.id)!;
    const cost = route.vehicleIds.length * goodsVehicleCostPerDay(world, route.id);
    const income = lorrySummaries(world).find((summary) => summary.id === route.id)?.incomePerDay ?? 0;
    console.log(
      `    ${route.id.padEnd(20)} lorries ${route.vehicleIds.length}  in ${fmt(income)}  cost ${fmt(cost)}  net ${fmt(income - cost)}/day  → ${d.verdict.padEnd(9)} ` +
        `t/day out ${d.outbound.toFixed(0)} in ${d.inbound.toFixed(0)}  delivered ${pct(d.delivered)} spoiled ${pct(d.spoiled)} load ${pct(d.loadFactor)}`,
    );
  }
  const track = world.simulation.map.segments
    .filter((s) => s.type === "rail" && !world.railOutOfService.has(s.id))
    .map((s) => `${s.id}${world.maintained.has(s.id) ? "*" : ""} ${pct(s.condition)} (${pct(wearSpeed(world, s))} speed, ${world.maintained.has(s.id) ? "upkeep" : "would cost"} ${upkeepPerDay(world, s).toFixed(0)}/day)`);
  if (track.length > 0) console.log(`    track (* maintained): ${track.join(", ")}`);
  const roads = world.simulation.map.segments
    .filter((s) => (world.roadFlowEMA.get(s.id) ?? 0) > 0.2)
    .map((s) => `${s.id}${world.maintained.has(s.id) ? "*" : ""} ${pct(s.condition)} (${pct(wearSpeed(world, s))} speed${world.maintained.has(s.id) ? `, upkeep ${upkeepPerDay(world, s).toFixed(0)}/day` : ""})`);
  console.log(`    roads (* maintained): ${roads.join(", ")}`);
  const busiest = [...world.roadFlowEMA].sort((a, b) => b[1] - a[1])[0];
  if (busiest) console.log(`    busiest road: ${busiest[0]} flow ${busiest[1].toFixed(2)}/s at ${pct(world.segmentSpeed.get(busiest[0]) ?? 1)} speed`);
  const flows = [...world.settlement.segmentFlowEMA].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(
    `    busiest roads (riders/s, yours): ${flows.map(([id, f]) => `${id} ${f.toFixed(2)} (${(world.settlement.segmentPlayerFlowEMA.get(id) ?? 0).toFixed(2)})`).join(", ")}`,
  );
  const grown = [...world.basePopulation]
    .filter(([id, base]) => Math.abs(world.towns.get(id)!.population / base - 1) > 0.01)
    .map(([id, base]) => `${world.towns.get(id)!.name} ${base}→${world.towns.get(id)!.population.toFixed(0)}k`);
  console.log(`    original towns grown: ${grown.join(", ") || "none"}`);
  const emergent = [...world.settlement.emergent].map((id) => `${world.towns.get(id)!.name} ${world.towns.get(id)!.population.toFixed(1)}k`);
  if (townEvents.length > 0) console.log(`    towns: ${townEvents.join("; ")}  → now ${emergent.join(", ") || "none"}`);
  for (const route of routeSummaries(world)) {
    const d = diagnoseRoute(world, route.id)!;
    console.log(
      `    ${route.id.padEnd(16)} buses ${route.buses}  in ${fmt(route.incomePerDay)}  cost ${fmt(route.costPerDay)}  net ${fmt(route.netPerDay)}/day  ` +
        `→ ${d.verdict.padEnd(12)} speed ${pct(d.speed)} informal traffic ${pct(d.informalTraffic)} carried ${pct(d.carried)} poached ${pct(d.poached)} gaveUp ${pct(d.gaveUp)} home ${pct(d.lost)} load ${pct(d.loadFactor)} ceiling ${fmt(d.ceilingPerDay)}`,
    );
  }
}
