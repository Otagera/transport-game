// Reads a run file saved from the slice ("Save run", src/engine/game/runlog.ts)
// and answers the questions a playtest raises: what was done when, what the
// screen showed day by day, and where the money and the riders went.
//
//   bun scripts/game-run.ts run.json             # timeline, actions, events, the last day
//   bun scripts/game-run.ts run.json --every 5   # a timeline row every 5 days (default 10)
//   bun scripts/game-run.ts run.json --day 120   # one day in full (routes, towns, corridors...)
//   bun scripts/game-run.ts run.json --verify    # replay it and check it reproduces exactly
//
// For anything the day rows don't hold, replayRun (runlog.ts) rebuilds the
// world at any tick: the sim is deterministic.
import { readFileSync } from "node:fs";
import { GAME_MAP } from "../src/game/map";
import { RUN_FORMAT, daySummary, replayRun, type RunDay, type RunFile } from "../src/engine/game/runlog";
import { gameDay } from "../src/engine/game/world";

const [path, ...flags] = process.argv.slice(2);
if (!path) {
  console.error("usage: bun scripts/game-run.ts <run.json> [--every N] [--day N] [--verify]");
  process.exit(2);
}
const file = JSON.parse(readFileSync(path, "utf8")) as RunFile;
if (file.format !== RUN_FORMAT) {
  console.error(`${path} isn't a slice run file (format ${String(file.format)})`);
  process.exit(2);
}
const flag = (name: string) => {
  const i = flags.indexOf(name);
  return i >= 0 ? flags[i + 1] : undefined;
};

const naira = (n: number) => `${n < 0 ? "-" : ""}N${Math.abs(Math.round(n)).toLocaleString()}`;
const num = (n: number) => Math.round(n).toLocaleString();
const pad = (s: string | number, w: number) => String(s).padStart(w);
const pair = (a: string, b: string) => `${a}-${b}`;
const names = new Map(file.days.at(-1)?.towns.map((t) => [t.id, t.name]) ?? []);
const town = (id: string) => names.get(id) ?? id;

function describeAction(action: RunFile["actions"][number]["action"]): string {
  switch (action.kind) {
    case "bus":
    case "minibus":
    case "brt":
    case "lorry":
    case "train":
    case "freight":
      return `${action.kind} ${town(action.a)}-${town(action.b)}`;
    case "road":
    case "track":
      return `${action.kind} ${town(action.a)}-${town(action.b)} (${action.alignment})`;
    case "pave":
    case "lane":
    case "settle":
      return `${action.kind} ${town(action.a)}-${town(action.b)}`;
    case "enforce":
      return `${action.enforcement} enforcement ${town(action.a)}-${town(action.b)}`;
    case "project":
      return `save for ${action.rung} ${town(action.a)}-${town(action.b)}`;
    case "halt":
      return `halt at ${town(action.town)}`;
    case "fix":
      return `${action.on ? "keep up" : "let wear"} ${action.segmentId}`;
    case "retire":
    case "restore":
    case "repair":
      return `${action.kind} ${action.segmentId}`;
    case "dropProject":
      return "drop the named project";
    case "restoreRefinery":
      return "restore the refinery";
    case "sell":
      return `sell on ${action.routeId}`;
  }
}

function describeEvent(event: RunDay["events"][number]): string | null {
  switch (event.kind) {
    case "founded":
      return `town founded: ${event.name}`;
    case "abandoned":
      return `town abandoned: ${event.name}`;
    case "strike-announced":
      return `strike announced ${pair(town(event.a), town(event.b))}`;
    case "strike":
      return `strike ${pair(town(event.a), town(event.b))}`;
    case "strike-over":
      return `strike over ${pair(town(event.a), town(event.b))}${event.cost !== null ? `, cost ${naira(event.cost)}` : ""}`;
    case "strike-called-off":
      return `strike called off ${pair(town(event.a), town(event.b))}`;
    case "project-done":
      return `project built: ${event.rung} ${pair(town(event.a), town(event.b))}`;
    case "project-lapsed":
      return `project lapsed: ${event.rung} ${pair(town(event.a), town(event.b))}, treasury took ${naira(event.taken)}`;
    case "project-affordable":
      return `project affordable: ${event.rung} ${pair(town(event.a), town(event.b))}`;
    case "project-lapse-warning":
      return `project lapse warning: ${event.rung} ${pair(town(event.a), town(event.b))}`;
    case "remitted":
      return event.amount > 0 ? `treasury took ${naira(event.amount)}` : null;
    default:
      return event.kind;
  }
}

