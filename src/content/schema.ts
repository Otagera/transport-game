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
