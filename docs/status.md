# Build status

Living log, one section per module from [rebuild-plan.md](rebuild-plan.md)'s build order.
Update this when a module finishes or its scope changes — this is what a new
conversation should read first to know where things stand, before diving into source or
`git log`. Pair with [architecture.md](architecture.md) for the stable "how it's shaped"
reference.

Current test count: **328 passing** across 47 files (`bun test`). All of typecheck /
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

## Module 9 — Growth ✅
`engine/growth/{types,state}.ts`: each village/settlement node gets a `NodeGrowthState`
with a demand multiplier `D` (starts at 1) that grows via a logistic ODE
(`dD/dt = growthRate * D * (1 - D/D_max)`), bounded by a per-tier `D_max`
(`village: 2.5, settlement: 6`, independent constants, not derived from `D` itself).
`D` feeds back into `simulate.ts`'s `growQueues` as a per-origin-node multiplier on
`pair.rate` — "growth scales the rate, not the graph," demand pair topology never
changes.

**Service ratio, computed correctly on the second attempt.** `growthRate` is gated by a
smoothstep on a rolling, paratransit-discounted service ratio S̄. The first
implementation EMA'd the *per-tick clamped ratio* (`servedThisTick / generatedThisTick`,
clamped to `[0,1]` before averaging) — this looked fine against synthetic
100%-every-tick samples but **silently failed against real vehicle behavior**: a vehicle
visiting a node every few seconds delivers service in a burst that dwarfs that single
tick's tiny generated amount, so the clamp threw away nearly all of the burst's weight,
converging S̄ to roughly `(1 tick serving) / (ticks per round trip)` — a live integration
test with a real two-node map, a real route, and real vehicles caught this
(`playerServiceEMA` stuck around 0.01–0.015, permanently below the 0.02 gate, no matter
how well the route was actually served). Fixed by EMA-ing the **raw rates** (generated,
player-served, paratransit-served — each `amount/dt`, smoothed independently) and taking
the ratio of the smoothed rates afterward, never smoothing an already-computed ratio.
Confirmed fixed both by the same live scenario and a synthetic regression test
(`test/simulation-integration.test.ts`).

**A second real bug, also caught by testing before it shipped:** the promotion
threshold was originally `D_MAX.village * PROMOTION_THRESHOLD_FRACTION` = `2.5 * 0.3 =
0.75` — below the starting multiplier of `1`, so *every* village promoted to settlement
on its very first tick regardless of service. Fixed by measuring the threshold as a
fraction of the *growable range above the starting multiplier*
(`1 + 0.3 * (2.5 - 1) = 1.45`), which is safe by construction for any fraction `< 1`.

