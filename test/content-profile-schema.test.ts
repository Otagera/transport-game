import { describe, expect, test } from "bun:test";
import { MATERIAL_CHANNELS, Profile2DDefSchema, ProfileElementSchema } from "@content/schema";

function element(material: string, channels: Record<string, number>) {
  return {
    id: "e1",
    material,
    vertices: [
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0.2 },
    ],
    channels,
  };
}

describe("ProfileElementSchema", () => {
  test("asphalt carries friction and decay", () => {
    expect(ProfileElementSchema.safeParse(element("asphalt", { friction: 0.8, decay: 1 })).success).toBe(true);
  });

  test("a curb carries structural integrity", () => {
    expect(ProfileElementSchema.safeParse(element("curb", { structuralIntegrity: 1 })).success).toBe(true);
  });

  // The whole reason the material -> channel map is in the schema rather
  // than left as a convention: a channel a material has no meaning for
  // must be a parse error, not a value that silently does nothing.
  test("a curb claiming friction is a parse error, not a silently-ignored value", () => {
    const parsed = ProfileElementSchema.safeParse(element("curb", { friction: 0.8 }));
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]!.message).toContain("curb carries no friction channel");
  });

  test("every material declares at least one channel it carries", () => {
    for (const [material, channels] of Object.entries(MATERIAL_CHANNELS)) {
      expect(channels.length, `${material} declares no channels`).toBeGreaterThan(0);
    }
  });

  test("channels default to empty rather than undefined, so an element is always exportable", () => {
    const parsed = ProfileElementSchema.parse({
      id: "e1",
      material: "asphalt",
      vertices: [
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 0.2 },
      ],
    });
    expect(parsed.channels).toEqual({});
  });

  test("two vertices is rejected -- a line sweeps to a surface with no thickness", () => {
    expect(
      ProfileElementSchema.safeParse({
        id: "e1",
        material: "asphalt",
        vertices: [
          { x: -1, y: 0 },
          { x: 1, y: 0 },
        ],
        channels: {},
      }).success,
    ).toBe(false);
  });
});

describe("Profile2DDefSchema", () => {
  const valid = {
    id: "trunk-road",
    surfaceType: "road" as const,
    width: 7,
    costPerMeter: 12,
    decayRateMultiplier: 1,
    crossSectionVertices: [
      { x: -3.5, y: 0.12 },
      { x: 3.5, y: 0.12 },
      { x: 3.5, y: 0 },
      { x: -3.5, y: 0 },
    ],
    elements: [element("asphalt", { friction: 0.8 })],
  };

  test("accepts a complete profile", () => {
    expect(Profile2DDefSchema.safeParse(valid).success).toBe(true);
  });

  test("rejects a profile with no elements -- an empty profile sweeps to nothing", () => {
    expect(Profile2DDefSchema.safeParse({ ...valid, elements: [] }).success).toBe(false);
  });

  test("rejects a non-positive decay multiplier -- zero would mean a road that never decays", () => {
    expect(Profile2DDefSchema.safeParse({ ...valid, decayRateMultiplier: 0 }).success).toBe(false);
  });

  test("rejects a zero width", () => {
    expect(Profile2DDefSchema.safeParse({ ...valid, width: 0 }).success).toBe(false);
  });
});
