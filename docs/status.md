# Status

Current state and what's next. This is what a new conversation should read first. For *how*
the code is shaped, see [architecture/index.md](architecture/index.md); for *why*, see
[principles.md](principles.md); lessons live by topic in the architecture deep-dives.
Everything older -- step-by-step measurements, bot runs, handoffs, earlier "what's next"
lists -- is in [status-archive.md](status-archive.md); a reference elsewhere to "status.md, step N" or "status.md, R1 N" from before 2026-10-19 now resolves there.

**581 tests passing** across 48 files (`bun test`). Typecheck / test / build /
verify:bundle all green.

## Where things stand (2026-10-21)

**The contract is [brief.md](brief.md); the slice is a mechanics lab** (principles §2: a
personal sandbox and a foundation to extract an engine from -- done means "the systems work and
hold up under play"). Built and played, in order:

- **Revision 1, the corridor's story:** dirt → paved → bus lane → rail, the union's pushback,
  generated maps.
- **Revision 2, a second economy:** problems named with their move, wear per corridor,
  quarries, rail's own job, private truckers, retiring roads.
- **Revision 3, goods that feel real, in chains** (all built 2026-10-20):
  1. fuel: a tank farm, an idle refinery and crude; shortages raise danfo fares, park danfos,
     raise your costs (`fuel.ts`);
  2. building: limestone → a cement works (working or idle by the seed) → towns, cement
     holding growth past +40% (`cement.ts`); sites employ commuters, make less without them,
     grow camps at their gates (`workers.ts`);
  3. food: farm towns' staple → a mill → market towns, cash crops → the port with an export
     payment, flour from imported wheat at the port; a fed market draws trade (`food.ts`).
- **Money, from the playtests:** goods ₦0.25 a tonne a cell; a 10% levy on earnings instead of
  80% of the surplus; bonds; expanding a site (two more lines); the lorry hint; site
  production gauges; the Treasury drawer.
- **The look picked in the design lab:** glass wings tucked at the edges, contours with names
  on the ground, Mini Metro route lines.

| Check (Revision 3) | State |
|---|---|
| C11 goods matter (20–40% of income by day 100) | Over: 45–60% in play and in the strategist; lorries net ~₦0 between them. Next: the goods/passengers balance |
| C12 a shortage is felt | Built and shown on cards; not measured against a twin |
| C13 rail carries a chain | Crude by freight train paid (+₦694 a day, map 543); payback unmeasured |
| C14 no dead stretch (days 60–150) | Passes in play (longest 13 days, map 2411); **fails after ~day 200** (stretches up to 32 days, ₦100–340k idle) -- site expansion is the first answer, in your playtest now |
| C15 it feels like this place | Yours to answer |

**Revision 4, the late game** (brief): steps 1-3 merged 2026-10-21 -- no player lorries, haulage
yards (Y; a yard at the crude source lets hauliers truck crude), towns expecting service (the
town card's Service line), the budget-year sweep as a trial (the Treasury's countdown). The
strategist on maps 0 and 2411: money held peaks ₦139-175k (was ₦305k), the sweep took
₦85-196k, the bot already meets the expectations; late-game stretches with nothing built
remain -- steps 4-6 (a second refinery, motor parks, a metro) are for that. `scripts/slice-play.ts`
plays the game from a terminal for an OpenCode player.

**Revision 4, step 4, the second refinery: merged 2026-10-21 for your playtest, not yet
settled.** A private refinery opens once, on a seeded day 90-120, by the port and far from the
crude, working but with no road (`fuel.ts` `updateNewRefinery`; a toast that pauses the game
once). It wants crude from the same source, fills what imports and the old refinery leave
short, and sends the rest to the port. Strategist at day 250, without → with: maps 0 and 2411
lay rail for its crude, net +₦0.9-1.4k a day, goods 5-12% of income where it was 0; **map 543
collapses** (people 707k → 321k, trips 2,192 → 681) -- not from crude trucks (a refinery a
twentieth the size collapses the same), but from the site: the strategist chases the commute
to it next to Opobo with 53 minibuses, restores the old refinery (towns ran short of fuel, cause
unknown), and never builds the lane, BRT and rail that grew 543 before. It also makes only
23-46% of its capacity with crude arriving (probably its workers; unchecked). Open, also:
cash-crop exports are paid twice a tick since `a4eeb21` (`payExports` adds to funds, and
`tick.ts` adds it again through the allocation) -- yours to decide; and C17 failed in your
2026-10-21 playtest (the sweep took money saved for rail), which the brief says takes the sweep
out.

**Before that:** your playtest of expansion, exports at ₦20, the look.
In a worktree meanwhile: **the strategist** (`scripts/slice-strategist.ts`), a long-game bot
that plays the ladder and the chains from the game's own advice and measures C2, C11 and C14
on several maps -- the bots in `slice-bots.ts` predate rail and the chains. **Then the
goods/passengers balance** (a decision for you). **Then the slice closes:** the carry-over plan
(brief, Open question 8).

## How to run it

- Play: `bun run dev`, open `/slice.html` (the original game is still `/`). `?seed=N` picks a
  map (0 is the hand-made one); `?dev=1` shows forecasts, receipts and best next moves;
  `?dev=1&funds=N` starts with money, for checks.
- Bots and the brief's checks: `bun scripts/slice-bots.ts` (`BOTS=...`, `CHECKS=0`, `SEED=n`,
  `BOTS_WORKERS=2` by default; 6 only on a machine that can take it).
- One corridor up the ladder: `bun scripts/corridor-probe.ts [days]` (`SEED=n`,
  `REAL_MONEY=1`, `BRT=1`, `LAX=1`, ...).
- A played game: "Save run" (beside "New map") downloads it; `bun scripts/slice-run.ts run.json`
  prints the timeline, what you did, what the game announced and the last day (`--day N` for
  one day in full, `--verify` replays it and checks it reproduces). `?goods=off` and
  `?wear=off` switch those systems off.
- Calibrate: `bun scripts/slice-probe.ts [days]`, with `SLICE_TUNING='{"fare":5}'` to try
  overrides.
- Detail: [architecture/engine.md](architecture/engine.md) §slice/,
  [architecture/render-and-ui.md](architecture/render-and-ui.md) §7.

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
