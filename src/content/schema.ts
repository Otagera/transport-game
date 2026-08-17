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
