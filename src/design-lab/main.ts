import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";
import { buildGameTerrain } from "@engine/game/terrain";
import { DEFAULT_GAME_TUNING } from "@engine/game/tuning";
import type { GameMapDef, GameTown } from "@engine/game/types";
import { gravityDemand } from "@engine/game/world";
import { GAME_MAP } from "../game/map";

// Design lab (docs/brief.md, Information design; build step 8): a mock of the
// slice's screen where every look is a token you can switch, so a look is
// picked by trying it, not by arguing about it. Each option is either a set of
// CSS custom properties or a data- attribute on #stage (design-lab.html's CSS
// reads both), so options compose: any theme with any panel pose, any dock.
// Mark each option Keep or Drop; Export turns the picks into markdown for the
// brief, with the composed tokens.
//
// The map is the real one (src/game/map.ts, engine/game/terrain.ts for the
// hills, the engine's gravity demand for trip counts). Everything else on the
// stage -- shares, routes, money -- is a fixed, made-up mid-game state: the lab
// judges looks, not numbers.
//
// Dev-only: served at /design-lab.html by `bun run dev`, never a build input.

type Tokens = Record<string, string>;

interface Option {
  id: string;
  label: string;
  note?: string;
  tokens?: Tokens;
}

interface Group {
  /** Also the data- attribute set on #stage (data-<id>="<option id>"). */
  id: string;
  label: string;
  /** Where it comes from: the brief, the video, or what's there today. */
  why: string;
  options: Option[];
}

