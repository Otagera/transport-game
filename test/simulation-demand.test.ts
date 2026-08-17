import { describe, expect, test } from "bun:test";
import { generateDemandPairs } from "@engine/simulation/demand";
import { generateMap } from "@engine/map/generate";

describe("generateDemandPairs", () => {
  test("passenger demand is reciprocal for every inhabited pair", () => {
    const map = generateMap(42);
    const pairs = generateDemandPairs(map);
    const passengerPairs = pairs.filter((pair) => pair.kind === "passengers");

    expect(passengerPairs.length).toBeGreaterThan(0);
    for (const pair of passengerPairs) {
      const reverseExists = passengerPairs.some((other) => other.from === pair.to && other.to === pair.from);
      expect(reverseExists).toBe(true);
    }
  });

  test("goods demand is one-way per kind between a village and its nearest settlement", () => {
    const map = generateMap(42);
    const pairs = generateDemandPairs(map);
    const produce = pairs.filter((pair) => pair.kind === "produce");
    const supplies = pairs.filter((pair) => pair.kind === "supplies");

    expect(produce.length).toBeGreaterThan(0);
    expect(supplies.length).toBeGreaterThan(0);
    for (const p of produce) {
      const matchingSupply = supplies.find((s) => s.from === p.to && s.to === p.from);
      expect(matchingSupply).toBeDefined();
    }
  });

  test("junction nodes never originate or receive demand", () => {
    const map = generateMap(42);
    const pairs = generateDemandPairs(map);
    const junctionIds = new Set(map.nodes.filter((node) => node.kind === "junction").map((node) => node.id));
    for (const pair of pairs) {
      expect(junctionIds.has(pair.from)).toBe(false);
      expect(junctionIds.has(pair.to)).toBe(false);
    }
  });
});
