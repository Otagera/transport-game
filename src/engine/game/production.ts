import type { GameWorld } from "./types";
import { portScale } from "./gateways";
import { flowKey, goodsFlows, type GoodsFlow } from "./goods";
import { crudeArriving, newRefineryCapacity, newRefineryCrude, newRefineryOutput, refineryCapacity, refineryOutput } from "./fuel";
import { siteScale } from "./expand";
import { cementImports, limestoneArriving, worksCapacity, worksOutput } from "./cement";
import { mineOutput, oreArriving, steelCapacity, steelImports, steelOutput } from "./steel";
import { flourCapacity, flourOutput, millCapacity, millOutput, stapleArriving, wheatArriving } from "./food";
import { siteJobs, staffFactor, staffing } from "./workers";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import { assemblyArriving, assemblyNeeds, assemblyShare } from "./assembly";

// What a site makes and what holds it back (playtest, map 2411: "we need
// indications for the factories in terms of production"). One reading for
// every kind of site, for its card and its gauge on the map: what it makes
// against what it could, each input against what full output takes, its
// workers, how much of what it makes gets away -- and the one that's
// holding it back. Tonnes a second throughout; the screen says a day.

export interface SiteInput {
  name: string;
  /** Arriving now, yours and the truckers'. */
  arriving: number;
  /** What it would take to run at capacity. */
  needed: number;
}

export type SiteLimit = "idle" | "input" | "workers" | "capacity";

export interface SiteProduction {
  /** What it makes ("fuel", "cement", "limestone"...). */
  product: string;
  made: number;
  capacity: number;
  inputs: SiteInput[];
  /** Share of a full shift getting there, 0..1; null for a site with no commuters. */
  staffing: number | null;
  /** Of what it makes, the share carried away (delivered or trucked) rather than left waiting, 0..1. */
  shipped: number;
  /** What's holding it back, the lowest of its input and workers (capacity: nothing is). */
  limit: SiteLimit;
  /** With `limit` "input": which one -- the input arriving the least of what it needs (two inputs: the assembly plant). */
  binding?: string;
}

/** `flows`: goodsFlows(world), when the caller already has them (the map reads every site each frame). */
// "Carried away" rolled over SHIPPED_DAYS (the OpenCode player: it "swung 11% -> 95%
// between ticks" -- hauliers lift 20-tonne loads). For the reading only: nothing in
// the simulation uses it, so replays are untouched. Kept off the world (plain data).
const SHIPPED_DAYS = 5;
const shippedSeen = new WeakMap<GameWorld, Map<string, { value: number; at: number }>>();

function smoothed(world: GameWorld, siteId: string, raw: number): number {
  let bySite = shippedSeen.get(world);
  if (!bySite) shippedSeen.set(world, (bySite = new Map()));
  const now = world.economy.elapsedSeconds;
  const seen = bySite.get(siteId);
  if (!seen || now < seen.at) {
    bySite.set(siteId, { value: raw, at: now });
    return raw;
  }
  const alpha = 1 - Math.exp(-(now - seen.at) / (SHIPPED_DAYS * SECONDS_PER_GAME_DAY));
  seen.value += (raw - seen.value) * alpha;
  seen.at = now;
  return seen.value;
}

