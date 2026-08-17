import type { CargoKind } from "../simulation/types";

// Fares are global per cargo kind, not per route (docs/rebuild-plan.md
// §5): a transport authority sets fares by policy, which keeps demand
// elasticity well-defined.
export type FareTable = Record<CargoKind, number>;

export interface VehicleEconomics {
  purchaseCost: number;
  operatingCostPerSecond: number;
  purchasedAtSeconds: number;
}

export interface RouteLedgerEntry {
  vehicleId: string;
  revenue: number;
  cost: number;
}

export interface EconomyState {
  funds: number;
  elapsedSeconds: number;
  fareTable: FareTable;
  vehicleEconomics: Map<string, VehicleEconomics>;
  ledger: Map<string, RouteLedgerEntry>;
  // Smoothed $/second rates, not a cumulative-since-start average -- a
  // cumulative average is sluggish to reflect a recent change (pruning a
  // bad route), diluted by all prior history. Sustained state gates
  // decisions here too (docs/rebuild-plan.md §5: "EMAs, never a single
  // tick" -- the same pattern used for spawn/despawn/growth elsewhere).
  incomeRateEMA: number;
  costRateEMA: number;
}
