# Status

Current state of the codebase, and what's next. This is what a new conversation should
read first. For *how* the code is shaped, see [architecture/index.md](architecture/index.md);
for *why*, see [principles.md](principles.md); for detailed bug write-ups and design
lessons, see the relevant architecture deep-dive — they're indexed by topic there, not
buried in a chronological log here.

**472 tests passing** across 48 files (`bun test`). Typecheck / test / build /
verify:bundle all green.

## Current direction: slice zero

**The contract is [brief.md](brief.md)** (2026-10-17): you are the state's transport arm;
money is a budget (fares, tolls, park levies, a state allocation), not the score; the
headline is trips made and who stayed home. Its build order for slice zero and its
pass/fail checks (M1-M9, P1-P6, A1-A3) are what work is measured against now. Read it
right after this file. Progress on that build order:

| Brief step | What | State |
|---|---|---|
| 1 | Brief into the repo, linked from CLAUDE.md and here | Done |
| 2 | Bot personas in the probe: baseline on today's game, M1-M9 | Done: baseline below |
| 3 | Switches in tuning.ts for wear, goods, rail, the straight alignment | Done: results below |
| 4 | Warm-up: 5 game days before day 1 | Done: results below |
| 5b, part 1 | Danfo road space released per segment; your vehicles' road space counts against the same budget | Done: results below |
| 5b, part 2 | The shared informal budget by surface: dirt 9, paved 15 | Done: results below |
| 5 | Riders respond to price | Next |

**Step 5b part 2, 2026-10-17.** Each road's informal budget (your road space included) now
depends on its surface: `informalRoadSpaceDirt` 9, `informalRoadSpace` (paved) 15, via
`tick.ts` `informalBudget`. Tuned to targets, not to the raw capacity ratio (0.6 against
1.6 would evict every danfo at 4 dirt buses). Same setup as part 1; the trunk dirt, or paved:

| Trunk | Buses | Below half speed | Yours | Danfo trips on the trunk | Trips a day |
|---|---|---|---|---|---|
| dirt | 0 / 2 / 4 / 8 | 0 / 16 / 4 / 4% | 0 / 87 / 182 / 246 | 99 / 62 / 52 / 22 | 389 / 583 / 652 / 633 |
| paved | 0 / 2 / 4 / 8 | 0 / 0 / 0 / 0% | 0 / 140 / 234 / 304 | 101 / 81 / 61 / 40 | 547 / 813 / 812 / 823 |

Targets, all met: dirt idle below half ≤ ~25% (0%); dirt with 2 buses ≤ ~30% (16%) and
your riders ≥ 78 (87); dirt with 4 buses, danfos ≥ a quarter of their no-bus trunk trips
(52 of 99); paved with 2 and 4 buses ≤ ~10% (0%), with more danfo trips and more trips in
all than dirt. Dirt budgets tried: 12 (2 buses jammed 63% of the time), 11 (55%), 10 (77
riders), 7 (danfos at 30 of 98, marginal), 5 (danfos all but evicted). Paved 12-20 all met
the targets: on a paved road demand, not road space, limits the danfos; 15 is dirt's 9 by
the capacity ratio.

Two cautions. Trips a day over days 21-25 swing by about ±50 between near-identical runs
(roadside towns found at different moments), so read total-trip differences under that
as noise. And the smaller dirt budget carries fewer people where you've built nothing:
with no buses, 389 trips a day against 504 at the old 12. The bots haven't been re-run
since (they run hot); every M check above predates parts 1 and 2.

**Step 5b part 1, 2026-10-17.** A danfo held road space on its whole path from dispatch
until its trip completed, so a long run kept its share of the trunk long after leaving it,
and a new long road could lower trips made. Now `reapInformal` gives back each segment
once the danfo is past it, and your vehicles' road space counts against the same budget
(rule 3 below: one road, one budget). From a 5-day warm-up, days 21-25, slice zero, with
roads to Ilaro and Ikole plus Ilaro-Ipaja and Ikole-Ise, and your buses on Ilase-Owode:

