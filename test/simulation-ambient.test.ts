import { describe, expect, test } from "bun:test";
import {
  AMBIENT_ATTENUATION_CELLS,
  addLoads,
  ambientAttenuation,
  ambientSegmentLoad,
  computeAmbientGeometry,
  computeAmbientLoads,
  congestionFactor,
} from "@engine/simulation/congestion";

const NODES = [
  { id: "lagos", kind: "settlement", x: 0, y: 0 },
  { id: "ibadan", kind: "settlement", x: 20, y: 0 },
  { id: "hamlet", kind: "village", x: 4, y: 0 },
  { id: "bend", kind: "vertex", x: 10, y: 0 },
];

function segment(id: string, from: string, to: string, type = "road") {
  return { id, type, fromNodeId: from, toNodeId: to };
}

describe("computeAmbientGeometry", () => {
  test("attributes a segment's traffic to the inhabited nodes nearest its ends", () => {
    const [entry] = computeAmbientGeometry(NODES, [segment("s1", "hamlet", "bend")]);
    expect(entry!.sourceNodeIdA).toBe("hamlet");
    expect(entry!.sourceNodeIdB).toBe("hamlet");
  });

  // The distinction the whole mechanic rests on: measured at the
  // endpoints this segment would read as distance zero at both ends and
  // carry full traffic along a 20-cell highway.
  test("measures attenuation distance from the midpoint, not the endpoints", () => {
    const [entry] = computeAmbientGeometry(NODES, [segment("trunk", "lagos", "ibadan")]);
    // Midpoint is (10, 0); nearest inhabited node is the hamlet at (4, 0).
    expect(entry!.midpointDistanceCells).toBeCloseTo(6, 6);
  });

  test("excludes rail outright rather than recording it for later filtering", () => {
    expect(computeAmbientGeometry(NODES, [segment("r1", "lagos", "ibadan", "rail")])).toHaveLength(0);
  });

  test("a map with nowhere inhabited generates no ambient geometry at all", () => {
    expect(computeAmbientGeometry([{ id: "a", kind: "vertex", x: 0, y: 0 }], [segment("s", "a", "a")])).toHaveLength(0);
  });

  test("a segment whose endpoints aren't on the map is skipped rather than throwing", () => {
    expect(computeAmbientGeometry(NODES, [segment("ghost", "missing-a", "missing-b")])).toHaveLength(0);
  });
});

describe("ambientAttenuation", () => {
  test("is full strength on top of a settlement", () => {
    expect(ambientAttenuation(0)).toBe(1);
  });

  test("falls to 1/e at the attenuation length", () => {
    expect(ambientAttenuation(AMBIENT_ATTENUATION_CELLS)).toBeCloseTo(Math.exp(-1), 6);
  });

  // Private cars concentrating on settlement approaches is the whole
  // reason this is spatial: without it, prosperity would degrade every
  // road on the map uniformly and there would be nothing to route around.
  test("open country far from anywhere is effectively clear", () => {
    expect(ambientAttenuation(AMBIENT_ATTENUATION_CELLS * 6)).toBeLessThan(0.01);
  });

  test("treats a negative distance as zero rather than amplifying", () => {
    expect(ambientAttenuation(-5)).toBe(1);
  });
});

describe("ambientSegmentLoad", () => {
  test("scales with the era's private car factor", () => {
    expect(ambientSegmentLoad(0.4, 1, 1, 0)).toBeCloseTo(2 * ambientSegmentLoad(0.2, 1, 1, 0), 6);
  });

  // The prosperity loop in one assertion: a settlement that the player
  // has grown generates more private traffic than one they have not.
  test("scales with endpoint growth, so a developed settlement congests its own approaches", () => {
    const grown = ambientSegmentLoad(0.4, 6, 6, 0);
    const ungrown = ambientSegmentLoad(0.4, 1, 1, 0);
    expect(grown).toBeCloseTo(6 * ungrown, 6);
  });

  test("averages the two endpoints rather than taking either alone", () => {
    expect(ambientSegmentLoad(1, 1, 5, 0)).toBeCloseTo(3, 6);
  });

  test("an era with no private cars produces no ambient load at any growth level", () => {
    expect(ambientSegmentLoad(0, 6, 6, 0)).toBe(0);
  });
});

describe("computeAmbientLoads", () => {
  const grown = new Map([
    ["lagos", 5],
    ["ibadan", 5],
    ["hamlet", 2],
  ]);

  function loadsFor(segments: ReturnType<typeof segment>[], eraFactor = 0.4) {
    return computeAmbientLoads(computeAmbientGeometry(NODES, segments), grown, eraFactor);
  }

  // The strategic payoff depends entirely on this being absolute. If rail
  // took even a fraction of ambient load there would be no infrastructure
  // immune to the late-game hazard, and the mechanic would be a flat tax
  // rather than a decision.
  test("rail carries no ambient load at all -- not a reduced one", () => {
    const loads = loadsFor([segment("r1", "lagos", "ibadan", "rail")]);
    expect(loads.has("r1")).toBe(false);
  });

  test("an equivalent road on the same alignment does carry it", () => {
    expect(loadsFor([segment("s1", "lagos", "hamlet")]).get("s1")).toBeGreaterThan(0);
  });

  // Approaches choke first; the open middle of a long run stays usable.
  // This is what gives the player somewhere to route around to, instead
  // of prosperity degrading every road on the map uniformly.
  test("a short settlement approach is busier than the middle of a long intercity run", () => {
    const loads = loadsFor([segment("approach", "lagos", "hamlet"), segment("trunk", "lagos", "ibadan")]);
    expect(loads.get("approach")!).toBeGreaterThan(loads.get("trunk")!);
  });

  test("an era with no private cars produces no entries at all", () => {
    expect(loadsFor([segment("s1", "lagos", "hamlet")], 0).size).toBe(0);
  });

  test("nodes with no recorded growth fall back to the baseline multiplier, not to zero", () => {
    const geometry = computeAmbientGeometry(NODES, [segment("s1", "lagos", "hamlet")]);
    expect(computeAmbientLoads(geometry, new Map(), 0.4).get("s1")).toBeGreaterThan(0);
  });
});

describe("addLoads", () => {
  test("sums vehicle and ambient occupancy per segment", () => {
    const total = addLoads(new Map([["s1", 1.5]]), new Map([["s1", 0.5], ["s2", 2]]));
    expect(total.get("s1")).toBe(2);
    expect(total.get("s2")).toBe(2);
  });

  test("does not mutate the base map it was given", () => {
    const base = new Map([["s1", 1]]);
    addLoads(base, new Map([["s1", 5]]));
    expect(base.get("s1")).toBe(1);
  });

  // Ambient load is in the same units vehicles use, so it has to be able
  // to push a segment past the free slot on its own -- that is what makes
  // a prosperous corridor slow down without the player adding a bus.
  test("ambient load alone can congest a road the player has not added a vehicle to", () => {
    const total = addLoads(new Map(), new Map([["s1", 3]]));
    expect(congestionFactor(total.get("s1")!)).toBeLessThan(1);
  });
});
