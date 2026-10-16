# Status

Current state of the codebase, and what's next. This is what a new conversation should
read first. For *how* the code is shaped, see [architecture/index.md](architecture/index.md);
for *why*, see [principles.md](principles.md); for detailed bug write-ups and design
lessons, see the relevant architecture deep-dive — they're indexed by topic there, not
buried in a chronological log here.

**364 tests passing** across 48 files (`bun test`). Typecheck / test / build /
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
| 1e | Kekes and okadas take riders who won't wait for a danfo | Built, **not yet played** |
| 2 | Shared road: congestion between danfos and buses | — |
| 3 | A place to build in: terrain, pathing, bridges | — |
| 4 | Depth, one at a time: growth, decay, goods, rail | — |

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

Play 1e: does the informal sector now hold its ground against a dense network? Money is
known to be loose; step 2 (congestion) is the planned answer — 34 buses plus swarms of
okadas on shared roads should start to cost. Step 1's question is in principles.md §6. Whatever the answer, write down what was
felt before changing anything — then step 2, or back to step 1's model if the loop didn't
hold.
