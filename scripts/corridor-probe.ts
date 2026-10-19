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
// A jam, judged by its consequences, not by speed (brief C1, 2026-10-19):
// since the last rung settled (3 days), the share of trips along the
// corridor with no seat has risen JAM_RISE above its low for two days
// running, or the corridor's two end towns together have fallen JAM_FALL
// below their peak. (A speed rule sat on a knife edge: a lane settled just
// above it while its towns shrank.)
// Usage: bun scripts/corridor-probe.ts [days=120] [a=ilase] [b=owode]
//   LAX=1 leaves the lane laxly enforced from the start.
//   BRT=1: once the lane is in, the player adds BRT buses (80 seats, lane
//   only) while they run full, instead of buses.
//   WINDOW=66-105 prints trips made, "no seat" along the corridor and your
//   money averaged over those days: run once with NO_LANE=1 and once with
//   the lane for a twin that never got it (deterministic up to the lane).
//   SLICE_TUNING='{"...":...}' overrides tuning, as the bots do.
import { SLICE_MAP } from "../src/slice/map";
import { startSliceGame } from "../src/engine/slice/start";
import { sliceTick } from "../src/engine/slice/tick";
import { addBrt, addBus, addBusLane, brtRouteId, findRoute, paveRoad, removeBus, roadChain, routeKey, routeSummaries } from "../src/engine/slice/world";
import { roadFull, townGrowth } from "../src/engine/slice/growth";
import { isDirt } from "../src/engine/slice/congestion";
import { DEFAULT_SLICE_TUNING } from "../src/engine/slice/tuning";
import { tollFor } from "../src/engine/slice/budget";
import { informalSpec } from "../src/engine/slice/tick";
import { setEnforcement } from "../src/engine/slice/pushback";
import { addTrain, buildTrack, railPath, railRouteId } from "../src/engine/slice/rail";
import type { SliceWorld } from "../src/engine/slice/types";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY } from "../src/engine/economy/state";

const DAYS = Number(process.argv[2] ?? 120);
const A = process.argv[3] ?? "ilase";
const B = process.argv[4] ?? "owode";
const JAM_RISE = Number(process.env.JAM_RISE ?? 0.1);
const JAM_FALL = Number(process.env.JAM_FALL ?? 0.05);
const SETTLE_DAYS = 3;
const FULL = 0.85;
const MAX_BUSES = Number(process.env.MAX_BUSES ?? 30);

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

const rung = () =>
  railDay ? "rail" : chain().every((piece) => piece.busLane) ? "lane" : chain().every((piece) => !isDirt(piece)) ? "paved" : "dirt";
// Rail, the top rung: new track along the corridor and trains on it, while they run full.
let railDay = 0;