const GROUPS: Group[] = [
  {
    id: "theme",
    label: "Theme",
    why: "Surfaces, ink and map colours. The signal colours keep their meaning in every theme.",
    options: [
      {
        id: "paper",
        label: "Paper",
        note: "Today's slice",
        tokens: {
          "--bg": "#e6dcc5", "--grid": "transparent", "--panel-rgb": "255 253 248", "--ink": "#2b2925", "--muted": "#7a7368",
          "--line": "#d9ccae", "--informal": "#f2c200", "--home": "#a59d90", "--good": "#2b8a3e", "--bad": "#c92a2a",
          "--land": "#efe6d2", "--land-edge": "#cdbf9f", "--water": "#9ec5e0", "--road-dirt": "#b89c6a", "--road-paved": "#6f6a63",
          "--hill-rgb": "150 118 70", "--contour": "rgba(120, 90, 50, 0.45)", "--chip-bg": "rgba(255, 255, 255, 0.7)",
          "--toolbar-active-bg": "#2b2925", "--toolbar-active-ink": "#fffdf8", "--shadow": "rgba(60, 45, 20, 0.35)",
        },
      },
      {
        id: "daylight",
        label: "Daylight blueprint",
        note: "The video's storyboard",
        tokens: {
          "--bg": "#eaf1fa", "--grid": "rgba(70, 120, 190, 0.07)", "--panel-rgb": "248 251 255", "--ink": "#12233a", "--muted": "#5b6e88",
          "--line": "#c7d8ee", "--informal": "#e0a800", "--home": "#9aa6b6", "--good": "#1f8a4c", "--bad": "#d0343a",
          "--land": "#f7fafe", "--land-edge": "#b9cde6", "--water": "#bcd7f3", "--road-dirt": "#a9b8cb", "--road-paved": "#5f7593",
          "--hill-rgb": "70 110 170", "--contour": "rgba(55, 105, 175, 0.4)", "--chip-bg": "rgba(255, 255, 255, 0.75)",
          "--toolbar-active-bg": "#1f5fd6", "--toolbar-active-ink": "#ffffff", "--shadow": "rgba(40, 90, 170, 0.35)",
        },
      },
      {
        id: "night",
        label: "Night blueprint",
        note: "The video's world map; base kept grey-blue so your colour still reads",
        tokens: {
          "--bg": "#07111f", "--grid": "rgba(110, 160, 230, 0.06)", "--panel-rgb": "12 24 41", "--ink": "#e4ecf8", "--muted": "#8ea1bb",
          "--line": "#233b5b", "--informal": "#f2c200", "--home": "#6c7a8e", "--good": "#3ccf7a", "--bad": "#ff5c63",
          "--land": "#0c1b2e", "--land-edge": "#2a4568", "--water": "#133d66", "--road-dirt": "#4b6380", "--road-paved": "#8aa2c2",
          "--hill-rgb": "120 170 235", "--contour": "rgba(120, 170, 235, 0.38)", "--chip-bg": "rgba(20, 38, 62, 0.85)",
          "--toolbar-active-bg": "#e4ecf8", "--toolbar-active-ink": "#07111f", "--shadow": "rgba(0, 0, 0, 0.6)",
        },
      },
    ],
  },
  {
    id: "you",
    label: "Your colour",
    why: "The one colour that must never get lost: your routes, your riders.",
    options: [
      { id: "blue", label: "Blue", note: "Today's; weak on the night theme", tokens: { "--you": "#2f6fdb" } },
      { id: "cyan", label: "Cyan", tokens: { "--you": "#19b8e6" } },
      { id: "coral", label: "Coral", note: "Stands apart from any blue theme", tokens: { "--you": "#ff6b4a" } },
    ],
  },
  {
    id: "material",
    label: "Panel material",
    why: "Solid is today's. The video's panels are frosted; glass shows how far see-through can go.",
    options: [
      { id: "solid", label: "Solid", tokens: { "--panel-opacity": "1", "--panel-blur": "0px", "--panel-glow": "none" } },
      {
        id: "frosted",
        label: "Frosted",
        tokens: { "--panel-opacity": "0.9", "--panel-blur": "14px", "--panel-glow": "0 12px 40px rgb(40 110 220 / 0.16), inset 0 1px 0 rgb(255 255 255 / 0.35)" },
      },
      {
        id: "glass",
        label: "Glass",
        note: "Check the numbers over the map",
        tokens: { "--panel-opacity": "0.68", "--panel-blur": "20px", "--panel-glow": "0 0 0 1px rgb(120 180 255 / 0.25), 0 16px 48px rgb(40 110 220 / 0.25)" },
      },
    ],
  },
  {
    id: "pose",
    label: "Panel pose",
    why: "The video's tilted side panels. The angle is the slider below.",
    options: [
      { id: "flat", label: "Flat", tokens: { "--tilt-rest": "0", "--tilt-hover": "0" } },
      { id: "leaning", label: "Leaning, always", tokens: { "--tilt-rest": "1", "--tilt-hover": "1" } },
      { id: "rest", label: "Leans at rest, flat when you use it", tokens: { "--tilt-rest": "1", "--tilt-hover": "0" } },
    ],
  },
  {
    id: "dock",
    label: "Docking",
    why: "Panels by the side that come out on hover.",
    options: [
      { id: "open", label: "Always out", tokens: { "--dock-hide": "0", "--dock-keep": "0px" } },
      {
        id: "tucked",
        label: "Tucked at the edge, out on hover",
        note: "Hover it, tab to it, or hover a town on the map. Click the spine to pin it out.",
        tokens: { "--dock-hide": "1", "--dock-keep": "44px" },
      },
    ],
  },
  {
    id: "layout",
    label: "Panels",
    why: "Today one panel swaps between the town and your routes (render-and-ui.md §7). The video flanks the map with two.",
    options: [
      { id: "one", label: "One panel, swaps on town hover", note: "Today's rule" },
      { id: "wings", label: "Two wings: town left, routes right", note: "Would reverse a recorded decision" },
    ],
  },
  {
    id: "headline",
    label: "Headline",
    why: "Brief, What doing well means: trips made, stayed home split, your riders, budget.",
    options: [
      { id: "bar", label: "Share bar and key box", note: "Today's" },
      { id: "chips", label: "Chips with counts", note: "The video's legend chips; they are their own key" },
    ],
  },
  {
    id: "town",
    label: "Town panel",
    why: "Brief, Information design: the panel's first screen fits without scrolling.",
    options: [
      { id: "text", label: "Paragraphs", note: "Today's" },
      { id: "card", label: "Card: kicker, title, three lines, one problem, pager", note: "The video's place cards" },
    ],
  },
  {
    id: "routes",
    label: "Route rows",
    why: "Brief, text budget: a verdict is at most 12 words and names one lever.",
    options: [
      { id: "rows", label: "Rows", note: "Today's" },
      { id: "cards", label: "Cards: label, name, one-line verdict", note: "The video's room cards" },
    ],
  },
  {
    id: "type",
    label: "Type",
    why: "Labels in spaced capitals carry most of the video's look.",
    options: [
      {
        id: "system",
        label: "System",
        note: "Today's",
        tokens: {
          "--font-sans": "system-ui, sans-serif", "--font-mono": "ui-monospace, monospace", "--font-display": "system-ui, sans-serif",
          "--label-font": "system-ui, sans-serif", "--label-tracking": "0.04em", "--title-weight": "650",
        },
      },
      {
        id: "mono",
        label: "System, with mono labels",
        tokens: {
          "--font-sans": "system-ui, sans-serif", "--font-mono": "ui-monospace, monospace", "--font-display": "system-ui, sans-serif",
          "--label-font": "ui-monospace, SFMono-Regular, Menlo, monospace", "--label-tracking": "0.12em", "--title-weight": "650",
        },
      },
      {
        id: "display",
        label: "Display and mono",
        note: "Space Grotesk, Michroma for titles, JetBrains Mono for labels (web fonts)",
        tokens: {
          "--font-sans": "\"Space Grotesk\", system-ui, sans-serif", "--font-mono": "\"JetBrains Mono\", ui-monospace, monospace",
          "--font-display": "\"Michroma\", \"Space Grotesk\", sans-serif", "--label-font": "\"JetBrains Mono\", ui-monospace, monospace",
          "--label-tracking": "0.14em", "--title-weight": "400",
        },
      },
    ],
  },
  {
    id: "shape",
    label: "Corners",
    why: "Corner radius, and the video's bracket marks on cards.",
    options: [
      { id: "soft", label: "Soft", note: "Today's", tokens: { "--radius": "10px" } },
      { id: "sharp", label: "Sharp", tokens: { "--radius": "4px" } },
      { id: "marks", label: "Sharp, with corner marks", tokens: { "--radius": "4px" } },
      { id: "round", label: "Round", tokens: { "--radius": "16px" } },
    ],
  },
  {
    id: "terrain",
    label: "Terrain",
    why: "Pillar: terrain is overcome, and the price says why. The ridge has to read as a climb.",
    options: [
      { id: "blobs", label: "Shaded blobs", note: "Today's" },
      { id: "contours", label: "Contour lines" },
      { id: "contours-labels", label: "Contours, with names on the ground", note: "The video's \"HAN RIVER\"" },
    ],
  },
  {
    id: "plate",
    label: "Map plate",
    why: "principles.md, Visual direction: a diorama, a made object with edges.",
    options: [
      { id: "flat", label: "Flat sheet", note: "Today's" },
      { id: "diorama", label: "Diorama slab", note: "Visible thickness and a shadow" },
    ],
  },
  {
    id: "treasury",
    label: "Treasury",
    why: "Playtest, map 2791, day 209: 'the economy/treasury panel is needed now... that side panel has outgrown its use' (brief, Revision 3, Money, 5).",
    options: [
      { id: "inline", label: "Inside the routes panel", note: "Today's: the budget under your routes" },
      { id: "wing", label: "Its own wing, docked left", note: "Tilts and tucks like the others; pairs with One panel" },
      { id: "drawer", label: "A drawer above the toolbar", note: "A one-line tab; out on hover, four columns" },
      { id: "pop", label: "Drops from Budget in the strip", note: "Hover or click the budget figure" },
    ],
  },
  {
    id: "hint",
    label: "Control hint",
    why: "Brief, hints: find the controls without a tutorial.",
    options: [
      { id: "off", label: "Off", note: "Today's" },
      { id: "on", label: "One line above the toolbar" },
    ],
  },
];

const PRESETS: Record<string, { label: string; pick: Record<string, string>; angle: number }> = {
  current: {
    label: "Today's slice",
    angle: 10,
    pick: { theme: "paper", you: "blue", material: "solid", pose: "flat", dock: "open", layout: "one", headline: "bar", town: "text", routes: "rows", type: "system", shape: "soft", terrain: "blobs", plate: "flat", hint: "off" },
  },
  brief: {
    label: "The brief, step 8",
    angle: 10,
    pick: { theme: "paper", you: "blue", material: "solid", pose: "flat", dock: "open", layout: "one", headline: "chips", town: "card", routes: "cards", type: "mono", shape: "soft", terrain: "contours-labels", plate: "flat", hint: "on" },
  },
  daylight: {
    label: "Video, daylight",
    angle: 12,
    pick: { theme: "daylight", you: "blue", material: "frosted", pose: "rest", dock: "tucked", layout: "wings", headline: "chips", town: "card", routes: "cards", type: "display", shape: "marks", terrain: "contours-labels", plate: "diorama", hint: "on" },
  },
  night: {
    label: "Video, night",
    angle: 12,
    pick: { theme: "night", you: "cyan", material: "frosted", pose: "rest", dock: "tucked", layout: "wings", headline: "chips", town: "card", routes: "cards", type: "display", shape: "marks", terrain: "contours-labels", plate: "diorama", hint: "on" },
  },
};

