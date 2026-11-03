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

**Goods in legs, shown (2026-10-29; brief, The gateways, 4).** Relayed goods were invisible
between the source and the town -- the map 949 playtest's "they don't get there". Three
views, each reading the engine's own plan (haulage.ts), never a second one:
- The Goods overlay (render.ts) draws cement, steel and fuel by their legs (`nextStop` from
  the source until the town), shared legs added together, so a relay town shows as a hub;
  everything else as before, source to town.
- A town's card (screen.ts `onTheWayHtml`, from `goodsOnTheWay`): "On the way: 17 t of cement
  from Ikire Cement, 3 legs, waiting at Igboho and Ikire".
- The Yard tool's label (main.ts `yardBrings`, from `yardWouldBring`, memoised a town a day):
  the towns a yard here would bring cement, steel or fuel to that no chain of legs reaches now
  ("cement and steel to Ilora, Ipetu, Iseyin (+7)"), else how many it would get there in
  fewer legs; else, as before, what waits here within its reach.

**The cards point at the map (2026-10-30, from the map 949 playtest).** A card's tool button
carries the places it's about (`data-at`, on the button from `carryWhy` or on its Waiting-on-you
card); pressed, `pointAt` (main.ts) frames them (zoom up to 3x, never out past the whole map) and
`DrawState.pointed` rings each, steady, for five seconds (render.ts `drawPointedRing`; look.md §7).
**Names that don't pile up:** `labelledTowns` counts the town picked in the panel (`focusTown`)
as lit, so it's always named (map 949's Saki, picked from the list, wasn't); a site's name, zoomed
in, and a ruin's "(closed)" -- zoomed in only, drawn after every living place -- go only where
they clear the names already placed (`labelBoxes`); a pointed-at site always.
**Smaller:** the town card's pager reads "12 of 44" (a dot a place outgrew the panel); the strip's
No seat opens its overlay (`data-show-overlay`); a Waiting-on-you item 10 days old or more says
how long it has stood (screen.ts `waitingSince`, keyed by its text to the first colon, numbers
left out, forgotten when it goes).

