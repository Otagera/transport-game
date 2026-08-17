# Transport game — rebuild plan

A ground-up rebuild. The previous build was lost before reaching a remote. This
document exists so the rebuild starts with everything the first attempt spent
months discovering.

**Read §5 before writing any code.** It is the part that cost the most to learn
and the part most likely to be rediscovered the hard way.

---

## 1. What this is

A transport infrastructure game set in a lightly fictionalised West African
country that reads as Nigeria. The player builds roads, rail and ferries across
four historical eras, lays vehicle routes on them, and contends with an informal
paratransit system that fills every gap they leave.

### Design pillar: true, not teaching

The filter for every decision is *"is this true to how transport in this place
actually behaves?"* — not "is this fun?" (paralysing) and not "does this teach?"
(invites bolted-on lessons). Truth is also the content engine: a truthful system
generates drama nobody authored.

### The hook

**The player's planned network competes with an emergent one.** Paratransit is
not a vehicle you buy — it is a system that exists whether you like it or not,
and it fills any gap you leave. It competes for passengers *and* for road space.

This is the thing no other transport game has. Protect it. Any change that makes
informal transport a subsystem rather than an antagonist is a change in the
wrong direction.

### Spine

Building infrastructure. Everything else is subordinate:

- Power/authority is *narrative framing*, not a fantasy to be simulated.
- Politics is *terrain* — a cost or constraint on building. Never its own screen.
- Tycoon economics and puzzle optimisation are ingredients, not the spine.

### Brownfield premise

The map is never empty. The player inherits a colonial rail spine built for
export rather than for people, plus some pre-built roads. **The inherited
network's geometry being wrong for present demand is the point.** Never "fix" it.

### Governing principle for terrain

**Terrain is never ignored and never reshaped. It is overcome, and overcoming
costs.**

No terraforming. A mountain in the way is a real choice: go around, over
(elevated), or under (tunnel). Water is terrain; a bridge is how you overcome it.
Gradient limits become meaningful rather than obstructive — which is why real
railways have far more tunnels than roads do.

**Corollary, load-bearing:** the cost model must be able to say *why*. A route
quoted at 4× the direct price must break down as "1.2km viaduct · 400m tunnel",
not just a bigger number. Otherwise the choice between round, over and under is
invisible and pricing reads as arbitrary.

---

## 2. Scope

### In

**One map scale: regional.** Settlements spread across a large map, corridors
running tens of cells between them. This is the scale that felt playable.

### Out, and staying out

- **City / district scale.** Parcels, catchment, stops-as-nodes, mode choice, the
  dual demand model. Months of work that never looked right; the scale confused
  everything — a district's worth of content at a region's framing.
- **City-builder mechanics.** Zoning, land value, developer models, service
  coverage. Different genre, more crowded, and the hook stops being the hook.
- **Nested scales.** No drilling from region into city.

### The finish line — decide before starting

This was never answered last time and it is why scope kept expanding.

- *Something others play* → needs onboarding, a goal, and a stopping point.
- *A personal sandbox* → needs neither, and can stay open-ended.
- *A foundation to extract an engine from* → stop at "the systems work".

**Answer this first.** It changes what "done" means for every module below.

---

## 3. Tech stack

**Keep the stack. It was not the problem.**

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, strict | No complaint ever surfaced. Strict mode caught real bugs |
| Build | Vite | Fast, no friction, dev-server middleware was useful for the content editor |
| Render | three.js | Produced the look eventually. The problems were art direction and tooling, not the renderer |
| Game UI | Vanilla TS, DOM overlay | The no-cached-display-state discipline is what a framework's reconciliation exists to solve. Vanilla plus a `setHtml` output-memo was enough, and kept one mental model |
| Dev tooling | Preact | Forms and sliders are what frameworks are good at. Dev-only, never ships |
| Content | JSON in `public/content/` | Schema-driven, editable, worked very well |

### Refinements worth making

**Merge the content editor and the tuning panel.** Last time they were separate
tools built months apart. They are the same thing: dev-only UI over values that
change how the game looks and behaves. One tool, one boundary, one build
exclusion to verify.