type Verdict = "keep" | "drop";

interface LabState {
  pick: Record<string, string>;
  /** Panel tilt, degrees. */
  angle: number;
  /** "<group>/<option>" -> verdict; an option with none is undecided. */
  verdicts: Record<string, Verdict>;
  notes: Record<string, string>;
}

const STORAGE_KEY = "design-lab:v1";

// ---- State: localStorage remembers your verdicts; the URL hash carries the look, so a link opens it.

function defaultState(): LabState {
  return { pick: { ...PRESETS.current!.pick }, angle: PRESETS.current!.angle, verdicts: {}, notes: {} };
}

function loadState(): LabState {
  const state = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<LabState> | null;
    if (saved) Object.assign(state, saved);
  } catch {
    // No storage (private window, blocked site data): start fresh.
  }
  const hash = new URLSearchParams(location.hash.slice(1));
  for (const group of GROUPS) {
    const id = hash.get(group.id);
    if (id && group.options.some((option) => option.id === id)) state.pick[group.id] = id;
  }
  const angle = Number(hash.get("angle"));
  if (hash.has("angle") && Number.isFinite(angle)) state.angle = angle;
  return state;
}

function lookHash(state: LabState): string {
  const params = new URLSearchParams();
  for (const group of GROUPS) params.set(group.id, optionOf(group, state).id);
  params.set("angle", String(state.angle));
  return params.toString();
}

function saveState(state: LabState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Verdicts just won't survive a reload.
  }
  history.replaceState(null, "", `#${lookHash(state)}`);
}

function optionOf(group: Group, state: LabState): Option {
  return group.options.find((option) => option.id === state.pick[group.id]) ?? group.options[0]!;
}

/** Every token the current picks set, in group order: later groups win. */
function composedTokens(state: LabState): Tokens {
  const tokens: Tokens = {};
  for (const group of GROUPS) Object.assign(tokens, optionOf(group, state).tokens ?? {});
  tokens["--tilt-angle"] = `${state.angle}deg`;
  return tokens;
}

// ---- The mock world: the real map and demand, a made-up mid-game state on top.

const towns = new Map(GAME_MAP.towns.map((town) => [town.id, town]));
const townIds = [...towns.keys()].sort((a, b) => towns.get(b)!.population - towns.get(a)!.population);
const name = (id: string) => towns.get(id)!.name;

/** Trips a day between two towns, both directions: the engine's own gravity demand. */
const tripsBetween = new Map<string, number>();
for (const pair of gravityDemand(GAME_MAP.towns, DEFAULT_GAME_TUNING.demandK)) {
  const key = [pair.from, pair.to].sort().join(":");
  tripsBetween.set(key, (tripsBetween.get(key) ?? 0) + pair.rate * SECONDS_PER_GAME_DAY);
}
const trips = (a: string, b: string) => tripsBetween.get([a, b].sort().join(":")) ?? 0;

// Mid-game: you paved the trunk; two cut-off towns are still unreached.
const roads = GAME_MAP.roads.map((road) => ({ ...road, paved: road.a === "ilase" && road.b === "owode" }));
const ROUTES = [
  { a: "ilase", b: "owode", label: "Route 01 · 2 buses", income: 271, cost: 144, verdict: "Full: riders left behind go to the danfos.",
    long: "Buses leave 100% full: more riders than seats. Another bus would carry the ones left behind.", stats: "53 riders/day · buses 100% full · 95% speed",
    bar: [0.58, 0.07, 0.2, 0.15] },
  { a: "ilase", b: "ise", label: "Route 02 · 1 minibus", income: 98, cost: 63, verdict: "Thin, but a minibus pays here.",
    long: "Its trips can't fill a bus, but a minibus covers its cost on them. Leave it, or run it through to Kuto.", stats: "24 riders/day · minibus 71% full · 100% speed",
    bar: [0.46, 0.04, 0.3, 0.2] },
  { a: "kuto", b: "ise", label: "Route 03 · 1 bus", income: 100, cost: 119, verdict: "Thin: too few trips to fill a bus. Try a minibus.",
    long: "Its riders don't fill its bus: 28 riders a day for 20 seats a trip. A minibus would carry them for less, or sell it.", stats: "28 riders/day · buses 41% full · 100% speed",
    bar: [0.35, 0.05, 0.25, 0.35] },
].sort((x, y) => x.income - x.cost - (y.income - y.cost));
const served = new Set(ROUTES.map((route) => [route.a, route.b].sort().join(":")));