| Rule | Trips a day (0 / 2 / 4 / 8 buses) | Yours (2 / 4 / 8) | Danfo trips on Ilase-Owode (0 / 2 / 4 / 8) | Trunk below half speed (2 / 4 / 8) |
|---|---|---|---|---|
| 1. hold the whole path (old) | 457 / 628 / 711 / 760 | 134 / 224 / 289 | 94 / 54 / 42 / 34 | 0 / 0 / 3% |
| 2. release per segment | 504 / 669 / 745 / 824 | 72 / 149 / 180 | 100 / 83 / 73 / 73 | 81 / 84 / 94% |
| **3. release, yours in the budget** | 504 / 655 / 717 / 718 | 78 / 163 / 225 | 100 / 76 / 57 / 46 | 63 / 37 / 34% |
| 4. release, `informalMinSpeed` 0.5 | 504 / 751 / 844 / 872 | 83 / 162 / 223 | 100 / 92 / 91 / 75 | 30 / 37 / 69% |

Rule 3 chosen. Rule 4 matched it on your riders but not on winning the road back: the
danfos on the trunk barely fall as you add buses, and at 8 buses the trunk jams twice as
often. Releasing per segment fixes the anomaly (idle 359 → 354, unchanged; road Ilaro-Ipaja
−62 → +31 trips a day against idle), and total throughput never collapses. Holding the whole
path had been an accidental second cap on the trunk; without your vehicles in the budget,
danfos filled the trunk around your buses. Still open for part 2: with 2 buses the trunk is
below half speed 63% of the time under rule 3 -- the shared budget should scale with road
capacity (dirt against paved), not be one number for every road.

**Bots baseline, 2026-10-17** (`bun scripts/slice-bots.ts`, ~5 min; Greedy forecasts every
affordable move daily in a worker pool against one shared do-nothing twin). The game as it
stood before slice zero changed anything. Headline per game day at day 40 (trips made / no
road / no seat / your riders), and mean net over days 36-40:

| Persona | What it does | Day 40 | Net/day |
|---|---|---|---|
| idle | nothing | 309 / 211 / 164 / 0 | ₦0 |
| naive | a bus on the two biggest towns a road joins, every 3rd day | 605 / 274 / 315 / 300 | −₦34 |
| builder | roads to cut-off towns, a minibus to each, then naive | 716 / 0 / 506 / 399 | ₦132 |
| roads only | roads to cut-off towns, nothing else | 309 / 0 / 357 / 0 | ₦0 |
| overbuilder | a bus on every pair on day 1 | 422 / 242 / 273 / 123 | −₦144 (₦−4,086 funds) |
| greedy | the best forecast move it can afford, daily | 825 / 106 / 527 / 561 | ₦90 |

| Check | Result | Measured |
|---|---|---|
| M1 opening variety | FAIL | days 16-20 net: builder ₦227, greedy ₦74, naive ₦5, roads ₦0, overbuilder −₦101 |
| M2 building pays | FAIL | road to Ilaro or Ikole plus a bus or minibus: none pays back in 60 days |
| M3 paving | FAIL | paving the trunk or a quiet road alone never pays back (no tolls) |
| M4 headline moves | FAIL (narrowly) | greedy lifts trips 167% over idle, but no road falls 211 → 106: 50.2%, not half |
| M5 tension | PASS | most riders greedy, most money builder |
| M6 no one-verb win | FAIL | naive (bus only) is top three on both, of only five players |
| M7 warm start | FAIL | informal share 0% at the start, 50% by day 10 |
| M8 signal over noise | FAIL | best day-10 bus adds 12.5 trips/day; doing nothing jitters 9.4 |
| M9 success reads | PASS | no strategy grows towns while trips made falls |

What it says, before anything changes:

- **Doing nothing decays.** Idle's trips fall 336 → 309 as roads wear and danfos slow;
  no seat rises 127 → 164.
