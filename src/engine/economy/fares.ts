import type { CargoKind } from "../simulation/types";
import type { FareTable } from "./types";

// Fares are global per cargo kind, not per route (docs/principles.md
// §3) -- a transport authority sets fares by policy.
export function computeRevenue(fareTable: FareTable, kind: CargoKind, amount: number): number {
  return fareTable[kind] * amount;
}
