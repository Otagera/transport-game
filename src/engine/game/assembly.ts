import type { GameTown, GameWorld } from "./types";
import { flowKey, servedRate } from "./goods";
import { addSite, dry, inHome, nearestDistance, ringSpot } from "./fuel";
import { inheritedRoad } from "./cement";
import { rebuildNetworks } from "./rail";
import { refreshDemand } from "./settlement";
import { staffFactor } from "./workers";
import { SECONDS_PER_GAME_DAY as D } from "../economy/state";

// The assembly plant (docs/brief.md, More industries, more chains, Chains: convergent, agreed
// 2026-10-30; parked in Revision 5 as "an assembly plant in a town (Innoson, Nnewi) that steel feeds
// and your orders grow"). The first site with two inputs -- steel and fuel -- so a single failure (a
// flood, a strike, a worn road on either leg) idles a place, not a product: it runs at the share of
// whichever arrives least. It's the one chain that closes on itself: it builds buses and minibuses,
// and you're its customer -- while it runs they're cheaper, the more so the longer it has run (a
// generation of the line every `assemblyGenerationDays` of full output, up to
// `assemblyMaxGenerations`), and as an input runs short the discount fades.
//
// Steel comes in two ways and they're one input: imported through the port's terminal, and from the
// works on maps that have one (steel.ts splits each over its takers by want, the plant among them),
// so a strike on your rail line is survivable if the port route was kept warm. Placed at the start
// beside the home cluster's second town, on an old road to it, behind `assemblyPlant` (absent in
// older runs: no plant).

export interface AssemblyState {
  siteId: string;
  /** Days of full output so far: what the line has learned (generations). */
  fullDays: number;
  /** The discount on a bus or minibus now, 0..1, rolled toward what the plant's running earns. */
  discount: number;
}

export const ASSEMBLY_ID = "assembly";

export function assemblyActive(world: GameWorld): boolean {
  return !!world.assembly && !!world.tuning.assemblyPlant && world.tuning.goodsEnabled && world.tuning.industriesEnabled;
}

/** Tonnes a second of steel and of fuel it takes at full output. */
export function assemblyNeeds(world: GameWorld): { steel: number; fuel: number } {
  const t = world.tuning;
  return { steel: (t.assemblySteelPerDay ?? 0) / D, fuel: (t.assemblyFuelPerDay ?? 0) / D };
}

/** What's arriving of each, yours and the hauliers', over the served roll (goods.ts servedRate). */
export function assemblyArriving(world: GameWorld): { steel: number; fuel: number } {
  const plant = world.assembly?.siteId;
  if (!plant) return { steel: 0, fuel: 0 };
  let steel = 0;
  let fuel = 0;
  for (const from of [world.steel?.terminalId, world.steel?.worksId]) if (from) steel += servedRate(world, world.goods.outcomes.get(flowKey({ from, to: plant, kind: "supplies" })));
  for (const from of [world.fuel?.depotId, world.fuel?.refineryId, world.fuel?.newRefineryId, world.border]) if (from) fuel += servedRate(world, world.goods.outcomes.get(flowKey({ from, to: plant, kind: "supplies" })));
  return { steel, fuel };
}

/** The share of full output it runs at: the lower of its two inputs' shares, times its shift. */
export function assemblyShare(world: GameWorld): { share: number; steel: number; fuel: number } {
  if (!assemblyActive(world)) return { share: 0, steel: 0, fuel: 0 };
  const need = assemblyNeeds(world);
  const got = assemblyArriving(world);
  const steel = need.steel > 0 ? Math.min(1, got.steel / need.steel) : 1;
  const fuel = need.fuel > 0 ? Math.min(1, got.fuel / need.fuel) : 1;
  return { share: Math.min(steel, fuel) * staffFactor(world, world.assembly!.siteId), steel, fuel };
}

/** Its line's generation: one per `assemblyGenerationDays` of full output, up to the most. */
export function assemblyGeneration(world: GameWorld): number {
  const t = world.tuning;
  if (!world.assembly) return 0;
  return Math.min(t.assemblyMaxGenerations ?? 3, Math.floor(world.assembly.fullDays / Math.max(1, t.assemblyGenerationDays ?? 30)));
}

/** Each tick: the line learns as it runs, and the discount follows what the running earns (rolled over a few days). */
export function updateAssembly(world: GameWorld, dt: number): void {
  const a = world.assembly;
  if (!a || !assemblyActive(world)) return;
  const t = world.tuning;
  const { share } = assemblyShare(world);
  a.fullDays += (share * dt) / D;
  // A first generation's discount from the day it runs; the next with each generation learned.
  const target = (t.assemblyDiscountPerGeneration ?? 0.1) * (1 + assemblyGeneration(world)) * share;
  const capped = Math.min(target, (t.assemblyDiscountPerGeneration ?? 0.1) * ((t.assemblyMaxGenerations ?? 3) + 1));
  a.discount += (capped - a.discount) * (1 - Math.exp(-dt / ((t.assemblyDiscountTauDays ?? 5) * D)));
}

/**
 * What a bus or a minibus costs you now: the list price, less the plant's discount while it runs
 * (locally assembled). Every price the game charges or quotes for one comes through here.
 */
export function vehiclePrice(world: GameWorld, kind: "bus" | "minibus" | "brt" | "train"): number {
  const t = world.tuning;
  const list = kind === "minibus" ? t.minibusPurchaseCost : kind === "brt" ? t.brtPurchaseCost : kind === "train" ? t.trainPurchaseCost : t.busPurchaseCost;
  if ((kind !== "bus" && kind !== "minibus") || !assemblyActive(world)) return list;
  return Math.round(list * (1 - (world.assembly?.discount ?? 0)));
}

/** At the start, after the other sites: beside the home cluster's second town, on an old road to it. */
export function placeAssemblyPlant(world: GameWorld): void {
  const t = world.tuning;
  if (!t.assemblyPlant || !t.goodsEnabled || !t.industriesEnabled || world.assembly || !world.steel) return;
  const port = world.port;
  const second = [...world.towns.values()].filter((town) => !town.industry && town.id !== port && inHome(world, town)).sort((p, q) => q.population - p.population)[0];
  const host: GameTown | undefined = second ?? (port ? world.towns.get(port) : undefined);
  if (!host) return;
  const at = ringSpot(world, host.x, host.y, 6, 10, 6, (x, y) => -Math.abs(Math.hypot(x - host.x, y - host.y) - 8));
  if (!at || !dry(world, at.x, at.y, 1) || nearestDistance(world, at.x, at.y) < 4) return;
  addSite(world, ASSEMBLY_ID, `${host.name} Motors`, "assembly", at);
  inheritedRoad(world, `${ASSEMBLY_ID}-road`, ASSEMBLY_ID, host.id);
  world.assembly = { siteId: ASSEMBLY_ID, fullDays: 0, discount: 0 };
  rebuildNetworks(world);
  world.plans = null;
  refreshDemand(world);
}
