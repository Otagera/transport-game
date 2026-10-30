> **Retired 2026-10-30:** the labs (design-lab.html, info-lab.html, sprite-lab.html, their
> `src/` folders, `scripts/info-snapshot.ts` and `src/game/sprites.ts`) were discarded; the game
> took what it needed from them long ago. Kept below as history; the code is in git history.

# Dev studio and the `window.dev` console

Everything under `src/dev/`, plus `window.dev` (installed from `main.ts`). Both are
DEV-only surfaces that must be dead-code-eliminated from the production bundle — see
§3 below for how that's actually verified, and a real leak it caught.

> **Retired 2026-10-23 with the 3D game** (§1-3: the studio and `window.dev`; §4-5, the labs, are current). Kept as history; the code is under the git tag `original-3d`. See [index.md](index.md).

## 1. The studio (`?studio=1`)

One dev-only Preact surface, four tabs:

```
[ Tuning ] [ Profile Studio ] [ Asset Modder ] [ Scenario Lab ]
```

- **Tuning** — the original Module 1 style-spec panel (sliders bound to the
  `StyleSpec`, live where possible, regenerating geometry where needed, exporting JSON
  to paste into content). `?tune=1` is kept as an alias that opens the studio on this
  tab, so the original workflow and muscle memory around it keep working.
- **Profile Studio** — an SVG cross-section canvas ruled at 1m with the centre at
  `(0,0)`, preset elements dragged by their vertex handles, and a live 3D sweep
  (`render/studioProfile.ts`, see [render-and-ui.md](render-and-ui.md)). The preview
  sweeps an S-curve with an elevated run rather than a straight test piece, because a
  straight piece hides exactly the failures that matter — fan-out at curvature, frame
  flip at an inflection. Exports a `Profile2DDef` (see [content.md](content.md)).
- **Asset Modder** — drag a `.glb`/`.gltf` in, click the mesh to drop anchor gizmos
  (axle positions, boarding doors, cargo nodes, particle emitters — **placed by
  clicking, not typed**, since a boarding door written as `[0.8, 0.4, -1.2]` is
  unverifiable until something stands in the wrong place at runtime), fill in the
  `VehicleDef` form, write a mod package. Imported models are normalised to a fixed
  framed size so anchors mean the same thing regardless of whether the source was
  authored in centimetres or metres.
- **Scenario Lab** — authors and live-validates a `Scenario` against `ScenarioSchema`
  (see [content.md](content.md)), exports it as JSON. It deliberately does not *apply*
  a scenario — that needed the warm-forward pass, which is `engine/save/scenario.ts`'s
  `applyScenario`/`warmForward` (see [engine.md](engine.md)); this tab only authors the
  definition.

`scripts/studio-mod-writer.mjs` is a Vite plugin with `apply: "serve"` — not a
runtime-gated path but one that **doesn't exist in a production build at all** —
writing `vehicle.json` plus the mesh into `public/mods/<mod_id>/`, with a download
fallback when no dev server is running.

**Bug caught live, Module 11c.** `btoa(String.fromCharCode(...new
Uint8Array(buffer)))` spreads every byte as a separate function argument, so it throws
`RangeError: Maximum call stack size exceeded` once a file exceeds the engine's
argument limit (measured between 64KB and 128KB in V8). The Module 11 live verification
had used a 678-byte hand-built glTF fixture, three orders of magnitude below the
threshold — the first real model anyone loaded blew the stack. Replaced with a chunked
encoder (`src/dev/encodeMesh.ts`); `test/dev-encode-mesh.test.ts` straddles the failing
threshold deliberately (64KB / 128KB / 1MB / 5MB) against `Buffer`'s own encoding.
`FileReader.readAsDataURL` would also work and is native, but Bun has no `FileReader`,
so it couldn't have a regression test pointed at it.

**A quieter bug underneath that one was worse.** `setMeshName(file.name)` ran *before*
the throwing line, so the panel reported "Loaded Train_Track_01.glb" while no bytes had
actually been captured — exactly what the original bug report showed, both messages at
once. "Write mod package" would then have written a `vehicle.json` whose `mesh` named a
file the server was never sent, producing a mod that looks fine on disk and fails
later, somewhere else. Fixed on both sides: the client encodes before touching any
state and only claims `mesh` when it holds the bytes, and the writer refuses the whole
write if `vehicle.mesh` names a file it wasn't sent.

## 2. `window.dev` — the console API (Module 10)

A separate surface from `?studio=1`, installed whenever the build is DEV **regardless**
of that query param, so it's reachable from the browser console alone:
`window.dev.{era, funds, warm, save, load, scenario}`.

- **`era(id)` / `funds(amount)` / `warm(days)` act live** — none of them change
  map/terrain identity, so there's no need to reload. `era()` sets
  `eraTimeline.currentIndex` directly (so, unlike live play advancing through
  `advanceEraTimeline`, it can jump *backward* too) and synthesizes an `EraTransition`
  through the same reaction pipeline a real transition uses. `warm()` calls
  `engine/save/scenario.ts`'s `warmForward` synchronously, then re-runs the same render
  refresh a live transition would trigger.
