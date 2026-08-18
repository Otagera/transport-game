import { describe, expect, test } from "bun:test";
import { generateMap } from "@engine/map/generate";

// docs/architecture/engine.md §map/: several seeds produce maps
// that look like places and are provably connected.
const SEEDS = Array.from({ length: 25 }, (_, i) => i * 97 + 1);

describe("map connectivity across seeds", () => {
  test("every seed produces a fully connected inherited network", () => {
    for (const seed of SEEDS) {
      expect(() => generateMap(seed)).not.toThrow();
    }
  });

  test("every seed places at least one settlement and one village", () => {
    for (const seed of SEEDS) {
      const map = generateMap(seed);
      const settlements = map.nodes.filter((node) => node.kind === "settlement");
      const villages = map.nodes.filter((node) => node.kind === "village");
      expect(settlements.length).toBeGreaterThan(0);
      expect(villages.length).toBeGreaterThan(0);
    }
  });

  test("the rail network alone does not necessarily reach every village", () => {
    // Brownfield premise: the colonial spine was built for export, not for
    // people. At least across this seed range, rail should not happen to
    // reach every single village -- if it does for all of them, the
    // network generator has drifted from that premise.
    let anySeedLeavesAVillageOffRail = false;
    for (const seed of SEEDS) {
      const map = generateMap(seed);
      const railNodeIds = new Set<string>();
      for (const segment of map.segments) {
        if (segment.type !== "rail") continue;
        railNodeIds.add(segment.fromNodeId);
        railNodeIds.add(segment.toNodeId);
      }
      const villages = map.nodes.filter((node) => node.kind === "village");
      if (villages.some((village) => !railNodeIds.has(village.id))) {
        anySeedLeavesAVillageOffRail = true;
        break;
      }
    }
    expect(anySeedLeavesAVillageOffRail).toBe(true);
  });
});
