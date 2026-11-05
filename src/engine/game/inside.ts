import type { GameWorld } from "./types";
import { urbanAt, urbanRiders } from "./metro";

// The inside scale (docs/SCALES-AND-MODES.md, scope 3; brief, Scales). A town's own journeys --
// the short trips inside it, `localTripsPerThousandPerDay` of its people a day -- were one number
// the kekes and okadas carried, invisible and "not counted against you". Now they're one number in
// four slices that sum to one, worked out when asked (a few sums a town):
//
//   - car: its private cars as trips -- the cars it has had all along (private.ts: a small share of
//     its size and all its growth since day 1, prosperity's), each car trip `privateLoadPerCarTrip`
//     of road load, so a town with no city line and rising prosperity sees this slice grow; 4% on
//     day 1, about 22% grown a third, 44% doubled;
//   - walk: the small town's, falling as it grows -- `walkableTownPopulation` over its people plus
//     that (a 10k village walks 80% of them, a 100k town 29%) -- and as it prospers: the cars come
//     first, so its cars are exactly what they always were;
//   - your city line: what your lines in it carry (metro.ts), taken out of the cars and the
//     informal in one stated ratio, its rung's (`carDraw` from the cars -- the metro's
//     `cityLineCarDraw` -- the rest from the informal, each no more than it has) -- one partition,
//     one subtraction, so the shares add up. A light rail stopped by a strike carries none, and its
//     riders are back in the cars and on the okadas;
//   - keke and okada: the rest, the informal's own ground.
//
// Only the car slice leaves the town: it's what loads the approach roads (private.ts townCars is
// car trips times their load). With no city line the cars are what they always were, so every
// check measured before still compares; a city line takes cars off your own approach roads -- its
// reason to exist, more than its fare.

/** A town's inside trips a day: its people, `localTripsPerThousandPerDay` a thousand. */
export function insideTrips(world: GameWorld, townId: string): number {
  const town = world.towns.get(townId);
  return town && !town.industry ? town.population * world.tuning.localTripsPerThousandPerDay : 0;
}

/** A town's cars as they've always been (private.ts before the split): a share of its size and all its growth, as road load. */
export function carsByProsperity(world: GameWorld, townId: string): number {
  const town = world.towns.get(townId);
  if (!town || town.industry) return 0;
  const t = world.tuning;
  const base = world.basePopulation.get(townId) ?? town.population;
  return (t.privatePerThousand ?? 0) * ((t.privateBaseShare ?? 0) * town.population + Math.max(0, town.population - base));
}

export interface InsideSplit {
  /** Inside trips a day. */
  trips: number;
  /** Shares of them, summing to one. */
  walk: number;
  informal: number;
  line: number;
  car: number;
  /** The car slice as it would be with no city line: what the line took from it is `carBase - car`. */
  carBase: number;
}

/**
 * The share of a town's inside trips your city lines carry (metro.ts), before it's taken from
 * anyone, and the share of that its rung draws out of the cars: the metro `cityLineCarDraw`, the
 * urban ladder's other rungs their own (light rail least: its trams take the okadas' riders).
 */
function cityLine(world: GameWorld, townId: string): { share: number; carDraw: number } {
  const at = urbanAt(world, townId);
  return at ? { share: urbanRiders(world, townId).share, carDraw: at.rung.carDraw } : { share: 0, carDraw: 0 };
}

/** A town's inside trips in their four slices. */
export function insideSplit(world: GameWorld, townId: string): InsideSplit {
  const trips = insideTrips(world, townId);
  const town = world.towns.get(townId);
  if (!town || trips <= 0) return { trips: 0, walk: 1, informal: 0, line: 0, car: 0, carBase: 0 };
  const t = world.tuning;
  const perTrip = t.privateLoadPerCarTrip ?? 0.0125;
  // Its cars as a share of its trips, first: the prosperous drive rather than walk. Then the walk
  // (falling as it grows, and as it prospers: no more than the cars leave), then the informal.
  const carBase = Math.min(1, carsByProsperity(world, townId) / (trips * perTrip));
  const walk = Math.min(t.walkableTownPopulation / (town.population + t.walkableTownPopulation), 1 - carBase);
  const informalBase = 1 - walk - carBase;
  // Your city line, out of the cars and the informal in the stated ratio, each no more than it has.
  const city = cityLine(world, townId);
  const line = Math.min(city.share, informalBase + carBase);
  let fromCar = Math.min(carBase, city.carDraw * line);
  let fromInformal = line - fromCar;
  if (fromInformal > informalBase) {
    fromCar = Math.min(carBase, fromCar + fromInformal - informalBase);
    fromInformal = informalBase;
  }
  return { trips, walk, informal: informalBase - fromInformal, line, car: carBase - fromCar, carBase };
}

/**
 * A town's cars as road load (private.ts): its car trips, each `privateLoadPerCarTrip` -- or, before
 * the split (no insideEnabled), as they were. Worked out as its cars less what a city line took, not
 * as share times trips: with no line it must be the old figure to the last bit, or a game with no
 * city line drifts from the same game before (a float's difference tips a decision by day 60).
 */
export function carLoad(world: GameWorld, townId: string): number {
  const cars = carsByProsperity(world, townId);
  if (!world.tuning.insideEnabled) return cars;
  const split = insideSplit(world, townId);
  const perTrip = world.tuning.privateLoadPerCarTrip ?? 0.0125;
  const taken = split.carBase - split.car;
  const most = split.trips * perTrip; // every one of its trips by car
  const load = cars < most ? cars : most;
  return taken > 0 ? Math.max(0, load - taken * split.trips * perTrip) : load;
}
