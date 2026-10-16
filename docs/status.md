# Status

Current state of the codebase, and what's next. This is what a new conversation should
read first. For *how* the code is shaped, see [architecture/index.md](architecture/index.md);
for *why*, see [principles.md](principles.md); for detailed bug write-ups and design
lessons, see the relevant architecture deep-dive — they're indexed by topic there, not
buried in a chronological log here.

**404 tests passing** across 48 files (`bun test`). Typecheck / test / build /
verify:bundle all green.

## Current direction: the slice

The project reset on 2026-10-16 — see [principles.md](principles.md) §6 for why and the
step plan. Eras are paused. The slice is a second page beside the original game:

- Play: `bun run dev`, open `/slice.html` (the original game is still `/`).
- Calibrate: `bun scripts/slice-probe.ts [days]`, with `SLICE_TUNING='{"fare":5}'` to try
  overrides.
- Detail: [architecture/engine.md](architecture/engine.md) §slice/,
  [architecture/render-and-ui.md](architecture/render-and-ui.md) §7.

| Step | What | State |
|---|---|---|
| 1 | Smallest loop: towns, roads, buses, giving up, danfos, money, share | Played once: the loop reads; needed 1b |
| 1b | Legibility: desire lines on hover, per-route diagnosis | Played to day 61: reads well |
| 1c | Towns grow along busy roads you serve; rarely fade | Played: one town in 61 days |
| 1d | Transfers: riders change buses at interchanges; fare per leg | Played to day 91: works; beat the danfos |
| 1e | Kekes and okadas take riders who won't wait for a danfo | Played: works (to day 18) |
| 2 | Shared road: flow-based congestion; traffic drawn on roads | Built, **not yet played** |
| 2b | Running cost that bites: thin routes lose, trunk peaks at 2 buses | Built, **not yet played** |
| 2c | Pave a dirt road: Road tool on two joined towns; 1.7× the traffic | Built, **not yet played** |
| 2d | Inside towns: kekes' and okadas' own ground, shown as such; they feed your buses | Built, **not yet played** |
| 3 | A place to build in: river, ridge, terrain-priced roads, bridges | Built, **not yet played** |
| 4a | Decay: roads wear with use; the Fix tool keeps a road up for daily upkeep | Built, **not yet played** |
| 4b | Growth of the original towns: served well, a town grows (to +50%) and makes more trips | Built, **not yet played** |
| 4 | Depth, one at a time: goods, rail (decay 4a, growth 4b done) | — |

Engine fixes found along the way, affecting the original game too: cyclic vehicles never
loaded passengers whose destination lay behind the path's wrap-around, so every A↔B route
ran its return leg empty; and the first fix overshot, letting mid-route riders board a bus
heading the wrong way ([principles.md](principles.md) §3, Vehicles).

## What's built (the original game, Modules 0–12)

The original rebuild plan's module order (Module 0 → 10) is complete, followed by two
modules added after the plan was written (11, 12). Everything below has shipped and is
live-verified; each links to where its detail actually lives now.

| # | Module | Delivered | Detail |
|---|---|---|---|
| 0 | Foundation | Repo + remote from commit one, fixed-timestep loop, content-loading skeleton | [architecture/index.md](architecture/index.md) |
| 1 | Visual foundation + tuning panel | Style spec, diorama treatment, orthographic camera, DEV-only tuning panel | [architecture/render-and-ui.md](architecture/render-and-ui.md) §1, [architecture/dev-studio.md](architecture/dev-studio.md) §1 |
| 2 | Terrain and map generation | Seeded deterministic generation, node placement, inherited network, hard-asserted connectivity | [architecture/engine.md](architecture/engine.md) §map/ |
| 3 | Simulation core | Demand pairs, node queues, conveyor-model vehicles, A* routing, stranded computation | [architecture/engine.md](architecture/engine.md) §simulation/ |
| 4 | Chain-of-nodes + terrain pathing + authoring | Corridor-as-node-chain refactor, terrain-aware A*, RDP + Catmull-Rom smoothing, interactive authoring | [architecture/engine.md](architecture/engine.md) §pathing/, [architecture/render-and-ui.md](architecture/render-and-ui.md) §3 |
| 5 | Bridges and levels | Bridge "jump" edges, span cap, segment levels, bridge rendering | [architecture/engine.md](architecture/engine.md) §pathing/, [architecture/render-and-ui.md](architecture/render-and-ui.md) §3 |
| 6 | Economy + vehicle catalog | Fares, revenue-on-unload, per-tick operating cost, depreciated resale, P&L | [architecture/engine.md](architecture/engine.md) §economy/ |
| 7 | Congestion + paratransit | Per-segment weighted load, EMA-gated one-shot spawning, corridor/pair caps | [architecture/engine.md](architecture/engine.md) §simulation/, §paratransit/ |
| 8 | Eras | Four compressed eras, five threaded modifiers, graceful obsolescence, rail dark period | [architecture/engine.md](architecture/engine.md) §eras/ |
| 9 | Growth | Logistic demand growth, paratransit-discounted service ratio, tier promotion | [architecture/engine.md](architecture/engine.md) §growth/ |
| 10 | Save/load and scenarios | Versioned snapshot, scenario content + warm-forward, `window.dev` console | [architecture/engine.md](architecture/engine.md) §save/, [architecture/dev-studio.md](architecture/dev-studio.md) §2 |
| 11 | Dev studio + information architecture | Six-homes UI refactor, `?studio=1` (Tuning/Profile Studio/Asset Modder/Scenario Lab) | [architecture/render-and-ui.md](architecture/render-and-ui.md) §2, [architecture/dev-studio.md](architecture/dev-studio.md) §1 |
| 11b | Profiles applied to the map | Authored cross-sections drive real corridor rendering, decay, and cost | [architecture/render-and-ui.md](architecture/render-and-ui.md) §4, [architecture/content.md](architecture/content.md) |
| 12 | Ambient private traffic | Prosperity → private cars → road friction, closing the growth/congestion loop | [architecture/engine.md](architecture/engine.md) §simulation/ |

## What's next

**Played 2026-10-16 to day 14** (steps 2–4b together): *"felt stuck, didn't know how to get
out of debt."* Fixed: the routes panel now names the way out when money runs low (which
buses to sell, for how much, saving how much a day), and a full route asks for a bus
before it mentions wear. Details in principles.md §6's playtest log.

**Play again.** Questions to bring back:

- When money ran low, did the panel's way out read, and did it get you out?
- Does piling buses onto the trunk hurt, and does traffic read on the map?
- Is money a constraint now (a bus costs ~₦105/day), or a grind?
- Is paving found, and worth it where buses run full?
- Does "Inside <town>" read as informal's ground, not a loss?
- Do the river and the ridge make you think about where to build — and do bends read as a
  longer trip? (Last time the Ikole bridge got a Kuto shuttle; a bus from Ilase through
  Kuto earns far more, and nothing says so.)
- Is choosing which roads to maintain a decision, or does everything (or nothing) get kept?
- Does a growing town (▲) read as a place developing, or as a treadmill of queues? Is money
  loose again by day 40?

Write down what was felt before changing anything (principles.md §6's playtest log). Open
after that: pointing at through-routes; a formal town-service tier (§5, "make it fixable")
if play wants inside-town trips; "hold the line" road alignment once a straight line is
priced as a line; then goods or rail.
