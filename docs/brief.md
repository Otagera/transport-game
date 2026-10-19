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
- **Routine upkeep (agreed, step 5):** a cost per cell per day on every road you built or paved, independent of wear: verges, drains, patching, the road agency's standing bill. More on paved roads than dirt (dirt 1 a cell a day, paved 3), and more on bridges (×3). Its job is per road: **a quiet road costs more than it returns, and the strongest strategy still paves its trunk.** (A first target, upkeep a fifth to a third of Greedy's running costs, was a proxy and is dropped: Greedy's money comes from its vehicles, and raising paved upkeep to reach it only made Greedy stop paving -- at 35 a cell its upkeep fell to 3%.) It is the cost that, with step 6's income lines, keeps money a decision. With wear off (slice zero step 3) the bots' money went loose: Greedy ended day 40 with ₦38,590 against ₦354 with wear on, so the budget stopped being a decision by about day 15. Tolls are earned on exactly the roads that carry this cost, so a road you built pays for itself only if traffic uses it: building more roads is never free, and an unused road is a standing loss. Inherited roads you haven't paved cost you nothing; they're the state's old network.
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
| Money limits the score | Not before step 5: Greedy holds ₦38,590 by day 40 with wear off | Trips-greedy waits on money most days 15–60 (M10) |

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

## Revision 1 (agreed 2026-10-19): the corridor's story

**Agreed. A corridor climbs a ladder (dirt → paved → bus lane → rail) because the towns it serves outgrow each rung; the climb is the story you tell, and saving for the next rung is the struggle.** Prompted by your playtest of slice zero after steps 7–8 (principles.md §6, Played 2026-10-19): *"fun for just a few minutes"*, the same map every time, *"not much to do"*, and *"no sense of struggle so its just about pointing one place to another and adding busses"*. By about day 30 every town had a road and money never made you wait. Nothing pushed back, so nothing had to happen next.

What you should be able to say after an hour, revised: "Ilase–Owode started as dirt. I paved it on day 12, gave my buses a lane on day 40 and lost the agberos' goodwill doing it, and by day 90 the old line was carrying it. Owode doubled."

### A corridor

A **corridor** is a whole road between two towns, through any roadside towns on it (what the game already names "the Ilase – Owode road"). It is the unit of the story: the panel gives each corridor of yours a card with its rungs and the day each arrived, and the map draws what it has been.

### The pressure: growth outruns the rung

**A corridor jams because you served it well, not because you neglected it.** Towns along a corridor grow toward a size set by the service they get (built, principles.md §3 Growth); the revision ties that size to the corridor's capacity, so a better rung lets its towns grow, and their growth fills the rung again. **A town's largest size depends on the capacity of its corridors only, never on its current size** (principles.md §3 Growth: `D_max` bounded independently of `D`, or the cap chases the town and growth is exponential in a logistic's clothes). Unserved, a corridor never jams: the danfos carry what they can and the rest stays home.

What a jam means on screen, all already drawn: traffic casings turning red, your buses' speed falling, "no seat" rising on that corridor, and the route verdict "jammed". The fix is the next rung, not another bus.

### The ladder

| Rung | What it changes | Price (target) | What it costs you besides money |
| --- | --- | --- | --- |
| Dirt road | Joins two towns; slow; danfos' road space 9 | About a bus (built) | Routine upkeep: a quiet road costs more than it returns |
| Paved | Carries 1.7× the traffic; danfos' road space 15; your tolls start | About 3–4 buses (built) | Higher upkeep; tolls send some danfo riders home |
| Bus lane | Your vehicles run in a lane congestion doesn't slow; the danfos lose road space on that corridor (back to dirt's, or less), so its tolls and levies fall | About paving again, 10–20 days of surplus | **Pushback arrives with it**: the union answers on that corridor (one form, chosen by playtest: Informal sector). The M5 tension: the corridor that carries most is the one that stops paying you |
| Rail | Restore the old line or lay new track, halts, trains: takes the corridor's long trips off the road altogether | 20–40 days of surplus: the big project (Commit phase) | Rail's own upkeep; the road's danfos keep the short trips |

