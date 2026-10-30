// The signal budget (docs/architecture/look.md §2, the base map's budget; Map density): the base map
// draws from at most six signal groups -- congestion, your service, the informal sector, goods,
// events, the chains -- and an overlay may add its own only while it's on. Without a budget every
// system that shipped added its own colour and its own mark, each right alone, and the late game
// summed them into noise (map 3218, day 433).
//
// Pure, so a test can hand it a render.ts with a seventh group and watch it fail; verify-look.ts
// runs it on the real files.

/** look.md §2's table of the base map's groups: group -> its tokens. */
export function budgetGroups(look: string): Map<string, string[]> {
  const at = look.indexOf("### The base map's signal budget");
  const groups = new Map<string, string[]>();
  if (at < 0) return groups;
  const table = look.slice(at, look.indexOf("\n## ", at) > 0 ? look.indexOf("\n## ", at) : undefined);
  for (const row of table.split("\n").filter((l) => /^\| [^-|]/.test(l) && !l.startsWith("| Group"))) {
    const [, name, tokens] = row.split("|").map((c) => c.trim());
    groups.set(name!, [...tokens!.matchAll(/`(--[a-z0-9-]+)`/g)].map((m) => m[1]!));
  }
  return groups;
}

/** look.md §2's signal tokens: every token named in its Signal table, the families and the budget's groups. */
export function signalTokens(look: string, groups: Map<string, string[]>): Set<string> {
  const colour = look.slice(look.indexOf("### Signal"), look.indexOf("\n## ", look.indexOf("### Signal")));
  // The terrain (`--map-*`) is the ground the signal is drawn on, not signal.
  const out = new Set([...colour.matchAll(/`(--[a-z0-9-]+)`/g)].map((m) => m[1]!).filter((t) => !t.startsWith("--map-")));
  for (const fam of ["--fuel", "--building", "--food", "--trade"]) out.add(fam);
  for (const tokens of groups.values()) for (const t of tokens) out.add(t);
  return out;
}

/** A function's whole text in a source, by name (brace-matched), or "" if absent. */
function functionText(source: string, name: string): string {
  const start = source.search(new RegExp(`function ${name}\\(`));
  if (start < 0) return "";
  let depth = 0;
  for (let i = source.indexOf("{", source.indexOf(")", start)); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/** The overlays' own passes: they may add their colours while they're on, outside the budget. */
const OVERLAY_PASSES = ["drawOverlay", "overlayMarks", "overlayCaption"];

/**
 * The signal tokens the base map's passes reach for -- `COLORS.x` (mapped to its token by render.ts's
 * COLORS table) and `token("--x")` outside the overlays' passes, and the chains' colours wherever the
 * site icons are drawn -- by group. Fails where one belongs to no group, or more than six groups are used.
 */
export function checkSignalBudget(render: string, icons: string, look: string): { used: Map<string, Set<string>>; failures: string[] } {
  const failures: string[] = [];
  const groups = budgetGroups(look);
  if (groups.size === 0) return { used: new Map(), failures: ["look.md §2 has no base-map signal budget table"] };
  const signal = signalTokens(look, groups);
  const colorsBlock = render.slice(render.indexOf("export const COLORS"), render.indexOf("};", render.indexOf("export const COLORS")));
  const tokenOf = new Map([...colorsBlock.matchAll(/(\w+): token\("(--[a-z0-9-]+)"\)/g)].map((m) => [m[1]!, m[2]!]));
  let base = colorsBlock.length ? render.replace(colorsBlock, "") : render;
  for (const name of OVERLAY_PASSES) base = base.replace(functionText(base, name), "");
  const reached = new Set<string>();
  for (const m of base.matchAll(/COLORS\.(\w+)/g)) if (tokenOf.has(m[1]!)) reached.add(tokenOf.get(m[1]!)!);
  for (const m of base.matchAll(/token\("(--[a-z0-9-]+)"\)/g)) reached.add(m[1]!);
  // The site icons paint in the chains' colours (icons.ts FAMILY_COLOR), on the base map.
  if (/drawSiteIcon\(/.test(base)) for (const m of icons.matchAll(/tokenColor\("(--(?:fuel|building|food|trade))"\)/g)) reached.add(m[1]!);
  const used = new Map<string, Set<string>>();
  for (const t of reached) {
    if (!signal.has(t)) continue; // chrome, the map's ground, the neutral greys: not signal
    const group = [...groups].find(([, tokens]) => tokens.includes(t))?.[0];
    if (!group) {
      failures.push(`signal budget: the base map uses ${t}, which is in no group of look.md §2's budget -- add it to one, or move it to an overlay`);
      continue;
    }
    used.set(group, (used.get(group) ?? new Set()).add(t));
  }
  if (used.size > 6) failures.push(`signal budget: the base map uses ${used.size} signal groups (${[...used.keys()].join(", ")}); look.md §2 allows six`);
  return { used, failures };
}
