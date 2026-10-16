import type { PathResult, SimulationState } from "../simulation/types";
import type { EconomyState } from "../economy/types";
import type { SettlementState } from "./settlement";
import type { TripPlans } from "./transfers";

// The slice (docs/principles.md §6): the smallest loop that can be felt --
// towns, straight roads, one bus type, passengers who give up, and the
// danfos that carry the ones who did. Everything here is a plain mirror;
// engine/ stays content-unaware (architecture hard rule 2), so the
// bootstrap layer hands in a SliceMapDef rather than this module loading
// one.

export interface SliceTown {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Thousands of people. Drives gravity demand; nothing else yet. */
  population: number;
}

export interface SliceRoadDef {
  a: string;
  b: string;
}

export interface SliceMapDef {
  width: number;
  height: number;
  towns: SliceTown[];
  /** Inherited roads -- the network that already exists at start. */
  roads: SliceRoadDef[];
}

/** A player route: an A<->B shuttle, running however many buses. */
export interface SliceRoute {
  id: string;
  a: string;
  b: string;
  vehicleIds: string[];
  /** Rolling fare income for this route, currency per second. */
  revenueRateEMA: number;
  /** Rolling riders boarding this route's buses, per second. */
  boardingRateEMA: number;
  /** Rolling mean of how full this route's buses are, 0..1. */
  loadFactorEMA: number;
}

/**
 * Where one (origin, destination) pair's passengers ended up, as rolling
 * rates (passengers per second). Every generated passenger lands in
 * exactly one bucket, which is what makes shares comparable:
 *
 * - player:  boarded one of your buses.
 * - poached: a danfo passing through picked them up before your bus came.
 * - gaveUp:  waited too long, then left on a danfo.
 * - lost:    gave up and stayed home (no road, or the danfo never filled).
 *
 * Danfo share is poached + gaveUp; they're kept apart because they answer
 * different questions when a route is losing money.
 */
export interface OutcomeRates {
  player: number;
  poached: number;
  gaveUp: number;
  lost: number;
}

export interface InformalState {
  /** pairKey -> passengers who gave up and are gathering for a danfo. */
  pool: Map<string, number>;
  /** danfo vehicleId -> the segments it occupies, for the corridor cap. */
  active: Map<string, { segmentIds: string[] }>;
  segmentCounts: Map<string, number>;
  /** Fares the informal sector has collected -- money you didn't make. */
  earnings: number;
}

export interface SliceTuning {
  /** Mean seconds a waiting passenger stays before giving up. */
  patienceSeconds: number;
  /** Gravity demand: passengers/sec = k * popA * popB / distance. */
  demandK: number;
  fare: number;
  roadCostPerCell: number;
  busCapacity: number;
  busSpeed: number;
  busPurchaseCost: number;
  busOperatingCostPerSecond: number;
  danfoCapacity: number;
  danfoSpeed: number;
  danfoCorridorCap: number;
  startingFunds: number;
  /** Time constant for every rolling rate the player reads. */
  outcomeTauSeconds: number;
  /** Danfos and buses slow each other down on shared road (step 2). */
  congestion: boolean;

  // Towns along busy roads (settlement.ts).
  /** Time constant for each road's rolling traffic flow. */
  flowTauSeconds: number;
  settlementCheckSeconds: number;
  /** Riders/sec past a point a road needs before a town grows on it. */
  foundTownFlow: number;
  /** ...of which at least this much must be your buses. */
  foundTownPlayerFlow: number;
  /** No town within this many cells of another; roads shorter than twice this never get one. */
  townSpacingCells: number;
  maxEmergentTowns: number;
  minSecondsBetweenTowns: number;
  newTownPopulation: number;
  /** Thousands of people an emergent town supports per rider/sec passing through it. */
  populationPerFlow: number;
  maxEmergentPopulation: number;
  townPopulationTauSeconds: number;
  /** An emergent town that shrinks below this is abandoned. */
  abandonBelowPopulation: number;
}

export interface SliceWorld {
  width: number;
  height: number;
  towns: Map<string, SliceTown>;
  tuning: SliceTuning;
  simulation: SimulationState;
  economy: EconomyState;
  routes: SliceRoute[];
  informal: InformalState;
  /** pairKey (`from:to`) -> where that trip's passengers went. Town and network shares are sums of these. */
  pairOutcomes: Map<string, OutcomeRates>;
  settlement: SettlementState;
  /** Emergent towns that faded: kept so their names can stay on the map. */
  ruins: Map<string, SliceTown>;
  /** townId -> rolling riders per second changing buses there. */
  transferRateEMA: Map<string, number>;
  /** How riders cross your network (transfers.ts). Null = stale; rebuilt on next use. */
  plans: TripPlans | null;
  /** pairKey -> road path, or null if the pair isn't connected. Cleared on every road change. */
  pathCache: Map<string, PathResult | null>;
  nextId: number;
}
