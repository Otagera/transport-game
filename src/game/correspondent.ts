import type { GameWorld } from "@engine/game/types";
import type { TermRecord } from "@engine/game/term";
import { isCutOff } from "@engine/game/world";
import { cementServed } from "@engine/game/cement";
import { fuelSupply } from "@engine/game/fuel";
import { townNoSeat } from "@engine/game/problems";
import { roadFull } from "@engine/game/growth";
import { stanceWord } from "@engine/game/union";
import { fordById } from "@engine/game/floods";
import { segmentLength } from "@engine/game/roads";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";

// The correspondent (docs/brief.md, Revision 5, step 4 rebuilt, agreed 2026-10-30): the
// Permanent Secretary of the state's Ministry of Transportation, who writes the day-1 handover
// and each term's letter. Two rules, absolute:
//   - he never names a control, a key, a button, a screen, a tool or a price (C32:
//     `notATutorial`, asserted over every template in the tests);
//   - every clause he writes is read from this seed's state; two named exceptions, constant
//     across seeds -- the mandate paragraph, and "Nobody has built anything new here in eleven
//     years".
// Render layer: reads the world, owns nothing, saves nothing. His name and how many he has
// written before come from the map; his stance from the term records.

const PERM_SECS: Record<string, string[]> = {
  southwest: ["Mr Olumide Adebayo", "Mr Kayode Ogunbiyi", "Mr Adewale Akinola", "Mr Tunji Oyelaran"],
  north: ["Alhaji Garba Shehu", "Mallam Sani Abdullahi", "Alhaji Umar Dikko", "Mallam Bashir Yakasai"],
  northeast: ["Alhaji Bukar Kolo", "Mallam Ibrahim Gaidam", "Mr Adamu Waziri", "Alhaji Modu Fannami"],
  middleBelt: ["Mr Terver Akaa", "Mr Joseph Ochai", "Mr Emmanuel Agbo", "Mr Dauda Gyang"],
  southeast: ["Mr Chukwuemeka Nwosu", "Mr Ikenna Okeke", "Mr Obinna Ezeh", "Mr Uche Anyaoku"],
  southSouth: ["Mr Tamunoemi Briggs", "Mr Ebiye Daubry", "Mr Oghene Ejiro", "Mr Ekpo Etim"],
};

/** What an old line carried down, by region: the export it was built for. */
const CARGO: Record<string, string> = {
  southwest: "cocoa", north: "groundnuts and cotton", northeast: "groundnuts and cotton", middleBelt: "tin and groundnuts", southeast: "palm kernels", southSouth: "palm oil",
};

