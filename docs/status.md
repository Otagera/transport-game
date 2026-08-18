# Build status

Living log, one section per module from [rebuild-plan.md](rebuild-plan.md)'s build order.
Update this when a module finishes or its scope changes — this is what a new
conversation should read first to know where things stand, before diving into source or
`git log`. Pair with [architecture.md](architecture.md) for the stable "how it's shaped"
reference.

Current test count: **148 passing** across 30 files (`bun test`). All of typecheck /
test / build / verify:bundle pass as of the last commit on this list.

## Module 0 — Foundation ✅
Repo init, pushed to `Otagera/transport-game` (private) immediately — losing the
previous build before it reached a remote was the whole reason for this rebuild, so this
was priority zero. Fixed-timestep loop (`engine/loop.ts`, `SIM_DT = 1/30`), empty
three.js scene, content loading skeleton. `AGENTS.md` created with `CLAUDE.md`
symlinked to it, kept lean; full design doc lives at `docs/rebuild-plan.md`.

## Module 1 — Visual foundation & tuning panel ✅
`render/scene.ts`, `render/style.ts`. DEV-only Preact tuning panel (`src/dev/`),
gated by `import.meta.env.DEV` + `?tune=1`, verified dead-code-eliminated from
production via `scripts/verify-prod-bundle.mjs`.

## Module 2 — Terrain and map generation ✅
`engine/map/{noiseField,terrain,nodes,corridors,connectivity,generate}.ts`. Seeded,
deterministic (`map-determinism.test.ts`). Hard-asserted node connectivity via
union-find (`union-find.test.ts`).

## Module 3 — Simulation core ✅
`engine/simulation/{demand,routing,vehicle,simulate}.ts`. Conveyor-model vehicles,
aggregate demand queues, A* runtime routing over built infrastructure.

## Module 4 — Chain-of-nodes refactor + terrain pathing + authoring UI ✅
Corridor became `nodeIds: string[]` with per-pair `Segment`s. Terrain-aware A*
(`pathing/terrainAStar.ts`), the cost-function-IS-the-price discipline
(`pathing/cost.ts`), RDP simplification + Catmull-Rom smoothing
(`pathing/{rdp,smoothing}.ts`), interactive authoring controller
(`render/authoring.ts`) with click-to-place waypoints, live cost preview, undo history.

