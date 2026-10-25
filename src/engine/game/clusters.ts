import type { ClusterDef, GameWorld } from "./types";
import { addSite, nearestDistance } from "./fuel";
import { inheritedRoad, cementActive } from "./cement";
import { isWater } from "../pathing/terrainAStar";
import { flowKey, goodsFlows } from "./goods";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// What the far clusters offer (docs/brief.md, Revision 5: "a reason for each far cluster").
// The designer's review: the region was "the same game with more road between the towns" --
// every chain sat in the home cluster, and a far town gave you only passengers that long bus
// routes lose money on. Each far cluster now holds something your home chains need, out past
// the hauliers' reach, so reaching it is a project with a payoff:
//
//   - limestone: a cluster the hill range runs to has a field in its hills -- a quarry that
//     never works out, making twice a quarry's limestone, for your cement works (cement holds
//     your towns' growth past +40%);
//   - farm: a farm belt -- its farm towns grow twice the staple for your mill (food.ts), which
//     feeds your market towns.
//
// No new chain: a field is a quarry (industries.ts), a farm belt farm towns, and what they
// send already flows to your sites -- it just doesn't arrive until you reach it, by a yard,
// a long road or rail. From term 2, the state's pledges ask for it (term.ts). Off, and absent,
// in runs played before it (no clusterOffersEnabled).

const on = (world: GameWorld) => !!world.tuning.clusterOffersEnabled && !!world.clusters;

/** The far cluster a town is in, if it's in one. */
export function clusterOf(world: GameWorld, townId: string): ClusterDef | undefined {
  return world.clusters?.find((cluster) => cluster.towns.includes(townId));
}

/** A farm-belt town: its land grows more staple (food.ts farmland). */
export function inFarmBelt(world: GameWorld, townId: string): boolean {
  return on(world) && clusterOf(world, townId)?.offer === "farm";
}

export const fieldId = (cluster: ClusterDef) => `field-${cluster.hub}`;

/**
 * At a new game's start (start.ts, with the other sites): a limestone field in each limestone
 * cluster's hills, 6-14 cells from its regional town on high dry ground, with an old road to it.
 * Needs the building chain: no works, no field.
 */
export function placeClusterOffers(world: GameWorld): void {
  if (!on(world) || !world.tuning.cementEnabled || !world.tuning.industriesEnabled || !world.cement) return;
  const { terrain } = world.simulation.map;
  const highest = terrain.elevation.reduce((top, e) => Math.max(top, e), 0) || 1;
  for (const cluster of world.clusters!) {
    if (cluster.offer !== "limestone" || world.towns.has(fieldId(cluster))) continue;
    const hub = world.towns.get(cluster.hub);
    if (!hub) continue;
    let best: { x: number; y: number; s: number } | null = null;
    for (let r = 6; r <= 14; r += 1) {
      for (let k = 0; k < 32; k += 1) {
        const a = (k / 32) * Math.PI * 2;
        const x = Math.round(hub.x + r * Math.cos(a));
        const y = Math.round(hub.y + r * Math.sin(a));
        if (x < 3 || y < 3 || x > world.width - 4 || y > world.height - 4) continue;
        let wet = false;
        for (let dy = -2; dy <= 2 && !wet; dy += 1) for (let dx = -2; dx <= 2 && !wet; dx += 1) wet = isWater(terrain, x + dx, y + dy);
        if (wet || nearestDistance(world, x, y) < 6) continue;
        // High ground (the limestone's in the hills), then nearer its town.
        const s = terrain.elevation[y * terrain.width + x]! / highest - r * 0.01;
        if (!best || s > best.s) best = { x, y, s };
      }
    }
    if (!best) continue;
    const id = fieldId(cluster);
    addSite(world, id, `${hub.name} Limestone Field`, "quarry", best);
    inheritedRoad(world, `${id}-road`, id, hub.id);
    const now = world.economy.elapsedSeconds;
    world.industries.set(id, { id, kind: "quarry", openedAtSeconds: now, closesAtSeconds: Infinity, deliveredEMA: 0, field: true });
  }
}

/**
 * Of what a far cluster offers, the share reaching your site now, 0..1, and its tonnes a day:
 * a field's limestone at your works, a farm belt's staple at your mill. Null when it offers
 * nothing (off, or its chain isn't there).
 */
export function clusterOfferShare(world: GameWorld, cluster: ClusterDef): { share: number; perDay: number; to: string } | null {
  if (!on(world)) return null;
  const flows: Array<{ from: string; to: string }> = [];
  if (cluster.offer === "limestone") {
    if (!cementActive(world) || !world.towns.has(fieldId(cluster))) return null;
    flows.push({ from: fieldId(cluster), to: world.cement!.worksId });
  } else {
    if (!world.food) return null;
    for (const town of cluster.towns) flows.push({ from: town, to: world.food.millId });
  }
  let wanted = 0;
  let arriving = 0;
  const kind = cluster.offer === "limestone" ? "supplies" : "produce";
  const rates = new Map(goodsFlows(world).filter((f) => f.kind === kind).map((f) => [`${f.from}|${f.to}`, f.rate]));
  for (const { from, to } of flows) {
    const rate = rates.get(`${from}|${to}`);
    if (!rate) continue;
    wanted += rate;
    const outcome = world.goods.outcomes.get(flowKey({ from, to, kind }));
    arriving += (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
  }
  const to = cluster.offer === "limestone" ? world.cement!.worksId : world.food!.millId;
  return { share: wanted > 0 ? Math.min(1, arriving / wanted) : 0, perDay: wanted * SECONDS_PER_GAME_DAY, to };
}
