import type { SliceHillDef, SliceMapDef, SliceRiverDef, SliceRoadDef, SliceTown } from "./types";
import { createRng, type Rng } from "../map/random";
import { UnionFind } from "../map/connectivity";
import { planCorridor } from "../pathing/plan";
import { buildSliceTerrain } from "./terrain";
import { variedSliceMap, varyTownSizes } from "./variation";

// Generated maps, per seed, with guards (docs/brief.md, After the ladder's
// playtest, 5; check P8). The seeded variation kept the hand-made map's
// towns where they were, and a second game read as "the same map just the
// names rearranged" (playtest, R1 4-6). A seed now draws the geography:
//
//   - Where about nine towns sit: spacing rules, not the hand-made positions
//     nudged (engine/map nodes.ts's rule: nothing closer than a minimum).
//   - The dominant city's setting: on the coast (a sea along its edge of the
//     map, and it's the port), on the river, or inland.
//   - A river that splits the map, its width varying, with one ford; one
//     ridge, between a cut-off town and its nearest neighbour.
//   - The inherited network: a trunk from the dominant city through a
//     middle town and across the river to the second city (the hand-made
//     map's Ilase-Owode-Ado), spurs on either bank, and 2-3 towns no road
//     reaches. The old railway: straight, from the dominant city across the
//     river, its geometry built for another age.
//
// Kept from the hand-made map: its size, its town sizes (varied as
// variation.ts varies them), one dominant city, the river, the ridge.
//
// Guards reject a draw and draw again (the brief): each of the trunk's legs
// within TRUNK_LENGTH_TOLERANCE of the hand-made one's, so the ladder's prices land as
// measured (a lane ~14 days of surplus, rail ~28: C2); one dominant city; the
// river splitting the map, at least MIN_TOWNS_A_BANK each side; 2-3 cut-off
// towns; and every town reachable by building roads (engine/map
// connectivity's UnionFind over the roads pathing can plan). No re-tuning:
// the ladder's numbers are rules (caps as shares of capacity, prices per
// cell), so they carry over.
//
// Seed 0 is the hand-made map, unchanged.

/** Cells. The hand-made map's size. */
const WIDTH = 100;
const HEIGHT = 64;
/** The hand-made map's sizes, thousands: the dominant city, the second city, the trunk's middle, then the rest. */
const SIZES = [120, 70, 45, 30, 25, 22, 18, 15, 12];
/** No two towns closer than this, cells (the hand-made map's closest pair is ~18). */
const MIN_SPACING = 15;
/** Towns keep this far from the map's edge, and from water's edge. */
const EDGE_MARGIN = 6;
const WATER_CLEARANCE = 3;
/**
 * The hand-made trunk's legs: Ilase-Owode 25.5, Owode-Ado 38.1 cells. Each
 * leg within TRUNK_LENGTH_TOLERANCE of its own, not only their sum: the
 * ladder is priced per cell along a corridor, and with the sum alone a first
 * leg of 32.1 cells put rail at 48 days of surplus, unbuilt by day 160
 * (corridor probe, seed 1).
 */
const TRUNK_LEGS = [25.5, 38.1] as const;
const TRUNK_LENGTH_TOLERANCE = 0.25;
/** The trunk runs on, not back: its two legs at least this straight (end to end over the legs' sum). */
const TRUNK_STRAIGHTNESS = 0.75;
const MIN_TOWNS_A_BANK = 3;
/** An inherited road keeps this far from towns it doesn't serve, cells. */
const ROAD_CLEARANCE = 3;
/** Draws before falling back to the seeded variation of the hand-made map (never seen in tests). */
const MAX_DRAWS = 400;

/** Names for generated towns: none of the hand-made map's, so a new map reads as new. The south-west's (Yoruba). */
const NAMES = [
  "Iseyin", "Okeho", "Igboho", "Saki", "Iwo", "Ede", "Ejigbo", "Ikire", "Ilesa", "Owo", "Ikare", "Ota", "Ifo", "Epe",
  "Ijero", "Ido", "Ilobu", "Erin", "Igbeti", "Kisi", "Ipetu", "Ifon", "Ilero", "Agbara", "Itori", "Ilugun", "Oyan", "Ilora",
];

