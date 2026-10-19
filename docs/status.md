# Status

Current state of the codebase, and what's next. This is what a new conversation should
read first. For *how* the code is shaped, see [architecture/index.md](architecture/index.md);
for *why*, see [principles.md](principles.md); for detailed bug write-ups and design
lessons, see the relevant architecture deep-dive — they're indexed by topic there, not
buried in a chronological log here.

**473 tests passing** across 48 files (`bun test`). Typecheck / test / build /
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
| — | Bots baseline after 5b, with paving as a move | Done: results below |
| 5 | Money: built roads born dirt, paving dear, running costs restored, routine upkeep, fares by distance | Done, **M10 failing**: results below |
| 5b | M1 with openings of equal skill; M10's fix proposed (treasury remittance) | Done: M1 fails, results below |
| 6 | Price response with tolls, levies, the allocation; the remittance | Done, tuning stopped: allocation ₦10, M10 borderline pass, M2 and day-60 M1 fail (findings), M5 expected to fail until pushback: below |
| 7 | The new headline (5-day averages, chips) and the panel's budget breakdown | Done 2026-10-19: below |
| 8 | Best next moves, forecasts and receipts to `?dev=1`; the six hints | Done 2026-10-19: below |
| — | Your playtest (brief P1-P6) | Played 2026-10-19: fun for minutes; one map; no story; no struggle (principles.md §6) |
| R1 | Revision 1, the corridor's story (brief) | **Agreed 2026-10-19.** One change and one measurement at a time |
| R1 1a | A town's growth cap set by its best road's rung | Done 2026-10-19, **C1 passes on the trunk**: below |
| R1 1b | The bus lane and pushback: a strike (C3) | Done 2026-10-19: C3 passes on paper; the lane's cost is 0.4% of the corridor's net and strikes earn you money |
| R1 1b+ | The lane's own capacity; C1 for the lane re-measured; strike money against a twin | Done 2026-10-19: lane C1 33 days (knife-edge); strikes earn ₦22-38; lane encroachment and a stronger C3 proposed in the brief: below |
| R1 1c | Strikes block the lane; encroachment and enforcement, strikes by enforcement; C1 by consequences | Done 2026-10-19: strikes cost ₦630-904; lane capacity 2.0 off the knife edge; dirt and paved never jam by consequences, they level off: below |
| R1 1d | "Road is full" on the town card; C1 read as growth days; C3 strict against lax | Done 2026-10-19: **C1 passes** (35/29/19-27 days); **C3 fails**: lax wins on both corridors |
| — | Your playtest of the ladder (dirt → paved → lane) | Played 2026-10-19: liked rebuilding the road and enforcement; couldn't tell a strike landed (principles.md §6) |
| R1 1e | Strikes made legible (announced, cancellable, 2 days, costed, on cards and road, pause option); the BRT bus; C3 re-measured | Done 2026-10-19: **C3 passes with BRT**: strict wins on the trunk, lax on Ilase-Kuto: below |
| R1 2a | Rail switched on as the top rung (growth by a working station); C1 for rail | Done 2026-10-19: rail holds 34 days of growth: below |
| R1 2a+ | Lanes open lax; a way out of every called strike (Settle, Relax) on its card; "no loss to you"; staggered strike clocks | Done 2026-10-19; **C3 now fails on the trunk** (lax ahead by 2%): below |
| R1 2a++ | C3 over longer windows | Done 2026-10-19: **still fails** -- lax wins on both corridors at 80 and 120 days: below |
| R1 2a+++ | A lane's town size limit follows what it carries (slides to paved with encroachment); C3 re-measured without rail | Done 2026-10-19: **C3 passes** -- strict on the trunk, no lane on Ilase-Kuto: below |
| R1 2a++++ | "Road is full" diagnoses a thin corridor (no lane suggested under 240 trips a day along it) | Done 2026-10-19 |
| R1 2b | The named project; lane and rail priced for C2 | Done 2026-10-19: **lane 14 days, rail 27.8 days** of surplus (corridor probe, real money): below |
| R1 3 | A seeded variation of the hand-made map: town sizes (cut-off towns wider), the river's course and its crossing widths (`variation.ts`); P8 | Done 2026-10-19: **P8 (a) passes** (5 of 5 seeds), **P8 (b) fails** (1 of 5 seeds: only where a cut-off town comes up big): below |
| — | **Next: your playtest.** The whole ladder (dirt → paved → lane → rail), strike warnings and the BRT on seed 0 (`slice.html?seed=0`), then two or three seeds (suggested: 1, Ikole big; 3, Ikole small, roads first; 5); P7 and P8, by your account | |

**Revision 1, step 3: the seeded variation, 2026-10-19.**