- **A road alone carries almost nobody.** Roads only clears "no road" but trips made end
  where idle's do: the danfos that come don't fill the new demand. Building pays only with
  vehicles on it, which is what tolls and the allocation are for (M2, M3).
- **The Evidence guess holds.** Naive's towns grow, trips rise 432 → 605, and no seat
  rises 135 → 315 with them: growth outruns seats. The split shows it; a share hid it.
- **One day's net is noise.** Five buses' daily net swings between −₦2 and −₦255 on the
  same network (ledger checked against funds: they agree). The checks rank strategies by
  mean net over 5-10 days; the strip's "net, last day" has the same problem for the player.
- **Six personas make M1 and M6 coarse.** Top three of five players is most of them. More
  openings come with the later steps, when the checks start to pass.

**Step 3, slice zero switched on, 2026-10-17** (wear, goods, rail and the straight alignment
off; `?systems=all` on the page, `ALL_SYSTEMS_ON` in scripts). The headline is now a 5-day
average (brief, What doing well means), and the bots pick roads by trips unlocked per
naira, measured over days 6-10 after building against a twin, not the cheapest road.
Run time ~18 min, Greedy ~15 of it.

| Persona | Day 40 (trips / no road / no seat / yours) | Funds, day 40 | Net/day, days 36-40 |
|---|---|---|---|
| idle | 364 / 211 / 109 / 0 | ₦2,500 | ₦0 |
| naive | 607 / 274 / 294 / 268 | ₦6,892 | ₦134 |
| builder | 843 / 0 / 417 / 406 | ₦17,485 | ₦881 |
| roads only | 428 / 0 / 265 / 0 | ₦1,193 | ₦0 |
| overbuilder | 494 / 249 / 227 / 132 | ₦7,409 | ₦180 |
| greedy | 1,163 / 112 / 362 / 771 | ₦38,590 | ₦1,915 |

| Check | Baseline | Slice zero | Measured |
|---|---|---|---|
| M1 | FAIL | FAIL | days 16-20: greedy ₦1,397, builder ₦617, naive ₦376 |
| M2 | FAIL | FAIL | Ilaro-Ilase (+26 trips/day) or Owode-Ikole (+25) plus a bus or minibus: neither pays back in 60 days |
| M3 | FAIL | FAIL | paving alone never pays back (no tolls) |
| M4 | FAIL | FAIL | greedy (most trips) leaves no road at 112 of 211; builder passes both halves (843 trips, no road 0) |
| M5 | PASS | FAIL | greedy carries the most and earns the most: without tolls and levies there's no tension |
| M6 | FAIL | FAIL | naive (bus only) in both top threes |
| M7 | FAIL | FAIL | informal share 0% at the start, 53% by day 10 (step 4 is for this) |
| M8 | FAIL | PASS | on the 5-day average: best day-10 bus +30.1 trips/day against jitter 3.4 |
| M9 | PASS | FAIL | overbuilder: towns grow, trips fall 509 → 494 from day 20 to 40 |

What switching them off did:

- **Money got loose.** Greedy ends day 40 with ₦38,590 against ₦354 with everything on;
  builder ₦17,485 against ₦1,429. Rough roads and wear were the game's money sink; without
  them the budget stops being a constraint by day 15 or so. Step 6 re-tunes running costs
  under fares by distance, and step 7's income lines land on top: both need this in mind,
  or slice zero has no money decision after the opening.
- **Doing nothing holds steady** (364 trips a day at days 10, 20 and 40) instead of decaying:
  the decay was wear. The brief wants exactly this for idle.
- **Roads alone do more.** Roads only reaches 428 trips against idle's 364 (+18%), against
  +0% with wear on.
- **The cheapest road is not the road.** Ranked at day 0 by trips unlocked over days 6-10:
  Ilaro-Ilase +26 a day for ₦457, Owode-Ikole +25 for ₦744, Ado-Ikole +14 for ₦450,
  Kuto-Ikole +16 for ₦581; Ikole-Ogbe (cheapest from Ikole, ₦430) −7. Measured too early
  (days 3-5) the ranking is mostly the cold start: Kuto-Ikole read −7 there, +15 by days 16-20.
