# Engine

Everything under `src/engine/`. Pure TypeScript — no DOM, no three.js, no content
imports (hard rule 1 in [index.md](index.md)). Every submodule here is fully unit
tested; `test/architecture-boundaries.test.ts` enforces the import boundary
automatically, so nothing below needs re-verifying by hand.

## map/ — terrain, nodes, corridors

`generate.ts`'s `generateMap(seed)` is the sole entry point and is **deterministic**:
same seed, same map, asserted in `test/map-determinism.test.ts`. It composes:

- `terrain.ts`'s `generateTerrainField(rng, width, height)` — elevation, water, and
  settlement-density as scalar `Float32Array`/`Uint8Array` fields over a noise field.
  Pure function of the seeded `Rng` (`random.ts`'s `createRng`, mulberry32) — this
  purity is exactly what lets `engine/save` skip serialising terrain and regenerate it
  on load instead (see the save/ section below).
- `nodes.ts`'s `placeNodes(terrain)` — settlement/village/junction placement by density.
- `corridors.ts`'s `generateInheritedNetwork(nodes)` — the brownfield spine: a
  neglected colonial rail line (starts at `condition: 0.6`) and cheap feeder roads
  (`condition: 0.75`) — the brownfield premise ([principles.md](../principles.md) §1)
  rendering itself as a literal number from Module 2 onward.
- `connectivity.ts`'s `assertFullyConnected` — union-find, **hard-asserted** at
  generation end. Every downstream module (routing, scenario seed-fleet placement) leans
  on this guarantee rather than checking it defensively.

**A `Corridor` is a chain of nodes** (`nodeIds: string[]` + one polyline); each
consecutive pair gets its own `Segment` — independently `type` (road/rail), `level`
(underground/ground/elevated), `condition`, `provenance` (inherited/built), and an
optional `profileId` (Module 11b — an opaque key into content's `Profile2DDef`
catalog, never the content type itself). This chain-of-nodes shape is what makes
curves, bridges, stations and elevation fall out of one graph change instead of four
separate features.

`decay.ts`'s `decaySegments(map, dt, eraDecayMultiplier, profileDecayById?)` ticks every
segment's `condition` down each tick, floored at `MIN_CONDITION = 0.3` (friction, not a
route-killing failure state — deferred, see principles.md §4). The two multipliers
**compose** rather than either replacing the other: an Informal-era decay spike still
bites an expressway less than a laterite feeder road, which is the whole point of
authoring the profile difference. `restoreSegmentCondition` is the inverse, used by the
Inspector's maintenance action — always through `pathing/cost.ts`'s `maintenanceCost`
(hard rule 3), and always pricing the deficit actually restored, never a repair that
didn't happen.