/** Which towns a road reaches from each town (inherited roads; you haven't built any yet). */
function component(start: string): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const road of roads) {
      const next = road.a === at ? road.b : road.b === at ? road.a : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
const reachable = (a: string, b: string) => component(a).has(b);
const isCutOff = (id: string) => component(id).size === 1;

/** Who carries a pair's trips, made up but consistent: unreachable stays home; your pairs you share. */
function pairShares(a: string, b: string): { you: number; informal: number; home: number } {
  if (!reachable(a, b)) return { you: 0, informal: 0, home: 1 };
  if (served.has([a, b].sort().join(":"))) return { you: 0.42, informal: 0.38, home: 0.2 };
  return { you: 0, informal: 0.6, home: 0.4 };
}

function townShares(id: string): { you: number; informal: number; home: number } {
  let total = 0;
  const sum = { you: 0, informal: 0, home: 0 };
  for (const other of townIds) {
    if (other === id) continue;
    const n = trips(id, other);
    const share = pairShares(id, other);
    total += n;
    sum.you += n * share.you;
    sum.informal += n * share.informal;
    sum.home += n * share.home;
  }
  return { you: sum.you / total, informal: sum.informal / total, home: sum.home / total };
}

const headline = (() => {
  const result = { you: 0, informal: 0, noRoad: 0, noSeat: 0 };
  for (let i = 0; i < townIds.length; i += 1) {
    for (let j = i + 1; j < townIds.length; j += 1) {
      const a = townIds[i]!;
      const b = townIds[j]!;
      const n = trips(a, b);
      const share = pairShares(a, b);
      result.you += n * share.you;
      result.informal += n * share.informal;
      if (reachable(a, b)) result.noSeat += n * share.home;
      else result.noRoad += n;
    }
  }
  return result;
})();

const fmt = (n: number) => Math.round(n).toLocaleString();
const naira = (n: number) => `${n < 0 ? "−" : ""}₦${fmt(Math.abs(n))}`;
const signedNaira = (n: number) => `${n < 0 ? "−" : "+"}₦${fmt(Math.abs(n))}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---- Map

/** The engine's own terrain at half-cell resolution: the same map scaled 2x, so hills come from terrain.ts. */
function fineTerrain(): { elevation: Float32Array; width: number; height: number } {
  const def: GameMapDef = {
    ...GAME_MAP,
    width: GAME_MAP.width * 2,
    height: GAME_MAP.height * 2,
    towns: GAME_MAP.towns.map((town) => ({ ...town, x: town.x * 2, y: town.y * 2 })),
    terrain: {
      rivers: (GAME_MAP.terrain?.rivers ?? []).map((river) => ({ points: river.points.map(([x, y]) => [x * 2, y * 2] as [number, number]), width: river.width * 2 })),
      hills: (GAME_MAP.terrain?.hills ?? []).map((hill) => ({ ...hill, x: hill.x * 2, y: hill.y * 2, radius: hill.radius * 2 })),
    },
  };
  const field = buildGameTerrain(def);
  return { elevation: field.elevation, width: def.width, height: def.height };
}

/** Marching squares: one path of short segments per level, in map cells. */
function contourPaths(levels: number[]): string[] {
  const { elevation, width, height } = fineTerrain();
  const at = (x: number, y: number) => elevation[y * width + x] ?? 0;
  // Corner bits: top-left 8, top-right 4, bottom-right 2, bottom-left 1. Edges: 0 top, 1 right, 2 bottom, 3 left.
  const CASES: number[][] = [[], [3, 2], [2, 1], [3, 1], [0, 1], [3, 0, 2, 1], [0, 2], [3, 0], [3, 0], [0, 2], [3, 2, 0, 1], [0, 1], [3, 1], [2, 1], [3, 2], []];
  return levels.map((level) => {
    let d = "";
    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), e = at(x, y + 1);
        const index = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (e > level ? 1 : 0);
        const edges = CASES.at(index)!;
        const point = (edge: number): string => {
          const t = (p: number, q: number) => (level - p) / (q - p);
          const [px, py] =
            edge === 0 ? [x + t(a, b), y] : edge === 1 ? [x + 1, y + t(b, c)] : edge === 2 ? [x + t(e, c), y + 1] : [x, y + t(a, e)];
          return `${(px / 2).toFixed(2)} ${(py / 2).toFixed(2)}`;
        };
        for (let k = 0; k < edges.length; k += 2) d += `M${point(edges[k]!)}L${point(edges[k + 1]!)}`;
      }
    }
    return d;
  });
}

function blobCells(): string {
  const { elevation, width, height } = fineTerrain();
  let cells = "";
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const e = elevation[y * width + x] ?? 0;
      if (e > 0.05) cells += `<rect x="${x / 2}" y="${y / 2}" width="0.52" height="0.52" fill-opacity="${Math.min(0.6, (e / 3) * 0.6).toFixed(2)}"/>`;
    }
  }
  return cells;
}

const CONTOUR_LEVELS = [0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8];
const contours = contourPaths(CONTOUR_LEVELS);
const blobs = blobCells();

function radius(town: GameTown): number {
  return Math.max(1.3, Math.sqrt(town.population) * 0.22);
}

/** A point a fraction t along the straight road a-b, pushed sideways by `side` cells. */
function along(a: string, b: string, t: number, side = 0): { x: number; y: number; angle: number } {
  const p = towns.get(a)!;
  const q = towns.get(b)!;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const length = Math.hypot(dx, dy);
  return { x: p.x + dx * t - (dy / length) * side, y: p.y + dy * t + (dx / length) * side, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

function vehicle(cls: string, a: string, b: string, t: number, side: number, length: number): string {
  const p = along(a, b, t, side);
  return `<rect class="${cls}" x="${-length / 2}" y="-0.32" width="${length}" height="0.64" rx="0.15" transform="translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${p.angle.toFixed(1)})"/>`;
}

function ring(cls: string, cx: number, cy: number, r: number, from: number, share: number): string {
  if (share <= 0) return "";
  const length = share * 100;
  return `<circle class="ring ${cls}" cx="${cx}" cy="${cy}" r="${r}" pathLength="100" stroke-dasharray="${length.toFixed(1)} ${(100 - length).toFixed(1)}" stroke-dashoffset="${(-from * 100).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`;
}

