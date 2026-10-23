// Play the slice from a terminal: the screen as text in, moves out (docs/brief.md,
// Revision 4: "an OpenCode player"). A cheap model -- or anyone -- can play a game
// one command at a time, and the game is saved as an ordinary run file for review
// (scripts/slice-run.ts reads it; the replay is exact).
//
//   bun scripts/slice-play.ts new <dir> [seed]      start a game in <dir> (a generated map; seed 0 is the hand-made one)
//   bun scripts/slice-play.ts state <dir>           what the screen shows now, each line with the move it names
//   bun scripts/slice-play.ts act <dir> '<json>'    make a move, e.g. '{"kind":"bus","a":"ilase","b":"owode"}'
//   bun scripts/slice-play.ts advance <dir> [days]  play on (default 1 day) and say what happened
//   bun scripts/slice-play.ts help                  every kind of move, with its shape
//
// <dir> holds run.json (the run file) and world.bin (a snapshot, so a command
// never replays from the start).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { serialize, deserialize } from "node:v8";
import { SLICE_MAP } from "../src/slice/map";
import { createRunRecorder, recordAction, recordTick, runFile, startRun, type RunRecorder } from "../src/engine/slice/runlog";
import { applyAction, type ActionSpec } from "../src/engine/slice/actions";
import { sliceTick } from "../src/engine/slice/tick";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "../src/engine/economy/state";
import { gameDay, headline, isCutOff, routeSummaries, diagnoseRoute, tripsFrom } from "../src/engine/slice/world";
import { averageNet } from "../src/engine/slice/history";
import { namedMoves, noSeatPairs } from "../src/engine/slice/problems";
import { growthTrend, roadFull, townGrowth } from "../src/engine/slice/growth";
import { rungPrice } from "../src/engine/slice/project";
import { fuelSupply } from "../src/engine/slice/fuel";
import { cementServed } from "../src/engine/slice/cement";
import { marketFed, foodWant } from "../src/engine/slice/food";
import { siteProduction } from "../src/engine/slice/production";
import { expandCost } from "../src/engine/slice/expand";
import { checkBond, bondAmount, bondPerDay } from "../src/engine/slice/bonds";
import { carryOver, sweepDue } from "../src/engine/slice/sweep";
import type { SliceWorld } from "../src/engine/slice/types";
import { yardGain } from "../src/engine/slice/yards";
import { parkLevyGain, parkReport } from "../src/engine/slice/parks";
import { checkMetro, metroLines, metroPrice, metroRiders } from "../src/engine/slice/metro";

interface Saved {
  world: SliceWorld;
  recorder: RunRecorder;
}

const ticksPerDay = Math.round(D / SIM_DT);
const k = (n: number) => `₦${Math.round(n).toLocaleString()}`;
const pc = (x: number) => `${Math.round(x * 100)}%`;
const j = (a: ActionSpec) => JSON.stringify(a);

function load(dir: string): Saved {
  if (!existsSync(join(dir, "world.bin"))) throw new Error(`no game in ${dir}: start one with "new ${dir}"`);
  return deserialize(readFileSync(join(dir, "world.bin"))) as Saved;
}

function save(dir: string, saved: Saved): void {
  writeFileSync(join(dir, "world.bin"), serialize(saved));
  writeFileSync(join(dir, "run.json"), JSON.stringify(runFile(saved.recorder)));
}

const name = (w: SliceWorld, id: string) => w.towns.get(id)?.name ?? id;