export function siteProduction(world: GameWorld, siteId: string, flows: GoodsFlow[] = goodsFlows(world)): SiteProduction | null {
  const site = world.towns.get(siteId);
  if (!site?.industry) return null;
  const t = world.tuning;
  const fuel = world.fuel;
  const cement = world.cement;
  const food = world.food;
  let product = "";
  let made = 0;
  let capacity = 0;
  let inputs: SiteInput[] = [];
  let idle = false;
  switch (site.industry) {
    case "refinery":
      product = "fuel";
      capacity = refineryCapacity(world);
      made = refineryOutput(world);
      inputs = [{ name: "crude", arriving: crudeArriving(world), needed: capacity }];
      idle = !fuel?.restored;
      break;
    case "newrefinery":
      product = "fuel";
      capacity = newRefineryCapacity(world);
      made = newRefineryOutput(world);
      inputs = [{ name: "crude", arriving: crudeArriving(world, siteId), needed: newRefineryCrude(world) }];
      break;
    case "works":
      product = "cement";
      capacity = worksCapacity(world);
      made = worksOutput(world);
      inputs = [{ name: "limestone", arriving: limestoneArriving(world), needed: capacity * t.limestonePerCement }];
      idle = !cement?.working;
      break;
    case "mill":
      product = food?.crops.food ?? "food";
      capacity = millCapacity(world);
      made = millOutput(world);
      inputs = [{ name: food?.crops.staple ?? "staple", arriving: stapleArriving(world), needed: capacity * t.staplePerFood }];
      break;
    case "flourmill":
      product = "flour";
      capacity = flourCapacity(world);
      made = flourOutput(world);
      inputs = [{ name: "wheat", arriving: wheatArriving(world), needed: capacity * t.wheatPerFlour }];
      break;
    case "quarry":
      product = cement && t.cementEnabled ? "limestone" : "stone";
      capacity = t.quarryOutputPerDay / SECONDS_PER_GAME_DAY;
      made = capacity * staffFactor(world, siteId);
      break;
    case "depot":
      product = "imported fuel";
      capacity = fuel ? t.fuelImportShare * fuel.baseDemand * portScale(world) : 0;
      made = capacity * staffFactor(world, siteId);
      break;
    case "silo":
      product = "imported cement";
      capacity = cement ? t.cementImportShare * cement.baseDemand * portScale(world) : 0;
      made = cementImports(world);
      break;
    // The steel chain (steel.ts).
    case "steelworks":
      product = "steel";
      capacity = steelCapacity(world);
      made = steelOutput(world);
      inputs = [{ name: "iron ore", arriving: oreArriving(world), needed: capacity * t.orePerSteel }];
      idle = !world.steel?.working;
      break;
    case "ironmine":
      product = "iron ore";
      capacity = world.steel?.working ? t.mineOutputPerDay / SECONDS_PER_GAME_DAY : 0;
      made = mineOutput(world);
      idle = !world.steel?.working;
      break;
    case "steelport":
      product = "imported steel";
      capacity = world.steel ? t.steelImportShare * world.steel.baseDemand * portScale(world) : 0;
      made = steelImports(world);
      break;
    // The assembly plant (assembly.ts): two inputs, and it runs at the lower one's share.
    case "assembly": {
      const need = assemblyNeeds(world);
      const got = assemblyArriving(world);
      product = "buses and minibuses";
      capacity = need.steel;
      made = need.steel * assemblyShare(world).share;
      inputs = [{ name: "steel", arriving: got.steel, needed: need.steel }, { name: "fuel", arriving: got.fuel, needed: need.fuel }];
      break;
    }
    case "oilfield":
    case "terminal":
      product = "crude";
      // For the old refinery once restored, and the second once it's open.
      capacity = (fuel?.restored ? t.crudeShare * fuel.baseDemand * siteScale(world, fuel.refineryId) : 0) + newRefineryCrude(world);
      made = capacity;
      idle = capacity <= 0;
      break;
  }
  const jobs = siteJobs(world, site);
  const staff = t.workersEnabled && jobs > t.jobsIdle + 1e-9 ? staffing(world, siteId) : null;
  let away = 0;
  let out = 0;
  for (const flow of flows) {
    if (flow.from !== siteId) continue;
    out += flow.rate;
    const outcome = world.goods.outcomes.get(flowKey(flow));
    // Each flow counts up to what it wants: one town's burst of a cleared backlog
    // mustn't cover for towns getting nothing (map 2418: "carried away 100%" with
    // six of seven towns at 0).
    away += Math.min(flow.rate, (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0));
  }
  const shipped = smoothed(world, siteId, out > 0 ? Math.min(1, away / out) : 0);
  // The binding one: idle first; else the lowest of the inputs and the shift, if it bites.
  const inputShare = inputs.length > 0 ? Math.min(...inputs.map((input) => (input.needed > 0 ? input.arriving / input.needed : 1))) : 1;
  const staffShare = staff === null ? 1 : staffFactor(world, siteId);
  const limit: SiteLimit = idle ? "idle" : Math.min(inputShare, staffShare) >= 0.95 ? "capacity" : inputShare <= staffShare ? "input" : "workers";
  const binding = limit === "input" ? [...inputs].sort((a, b) => (a.needed > 0 ? a.arriving / a.needed : 1) - (b.needed > 0 ? b.arriving / b.needed : 1))[0]?.name : undefined;
  return { product, made, capacity, inputs, staffing: staff, shipped, limit, ...(binding ? { binding } : {}) };
}