**Bugs caught live, not by unit tests:** a grid-Y/world-Z sign flip in
`render/gridCoords.ts` (silent — routed corridors to the wrong nodes; locked in by
`test/grid-coords.test.ts`'s non-round-trip assertion), and a node-ID collision between
the map generator and the authoring builder (fixed with an `authored-` prefix).

## Module 5 — Bridges and levels ✅
`pathing/supercover.ts` (DDA cell walking for water detection), bridge "jump" edges in
A* (cardinal-only, span-capped, linearly-priced — see architecture.md hard rule 3),
`SegmentLevel: "underground" | "ground" | "elevated"`.

**Bugs caught live:** (1) a long ground run between two *separate* water crossings got
misclassified as itself being a bridge, because the check only compared jump-distance
without requiring chain-index adjacency — fixed by requiring `idx === prevIdx + 1`, (2) a
bridge-deck rotation sign bug in `render/network.ts` where X came out right (cosine
masks sign errors) but Z was reflected — root-caused via a temporary standalone HTML
harness reading `mesh.matrixWorld`-transformed endpoints through Playwright, not by
re-deriving on paper a second time.

## Module 6 — Economy + vehicle catalog ✅
`engine/economy/{types,state,fares,report}.ts`, `content/schema.ts`'s
`VehicleDefSchema`, `render/fleet.ts` (buy/sell UI), `ui/pnlPanel.ts`. Fares are global
per cargo kind. Depreciated resale floors at `MIN_RESALE_FRACTION`. Burn-rate EMAs
(`incomeRateEMA`/`costRateEMA`) computed once per tick globally.

**Bug self-caught before shipping:** originally planned to update `incomeRateEMA`
inside the per-vehicle delivery-revenue function — would have decayed the rate toward
zero on every vehicle that didn't deliver *that specific tick*. Split into a per-vehicle
ledger-only update (`recordDeliveryRevenue`) and a single once-per-tick
`updateIncomeRateEMA` fed the tick's *total* revenue.

## Module 7 — Congestion + paratransit ✅
`simulation/congestion.ts` (per-segment weighted load, free-first-slot threshold, floor),
`paratransit/{types,spawn}.ts` (EMA-gated one-shot spawning, per-pair + per-corridor
caps, cooldown), live status bar informal-vehicle count.

**Bug caught live (90s untouched run):** `simulate.ts`'s `tick()` credited *any*
vehicle's delivery revenue to the player's economy, including paratransit's — player
funds rose from ₦1,000 to over ₦5,000 purely from informal traffic nobody bought. None
of the (then) 125 tests caught it, since none checked player funds with paratransit
running concurrently. Fixed by gating the credit on `vehicle.lifecycle !== "one-shot"`.

## Module 8 — Eras ✅
Four compressed eras (`public/content/eras.json`): Post-Independence → Oil Boom →
Informal → Modern, each 75 real seconds (a tunable placeholder, not gospel — chosen
short/testable, consistent with the doc's own "compressed eras" intent). Advance on
real time, not player action (`engine/eras/{types,timeline}.ts`:
`createEraTimeline`/`advanceEraTimeline`/`currentEra`, holds at the final era rather
than looping).

**Five modifiers threaded through, each as a plain number parameter (engine submodules
stay content-unaware — only `simulation/simulate.ts`'s `tick()` imports `EraModifiers`):**
- `demand` → `simulate.ts`'s `growQueues` multiplies `pair.rate`.
- `fuel` → `economy/state.ts`'s `applyOperatingCosts(state, dt, fuelMultiplier)`,
  applied **live per tick**, not baked into `operatingCostPerSecond` at purchase time —
  a fuel-price era transition must bite vehicles already on the road, not just future
  purchases ("Informal-era fuel spike bites operationally" is meant to be felt).
- `buildCost` → `pathing/cost.ts`'s `sumStepCosts(steps, newNodeCount, multiplier)`
  scales every breakdown field uniformly (so the cost-panel receipt still sums
  correctly), threaded through `pathing/plan.ts`'s `planCorridor` and
  `render/authoring.ts`'s live `getBuildCostMultiplier()` getter.
- `decay` → new mechanic, `engine/map/decay.ts`: `Segment.condition` (existed since
  Module 4, previously write-once/never-read) now ticks down every tick via
  `decaySegments`, floored at `MIN_CONDITION = 0.3` (friction, not a route-killing
  failure state — that's the deferred "Corridor failure state" from the Findings, out
  of scope here). Read back as a minor vehicle speed penalty via
  `conditionSpeedFactor` in `simulation/vehicle.ts`'s `tickVehicle`.
- `paratransitPressure` → `paratransit/spawn.ts`'s `trySpawnParatransit` divides
  `SPAWN_EMA_THRESHOLD` by the pressure (caps stay fixed — they're a perf/pacing
  concern, not an era-flavor one).

**Graceful obsolescence, not despawn:** vehicle defs gain `eraIn`/`eraOut` (`null` =
still purchasable forever). `render/fleet.ts` blocks purchase outside the window and
shows the era window in the cycling hint text (`"Okada (Informal+)"`). Owned vehicles
keep running unconditionally. `economy/types.ts`'s `VehicleEconomics` gained
`defId`/`obsoleteSinceSeconds`; `economy/state.ts`'s `markVehicleObsolete` (idempotent —
an era timeline only moves forward) is called by `fleet.ts`'s `handleEraChanged` for
any owned vehicle whose def's `eraOut` the timeline has passed, and
`applyOperatingCosts` ramps maintenance 2%/sec obsolete, capped at 3x (a real cost, but
never an unrecoverable spiral — no game over).

**Rail goes dark:** `Era.railAvailable` (false through Informal). `render/authoring.ts`
blocks toggling *to* rail via a live `getRailAvailable()` getter, and reconciles a
mid-draw rail selection back to road if an era transition happens while authoring is in
progress (`reconcileEraGating`, called from `main.ts`'s transition handler) — a
designed absence must be visible in advance, not ambush an in-progress action.

**Palette + notification:** `main.ts`'s `applyEraPalette` sets
`style.background.color`/`style.lighting.fill.color` from `era.palette` and calls the
already-existing `sceneHandle.applyStyle` (cheap, no geometry rebuild — same mechanism
the Module 1 tuning panel uses). A minimal self-dismissing `ui/eraBanner.ts` shows
`"Era: <name>"` for 4s on transition — deliberately scoped down from the fuller
"sorted deltas by magnitude" banner described in the Findings, which is a richer
treatment out of this module's bullet list.

**Live-verified** (Playwright vs. local Chrome, ~82s real-time run through the first
transition): initial hint text shows era windows (`"Danfo (Post-Independence+)"`,
`"Okada (Informal+)"` correctly blocked pre-Informal); status bar era name and the
banner both update exactly at the Post-Independence → Oil Boom boundary; background
color read back via a temporary debug hook went `#8a6d3b → #1b5e20` at the exact
transition tick, confirmed against `eras.json`'s literal palette values, then the debug
hook was removed before commit. Engine-level mechanics (decay's speed penalty, the
build-cost multiplier's receipt-consistency, rail gating's cost-panel hint, the
obsolescence ramp/cap) are unit-tested but not separately live-verified beyond the
wiring pattern already proven by the transition run.

## Module 9 — Growth (not started)
Per `rebuild-plan.md`'s build order, comes next.

## Module 10 — Save/load and scenarios (not started)
Last module in the plan.