`prune.ts`'s `pruneCorridor` is the inverse of authoring's `commitCorridor` and equally
pure (returns a new `GeneratedMap`, never mutates). A settlement or village is never
removed — a place is not built infrastructure and keeps originating demand whether or
not anything currently reaches it (that's what makes "stranded" a real state). Junctions
and vertices go with the corridor that created them, but only once nothing else still
connects to them.

## pathing/ — terrain-aware A*, cost is currency

**The cost function IS the build price** (hard rule 3) — `cost.ts`'s `stepCost` /
`bridgeStepCost` / `sumStepCosts` / `maintenanceCost` are the only functions in the
codebase allowed to turn geometry into currency. `terrainAStar.ts` searches against
exactly these; `plan.ts`'s `planCorridor` produces the same breakdown the live cost
panel and the ghost preview render — one function, three consumers, never two
computations that could disagree.

- **No corner cutting.** A diagonal move whose shared corner is water is disallowed, so
  pathing cost, water measurement, and rendered geometry all agree.
- **`supercover.ts`** walks cells with a DDA algorithm for precise water detection —
  endpoint or interval sampling would miss corner clips.
- **`smoothing.ts`** applies Catmull-Rom to the *entire chain at once*, not per segment,
  to avoid kinks at joins, then clamps the result back to the traversable set (both
  vertices and segments), with a raw-path fallback if clamping would change corridor
  type.
- **Bridges are A\* "jump" edges** — cardinal-only, span-capped (`MAX_BRIDGE_SPAN`),
  and **linearly priced**: total cost still goes with the square since base cost is
  already proportional to span, but the *premium* is linear — exponential would make
  many short spans cheaper than one long one, handing the discount to whoever clicks
  most. The inherited spine gets no span cap (it already exists and wasn't paid for);
  applying the player's cap to it would sever the network.

**Bug caught live, Module 5:** a long ground run between two *separate* water crossings
got misclassified as itself being a bridge, because the jump-distance check compared
only distance without requiring chain-index adjacency (`idx === prevIdx + 1`). Fixed by
requiring that adjacency explicitly.

**Bug caught in the slice, step 3:** `supercover.ts`'s walk, on a line running left or up to
an integer endpoint, tied both crossings at t = 1, stepped past the end cell and wandered
until its guard — off the map, which `isWater` reads as water — so "straight" planning
returned null on dry ground. It now stops once the next crossing is at or past the end
(still taking both corner-adjacent cells at a corner tie). Affects the original game's
straight mode too.

**Known gap (original game):** "straight" mode prices the supercover *staircase* of cells,
not the line — on flat ground a straight road quotes ~2.5× the identical auto road. The
slice prices straight lines itself (`roads.ts` `planDirect`, below) rather than change the
original game's balance.

## simulation/ — the tick loop

`simulate.ts`'s `tick()` is the one integration point that threads economy, paratransit,
era modifiers, growth and profile decay together (see [index.md](index.md)'s tick-loop
section for the call signature). In order, each tick:

1. `demand.ts`'s pre-generated `DemandPair[]` (reciprocal passengers between every
   inhabited node pair, one-way goods village↔nearest-settlement) grow each node's
   `NodeQueues` — aggregate `(destination, kind) -> amount`, never per-passenger agents
   (hard rule 4). Demand pairs are static topology; growth (see below) scales the
   *rate* a pair generates, never the graph itself.
2. `map/decay.ts` decays segment condition.
3. `congestion.ts` computes the tick's **one published load per segment**:
   `computeSegmentLoads` (vehicles, weighted by `congestionWeight` — an okada isn't a
   bus) plus `computeAmbientLoads` (private cars, see below), summed via `addLoads` into
   `SimulationState.segmentLoads`. Everything that needs "how loaded is this road" reads
   this single number — vehicle speed, the paratransit spawn check, the Corridor stress
   overlay — never recomputes it. Congestion **scales effective capacity, not just
   speed** (speed-only would mean more vehicles is always strictly better), floors at a
   minimum factor, and gives a **free first slot** (one vehicle on a corridor is not
   congested).
4. `vehicle.ts`'s `tickVehicle` moves every vehicle along its path, loading
   opportunistically at each node (queued demand whose destination lies ahead on the
   remaining route — no manifests) and unloading on arrival, gated by
   `isCompatibleCargo` (a goods vehicle never loads passenger demand). **Player vehicles
   are `cyclic`** (loop forever); **paratransit vehicles are `one-shot`** (removed on
   `hasCompletedTrip`) — cyclic paratransit was measured to drain queues to a
   comfortable equilibrium and remove the pressure to build, which is why the
   distinction is load-bearing, not cosmetic.
5. Economy and paratransit react to what the tick just did (see their own sections
   below).
6. Growth samples this tick's pickups and may return `PromotionEvent[]`.

### Ambient private traffic (Module 12)

`congestion.ts`'s `computeAmbientGeometry`/`computeAmbientLoads`: **no car agents** —
prosperity (growth's `D`, see below) times the era's `ambientTraffic` content field
becomes a per-segment load, the same "aggregate number, not entities" reasoning as
queued demand. `SimulationState.ambientLoads` publishes the private-car share
separately from the combined `segmentLoads`, so the renderer draws cars *from* a number
without ever inventing traffic nobody is driving.

**Attenuation is measured from each segment's midpoint, not its endpoints — and that
distinction is the whole mechanic.** Measured at the endpoints, a long
settlement-to-settlement highway has both ends at distance zero and would carry full
traffic along its entire length: prosperity would degrade every road uniformly, a flat
tax with nothing to route around. Measured at the midpoint, short approaches stay busy
and the open middle of a long intercity run stays clear. Caught by looking at the first
render, not by a test.

**Rail's immunity is structural, not a filter** — rail segments are excluded when the
ambient geometry is built, so there is no code path in which a railway acquires car
traffic. This is deliberate: if rail took even a fraction, there would be no
infrastructure immune to the late-game hazard, and the mechanic would stop being a
decision. Ambient traffic closes a real vicious loop (cars slow buses → queues clear
slower → unserved EMA rises → paratransit spawns → paratransit adds *more* load) — see
the paratransit section below for the damping that keeps it a decision rather than a
death spiral. Numbers (`ambientTraffic: 0.02/0.18/0.08/0.38` across the four eras) are
starting points, not calibrated — see principles.md §5's open questions.

### `rebuildFromMap`

Everything derived from map topology — `routing` (A* graph) and `ambientGeometry` — is
rebuilt together in one function, `simulate.ts`'s `rebuildFromMap(state, map)`. Callers
used to set `routing` by hand at two separate call sites in `render/fleet.ts`; adding a
second derived cache to that pattern would have meant two places to forget one. A stale
`ambientGeometry` is the quiet kind of wrong — traffic would keep clustering around a
settlement that's since been pruned away from.

## economy/ — funds, fares, obsolescence

`state.ts`: **revenue accrues on unload** (`recordDeliveryRevenue`), never on carriage.
**Operating cost is per-tick and unconditional** (`applyOperatingCosts`) — it applies
even at negative funds; debt is allowed, with no interest and no game over (a hard
failure is wrong for a sandbox, principles.md §3). Depreciated resale
(`sellVehicle`) floors at `MIN_RESALE_FRACTION` rather than going to zero, or a player
in debt liquidates the fleet and is instantly solvent.

**Graceful obsolescence, not despawn.** A vehicle def's `eraOut` closes the purchase
catalog without touching owned stock — `markVehicleObsolete` (idempotent; an era
timeline only moves forward) is called once an owned vehicle's def falls outside the
current era's window, and `applyOperatingCosts` ramps its maintenance 2%/sec obsolete,
capped at 3×. Rising, so staying obsolete is a real cost, but capped so it's never an
unrecoverable death spiral for one vehicle.

**EMAs updated exactly once per tick, globally** (`incomeRateEMA`/`costRateEMA`) —
`updateIncomeRateEMA` takes the tick's *total* revenue across every vehicle, not a
per-vehicle call.

**Bug self-caught before shipping, Module 6:** the original plan was to update
`incomeRateEMA` *inside* the per-vehicle delivery-revenue function. That would decay the
rate toward zero on every vehicle that didn't happen to deliver on that specific tick,
compounding with fleet size. Split into a per-vehicle ledger-only update
(`recordDeliveryRevenue`, no EMA touch) and one once-per-tick
`updateIncomeRateEMA(state, totalRevenueThisTick, dt)` — this is the canonical example
behind hard rule 7.

**Bug caught live, Module 7 (90s untouched run):** `simulate.ts`'s `tick()` originally
credited *any* vehicle's delivery to the player's economy, including paratransit's —
player funds rose from ₦1,000 to over ₦5,000 purely from informal traffic nobody bought.
None of the 125 tests running at the time caught it, since none checked player funds
with paratransit running concurrently. Fixed by gating the credit on
`vehicle.lifecycle !== "one-shot"` — paratransit is an independent informal economy, and
that gate (not "does economy have an entry for this vehicle id") is what keeps it
correct even if the entry-based invariant ever slips.

## paratransit/ — the informal antagonist

`spawn.ts`'s `trySpawnParatransit`: one-shot vehicles spawn on **sustained** unserved
demand — a rolling EMA per demand pair (`pairUnservedEMA`), never queue depth alone. A
real operator does not join a jam that pays nothing. Capped **per corridor as well as
per demand pair** — many pairs route over one shared corridor, and without a
corridor-level cap 20+ informal vehicles were measured accumulating on one link,
collapsing throughput to ~10%. Spawning is **passengers-only** (informal freight needs
capital an okada doesn't have) and **damped, not blocked**, by the rolling
player-served share (`growth`'s `playerServiceEMA`) for that origin — a hard cutoff at
moderate service would turn the antagonist into a subsystem that politely waits its
turn, which is exactly the failure mode principles.md's hook section warns against.
Informal-era pressure is strong enough to break through service that would block a
spawn in a calmer era — that's the correct reading of "rail collapse, paratransit
takeover," not a bug (a test asserting the two "compose" nicely was itself wrong, and
was fixed to match).

## eras/ — the compressed timeline

`timeline.ts`: `createEraTimeline`/`advanceEraTimeline`/`currentEra`. Four eras
(Post-Independence → Oil Boom → Informal → Modern) advance on **real elapsed time**, not
player action, and hold at the final era rather than looping. `advanceEraTimeline`
returns an `EraTransition | null`, consumed by `main.ts` to react (palette, obsolescence
marking, rail-gating reconciliation, a banner) and by `window.dev.era()` to synthesize
one manually (see [dev-studio.md](dev-studio.md)).

**Five modifiers thread through `tick()` as `EraModifiers`**, a plain engine-side type
with no `palette` field (palette is render-only — hard rule 2): `demand`, `fuel`,
`buildCost`, `decay`, `paratransitPressure`, and `ambientTraffic` (Module 12, required
rather than optional-with-a-default — an era that forgot to say how motorised it is
would silently render as empty roads, and a missing mechanic that looks like a working
one is the worst kind). Each submodule takes its multiplier as a bare number, never the
`EraModifiers` type itself — `simulate.ts` is the only place in `engine/` that knows
eras exist at all.

**Rail goes dark through Informal, returns as standard gauge in Modern** —
`EraDef.railAvailable`. A designed absence must be visible in advance (a catalog
timeline shows it coming), not ambush an in-progress build — see
[render-and-ui.md](render-and-ui.md) for how authoring reconciles a mid-draw rail
selection if a transition happens while the player is mid-draw.

## growth/ — logistic demand growth, service ratio, promotion

`state.ts`: each village/settlement node gets a `NodeGrowthState` with a demand
multiplier `D` (starts at `INITIAL_DEMAND_MULTIPLIER = 1`) that grows via a logistic ODE
— `dD/dt = growthRate * D * (1 - D/D_max)` — bounded by a per-tier `D_max` (village:
2.5, settlement: 6; independent constants, **not derived from `D` itself**, or the
logistic cap would chase the variable and growth would be uncapped exponential wearing a
logistic's clothing). `D` feeds back into `simulate.ts`'s `growQueues` as a per-origin
multiplier on `pair.rate` — growth scales the *rate*, demand pair topology never
changes.

`growthRate` is gated by a smoothstep on a rolling, paratransit-discounted service ratio
S̄ (`serviceRatioEMA = playerServiceEMA + PARATRANSIT_SERVICE_DISCOUNT *
paratransitServiceEMA`, discount ~0.5 — paratransit *sustains*, player service
*develops*). **`playerServiceEMA` is a necessary condition, not a weighted
contributor** — growth is gated to exactly zero below `PLAYER_SERVICE_EPSILON = 0.02`
regardless of how high paratransit's discounted contribution pushes the combined ratio,
or reachability would saturate late-game and everything would grow on informal service
alone.

**Bug caught by a live integration test, not synthetic ones (Module 9).** The first
implementation EMA'd the *per-tick clamped ratio*
(`clamp01(servedThisTick / generatedThisTick)`), which looked fine against synthetic
100%-every-tick samples but failed against real vehicle behavior: a vehicle visiting a
node every few seconds delivers service in a burst that dwarfs that single tick's tiny
generated amount, so clamping to `[0,1]` before averaging threw away nearly all of the
burst's weight — `playerServiceEMA` stuck around 0.01–0.015 forever, below the 0.02 gate,
no matter how well the route was actually served. Fixed by EMA-ing the **raw rates**
independently (`generatedRateEMA`, `playerServedRateEMA`, `paratransitServedRateEMA`,
each `amount/dt`) and taking the ratio of the smoothed rates afterward — never smoothing
an already-computed ratio. This is the second instance behind hard rule 7.

**A second bug, also caught by testing before it shipped.** The promotion threshold was
originally `D_MAX.village * PROMOTION_THRESHOLD_FRACTION` = `2.5 * 0.3 = 0.75` — *below*
the starting multiplier of `1`, so every village promoted to settlement on its very
first tick regardless of service. Fixed by measuring the threshold as a fraction of the
*growable range above the starting multiplier*: `1 + 0.3 * (2.5 - 1) = 1.45`, which is
safe by construction for any fraction below 1.

**Promotion is a `NodeKind` mutation, nothing more elaborate** — `village` is already
the top of a two-level hierarchy below `settlement`, so `GrowableTier` just mirrors
`NodeKind` rather than inventing a parallel enum. `applyPromotion` mutates
`GeneratedMap.nodes[i].kind` **in place** (same pattern as `decaySegments` mutating
`Segment.condition`), which is what makes the promotion show up as a real map change for
free once the caller re-renders from that same map — see
[render-and-ui.md](render-and-ui.md) for the visual side.

**A gap Module 11 closed:** `congestionWeight` had been modelled in `congestion.ts`
since Module 7, but nothing ever supplied a value — every player vehicle used
`createVehicle`'s default of 1, so an okada weighed exactly as much as a BRT, the exact
thing principles.md's paratransit findings warn against. The vehicle catalog now carries
real weights (content, see [content.md](content.md)); `render/fleet.ts` threads them.

## save/ — versioned snapshot and scenarios (Module 10)

`types.ts`/`snapshot.ts`: `createSnapshot`/`restoreIntoState` mutate the target
`simulation`/`economy`/`paratransit`/`growth`/`eraTimeline` objects **in place** (same
pattern as `applyPromotion`/`decaySegments`) rather than returning new ones —
`main.ts`'s controllers hold direct references to these objects, so replacing them
would leave those controllers pointed at stale state.

**A save is state, not content.** `SaveFile` is a hand-written type, not derived from
`content/schema.ts`. The content schemas' `.default()` calls
(`congestionWeight.default(1)`, `channels.default({})` — see [content.md](content.md))
are correct for a hand-authored catalog, where an absent field means "assume the common
case." They are wrong for a save, where an absent field means "this save predates it"
and must fail the version check, not silently backfill a plausible value.
`restoreIntoState` rejects anything whose `version` doesn't match
`SAVE_FORMAT_VERSION` exactly, with a clear error, and leaves the target state
untouched on rejection.

**Terrain is the only thing derivable from the seed.** `generateMap` is deterministic
(see map/ above), so `SaveFile.map` stores `{ seed, nodes, corridors, segments }` and
`restoreIntoState` regenerates the ~7k terrain floats via `generateTerrainField` rather
than serialising them. Everything else in that shape has drifted from what the seed
alone would produce and must be stored: promoted `node.kind`, decayed
`segment.condition`, authored corridors/segments, and — the field that would corrupt a
save *silently*, since a dropped one still renders fine off the inherited-profile
fallback — **`segment.profileId`**. `SimulationState`'s four fields derived from map
topology (`demand`, `routing`, `ambientGeometry`, `segmentLoads`/`ambientLoads`) are
never serialised either — `restoreIntoState` calls `rebuildFromMap` and
`generateDemandPairs` instead of storing a second source of truth for something the
engine already recomputes.

`scenario.ts`: `applyScenario`/`warmForward` take plain mirrored types
(`ScenarioSpec`/`ScenarioVehicleSpec`), never `Scenario` or `VehicleDef` directly — hard
rule 2, same pattern as `EraDef`. `applyScenario` sets funds and jumps the era timeline
directly (not via `advanceEraTimeline`, which only ever moves forward), then places
`seedFleet` vehicles round-robin over pairs of inhabited nodes on the map's
already-connected inherited network — no corridor authoring needed, since `generateMap`
guarantees full connectivity. Seed vehicles are registered as real purchases (funds
deducted, ledger entries created), not free stock: `startingFunds` and `seedFleet` are
both scenario-author knobs, shown side by side in the Scenario Lab, so the author
reconciles them directly.

**`warmForward` runs real ticks, not a clock skip**, so a warmed scenario produces an
economy, a paratransit sector, and grown settlements that actually exist for the target
era — reproducible from the same seed, since nothing in the tick path but paratransit's
spawn-id derivation uses randomness, and that derives from `paratransit.elapsedSeconds`
(deterministic; there is no `Math.random` anywhere under `src/engine/`). Its
`growth`/`eraModifiersById`/`profileDecayById` parameters are **required**, unlike
`tick()`'s optional ones: `tick()`'s parameters are optional so existing call sites keep
compiling, but a warm-forward that omits `eraModifiers` gets no ambient traffic at all,
omits `growth` and settlements never develop, omits `profileDecayById` and every segment
decays at the base rate regardless of profile — a warm-forward missing any of them would
warm the wrong world *silently*. Making them required at `warmForward`'s own boundary
turns that into a compile error instead of a silent gap.

*Known limitation, not a blocker:* a warmed-forward vehicle's obsolescence isn't marked
mid-warm (that logic lives in `render/fleet.ts`'s `markObsoleteStock`, which needs the
content catalog `engine/` can't import). `main.ts` calls
`fleetController.handleEraChanged()` once after a scenario/save is applied, which
catches it for the *final* era reached, just not for eras passed through en route.

## slice/ — the reset's loop (principles.md §6)

`engine/slice/` composes existing modules into the slice's tick rather than extending
`simulation/simulate.ts`'s `tick`. Two hooks in `simulation/` exist for it: `tickVehicle`
takes an optional `Loader` that replaces the default boarding rule at each stop, and
`LoadEntry` carries an optional `trip` (origin, final destination) that `DeliveryEvent`
hands back on unload. `nodesAhead` is exported and shared. It reuses `createVehicle` / `createOneShotVehicle` /
`tickVehicle`, `buildRoutingContext` / `findPath` / `rebuildFromMap`, and economy's
purchase, sale, operating-cost and income-EMA functions unchanged. It does not use eras,
growth, decay, ambient traffic, or `paratransit/spawn.ts`.

- **`world.ts`** — `createSliceWorld(def, tuning)` builds a `GeneratedMap` (blank terrain,
  every town a `settlement`, inherited roads as two-point corridors) and replaces the
  generated demand with **gravity demand** (`k · popA · popB / distance`, passengers only,
  reciprocal, between *every* pair whether or not a road joins them). Player actions —
  `buildRoad`, `addBus`, `removeBus` — return `{ ok, reason }` and each has a matching
  `check*` the UI uses for previews. `roadCost` is the only function that prices a road
  (hard rule 3). Road paths are cached per pair in `pathCache`, cleared on every road change.
- **`tick.ts`** — `sliceTick`, in order: arrivals; **giving up** (each queue loses
  `1 − e^(−dt/patience)` per tick into a motor-park pool, so a queue settles at
  rate × patience — no `QUEUE_CAP`); vehicle movement and fares; **danfo dispatch**; reap;
  operating cost; rolling rates; settlements. Every waiting rider remembers the trip
  they're on: queue keys are `destination|origin`, pool keys `at>origin>destination`, so a
  rider changing buses or giving up at an interchange is still counted against their
  original trip.
- **Transfers** (`transfers.ts`) — `buildTripPlans` does a breadth-first search over
  routes per destination: a stop is *k* buses away if some route through it reaches a stop
  *k − 1* away. For each (stop, destination, route) on a fewest-buses trip it records where
  to get off — the qualifying stop nearest the destination. The slice's bus `Loader` boards
  riders whose planned stop is in `nodesAhead`; on unload, a rider short of their
  destination goes back into that stop's queue (same trip key) and counts toward its
  interchange rate. Each leg pays a fare on getting off. Danfos' `Loader` takes anyone whose
  final destination is ahead. The plan is cached on `world.plans`, nulled whenever a route
  is created or removed, a town is founded (paths change) or abandoned.
- **The informal sector** (`dispatchInformal`) — two motor-park pools with the same keys.
  Stage 1, `pool`: people who gave up on your bus wait for a danfo. Riders are grouped by
  where they are and their first hop; a danfo (14 seats) goes toward the destination whose
  path collects the most of them and takes everyone whose stop is on the way, if that's a
  full load. Riders who won't wait any longer drift (τ = patience × 3) into stage 2,
  `smallPool`: a keke (3 seats) goes when 3 share a run, otherwise an okada takes one rider.
  Stage-2 riders who out-wait even that go home. With no road, pooled riders go home at
  once. Every informal vehicle is created with an *empty* queue map — it leaves with the
  people who gave up, not the queue still waiting for you — but its `Loader` picks up
  anyone at a stop it passes whose final destination is ahead, which counts as `poached`.
  **Road space** caps the sector per segment in danfo-equivalents
  (`informalRoadSpace`, each mode's congestion weight: danfo 1, keke 0.5, okada 0.3);
  `informal.active` records each vehicle's mode, weight and segments so reaping frees the
  space. Capacities, speeds and weights come from the original catalog
  (`public/content/vehicles.json`).
- **Outcomes** — kept per (origin, destination) pair in `world.pairOutcomes`, as EMA rates
  (τ = one game day) of four disjoint buckets, each counted once, *when the trip
  resolves*: `player` (arrived at their destination on your buses, however many changes),
  `poached` (a passing danfo picked them up from a stop), `gaveUp` (waited too long, then
  left on a danfo), `lost` (stayed home). Danfo share is poached + gaveUp; they're kept apart because
  they answer different questions about a losing route. Town and network shares
  (`townShare`, `networkShare`) and the desire lines (`tripsFrom`) are all sums over pairs
  — one source, no per-town copy to drift. Attribution needs each pickup's destination and
  vehicle, so `simulation/types.ts`'s `PickupEvent` carries `to` and `vehicleId`.
- **Routes** keep EMAs of fare income, boardings, and load factor (mean cargo/capacity of
  their buses). Route cost is buses × operating cost.
- **`diagnoseRoute`** — measured, not modelled: sums the outcomes of trips whose planned
  journey rides this route for at least one leg (`plannedRoutes`) — so a feeder's numbers
  include the riders it hands on — then picks one verdict, most structural first: `thin` (one bus,
  catching about `ONE_BUS_REACH` — half — of every possible rider, wouldn't pay its running
  cost; measured, one bus catches ~33–55%), `overcapacity` (≥2 buses, load < 35% *and*
  ≥ 60% of riders already carried), `full` (load ≥ 85%), `poached` (≥ 20% taken by passing
  danfos), `waiting` (≥ 30% gave up), else `healthy`. The page turns the verdict into a
  sentence; the engine never formats text.
- **Towns along busy roads** (`settlement.ts`) — each segment keeps EMAs of riders/second
  passing a point (all vehicles, and yours alone). Once a game day: an emergent town below
  `abandonBelowPopulation` is abandoned, then at most one town is founded — at the midpoint
  of the busiest segment that's at least `2 × townSpacingCells` long, clear of every node by
  the spacing, with total flow ≥ `foundTownFlow` *and* your flow ≥ `foundTownPlayerFlow`
  (your service is a necessary condition — principles §3, Growth). Founding **splits the
  segment** into two through the new node (a corridor is a chain of nodes), and
  `insertIntoPath` threads the town into every vehicle path crossing it, keeping each
  vehicle where it physically is — so a bus route on that road serves the new town at once.
  The halves are too short to found on again, which is what keeps towns sparse; 
  `maxEmergentTowns` is the backstop. Emergent populations drift (τ = 10 days) toward
  `riders/s through it × populationPerFlow`; demand is regenerated once a day.
  Abandoning turns the node into a `junction` (the road keeps its bend), moves the town to
  `world.ruins` so its name stays on the map, and drops its queues, pools, demand and
  outcomes. Original towns never change size and never fade. `sliceTick` returns these as
  `SliceEvent`s.
- **Bus placement** — `addBus` creates the vehicle without queues (no teleport-load) and
  places it at the midpoint of the largest gap between the route's existing buses
  (`cycleFraction` / `largestGapMidpoint`).
- **Congestion** (`congestion.ts`) — `updateRoadSpeeds` runs once per tick before anything
  moves. It detects road space *entering* each segment (a vehicle starting a new leg —
  keyed `segment#pathIndex`, so a shuttle re-enters its one segment each way), keeps a
  rolling flow per road (τ = 10 s), and sets `world.segmentSpeed` from the BPR curve,
  `1 / (1 + 0.15·(flow/capacity)^4)`, floored at `minSpeedFactor`. Capacity is per road:
  `roadFlowCapacity`, × `dirtRoadCapacity` for inherited roads. `tickVehicle` takes those
  speeds through its `speedFactors` hook, so the number that slows a bus is the number the
  map draws. Road space is each vehicle's congestion weight (bus 1.2, danfo 1, keke 0.5,
  okada 0.3). Informal operators won't dispatch onto a road below `informalMinSpeed`.
  Routes keep a speed EMA; `diagnoseRoute` adds `speed`, `informalTraffic` (informal share of
  the road space on its roads now) and the `jammed` verdict (speed < 70%), ranked after
  `thin` and `overcapacity`. A segment split carries its flow to both halves.
- **Paving** (`paveRoad` / `checkPave` in `world.ts`, `isDirt` in `congestion.ts`) — turns the
  one dirt segment directly joining two towns (`directRoad`) into a built one, at `paveCost`
  (surface only since step 3; on flat ground what building it would cost). Provenance is the surface in
  the slice, so `splitSegment`'s copy leaves both halves of a paved road paved and the map
  draws it like a built road. `dirtRoadsOn(route)` lists a route's dirt roads for the
  jammed reason.
- **Inside towns** (`localTravel` in `world.ts`) — display only: a town's inside trips
  (`population × localTripsPerThousandPerDay`), the share of your riders who reach the park
  by keke or okada (`pop / (pop + walkableTownPopulation)`), and that share of your riders
  starting or ending trips there (`pairOutcomes`, so riders changing buses aren't counted).
  Nothing in the tick reads it; it touches no share and no money (a test pins that).
- **Terrain and roads** (step 3; `terrain.ts`, `roads.ts`) — `buildSliceTerrain` turns the map
  def's authored rivers (centre line + width) and hills (smooth bumps; elevation unbounded,
  since water is explicit) into the same `TerrainField` engine/map makes, and hard-fails a
  town in water. `planRoad` runs `pathing/plan.ts`'s `planCorridor` in auto mode (terrain A*,
  bridges as jump edges, smoothing) — or, for `alignment: "direct"`, `planDirect`: water by
  supercover, one span-capped bridge per crossing, ground priced by stepping the true line
  through `stepCost` — and "cheapest" takes whichever of the two costs less. It converts the
  `CostBreakdown` at one exchange rate,
  `roadCostPerCell / BASE_COST_PER_CELL`, naming the bridge and hills parts; plans are
  cached per pair (terrain never changes). A built road stores the plan's polyline on its
  corridor and its arc length on `Segment.length`, which routing and `tickVehicle` read
  (`nodeDistance` uses the edge weight), so a bend is a longer trip. Inherited roads stay
  straight with no `length` (brownfield premise). Paving prices the surface only:
  `segmentLength × roadCostPerCell`. A roadside town is founded halfway along the road's
  arc, never over water, and `splitSegment` splits the polyline there.
- **Wear** (step 4, `wear.ts`) — `updateRoadWear` runs each tick after the vehicles move:
  every segment loses `(weatherPerSecond + wearPerFlow × roadFlowEMA) × dirt × bridge` per
  second, floored at `map/decay.ts`'s `MIN_CONDITION`; maintained segments
  (`world.maintained`) are held where they are and the wear is billed via `repairCost`,
  which prices ground cells with `pathing/cost.ts`'s `maintenanceCost` and bridge cells
  (`bridgeCellsOn`, cached) at 4× (the build ratio), × `repairCostScale` at the slice's
  exchange rate. The tick charges that through `applyOperatingCosts`'s new
  `otherCostThisTick` (the original game passes none), so upkeep is in the burn rate.
  `tickVehicle` gets every segment's condition, so `conditionSpeedFactor` slows buses and
  danfos alike — kept apart from `segmentSpeed`, which stays traffic only (the casing
  means traffic). `setMaintained` charges the catch-up repair at once. `paveCost` includes
  repairing the base. `diagnoseRoute` adds `wornSpeed` (the worst stretch) and the `worn`
  verdict (< 85%, after `jammed` and `full` — a full route asks for a bus first); `wornRoadsOn` names them with their upkeep. A split
  carries maintenance to both halves.
- **Growth of the original towns** (step 4, `growth.ts`) — `townGrowth` reads the town's
  share (`townShare`: trips leaving it), service = player + 0.5 × informal, and gives a target
  `base × (1 + townGrowthCap × smoothstep((service − floor) / (full − floor)))`, zero growth
  below `growthMinPlayerShare`; `base` is `world.basePopulation` (the def's sizes), so the
  cap never chases the population. `growTowns` drifts each original town toward it every
  tick (from `updateSettlements`, after the roadside towns' drift); demand follows at the
  daily `refreshDemand`. Emergent towns are not in `basePopulation` and keep growing from
  traffic.
- **Through-routes** (`world.ts`) — `demandAlong(a, b)` is the demand of every trip with
  both ends on the bus's road path. `throughRoute(route)` tries each road leaving either
  end to a town not on the route (one hop), keeps extensions whose reach per path length is
  no lower than the route's, and returns the best if its reach is ≥ 1.5× the route's and
  ≥ 1.5× one bus's break-even at `ONE_BUS_REACH`.
- **Rail** (step 4d, `rail.ts`) — track is a `type: "rail"` segment on the same map.
  `rebuildNetworks` (replacing the slice's `rebuildFromMap` calls) builds
  `simulation.routing` from roads only and `world.railRouting` from in-service track
  (`world.railOutOfService` holds inherited track until restored); `railPath` mirrors
  `roadPath`. Trains are passenger routes `rail:a~b` in `world.routes` (`addTrain`), their
  vehicles in `world.railVehicles`; `routingFor(world, vehicle)` picks the network for
  `tickVehicle`, spacing (`edgeLengths`), `routeSegments`, `routeSpeed` and drawing.
  Congestion's `currentSegment`, segment loads and roadside-town flows skip trains; track
  gets no road traffic (its `segmentSpeed` is the slow order, below); towns are founded beside roads only; `splitSegment` splices
  road vehicles only. `planRail` is `roads.ts`'s `planAlignment` (the one planner, which
  `planRoad` now calls too) over a terrain with elevation × `railGradientMultiplier`, at
  `railCostPerCell`; `buildTrack` restores the derelict track joining two towns
  (`railRestoreCostPerCell` × length) or lays new. Route cost and the thin threshold are
  per vehicle kind (`vehicleCostPerDay`). `isCutOff` / `TripSummary.reachable` count working
  track. `throughRoute` extends bus routes along roads only, never trains.
- **Track wear** (`wear.ts`, `congestion.ts`) — `updateRoadSpeeds` counts trains entering each
  stretch of track (on `railRouting`) into `world.railFlowEMA`; `wearRate` for track is
  `(weatherPerSecond + railWearPerTrain × trains/s) × bridge`, no dirt factor;
  `updateRoadWear` skips only disused track. `slowOrder(world, segment)` is
  `railSlowOrderSpeed` below `railSlowOrderBelow` condition (1 otherwise and for roads); it's
  published as the track's `segmentSpeed`, so `tickVehicle` applies it with the condition
  factor, and `wearSpeed(world, segment)` includes it. `repairCost` prices track at
  `roadCostPerCell`, not `railCostPerCell`. `diagnoseRoute` never calls a train route
  `jammed`; `wornRoadsOn` covers a train route's track.
- **Export and freight trains** (`goods.ts`) — `goodsFlows` adds, per non-port market,
  produce to the port at `exportShare` × the rolling produce *delivered* to that market
  (`goods.outcomes`), so export starts at nothing and depends on feeders. Freight trains
  are goods routes `freight:a~b` in `world.lorryRoutes` (`addFreightTrain`), their vehicles
  in `world.railVehicles` (track routing, no road traffic); `goodsPath` / `goodsAlong(…,
  onTrack)` / `diagnoseLorryRoute` use the track path for them, `goodsVehicleCostPerDay`
  the freight running cost; `removeLorry` sells either. A freight train enters track
  weighted `lorryWearMultiplier` for track wear.
- **Goods** (step 4c, `goods.ts`) — `goodsFlows` derives one-way flows from the towns as they
  are: produce from each original town under `marketPopulation` to its nearest market
  (ties to the bigger), supplies from `world.port` (the map def's `port`) to every other town,
  rates per thousand people a day. `produceAndSpoil` (each tick, before movement) adds them
  to each town's yard (`world.goods.yards`, `to|kind` → tonnes) and spoils
  `1 − e^(−dt/goodsSpoilSeconds)` of what waits. Lorry routes are `world.lorryRoutes`,
  ids `lorry:a~b` (`addLorry` / `removeLorry` / `lorrySummaries`), never in `world.routes`, so
  transfers, diagnosis, through-routes and growth stay passenger-only. In the tick a
  `carries: "goods"` vehicle uses `goodsLoader` (goods for any stop ahead, no transfers);
  deliveries pay `produceFare`/`suppliesFare` through the economy's fare table and roll
  into `goods.outcomes` (delivered vs spoiled per flow). Lorry routes' rates roll over 4×
  `outcomeTauSeconds`. `updateRoadSpeeds` also keeps `heavyFlowEMA` (lorry road space alone);
  `wearRate` counts it `lorryWearMultiplier` times. Settlement flows count
  `carries: "passengers"` vehicles only. `diagnoseLorryRoute`: tonnes/day each way along the
  path, delivered/spoiled shares, verdict thin → full → one-way (weaker way < 30% of the
  stronger) → spoiling → healthy. `debtAdvice` includes losing lorry routes.
- **`debtAdvice`** (`world.ts`) — null unless in debt or under `RUNWAY_WARNING_DAYS` (7) of
  money left at the burn rate; otherwise the routes losing money on their own book, worst
  first, with `economy/state.ts`'s `resaleValue` (the preview `sellVehicle` itself uses)
  summed over their buses and their loss as the daily saving.
- **`tuning.ts`** — every number, with what it was calibrated *to* written beside it.

Tests: `test/slice.test.ts` — feel invariants (principles.md §6), the diagnosis verdicts,
town founding/abandonment rules, and `insertIntoPath`'s position-preserving split.