- **`save()` / `load()` / `scenario(id)` reload the page.** Hot-swapping a running
  scene's map/terrain would need new `setMap`/`setGroundMesh` methods and risks stale
  closures in raycasting/network/authoring — instead, `load()`/`scenario()` stash a
  one-shot `BootOverride` into `sessionStorage` and call `location.reload()`.
  `bootstrap()` consumes that override and calls `restoreIntoState`/`applyScenario`
  **before** constructing `sceneHandle`/`networkHandle`/`authoringController`/
  `fleetController`, then reads `map` back off `simulation.map` (not the freshly
  generated one) so the scene is built from whatever topology actually won. Actual save
  bytes persist in `localStorage`; the boot-override pointer lives in `sessionStorage`
  since it must not survive past the one reload it triggers.

## 3. Why this stays out of production, and a real leak it caught

`scripts/verify-prod-bundle.mjs` runs after `vite build` and asserts a string belonging
to each DEV-only surface (`"preact"`, `"Asset Modder"`, `"GLTFLoader"`,
`"transport-game: dev console ready"`, the boot-override storage key, …) is **absent**
from the built JS. This is an assertion against the actual bundle, not a promise about
a code path — adding a new dev-only surface means adding a string here, or the gate
stops being real.

**Bug caught by `verify:bundle` itself, not by review, Module 10.** The first version
of `window.dev`'s object literal was constructed **unconditionally** at the top of
`bootstrap()`, with only its *installation onto `window`* gated by
`import.meta.env.DEV` inside `maybeMountDevTools`. An object literal built at a
function's top level is never dead code no matter what its methods reference — so
`createSnapshot`/`restoreIntoState` and the boot-override storage-key string shipped
into the production bundle regardless of that inner gate. `verify:bundle` failed
immediately on the exact string. Fixed by moving the *entire* `devApi` construction
(and the `maybeMountDevTools` call using it) inside its own top-level
`if (import.meta.env.DEV) { ... }` in `bootstrap()`, where Rollup can actually prove it
unreachable in a production build and strip it. The lesson generalises: **gating the
installation of a DEV-only object is not the same as gating its construction** — only
the latter is guaranteed to tree-shake.

## 4. The design lab (`/design-lab.html`)

A mock of the slice's screen where every look is a token, for picking the step 8 look
([brief.md](../brief.md), Information design) by trying it. `design-lab.html` holds the
CSS; `src/design-lab/main.ts` holds the option groups (theme, your colour, panel
material, panel pose and tilt angle, docking, one panel or two wings, headline, town
panel, route rows, type, corners, terrain, map plate, the Treasury -- inline, its own left
wing, a drawer above the toolbar, or a drop from the strip's budget -- and control hint) and the presets
(today's slice, the brief's step 8, the video-inspired daylight and night looks).

- **Tokens compose.** An option is a set of CSS custom properties set on `#stage`, or a
  `data-<group>` attribute for options that change structure; the stage's CSS reads only
  those, so any theme works with any pose or dock. Panel tilt and docking are one
  `transform` built from `--tilt-*` and `--dock-*`; hover, focus, a town hovered on the
  map, or a click on the spine (pin) brings a wing out and flat.
- **Real map, made-up state.** Towns, roads, river and hills come from `src/game/map.ts`;
  contours are the engine's own terrain (`buildGameTerrain`, on the map scaled 2× for
  half-cell resolution); trip counts are the engine's gravity demand. Shares, routes and
  money are a fixed mid-game mock: the lab judges looks, not numbers.
- **Verdicts.** Each option takes Keep or Drop; picks and notes save in localStorage
  (`design-lab:v1`), the URL hash carries the look (a link opens it), and Export writes
  markdown with the composed tokens for the brief or another session.
- **Dev-only by construction.** It is not a `vite.config.ts` build input, so `vite build`
  never sees it; `verify:bundle` also forbids its storage key (§3).

## 5. The information lab (`/info-lab.html`)

A mock of the full game's information design ([brief.md](../brief.md), the carry-over plan:
three layers after Subway Builder), started fresh beside the design lab: that one picks how the
slice is styled, this one what the screen says. It runs on a game you played, not made-up
numbers: `bun scripts/info-snapshot.ts run.json` replays a saved run to its last day and writes
`src/info-lab/snapshot.json` -- the run file's own day-by-day summaries (money, the headline,
the budget, routes, towns, events) plus the final map's state (road shapes and loads, town
shares and growth, sites, goods flows, the moves the game names).

- **At a glance** (the map): roads by traffic (width) and how full they run (free, busy,
  jammed), your riders as a blue core along them, towns sized by people with a ring of who
  carries their trips, trend, and an amber mark where there's a problem; overlays one at a
  time (demand, no seat, the informal share, the 25 biggest goods flows); the strip's numbers
  with their trend over 10 days.
- **Side panels:** sortable lists (routes worst first, towns, sites), and one layout for
  whatever you click -- a town, route, site or road: its numbers as tiles, a chart of it
  over time, its problem in one line with its move as a button (a mock).
- **The revenue screen:** income and running costs a day by line (stacked, 5-day average),
  what the treasury took (its levy, and each sweep on its day), net and money held, totals
  since day 1, and the routes' money as a sortable table.
- **The log:** every event of the run, filtered by kind, clickable to its town or site.

Charts follow the dataviz rules: one axis, a hover crosshair with every value, a legend with
values (the light-mode aqua sits under 3:1 contrast, so labels carry it). Dev-only: not a
`vite.config.ts` build input.
