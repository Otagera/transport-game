# Content

`src/content/schema.ts` (Zod schemas) + `src/content/loader.ts` (fetch + parse) for
everything under `public/content/*.json`. **Content is data** (hard rule 2 in
[index.md](index.md)): new vehicles, eras, profiles or scenarios are new JSON, never new
code, and `engine/` never imports these types — the bootstrap layer (`main.ts`) maps
loaded content into `engine/`'s own plain mirrored interfaces.

## The schemas

- **`EraSchema`** (`eras.json`) — id/name/order/durationSeconds, `palette` (render-only),
  `modifiers: EraModifiers` (see [engine.md](engine.md)'s eras section), `railAvailable`.
  `ambientTraffic` is required, not optional-with-a-default, on purpose — an era that
  forgot to say how motorised it is would silently render as empty roads.
- **`VehicleDefSchema`** (`vehicles.json`) — per-def purchase costs, `eraIn`/`eraOut`
  (`null` = still purchasable forever), `congestionWeight` (Module 11, defaults to `1`
  so the pre-existing catalog validates unchanged — the actual catalog values now rise
  with capacity, `0.3` okada → `2.2` BRT, asserted by a content test), and optional
  `mesh`/`anchors` for mod packages authored in the Asset Modder (see
  [dev-studio.md](dev-studio.md)). **`runsOn` is free text, not `road | rail`** despite
  the original module brief specifying the latter — the committed schema and the whole
  existing catalog use it as the propulsion/fuel channel (`"petrol"`, with an electric
  Modern-era bus as the field's documented reason to exist); road vs. rail is a property
  of the *segment* a vehicle routes over, not of the def, and narrowing it would
  invalidate every existing vehicle for no benefit.
- **`ScenarioSchema`** + **`SeedFleetEntrySchema`** (`scenarios.json`, Module 10) — id,
  name, mapSeed, startingEraId, startingFunds, warmForwardDays, and
  `seedFleet: { defId, count }[]`. A scenario is a starting point for tuning, not a
  curated layout — `seedFleet` just says how many of a def to start with;
  `engine/save/scenario.ts`'s `applyScenario` decides where they run (see
  [engine.md](engine.md)).
- **`Profile2DDefSchema`** + **`ProfileElementSchema`** (`profiles.json`, Module 11) —
  a parametric road/rail cross-section: a closed outline polygon plus named `elements`
  (asphalt, curb, gutter, ditch, barrier, ballast, sleeper), each with `vertices` and a
  `channels` map (`friction`/`decay`/`structuralIntegrity`). **`MATERIAL_CHANNELS` lives
  in the schema**, not as a convention — a `superRefine` validates that an element only
  claims channels its material is allowed to carry (asphalt: friction+decay; ballast:
  decay+structuralIntegrity; a curb: structuralIntegrity only), so "a curb claiming
  friction" is a parse error, not a value that silently does nothing downstream. The dev
  studio's Profile Studio editor reads this same map and only offers channels the
  selected material actually carries.

  `costPerMeter` is applied **relative to `REFERENCE_COST_PER_METRE`** in
  `pathing/cost.ts` — the map has no stated cell size, so inventing a metres-per-cell
  scale to make pricing absolute would silently rebalance every number tuned against the
  earlier modules. It scales the per-length terms only, never `nodes` — a junction costs
  the same whichever surface meets there. `test/content-profiles.test.ts` re-derives
  every profile's outline and width from its own elements via the same
  `crossSectionOutline` function the renderer uses, so a hand-edited profile whose
  silhouette stops matching its own parts fails the build — and asserts a costlier
  profile also lasts longer (a lower decay-rate multiplier), so paying more is never a
  pure tax.

## `.default()` is a content-authoring convenience, not a state-restoration one

Several fields above (`congestionWeight.default(1)`, `ProfileElementSchema`'s
`channels.default({})`, `VehicleAnchorsSchema`'s array fields) default to a sensible
value when absent. That's correct for **hand-authored content** — `vehicles.json`
should be allowed to omit a field that didn't exist when most of the catalog was
written. It would be actively wrong applied to a **save file**: there, an absent field
means "this save predates the field" and must fail a version check, not silently
backfill a plausible value. This is why `engine/save`'s `SaveFile` type
([engine.md](engine.md)) is hand-written rather than derived from anything in this
file — reusing a content schema for save validation would turn every `.default()` here
into an undeclared migration.
