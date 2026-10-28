import type { GameWorld } from "./types";
import { addSite, dry, nearestDistance } from "./fuel";
import { inheritedRoad } from "./cement";
import { isCutOff } from "./world";
import { rebuildNetworks } from "./rail";
import { refreshDemand } from "./settlement";

// The gateways, step 2 (brief, The region, The gateways): one border crossing a map, on the edge
// that faces the neighbouring country as that part of Nigeria does, by the towns nearest it,
// on an old road to it. What crosses it: cash crops, which leave by whichever gateway nets more a
// tonne (gateways.ts exportGateway). Placed at the start like the chains' sites, behind
// `borderCrossing` (absent in older runs: no border).

const CROSSINGS: Record<string, { name: string; edge: Edge }> = {
  southwest: { name: "Idiroko", edge: "west" }, // to Benin
  north: { name: "Jibia", edge: "north" }, // to Niger
  northeast: { name: "Banki", edge: "east" }, // to Cameroon
  middleBelt: { name: "Belegete", edge: "east" }, // to Cameroon
  southeast: { name: "Mfum", edge: "east" }, // to Cameroon
  southSouth: { name: "Mfum", edge: "east" },
};
type Edge = "north" | "west" | "east";

export const BORDER_ID = "border";

/** The country over a crossing, by its name. */
export function borderCountry(world: GameWorld): string {
  const name = world.border ? world.towns.get(world.border)?.name ?? "" : "";
  return name.startsWith("Idiroko") ? "Benin" : name.startsWith("Jibia") ? "Niger" : "Cameroon";
}

export function placeBorder(world: GameWorld): void {
  if (!world.tuning.borderCrossing || !world.home || world.border) return;
  const crossing = CROSSINGS[world.region ?? ""] ?? CROSSINGS.southwest!;
  const box = world.home;
  // By the nearest towns, the home cluster's too where it lies on that edge (Idiroko is a morning's
  // drive from Lagos), but never inside the home box: its trunk's prices are as measured.
  const near = [...world.towns.values()].filter((t) => !t.industry);
  if (!near.length) return;
  const along = (edge: Edge) => {
    const points: Array<{ x: number; y: number }> = [];
    if (edge === "north") for (let x = 8; x < world.width - 8; x += 2) points.push({ x, y: 4 });
    else for (let y = 8; y < world.height - 8; y += 2) points.push({ x: edge === "west" ? 4 : world.width - 5, y });
    return points;
  };
  const toBox = (p: { x: number; y: number }) => Math.hypot(Math.max(box.x - p.x, 0, p.x - (box.x + box.width)), Math.max(box.y - p.y, 0, p.y - (box.y + box.height)));
  // Its own edge first; where that's the sea (the north's maps still have a side coast), the next.
  for (const edge of [crossing.edge, ...(["north", "west", "east"] as Edge[]).filter((e) => e !== crossing.edge)]) {
    let best: { x: number; y: number; d: number } | null = null;
    for (const p of along(edge)) {
      if (!dry(world, p.x, p.y, 2) || toBox(p) < 3 || nearestDistance(world, p.x, p.y) < 8) continue;
      const d = Math.min(...near.map((t) => Math.hypot(t.x - p.x, t.y - p.y)));
      if (!best || d < best.d) best = { ...p, d };
    }
    // On its own edge as far as 100 cells from a town; on another only within 60.
    if (!best || best.d > (edge === crossing.edge ? 100 : 60)) continue;
    // No people of its own: a border post isn't anywhere passengers go.
    addSite(world, BORDER_ID, `${crossing.name} border`, "border", best).population = 0;
    world.border = BORDER_ID;
    // The old road to the nearest town on the network.
    const town = [...world.towns.values()].filter((t) => !t.industry && !isCutOff(world, t.id)).sort((p, q) => Math.hypot(p.x - best!.x, p.y - best!.y) - Math.hypot(q.x - best!.x, q.y - best!.y))[0];
    if (town) inheritedRoad(world, "border-road", BORDER_ID, town.id);
    // The networks rebuilt with every inherited road in them -- this one, and the ridge field's,
    // which placeRidgeField (crossings.ts) adds without a rebuild, so until a player's first build
    // the field's road wasn't in the routing and its town read cut off, its workers home (in new
    // games now on, from the start: +93 trips a day over 8 maps, the field's commuters).
    rebuildNetworks(world);
    world.plans = null;
    refreshDemand(world);
    return;
  }
}
