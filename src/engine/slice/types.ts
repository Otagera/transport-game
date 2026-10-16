import type { PathResult, SimulationState } from "../simulation/types";
import type { EconomyState } from "../economy/types";

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
}

/**
 * Where each town's passengers ended up, as rolling rates (passengers per
 * second). Every generated passenger eventually lands in exactly one of
 * these three -- boarded one of your buses, gave up and took a danfo, or
 * gave up and stayed home -- which is what makes the shares comparable.
 */
export interface TownOutcomeRates {
  player: number;
  informal: number;
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
  outcomes: Map<string, TownOutcomeRates>;
  /** pairKey -> road path, or null if the pair isn't connected. Cleared on every road change. */
  pathCache: Map<string, PathResult | null>;
  nextId: number;
}
