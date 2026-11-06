import type { RoutingContext, RoutingGraph, Vehicle } from "../simulation/types";
import { createVehicle } from "../simulation/vehicle";
import { canAfford, registerPurchase, SECONDS_PER_GAME_DAY } from "../economy/state";
import { forgetRoute } from "./ledger";
import type { GameRoute, GameWorld } from "./types";
import { SWITCHED_OFF } from "./tuning";
import { landing, waterRoute, type WaterRoute } from "./waterways";
import { cycleFraction, largestGapMidpoint, placeAtCycleFraction, routeKey, type ActionResult } from "./world";

// Jetties and boats (docs/water.md, Step 2; brief, Water first): water's first mode.
//
//   - A jetty at a waterside town (the Jetty tool): its landing is the nearest point of water a
//     boat can use within `jettyReach` cells (waterways.ts). Only your boats stop there.
//   - Water buses: a passenger line between two jetties, `boat:a~b` in `world.routes` -- trip
//     plans, transfers and fares as a bus's; riders change bus <-> boat at the town.
//   - Barges: a goods line between two jetties, `barge:a~b` in `world.lorryRoutes`, loaded as a
//     lorry is -- slow, big, cheap a tonne.
//   - A third network, as track is a second (rail.ts): a boat runs on its line's way over the
//     water (`world.waterLinks`), never a road. Every road system skips `world.boatVehicles`
//     (principles §3, Two networks): a boat between two towns that also share a road is no
//     traffic on it, wears nothing, grows no roadside town, takes no danfo's road space (C52).
//   - Not yet: fords and causeways blocking boats, and the rains on the river (step 3);
//     informal canoes (step 4); stops along the way (a line is two jetties).

export const BOAT_DEF_ID = "slice-waterbus";
export const BARGE_DEF_ID = "slice-barge";

export type BoatKind = "boat" | "barge";

/** A line's way over the water, from its first town to its second. */
export interface WaterLink {
  /** The line's route id: `boat:a~b` or `barge:a~b`. */
  id: string;
  kind: BoatKind;
  a: string;
  b: string;
  /** Cells along the water, the walks to the landings included. */
  length: number;
  points: Array<[number, number]>;
}

export function boatRouteId(a: string, b: string): string {
  return `boat:${routeKey(a, b)}`;
}

export function bargeRouteId(a: string, b: string): string {
  return `barge:${routeKey(a, b)}`;
}

/** A passenger line on the water. */
export function isBoatRoute(routeId: string): boolean {
  return routeId.startsWith("boat:");
}

/** A goods line on the water. */
export function isBargeRoute(routeId: string): boolean {
  return routeId.startsWith("barge:");
}

/** Whether a vehicle is on the water: every road system skips it. */
export function onWater(world: GameWorld, vehicleId: string): boolean {
  return world.boatVehicles?.has(vehicleId) ?? false;
}

/** Whether a vehicle is off the roads -- a train or a boat. */
export function offRoad(world: GameWorld, vehicleId: string): boolean {
  return world.railVehicles.has(vehicleId) || onWater(world, vehicleId);
}

function boatsOn(world: GameWorld): boolean {
  return world.tuning.boatsEnabled ?? false;
}

/** Cells of water a kind of boat needs. */
export function minWidth(world: GameWorld, kind: BoatKind): number {
  return kind === "barge" ? world.tuning.bargeMinWidth ?? 2.5 : world.tuning.waterBusMinWidth ?? 1.5;
}

const reachOf = (world: GameWorld) => world.tuning.jettyReach ?? 10;

// --- Jetties ---------------------------------------------------------------

/** Where a jetty at this town would land, for the smaller boat (a water bus); null if no water a boat can use is near. */
export function jettyLanding(world: GameWorld, townId: string) {
  return landing(world, townId, minWidth(world, "boat"), reachOf(world));
}

export function hasJetty(world: GameWorld, townId: string): boolean {
  return world.jetties?.has(townId) ?? false;
}

