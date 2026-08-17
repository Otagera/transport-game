import { z } from "zod";

// Matches docs/rebuild-plan.md §6 Module 8: four compressed eras,
// Post-Independence -> Oil Boom -> Informal -> Modern.
export const EraSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int().nonnegative(),
  palette: z.object({
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
  }),
});

export type Era = z.infer<typeof EraSchema>;

export const EraListSchema = z.array(EraSchema);

// Per-def purchase costs are essential (docs/rebuild-plan.md §5): with
// one flat cost, every roster comparison is meaningless -- capex held
// artificially equal. `eraIn`/`eraOut` are Module 8's job (graceful
// obsolescence); this ships without them, same "field costs nothing
// later" pattern as Segment.level.
export const VehicleDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  carries: z.enum(["passengers", "goods"]),
  capacity: z.number().positive(),
  speed: z.number().positive(),
  purchaseCost: z.number().nonnegative(),
  operatingCostPerSecond: z.number().nonnegative(),
});

export type VehicleDef = z.infer<typeof VehicleDefSchema>;

export const VehicleDefListSchema = z.array(VehicleDefSchema);