**Watch draw calls and CPU cost from the start.** The old build hit 27 fps at 51
draw calls and 121k triangles, which is CPU-bound, not GPU-bound. Instance
everything repeated, merge static geometry per region, and profile before it
becomes structural.

**Optionally target `three/webgpu`.** Gets the modern backend without hand-rolling
a pipeline. Not required — WebGL is fine at this scale, and browser support is
better, which matters for the intended audience.

### Rejected

- **Raw WebGPU.** You would write culling, batching, camera, picking and text
  yourself. That is weeks of infrastructure that is not the game.
- **A framework for the game UI.** The re-derive discipline forbids the mutable
  view tree a framework exists to reconcile.
- **Physics engines (Rapier etc).** Vehicles move along corridors as progress
  values on a graph. No forces, no collisions, no rigid bodies.
- **Tile grids / dense element stacks.** Would cost the entire bottleneck and
  health signal layer, which is cheap precisely because the graph is sparse.

---

## 4. Architecture

### Hard rules — these held up under repeated audit

1. **`engine/` imports nothing from `render/`, `content/`, or three.js.** Pure
   simulation. If you find yourself importing THREE into engine, stop.
2. **Rendering reads state; it owns nothing.** Consumes snapshots, never mutates.
3. **Content is data.** Vehicles, eras, economy, scenarios live in JSON loaded at
   runtime. New content = new JSON, not new code.
4. **`Corridor` (terrain, permanent) and `BuiltInfrastructure` (sim-owned,
   mutable) stay separate.** Terrain facts describe the corridor; type, condition
   and provenance describe the built layer.
5. **Fixed timestep `SIM_DT = 1/30`, accumulator, decoupled from render.**
6. **Aggregate demand, individual vehicle agents carrying aggregate load.** Never
   per-passenger agents.
7. **No cached display state.** Every panel re-derives from the snapshot.
8. **Grid coordinates only.** No lat/long. The format must stay importable from
   real-world data later.

### Module boundaries

```
engine/          pure simulation, no DOM, no three.js
  map            generation, terrain, corridors, nodes
  pathing        terrain A*, geometry, smoothing
  simulation     tick, demand, vehicles, routing
  economy        costs, fares, eras
content/         JSON + schema + loader
render/          three.js scene, meshes, materials
ui/              DOM overlay, panels, lists
dev/             tuning panel + content editor, never ships
```

---

## 5. Findings — build these in, do not rediscover them

**This is the most valuable section in the document.** Each line cost at least one
diagnostic cycle to find, several cost weeks.

### Demand

- **Passenger demand must be reciprocal by construction.** Commuting is
  round-trip. Generating one-directional pairs and hoping reverse flows emerge
  leaves every route half-empty. Fixing this took one live route from break-even
  to strongly positive without touching a balance number.
- **Every inhabited node originates demand**, not just "significant" ones.
  Excluding villages removes rural-to-urban movement, which is the most
  characteristic flow in the setting.
- **Goods stay one-way**, with reverse flows authored separately as *different
  cargo*. Produce does not come back from market; supplies and imports go the
  other way. Mirroring goods flows is untrue and pointless.
- Demand pairs are static topology; growth scales the *rate*, not the graph.

### Vehicles and carriage

- **Conveyor model.** Vehicles physically carry aggregate `{to, from, passengers,
  goods}` entries. Throughput means *delivered*, not capacity-present.
- **Opportunistic loading, no manifests.** At each node a vehicle loads queued
  demand whose destination lies ahead on its remaining route.
- **Load entries must carry `from`**, or delivered trips cannot be attributed
  back to the origin that generated them — which growth needs.
- **Player vehicles run cyclic routes. Paratransit is one-shot.** Cyclic
  paratransit drains queues to a comfortable equilibrium and removes the pressure
  to build. Measured, not assumed.

### Paratransit

- **Cap per corridor, not only per demand pair.** Many pairs route over one
  corridor; without a corridor-level cap, 20+ informal vehicles accumulate on one
  link and collapse throughput to ~10%.
- **Gate spawning on sustained congestion**, not queue depth alone. A real
  operator does not join a jam that pays nothing.
- **Per-vehicle congestion weight.** An okada occupying the same road space as a
  bus is plainly wrong and inflates the congestion effect.
