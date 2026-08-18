# Architecture

A stable reference to how this codebase is put together: module boundaries, file map,
and the recurring patterns used everywhere. For *what's been built so far and what's
next*, see [status.md](status.md). For *why* any of this is shaped the way it is, see
[rebuild-plan.md](rebuild-plan.md) §5 (Findings) — that document is the reasoning; this
one is the resulting map.

## Hard rules (enforced, not just convention)

1. **`engine/` never imports `render/`, `content/`, `ui/`, `dev/`, or `three.js`.**
   Enforced by `test/architecture-boundaries.test.ts`, which walks the TypeScript
   Compiler API over every file in `src/engine/`. `engine/` submodules (`simulation`,
   `economy`, `pathing`, `paratransit`, `map`, `eras`, `growth`) *can* import each other.
2. **Content is data.** Game content (eras, vehicles) lives in schema-validated JSON
   under `public/content/`, loaded at runtime via `src/content/loader.ts` +
   `src/content/schema.ts` (Zod). `engine/` never imports content types directly — it
   defines its own plain mirrored interfaces (e.g. `engine/eras/types.ts`'s `EraDef` has
   no `palette` field, because palette is render-only) and the bootstrap layer
   (`main.ts`) maps loaded content into them.
3. **The cost function IS the build price.** `engine/pathing/cost.ts`'s `stepCost` /
   `bridgeStepCost` / `sumStepCosts` / `maintenanceCost` are the *only* functions that
   turn geometry into currency — the A* search (`terrainAStar.ts`), the live
   cost-breakdown UI (`ui/costPanel.ts`, fed by `pathing/plan.ts`), the Inspector's
   maintenance action and the Buildability overlay all call through them. Never compute
   cost two different ways. A profile's `costPerMeter` is authored content that *feeds*
   this function, never a second path around it.
4. **Aggregate demand, never per-passenger agents.** A node's queue is
   `(destination, kind) -> amount waiting` (`NodeQueues` in `engine/simulation/types.ts`).
   Vehicles carry `LoadEntry[]`, an aggregate list, not individual riders.
5. **One home per fact.** Every player-facing fact belongs to exactly one of the six
   homes — Inspector, Overlays, Lists, Strip, Moments, Map — and does not also appear in
   another. See [module-11-studio-and-ia.md](module-11-studio-and-ia.md) §1 for the table
   and the negative rule that makes each home useful.