The bus lane is a regulation verb (Open question 5), answered here as a rung: a stick with a price, in levies lost and pushback.

### Proposed (2026-10-19): lane encroachment, and pushback that costs

**Proposed. A bus lane is only yours while you pay to keep it: danfos drive in it unless enforcement is paid for, and the lane's speed advantage wears away with encroachment.** Measured on 1b (status.md): the lane as built costs the corridor 0.4% of its net in tolls and levies (₦9 a day against ₦2,413), and the strike *earns* you money: on 3 of 4 strike days the danfos' riders flooded your buses and you ended ₦22–38 ahead of a world without the strike. So neither is pushback yet.

- **Encroachment:** each day a lane goes unenforced, danfos (and okadas) take more of it: a share of the danfos' traffic runs in the lane, slowing your buses there, up to the lane being no faster than the road. True to how bus lanes go where enforcement lapses.
- **Enforcement** is a running cost per lane, paid daily (wardens; a Lagos-style traffic agency): paid, encroachment falls back; unpaid, it grows. A choice each day between the lane's speed and its cost.
- **On the map:** yellow danfos drawn inside the lane's blue band as encroachment grows, and the band fading; an enforced lane draws clean, with a warden mark.
- **The strike must cost you:** as built, its riders come to you. Candidates for a decision: strikers block the lane too (your buses stuck behind them that day); or a strike day closes the corridor's parks to your boardings. Either way the check below holds it to a cost.

### Guarding against a treadmill

**Each rung must visibly change the corridor and buy about 20–40 days before the next jam.** A ladder you climb only to stay in place is a chore. So:

- **Visible:** each rung draws differently (dirt dashed, paved solid, a coloured lane beside the road, track), the corridor's earlier rung stays faint on the map where the alignment changed, and its card lists the rungs and their days. That card is the story.
- **Measured:** the bots measure days from a rung to that corridor's next jam (check C1). Under 20 is a treadmill; over 40 and the rung was the end of the story.
- **Not every corridor climbs, but one does:** a corridor whose towns stop growing (small towns, the cap) stays on its rung. A map where every corridor is rail by day 100 fails, and so does one where no corridor reaches rail by day 100–150 in a good game.

### Money: the struggle is saving for the next rung

**Money binds when the rung you need costs more than you have.** Today it never does (M10 passes only at 14.6%; ₦25,644 in funds on day 33 of your playtest). With the ladder, the next rung is a project you save for while the corridor jams. Two things follow, both proposed:

- **The treasury leaves a named project alone, for a while.** Name the rung you're saving for (a corridor and a rung), and what you set aside for it isn't remitted (Open question 9's "save for a named project"). If the rung isn't built within about 30 days, the set-aside lapses to the treasury: a named project is a commitment, not a place to hide money. Without set-asides, the 80% remittance above the ₦3,000 reserve makes rail unreachable. With them, saving is a visible choice: money set aside isn't buying buses.
- **Rungs are priced against the surplus they arrive in:** a bus lane 10–20 days of a mid-game surplus, rail 20–40. The bots tune it (check C2).

### Eras stay paused

Calendar eras stay paused (principles.md §6). Each corridor climbs at its own pace, as its towns grow; the region is never in one era. A corridor at rail beside one still on dirt is the brownfield pillar played forward.

### The order

1. **Pressure and the ladder, one change and one measurement at a time:**
   - **1a. Growth tied to corridor capacity, alone.** Measure C1 and the 20–40-day breathing-room guard before anything else changes.
   - **1b. The bus lane and pushback** (one form, on the map). Measure C3.
   - Then the corridor card and its drawn history, and the named project the treasury leaves alone (C2); M10 and day-60 M1 again.
2. **Rail returns as the top rung** (switched on; restore the old line, new track, halts, trains), priced for C2.
3. **A seeded variation of the hand-made map:** the same geography, with town sizes and the river's crossing points varied by a seed, so a second game differs (P8). Full map generation waits until the variation has been played. **Proposed, not built:** if the playtest says the maps feel the same, the next step before full generation is to vary the inherited road network per seed (which towns start cut off, which corridor is the trunk): sizes alone change the game only when a cut-off town comes up big (principles.md §3, Maps).
4. **Wear returns after rail** (Fix tool): keeping what you built against climbing further.

The straight alignment and goods come back later, one per playtest, as before.

### Checks for Revision 1

| # | Check | Passes when |
| --- | --- | --- |
| C1 | A rung buys time | Each rung buys 20–40 days of growth: from the rung, its corridor's towns keep growing that long before they level off (agreed 2026-10-19; dirt and paved corridors never visibly jam -- their towns stop at the rung's cap, so the town card says "<Town> can't grow: its road is full. <Next step> to grow further."). A jam, where one is measured, is judged by its consequences, not speed: "no seat" rising clearly above its low since the rung, or the towns falling from their peak |
| C2 | Money makes you wait | Trips-greedy waits on money for a rung on at least a quarter of days 20–60; a bus lane costs 10–20 days of its surplus, rail 20–40 |
| C3 | Each enforcement choice wins somewhere | A bus lane's enforcement is a real choice (agreed 2026-10-19, replacing "lowers takings" and the 10%-of-net bar): run strict against lax on the trunk and on a modest corridor; it passes if the better choice (your money over the lane's first 40 days) differs between them. Pushback still shows on the map where it happens, and a strike day costs you money against a twin without it |
| C4 | Some corridors climb, not all | By day 100, at most half the strongest strategy's corridors have passed paved; and a good game gets at least one corridor to rail by day 100–150 |
| P7 | A story to tell | After a session you can tell one corridor's story in a sentence, with days in it |
| P8 | The second game differs | A new seed changes at least your first three moves. Read (agreed 2026-10-19) as two measured parts, and your playtest is the real P8: (a) on a new seed, at least 2 of trips-greedy's first 3 moves are new against seed 0's; (b) seed 0's opening (trips-greedy's day-1 moves), replayed on the new seed, makes at least 15% fewer trips made by day 20 (5-day average, all trips, informal included: a road to a cut-off town shows there first) than that seed's best opening, the best of trips-greedy's, greedy's and the replayed one (agreed 2026-10-19: trips-greedy alone buys a cheap opening, not the best one). Every opening buys on day 1 only, then holds. Ilase is always the largest town, by design |

The slice-zero checks that pass stay as regression checks. **Closing slice zero is a one-time, recorded exception** to "nothing moves on until every check passes": M5 is replaced by C3 (the tension it asked for comes from the bus lane and pushback); M2 stays a finding (principles.md §3: a lifeline road buys trips at a premium); day-60 M1 is re-measured under Revision 1. **For Revision 1, every check passes before moving on.**

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

**Warm-up:** the world runs 7 game days before day 1, so the danfos are running and queues have settled when you arrive. Day-1 forecasts were wrong in sign because the world started empty (see Evidence), and an empty start breaks the brownfield pillar anyway.

**The build order for slice zero.** The economics land before the advice leaves. Hide the advice first and hints alone won't get a player out of debt: the day-25 failure again.

