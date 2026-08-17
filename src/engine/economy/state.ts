import type { DeliveryEvent } from "../simulation/types";
import { computeRevenue } from "./fares";
import type { EconomyState, FareTable } from "./types";

export const SECONDS_PER_GAME_DAY = 30;
const MIN_RESALE_FRACTION = 0.15;
const DEPRECIATION_PER_DAY = 0.05;
const BURN_RATE_TIME_CONSTANT_SECONDS = 10;

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
// is unconditional and keeps applying regardless (docs/rebuild-plan.md
// §5: "Spending blocked, billing continues"). Debt itself is allowed --
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
): void {
  state.funds -= purchaseCost;
  state.vehicleEconomics.set(vehicleId, {
    purchaseCost,
    operatingCostPerSecond,
    purchasedAtSeconds: state.elapsedSeconds,
  });
  state.ledger.set(vehicleId, { vehicleId, revenue: 0, cost: 0 });
}

// Depreciated resale (docs/rebuild-plan.md §5): without this, a player in
// debt liquidates the fleet and is instantly solvent. Floors at
// MIN_RESALE_FRACTION rather than depreciating to zero.
export function sellVehicle(state: EconomyState, vehicleId: string): number {
  const econ = state.vehicleEconomics.get(vehicleId);
  if (!econ) return 0;

  const secondsOwned = state.elapsedSeconds - econ.purchasedAtSeconds;
  const daysOwned = secondsOwned / SECONDS_PER_GAME_DAY;
  const fraction = Math.max(MIN_RESALE_FRACTION, 1 - DEPRECIATION_PER_DAY * daysOwned);
  const resaleAmount = econ.purchaseCost * fraction;

  state.funds += resaleAmount;
  state.vehicleEconomics.delete(vehicleId);
  state.ledger.delete(vehicleId);
  return resaleAmount;
}

function emaUpdate(previous: number, instantaneous: number, dt: number, tau: number): number {
  const alpha = 1 - Math.exp(-dt / tau);
  return previous + (instantaneous - previous) * alpha;
}

// Operating cost is per-tick and unconditional (docs/rebuild-plan.md §5)
// -- it applies even if funds go negative doing so. Era fuel multipliers
// are folded into operatingCostPerSecond at purchase/era-transition time
// (Module 8), not computed here.
export function applyOperatingCosts(state: EconomyState, dt: number): void {
  state.elapsedSeconds += dt;

  let costThisTick = 0;
  for (const [vehicleId, econ] of state.vehicleEconomics) {
    const cost = econ.operatingCostPerSecond * dt;
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
