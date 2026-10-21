# Architecture

A stable reference to how this codebase is put together. Start here, then follow into
whichever deep-dive covers the area you're touching:

- [engine.md](engine.md) — every `engine/` submodule: map/pathing, simulation, economy,
  paratransit, eras, growth, save/scenarios. Pure TypeScript, the tick loop, the bugs
  caught there.
- [render-and-ui.md](render-and-ui.md) — the three.js scene, the six-homes UI taxonomy,
  picking, authoring, corridor/profile rendering, the bugs caught there.
- [content.md](content.md) — the Zod content schemas, the loader, and the
  content-vs-save distinction that Module 10 had to get right.
- [dev-studio.md](dev-studio.md) — the `?studio=1` dev tooling, `window.dev`, and the
  production-bundle exclusion discipline both depend on.

For *what's been built and current state*, see [status.md](../status.md). For *why* any
of this is shaped the way it is, see [principles.md](../principles.md) §3 (Findings) —
that document is the reasoning; these are the resulting map.

## Hard rules (enforced, not just convention)

1. **`engine/` never imports `render/`, `content/`, `ui/`, `dev/`, or `three.js`.**
   Enforced by `test/architecture-boundaries.test.ts`, which walks the TypeScript
   Compiler API over every file in `src/engine/`. `engine/` submodules (`simulation`,
   `economy`, `pathing`, `paratransit`, `map`, `eras`, `growth`, `save`) *can* import
   each other.
2. **Content is data.** Game content (eras, vehicles, profiles, scenarios) lives in
   schema-validated JSON under `public/content/`, loaded at runtime via
   `src/content/loader.ts` + `src/content/schema.ts` (Zod) — see
   [content.md](content.md). `engine/` never imports content types directly — it
   defines its own plain mirrored interfaces (e.g. `engine/eras/types.ts`'s `EraDef`
   has no `palette` field, because palette is render-only) and the bootstrap layer
   (`main.ts`) maps loaded content into them.
3. **The cost function IS the build price.** `engine/pathing/cost.ts`'s `stepCost` /
   `bridgeStepCost` / `sumStepCosts` / `maintenanceCost` are the *only* functions that
   turn geometry into currency — the A* search, the live cost-breakdown UI, the
   Inspector's maintenance action and the Buildability overlay all call through them.
   Never compute cost two different ways. A profile's `costPerMeter` is authored content
   that *feeds* this function, never a second path around it. See
   [engine.md](engine.md).
4. **Aggregate demand, never per-passenger agents.** A node's queue is
   `(destination, kind) -> amount waiting` (`NodeQueues` in `engine/simulation/types.ts`).
   Vehicles carry `LoadEntry[]`, an aggregate list, not individual riders. No car agents
   either — ambient private traffic is a per-segment load, same reasoning. See
   [engine.md](engine.md).
5. **One home per fact.** Every player-facing fact belongs to exactly one of six homes —
   Inspector, Overlays, Lists, Strip, Moments, Map — and does not also appear in another.
   See [render-and-ui.md](render-and-ui.md) §2 for the table and the negative rule that
   makes each home useful.