/**
 * Where in the country a map is: its towns are named from one region, so a
 * map reads as one real place, never a Hausa town beside an Ijaw one (the
 * pillar, true not teaching). Real towns of each region, middle-sized, plain
 * spellings. Only the south-west and the south-south reach the coast.
 */
export type NameRegion = "southwest" | "north" | "northeast" | "middleBelt" | "southeast" | "southSouth";

const REGION_NAMES: Record<Exclude<NameRegion, "southwest">, string[]> = {
  north: [
    "Zaria", "Funtua", "Gusau", "Malumfashi", "Daura", "Kazaure", "Hadejia", "Gumel", "Rano", "Wudil", "Kankia", "Dutsin-Ma",
    "Bichi", "Gwarzo", "Dambatta", "Ringim", "Kiru", "Tsafe", "Zuru", "Bunza", "Argungu", "Jega", "Yauri", "Soba", "Ikara",
    "Makarfi", "Kudan",
  ],
  northeast: [
    "Biu", "Potiskum", "Nguru", "Gashua", "Geidam", "Damaturu", "Bama", "Gwoza", "Askira", "Uba", "Mubi", "Michika", "Hong",
    "Ganye", "Numan", "Jalingo", "Kaltungo", "Dukku", "Azare", "Misau", "Gombe",
  ],
  middleBelt: [
    "Gboko", "Katsina-Ala", "Otukpo", "Oju", "Wukari", "Bida", "Mokwa", "Lapai", "Agaie", "Kontagora", "Lafia", "Keffi",
    "Akwanga", "Doma", "Idah", "Ankpa", "Dekina", "Ajaokuta", "Okene", "Lokoja", "Kabba", "Pankshin", "Shendam", "Bukuru",
    "Vom", "Kafanchan",
  ],
  southeast: [
    "Nnewi", "Ekwulobia", "Awka", "Agulu", "Oko", "Ihiala", "Okigwe", "Orlu", "Nkwerre", "Ohafia", "Arochukwu", "Abiriba",
    "Bende", "Afikpo", "Nsukka", "Udi", "Agbani", "Awgu", "Adani", "Ogidi", "Ozubulu", "Uga", "Igbo-Ukwu", "Obollo-Afor",
  ],
  southSouth: [
    "Warri", "Sapele", "Ughelli", "Abraka", "Kwale", "Oleh", "Ozoro", "Burutu", "Bomadi", "Patani", "Brass", "Nembe",
    "Oloibiri", "Bonny", "Okrika", "Ahoada", "Omoku", "Eket", "Oron", "Abak", "Itu", "Opobo", "Degema", "Ikot-Ekpene",
    "Auchi", "Ekpoma", "Uromi", "Irrua", "Igarra", "Agbor",
  ],
};

/**
 * A map's region, from a stream of its own so the geography's draws (and
 * every map made before regions) stay exactly as they were. The south-west
 * stays the most likely; a coast is only the south-west's or the south-south's.
 */
function nameRegion(seed: number, setting: CitySetting): NameRegion {
  const roll = createRng(seed + 1_000_003)();
  if (setting === "coast") return roll < 0.6 ? "southwest" : "southSouth";
  const others: NameRegion[] = ["north", "northeast", "middleBelt", "southeast", "southSouth"];
  return roll < 0.4 ? "southwest" : others[Math.min(others.length - 1, Math.floor(((roll - 0.4) / 0.6) * others.length))]!;
}

/** A town's id from its name: lower case, letters only ("Dutsin-Ma" -> "dutsinma"). */
const townId = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

export type CitySetting = "coast" | "river" | "inland";

interface Point {
  x: number;
  y: number;
}