/** A number from the map, the same every time it's asked (the towns' names and where they stand). */
function mapHash(world: GameWorld): number {
  let h = 2166136261;
  for (const t of [...world.towns.values()].filter((x) => !x.industry).sort((p, q) => p.id.localeCompare(q.id))) {
    for (const c of `${t.name}${Math.round(t.x)}${Math.round(t.y)}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  }
  return h >>> 0;
}

export function correspondentName(world: GameWorld): string {
  const pool = PERM_SECS[world.region ?? "southwest"] ?? PERM_SECS.southwest!;
  return pool[mapHash(world) % pool.length]!;
}

/** How many of these he has written before yours: three to six. */
export function predecessors(world: GameWorld): number {
  return 3 + (Math.floor(mapHash(world) / 7) % 4);
}

export type Stance = "correct" | "behind" | "doubtful" | "finished";

/**
 * His stance, on your record (as the chairman's is on his memory: union.ts) -- as it stood when
 * term `upTo` ended, for that term's letter (the term-1 letter of a good term said "the state
 * has noticed" once term 2 had failed); the record now without it.
 */
export function stanceOf(world: GameWorld, upTo?: number): Stance {
  const term = world.term;
  if (!term) return "correct";
  const h = upTo === undefined ? term.history : term.history.filter((r) => r.number <= upTo);
  const failedInRow = (() => { let n = 0; for (const r of [...h].reverse()) { if (!r.failed) break; n += 1; } return n; })();
  if ((upTo === undefined && term.replacedAtSeconds !== undefined) || failedInRow >= 2) return "finished";
  if (h.at(-1)?.failed) return "doubtful";
  const good = (r: TermRecord | undefined) => !!r && r.failed === false && r.kept.length > 0 && r.peopleTo > r.peopleFrom;
  if (good(h.at(-1)) && good(h.at(-2))) return "behind";
  return "correct";
}

// --- C32: not a tutorial -----------------------------------------------------------------

/**
 * The grammar of an instruction, which nothing he writes may have: a key in brackets, the names
 * of the controls, a price, or a sentence telling you what to do. Not a word list of the world's
 * nouns: the tools are named for things in it, and "you have the roads, the track and the buses"
 * is a true sentence, not a tooltip. Returns what offends, or null.
 */
export function notATutorial(text: string): string | null {
  const checks: RegExp[] = [
    /\((?:[A-Z]|Space|Esc)\)/, // a key in brackets: "(R)"
    /\b(?:press|click|tap|drag|hover|button|screen|toolbar|menu|tab|panel|tooltip|hotkey|keyboard|tool)s?\b/i,
    /₦|\bnaira\b/i, // a price
    /\b(?:you should|you must|you need to|try to|make sure|don't forget|remember to)\b/i,
    // A sentence that opens with a command.
    /(?:^|[.!?:;]\s+)(?:Build|Pave|Restore|Lay|Run|Buy|Connect|Open|Choose|Pick|Select|Use|Try|Put|Add|Make|Go|Start|Click|Press|Get|Bring|Raise|Keep)\b/,
  ];
  for (const check of checks) {
    const m = text.match(check);
    if (m) return m[0].trim();
  }
  return null;
}

// --- The handover note (day 1) --------------------------------------------------------------

const nameOf = (world: GameWorld, id: string) => world.towns.get(id)?.name ?? world.ruins.get(id)?.name ?? id;
const KM_PER_CELL = 0.8;
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const say = (n: number) => (n >= 0 && n < words.length ? words[n]! : String(n));
const Say = (n: number) => say(n).charAt(0).toUpperCase() + say(n).slice(1);
const thousands = (k: number) => `${Math.round(k).toLocaleString()},000`;

/** The old line's ends, and its stations by kind (stations.ts): the longest, where a map has more than one. */
function oldLine(world: GameWorld): { from: string; to: string; stations: number; gone: number; out: number } | null {
  const lines = new Map<string, typeof world.simulation.map.segments>();
  for (const s of world.simulation.map.segments) {
    const line = s.type === "rail" ? s.id.match(/^inherited-rail-\d+/)?.[0] : undefined;
    if (line) lines.set(line, [...(lines.get(line) ?? []), s]);
  }
  let best: { from: string; to: string; stations: number; gone: number; out: number; length: number } | null = null;
  for (const pieces of lines.values()) {
    const degree = new Map<string, number>();
    for (const s of pieces) for (const n of [s.fromNodeId, s.toNodeId]) degree.set(n, (degree.get(n) ?? 0) + 1);
    const ends = [...degree].filter(([, d]) => d === 1).map(([id]) => id);
    if (ends.length !== 2) continue;
    const from = ends.find((e) => e === world.port) ?? ends[0]!;
    const to = ends.find((e) => e !== from)!;
    const on = [...degree.keys()].map((id) => world.stations?.get(id)).filter((x) => x !== undefined);
    const length = pieces.reduce((sum, s) => sum + segmentLength(world, s), 0);
    if (!best || length > best.length) best = { from, to, stations: on.length + 2, gone: on.filter((x) => x!.kind === "gone").length, out: on.filter((x) => x!.kind === "out").length, length };
  }
  return best;
}

/** Paragraph 1: what the state inherited, each thing with the reason it was built. */
function inherited(world: GameWorld): string {
  const parts: string[] = [];
  const line = oldLine(world);
  if (line) {
    const cargo = CARGO[world.region ?? "southwest"] ?? "export crops";
    let s = `The railway from ${nameOf(world, line.from)} to ${nameOf(world, line.to)} was laid to carry ${cargo} down to the coast, not people, and nothing runs on it now.`;
    const one = (n: number, singular: string, plural: string) => (n === 1 ? singular : plural);
    if (line.gone > 0) s += ` ${Say(line.gone)} of its ${say(line.stations)} stations ${one(line.gone, "serves a town", "serve towns")} that ${one(line.gone, "is", "are")} no longer there${line.out > 0 ? `, and ${say(line.out)} ${one(line.out, "stands", "stand")} miles out of the ${one(line.out, "town it was", "towns they were")} named for` : ""}.`;
    else if (line.out > 0) s += ` ${Say(line.out)} of its ${say(line.stations)} stations ${one(line.out, "stands", "stand")} miles out of the ${one(line.out, "town it was", "towns they were")} named for.`;
    parts.push(s);
  }
  const fords = world.floods?.fords ?? [];
  if (fords.length > 0) {
    // One on a road between the home city and a town (not a site's road).
    const town = (id: string) => !!world.towns.get(id) && !world.towns.get(id)!.industry;
    const trunk = fords.find((f) => (f.a === world.port || f.b === world.port) && town(f.a) && town(f.b));
    parts.push(`Where the old roads meet a river they do not cross it, they ford it: ${say(fords.length)} places${trunk ? `, and the ${trunk.name} is on the road out of ${nameOf(world, world.port!)}` : ""}.`);
  }
  const chairmen = world.unions ?? [];
  if (chairmen.length > 0) {
    const home = chairmen.find((u) => u.id === "home") ?? chairmen[0]!;
    parts.push(`Everything else that moves leaves from the motor parks, and the parks are the union's; in ${nameOf(world, world.port!)} that means ${home.chairman}.`);
  }
  return parts.join(" ");
}

/** Paragraph 2: what's wrong today, two or three facts, worst first, as condition. */
function wrongToday(world: GameWorld): string {
  const facts: string[] = [];
  // An idle works or refinery, and the town it holds back.
  // A site's name is its town's and its kind ("Ijero Refinery"): he says where it is.
  const outside = (id: string) => nameOf(world, id).replace(/ (Refinery|Cement|Cement Works)$/, "");
  if (world.cement && !world.cement.working) facts.push(`The cement works outside ${outside(world.cement.worksId)} has not run in years; the towns round it build with what they can find.`);
  else if (world.fuel && !world.fuel.restored) facts.push(`The refinery outside ${outside(world.fuel.refineryId)} has not run in years; every litre here comes in through ${nameOf(world, world.port!)}.`);
  // A town no road reaches.
  const cut = [...world.towns.values()].filter((t) => !t.industry && world.basePopulation.has(t.id) && isCutOff(world, t.id)).sort((p, q) => q.population - p.population)[0];
  if (cut) facts.push(`${cut.name}, ${thousands(cut.population)} people, has no road to anywhere.`);
  // The largest pair the roads join and nobody but the danfos serve.
  const pair = [...world.simulation.demand]
    .filter((d) => world.towns.has(d.from) && world.towns.has(d.to) && !world.towns.get(d.from)!.industry && !world.towns.get(d.to)!.industry && d.from < d.to)
    .sort((p, q) => q.rate - p.rate)[0];
  if (pair && facts.length < 3) {
    const a = world.towns.get(pair.from)!;
    const b = world.towns.get(pair.to)!;
    const km = Math.round((Math.hypot(a.x - b.x, a.y - b.y) * KM_PER_CELL) / 5) * 5;
    facts.push(`More people want to travel between ${a.name} and ${b.name} than anywhere else, ${km} km, and only the danfos carry them.`);
  }
  // The two worst, then the named exception: the licence for the premise.
  return [...facts.slice(0, 2), "Nobody has built anything new here in eleven years."].join(" ");
}

/** Paragraph 3: your role and what you answer to -- constant across seeds, as the mandate is. */
function yourRole(world: GameWorld): string {
  return `You have the roads, the track and the buses. You do not have the danfos, and you will not get them: whatever you build, they will be on it too, and the parks will take their cut. The state will put choices in front of you each term and I will write down what came of them. Two terms with nothing to show and they will find someone else. I have written ${say(predecessors(world))} of these.`;
}

export interface Letter {
  from: string;
  /** The letter's paragraphs, in his voice. */
  paragraphs: string[];
}

/** The day-1 handover note: three short paragraphs, read from this seed. */
export function handoverNote(world: GameWorld): Letter {
  return { from: correspondentName(world), paragraphs: [inherited(world), wrongToday(world), yourRole(world)].filter((p) => p.length > 0) };
}

// --- The term's letter ----------------------------------------------------------------------

interface Clause { weight: number; text: string }

const KEPT: Record<string, (t: string) => string> = {
  connect: (t) => `You joined ${t} to the roads.`,
  cement: (t) => `You got cement to ${t}.`,
  fuel: (t) => `You got fuel to ${t}.`,
  seats: (t) => `You found seats for the people left waiting at ${t}.`,
  service: (t) => `You carried what ${t} expected of you.`,
  grow: (t) => `${t} grew as the state asked.`,
  reach: (t) => `What ${t}'s cluster offers reaches you now.`,
};

function missedNow(world: GameWorld, kind: string, id: string): string {
  const t = nameOf(world, id);
  const pct = (x: number) => `${Math.round(x * 100)} per cent`;
  switch (kind) {
    case "connect": return isCutOff(world, id) ? `You did not join ${t} to the roads. It is still cut off.` : `You did not join ${t} to the roads in time.`;
    case "cement": return `You did not get cement to ${t}. It has ${pct(cementServed(world, id))} of what it needs.`;
    case "fuel": return `You did not get fuel to ${t}. It has ${pct(fuelSupply(world, id)?.supplied ?? 0)} of its fuel.`;
    case "seats": return `You did not find the seats at ${t}. ${Math.round(townNoSeat(world, id)?.perDay ?? 0)} a day there still go without.`;
    case "service": return `${t} expected more of you than you carried.`;
    case "grow": return `${t} did not grow as the state asked.`;
    default: return `What ${t}'s cluster offers still does not reach you.`;
  }
}

/** The union clause: the thing his chairman remembers from this term, his figures left out. */
function unionClause(world: GameWorld, r: TermRecord): Clause | null {
  const day = (s: number) => Math.floor((s - world.startSeconds) / D) + 1;
  const [from, to] = [day(r.fromSeconds ?? 0), day(r.toSeconds ?? Infinity)];
  let best: { chairman: string; text: string; delta: number } | null = null;
  for (const u of world.unions ?? []) {
    for (const m of u.memory) if (m.day >= from && m.day <= to && (!best || Math.abs(m.delta) > Math.abs(best.delta))) best = { chairman: u.chairman, text: m.text, delta: m.delta };
  }
  if (!best) return null;
  const what = best.text.replace(/\s*\([^)]*\)/g, "");
  const stance = stanceWord((world.unions ?? []).find((u) => u.chairman === best!.chairman)?.stance ?? 0);
  return {
    weight: 4 + Math.abs(best.delta) * 10,
    text: best.delta < 0 ? `${best.chairman} has not forgotten that ${what}.${stance === "against you" ? " His men are against you now." : ""}` : `${best.chairman} remembers that ${what}.${stance === "with you" ? " His men are with you." : ""}`,
  };
}