- **Open: some roads make fewer people travel.** Ilaro-Ipaja costs ₦1,103 and takes 60-80
  trips a day off the network for at least 20 days; Ilaro-Ogbe −94 at days 3-5. Likely the
  danfos' road-space budget: a long new corridor ties danfos up on long trips. To look at
  with step 5b (road space scaled by road capacity), which touches the same budget.

**Step 4, the warm-up, 2026-10-17.** The world runs 5 game days before day 1
(`start.ts`); those days count toward neither the day counter nor money, and the 5-day
averages start filled from them (`history.ts`). Bots now also include **trips-greedy**
(best trips made per naira, losses allowed, saves for its best move; 60 days) and check
**M10**. Run time ~30 min (Greedy ~21, trips-greedy ~7).

| Persona | Day 40 (trips / no road / no seat / yours) | Funds, day 40 | Net/day, days 36-40 |
|---|---|---|---|
| idle | 372 / 211 / 109 / 0 | ₦2,500 | ₦0 |
| naive | 648 / 274 / 275 / 297 | ₦7,511 | ₦231 |
| builder | 852 / 0 / 421 / 417 | ₦22,208 | ₦958 |
| roads only | 448 / 0 / 245 / 0 | ₦1,299 | ₦0 |
| overbuilder | 528 / 250 / 204 / 137 | ₦7,131 | ₦195 |
| greedy | 1,188 / 113 / 397 / 827 | ₦36,624 | ₦1,776 |
| trips-greedy | 1,027 / 0 / 439 / 634 | ₦7,257 | ₦622 |

| Check | Step 3 | Step 4 | Measured |
|---|---|---|---|
| M1 | FAIL | FAIL | days 16-20: greedy ₦1,444, builder ₦755, naive ₦366, trips-greedy ₦365 |
| M2 | FAIL | FAIL | Owode-Ikole (+54 trips/day) or Ilaro-Ilase (+35) plus a bus or minibus: no payback in 60 days |
| M3 | FAIL | FAIL | paving alone never pays back (no tolls) |
| M4 | FAIL | FAIL | greedy leaves no road at 113 of 211; builder and trips-greedy clear it to 0 |
| M5 | FAIL | FAIL | greedy carries the most and earns the most |
| M6 | FAIL | PASS | seven players now; naive is no longer in both top threes |
| M7 | FAIL | **PASS** | informal share 55% at the start, 52% on day 10 |
| M8 | PASS | PASS | best day-10 bus +14.8 trips/day against jitter 4.5 |
| M9 | FAIL | FAIL | overbuilder: towns grow, trips fall from day 20 to 40 |
| M10 | — | FAIL | trips-greedy waited on money 1 of 46 days (15-60) and ends day 60 with ₦8,359 |

- **The warm start works (M7).** Day 1 opens with danfos running and the informal share
  where it stays.
- **Money doesn't limit the score (M10).** Even a player who buys trips regardless of
  profit is almost never short of money after day 15: building trips is profitable on its
  own. Step 7's income lines would make this worse, not better; the routine upkeep the
  brief proposes, or re-tuned running costs (step 6), have to supply the constraint.
- **Day-1 forecasts, warmed** (`START=warm bun scripts/coldstart.ts`): with every system on,
  the three routes the cold forecast called winners and that lost are now forecast to lose.
  In slice zero the 2-day forecast is cautious instead: it can't see growth (Ilase-Owode
  forecast +₦51/day, earns +₦140-199; Ise-Ipaja forecast −₦13, earns ~+₦50).

## The slice so far

The project reset on 2026-10-16 — see [principles.md](principles.md) §6 for why and the
step plan. Eras are paused. The slice is a second page beside the original game:

- Play: `bun run dev`, open `/slice.html` (the original game is still `/`). Slice zero has
  wear, goods, rail and the straight alignment off; `/slice.html?systems=all` turns them on.
- Bots and the brief's checks: `bun scripts/slice-bots.ts` (`BOTS=naive,idle`, `CHECKS=0`).
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
| 4c | Goods: produce to market, supplies from Ilase; lorries pay where goods go both ways | Built, **not yet played** |
| 4d | Rail: an old export line to restore, or new track through the towns; passenger trains | Built, **not yet played** |
| 4d+ | Track wear: trains wear track; slow orders on worn track; the Fix tool keeps it up | Built, **not yet played** |
| 4d++ | Goods trains + export: markets send produce on to the port; freight on track | Built, **not yet played** |
| — | Alignment: build roads and track straight (pay the climb) or the cheapest way | Built, **not yet played** |
| 4 | Depth, one at a time: decay, growth, goods, rail — all built (4a–4d) | Built, **not yet played** |

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

## Handoff (cloud session → laptop, 2026-10-16)

Everything is committed and pushed on `slice`; the working tree is clean. This session built
steps 2b through 4d++ and alignment (table above), then answered toolbar feedback:

- A refusal keeps the price in view ("can't afford it" no longer hides what the train costs).
- The toolbar is grouped by purpose: On roads (Bus, Lorry), On rail (Train, Freight), Build
  (Road, Track), Line (Cheapest | Straight switch), Upkeep (Fix), Time.
- The key never covers the map: the map's bottom inset is measured from the toolbar and the
  open key, and the key stacks above the toolbar on narrow windows.

The next step is the user's playtest — nothing is mid-build. Check UI changes in a real
browser: `bunx vite --port 5199`, open `/slice.html`.

## What's next

**Lever audit, 2026-10-17** (`bun scripts/slice-lever-audit.ts`: each lever pulled in one of
two identical deterministic worlds; the difference is its effect on every number the page
shows). The user played to here and called it good; this is the start of making levers read:

- The strip's net/day jitters ±₦135/day on its own; no lever moves it more than that, so
  it can't show whether an action worked. Route rows settle in 1.5–2 days, lorries in ~5.
- Shares (town rings, the strip bar) are the clean, fast signals: visible within a day.
- Only buses and lorries pay (5–8 days). Pave pays in 80–175 days; fix never (−₦88/day net
  on the trunk, informal gains more than you); both trains lose money at mid-game.
- Selling a bus leaves no trace of its saving; pave and fix predict but never report back;
  waiting dots don't respond to one route.
- A roadside town splits a road, after which paving it by its end towns is refused
  ("no road joins them directly").

**Track 1 built (not yet played):** the strip and route rows read an exact rolling
one-day ledger ("Net, last day"); every action gets a **receipt** two game days later —
the world copied just before the action and run without it, so the difference is the
action's own (money/day, payback, share and town rings it moved), listed under Results in
the routes panel; and paving and fixing work on a whole road through roadside towns. First
receipts in the browser say buses are marginal early (+₦10–20/day on ₦500 at day 3–4) —
an input to track 2.

**Track 2 started (not yet played):** worn roads now raise your road vehicles' running cost
(up to +70% at the floor), roads start sound (0.95) so your own traffic wears them, and bus
and lorry running costs came down to match (₦90/day, ₦108/day). Audit, 20 days on: a bus on
the busy route pays back in ~10 days, a thin new route ~17; maintaining a road 3 of your
buses use ~10, paving it ~9; maintaining a danfo-only road earns nothing; a lorry ~20 days
on dirt, ~5 paved. The Fix hover and the worn-route reason put both numbers side by side
(what the wear costs you, what upkeep costs). Rail: new track through the towns pays
(+₦212/day, ~27 days on ₦5.6k). Restoring the old line always lost (−₦78/day), so — the
user's pick — it gained **halts** (Track tool, click a town the line passes twice: a short
spur in, ₦300 + the spur) and a **narrow-gauge speed limit** (55% of new track). Now: old line
to Owode via a halt +₦249/day (~12 days), new track +₦312 (~10), whole old line to Ipaja
+₦145 (~22). **Freight isn't dead, it's a trunk business:** added to track your passenger
trains already use (Ilase–Owode–Ado) it pays back in ~16 days (+₦155/day); on the old line
via the halt it breaks even; on the old line alone it loses. No economic change needed — the
audit's original verdict tested it in its worst setting. Lorries on dirt now lose over 20
days (they wear roads hardest) and pay in ~7 paved; their route reason gained a "worn"
verdict naming the roads to pave.