/** What the screen shows, as text: each problem with the move that answers it, as JSON to send. */
function state(w: SliceWorld): string {
  const out: string[] = [];
  const h = headline(w);
  out.push(`DAY ${gameDay(w)} · money ${k(w.economy.funds)} · net ${k(averageNet(w))}/day (5-day average) · trips made ${Math.round(h.tripsPerDay)}/day, yours ${Math.round(h.yourRidersPerDay)} · no road ${Math.round(h.noRoadPerDay)} · no seat ${Math.round(h.noSeatPerDay)}`);
  if (w.tuning.sweepEnabled) {
    const due = sweepDue(w);
    out.push(`Budget year ends day ${gameDay(w, w.sweep.endsAtSeconds)}: you may carry over ${k(carryOver(w))}${due >= 1 ? `; ${k(due)} above it goes back to the treasury unless you spend it or name a project` : ""}.`);
  }
  for (const bond of w.bonds.filter((b) => b.owed > 0.5)) out.push(`Bond: ${bond.label}, ${k(bond.owed)} left at ${k(bond.perDay)}/day.`);
  if (w.project) out.push(`Saving for: the ${w.project.rung} on ${name(w, w.project.a)}–${name(w, w.project.b)}, price ${k(w.project.price)}.`);

  out.push("", "TOWNS (id: name, size, trend; what it expects of you; its supplies)");
  for (const id of [...w.basePopulation.keys()].sort((a, b) => w.towns.get(b)!.population - w.towns.get(a)!.population)) {
    const t = w.towns.get(id)!;
    const g = townGrowth(w, id);
    const bits = [`${t.name} ${Math.round(t.population)}k ${growthTrend(w, id)}`];
    if (isCutOff(w, id)) bits.push("NO ROAD");
    if (g) bits.push(`you carry ${pc(g.playerShare)} of its trips${g.expected > 0 ? ` (it expects ${pc(g.expected)})` : ""}`);
    if (g && g.cementHeld > 2) bits.push(`cement ${pc(cementServed(w, id))}, holding back ${Math.round(g.cementHeld)}k people`);
    const fuel = fuelSupply(w, id);
    if (fuel && fuel.supplied < 0.6) bits.push(`fuel ${pc(fuel.supplied)}`);
    if (foodWant(w, id) > 0) bits.push(`market fed ${pc(marketFed(w, id))}`);
    const full = roadFull(w, id);
    if (full?.road && !full.thin) {
      const rung = full.next;
      const price = rung === "paved" ? null : rungPrice(w, full.road.a, full.road.b, rung);
      bits.push(`ITS ROAD IS FULL: next rung ${rung}${price ? ` (${k(price)})` : ""}`);
    }
    const park = parkReport(w, id);
    if (park) bits.push(`motor park: roads into it at ${pc(park.roadSpeed)} speed, levy ${k(park.yours)}/day to you (agberos ${k(park.agberos)}, would keep ${k(park.agberosWithout)} without it)`);
    else if (w.tuning.parksEnabled) bits.push(`a park here: ~+${k(parkLevyGain(w, id))}/day levy, roads into it +${pc(w.tuning.parkCapacityBoost)} capacity -- ${j({ kind: "park", townId: id })}`);
    const lines = metroLines(w, id);
    if (lines > 0) bits.push(`metro ${lines} line(s), ${Math.round(metroRiders(w, id).riders)} riders/day`);
    if (checkMetro(w, id).ok || (lines < w.tuning.metroMaxLines && t.population >= w.tuning.metroMinPopulation && w.tuning.metroEnabled)) bits.push(`${lines === 0 ? "a metro" : "another metro line"} ${k(metroPrice(w, id))}: ~${Math.round(w.tuning.metroLineShare * t.population * w.tuning.localTripsPerThousandPerDay)} riders/day -- ${j({ kind: "metro", townId: id })}`);
    out.push(`  ${id}: ${bits.join(" · ")}`);
  }
  const roadside = [...w.towns.values()].filter((t) => !t.industry && !w.basePopulation.has(t.id));
  if (roadside.length) out.push(`  roadside towns: ${roadside.map((t) => `${t.id} (${t.name} ${Math.round(t.population)}k)`).join(", ")}`);

  out.push("", "YOUR ROUTES (worst first: net a day, and what its card says)");
  const routes = routeSummaries(w);
  if (routes.length === 0) out.push("  none yet");
  for (const r of routes) {
    const d = diagnoseRoute(w, r.id);
    out.push(`  ${r.id}: ${r.buses} vehicle(s), net ${k(r.netPerDay)}/day, ${d?.verdict ?? "?"}${d ? `, ${Math.round(d.boardingsPerDay)} riders/day, ${pc(d.loadFactor)} full` : ""} -- sell one: ${j({ kind: "sell", routeId: r.id })}`);
  }

  out.push("", "WHAT THE SCREEN NAMES (each with its price and its move)");
  for (const m of namedMoves(w).sort((a, b) => a.price - b.price).slice(0, 12)) out.push(`  ${m.label} · ${k(m.price)} -- ${j(m.action)}`);
  for (const p of noSeatPairs(w).slice(0, 5)) out.push(`  ${Math.round(p.perDay)} a day find no seat between ${name(w, p.a)} and ${name(w, p.b)} -- e.g. ${j({ kind: "bus", a: p.a, b: p.b })}`);

  out.push("", "SITES (what each makes against what it could, and what holds it back)");
  for (const s of [...w.towns.values()].filter((t) => t.industry)) {
    const p = siteProduction(w, s.id);
    const moves: string[] = [];
    if (s.industry === "refinery" && w.fuel && !w.fuel.restored) {
      moves.push(`restore ${k(w.tuning.refineryRestoreCost)}: ${j({ kind: "restoreRefinery" })}`);
      if (checkBond(w, "refinery").ok) moves.push(`or borrow ${k(bondAmount(w, "refinery")!)} (repay ${k(bondPerDay(w, bondAmount(w, "refinery")!))}/day): ${j({ kind: "bond", purpose: "refinery" })}`);
    }
    if (s.industry === "works" && w.cement && !w.cement.working) moves.push(`restore ${k(w.tuning.worksRestoreCost)}: ${j({ kind: "restoreWorks" })}`);
    const cost = expandCost(w, s.id);
    if (cost !== null && p?.limit === "capacity") moves.push(`expand ${k(cost)}: ${j({ kind: "expand", siteId: s.id })}`);
    if (w.tuning.yardsEnabled && !w.yards.has(s.id)) moves.push(`haulage yard ${k(w.tuning.yardCost)} (~${Math.round(yardGain(w, s.id))} t/day wait here within its reach): ${j({ kind: "yard", townId: s.id })}`);
    const line = p && p.capacity > 0
      ? `${p.limit === "idle" ? "idle" : `makes ${Math.round(p.made * D)} of ${Math.round(p.capacity * D)} t ${p.product}/day`}${p.inputs.map((i) => `, ${i.name} in ${Math.round(i.arriving * D)} of ${Math.round(i.needed * D)}`).join("")}${p.staffing !== null ? `, workers ${pc(p.staffing)}` : ""}, carried away ${pc(p.shipped)}${p.limit !== "capacity" && p.limit !== "idle" ? ` -- held back by its ${p.limit}` : ""}`
      : "";
    out.push(`  ${s.id}: ${s.name} (${s.industry})${isCutOff(w, s.id) ? " NO ROAD" : ""}${w.yards.has(s.id) ? " [yard]" : ""} ${line}${moves.length ? `\n      moves: ${moves.join(" | ")}` : ""}`);
  }
  return out.join("\n");
}

