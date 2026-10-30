import type { GameWorld } from "./types";
import { railPath } from "./rail";
import { roadPath } from "./world";
import { isDirt } from "./congestion";
import { epoch } from "./epoch";

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

const seen = new WeakMap<GameWorld, { at: number; epoch: number; link: SeaportLink }>();

/** How well the home city is joined to its seaport, worked out once a tick. */
export function seaportLink(world: GameWorld): SeaportLink {
  const port = world.port ?? "";
  const seaport = world.seaport ?? port;
  if (!world.tuning.seaportImports || !world.port || seaport === port) return { seaport, share: 1, by: "here", paved: 1 };
  const now = world.economy.elapsedSeconds;
  const kept = seen.get(world);
  // The clock and the epoch (epoch.ts): a reading taken between ticks isn't the next tick's.
  if (kept && kept.at === now && kept.epoch === epoch(world)) return kept.link;
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
  seen.set(world, { at: now, epoch: epoch(world), link });
  return link;
}

/** The share of imports that reach the home city (1 where it's the seaport). */
export function importsArriving(world: GameWorld): number {
  return seaportLink(world).share;
}

/** A farm town's way out for its cash crop: to the home city (and on to the seaport) or to the border. */
export interface ExportGateway {
  to: string;
  /** Paid a tonne arriving there. */
  pay: number;
}

const ways = new WeakMap<GameWorld, { at: number; epoch: number; byTown: Map<string, ExportGateway> }>();

/**
 * Goods leave by whichever gateway nets more a tonne by what's built (brief, The gateways): its pay
 * less the goods fare to get it there by road. The sea pays `exportPayPerTonne` times the share
 * that reaches the coast (seaportLink); the border (border.ts) `borderPayShare` of it, by the road
 * to it. No road to either: the home city, as before. Without a border, the home city always.
 */
export function exportGateway(world: GameWorld, townId: string): ExportGateway | null {
  const port = world.port;
  if (!port) return null;
  const t = world.tuning;
  const sea = { to: port, pay: t.exportPayPerTonne * importsArriving(world) };
  if (!world.border || !world.towns.has(world.border)) return sea;
  const now = world.economy.elapsedSeconds;
  let kept = ways.get(world);
  if (!kept || kept.at !== now || kept.epoch !== epoch(world)) ways.set(world, (kept = { at: now, epoch: epoch(world), byTown: new Map() }));
  const known = kept.byTown.get(townId);
  if (known) return known;
  const border = { to: world.border, pay: t.exportPayPerTonne * (t.borderPayShare ?? 0.7) };
  const net = (way: ExportGateway) => {
    const path = townId === way.to ? { distance: 0 } : roadPath(world, townId, way.to);
    return path ? way.pay - path.distance * t.goodsFarePerTonneCell : -Infinity;
  };
  const way = net(border) > net(sea) ? border : sea;
  kept.byTown.set(townId, way);
  return way;
}

// --- Growing the port (brief, The region: "its handling (tonnes a day) is a rung like a road's") --
// Imports were set at day 1's need -- the tank farm brings in 100% of what the towns burned on day
// 1 -- so as towns grow, the only answer to the shortage that follows was the refinery. The port's
// rungs are the other: a deep-water berth lands `portImportScale[1]` of day 1's need, a container
// terminal `[2]`, bought once each at the seaport (or the coast road's gateway). The link's share
// still applies on top: a bigger port up a dirt road still loses its 40%. Behind `portRungs`
// (absent in older runs: off, every import at day 1's need).

/** How much the port lands, as a multiple of day 1's need: 1 until it's grown. */
export function portScale(world: GameWorld): number {
  const t = world.tuning;
  if (!t.portRungs) return 1;
  return t.portImportScale?.[world.portLevel ?? 0] ?? 1;
}

/** The next rung's name and price; null at the top or switched off. */
export function nextPortRung(world: GameWorld): { name: string; price: number; scale: number } | null {
  const t = world.tuning;
  if (!t.portRungs || !world.port) return null;
  const level = world.portLevel ?? 0;
  const price = t.portUpgradeCosts?.[level];
  const scale = t.portImportScale?.[level + 1];
  if (price === undefined || scale === undefined) return null;
  return { name: level === 0 ? "a deep-water berth" : "a container terminal", price, scale };
}

export function upgradePort(world: GameWorld): { ok: boolean; reason?: string; charged?: number } {
  const next = nextPortRung(world);
  if (!next) return { ok: false, reason: world.tuning.portRungs ? "the port is as big as it gets" : "switched off" };
  if (world.economy.funds < next.price) return { ok: false, reason: "can't afford it" };
  world.economy.funds -= next.price;
  world.portLevel = (world.portLevel ?? 0) + 1;
  return { ok: true, charged: next.price };
}

// --- Fuel over the border ------------------------------------------------------------------
// Where the crossing is to Benin (Idiroko) or Niger (Jibia), cheap fuel comes over it informally
// (kpayo, as it does), `borderFuelShare` of day 1's need, carried by tanker from the crossing to the
// towns in reach (fuel.ts fuelFlows). Cameroon's crossings bring none. Behind `borderFuel` (absent
// in older runs: none).

/** The border site fuel comes over, or null. */
export function borderFuelSite(world: GameWorld): string | null {
  if (!world.tuning.borderFuel || !world.border) return null;
  const name = world.towns.get(world.border)?.name ?? "";
  return name.startsWith("Idiroko") || name.startsWith("Jibia") ? world.border : null;
}
