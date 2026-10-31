import type { GameMapDef } from "./types";
import { NAMES, REGION_NAMES, townId } from "./generate";

// Fictional names, true to their region (the fidelity scope of 2026-10-30, A5; your word: "random
// generation, fictional but taking into account how Nigeria is" -- and "it will confuse people when
// they see real names but not like-for-like geography"). Every map had taken real towns' names from
// its region's list (Lokoja, Numan, Katsina-Ala) and put them where those towns aren't. Now each
// town's name is made from the sounds of its region's languages, so a map reads as plausibly of its
// part of the country without claiming to be anywhere real:
//
//   - south-west, Yoruba: vowel-initial, open syllables, a final -n now and then; Oke-, Ile-, Ado-;
//   - south-east, Igbo: Umu-, Ama-, Nk-, Nn-, Obi-; ch, gw, kw, nw, ny;
//   - south-south: Ijaw's -ama and -biri, Efik and Ibibio's Ikot ..., Urhobo and Isoko's gh and rh;
//   - Middle Belt: Tiv, Nupe, Idoma, Igala -- gb, kp, ts; -kpo, -ko, -pa, -ji, -ya;
//   - north, Hausa: Kafin, Tudun, Gidan, Dan, Birnin ...; -wa, -ri, -ni, -ma, -di;
//   - north-east, Kanuri and Fulfulde: Ng-, -ram, -gu, -no; Mayo ....
//
// Drawn from the map's seed, so the same map is always named the same; never a real town's name
// from the lists the maps used; never two alike. Map version 9 (region.ts); older runs keep theirs.