function printDay(day: RunDay): void {
  console.log(`\nDay ${day.day}: funds ${naira(day.funds)}, net ${naira(day.netPerDay)}/day, trips made ${num(day.tripsMade)} (yours ${num(day.yourRiders)}, informal ${num(day.informal)}), no road ${num(day.noRoad)}, no seat ${num(day.noSeat)}, people ${day.people >= 0 ? "+" : ""}${day.people}k`);
  console.log("  budget so far: " + Object.entries(day.budget).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${naira(v)}`).join(", "));
  console.log("  routes, worst first:");
  for (const r of day.routes) console.log(`    ${pad(naira(r.netPerDay), 8)}/day  ${r.vehicles} on ${pair(town(r.a), town(r.b))}  ${r.verdict ?? ""}  [${r.id}]`);
  for (const r of day.lorries) console.log(`    ${pad(naira(r.netPerDay), 8)}/day  ${r.vehicles} on ${pair(town(r.a), town(r.b))}  goods  [${r.id}]`);
  console.log("  towns: " + [...day.towns].sort((x, y) => y.population - x.population).map((t) => `${t.name} ${t.population}k`).join(", "));
  const corridors = day.corridors.filter((c) => c.you > 0 || c.taken || c.lane);
  if (corridors.length > 0) {
    console.log("  corridors (you / informal / stayed home):");
    for (const c of corridors) console.log(`    ${pair(town(c.a), town(c.b))}: ${Math.round(c.you * 100)}% / ${Math.round(c.informal * 100)}% / ${Math.round(c.lost * 100)}%${c.taken ? "  TAKEN" : ""}${c.lane ? "  lane" : ""}`);
  }
  if (day.lanes.length > 0) console.log("  lanes: " + day.lanes.map((l) => `${pair(town(l.a), town(l.b))} ${l.enforcement}, ${Math.round(l.encroachment * 100)}% taken by danfos`).join("; "));
  if (day.industries.length > 0) console.log("  industries open: " + day.industries.map((i) => `${i.kind} ${i.id}`).join(", "));
  const events = day.events.map(describeEvent).filter((e): e is string => e !== null);
  if (events.length > 0) console.log("  that day: " + events.join("; "));
}

const last = file.days.at(-1);
const switches = [file.switches.all ? "all systems" : "", file.switches.goodsOff ? "goods off" : "", file.switches.wearOff ? "wear off" : ""].filter(Boolean).join(", ") || "defaults";
console.log(`Run: map ${file.seed} (${switches}), saved ${file.savedAt}, ${file.days.length} days, ${file.actions.length} actions${file.devFunds !== null ? `, dev funds ${naira(file.devFunds)}` : ""}, build ${file.build ?? "not recorded"}${file.tuning ? "" : ", tuning not recorded (replays use today's)"}`);

const dayArg = flag("--day");
if (dayArg !== undefined) {
  const day = file.days.find((d) => d.day === Number(dayArg));
  if (!day) console.error(`no row for day ${dayArg} (days ${file.days[0]?.day}-${last?.day})`);
  else printDay(day);
} else if (flags.includes("--verify")) {
  // Replay and compare every recorded day: equal funds and trips made mean the run reproduces.
  const recorded = new Map(file.days.map((d) => [d.day, d]));
  let lastDay = -1;
  let checked = 0;
  let first: string | null = null;
  replayRun(GAME_MAP, file, file.ticks, (world) => {
    const day = gameDay(world);
    if (lastDay === -1) lastDay = day;
    if (day === lastDay) return;
    const row = daySummary(world, lastDay, []);
    const want = recorded.get(lastDay);
    if (want) {
      checked += 1;
      if (!first && (Math.abs(want.funds - row.funds) > 0.5 || Math.abs(want.tripsMade - row.tripsMade) > 0.5)) {
        first = `day ${lastDay}: recorded funds ${naira(want.funds)}, trips ${num(want.tripsMade)}; replayed ${naira(row.funds)}, ${num(row.tripsMade)}`;
      }
    }
    lastDay = day;
  });
  console.log(first ? `DIVERGES from ${first}` : `Reproduces: ${checked} days replayed, every one matching its recorded row.`);
} else {
  const every = Number(flag("--every") ?? 10);
  console.log(`\n ${pad("day", 4)} ${pad("funds", 10)} ${pad("net/day", 9)} ${pad("trips", 6)} ${pad("yours", 6)} ${pad("informal", 8)} ${pad("no road", 7)} ${pad("no seat", 7)} ${pad("routes", 6)} ${pad("losing", 6)}`);
  for (const d of file.days) {
    if (d.day % every !== 0 && d !== last) continue;
    const losing = d.routes.filter((r) => r.netPerDay < 0).length + d.lorries.filter((r) => r.netPerDay < 0).length;
    console.log(` ${pad(d.day, 4)} ${pad(naira(d.funds), 10)} ${pad(naira(d.netPerDay), 9)} ${pad(num(d.tripsMade), 6)} ${pad(num(d.yourRiders), 6)} ${pad(num(d.informal), 8)} ${pad(num(d.noRoad), 7)} ${pad(num(d.noSeat), 7)} ${pad(d.routes.length + d.lorries.length, 6)} ${pad(losing, 6)}`);
  }
  console.log("\nWhat you did:");
  const byDay = new Map<number, string[]>();
  for (const a of file.actions) byDay.set(a.day, [...(byDay.get(a.day) ?? []), describeAction(a.action)]);
  for (const [day, actions] of byDay) console.log(`  day ${pad(day, 3)}: ${actions.join("; ")}`);
  console.log("\nWhat the game announced:");
  for (const d of file.days) {
    const events = d.events.map(describeEvent).filter((e): e is string => e !== null);
    if (events.length > 0) console.log(`  day ${pad(d.day, 3)}: ${events.join("; ")}`);
  }
  if (last) printDay(last);
}
