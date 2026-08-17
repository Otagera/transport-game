import { describe, expect, test } from "bun:test";
import { createEconomyState, recordDeliveryRevenue, registerPurchase } from "@engine/economy/state";
import { computeBurnRate, computeRoutePnL } from "@engine/economy/report";

const fareTable = { passengers: 2, produce: 1, supplies: 1.5 };

describe("computeRoutePnL", () => {
  test("sorts worst (most negative net) first", () => {
    const state = createEconomyState(fareTable, 0);
    registerPurchase(state, "profitable", 0, 0);
    registerPurchase(state, "bleeding", 0, 0);
    registerPurchase(state, "breakeven", 0, 0);

    recordDeliveryRevenue(state, "profitable", [{ kind: "passengers", amount: 100 }]);
    state.ledger.get("profitable")!.cost = 50;

    state.ledger.get("bleeding")!.cost = 300;
    recordDeliveryRevenue(state, "bleeding", [{ kind: "passengers", amount: 10 }]);

    recordDeliveryRevenue(state, "breakeven", [{ kind: "passengers", amount: 25 }]);
    state.ledger.get("breakeven")!.cost = 50;

    const rows = computeRoutePnL(state);
    expect(rows.map((r) => r.vehicleId)).toEqual(["bleeding", "breakeven", "profitable"]);
    expect(rows[0]!.net).toBeLessThan(0);
    expect(rows[2]!.net).toBeGreaterThan(0);
  });

  test("empty ledger produces an empty report", () => {
    const state = createEconomyState(fareTable, 0);
    expect(computeRoutePnL(state)).toEqual([]);
  });
});

describe("computeBurnRate", () => {
  test("scales the EMA rates up to a per-day figure", () => {
    const state = createEconomyState(fareTable, 0);
    state.incomeRateEMA = 10; // $/sec
    state.costRateEMA = 4; // $/sec
    const burn = computeBurnRate(state);
    expect(burn.incomePerDay).toBeCloseTo(300, 5); // 10 * 30 seconds/day
    expect(burn.costPerDay).toBeCloseTo(120, 5);
    expect(burn.netPerDay).toBeCloseTo(180, 5);
  });
});