6. **Two visual channels, two meanings.** On the base map, **hue = health** and
   **brightness = utilisation** (`render/network.ts`'s `segmentSignalColor`). Nothing
   else may borrow either. Anything that needs to say something different says it in
   `render/overlayLayer.ts`'s separate additive group, and the base map dims to neutral
   while it does.
7. **EMAs, never a single tick.** Every "should this trigger" decision that depends on
   sustained state (burn rate, paratransit spawn threshold, unserved demand) is gated on
   an exponential moving average, computed as `alpha = 1 - Math.exp(-dt / tau)`, updated
   **exactly once per tick, globally** — never per-vehicle/per-entity. Getting this wrong
   (updating inside a per-vehicle loop) was a real bug caught twice during the build; see
   status.md Module 6/7 notes.

## Directory map

```
src/
  content/        Zod schemas + loader for public/content/*.json
                  (eras, vehicles, scenarios, 2D profiles)
  engine/         Pure TypeScript, no DOM/three.js. Fully unit tested.
    eras/         EraTimeline: advances through eras over real time
    economy/      Funds, fares, operating costs, obsolescence, P&L
    map/          Terrain/node/corridor generation, decay, pruning, cloning
    pathing/      Terrain-aware A*, corridor planning, cost breakdown
    paratransit/  Informal-sector one-shot vehicle spawning
    simulation/   The tick loop: demand, vehicles, congestion, routing
    growth/       Logistic demand growth, service ratio, tier promotion
  render/         three.js scene, camera transitions, authoring UI logic, entity
                  picking, overlay layer, profile extrusion, DOM event handling
  ui/             Plain-DOM panels, one per home: inspector, overlays, pnlPanel,
                  statusBar, eraBanner, costPanel — plus selection.ts, the store all
                  of them agree on
  dev/            DEV-only Preact studio (`?studio=1`): Tuning, Profile Studio, Asset
                  Modder, Scenario Lab. Dead-code-eliminated from production via
                  `import.meta.env.DEV` (see verify:bundle below)
  main.ts         Bootstrap: loads content, wires every controller, owns the frame loop
public/content/    eras.json, vehicles.json — the actual game content
public/mods/       Mod packages written by the Asset Modder tab (vehicle.json + mesh)
docs/
  rebuild-plan.md The original design doc: goals, module order, Findings (§5)
  architecture.md This file
  status.md       Per-module build log: what's done, what's pending, key decisions
  module-11-studio-and-ia.md  The six homes taxonomy + dev studio contract
test/              One file per engine module + a handful of render-adjacent ones
```

## The tick loop

`src/engine/loop.ts` exposes `Accumulator` (fixed-timestep, `SIM_DT = 1/30`) and
`SIM_DT`. `main.ts`'s `frame()` calls `accumulator.advance(elapsed, dt => { ... })`
once per animation frame; the callback may run zero or more `dt`-sized simulation steps
depending on how much real time elapsed. Inside that callback, in order:

1. `tick(simulation, dt, economy, paratransit, eraModifiers)` — the one integration
   point (`engine/simulation/simulate.ts`) that threads economy, paratransit, and era
   modifiers together. It grows demand queues, decays segment condition, moves every
   vehicle, applies operating costs, and runs paratransit spawn/reap.
2. `advanceEraTimeline(eraTimeline, dt)` — may return an `EraTransition`, which
   `main.ts` reacts to (see Module 8 in status.md).

`engine/economy`, `engine/paratransit`, and `engine/eras` are all optional/separate from
`SimulationState` on purpose — `engine/simulation` stays about physical movement only.

## Recurring patterns worth knowing before touching code

- **Chain-of-nodes corridors.** A `Corridor` is an ordered `nodeIds: string[]`. Each
  consecutive pair gets its own `Segment` (independently typed/leveled/maintained). This
  is what makes curves, bridges, and elevation fall out of one graph change instead of
  four separate features.
- **Supercover DDA + whole-chain Catmull-Rom.** `pathing/supercover.ts` walks cells for
  precise water detection; `pathing/smoothing.ts` smooths the *entire* chain at once
  (not per-segment) to avoid kinks at joins, then clamps back to traversable terrain.
- **Bridges are A* "jump" edges.** Cardinal-only, span-capped
  (`MAX_BRIDGE_SPAN` in `pathing/cost.ts`), linearly priced (not exponential — see hard
  rule 3's comment in the source for why).
- **Conveyor-model vehicles.** No per-passenger agents. Player vehicles are `cyclic`
  (loop forever); paratransit vehicles are `one-shot` (removed on completion,
  `hasCompletedTrip` in `simulation/vehicle.ts`).
- **Congestion scales both speed and effective capacity.** Per-segment vehicle load is
  weighted by `congestionWeight` (an okada isn't a bus), floors at a minimum factor
  rather than approaching zero. See `simulation/congestion.ts`.
- **Revenue on unload, cost every tick unconditionally.** `economy/state.ts`:
  `recordDeliveryRevenue` fires on delivery; `applyOperatingCosts` fires every tick
  regardless of affordability (debt is allowed, no interest, no game over). Depreciated
  resale floors at `MIN_RESALE_FRACTION` rather than going to zero.
- **Selection is shared, not owned.** `ui/selection.ts` is a tiny store; the Inspector,
  the P&L list, the moments banner, the map picker and the camera all read or write it.
  No panel owns "what is selected" — that is what lets a list row, a banner and a map
  click all mean the same thing.
- **Picking is grid-space arithmetic, not raycasting.** `render/picking.ts` converts the
  pointer to a grid cell through the one shared `gridCoords.ts` conversion and then does
  plain distance math, preferring vehicle → node → segment. Line primitives are almost
  impossible to hit with a ray, and this version is unit-testable with no WebGL context.
  `render/vehicles.ts` shares `vehicleGridPosition` with it, so the marker you see and
  the thing you click cannot disagree.
- **Overlays are additive and mutually exclusive.** `render/overlayLayer.ts` draws into
  its own group on a 0.25s timer (every overlay is a whole-map aggregate; per-frame
  disposal churn would dwarf the simulation), and always calls the engine's own function
  for whatever it displays — `congestionFactor` for stress, `stepCost` for buildability.
- **Content-aware code stays out of `engine/`.** Era multipliers, vehicle era-gating,
  and obsolescence are all *triggered* from `render/fleet.ts` and `main.ts` (which know
  about content), but the actual mechanics (`markVehicleObsolete`, `decaySegments`,
  `trySpawnParatransit`'s pressure divisor) live in `engine/` and take plain numbers, not
  content types.
- **Live getters, not captured values, for anything era-dependent in render/.**
  `createFleetController` and `createAuthoringController` both take
  `getCurrentEraId: () => string` / `getBuildCostMultiplier: () => number` /
  `getRailAvailable: () => boolean` callbacks, not one-time values — the era timeline
  advances on its own after these controllers are constructed.

## Build/verify pipeline

- `bun run typecheck` — `tsc --noEmit`, pinned to TypeScript `^5.7` (the `latest` tag is
  an unstable 7.x rewrite with a different, non-classic compiler API that
  `architecture-boundaries.test.ts` depends on — don't upgrade without checking).
- `bun test` — all engine + a handful of render-support unit tests.
- `bun run build` — `vite build`.
- `bun run verify:bundle` (`scripts/verify-prod-bundle.mjs`) — asserts a string
  belonging to each dev-only surface (e.g. "preact", "Asset Modder", "GLTFLoader") is
  absent from the production bundle, since the whole studio is gated behind
  `import.meta.env.DEV` and must be dead-code-eliminated. **Adding a studio tab means
  adding a string there**, or the gate stops being an assertion and becomes a promise.
- GitHub Actions CI runs all four in that order on push.

## Live browser verification

There is no automated E2E suite. Feature-level verification is done ad hoc with
Playwright (`playwright-core`, a devDependency) driving the **user's actual installed
Google Chrome** via `executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`
— **never download a Chromium binary**; that's an explicit, repeated constraint from the
project owner. Pattern: `bun run dev` in the background, then a throwaway `.mjs` script
in the scratchpad dir using `chromium.launch({ executablePath, headless: true })`,
reading real computed values (status bar text, a debug-exposed style object, etc.) rather
than trusting screenshots alone. Delete throwaway debug hooks after use; don't leave them
in committed code.
