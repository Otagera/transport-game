// Lever audit for the slice: for every action a player can take, does the
// page show that it worked, how soon, and can the player tell it was *their*
// action that did it?
//
// Method: two identical worlds (the sim is deterministic) are set up the
// same way and warmed together. The lever is pulled in one of them only;
// both then run on, and every number the page displays is sampled in both.
// The difference is exactly the lever's effect -- nothing else changed.
// For each displayed number it reports:
//
//   effect   what it settles to (mean difference over the last two days)
//   visible  when the difference first exceeds what the display can show
//            (₦10/day, 1 percentage point, one waiting-dot, 1k people)
//   63%      when it first reaches 63% of its settled value -- the lag
//   signal   settled effect / the number's own jitter in the untouched
//            world: under ~2, the player can't tell the change from noise
//
//   bun scripts/slice-lever-audit.ts            # every lever
//   bun scripts/slice-lever-audit.ts pave       # levers whose name matches
import { SLICE_MAP } from "../src/slice/map";
import {
  addBus,
  buildRoad,
  createSliceWorld,
  networkShare,
  roadPath,
  paveRoad,
  removeBus,
  routeKey,
  routeSummaries,
  townShare,
  waitingAt,
} from "../src/engine/slice/world";
import { sliceTick } from "../src/engine/slice/tick";
import { DEFAULT_SLICE_TUNING } from "../src/engine/slice/tuning";
import { setMaintained } from "../src/engine/slice/wear";
import { addLorry, lorrySummaries } from "../src/engine/slice/goods";
import { addTrain, buildTrack } from "../src/engine/slice/rail";
import { addFreightTrain } from "../src/engine/slice/goods";
import { computeBurnRate } from "../src/engine/economy/report";
import { lastDay } from "../src/engine/slice/ledger";
import type { SliceWorld } from "../src/engine/slice/types";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY } from "../src/engine/economy/state";

const WARM_DAYS = 10;
const AFTER_DAYS = Number(process.env.AFTER_DAYS ?? 10);
const SAMPLE_SECONDS = 1;
const filter = process.argv[2];

/** A mid-game network: the trunk, the river crossing, a southern feeder. */
function baseline(): SliceWorld {
  const world = createSliceWorld(SLICE_MAP, { ...DEFAULT_SLICE_TUNING, startingFunds: 100_000 });
  addBus(world, "ilase", "owode");
  addBus(world, "ilase", "owode");
  addBus(world, "owode", "ado");
  addBus(world, "ilase", "kuto");
  return world;
}

function run(world: SliceWorld, seconds: number): void {
  for (let t = 0; t < seconds; t += SIM_DT) sliceTick(world, SIM_DT);
}

interface Watch {
  label: string;
  /** What the page shows. */
  read: (world: SliceWorld) => number;
  /** The smallest change the display can show. */
  resolution: number;
  unit: "₦" | "pp" | "people" | "k";
}

interface Lever {
  name: string;
  /** Pull it. Returns what to watch beyond the network-wide numbers. */
  pull: (world: SliceWorld) => Watch[];
}

const money = (label: string, read: (w: SliceWorld) => number): Watch => ({ label, read, resolution: 10, unit: "₦" });
const share = (label: string, read: (w: SliceWorld) => number): Watch => ({ label, read: (w) => read(w) * 100, resolution: 1, unit: "pp" });
const routeNet = (id: string) => (w: SliceWorld) => routeSummaries(w).find((r) => r.id === id)?.netPerDay ?? 0;
const lorryNet = (id: string) => (w: SliceWorld) => lorrySummaries(w).find((r) => r.id === id)?.netPerDay ?? 0;
/**
 * The road between a and b as it stands now: by day 10 a roadside town has
 * usually split it (Owode - Mile 10 - Ado), so "the Owode-Ado road" is
 * several segments, and paving or fixing it means each of them.
 */
