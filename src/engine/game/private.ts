import type { GameWorld } from "./types";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// Private traffic (docs/brief.md, Revision 5, Ideas parked: "we did not account for other
// humans driving on our roads"). The original game's Module 12 (git 661492b), carried over:
//
//   - No car agents. A private car is not something the simulation moves; it's something that
//     makes the road narrower: a load on each road, in the same units as the vehicles' flow
//     (danfo-equivalents a second), added to it where speed is worked out (congestion.ts).
//   - It grows with prosperity: a town's cars are a small share of its size, plus its growth
//     since day 1 -- the growth your network caused. A town that doesn't grow adds little.
//   - Heaviest near towns. Each town's cars spread over its roads, each taking them for the
//     share of its length that lies near the town (within privateReachCells of either end): a
//     short approach into a city carries them all, a long highway a little -- something to route
//     round, not a flat tax on every road. (Faded by the distance to a road's middle, as Module
//     12 did on its finer roads, a city's own long approaches barely felt it: Katsina-Ala grown
//     from 135k to 191k added a few percent to its roads.)
//
// So success chokes the corridors that made it, and a growing city's approaches need lanes,
// BRT and rail to keep moving: the pressure the designer's review found missing, from your
// own success, not a script. Worked out once a game day (populations move slowly); plain data
// on the world. Off, and absent, in runs played before it (no privateTrafficEnabled).

/** Each road's private-car load now (danfo-equivalents a second); 0 when it's off. */
export function privateLoad(world: GameWorld, segmentId: string): number {
  return world.privateFlow?.get(segmentId) ?? 0;
}

/** A town's cars, as road load: a share of its size and all of its growth since day 1, thousands, times the load a thousand make. */
export function townCars(world: GameWorld, townId: string): number {
  const town = world.towns.get(townId);
  if (!town || town.industry) return 0;
  const t = world.tuning;
  const base = world.basePopulation.get(townId) ?? town.population;
  return (t.privatePerThousand ?? 0) * ((t.privateBaseShare ?? 0) * town.population + Math.max(0, town.population - base));
}

/** Once a game day (tick.ts): every road's private load from the towns near it. */
export function updatePrivateTraffic(world: GameWorld): void {
  if (!world.tuning.privateTrafficEnabled) return;
  const now = world.economy.elapsedSeconds;
  if (world.privateFlowAtSeconds !== undefined && now < world.privateFlowAtSeconds + SECONDS_PER_GAME_DAY) return;
  world.privateFlowAtSeconds = now;
  const reach = world.tuning.privateReachCells ?? 8;
  // Roads between towns: cars don't drive to a tank farm or a quarry, and a big town's spurs
  // to its sites spread its cars thin over roads they don't use (Katsina-Ala's dozen).
  const isTown = (id: string) => world.towns.has(id) && !world.towns.get(id)!.industry;
  const roads = world.simulation.map.segments.filter((segment) => segment.type === "road" && segment.retiredAt === undefined && isTown(segment.fromNodeId) && isTown(segment.toNodeId));
  // How many roads each town's cars spread over.
  const degree = new Map<string, number>();
  for (const road of roads) for (const end of [road.fromNodeId, road.toNodeId]) degree.set(end, (degree.get(end) ?? 0) + 1);
  const nodes = new Map(world.simulation.map.nodes.map((node) => [node.id, node]));
  const flow = new Map<string, number>();
  for (const road of roads) {
    const a = nodes.get(road.fromNodeId);
    const b = nodes.get(road.toNodeId);
    if (!a || !b) continue;
    const length = road.length ?? Math.hypot(a.x - b.x, a.y - b.y);
    const near = Math.min(1, reach / Math.max(1, length));
    let load = 0;
    for (const end of [road.fromNodeId, road.toNodeId]) {
      const cars = townCars(world, end);
      if (cars > 0) load += (cars / Math.max(1, degree.get(end) ?? 1)) * near;
    }
    if (load > 0) flow.set(road.id, load);
  }
  world.privateFlow = flow;
}
