import type { SliceWorld } from "./types";
import { flowKey, goodsFlows, type GoodsFlow } from "./goods";
import { crudeArriving, refineryCapacity, refineryOutput } from "./fuel";
import { siteScale } from "./expand";
import { cementImports, limestoneArriving, worksCapacity, worksOutput } from "./cement";
import { flourCapacity, flourOutput, millCapacity, millOutput, stapleArriving, wheatArriving } from "./food";
import { siteJobs, staffFactor, staffing } from "./workers";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

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
}

/** `flows`: goodsFlows(world), when the caller already has them (the map reads every site each frame). */
// "Carried away" rolled over SHIPPED_DAYS (the OpenCode player: it "swung 11% -> 95%
// between ticks" -- hauliers lift 20-tonne loads). For the reading only: nothing in
// the simulation uses it, so replays are untouched. Kept off the world (plain data).
const SHIPPED_DAYS = 5;
const shippedSeen = new WeakMap<SliceWorld, Map<string, { value: number; at: number }>>();

function smoothed(world: SliceWorld, siteId: string, raw: number): number {
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

export function siteProduction(world: SliceWorld, siteId: string, flows: GoodsFlow[] = goodsFlows(world)): SiteProduction | null {
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
      capacity = fuel ? t.fuelImportShare * fuel.baseDemand : 0;
      made = capacity * staffFactor(world, siteId);
      break;
    case "silo":
      product = "imported cement";
      capacity = cement ? t.cementImportShare * cement.baseDemand : 0;
      made = cementImports(world);
      break;
    case "oilfield":
    case "terminal":
      product = "crude";
      capacity = fuel ? t.crudeShare * fuel.baseDemand * siteScale(world, fuel.refineryId) : 0;
      made = fuel?.restored ? capacity : 0;
      idle = !fuel?.restored;
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
    away += (outcome?.delivered ?? 0) + (outcome?.trucked ?? 0);
  }
  const shipped = smoothed(world, siteId, out > 0 ? Math.min(1, away / out) : 0);
  // The binding one: idle first; else the lowest of the inputs and the shift, if it bites.
  const inputShare = inputs.length > 0 ? Math.min(...inputs.map((input) => (input.needed > 0 ? input.arriving / input.needed : 1))) : 1;
  const staffShare = staff === null ? 1 : staffFactor(world, siteId);
  const limit: SiteLimit = idle ? "idle" : Math.min(inputShare, staffShare) >= 0.95 ? "capacity" : inputShare <= staffShare ? "input" : "workers";
  return { product, made, capacity, inputs, staffing: staff, shipped, limit };
}
