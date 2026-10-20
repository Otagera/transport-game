import type { SliceWorld } from "./types";
import type { ActionResult } from "./world";
import { canAfford } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";
import { refreshDemand } from "./settlement";

// Expanding a site (docs/brief.md, Revision 3, money, from the map 2411
// playtest: day 216, ₦193,748 held and "Cement: 8 towns held back" by a
// works at full capacity -- money with nothing worth buying). Pay to add a
// line to the refinery, the cement works, the mill or the flour mill:
// `expandStep` more capacity a time, up to `expandMaxLevel` times, each
// dearer than the last (`expandCostGrowth`). A bigger site wants more of its
// input and employs more people, and an expanded works lets one more
// limestone quarry open at a time (industries.ts).

export const EXPANDABLE = new Set(["refinery", "works", "mill", "flourmill"]);

/** How many times a site has been expanded. */
export function expandLevel(world: SliceWorld, siteId: string): number {
  return world.expansions.get(siteId) ?? 0;
}

/** A site's capacity and workforce, against what it was built with: 1 unexpanded. */
export function siteScale(world: SliceWorld, siteId: string): number {
  const level = expandLevel(world, siteId);
  return level === 0 ? 1 : 1 + world.tuning.expandStep * level;
}

/** What the next expansion costs; null when it can't be expanded further, or isn't a site that can. */
export function expandCost(world: SliceWorld, siteId: string): number | null {
  const site = world.towns.get(siteId);
  if (!site?.industry || !EXPANDABLE.has(site.industry)) return null;
  const level = expandLevel(world, siteId);
  if (level >= world.tuning.expandMaxLevel) return null;
  const t = world.tuning;
  const base = site.industry === "refinery" ? t.refineryRestoreCost : site.industry === "works" ? t.worksRestoreCost : t.millExpandCost;
  return Math.round(base * t.expandCostShare * t.expandCostGrowth ** level);
}

export function checkExpand(world: SliceWorld, siteId: string): ActionResult {
  if (!world.tuning.expandEnabled) return { ok: false, reason: SWITCHED_OFF };
  const site = world.towns.get(siteId);
  const cost = expandCost(world, siteId);
  if (!site || cost === null) return { ok: false, reason: "it can't be expanded further" };
  if ((site.industry === "refinery" && !world.fuel?.restored) || (site.industry === "works" && !world.cement?.working)) return { ok: false, reason: "restore it first" };
  if (!canAfford(world.economy, cost)) return { ok: false, reason: "can't afford it" };
  return { ok: true };
}

/** Adds a line to the site: more capacity, more input wanted, more jobs. */
export function expandSite(world: SliceWorld, siteId: string): ActionResult & { charged?: number } {
  const check = checkExpand(world, siteId);
  if (!check.ok) return check;
  const cost = expandCost(world, siteId)!;
  world.economy.funds -= cost;
  world.expansions.set(siteId, expandLevel(world, siteId) + 1);
  refreshDemand(world); // its new workers commute (workers.ts)
  return { ok: true, charged: cost };
}
