# Status

Current state and what's next. This is what a new conversation should read first. For *how*
the code is shaped, see [architecture/index.md](architecture/index.md); for *why*, see
[principles.md](principles.md); lessons live by topic in the architecture deep-dives.
Everything older -- step-by-step measurements, bot runs, handoffs, earlier "what's next"
lists -- is in [status-archive.md](status-archive.md); a reference elsewhere to "status.md, step N" or "status.md, R1 N" from before 2026-10-19 now resolves there.

**542 tests passing** across 48 files (`bun test`). Typecheck / test / build /
verify:bundle all green.

## Where things stand (2026-10-19)

**The contract is [brief.md](brief.md).** Slice zero is closed (a one-time recorded exception:
the brief, Revision 1). **Revision 1, the corridor's story, is built and played**: a corridor
climbs dirt → paved → bus lane → rail as its towns outgrow each rung; the bus lane brings the
union's pushback (strikes, announced and answerable: Settle or Relax); the treasury, the
score and each corridor's informal share are visible; each game is a generated map (seed 0 is
the hand-made one). Eras stay paused.

| Check | State |
|---|---|
| C1, a rung buys time | Passes: dirt 35, paved 29, lane 35, rail 27-37 days of growth |
| C2, money makes you wait | Prices pass on the hand-made map (lane 14 days of surplus, rail 35.3); on generated seeds lane 13.8-19.4, rail 34.3-43.3 (seed 3 past 40). The waiting rule is unmeasured: the bots don't build lanes, BRTs or rail |
| C3, each enforcement choice wins somewhere | Passes: strict on the trunk, no lane on a modest corridor |
| C4, some corridors climb, not all | Rail by day 122 (hand-made); day 141-156 on generated seeds (two just past 150). The "at most half past paved by day 100" part is unmeasured (bots) |
| P7, a story to tell | By the playtest, a map's story: "Ido started as the largest but Ikire turned out to be the connecting hub" |
| P8, the second game differs | By the playtest: "it did feel different". Bots: (a) passes; (b) 2 of 3 generated seeds |

Last played 2026-10-19, a generated map to day 210 (principles.md §6): it felt different, and
it ended at "nothing more to build" -- every town connected, roads upgraded, rail laid, money
binding only at the top rung. Read: stopping here is "Mini Metro with money"; the map asks
for a fixed amount of building and then nothing new.

Open, not built: the bots don't play the ladder (C2's waiting rule, C4's first part, day-60
M1 under Revision 1 all unmeasured; no full bots run since rail came on); taking a corridor
costs ₦1-10 a day against the brief's 20-40% (parked); rail reshaping the map, proposed in
the brief, now folded into Revision 2.

## Next: play Revision 2, step 1, past day 150

**Agreed 2026-10-19:** step 1 first and alone, and the informal hook in goods (truckers
included; principles.md §3 amended in spirit). **Step 1 is built** (`problems.ts`; brief,
Revision 2, Step 1): a shrinking town says why and names the move ("you carry 6% of its trips,
down from 14% on day 120; it grows only above 10%" · the bus back); a town's no seat names the
trip most of it wants, the road, and the move with its price; the Corridors section lists
no seat worst first with the same moves; the map draws no seat as a grey band beside each
corridor. C5's measure (`namedMoves`, `affordable`) prints in the corridor probe from day 150: on the
hand-made map to day 210, a move named and affordable on 61 of 61 days -- but that player serves
one corridor, so the rest of the map's problems are its own; the real C5 is your playtest.

**Your playtest:** a generated map past day 150. Bring back: does the screen still ask for a
move then, and do you make one you can say why you made (C5)? Its answer sizes the rest of
Revision 2: alive, and goods may be smaller than drafted; still "nothing more to build", and
the second economy has earned its place.

### What the draft was asked to cover (agreed to draft 2026-10-19)

From the R1 7 playtest (principles.md §6): the slice ends at "nothing more to build", and
stopping here makes it "Mini Metro with money". Draft brief Revision 2 as **Proposed**, in the
brief's own form (what changes, the order, checks like C1-C4, decisions-log rows). Build nothing
until the user marks it Agreed. What it should cover:

- **Goods and industries: a second reason to build.** Industries that open and close (quarry,
  mill, factory...), wanting inputs in and output to the port or towns; when one closes, its line
  goes quiet. Goods return from slice zero's step 4 (lorries, freight trains, the port;
  `goods.ts`, switched off). New problems keep arriving after every town is connected, without
  flooding the map with towns (user taste: towns appear over time, not a flood).