- Paratransit is **passengers-only**. Informal freight needs capital an okada
  does not. The asymmetry is deliberate and historically true.
- Paratransit **counts toward service at a discount** (~0.5) for growth purposes:
  informal service *sustains* a place, player service *develops* it.

### Congestion

- **Congestion scales effective capacity, not just speed.** Speed-only means more
  vehicles is always better and there is no puzzle.
- **Free first slot** — one vehicle on a corridor is not congested.
- Congestion is what couples informal traffic to player economics. Weak service
  invites the interference that weakens it further. **Keep this asymmetry** — it
  is the hook working — but make sure there is an exit.

### Economy

- **Fares are global per cargo kind**, not per route. A transport authority sets
  fares by policy, and it keeps demand elasticity well-defined.
- **Revenue accrues on unload**, not on carriage.
- **Operating cost is per-tick and unconditional.** Era fuel multipliers drive it,
  so the Informal-era spike bites operationally rather than only at purchase.
- **Debt allowed** — no interest, no game over. Spending blocked, billing
  continues. Hard failure is wrong for a sandbox.
- **Vehicle resale must be depreciated**, or a player in debt liquidates the
  fleet and is instantly solvent.
- **Per-def purchase costs are essential.** With one flat cost, every roster
  comparison is meaningless — capex held artificially equal. Roughly: okada 25,
  keke 75, danfo 200, bolekaja 450, lorry 550, molue 650, BRT 1600. 1 BRT ≈ 8
  danfos is a meaningful ratio.
- **`eraOut` closes the purchase catalog; owned stock keeps running.** Despawning
  a fleet at an era boundary is an unsurvivable cliff. This is graceful
  obsolescence.
- **Rising maintenance on obsolete stock** is the other half — without it nothing
  pressures replacement and era turnover never happens.

### Balance numbers (from the old build — starting points, not gospel)

- Fleet optimum was ~15 vehicles under static demand; revenue plateaued around
  the network's coverage ceiling; net went negative past ~31.
- **Route composition matters more than fleet size.** Pruning the worst 10 of 62
  routes took net/day from ₦1,164 to ₦4,443 — revenue fell 2.7%, cost fell 11.3%.
- **The failure mode is over-building past what the network reaches.** Not
  mispriced fares.

### Growth

- Growth driven by a **paratransit-discounted service ratio**, gated by a
  smoothstep on a **rolling** S̄ (never instantaneous).
- **Growth requires player service as a necessary condition**, not just a weighted
  contributor. Otherwise reachability saturates late-game and everything grows on
  informal service alone.
- **The promotion threshold must sit early in the growth curve**, not near the
  cap. The logistic term halves the rate as you approach the ceiling, so a
  threshold at ~58% of cap arrives far too late to be felt.
- `D_max` must be bounded independently of `D`, or the logistic cap chases the
  variable and growth is uncapped exponential wearing a logistic's clothing.
- Growth **must be visible without reading a number**, or it reads as a treadmill
  — queues rising faster than you can add vehicles — rather than as a place
  developing.

### Geometry and pathing

- **The A\* cost function IS the build price.** Where a system optimises against
  one function and reports or charges another, they will disagree. This was
  violated four separate times and each was a real bug.
- **One geometry representation.** Everything has a polyline, including
  straight-line corridors (a two-point polyline). Dual representations produce a
  bug class.
- **No corner cutting in A\*.** A diagonal move between two land cells whose
  shared corner is water must be disallowed, so pathing cost, water measurement
  and rendered geometry all agree.
- **Supercover DDA for all water measurement**, not endpoint or interval
  sampling, which misses corner clips.
- **Smoothing must not change corridor type.** Clamp smoothed geometry back to
  the traversable set — both vertices *and* segments — with a raw-path fallback.
- **Density is a pricing term, not a routing one** at regional scale. Measured: it
  alters ~2% of paths and junction-routing saves at most 3.3%.
- **Heading-aware A\* for rail** gives a real turning radius and makes rail feel
  different to lay.

### Nodes, chains, levels

