import { isFuelSite } from "./fuel";
import { borderFuelSite } from "./gateways";
import type { GameWorld } from "./types";
import { parseRelayKey, type GoodsKind } from "./goods";
import { legReach, nextStop, relayed } from "./haulage";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
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
/** A leg of a relayed load (haulage.ts): to this leg's stop, bound for `final`, from `origin`. */
const legKey = (from: string, to: string, kind: GoodsKind, final: string, origin: string) => `${from}|${to}|${kind}|${final}|${origin}`;

/** How keen truckers are on a haul of this many cells: 1 next door, 0 at `max` (truckerMaxHaulCells) and beyond. */
export function haulShare(world: GameWorld, cells: number, max = world.tuning.truckerMaxHaulCells): number {
  return max > 0 ? Math.max(0, 1 - cells / max) : 0;
}

/** Truckers take some of what's waiting at each yard, short hauls fastest. After goods arrive, before lorries load. */
export function truckersPickUp(world: GameWorld, dt: number): void {
  const { tuning, goods } = world;
  if (!tuning.truckersEnabled) return;
  const pickup = 1 - Math.exp(-dt / tuning.truckerPickupSeconds);
  const relay = !!tuning.goodsRelay;
  // Goods at `from` bound for `final`, from `origin` (here, unless they're between legs):
  // what hauliers take of them now toward this leg's stop.
  const take = (store: Map<string, number>, key: string, amount: number, from: string, final: string, kind: GoodsKind, origin: string) => {
    // With goods relayed (haulage.ts), a load past this leg's reach goes to a town on the way.
    const to = relay && relayed(world, origin, kind) ? nextStop(world, from, final, legReach(world, from, kind)) : final;
    if (!to) return;
    const path = roadPath(world, from, to);
    if (!path) return;
    // Fuel goes by road tanker, far: nearly all of it does here (fuel.ts).
    // Crude doesn't go by the roadside: it's moved under contract -- yours,
    // by rail, or hauliers' from a yard at the source (Revision 4: with no
    // player lorries, a refinery mustn't need track to get any crude).
    const site = world.towns.get(from)?.industry;
    if ((site === "oilfield" || site === "terminal") && !(tuning.yardsEnabled && hasYard(world, from))) return;
    // From a haulage yard (yards.ts), hauliers reach further and load faster.
    const atYard = tuning.yardsEnabled && hasYard(world, from);
    // Against your freight line's rate (freightrates.ts): keener against a dear one, less against a cheap.
    const pull = haulierPull(world, from, to);
    // Fuel over the border goes by tanker too (gateways.ts borderFuelSite).
    const reach = legReach(world, from, kind) * pull;
    // No more than a few loads held a destination (truckerHoldLoads): the rest stays at the
    // yard, where it shows as waiting and spoils if nobody comes (map 2418, day 233:
    // hauliers held 4,214 t of cement for Katsina-Ala, delivering none -- it vanished).
    const k = to === final && origin === from ? heldKey(from, to, kind) : legKey(from, to, kind, final, origin);
    const room = Math.max(0, (tuning.truckerHoldLoads ?? Infinity) * tuning.truckLoad - (world.truckers.get(k) ?? 0));
    const taken = Math.min(amount, room, amount * Math.min(1, pickup * pull) * (atYard ? tuning.yardPickupBoost : 1) * haulShare(world, path.distance, reach));
    if (taken <= 0) return;
    store.set(key, amount - taken);
    // When this load began to gather, for a part load (dispatchTrucks).
    if (tuning.partLoadDays && !(world.truckers.get(k) ?? 0)) (world.truckerSince ??= new Map()).set(k, world.economy.elapsedSeconds);
    world.truckers.set(k, (world.truckers.get(k) ?? 0) + taken);
  };
  for (const [from, yard] of goods.yards) {
    for (const [key, amount] of yard) {
      if (amount <= 0) continue;
      const bar = key.indexOf("|");
      take(yard, key, amount, from, key.slice(0, bar), key.slice(bar + 1) as GoodsKind, from);
    }
  }
  if (!relay) return;
  for (const [at, waits] of goods.relay ?? []) {
    for (const [key, amount] of waits) {
      if (amount <= 0) continue;
      const { to, kind, origin } = parseRelayKey(key);
      take(waits, key, amount, at, to, kind, origin);
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
    const [from, to, kind, final, origin] = key.split("|") as [string, string, GoodsKind, string?, string?];
    // A full truck; or, for what a town waits on to grow (haulage.ts relayed), what's gathered
    // once it has waited `partLoadDays`: a small far town wants half a tonne of steel a day, and
    // a full 20 t a leg took months over two or three legs (map 949: seven towns at none).
    let load = tuning.truckLoad;
    if (held < tuning.truckLoad) {
      const since = world.truckerSince?.get(key);
      if (!tuning.partLoadDays || held < 1 || since === undefined || !relayed(world, origin ?? from, kind)) continue;
      if (world.economy.elapsedSeconds - since < tuning.partLoadDays * SECONDS_PER_GAME_DAY) continue;
      load = held;
    }
    const path = roadPath(world, from, to);
    // A tanker isn't held back by the danfos' share of the road: fuel gets
    // through a jammed road slowly, never not at all (fuel.ts). It still
    // takes its road space and slows what's there.
    const tanker = isFuelSite(world.towns.get(from)) || (kind === "supplies" && from === borderFuelSite(world));
    // Freight isn't held to the danfos' share of the road either, now goods depend on
    // hauliers (Revision 4): waiting for it, trucks never left busy towns (map 2418).
    const free = tanker || tuning.trucksFreeOfDanfoBudget;
    if (!path || (!free && !fits(path.segmentIds, tuning.lorryRoadSpace))) continue;
    const id = `truck-${world.nextId++}`;
    const vehicle = createOneShotVehicle(id, from, to, simulation.routing, tuning.truckSpeed, tuning.truckLoad, tuning.lorryRoadSpace, new Map());
    if (!vehicle) continue;
    vehicle.carries = "goods";
    // A relayed load (legKey) carries where it's going and where it began (haulage.ts).
    vehicle.cargo = [{ from, to, kind, amount: load, ...(final && origin ? { trip: { origin, destination: final } } : {}) }];
    world.truckers.set(key, held - load);
    if (tuning.partLoadDays) {
      if (held - load > 0) world.truckerSince?.set(key, world.economy.elapsedSeconds);
      else world.truckerSince?.delete(key);
    }
    takings.tolls += tollFor(world, path.segmentIds, tuning.lorryRoadSpace);
    if (tuning.yardsEnabled && hasYard(world, from)) {
      // A yard's levy: more a tonne, run properly, the touts' share smaller (yards.ts).
      const levy = tuning.yardLevyPerTonne * load;
      takings.loading += levy * (1 - tuning.yardToutShare);
      takings.touts += levy * tuning.yardToutShare;
    } else if (levied(world, from)) {
      const levy = tuning.loadingLevyPerTonne * load;
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