export function checkJetty(world: GameWorld, townId: string): ActionResult {
  if (!boatsOn(world)) return { ok: false, reason: SWITCHED_OFF };
  const town = world.towns.get(townId);
  if (!town) return { ok: false, reason: "pick a town" };
  if (town.industry) return { ok: false, reason: "a jetty goes at a town" };
  if (hasJetty(world, townId)) return { ok: false, reason: "it has a jetty" };
  if (!jettyLanding(world, townId)) return { ok: false, reason: `no water a boat can use within ${reachOf(world)} cells` };
  if (!canAfford(world.economy, world.tuning.jettyCost ?? 0)) return { ok: false, reason: "can't afford a jetty" };
  return { ok: true };
}

export function buildJetty(world: GameWorld, townId: string): ActionResult & { charged?: number } {
  const check = checkJetty(world, townId);
  if (!check.ok) return check;
  const cost = world.tuning.jettyCost ?? 0;
  world.economy.funds -= cost;
  (world.jetties ??= new Set()).add(townId);
  return { ok: true, charged: cost };
}

// --- The water between two jetties ------------------------------------------

/** The way over the water between two towns for a kind of boat, whether or not they have jetties. */
export function waterWay(world: GameWorld, a: string, b: string, kind: BoatKind): WaterRoute | null {
  return waterRoute(world, a, b, minWidth(world, kind), reachOf(world));
}

/** Cells along the water between two towns on a line of this kind (a fare's length, as track's for a train). */
export function waterLength(world: GameWorld, a: string, b: string, kind: BoatKind): number | null {
  const link = world.waterLinks?.find((l) => l.kind === kind && ((l.a === a && l.b === b) || (l.a === b && l.b === a)));
  return link?.length ?? waterWay(world, a, b, kind)?.length ?? null;
}

// --- The boats' networks ------------------------------------------------------

// Keyed on the links' list, which is replaced (never edited) when a line opens or closes.
const networks = new WeakMap<object, { boat: RoutingContext; barge: RoutingContext }>();
const NO_LINKS: WaterLink[] = [];

/** The routing a kind of boat runs on: its lines' ways, between their towns. Rebuilt when a line opens or closes. */
export function waterRouting(world: GameWorld, kind: BoatKind): RoutingContext {
  const links = world.waterLinks ?? NO_LINKS;
  let held = networks.get(links);
  if (!held) {
    const build = (k: BoatKind): RoutingContext => {
      const graph: RoutingGraph = new Map();
      const positions = new Map<string, { x: number; y: number }>();
      for (const link of links) {
        if (link.kind !== k) continue;
        for (const id of [link.a, link.b]) {
          const town = world.towns.get(id);
          if (town && !positions.has(id)) positions.set(id, { x: town.x, y: town.y });
          if (!graph.has(id)) graph.set(id, []);
        }
        graph.get(link.a)!.push({ to: link.b, segmentId: link.id, weight: link.length });
        graph.get(link.b)!.push({ to: link.a, segmentId: link.id, weight: link.length });
      }
      return { graph, positions };
    };
    networks.set(links, (held = { boat: build("boat"), barge: build("barge") }));
  }
  return kind === "barge" ? held.barge : held.boat;
}

/** The network a boat runs on, by what it carries. */
export function boatRouting(world: GameWorld, vehicle: Vehicle): RoutingContext {
  return waterRouting(world, vehicle.carries === "goods" ? "barge" : "boat");
}

// --- Lines --------------------------------------------------------------------

