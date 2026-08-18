# Architecture

A stable reference to how this codebase is put together: module boundaries, file map,
and the recurring patterns used everywhere. For *what's been built so far and what's
next*, see [status.md](status.md). For *why* any of this is shaped the way it is, see
[rebuild-plan.md](rebuild-plan.md) §5 (Findings) — that document is the reasoning; this
one is the resulting map.

## Hard rules (enforced, not just convention)

1. **`engine/` never imports `render/`, `content/`, or `three.js`.** Enforced by
   `test/architecture-boundaries.test.ts`, which walks the TypeScript Compiler API over
   every file in `src/engine/`. `engine/` submodules (`simulation`, `economy`, `pathing`,
   `paratransit`, `map`, `eras`) *can* import each other.
2. **Content is data.** Game content (eras, vehicles) lives in schema-validated JSON
   under `public/content/`, loaded at runtime via `src/content/loader.ts` +
   `src/content/schema.ts` (Zod). `engine/` never imports content types directly — it
   defines its own plain mirrored interfaces (e.g. `engine/eras/types.ts`'s `EraDef` has
   no `palette` field, because palette is render-only) and the bootstrap layer
   (`main.ts`) maps loaded content into them.
3. **The cost function IS the build price.** `engine/pathing/cost.ts`'s `stepCost` /
   `bridgeStepCost` / `sumStepCosts` are the *only* functions that turn geometry into
   currency — both the A* search (`terrainAStar.ts`) and the live cost-breakdown UI
   (`ui/costPanel.ts`, fed by `pathing/plan.ts`) call through them. Never compute cost
   two different ways.
4. **Aggregate demand, never per-passenger agents.** A node's queue is
   `(destination, kind) -> amount waiting` (`NodeQueues` in `engine/simulation/types.ts`).
   Vehicles carry `LoadEntry[]`, an aggregate list, not individual riders.
5. **EMAs, never a single tick.** Every "should this trigger" decision that depends on
   sustained state (burn rate, paratransit spawn threshold, unserved demand) is gated on
   an exponential moving average, computed as `alpha = 1 - Math.exp(-dt / tau)`, updated
   **exactly once per tick, globally** — never per-vehicle/per-entity. Getting this wrong
   (updating inside a per-vehicle loop) was a real bug caught twice during the build; see
   status.md Module 6/7 notes.

## Directory map

```
src/
  content/        Zod schemas + loader for public/content/*.json (eras, vehicles)
  engine/         Pure TypeScript, no DOM/three.js. Fully unit tested.
    eras/         EraTimeline: advances through eras over real time
    economy/      Funds, fares, operating costs, obsolescence, P&L
    map/          Terrain/node/corridor generation, decay, cloning
    pathing/      Terrain-aware A*, corridor planning, cost breakdown
    paratransit/  Informal-sector one-shot vehicle spawning
    simulation/   The tick loop: demand, vehicles, congestion, routing
  render/         three.js scene, authoring UI logic, DOM event handling
  ui/             Plain-DOM status/cost/P&L/fleet-hint/era-banner panels
  dev/            DEV-only tuning panel (Preact) + greyscale test, dead-code-eliminated
                  from production via `import.meta.env.DEV` (see verify:bundle below)
  main.ts         Bootstrap: loads content, wires every controller, owns the frame loop
public/content/    eras.json, vehicles.json — the actual game content
docs/
  rebuild-plan.md The original design doc: goals, module order, Findings (§5)
  architecture.md This file
  status.md       Per-module build log: what's done, what's pending, key decisions
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
- `bun run verify:bundle` (`scripts/verify-prod-bundle.mjs`) — asserts dev-only strings
  (e.g. "preact") are absent from the production bundle, since the tuning panel is
  gated behind `import.meta.env.DEV` and must be dead-code-eliminated.
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
