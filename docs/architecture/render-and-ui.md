# Render and UI

Everything under `src/render/` and `src/ui/`. Rendering **reads state; it owns
nothing** — consumes snapshots from `engine/`, never mutates them. No cached display
state anywhere: every panel re-derives from the current snapshot each frame rather than
storing a mutable view tree, which is also why the game UI is vanilla DOM rather than a
framework (principles.md §2) — the re-derive discipline is what a framework's
reconciliation exists to solve, and this codebase doesn't have that problem to begin
with.

## 1. Scene, camera, style

`render/scene.ts`/`style.ts`: one mutable `StyleSpec` object holds every value that
decides how the scene looks — no scattered constants. `applyStyle` is cheap (no
geometry rebuild) and is what both the era-palette transition and the dev studio's live
Tuning tab call. Diorama treatment: base slab with visible thickness, directional key
light with shadows, fill + ambient, contact shadows (grounding is the cheapest legibility
win available — without it everything floats). Angled orthographic camera
(`render/camera.ts`), middle-distance register, cursor-anchored zoom/pan/rotate; no
street-level flying, a deliberate trade that saves a lot of building detail.

**Bug caught live, Module 11b — a visual saying something the model doesn't mean, the
single most reliable failure class in the project (principles.md §3).** The
orthographic camera was non-uniformly scaled: `scene.ts`'s `resize()` updated
`camera.left`/`right` from `baseHalfHeight` but never `top`/`bottom`, which stayed at
whatever the constructor set from `style.camera.viewSize`. The moment `setTerrain`
raised `baseHalfHeight` to frame a real 48×48 map, the world rendered ~2.7× horizontally
squashed at a 1400×950 canvas — pre-existing since Module 4, surviving because nothing
on screen was round enough to give it away, until node spheres started drawing as
vertical ellipses.

## 2. The six homes

Every player-facing fact belongs to exactly one of six homes (hard rule 5 in
[index.md](index.md)), and — the negative rule that makes this useful — does not also
appear in another:

| Home | Files | What it holds | The rule that keeps it honest |
| --- | --- | --- | --- |
| **Inspector** | `ui/inspector.ts` | Everything about the one selected entity: stats and the actions you can take on it. | **Empty when nothing is selected.** No fallback summary — a fallback would make it a second Strip, and then two homes disagree about the same number. |
| **Overlays** | `ui/overlays.ts` (state+picker), `render/overlayLayer.ts` (drawing) | One question asked of the whole map at once. | **Exactly one active at a time**, `None` included. Overlays that stack stop being readable. |
| **Lists** | `ui/pnlPanel.ts`, `render/fleet.ts` | Ranked comparisons across many entities. | **Worst-first by default**, and every row is **select-and-focus**: clicking it selects the entity and flies the camera there. Ranking tells you which route bleeds; it doesn't tell you where it is, and hunting for it is where "diagnosable in under ten seconds" actually went. |
| **Strip** | `ui/statusBar.ts` | Ambient state you must never have to ask for. | **Never behind a click.** Funds, burn-rate EMA, era. `fps`/`tick` live behind a DEV-only `diagnostics` field — a developer's number doesn't belong in the one home reserved for the player's. |
| **Moments** | `ui/eraBanner.ts` | Brief, self-dismissing events (era transitions, growth promotions, `window.dev.warm()`'s summary). | Clicking a moment **selects its subject** — a moment is a pointer into the Inspector, not a dead-end toast. Reused as a fully generic "show a message for 4s, optionally with a subject" component rather than one type per event kind. |
| **Map** | `render/*` | The world itself. | **Hue = health, brightness = utilisation.** Two channels, two meanings, never conflated (hard rule 6). |

`ui/selection.ts` is the spine: a tiny store the Inspector, the list, the moments
banner, the map picker and the camera all read or write. No panel owns "what is
selected" — that's what lets a list row, a banner and a map click all mean the same
thing. Re-selecting the same entity deliberately does not re-emit, or every click on an
already-selected row would re-fly the camera and read as the map twitching.

### The two visual channels

`network.ts`'s `updateSignals` recolours in place (no geometry churn, safe per frame),
mapping **hue to health and brightness to utilisation** from
`computeBottleneckMetrics`. Streets stay neutral where nothing runs — colouring every
corridor turns the map into a lattice and destroys the signal. Overlays never borrow
these channels: `overlayLayer.ts` is a separate additive render group, and the base
network **dims to neutral** while an overlay is up, so exactly one thing on screen
speaks in colour at a time. `test/network-signal-color.test.ts` asserts hue is
independent of utilisation and vice versa.

**Regression caught in the same session it was introduced, Module 12.** The Corridor
stress overlay drew a ribbon wherever load was above zero, which was fine while
vehicles were the only thing on the road. Ambient traffic put non-zero load on *every*
road in every motorised era, so the overlay ribboned the entire network — exactly the
"colouring every corridor destroys the signal" failure. Fixed by gating the ribbon at
`FREE_SLOT_WEIGHT`: a free-flowing link is not an answer to "which link is the
bottleneck?"

### Inspector actions, and a deliberate rule exception

Three actions, all of which **stay available at negative funds** (`funds = -5000` is
pinned by `test/ui-inspector.test.ts`): *sell vehicle* (depreciated resale; paratransit
excluded — it isn't the player's to sell, it's the antagonist), *prune corridor*
(`engine/map/prune.ts`, routed through the authoring controller's
`applyMapChange` so undo covers it exactly as it covers a build — two undo stacks would
be a trap; blocked only by `engine/simulation/dependents.ts` finding vehicles still
routed over it, which it names so you can sell them first), *maintain segment*
(`restoreSegmentCondition` restores first and returns the deficit actually bought back;
`maintenanceCost` prices exactly that, per hard rule 3).

This is a **deliberate, documented exception** to `economy/state.ts`'s "spending is
blocked when it isn't affordable," which still governs purchases. The distinction: a
purchase *adds* ongoing cost, these three *remove* it, and they're the only levers a
player in debt has — disabling the way out isn't a rule worth being consistent about
(principles.md §3 records three playthroughs on the first attempt ending in
undiagnosable debt).

## 3. Picking and authoring

`render/picking.ts` converts the pointer to a grid cell through the one shared
`gridCoords.ts` conversion, then does plain distance math, preferring vehicle → node →
segment. **Grid-space arithmetic, not raycasting** — line primitives are near-impossible
to hit with a ray (the bridge-deck bug below lived at exactly this boundary), and
grid-space picking is unit-testable with no WebGL context. `render/vehicles.ts` shares
`vehicleGridPosition` with it, so the marker you see and the thing you click cannot
disagree.

`render/authoring.ts` is the interactive corridor-building controller: click-to-place
waypoints, live cost preview (via `pathing/plan.ts`, never a second cost computation),
undo history, alignment modes (straight/curve/auto, switchable mid-draw — straight
doesn't mean "ignore terrain," it means "hold this line and tell me what holding it
costs"). Build and Inspect are **explicit modes**, not modifier conventions — they
compete for the click and most of the keyboard, and `authoring.ts` now stands down
entirely in inspect mode rather than silently mutating a pending draw.

**Bugs caught live, Module 4.** (1) A grid-Y/world-Z sign flip in `gridCoords.ts` —
silent, routed corridors to the wrong nodes; now locked in by
`test/grid-coords.test.ts`'s non-round-trip assertion. (2) A node-ID collision between
the map generator and the authoring builder — fixed with an `authored-` id prefix so
the two id spaces can never collide regardless of generation order.

**Bug caught live, Module 5.** A bridge-deck rotation sign bug in `network.ts`: X came
out right (cosine masks sign errors) but Z was reflected — root-caused via a temporary
standalone HTML harness reading `mesh.matrixWorld`-transformed endpoints through
Playwright, not by re-deriving the rotation on paper a second time. This is the origin
of the live-verification discipline described in [index.md](index.md) — some
render-layer bugs are faster to catch by reading real transformed coordinates than by
re-deriving geometry by hand.

**Live getters, not captured values, for anything era-dependent.**
`createFleetController` and `createAuthoringController` take
`getCurrentEraId: () => string` / `getBuildCostMultiplier: () => number` /
`getRailAvailable: () => boolean` callbacks, not one-time values — the era timeline
advances on its own after these controllers are constructed. Rail gating specifically
also *reconciles* a mid-draw rail selection back to road if a transition happens while
authoring is in progress — a designed absence must be visible in advance, not ambush an
in-progress action.

## 4. Corridors as swept cross-sections (Module 11b)

Each segment's body is its authored `Profile2DDef` (content, see
[content.md](content.md)) swept along its share of the corridor's smoothed polyline —
`render/corridorGeometry.ts` splits the corridor's one whole-chain smoothed polyline
into per-segment runs. Until this module, `network.ts` drew straight lines node to node,
and none of the whole-chain smoothing `pathing/smoothing.ts` paid for had ever been
visible — sweeping a cross-section made that impossible to ignore, since a profile swept
along a straight line fans out at a corner. `render/studioProfile.ts` derives the swept
silhouette as the upper envelope walked left-to-right then the lower envelope back — a
true polygon union is unnecessary because a cross-section is single-valued the way
terrain is. Frames use **world up, not a Frenet normal**: a road banks with the terrain,
not with its own plan curvature, and a Frenet frame rolls the section upside down
through an inflection point.

Because a segment body's colours now belong to its *materials*, hue and brightness (the
two display channels) moved onto a thin signal strip above the carriageway rather than
repainting the road a different substance. A segment whose profile can't be resolved
(missing content, or none authored) degrades to the pre-profile line rendering —
missing content must never blank the map (`render/profileCatalog.ts`'s `resolve` is a
fallback chain, never a stamp).

**Bug caught live, Module 11b.** Literally-correct asphalt was invisible asphalt: the
studio's material palette was picked for a lit close-up preview against a dark editor
background. On the map, real asphalt sat at almost the same value as era-tinted
terrain, and the roads visually vanished. Re-valued for albedo separation
(principles.md §3: "the scene read flat because large areas shared an albedo, not
because the lighting was wrong"), keeping value structure *within* a profile so light
ballast against dark sleepers is what makes rail read as rail.

**The metre scale is visual only.** `WORLD_UNITS_PER_METRE` in `studioProfile.ts` exists
so a cross-section authored in metres lands at roughly the width the Module 5 bridge
deck established. It is deliberately **not** reused for pricing — the map has no stated
cell size, so `pathing/cost.ts` prices `costPerMeter` *relative to*
`REFERENCE_COST_PER_METRE` (see [content.md](content.md)) and no invented scale leaks
into currency.

**Still not done:** sleepers sweep as a continuous band, not discrete cross-ties. A
swept cross-section cannot express repetition *along* the alignment at all — a limit of
the representation, not a tuning gap. At the diorama's middle-distance register the
continuous band still separates rail from road by width and surface treatment, which is
what the display-legibility Finding asks of the channel.

## 5. Overlays

`render/overlayLayer.ts` draws into its own additive group on a 0.25s timer — every
overlay is a whole-map aggregate, so per-frame disposal churn would dwarf the
simulation cost of computing it. Always calls the engine's own function for whatever it
displays (`congestionFactor` for stress, `stepCost` for buildability) — never a second
computation, same discipline as hard rule 3.

## 6. Ambient traffic rendering

`network.ts` draws instanced cars **from** the published `ambientLoads` number (see
[engine.md](engine.md)); deleting the renderer would change how the game *looks* and
nothing about how it *plays* — the load exists in `engine/` whether or not anything
draws it.

## 7. The slice's page (principles.md §6)

`slice.html` + `src/slice/` — a separate page, flat 2D canvas, no three.js, no Preact. It
reads `engine/slice` state every frame and keeps no display state of its own (the same
no-cached-view discipline as §2).

- **`render.ts`** draws, back to front: ground, roads (dashed tan = inherited dirt, solid
  grey = built), one coloured line per route (offset per route so shared roads show both),
  the ghost line, vehicles, towns, and the ghost's price label last so nothing draws
  through it. Vehicles keep right of the road centre so opposite directions don't overlap.
  A bus is outlined in its route colour and filled from the back by how full it is. The
  informal sector reads by size: a danfo is a yellow minibus with a black stripe, a keke a
  small yellow tricycle with a green band, an okada a dark dot. The page calls their shared
  share "informal".
- **Each town carries the loop's two facts.** The ring: where its passengers went, as
  shares of rolling rates — blue yours, yellow danfo, grey stayed home. The dots: people
  waiting now, one per four. Both are always on; there is no overlay to switch.
- **Desire lines** — hovering a town (or, failing that, the selected one) draws a straight
  line to every other town: thickness = how many want that trip (√-scaled to the town's
  biggest), and the line itself is a stacked bar of who carries them — blue from the
  focused end, then yellow, then grey — labelled riders/day. The side panel swaps to that
  town's trip list with the same bars. One home at a time: the panel shows the focused
  town *or* your routes, never both.
- **Route rows** show income/cost/net, a stacked bar of where the route's riders went
  (you / poached / gave up → danfo / stayed home), and `diagnoseRoute`'s verdict as one
  sentence with the lever that would change it. Build previews carry the trip's
  riders/day alongside the price.
- **Interchanges** — a town where at least 3 riders/day change buses draws with a second,
  inner outline (the Mini Metro convention), and its panel says how many change there.
- **Town events** arrive from `sliceTick` and show as a longer toast. Ruins (abandoned
  emergent towns) draw as a grey dot with the name in italics.
- **`main.ts`** — two tools (Bus `B`, Road `R`): click a town, then another. Shift keeps
  the first town selected. Refusals come back as `reason` strings from `engine/slice`
  and show as a toast; the ghost previews the same `check*` result and `roadCost` before
  you click. The strip shows day, funds, net/day (economy's burn-rate EMA), the
  you/danfo/home share bar, and what danfos earned. The routes panel is worst-first with
  +/− per route. Speed: Space pauses, 1/2/3 give 1×/2×/4×.
- **`map.ts`** — the hand-made map as a TS constant, not yet content JSON (it moves to
  `public/content/` once the loop survives a playtest).