- **What a seed draws** (`variation.ts`, engine.md): every town's size (Ilase ×0.85-1.2 and always
  the largest; the rest ×0.5-2), the river's course (shifted up to 5 cells) and its width along
  it, with one ford. Seed 0 is the authored map. The page draws a seed per new game ("Map N · New
  map"); `?seed=N` replays one.
- **P8, read as two parts** (the brief). Trips-greedy, seeds 1-5 against seed 0
  (`SEED=n BOTS_MOVES=1 BOTS_DAYS=2`):
  - **(a) passes**: its first three moves are all new on seeds 1, 2 and 5, and 2 of 3 on seeds
    3 and 4. The move that survives is the minibus Ilase-Ado (the two biggest towns). Roads to
    cut-off towns follow the ford and the sizes: Ikole's comes from Owode on seed 0, from Kuto on
    seeds 1, 2 and 4, and from Ogbe on seed 5.
  - **(b) fails**: seed 0's day-1 opening (8 moves: six minibuses and the roads to Ilaro and
    Ikole from Owode), replayed on each seed, against trips-greedy's own day-1 opening there.
    Both hold after day 1 (`OPENING_ONLY=1 REPLAY=... BOTS=trips-greedy,replay`). Trips made a
    day at day 20, own / replayed: seed 1 616 / 623 (−1%), 2 624 / 594 (+5%), 3 622 / 568 (+9%),
    4 588 / 577 (+2%), 5 561 / 597 (−6%). Every replayed move was affordable; every gap is
    within the ±50 trips a day treated as noise. Seed 0's own opening makes 602.
  - **(b) on your riders only also fails** (re-measured 2026-10-19; informal riders left out,
    since they're there whatever you buy). Own / replayed: seed 1 126 / 136 (replay ahead 8%),
    2 152 / 140 (−8%), 3 147 / 136 (−7%), 4 110 / 128 (replay ahead 16%), 5 134 / 134 (0%).
    Seed 0's own: 133. No seed reaches 15%, and on two the replay wins: trips-greedy's
    trips-per-naira ranking isn't the most riders, and an 8-move opening on the same nine towns
    serves much the same pairs whatever the sizes.
  - **Cut-off towns widened** (`variation.ts` `CUT_OFF_RANGE`: a town no inherited road reaches,
    Ikole and Ilaro, ×1/3-3 instead of ×0.5-2; nothing else on any seed moves). Re-measured:
    **(a) still passes** (3 of 3 new on seeds 1, 2, 3, 5; 2 of 3 on 4; on seed 1, Ikole at 86k,
    the road Ikole-Ilase is a first-three move; on seed 3 two of three are roads). **(b) still
    fails.** Own / replayed, trips made a day: 1 683 / 513 (25%), 2 617 / 607 (2%), 3 577 / 582
    (−1%), 4 562 / 556 (1%), 5 633 / 579 (9%); your riders: 1 136 / 143 (−5%), 2 156 / 137 (12%),
    3 120 / 145 (−21%), 4 115 / 128 (−11%), 5 143 / 138 (3%).
  - **What (b) is measuring**: on your riders the replay beats the seed's "own best" on 3 of 5
    seeds, which a best opening can't do: trips-greedy ranks by trips per naira, so its opening
    is a cheap one, not the best. A road to a big cut-off town shows in trips made (seed 1: 25%)
    but not in your riders (it's danfos that serve a new road first). (b) is limited by the bot's
    opening as much as by the map.
  - **(b) as agreed** (the best of trips-greedy's, greedy's and the replayed opening, all trips;
    `BOTS=trips-greedy,greedy,replay OPENING_ONLY=1`): **passes on 1 of 5 seeds.** Trips made a
    day at day 20, trips-greedy / greedy / replayed, and the replay's gap to the best: seed 1
    683 / 357 / 513 (**25%, passes**; Ikole at 86k, its road a first-day move), 2 617 / 428 / 607
    (2%), 3 577 / 325 / 582 (0%: the replay is the best), 4 562 / 333 / 556 (1%), 5 633 / 373 /
    579 (9%). Greedy buys one move a day (its persona), so its day-1 opening is a single move and
    never the best. Finding (principles.md §3, Maps): sizes alone change the game only when a
    cut-off town comes up big. Proposed, not built (brief): vary the inherited road network per
    seed, if the playtest says the maps feel the same.
  - **Why (b) fails, as read**: a ₦2,500 opening is small against what the map carries
    without you (about 300 trips a day by informal transport on day 1), so on any seed most
    sensible openings land within noise of each other by day 20. Trips-greedy also ranks moves
    by trips per naira, not total trips, so its "best" opening can lose to another (seeds 1 and
    5). The variation changes which moves come first (a), not yet what a wrong one costs (b).

**Revision 1, 2b: the named project, and rungs that cost, 2026-10-19.**

- **"Road is full" diagnoses before it suggests** (`growth.ts` `roadFull`): a paved town at its
  cap is told to add a bus lane only where the trips wanted along its busiest paved road could
  fill three BRT loads a day (`laneMinTripsPerDay` 240: the trunk wants 700+ at its paved
  plateau, Ilase-Kuto ~50-100); otherwise "<Town> is as big as this road supports; traffic here
  is too thin for a bus lane."
- **The named project** (`project.ts`): when a lane or rail is the next rung and you can't
  afford it, the road-full line offers "Save for it: ₦X". What you hold toward it (above the
  ₦3,000 reserve, up to its price) isn't remitted; built, it's done; unbuilt after 30 days it
  lapses and the treasury takes its 80% of what was held. The budget panel shows "Saving for
  ... ₦held of ₦price, safe until day N", with "Drop it". Not checked in the browser (a
  plateau takes ~30 game days to reach).
- **C2, corridor probe with real money** (`REAL_MONEY=1`: no top-ups, the treasury on; the
  player names the next rung when it can't afford it and buys nothing else meanwhile; buses
  swapped for BRTs as money allows):

| Rung | Price, before -> now | Days of the surplus it was wanted in | Waited | Built |
|---|---|---|---|---|
| bus lane (30x paving) | ₦1,655 -> ₦49,639 | 0.5 -> **14.0** (₦3,538 a day) | 0 -> 5 days | day 70 |
| rail (track ₦6,000 a cell, train ₦20,000) | ₦3,146 -> ₦172,735 | 0.5 -> **27.8** (₦6,207 a day) | 0 -> 18 days | day 123 |

- **C2's prices pass** (lane 10-20, rail 20-40) and **C4's lower bound** (rail by day 100-150).
  C1 still passes for every rung: dirt 35, paved 29, lane 35, rail 27 days of growth.
- **Not measured: C2's waiting rule as written** ("trips-greedy waits on money for a rung on a
  quarter of days 20-60"): the bots don't build lanes, BRTs or rail yet (`moves.ts`), so the
  corridor probe's saving player stands in. Halts and restoring the old line scaled with rail
  (₦30,000 + track, ₦1,500 a cell): restoring stays the cheap, wrong choice.

**Revision 1, 2a+++: a lane grows towns only while it carries, 2026-10-19** (`growth.ts`
`carriedShare`; principles.md §3, Geometry and pathing). A town's cap share is the best of its
roads and track by what each carries now: a lane's slides from `growthCapLaneShare` toward a
paved road's as danfos encroach, and fully taken it is a paved road. The BRT bus (built in
`cc3a9a8`, 80 seats, lane-only) is in every run: the probe replaces the corridor's buses with
BRTs when the lane opens. C3 without rail, your money a day over the window (and trips a day
along the corridor):

| Corridor, window | Strict | Lax | No lane |
|---|---|---|---|
| Trunk, days 66-145 | **₦5,965** · 1,039 | ₦4,224 · 815 | |
| Trunk, days 66-185 | **₦5,980** · 1,040 | ₦3,903 · 774 | |
| Ilase-Kuto, days 13-92 | −₦50 · 37 | −₦20 · 37 | **₦61 · 37** |
| Ilase-Kuto, days 13-132 | −₦48 · 37 | −₦20 · 37 | **₦60 · 37** |

