# Build status

Living log, one section per module from [rebuild-plan.md](rebuild-plan.md)'s build order.
Update this when a module finishes or its scope changes — this is what a new
conversation should read first to know where things stand, before diving into source or
`git log`. Pair with [architecture.md](architecture.md) for the stable "how it's shaped"
reference.

Current test count: **231 passing** across 39 files (`bun test`). All of typecheck /
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

## Module 10 — Save/load and scenarios (not started)
Last module in `rebuild-plan.md`'s build order. Module 11 landed ahead of it and did
**not** implement it: `ScenarioSchema` exists in `content/schema.ts` and the studio's
Scenario Lab tab authors and validates one, but nothing *applies* a scenario yet — that
needs the warm-forward pass and is still Module 10's job.

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

**Not done, and deliberately so:** authored profiles are not yet *applied* to built
corridors — `Profile2DDef` is authored, validated and swept in the studio, but
`render/network.ts` still draws segments as lines and decks. Wiring a profile onto a real
corridor (and its `decayRateMultiplier` into `decaySegments`) is the natural next step and
was outside this module's brief.