export function checkBoat(world: GameWorld, a: string, b: string, kind: BoatKind): ActionResult {
  if (!boatsOn(world) || (kind === "barge" && !world.tuning.goodsEnabled)) return { ok: false, reason: SWITCHED_OFF };
  if (a === b) return { ok: false, reason: "pick two different towns" };
  const missing = [a, b].filter((id) => !hasJetty(world, id));
  if (missing.length > 0) return { ok: false, reason: `no jetty at ${missing.map((id) => world.towns.get(id)?.name ?? id).join(" or ")}: build one (Jetty tool)` };
  if (!waterWay(world, a, b, kind)) return { ok: false, reason: kind === "barge" ? `the water between them is too narrow for a barge (${minWidth(world, kind)} cells)` : "the water doesn't join them" };
  const cost = kind === "barge" ? world.tuning.bargePurchaseCost ?? 0 : world.tuning.waterBusPurchaseCost ?? 0;
  if (!canAfford(world.economy, cost)) return { ok: false, reason: kind === "barge" ? "can't afford a barge" : "can't afford a water bus" };
  return { ok: true };
}

/** A water bus or a barge on the line between two jetties, opening it if it's new. */
export function addBoat(world: GameWorld, a: string, b: string, kind: BoatKind): ActionResult {
  const check = checkBoat(world, a, b, kind);
  if (!check.ok) return check;
  const t = world.tuning;
  const routeId = kind === "barge" ? bargeRouteId(a, b) : boatRouteId(a, b);
  const list: GameRoute[] = kind === "barge" ? world.lorryRoutes : world.routes;
  let route = list.find((candidate) => candidate.id === routeId);
  if (!route) {
    route = { id: routeId, a, b, vehicleIds: [], openedAtSeconds: world.economy.elapsedSeconds, boardingRateEMA: 0, loadFactorEMA: 0, speedEMA: 1 };
    list.push(route);
    forgetRoute(world.ledger, route.id);
    if (kind === "boat") world.plans = null; // a new line changes how riders cross the network
  }
  if (!(world.waterLinks ?? []).some((link) => link.id === routeId)) {
    const way = waterWay(world, route.a, route.b, kind)!;
    world.waterLinks = [...(world.waterLinks ?? []), { id: routeId, kind, a: route.a, b: route.b, length: way.length, points: way.points }];
  }
  const id = `${kind}-${world.nextId++}`;
  const routing = waterRouting(world, kind);
  const vehicle =
    kind === "barge"
      ? createVehicle(id, [route.a, route.b], routing, t.bargeSpeed ?? 1.5, t.bargeCapacity ?? 200, undefined, "goods", 0)
      : createVehicle(id, [route.a, route.b], routing, t.waterBusSpeed ?? 2.5, t.waterBusCapacity ?? 60, undefined, "passengers", 0);
  (world.boatVehicles ??= new Set()).add(id);
  // Spread out like buses (world.ts addBus): a convoy serves no more often than one.
  const others = route.vehicleIds
    .map((otherId) => world.simulation.vehicles.find((candidate) => candidate.id === otherId))
    .filter((candidate): candidate is Vehicle => candidate !== undefined);
  placeAtCycleFraction(world, vehicle, largestGapMidpoint(others.map((other) => cycleFraction(world, other))));
  world.simulation.vehicles.push(vehicle);
  const price = kind === "barge" ? t.bargePurchaseCost ?? 0 : t.waterBusPurchaseCost ?? 0;
  const running = kind === "barge" ? t.bargeOperatingCostPerSecond ?? 0 : t.waterBusOperatingCostPerSecond ?? 0;
  registerPurchase(world.economy, id, price, running, kind === "barge" ? BARGE_DEF_ID : BOAT_DEF_ID);
  route.vehicleIds.push(id);
  return { ok: true };
}

/** Running cost a day of one boat on a line. */
export function boatCostPerDay(world: GameWorld, routeId: string): number {
  const t = world.tuning;
  return (isBargeRoute(routeId) ? t.bargeOperatingCostPerSecond ?? 0 : t.waterBusOperatingCostPerSecond ?? 0) * SECONDS_PER_GAME_DAY;
}

/** A closed line's way off the water (its last boat sold). */
export function forgetLink(world: GameWorld, routeId: string): void {
  if (world.waterLinks?.some((link) => link.id === routeId)) world.waterLinks = world.waterLinks.filter((link) => link.id !== routeId);
}