const between = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function shuffle<T>(rng: Rng, items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Distance from a point to a segment. */
function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Whether two segments cross (sharing an end doesn't count). */
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  if ([a, b].some((p) => (p.x === c.x && p.y === c.y) || (p.x === d.x && p.y === d.y))) return false;
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

/** The river's centre where it crosses row y (its points run down the map, top to bottom). */
function riverX(river: SliceRiverDef, y: number): number {
  const { points } = river;
  for (let k = 1; k < points.length; k += 1) {
    const [ax, ay] = points[k - 1]!;
    const [bx, by] = points[k]!;
    if (y >= ay && y <= by) return ax + ((bx - ax) * (y - ay)) / (by - ay);
  }
  return points[0]![0];
}

/** Which bank of the river a point is on: -1 west, 1 east. */
const bankOf = (river: SliceRiverDef, p: Point) => Math.sign(p.x - riverX(river, p.y)) || 1;

/** A river from the top of the map to the bottom, meandering about x = cx, its width varying, with one ford. */
function drawRiver(rng: Rng, cx: number): SliceRiverDef {
  const rows = [-2, 10, 22, 34, 46, 56, HEIGHT + 2];
  const points = rows.map((y): [number, number] => [Math.round(cx + between(rng, -6, 6)), y]);
  const widths = rows.map(() => between(rng, 2.5, 5));
  widths[1 + Math.floor(rng() * (rows.length - 2))] = 1.2;
  return { points, width: 3, widths };
}

/** A sea along the west or east edge, `depth` cells of water in from it: drawn as a very wide river off the map's edge. */
function drawSea(rng: Rng, side: -1 | 1, depth: number): SliceRiverDef {
  const offMap = 8;
  const edgeX = side < 0 ? -offMap : WIDTH - 1 + offMap;
  const rows = [-2, 20, 42, HEIGHT + 2];
  const points = rows.map((y): [number, number] => [Math.round(edgeX + side * between(rng, -1.5, 1.5)), y]);
  return { points, width: 2 * (offMap + depth) };
}

/** The water's cell grid for a draw, to check towns against. */
function isDryAround(water: SliceRiverDef[], p: Point, clearance: number): boolean {
  for (const river of water) {
    for (let k = 1; k < river.points.length; k += 1) {
      const [ax, ay] = river.points[k - 1]!;
      const [bx, by] = river.points[k]!;
      const width = Math.max(river.width, ...(river.widths ?? []));
      if (toSegment(p, { x: ax, y: ay }, { x: bx, y: by }) <= width / 2 + clearance) return false;
    }
  }
  return true;
}

export interface GeneratedMapInfo {
  map: SliceMapDef;
  setting: CitySetting;
  /** The part of the country its town names come from. */
  region: NameRegion;
  /** The inherited trunk: dominant city, middle town, second city. */
  trunk: [string, string, string];
  /** How many draws the guards rejected before this one. */
  rejected: number;
}

/** The map for a seed: the hand-made one for seed 0, else a generated one (generatedMapInfo). */
export function generatedSliceMap(base: SliceMapDef, seed: number): SliceMapDef {
  return generatedMapInfo(base, seed).map;
}

export function generatedMapInfo(base: SliceMapDef, seed: number): GeneratedMapInfo {
  if (seed === 0) return { map: { ...structuredClone(base), region: "southwest" }, setting: "inland", region: "southwest", trunk: ["ilase", "owode", "ado"], rejected: 0 };
  const rng = createRng(seed);
  // The setting is the seed's, drawn once: redrawn with every rejected draw,
  // the harder settings came up less (river 35 of 300 seeds).
  const setting: CitySetting = (["coast", "river", "inland"] as const)[Math.floor(rng() * 3)]!;
  const region = nameRegion(seed, setting);
  const regional = region === "southwest" ? null : shuffle(createRng(seed + 2_000_003), REGION_NAMES[region]);
  for (let draw = 0; draw < MAX_DRAWS; draw += 1) {
    const result = drawMap(rng, setting, regional);
    if (result) return { ...result, map: { ...result.map, region }, region, rejected: draw };
  }
  // Never reached by any seed the tests try; kept so a seed always makes a game.
  return { map: variedSliceMap(base, seed), setting: "inland", region: "southwest", trunk: ["ilase", "owode", "ado"], rejected: MAX_DRAWS };
}

/** One draw; null when a guard rejects it. `regional`: another region's names, already shuffled (null: the south-west's). */
function drawMap(rng: Rng, setting: CitySetting, regional: string[] | null): Omit<GeneratedMapInfo, "rejected" | "region"> | null {
  const river = drawRiver(rng, between(rng, 38, 62));
  // The dominant city's bank, and for the coast, a sea along that bank's edge.
  const cityBank: -1 | 1 = rng() < 0.5 ? -1 : 1;
  const water: SliceRiverDef[] = [river];
  if (setting === "coast") water.push(drawSea(rng, cityBank, Math.round(between(rng, 4, 7))));

  const inBounds = (p: Point) => p.x >= EDGE_MARGIN && p.x <= WIDTH - 1 - EDGE_MARGIN && p.y >= EDGE_MARGIN && p.y <= HEIGHT - 1 - EDGE_MARGIN;
  const dry = (p: Point) => isDryAround(water, p, WATER_CLEARANCE);

  // The dominant city first, where its setting puts it.
  let city: Point | null = null;
  for (let attempt = 0; attempt < 400 && !city; attempt += 1) {
    const p = { x: Math.round(between(rng, EDGE_MARGIN, WIDTH - 1 - EDGE_MARGIN)), y: Math.round(between(rng, EDGE_MARGIN + 4, HEIGHT - 5 - EDGE_MARGIN)) };
    if (bankOf(river, p) !== cityBank || !dry(p)) continue;
    const toRiver = Math.abs(p.x - riverX(river, p.y));
    const toEdge = cityBank < 0 ? p.x : WIDTH - 1 - p.x;
    const fits =
      setting === "coast" ? !isDryAround(water.slice(1), p, WATER_CLEARANCE + 5) && toRiver > 15
      : setting === "river" ? toRiver < 9
      : toRiver > 15 && toEdge > 14;
    if (fits) city = p;
  }
  if (!city) return null;

  // The rest by spacing, anywhere dry. Coast cities sit by the sea, so relax the edge margin there.
  const spots: Point[] = [city];
  for (let attempt = 0; attempt < 4000 && spots.length < SIZES.length; attempt += 1) {
    const p = { x: Math.round(between(rng, 0, WIDTH - 1)), y: Math.round(between(rng, 0, HEIGHT - 1)) };
    if (!inBounds(p) || !dry(p) || spots.some((q) => distance(p, q) < MIN_SPACING)) continue;
    spots.push(p);
  }
  if (spots.length < SIZES.length) return null;
  const banks = spots.map((p) => bankOf(river, p));
  if (banks.filter((b) => b === cityBank).length < MIN_TOWNS_A_BANK || banks.filter((b) => b !== cityBank).length < MIN_TOWNS_A_BANK) return null;

  // The trunk: city -> a middle town on its bank -> the second city across the river.
  const trunks: Array<[number, number]> = [];
  for (let m = 1; m < spots.length; m += 1) {
    if (banks[m] !== cityBank) continue;
    for (let s = 1; s < spots.length; s += 1) {
      if (banks[s] === cityBank) continue;
      const first = distance(spots[0]!, spots[m]!);
      const second = distance(spots[m]!, spots[s]!);
      if ([first, second].some((leg, k) => Math.abs(leg - TRUNK_LEGS[k]!) > TRUNK_LEGS[k]! * TRUNK_LENGTH_TOLERANCE)) continue;
      const legs = first + second;
      if (distance(spots[0]!, spots[s]!) < TRUNK_STRAIGHTNESS * legs) continue;
      trunks.push([m, s]);
    }
  }
  if (trunks.length === 0) return null;
  const [middle, second] = trunks[Math.floor(rng() * trunks.length)]!;

  // Sizes: the hand-made map's, the three largest on the trunk, the rest shuffled.
  // The south-west's shuffle is always drawn, so the rest of the map draws the same whatever the region.
  const southwest = shuffle(rng, NAMES);
  const names = (regional ?? southwest).slice(0, spots.length);
  const order = [0, middle, second, ...shuffle(rng, spots.map((_, i) => i).filter((i) => i !== 0 && i !== middle && i !== second))];
  const sizes = new Map<number, number>([[0, SIZES[0]!], [second, SIZES[1]!], [middle, SIZES[2]!]]);
  order.slice(3).forEach((i, k) => sizes.set(i, SIZES[3 + k]!));
  const towns: SliceTown[] = spots.map((p, i) => ({ id: townId(names[i]!), name: names[i]!, x: p.x, y: p.y, population: sizes.get(i)! }));
  const id = (i: number) => towns[i]!.id;

  // The inherited roads: the trunk, then spurs. 2-3 towns off the trunk are left cut off.
  const roads: SliceRoadDef[] = [{ a: id(0), b: id(middle) }, { a: id(middle), b: id(second) }];
  const cutOffCount = rng() < 0.5 ? 2 : 3;
  const offTrunk = order.slice(3);
  const cutOff = new Set(shuffle(rng, offTrunk).slice(0, cutOffCount));
  const joined = new Set([0, middle, second]);
  const clearOfTowns = (a: number, b: number) => spots.every((p, i) => i === a || i === b || toSegment(p, spots[a]!, spots[b]!) >= ROAD_CLEARANCE);
  const clearOfRoads = (a: number, b: number) =>
    roads.every((road) => {
      const [c, d] = [towns.findIndex((t) => t.id === road.a), towns.findIndex((t) => t.id === road.b)];
      return !crosses(spots[a]!, spots[b]!, spots[c]!, spots[d]!);
    });
  // Prim's way: the next spur is the shortest that joins a new town to the network on its own bank.
  for (;;) {
    let best: [number, number, number] | null = null;
    for (const t of offTrunk) {
      if (joined.has(t) || cutOff.has(t)) continue;
      for (const j of joined) {
        if (banks[t] !== banks[j] || !clearOfTowns(t, j) || !clearOfRoads(t, j)) continue;
        const d = distance(spots[t]!, spots[j]!);
        if (!best || d < best[2]) best = [t, j, d];
      }
    }
    if (!best) break;
    roads.push({ a: id(best[0]), b: id(best[1]) });
    joined.add(best[0]);
  }
  if (offTrunk.some((t) => !joined.has(t) && !cutOff.has(t))) return null; // a town meant to be served that no spur could reach
  if (!clearOfTowns(0, middle) || !clearOfTowns(middle, second)) return null;

  // One ridge: two hills on the line from a cut-off town toward its nearest
  // joined neighbour -- the cut-off town with the widest gap, so the ridge sits
  // between them, not on either (from a town 15 cells away, the hills sat on
  // the towns: seeds 3 and 4).
  const nearestJoined = (t: number) => [...joined].reduce((n, j) => (distance(spots[t]!, spots[j]!) < distance(spots[t]!, spots[n]!) ? j : n));
  const behind = [...cutOff].reduce((best, t) => (distance(spots[t]!, spots[nearestJoined(t)]!) > distance(spots[best]!, spots[nearestJoined(best)]!) ? t : best));
  const from = spots[behind]!;
  const to = spots[nearestJoined(behind)]!;
  const at = (t: number) => ({ x: Math.round(from.x + (to.x - from.x) * t), y: Math.round(from.y + (to.y - from.y) * t) });
  const hills: SliceHillDef[] = [
    { ...at(0.4), radius: 8, height: 3 },
    { ...at(0.65), radius: 7, height: 2.5 },
  ];
  if (hills.some((h) => spots.some((p) => distance(p, h) < h.radius))) return null;

  // The old railway: straight from the city to the farthest town across the river, not through a town.
  const rail = spots
    .map((_, i) => i)
    .filter((i) => banks[i] !== cityBank && i !== second && spots.every((p, k) => k === 0 || k === i || toSegment(p, spots[0]!, spots[i]!) >= 2.5))
    .sort((a, b) => distance(spots[0]!, spots[b]!) - distance(spots[0]!, spots[a]!))[0];
  if (rail === undefined) return null;

  const map: SliceMapDef = {
    width: WIDTH,
    height: HEIGHT,
    towns,
    roads,
    port: id(0),
    rails: [{ a: id(0), b: id(rail) }],
    terrain: { rivers: water, hills },
  };

  // Sizes varied as the seeded variation varies them (cut-off towns wider); the city stays dominant.
  varyTownSizes(map, rng);
  const dominant = towns.reduce((big, t) => (t.population > big.population ? t : big));
  if (dominant.id !== id(0)) return null;

  // Every town reachable by building roads: the inherited roads, plus every road
  // pathing can plan from a town to one of its three nearest.
  const terrain = buildSliceTerrain(map);
  const reach = new UnionFind(towns.map((t) => t.id));
  for (const road of roads) reach.union(road.a, road.b);
  for (let i = 0; i < spots.length; i += 1) {
    const nearest = spots.map((_, k) => k).filter((k) => k !== i).sort((a, b) => distance(spots[i]!, spots[a]!) - distance(spots[i]!, spots[b]!)).slice(0, 3);
    for (const k of nearest) {
      if (reach.connected(id(i), id(k))) continue;
      if (planCorridor(terrain, [spots[i]!, spots[k]!], "auto", new Set([0, 1]))) reach.union(id(i), id(k));
    }
  }
  if (reach.componentCount() !== 1) return null;

  return { map, setting, trunk: [id(0), id(middle), id(second)] };
}