- **C3 passes:** on the busy trunk strict enforcement wins by ~40-50%, and carries a third more
  trips; on the modest Ilase-Kuto the lane loses money either way (lax loses less) and **no
  lane is right** -- the lane is the wrong rung for a thin corridor.
- On Ilase-Kuto a lane changes no trips (37 a day in all three): its towns are thin. Neither
  the panel nor the hints say so yet ("road is full" names the lane as the next rung there).

**Revision 1, 2a++: C3 over longer windows, 2026-10-19** (corridor probe, BRT, money over
the lane's first N days).

| | Strict | Lax |
|---|---|---|
| Trunk, 80 days, rail allowed | **₦638,901** · 1,414 trips | ₦594,823 · 1,316 trips |
| Trunk, 120 days, rail allowed | **₦1,072,300** · 1,598 trips | ₦932,949 · 1,389 trips |
| Trunk, 80 days, no rail | ₦477,160 · 1,039 trips | **₦486,437** · 1,104 trips |
| Trunk, 120 days, no rail | ₦717,540 · 1,040 trips | **₦744,038** · 1,123 trips |
| Ilase-Kuto, 80 / 120 days, no rail | −₦3,971 / −₦5,765 | **−₦1,636 / −₦2,295** |

- **C3 still fails.** With rail in the window strict wins, but only because the strict lane's
  towns level off sooner and the probe climbs to rail sooner: rail, not enforcement. Holding
  rail back, lax wins on both corridors, and by more the longer the window.
- **A likely flaw:** an encroached lane still counts as the lane rung for growth
  (`growth.ts` `bestRung`), so a lax lane keeps the lane's town cap while the danfos take it
  back and pay tolls and levies again -- the lane's benefit without its cost. Fully
  encroached, a lane is no faster than the road, so it should grow towns like a paved road:
  the rung's cap share sliding from the lane's toward paved's with encroachment. For a
  decision.

**Revision 1, 2a+: a strike you can answer, 2026-10-19** (playtest: "the strike has pull now
but I can't tell what I can do in this case since I did not put restrictions").

- **Lanes open lax** (no wardens); strict is your choice (Road tool on the lane). The union
  answers a new lane with a strike ~5 days on regardless; each new lane's clock starts 3 days
  after the last, so they don't all strike at once.
- **Every called strike has a way out on its card:** "Settle ₦X" (always: half what the strike
  would cost you on the corridor's normal days, at least ₦150) and "Relax enforcement" (if it
  was called while strict). Checked in Chrome: called on day 2 for day 6, "Settle ₦380",
  paid, strike off.
- A strike that cost you nothing says "no loss to you" (it said "₦0").
- **C3 now fails on the trunk.** Strict against lax, BRT, money over the lane's first 40 days:
  trunk ₦236,230 strict against **₦240,674 lax** (it was ₦226,772 against ₦205,720 before
  this change); Ilase-Kuto −₦4,804 against **−₦3,891 lax**. The trunk's margin either way is
  2-10%: the result is fragile to when strikes fall. For a decision before rail's pricing.

**Revision 1, 2a: rail, the top rung, 2026-10-19.** `railEnabled` is on by default (wear,
goods and the straight alignment stay off). A town with track in service at it -- a station
or a halt's spur, not the old line out of service -- is on the "rail" rung, allowed
`growthCapRailShare` (2.4, a first guess) of the growth cap; a laned town at its target is told
"Rail (K ... then T for trains) to grow further". Corridor probe (BRT on the lane, then new
track Ilase-Owode and trains while full, money no object):

| Rung (day) | Towns grew before levelling off | Ilase / Owode at the plateau |
|---|---|---|
| dirt (1) | 35 days | 158k / 64k |
| paved (36) | 29 days | 237k / 98k |
| lane + BRT (65) | 33 days | 307k / 131k |
| **rail (98)** | **34 days** | 423k / 178k (440k / 180k by day 200) |

- **C1 passes for every rung** (20-40). Ilase ends at 3.7x its start: money is no object
  here; C2 (rail at 20-40 days of a mid-game surplus, with the named project) is next.
- The trunk reaches rail on day 98 with unlimited money: inside C4's 100-150 window only if
  money doesn't hold it back much -- C2 decides.

**Revision 1, 1e: strikes you can see; the BRT bus; C3 passes, 2026-10-19**

- **Strikes** (pushback.ts; proposed in the brief): the union announces one 4 days ahead
  ("STRIKE DAY N" in amber on the road, a toast, a badge on the route and town cards);
  relaxing the lane before then calls it off. It lasts 2 days (red road and tag, "On strike
  until day N"), at half the old frequency (strict ~every 24 days plus notice, lax ~120).
  After it, "struck day N · cost ₦X" stays on the road and the cards for 5 days, and "Lost to
  strikes (estimated)" sits under the budget's net. The estimate is the corridor's income
  (your fares on routes along it, its tolls and levies) on the 3 days before, less what came
  in; under 2 normal days (a new lane), no estimate. At 4× the game pauses when a strike is
  called or begins (P toggles, remembered). Checked in Chrome: called, on, and the mark after.
- **What strikes cost**, corridor probe against a twin with each called off, and the game's
  own estimate beside it: ₦1,192 (estimate 624), ₦1,677 (1,836), ₦976 (1,509). Same range.
- **The BRT bus** (X, in the toolbar once a lane exists): articulated, 80 seats, ₦1,500,
  2x a bus's running cost (₦0.81 a seat-cell against ₦1.30), only on a route laned the whole
  way. Drawn longer. Bought alongside the trunk's 13 buses, one BRT ran 18% full and changed
  nothing; **replacing them** (same seats in BRTs, then more while full), it carries:

| Days 66-105, trunk (lane day 65) | Trips a day | No seat a day | No-seat share | Your money a day |
|---|---|---|---|---|
| no lane (paved, buses) | 694 | 72 | 9.4% | ₦2,989 |
| lane + buses | 936 | 145 | 13.4% | ₦4,911 |
| **lane + BRT** | **986** | **117** | **10.6%** | **₦5,669** |

- **Against a twin that never got the lane, the lane carries far more** (the lane's cap grows
  the towns), but "no seat" rises with it; BRT brings the no-seat share almost back to the
  twin's. The earlier "carries less than it displaces" was against *lax*, not no lane.
- **C3 passes with BRT** -- money over the lane's first 40 days:

| Corridor | Strict | Lax | Better |
|---|---|---|---|
| Ilase-Owode (trunk), BRT | **₦226,772** · 986 trips | ₦205,720 · 922 trips | strict |
| Ilase-Kuto (modest), BRT | −₦1,858 · 36 trips | **−₦801** · 37 trips | lax |

  On the thin corridor a BRT is too big and loses money either way: the lane is the wrong rung
  there, which the town card's "road is full" line doesn't yet say.
- The bots don't buy BRT buses yet (`moves.ts` lists another BRT on a BRT route, no new ones).

**Revision 1, 1d: the road is full; C1 as growth; C3 as a choice, 2026-10-19**

- **"Road is full"** (`growth.ts` `roadFull`): a town grown by your service to the target its
  best road allows (within 3%, and at least 5% above its start) gets the town card's problem
  line "<Town> can't grow: its road is full. Pave its road (R) / A bus lane on its road (R)
  to grow further." Nothing at the lane (rail is off). On the trunk it fires from day 29, as
  the dirt corridor's towns level off.
- **C1 passes, read as days of growth:** dirt 35, paved 29, the lane 19 (strict) to 27 (lax).
- **C3 fails: strict never wins.** Money over the lane's first 40 days, and trips a day along
  the corridor (`scripts/corridor-probe.ts`, `LAX=1`):

| Corridor | Strict | Lax |
|---|---|---|
| Ilase-Owode (trunk) | ₦195,216 · 928 trips | **₦211,057 · 1,049 trips** |
| Ilase-Kuto (modest) | ₦1,061 · 37 trips | **₦2,262 · 37 trips** |

- **Neither knob flips it.** Strikes every 20 or 30 days instead of 12: strict ₦197,265 and
  ₦198,117. Lax encroaching 2x or 4x as fast: still ₦206,271 and ₦210,471 with more trips.
- **Why: the lane carries fewer people than the danfos it squeezes out.** Strict holds the
  danfos to 4 road space; your buses (added while full) don't replace what they carried, so
  trips along the corridor fall (928 against 1,049) and so does money. A fully encroached
  lane is a paved road again, and beats it. For the lane to be worth enforcing, it must
  carry more than it displaces: e.g. your buses much faster or bigger in it, or the danfos'
  loss smaller. For a decision after the playtest.
- On the modest corridor the probe climbed to a lane by day 12 (its thin towns level off
  fast): its numbers are small, and the result the same.

**Revision 1, 1c: enforcement, encroachment, strikes that cost; C1 by consequences, 2026-10-19**
(`scripts/corridor-probe.ts`; the player climbs a rung when the corridor jams *or* its end
towns level off -- under 1% growth in 5 days).

- **A strike blocks the lane**: your buses fall back into general traffic, and its riders
  wait or stay home (trips made 855 -> 763 the first strike day; "no seat" 42 -> 74 the
  next). Against a twin with the strike called off: **every strike costs you ₦630-904**
  over its day and the next (it earned ₦22-38 before).
- **Enforcement** (pushback.ts): a lane opens strictly enforced (wardens, ~₦30 a day on the
  trunk, a "W" on the map; its own budget line); the Road tool on a laned road switches it
  lax/strict. Lax: danfos take 5% of the lane a day -- the band fades, yellow dashes grow
  in it, your buses' lane speed blends toward general traffic's and the danfos' road space
  comes back. **Strikes follow enforcement, not a timer**: strict, every ~12 days; lax,
  every ~60 (first at day 25 of a lax lane). Checked in Chrome: warden badge, the relax
  preview, a lax lane at day 14.
- **C1, a jam by consequences** ("no seat" 10 points over its low for 2 days, or the end
  towns 5% below their peak):

| Rung | Towns grew before levelling off | Jam (by consequences) |
|---|---|---|
| dirt (from day 1) | 35 days | after 84 days |
| paved (day 36) | 29 days | after 49 days |
| lane, strict (day 65) | 19 days | after 20 days: each lane jam falls 1-2 days after a strike |
| lane, lax | 27 days | after 59 days |

- **Dirt and paved never jam by consequences while you keep adding buses:** their towns
  grow to the rung's cap and level off, service intact (the road slows, to ~0.6, but trips
  are made). So what ends a rung's room is the cap, not a jam; the "jams" the speed rule
  saw were slow roads, not lost trips. Reading C1 as *days of growth a rung buys* gives
  35, 29, 19-27: in or near the target. For a decision.
- **Lane capacity off the knife edge:** by consequences the lane's towns grow 18-23 days at
  any capacity from 1.3 to 3.0 (below ~1.0 buses crawl): set 2.0, the middle.
- **C3 (proposed: the lane's cost >= 10% of the corridor's net):** strict, the lane costs
  ~₦130 a day -- lost takings ₦38, strikes ~₦62 a day averaged, wardens ~₦30 -- **about 6.5%
  of the corridor's ₦2,014 net**: under 10%. Lax, the corridor's takings *rise* over the
  twin (₦326 against ₦262: the danfos come back) and strikes are rare: the lane's price is
  its speed instead.

**Revision 1, 1b+: the lane's own capacity, and what a strike costs, 2026-10-19**
(`scripts/corridor-probe.ts`, now to 30 buses).

| Lane capacity (road space a second) | Lane held, days to the next jam |
|---|---|
| 0.6, 1.0 | buses crawl at once (the lane far over capacity) |
| 1.3 | 10 |
| 1.6 | 18 |
| **1.65 (set)** | **33** |
| 1.7-2.2 | never, by the probe's rule |

- **C1 for the lane passes at 1.65, on a knife edge.** Past ~1.7 the lane settles just above
  the rule's 0.7 speed, so it never "jams", though its towns fall back ~15% from about day 70.
  The rule, not the corridor, is the edge; a jam rule that reads the towns' decline would be
  steadier. For a decision.
- **Route speed now reads the lane** (`tick.ts`): it read general traffic's, which hid the
  first crawl.
- **Strikes earn you money.** A twin with each strike called off, the same buses: over the
  strike day and the next, you ended ₦38, ₦37, ₦22 ahead and once ₦6 behind. The danfos'
  riders board your buses. **Not pushback**, by your test.
- **The lane's lost takings are 0.4% of the corridor's net** (₦9 a day against ₦2,413).
- Proposed in the brief (Revision 1, "lane encroachment, and pushback that costs"): danfos
  encroach on an unenforced lane, enforcement is a daily cost, shown on the map; a strike
  must cost you; C3 requires the lane's cost to be at least 10% of the corridor's net.

**Revision 1, 1b: the bus lane and pushback, 2026-10-19** (`scripts/corridor-probe.ts`: the
same trunk player climbs to a bus lane on the paved trunk's jam, day 41; a twin without the
lane, the same buses bought in both, for 10 days). The lane: the Road tool on a paved road;
priced as paving it again; your vehicles run free of the traffic on it and leave the shared
road space; general traffic keeps 60% of the road; the danfos' road space on it falls. The
pushback, one form: a strike -- 5 days after the lane, then every 20, for a day, no danfo sets
off along the corridor (kekes and okadas still run); "STRIKE" on the road, and a toast.

| Danfos' road space on a lane | Corridor's tolls + levies a day, lane against twin |
|---|---|
| 9 (dirt's) | 294 against 279 (**+5%**: your buses left the shared space, freeing it) |
| 6 | 270 against 279 (−3%) |
| **4 (set)** | **245 against 279 (−12%)** |

- **C3 passes:** the lane lowers the corridor's takings 12%, and the first strike comes 6 days
  after it (target: within 10), shown on the map where it happens.
- **The lane's own C1 fails: it never jams again** (past day 110). On a lane your buses run
  free, so a corridor can only jam there through "no seat", which more buses always fix. A
  real lane fills too: proposed, the lane gets a capacity of its own (your buses' flow on it,
  the same speed curve), so a busy lane slows and rail is the next rung. For a decision.
- The tension is small in money: −₦34 a day over the lane's first 10 days, plus a strike
  day's corridor takings every 20 days, against a strong network's ~₦5,000 a day. Its
  weight in play (M5's question) is for the playtest.
- Checked in Chrome with the developer start (`?dev=1&funds=20000`): paved Ilase-Owode,
  a bus lane on it (a band of your colour under the road), six buses; on day 6 the strike
  draws as a red dashed road with a "STRIKE" tag at its middle, and the toast says why.

**Revision 1, 1a: growth tied to corridor capacity, 2026-10-19** (`scripts/corridor-probe.ts`,
Ilase-Owode; a scripted player adds a bus while its buses run full, paves on the first jam;
money no object). A jam: the corridor's slowest piece under 0.7 of free speed for a day, or
"no seat" over 25% of the trips along it.

| Paved cap (× start) | Paving held, days to the next jam |
|---|---|
| 1.5 (fixed, before 1a) | never, through day 90 |
| 1.0 | 49 |
| 1.15 | 34 |
| **1.25 (set)** | **26** (27 with buses held to 8) |
| 1.5 | 16 |
| 2.0 | 13 |

- **C1 passes for paving on the trunk: 26 days** (target 20-40). Dirt allows 40% of the cap:
  +50%, the old cap, so dirt corridors behave as before.
- **The dirt rung holds ~15 days** on the trunk (inherited, jams on day 15): under C1's 20.
  It's the opening rung; whether it counts for C1 is for a decision.
- Not measured yet: what bigger towns do to money (more trips, more fares: M10, C2 later),
  and C1 on other corridors and with the bots. After a jam the towns shrink back a little
  as service falls (Ilase 240k -> 215k by day 120).

**Steps 7 and 8, 2026-10-19** (render-and-ui.md §7). Styled from the design lab's "The
brief, step 8" preset: no exported picks were found, so the preset stands in until you
export yours. The strip is the headline as 5-day averages with chips; the routes panel has
route cards (verdicts of at most 12 words, one lever, tested), the budget by line (summing
to the strip's net, tested) and the treasury, then your share. Town panels are cards.
Best next moves, forecast lines, losing-move confirmations, Results and receipt toasts are
`?dev=1` only, and off it no forecast workers or shadow worlds run. The six hints fire on
state, one at a time, beside the town they're about; `H` or "Hints off" turns them off.
Not done: the preset's contour terrain; hint 6 assumes tolls stay automatic (brief Open
question 3). Checked in Chrome at 1440×900: no console errors.

**Step 6, pass 1, 2026-10-18** (`BOTS_WORKERS=6`, ~48 min). First-guess values: toll ₦10 a
road per danfo-equivalent, levy ₦0.6 a seat (agberos half), allocation ₦50 a day + ₦20 per
thousand grown since day 1, price elasticity 1.

| Opening | Net a day, day 20 → 60 | Trips made a day, day 20 → 60 |
|---|---|---|
| bus first | ₦4,244 → ₦7,555 | 782 → 1,499 |
| minibus first | ₦4,392 → ₦7,279 | 794 → 1,458 |
| road first | ₦3,680 → ₦7,181 | 643 → 1,336 |
| pave first | ₦3,555 → **₦7,590** | 613 → 1,404 |

| Check | Result | Measured |
|---|---|---|
| M1 (day 20) | **PASS** | all four openings within 25% |
| M1 (proposed, day 60) | FAIL, narrowly | pave first has the best net, but 95 fewer trips a day than bus first |
| M2 | **PASS** | road Ikole-Kuto + minibus pays back in 18 days, + bus in 34 |
| M3 | FAIL | paving the trunk pays back in 7 days (target 10-30): tolls too high |
| M5 | FAIL | greedy carries the most and earns the most |
| M10 | FAIL, far worse | trips-greedy ₦198,280 at day 60 |
| M4, M6-M9 | PASS | |

- **The catch-up works**: with tolls and the growth allocation, infrastructure-first openings
  converge on vehicles-first by day 60, and paving first ends with the best net.
- **Too generous**: the allocation at ₦20 per thousand grown pays naive ₦1,615 a day (59% of
  its income; greedy's 33% is inside the brief's quarter-to-a-third) and leaves greedy at
  ₦126,130 by day 40. Tolls at ₦10 a road pay greedy ₦1,592 a day and pay the trunk's paving
  back in 7 days. Levies look right: doing nothing collects ₦81 a day (the agberos the same).
- Builder's minibus to Ikole loses ₦39 a day at day 20 (the other makes ₦53).

**Pass 1 tuned, 2026-10-18** (~63 min): toll ₦4 a road, allocation ₦7 per thousand grown.

| Check | ₦10 toll, ₦20 allocation | ₦4 toll, ₦7 allocation |
|---|---|---|
| M3 | FAIL (trunk paving pays back in 7 days) | **PASS** (29 days; a quiet road not in 60) |
| builder's minibuses, day 20 | −₦39, +₦53 | +₦91, +₦165 |
| allocation's share, strong networks | 32-36% | 19-22% (target 25-33%) |
| M1 (day 20) | PASS | PASS |
| M1 (proposed, day 60) | FAIL, narrowly | FAIL: road first within 25% on net (₦4,279 against ₦4,744), 151 fewer trips than bus first |
| M2 | PASS | FAIL |
| M10 | FAIL | FAIL (trips-greedy ₦131,589 at day 60) |

Set: toll ₦4, allocation ₦10 per thousand (between the two, for M2 and the allocation's
share), measured with pass 2.

**Step 6, pass 2: the treasury remittance, 2026-10-18** (~62 min; toll ₦4, allocation ₦10 per
thousand, remittance 80% of funds above ₦3,000 every 10 days, never more than the period's
surplus).

| Opening | Net a day, day 20 → 60 | Trips made a day, day 20 → 60 |
|---|---|---|
| bus first | ₦2,865 → ₦4,873 | 970 → 1,545 |
| minibus first | ₦2,673 → ₦5,098 | 931 → 1,603 |
| road first | ₦2,186 → **₦5,311** | 766 → 1,568 |
| pave first | ₦1,918 → ₦4,409 | 720 → 1,428 |

| Check | Result | Measured |
|---|---|---|
| M1 (day 20) | PASS | |
| M1 (proposed, day 60) | FAIL, inside the noise | road first has the best net and passes bus first on trips; minibus first has 35 more trips (±50 is noise) |
| M2 | FAIL | see below |
| M3 | PASS | trunk paving pays back in 17 days; a quiet road not in 60 |
| M4, M6-M9 | PASS | |
| M5 | FAIL | greedy carries the most and earns the most |
| M10 | FAIL | trips-greedy never waits on money; funds ₦24,930 at day 60 (₦131,589 without the remittance), net ₦4,507 a day |

The allocation is now 25-28% of a strong network's income (the brief's quarter to a third);
greedy's funds at day 40 fall from ₦79,411 to ₦12,443; builder's minibuses pay; greedy still
paves its trunk. Two readings the remittance changes, for a decision:

- **M10 can't pass as defined.** The remittance caps what piles up, not what can be bought
  each day: trips-greedy keeps the ₦3,000 reserve plus 20% of each period's surplus (~₦900 a
  day at ₦4,500 net), and its best move costs ₦250-1,700. Only a much lower reserve -- which
  defeats saving for a project -- would make it wait. M10 could instead measure the cap.
- **M2 fails because payback is measured in funds.** The treasury takes 80% of the extra
  surplus a road and bus make, so funds pay back about five times slower; the road still
  adds trips (+28, +36 a day). Payback could be measured on net before remittance.

**M10 and M2 re-read, 2026-10-18** (short set: idle, naive, trips-greedy and the same policy
with unlimited funds, ~18 min). M2 now measures payback on net before the remittance (funds
plus what was remitted). M10 now compares trips made at day 60 with and without unlimited
money (pass at +15% and above the noise). Trips-greedy now buys down its ranked list each
day while it can afford the next move and its budget balances: at one move a day it was
never short of money, and unlimited money bought exactly the same trips (1,593 against 1,593).

| Trips made a day | day 10 | day 20 | day 40 | day 60 |
|---|---|---|---|---|
| trips-greedy | 679 | 1,005 | 1,417 | 1,611 |
| unlimited money | 772 (+14%) | 1,152 (+15%) | 1,404 (−1%) | 1,580 (−2%) |

- **M10 fails at day 60 because the map saturates, not because money is loose.** Unlimited
  money builds the network ~15% faster through day 20; by day 40 both have filled the nine
  towns' demand. Trips-greedy never waits on cash: what stops it each day is the
  budget-balancing rule. Lowering the 20% retained share wouldn't bite, and the levies it
  displaces are small (₦50-104 a day). M10 may belong in the build-out (day 20, or the area
  between the curves) -- for a decision.
- **M2 fails on net before the remittance too**: neither road to a cut-off town plus a
  vehicle pays back in 60 days at ₦10 per thousand grown (it did at ₦20).
- M5: trips-greedy carries the most and earns the most in this set; re-read on a full run.

**Full set at allocation ₦15 per thousand, M10 read at day 20, 2026-10-18** (~65 min, 6
workers; toll ₦4, remittance as pass 2).

| Check | Result | Measured |
|---|---|---|
| M1 (day 20) | PASS | minibus first ₦3,670/978 trips, bus first ₦3,460/970, pave first ₦2,914/848, road first ₦2,514/757 |
| M1 (proposed, day 60) | FAIL | road first within 25% on net (₦5,806 against ₦6,478) but 74 trips short of minibus first (1,561 against 1,635), outside the noise |
| M2 | FAIL | road to Ilaro (+28 trips/day) or Ikole (+36) plus a bus or minibus: no payback in 60 days on net before remittance |
| M3 | PASS | trunk paving pays back in 29 days; a quiet road not in 60 |
| M4, M6-M9 | PASS | |
| M5 | **PASS** | trips-greedy carries the most; greedy earns the most (₦4,933 a day) |
| M10 | FAIL | trips made at day 20: unlimited 1,152 against 1,123 (+3%); trips-greedy waited on money 0 of 46 days |

- **The allocation's share** of a strong network's income is 30-35% (days 31-40), the top of
  the brief's quarter to a third; weak networks (naive, overbuilder) live half on it.
- **M10 and M2 pull against each other.** The extra ₦5 per thousand bought trips-greedy
  the build-out speed unlimited money had: 1,005 → 1,123 trips at day 20 against the same
  1,152. So the gap M10 measured at ₦10 (+15%) closes, while M2 still doesn't pay back. A
  single allocation rate can't pass both; M2 needs a road's return that isn't the
  allocation (or a shorter road), M10 needs money to bind earlier.
- Routine upkeep's target is per road (brief): a quiet road costs more than it returns (M3
  passes) and the strongest strategy still paves its trunk (trips-greedy and greedy do). Its
  share of running costs, 12-18%, is printed but no longer a target.

**Back to ₦10 per thousand; M2 read in trips, 2026-10-18** (~61 min, 6 workers). The
openings and greedy match pass 2 exactly (same tuning, deterministic).

| Check | Result | Measured |
|---|---|---|
| M1 (day 20) | PASS | |
| M1 (proposed, day 60) | FAIL, not relaxed | road first has the best net (₦5,311) but 35 trips fewer than minibus first (1,568 against 1,603) |
| M2 (proposed, in trips) | FAIL (printed PASS: a bug, fixed) | lifelines add 28-44 trips a day at ₦17-31 a trip and lose ₦18-64 a day (affordable: up to ₦518); the best bus adds 74 at ₦7 a trip |
| M3 | PASS | 29 days; a quiet road not in 60 |
| M4, M6-M9 | PASS | |
| M5 | **FAIL** | trips-greedy carries the most and earns the most (₦3,917 a day) |
| M10 | FAIL by a hair | unlimited 1,152 against 1,005 at day 20: +14.6%, 147 trips (threshold 15%) |

- **The M2 printout passed on a bug.** The best paving by trips per naira on days 6-10,
  Ado-Ogbe, *lost* 39 trips a day over 60 days, so its naira per trip was astronomical and
  the "good moves" mean let everything through. Good moves that add no trips are now
  excluded. Against the bus alone (₦7 a trip, 1.5× = ₦10.5) every lifeline fails on cost
  per trip; all four pass on affordability. The comparison may want the trunk paving (M3's
  busy road) as the paving reference instead of the day-1 ranking's first -- for a decision.
- **A ranking on days 6-10 can mislead over 60.** Ado-Ogbe paving ranks first per naira on
  a 5-day twin and costs trips over 60; the bots' paving choices use the 5-day ranking.
- **M5 depends on the allocation.** At ₦15 greedy earned the most; at ₦10 trips-greedy
  does. The tension sits on the edge.
- The allocation is 22-27% of a strong network's income (the brief's quarter to a third, at
  its floor).

