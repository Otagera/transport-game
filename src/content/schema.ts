import { z } from "zod";

// Matches docs/rebuild-plan.md §6 Module 8: four compressed eras,
// Post-Independence -> Oil Boom -> Informal -> Modern. Era identity must
// be expressed mechanically, not only in prices (docs/rebuild-plan.md
// §5) -- `modifiers` is that mechanical expression; `palette` is the
// (cheap, high-leverage) visual one.
export const EraSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int().nonnegative(),
  durationSeconds: z.number().positive(),
  palette: z.object({
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
  }),
  modifiers: z.object({
    demand: z.number().positive(),
    fuel: z.number().positive(),
    buildCost: z.number().positive(),
    decay: z.number().positive(),
    paratransitPressure: z.number().positive(),
  }),
  // Rail goes dark through Informal and returns as standard gauge in
  // Modern (docs/rebuild-plan.md §5) -- historically exact, but a
  // designed absence must be visible in advance, not ambush the player.
  railAvailable: z.boolean(),
});

export type Era = z.infer<typeof EraSchema>;

export const EraListSchema = z.array(EraSchema);

// Per-def purchase costs are essential (docs/rebuild-plan.md §5): with
// one flat cost, every roster comparison is meaningless -- capex held
// artificially equal. eraIn/eraOut close the purchase catalog without
// despawning owned stock (graceful obsolescence); eraOut: null means
// "still purchasable in every later era." `runsOn` exists for a future
// era to differentiate (e.g. an electric Modern-era bus) -- it costs
// nothing now, same "field costs nothing later" pattern as Segment.level.
export const VehicleDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  carries: z.enum(["passengers", "goods"]),
  capacity: z.number().positive(),
  speed: z.number().positive(),
  purchaseCost: z.number().nonnegative(),
  operatingCostPerSecond: z.number().nonnegative(),
  runsOn: z.string(),
  eraIn: z.string(),
  eraOut: z.string().nullable(),
});

export type VehicleDef = z.infer<typeof VehicleDefSchema>;

export const VehicleDefListSchema = z.array(VehicleDefSchema);

// Module 10: scenarios as content, not code (docs/rebuild-plan.md §5,
// "Content is data"). A scenario is a starting point for tuning, not a
// curated layout -- seedFleet just says how many of a def to start with;
// applyScenario decides where they run.
export const SeedFleetEntrySchema = z.object({
  defId: z.string(),
  count: z.number().int().positive(),
});

export const ScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  mapSeed: z.number().int(),
  startingEraId: z.string(),
  startingFunds: z.number().nonnegative(),
  warmForwardDays: z.number().nonnegative(),
  seedFleet: z.array(SeedFleetEntrySchema),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

export const ScenarioListSchema = z.array(ScenarioSchema);

// Module 11: parametric road/rail cross-sections, authored in the dev
// studio's Profile Studio tab and swept along a corridor's Catmull-Rom
// centreline by render/studioProfile.ts.
//
// "Road and rail need a distinct visual channel -- width, surface
// treatment, sleepers. Not hue or brightness, which are taken"
// (docs/rebuild-plan.md §5). A profile IS that third channel, made
// authorable: the difference between a road and a railway becomes a
// difference in geometry rather than a difference in colour, which the
// two-channel contract has no room left for.
export const ProfileMaterialSchema = z.enum([
  "asphalt",
  "curb",
  "gutter",
  "ditch",
  "barrier",
  "ballast",
  "sleeper",
]);

export type ProfileMaterial = z.infer<typeof ProfileMaterialSchema>;

// Which physical channels a material is allowed to carry. Encoded here
// rather than left as a convention, so "asphalt takes friction and decay,
// a curb takes structural integrity" is a validated fact -- an element
// claiming a channel its material has no meaning for is a parse error,
// not a value that silently does nothing downstream.
export const MATERIAL_CHANNELS: Record<ProfileMaterial, ReadonlyArray<"friction" | "decay" | "structuralIntegrity">> = {
  asphalt: ["friction", "decay"],
  curb: ["structuralIntegrity"],
  gutter: ["structuralIntegrity"],
  ditch: ["structuralIntegrity"],
  barrier: ["structuralIntegrity"],
  ballast: ["decay", "structuralIntegrity"],
  sleeper: ["friction", "decay"],
};

export const Vec2Schema = z.object({ x: z.number(), y: z.number() });

export const ProfileElementSchema = z
  .object({
    id: z.string(),
    material: ProfileMaterialSchema,
    // A closed polygon in cross-section space: x across the alignment,
    // y up from the centreline's ground plane. Three points minimum --
    // two would be a line, which sweeps to a surface with no thickness.
    vertices: z.array(Vec2Schema).min(3),
    channels: z
      .object({
        friction: z.number().positive().optional(),
        decay: z.number().positive().optional(),
        structuralIntegrity: z.number().positive().optional(),
      })
      .default({}),
  })
  .superRefine((element, ctx) => {
    const allowed = MATERIAL_CHANNELS[element.material];
    for (const channel of Object.keys(element.channels) as Array<keyof typeof element.channels>) {
      if (!allowed.includes(channel)) {
        ctx.addIssue({
          code: "custom",
          path: ["channels", channel],
          message: `${element.material} carries no ${channel} channel (allowed: ${allowed.join(", ")})`,
        });
      }
    }
  });

export type ProfileElement = z.infer<typeof ProfileElementSchema>;

export const Profile2DDefSchema = z.object({
  id: z.string(),
  surfaceType: z.enum(["road", "rail"]),
  /** Bank-to-bank width in metres, derived from the outline. */
  width: z.number().positive(),
  costPerMeter: z.number().nonnegative(),
  /**
   * Scales engine/map/decay.ts's base decay rate for segments built to
   * this profile. A number, not a content type reaching into the engine --
   * same pattern as the era modifiers (architecture.md, "content-aware
   * code stays out of engine/").
   */
  decayRateMultiplier: z.number().positive(),
  /** The swept silhouette: a closed polygon, outermost outline only. */
  crossSectionVertices: z.array(Vec2Schema).min(3),
  elements: z.array(ProfileElementSchema).min(1),
});

export type Profile2DDef = z.infer<typeof Profile2DDefSchema>;

export const Profile2DDefListSchema = z.array(Profile2DDefSchema);
