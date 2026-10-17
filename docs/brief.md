# Transport game — design brief (draft)

Oct 17, 2026 · @Othniel

## How to use this brief

This brief is the contract for what the game is and what gets built next; work is checked against it, not against memory. It is a draft: every decision in it stays proposed until you mark it agreed in the Decisions log.

- **principles.md** stays the record of *why*: the pillars and §3 Findings, the measured lessons. This brief says *what*: who the player is, what pays, what counts as doing well, what is in scope now.
- **status.md** stays the record of *where things stand*. Each step's pass/fail checks live here; status.md reports which ones passed.
- **When they disagree,** this brief wins on direction and principles.md wins on measured fact. The disagreement goes into the Decisions log the same day.

Rules of use:

1. A new system, verb or screen element must point at a line in this brief. If nothing fits, change the brief first, then build.
2. A playtest finding that changes direction updates this brief before any code changes.
3. New vocabulary goes into the Glossary in the session it appears. That is how finding the game by building it stays anchored.
4. Agents (Claude, OpenCode) read this brief right after status.md. Delegated work names the section it implements.
5. Nothing moves to the full game until slice zero's checks pass (see Pass/fail checks).

## The game in one paragraph

You run the transport arm of a state in a lightly fictionalised Nigeria. The region already moves: by danfo, keke and okada, out of motor parks where agberos collect the levies. A colonial railway built for export, not for people, lies half-derelict across it. You build and pave roads, run buses and later trains, on a budget fed by fares, tolls, park levies and a state allocation that grows as the towns you serve grow. The informal sector is your rival for riders, a source of your income, and an interest group that pushes back. There is no winning, only a region that moves better and grows because of what you built.

**The fantasy in one line:** make the region move, and watch it grow because of what you built.

**What you should be able to say after an hour (proposed, refined in Open questions):** "I took the Ilase–Owode corridor off the danfos, connected Ilaro, and Owode grew by half. The agberos made me pay for it."

## Pillars

Five pillars from principles.md §1, each with what it lets in and what it keeps out. A feature that serves none of them does not enter.

| Pillar | Lets in | Keeps out |
| --- | --- | --- |
| **True, not teaching**: "is this how transport here behaves?" | Fares that rise with distance, tolls, park levies, wear that follows use, a wrong colonial line | Advice that solves the game for you; rules invented for balance that nothing real explains |
| **The hook**: your planned network competes with an emergent informal one | Danfos that fill every gap, poach at your stops, crowd your roads, and pay levies | Informal transport as something you buy, or a subsystem you can switch off |
| **The spine is building infrastructure**: operating vehicles serves it | Roads, paving, bridges, track as the moves that change the region, and that pay back | A game whose only profitable move is buying vehicles |
| **Brownfield**: the map is never empty, and what you inherit is wrong for today | A world already running on day 1; the export line that stops nowhere | An empty start; an inherited network that is quietly "fixed" |
| **Terrain is overcome, never reshaped**, and the price says why | River, ridge, bridges, "straight or round" | Terraforming; a price with no breakdown |

Two standing rules sit beside the pillars (principles.md §2, §6): **a parameter enters only when it creates a decision**, and **legibility before looks**.

## Who the player is

**Agreed: you are the state's transport arm, an agency that builds roads and track and also runs its own buses and trains.** Think of a Lagos-style transport authority with its own bus company: it builds, it operates, it collects, and it answers to the state.

Why this role:

- **It keeps what played well.** Placing buses "plays like Mini Metro in a good way" (playtest, 2026-10-16), and this role keeps every vehicle move.
- **It gives building a payback.** Roads earn tolls, and the towns they grow raise the state allocation. Today a road earns nothing.
- **It deepens the hook.** The informal sector becomes rival, revenue and interest group at once, instead of only a rival.
- **It is true.** State agencies build and toll roads; many Nigerian states run their own bus companies; park levies reach local government through the unions' touts.

| You control | You don't control |
| --- | --- |
| Where roads and track go, and how they're aligned | Where people want to go (demand) |
| Paving, and which roads you keep up | Where danfos, kekes and okadas run: they go to the gaps |
| Your vehicles: which routes, how many, what size | The agberos' cut of the levy |
| Later: fare level, tolls per road, regulating a road | Terrain, weather, the colonial line's geometry |
|  | The allocation formula, which reads what you grew |

Roles considered and set aside:

| Role | How money works | Why not |
| --- | --- | --- |
| A transport company (Transport Fever, OpenTTD) | Fares only; roads are a convenience | Roads earn nothing, so the spine is the worst investment; danfos are only a rival; not who builds roads here |
| A pure authority that contracts every operator | Budget and tolls; operators run all vehicles | Truest to Lagos, but removes the vehicle moves that played best. Revisit if operating starts to feel like busywork |
| No stated role (today) | Fares only, plus road building | Produced the "what am I doing wrong?" playtests: the rewards point at buses, the setting at infrastructure |

