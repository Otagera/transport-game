# Architecture

A stable reference to how this codebase is put together. Start here, then follow into
whichever deep-dive covers the area you're touching:

- [engine.md](engine.md) — every `engine/` submodule: the game (`engine/game/`), and the
  foundation it composes -- map/pathing, simulation, economy, paratransit, growth. Pure
  TypeScript, the tick loop, the bugs caught there.
- [render-and-ui.md](render-and-ui.md) §7 — the game's page: the 2D canvas map, its panels
  and cards. §1-6 describe the retired 3D game.
- [dev-studio.md](dev-studio.md) §4-5 — the design lab and the information lab (dev-only
  pages). §1-3 describe the retired 3D game's studio.
- [look.md](look.md) — **the visual contract** (2026-10-30): palette (chrome and signal), type, spacing,
  the four control roles, the Board layout, motion, the 3D view's order, and the checks that hold it.
- [content.md](content.md) — retired with the 3D game (its Zod content schemas).

**2026-10-23, the carry-over:** the slice became the game. The original 3D game -- its
three.js renderer, six-homes UI, dev studio, content schemas, calendar eras and
save/scenarios -- was retired from the build and the tree; it is kept whole under the git
tag `original-3d`. The flat map is the game's look until a good 3D one is within reach
(brief, the carry-over plan).

For *what's been built and current state*, see [status.md](../status.md). For *why* any
of this is shaped the way it is, see [principles.md](../principles.md) §3 (Findings) —
that document is the reasoning; these are the resulting map.

## Hard rules (enforced, not just convention)

1. **`engine/` never imports a page or the DOM.** `test/architecture-boundaries.test.ts`
   walks every file in `src/engine/` with the TypeScript Compiler API. The game's page
   (`src/game/`) and the labs read the engine; nothing goes the other way.
2. **The cost function IS the build price.** `engine/pathing/cost.ts`'s `stepCost` /
   `bridgeStepCost` / `sumStepCosts` / `maintenanceCost` are the *only* functions that
   turn geometry into currency (`engine/game/roads.ts` converts at one rate). Never
   compute cost two different ways. See [engine.md](engine.md).
3. **Aggregate demand, never per-passenger agents.** A node's queue is
   `(destination, kind) -> amount waiting` (`NodeQueues` in `engine/simulation/types.ts`).
   Vehicles carry `LoadEntry[]`, an aggregate list, not individual riders.
4. **The information design is the brief's.** Three layers -- the map at a glance, side
   panels, the revenue screen -- and the rules settled in the information lab (brief, the
   carry-over plan): roads by traffic and how full (grey, orange, red), yellow only for
   the informal sector, the other side's vehicles as bands with individuals on top when
   there's room, focus fades the rest.
5. **EMAs, never a single tick.** Every "should this trigger" decision that depends on
   sustained state is gated on an exponential moving average, `alpha = 1 - Math.exp(-dt /
   tau)`, updated **exactly once per tick, globally**.
6. **Run files replay as played.** A saved run records the tuning it was played with; a
   change to the game's behaviour sits behind a tuning key old files lack (undefined means
   the old behaviour), so every saved game still replays exactly ([engine.md](engine.md),
   the late game).

## Directory map

```
src/
  engine/         Pure TypeScript, no DOM. Fully unit tested. -- engine.md
    game/         The game: world, tick, roads and the ladder, the informal sector and
                  its pushback, goods chains, industries, growth, money, maps, run files
    economy/      Funds, fares, operating costs, P&L (the game composes it)
    map/          Map types, connectivity, decay; the original's terrain/node generator
                  (kept: its tests cover the simulation the game uses)
    pathing/      Terrain-aware A*, corridor planning, cost breakdown
    paratransit/  Informal one-shot vehicle spawning
    simulation/   Demand, vehicles, congestion, routing
    growth/       Growth state and types (the game's growth is engine/game/growth.ts)
    eras/         types.ts only (calendar eras retired; eras return as vehicle generations)
  game/           The game's page: 2D canvas map (render.ts), panels and cards (main.ts),
                  hints, verdicts, the hand-made map (map.ts) -- render-and-ui.md §7
    styles/       The page's CSS, linked from index.html: tokens.css (every colour the
                  page and the 2D map share), then base, cards, map, screen, fullscreen
  design-lab/     The design lab (dev-only) -- dev-studio.md §4
  info-lab/       The information lab (dev-only): the three layers on a played game -- §5
index.html        The game
design-lab.html, info-lab.html   The labs (dev-only, not build inputs)
public/content/vehicles.json      The original vehicle catalog the game's numbers cite
scripts/game-bots.ts        Bot personas + the brief's measured checks
scripts/game-strategist.ts  A long-game bot: the ladder and the chains to day 250+ (C2, C11, C14, ...)
scripts/game-play.ts        Play from a terminal (an OpenCode player)
scripts/game-run.ts         Read or replay a saved run
scripts/game-probe.ts, corridor-probe.ts, game-lever-audit.ts   Calibration probes
scripts/info-snapshot.ts    A saved run as the information lab's data
docs/
  brief.md        The design contract
  principles.md   Design premise, scope, Findings (the "why")
  architecture/   This directory (the "how it's shaped")
  status.md       What's built, current state, what's next
test/              game.test.ts (the game) + one file per engine foundation module
```

## The tick loop

`src/engine/loop.ts` exposes `SIM_DT = 1/30`. The page (`src/game/main.ts`) runs
`gameTick(world, SIM_DT)` (`engine/game/tick.ts`) as many times a frame as the game speed
asks; each call runs the whole game a step in a fixed order -- demand, your vehicles, the
informal sector, goods and hauliers, money, lanes and strikes, growth, industries, sites --
and returns the events of that step (strikes, sites opening, milestones...), which the page
turns into toasts and the run file records. Detail in [engine.md](engine.md) §game/.

## Build/verify pipeline

- `bun run typecheck` — `tsc --noEmit`, pinned to TypeScript `^5.7` (the `latest` tag is
  an unstable 7.x rewrite with a different, non-classic compiler API that
  `architecture-boundaries.test.ts` depends on — don't upgrade without checking).
- `bun test` — the game's tests and the engine foundation's.
- `bun run build` — `vite build`.
- `bun run verify:bundle` (`scripts/verify-prod-bundle.mjs`) — asserts strings belonging
  to dev-only surfaces are absent from the production bundle (the labs are never build
  inputs). **Adding a dev-only surface means adding a string there.**
- GitHub Actions CI runs all four in that order on push.

## Deploy

The game is hosted on a Coolify VPS, built from the repo's `Dockerfile` (Coolify's
"Dockerfile" build pack, port 80). Stage one installs with Bun and runs `bun run build` and
the bundle check, so a bundle that leaks a dev surface never ships; stage two serves `dist/`
from nginx (`nginx.conf`: `/assets/` cached forever since Vite fingerprints it, `index.html`
`no-cache` so a deploy reaches players at once). The image is ~80 MB and idles at ~15 MB of
RAM. `.git` isn't in the build context, so `vite.config.ts` takes the run files' build stamp
from Coolify's `SOURCE_COMMIT` build arg. Tests and typecheck stay in CI, not in the image.

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