- **Rail gets a job of its own:** freight is heavy and long, so rail lines become a choice
  (this corridor carries ore, that one people), not a faster bus everywhere. Absorbs the
  proposed (4), rail reshaping the map (station towns grow, new desire lines).
- **A second ladder:** an industry's dirt track → paved → lorries → a rail spur.
- **Wear, made easy to do:** per corridor, never per piece -- a "Keep it up" switch with its
  cost a day; off, the road visibly wears and slows and the town card says why; one "Fix all on
  this corridor". The parts exist in `wear.ts`.
- **Removing what you built (user's ask):** routes can already go (selling a route's last
  vehicle closes it, `removeBus`); roads can't. Propose a verb to retire a road -- its upkeep
  stops, towns that relied on it lose access, the danfos lose ground (brownfield: removal has
  consequences) -- and replacing a road with rail on the same alignment (the road retired, the
  track laid cheaper along its earthworks).
- **Where is the hook in the second economy?** Paratransit is passengers-only (principles.md
  §3, Paratransit), so goods as they stand have no antagonist. Propose how the informal
  sector stays central to goods: lorries sharing and jamming the corridors with danfos and
  buses; private truckers as freight rivals (taking the loads you don't, undercutting the
  ones you do); market levies and touts at the markets and the port. Keep principles.md §1:
  informal transport stays an antagonist, never a subsystem.
- **Legibility before new content: R2's first step.** At day 210 the playtest had 2,865 trips
  a day with no seat and three towns shrinking, yet "nothing more to build". Propose making
  those visible and fixable -- a problem line on the town card (why it's shrinking, what
  would fix it) and on the corridor (where riders find no seat, what would carry them) --
  before any goods content, measured by whether the game still asks for a move at day 150+.
- **Settlements priced by what the corridor is worth**, not half a strike's estimated cost
  with a ₦150 minimum (`settlementPrice`, pushback.ts): a settlement should cost in proportion
  to the corridor's value to you, so paying off the union is a real choice on a busy corridor.
- **Checks:** how the playtest knows it worked: the game still asks for a move after every
  town is connected (e.g. day 150+); a rail line is a choice (passenger vs freight); upkeep
  takes a decision per corridor, not clicks per piece.

**After the draft:** the user marks what they agree with; the two questions that matter most
are whether the informal-sector answer for goods (truckers, market touts) feels like their
game, and whether "show the problems first" really comes ahead of any goods. Then build
**only that first step** and play it past day 150. That playtest sizes the rest of Revision 2:
if the late game comes alive with problems made visible, goods may be smaller than drafted;
if it still ends at "nothing more to build", the second economy has earned its place.


## How to run it

- Play: `bun run dev`, open `/slice.html` (the original game is still `/`). `?seed=N` picks a
  map (0 is the hand-made one); `?dev=1` shows forecasts, receipts and best next moves;
  `?dev=1&funds=N` starts with money, for checks.
- Bots and the brief's checks: `bun scripts/slice-bots.ts` (`BOTS=...`, `CHECKS=0`, `SEED=n`,
  `BOTS_WORKERS=2` by default; 6 only on a machine that can take it).
- One corridor up the ladder: `bun scripts/corridor-probe.ts [days]` (`SEED=n`,
  `REAL_MONEY=1`, `BRT=1`, `LAX=1`, ...).
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