**The rule that stops drift: money is how you do things, not what you are trying to do.** A headline that ranks your progress by money alone is a sign the game has slid back into being a bus company. Per-route profit and loss stays, as a diagnosis one click down.

## Money: a budget, not a score

**Four income lines, each with its own tension, and each one true of a state transport arm.** Money pays for the build; what counts as doing well is in the next sections. The numbers here are targets for the probe, not tuned values.

| Line | Who pays | When | The tension it creates | In slice zero |
| --- | --- | --- | --- | --- |
| Fares | Riders on your vehicles | On unload, per leg, rising with distance (see Fares) | You compete with danfos for the same riders | Yes |
| Tolls | Every vehicle on a road you built or paved: danfos, kekes, okadas, lorries. Not your own | Each time a vehicle enters the road, scaled by its road space | Passed on to riders: danfos on a toll road charge more, so some riders switch to you and some stay home. Budget up, headline down | Yes |
| Park levies | Each informal vehicle that loads at a town's park | Each departure | Displacing danfos cuts levy income; the agberos keep a cut first | Yes |
| State allocation | The state | Daily | A small fixed base plus a share of the growth you caused: towns you grew pay you back | Yes |

Proposed forms (every constant calibrated by the probe):

```latex
\text{toll per entry} = t \times \text{road space} \quad (\text{danfo } 1,\ \text{keke } 0.5,\ \text{okada } 0.3,\ \text{lorry } 1.5)
```

```latex
\text{levy to you per departure} = (1 - a) \times l \times \text{seats}, \quad a \approx 0.5 \text{ (the agberos' cut)}
```

```latex
\text{allocation per day} = B + k \times \sum_{\text{towns}} \max(0,\ P_{\text{now}} - P_{\text{start}})
```

In the allocation, B is a small fixed base and k a sum per thousand people grown; a new town along your road counts its whole population.

**Growth already needs your service.** A town grows only once you carry 10% of its trips (`growthMinPlayerShare`), and new towns need your riders on the road (`foundTownPlayerFlow`). So the allocation rewards growth you served, and a region left to danfos earns only the base.

**Riders must respond to price, or tolls are free money.** Today nobody does: riders take whichever vehicle comes first, and danfos charge the same flat ₦4 as you (`tick.ts`). A toll would simply skim the busiest danfo flow on the map. Proposed: a danfo on a toll road adds the toll to its fare. Of the riders who would board it, a share stays home, growing with the fare gap; riders waiting for your cheaper vehicle wait a little longer before giving up. The same mechanic then serves fares by distance and the later fare dial.

Costs:

- **Capital:** roads, paving, track, halts, vehicles. Terrain-priced with a breakdown, as today.
- **Running:** each vehicle, every second, unconditional, as today.
- **Routine upkeep (proposed):** a cost per cell per day on every road you built or paved, independent of wear: verges, drains, patching, the road agency's standing bill. It is the cost that balances step 7's income lines. With wear off (slice zero step 3) the bots' money went loose: Greedy ended day 40 with ₦38,590 against ₦354 with wear on, so the budget stopped being a decision by about day 15. Tolls are earned on exactly the roads that carry this cost, so a road you built pays for itself only if traffic uses it: building more roads is never free, and an unused road is a standing loss. Inherited roads you haven't paved cost you nothing; they're the state's old network.
- **Wear upkeep:** keeping a worn road up (the Fix tool). Returns with wear, after slice zero.
- **Later:** pushback from the union (see The informal sector).

Kept from principles.md §3, Economy: debt allowed, with no interest and no game over; in debt, spending is blocked and billing continues; resale is depreciated; fares are set by policy, never per route.