// C3: from the day a lane opens, a twin without it (the same buses bought in
// both), for 10 days: the lane's tolls and levies against the twin's, and
// when the first strike comes.
const C3_DAYS = 10;
let twin: SliceWorld | null = null;
let laneDay = 0;
let strikeDay: number | null = null;
// The corridor's own takings: tolls and your share of levies from informal
// departures whose path runs along it, counted as they set off. The whole
// network's would mix in the lane's bigger towns' levies everywhere.
const corridorTakings = new WeakMap<SliceWorld, { seen: Set<string>; total: number }>();
function countTakings(w: SliceWorld): void {
  let tally = corridorTakings.get(w);
  if (!tally) corridorTakings.set(w, (tally = { seen: new Set(w.informal.active.keys()), total: 0 }));
  const ids = new Set(chainOf(w).map((piece) => piece.id));
  for (const [id, trip] of w.informal.active) {
    if (tally.seen.has(id)) continue;
    tally.seen.add(id);
    if (!trip.segmentIds.some((segmentId) => ids.has(segmentId))) continue;
    const spec = informalSpec(w.tuning, trip.mode);
    tally.total += tollFor(w, trip.segmentIds, spec.weight) + w.tuning.levyPerSeat * spec.capacity * (1 - w.tuning.agberoCut);
  }
}
const chainOf = (w: SliceWorld) => roadChain(w, A, B) ?? [];
const takings = (w: SliceWorld) => corridorTakings.get(w)?.total ?? 0;
let c3: { lane: number; twin: number } | null = null;
let corridorNet = 0;
// C3 (2026-10-19: each enforcement choice wins somewhere): your money and
// the trips along the corridor over the lane's first ENFORCE_DAYS days.
const ENFORCE_DAYS = Number(process.env.ENFORCE_DAYS ?? 40);
let laneMoney = 0;
let laneTrips = 0;
const [windowFrom, windowTo] = (process.env.WINDOW ?? "0-0").split("-").map(Number) as [number, number];
const windowStats = { days: 0, made: 0, noSeat: 0, money: 0 };
// Strike days: does a strike cost you money, or earn it (riders flood your
// buses)? At each strike, a twin with the strike called off, the same buses
// in both, for the strike day and the day after: your money in each.
let strikeTwin: SliceWorld | null = null;
let strikeTwinDays = 0;
let strikeGain = { struck: 0, calm: 0 };
const strikeMoney: Array<{ day: number; struck: number; calm: number }> = [];
/** The game's own estimate of each strike's cost (pushback.ts), to set beside the twin's. */
const estimates: number[] = [];
let c3Start: { lane: number; twin: number } | null = null;
const ticks = Math.round(SECONDS_PER_GAME_DAY / SIM_DT);
const rungs: Array<{ day: number; rung: string }> = [{ day: 1, rung: rung() }];
function newRung(day: number, name: string): void {
  rungs.push({ day, rung: name });
  rungDay = day;
  lowShare = Infinity;
  peakTowns = 0;
  risenDays = 0;
  townsHistory = [];
}
const jams: number[] = [];
let jammedYesterday = false;
// Since the last rung: the lowest no-seat share (after settling), the end towns' peak, days risen.
let rungDay = 1;
let lowShare = Infinity;
let peakTowns = 0;
let risenDays = 0;
// A plateau: the end towns grew under 1% over the last 5 days -- the rung's
// room is used up, jam or not. The scripted player climbs on either.
const PLATEAU_DAYS = 5;
const PLATEAU_GROWTH = 0.01;
let townsHistory: number[] = [];
const plateaus: Array<{ rung: string; day: number }> = [];