1. The brief into the repo as `docs/brief.md`, linked from CLAUDE.md and status.md, once you've agreed the role decision.
2. Bot personas in the probe, run on today's game first, as a baseline before anything changes. First, copy `coldstart.ts`, `connect.ts` and `horizon.ts` into `scripts/` (done 2026-10-17, imports made relative). They report M1–M9, which means adding trips made a day, the no road / no seat split, and that number's daily jitter (M8). Done 2026-10-17: `scripts/slice-bots.ts`; baseline in status.md.
3. Switches in `tuning.ts` for wear, goods, rail and the straight alignment, all off. Re-run the personas to see what switching them off did. The bots pick roads by trips unlocked per naira, measured, not the cheapest road (Ikole–Ogbe is cheapest and nobody would build it), and M2 tests that road.
4. Warm-up: 5 game days before day 1 (7 since the post-5b baseline: at 5 the informal share still moved 6 points by day 10, M7's limit is 5; at 7 it moves ~2). Warm-up days count toward neither the day counter nor money (funds untouched, the informal sector's earnings start at 0), and the 5-day averages start already filled from them. Re-run `coldstart.ts` after it (`START=warm`).
4b. Danfo road space (built before the reorder, as 5b): scale `informalRoadSpace` with road capacity (dirt against paved), so paving lets more danfos run. Today the informal sector's road-space budget is one number for every road, so paving adds no danfos and a toll on a paved road would collect from no more of them. The tolls (now step 6) depend on it. First, fix how the space is held: a danfo reserves road space on its whole path when it's dispatched (`tick.ts`, `dispatchInformal`) and releases it only when the trip completes (`reapInformal`), so a long run like Ilaro–Ipaja keeps trunk space long after it has left the trunk. That is the likely cause of roads that lower trips made (status.md, step 3: Ilaro–Ipaja takes 60–80 trips a day off the network). Release each segment as the danfo leaves it, then check the cap still prevents the collapse it was added for (principles.md §3, Paratransit). Done 2026-10-17 (status.md): Ilaro–Ipaja goes from −62 to +31 trips a day, and total throughput never collapses; but with 8 of your buses on the trunk, danfos now crowd it (below half speed 60% of the time, your riders 289 → 180). Decided: one road, one budget -- your road space counts against it (status.md, rule 3: at 8 buses, your riders 225 and the trunk below half speed 34% of the time; the danfos on the trunk fall as you add buses). Part 2 scales that shared budget with road capacity. Done 2026-10-17: by surface, tuned to targets rather than the raw capacity ratio (0.6 against 1.6 would evict every danfo at 4 dirt buses): dirt 9, paved 15 (status.md).
**The order from here, reordered 2026-10-17:** money first (step 5, formerly 6), then price response with tolls (step 6, formerly 5 and 7).

5. Fares by distance, then re-tune the vehicles' running costs, and bring routine upkeep on the roads you built or paved forward (it was step 7's). Money is loose (M10: trips-greedy waits on money 1 day in 46) mostly because wear's rough-road discount is still in the running costs: the bus went 3.5 → 3.0 a second when worn roads began costing your vehicles extra (track 2), then 3.0 → 2.4 for the minibus's balance. With wear off, reverse the discount and keep the bus/minibus per-seat-cell ratio: bus × 3.5/3.0 ≈ 2.8, minibus ≈ 2.45. **From step 5 on, M10 is a gate:** every later step must keep it passing. Watch M1 (opening variety) as costs rise. **Agreed:** roads you build start as dirt (cheaper than ₦15 a cell), and paving is the dear upgrade, priced so paving the trunk costs about 3–4 buses (₦1,500–2,000), through the cost function (`engine/pathing/cost.ts` via `roads.ts`: the cost function is the build price). Routine upkeep (Money, Costs) comes in here too. The surplus is large (trips-greedy ends day 60 with ₦30,915), so expect big moves. Today paving the trunk costs ~₦380–435 and adds ~158 trips a day with no buses (389 → 547) and ~230 with 2: about six times a bus per naira, the dominant opening (status.md, 5b part 2), and every road you build is born paved.
6. Riders respond to price, built together with tolls: the price response is inert until a toll creates a fare gap. Then tolls (passed on to danfo riders), levies and the allocation, tuned until M2, M3, M5 and M6 pass while M10 still passes. In two measured passes. **(1)** Price response, tolls, levies, the allocation; then measure M2, M3, M5 and the four openings' curves (net and trips made a day, to day 60). **(2)** The treasury remittance (Decisions log); then measure M10 and the curves again. *Checked first (2026-10-18):* tolls alone can't close the openings' gap. Infrastructure-first trails vehicles-first by ~₦1,000 a day at day 20, and informal riders a day on the roads you built or paved are ~100 (roads to Ilaro and Ikole) or ~200 (the paved trunk): ₦1,000 a day would be ₦9–10 a rider (1.6–1.9 fares) or ₦5 (0.8 of a fare). The catch-up has to come from the growth allocation, and from the remittance damping the vehicle snowball; tolls are tuned for M3 and the tension (M5), not to carry the openings.
7. The new headline and the panel's budget breakdown. Done 2026-10-19, styled from the design lab's "The brief, step 8" preset (render-and-ui.md §7).
8. The advice moves to `?dev=1`, and the six hints arrive. Done 2026-10-19.
9. The AI harness (`scripts/slice-play.ts`), then the A checks and your session.