**Decisions and M2 against trips-greedy's moves, 2026-10-18** (idle and trips-greedy, ~9
min). Tuning stops here; slice zero goes to the playtest (brief P1-P6).

| Check | Status | Reading |
|---|---|---|
| M2 (in trips) | FAIL, recorded as a finding (principles.md §3) | Lifelines cost ₦17-31 per added trip a day; trips-greedy's moves on days 20-30 cost a median ₦11 (17 moves), 1.5x = ₦16. Best: Ikole + minibus at ₦17, losing ₦18 a day (affordable: ₦518) |
| M10 | PASS, **borderline** | +14.6% at day 20; "about 15%" passes at 14.5% and up, flagged below 15% |
| M5 | FAIL, expected | Until pushback (after slice zero). The allocation isn't tuned to flip it (at ₦15 it flipped) |
| M1 (day 60) | FAIL, not relaxed | Road first 35 trips short of minibus first, with the best net |

**The bots' paving ranking can pick a paving that loses trips.** They rank paving by trips
added per naira on a 5-day twin (days 6-10); on day 1 that puts Ado-Ogbe first, which loses
39 trips a day over 60 days. Treat the bots' paving choices as suspect until the ranking is
checked against a longer twin.

**M1 with openings of equal skill, 2026-10-18** (~24 min). Four openings spend the whole
first ₦2,500 on one kind of move -- the best each time (vehicles by forecast ₦/day, roads
and paving by trips per naira) -- then all play greedy, to day 20:

| Opening | Net a day, days 16-20 | Trips made, day 20 | Funds, day 20 |
|---|---|---|---|
| minibus first | ₦1,552 | 901 | ₦13,224 |
| bus first | ₦1,455 | 853 | ₦9,516 |
| pave first | ₦412 | 585 | ₦793 |
| road first | ₦140 | 549 | ₦231 |

**M1 fails** (two within 25% of the best). With skill equal, the gap is real, not the bots':
the first ₦2,500 spent on vehicles is ~₦1,000 a day ahead by day 20 of the same money spent
on roads or paving, and ahead on trips made too. Roads and paving earn no money of their own
and cost upkeep, so an infrastructure opening waits on fares it doesn't collect -- the
brief's spine ("building pays back") isn't true yet. That's what step 6's tolls and the
growth allocation are for; M1 is likely to pass only with them.

**Before tolls, 2026-10-18** (`.tmp-check`, not kept): informal riders a day whose trip uses
a road you built or paved, from the warmed world with nothing else of yours. Roads to Ilaro
(Ilase-Ilaro) and Ikole (Kuto-Ikole): ~98-110 a day, average fare ₦5.3-5.8, so ₦1,000 a
day would be ₦9-10 a rider, 1.6-1.9 fares. The paved trunk: ~200 a day, average fare
₦6.1-6.3, ₦5 a rider, 0.8 of a fare. Tolls can't close the openings' gap without pushing
riders off; the catch-up must come from the growth allocation and the remittance.
| 6 | Riders respond to price, with tolls, levies and the allocation | Next |

