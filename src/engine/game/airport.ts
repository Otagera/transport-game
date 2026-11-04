import type { GameWorld } from "./types";
import type { DemandPair } from "../simulation/types";
import type { GoodsFlow } from "./goods";
import { addSite, dry, inHome, nearestDistance } from "./fuel";
import { inheritedRoad } from "./cement";
import { rebuildNetworks } from "./rail";
import { refreshDemand } from "./settlement";
import { SECONDS_PER_GAME_DAY as D } from "../economy/state";
import { MIN_CONDITION } from "../map/decay";

// The airport (docs/five-modes.md, 2. Airport; brief, The region, The gateways -- the third
// gateway, after the seaport and the border crossings). One a region. You don't run flights: it's
// a place that makes demand, and you connect it or you don't.
//
//   - Travellers: people flying in who need to get to the towns, and the towns' people flying out
//     -- a few hundred a day at the start (`airportTravellersPerThousand` of the region's people),
//     rising as the region grows, whether you serve them or not; most bound for the big towns and
//     the near ones. Demand at a point with no people: it grows nothing and generates nothing of
//     its own, it only needs reaching -- the game's core question at its purest, competing for a
//     term's money with things that serve people where they live.
//   - Air freight: high value, low tonnage (`airFreightPerThousand`: 5-15 t a day), to the market
//     towns; the hauliers carry it by road, paying the loading levy, and your freight train at
//     `airFreightRate` (8x) the tonne if you lay track to it.
//   - Brownfield: it's there on day 1, well outside the home city, with a long dirt road to it worn
//     to the floor (`airportRoadCondition`) -- as Nigerian airports usually are. Nobody has to build
//     it; reaching it well costs a road kept up as well as a bus (wear.ts), so it competes for a
//     term's money with the lines to towns rather than paying from day 1 on any bus.
//   - Unserved, it shows as a loss: its travellers who can't make the trip are counted as wanted
//     and not made, as a site's workers are (pairOutcomes).
//
// A site (industry "airport", no people of its own), placed at the start after every other site,
// behind `airportEnabled` (absent in older runs: no airport).

export const AIRPORT_ID = "airport";

const on = (world: GameWorld) => !!world.tuning.airportEnabled && !!world.airport && world.towns.has(world.airport);
const people = (world: GameWorld) => [...world.towns.values()].filter((t) => !t.industry);

export function airportOn(world: GameWorld): boolean {
  return on(world);
}

/**
 * At the start, last of the sites: on flat dry ground `airportMinCells`-`airportMaxCells` from the
 * home city, as far from any town as it can be there (out of everyone's way, and so out of the
 * way), on a long old dirt road to the home city.
 */
export function placeAirport(world: GameWorld): void {
  const t = world.tuning;
  if (!t.airportEnabled || world.airport || !world.port) return;
  const city = world.towns.get(world.port);
  if (!city) return;
  const min = t.airportMinCells ?? 18, max = t.airportMaxCells ?? 30;
  let best: { x: number; y: number; s: number } | null = null;
  for (let r = min; r <= max; r += 2) {
    for (let k = 0; k < 48; k += 1) {
      const a = (k / 48) * Math.PI * 2;
      const x = Math.round(city.x + Math.cos(a) * r), y = Math.round(city.y + Math.sin(a) * r);
      if (x < 6 || y < 6 || x > world.width - 7 || y > world.height - 7) continue;
      // The home city's airport, in its cluster's box, as the chains' sites are.
      if (!inHome(world, { x, y })) continue;
      // A runway wants flat dry ground round it.
      if (!dry(world, x, y, 3)) continue;
      const clear = nearestDistance(world, x, y);
      if (clear < 9) continue;
      const s = clear - Math.abs(r - (min + max) / 2) * 0.2;
      if (!best || s > best.s) best = { x, y, s };
    }
  }
  if (!best) return;
  addSite(world, AIRPORT_ID, `${city.name} Airport`, "airport", best).population = 0;
  world.airport = AIRPORT_ID;
  inheritedRoad(world, "airport-road", AIRPORT_ID, city.id);
  // Its road a poor one (the scope's brownfield): worn, until you keep it up.
  const road = world.simulation.map.segments.find((s) => s.id === "airport-road");
  if (road && t.wearEnabled && t.airportRoadCondition !== undefined) road.condition = Math.max(MIN_CONDITION, Math.min(1, t.airportRoadCondition));
  rebuildNetworks(world);
  world.plans = null;
  refreshDemand(world);
}