The order things come back, one per playtest, each with its own check (*superseded if Revision 1 is agreed: pushback comes with the bus lane, rail returns as the top rung, then wear; see Revision 1, The order*):

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
| M1 | Opening variety | At least 3 different plans for the first ₦2,500 end day 20 within 25% of the best plan's net. *Proposed (2026-10-18):* the plans are four openings of equal skill (all the first ₦2,500 on buses, minibuses, roads or paving, then the same greedy policy); vehicles-first may lead at day 20, but infrastructure-first catches up or overtakes on trips made by about day 60 and is within 25% on net by then |
| M2 | Building pays | A road to a cut-off town plus one vehicle pays back within 60 days, counting tolls, levies and allocation. The road: that town's best by trips unlocked per naira. *Proposed (2026-10-18):* busy roads pay in money (M3); lifeline roads pay in trips. The road plus one vehicle passes if its added trips cost about what good moves' do (naira per added trip a day, measured over 60 days, within 1.5× the median of what trips-greedy actually bought on days 20–30) and its running loss is affordable on a balanced budget (at most a fifth of trips-greedy's net a day, days 16–20) |
| M3 | Paving isn't a no-brainer | Paving the busiest road pays back in 10–30 days; paving a quiet road doesn't within 60 |
| M4 | The headline moves | The best strategy halves "no road" and lifts trips made a day 25% above doing nothing, by day 40 |
| M5 | The tension is real | The strategy carrying the most riders is not the one making the most money; they differ on at least one corridor. *Expected to fail until pushback (after slice zero); the allocation is not tuned to flip it (2026-10-18)* |
| M6 | No one-verb win | No strategy using a single verb is in the top three on both trips made and money |
| M7 | Warm start | On day 1 the informal share is within 5 points of its day-10 value |
| M8 | Signal over noise | A good action moves the number it acts on, as shown (the 5-day average), by at least twice that number's own jitter: a vehicle moves your riders; a road or paving moves trips made |
| M9 | Success reads as success | No strategy that grows towns shows a headline falling by more than the noise (over 50 trips a day or 10%) while it does |
| M10 | Money limits the score | Trips-greedy (budget-balancing, below) makes at least ~15% fewer trips (14.5% passes, flagged borderline below 15%) by day 20 than the same policy with unlimited money, above the noise: money sets the pace of the build-out. (Day 20: by day 40 both fill the map and the comparison measures the map, not money.) |

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
   - *Trips-greedy:* each day it buys down its list of moves by trips made per naira, for as long as it can afford the next and its budget balances (net a day plus the moves' forecasts at or above zero). Plays 60 days. *Trips-greedy unlimited* plays the same policy with its funds topped up and no remittance: M10's comparison.
   - *Openings* (M1): four of equal skill, spending the whole first ₦2,500 on buses, minibuses, roads or paving, then playing greedy to day 60.
   - Roads are chosen by trips unlocked per naira, measured against a twin, never by price alone. Paving is a move like any other (`moves.ts` `paveMoves`), ranked the same way: Greedy and trips-greedy consider it.
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

**Thirty decisions were drafted on 2026-10-17 to 19, three of them from a review of this brief; seven are agreed.** Newest first. Change a status as you decide; a rejected decision stays in the log with a line on why.

| Date | Decision | Status |
| --- | --- | --- |
| 2026-10-19 | If the playtest says the maps feel the same, vary the inherited road network per seed (which towns start cut off, which corridor is the trunk) before full map generation. Varying town sizes and the river alone changes the game only when a cut-off town comes up big (P8 (b), status.md) | Proposed |
| 2026-10-19 | P8 read as (a) at least 2 of trips-greedy's first 3 moves new on a new seed, and (b) seed 0's opening replayed there makes at least 15% fewer trips by day 20 than the best of trips-greedy's, greedy's and the replayed opening, on all trips. Ilase stays the largest town, by design; the cut-off towns vary from a third to three times their size, the rest half to double. Your playtest is the real P8 | Agreed 2026-10-19 |
| 2026-10-19 | A bus lane opens with no wardens (lax): strict enforcement is a choice you make (Road tool on the lane), not a default you inherit. The union answers a new lane with a strike within days regardless, each new lane a few days after the last. Every called strike has a way out on its route and town cards: "Settle with the union" (always; about half what the strike would cost you, at least ₦150 -- the settlement form of pushback, Open question 2) and "Relax enforcement" (if the lane was strict when it was called). A strike that cost you nothing says "no loss to you". From the playtest: "I can't tell what I can do in this case since I did not put restrictions" | Proposed |
| 2026-10-19 | The union announces a strike about 4 days ahead (3–5), and relaxing the lane's enforcement before then calls it off; a strike announced while the lane is already lax goes ahead. Strikes last 2 days, at about half the frequency (strict every ~24 days, lax ~120). A strike is shown on the route and town cards, as a tag on the road (called, on, then "struck day N · cost ₦X" for a few days), and as "Lost to strikes" under the budget's net; at 4× the game can pause when one is called or begins (P). From the playtest: "did a strike land? I couldn't tell" | Proposed |
| 2026-10-19 | Strikes follow enforcement, not a timer: strict enforcement keeps the lane fast and clear but raises strike frequency (the union's grievance builds faster); lax enforcement keeps the peace but lets encroachment wear the lane down. A strike blocks the lane: your buses fall back into general traffic and the corridor's "no seat" spikes | Proposed |
| 2026-10-19 | C1 reads as days of growth a rung buys; the town card names a town that can't grow because its road is full, and the next rung. C3 becomes "each enforcement choice wins somewhere" (strict against lax, trunk and a modest corridor; the better choice must differ). Stop before rail: you playtest the ladder (dirt → paved → lane), checking P7 | Agreed 2026-10-19 |
| 2026-10-19 | C1's jam is judged by consequences: "no seat" rising clearly above its low since the rung, or the corridor's towns falling from their peak; not a speed threshold | Agreed 2026-10-19 |
| 2026-10-19 | Lane encroachment: danfos drive in a bus lane unless enforcement is paid for daily; the lane's speed advantage wears away with encroachment, shown on the map. A strike must cost the player (1b measured it earning ₦22–38). C3 requires the lane's cost to be at least 10% of the corridor's net | Proposed |
| 2026-10-19 | Revision 1: the corridor's story. A corridor climbs dirt → paved → bus lane → rail as its towns outgrow each rung; each rung visibly changes it and buys about 20–40 days before the next jam; the bus lane takes road space from the danfos and brings pushback (M5); calendar eras stay paused. Order: pressure and the ladder, rail as the top rung, a seeded variation of the hand-made map, then wear. Prompted by your playtest (principles.md §6, 2026-10-19) | Agreed 2026-10-19 |
| 2026-10-19 | Slice zero closes by a one-time recorded exception: M5 replaced by C3, M2 kept as a finding, day-60 M1 re-measured under Revision 1. "Every check passes before moving on" stays in force for Revision 1 | Agreed 2026-10-19 |
| 2026-10-19 | The treasury leaves a named project alone: money set aside for a named rung isn't remitted, and lapses to the treasury if the rung isn't built within about 30 days (Open question 9) | Agreed 2026-10-19 |
| 2026-10-19 | A town's largest size depends on its corridors' capacity only, never on its current size (principles.md §3 Growth) | Agreed 2026-10-19 |
| 2026-10-18 | M2 is read in trips: a lifeline road (to a cut-off town) plus one vehicle passes if its added trips cost about what other good moves' do and its running loss is affordable on a balanced budget. Busy roads pay in money (M3); lifeline roads pay in trips. The allocation goes back to ₦10 per thousand: at ₦15 trips-greedy built out as if money were unlimited (M10) | Proposed |
| 2026-10-18 | M1 is read on four openings of equal skill: vehicles-first may lead at day 20; infrastructure-first catches up or overtakes on trips made by about day 60, within 25% on net | Proposed |
| 2026-10-18 | Treasury remittance: every 10 game days the state takes 80% of your funds above a reserve limit (about ₦3,000 in slice zero; raised when rail returns), never more than that period's net surplus; a deficit pays nothing. So openings are untouched, compounding is capped, and saving for a project stays possible -- 80% of each period's whole surplus would cap saving at 20% a period, putting any project bigger than one period's surplus out of reach (₦5,000 at ₦2,000 a period: ~125 days). As reported, 2007 Act: Nigeria's Fiscal Responsibility Act 2007 has corporations remit 80% of operating surplus to the Consolidated Revenue Fund and keep 20% (consistent across reports; the statute text unchecked; a 2024 re-enactment bill passed second reading, enactment unconfirmed). Proposed for M10, instead of a per-vehicle depot charge | Proposed |
| 2026-10-18 | Fares by distance: ₦1 boarding plus ₦1.0 per 10-cell stage, set for the opening (a builder's minibus to a newly connected town pays at 1.0, loses ₦42 a day at 0.8); the snowball is fixed separately (M10 fails) | Agreed |
| 2026-10-17 | Roads you build start as dirt; paving is the dear upgrade, the trunk costing about 3–4 buses, priced through the cost function (step 5) | Agreed |
| 2026-10-17 | Routine upkeep per cell on roads you built or paved (dirt 1, paved 3, bridges ×3), independent of wear: a quiet road costs more than it returns; the strongest strategy still paves its trunk (step 5). Use-based upkeep returns with wear, after slice zero | Agreed |
| 2026-10-17 | Order: money (step 5) before price response, which is built with tolls (step 6) | Agreed |
| 2026-10-17 | Tolls are passed on to danfo riders as a higher fare, so riders respond to price: one mechanic for tolls, fares by distance and the later fare dial (from the review) | Proposed |
| 2026-10-17 | The allocation rewards growth, which already requires your service; a region left to danfos earns only the base (from the review) | Proposed |
| 2026-10-17 | Build order: fares and the income lines land before the advice moves to `?dev=1` (from the review) | Proposed |
| 2026-10-17 | The player is the state's transport arm, and it also runs its own vehicles | Agreed |
| 2026-10-17 | Money is a budget, fed by fares, tolls, park levies and a state allocation | Proposed |
| 2026-10-17 | The headline: trips made, stayed home split into no road and no seat, your riders. Share moves one click down | Proposed |
| 2026-10-17 | Up to six state-triggered hints replace Best next moves; forecasts and receipts move to a developer view (you, in chat) | Agreed |
| 2026-10-17 | Fares rise with distance, on one schedule for everyone | Proposed |
| 2026-10-17 | Slice zero: wear, goods, rail and the straight alignment go behind switches and return one per playtest | Proposed |
| 2026-10-17 | The world warms up before day 1 (5 game days; 7 since the post-5b baseline, for M7) | Proposed |
| 2026-10-17 | Nothing moves to the full game until slice zero's checks pass | Proposed |
| 2026-10-16 | Eras paused; the slice runs one present-day setting (principles.md §6) | Agreed |
| Earlier | A personal sandbox and an engine foundation; no tutorial, no authored goals (principles.md §2; hints: see Open questions) | Agreed |

## Open questions

**Nine questions are open; each names what would answer it.**

1. **What does a great hour feel like?** You said "connect towns, add buses" feels simplistic. Candidates: bring order to a chaotic corridor; open up the hinterland; out-hustle the danfos without losing the parks. *Answered by:* writing the one sentence you'd want to say after an hour, then holding P6 to it.
2. **Which form of pushback?** A settlement cost, slower boarding at their parks, or strike days. *Answered by:* building the cheapest (a settlement cost) and playing it once. *Revision 1 (proposed 2026-10-19): strikes, with a settlement as the way to call one off.*
3. **Tolls automatic, or a choice per road?** Automatic is simpler; a choice adds "toll it and push traffic elsewhere, or keep it free". *Answered by:* M3 and P3. If tolls never feel like a decision, make them one. Passing the toll on to danfo riders already gives automatic tolls a cost: the budget rises and the headline falls.
4. **Does the allocation reward growth or service?** Mostly answered: growth already requires your service (a town grows only once you carry 10% of its trips; new towns need your riders), so the allocation rewards growth you served. *Answered by:* the probe, which only has to settle how big k is: big enough to pass M2, small enough that buses alone don't win (M6).
5. **Regulation verbs:** ban okadas from a highway, reserve a bus lane. *Revision 1 (agreed) answers the bus lane as a rung of the ladder.* True (from memory, Lagos restricted okadas on major roads in 2020) and powerful, but principles.md §1 makes power framing, not a fantasy. *Answered by:* after pushback is played: does the game want a stick, or are tolls and levies enough?
6. **Hints and "no onboarding".** principles.md §2 rules out onboarding; you want hints at the start. *Answered by:* your call on amending §2 to "up to six state-triggered hints, no tutorial".
7. **Do levies soften the antagonist?** If danfos become too valuable to you, the hook goes slack. *Answered by:* M5, and the levy target (20–40% of what you gain by taking a corridor).
8. **The full game: what carries over first?** The 3D map, eras and studio wait. *Answered by:* a separate plan for moving over, written after slice zero passes.
9. **Who pays for what: one budget, or capital and operations apart?** Truer to a state transport agency: capital (roads, paving, track, vehicles) comes from the state budget, and fares cover operations. Today one pot pays for both, so a profitable fleet funds its own expansion (the snowball M10 measures). Splitting them would make the allocation the capital budget and fares the operating account. The reported definition of the surplus a corporation remits -- revenue above approved spending -- also supports a later action: **save for a named project**, money set aside for an approved project that the remittance doesn't take. *Answered by:* whether the treasury remittance (Decisions log) fixes M10 without it; if it doesn't, or the split reads truer in play, build it. *Revision 1 (agreed) takes the named project: savings for a named rung aren't remitted, and lapse to the treasury after about 30 days unbuilt.*

## Glossary

The game's vocabulary, alphabetical. Add a word the session it first matters.

| Term | Meaning |
| --- | --- |
| Agbero | A tout at a motor park or bus stop who collects levies from drivers for the union, keeping a cut |
| Allocation | The state's daily money to you: a fixed base plus a share of the growth you caused |
| Brownfield | The map is never empty: towns, roads, informal transport and a wrong railway exist on day 1 |
| Bus lane | A rung of the ladder: a lane on a paved corridor that only your vehicles use; the danfos lose road space there (Revision 1) |
| Corridor | A whole road between two towns, through any roadside towns on it: the unit that climbs the ladder (Revision 1) |
| Danfo | A yellow minibus, about 14 seats, that leaves when full; the informal sector's workhorse |
| Desire line | A line from a town to each town its people want to reach; thickness is trips a day |
| Feeder | A route that brings riders to a trunk |
| Halt | A short spur that brings the old line into a town it passes |
| Interchange | A town where riders change between your routes |
| Jam | A corridor whose traffic holds your vehicles well below free speed and whose "no seat" is rising: the signal for the next rung (Revision 1) |
| Keke | A three-wheeled taxi, 3 seats |
| Ladder, rung | The upgrades a corridor climbs, dirt → paved → bus lane → rail; each is a rung (Revision 1) |
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
