import { isFuelSite } from "./fuel";
import type { GameWorld } from "./types";
import type { GoodsKind } from "./goods";
import { roadPath } from "./world";
import { tollFor, type Takings } from "./budget";
import { hasYard } from "./yards";
import { haulierPull } from "./freightrates";
import { createOneShotVehicle } from "../simulation/vehicle";

// Private truckers: the informal sector's freight rival (docs/brief.md,
// Revision 2, the informal hook in goods, agreed 2026-10-19; principles.md
// §3, Paratransit, amended in spirit -- a haulier owns a lorry, which no
// okada rider can, so paratransit stays passengers-only). They work as the
// danfos do for riders: where goods sit at a yard with nobody moving them,
// truckers come for them, before they spoil.
//
//   - Short hauls are theirs: they pick up waiting goods fast where the
//     road run is short, slower as it lengthens, and not at all past
//     `truckerMaxHaulCells` -- a lorry on a long run loses, and volume over
//     distance is rail's (principles.md §3, Demand). So on a short haul they
//     undercut you (what they take, your lorry doesn't find), and on a long
//     one the goods are yours or nobody's.
//   - They take road space and wear roads like a lorry, and pay your tolls.
//   - Every load lifted at a market or the port pays a loading levy; the
//     touts keep their cut, and the rest reaches you, as the park levy does.
//   - What they deliver counts, at half, toward the stone a town gets
//     (industries.ts stoneServed): informal service sustains, yours develops.

/** `from|to|kind` -> tonnes truckers hold at a yard, waiting to fill a truck. */
export type TruckerHeld = Map<string, number>;

const heldKey = (from: string, to: string, kind: GoodsKind) => `${from}|${to}|${kind}`;

/** How keen truckers are on a haul of this many cells: 1 next door, 0 at `max` (truckerMaxHaulCells) and beyond. */
export function haulShare(world: GameWorld, cells: number, max = world.tuning.truckerMaxHaulCells): number {
  return max > 0 ? Math.max(0, 1 - cells / max) : 0;
}

/** Truckers take some of what's waiting at each yard, short hauls fastest. After goods arrive, before lorries load. */
export function truckersPickUp(world: GameWorld, dt: number): void {
  const { tuning, goods } = world;
  if (!tuning.truckersEnabled) return;
  const pickup = 1 - Math.exp(-dt / tuning.truckerPickupSeconds);
  for (const [from, yard] of goods.yards) {
    for (const [key, amount] of yard) {
      if (amount <= 0) continue;
      const bar = key.indexOf("|");
      const to = key.slice(0, bar);
      const kind = key.slice(bar + 1) as GoodsKind;
      const path = roadPath(world, from, to);
      if (!path) continue;
      // Fuel goes by road tanker, far: nearly all of it does here (fuel.ts).
      // Crude doesn't go by the roadside: it's moved under contract -- yours,
      // by rail, or hauliers' from a yard at the source (Revision 4: with no
      // player lorries, a refinery mustn't need track to get any crude).
      const site = world.towns.get(from)?.industry;
      if ((site === "oilfield" || site === "terminal") && !(tuning.yardsEnabled && hasYard(world, from))) continue;
      // From a haulage yard (yards.ts), hauliers reach further and load faster.
      const atYard = tuning.yardsEnabled && hasYard(world, from);
      // Against your freight line's rate (freightrates.ts): keener against a dear one, less against a cheap.
      const pull = haulierPull(world, from, to);
      const reach = Math.max(isFuelSite(world.towns.get(from)) ? tuning.tankerMaxHaulCells : tuning.truckerMaxHaulCells, atYard ? tuning.yardReachCells : 0) * pull;
      // No more than a few loads held a destination (truckerHoldLoads): the rest stays at the
      // yard, where it shows as waiting and spoils if nobody comes (map 2418, day 233:
      // hauliers held 4,214 t of cement for Katsina-Ala, delivering none -- it vanished).
      const k = heldKey(from, to, kind);
      const room = Math.max(0, (tuning.truckerHoldLoads ?? Infinity) * tuning.truckLoad - (world.truckers.get(k) ?? 0));
      const take = Math.min(amount, room, amount * Math.min(1, pickup * pull) * (atYard ? tuning.yardPickupBoost : 1) * haulShare(world, path.distance, reach));
      if (take <= 0) continue;
      yard.set(key, amount - take);
      world.truckers.set(k, (world.truckers.get(k) ?? 0) + take);
    }
  }
}