**Playtest, day 31: "what am I doing wrong?"** — ₦326, one bus on a long direct road to Ado
(full, yet −₦47/day), two new roads that earned nothing, buses sold under debt pressure. The
panel had told them to add a bus. Fixed, all three:
- a **"long" verdict**: full, yet a full bus takes less than it costs to run — says the
  route is too long for flat fares, how many round trips a bus makes, and the stop to end it
  at instead (never "add a bus" when another would lose too);
- the **road preview** says a road earns no fares itself;
- a **forecast** on every build preview (and the Fix hover): the receipt the action would get,
  computed before the click in a worker — "+₦47/day, pays back in ~11 days, your share +4pp".

**Playtest, day 11: broke again** — a bus on every existing road, the forecast unread at 4×.
Forecast at the start: only 7 of 21 first buses pay; the best are through-routes via Ilase.
Built, the user's picks:
- **Best next moves** in the panel: one more vehicle on each route, new buses and minibuses
  on every road-connected pair, forecast in a pool of up to 3 workers, top four with Buy.
- **Red/green preview line** by forecast, and a **second click** to confirm a move forecast
  to lose money.
- **The way out mends before it sells**: a losing route whose worn roads cost more than
  upkeep is told to maintain them first; only what it still loses is a reason to sell (it
  had told the day-25 player to sell a bus whose road just needed keeping up).
- **Minibus** (M): 12 seats, danfo speed, ₦250, ₦63/day; the bus came down to ₦72/day so
  it's the cheaper way to move many people. Minibus wins thin pairs, the bus wins top pairs
  and a busy route's second vehicle. (First pass made the minibus best everywhere — it was
  cheaper per seat-cell, being faster; the user caught it.)

**Lever table after track 2** (audit, 20 days on, mid-game network): bus on the busy route
~14 days; thin new route ~24; maintain a road 3 of your buses use ~9, pave it ~15; maintain
a danfo-only road, never; lorry paved ~7, on dirt never; old line to Owode via a halt + train
~12, new track + train ~10; freight on existing track ~16. Still poor on money by design or
open question: roads to cut-off towns (~140 days alone, ~64 with a bus) — they pay in share
and informal service, not fares.

Plan: **track 1, legibility** (a steady net/day, a receipt a day after each action, pave and
fix a whole road through roadside towns), then **track 2, economics** of the dead levers
(fix, pave, then rail).

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
  longer trip? Is "straight or round" (A) a choice you make? Does "Run it through" get the
  Ikole bridge used as an Ilase–Ikole route?
- Is choosing which roads to maintain a decision, or does everything (or nothing) get kept?
- Does a growing town (▲) read as a place developing, or as a treadmill of queues? Is money
  loose again by day 40?
- Goods: is "which routes carry goods both ways" a decision you make? Do lorries crowd the
  buses' roads, or wear them faster than you'd keep up?
- Rail: restore the wrong old line, or build the right one — is that a choice you feel? Is
  rail a mid-game goal, or out of reach? Does a slow order on worn track get noticed?
- Freight: do you build feeder lorries to fill a freight train's load back, or ignore export?

Write down what was felt before changing anything (principles.md §6's playtest log). Open,
each waiting on what play says: a formal town-service tier (§5, "make it fixable") if play
wants inside-town trips; goods into growth (supplies developing towns) if play wants a
reason beyond money.
