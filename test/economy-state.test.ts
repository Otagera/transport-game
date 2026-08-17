import { describe, expect, test } from "bun:test";
import {
  applyOperatingCosts,
  canAfford,
  createEconomyState,
  recordDeliveryRevenue,
  registerPurchase,
  sellVehicle,
  SECONDS_PER_GAME_DAY,
  updateIncomeRateEMA,
} from "@engine/economy/state";

const fareTable = { passengers: 2, produce: 1, supplies: 1.5 };

describe("canAfford", () => {
  test("true when funds cover the cost, false otherwise", () => {
    const state = createEconomyState(fareTable, 100);
    expect(canAfford(state, 100)).toBe(true);
    expect(canAfford(state, 101)).toBe(false);
  });
});

describe("registerPurchase", () => {
  test("deducts funds and creates ledger + economics entries", () => {
    const state = createEconomyState(fareTable, 500);
    registerPurchase(state, "v1", 200, 4);
    expect(state.funds).toBe(300);
    expect(state.vehicleEconomics.get("v1")).toEqual({
      purchaseCost: 200,
      operatingCostPerSecond: 4,
      purchasedAtSeconds: 0,
    });
    expect(state.ledger.get("v1")).toEqual({ vehicleId: "v1", revenue: 0, cost: 0 });
  });

  test("purchasing is allowed to run funds negative -- spending gating is the caller's job", () => {
    const state = createEconomyState(fareTable, 50);
    registerPurchase(state, "v1", 200, 4);
    expect(state.funds).toBe(-150);
  });
});

describe("applyOperatingCosts", () => {
  test("deducts unconditionally, even into debt, and accrues per-vehicle ledger cost", () => {
    const state = createEconomyState(fareTable, 10);
    registerPurchase(state, "v1", 0, 4); // 4/sec operating cost, no purchase cost for this test
    applyOperatingCosts(state, 5); // 5 seconds -> 20 cost
    expect(state.funds).toBe(-10);
    expect(state.ledger.get("v1")!.cost).toBe(20);
    expect(state.elapsedSeconds).toBe(5);
  });

  test("a vehicle with no registered economics costs nothing", () => {
    const state = createEconomyState(fareTable, 10);
    applyOperatingCosts(state, 5);
    expect(state.funds).toBe(10);
  });
});

describe("recordDeliveryRevenue", () => {
  test("adds revenue to funds and the vehicle's ledger entry", () => {
    const state = createEconomyState(fareTable, 0);
    registerPurchase(state, "v1", 0, 0);
    const revenue = recordDeliveryRevenue(state, "v1", [{ kind: "passengers", amount: 10 }]);
    expect(revenue).toBe(20);
    expect(state.funds).toBe(20);
    expect(state.ledger.get("v1")!.revenue).toBe(20);
  });

  test("a delivery for a vehicle with no ledger entry still returns the revenue amount", () => {
    const state = createEconomyState(fareTable, 0);
    const revenue = recordDeliveryRevenue(state, "ghost", [{ kind: "passengers", amount: 5 }]);
    expect(revenue).toBe(10);
    expect(state.funds).toBe(10);
  });
});

describe("sellVehicle", () => {
  test("resells at full price when sold immediately", () => {
    const state = createEconomyState(fareTable, 200);
    registerPurchase(state, "v1", 200, 0);
    expect(state.funds).toBe(0);
    const resale = sellVehicle(state, "v1");
    expect(resale).toBeCloseTo(200, 5);
    expect(state.funds).toBe(200);
  });

  test("depreciates with ownership time and removes tracking on sale", () => {
    const state = createEconomyState(fareTable, 0);
    registerPurchase(state, "v1", 200, 0);
    state.elapsedSeconds = SECONDS_PER_GAME_DAY * 10; // 10 game-days owned
    const resale = sellVehicle(state, "v1");
    // 10 days * 5%/day = 50% depreciation -> 50% of 200 = 100
    expect(resale).toBeCloseTo(100, 5);
    expect(state.vehicleEconomics.has("v1")).toBe(false);
    expect(state.ledger.has("v1")).toBe(false);
  });

  test("never depreciates below the resale floor, however long it's owned", () => {
    const state = createEconomyState(fareTable, 0);
    registerPurchase(state, "v1", 200, 0);
    state.elapsedSeconds = SECONDS_PER_GAME_DAY * 1000;
    const resale = sellVehicle(state, "v1");
    expect(resale).toBeCloseTo(200 * 0.15, 5);
  });

  test("selling an unknown vehicle id is a no-op returning 0", () => {
    const state = createEconomyState(fareTable, 50);
    expect(sellVehicle(state, "nonexistent")).toBe(0);
    expect(state.funds).toBe(50);
  });
});

describe("burn-rate EMA", () => {
  // Time constant is 10 game-seconds; running for ~3x that gives >90%
  // convergence (1 - e^-3 ≈ 0.95) toward the sustained rate.
  test("costRateEMA converges toward the sustained cost rate over several ticks", () => {
    const state = createEconomyState(fareTable, 100000);
    registerPurchase(state, "v1", 0, 10); // sustained $10/sec cost
    for (let i = 0; i < 900; i += 1) {
      applyOperatingCosts(state, 1 / 30);
    }
    expect(state.costRateEMA).toBeGreaterThan(9);
    expect(state.costRateEMA).toBeLessThanOrEqual(10.01);
  });

  test("incomeRateEMA reflects sustained delivered revenue across many ticks", () => {
    const state = createEconomyState(fareTable, 0);
    const dt = 1 / 30;
    for (let i = 0; i < 900; i += 1) {
      // One passenger delivered every tick, at $2 fare -> sustained $60/sec.
      updateIncomeRateEMA(state, 2, dt);
    }
    expect(state.incomeRateEMA).toBeGreaterThan(54);
  });
});
