// The corridor probe (docs/brief.md, Revision 1, check C1): does a corridor
// you serve well jam again after you upgrade it, and how long does the
// upgrade buy? One corridor, one scripted player, money no object (C1 asks
// about breathing room, not the budget):
//
//   - each day, another bus on the corridor while its buses run full;
//   - when the corridor jams, the next rung (today: dirt -> paved);
//   - a day-by-day line: town sizes and caps, buses, load, the corridor's
//     speed, "no seat" along it, danfos on it.
//
// A jam: the corridor's slowest piece averages under JAM_SPEED of free flow
// over a whole day, or "no seat" along it is over JAM_NO_SEAT of the trips
// along it. Usage: bun scripts/corridor-probe.ts [days=120] [a=ilase] [b=owode]
//   SLICE_TUNING='{"...":...}' overrides tuning, as the bots do.
import { SLICE_MAP } from "../src/slice/map";
import { startSliceGame } from "../src/engine/slice/start";
import { sliceTick } from "../src/engine/slice/tick";
import { addBus, findRoute, paveRoad, roadChain } from "../src/engine/slice/world";
import { townGrowth } from "../src/engine/slice/growth";
import { isDirt } from "../src/engine/slice/congestion";
import { DEFAULT_SLICE_TUNING } from "../src/engine/slice/tuning";
import type { SliceWorld } from "../src/engine/slice/types";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY } from "../src/engine/economy/state";

const DAYS = Number(process.argv[2] ?? 120);
const A = process.argv[3] ?? "ilase";
const B = process.argv[4] ?? "owode";
const JAM_SPEED = Number(process.env.JAM_SPEED ?? 0.7);
const JAM_NO_SEAT = Number(process.env.JAM_NO_SEAT ?? 0.25);
const FULL = 0.85;
const MAX_BUSES = Number(process.env.MAX_BUSES ?? 16);

const tuning = { ...DEFAULT_SLICE_TUNING, ...JSON.parse(process.env.SLICE_TUNING ?? "{}") };
const world = startSliceGame(SLICE_MAP, tuning);
world.tuning.remittanceEnabled = false;

const chain = () => roadChain(world, A, B) ?? [];
const corridorTowns = (): Set<string> => {
  const towns = new Set<string>([A, B]);
  for (const piece of chain()) {
    towns.add(piece.fromNodeId);
    towns.add(piece.toNodeId);
  }
  return towns;
};

/** Trips a day along the corridor (both ends on it): made, and no seat. */
function along(w: SliceWorld): { made: number; noSeat: number } {
  const towns = corridorTowns();
  let made = 0;
  let noSeat = 0;
  for (const [key, rates] of w.pairOutcomes) {
    const [x, y] = key.split(":") as [string, string];
    if (!towns.has(x) || !towns.has(y)) continue; // both on the corridor: it joins them
    made += rates.player + rates.poached + rates.gaveUp;
    noSeat += rates.lost;
  }
  return { made: made * SECONDS_PER_GAME_DAY, noSeat: noSeat * SECONDS_PER_GAME_DAY };
}

const rung = () => (chain().every((piece) => !isDirt(piece)) ? "paved" : "dirt");
const ticks = Math.round(SECONDS_PER_GAME_DAY / SIM_DT);
const rungs: Array<{ day: number; rung: string }> = [{ day: 1, rung: rung() }];
const jams: number[] = [];
let jammedYesterday = false;

console.log(`Corridor ${A}-${B}: jam = slowest piece under ${JAM_SPEED} of free flow for a day, or no seat over ${JAM_NO_SEAT * 100}% of trips along it`);
console.log("day  rung   " + [...corridorTowns()].map((t) => `${t.padEnd(9)} cap  `).join("") + "buses load  speed  along  noSeat  danfos");
for (let day = 1; day <= DAYS; day += 1) {
  world.economy.funds = 1e9;
  let slowSum = 0;
  let danfoSum = 0;
  for (let i = 0; i < ticks; i += 1) {
    sliceTick(world, SIM_DT);
    const pieces = chain();
    slowSum += Math.min(...pieces.map((piece) => world.segmentSpeed.get(piece.id) ?? 1));
    // Danfos on the corridor right now, by their current segment.
    if (i % 30 === 0) {
      const ids = new Set(pieces.map((piece) => piece.id));
      danfoSum += [...world.vehicleSegment.values()].filter((leg) => ids.has(leg.split("#")[0]!)).length;
    }
  }
  const speed = slowSum / ticks;
  const { made, noSeat } = along(world);
  const route = findRoute(world, A, B);
  const load = route?.loadFactorEMA ?? 0;
  const jammed = speed < JAM_SPEED || noSeat > JAM_NO_SEAT * (made + noSeat);
  const sizes = [...corridorTowns()]
    .map((t) => {
      const town = world.towns.get(t);
      const growth = townGrowth(world, t);
      return `${String(Math.round(town?.population ?? 0)).padStart(4)}k ${String(Math.round(growth?.cap ?? 0)).padStart(4)}k  `;
    })
    .join("");
  console.log(
    `${String(day).padStart(3)}  ${rung().padEnd(6)} ${sizes}${String(route?.vehicleIds.length ?? 0).padStart(5)} ${load.toFixed(2)}  ${speed.toFixed(2)}  ${String(Math.round(made)).padStart(5)}  ${String(Math.round(noSeat)).padStart(6)}  ${(danfoSum / (ticks / 30)).toFixed(1).padStart(6)}${jammed ? "  JAM" : ""}`,
  );
  if (jammed && !jammedYesterday) jams.push(day);
  jammedYesterday = jammed;
  // The scripted player: the next rung on a jam, else another bus while they run full.
  if (jammed && rung() === "dirt" && process.env.NO_PAVE !== "1") {
    if (paveRoad(world, A, B).ok) rungs.push({ day, rung: "paved" });
  } else if ((load > FULL || !route) && (route?.vehicleIds.length ?? 0) < MAX_BUSES) addBus(world, A, B);
}

console.log(`\nRungs: ${rungs.map((r) => `${r.rung} day ${r.day}`).join(", ")}`);
console.log(`Jams began: ${jams.length ? jams.map((d) => `day ${d}`).join(", ") : "never"}`);
for (const r of rungs.slice(1)) {
  const next = jams.find((d) => d > r.day + 1);
  console.log(`C1: ${r.rung} on day ${r.day} held ${next ? `${next - r.day} days` : `past day ${DAYS}`} before the next jam (target 20-40)`);
}