- **A corridor is a chain of nodes.** Each node costs money. Each segment between
  two nodes is independently typed, levelled and maintained. This makes curves,
  bridges, stations and elevation fall out of one graph change rather than four
  features.
- **A `vertex` is a fourth node kind**, never named, never labelled. Separate enum
  value, not a flag on `junction`, so every switch site is a compile error until
  handled.
- **Node cost is what keeps shaping a decision rather than a flood.** The
  generator never places vertices; only the player and the water rule do.
- **Segment `level`: underground | ground | elevated.** A bridge is an elevated
  segment over water. Ship with `ground` only; the field costs nothing and its
  absence would be a refactor.
- **An elevated segment must be bank-to-bank.** A corridor-level "crosses water"
  flag raises the deck along its entire length, which renders as a dam.
- **Curve continuity across joins.** Smoothing per segment produces a kink at
  every node. Tangent-match across joins, and apply the turning-radius constraint
  across joins too.
- **Alignment modes** — straight, curve, auto — picked before drawing and
  switchable mid-draw, per segment. Straight does not mean "ignore terrain"; it
  means "hold this line and tell me what holding it costs."
- **Wet waypoints must not create nodes.** Otherwise a span-scaled premium is
  defeated by chunking, exactly as a hard cap was.

### Bridges

- `maxBridgeSpan` ≈ 14 cells. Measured on straight lines between node pairs
  (not on generated corridors, which are already A\* output that avoided water —
  a selection effect that halves the apparent spans).
- **Premium scales linearly with span**; total cost goes with the square since
  base cost is already proportional. Exponential would make *n* short spans
  cheaper than one long one, handing the discount to whoever clicks most.
- **Bridges decay faster and cost more to repair.** This is where it earns its
  keep as a *game* change: the network stops degrading uniformly and starts
  failing at the crossings, which are exactly the links that cannot be routed
  around.
- **A\* must weigh a bridge against a detour.** If water is near-prohibitive,
  roads trace shorelines and no bridge is ever chosen — bridges become a manual
  override rather than part of the model.
- The inherited spine gets **no span cap** — it already exists and was not paid
  for. Applying the player's cap severs it.

### Eras

- **Four compressed eras:** Post-Independence → Oil Boom → Informal → Modern.
- **Palette carries most of the era legibility.** Verified cheap; four
  screenshot-distinct worlds cost very little.
- **Era identity must be expressed mechanically**, not only in prices —
  per-era paratransit parameters made the Informal era feel like informal
  transport taking over.
- **Rail goes dark through Informal and returns as standard gauge in Modern.**
  Historically exact. But a *designed absence* must be visible in advance via a
  catalog timeline, or it ambushes the player.
- Era transition banners should **sort deltas by magnitude** and include all
  terms, or the headline number gets buried.

### Display and legibility

- **A visual must not say something the model doesn't mean.** Every audit found
  its bugs at the display boundary, never in sim logic. This is the single most
  reliable rule in the project.
- **Colour encodes a question the player must act on**, not a fact they already
  know. Hue = health, brightness = utilisation. Two channels, two meanings, never
  conflated.
- **Streets should be neutral by default** and take the health hue only where
  service runs. Colouring every corridor green makes the whole map a lattice and
  destroys the signal.
- **Show relationships, not just state.** Every legibility win came from making a
  connection visible, not a number bigger.
- **Stranded must be reachability-based** — "originates demand that can't reach
  any destination" — not "has no built edge". A road to nowhere doesn't un-strand
  a node.
- **Per-route P&L with worst-first sorting** is what makes the economy
  diagnosable. Three playthroughs ended in undiagnosable debt without it.
- **Burn rate in the status strip** — income, cost, net per day. Balance without
  rate is unreadable.

### Visual direction

- **Diorama.** A bounded miniature world reading as a made object: base with
  visible thickness, strong value structure, directional lighting, ambient
  occlusion. This resolves out-of-bounds — a model is allowed to have edges.
- Commits to the **middle-distance view**. No street-level flying. That is a trade
  and it saves a lot of building detail.
- **Grounding is the biggest cheap win.** Contact shadow where things meet.
  Without it everything floats.
- **Albedo separation before lighting.** The old build had corridor, terrain and
  ground all at ~0.45 value — the scene read flat because large areas shared an
  albedo, not because the lighting was wrong.
