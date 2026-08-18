import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Profile2DDefListSchema } from "@content/schema";
import { crossSectionOutline, outlineWidth } from "@render/studioProfile";
import { REFERENCE_COST_PER_METRE, profileCostMultiplier } from "@engine/pathing/cost";
import { createProfileCatalog } from "@render/profileCatalog";
import type { Segment } from "@engine/map/types";

const profiles = Profile2DDefListSchema.parse(
  JSON.parse(readFileSync(join(import.meta.dir, "..", "public", "content", "profiles.json"), "utf8")),
);

function segment(overrides: Partial<Segment>): Segment {
  return {
    id: "s1",
    corridorId: "c1",
    fromNodeId: "a",
    toNodeId: "b",
    type: "road",
    level: "ground",
    condition: 1,
    provenance: "inherited",
    ...overrides,
  };
}

describe("profiles.json", () => {
  test("validates against the schema", () => {
    expect(profiles.length).toBeGreaterThan(0);
  });

  // The studio derives both of these from the elements. If a profile is
  // ever hand-edited, this is what catches an outline that no longer
  // matches the parts it is supposed to enclose -- a silhouette that lies
  // about the shape is exactly the display-boundary failure class
  // docs/rebuild-plan.md §5 calls the most reliable rule in the project.
  test("every profile's outline and width are consistent with its own elements", () => {
    for (const profile of profiles) {
      const outline = crossSectionOutline(profile.elements);
      expect(profile.crossSectionVertices, `${profile.id} outline`).toEqual(
        outline.map((point) => ({ x: Number(point.x.toFixed(3)), y: Number(point.y.toFixed(3)) })),
      );
      expect(profile.width, `${profile.id} width`).toBeCloseTo(outlineWidth(outline), 3);
    }
  });

  test("both surface types are covered, so rail is never left without a profile", () => {
    const types = new Set(profiles.map((profile) => profile.surfaceType));
    expect(types.has("road")).toBe(true);
    expect(types.has("rail")).toBe(true);
  });

  test("ids are unique", () => {
    expect(new Set(profiles.map((profile) => profile.id)).size).toBe(profiles.length);
  });

  // The whole point of authoring more than one: a costlier cross-section
  // must buy something. If every profile decayed at the same rate the
  // choice would be a pure tax.
  test("a costlier profile lasts longer -- cost and decay rate move opposite ways", () => {
    for (const surfaceType of ["road", "rail"] as const) {
      const ofType = profiles.filter((profile) => profile.surfaceType === surfaceType);
      if (ofType.length < 2) continue;
      const byCost = [...ofType].sort((a, b) => a.costPerMeter - b.costPerMeter);
      expect(byCost.at(0)!.decayRateMultiplier, surfaceType).toBeGreaterThan(byCost.at(-1)!.decayRateMultiplier);
    }
  });

  test("the reference profile leaves existing build pricing exactly where it was", () => {
    const reference = profiles.find((profile) => profile.costPerMeter === REFERENCE_COST_PER_METRE);
    expect(reference).toBeDefined();
    expect(profileCostMultiplier(reference!.costPerMeter)).toBe(1);
  });
});

describe("createProfileCatalog", () => {
  const catalog = createProfileCatalog(profiles, { road: "feeder-road", rail: "colonial-rail" });

  test("the inherited defaults both exist -- a typo here would blank the whole base map", () => {
    expect(catalog.byId.has(catalog.inheritedDefaults.road)).toBe(true);
    expect(catalog.byId.has(catalog.inheritedDefaults.rail)).toBe(true);
  });

  test("a segment with no profileId resolves to the inherited default for its type", () => {
    expect(catalog.resolve(segment({ type: "road" }))!.id).toBe("feeder-road");
    expect(catalog.resolve(segment({ type: "rail" }))!.id).toBe("colonial-rail");
  });

  test("a segment naming a profile resolves to it", () => {
    expect(catalog.resolve(segment({ profileId: "expressway" }))!.id).toBe("expressway");
  });

  test("a segment naming a profile that no longer exists degrades to the default, it does not vanish", () => {
    expect(catalog.resolve(segment({ profileId: "deleted-mod-profile" }))!.id).toBe("feeder-road");
  });

  test("buildable profiles are filtered by surface type, so rail cross-sections never appear for a road", () => {
    expect(catalog.buildable("road").every((profile) => profile.surfaceType === "road")).toBe(true);
    expect(catalog.buildable("rail").every((profile) => profile.surfaceType === "rail")).toBe(true);
    expect(catalog.buildable("road").length).toBeGreaterThan(0);
  });

  test("decay multipliers are a plain profileId -> number map, which is all engine/ ever sees", () => {
    for (const profile of profiles) {
      expect(catalog.decayMultipliers.get(profile.id)).toBe(profile.decayRateMultiplier);
    }
  });
});