function roadPieces(world: SliceWorld, a: string, b: string): Array<{ from: string; to: string; id: string }> {
  const path = roadPath(world, a, b);
  if (!path) return [];
  return path.segmentIds.map((id, i) => ({ from: path.nodeIds[i]!, to: path.nodeIds[i + 1]!, id }));
}
const meanOver = (a: string, b: string, read: (w: SliceWorld, id: string) => number) => (w: SliceWorld) => {
  const pieces = roadPieces(w, a, b);
  return pieces.length === 0 ? 1 : pieces.reduce((sum, p) => sum + read(w, p.id), 0) / pieces.length;
};
const roadSpeed = (a: string, b: string) => meanOver(a, b, (w, id) => w.segmentSpeed.get(id) ?? 1);
const roadCondition = (a: string, b: string) =>
  meanOver(a, b, (w, id) => w.simulation.map.segments.find((s) => s.id === id)?.condition ?? 1);

const levers: Lever[] = [
  {
    name: "add a bus to a busy route (+ on Ilase–Owode, 2 → 3)",
    pull: (w) => {
      addBus(w, "ilase", "owode");
      const id = routeKey("ilase", "owode");
      return [money("route net/day", routeNet(id)), share("Ilase ring: you", (x) => townShare(x, "ilase").player), { label: "waiting at Ilase", read: (x) => waitingAt(x, "ilase"), resolution: 4, unit: "people" }];
    },
  },
  {
    name: "sell a bus (− on Owode–Ado, 1 → 0)",
    pull: (w) => {
      removeBus(w, routeKey("owode", "ado"));
      return [share("Ado ring: you", (x) => townShare(x, "ado").player), share("Ado ring: informal", (x) => townShare(x, "ado").informal)];
    },
  },
  {
    name: "open a new bus route (Ilase–Ise)",
    pull: (w) => {
      addBus(w, "ilase", "ise");
      const id = routeKey("ilase", "ise");
      return [money("route net/day", routeNet(id)), share("Ise ring: you", (x) => townShare(x, "ise").player)];
    },
  },
  {
    name: "build a road to a cut-off town (Ilase–Ikole, cheapest)",
    pull: (w) => {
      buildRoad(w, "ilase", "ikole");
      return [share("Ikole ring: informal", (x) => townShare(x, "ikole").informal), share("Ikole ring: stayed home", (x) => townShare(x, "ikole").lost)];
    },
  },
  {
    name: "build a road + run a bus on it (Ilase–Ikole)",
    pull: (w) => {
      buildRoad(w, "ilase", "ikole");
      addBus(w, "ilase", "ikole");
      const id = routeKey("ilase", "ikole");
      return [money("route net/day", routeNet(id)), share("Ikole ring: you", (x) => townShare(x, "ikole").player)];
    },
  },
  {
    name: "pave the trunk (Owode–Ado, every piece)",
    pull: (w) => {
      for (const piece of roadPieces(w, "owode", "ado")) paveRoad(w, piece.from, piece.to);
      const id = routeKey("owode", "ado");
      return [money("Owode–Ado route net/day", routeNet(id)), share("road speed", roadSpeed("owode", "ado")), share("road condition", roadCondition("owode", "ado"))];
    },
  },
  {
    name: "fix (maintain) the trunk (Owode–Ado, every piece)",
    pull: (w) => {
      for (const piece of roadPieces(w, "owode", "ado")) setMaintained(w, piece.id, true);
      const id = routeKey("owode", "ado");
      return [money("Owode–Ado route net/day", routeNet(id)), share("road speed", roadSpeed("owode", "ado")), share("road condition", roadCondition("owode", "ado"))];
    },
  },
  {
    name: "add a lorry (Ilase–Kuto: produce in, supplies out)",
    pull: (w) => {
      addLorry(w, "ilase", "kuto");
      const id = w.lorryRoutes[w.lorryRoutes.length - 1]?.id ?? "";
      return [money("lorry route net/day", lorryNet(id))];
    },
  },
  {
    name: "restore the old line + a passenger train (Ilase–Ipaja)",
    pull: (w) => {
      buildTrack(w, "ilase", "ipaja");
      addTrain(w, "ilase", "ipaja");
      const id = w.routes[w.routes.length - 1]?.id ?? "";
      return [money("train route net/day", routeNet(id)), share("Ipaja ring: you", (x) => townShare(x, "ipaja").player)];
    },
  },
  {
    name: "restore the old line + a freight train (Ilase–Ipaja)",
    pull: (w) => {
      buildTrack(w, "ilase", "ipaja");
      addFreightTrain(w, "ilase", "ipaja");
      const id = w.lorryRoutes[w.lorryRoutes.length - 1]?.id ?? "";
      return [money("freight route net/day", lorryNet(id))];
    },
  },
];