**Necessary condition, not a weighted contributor:** `playerServiceEMA` (rolling,
player-only) gates growth to exactly zero if it's ever at/below `PLAYER_SERVICE_EPSILON
= 0.02`, independent of how high paratransit's discounted contribution pushes the
combined S̄. Paratransit counts toward S̄ at `PARATRANSIT_SERVICE_DISCOUNT = 0.5`.

**Promotion is a `NodeKind` change, nothing more elaborate:** `village` → `settlement` is
already the top of the existing kind hierarchy, so `engine/growth/types.ts`'s
`GrowableTier` just mirrors it — no new tier enum. `applyPromotion` mutates
`GeneratedMap.nodes[i].kind` in place (same pattern as `decaySegments` mutating
`Segment.condition`), which is what makes the promotion show up as a real map change for
free once the caller re-renders from that same map.

**Visible on the map without reading a number:** `render/network.ts` already recolors
nodes by `kind` on every `update()` call; a promoted settlement additionally renders
larger (`0.25 → 0.32` radius) as a second, unambiguous cue. `main.ts`'s
`handlePromotions` re-runs `networkHandle.update(simulation.map)` and reuses the
existing `ui/eraBanner.ts` component (already generic — "show a message for 4s," not
era-specific) for a `"<nodeId> grew into a settlement!"` notification.

**`tick()` signature change:** now takes an optional `growth?: GrowthState` and
**returns `PromotionEvent[]`** (previously `void`) so a rendering-aware caller can react
without `engine/simulation` needing to know rendering exists. `vehicle.ts`'s
`tickVehicle` gained an optional `pickupEvents: PickupEvent[] = []` out-parameter
(same default-empty-array pattern as Module 8's `segmentConditions`) so `loadAt` calls
during ongoing ticks (not the one-time initial load at vehicle creation) report what was
picked up, from where, and by which vehicle lifecycle — this is what growth's per-node
samples are built from.

**Live-verified** (Playwright vs. local Chrome, ~90s real-time run): a temporary debug
hook (added, used, then fully removed before commit — same discipline as Module 8's
palette check) built one real passenger route and one real goods route between an
actual village and its nearest settlement on the live bootstrapped map, bought real
vehicles for both, and sampled `growth` state every 15s. `demandMultiplier` climbed
monotonically `1.00 → 1.02 → 1.07 → 1.20 → 1.30 → 1.37 → 1.41` over 90 seconds under
partial-but-real service (`playerServiceEMA` fluctuating ~0.10–0.22, since the village
still generates demand toward the 13 other inhabited nodes this pair of routes doesn't
serve) — did not reach the promotion threshold in this run, which is expected on the
full multi-node map without more routes; a dedicated two-node synthetic scenario (in
`test/simulation-integration.test.ts`) confirms promotion itself fires correctly and
`D` continues climbing past it toward the settlement's higher cap. Era transitions,
economy, and paratransit all continued running correctly concurrently throughout. No
console errors beyond the pre-existing harmless favicon 404.

## Module 10 — Save/load and scenarios ✅
Last module in `rebuild-plan.md`'s build order. Built on top of Modules 11/11b/11c/12
(merged first — see [handoff-module-10.md](handoff-module-10.md) for what they changed
that a save format has to account for) rather than in parallel with them.

**A save is state, not content.** `engine/save/types.ts`'s `SaveFile` is a hand-written
type, not derived from `content/schema.ts`. The content schemas' `.default()` calls
(`congestionWeight.default(1)`, `channels.default({})`) are correct for a hand-authored
catalog, where an absent field means "assume the common case" — they are wrong for a
save, where an absent field means "this save predates it" and must fail the version
check, not silently backfill a plausible value. `restoreIntoState` rejects anything
whose `version` doesn't match `SAVE_FORMAT_VERSION` exactly, with a clear error, and
does not touch the target state on rejection.

**Terrain is the only thing derivable from the seed.** `generateMap` is deterministic,
so `SaveFile.map` stores `{ seed, nodes, corridors, segments }` and `restoreIntoState`
regenerates the ~7k terrain floats via `generateTerrainField(createRng(seed), ...)`
rather than serialising them. Everything else in `SavedMap` has drifted from what the
seed alone would produce and has to be stored: promoted `node.kind`, decayed
`segment.condition`, authored corridors/segments, and — the field that would corrupt a
save silently, since a dropped one still renders fine — `segment.profileId`. A
dedicated test (`test/save-snapshot.test.ts`) builds a segment with a profile set,
round-trips it, and asserts the id survives.

**`SimulationState`'s four derived fields are never serialised.** `demand` (pure
function of `map.nodes`), `routing` and `ambientGeometry` (pure functions of
`map.segments`/`map.nodes`, rebuilt together by Module 12's `rebuildFromMap`), and
`segmentLoads`/`ambientLoads` (recomputed every tick) would just be a second source of
truth for something the engine already recomputes — `restoreIntoState` calls
`rebuildFromMap` and `generateDemandPairs` instead of storing any of them.

**`applyScenario`/`warmForward` (`engine/save/scenario.ts`) take plain mirrored types,
never `Scenario` or `VehicleDef` directly** — the same "content is data, engine stays
content-unaware" pattern as `EraDef` (architecture.md hard rule 2). `main.ts` maps a
loaded `Scenario`/`VehicleDef[]` into `ScenarioSpec`/`ScenarioVehicleSpec[]` before
calling in. `applyScenario` sets funds and jumps the era timeline directly (not via
`advanceEraTimeline`, which only ever moves forward), then places `seedFleet` vehicles
round-robin over pairs of inhabited nodes on the map's already-connected inherited
network — no corridor authoring needed (Module 2 guarantees full connectivity). Seed
vehicles are registered as real purchases (funds deducted, ledger/vehicleEconomics
entries created), not free stock: `startingFunds` and `seedFleet` are both scenario-
author knobs shown side by side in the Scenario Lab, so the author reconciles them
directly rather than the engine guessing at a "free starter fleet" exemption.

**`warmForward` runs real ticks, not a clock skip**, so a warmed scenario produces an
economy, a paratransit sector, and grown settlements that actually exist for the target
era — reproducible from the same seed, since nothing in the tick path but paratransit's
spawn-id derivation uses randomness, and that derives from `paratransit.elapsedSeconds`
(deterministic). Its `growth`/`eraModifiersById`/`profileDecayById` parameters are
**required**, unlike `tick()`'s optional ones — the fix for the exact bug
docs/handoff-module-10.md warned about: `tick()`'s parameters are all optional so
existing call sites keep compiling, but a warm-forward that omits `eraModifiers` gets no
ambient traffic at all, omits `growth` and settlements never develop, omits
`profileDecayById` and every segment decays at the base rate regardless of profile. A
warm-forward missing any of them would warm the wrong world silently; making them
required at `warmForward`'s own boundary turns that into a compile error instead.
*Known limitation, not a blocker:* a warmed-forward vehicle's obsolescence isn't marked
mid-warm (that logic lives in `render/fleet.ts`'s `markObsoleteStock`, which needs the
content catalog `engine/` can't import) — `main.ts` calls
`fleetController.handleEraChanged()` once after a scenario/save is applied, which
catches it for the *final* era reached, just not for eras passed through en route.

**Reload-based `load()`/`scenario()`, live `era()`/`funds()`/`warm()`.** Hot-swapping a
running scene's map/terrain would need new `setMap`/`setGroundMesh` methods and risks
stale closures in raycasting/network/authoring — instead, `load()`/`scenario()` stash a
one-shot `BootOverride` into `sessionStorage` and call `location.reload()`;
`bootstrap()` consumes it (DEV-only) and calls `restoreIntoState`/`applyScenario`
**before** constructing `sceneHandle`/`networkHandle`/`authoringController`/
`fleetController`, then reads `map` back off `simulation.map` (not the freshly generated
one) so the scene is built from whatever topology actually won. `era()`/`warm()` operate
live since neither changes map/terrain identity: `era()` sets `eraTimeline.currentIndex`
directly (so, unlike live play, it can jump backward too) and synthesizes an
`EraTransition` through the existing `handleEraTransition` reaction pipeline; `warm()`
calls `warmForward` synchronously and then re-runs the same render refresh
(`networkHandle.update`, `applyEraPalette`, `fleetController.handleEraChanged`) a live
transition would trigger.

**`window.dev` is a separate surface from `?studio=1`**, installed whenever the build is
DEV regardless of that query param — `window.dev.{era,funds,warm,save,load,scenario}`.

**A real bug caught by `verify:bundle`, not by inspection:** the first version of
`window.dev`'s object literal was constructed unconditionally at the top of
`bootstrap()`, with only `maybeMountDevTools`'s *installation* of it gated by
`import.meta.env.DEV`. An object literal built at a function's top level is never dead
code regardless of what its methods reference, so `createSnapshot`/`restoreIntoState`
and the `"transport-game:boot-override"` storage-key string shipped into the production
bundle anyway — caught immediately by `verify:bundle` failing on that exact string, not
by review. Fixed by moving the whole `devApi` construction (and the `maybeMountDevTools`
call) inside `if (import.meta.env.DEV) { ... }` at the top level of `bootstrap()`, where
Rollup can actually prove it unreachable in a production build. `scripts/
verify-prod-bundle.mjs` gained both that key string and the dev-console-ready log
message as forbidden strings so a regression fails the same way again.

**Live-verified** (Playwright vs. local Chrome, `?studio=1`): `window.dev.era("modern")`
jumped the status bar to Modern instantly (including backward-capable jumps, unlike live
play); `funds(123456)` updated the status bar directly; `warm(2)` ran without error;
`save()` wrote a version-1 snapshot to `localStorage` (segments, funds, seed all
present); `load()` triggered a reload and came back with the exact prior tick count,
era, and funds — confirming real restoration, not a fresh boot; a save with its
`version` field hand-corrupted to `999` was rejected with
`"save format version 999 is not supported (this build reads version 1)."` and the game
started a fresh map instead of mis-loading it; `scenario("modern-endgame")` reloaded,
landed in the Modern era with funds net of its seeded BRT/lorry fleet, and showed real
non-zero income/day and cost/day — confirming the 8-day warm-forward (7,200 ticks at
`SIM_DT`) actually simulated real economic activity rather than skipping a clock
forward.

## Module 11 — Dev studio + information architecture ✅
Two halves of one problem — where a fact lives, and who is allowed to author it. Full
design contract in [module-11-studio-and-ia.md](module-11-studio-and-ia.md).

### The six homes (`src/ui/`)
Every player-facing fact now belongs to exactly one home and does not also appear in
another. The rules that make each one useful are the negative ones:

- **Inspector** (`ui/inspector.ts`, new) — **empty when nothing is selected.** A
  fallback summary would make it a second Strip, and then two homes disagree about the
  same number. Covers vehicle / node / segment / corridor.
- **Overlays** (`ui/overlays.ts` state+picker, `render/overlayLayer.ts` drawing, both
  new) — exactly one active, `None` included.
- **Lists** (`ui/pnlPanel.ts`) — worst-first as before, now **select-and-focus**: a row
  click selects the vehicle and flies the camera. Ranking tells you which route bleeds;
  it doesn't tell you where it is, and hunting for it is where the "under ten seconds"
  actually went.
- **Strip** (`ui/statusBar.ts`) — fps and tick moved behind a DEV-only `diagnostics`
  field. A developer's number doesn't belong in the one home reserved for the player's.
- **Moments** (`ui/eraBanner.ts`) — now carry an optional subject and are clickable. A
  banner that says a village grew and then leaves you to find it is a dead end.
- **Map** (`render/network.ts`) — see below.

`ui/selection.ts` is the spine: a tiny store the Inspector, the list, the moments banner,
the map picker and the camera all agree on. Re-selecting the same entity deliberately
does not re-emit, or every click on an already-selected row would re-fly the camera and
read as the map twitching.

### The two visual channels finally used
`network.ts` gained `updateSignals` — recolour in place, no geometry churn, safe per
frame — mapping **hue to health and brightness to utilisation** from
`computeBottleneckMetrics`, which had been sitting unused since Module 3 waiting for
exactly this. Streets stay neutral where nothing runs (colouring every corridor makes the
map a lattice and destroys the signal). Overlays never borrow those channels: the overlay
layer is a separate additive group and the base network **dims to neutral** while one is
up, so exactly one thing on screen speaks in colour at a time.
`test/network-signal-color.test.ts` asserts hue is independent of utilisation and vice
versa, so a later "make it pop" tweak can't quietly conflate them.

### Inspector actions, and a deliberate rule exception
Three actions, all of which **stay available at negative funds**:

- *Sell vehicle* — depreciated resale. Paratransit is excluded: it is not the player's to
  sell, it is the antagonist.
- *Prune corridor* — `engine/map/prune.ts`, pure like `commitCorridor`, routed through a
  new `authoringController.applyMapChange` so Ctrl/Cmd+Z undoes a prune exactly as it
  undoes a build (two undo stacks would be a trap). Settlements and villages are never
  removed — a place is not built infrastructure — and a junction survives if another
  corridor still uses it. Blocked **only** by `engine/simulation/dependents.ts` finding
  vehicles still routed over it, which it names so you can sell them first.
- *Maintain segment* — `restoreSegmentCondition` restores first and returns the deficit
  actually bought back; `maintenanceCost` prices exactly that. Maintenance pricing lives
  in `pathing/cost.ts` because that module is the only place geometry may become
  currency.

`test/ui-inspector.test.ts` pins this down against `funds = -5000`: if a later change
routes these three through `canAfford` "for consistency" with purchases, that is what
should fail.

Keeping all three usable in debt is a **deliberate, documented exception** to
`economy/state.ts`'s "spending is blocked when it isn't affordable", which still governs
purchases. The distinction that justifies it: buying a vehicle *adds* ongoing cost, these
three *remove* it, and they are the only levers a player in debt has. §5 records three
playthroughs ending in undiagnosable debt — disabling the way out isn't a rule worth
being consistent about. Flagged here because it is the one place this module contradicts
an earlier module's stated rule.

### Build vs Inspect are explicit modes
Tab toggles; the mode is always on screen. They compete for the click and most of the
keyboard, and modifier-click conventions would have been worse than a visible mode.
`authoring.ts` now stands down entirely in inspect mode rather than silently mutating a
pending draw with `1`/`2`/`3`/`R`/Enter.

Picking (`render/picking.ts`) is **grid-space arithmetic, not raycasting**: line
primitives are near-impossible to hit with a ray (Module 5's bridge-deck bug lived at
this exact boundary), and grid-space picking is unit-testable with no WebGL context.
`render/vehicles.ts` shares `vehicleGridPosition` with it, so the marker you see and the
thing you click cannot disagree.

### The dev studio (`?studio=1`)
Module 1's tuning panel became one tab of four: **Tuning · Profile Studio · Asset Modder
· Scenario Lab**. `?tune=1` is kept as an alias rather than retired. Preact JSX is
configured through Vite 8's **`oxc.jsx`** — Vite 8 replaced the esbuild transform with
oxc, so the familiar `esbuild.jsx` key no longer exists.

**Profile Studio** — an SVG cross-section canvas ruled at 1 m with the centre at (0,0),
preset elements dragged by their vertex handles, and a live 3D sweep.
`render/studioProfile.ts` derives the swept silhouette as the upper envelope walked
left-to-right then the lower envelope back — a true polygon union is unnecessary because
a cross-section is single-valued the way terrain is, so the envelope *is* the silhouette,
exactly, for anything that can actually be built. Frames use **world up, not a Frenet
normal**: a road banks with the terrain, not with its own plan curvature, and a Frenet
frame rolls the section upside down through an inflection point. The preview sweeps along
an S-curve with an elevated run, because a straight test piece hides both the failures
that matter (fan-out at curvature, frame flip at the inflection).

`MATERIAL_CHANNELS` lives **in the schema**, so "asphalt takes friction and decay, a curb
takes structural integrity" is a validated fact — a curb claiming friction is a parse
error, not a value that silently does nothing. The editor reads the same map and only
offers channels the material actually carries.

**Asset Modder** — drag a `.glb`/`.gltf` in, click the mesh to drop anchor gizmos (axles,
boarding doors, cargo nodes, particle emitters), fill in the `VehicleDef`, write a mod
package. Anchors are **placed by clicking, not typed**: a boarding door written as
`[0.8, 0.4, -1.2]` is unverifiable until something stands in the wrong place at runtime.
Imported models are normalised to a fixed framed size so anchors mean the same thing
whether the source was authored in centimetres or metres.
`scripts/studio-mod-writer.mjs` is a Vite plugin with `apply: "serve"` — not a
runtime-gated path but one that **doesn't exist in a production build at all** — writing
`vehicle.json` plus the mesh into `public/mods/<mod_id>/`, with a download fallback.

**A real gap closed on the way through:** `congestionWeight` has been modelled in
`simulation/congestion.ts` since Module 7, but *nothing ever supplied a value* —
`render/fleet.ts` never passed one, so every player vehicle took `createVehicle`'s
default of 1 and an okada weighed exactly as much as a BRT, which is the precise thing
§5's "an okada occupying the same road space as a bus is plainly wrong" exists to
prevent. The catalog now carries real weights (0.3 okada → 2.2 BRT), fleet.ts threads
them, and a content test asserts weight rises with capacity so it can't silently flatten
again.

**Deliberate deviation from the brief:** `runsOn` was specified as `road | rail`. It is
left as free text. The committed schema and the whole existing catalog use it as the
propulsion/fuel channel (all `"petrol"`, with an electric Modern-era bus as its
documented reason to exist); road vs. rail is a property of the *segment* a vehicle
routes over, not of the def. Narrowing it would invalidate every existing vehicle and
delete a field already load-bearing for a later era. The tab says so where it's edited.

### Boundaries
`test/architecture-boundaries.test.ts` now also forbids `engine/` importing `ui/` and
`dev/`. Both gained a lot more surface in this module — `ui/inspector.ts` reads engine
state to build its panels and `dev/` authors content the engine consumes — so the
pressure to close the loop the wrong way round is real now in a way it wasn't when `ui/`
was four read-only text panels. `verify-prod-bundle.mjs` carries a forbidden string per
studio surface; adding a tab means adding a string, or the gate stops being an assertion.

### Live verification (Playwright vs. local Chrome, three separate runs)
- **Game:** status strip reads correctly, `O` cycles the seven overlays with each one's
  question shown, Tab switches to INSPECT, a map click resolves to a real inherited
  segment and the Inspector renders its stats plus a priced maintenance action (₦23 for a
  24.4-cell segment at 73% condition). Inspector starts hidden, as it must.
- **Profile Studio:** selecting the curb exposes 4 drag handles; dragging one updates the
  derived bank-to-bank width live (7.22 m → 9.9 m); adding ballast offers exactly decay
  and structural integrity and no friction; export round-trips a valid `Profile2DDef`
  with a 12-point outline.
- **Asset Modder:** a minimal hand-built glTF drops and frames; two clicks place two axle
  anchors and one places a boarding door at real surface coordinates; "Write mod package"
  lands a schema-valid `vehicle.json` plus the mesh in `public/mods/<id>/`.

No console errors in any run beyond the pre-existing harmless favicon 404.

## Module 11b — Profiles applied to the map ✅
The follow-up Module 11 listed as not done. Authored cross-sections are now what the map
is actually made of.

- **Content:** `public/content/profiles.json` — feeder-road, trunk-road, expressway,
  colonial-rail, standard-gauge. Generated *through* `crossSectionOutline`, and
  `test/content-profiles.test.ts` re-derives every outline and width from the elements, so
  a hand-edited profile whose silhouette stops matching its own parts fails the build. A
  costlier profile must also last longer, asserted rather than assumed — otherwise paying
  more would be a pure tax.
- **`Segment.profileId?: string`** — an opaque key, never the content type, exactly as
  `VehicleEconomics.defId` is.
- **Resolution is by fallback, not by stamping** (`render/profileCatalog.ts`): a segment
  with no profile, or one naming a profile a mod has since removed, still renders and
  still decays at the base rate. `main.ts` declares what the *inherited* network was built
  to (neglected colonial rail, cheap feeder roads — the brownfield premise), which is the
  bootstrap layer's documented job.
- **Decay:** `decaySegments` takes a plain `Map<profileId, multiplier>` and **composes**
  it with the era multiplier rather than replacing it — an Informal-era decay spike should
  still bite an expressway less than a laterite feeder, which is the whole point of
  authoring the difference.
- **Cost:** priced through `sumStepCosts`, never around it. `costPerMeter` is applied
  **relative to `REFERENCE_COST_PER_METRE`**, because the map has no stated cell size:
  inventing a metres-per-cell scale to make it absolute would silently rebalance every
  number Modules 4–9 were tuned against, to buy precision the model does not have. The
  reference profile leaves existing pricing exactly where it was. It scales the per-length
  terms only, never `nodes` — a junction is a junction whichever surface meets there.
- **Authoring:** `T` cycles the profiles valid for the current infrastructure type (reset
  on the road/rail toggle, since they are separate lists and a carried index would
  silently pick an unrelated profile). The receipt updates live.
- **Rendering:** `render/corridorGeometry.ts` splits a corridor's single smoothed polyline
  into per-segment runs. Until now `network.ts` drew straight lines node to node and **none
  of the whole-chain smoothing Module 4 paid for had ever been visible** — sweeping a
  cross-section made that impossible to ignore, since a profile swept along a straight line
  fans out at a corner.

**Two real bugs found by looking at the result, not by testing it:**

1. **The orthographic camera was non-uniformly scaled.** `scene.ts`'s `resize()` updated
   `camera.left`/`right` from `baseHalfHeight` but never `top`/`bottom`, which stayed at
   whatever the constructor set from `style.camera.viewSize`. The moment `setTerrain`
   raised `baseHalfHeight` to frame a real map, the world rendered ~2.7× horizontally
   squashed at a 1400×950 canvas. Pre-existing since **Module 4**; it survived because
   nothing on screen was round enough to give it away. Spotted as node spheres drawing as
   vertical ellipses — a visual saying something the model doesn't mean, the failure class
   §5 calls the single most reliable rule in the project.
2. **Literally-correct asphalt is invisible asphalt.** The studio's material palette was
   picked for a lit close-up preview against a dark editor background. On the map, real
   asphalt (~`0x3a3a3e`) sits exactly where era-tinted terrain already is, and the roads
   vanished. Re-valued for albedo separation (§5: "the scene read flat because large areas
   shared an albedo, not because the lighting was wrong"), keeping value structure *within*
   a profile so light ballast against dark sleepers is what makes rail read as rail. The
   studio's swatches now derive from the renderer's palette rather than restating it.

**Live-verified** (screenshots actually looked at, not just asserted on): the whole 48×48
map frames correctly with round node markers; roads render at real cross-section width and
rail reads as ballast-and-sleepers when zoomed; a bridge built across water renders the
swept deck with its fascia band and shadow; cycling `T` while previewing moves the receipt
through feeder-road ₦194 / trunk-road ₦297 / expressway ₦750 with `nodes: 50` unchanged
throughout, confirming the profile scales the per-length terms and not the point cost; the
Inspector reports `profile feeder-road (inherited) · cross-section 7.2 m · decay rate
1.60x`. The Condition overlay shows the colonial rail spine as the worst thing on the map,
which is correct and not a decay artifact — `corridors.ts` has started inherited rail at
condition 0.6 and roads at 0.75 since Module 2. That is the brownfield premise rendering
itself.

**Still not done:** sleepers sweep as a continuous band rather than discrete cross-ties. A
swept cross-section cannot express repetition *along* the alignment at all, so this is a
limit of the representation rather than a tuning gap. At the diorama's middle-distance
register the continuous band still separates rail from road by width and surface
treatment, which is what §5 asks of the channel.

## Module 11c — Asset Modder crash on a real `.glb` ✅
Reported from actual use: loading `Train_Track_01.glb` printed `RangeError: Maximum call
stack size exceeded`.

`btoa(String.fromCharCode(...new Uint8Array(buffer)))` spreads every byte as a separate
function argument, so it throws once the file exceeds the engine's argument limit —
measured here between 64 KB and 128 KB in V8. **The Module 11 live verification used a
678-byte hand-built glTF**, three orders of magnitude below the threshold, so it passed
while the first real model anyone loaded blew the stack. A fixture small enough to be
convenient was the whole reason this shipped.

Replaced with a chunked encoder in `src/dev/encodeMesh.ts`. `FileReader.readAsDataURL`
would also work and is native, but Bun has no `FileReader`, so it could not have a
regression test pointed at it; `test/dev-encode-mesh.test.ts` now straddles the failing
threshold deliberately (64 KB / 128 KB / 1 MB / 5 MB) against `Buffer`'s own encoding.

**The quieter bug underneath it was worse.** `setMeshName(file.name)` ran *before* the
throwing line, so the panel reported "Loaded Train_Track_01.glb" while no bytes had been
captured — which is exactly what the report showed, both messages at once. "Write mod
package" would then have written a `vehicle.json` whose `mesh` named a file the server was
never given, producing a mod that looks fine on disk and fails later, somewhere else.
Fixed on both sides: the client encodes before touching any state and only claims `mesh`
when it holds the bytes, and the writer refuses the whole write if `vehicle.mesh` names a
file it wasn't sent. The mesh filename also gets the allowlist treatment the mod id
already had, since it likewise becomes a path on disk.

Re-verified against a real 501 KB **binary** `.glb` — the earlier fixture was JSON
`.gltf`, so the GLB container path had never been exercised either. Loads clean, anchors
place on the mesh, and the written mesh is byte-for-byte the size of the source.

## Module 12 — Ambient private traffic ✅
The prosperity loop closed: the network develops villages into settlements, the growth
that implies puts private cars on the road, and the corridors that enabled the growth
start to choke. Road transit becomes a victim of its own success, and grade-separated rail
is the only way out.

**No car agents.** `C_ambient` is a per-segment *load*, not a population — a private
commuter is not something the simulation moves, it is something that makes the road
narrower. Same reasoning as aggregate demand queues (architecture.md hard rule 4), and it
costs one number per segment per tick. `render/network.ts` draws instanced cars *from*
that number; deleting the renderer would change how the game looks and nothing about how
it plays.

`ambientTraffic` joins the five existing era modifiers as content (`eras.json`), so the
whole curve is tunable without touching code — starting values 0.02 / 0.18 / 0.08 / 0.38
across the four eras. Required rather than optional-with-a-default: an era that forgot to
say how motorised it is would silently render as empty roads, and a missing mechanic that
looks like a working one is the worst kind.

**Attenuation is measured from each segment's midpoint, not its endpoints — and that
distinction is the whole mechanic.** Measured at the endpoints, a 24-cell
settlement-to-settlement highway has both ends at distance zero and therefore carries full
traffic along its entire length: prosperity would degrade every road on the map uniformly,
a flat tax with nothing to route around. Measured at the midpoint, short approaches stay
busy and the open middle of a long intercity run stays clear. Caught by looking at the
first render, not by a test.

**Rail's immunity is structural, not a filter.** Rail segments are excluded when the
ambient geometry is built, so there is no code path in which a railway acquires car
traffic. The strategic payoff depends on that being absolute: if rail took even a
fraction, there would be no infrastructure immune to the late-game hazard and the mechanic
would stop being a decision. It is visible on the map — under Corridor stress, roads carry
ribbons and the colonial spine carries none.

**The runaway safeguard.** Ambient traffic closes a genuine vicious loop: cars slow the
player's buses → queues clear more slowly → the unserved EMA rises → paratransit spawns →
paratransit adds *more* load to the same road. Every step is individually correct, which
is what makes it dangerous. Queue depth cannot tell "service collapsed" apart from "the
road got slower"; the rolling player-served share can, so `trySpawnParatransit` damps its
threshold by `engine/growth`'s `playerServiceEMA` for that origin. It **damps rather than
blocks** — paratransit filling any gap the player leaves is the hook, and a hard cutoff at
moderate service would turn the antagonist into a subsystem that politely waits its turn.

A test asserting era pressure and service damping "compose" initially failed, and the
**test** was wrong, not the code: Informal-era pressure is strong enough to break through
service that would block a spawn in a calmer era. That is the correct reading of "rail
collapse, paratransit takeover" — the damping exists to stop a feedback loop, not to let a
competent player switch the antagonist off.

**A legibility regression caught in the same session it was introduced.** The Corridor
stress overlay drew a ribbon wherever load was above zero, which was fine while vehicles
were the only thing on the road. Ambient traffic puts non-zero load on *every* road in
every motorised era, so the overlay ribboned the entire network — "colouring every corridor
destroys the signal" (§5), in one change. Now gated at `FREE_SLOT_WEIGHT`: a free-flowing
link is not an answer to "which link is the bottleneck?"

**Two smaller cleanups the work forced.** `SimulationState` publishes `segmentLoads`
(total) and `ambientLoads` (the private-car share) once per tick, so the number that slows
a bus and the number the overlay draws are literally the same object. And `rebuildFromMap`
consolidates the map/routing/ambient-geometry rebuild that `render/fleet.ts` was doing by
hand at two separate call sites.

**Live-verified**: instanced cars render and move along real corridor centrelines at a
steady 60 fps; under Corridor stress the dense settlement cluster shows stressed
approaches while long intercity runs show nothing, and the rail spine shows nothing at
all. Verified by temporarily raising the starting era's factor to stand in for a grown
Modern network, then reverting — the committed content is unchanged.

**Not calibrated, deliberately.** The numbers are starting points, not gospel (§5:
"analytical models are wrong on first contact, every time; the error is usually
calibration, not structure"). They live in content precisely so a playtest can move them
without a code change. What has *not* been felt is a real Modern-era game with genuinely
grown settlements — that needs a warm-forward, which is Module 10's job.