console.log(`Corridor ${A}-${B}: jam = no-seat share ${JAM_RISE * 100}pp over its low since the rung for 2 days, or the end towns ${JAM_FALL * 100}% below their peak`);
console.log("day  rung   " + [...corridorTowns()].map((t) => `${t.padEnd(9)} cap  `).join("") + "buses load  speed  along  noSeat  danfos");
for (let day = 1; day <= DAYS; day += 1) {
  world.economy.funds = 1e9;
  let slowSum = 0;
  let danfoSum = 0;
  // A strike begins within this day: twin the world with it called off.
  const now = world.economy.elapsedSeconds;
  const strikesToday = world.lanes.some((lane) => lane.strikeAt > now && lane.strikeAt <= now + SECONDS_PER_GAME_DAY);
  if (!strikeTwin && strikesToday) {
    strikeTwin = structuredClone(world);
    for (const lane of strikeTwin.lanes) {
      lane.strikeAt = 0;
      lane.grievance = -1e9;
    }
    strikeTwinDays = 0;
    strikeGain = { struck: 0, calm: 0 };
  }
  const fundsAtDayStart = world.economy.funds;
  if (strikeTwin) strikeTwin.economy.funds = 1e9;
  const twinning = twin !== null && day <= laneDay + C3_DAYS;
  if (twinning) twin!.economy.funds = 1e9;
  for (let i = 0; i < ticks; i += 1) {
    for (const event of sliceTick(world, SIM_DT)) {
      if (event.kind === "strike" && strikeDay === null) strikeDay = day;
      if (event.kind === "strike-over") estimates.push(event.cost === null ? NaN : Math.round(event.cost));
    }
    if (strikeTwin) sliceTick(strikeTwin, SIM_DT);
    if (twinning) {
      sliceTick(twin!, SIM_DT);
      countTakings(world);
      countTakings(twin!);
    }
    const pieces = chain();
    // On a bus lane your buses run free of the traffic: there, the jam is in their own speed.
    slowSum += rung() === "lane" ? (findRoute(world, A, B)?.speedEMA ?? 1) : Math.min(...pieces.map((piece) => world.segmentSpeed.get(piece.id) ?? 1));
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
  const share = noSeat / Math.max(1, made + noSeat);
  const endTowns = (world.towns.get(A)?.population ?? 0) + (world.towns.get(B)?.population ?? 0);
  peakTowns = Math.max(peakTowns, endTowns);
  if (day >= rungDay + SETTLE_DAYS) lowShare = Math.min(lowShare, share);
  risenDays = share >= lowShare + JAM_RISE ? risenDays + 1 : 0;
  const jammed = risenDays >= 2 || endTowns < peakTowns * (1 - JAM_FALL);
  townsHistory.push(endTowns);
  const back = townsHistory[townsHistory.length - 1 - PLATEAU_DAYS];
  const plateau = day >= rungDay + PLATEAU_DAYS && back !== undefined && endTowns < back * (1 + PLATEAU_GROWTH);
  if (plateau && !plateaus.some((p) => p.rung === rung() && p.day >= rungDay)) plateaus.push({ rung: rung(), day });
  const sizes = [...corridorTowns()]
    .map((t) => {
      const town = world.towns.get(t);
      const growth = townGrowth(world, t);
      return `${String(Math.round(town?.population ?? 0)).padStart(4)}k ${String(Math.round(growth?.cap ?? 0)).padStart(4)}k  `;
    })
    .join("");
  console.log(
    `${String(day).padStart(3)}  ${rung().padEnd(6)} ${sizes}${String(route?.vehicleIds.length ?? 0).padStart(5)} ${load.toFixed(2)}  ${speed.toFixed(2)}  ${String(Math.round(made)).padStart(5)}  ${String(Math.round(noSeat)).padStart(6)}  ${(danfoSum / (ticks / 30)).toFixed(1).padStart(6)}${jammed ? "  JAM" : ""}${roadFull(world, A) || roadFull(world, B) ? "  FULL" : ""}`,
  );
  if (jammed && !jammedYesterday) jams.push(day);
  jammedYesterday = jammed;
  // The scripted player: the next rung on a jam, else another bus while they run full.
  if (day >= windowFrom && day <= windowTo) {
    windowStats.days += 1;
    windowStats.made += made;
    windowStats.noSeat += noSeat;
    windowStats.money += world.economy.funds - fundsAtDayStart;
  }
  if (laneDay && day > laneDay && day <= laneDay + ENFORCE_DAYS) {
    laneMoney += world.economy.funds - fundsAtDayStart;
    laneTrips += made / ENFORCE_DAYS;
  }
  if (strikeTwin) {
    strikeGain.struck += world.economy.funds - fundsAtDayStart;
    strikeGain.calm += strikeTwin.economy.funds - 1e9;
    strikeTwinDays += 1;
    if (strikeTwinDays === world.tuning.strikeDays + 1) {
      strikeMoney.push({ day: day - world.tuning.strikeDays, ...strikeGain });
      strikeTwin = null;
    }
  }
  if (twin && day === laneDay + C3_DAYS) {
    c3 = { lane: (takings(world) - c3Start!.lane) / C3_DAYS, twin: (takings(twin) - c3Start!.twin) / C3_DAYS };
    // The corridor's net a day: your route on it (fares less running costs) plus its takings.
    const routeNet = routeSummaries(world).find((r) => r.id === findRoute(world, A, B)?.id)?.netPerDay ?? 0;
    corridorNet = routeNet + c3.lane;
    twin = null;
  }
  const climb = jammed || plateau;
  if (climb && rung() === "dirt" && process.env.NO_PAVE !== "1") {
    if (paveRoad(world, A, B).ok) newRung(day, "paved");
  } else if (climb && rung() === "paved" && process.env.NO_LANE !== "1" && !laneDay) {
    const before = structuredClone(world);
    countTakings(world);
    countTakings(before);
    if (addBusLane(world, A, B).ok) {
      newRung(day, "lane");
      // Lanes open lax; the probe's default player enforces strictly (LAX=1 leaves it).
      setEnforcement(world, A, B, process.env.LAX === "1" ? "lax" : "strict");
      // BRT=1: the corridor's buses are sold and BRT buses bought with as many seats.
      if (process.env.BRT === "1") {
        const buses = findRoute(world, A, B)?.vehicleIds.length ?? 0;
        while (removeBus(world, routeKey(A, B)) > 0) {}
        for (let i = 0; i < Math.ceil((buses * world.tuning.busCapacity) / world.tuning.brtCapacity); i += 1) addBrt(world, A, B);
      }
      twin = before;
      laneDay = day;
      c3Start = { lane: takings(world), twin: takings(twin) };
    }
  } else if (climb && rung() === "lane" && process.env.NO_RAIL !== "1" && !railDay) {
    if (buildTrack(world, A, B, "cheapest").ok && railPath(world, A, B) && addTrain(world, A, B).ok) {
      railDay = day;
      newRung(day, "rail");
    }
  } else if (railDay && (world.routes.find((r) => r.id === railRouteId(A, B))?.loadFactorEMA ?? 0) > FULL) {
    const trains = world.routes.find((r) => r.id === railRouteId(A, B))?.vehicleIds.length ?? 0;
    if (trains < MAX_BUSES) addTrain(world, A, B);
  } else if (process.env.BRT === "1" && laneDay) {
    // BRT buses, while they run full (the buses already bought stay).
    const brt = world.routes.find((r) => r.id === brtRouteId(A, B));
    if ((!brt || brt.loadFactorEMA > FULL) && (brt?.vehicleIds.length ?? 0) < MAX_BUSES) addBrt(world, A, B);
  } else if ((load > FULL || !route) && (route?.vehicleIds.length ?? 0) < MAX_BUSES) {
    addBus(world, A, B);
    if (twin && day < laneDay + C3_DAYS) addBus(twin, A, B);
    if (strikeTwin) addBus(strikeTwin, A, B);
  }
}

console.log(`\nRungs: ${rungs.map((r) => `${r.rung} day ${r.day}`).join(", ")}`);
console.log(`Jams began: ${jams.length ? jams.map((d) => `day ${d}`).join(", ") : "never"}`);
for (const r of rungs) {
  const next = jams.find((d) => d > r.day + 1);
  const flat = plateaus.find((p) => p.rung === r.rung && p.day > r.day);
  console.log(`C1: ${r.rung} from day ${r.day}: towns grew ${flat ? `${flat.day - r.day} days before levelling off` : `past day ${DAYS}`}; ${next ? `jammed after ${next - r.day} days` : `no jam by day ${DAYS}`} (target 20-40)`);
}
if (laneDay) {
  console.log(`C3: tolls and levies a day over the lane's first ${C3_DAYS} days: ${c3 ? `${c3.lane.toFixed(0)} with the lane against ${c3.twin.toFixed(0)} without (${c3.lane < c3.twin ? "lower" : "NOT lower"}, ${Math.round(c3.twin - c3.lane)} a day = ${Math.round(((c3.twin - c3.lane) / corridorNet) * 100)}% of the corridor's net ${Math.round(corridorNet)} a day)` : "not measured (ran out of days)"}; first strike ${strikeDay === null ? "never" : `day ${strikeDay}, ${strikeDay - laneDay} days after the lane`} (C3: within 10)`);
}
for (const [i, s] of strikeMoney.entries()) {
  const diff = s.struck - s.calm;
  if (estimates[i] !== undefined) console.log(`  (the game's estimate of that strike: ${estimates[i]})`);
  console.log(`Strike from day ${s.day}: your money over it (${world.tuning.strikeDays} days) and the day after ${Math.round(s.struck)} against ${Math.round(s.calm)} without it: ${diff < 0 ? `costs you ${Math.round(-diff)}` : `EARNS you ${Math.round(diff)}`}`);
}
if (laneDay) {
  const kept = laneDay + ENFORCE_DAYS <= DAYS;
  console.log(`Enforcement ${process.env.LAX === "1" ? "lax" : "strict"}: over the lane's first ${ENFORCE_DAYS} days, your money ${Math.round(laneMoney)}, trips along the corridor ${Math.round(laneTrips)} a day${kept ? "" : " (ran out of days)"}`);
}
if (windowStats.days > 0) {
  const n = windowStats.days;
  console.log(`Window days ${windowFrom}-${windowTo}: trips made along the corridor ${Math.round(windowStats.made / n)} a day, no seat ${Math.round(windowStats.noSeat / n)} a day, your money ${Math.round(windowStats.money / n)} a day`);
  const brt = world.routes.find((r) => r.id === brtRouteId(A, B));
  console.log(`  at the end: ${findRoute(world, A, B)?.vehicleIds.length ?? 0} buses${brt ? `, ${brt.vehicleIds.length} BRT buses (${Math.round(brt.loadFactorEMA * 100)}% full)` : ""}`);
}