const HELP = `Moves (send one as JSON with "act"). Town and site ids are in "state".
  {"kind":"road","a":ID,"b":ID,"alignment":"cheapest"}   build a dirt road between two towns or sites
  {"kind":"pave","a":ID,"b":ID}                          pave the road joining them
  {"kind":"lane","a":ID,"b":ID}                          a bus lane on a paved road (then BRT buses: 80 seats, worth it only where ~240+ riders a day want trips along it)
  {"kind":"bus"|"minibus"|"brt","a":ID,"b":ID}            a vehicle on a route (adds one if the route exists)
  {"kind":"sell","routeId":ROUTE_ID}                     sell a route's newest vehicle
  {"kind":"track","a":ID,"b":ID,"alignment":"cheapest"}  lay railway track
  {"kind":"train"|"freight","a":ID,"b":ID}               a passenger or freight train on track
  {"kind":"fix","segmentId":SEGMENT_ID,"on":true}        keep a road up (from the moves the screen names)
  {"kind":"yard","townId":ID}                            a haulage yard: hauliers reach further from here
  {"kind":"metro","townId":ID}                           a metro in a big town (200k+), or another line: carries its inside trips
  {"kind":"park","townId":ID}                            a motor park: danfos load off the road (roads into the town carry more), and pay you more of their levy
  {"kind":"restoreRefinery"} {"kind":"restoreWorks"}     restore an idle site
  {"kind":"expand","siteId":ID}                          another line at a site at capacity
  {"kind":"project","a":ID,"b":ID,"rung":"lane"|"rail"}  name what you're saving for (safe from the year-end sweep)
  {"kind":"bond","purpose":"refinery"|"works"|"project"} borrow for it, repaid daily with interest
How to play: read "state", make a few moves with "act", then "advance <dir> 5" and read what changed. Money is a budget; the score is trips made and towns grown.`;

function main(): void {
  const [cmd, dir, arg] = process.argv.slice(2);
  if (!cmd || cmd === "help") return void console.log(HELP);
  if (!dir) throw new Error("which game? give its folder");
  if (cmd === "new") {
    mkdirSync(dir, { recursive: true });
    const seed = Number(arg ?? Math.floor(Math.random() * 9000) + 1);
    const switches = { all: false, goodsOff: false, wearOff: false };
    const world = startRun(SLICE_MAP, seed, switches, null);
    const saved = { world, recorder: createRunRecorder(world, seed, switches, null, "slice-play") };
    save(dir, saved);
    console.log(`New game: map ${seed}, in ${dir}.\n\n${state(world)}\n\n${HELP}`);
    return;
  }
  const saved = load(dir);
  const { world, recorder } = saved;
  if (cmd === "state") return void console.log(state(world));
  if (cmd === "act") {
    const action = JSON.parse(arg ?? "") as ActionSpec;
    const result = applyAction(world, action);
    if (result.ok) recordAction(recorder, world, action);
    save(dir, saved);
    console.log(result.ok ? `Done${result.amount ? ` (${k(result.amount)})` : ""}. Money now ${k(world.economy.funds)}.` : `Refused: ${result.reason}`);
    return;
  }
  if (cmd === "advance") {
    const days = Math.max(1, Math.min(30, Number(arg ?? 1)));
    const said: string[] = [];
    for (let i = 0; i < days * ticksPerDay; i += 1) {
      const events = sliceTick(world, SIM_DT);
      recordTick(recorder, world, events);
      for (const e of events) if (e.kind !== "remitted" && !(e.kind === "swept" && e.amount < 1)) said.push(`day ${gameDay(world)}: ${JSON.stringify(e)}`);
    }
    save(dir, saved);
    console.log(`${said.length ? said.slice(-15).join("\n") + "\n\n" : ""}${state(world)}`);
    return;
  }
  throw new Error(`unknown command "${cmd}" (new, state, act, advance, help)`);
}

main();