/** Travellers a day, each way, the region's people as they are now. */
export function airportTravellersPerDay(world: GameWorld): number {
  if (!on(world)) return 0;
  return (world.tuning.airportTravellersPerThousand ?? 0.25) * people(world).reduce((sum, t) => sum + t.population, 0);
}

/** How the airport's travellers split over the towns: by their people, the near ones more. */
function shares(world: GameWorld): Array<{ town: string; share: number }> {
  const airport = world.towns.get(world.airport!)!;
  const decay = world.tuning.airportReachCells ?? 100;
  const weights = people(world).map((t) => ({ town: t.id, w: t.population / (1 + Math.hypot(t.x - airport.x, t.y - airport.y) / decay) }));
  const total = weights.reduce((sum, x) => sum + x.w, 0) || 1;
  return weights.map((x) => ({ town: x.town, share: x.w / total })).filter((x) => x.share > 0.002);
}

/** The airport's trips (settlement.ts refreshDemand, once a day): arrivals to the towns and the towns' departures, the same each way. */
export function airportDemand(world: GameWorld): DemandPair[] {
  if (!on(world)) return [];
  const each = airportTravellersPerDay(world) / D;
  const pairs: DemandPair[] = [];
  for (const { town, share } of shares(world)) {
    pairs.push({ from: world.airport!, to: town, kind: "passengers", rate: each * share });
    pairs.push({ from: town, to: world.airport!, kind: "passengers", rate: each * share });
  }
  return pairs;
}

/** Air freight (goods.ts goodsFlows): to the market towns by their people, high value, a few tonnes a day. */
export function airportFlows(world: GameWorld): GoodsFlow[] {
  if (!on(world) || !world.tuning.goodsEnabled) return [];
  const t = world.tuning;
  const towns = people(world).filter((x) => x.population >= t.marketPopulation);
  const total = towns.reduce((sum, x) => sum + x.population, 0);
  if (total <= 0) return [];
  const perDay = (t.airFreightPerThousand ?? 0.012) * people(world).reduce((sum, x) => sum + x.population, 0);
  return towns.map((x) => ({ from: world.airport!, to: x.id, kind: "supplies" as const, rate: (perDay * x.population) / total / D }));
}

/** Whether goods came from the airport: air freight, paid at `airFreightRate` the tonne (fares.ts). */
export function isAirCargo(world: GameWorld, origin: string): boolean {
  return !!world.airport && origin === world.airport;
}

/** The airport for its card: its travellers and who carried them, its freight and who carried it. */
export function airportSummary(world: GameWorld) {
  if (!on(world)) return null;
  const id = world.airport!;
  let you = 0, informal = 0, stranded = 0, wanted = 0;
  for (const [key, r] of world.pairOutcomes) {
    const i = key.indexOf(":");
    if (key.slice(0, i) !== id && key.slice(i + 1) !== id) continue;
    // Gave up waiting for you: they went by danfo. Lost: they didn't go.
    you += r.player;
    informal += r.poached + r.gaveUp;
    stranded += r.lost;
    wanted += r.player + r.poached + r.gaveUp + r.lost;
  }
  let flown = 0, carried = 0, trucked = 0;
  for (const f of airportFlows(world)) {
    flown += f.rate;
    const o = world.goods.outcomes.get(`${f.from}:${f.to}:${f.kind}`);
    carried += o?.delivered ?? 0;
    trucked += o?.trucked ?? 0;
  }
  return {
    id,
    travellersPerDay: airportTravellersPerDay(world),
    tripsPerDay: wanted * D,
    you: wanted > 0 ? you / wanted : 0,
    informal: wanted > 0 ? informal / wanted : 0,
    stranded: wanted > 0 ? stranded / wanted : 0,
    freightPerDay: flown * D,
    freightYours: carried * D,
    freightHauliers: trucked * D,
  };
}

/** Trips wanted to or from the airport that weren't made, a day: what leaving it unserved costs. */
export function airportStranded(world: GameWorld): number {
  const s = airportSummary(world);
  return s ? s.tripsPerDay * s.stranded : 0;
}