type Rand = () => number;
const pick = <T>(rand: Rand, list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const chance = (rand: Rand, p: number) => rand() < p;
const cap = (s: string) => s.replace(/(^|[ -])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());

function syllables(rand: Rand, onsets: readonly string[], vowels: readonly string[], count: number): string {
  let out = "";
  for (let k = 0; k < count; k += 1) out += pick(rand, onsets) + pick(rand, vowels);
  return out;
}

const GRAMMARS: Record<string, (rand: Rand) => string> = {
  southwest: (rand) => {
    const onsets = ["b", "d", "f", "g", "gb", "j", "k", "l", "m", "n", "p", "r", "s", "sh", "t", "w", "y"];
    const vowels = ["a", "e", "i", "o", "u", "a", "o", "i"];
    const word = () => pick(rand, ["i", "o", "e", "a", "i", "o"]) + syllables(rand, onsets, vowels, 1 + (chance(rand, 0.6) ? 1 : 0)) + (chance(rand, 0.25) ? "n" : "");
    return chance(rand, 0.18) ? `${pick(rand, ["oke", "ile", "ado", "iju", "ita", "igbo"])}-${word()}` : word();
  },
  southeast: (rand) => {
    const onsets = ["b", "ch", "d", "g", "gw", "k", "kw", "l", "m", "n", "nw", "ny", "r", "z", "gb"];
    const vowels = ["a", "e", "i", "o", "u", "a", "e"];
    const lead = pick(rand, ["umu", "ama", "nk", "nn", "obi", "ezi", "ok", "aw", "ag", "ih", "ob"]);
    const body = syllables(rand, onsets, vowels, 1 + (chance(rand, 0.55) ? 1 : 0));
    const word = lead.endsWith("u") || lead.endsWith("a") || lead.endsWith("i") ? lead + body : lead + pick(rand, vowels) + body.slice(1);
    return chance(rand, 0.12) ? `${word}-${pick(rand, ["agu", "ukwu", "nta", "ani"])}` : word;
  },
  southSouth: (rand) => {
    const vowels = ["a", "e", "i", "o", "u", "a", "o"];
    const kind = rand();
    if (kind < 0.35) return syllables(rand, ["b", "k", "t", "s", "d", "g", "n", "y", "f"], vowels, 1 + (chance(rand, 0.5) ? 1 : 0)) + pick(rand, ["ama", "biri", "tor", "gbene", "kiri", "ma"]);
    if (kind < 0.55) return `ikot ${pick(rand, ["a", "e", "o", "u", ""])}${syllables(rand, ["b", "k", "d", "s", "m", "n", "t", "y"], vowels, 2)}`;
    return pick(rand, ["u", "o", "e", "i"]) + syllables(rand, ["gh", "rh", "b", "d", "k", "l", "m", "r", "s", "t", "v", "z"], vowels, 2);
  },
  middleBelt: (rand) => {
    const onsets = ["b", "d", "gb", "k", "kp", "l", "m", "n", "p", "t", "ts", "v", "w", "y", "j"];
    const vowels = ["a", "e", "i", "o", "u", "a", "o"];
    // A vowel to start, or "an" before a stop (Ankpa, Angwa), never a cluster like "ott" or "otp".
    const start = chance(rand, 0.4) ? pick(rand, ["o", "a", "i", "u"]) : "";
    const body = start === "" && chance(rand, 0.12) ? `an${pick(rand, ["kp", "k", "g", "d"])}${pick(rand, vowels)}` : start + syllables(rand, onsets, vowels, 1);
    return body + (chance(rand, 0.4) ? syllables(rand, onsets, vowels, 1) : "") + pick(rand, ["kpo", "ko", "pa", "ji", "ya", "wa", "gi", "la", "da", ""]);
  },
  north: (rand) => {
    const onsets = ["b", "d", "g", "k", "ts", "z", "sh", "r", "n", "m", "w", "y", "f", "h", "j", "s"];
    const vowels = ["a", "a", "i", "u", "e", "o", "a", "i"];
    const word = syllables(rand, onsets, vowels, 1 + (chance(rand, 0.55) ? 1 : 0)) + pick(rand, ["wa", "ri", "ni", "ma", "di", "ji", "ko", "mi", "ra", "u", "n", ""]);
    return chance(rand, 0.2) ? `${pick(rand, ["kafin", "tudun", "gidan", "dan", "birnin", "kurmin", "unguwar"])} ${word}` : word;
  },
  northeast: (rand) => {
    const vowels = ["a", "a", "u", "i", "o", "e"];
    const lead = pick(rand, ["ng", "m", "d", "g", "b", "k", "w", "y", "dikw", "gub", "mong"]);
    const word = lead + pick(rand, vowels) + syllables(rand, ["g", "l", "m", "n", "r", "k", "w", "d", "b"], vowels, chance(rand, 0.5) ? 1 : 0) + pick(rand, ["ram", "gu", "no", "wa", "ri", "ma", "la", "ram", "re", ""]);
    return chance(rand, 0.12) ? `mayo ${word}` : word;
  },
};

/**
 * Every real town's name the maps had used, the country's best-known towns besides, and a few
 * English words the grammars can make: a made-up name never lands on one.
 */
const KNOWN = [
  "Lagos", "Ibadan", "Abeokuta", "Ogbomoso", "Oyo", "Ife", "Ilorin", "Osogbo", "Akure", "Ado", "Ondo", "Ijebu", "Benin", "Warri", "Asaba", "Onitsha",
  "Enugu", "Owerri", "Aba", "Umuahia", "Abakaliki", "Calabar", "Uyo", "Yenagoa", "Kano", "Kaduna", "Katsina", "Sokoto", "Zaria", "Gusau", "Birnin Kebbi",
  "Dutse", "Maiduguri", "Yola", "Bauchi", "Jos", "Abuja", "Makurdi", "Lafia", "Minna", "Lokoja", "Damaturu", "Jalingo", "Dikwa", "Monguno", "Ngala",
  "Gubio", "Kukawa", "Bama", "Mubi", "Gombe", "Owan", "Okene", "Idah", "Bida", "Kontagora", "Nguru", "Potiskum", "Biu", "Nsukka", "Awka", "Nnewi",
  "Oboe", "Banana", "Mama", "Papa", "Gaga", "Dodo", "Kiwi", "Tuna", "Sofa", "Sushi", "Moma", "Data",
];
const REAL = new Set([...NAMES, ...Object.values(REGION_NAMES).flat(), ...KNOWN].map(townId));

/** A name for a town of `region`, from `rand`; `used` holds the ids already taken on the map. */
export function fictionalName(region: string, rand: Rand, used: Set<string>): string {
  const grammar = GRAMMARS[region] ?? GRAMMARS.southwest!;
  for (let tries = 0; ; tries += 1) {
    const name = cap(grammar(rand));
    const id = townId(name);
    const letters = name.replace(/[^a-z]/gi, "").length;
    if (tries < 200 && (letters < 4 || letters > 12 || REAL.has(id) || used.has(id) || /(.)\1\1/.test(name.toLowerCase()))) continue;
    used.add(id);
    return name;
  }
}

/** A deterministic stream from a seed (mulberry32). */
export function stream(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The map with every town renamed by its region's sounds, and every reference to a town's id with it. */
export function withFictionalNames(map: GameMapDef, seed: number): GameMapDef {
  const rand = stream(seed * 2654435761 + 8_000_009);
  const used = new Set<string>();
  const renamed = new Map<string, { id: string; name: string }>();
  // Biggest first, so the home city's name is drawn first whatever else the map holds.
  for (const town of [...map.towns].sort((a, b) => b.population - a.population || a.id.localeCompare(b.id))) {
    const name = fictionalName(map.region ?? "southwest", rand, used);
    renamed.set(town.id, { id: townId(name), name });
  }
  const id = (old: string) => renamed.get(old)?.id ?? old;
  const road = <R extends { a: string; b: string }>(r: R): R => ({ ...r, a: id(r.a), b: id(r.b) });
  return {
    ...map,
    towns: map.towns.map((t) => ({ ...t, ...renamed.get(t.id)! })),
    roads: map.roads.map(road),
    rails: map.rails?.map(road),
    port: map.port && id(map.port),
    seaport: map.seaport && id(map.seaport),
    clusters: map.clusters?.map((c) => ({ ...c, hub: id(c.hub), towns: c.towns.map(id) })),
  };
}
