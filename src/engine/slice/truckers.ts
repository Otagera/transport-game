import { isFuelSite } from "./fuel";
import type { SliceWorld } from "./types";
import type { GoodsKind } from "./goods";
import { roadPath } from "./world";
import { tollFor, type Takings } from "./budget";
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
export function haulShare(world: SliceWorld, cells: number, max = world.tuning.truckerMaxHaulCells): number {
  return max > 0 ? Math.max(0, 1 - cells / max) : 0;
}

/** Truckers take some of what's waiting at each yard, short hauls fastest. After goods arrive, before lorries load. */
export function truckersPickUp(world: SliceWorld, dt: number): void {
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
      // Crude doesn't go by the roadside: it's moved under contract -- yours.
      const site = world.towns.get(from)?.industry;
      if (site === "oilfield" || site === "terminal") continue;
      const reach = isFuelSite(world.towns.get(from)) ? tuning.tankerMaxHaulCells : tuning.truckerMaxHaulCells;
      const take = amount * pickup * haulShare(world, path.distance, reach);
      if (take <= 0) continue;
      yard.set(key, amount - take);
      const k = heldKey(from, to, kind);
      world.truckers.set(k, (world.truckers.get(k) ?? 0) + take);
    }
  }
}

/** A loading levy is charged where loads are lifted at a market, the port, or a fuel depot or refinery (the tanker drivers' union is there too). */
function levied(world: SliceWorld, townId: string): boolean {
  if (townId === world.port) return true;
  const site = world.towns.get(townId)?.industry;
  if (site === "depot" || site === "refinery") return true;
  const town = world.towns.get(townId);
  return !!town && world.basePopulation.has(townId) && town.population >= world.tuning.marketPopulation;
}

/**
 * Sends a truck for every full load truckers hold, if the road has space
 * for it (the informal sector's road budget, your vehicles' road space
 * counted against it, as for danfos). `fits(segmentIds, weight)` asks.
 */
export function dispatchTrucks(world: SliceWorld, takings: Takings, fits: (segmentIds: string[], weight: number) => boolean): void {
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
    if (!path || (!tanker && !fits(path.segmentIds, tuning.lorryRoadSpace))) continue;
    const id = `truck-${world.nextId++}`;
    const vehicle = createOneShotVehicle(id, from, to, simulation.routing, tuning.truckSpeed, tuning.truckLoad, tuning.lorryRoadSpace, new Map());
    if (!vehicle) continue;
    vehicle.carries = "goods";
    vehicle.cargo = [{ from, to, kind, amount: tuning.truckLoad }];
    world.truckers.set(key, held - tuning.truckLoad);
    takings.tolls += tollFor(world, path.segmentIds, tuning.lorryRoadSpace);
    if (levied(world, from)) {
      const levy = tuning.loadingLevyPerTonne * tuning.truckLoad;
      takings.loading += levy * (1 - tuning.agberoCut);
      takings.touts += levy * tuning.agberoCut;
    }
    simulation.vehicles.push(vehicle);
    informal.active.set(id, { segmentIds: path.segmentIds, weight: tuning.lorryRoadSpace, mode: "truck", released: 0 });
    for (const segmentId of path.segmentIds) informal.segmentSpace.set(segmentId, (informal.segmentSpace.get(segmentId) ?? 0) + tuning.lorryRoadSpace);
  }
}