const always: Watch[] = [
  money("strip net, last day", (w) => lastDay(w.ledger).net),
  money("(old) net/day average", (w) => computeBurnRate(w.economy).netPerDay),
  share("strip: you", (w) => networkShare(w).player),
  share("strip: informal", (w) => networkShare(w).informal),
];

function stats(values: number[]): { mean: number; std: number } {
  const mean = values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, values.length));
  return { mean, std };
}

const days = (seconds: number) => (seconds / SECONDS_PER_GAME_DAY).toFixed(1);
const fmt = (n: number, unit: Watch["unit"]) => (unit === "₦" ? `${n >= 0 ? "+" : "−"}₦${Math.abs(Math.round(n))}` : `${n >= 0 ? "+" : ""}${n.toFixed(1)}${unit === "pp" ? "pp" : unit === "k" ? "k" : ""}`);

// Determinism check: the whole method rests on it.
{
  const a = baseline();
  const b = baseline();
  run(a, 5 * SECONDS_PER_GAME_DAY);
  run(b, 5 * SECONDS_PER_GAME_DAY);
  if (a.economy.funds !== b.economy.funds) throw new Error(`not deterministic: ${a.economy.funds} vs ${b.economy.funds}`);
}

for (const lever of levers) {
  if (filter && !lever.name.toLowerCase().includes(filter.toLowerCase())) continue;
  const control = baseline();
  const treated = baseline();
  run(control, WARM_DAYS * SECONDS_PER_GAME_DAY);
  run(treated, WARM_DAYS * SECONDS_PER_GAME_DAY);

  const before = treated.economy.funds;
  const watches = [...always, ...lever.pull(treated)];
  const capital = before - treated.economy.funds;

  const samples: Array<{ t: number; diff: number[]; control: number[] }> = [];
  for (let t = SAMPLE_SECONDS; t <= AFTER_DAYS * SECONDS_PER_GAME_DAY; t += SAMPLE_SECONDS) {
    run(control, SAMPLE_SECONDS);
    run(treated, SAMPLE_SECONDS);
    samples.push({ t, diff: watches.map((w) => w.read(treated) - w.read(control)), control: watches.map((w) => w.read(control)) });
  }

  console.log(`\n${lever.name}   (capital ${capital > 0 ? `₦${Math.round(capital)}` : "none"})`);
  console.log(`  ${"number on screen".padEnd(28)} ${"effect".padStart(9)}  ${"visible".padStart(8)}  ${"63%".padStart(8)}  ${"signal".padStart(6)}`);
  const settleFrom = (AFTER_DAYS - 2) * SECONDS_PER_GAME_DAY;
  watches.forEach((watch, i) => {
    const tail = samples.filter((s) => s.t >= settleFrom);
    const effect = stats(tail.map((s) => s.diff[i]!)).mean;
    const noise = stats(tail.map((s) => s.control[i]!)).std;
    const visible = samples.find((s) => Math.abs(s.diff[i]!) >= watch.resolution);
    const reached = Math.abs(effect) >= watch.resolution ? samples.find((s) => Math.sign(s.diff[i]!) === Math.sign(effect) && Math.abs(s.diff[i]!) >= 0.63 * Math.abs(effect)) : undefined;
    const signal = noise > 1e-9 ? Math.abs(effect) / noise : Infinity;
    const settled = Math.abs(effect) >= watch.resolution;
    console.log(
      `  ${watch.label.padEnd(28)} ${(settled ? fmt(effect, watch.unit) : "≈ 0").padStart(9)}  ${(visible ? `${days(visible.t)}d` : "never").padStart(8)}  ${(reached ? `${days(reached.t)}d` : "—").padStart(8)}  ${(settled ? (signal === Infinity ? "clean" : signal.toFixed(1)) : "—").padStart(6)}`,
    );
  });
  const netEffect = stats(samples.filter((s) => s.t >= settleFrom).map((s) => s.diff[0]!)).mean;
  if (capital > 0) console.log(`  payback: ${netEffect > 0 ? `${(capital / netEffect).toFixed(1)} days` : "never, at this rate"}`);
}
