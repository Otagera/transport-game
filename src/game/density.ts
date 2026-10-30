// Map density (docs/architecture/look.md, Map density): what the map draws, and when. Kept apart
// from the canvas so it can be tested. Three zoom tiers decide what draws at all; one label
// placer, with a priority order, decides where text goes -- a strike takes the space a road name
// had, never the other way -- and three or more of a kind in one place collapse into a chip.

export type Tier = "far" | "mid" | "near";

/**
 * The tiers by zoom over fitting the whole map (markScale², 1 at fit and never below it): far
 * from fit to `mid`, mid to `near`, near past it. "far below 1" (the proposal) would never happen.
 */
export const TIER_AT = { mid: 1.4, near: 2 };

export function tierOf(zoom: number, at = TIER_AT): Tier {
  return zoom >= at.near ? "near" : zoom >= at.mid ? "mid" : "far";
}

/** What may draw on the map, by kind. */
export type Layer =
  | "townMark" | "townName" | "villageName"
  | "siteIcon" | "siteName"
  | "ruin" | "roadName" | "ford" | "event" | "taken"
  | "vehiclesOneByOne" | "wardens";

const RANK: Record<Tier, number> = { far: 0, mid: 1, near: 2 };
/** The tier each layer first draws at (look.md, Map density). */
const FROM: Record<Layer, Tier> = {
  townMark: "far", // every town's mark: a village is a dot from the start, so a day-1 map isn't emptier
  townName: "far", // a regional town's or the city's
  event: "far", // a strike, a flood, a ford closing: happening now
  siteIcon: "far", // at far, only where it fits (the placer, lowest priority) or the panel points at it
  villageName: "mid",
  ford: "mid",
  taken: "mid",
  siteName: "near",
  roadName: "near",
  ruin: "near",
  vehiclesOneByOne: "near",
  wardens: "near",
};

/** Whether a layer draws at a tier; something selected, pointed at or waiting on you draws at any. */
export function drawsAt(tier: Tier, layer: Layer, lit = false): boolean {
  return lit || RANK[tier] >= RANK[FROM[layer]];
}

// --- One label placer ---------------------------------------------------------------------------

export interface Box { x0: number; y0: number; x1: number; y1: number }

/** Priority, highest first (1): an action in progress, then what's happening, then what you asked for, then standing state. */
export const PRIORITY = { ghost: 1, event: 2, lit: 3, taken: 4, townName: 5, siteName: 6, roadName: 7, ruin: 8, siteIcon: 9 } as const;

export interface Claim {
  id: string;
  kind: string;
  priority: number;
  box: Box;
  /** Where it's about, for collapsing a crowd of its kind (a screen point). */
  at: { x: number; y: number };
}

export interface Chip { kind: string; count: number; ids: string[]; at: { x: number; y: number }; box: Box }

const overlap = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export interface CollapseRule {
  kind: string;
  /** Screen pixels: claims this close (chained) are one crowd. */
  radius: number;
  /** A crowd this big or bigger becomes one chip. */
  min: number;
  /** The chip's box for a count at a point. */
  chipBox: (at: { x: number; y: number }, count: number) => Box;
}

/**
 * Every label claims a box first; then they're resolved together -- highest priority first, a claim
 * placed only where it clears everything already placed -- and only then painted. So order of
 * claiming doesn't matter: a road name claimed before a strike still gives way to it. Crowds of a
 * collapsible kind become one chip ("5 taken") before placing.
 */
export class Placer {
  private claims: Claim[] = [];

  claim(c: Claim): void {
    this.claims.push(c);
  }

  resolve(rules: CollapseRule[] = []): { placed: Set<string>; chips: Chip[] } {
    let claims = this.claims;
    const chips: Chip[] = [];
    for (const rule of rules) {
      const mine = claims.filter((c) => c.kind === rule.kind);
      const crowd = new Map<string, number>();
      // Single-linkage crowds: a claim joins any crowd within `radius` of a member.
      const groups: Claim[][] = [];
      for (const c of mine) {
        const near = groups.filter((g) => g.some((m) => Math.hypot(m.at.x - c.at.x, m.at.y - c.at.y) <= rule.radius));
        const merged = [c, ...near.flat()];
        for (const g of near) groups.splice(groups.indexOf(g), 1);
        groups.push(merged);
      }
      for (const g of groups) {
        if (g.length < rule.min) continue;
        for (const m of g) crowd.set(m.id, 1);
        const at = { x: g.reduce((s, m) => s + m.at.x, 0) / g.length, y: g.reduce((s, m) => s + m.at.y, 0) / g.length };
        chips.push({ kind: rule.kind, count: g.length, ids: g.map((m) => m.id), at, box: rule.chipBox(at, g.length) });
      }
      claims = claims.filter((c) => !crowd.has(c.id));
      for (const chip of chips.filter((x) => x.kind === rule.kind)) claims.push({ id: `chip:${rule.kind}:${chip.ids[0]}`, kind: `${rule.kind}-chip`, priority: mine[0]?.priority ?? PRIORITY.siteIcon, box: chip.box, at: chip.at });
    }
    const placed: Box[] = [];
    const won = new Set<string>();
    // Highest priority first; ties in the order claimed (largest town first, as the callers claim them).
    const order = claims.map((c, i) => ({ c, i })).sort((p, q) => p.c.priority - q.c.priority || p.i - q.i);
    for (const { c } of order) {
      if (placed.some((b) => overlap(b, c.box))) continue;
      placed.push(c.box);
      won.add(c.id);
    }
    return { placed: won, chips: chips.filter((chip) => won.has(`chip:${chip.kind}:${chip.ids[0]}`)) };
  }
}