function drawMap(focus: string | null): string {
  const river = (GAME_MAP.terrain?.rivers ?? [])
    .map((r) => `<path class="river" stroke-width="${r.width}" d="M${r.points.map(([x, y]) => `${x} ${y}`).join("L")}"/>`)
    .join("");
  const roadLines = roads
    .map((road) => {
      const p = towns.get(road.a)!;
      const q = towns.get(road.b)!;
      return `<line class="road ${road.paved ? "paved" : "dirt"}" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"/>`;
    })
    .join("");
  const routeLines = ROUTES.map((route, i) => {
    // Kuto–Ise runs via Ilase: draw both legs.
    const legs = route.a === "kuto" ? [["kuto", "ilase"], ["ilase", "ise"]] : [[route.a, route.b]];
    return legs
      .map(([a, b]) => {
        const p = along(a!, b!, 0, 0.55 + i * 0.35);
        const q = along(a!, b!, 1, 0.55 + i * 0.35);
        return `<line class="route" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"/>`;
      })
      .join("");
  }).join("");
  const vehicles = [
    vehicle("bus", "ilase", "owode", 0.3, 0.55, 1.3),
    vehicle("bus", "owode", "ilase", 0.35, 0.55, 1.3),
    vehicle("bus", "ilase", "ise", 0.5, 0.9, 1),
    vehicle("danfo", "owode", "ado", 0.25, -0.4, 1),
    vehicle("danfo", "ado", "owode", 0.55, -0.4, 1),
    vehicle("danfo", "ado", "ipaja", 0.5, -0.4, 1),
    vehicle("danfo", "ilase", "kuto", 0.4, -0.4, 1),
    vehicle("danfo", "ado", "ogbe", 0.6, -0.4, 1),
    vehicle("danfo", "ilase", "owode", 0.62, -0.4, 1),
  ].join("");

  let desire = "";
  if (focus) {
    const biggest = Math.max(...townIds.filter((id) => id !== focus).map((id) => trips(focus, id)));
    for (const other of townIds) {
      if (other === focus) continue;
      const p = towns.get(focus)!;
      const q = towns.get(other)!;
      const w = 0.15 + Math.sqrt(trips(focus, other) / biggest) * 1.1;
      desire += `<line class="desire${reachable(focus, other) ? "" : " cut"}" x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke-width="${w.toFixed(2)}"/>`;
    }
  }

  const townMarks = townIds
    .map((id) => {
      const town = towns.get(id)!;
      const r = radius(town);
      const share = townShares(id);
      const rr = r + 0.55;
      return `<g data-town="${id}">
        ${ring("you", town.x, town.y, rr, 0, share.you)}
        ${ring("informal", town.x, town.y, rr, share.you, share.informal)}
        ${ring("home", town.x, town.y, rr, share.you + share.informal, share.home)}
        <circle class="town-core" data-town="${id}" cx="${town.x}" cy="${town.y}" r="${r}"/>
        <text class="town-name" x="${town.x}" y="${town.y + r + 2.4}">${town.name}</text>
        <text class="town-pop" x="${town.x}" y="${town.y + r + 3.8}">${town.population}k</text>
        ${isCutOff(id) ? `<text class="noroad" x="${town.x}" y="${town.y + r + 5.2}">no road</text>` : ""}
      </g>`;
    })
    .join("");

  return `
    <defs><filter id="lab-soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="0.7"/></filter></defs>
    <rect class="slab" x="0" y="1.4" width="100" height="64" rx="2"/>
    <rect class="land" x="0" y="0" width="100" height="64" rx="2"/>
    <g class="blobs" filter="url(#lab-soft)">${blobs}</g>
    <g class="contours">${contours.map((d, i) => `<path class="${i % 2 === 1 ? "major" : ""}" d="${d}"/>`).join("")}</g>
    ${river}
    <text class="ground" x="57" y="3" transform="rotate(84 57 3)">The river</text>
    <text class="ground" x="17.5" y="9">The ridge</text>
    ${roadLines}${routeLines}${desire}${vehicles}${townMarks}`;
}

// ---- Panels

function tripRows(id: string, limit: number): string {
  return townIds
    .filter((other) => other !== id)
    .sort((x, y) => trips(id, y) - trips(id, x))
    .slice(0, limit)
    .map((other) => {
      const share = pairShares(id, other);
      return `<div class="trip"><span>${name(other)}</span><span class="num">${fmt(trips(id, other))}/day</span>${tripBar(share.you, share.informal, share.home)}</div>`;
    })
    .join("");
}

function tripBar(you: number, informal: number, home: number): string {
  return `<div class="tripbar"><i style="width:${pct(you)};background:var(--you)"></i><i style="width:${pct(informal)};background:var(--informal)"></i><i style="width:${pct(home)};background:var(--home)"></i></div>`;
}

function townPanel(id: string): string {
  const town = towns.get(id)!;
  const share = townShares(id);
  const others = townIds.filter((other) => other !== id).sort((x, y) => trips(id, y) - trips(id, x));
  const biggest = others[0]!;
  const unreachable = others.filter((other) => !reachable(id, other));
  const stayHome = unreachable.reduce((sum, other) => sum + trips(id, other), 0);
  const role = id === GAME_MAP.port ? "Port" : town.population >= DEFAULT_GAME_TUNING.marketPopulation ? "Market town" : "Farm town";
  const inside = fmt(town.population * DEFAULT_GAME_TUNING.localTripsPerThousandPerDay);
  const problem = isCutOff(id)
    ? `No road reaches ${town.name}: ${fmt(stayHome)} trips a day stay home. The biggest is to ${name(biggest)}, ${fmt(trips(id, biggest))}/day.`
    : unreachable.length > 0
      ? `${fmt(stayHome)} trips a day to ${unreachable.map(name).join(" and ")} have no road.`
      : `${pct(share.home)} of its trips have a road but no seat.`;
  const index = townIds.indexOf(id);
  const prev = townIds.at((index - 1 + townIds.length) % townIds.length)!;
  const next = townIds.at((index + 1) % townIds.length)!;

  const text = `<div class="town-text">
      ${isCutOff(id) || unreachable.length > 0 ? `<div class="callout bad">${problem}</div>` : ""}
      <h2>${town.name} · ${town.population}k people</h2>
      <p class="hint">Trips to and from ${town.name}, both directions, biggest first. Bar: you · informal · stayed home.</p>
      <p>Of everyone leaving ${town.name} for another town: you ${pct(share.you)}, informal ${pct(share.informal)}, stayed home ${pct(share.home)}.</p>
      <p>${town.name} ${share.you >= DEFAULT_GAME_TUNING.growthMinPlayerShare ? "is growing: you carry enough of its trips for it to develop" : `is steady at ${town.population}k. It only grows once you carry at least 10% of its trips (now ${pct(share.you)})`}.</p>
      <div class="inside"><b>Inside ${town.name}:</b> ~${inside} short trips a day, all by keke and okada. Nothing you run reaches that finely, and it isn't counted against you.</div>
      ${tripRows(id, 8)}
    </div>`;

  const card = `<div class="town-card">
      <div class="label">${role} · ${town.population}k people${share.you >= DEFAULT_GAME_TUNING.growthMinPlayerShare ? " · ▲ growing" : ""}</div>
      <div class="title">${town.name}</div>
      <ul>
        <li>Biggest trip: ${name(biggest)}, ${fmt(trips(id, biggest))}/day${pairShares(id, biggest).you > 0 ? `; you carry ${pct(pairShares(id, biggest).you)}` : ""}</li>
        <li>Informal carries ${pct(share.informal)} of its trips</li>
        <li>Inside: ~${inside} short trips a day by keke and okada, not counted against you</li>
      </ul>
      <div class="callout hook marked"><div class="label" style="color:inherit">The problem here</div>${problem}</div>
      ${tripRows(id, 4)}
      <div class="pager">
        <button data-select="${prev}">‹ ${name(prev)}</button>
        <span class="dots">${townIds.map((other) => `<i class="${other === id ? "on" : ""}"></i>`).join("")}</span>
        <button data-select="${next}">${name(next)} ›</button>
      </div>
    </div>`;
  return text + card;
}