- **Full-framebuffer AO conflicts with the corridor signal channel.** GTAO darkens
  corridor strips along with everything else. Ground buildings with geometry and
  contact shadows instead.
- **Water should be a strong value area** the built mass reads against. A flat
  tinted plane does nothing.
- **Roofs carry the colour**, not walls. From this camera the roof is most of what
  you see.
- **Road and rail need a distinct visual channel** — width, surface treatment,
  sleepers. Not hue or brightness, which are taken.

### Process

- **Sim logic keeps auditing clean; failures land at the display boundary.**
- **Analytical models are wrong on first contact, every time.** The error is
  usually calibration, not structure. Prototype the smallest version that can be
  felt before building the full model.
- **Measure the failing case, not a proxy.** Fixes were twice validated against
  scenarios that weren't broken.
- **Fix the model before tuning content.** Three balance conclusions were
  invalidated by upstream model bugs found later.
- **Sustained state gates decisions.** Spawn, despawn, notification and promotion
  read EMAs, never a single tick. This bit five times.
- **Small steps with playtests between** worked for mechanics and failed for
  visual work, where half-built looks worse than either end.

---

## 6. Modules

Build order matters. **Modules 0–2 come first and in that order** — the biggest
process failure last time was building machinery for months and only then trying
to make it look like a game.

Each module should leave the thing runnable.

---

### Module 0 — Foundation

- Repo, **remote from commit one**, CI running tests + typecheck + build.
- Vite + TypeScript strict.
- `engine/` `content/` `render/` `ui/` `dev/` boundaries, with a lint rule or
  test asserting `engine/` imports nothing forbidden.
- Fixed-timestep loop with accumulator, decoupled from render.
- Content loader + schema, with the schema validating the real JSON in CI.

**Done when:** an empty scene renders at a stable frame rate and content loads.

---

### Module 1 — Visual foundation and tuning panel

**This is first for a reason.** Everything after it is judged against a target
that exists from day one.

- Style spec: one mutable object holding every value that decides how the scene
  looks. No scattered constants.
- **Tuning panel** (`?tune=1`, dev-only, verified absent from the production
  bundle): sliders bound to the style spec, live where possible, regenerate where
  geometry is affected, export as JSON to paste into content.
- Diorama treatment on a placeholder scene: base slab with thickness, directional
  key light with shadows, fill and ambient, contact shadows.
- Camera: angled orthographic, middle-distance register, cursor-anchored zoom,
  pan, rotate.
- Greyscale test as an acceptance check — the scene must read in value alone.

**Done when:** you can drag a slider and see the scene change, and a bare terrain
slab already looks like a considered object.

---

### Module 2 — Terrain and map generation

- Seeded, deterministic. Same seed, same map, asserted in a test.
- Elevation, water, settlement density as scalar fields.
- Node placement by density; node kinds: settlement, village, junction.
- Corridors as the inherited network only — the possibility space is unbounded
  because the player authors corridors (Module 4).
- Union-find connectivity guarantee with a **hard assert** at generation end.
- Water as a strong value area; terrain with enough relief for lighting to
  describe.

**Done when:** several seeds produce maps that look like places and are provably
connected.

---

### Module 3 — Simulation core

- Demand pairs: reciprocal passengers from every inhabited node; one-way goods on
  role pairs.
- Node queues, A\* routing over built infrastructure.
- Vehicle agents on the conveyor model with `from`-tagged load entries.
- Bottleneck attribution: hue = health from potential flow, brightness =
  utilisation.
- Reachability-based stranded computation.

**Done when:** vehicles carry demand between places and the map shows where the
pressure is.

---

### Module 4 — Building and chains

- Corridor authoring: click-to-place nodes, pen-tool interaction, alignment modes.
- Chains: `vertex` node kind, per-segment type and `level` (ground only).
- Terrain A\* with the cost function *as* the price, no corner cutting,
  supercover water measurement.
- RDP simplification, Catmull-Rom smoothing **with continuity across joins**,
  turning radius across joins.
- Cost breakdown in the ghost preview: base, gradient, water, density, nodes.
- Build as a command, undoable.