/** The shock clause: the rains, if they came this term. */
function floodClause(world: GameWorld, r: TermRecord): Clause | null {
  const risen = (world.floods?.risen ?? []).filter((x) => x.atSeconds >= (r.fromSeconds ?? 0) && x.atSeconds <= (r.toSeconds ?? Infinity));
  const last = risen.at(-1);
  if (!last) return null;
  const days = world.tuning.floodDays ?? 20;
  const ford = (id: string) => fordById(world, id)?.name ?? "the ford";
  if (last.under.length === 0 && last.bridged.length > 0) return { weight: 5, text: `The rains came and the ${ford(last.bridged[0]!)} held: you had raised the bridge.` };
  if (last.under.length > 0) return { weight: 5, text: `The rains took the ${ford(last.under[0]!)} road for ${say(days)} days${last.bridged.length > 0 ? `; the ${ford(last.bridged[0]!)}, which you had raised, held` : ""}.` };
  return null;
}

/** The region: paved road now against the term before, if it changed. */
function regionClause(world: GameWorld, r: TermRecord): Clause | null {
  const before = world.term?.history.find((x) => x.number === r.number - 1)?.pavedCells ?? 0;
  const now = r.pavedCells ?? world.simulation.map.segments.filter((s) => s.type === "road" && s.surface === "paved").reduce((sum, s) => sum + segmentLength(world, s), 0);
  const km = Math.round(((now - before) * KM_PER_CELL) / 10) * 10;
  if (km < 10) return null;
  return { weight: 2, text: before > 0 ? `There are ${km} km more paved road here than a term ago.` : `There are ${km} km of paved road here that were not here before you.` };
}

