import type { GameWorld } from "./types";

// Transfers (docs/principles.md §6): a rider whose destination isn't on any
// one of your routes rides to an interchange, gets off, and waits there for
// the next bus -- exactly how a long trip works across danfo parks. Without
// this, a network was only a pile of separate shuttles and the one winning
// play was a direct route per big pair (playtest, 2026-10-16).
//
// Riders minimise the number of buses they take; ties go to the interchange
// nearest their destination. Aggregate, not per-rider (architecture hard
// rule 4): the plan is a lookup, `(where I am, where I'm going, which route
// is boarding) -> where I get off`, rebuilt whenever a route or the map
// changes.

export interface TripPlans {
  /** at -> destination -> routeId -> stop to get off at. Only routes on a fewest-buses trip appear. */
  alight: Map<string, Map<string, Map<string, string>>>;
  /** at -> destination -> buses still needed. Missing: your network can't get them there. */
  rides: Map<string, Map<string, number>>;
  /** routeId -> its stops, in path order. */
  stops: Map<string, string[]>;
}

export function routeStops(world: GameWorld, routeId: string): string[] {
  const route = world.routes.find((candidate) => candidate.id === routeId);
  const vehicle = route && world.simulation.vehicles.find((candidate) => candidate.id === route.vehicleIds[0]);
  if (!vehicle) return [];
  return [...new Set(vehicle.path)];
}

export function buildTripPlans(world: GameWorld): TripPlans {
  const stops = new Map(world.routes.map((route) => [route.id, routeStops(world, route.id)]));
  const plans: TripPlans = { alight: new Map(), rides: new Map(), stops };
  const positions = world.simulation.routing.positions;
  const nodes = new Set([...stops.values()].flat());

  for (const destination of world.towns.keys()) {
    if (!nodes.has(destination)) continue;

    // Breadth-first over routes: a stop is k rides from the destination if
    // some route through it reaches a stop k-1 rides away.
    const rides = new Map<string, number>([[destination, 0]]);
    let frontier = new Set([destination]);
    for (let k = 1; frontier.size > 0; k += 1) {
      const next = new Set<string>();
      for (const routeNodes of stops.values()) {
        if (!routeNodes.some((stop) => frontier.has(stop))) continue;
        for (const stop of routeNodes) {
          if (rides.has(stop)) continue;
          rides.set(stop, k);
          next.add(stop);
        }
      }
      frontier = next;
    }

    const goal = positions.get(destination)!;
    const distanceToGoal = (stop: string) => {
      const p = positions.get(stop)!;
      return Math.hypot(p.x - goal.x, p.y - goal.y);
    };

    for (const [at, k] of rides) {
      if (at === destination) continue;
      let byRoute = plans.alight.get(at)?.get(destination);
      for (const [routeId, routeNodes] of stops) {
        if (!routeNodes.includes(at)) continue;
        // Get off at the stop on this route that leaves the fewest buses to
        // go; on a tie, the one nearest the destination.
        let best: string | null = null;
        for (const stop of routeNodes) {
          if (stop === at) continue;
          const left = rides.get(stop);
          if (left === undefined || left !== k - 1) continue;
          if (best === null || distanceToGoal(stop) < distanceToGoal(best)) best = stop;
        }
        if (best === null) continue;
        if (!byRoute) {
          byRoute = new Map();
          if (!plans.alight.has(at)) plans.alight.set(at, new Map());
          plans.alight.get(at)!.set(destination, byRoute);
        }
        byRoute.set(routeId, best);
      }
      if (!plans.rides.has(at)) plans.rides.set(at, new Map());
      plans.rides.get(at)!.set(destination, k);
    }
  }
  return plans;
}

/** The plan, rebuilt only when something marked it stale. */
export function tripPlans(world: GameWorld): TripPlans {
  if (!world.plans) world.plans = buildTripPlans(world);
  return world.plans;
}

/**
 * Every route a trip from origin to destination might ride on some
 * fewest-buses journey. Empty if your network can't carry it.
 *
 * All of them, not one chosen path: when two routes serve a leg equally
 * well (a direct Ilase-Mile 6 route, and Ilase-Owode stopping at Mile 6),
 * riders board whichever comes first, so both carry the trip. Following
 * only the alphabetically-first option told the second route "0 riders
 * want these trips" while it was boarding 7 a day (playtest, day 91).
 */
export function routesOnTrip(world: GameWorld, origin: string, destination: string): Set<string> {
  const plans = tripPlans(world);
  const used = new Set<string>();
  const seen = new Set<string>();
  const stack = [origin];
  while (stack.length > 0) {
    const at = stack.pop()!;
    if (at === destination || seen.has(at)) continue;
    seen.add(at);
    for (const [routeId, stop] of plans.alight.get(at)?.get(destination) ?? []) {
      used.add(routeId);
      stack.push(stop);
    }
  }
  return used;
}
