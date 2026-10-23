import type { RouteVerdict } from "@engine/game/world";

// A route card's one-line verdict (docs/brief.md, Information design: "a
// route verdict is at most 12 words and names one lever"). The engine picks
// the verdict (world.ts diagnoseRoute); this says it short, naming the one
// thing to do -- a key or the card's +/−. The long reason stays on the card's
// hover, for when the short one isn't enough.

export interface VerdictContext {
  verdict: RouteVerdict;
  /** "bus", "minibus" or "train": what the route runs. */
  vehicle: string;
  netPerDay: number;
  /** A dirt road on the route, named, if any (a jammed route's lever is paving it). */
  dirtRoad: string | null;
  /** A town to run a thin route through to instead, if that reaches far more trips. */
  throughTo: string | null;
}

export const MAX_VERDICT_WORDS = 12;

export function shortVerdict(c: VerdictContext): string {
  switch (c.verdict) {
    case "thin":
      if (c.throughTo) return `Thin. Run it through to ${c.throughTo} instead.`;
      return c.vehicle === "bus" ? "Thin: too few riders to fill a bus. Try a minibus." : `Thin: too few riders even for a ${c.vehicle}. Sell it (−).`;
    case "overcapacity":
      return `More seats than riders. Sell a ${c.vehicle} (−).`;
    case "jammed":
      return c.dirtRoad ? `Jammed in traffic. Pave ${c.dirtRoad} (R).` : `Jammed in traffic. Fewer ${plural(c.vehicle)} of your own (−).`;
    case "worn":
      return "Worn roads slow it. Maintain them (F).";
    case "long":
      return "Too long for its fares. End it at a nearer town.";
    case "full":
      // Full yet losing: another vehicle loses more (the OpenCode player, day 95).
      if (c.netPerDay < 0) return c.vehicle === "minibus" ? "Full but losing: a bus (B) carries more per naira." : "Full but losing: costs outrun fares. Check fuel and worn roads.";
      return "Full: riders left behind go to the danfos. Add one (+).";
    // The long reasons add "if their fares cover its cost"; short, that
    // condition has to be decided here. A route already losing money won't
    // pay for another vehicle (playtest, day 57: "another bus (+)" on Ilase ↔
    // Ilaro, 4 buses 35% full, while the receipt said the 4th lost ₦46/day).
    case "poached":
      return c.netPerDay < 0 ? "Danfos take its riders first; it loses money. Sell one (−)." : "Danfos take its riders first. More frequent service (+).";
    case "waiting":
      return c.netPerDay < 0 ? "Riders give up waiting, but it loses money. Sell one (−)." : `Riders give up waiting. Another ${c.vehicle} (+) catches them.`;
    case "healthy":
      return c.netPerDay < 0 ? `Fares don't cover its vehicles. Sell one (−).` : "Earning well.";
  }
}

const plural = (vehicle: string) => (vehicle === "train" ? "trains" : `${vehicle}es`);

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
