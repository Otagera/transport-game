import type { DeliveryEvent } from "../simulation/types";
import { computeRevenue } from "./fares";
import type { EconomyState, FareTable, VehicleEconomics } from "./types";

export const SECONDS_PER_GAME_DAY = 30;
const MIN_RESALE_FRACTION = 0.15;
const DEPRECIATION_PER_DAY = 0.05;
const BURN_RATE_TIME_CONSTANT_SECONDS = 10;
// Module 8, graceful obsolescence: maintenance ramps 2%/sec obsolete,
// capped at 3x -- rising, so staying obsolete is a real cost, but capped
// so it never becomes an unrecoverable death spiral for a single vehicle
// (docs/principles.md §3: no game over).
const OBSOLESCENCE_RAMP_PER_SECOND = 0.02;
const OBSOLESCENCE_MAX_MULTIPLIER = 3;

export function createEconomyState(fareTable: FareTable, startingFunds: number): EconomyState {
  return {
    funds: startingFunds,
    elapsedSeconds: 0,
    fareTable,
    vehicleEconomics: new Map(),
    ledger: new Map(),
    incomeRateEMA: 0,
    costRateEMA: 0,
  };
}

// Spending is blocked when it isn't affordable; billing (operating cost)
// is unconditional and keeps applying regardless (docs/principles.md
// §3: "Spending blocked, billing continues"). Debt itself is allowed --
// no interest, no game over -- it just accumulates from ongoing costs
// outrunning revenue, not from being allowed to overspend on a purchase.
export function canAfford(state: EconomyState, cost: number): boolean {
  return state.funds >= cost;
}

export function registerPurchase(
  state: EconomyState,
  vehicleId: string,
  purchaseCost: number,
  operatingCostPerSecond: number,
  defId: string,
): void {
  state.funds -= purchaseCost;
  state.vehicleEconomics.set(vehicleId, {
    purchaseCost,
    operatingCostPerSecond,
    purchasedAtSeconds: state.elapsedSeconds,
    defId,
    obsoleteSinceSeconds: null,
  });
  state.ledger.set(vehicleId, { vehicleId, revenue: 0, cost: 0 });
}

// Called once per obsoleted vehicle, from an era transition handler that
// knows which defIds fell outside the new era's window -- economy/state.ts
// itself stays content-unaware, same as elsewhere in engine/. A no-op if
// already marked: an era timeline only moves forward, so a vehicle can't
// un-obsolete and re-obsolete.
export function markVehicleObsolete(state: EconomyState, vehicleId: string): void {
  const econ = state.vehicleEconomics.get(vehicleId);
  if (!econ || econ.obsoleteSinceSeconds !== null) return;
  econ.obsoleteSinceSeconds = state.elapsedSeconds;
}

function obsolescenceMultiplier(econ: VehicleEconomics, elapsedSeconds: number): number {
  if (econ.obsoleteSinceSeconds === null) return 1;
  const secondsObsolete = elapsedSeconds - econ.obsoleteSinceSeconds;
  return Math.min(OBSOLESCENCE_MAX_MULTIPLIER, 1 + OBSOLESCENCE_RAMP_PER_SECOND * secondsObsolete);
}

// Depreciated resale (docs/principles.md §3): without this, a player in
// debt liquidates the fleet and is instantly solvent. Floors at
// MIN_RESALE_FRACTION rather than depreciating to zero.
// What selling a vehicle would return now -- the preview and the sale are
// this one computation.
export function resaleValue(state: EconomyState, vehicleId: string): number {
  const econ = state.vehicleEconomics.get(vehicleId);
  if (!econ) return 0;
  const secondsOwned = state.elapsedSeconds - econ.purchasedAtSeconds;
  const daysOwned = secondsOwned / SECONDS_PER_GAME_DAY;
  const fraction = Math.max(MIN_RESALE_FRACTION, 1 - DEPRECIATION_PER_DAY * daysOwned);
  return econ.purchaseCost * fraction;
}

export function sellVehicle(state: EconomyState, vehicleId: string): number {
  const econ = state.vehicleEconomics.get(vehicleId);
  if (!econ) return 0;
  const resaleAmount = resaleValue(state, vehicleId);

  state.funds += resaleAmount;
  state.vehicleEconomics.delete(vehicleId);
  state.ledger.delete(vehicleId);
  return resaleAmount;
}

function emaUpdate(previous: number, instantaneous: number, dt: number, tau: number): number {
  const alpha = 1 - Math.exp(-dt / tau);
  return previous + (instantaneous - previous) * alpha;
}

// Operating cost is per-tick and unconditional (docs/principles.md §3)
// -- it applies even if funds go negative doing so. The era fuel
// multiplier is applied live here, not baked into operatingCostPerSecond
// at purchase time (Module 8): a fuel-price era transition must bite
// every vehicle already on the road, not just ones bought after the
// transition -- "Informal-era fuel spike bites operationally" is a felt
// event, not a catalog footnote.
// `otherCostThisTick` is spending that isn't a vehicle's (the slice's road
// upkeep), charged here so it counts in the same burn rate. The original
// game passes none.
export function applyOperatingCosts(state: EconomyState, dt: number, fuelMultiplier: number = 1, otherCostThisTick: number = 0): void {
  state.elapsedSeconds += dt;

  let costThisTick = otherCostThisTick;
  state.funds -= otherCostThisTick;
  for (const [vehicleId, econ] of state.vehicleEconomics) {
    const cost = econ.operatingCostPerSecond * fuelMultiplier * obsolescenceMultiplier(econ, state.elapsedSeconds) * dt;
    costThisTick += cost;
    state.funds -= cost;
    const entry = state.ledger.get(vehicleId);
    if (entry) entry.cost += cost;
  }

  state.costRateEMA = emaUpdate(state.costRateEMA, costThisTick / dt, dt, BURN_RATE_TIME_CONSTANT_SECONDS);
}

// Per-vehicle ledger update only -- does not touch incomeRateEMA. Call
// once per vehicle per tick; the EMA is a single global rate and must be
// updated exactly once per tick (see updateIncomeRateEMA), or calling it
// once per vehicle would decay it toward zero on every vehicle that
// didn't happen to deliver this tick, compounding with vehicle count.
export function recordDeliveryRevenue(state: EconomyState, vehicleId: string, events: DeliveryEvent[]): number {
  let revenue = 0;
  for (const event of events) {
    revenue += computeRevenue(state.fareTable, event.kind, event.amount);
  }
  if (revenue === 0) return 0;
  state.funds += revenue;
  const entry = state.ledger.get(vehicleId);
  if (entry) entry.revenue += revenue;
  return revenue;
}

export function updateIncomeRateEMA(state: EconomyState, totalRevenueThisTick: number, dt: number): void {
  state.incomeRateEMA = emaUpdate(state.incomeRateEMA, totalRevenueThisTick / dt, dt, BURN_RATE_TIME_CONSTANT_SECONDS);
}
