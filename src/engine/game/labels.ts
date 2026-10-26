import type { GameWorld } from "./types";
import { chainOf, roadChain, type ActionResult } from "./world";

// Your mark on the map (docs/brief.md, The map: the builder's canvas, "Your mark on it", 1:
// names and colours for your lines, bridges and corridors -- step 7, "can come earlier: it's
// cheap"). A route of yours can have a name and a colour, and its vehicles take that colour on
// the map, so your network reads as lines, not as one blue. A road can have a name ("the Kabba
// Expressway"), drawn along it. Nothing in the simulation reads them: they're yours. Recorded
// in the run file as `label` actions, so a replay keeps them.

/** The colours a line can have: distinct from the danfos' yellow, the goods' brown and each other. */
export const LINE_COLOURS = ["#2a78d6", "#1baf7a", "#6250d6", "#eb6834", "#c2255c", "#2b8a3e", "#0c8599", "#862e9c"] as const;

export interface Label {
  name?: string;
  colour?: string;
}

/** A route's key, or a road's (by its whole road's two end towns, either way round). */
export const routeLabelKey = (routeId: string) => `route:${routeId}`;
export function roadLabelKey(a: string, b: string): string {
  return a < b ? `road:${a}|${b}` : `road:${b}|${a}`;
}
/** The label key of the whole road a piece belongs to. */
export function roadLabelKeyOf(world: GameWorld, segmentId: string): string | null {
  const chain = chainOf(world, segmentId);
  return chain ? roadLabelKey(chain.a, chain.b) : null;
}

export function labelOf(world: GameWorld, key: string): Label | undefined {
  return world.labels?.[key];
}

/** The `label` action: name (blank clears it) and colour (a route's; blank clears it). */
export function setLabel(world: GameWorld, key: string, name?: string, colour?: string): ActionResult {
  const [kind, rest] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "route") {
    if (![...world.routes, ...world.lorryRoutes].some((route) => route.id === rest)) return { ok: false, reason: "no such route" };
  } else if (kind === "road") {
    const [a, b] = rest.split("|") as [string, string];
    if (!roadChain(world, a, b)) return { ok: false, reason: "no such road" };
    if (colour) return { ok: false, reason: "a road has a name, not a colour" };
  } else return { ok: false, reason: "nothing to name" };
  if (colour && !(LINE_COLOURS as readonly string[]).includes(colour)) return { ok: false, reason: "not one of the line colours" };
  const label: Label = { ...(world.labels?.[key] ?? {}) };
  if (name !== undefined) {
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 32);
    if (clean) label.name = clean;
    else delete label.name;
  }
  if (colour !== undefined) {
    if (colour) label.colour = colour;
    else delete label.colour;
  }
  world.labels = { ...(world.labels ?? {}), [key]: label };
  return { ok: true };
}
