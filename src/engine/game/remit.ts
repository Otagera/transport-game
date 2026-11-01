import type { ClusterDef, GameWorld } from "./types";
import { inHome } from "./fuel";
import { clusterOf } from "./clusters";
import type { ActionSpec } from "./actions";
import { fordById } from "./floods";
import { chainOf } from "./world";

// Your remit (docs/brief.md, Chains: convergent, "The remit opens", agreed 2026-10-31). The far
// clusters are on the map from day 1 and run as they always have -- towns growing, danfos and
// hauliers working them -- because you're not building afresh; what's closed is your authority
// there. You start with the home cluster's land. A term's verdict that keeps a pledge (and isn't
// a failed term) grants an opening; the clusters nearest your remit are offered and you choose
// one (the `open` action). Openings you haven't spent wait for you.
//
// Closed, in a cluster outside your remit: stops and lines with an end there, stations, yards,
// parks, metros, paving and roads between two of its towns, restoring or expanding its sites.
// Open everywhere: looking; the inherited roads and railway your vehicles already use; a road or
// track from your remit to a closed cluster's town -- the corridor waits at its door. The seaport
// and the border posts are always yours.
//
// A cluster's land is what's nearer its regional town than the home box or any other cluster's
// regional town. Plain data on the world (`world.remit`), changed only at a verdict and by the
// `open` action, so a run file replays it. Off, and absent, in runs played before it.

export interface RemitState {
  /** The far clusters opened to you, by regional town, in the order opened. */
  open: string[];
  /** Openings granted by verdicts and not yet chosen. */
  toOpen: number;
}

/** How many clusters a verdict offers to choose from. */
const OFFERED = 2;

/** The remit applies: on in the run's tuning, with terms to open it and clusters to close. */
export function remitOn(world: GameWorld): boolean {
  return !!world.tuning.remitOpens && !!world.tuning.pledgesEnabled && !!world.remit && !!world.clusters?.length;
}

/** At a new game's start (start.ts): the home cluster only. */
export function startRemit(world: GameWorld): void {
  if (!world.tuning.remitOpens || !world.tuning.pledgesEnabled || !world.clusters?.length) return;
  world.remit = { open: [], toOpen: 0 };
}

/** The far cluster whose land a place is on, or undefined for the home cluster's. */
export function landOf(world: GameWorld, at: { x: number; y: number }): ClusterDef | undefined {
  if (inHome(world, at)) return undefined;
  const box = world.home!;
  const dx = Math.max(box.x - at.x, 0, at.x - (box.x + box.width));
  const dy = Math.max(box.y - at.y, 0, at.y - (box.y + box.height));
  let best: ClusterDef | undefined;
  let bestDistance = Math.hypot(dx, dy);
  for (const cluster of world.clusters ?? []) {
    const hub = world.towns.get(cluster.hub);
    if (!hub) continue;
    const d = Math.hypot(hub.x - at.x, hub.y - at.y);
    if (d < bestDistance) {
      best = cluster;
      bestDistance = d;
    }
  }
  return best;
}

/** The far cluster a town or site belongs to, or undefined for home: its own cluster first, then its land. */
export function clusterAt(world: GameWorld, townId: string): ClusterDef | undefined {
  const own = clusterOf(world, townId);
  if (own) return own;
  const town = world.towns.get(townId);
  return town ? landOf(world, town) : undefined;
}

/** A closed cluster: one outside your remit. */
export function isClosed(world: GameWorld, cluster: ClusterDef | undefined): boolean {
  return !!cluster && remitOn(world) && !world.remit!.open.includes(cluster.hub);
}

/** A town or site you may build at: in your remit, or the seaport or a border post (always yours). */
export function inRemit(world: GameWorld, townId: string): boolean {
  if (!remitOn(world)) return true;
  const town = world.towns.get(townId);
  if (townId === world.seaport || town?.industry === "border" || town?.industry === "gateway") return true;
  return !isClosed(world, clusterAt(world, townId));
}

/** The closed cluster a town is in, for a refusal's words. */
export function closedClusterOf(world: GameWorld, townId: string): ClusterDef | undefined {
  if (inRemit(world, townId)) return undefined;
  return clusterAt(world, townId);
}

/** Why you can't build at a town, or null when you can. */
export function outsideRemit(world: GameWorld, townId: string): string | null {
  const cluster = closedClusterOf(world, townId);
  if (!cluster) return null;
  const hub = world.towns.get(cluster.hub)?.name ?? cluster.hub;
  return `${world.towns.get(townId)?.name ?? townId} is outside your remit: ${hub}'s cluster opens at a term's verdict`;
}