6. **Two visual channels, two meanings.** On the base map, **hue = health** and
   **brightness = utilisation** (`render/network.ts`'s `segmentSignalColor`). Nothing
   else may borrow either. Anything that needs to say something different says it in
   `render/overlayLayer.ts`'s separate additive group, and the base map dims to neutral
   while it does. See [render-and-ui.md](render-and-ui.md).
7. **EMAs, never a single tick.** Every "should this trigger" decision that depends on
   sustained state (burn rate, paratransit spawn threshold, unserved demand, growth's
   service ratio) is gated on an exponential moving average, computed as
   `alpha = 1 - Math.exp(-dt / tau)`, updated **exactly once per tick, globally** — never
   per-vehicle/per-entity. Getting this wrong was a real bug, twice, during the rebuild —
   see [engine.md](engine.md)'s economy and growth sections.

## Directory map

```
src/
  content/        Zod schemas + loader for public/content/*.json
                  (eras, vehicles, scenarios, 2D profiles) -- content.md
                  NB: schemas only -- resolving a profile for a segment is
                  render/profileCatalog.ts, the bootstrap layer's job
  engine/         Pure TypeScript, no DOM/three.js. Fully unit tested. -- engine.md
    eras/         EraTimeline: advances through eras over real time
    economy/      Funds, fares, operating costs, obsolescence, P&L
    map/          Terrain/node/corridor generation, decay, pruning, cloning
    pathing/      Terrain-aware A*, corridor planning, cost breakdown
    paratransit/  Informal-sector one-shot vehicle spawning
    simulation/   The tick loop: demand, vehicles, congestion, routing, ambient traffic
    growth/       Logistic demand growth, service ratio, tier promotion
    save/         Versioned snapshot and scenario application/warm-forward
    slice/        The reset's loop (principles.md §6): abandonment, corridor danfos,
                  routes, share -- composes simulation/economy, doesn't replace them
  render/         three.js scene, camera, authoring UI logic, entity picking, overlay
                  layer, profile extrusion -- render-and-ui.md
  ui/             Plain-DOM panels, one per home: inspector, overlays, pnlPanel,
                  statusBar, eraBanner, costPanel -- plus selection.ts, the store all of
                  them agree on -- render-and-ui.md
  dev/            DEV-only Preact studio (`?studio=1`) -- dev-studio.md
  slice/          The slice's page: 2D canvas renderer, DOM panels, hand-made map
                  -- render-and-ui.md §7
  main.ts         Bootstrap: loads content, wires every controller, owns the frame loop
slice.html         The slice's entry page (index.html is the original game)
public/content/    eras.json, vehicles.json, profiles.json, scenarios.json
public/mods/       Mod packages written by the Asset Modder tab (vehicle.json + mesh)
scripts/slice-probe.ts  Headless calibration probe for the slice
scripts/slice-bots.ts   Bot personas + the brief's measured checks M1-M9 (docs/brief.md)
scripts/slice-strategist.ts  A long-game bot (Revision 3): plays the ladder and the chains to day 250+, measures C2, C11, C14
scripts/slice-lever-audit.ts  Each lever pulled in a twin world, measured against the original
scripts/{coldstart,connect,horizon}.ts  The brief's Evidence measurements, re-runnable
docs/
  principles.md   Design premise, scope, Findings (the "why")
  architecture/   This directory (the "how it's shaped")
  status.md       What's built, current state, what's next
test/              One file per engine module + a handful of render-adjacent ones
```

## The tick loop

`src/engine/loop.ts` exposes `Accumulator` (fixed-timestep, `SIM_DT = 1/30`) and
`SIM_DT`. `main.ts`'s `frame()` calls `accumulator.advance(elapsed, dt => { ... })` once
per animation frame; the callback may run zero or more `dt`-sized simulation steps
depending on how much real time elapsed. Inside that callback, in order:

1. `tick(simulation, dt, economy?, paratransit?, eraModifiers?, growth?, profileDecayById?)`
   — the one integration point (`engine/simulation/simulate.ts`) that threads economy,
   paratransit, era modifiers, growth and profile decay together. It grows demand
   queues, decays segment condition, computes the tick's total road occupancy (vehicles
   **plus** ambient private traffic), moves every vehicle, applies operating costs, and
   runs paratransit spawn/reap. Returns any `PromotionEvent[]` the tick produced. Detail
   in [engine.md](engine.md).

   Every optional argument is optional on purpose: `tick(state, dt)` alone is a pure
   physical-movement simulation, which is what most engine tests run. Each extra
   argument is a plain value or a plain `Map`, never a content type. `engine/save`'s
   `warmForward` makes the ones it needs *required* at its own boundary instead — see
   [engine.md](engine.md)'s save section for why that matters.
2. `advanceEraTimeline(eraTimeline, dt)` — may return an `EraTransition`, which
   `main.ts` reacts to (palette, obsolescence marking, era-gating reconciliation, a
   banner).

`engine/economy`, `engine/paratransit`, `engine/eras` and `engine/growth` are all
optional/separate from `SimulationState` on purpose — `engine/simulation` stays about
physical movement only. Anything derived from map topology (`routing`,
`ambientGeometry`) is rebuilt in one place, `simulate.ts`'s `rebuildFromMap`, so a map
change cannot leave half the caches stale.

`main.ts`'s `bootstrap()` also owns `window.dev`'s save/load/scenario reload flow — see
[dev-studio.md](dev-studio.md).

## Build/verify pipeline

- `bun run typecheck` — `tsc --noEmit`, pinned to TypeScript `^5.7` (the `latest` tag is
  an unstable 7.x rewrite with a different, non-classic compiler API that
  `architecture-boundaries.test.ts` depends on — don't upgrade without checking).
- `bun test` — all engine + a handful of render-support unit tests.
- `bun run build` — `vite build`.
- `bun run verify:bundle` (`scripts/verify-prod-bundle.mjs`) — asserts a string
  belonging to each dev-only surface (studio tabs, `window.dev`) is absent from the
  production bundle, since all of it is gated behind `import.meta.env.DEV` and must be
  dead-code-eliminated. **Adding a dev-only surface means adding a string there**, or
  the gate stops being an assertion and becomes a promise — see
  [dev-studio.md](dev-studio.md) for a real leak this caught.
- GitHub Actions CI runs all four in that order on push.

## Live browser verification

There is no automated E2E suite. Feature-level verification is done ad hoc with
Playwright (`playwright-core`, a devDependency) driving the **user's actual installed
Google Chrome** via
`executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` —
**never download a Chromium binary**; that's an explicit, repeated constraint from the
project owner. Pattern: `bun run dev` in the background, then a throwaway `.mjs` script
in the scratchpad dir using `chromium.launch({ executablePath, headless: true })`,
reading real computed values (status bar text, `localStorage` contents, a
debug-exposed style object, etc.) rather than trusting screenshots alone. Delete
throwaway debug hooks after use; don't leave them in committed code.
