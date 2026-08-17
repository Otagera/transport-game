import { describe, expect, test } from "bun:test";
import { computeRevenue } from "@engine/economy/fares";

describe("computeRevenue", () => {
  test("multiplies fare by delivered amount", () => {
    const fareTable = { passengers: 2, produce: 1, supplies: 1.5 };
    expect(computeRevenue(fareTable, "passengers", 10)).toBe(20);
    expect(computeRevenue(fareTable, "produce", 4)).toBe(4);
    expect(computeRevenue(fareTable, "supplies", 4)).toBe(6);
  });

  test("zero amount delivers zero revenue", () => {
    const fareTable = { passengers: 2, produce: 1, supplies: 1.5 };
    expect(computeRevenue(fareTable, "passengers", 0)).toBe(0);
  });
});