/** A link between two towns (a road, track, its paving or upkeep): one end in your remit is enough -- to a closed cluster's door. */
export function linkOutsideRemit(world: GameWorld, a: string, b: string): string | null {
  if (inRemit(world, a) || inRemit(world, b)) return null;
  return outsideRemit(world, a);
}

/** A line or a place's build: every end in your remit. */
export function placesOutsideRemit(world: GameWorld, ...towns: string[]): string | null {
  for (const town of towns) {
    const why = outsideRemit(world, town);
    if (why) return why;
  }
  return null;
}

/** The closed clusters a verdict's opening may take: the nearest to your remit, `OFFERED` at most. */
export function remitOffers(world: GameWorld): ClusterDef[] {
  if (!remitOn(world) || world.remit!.toOpen <= 0) return [];
  const yours = [...world.towns.values()].filter((t) => !t.industry && inRemit(world, t.id));
  const distance = (cluster: ClusterDef) => {
    const hub = world.towns.get(cluster.hub);
    if (!hub) return Infinity;
    return Math.min(...yours.map((t) => Math.hypot(t.x - hub.x, t.y - hub.y)));
  };
  return (world.clusters ?? [])
    .filter((c) => isClosed(world, c))
    .map((c) => ({ c, d: distance(c) }))
    .sort((p, q) => p.d - q.d || (p.c.hub < q.c.hub ? -1 : 1))
    .slice(0, OFFERED)
    .map(({ c }) => c);
}

/** At a term's verdict (term.ts): a kept, unfailed term grants an opening while a cluster is closed. */
export function verdictOpening(world: GameWorld, kept: number, failed: boolean | undefined): boolean {
  if (!remitOn(world) || kept === 0 || failed) return false;
  const closed = (world.clusters ?? []).filter((c) => isClosed(world, c)).length;
  if (world.remit!.toOpen >= closed) return false;
  world.remit!.toOpen += 1;
  return true;
}

/** The `open` action: spend an opening on one of the clusters offered. */
export function openCluster(world: GameWorld, hub: string): { ok: boolean; reason?: string } {
  if (!remitOn(world)) return { ok: false, reason: "your remit is the whole region" };
  if (world.remit!.toOpen <= 0) return { ok: false, reason: "no opening to choose: one comes with a term's verdict" };
  if (!remitOffers(world).some((c) => c.hub === hub)) return { ok: false, reason: "not on offer" };
  world.remit!.open.push(hub);
  world.remit!.toOpen -= 1;
  return { ok: true };
}

/** What a cluster brings, for the offer's words. */
export function clusterBrings(world: GameWorld, cluster: ClusterDef): string[] {
  const brings: string[] = [`${cluster.towns.length} towns`];
  if (world.tuning.clusterOffersEnabled) brings.push(cluster.offer === "limestone" ? "a limestone field" : "a farm belt");
  if (cluster.towns.includes(world.seaport ?? "")) brings.push("the seaport's city");
  const railEnds = new Set(world.simulation.map.segments.filter((s) => s.id.startsWith("inherited-rail-")).flatMap((s) => [s.fromNodeId, s.toNodeId]));
  if (cluster.towns.some((t) => railEnds.has(t))) brings.push("the old railway's far end");
  return brings;
}

/** Why an action reaches outside your remit, or null: a line or a place needs every end in it, a link one. */
export function remitRefusal(world: GameWorld, spec: ActionSpec): string | null {
  switch (spec.kind) {
    case "bus": case "minibus": case "brt": case "lorry": case "train": case "freight":
    case "lane": case "enforce": case "settle": case "project":
      return placesOutsideRemit(world, spec.a, spec.b);
    case "road": case "pave": case "track":
      return linkOutsideRemit(world, spec.a, spec.b);
    case "halt":
      return placesOutsideRemit(world, spec.town);
    case "yard": case "park": case "metro":
      return placesOutsideRemit(world, spec.townId);
    case "expand":
      return placesOutsideRemit(world, spec.siteId);
    case "restoreRefinery":
      return world.fuel ? placesOutsideRemit(world, world.fuel.refineryId) : null;
    case "restoreWorks":
      return world.cement ? placesOutsideRemit(world, world.cement.worksId) : null;
    case "restoreSteel":
      return world.steel?.worksId ? placesOutsideRemit(world, world.steel.worksId) : null;
    case "fix": case "retire": case "restore": case "repair": {
      const chain = chainOf(world, spec.segmentId);
      return chain ? linkOutsideRemit(world, chain.a, chain.b) : null;
    }
    case "bridgeFord": {
      const ford = fordById(world, spec.fordId);
      return ford ? linkOutsideRemit(world, ford.a, ford.b) : null;
    }
    default:
      return null;
  }
}
