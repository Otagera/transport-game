# Render and UI

Everything under `src/render/` and `src/ui/`. Rendering **reads state; it owns
nothing** — consumes snapshots from `engine/`, never mutates them. No cached display
state anywhere: every panel re-derives from the current snapshot each frame rather than
storing a mutable view tree, which is also why the game UI is vanilla DOM rather than a
framework (principles.md §2) — the re-derive discipline is what a framework's
reconciliation exists to solve, and this codebase doesn't have that problem to begin
with.

> **Retired 2026-10-23 with the 3D game** (§1-6: the three.js scene, the six homes, picking, profiles, overlays, ambient traffic; §7, the game's page, is current). Kept as history; the code is under the git tag `original-3d`. See [index.md](index.md).

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

`index.html` + `src/game/` — a separate page, flat 2D canvas, no three.js, no Preact. It
reads `engine/game` state every frame and keeps no display state of its own (the same
no-cached-view discipline as §2).

**Slice zero's screen (brief steps 7-8, 2026-10-19).** Styled from the design lab's "The
brief, step 8" preset (`src/design-lab/main.ts` `PRESETS.brief`): paper theme, solid panels,
mono spaced-capital labels (`.k`, `--label-font`), chips, town and route cards, a control
hint line over the toolbar, no key box (chips are their own key). The preset's contour
terrain isn't applied: the map still draws shaded hills.

- **The strip** (`renderStrip`) is the brief's headline, all 5-day averages
  (`history.ts`): day, budget (funds), net a day, trips made a day, and chips for your
  riders, informal, no road (hatched) and no seat -- one number each, the meaning on hover.
  Your share in % moved one click down: the routes panel's last block. The score marked like
  the money (R1 5): trips made carries ▲/▼ and its change over `TREND_DAYS` (10), green or
  red, and a sparkline of the 5-day average since day 1 (`sparkline`, an inline SVG, shape
  only); then "People, since day 1" (`peopleSinceStart`: shrinking towns count against).
  A town passing +25%, +50%, ×2 or ×3 of its day-1 size is a toast ("Owode has grown by a
  quarter since day 1: 45k → 56k people") and a green tag over it on the map for
  `MILESTONE_BADGE_DAYS` (`freshMilestone`, drawn in `drawTown`).
- **Route cards** (`routeCard`): vehicles, in, cost and net a day; the pair with +/−; one
  verdict of at most 12 words naming one lever (`verdicts.ts` `shortVerdict`, tested), the
  long `reasonText` on the card's hover; the riders bar.
- **The look** (the design lab's pick, applied 2026-10-20): two **wings** in `index.html` --
  `#wing-town` left (the town or site card, `townEl`: every card renders there) and
  `#wing-routes` right (`#routes`: advice, routes, corridors, who carried trips) -- glass
  (68% panel, 20px blur, a blue glow), leaning 7° at rest and flat when used, tucked to a
  44px spine (its name, and your routes' net) and out on hover, focus, a town hovered or
  selected (`.out`), or a click on the spine (`.pinned`). The map fits between the spines
  (`fitView`'s `sideInset`). Round corners (16px), glass on the toolbar and the Treasury;
  the control hint line is gone, the map's number and its links sit top-right. Terrain:
  contour lines (marching squares on the terrain's elevation, seven levels to its peak) over
  a light hill wash, and "THE RIDGE" and "THE RIVER" on the ground where there's room.
  Route lines Mini Metro's way: a slot per route on every road, each drawn parallel to the
  road in its slot (`drawRouteLines`, `strokeParallel`).
- **Site production** (`production.ts siteProduction`; `main.ts productionHtml`,
  `siteProblem`): every site card opens with what it makes against capacity, each input
  against what full output takes, its shift, and the share carried away, a gauge each, the
  binding one marked "holding it back"; with no more pressing problem, the bottleneck is "The
  problem here" (short of its input, naming where from; or most of it waiting). On the map, a
  gauge under each site's square (green ≥80%, amber ≥40%, red below; grey idle). The map
  passes `goodsFlows` in once a frame (playtest, map 2411: "we need indications for the
  factories in terms of production").
- **Map labels** (`render.ts draw`, `occupied`): towns draw first, biggest first, and take
  their circle and name; then sites, each with its name only (muted) at rest -- what it makes
  only when hovered or selected, "idle · restore it" and "no road" always -- placed below,
  above, right or left of its square, whichever is free, else hidden until you point at it
  (playtest, map 2411: "the screen is getting too muddled").
- **The Treasury drawer** (`treasuryHtml`, `#treasury` in `index.html`; Revision 3, Money, 5,
  the design lab's pick): a one-line tab above the control line (kept a day, levy, bond
  repayments, the worst chain), out on hover or focus, pinned by a click on the tab, into four
  columns built from `budgetParts`: income and spending lines a day over the last 5 days
  (`averageBudget`, summing to the strip's net); net, the treasury's take, bond repayments
  and what you keep, the bonds owed and the project saved for; and `chainLines` (fuel,
  cement, workers). Re-rendered with the side panel (`renderPanel`); its buttons share the
  panel's click handler (`onPanelClick`). The budget is no longer in the side panel.
- **The town card** (`renderTown`): kicker (role, size, ▲/▼), name, three lines (biggest
  trip, who carried its trips, inside trips), "The problem here" (no road; no road to some
  towns; its road is full -- `roadFull`: grown to all its rung allows, naming the next rung;
  or a road but no seat), growth, its top five trips, a pager through the towns.
- **The developer view, `?dev=1`** (`dev`): Best next moves, forecast lines on previews,
  the second click on a losing move, Results and receipt toasts, route rows' riders/load
  line, and the key. Without it none of that runs: no forecast workers, and `act()` skips
  `receipts.perform`, so no shadow world steps every frame.
- **The bus lane and strikes** (Revision 1, 1b): the Road tool on a paved road offers a bus
  lane (preview: price, "your vehicles skip the traffic · danfos lose a lane, and their union
  will strike"); a lane draws as a band of your colour under the road (wider than a route
  line, so it reads as the road's); a struck road as a red dashed line, with a "STRIKE" tag
  drawn after the towns (`drawStrikeLabels`) so nothing covers it; strikes start and end
  with a toast. Encroachment fades the band and grows yellow dashes in it; a strictly
  enforced lane carries a "W" warden badge (`drawWardens`). The Road tool on a laned road
  switches enforcement (preview: its cost a day, how much danfos have taken, what the union
  will do); the budget shows "Lane enforcement". A strike: announced ("STRIKE DAY N", amber
  tag; a toast saying how to call it off), on (red), then "struck day N · ₦X" for 5 days --
  on the road and as a badge on the route and town cards (`strikeBadge`; a called strike's
  badge carries "Settle ₦X" and, if the lane was strict, "Relax enforcement" buttons; a strike
  that cost nothing reads "no loss to you"); "Lost to strikes
  (estimated)" under the budget's net; at 4× the game pauses when one is called or begins
  (P, `pauseOnStrike`). The BRT tool (X) appears once a lane exists; BRT buses draw longer.
  The town card's "road is full" line says when a corridor is too thin for a lane, and offers
  "Save for it: ₦X" when the next rung is out of reach (`saveButton`); a named project shows
  at the top of the budget ("Saving for ... safe until day N", a progress bar of what's set
  aside against the price, "Drop it").
- **Retiring (Revision 2)** — a Corridors row of a road that's yours carries "Retire"
  (its consequences in the tooltip); retired, "Retired day N · gone day M · Restore ₦X". A
  retired road draws faded and dashed, nothing else on it. The Track preview between a retired
  road's towns reads "Track on the retired road ₦X · its earthworks are done; the road goes";
  a road gone is a toast naming the vehicles sold and the refund.
- **Truckers (Revision 2)** — a trucker's lorry draws brown with a yellow cab and the
  informal outline (`drawInformal`, mode `truck`); the budget adds "Loading levies (touts kept
  ₦X)"; a quarry's buyer bars show yours in brown and the truckers' in yellow; the goods line
  says "Truckers take what you don't on short hauls; the rest spoils."
- **Industries (Revision 2)** — a site draws as a brown square with a peak (`drawIndustry`),
  its name, "stone · 100 t/day" and "no road" while cut off; a closed one is a ruin "(closed)".
  Its card (`renderIndustry`): opened and works-out days, its buyers with tonnes a day and a
  delivered bar, and the problem (no road -- from the nearest connected town; or nothing
  moving and the day it closes). Opening and closing are toasts naming the buyers or the
  reason. A town's goods line adds the stone it gets ("40 t/day of stone from Ilaro Quarry
  (35% delivered)").
- **Problems named (Revision 2, step 1)** — the town card's last problem line is
  `townNoSeat`: "212 of its trips a day find no seat, most toward Ikire on the Ikire–Ado road.
  **Add a bus to Ikire ↔ Ido (+)** · ₦500" (`moveText`: the move named and priced, never a
  buy button). A shrinking town's growth line becomes a "Why it's shrinking" callout
  (`shrinkCause`) with its move. The Corridors section lists corridors with no seat first
  (≥ 20 a day), worst first, each with "No seat N/day, most A ↔ B: <move>". The map draws
  each such corridor's no seat as a grey band beside the road, 2-12 px by trips a day
  (`drawNoSeat`, `strokeOffset`: offset along the polyline's normals; cached once a sim
  second).
- **Wear per corridor (Revision 2)** — `wearLine` under each Corridors row (`corridorWear`):
  kept up and its cost a day with "Stop", or its state ("Sound" / "Worn: N% speed · costs
  your vehicles ₦X/day") with "Keep it up ₦U/day" (`setRoadMaintained`, whole road) and "Fix
  now ₦R" (`fixRoadNow`). The town card's problem line names a worn road your vehicles pay
  for (`wornRoadAt`) before its no seat.
- **Corridors (R1 6)** — `corridorsHtml`, between the route cards and the budget: each
  corridor you run along, taken ones first, with a you / informal / stayed home bar, "You N% ·
  informal N%", the levies lost a day and, if laned, the last strike's cost (or "no pushback
  without a lane" once taken); a blue "Taken, day N" pill, else "Taken at 40%". Taking and
  losing one is a toast and, for `CORRIDOR_TAG_DAYS` (3), a tag a third of the way along it
  on the map: blue TAKEN or grey LOST (`corridorChanges`, `drawTakenLabels`; the middle is
  where roadside towns and strike tags sit). A change, not a state: tagging every taken
  corridor for good put ~17 tags on a day-300 map, some over town names (playtest, R1 4-6).
  Map tags draw centred text inside `ctx.save()`/`restore()`, and `drawLabel` sets its own
  alignment: the TAKEN tag's leaked `textAlign = "center"` once drew the price label's text
  half its width left of its box (playtest).
- **The treasury, visible (R1 4)** — inside the budget breakdown, no panel of its own:
  "Treasury took, day N" under the net (the last remittance; under it, like "Lost to
  strikes", since it isn't a running cost); then the countdown, "About ₦X over the reserve
  goes to the treasury in N days; spend it or set it aside" (`remittanceExpected`: the period
  carried to its end at the strip's 5-day net -- the amount so far named ₦17 on day 11 of a
  period that took ₦8,383); then the rule in one line. Each period's end is a toast naming
  the amount (the `remitted` event; "took nothing" when there was no surplus).
- **Developer start:** `?dev=1&funds=20000` sets the starting funds, to reach a late rung in a
  minute for checks and screenshots.
- **Hints** (`hints.ts`, no DOM; `renderHint` every frame): the brief's six, one at a time,
  each latched by the game's state, shown lowest first, dismissed by doing the thing (a
  hover; a route of yours; a road; a vehicle added; funds back or a sale; a day passing for
  the toll hint), skipped if already done when its turn comes. A hint about a town sits
  beside it on the map; × closes it; "Hints off" (or `H`) is remembered in localStorage.

- **`render.ts`** draws, back to front: ground and terrain (water cells, hills shaded by height,
  cached in an offscreen canvas per view since terrain never changes), roads along their
  corridor polylines (dashed tan = inherited dirt, solid grey = built; a bridge deck under
  every stretch over water), route lines, traffic casings and vehicles all along the same
  polylines (`edgeLine`), one coloured line per route (offset per route so shared roads show both),
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
- **Inside towns** — the town panel's dashed, neutral "Inside <town>" block (`insideText`):
  its short trips, all keke and okada, "not counted against you", and how many of your riders
  they carry to and from your buses. Neutral, not the red callout: it isn't a problem to fix.
  The strip's share bar and the town's share line say "between towns".
- **Cut-off towns** — a trip with no road between its towns draws dashed (`TripSummary.reachable`);
  a town no road reaches (`isCutOff`) is labelled "no road" on the map, and its panel opens
  with a sentence naming the biggest trip as the road to build.
- **Route rows** show income/cost/net, a stacked bar of where the route's riders went
  (you / poached / gave up → danfo / stayed home), and `diagnoseRoute`'s verdict as one
  sentence with the lever that would change it. Build previews carry the trip's
  riders/day alongside the price.
- **Traffic** — a road below 90% of free speed draws a casing under it, amber then red
  as it slows, from the same `segmentSpeed` that slows the buses. Route rows report their
  buses' speed, and a jammed route says how much of the traffic is informal.
- **Interchanges** — a town where at least 3 riders/day change buses draws with a second,
  inner outline (the Mini Metro convention), and its panel says how many change there.
- **Town events** arrive from `gameTick` and show as a longer toast. Ruins (abandoned
  emergent towns) draw as a grey dot with the name in italics.
- **Toolbar** — captioned groups (`renderToolbar`'s `group`): On roads (Bus, Lorry; tan),
  On rail (Train, Freight; dark), Build (Road, Track), Line (road, track) — a
  Cheapest | Straight switch, not a tool — Upkeep (Fix), Time. Every vehicle preview keeps
  its price on refusal (`refusedOr`); short of money it keeps the whole preview, the route
  drawn (`shownPath`), and says what you have. Refusal toasts carry the price.
- **Alignment** — `A` (or the toolbar's Cheapest | Straight switch) switches the Road and Track
  tools between the cheapest alignment and the straight line; the preview names the other
  one's price and length ("straight ₦852, 20% shorter (A)").
- **Road preview** — the ghost draws the planned road itself, bends and all, and its label
  says what the price is made of: "Road ₦581 (bridge 4 cells ₦315, bends round: 10% longer
  trip)" (principles §1: a quote must say why). It flips left rather than run under the panel.
- **Rail** — track draws as a dark rail line with sleepers across it (width and surface, not
  hue — principles §3); derelict track faded, dashed, sleepers missing. Trains draw long
  and dark with their route's colour along the side, filled by load; `edgeLine` takes the
  network (`routingFor`) so trains, their route lines and the Train ghost follow track. The
  Track tool (`K`) previews restoring the old line ("built for export: it stops nowhere
  between") or new track (planned line, why it costs what it does); the Train tool (`T`)
  counts riders along the track path. Train rows read "by rail", "1 train", and their
  reasons are the bus reasons with the vehicle renamed (`forVehicle`). The toolbar (nine
  tools) sits right of the key, left of the side panel; the key is 11px and five lines.
  Worn track cracks like a road; kept track draws on a pale bed under its sleepers (a centre
  line vanished inside the rail at normal zoom). The Fix tool hovers and keeps track too
  ("Track Ilase – Ipaja · … trains at N% speed"), never disused track.
- **Freight trains** — the Freight tool (`G`) previews the goods along the *track* each way and
  draws the track path; freight trains draw as a dark engine and three brown wagons filling
  by load; their rows sit with the lorries under "Your goods", "by rail", reasons renamed
  (`forGoodsVehicle`). With ten tools the key is a `<details>` panel, open when the window is
  ≥ 1560px wide, else a "Key" button; opened where it would run under the toolbar, it sits
  above it. `resize()` measures the toolbar and the open key (`getClientRects`, since both
  are `position: fixed`) and re-fits the map above whichever reaches higher, on resize and on
  the key's `toggle`.
- **Lorries** — the Lorry tool (`L`) buys a lorry for a route like the Bus tool; its ghost
  says the goods along it each way ("25 t/day out, 50 back") and draws its road. Lorries
  draw longer than buses, brown, with a cab, filled by load; their routes as a brown dashed
  line. The routes panel lists them after the buses ("Your lorries"), each with a
  delivered/spoiled bar, a one-line reason, and tonnes each way; the town panel adds what
  goods leave and arrive and how much is delivered.
- **Through-routes** — a thin route's reason leads with `throughText` ("Run it through: a bus
  Ilase ↔ Ikole (via Kuto) reaches ₦…/day of trips, against ₦… on this one"), and the money
  note offers it beside selling. The bus ghost counts `demandAlong` ("N riders/day want
  trips along it") and draws its road path (`Ghost.path`, via `edgeLine`), not a straight
  line between the two towns.
- **Money note** — in debt or under a week from it, the routes panel opens with a red
  callout (`moneyNote`): the situation (spending blocked, billing continues), then the exit —
  losing routes with their loss and resale, and the total refund and daily saving; or road
  upkeep to drop; or, if every route pays, how long the debt takes to clear.
- **Growth** — a town's circle already scales with √population; a ▲ (green) or ▼ beside its
  population says which way it's heading (`growthTrend`: target more than 5% of the town's
  *starting* size away; the panel's "growing/shrinking/steady" uses the same rule). The town panel says why:
  heading, service (yours + informal at half), the cap — or that it needs 10% of its trips
  from you, or that no road reaches it. `fitView` takes a bottom inset so the map clears the
  key and toolbar (Ise's label sat under the key before).
- **Wear** — a worn road draws cracks across it, closer together the worse it is; a
  maintained one a white dashed centre line instead. The Fix tool (`F`) hit-tests roads
  (`roadAt`, 10px), highlights the one under the cursor and labels it with its condition,
  the speed it allows and its upkeep; a click toggles maintenance (toast: what the repair
  cost, upkeep a day). A route's `worn` reason names its worn roads and their upkeep.
  Route rows' cost is still buses only; upkeep is per road, and shows in the strip's net/day.
- **`main.ts`** — three tools (Bus `B`, Road `R`, Fix `F`): Bus and Road click a town, then another. The Road tool
  on two towns a dirt road already joins paves it instead (ghost: "Pave ₦… · carries 1.7×
  the traffic"); a jammed route on dirt names the roads to pave. Shift keeps
  the first town selected. Refusals come back as `reason` strings from `engine/game`
  and show as a toast; the ghost previews the same `check*` result and `roadCost` before
  you click. The strip and panel are slice zero's (above). The routes panel is worst-first with
  +/− per route; a "healthy" route that loses money says its riders don't fill its buses
  instead of "earning well". Speed: Space pauses, 1/2/3 give 1×/2×/4×.
- **`map.ts`** — the hand-made map as a TS constant, not yet content JSON (it moves to
  `public/content/` once the loop survives a playtest).

### Results and naming (legibility, track 1)

- Every action in the page goes through `act()` → `receipts.perform`, with a label the
  player would use ("a 3rd bus on Ilase ↔ Owode", "paving Owode – Ado"). The routes panel
  opens with **Results**: what's being measured and the day its result is due, then the
  latest three receipts as one sentence each (money first, then who it moved), green or red.
  A finished receipt also shows as an 8-second toast.
- Roads are named by their end towns even when roadside towns have split them; the Fix
  tool's hover shows the whole road's worst piece and total upkeep.
- **Halts** — with the Track tool, clicking a town twice builds a halt where a line passes
  it; back over the selected town, the preview offers it with distance and price. The town
  panel names the passing line and how to build the halt.
- **Forecasts** — `src/game/forecast.worker.ts` runs `forecast` off the frame. Every build
  preview and the Fix hover asks for one; the label grows a second line ("Forecasting the
  next two days…", then the money, payback and biggest share move, green/red/grey). Cached by
  action, game day and an action counter that every `act()` bumps; only the latest request
  waits in the queue.
- *Results, forecasts, Best next moves and the forecast click are the developer view's
  (`?dev=1`) since slice zero step 8.*
- **Best next moves** — the routes panel opens (after any debt note) with a ranked list:
  candidates are one more vehicle on each bus/minibus route and new buses and minibuses on
  every road-connected pair (most trips-along first), forecast by a pool of up to three
  workers (separate from the hover worker), refreshed every three game days and after any
  action. Top four by money per day, each with a Buy button that goes through `act()`.
- **Forecast in the click** — the preview line is green or red once its forecast lands, and a
  move forecast to lose over ₦5/day needs a second click on the same town (`actionFor` maps
  the tool and towns to the same action the preview forecast).
- **Minibus tool** (M) under On roads; minibuses draw smaller than buses; route rows,
  reasons and receipts name them ("2 minibuses", "Another minibus on …").

### The map layer (2026-10-23): the information lab's map, ported

`render.ts` is the lab's map (`info-lab.html`) on live state, as agreed -- not the lab's rules
layered onto the old map (a first build did that, and kept the old map's look: the user, "this
was not what you showed in the lab"). Roads by traffic (width by `roadFlowEMA` / `roadCapacity`,
grey/orange/red by speed) with a white edge; your service as one blue line along them, as wide
as your riders (`yourRidersOnRoads`); the other side as bands beside each road (yellow informal,
brown trucks; `otherSideOnRoads`, rolled frame to frame) and its vehicles drawn on top only when
there's room (below 4x, or zoomed in to 2x); your vehicles as the lab's pills, filled as full as
they run; towns as the lab's (a share ring, name, size and trend, an amber `!` on towns you serve
with a problem); sites as squares named on hover; the lab's terrain (a smoothed wash of water and
hills -- since 2026-10-23 the water drawn from the map's own river and sea lines,
`world.waterLines`, smooth at any zoom, and the hills in relief lit from the north-west with five
contours to the highest: the cells' staircase and a grey wash didn't read on the region). Names
go to the biggest towns first where they clear the ones placed (`labelledTowns`), so zoomed out
over the region they don't sit on each other. One overlay at a time (`Overlay`: demand, no seat, the informal share, the 25 biggest goods
flows), cached a sim second. Focus (`focusOf`) fades what isn't part of the hovered town or route;
zoom and pan in `main.ts`, with marks growing by the square root of the zoom (`growOf`).

**Kept from the old map, in the lab's style** (the lab had no need to show them): the build
preview and its price label, the fix tool's road, strike and TAKEN/LOST tags, wardens, the
yard/park/metro marks, emptied towns, rail track. **Gone from the map** (the cards, the overlays
and the log carry them): per-route colours (the routes list keeps a swatch each), surface dashes,
cracks and centre lines, bridge decks, ground names (contours came back with the region's relief), waiting dots, fuel cans,
milestone tags, desire lines (the Demand overlay replaces them).

### The screen (2026-10-23): the information lab's strip, log, panel and revenue screen

`screen.ts` is the rest of the lab (`info-lab.html`), ported whole on the live game. The lab
read a saved run; the screen reads the world now and the days the run recorder keeps
(`recorder.file.days`, plus `recorder.pending` for today's events), so its charts are the same
data the lab drew. The page is the lab's layout: the strip on top, the log left (`--left`), the
panel right (`--right`), the map fitted between them (`fitView`'s left and right insets).

- **The strip**: day and map (New map, Save run), then trips made, your riders, no seat, net
  and money, each with its change over ten days and a 30-day sparkline; Revenue opens the
  revenue screen.
- **The log**: the run's events as lines, filterable, a click shows the town or site it's about.
  Redrawn only when an event arrives -- a redraw under the pointer swallows a click.
- **The panel**: Routes, Towns, Sites tabs that sort by column, or one thing picked -- a row, a
  log line, a town pointed at on the map (it stays when the pointer leaves for the panel; not
  mid-build), a road clicked with nothing else under it. Each has the lab's tiles, a chart
  over the days, and one problem line. Its button is real: a named move (`problems.ts`) is
  bought (`data-named`), a route's is add or sell, the rest pick the tool that does it
  (`data-tool`). A row hovered, or a thing picked from the panel, focuses the map; a town
  shown because you pointed at it doesn't fade the map.
- **"More"**: the old cards, whole, under a fold that stays open across redraws -- the town or
  site card (trips, parks, metro, strikes, production, expand, restore), the route card, the
  routes wing's rest (lorries, corridors, your share), and the Treasury drawer as a card on the
  revenue screen (bonds, the named project, chains). Their buttons go through `onPanelClick`
  as before: nothing the old cards could do was lost.
- **The revenue screen**: the lab's -- heroes, income and costs stacked, what the treasury
  took, net and money, totals since day 1, the routes table -- plus the treasury card.
  Esc closes it.

### Icons (2026-10-23): towns by tier, sites by glyph

`icons.ts` is the icon set agreed in the information lab (its icon sheet), drawn on canvas with
no data, shared by the game (`render.ts`) and the lab. **Towns by tier** (`tierOf`): a village
(under 15k) a small dot with a thin ring, named only zoomed in to 2x or pointed at; a town the
lab's ring; a regional town (45k+) a heavier rim and a bold name; the region's biggest town, the
city, a second outer ring. **Sites** as a rounded tile with a glyph (`GLYPHS`): the glyph says
what it is, the colour which family of chain -- energy, building, food and crops, trade; four
colours checked for colour-blind separation, never colour alone. Solid working, hollow with a
dashed rim idle (making under half a tonne a day), an amber corner held back (under 60% of
capacity). **Badges**: the port's anchor always; a farm town's furrows zoomed in or pointed at
(most small towns farm: a badge on each at fit was clutter). The sheet already draws the chains
agreed next (steel, palm oil, cotton, cattle, cocoa, coal, general cargo).