function routesPanel(): string {
  const net = ROUTES.reduce((sum, route) => sum + route.income - route.cost, 0);
  const rows = ROUTES.map((route) => {
    const routeNet = route.income - route.cost;
    const [you, poached, gaveUp, home] = route.bar;
    const bar = `<div class="tripbar"><i style="width:${pct(you!)};background:var(--you)"></i><i style="width:${pct(poached!)};background:var(--informal);opacity:.6"></i><i style="width:${pct(gaveUp!)};background:var(--informal)"></i><i style="width:${pct(home!)};background:var(--home)"></i></div>`;
    return `<div class="route-row">
        <span class="sw"></span>
        <span><span class="name">${name(route.a)} ↔ ${name(route.b)}</span><small>${route.label.split(" · ")[1]} · in ${naira(route.income)} · cost ${naira(route.cost)}</small></span>
        <span class="net num ${routeNet < 0 ? "neg" : ""}">${naira(routeNet)}</span>
        <div class="detail">${bar}<div class="${routeNet < 0 ? "neg" : ""}">${route.long}</div><small>${route.stats}</small></div>
      </div>
      <div class="route-card marked">
        <div class="top"><span class="label">${route.label}</span><span class="num ${routeNet < 0 ? "neg" : "pos"}">${signedNaira(routeNet)}/day</span></div>
        <div class="name">${name(route.a)} ↔ ${name(route.b)}</div>
        <div class="verdict">${route.verdict}</div>
        ${bar}
      </div>`;
  }).join("");
  const budget: Array<[string, number]> = [
    ["Fares", ROUTES.reduce((sum, route) => sum + route.income, 0)],
    ["Tolls", 40],
    ["Park levies (agberos kept ₦25)", 25],
    ["State allocation", 60],
    ["Running costs", -ROUTES.reduce((sum, route) => sum + route.cost, 0)],
    ["Road upkeep", -126],
  ];
  const total = budget.reduce((sum, [, n]) => sum + n, 0);
  return `<h2>Your routes</h2>
    <p class="hint">Worst first. Net over the last 5 days.</p>
    ${rows}
    <h2 class="section inline-budget">Budget, 5-day average</h2>
    <div class="budget inline-budget">${budget.map(([label, n]) => `<span>${label}</span><span class="num ${n < 0 ? "neg" : ""}">${signedNaira(n)}</span>`).join("")}
      <span class="total">Net</span><span class="total num ${total < 0 ? "neg" : "pos"}">${signedNaira(total)}/day</span>
    </div>
    <p class="hint" style="margin-top:8px">Routes net ${signedNaira(net)}; tolls, levies and the allocation make up the rest.</p>`;
}

// The Treasury (brief, Revision 3, Money, 5): every line of money, what the
// treasury and the bonds take, what you're saving for, and each chain in a
// line. Numbers from the map 2791 playtest at day 209, under the new rules
// (the levy, a refinery bond): a late game, where the side panel outgrew it.
const TREASURY = {
  // Goods at ₦0.25 a tonne a cell: 2.5x the run's ₦1,748.
  income: [["Fares", 8440], ["Goods", 4370], ["Tolls", 1180], ["Park levies (agberos kept ₦180)", 180], ["Loading levies", 25], ["State allocation", 1350]] as Array<[string, number]>,
  spending: [["Running costs", -9035], ["Fuel above the pump price", -1531], ["Road upkeep", -2207]] as Array<[string, number]>,
  /** 10% of everything earned but the allocation. */
  levy: -0.1 * (8440 + 4370 + 1180 + 180 + 25),
  bonds: [{ label: "Restoring Igbo-Ukwu Refinery", left: 48000, perDay: 1200, days: 40 }],
  saving: { label: "Rail, Abiriba – Ozubulu", held: 31000, price: 112000 },
  chains: [
    { name: "Fuel", state: "bad", line: "Agulu 6%, Ozubulu 5%, Igbo-Ukwu 14% supplied: ₦1,531/day above the pump price" },
    { name: "Cement", state: "warn", line: "Works at 121 of 121 t/day; Abiriba holds 24k people of growth back" },
    { name: "Workers", state: "good", line: "Every working site fully staffed" },
  ],
};

/** What you keep a day, after spending, the levy and the bonds. */
function treasuryKept(): number {
  const t = TREASURY;
  return t.income.reduce((sum, [, n]) => sum + n, 0) + t.spending.reduce((sum, [, n]) => sum + n, 0) + t.levy - t.bonds.reduce((sum, bond) => sum + bond.perDay, 0);
}

function treasuryHtml(columns: boolean): string {
  const row = ([label, n]: [string, number]) => `<span>${label}</span><span class="num ${n < 0 ? "neg" : ""}">${signedNaira(n)}</span>`;
  const t = TREASURY;
  const earned = t.income.reduce((sum, [, n]) => sum + n, 0);
  const spent = t.spending.reduce((sum, [, n]) => sum + n, 0);
  const bonds = t.bonds.reduce((sum, bond) => sum - bond.perDay, 0);
  const kept = earned + spent + t.levy + bonds;
  const income = `<div class="tcol"><h3>Income, a day</h3><div class="budget">${t.income.map(row).join("")}<span class="total">In</span><span class="total num">${signedNaira(earned)}</span></div></div>`;
  const spending = `<div class="tcol"><h3>Spending, a day</h3><div class="budget">${t.spending.map(row).join("")}<span class="total">Out</span><span class="total num neg">${signedNaira(spent)}</span></div></div>`;
  const treasury = `<div class="tcol"><h3>Treasury and bonds</h3><div class="budget">${row(["Levy, 10% of earnings", t.levy])}${row(["Bond repayments", bonds])}<span class="total">You keep</span><span class="total num ${kept < 0 ? "neg" : "pos"}">${signedNaira(kept)}/day</span></div>
    ${t.bonds.map((bond) => `<p class="hint">${bond.label}: ${naira(bond.left)} left, ${naira(bond.perDay)}/day for ${bond.days} more days</p>`).join("")}
    <p class="hint">Saving for ${t.saving.label}: ${naira(t.saving.held)} of ${naira(t.saving.price)}</p><div class="tripbar"><i style="width:${pct(t.saving.held / t.saving.price)};background:var(--you)"></i></div></div>`;
  const chains = `<div class="tcol"><h3>Chains</h3>${t.chains.map((chain) => `<p class="chain ${chain.state}"><b>${chain.name}</b> ${chain.line}</p>`).join("")}</div>`;
  return `<h2>Treasury</h2><p class="hint">Day 209, 5-day average. Where the money comes from and goes, and what each chain is costing you.</p>
    <div class="tgrid ${columns ? "cols" : ""}">${income}${spending}${treasury}${chains}</div>`;
}

