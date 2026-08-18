import type { CargoKind } from "../simulation/types";

// Fares are global per cargo kind, not per route (docs/principles.md
// §3): a transport authority sets fares by policy, which keeps demand
// elasticity well-defined.
export type FareTable = Record<CargoKind, number>;

export interface VehicleEconomics {
  purchaseCost: number;
  operatingCostPerSecond: number;
  purchasedAtSeconds: number;
  // Module 8, graceful obsolescence (docs/principles.md §3): a vehicle
  // whose def falls outside the current era's eraIn/eraOut window keeps
  // running -- it is never force-despawned -- but costs rising maintenance
  // the longer it stays obsolete. `defId` is what a transition handler
  // checks against the catalog; `obsoleteSinceSeconds` is null while the
  // vehicle is still current, set once, and never cleared (an era timeline
  // only advances forward, so a vehicle can't un-obsolete).
  defId: string;
  obsoleteSinceSeconds: number | null;
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
  // decisions here too (docs/principles.md §3: "EMAs, never a single
  // tick" -- the same pattern used for spawn/despawn/growth elsewhere).
  incomeRateEMA: number;
  costRateEMA: number;
}