/** A term's letter, at most three clauses ranked by how much each changed; the grant and mandate are set below it, not in his voice. */
export function termLetter(world: GameWorld, r: TermRecord): Letter {
  // As it stood at this term's end: the record up to it, this term included.
  const recorded = world.term?.history.some((x) => x.number === r.number);
  const stance = recorded ? stanceOf(world, r.number) : stanceOf({ ...world, term: world.term ? { ...world.term, history: [...world.term.history, r] } : world.term } as GameWorld, r.number);
  if (stance === "finished") {
    return { from: correspondentName(world), paragraphs: [`Term ${r.number}. Two terms with nothing to show, and the state has found someone else. Your record stays with the ministry, and whoever comes next inherits what you built. I have written ${say(predecessors(world) + 1)} of these now.`] };
  }
  const clauses: Clause[] = [];
  const towns = new Map((r.towns ?? []).map((t) => [t.id, t]));
  for (const key of r.keptKeys ?? []) {
    const [kind, id] = key.split(":") as [string, string];
    const t = towns.get(id);
    const name = nameOf(world, id);
    let text = (KEPT[kind] ?? KEPT.grow!)(name);
    const grew = t ? t.to - t.from : 0;
    if (t && Math.abs(grew) >= 1) text += ` ${name} has gone from ${thousands(t.from)} people to ${thousands(t.to)}.`;
    // The arc: what keeping it did to its roads -- your growth choking your own corridor.
    const full = roadFull(world, id);
    if (full && !full.thin && r.number >= 2) text += ` The road into ${name} is now as full as it gets; it will not carry another term like this one.`;
    clauses.push({ weight: 10 + Math.abs(grew), text });
  }
  for (const key of r.missedKeys ?? []) {
    const [kind, id] = key.split(":") as [string, string];
    clauses.push({ weight: 8, text: missedNow(world, kind, id) });
  }
  for (const c of [unionClause(world, r), floodClause(world, r), regionClause(world, r)]) if (c) clauses.push(c);
  if (clauses.length === 0) clauses.push({ weight: 1, text: r.peopleTo >= r.peopleFrom ? `The towns grew by ${thousands(r.peopleTo - r.peopleFrom)} people. You made no promises to the state, and kept none.` : `The towns lost ${thousands(r.peopleFrom - r.peopleTo)} people. You made no promises to the state, and kept none.` });
  const body = clauses.sort((p, q) => q.weight - p.weight).slice(0, 3).map((c) => c.text);
  // His stance, in what he adds -- never in the facts.
  if (stance === "doubtful") body.push("The state has noticed.");
  if (stance === "behind") body.push("We are getting somewhere.");
  return { from: correspondentName(world), paragraphs: [`Term ${r.number}. ${body.join(" ")}`] };
}