/** The drawer's closed tab, and the strip pop's anchor: the money in one line. */
function treasuryTab(): string {
  const kept = treasuryKept();
  return `<span class="label">Treasury</span> <span class="num ${kept < 0 ? "neg" : "pos"}">${signedNaira(kept)}/day kept</span> · levy <span class="num neg">${signedNaira(TREASURY.levy)}</span> · bonds <span class="num neg">${signedNaira(-TREASURY.bonds.reduce((sum, bond) => sum + bond.perDay, 0))}</span> · <span class="chain bad"><b>Fuel</b> short in 3 towns</span>`;
}

function strip(): string {
  const made = headline.you + headline.informal;
  const total = made + headline.noRoad + headline.noSeat;
  return `
    <div class="stat"><span class="label">Day</span><span class="v num">23</span></div>
    <div class="stat budget-stat" tabindex="0"><span class="label h-bar">Funds</span><span class="label h-chips">Budget</span><span class="v num">₦4,180</span><div id="treasury-pop" class="panel">${treasuryHtml(false)}</div></div>
    <div class="stat h-bar"><span class="label">Net, last day</span><span class="v num good">₦96</span></div>
    <div class="stat h-chips"><span class="label">Net, 5-day average</span><span class="v num good">+₦142</span></div>
    <div class="share h-bar">
      <span class="label">Trips between towns: who carried them</span>
      <div class="bar"><i style="width:${pct(headline.you / total)};background:var(--you)"></i><i style="width:${pct(headline.informal / total)};background:var(--informal)"></i><i style="width:${pct((headline.noRoad + headline.noSeat) / total)};background:var(--home)"></i></div>
      <span style="font-size:12px">You ${pct(headline.you / total)} · Informal ${pct(headline.informal / total)} · Stayed home ${pct((headline.noRoad + headline.noSeat) / total)}</span>
    </div>
    <div class="stat h-bar"><span class="label">Informal sector earned</span><span class="v num">₦19,420</span></div>
    <div class="stat h-chips"><span class="label">Trips made, a day</span><span class="v num">${fmt(made)} <span class="good" style="font-size:13px">▲</span></span></div>
    <div class="chips h-chips">
      <span class="chip"><b style="background:var(--you)"></b>You <span class="num">${fmt(headline.you)}</span></span>
      <span class="chip"><b style="background:var(--informal)"></b>Informal <span class="num">${fmt(headline.informal)}</span></span>
      <span class="chip hatch"><b></b>No road <span class="num">${fmt(headline.noRoad)}</span></span>
      <span class="chip"><b style="background:var(--home)"></b>No seat <span class="num">${fmt(headline.noSeat)}</span></span>
    </div>`;
}

function toolbar(): string {
  const group = (cap: string, buttons: string) => `<div class="group"><span class="label cap">${cap}</span><div class="btns">${buttons}</div></div>`;
  return (
    group("On roads", `<button class="active">Bus<kbd>B</kbd></button><button>Minibus<kbd>M</kbd></button>`) +
    group("Build", `<button>Road<kbd>R</kbd></button>`) +
    group("Time", `<button>Pause<kbd>Space</kbd></button><button class="active">1×</button><button>2×</button><button>4×</button>`)
  );
}

// ---- The lab's controls