/** A loading levy is charged where loads are lifted at a market, the port, a fuel depot or refinery (the tanker drivers' union is there too), or at the cement works or terminal. */
function levied(world: GameWorld, townId: string): boolean {
  if (townId === world.port) return true;
  const site = world.towns.get(townId)?.industry;
  if (site === "depot" || site === "refinery" || site === "newrefinery" || site === "works" || site === "silo" || site === "mill" || site === "flourmill") return true;
  const town = world.towns.get(townId);
  return !!town && world.basePopulation.has(townId) && town.population >= world.tuning.marketPopulation;
}

/**
 * Sends a truck for every full load truckers hold, if the road has space
 * for it (the informal sector's road budget, your vehicles' road space
 * counted against it, as for danfos). `fits(segmentIds, weight)` asks.
 */
export function dispatchTrucks(world: GameWorld, takings: Takings, fits: (segmentIds: string[], weight: number) => boolean): void {
  const { tuning, informal, simulation } = world;
  if (!tuning.truckersEnabled) return;
  for (const [key, held] of world.truckers) {
    if (held < tuning.truckLoad) continue;
    const [from, to, kind] = key.split("|") as [string, string, GoodsKind];
    const path = roadPath(world, from, to);
    // A tanker isn't held back by the danfos' share of the road: fuel gets
    // through a jammed road slowly, never not at all (fuel.ts). It still
    // takes its road space and slows what's there.
    const tanker = isFuelSite(world.towns.get(from));
    // Freight isn't held to the danfos' share of the road either, now goods depend on
    // hauliers (Revision 4): waiting for it, trucks never left busy towns (map 2418).
    const free = tanker || tuning.trucksFreeOfDanfoBudget;
    if (!path || (!free && !fits(path.segmentIds, tuning.lorryRoadSpace))) continue;
    const id = `truck-${world.nextId++}`;
    const vehicle = createOneShotVehicle(id, from, to, simulation.routing, tuning.truckSpeed, tuning.truckLoad, tuning.lorryRoadSpace, new Map());
    if (!vehicle) continue;
    vehicle.carries = "goods";
    vehicle.cargo = [{ from, to, kind, amount: tuning.truckLoad }];
    world.truckers.set(key, held - tuning.truckLoad);
    takings.tolls += tollFor(world, path.segmentIds, tuning.lorryRoadSpace);
    if (tuning.yardsEnabled && hasYard(world, from)) {
      // A yard's levy: more a tonne, run properly, the touts' share smaller (yards.ts).
      const levy = tuning.yardLevyPerTonne * tuning.truckLoad;
      takings.loading += levy * (1 - tuning.yardToutShare);
      takings.touts += levy * tuning.yardToutShare;
    } else if (levied(world, from)) {
      const levy = tuning.loadingLevyPerTonne * tuning.truckLoad;
      takings.loading += levy * (1 - tuning.agberoCut);
      takings.touts += levy * tuning.agberoCut;
    }
    simulation.vehicles.push(vehicle);
    // A tanker shares the road (its traffic congests it), not the danfos'
    // share of it: counted against their budget, the fuel's long slow hauls
    // crowded danfos off the roads and cut trips made by a quarter.
    if (free) continue;
    informal.active.set(id, { segmentIds: path.segmentIds, weight: tuning.lorryRoadSpace, mode: "truck", released: 0 });
    for (const segmentId of path.segmentIds) informal.segmentSpace.set(segmentId, (informal.segmentSpace.get(segmentId) ?? 0) + tuning.lorryRoadSpace);
  }
}
