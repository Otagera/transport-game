import type { GameWorld } from "./types";
import { railPath } from "./rail";
import { roadPath } from "./world";
import { isDirt } from "./congestion";

// The gateways (brief, The region, The gateways; agreed 2026-10-28), step 1: the seaport a real
// place. Imports land at the seaport and come up to the home city's sites (the tank farm, the
// flour mill, the steel terminal, the cement silo); exports, and their payment, go down to it. On
// 41 of 60 maps the seaport isn't the home city but a coast town 99-222 cells off -- far past a
// haulier's 40 -- so the haul is drawn as a share, not as trucks: long-haul firms bring
// `importsOverDirt` of it up the old highway, more as it's paved (`importsOverPaved` paved end to
// end), all of it once the old railway runs between the two. Where the home city is the seaport,
// or with `seaportImports` off (older runs), everything lands as before.

export interface SeaportLink {
  /** The coast town imports land at; the home city's own id where it's on the coast. */
  seaport: string;
  /** The share of imports reaching the home city, and of exports reaching the coast: 0..1. */
  share: number;
  /** How: at the home city itself, by the restored railway, by road (with the share of it paved), or not at all. */
  by: "here" | "rail" | "road" | "none";
  paved: number;
}

const seen = new WeakMap<GameWorld, { at: number; link: SeaportLink }>();

/** How well the home city is joined to its seaport, worked out once a tick. */
export function seaportLink(world: GameWorld): SeaportLink {
  const port = world.port ?? "";
  const seaport = world.seaport ?? port;
  if (!world.tuning.seaportImports || !world.port || seaport === port) return { seaport, share: 1, by: "here", paved: 1 };
  const now = world.economy.elapsedSeconds;
  const kept = seen.get(world);
  if (kept && kept.at === now) return kept.link;
  const t = world.tuning;
  let link: SeaportLink;
  if (railPath(world, port, seaport)) link = { seaport, share: 1, by: "rail", paved: 1 };
  else {
    const path = roadPath(world, port, seaport);
    if (!path) link = { seaport, share: 0, by: "none", paved: 0 };
    else {
      // Of the road's length, the share paved.
      let length = 0, paved = 0;
      for (let k = 1; k < path.nodeIds.length; k += 1) {
        const edge = world.simulation.routing.graph.get(path.nodeIds[k - 1]!)?.find((e) => e.to === path.nodeIds[k]);
        const segment = edge && world.simulation.map.segments.find((s) => s.id === edge.segmentId);
        const span = edge?.weight ?? 0; // its length (routing weights roads by their length)
        length += span;
        if (segment && !isDirt(segment)) paved += span;
      }
      const share = length > 0 ? paved / length : 0;
      const dirt = t.importsOverDirt ?? 0.6, all = t.importsOverPaved ?? 0.9;
      link = { seaport, share: dirt + (all - dirt) * share, by: "road", paved: share };
    }
  }
  seen.set(world, { at: now, link });
  return link;
}

/** The share of imports that reach the home city (1 where it's the seaport). */
export function importsArriving(world: GameWorld): number {
  return seaportLink(world).share;
}