function controls(state: LabState): string {
  const presets = Object.entries(PRESETS)
    .map(([id, preset]) => `<button data-preset="${id}">${preset.label}</button>`)
    .join("");
  const groups = GROUPS.map((group) => {
    const current = optionOf(group, state).id;
    const options = group.options
      .map((option) => {
        const key = `${group.id}/${option.id}`;
        const verdict = state.verdicts[key];
        return `<div class="opt ${option.id === current ? "on" : ""}">
            <button class="pick" data-group="${group.id}" data-option="${option.id}">${option.label}${option.note ? `<span class="note">${option.note}</span>` : ""}</button>
            <button class="verdict keep ${verdict === "keep" ? "set" : ""}" data-verdict="keep" data-key="${key}" title="Keep">Keep</button>
            <button class="verdict drop ${verdict === "drop" ? "set" : ""}" data-verdict="drop" data-key="${key}" title="Drop">Drop</button>
          </div>`;
      })
      .join("");
    const slider =
      group.id === "pose"
        ? `<label class="slider">Angle <input type="range" min="0" max="20" step="1" value="${state.angle}" data-angle /> <span>${state.angle}°</span></label>`
        : "";
    const note = state.notes[group.id] ?? "";
    return `<section class="group">
        <h2>${group.label}</h2>
        <p class="why">${group.why}</p>
        ${options}${slider}
        <details ${note ? "open" : ""}><summary>Note</summary><textarea data-note="${group.id}" placeholder="What works, what doesn't">${escapeHtml(note)}</textarea></details>
      </section>`;
  }).join("");
  return `<h1>Design lab</h1>
    <p class="lede">Pick a look per group; the stage updates live. Mark options Keep or Drop as you go. Picks save in this browser, and the URL opens this exact look.</p>
    <div class="row">${presets}</div>
    <div class="row"><button data-export>Export picks</button><button data-copylink>Copy link to this look</button><button data-clear>Clear verdicts</button></div>
    ${groups}`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function exportMarkdown(state: LabState): string {
  const verdictOf = (group: Group, option: Option) => state.verdicts[`${group.id}/${option.id}`] ?? "";
  const rows = GROUPS.map((group) => {
    const option = optionOf(group, state);
    return `| ${group.label} | ${option.label} | ${verdictOf(group, option) || "—"} |`;
  }).join("\n");
  const list = (verdict: Verdict) =>
    GROUPS.flatMap((group) => group.options.filter((option) => verdictOf(group, option) === verdict).map((option) => `${group.label}: ${option.label}`));
  const notes = GROUPS.filter((group) => (state.notes[group.id] ?? "").trim())
    .map((group) => `- **${group.label}:** ${state.notes[group.id]!.trim()}`)
    .join("\n");
  const tokens = Object.entries(composedTokens(state))
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");
  const structure = GROUPS.map((group) => `data-${group.id}="${optionOf(group, state).id}"`).join(" ");
  return `# Design lab picks, ${new Date().toISOString().slice(0, 10)}

Open this look: \`/design-lab.html#${lookHash(state)}\`

## The look on screen

| Group | Pick | Verdict |
|---|---|---|
${rows}

Panel tilt: ${state.angle}°.

## Every verdict

- **Keep:** ${list("keep").join("; ") || "none yet"}
- **Drop:** ${list("drop").join("; ") || "none yet"}
${notes ? `\n## Notes\n\n${notes}\n` : ""}
## Tokens for this look

\`\`\`css
#stage {
${tokens}
}
\`\`\`

Structure switches: \`${structure}\`
`;
}

// ---- Wiring

const lab = document.querySelector<HTMLElement>("#lab")!;
const stage = document.querySelector<HTMLElement>("#stage")!;
const map = document.querySelector<SVGSVGElement>("#lab-map")!;
const stripEl = document.querySelector<HTMLElement>("#lab-strip")!;
const leftWing = document.querySelector<HTMLElement>("#wing-left")!;
const rightWing = document.querySelector<HTMLElement>("#wing-right")!;
const treasuryWing = document.querySelector<HTMLElement>("#wing-treasury")!;
const treasuryDrawer = document.querySelector<HTMLElement>("#treasury-drawer")!;
const dialog = document.querySelector<HTMLDialogElement>("#export")!;

const state = loadState();
let hoverTown: string | null = null;
/** Clicked on the map or paged to: its desire lines stay drawn. Until then the town panel shows Ilase, with none. */
let selectedTown: string | null = null;
let leaveTimer: number | undefined;

function applyLook(): void {
  for (const group of GROUPS) stage.dataset[group.id] = optionOf(group, state).id;
  for (const [key, value] of Object.entries(composedTokens(state))) stage.style.setProperty(key, value);
}

function renderStage(): void {
  const wings = state.pick.layout === "wings";
  map.innerHTML = drawMap(hoverTown ?? selectedTown);
  // One panel: it shows the hovered town, else your routes. Two wings: town left, routes right.
  const townId = hoverTown ?? selectedTown ?? "ilase";
  const right = !wings && hoverTown ? townPanel(hoverTown) : routesPanel();
  rightWing.querySelector(".wing-body")!.innerHTML = right;
  leftWing.querySelector(".wing-body")!.innerHTML = wings ? townPanel(townId) : "";
  const net = ROUTES.reduce((sum, route) => sum + route.income - route.cost, 0);
  rightWing.querySelector(".spine")!.innerHTML =
    !wings && hoverTown ? `<span class="label">${name(hoverTown)}</span>` : `<span class="label">Your routes</span><span class="num">${signedNaira(net)}</span>`;
  leftWing.querySelector(".spine")!.innerHTML = `<span class="label">${name(townId)}</span><span class="num">${towns.get(townId)!.population}k</span>`;
  treasuryWing.querySelector(".wing-body")!.innerHTML = treasuryHtml(false);
  treasuryWing.querySelector(".spine")!.innerHTML = `<span class="label">Treasury</span><span class="num">${signedNaira(treasuryKept())}/day</span>`;
  treasuryDrawer.innerHTML = `<div class="tab">${treasuryTab()}</div><div class="drawer-body">${treasuryHtml(true)}</div>`;
  // A town hovered on the map brings its panel out, even when tucked.
  (wings ? leftWing : rightWing).classList.toggle("out", hoverTown !== null);
  (wings ? rightWing : leftWing).classList.remove("out");
}

function renderControls(): void {
  lab.innerHTML = controls(state);
}

function update(): void {
  applyLook();
  renderStage();
  renderControls();
  saveState(state);
}

lab.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("button");
  if (!target) return;
  if (target.dataset.group && target.dataset.option) state.pick[target.dataset.group] = target.dataset.option;
  else if (target.dataset.verdict && target.dataset.key) {
    const verdict = target.dataset.verdict as Verdict;
    if (state.verdicts[target.dataset.key] === verdict) delete state.verdicts[target.dataset.key];
    else state.verdicts[target.dataset.key] = verdict;
  } else if (target.dataset.preset) {
    const preset = PRESETS[target.dataset.preset]!;
    state.pick = { ...preset.pick };
    state.angle = preset.angle;
  } else if (target.hasAttribute("data-clear")) {
    state.verdicts = {};
  } else if (target.hasAttribute("data-export")) {
    dialog.querySelector("textarea")!.value = exportMarkdown(state);
    dialog.showModal();
    return;
  } else if (target.hasAttribute("data-copylink")) {
    void copy(location.href);
    return;
  } else return;
  update();
});

lab.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (target.dataset.note) {
    state.notes[target.dataset.note] = target.value;
    saveState(state);
  } else if (target.hasAttribute("data-angle")) {
    state.angle = Number(target.value);
    target.nextElementSibling!.textContent = `${state.angle}°`;
    applyLook();
    saveState(state);
  }
});

map.addEventListener("mouseover", (event) => {
  const id = (event.target as Element).closest<SVGElement>("[data-town]")?.dataset.town;
  if (!id || id === hoverTown) return;
  window.clearTimeout(leaveTimer);
  hoverTown = id;
  renderStage();
});

map.addEventListener("mouseout", (event) => {
  if (!(event.target as Element).closest("[data-town]")) return;
  // A beat before letting go, so the pointer can travel to the panel that came out.
  window.clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(() => {
    hoverTown = null;
    renderStage();
  }, 450);
});

map.addEventListener("click", (event) => {
  // A town keeps its desire lines drawn; empty ground lets go.
  selectedTown = (event.target as Element).closest<SVGElement>("[data-town]")?.dataset.town ?? null;
  renderStage();
});

for (const wing of [leftWing, rightWing]) {
  wing.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest(".spine")) wing.classList.toggle("pinned");
    const select = target.closest<HTMLElement>("[data-select]")?.dataset.select;
    if (select) {
      selectedTown = select;
      hoverTown = null;
      renderStage();
    }
  });
  wing.addEventListener("mouseenter", () => window.clearTimeout(leaveTimer));
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard blocked: the export dialog's text is selectable by hand.
  }
}

document.querySelector("#copy")!.addEventListener("click", () => {
  const area = dialog.querySelector("textarea")!;
  area.select();
  void copy(area.value);
});
document.querySelector("#close")!.addEventListener("click", () => dialog.close());

stripEl.innerHTML = strip();
document.querySelector("#lab-toolbar")!.innerHTML = toolbar();
update();