**Step 5, money, 2026-10-17** (`BOTS_WORKERS=6`, ~15 min). Built roads are born dirt
(`roadCostPerCell` 15 → 10); paving is `PAVE_COST_PER_CELL` 65 in `pathing/cost.ts` (the
trunk ₦382 → ~₦1,660); routine upkeep 1 a cell a day on built dirt, 3 paved, bridges ×3;
bus 2.4 → 2.6 and minibus 2.1 → 2.275 a second (most of the rough-road discount reversed;
the full 2.8 sank every opening but greedy's); warm-up 7 days. Bots: trips-greedy balances
its budget (buys only moves whose forecast keeps its net a day ≥ 0); M8 split by what an
action moves; M9 above noise.

| Persona | Day 40 (trips / no road / no seat / yours) | Funds, day 40 | Net/day, 36-40 | Paved by day 40 |
|---|---|---|---|---|
| idle | 335 / 211 / 137 / 0 | ₦2,500 | ₦0 | — |
| naive | 528 / 267 / 328 / 308 | ₦6,941 | ₦186 | — |
| builder | 422 / 0 / 269 / 18 | −₦4,116 | −₦148 | — |
| roads only | 406 / 0 / 277 / 0 | −₦1,674 | −₦82 | — |
| overbuilder | 565 / 248 / 187 / 129 | ₦4,750 | ₦126 | — |
| greedy | 1,237 / 327 / 189 / 1,008 | ₦15,856 | ₦1,367 | Ilase-Owode |
| trips-greedy | 1,264 / 0 / 389 / 716 | ₦3,270 | ₦634 | Ilase-Owode, Ikole-Kuto, Ilase-Kuto |

| Check | Result | Measured |
|---|---|---|
| M1 | FAIL | days 16-20: greedy ₦574, naive ₦343, trips-greedy ₦313 (25% of the best is ₦430) |
| M2, M3, M5 | FAIL | unchanged (step 6's income lines) |
| M4 | PASS | trips-greedy: 1,264 trips, no road 0 |
| M6 | PASS | none |
| M7 | PASS | informal share 52% at the start, 50% on day 10 (warm-up 7) |
| M8 | PASS | bus: your riders +35.8 against jitter 11.0; road Ikole-Kuto: trips +56.2 against 5.0 |
| M9 | PASS | none above the noise |
| **M10** | **FAIL** | budget-balancing trips-greedy waited on money 3 of 46 days; ₦8,520 at day 60, +₦788 a day |

- **M10's first real reading fails.** A budget-balancing trips-maximiser is rarely short of
  money: its moves pay. Greedy's money comes from its vehicles (₦1,367 a day, upkeep 3% of
  its running costs), so the next lever is fares by distance with the fare level and the
  bus running cost tuned against M10 and M1 together.
- **Paving stays a decision:** greedy paves its trunk and nothing else; trips-greedy paves
  three roads. A quiet road costs more than it returns: roads only loses ₦82 a day.
- **Builder's guard fails:** its minibuses to the towns it connected net −₦43 (Ilaro-Owode)
  and −₦2 (Ikole-Ilase) a day at day 20. Builder never recovers (−₦4,116 by day 40).
- Earlier passes: the full reversal (bus 2.8) put trips-greedy in debt from day 10; raising
  paved upkeep to hit "a fifth to a third of greedy's running costs" made greedy stop
  paving (at 35 a cell its upkeep fell to 3%) -- that target was dropped as a proxy.

**Step 5, fares by distance, 2026-10-18.** Every leg pays ₦1 boarding plus a price per
10-cell stage, rounded up (`fares.ts`), you and the danfos alike; a transfer costs one more
boarding fare, not a whole fare. The route ceiling and `throughRoute` use real fares; road
and pave previews say what keeping them costs. Three stage prices, bus at 2.6:

| ₦ a stage | trips-greedy waited on money | trips-greedy, day 60 | greedy / next best, days 16-20 | builder's minibuses, day 20 | greedy paves its trunk |
|---|---|---|---|---|---|
| 0.6 | 42 of 46 days | ₦33, +₦12/day | ₦221 / ₦95 | −₦47, −₦12 | no |
| 0.8 | 2 of 46 | ₦20,395, +₦1,065/day | ₦680 / ₦315 | −₦42, +₦1 | yes |
| **1.0 (chosen)** | 0 of 46 | ₦52,330, +₦2,036/day | ₦1,247 / ₦608 | +₦65, +₦71 | yes |

Set at **₦1.0 a stage, for the opening**: it is the level at which a builder's minibuses to
the towns it connects pay. **M10 fails** there, and is recorded failing: the fare level is a
knife edge for a budget-balancing trips-maximiser (it never gets going or it snowballs), and
the best opening earns about twice the next at every level, so the fare can fix neither.
M10's fix is proposed separately (brief, Decisions log: a treasury remittance); M1 gets
openings of equal skill (step 5b). Checks at 1.0: M4, M6-M9 pass; M1, M2, M3, M5, M10 fail.

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
with no buses, 389 trips a day against 504 at the old 12. Re-run below.

**Bots baseline after 5b, 2026-10-17** (`BOTS_WORKERS=6 bun scripts/slice-bots.ts`, ~13
min). Paving is now a move (`moves.ts` `paveMoves`), ranked with roads by trips added per
naira; Greedy and trips-greedy consider it, and Greedy screens its vehicle moves like
trips-greedy (every extra vehicle on its routes, the 16 new routes with the most trips
along them per naira) -- 302 s instead of ~1,260. Differences under ±50 trips are noise.

| Persona | Day 40 (trips / no road / no seat / yours) | Funds, day 40 | Net/day, days 36-40 |
|---|---|---|---|
| idle | 338 / 211 / 139 / 0 | ₦2,500 | ₦0 |
| naive | 481 / 262 / 338 / 257 | ₦6,576 | ₦99 |
| builder | 732 / 0 / 476 / 371 | ₦12,571 | ₦613 |
| roads only | 433 / 0 / 264 / 0 | ₦1,462 | ₦0 |
| overbuilder | 560 / 247 / 185 / 123 | ₦5,908 | ₦178 |
| greedy | 1,371 / 0 / 363 / 893 | ₦27,044 | ₦1,590 |
| trips-greedy | 1,293 / 0 / 369 / 698 | ₦8,982 | ₦924 |

| Check | Step 4 | Now | Measured |
|---|---|---|---|
| M1 | FAIL | FAIL | days 16-20: greedy ₦868, builder ₦514, naive ₦372, trips-greedy ₦357 |
| M2 | FAIL | FAIL | Ilaro-Ilase (+40 trips/day) or Kuto-Ikole (+49) plus a bus or minibus: no payback in 60 days |
| M3 | FAIL | FAIL | paving alone never pays back (no tolls) |
| M4 | FAIL | **PASS** | greedy: trips 1,371 against idle's 338, no road 0 of 211 |
| M5 | FAIL | FAIL | greedy carries the most and earns the most |
| M6 | PASS | PASS | none |
| M7 | PASS | FAIL | informal share 56% at the start, 50% on day 10: 6 points, the limit is 5 |
| M8 | PASS | FAIL | best day-10 bus +7.6 trips/day against jitter 6.1 |
| M9 | FAIL | FAIL | naive: towns grow, trips fall from day 20 to 40 (505 → 481, inside the noise) |
| M10 | FAIL | FAIL | trips-greedy never waited on money (0 of 46 days) and ends day 60 with ₦30,915 |

- **Idle carries fewer people** (338 a day, 372 before 5b): the dirt budget of 9. The
  noise grew with it -- M8's jitter is 6.1 against 4.5 -- so a good bus no longer clears
  twice the noise, and M7 slips a point past its limit. Both are near their lines.
- **Greedy now builds and paves its way to the most trips** (M4 passes: no road 0), and it
  is still the richest: M5 has no tension until tolls and levies (step 7).
- **Money is looser still** (M10): trips-greedy, which buys trips with no regard for
  profit, ends day 60 with ₦30,915 and never waited for money. Step 6's reversed
  rough-road discount, routine upkeep and dearer paving (proposed) are what tighten it.
- **M9 for naive is inside the noise** (505 → 481); read it again after step 6.

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