**The correspondent (2026-10-30; brief, Revision 5, step 4 rebuilt).** `src/game/correspondent.ts`:
pure functions over the world, no DOM, so the tests run every template. The Permanent Secretary's
name (by region, from a hash of the map's towns) and how many he's written before (three to six)
come from the map; his stance (`correct`, `behind`, `doubtful`, `finished`) from the term
records -- nothing saved. `handoverNote`: three paragraphs, each clause read from the seed (the
longest old line's ends, cargo by region, its stations by kind; the fords; the home chairman; an
idle works or refinery and a town no road reaches) plus the two named constants. `termLetter`: a
kept or missed pledge each (kind and town from `TermRecord.keptKeys`/`missedKeys`, the town's
people then and now from `towns`), the road it filled (`roadFull`, from term 2), the union
(the memory this term moved his chairman most, its figures in brackets dropped), the rains
(`FloodState.risen`), paved road against last term (`pavedCells`) -- at most three, by weight;
the replacement letter alone when he's finished with you. **C32** is `notATutorial`, a check on
the grammar of an instruction (a key in brackets, the controls' names, a price, an imperative),
asserted over every template on five seeds and every stance. The verdict screen's `handover`
mode opens on day 1 before the pledges, once a map (`localStorage`, `game:handover:{seed}`), and
from "Your record" any time; a term's letter heads its verdict (`.letter`, `--letter-font`).
**Then and now** (`src/game/thenandnow.ts`), beside a term's letter: an SVG of the region -- the
rivers; the inherited roads and old line as found (`provenance === "inherited"`, kept by every split),
faint; what you built and paved, and track running, over them; each town's dot now with its day-1
ring (`world.startPopulation`) on top, red and dashed where it shrank; the letter's towns
(`TermRecord.towns`) pinned, labelled on the side with room. Read off today's map, nothing stored.

**The look, steps 1-3 (2026-10-30; look.md):** the palette in `tokens.css` (ink-and-cream chrome, the
signal colours, the dark river, the four chains' tokens `FAMILY_COLOR` reads); the Board layout in
`index.html` (`#controls-col`: `#mapctl` zoom and 3D, `#overlays`, `#log`, `#key` a closed chip;
`#panel-col`: `#hint` inline, `#panel`; `#toolbar` docked) with the strip in ink, three numbers, the
term's pledges in the panel (screen.ts `pledgesHtml`), "your riders" and "no seat" on Revenue;
`controls.css`'s four button roles (quiet by default, `primary`, `on`/`active`, `tool`) with keys in
`<kbd>` (`toolButton` lets them through its escaping); font sizes as `--fs-*`, spacing as `--sp-*`,
radii as `--radius`/`--radius-control`.

**The chain strip and the recipe card (2026-10-30; brief, Chains: convergent).** On a site's panel,
above its problem line. The strip (screen.ts `chainStripHtml`, from production.ts `siteChain`): each
input as a box with where it comes from and its share, two inputs stacked as a fork into the site's
box, then what it makes and where that goes (the assembly plant's: your buses, at today's
discount); exactly one box marked broken -- the binding input, else an output mostly not getting away.
The recipe card (`recipeHtml`): a row and bar per input, arriving against what full output takes, the
binding one marked (`SiteProduction.binding`); for it, where it's stuck, source by source -- tonnes
waiting at the source's yard, on the way and where (`goodsOnTheWay`), or the gap no haulier crosses
(`haulBreak`); then what it makes against capacity, and how much gets away. The map says where, the
card says why.

**The site see-through, redrawn (2026-11-01; seethrough.ts `siteFigure`).** The first drawing (an
isometric box, pipes and lanes in a 360-wide view squeezed to the panel, its words ~9 px) "looked
like shit"; of three redrawings in a lab -- flow bands (a Sankey), the process column, a transit line
-- you liked the first two, and this is them together. Read down the panel as the goods move: each
input a bar filled to what arrives of what the plant could use, flowing down into the plant as a band
as thick as it arrives; the plant a dial (amber when an input or the shift holds it back, green at
capacity), its tonnes against capacity, its shift; a trunk out of the plant and a branch to each
town as thick as its share of the tonnes sent (up to five, then "and N more"), each running on along
its town's row as far as it's carried, the rest a track -- amber where it waits for hauliers, red and
dotted where no road or tanker reaches. One SVG at the panel's width (290 units), so the words are
the page's own sizes. Same `FigureData` from screen.ts; `kind` no longer drawn.

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
- **Rail lines' cards** (2026-11-02; on both line cards under their tiles since the network,
  2026-11-03, the `cars` hook): a passenger line's card and a freight line's card say how
  long their trains run ("2 of 4 cars a train, 160 seats each") with "+ carriage" or "+ wagon" and
  its price for every train on the line (`carsRow`, rail.ts `addCar`): each car's seats or tonnes
  and running cost, and "no more room on the track". The Train and Freight previews say a line's
  room by passes ("34 of 40 passes a day on its busiest stretch", `LineRoom.text`), and a full line
  refuses with what this train would add, pointing at longer trains.
- **The time controls say the speed the device manages** (2026-11-02): while the game can't step
  within its 10 ms a frame (index.md, The tick loop), the active speed reads "4× (2.7×)",
  refreshed only when that changes by a tenth, so the toolbar isn't rebuilt every frame.
- **Site production** (`production.ts siteProduction`; `main.ts productionHtml`,
  `siteProblem`): every site card opens with what it makes against capacity, each input
  against what full output takes, its shift, and the share carried away, a gauge each, the
  binding one marked "holding it back"; with no more pressing problem, the bottleneck is "The
  problem here" (short of its input, naming where from; or most of it waiting). On the map, a
  gauge under each site's square (green ≥80%, amber ≥40%, red below; grey idle). Under the
  gauges, a site in a power station's reach says what the grid adds or would (`powerHtml`); the
  station and its coal mine have their own card (`renderPowerSite`), the station's restore in
  "The problem here" while it's idle; once working with no line from the coal, "Save for the coal
  line" (a named freight-line project, project.ts) and its price, or why your remit refuses it. The map
  passes `goodsFlows` in once a frame (playtest, map 2411: "we need indications for the
  factories in terms of production"). **Keep passing it:** `siteProduction` works the flows
  out itself when not handed them, and the site icons' redraw had dropped the argument -- on
  map 2418 at 4x, `drawSite` was then 15% of the page's main-thread time and the 2D map
  stuttered (p99 frame 50 ms; 17.6 ms with it back, 2026-10-28).
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
flows), cached a sim second. Under an overlay the roads and vehicles drop to 20%
(`OVERLAY_BACKDROP`), so the overlay is what you see, and `#overlay-caption` under the mode buttons
gives its headline in a line (`overlayCaption`: the total and the biggest mark by name; on No
seat, the move for the worst pair), read twice a second. The hint box sits top-left under the
mode bar, not in the map's middle over the network it explains (outside review, 2026-10-26). Focus (`focusOf`, and `focusFor` for the 3D view) fades what isn't part of the hovered town or route;
zoom and pan in `main.ts`, with marks growing by the square root of the zoom (`growOf`).

**The 3D view's focus** (`view3d.ts`, 2026-10-26). The 2D map's focus (`focusFor`) is passed to
`View3D.frame` as well. A selected town's or route's roads and track carry a line in your colour
down their middle (2.2 m; `focusLine`, made the first time a road is lit), the rest fade a little
toward the ground's pale -- until 2026-10-28 the roads themselves were recoloured and lit, 7.5-10 m
of glowing blue that covered the map round a selection and hid each road's traffic colour; a thin pulsing ring marks the selected town's
built-up heart; the names of the towns it connects to stay up whatever the zoom; and the camera
glides over to a newly selected place, keeping its angle (a drag of yours stops the glide).
Recoloured when the focus changes and on the roads' half-second recolour. From the outside
review: selecting a place should show what it's connected to, or 3D is scenery.

**Layers, both views** (2026-11-03, your "toggle just roads/rails in 2d or 3d"). Under the overlay
buttons, "Roads and rail · Roads · Rail" (`Network`, render.ts): the 2D map leaves the other off
(`drawRoads` filters its segments and junction plates, `drawVehicles` its vehicles by
`railVehicles`, the wardens go with the roads); in 3D the same (`Built.layers`: each road or
track mesh by its `rail`, level crossings only with both, each fleet by kind, the laterite dust
with the roads). In 3D a Scenery button as well: the trees (`groves`), rocks, hamlets, reeds,
filling stations and clouds off, so the network reads through the land; towns, sites, water and
people stay -- they're the game. The overlays are both views' now: in 3D each mark
(`overlayMarks`, exported from render.ts, the 2D map's own) an arc over the land town to town,
its top about a seventh of its span up (an Informal share corridor lower), as thick as its value, in
its colour, unlit and through the haze; rebuilt when the marks are (once a second). The caption
under the buttons shows in 3D too.

**Click anything in 3D** (2026-11-03; `Built.pickAt`, `Pick3D`). The 3D view was watch-only but
for towns and sites; a click now picks, smallest first: a vehicle drawn within 12 px (its line's
card; a danfo's or hauliers' truck, the road it's on), a town's or site's buildings (or its
label), then the road or track nearest where the ray meets the land, within 12 px' worth --
each opening the card the 2D map would (`screen.select`). Only what's showing (the layers) can be
picked, and the pointer says when something under it can be.

**Pipelines on the screen** (2026-11-03; engine.md, Pipelines). The Pipe tool (<kbd>I</kbd>, under
Build): a fuel source and a town, either first; its preview the road it's laid beside, its price,
the fuel going its way now (`pipeWouldCarry`). On the 2D map (`drawPipes`) a fuel-red line
`PIPE_SIDE` (0.9 cells) beside its road, light dashes drifting along it while fuel flows, dashed
when shut, dotted grey when broken; heavier when its card is open; a click on it opens its card
(`pipeAt`, before the road's). Its card: the dial in tenths (− / +), through it of its cap and of
what goes its way, the share of a fleet its tankers are, lost on the way and its upkeep; the union
that loads its tankers and what the dial does to him; the trap in a line; keep it up or not;
restore the inherited one. The Network tab lists the pipelines under the lines; a shut pipe is a
Waiting-on-you item; a union's pipeline demand offers "Turn the pipe down" as its concession. In
3D a steel pipe on supports beside its road (rust and gaps where it's broken), a pumping station
at its source; clicking it opens its card.

**Stations and trains in their parts** (2026-11-03, `stations3d.ts`; your playtest, map 8703 day
482: Otido's six lines and its freight in one heap in the town's middle). The game's trains have no
platforms -- every line's track runs to its town's node, and a train loads the moment it's there
(no dwell) -- so drawn as they ran, a hub's trains met at one point. Now each rail town (a site's
track is its own) has a station laid out from the network (`layStations`): its axis the way most
of its track runs (angles doubled, so in and out count alike); a platform track for each line
through it, ordered so each comes in on the side its track arrives from, passenger lines in pairs
round island platforms, freight on loops outside them; its platforms 68-104 m by the town's size
(kept from its first drawing, `halfFor`); its centre on the node or beside it, wherever the
fewest roads cross it, nothing's in the way (water, a site's yard, the quay) and its lines' throats
run shortest (an offset station's far-side lines crossed the whole town to reach it). The open
line stops a throat's length out (`reachAlong`, the segment trimmed in `syncRoads`), and each
line's throat curves in from there to its own track (`throatLine`, a cubic from the line's own
heading to the platform's). A train is drawn in its pieces -- the engine, then each car
(`carsOn`, `LOCO_LENGTH`, `CAR_LENGTH`), every one a set distance back along the path it came,
round the throat and down its own platform (`railPoint`, `onStation`) -- so a hub's trains fan out
and stand side by side, and a four-car train is as long as it is. The station itself
(`buildStation`): ballast, sleepers and rails on every platform track and throat (no telegraph
poles inside), island platforms a metre up with yellow edges, white canopies on posts, benches,
lamps and name boards; a footbridge across every track with steps down to each platform; the
building on its own platform, two floors and a clock tower, its forecourt toward the town; a goods
shed beside the freight loops; a buffer stop where a line ends. Where a road still crosses (a
town's middle hemmed in by water and sites has nowhere else), the platforms break and the road
runs through at grade. The waiting stand on the platforms (the town's waiting, `waitingAt`, split
across its islands). The town's houses keep off the station and its throats (`onStationGround`);
a town rebuilds when its station changes. The 2D map's train pills are longer by their cars.

**The 3D view's look** (2026-10-26, borrowed from two procedural-landscape films the user
pointed at, napali and procedural-alpine-lake). ACES filmic tone mapping at exposure 0.92 (1.25
washed the land pale and lost the shadows); a soft vignette as a CSS gradient over the canvas
(no post-processing pass); haze as aerial perspective, patched into three's `fog_fragment`
once -- colour drains toward grey from 0.7 × the fog's near, then the land goes to the warm
haze near and a cool blue far; and trees in groves -- a finer value noise (`grove`, 5-cell
lattice) gathers the savanna's and hills' trees into clumps with open ground between, taller
in a grove's heart, with one in thirty standing half again above the rest. The gallery forest
by the banks and the towns' trees aren't clumped.

**A town's size, as density and height** (`view3d.ts townKit`, 2026-10-28). A cell is 8 m and
towns stand 15-20 cells apart, and a town's reach is capped at its share of the gap to the
next (so a close pair don't merge into one sprawl): the capital of map 2418 (Katsina-Ala,
135k) got a radius of 88 m against the 116 it wanted, capped by Pankshin (13k) 17 cells off.
On a 10 m grid with a street every third plot that held 21 houses, ~75 buildings all told --
fewer than Kabba (95k, no near neighbour, 167), so a 135k city read as a 15k town. Spread
can't fix that; density and height do. Plots 8.5 m apart, a lane every fifth and fourth (a
city every sixth and fifth, and thinning less toward its edge); and a heart of blocks
(`House.floors`: concrete, flat-roofed, a window band a floor, a third instanced draw) inside
65% of a city's radius, 45% of a regional town's, 25% of a town's, as tall as
`1 + 0.7·√thousands` floors in the middle (135k 9, 52k 6, 20k 4), falling off linearly --
squared, the blocks that got built (the very middle is its road junction) came out 2-3
floors. After: the capital 57 houses on its grid, 20 of them blocks, and a skyline.

**A town's own streets** (`townKit`, `Street`, `streetMesh`, 2026-10-28; your word: "they don't
have internal roads showing"). The grid's lanes, drawn where a house stands on either side, one
instanced slab a plot; one-plot gaps along a lane closed and lone pieces dropped (laid only
where a house was, a 15k town's lanes came out as scattered stubs); paved in a city's or
regional town's heart, laterite elsewhere, paler and narrower than the roads between towns
and 0.2 m under them, so those still lead. Joined to the roads into town: houses stand back
from a road, so the streets between them stopped a plot or two short; a run that ends short
carries on along its lane up to three plots if that reaches a road, a town with none takes its
shortest way out up to eight, and a town whose roads run alongside its lanes (Bida, Kontagora
on map 2418) gets a spur at its own angle to the nearest road. Drawing
them showed every building had stood mirrored to its own grid: three turns about y the other
way to the grid's cos/sin, so a building faces its street at `-grid` (`facing`).

**How close, and how low** (`view3d.ts`, 2026-10-28). The camera comes no closer than 120 m
(it was 25: at street level a stall stood as big as a house and every prop read as a toy), and
the closer it is, the more it looks down -- its tilt limit runs from 65° off vertical at the
closest to 79° from ~370 m out (the first cut, 54° to 620 m, left a camera zoomed in already at its
limit: "I can't tilt") -- so close in it stays a diorama, while from further out the skyline over
the savanna is still there to tilt down to. Beside Map in 3D, buttons turn (⟲ ⟳) and tilt (▼ ▲),
eased over a few frames (`View3D.turn`, `tilt`): right-drag is awkward on a trackpad (shift-drag
turns too). Market stalls are drawn at life size
(a 3 m umbrella; at a 2.2 m radius they stood as wide as the trees).

**Labels that don't pile up** (`cullLabels`, 2026-10-28). Shown as near as each is readable
(and a selected place's connections at any distance), then placed in order -- the selected
place, its connections, city, regional town, town, village, site -- and any that would overlap
one already placed is hidden, as on the 2D map: pulled back with the capital selected, its
name, its four sites' and Lokoja's had piled into one knot. Each label's size is measured once
a text (a label not yet shown measures nothing and is estimated until it has been).

**The ground, painted** (`view3d.ts`, the land, `plant`; 2026-10-28, "the ground looks like
stickers"). The land had been coloured by vertex -- 4 m apart, so it could only change colour in
soft blobs -- and the fields laid on it as separate flat quads 0.15 m up, hard-edged, cutting
into slopes at their corners, in colours that stood off the land. Now one texture, 8 px a cell
(~2000 × 1280): the same savanna, river-green, hill and red-earth colouring worked out at 2 px a
cell and scaled up smooth (converted from three's linear colours to the canvas's sRGB -- written
as they were, the land came out dark and saturated), a grain of lighter and darker flecks, a
damp margin and pale sand along every river under its water, and the fields painted in once
they're laid, in colours a step from the savanna's with corners nudged off square and their
rows as faint furrows. One mesh, nothing floating.

**The sky and the map's edge** (2026-10-28, "look at the ledge fall off, it's not right"). A sky
dome kept round the camera: blue overhead, a warm haze at the horizon that is the fog's own colour
(a blue-grey background against a beige fog had turned the land's far end a beige wedge), and a
cool blue-grey below the horizon, round and under the map, so the warm land stands off its
backdrop. The cut edge 90 m deep (48 under a 2 km slab read as a sheet of card): grass lip,
topsoil, red laterite, sandstone, rock, shaded by side and darker with depth rather than lit -- the
face you mostly see looks south, away from the sun, and lit it sat in shadow, its bands one brown.
And the point you turn round is held over the land: a pan could carry the map off the screen.

**Day or night** (`View3D.setNight`, `Built.setNight`; the Night/Day button in 3D, kept in this
browser, 2026-10-28). Night repaints the sky dome and the fog dark, makes the sun a dim blue moon
and the hemisphere light low, lights the blocks' window bands from inside (their own material,
emissive amber), and dims by hand what's drawn unlit -- the water, the road centre lines, the cut
edge -- or it would glow. A toggle, not a clock: nothing in the game depends on the hour.

**The land by region** (`view3d.ts BIOMES`, from `world.region`; 2026-10-28). The painted ground
and the trees take the map's region: the north and north-east dry ochre with a third to a half
the trees, the south-east greener and thicker, the south-south lush (1.7× the trees), the Middle
Belt's high ground grey rock; the south-west as before. Map version 4 draws the shape (hills,
plateau, delta, lagoon); this, the look.

**Water** (`view3d.ts makeWaterMaterial`, 2026-10-29; ideas from Ultra-Water, an FFT ocean for
three.js, borrowed in this map's look rather than adopted: it renders an open ocean round a camera
at sea level, photoreal, at 3-5 ms a frame -- this is a diorama of rivers seen from 120 m up). One
shader for every river and the sea: shallow at the banks to deep mid-channel (the sea deepening
from its shore); ripples in each river's own frame (metres along it, across it), carried downstream
faster where it narrows, the sea barely drifting; a soft foam band where it meets land, broken and
drifting, never at the map's cut edge (where the sea is clamped: `aShore`); a little sky at low
angles and the sun's glint; moonlight and darker colours at night (`setWaterNight`). The ribbons
carry the frame (`ribbonGeometry`'s `water`: `aAcross`, `aAlong`, `aWidth`, `aShore`). Shaded as if
the surface faced up with the ripples on top, never from the mesh's normals -- the sea's ribbon
folds at sharp bends, and lit by its own normals the folds showed as dark slivers. Into three's fog
chunks, so the haze still falls on it. Frame times unchanged (p99 16.8 ms, 3D at 4x).

**The world's state, drawn in 3D** (2026-10-26, from an outside review's "make the systemic state
legible at a glance"). Each reads a rule the game already has; nothing new is simulated:
- **Fuel sellers.** Where a town is 35% or more short (`shortageAt`, the same threshold as the
  town card's "Roadside sellers sell fuel at a premium"), jerrycan stalls line the roads into it
  (`fuelSeller`, shapes3d.ts): a mesh a town, built the first time it's short, then shown or
  hidden by the steadied shortage (`steady.ts`, with a band under 35%); all rebuilt only when
  the roads change. A town's shortage is a sawtooth (rising until
  a tanker lands, then 0), so which towns are short changed at half the half-second checks: the
  first cut, one merged mesh rebuilt on each change, was 18% of the main thread in 3D at 4x,
  with 92 long tasks in 12 s and a p90 frame of 83 ms (17 ms after, map 2418, 2026-10-28).
- **Dust.** Behind each road vehicle on a piece worn past 45% of the way to the floor (its
  `condition`, as `roughCostFactor` reads it), three pale puffs: one instanced mesh, up to 3,000.
- **A booming town.** A town `growthTrend` calls growing gets extra market umbrellas through its
  streets (more in a city). They're placed after everything else in `townKit`, so a town switching in
  or out of growth doesn't reshuffle its houses.
- **A site at work** (2026-11-01, the fidelity list's "sites that show their state"). What a site
  gives off is a table in its kit's frame (`shapes3d.ts SITE_LIFE`): a works' stack smokes, a
  steelworks' smokes black, a refinery burns its flare (its furnace stack steams), a mill or
  flour mill steams over its silos, a silo and a quarry raise dust, an oilfield's pump jacks nod.
  Each runs as hard as `siteProduction` says the site works (made over capacity, checked twice a
  second, `goodsFlows` once for all) and stills when it stands idle: a refinery waiting to be
  restored has no flare. The smoke, steam and dust are one `THREE.Points` for the map (2,400
  puffs), moved on the graphics card; only each puff's on/off is written. Two lessons: a point's
  size must go through the projection (`projectionMatrix[1][1]` times half the drawing's height,
  over depth, as three's own points do) or it shrinks to nothing at the camera's 40° lens; and
  `smoothstep(1.0, 0.2, r)` (edges reversed) is undefined in GLSL -- ANGLE on Metal gave near-zero,
  which made the first smoke invisible. Grey on pale savanna barely shows: the puffs are near-
  opaque by the stack, lit from above (bright tops, shaded undersides).
- **Roads and track in their parts** (2026-11-02, your word: "since the vehicles look better we
  could improve the roads/rails"). A road's surface is painted in its shader (`roadSurface`, a patch
  on its material, so the traffic tint, the cloud shadows and the focus line work as before) from
  where across and how far along each point of its ribbon is (`aRoadAcross`, `aRoadAlong`): dirt is
  laterite with grain, two ruts where the wheels run and a ragged, dusty edge; paved is asphalt
  with shoulders, a white line each edge and a dashed centre (the old centre-line ribbon gone); a
  retired road goes back to grass. Its wear, the condition the game keeps, breaks it up as it
  falls: potholes, and patching on asphalt. Track (`trackParts`) is its ballast (stones, darker
  down its shoulders), sleepers across it every 1.4 m and two steel rails on them; out of service,
  the rails are rust, the sleepers grey and grass grows through the ballast in tufts. Telegraph
  poles run beside it every 46 m. Where a road crosses the track away from a town, a level
  crossing: boards over the rails, a barrier each side with its boom down, cross-buck signs. The
  track is laid after the roads, and leaves out its sleepers and grass where a road runs over it.
- **The sites in their parts** (2026-11-02, your look: "the effort put into the harbour, if you
  extend it to the rest of things they will come out better"; shapes3d.ts `site`). Each kind as the
  thing it is, in a fenced yard (light posts and rails in 6 m runs, a gatehouse and barrier): a
  refinery's tank farm in its bund, its ringed columns, flare stack, heater, pipe racks and loading
  gantry; a terminal's or depot's tanks, rack and gantry; an oilfield's pump jacks on pads,
  flowlines, separator and tanks; a quarry's or iron mine's pit (floor, two benches, spoil), its
  crusher and conveyor up to the stockpile, a dump truck and an excavator; a cement works'
  stockpile, conveyor, preheater tower, kiln on its piers, clinker shed and silos; a steelworks'
  blast furnace and stoves, ore heaps, steel shop, rolling mill and slag tip; the steel terminal's
  overhead crane and shed; a mill's silos, elevator and gallery, mill house and bagging shed; the
  motor plant's sawtooth hall, office and boiler house; a coal mine's pit as an iron mine's, dark;
  a power station's two waisted cooling towers (steaming), boiler house and tall stack, coal heaps
  and conveyor, switchyard. What changes with how it's doing: **its
  stock** (`SITE_STOCK`: sacks, a heap, steel coils, finished cars) piles up as much as it makes and
  can't get away -- `siteProduction`'s shipped share -- none while it's idle; **its lorries at the
  bay** (`SITE_BAY`: tankers or trucks), one to three as much as it ships; **the excavator** swings
  as fast as the site works. Stock and lorries are each one mesh of pieces built in order, drawn up
  to the piece wanted (`setDrawRange`), so nothing is rebuilt as they change.
  **Where a site goes** (`siteKit`; your look at the quarry: two strips of pit wall, its lorries in
  a jam). The roads into a site run to its middle, and a road through its yard drops what's on it.
  Seventeen spots within 26 m, all facing one way, rarely cleared a 54 by 42 m yard; now its pieces
  are surveyed once, dry (`SurveyKit`), and tried at 49 spots up to 46 m off, turned four ways,
  against a map of how far the roads are (2 m squares): each piece lost counts by its size, the gate
  is drawn toward where the road ends, flat ground is preferred, and the yards of sites already
  placed nearby are taken ground. The kit is built once, at the best, turned as chosen
  (`SITE_YARD`; the smoke turned with it). It's set at the mean height of the ground under its yard,
  not its town point's: moved up a hillside, a quarry had sunk its crusher and dump truck. On map
  2418 every site loses nothing to roads but the hemmed-in cement works and steel terminal. A
  compound piece -- a tank, a tower, a shed -- is kept whole or left out whole (`fits`), not a stack
  without its tower. Big pieces (the pit's floor and benches, the kiln) are built in lengths. Each
  kind's stock and bay are laid out clear of its buildings; on a road, it goes without. The towns
  build round the whole yard (`inYard`), the yard grows no trees, and its dust is a thin haze (it
  had hung over a quarry's crusher like a wall).
- **The seaport's harbour.** At the seaport city (`w.seaport`; a coast-road gateway has none) a
  jetty on piles, an apron of container stacks, gantry cranes whose booms swing, a ship moored
  alongside and more standing off on slow circles in open sea; a crane and a ship more per rung of
  `portLevel`, rebuilt when it grows. The quay is chosen once, before any town is drawn
  (`quaySpot`): the nearest coast past 0.8 of the city's reach with open sea off it and dry
  ground behind, clear of other towns and the old roads. The city's houses, streets and markets
  keep off it (`onQuay`, beside the four checks that keep them off sites), so it reads as the
  city's port district rather than a slab dropped on its outskirts. Then (2026-11-02, your look:
  "the little crane detail is good. It could be better"): a shed across the back of the apron and
  lorries queued at it (one more a rung), a rubble breakwater hooked round the jetty's open side
  (stones only where there's sea), a tug at the moored ship's bow nudging, and a wake behind each
  ship under way. A ship under way circles the nearest open sea that holds her whole circle; where
  the map's own sea is a coastal strip that may run out over the sea past its edge (the skirt) --
  only where the edge is sea -- so she's seen from the harbour looking out though the camera can't
  centre on her there. Her bow now leads along her circle (it had been crabbing).
- **Lakes, deep and to scale** (2026-11-02, your look: "cool pond ... the scale makes it hard to
  tell"; it read pale as ice). Water deepens over its own distance from the shore (`aDeep`): a
  river a third of its width, the sea ninety metres, a lake its own size -- at the sea's ninety a
  lake a few cells across never got past its shallows. And things whose size you know
  (`buildLakes`, shapes3d.ts): reeds in stands on the wet bank, a fishing jetty on stilts from the
  shore nearest a town or hamlet with its thatched hut and drying racks, a dugout or two with a
  fisherman drifting on the open water.
- **Your remit, veiled** (2026-11-02; remit.ts, as the 2D map's `closedCanvas`). Land outside your
  remit is faded toward the haze and drawn out of colour -- there and running, not yours to build in
  yet -- with a fine dashed line on the ground where your remit ends; its towns, sites and roads
  stay sharp (they run, and the inherited roads are yours to use), its towns' names quieter
  (`.label3d.closed`). A mask the map wide (two texels a cell, softened so the line runs smooth),
  sampled in the cloud patch (`withClouds`) by the materials marked `veiled` (the land and its
  line, the skirt, the trees): red the veil as it stands, green where it settles (the line, drawn
  a couple of pixels wide at any zoom by `fwidth`). When a cluster opens its veil lifts over two
  seconds. The key that says it changed is prefixed (`open:`): no clusters open is `""`, the same
  as never worked out, and the first veil never drew.
- **People** (2026-11-01, the fidelity list's "people who show the game"; `syncPeople`). Riders at
  each of your road routes' stops: a shelter (`busShelter`, its sign in your colour) beside the
  road the route takes out of the town, 8 m off its middle on the near side (the far side where a
  railway runs along it), and in front of it a figure for every six `waitingAt` the town (up to 30,
  shared between its stops), spilling along the road as the wait grows. At your motor parks,
  passengers under the union's shelter by the informal pool waiting there (`parsePoolKey`'s `at`)
  and three touts working the rows. At each town's markets (recorded by `townKit`), shoppers by
  its size, a third more while it grows. People are one pair of instanced meshes (clothes tinted
  from `CLOTHES`, the rest as is; 3,000 at most, 1.3× life to be seen at the closest zoom), each
  moving on the graphics card by its `aWander` (a shift of the weight at a stop, a slow loop round
  the stalls); the matrices are written only when a crowd's size changes. Your motor parks,
  yards and metro entrances (`standAt`) now keep clear of the town's buildings (`builtAt`, every
  house and market `townKit` placed) as well as the quay, stepping outward till they are -- a
  town's outskirts run past its reach, and parks were landing on compounds.

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
- **The panel**: Network, Towns, Sites tabs that sort by column (Routes until 2026-11-02, see The
  network below), or one thing picked -- a row, a
  log line, a town pointed at on the map (it stays when the pointer leaves for the panel; not
  mid-build), a road clicked with nothing else under it. Each has the lab's tiles, a chart
  over the days, and one problem line. Its button is real: a named move (`problems.ts`) is
  bought (`data-named`), a route's is add or sell, the rest pick the tool that does it
  (`data-tool`). A row hovered, or a thing picked from the panel, focuses the map; a town
  shown because you pointed at it doesn't fade the map.
- **"More"**: the old cards, whole, under a fold that stays open across redraws -- the town or
  site card (trips, parks, metro, strikes, production, expand, restore), the route card, and the
  Treasury drawer as a card on the revenue screen (bonds, the named project, chains). The routes
  wing's rest (lorries, corridors, your share) went into the network and the road card
  (2026-11-02): its corridors were another style under a fold; only the developer's forecasts
  are left under the network. Their buttons go through `onPanelClick`
  as before: nothing the old cards could do was lost.
- **The revenue screen** (2026-11-02; of two tried you asked for both): the heroes, then **the
  flow** -- a day's money from where it comes (each family's takings, the allocation, levies,
  exports) to where it goes (each family's running, the treasury, what's kept); **the
  statement** -- a day's money line by line, on the strip's own days (`averageBudget`), so its
  net is the strip's to the naira; the treasury's levy, the sweep and bonds after the net, not
  in it (budget.ts: not running costs); fuel above the pump is tallied apart from running, not
  inside it -- with the net and money held beside it; **your lines** -- every line in its
  family, carried, income, cost, net, and its net as a bar from a zero line; then the stacked
  charts, totals since day 1 and the treasury card. Esc closes it.
- **Redrawn in place** (`patch.ts patchHtml`, 2026-10-28): the strip, log, panel and revenue
  screen are still built as HTML strings from the world, but applied to the elements already
  there -- text and attributes change, an element comes or goes only when the content does,
  and rows and folds are matched by their `data-pick` / `data-fold` / `data-tab` / `data-key`
  or `id`, so a row that moves is the same row. Set as `innerHTML` four times a second, every
  button was new each time: on map 2418 at 4x only 16% of the panel's elements outlived a
  redraw, and a click aimed between redraws hit nothing ("some buttons are not clickable").
  After: 100%, and 19 of 20 scripted row clicks opened their card (15 before, 4 more lost
  their row). Give a list's items a key when they can reorder.
- **Steady readings** (`steady.ts`, 2026-10-28): goods arrive in loads, so a town's fuel ran
  100% -> 72% -> 100% in a game day, a market's food fell and jumped, a mill's output came in
  lumps. The screen showed each moment: a town card's "Danfo fares here..." sentence came and
  went (its layout jumped in 26 of 59 redraws at 4x, moving buttons from under the pointer), a
  mill's ⚠ flipped at the sites list's 60%, the 3D sellers set up and packed away with each
  tanker. Fuel, food and a site's output and inputs are now shown as their average over two
  game days (`steady`; `steadyFuel`, `steadyShortage`, `steadyFood`, `steadySite`), sampled for
  every town and site at each panel redraw (`keepSteady`) so a card opened mid-swing shows the
  average; a sentence or mark that turns on at a line keeps a band below it (`steadyOver`).
  After: no layout change in 59 redraws on any list or card surveyed. **Display only:** the
  simulation still runs on the moment (fares and parked danfos follow each tanker), nothing is
  kept on the world, replays are untouched -- `production.ts`'s "carried away" was the
  pattern. A source's share is told as its part of the averaged whole: averaged apart, capped
  moment by moment, they read "75% supplied (86% imported)". Numbers that move because the
  game is moving (a worn road's repair price climbing) are left alone: steady swings, not trends.

- **Held still while you aim** (`patch.ts`, 2026-11-02; your playtest: "to click on some
  things are difficult ... between tick the information is changing"). Kept elements still
  moved: a probe sampling what's under a column of points at 10 Hz on map 2418 at 4x found the
  revenue screen's routes re-sorted under the pointer in 37 of 43 changes (half of aims on
  another row a second later), and Waiting on you's restore lines coming and going with their
  weights, moving every list and card under them. Now: under the pointer a steady redraw
  (`redrawSteadily`) changes only figures -- the HTML with its figures, charts and up/down
  colours taken out must match -- and a real change of shape waits for the pointer to leave,
  four seconds at most; tables are ranked once a game day, when you sort, or after a move
  (`sortRows`, the figures in them live); Waiting on you keeps its five through a day
  (`steadyWaiting`, items by `id`). Anything a button names by position in a list remade each
  redraw is named by what it is (a problem line's move by its action, a log line by its place in
  the whole log): a held panel shows an older redraw, and its button must still do what it says.
  After, the pointer in the panel: 96-100% of aims land on what was aimed at (88% in the routes
  list, 76% on the revenue screen before), figures still updating.

### The network (`lines.ts`, 2026-11-02)

Your playtest: "the difference between roads (corridors), routes and the trains, freight and
track ... need harmonization". Buses, minibuses, BRT and passenger trains were a table;
lorries and freight trains a table you couldn't click and older cards under More, with no card;
roads had no list (the corridors under More, a road's card only from the map), track none.

- **One record each** (`lines.ts`): a `Line` for everything you run -- family (people, goods),
  mode (road, rail), vehicles, carried a day (riders or tonnes), how full, money, verdict -- and
  a `Way` for what it runs on: a road whole between two towns (`chainOf`, which is what a
  corridor is) or a stretch of track. `waysOf` puts each line on every way its path uses.
- **The Network tab**: one table, each road or stretch of track a header row with its facts
  (surface, condition, traffic, jammed or worn, your share of its trips, taken, riders with no
  seat), the lines on it under it -- a line through three towns under each road it uses, the
  buses and lorries and trains sharing a road together. Chips narrow it to people, goods, road
  or rail; the roads and track nothing of yours runs on are listed when asked. Of three lists
  tried (one table; the four families with their trends; this), you found the table cleaner and
  the network's pairing better: this is both.
- **Cards**: a goods line has the passenger line's card, in tonnes, with its reason and freight
  rate (`goodsWhy`); a road or track's card is the whole way -- its lines, who carries its trips,
  levies lost, strikes, no seat with its move as a button, and its wear as one decision (keep it
  up, fix now, retire, restore) -- the corridor fold's content in the card's own style. Track
  doesn't wear (wear.ts is roads'), so it's never flagged worn.

### Your remit on the screen (2026-10-31; engine.md, Your remit)

- **The map:** land outside your remit under a veil -- the ground's colour at half, a shade of ink
  -- with its edge drawn where closed land meets open (`closedCanvas`, render.ts: two pixels a cell,
  drawn over the terrain, redrawn only when a cluster opens). A first cut faded only the water;
  the land read the same either side, so the shade and the edge were added.
- **Before the click:** every preview that carries a forecast (`withForecast`) asks
  `remitRefusal`, so a bus or yard aimed into a closed cluster shows its reason as the ghost's
  label, not after.
- **A closed town's card** says so as its problem line, with no button; the towns table gives it no
  ⚠ and Waiting on you counts only your remit's towns -- a shortage you can't answer isn't waiting
  on you.
- **An opening** is a Waiting on you item (weight just under the union's demands): each cluster on
  offer as a button, "Open X's cluster", with what it brings (`clusterBrings`: its towns, its
  limestone field or farm belt, the seaport's city, the old railway's far end); the log says
  the verdict granted it.

### The design console's drawer (2026-11-02; brief, Dev tools, step 1)

`src/game/devconsole.ts` and `styles/dev.css`, with `?dev=1` only: main.ts `import()`s it on
demand, so it's its own chunk and never in the entry script a player downloads
(`verify:bundle` checks both, D4) -- `?dev=1` still works on the deployed game. The `` ` `` key
opens it at the plate's top right, as `#plate-overlay`'s child (nothing fixed over the plate).
- **Moves**, each a `console` action (term.ts `consoleMove`) recorded in the run file, so a run
  with them replays (D3): end the term, rains now, offer pledges now (the uncommitted ones
  redrawn from today's problems), open a cluster now (remit.ts `grantOpening`: an opening that
  waits, chosen on Waiting on you as a verdict's is), set money.
- **Numbers:** every number or switch in `DEFAULT_GAME_TUNING`, filtered by name, the ones changed
  listed first with their default beside them; set on Enter or leaving the field. Some are read
  only at the start (the map, the clusters): setting them later changes nothing.
- **Inspect:** the panel's pick (town, site, route, road) as its raw data and what the engine
  derives from it (growth, fuel, production, cluster, remit), redrawn each second while open,
  Copy JSON for a script or a bug. Only reads. The rest of the drawer redraws only on a move, so a
  field being typed in keeps its focus.
- The term stat's three buttons it replaced now just name the key.
- **Forecasts and receipts** are a switch in the drawer, off unless turned on (D1: `?dev=1` alone
  runs nothing you didn't ask for), remembered in this browser (`dev:forecasts`). On: a move the
  toolbar previews gets a two-day forecast from a worker made at the first one, a move that would
  lose money takes a second click, and a move made gets a receipt two days on -- a shadow copy of
  the world stepped beside the real one on the frame (receipts.ts `perform`). Before 2026-11-02
  `?dev=1` did both always: a worker on load, and a shadow world per move for two days (up to
  `MAX_PENDING`), each roughly doubling the tick while it lasted. Off again: the worker is ended;
  receipts already running finish.
- **Fork from day N** (step 2): this game kept as it is, and a new save cut at the start of day
  N (runlog.ts `forkRun`: the actions before that tick, the days ended before it) opened at once
  at `?game=<id>`, replaying to there as a save from another build does. The cut tick is the
  `endTick` the day before's row keeps -- exact; worked out from the seconds it came out a tick
  short of the day, as time adds up a tick at a time. saves.ts keys a map's own game by its seed
  (as before) and a fork by its id (`saveKey`), "fork from day N" on the chooser; a fork has no
  snapshot until it's first kept.
- **What if** (step 3): "Take the game now" sends the world to a worker (`whatif.worker.ts`, made
  on the first question, never before) which keeps that copy; Ask names a change -- a tuning
  number and value, or the move the toolbar last previewed (main.ts `lastPreview`, set in
  `withForecast`) -- and a horizon, 1-30 days, 10 by default. The worker plays the copy on without
  and with it (engine.md, The what-if) and answers with a table: money at the end, net over the
  days and on the last, people, trips, your riders, goods arriving; the difference coloured;
  day by day under a fold. The run without is kept per horizon until the game is taken again, so
  a second question costs half (measured on map 2418 from day 1: 6.4 s for 3 days, then 2.4 s).
  It yields between days: a new question or Cancel ends the old at the next day. The game runs
  on meanwhile; the answer names the day it was asked about.
- **The map graph** (step 4, `whatifgraph.ts`): under an answer, "On the map: trips | goods". A
  canvas in `#plate-overlay` (no pointer: the map under it still picks) draws over the live 2D map,
  redrawn each frame while shown so it follows pan and zoom: a straight line between each pair of
  places with a trip or a tonne a day, both directions and every kind of goods as one; green where
  the change grew it, red where it shrank, width by the size of the change; faint where it moved
  less than half a unit or 2% (`moved`). A ring at a town whose people moved. A town picked on the
  map gets its people before and after and its six most changed links in the drawer. Read from the
  what-if's `end` (people by town, goods by flow, trips by pair), so nothing more is run. The 2D
  map only: in 3D it draws over nothing meaningful.
- **The systems graph** (step 5, `systems.ts`, `systemsgraph.ts`): under an answer, "the model"
  opens a panel across the plate (Close, or untick). `systems.ts` is the hand-kept chain: 15 nodes
  in columns, cause to outcome -- trips wanted, road speed, sites making goods, budget; your
  vehicles, danfos, hauliers; no seat, cement, fuel, steel, markets fed; town growth, your money;
  people -- each with what it feeds, the tuning numbers that enter there (name patterns; first
  match, NOT_DRAWN checked first) and, for most, a measure read from a world. The worker passes
  `measureSystems` to `playAhead`, which calls it on each run's last day (`end.measured`; the
  engine never imports the dev code). The change's box at the left feeds the node it enters (a
  number by `placeOf`, a move by `moveNode`); that node and all it feeds are drawn lit, the rest
  faint -- but every measured node shows without → with and the change, lit or not, so an effect
  the table doesn't link (relay off: trips wanted -1.8% though only hauliers is lit) still shows.
  D5 (test/whatif-graph.test.ts): every number in tuning.ts is placed or named as not drawn; a new
  one fails until it is. The table can still be wrong about what feeds what: it's a reading
  aid, not the engine.

### The start (2026-10-28: "it loads and shows the game but for a few seconds nothing happens")

Between the loading card going and the term's pledge card the page froze 7.1 s (map 2418). Two
causes. Opening the card names each pledge's move with its price; "Connect a town by road" took
the cheapest of `roadMoves` -- a road planned from every cut-off town to every connected one,
~180 terrain plans on the region, ~5 s. `moves.ts cheapestRoadFrom` plans from the one town,
nearest first, stopping where even a straight road at the base price per cell would cost more
than the best so far (a road is never cheaper: cost.ts), so the answer is the same (44 towns on 8
seeds: identical; 178 s of plans -> 0.15 s). And the 2D map's first frame paints its land once
(`terrainCanvas`): three arrays made a pixel to write four bytes, ~1 s; written straight in.
After: the card opens ~0.35 s after the game shows, 5.2 s from the page opening (12.8 before).

**The arrival, as one movement (2026-11-01, "onboarding/the loading screen ... better
transition").** It had been three page switches: the loading card on a blank page, gone in a
frame; then the handover note, then the pledges, each a blank full page with no map in sight. Now
the loading card rises in, and when the week has run it lifts away (`#loading.done`, removed once
faded) while the map settles in under it (`body.arriving`, a touch nearer to where it rests). The
verdict screen -- the handover note, the pledges, a term's verdict, your record -- is a card over
the map you're about to run, the page behind it dimmed (a spread shadow) and taking no clicks
(`body:has(#verdict.open)`). It rises in and fades away (`transition-behavior: allow-discrete` on
`display`, `@starting-style`); its width follows its page (`data-mode`, set by `openVerdict`: the
letter narrow, the pledges wider, the verdict widest), and a new page's content lifts in a step
at a time (`.enter`, for 0.7 s only, so a redraw within a page -- a pledge made -- doesn't replay
it). `prefers-reduced-motion` turns the movement off.

**Saved games (2026-11-01, "people might not play all at once"; `saves.ts`, main.ts `chooseStart`,
`keep`).** The game saves itself -- each game day, when you pause, when you leave the tab -- one
save a map (a new game on the same map replaces it once it has run a day), the five most recent
kept, in this browser's IndexedDB: the world (engine `snapshot.ts`) and the run's recorder (what
"Save run" writes, and the days the charts read), with a summary the card lists without opening
the world (~0.9 MB a world, ~6 ms to copy). Opening the game with a save of the address's map, or
with no map asked for and any saves, the loading card offers them first ("Term 1, day 45 · 812k
people · ₦34,000 · saved 2 hours ago") or a new map; "New map" in the strip (`?new=1`) skips the
offer. A save from this build resumes at once; from another, its run replays from day one with the
card counting ("Catching up: day 12 of 45") -- a run file replays as played. You come back paused,
told where. Storage refused (a private window): nothing is kept, nothing breaks.

### Styles and tokens (2026-10-28)

The page's CSS is in `src/game/styles/`, linked from `index.html` (not imported from
`main.ts`: a linked sheet loads before the loading card shows). `index.css` imports the
rest **in cascade order** -- tokens, base, cards, map, screen, fullscreen -- the order the
one `<style>` block had, so a later file still wins on equal selectors; a rule moved
between files can change what wins. Vite swaps an edited sheet in place: a style tweak no
longer reloads the page and its warm-up.

`tokens.css` is the one place a colour is set, named by role (`--you`, `--informal`,
`--road-busy`, `--strike`...), never by hue. The 2D map reads them (`render.ts COLORS`,
through `token()`, once at start; a missing token throws), so the canvas and the panels
can't drift apart; the info lab links the same file before its own block. Merged when the
file was made: `--player` into `--you`, `--danfo` into `--informal`, `--panel` into
`--surface` (each pair the same colour under two names), and the raw hex in the sheets and
the map named (`--on-fill`, `--bad-bg`, `--strike-ink`, `--flood`, `--map-*`...).
Checked by every element's computed style on a paused game (pledges, the lists, a town card
with More open, the revenue screen) and the screenshots' pixels: no difference.
Not tokens: the 3D buildings' paint (shapes3d.ts) and the engine's line colours
(labels.ts) are data; the key's site-family swatches mirror icons.ts.

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

