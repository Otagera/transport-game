// The look's checks (docs/architecture/look.md §9), run by `bun run verify`, so the visual
// contract holds without anyone remembering it:
//   - no literals: a hex colour, rgb()/rgba(), a px font-size or px spacing in src/game/ or
//     index.html outside src/game/styles/tokens.css (the one source; TS reads it);
//   - four roles: a button made with a class outside look.md §5's (primary, quiet, toggle, tool,
//     and the toggle's state, on / active);
//   - tokens agree: tokens.css and look.md §2's tables name the same value for each token;
//   - signal untouched: the same, for the signal layer -- its values change only with its rows;
//   - nothing over the plate: only the page's regions are position: fixed; the rest is #plate-overlay's;
//   - the signal budget: the base map draws from at most six signal groups (scripts/signal-budget.ts).
//
//   bun scripts/verify-look.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkSignalBudget } from "./signal-budget";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const failures: string[] = [];

/** Files allowed literals for now, each with its reason; empty since the 3D view read the tokens (2026-10-30). */
const PENDING_3D = new Set<string>();

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = `${dir}/${name}`;
    if (statSync(join(ROOT, p)).isDirectory()) files(p, out);
    else if (/\.(ts|css)$/.test(name)) out.push(p);
  }
  return out;
}

/** The text with comments blanked (kept line for line), so a colour named in a comment isn't one used. */
function code(text: string, css: boolean): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (!css) out = out.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, pre: string) => pre + blank(m.slice(pre.length)));
  return out;
}

// --- No literals ------------------------------------------------------------------------------
const LITERALS: Array<{ what: string; re: RegExp; css?: boolean }> = [
  { what: "a hex colour", re: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g },
  { what: "a three.js hex colour", re: /\b0x[0-9a-fA-F]{6}\b/g },
  { what: "an rgb() colour", re: /\brgba?\(\s*\d/g },
  { what: "a px font size", re: /font-size:\s*-?\d+(?:\.\d+)?px|font:[^;"`]*?\b\d+(?:\.\d+)?px|\b\d+(?:\.\d+)?px\s+(?:ui-monospace|system-ui|sans-serif|serif|monospace)/g },
  { what: "px spacing", re: /\b(?:padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?\s*:\s*[^;"`}]*?\b[1-9]\d*(?:\.\d+)?px/g },
];
const scanned = [...files("src/game"), "index.html"].filter((p) => p !== "src/game/styles/tokens.css");
const pending = new Map<string, number>();
for (const p of scanned) {
  const text = code(read(p), p.endsWith(".css"));
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const { what, re } of LITERALS) {
      for (const m of line.matchAll(re)) {
        if (PENDING_3D.has(p)) {
          pending.set(p, (pending.get(p) ?? 0) + 1);
          continue;
        }
        failures.push(`no literals: ${p}:${i + 1}: ${what} "${m[0]}" -- use a token from tokens.css`);
      }
    }
  });
}

// --- Four roles -------------------------------------------------------------------------------
const ROLES = new Set(["primary", "quiet", "toggle", "tool", "on", "active"]);
for (const p of [...files("src/game").filter((f) => f.endsWith(".ts")), "index.html"]) {
  const text = code(read(p), false);
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/<button\b[^>]*?\bclass="([^"$]*)"/g)) {
      for (const c of m[1]!.split(/\s+/).filter(Boolean)) if (!ROLES.has(c)) failures.push(`four roles: ${p}:${i + 1}: a button of class "${c}" -- look.md §5 has primary, quiet, toggle, tool`);
    }
  });
}

// --- Nothing fixed over the plate ---------------------------------------------------------------
// Only the page's own regions are position: fixed -- the map, the strip, the two columns, the
// toolbar, the full screens, the pointer's tooltip, and the plate's one overlay container; anything
// over the map is that container's child (look.md §6).
const FIXED_OK = new Set(["#map", "#strip", "#controls-col, #panel-col", "#toolbar", "#plate-overlay", "#revenue", "#verdict", "#loading", "#tip", "#revenue, #verdict"]);
for (const p of files("src/game/styles").filter((f) => f.endsWith(".css"))) {
  const text = code(read(p), true);
  for (const m of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/position:\s*fixed/.test(m[2]!)) continue;
    const selector = m[1]!.trim().replace(/\s+/g, " ");
    if (!FIXED_OK.has(selector)) failures.push(`nothing over the plate: ${p}: "${selector}" is position: fixed -- make it a child of #plate-overlay`);
  }
}
for (const p of files("src/game").filter((f) => f.endsWith(".ts"))) {
  const lines = code(read(p), false).split("\n");
  lines.forEach((line, i) => {
    // The 3D view's host fills the window as the 2D map does.
    if (/position:\s*fixed/.test(line) && !(p === "src/game/view3d.ts" && line.includes("host.style"))) failures.push(`nothing over the plate: ${p}:${i + 1}: position: fixed -- make it a child of #plate-overlay`);
  });
}

// --- Tokens agree, signal untouched -----------------------------------------------------------
const look = read("docs/architecture/look.md");
const section = (title: string) => look.slice(look.indexOf(title), look.indexOf("\n## ", look.indexOf(title) + 1));
const FAMILY: Record<string, string> = { fuel: "--fuel", building: "--building", food: "--food", trade: "--trade" };
function tableTokens(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of text.split("\n").filter((l) => l.startsWith("| `--") || l.startsWith("| site families"))) {
    const cells = row.split("|").map((c) => c.trim());
    if (cells[1] === "site families") {
      for (const m of cells[2]!.matchAll(/`(#[0-9A-Fa-f]{6})` (\w+)/g)) if (FAMILY[m[2]!]) out.set(FAMILY[m[2]!]!, m[1]!.toLowerCase());
      continue;
    }
    const names = [...cells[1]!.matchAll(/`(--[a-z0-9-]+)`/g)].map((m) => m[1]!);
    const values = [...cells[2]!.matchAll(/`(#[0-9A-Fa-f]{6})`/g)].map((m) => m[1]!.toLowerCase());
    names.forEach((n, k) => values[k] && out.set(n, values[k]!));
  }
  return out;
}
const css = read("src/game/styles/tokens.css");
const defined = new Map([...css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
const colour = section("## 2. Colour");
const chrome = tableTokens(colour.slice(0, colour.indexOf("### Signal")));
const signal = tableTokens(colour.slice(colour.indexOf("### Signal")));
for (const [layer, table] of [["tokens agree", chrome], ["signal untouched", signal]] as const) {
  if (table.size === 0) failures.push(`${layer}: look.md §2's table couldn't be read`);
  for (const [name, value] of table) {
    const has = defined.get(name);
    if (has === undefined) failures.push(`${layer}: ${name} is in look.md §2 but not in tokens.css`);
    else if (has !== value) failures.push(`${layer}: ${name} is ${has} in tokens.css, ${value} in look.md §2 -- change both, or neither`);
  }
}

// --- The signal budget (look.md §2): six groups on the base map ----------------------------------
const budget = checkSignalBudget(read("src/game/render.ts"), read("src/game/icons.ts"), look);
failures.push(...budget.failures);

for (const [p, n] of pending) console.log(`pending (the look, step 5): ${p} still has ${n} colour literals`);
if (failures.length > 0) {
  console.error(`${failures.length} look check${failures.length === 1 ? "" : "s"} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("OK: the look's checks pass (look.md §9)");
