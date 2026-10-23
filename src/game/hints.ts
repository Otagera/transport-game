import type { GameWorld } from "@engine/game/types";
import { isCutOff } from "@engine/game/world";
import { isYourRoad } from "@engine/game/upkeep";
import { isRailRoute } from "@engine/game/rail";
import { averageBudget } from "@engine/game/history";
import { SECONDS_PER_GAME_DAY } from "@engine/economy/state";

// The six hints (docs/brief.md, Information design: "Hints replace Best
// next moves"). Each fires once, when the game's state calls for it; each is
// dismissed by doing the thing it suggests; all can be switched off; each
// points at the map -- a town, a road -- never at a purchase.
//
// No DOM here: main.ts calls updateHints every panel refresh with what the
// player is hovering, and draws whichever hint is showing next to the town
// it names.

export type HintId = 1 | 2 | 3 | 4 | 5 | 6;

export const HINT_TEXT: Record<HintId, string> = {
  1: "Demand (top left) shows where people want to go; hover a town to see its roads and routes.",
  2: "A bus runs between two towns a road joins. The thickest line with a road under it is a good start.",
  3: "Dashed lines have no road. Build one (R) and danfos will come; run a bus and you will.",
  4: "Your bus leaves full: riders left behind go to the danfos.",
  5: "Money is low. Selling a losing vehicle returns most of its price (− on the route).",
  6: "Danfos on a road you built pay its toll and charge their riders more.",
};

/** A buses-full route has to stay full this long (brief: "for a day"). */
const FULL_FOR_SECONDS = SECONDS_PER_GAME_DAY;
const FULL_LOAD = 0.97;
/** Funds under this many days of running costs and upkeep is "low" (brief: a week). */
const LOW_FUNDS_DAYS = 7;

/** What a fired hint was about, to point at and to know when it's done. */
export interface HintContext {
  town?: string;
  routeId?: string;
  /** Vehicles on that route, or yours in all, when it fired. */
  vehicles?: number;
  /** Routes you ran when it fired. */
  routes?: number;
  firedAtSeconds?: number;
}

export interface HintState {
  /** Off: nothing shows (a switch the player keeps). */
  off: boolean;
  /** Triggered, waiting to show; one shows at a time, lowest first. */
  triggered: Map<HintId, HintContext>;
  showing: { id: HintId; context: HintContext } | null;
  /** Shown and dismissed, or found already done: never again. */
  done: Set<HintId>;
  /** Since when each route has run full, for hint 4. */
  fullSince: Map<string, number>;
}

export function createHintState(off = false): HintState {
  return { off, triggered: new Map([[1, {}]]), showing: null, done: new Set(), fullSince: new Map() };
}

const yourRoutes = (world: GameWorld) => world.routes.filter((route) => !isRailRoute(route.id));
const yourVehicles = (world: GameWorld) => world.routes.reduce((sum, route) => sum + route.vehicleIds.length, 0);
const hasYourRoad = (world: GameWorld) => world.simulation.map.segments.some((segment) => segment.type === "road" && isYourRoad(segment));

/** A week of running costs and upkeep, and funds under it (hint 5). */
function fundsLow(world: GameWorld): boolean {
  const budget = averageBudget(world);
  const costs = budget.running + budget.upkeep;
  return costs > 0 && world.economy.funds < LOW_FUNDS_DAYS * costs;
}

/** Whether the thing a hint suggests has been done (or no longer applies). */
function isDone(world: GameWorld, id: HintId, context: HintContext, hoverTown: string | null): boolean {
  switch (id) {
    case 1:
      return hoverTown !== null;
    case 2:
      return yourRoutes(world).length > (context.routes ?? 0);
    case 3:
      // A road built, or the town reached: the dashed line got its road.
      return hasYourRoad(world) || (context.town !== undefined && !isCutOff(world, context.town));
    case 4: {
      const route = world.routes.find((candidate) => candidate.id === context.routeId);
      return !route || route.vehicleIds.length > (context.vehicles ?? 0);
    }
    case 5:
      return !fundsLow(world) || yourVehicles(world) < (context.vehicles ?? 0);
    case 6:
      // Nothing to do but read it: it goes after a game day.
      return world.economy.elapsedSeconds - (context.firedAtSeconds ?? world.economy.elapsedSeconds) >= SECONDS_PER_GAME_DAY;
  }
}

/** Latches any hint whose trigger the world (or the hover) now meets. */
function trigger(state: HintState, world: GameWorld, hoverTown: string | null): void {
  const latch = (id: HintId, context: HintContext) => {
    if (!state.done.has(id) && !state.triggered.has(id) && state.showing?.id !== id) state.triggered.set(id, context);
  };
  if (hoverTown && world.towns.has(hoverTown)) {
    if (isCutOff(world, hoverTown)) latch(3, { town: hoverTown });
    else latch(2, { town: hoverTown, routes: yourRoutes(world).length });
  }
  const now = world.economy.elapsedSeconds;
  for (const route of yourRoutes(world)) {
    if (route.vehicleIds.length === 0 || route.loadFactorEMA < FULL_LOAD) {
      state.fullSince.delete(route.id);
      continue;
    }
    const since = state.fullSince.get(route.id) ?? now;
    state.fullSince.set(route.id, since);
    if (now - since >= FULL_FOR_SECONDS) latch(4, { town: route.a, routeId: route.id, vehicles: route.vehicleIds.length });
  }
  if (fundsLow(world)) latch(5, { vehicles: yourVehicles(world) });
  if (hasYourRoad(world)) {
    const road = world.simulation.map.segments.find((segment) => segment.type === "road" && isYourRoad(segment));
    latch(6, { town: road?.fromNodeId, firedAtSeconds: now });
  }
}

/**
 * Called every panel refresh: dismisses the hint showing if its thing is
 * done, latches new triggers, and shows the next one waiting. Returns the
 * hint to show, if any.
 */
export function updateHints(state: HintState, world: GameWorld, hoverTown: string | null): { id: HintId; text: string; town?: string } | null {
  if (state.showing && isDone(world, state.showing.id, state.showing.context, hoverTown)) {
    state.done.add(state.showing.id);
    state.showing = null;
  }
  trigger(state, world, hoverTown);
  while (!state.showing && state.triggered.size > 0) {
    const id = Math.min(...state.triggered.keys()) as HintId;
    const context = state.triggered.get(id)!;
    state.triggered.delete(id);
    // Already done by the time its turn came (a road built before hint 3 could show): skip it.
    if (id !== 6 && isDone(world, id, context, hoverTown)) {
      state.done.add(id);
      continue;
    }
    state.showing = { id, context: id === 6 ? { ...context, firedAtSeconds: world.economy.elapsedSeconds } : context };
  }
  if (state.off || !state.showing) return null;
  const { id, context } = state.showing;
  return { id, text: HINT_TEXT[id], town: context.town && world.towns.has(context.town) ? context.town : undefined };
}

/** The player closed the hint showing (×): it counts as seen. */
export function dismissHint(state: HintState): void {
  if (!state.showing) return;
  state.done.add(state.showing.id);
  state.showing = null;
}
