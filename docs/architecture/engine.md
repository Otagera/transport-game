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