Calibration targets (probe, 40 days, today's map):

| Target | Today (measured) | Wanted |
| --- | --- | --- |
| Doing nothing | ₦0/day; the region slowly worsens | A small positive budget (base allocation plus levies); the region stays as it is |
| First vehicle on the best pair | Pays back in ~5–10 days | Keep |
| Road to a cut-off town plus one vehicle | ~64 days; the road alone ~140 | 30–60 days, counting tolls and the allocation from growth |
| Paving the busiest road | ~9–15 days (lever audit) | 10–30 days including tolls; tolls must not make paving a no-brainer |
| Allocation, day 40, well-connected network | None today | About a quarter to a third of income |
| Levy lost by taking a corridor from danfos | None today | 20–40% of what your vehicles gain there: felt, never decisive |
| The agberos' cut | None today | About half the levy, shown as its own line |
| Routine upkeep, built and paved roads | None today | A busy toll road's tolls cover it several times; a road nobody uses costs its upkeep and earns nothing |
| Money limits the score | Not before step 7: Greedy holds ₦38,590 by day 40 with wear off | Trips-greedy waits on money most days 15–60 (M10) |

## The informal sector: rival, revenue, interest group

**Danfos, kekes and okadas are three things to you at once, and the game lives in the tension between them.** Today they are only a rival; this brief adds the other two roles.

| Role | What it means in play | Built? |
| --- | --- | --- |
| Rival | Riders who give up waiting for you board a danfo; danfos passing your stop poach your queue; they crowd your roads and wear them | Yes (slice steps 1, 1e, 2) |
| Revenue | They pay tolls on roads you built or paved, and levies at the parks | No: slice zero |
| Interest group | The union and its agberos push back when you take their trade | No: after slice zero |

How the levy works, simplified from how Lagos parks are commonly described:

- Every informal departure from a town's park pays a levy. The agberos collect it and keep a cut; the rest reaches you.
- Levy income follows informal traffic, so the big parks (Ilase) pay most.
- It shows plainly beside "Informal sector earned": "Parks paid ₦… in levies; agberos kept ₦…". A true and slightly bitter line, with no judgement attached.

Pushback, after slice zero. Politics stays terrain, a cost or constraint on building, never its own screen (principles.md §1):

- **Trigger:** your share of a town's trips passes a threshold (around 40%) and danfo departures there fall.
- **Candidate forms, one chosen by playtest:** (a) a settlement, a one-off cost to open a new route from that town's park; (b) touts at your stop, so your vehicles board slower at that park; (c) a strike day, when danfos stop on a road and its riders flood your vehicles.
- **Shown on the map** where it happens. Never a dialog, a meter, or a negotiation screen.

Co-opting, later, as a verb: hand a route to a union cooperative. They run it; you keep the levies and the peace and give up the fares. From memory, Lagos's first BRT buses were run by a cooperative formed from union members; check before relying on it. If true, it is a real decision with a real precedent.

Kept from principles.md §3, Paratransit: informal carries passengers only; inside towns it is acknowledged, not contested; it counts toward growth at half. Regulation verbs (banning okadas from a road, a bus lane) are in Open questions.

## What doing well means

**Doing well means more people get where they want to go, and the towns you serve grow.** There is no win or loss state (sandbox, principles.md §2); the headline is simply what rises when you play well and falls when you don't.

The headline, always on screen:

| Number | What it is | Why it's there |
| --- | --- | --- |
| Trips made a day | Trips between towns that happened, by anyone; an absolute count, as a 5-day average | It rises with growth, so success reads as success. A share hid this (see Evidence). Averaged because one day's count jitters by about what a good move adds (bots baseline: +12.5 against 9.4) |
| Stayed home: no road | Trips between towns that no road joins | Your build job: falls when you build |
| Stayed home: no seat | Trips a road joins, but nobody carried | Your service job: falls when you run vehicles |
| Your riders a day | Trips you carried | Your direct part |
| Budget, and net per day | Funds, and net per day averaged over the last 5 days | The means, not the score. One day's net swings from −₦2 to −₦255 on the same five buses (bots baseline) |

On the map, not as numbers: towns growing (▲, and their circles), new towns appearing along your roads, town rings turning blue.

Explicitly **not** the score:

- **Money.** It is the budget. A big balance and an unchanged region is a poor game.
- **Your share in %.** Shown one click down. As a headline it falls exactly when you grow towns.
- **Beating the danfos.** Pushing them out costs levies and invites pushback. A region where informal carries 30% and nobody stays home is a good outcome.

## Core loop and the arc of a session

**Building pays back through the towns it grows, and the danfos both compete with you and pay you.** That is the loop this brief adds; today the loop stops at fares.

The loop:

- Budget → Build or run: funds
- Build or run → People move: service
- People move → Budget: fares
- People move → Towns grow: service grows towns
- Towns grow → Budget: allocation (the link this brief adds)
- Danfos, kekes, okadas → Budget: tolls and levies
- Danfos, kekes, okadas ↔ People move: rivals for riders

Today only the fares arrow into the budget exists: no tolls, no levies, no allocation. So a road pays back only through the buses on it.

Three timescales:

- **Seconds:** read the map (desire lines, waiting dots, "no road" labels), act, and watch vehicles fill and town rings turn blue.
- **Days:** a route pays or it doesn't; tolls and levies come in; the budget moves.
- **Weeks:** towns grow, the allocation rises, roads wear, and the danfos shift to the gaps you leave.

The arc of a session. One game day is 30 seconds at 1×, so at 2× an hour is about 240 days. The phase lengths are targets: the bots measure where they actually fall.

| Phase | Game days | What you do | The pressure |
| --- | --- | --- | --- |
| Opening | 1–15 | Read the desire lines; first buses on the trunk and through-routes via Ilase | ₦2,500, and many first routes lose money; danfos already carry about half the trips |
| Reach | 15–60 | Connect a cut-off town (Ilaro or Ikole); pave the trunk; the first tolls arrive | A road is a long bet; danfos reach your new road before your buses do |
| Commit | 60–150 | Save for one big project: rail through the towns, or a corridor taken off the danfos | Taking a corridor cuts your levies, and the union pushes back |
| Keep or grow | 150 on | Choose which roads to keep up; extend or consolidate | Upkeep against expansion; growth outruns your seats |

## Player verbs

**Every verb must create a decision; slice zero keeps five of them.** The rest are already built and tested, and come back one per playtest (see Slice zero).

| Verb | Key | The decision it creates | Slice zero |
| --- | --- | --- | --- |
| Build road | R | Which cut-off town or shortcut, and what crossing the river or ridge costs | On, cheapest alignment only |
| Pave road | R on two towns a road joins | Capacity and tolls now, or the cash for vehicles | On |
| Run bus | B | Where frequency pays: busy pairs, through-routes via the hub | On |
| Run minibus | M | Small and cheap for thin routes, or big and efficient for busy ones | On |
| Sell vehicle | − on a route | Cut a loser; raise cash in debt | On |
| Maintain road | F | Whose road is it? Keep the ones your vehicles use | Off until wear returns |
| Straight or round | A | Pay the climb for a shorter trip | Off |
| Lay or restore track, build a halt | K | Restore the wrong old line cheaply, or build the right one dearly | Off |
| Run train | T | A big project: fast and rare, against buses' frequency | Off |
| Run lorry, freight train | L, G | Goods both ways; feeders for export | Off |
| Later candidates | — | Fare level; tolls on or off per road; regulate a road; hand a route to the union | Not built |

A verb that stops creating a decision in play (always done, or never done) is a candidate to cut, whatever it cost to build.

## Fares

**Fares rise with distance, on one schedule set by policy, the same for you and the danfos.** Today every leg pays ₦4 whatever its length. That left long routes unable to pay and made changing buses double the fare (see Evidence).

The schedule, proposed form (numbers to calibrate):

```latex
\text{fare} = F_0 + f \times \text{cells ridden}, \text{ rounded up to the next stage}
```

- **F₀, the boarding fare,** is what a transfer costs a rider: two legs pay one more F₀ than a single leg of the same length. Small enough that hubs still pay; big enough that a through-route is not punished.
- **Stages, not a smooth price.** Danfo fares are called by stop, in steps. Start with a stage of about 10 cells.
- **One schedule for everyone.** This keeps principles.md's "fares are global per cargo kind". Danfos charge the same, so riders still choose on waiting time, as now, except where a toll raises the danfo fare (see Money: riders must respond to price).
- **Goods pay per tonne per cell.** A long lorry run can then pay, and rail's edge over lorries becomes speed and volume, not a side effect of flat fares.

Calibration targets:

- A long through-route via Owode earns about what a short route earns per hour of bus.
- The "long" route verdict becomes rare; it existed to explain flat fares.
- The first vehicle on the best pair still pays back in 5–10 days.

Later: **fare level as a policy dial** (low, standard, high). Higher fares earn more per rider and send more riders to the danfos. A classic lever, and true: fare policy is the authority's.

What this unsettles in principles.md §3: "riders change buses; each leg pays a fare" and "freight: volume over distance is rail's job" were both measured under flat fares. Re-measure both after the change, and re-tune the vehicles' running costs (bus ₦72/day, minibus ₦63/day), which were also set under flat fares.

## Information design

**The map carries the game, the strip carries the headline, detail sits one click down, and the forecasting tools move to a developer view.** Two playtests answered confusion with more text; this section is the rule that stops that.

| Layer | What's there | The question it answers |
| --- | --- | --- |
| Map, always | Desire lines on hover, town rings, waiting dots, traffic and wear on roads, ▲ growth, "no road" labels. New: a toll mark on toll roads, a park mark sized by its levy | Where should I act? |
| Strip, always | The headline numbers (What doing well means) | Am I doing well? |
| One click down, the panel | Per-route profit and loss with a one-line verdict; per-town trips; a Budget breakdown: fares, tolls, levies, allocation, running costs, upkeep | Why? |
| Developer view (`?dev=1`) | Forecasts, receipts, best next moves, lever-audit numbers | You, calibrating. Never the player |

Text budget, pass/fail, each checked by a test where it can be:

- A route verdict is at most 12 words and names one lever.
- The strip and the map carry no sentence with more than one number in it.
- The panel's first screen fits without scrolling at 1440×900.
- Nothing is said only in text that the map could show.

**Hints replace Best next moves.** At most six; each fires once, is triggered by the game's state, is dismissed by doing the thing, and can be switched off. Each points at the map, never at a purchase.

| # | Trigger | Hint |
| --- | --- | --- |
| 1 | Game start | "Hover a town: thick lines are where its people want to go." |
| 2 | First hover of a town that has roads | "A bus runs between two towns a road joins. The thickest line with a road under it is a good start." |
| 3 | First hover of a cut-off town | "Dashed lines have no road. Build one (R) and danfos will come; run a bus and you will." |
| 4 | A route runs 100% full for a day | "Your bus leaves full: riders left behind go to the danfos." |
| 5 | Funds fall under a week of running costs | "Money is low. Selling a losing vehicle returns most of its price (− on the route)." |
| 6 | First road built or paved | "Danfos on a road you built pay its toll and charge their riders more." (Only if tolls stay automatic: Open question 3) |

Kept from what's built: desire lines, town rings, route verdicts ranked by cause, the debt exit named (principles.md: "debt needs its exit named"), prices kept on refusals, the grouped toolbar.

Taken out of the player's view: Best next moves, forecast lines on previews, second-click confirmations, receipts as panel text. A receipt may come back as a brief mark on the map ("+₦40/day" over the route two days on): test it before keeping it.

## Slice zero: what's on, what's off, and the order things come back

**Slice zero is the smallest game that tests this brief: roads, buses and danfos, with the new money and the new headline.** Everything else is already built and tested; it goes behind a switch in `tuning.ts`, not into the bin.

On:

- The hand-made map, terrain (river, ridge) and bridges; road building at the cheapest alignment
- Buses, minibuses, selling; transfers between routes
- Danfos, kekes, okadas; congestion; inside-town informal trips (display only)
- Growth of the original towns; new towns along busy roads
- New: tolls, park levies, state allocation; fares by distance; the new headline; the six hints; a world warmed up before day 1

Off, each behind a switch that defaults to off for slice zero:

- Wear and the Fix tool
- Goods: lorries, freight trains, export
- Rail: track, restoring the old line, halts, trains
- The straight alignment
- Every piece of advice now headed for the developer view

**Warm-up:** the world runs 5 game days before day 1, so the danfos are running and queues have settled when you arrive. Day-1 forecasts were wrong in sign because the world started empty (see Evidence), and an empty start breaks the brownfield pillar anyway.

**The build order for slice zero.** The economics land before the advice leaves. Hide the advice first and hints alone won't get a player out of debt: the day-25 failure again.

1. The brief into the repo as `docs/brief.md`, linked from CLAUDE.md and status.md, once you've agreed the role decision.
2. Bot personas in the probe, run on today's game first, as a baseline before anything changes. First, copy `coldstart.ts`, `connect.ts` and `horizon.ts` into `scripts/` (done 2026-10-17, imports made relative). They report M1–M9, which means adding trips made a day, the no road / no seat split, and that number's daily jitter (M8). Done 2026-10-17: `scripts/slice-bots.ts`; baseline in status.md.
3. Switches in `tuning.ts` for wear, goods, rail and the straight alignment, all off. Re-run the personas to see what switching them off did. The bots pick roads by trips unlocked per naira, measured, not the cheapest road (Ikole–Ogbe is cheapest and nobody would build it), and M2 tests that road.
4. Warm-up: 5 game days before day 1. Warm-up days count toward neither the day counter nor money (funds untouched, the informal sector's earnings start at 0), and the 5-day averages start already filled from them. Re-run `coldstart.ts` after it (`START=warm`).
5. Riders respond to price: the one mechanic that tolls, fares by distance and the fare dial all share.
   5b. Beside it: scale `informalRoadSpace` with road capacity (dirt against paved), so paving lets more danfos run. Today the informal sector's road-space budget is one number for every road, so paving adds no danfos and a toll on a paved road would collect from no more of them. Step 7's tolls depend on it. First, fix how the space is held: a danfo reserves road space on its whole path when it's dispatched (`tick.ts`, `dispatchInformal`) and releases it only when the trip completes (`reapInformal`), so a long run like Ilaro–Ipaja keeps trunk space long after it has left the trunk. That is the likely cause of roads that lower trips made (status.md, step 3: Ilaro–Ipaja takes 60–80 trips a day off the network). Release each segment as the danfo leaves it, then check the cap still prevents the collapse it was added for (principles.md §3, Paratransit). Done 2026-10-17 (status.md): Ilaro–Ipaja goes from −62 to +31 trips a day, and total throughput never collapses; but with 8 of your buses on the trunk, danfos now crowd it (below half speed 60% of the time, your riders 289 → 180). Decided: one road, one budget -- your road space counts against it (status.md, rule 3: at 8 buses, your riders 225 and the trunk below half speed 34% of the time; the danfos on the trunk fall as you add buses). Part 2 scales that shared budget with road capacity. Done 2026-10-17: by surface, tuned to targets rather than the raw capacity ratio (0.6 against 1.6 would evict every danfo at 4 dirt buses): dirt 9, paved 15 (status.md).
6. Fares by distance, then re-tune the vehicles' running costs, and bring routine upkeep on the roads you built or paved forward from step 7. Money is loose (M10: trips-greedy waits on money 1 day in 46) mostly because wear's rough-road discount is still in the running costs: the bus went 3.5 → 3.0 a second when worn roads began costing your vehicles extra (track 2), then 3.0 → 2.4 for the minibus's balance. With wear off, reverse the discount and keep the bus/minibus per-seat-cell ratio: bus × 3.5/3.0 ≈ 2.8, minibus ≈ 2.45. **From step 6 on, M10 is a gate:** every later step must keep it passing. Watch M1 (opening variety) as costs rise.
7. Tolls (passed on to danfo riders), levies and the allocation, tuned until M2, M3, M5 and M6 pass while M10 still passes.
8. The new headline and the panel's budget breakdown.
9. The advice moves to `?dev=1`, and the six hints arrive.
10. The AI harness (`scripts/slice-play.ts`), then the A checks and your session.

The order things come back, one per playtest, each with its own check:

1. **Wear and the Fix tool.** It creates the late-game choice between keeping what you built and building more, and it meets tolls: a toll road you don't keep up loses traffic. *Check:* you keep some roads and drop others, and can say why.
2. **Pushback, one form.** It completes the informal sector's third role. *Check:* at least once you hold back from a corridor because of it, and it feels fair.
3. **Rail:** new track and passenger trains first, then the old line and halts. The big mid-game project. *Check:* by day 30–60 rail is something you save toward, and you choose between restoring and building.
4. **The straight alignment.** A refinement of road building. *Check:* you use it at least once and can say what it bought you.
5. **Goods:** lorries first, then freight trains and export. The deepest system and the least played. *Check:* you run goods both ways on purpose.

## Pass/fail checks: when slice zero is done

**Slice zero is done when every check below passes; until then nothing new gets built and nothing moves to the full game.** Measured checks run in the probe (`scripts/slice-probe.ts`) and become tests where they can. Played checks come from your sessions; AI checks from the harness (see Playtest protocol).

Measured, by the probe (40 days unless stated):

| # | Check | Passes when |
| --- | --- | --- |
| M1 | Opening variety | At least 3 different plans for the first ₦2,500 end day 20 within 25% of the best plan's net |
| M2 | Building pays | A road to a cut-off town plus one vehicle pays back within 60 days, counting tolls, levies and allocation. The road: that town's best by trips unlocked per naira |
| M3 | Paving isn't a no-brainer | Paving the busiest road pays back in 10–30 days; paving a quiet road doesn't within 60 |
| M4 | The headline moves | The best strategy halves "no road" and lifts trips made a day 25% above doing nothing, by day 40 |
| M5 | The tension is real | The strategy carrying the most riders is not the one making the most money; they differ on at least one corridor |
| M6 | No one-verb win | No strategy using a single verb is in the top three on both trips made and money |
| M7 | Warm start | On day 1 the informal share is within 5 points of its day-10 value |
| M8 | Signal over noise | A good action moves trips made a day, as shown (the 5-day average), by at least twice that average's own jitter |
| M9 | Success reads as success | No strategy that grows towns shows a falling headline while it does |
| M10 | Money limits the score | Trips-greedy (below) can't afford its next best move on most days, 15–60: money is the constraint on doing well, not an afterthought |

Played, in your sessions (write down what you felt before changing anything):

| # | Check | Passes when |
| --- | --- | --- |
| P1 | The first ten days | You can say what your first three moves were for, without having read the panel |
| P2 | Diagnosis from the map | You can say why your worst route loses in one sentence, from the map and its one-line verdict |
| P3 | The tension is felt | At least once you leave the danfos a road because of tolls or levies, and it feels like a choice |
| P4 | Visible change | By day 40 you can point at a place you changed: a road, a grown town, a new town |
| P5 | No "what am I doing wrong?" | Any such moment is answered by the headline plus one click |
| P6 | Pull | You want to play past day 40, and can name what you'd do next |

AI harness:

| # | Check | Passes when |
| --- | --- | --- |
| A1 | A readable headline | Playing from the headline and hints only, the agent ends day 30 out of debt in 3 of 5 runs |
| A2 | Less detail needed | Its requests for detail per decision fall over a run |
| A3 | No contradictions | No case logged where the text says one thing and the numbers another |

## Playtest protocol

**Three kinds of test, cheapest first: scripted bots on every change, the AI harness before each of your sessions, and you for feel.** Feel is never delegated.

1. **Scripted bots: free, on every change.** Extend the probe with personas, each reporting the headline numbers at days 10, 20 and 40. They run checks M1–M9.
   - *Greedy:* each move is the best ₦/day available.
   - *Naive:* a bus between the two biggest towns a road joins, repeated.
   - *Builder:* roads to every cut-off town first, then vehicles.
   - *Overbuilder:* spends everything on day 1.
   - *Idle:* does nothing.
   - *Roads only:* builds roads to cut-off towns, nothing else (a one-verb player, for M6).
   - *Trips-greedy:* each move is the best trips made per naira available, losses allowed; if it can't afford that move it saves for it. Plays 60 days, for M10.
   - Roads are chosen by trips unlocked per naira, measured against a twin, never by price alone.
2. **AI playtester: OpenCode's free model, before each of your sessions.** A text harness, `scripts/slice-play.ts`:
   - It keeps an action log (JSON) and replays it from day 1 each turn. The sim replays identically, so it needs no save files, and it doesn't touch Module 10's save/load.
   - Commands: `status` (the strip and hints only), `details <town|route|budget>`, `act <action>`, `run <days>`.
   - It logs every `details` request and every contradiction the agent reports.
   - The agent's brief: play 40 days, one line of reasoning per decision, then report what confused it.
   - Model: `opencode/deepseek-v4-flash-free` ($0). Good at contradictions, dominant strategies and levers that do nothing. Blind to pacing, fun and the map.
3. **You: feel.** A 20–40 minute session, with one system changed since the last one. Before changing anything, write in principles.md §6's playtest log: what you felt, where you hesitated, and what you wanted to do but couldn't. Then answer the step's played checks.

The order for every step: build → bots pass the measured checks → AI harness → your session → update this brief and status.md.

## Evidence: what the review measured

Three measurements drove this brief, all taken on 2026-10-17 with today's tuning. The scripts are in `scripts/` (`coldstart.ts`, `connect.ts`, `horizon.ts`); each re-runs in minutes.

**1. The headline doesn't respond to play.** Share of trips between towns that stayed home (`connect.ts`):

| Strategy | Day 10 | Day 20 | Day 40 | Your share, day 10 → 40 |
| --- | --- | --- | --- | --- |
| Do nothing | 50% | 52% | 55% | 0% |
| Two buses on the trunk | 47% | 56% | 57% | 14% → 11% |
| Roads to Ilaro and Ikole, no vehicles | 43% | 46% | 46% | 0% |
| Those roads plus four vehicles | 36% | 46% | 46% | 19% → 15% |

Two trunk buses end with more people staying home than doing nothing, because the towns they grow make more trips than anyone carries. Confirmed by build step 2's bots: the naive persona (a bus on the trunk every third day) lifts trips made 432 → 605 a day from day 10 to 40 while no seat rises 135 → 315 and no road 230 → 274, as grown towns want trips nobody carries or no road reaches. A share hides that growth; an absolute count shows it.

**2. The forecast can't see slow systems or an empty start** (`coldstart.ts`, moves bought at day 1, ₦ per day):

| Move | Forecast at day 1 | Earned, days 20–30 |
| --- | --- | --- |
| Bus Owode–Ise | 126 | 52 |
| Bus Kuto–Ipaja | 85 | −40 |
| Bus Ilase–Owode | 66 | 70 |
| Minibus Kuto–Ipaja | 48 | −38 |
| Minibus Ilase–Ise | 42 | 5 |
| Bus Ise–Ipaja | 15 | −31 |

Bought at day 9, once the danfos were running, the same three routes were forecast to lose. Most moves earn a third to half less in days 20–30 than in their first ten days as roads wear, which a two-day forecast cannot see (`horizon.ts`).

**3. Flat fares shape the findings.** Every leg pays ₦4 whatever its length, and every tonne of goods ₦4 (`fare`, `produceFare` and `suppliesFare` in `tuning.ts`, charged per unload in `economy/fares.ts`). A long route earns no more per rider than a short one, and a rider who changes buses pays twice.

One more, kept as it is: by day 30 of a two-bus game the strip showed the informal sector had earned ₦33,974 while you held ₦5,041. That contrast is the hook working; keep it on screen.

## Decisions log

**Twelve decisions were drafted on 2026-10-17, three of them from a review of this brief; two are agreed.** Newest first. Change a status as you decide; a rejected decision stays in the log with a line on why.

| Date | Decision | Status |
| --- | --- | --- |
| 2026-10-17 | Routine upkeep per cell on roads you built or paved, independent of wear, balances the income lines (step 7) | Proposed |
| 2026-10-17 | Tolls are passed on to danfo riders as a higher fare, so riders respond to price: one mechanic for tolls, fares by distance and the later fare dial (from the review) | Proposed |
| 2026-10-17 | The allocation rewards growth, which already requires your service; a region left to danfos earns only the base (from the review) | Proposed |
| 2026-10-17 | Build order: fares and the income lines land before the advice moves to `?dev=1` (from the review) | Proposed |
| 2026-10-17 | The player is the state's transport arm, and it also runs its own vehicles | Agreed |
| 2026-10-17 | Money is a budget, fed by fares, tolls, park levies and a state allocation | Proposed |
| 2026-10-17 | The headline: trips made, stayed home split into no road and no seat, your riders. Share moves one click down | Proposed |
| 2026-10-17 | Up to six state-triggered hints replace Best next moves; forecasts and receipts move to a developer view (you, in chat) | Agreed |
| 2026-10-17 | Fares rise with distance, on one schedule for everyone | Proposed |
| 2026-10-17 | Slice zero: wear, goods, rail and the straight alignment go behind switches and return one per playtest | Proposed |
| 2026-10-17 | The world warms up 5 game days before day 1 | Proposed |
| 2026-10-17 | Nothing moves to the full game until slice zero's checks pass | Proposed |
| 2026-10-16 | Eras paused; the slice runs one present-day setting (principles.md §6) | Agreed |
| Earlier | A personal sandbox and an engine foundation; no tutorial, no authored goals (principles.md §2; hints: see Open questions) | Agreed |

## Open questions

**Eight questions are open; each names what would answer it.**

1. **What does a great hour feel like?** You said "connect towns, add buses" feels simplistic. Candidates: bring order to a chaotic corridor; open up the hinterland; out-hustle the danfos without losing the parks. *Answered by:* writing the one sentence you'd want to say after an hour, then holding P6 to it.
2. **Which form of pushback?** A settlement cost, slower boarding at their parks, or strike days. *Answered by:* building the cheapest (a settlement cost) and playing it once.
3. **Tolls automatic, or a choice per road?** Automatic is simpler; a choice adds "toll it and push traffic elsewhere, or keep it free". *Answered by:* M3 and P3. If tolls never feel like a decision, make them one. Passing the toll on to danfo riders already gives automatic tolls a cost: the budget rises and the headline falls.
4. **Does the allocation reward growth or service?** Mostly answered: growth already requires your service (a town grows only once you carry 10% of its trips; new towns need your riders), so the allocation rewards growth you served. *Answered by:* the probe, which only has to settle how big k is: big enough to pass M2, small enough that buses alone don't win (M6).
5. **Regulation verbs:** ban okadas from a highway, reserve a bus lane. True (from memory, Lagos restricted okadas on major roads in 2020) and powerful, but principles.md §1 makes power framing, not a fantasy. *Answered by:* after pushback is played: does the game want a stick, or are tolls and levies enough?
6. **Hints and "no onboarding".** principles.md §2 rules out onboarding; you want hints at the start. *Answered by:* your call on amending §2 to "up to six state-triggered hints, no tutorial".
7. **Do levies soften the antagonist?** If danfos become too valuable to you, the hook goes slack. *Answered by:* M5, and the levy target (20–40% of what you gain by taking a corridor).
8. **The full game: what carries over first?** The 3D map, eras and studio wait. *Answered by:* a separate plan for moving over, written after slice zero passes.

## Glossary

The game's vocabulary, alphabetical. Add a word the session it first matters.

| Term | Meaning |
| --- | --- |
| Agbero | A tout at a motor park or bus stop who collects levies from drivers for the union, keeping a cut |
| Allocation | The state's daily money to you: a fixed base plus a share of the growth you caused |
| Brownfield | The map is never empty: towns, roads, informal transport and a wrong railway exist on day 1 |
| Danfo | A yellow minibus, about 14 seats, that leaves when full; the informal sector's workhorse |
| Desire line | A line from a town to each town its people want to reach; thickness is trips a day |
| Feeder | A route that brings riders to a trunk |
| Halt | A short spur that brings the old line into a town it passes |
| Interchange | A town where riders change between your routes |
| Keke | A three-wheeled taxi, 3 seats |
| Levy | What each informal vehicle pays to load at a park |
| No road / no seat | The two kinds of stayed home: no road joins the towns; or one does, but nobody carried them |
| Okada | A motorcycle taxi, 1 passenger |
| Park | A town's motor park, where danfos load and levies are collected |
| Poached | Your waiting riders taken by a danfo passing through |
| Slice zero | The smallest game that tests this brief (see its section) |
| Slow order | A speed limit on worn track |
| Stage | A fare step: fares are called by stop, so the price rises in steps |
| Through-route | One route running through a hub, carrying every trip along it |
| Toll | What every vehicle except yours pays to use a road you built or paved |
| Trunk | The busiest corridor: Ilase–Owode on today's map |
| Union | The drivers' union (in Nigeria, the NURTW); the agberos work for it |