**Done when:** you can draw a line you meant to draw, and you can see why it costs
what it costs.

---

### Module 5 — Bridges and levels

- Auto-nodes at water banks; elevated segments bank-to-bank only.
- Span cap ~14; premium linear in span.
- A\* weighs bridge premium against detour — verify by measuring how many
  generated corridors include a bridge across seeds.
- Bridge render: deck clearance, fixed-depth fascia band, cast shadow.
- Faster decay and dearer repair on water segments.

**Done when:** the pathfinder chooses to bridge where bridging is cheaper, and a
bridge reads as a bridge rather than a dam.

---

### Module 6 — Economy

- Fares global per kind; revenue on unload; per-tick operating cost.
- Per-def purchase costs; era multipliers; build costs.
- Debt allowed; depreciated resale.
- **Per-route P&L, worst-first sorted; burn rate in the status strip.** Build
  these *with* the economy, not after — three playthroughs were wasted without
  them.

**Done when:** you can tell which route is bleeding in under ten seconds.

---

### Module 7 — Paratransit

- One-shot spawning on sustained unserved demand.
- Per-corridor cap and per-pair cap; congestion-gated spawning.
- Per-vehicle congestion weight; congestion scales capacity.
- Passengers only.

**Done when:** leaving a corridor unserved fills it with informal traffic that
degrades your own service, and the loop has an exit.

---

### Module 8 — Eras

- Four eras with per-era modifiers: demand, fuel, build cost, decay, paratransit
  parameters.
- Vehicle catalog with `eraIn`/`eraOut`, `carries`, `runsOn`, `purchaseCost`.
- Graceful obsolescence plus rising maintenance.
- Catalog timeline so designed absences are visible in advance.
- Era palettes.

**Done when:** a full four-era run is survivable with competent play and each era
feels different to operate in.

---

### Module 9 — Growth

- Service ratio per node with paratransit discounted.
- Smoothstep gate on rolling S̄; growth requires player service.
- Tier promotion with the threshold early in the curve; `D_max` bounded by tier.
- **Growth visible on the map** — promotion moments, marker and label change,
  settlements that visibly change.

**Done when:** you can see a place grow without reading a number, and you serve
somewhere *in order to* grow it.

---

### Module 10 — Save/load and scenarios

- State snapshot, versioned format, old versions rejected clearly.
- Scenario definitions as content: starting era, funds, seed fleet, warm-forward
  days.
- `window.dev` console API for era, funds, warm, save, load.

**Done when:** you can reach any era in seconds for tuning.

---

## 7. Deferred, with triggers

| Item | Trigger |
|---|---|
| Stations ("no station, no service") | Its own pass with its own playtest — it inverts a core assumption and re-litigates the economy |
| Underground / tunnels | When elevated is proven and terrain is worth defeating |
| Corridor failure state | When decay is visibly biting and repair needs to compete with expansion |
| Paratransit on dirt roads | After failure state, sharing a usable-set concept |
| Real-world map import | When the generator is proven and recognition is worth the OSM work |
| Onboarding, goals | When someone other than the author plays it |
| LTM traffic model | Only if spillback would change a player decision |
| Scripting / events | When there is a concrete thing JSON cannot express |

---

## 8. Open questions

- **The finish line.** §2. Answer before Module 3.
- **Do settlements need visual richness**, or is the map's problem terrain, water
  and lighting rather than what sits on it?
- **What is a ferry for?** In the old build it ended at ~8% of crossings with one
  vehicle type — close to dead content. Either give it a reason to be chosen where
  a bridge is legal (cheap and immediate versus expensive and permanent), or
  accept it as a fallback and stop giving it character.
- **Does rail belong at this demand scale?** An informed player avoided it once
  the catalog showed it goes dark in Informal.

---

## 9. How to decide what's next

1. **Is there an unplayed shipped thing?** Play it. Every finding that mattered
   came from playing or from measuring the failing case — never from analysis of
   a healthy one.
2. **Is there a premise-level question open?** Those beat features.
3. **Otherwise:** prefer the item that adds *meaning* over the item that adds
   *depth*.

The standing test is *"is this a game someone else could play?"* — not "is this
complete?"
