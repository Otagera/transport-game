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
| Levy lost by taking a corridor from danfos | Measured 2026-10-19 (R1 6, `corridors.ts`): ₦1–10 a day on a taken trunk (3–4 buses), about 2% of the fares there -- your riders are mostly ones who'd have stayed home, so the danfos' departures barely fall | 20–40% of what your vehicles gain there: felt, never decisive |
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
3. **A seeded variation of the hand-made map:** the same geography, with town sizes and the river's crossing points varied by a seed, so a second game differs (P8). Full map generation waits until the variation has been played. The playtest said the maps feel the same; generated maps with guards are next (After the ladder's playtest, 5): sizes alone change the game only when a cut-off town comes up big (principles.md §3, Maps).
4. **Wear returns after rail** (Fix tool): keeping what you built against climbing further.

### After the ladder's playtest (2026-10-19)

Your playtest of the whole ladder (principles.md §6): rail after 100+ days with idle waiting; played for money; the treasury unnoticed, felt as incidental loss; rail's payoff temporary ("I already know all the routes"); strikes let pass or paid once. Agreed 2026-10-19: build in order, each played before the next, ahead of wear (4 above):

1. **The treasury visible, inside the existing budget breakdown -- no new panel.** A "Treasury took" line; a countdown to the next remittance ("₦X over the reserve goes to the treasury in N days; spend it or set it aside"); a progress bar on a set-aside (the named project); and the 10-day remittance as a toast naming the amount. A full treasury panel waits for the full game.
2. **The score as visible as money.** Town-growth milestones, and the trips-made trend.
3. **Each corridor's informal share, and "corridor taken" as a visible state**, with what taking it costs (levies lost, pushback).
4. **Proposed, not built: rail reshapes the map.** Towns with a station grow (beyond the rail cap's ceiling alone), and new desire lines appear (trips that didn't exist before rail: new pairs, a station town pulling from its neighbours), so the network you know stops being the whole map once rail opens. Prompted by "I already know all the routes".

**Next, agreed 2026-10-19 after the playtest of R1 4-6 ("I think I have played to its end"; seeds read as "the same map just the names rearranged"):**

5. **Generated maps, per seed, with guards.** A seed draws where about 9 towns sit (spacing rules, not the hand-made positions nudged), which corridor is the inherited trunk, which 2-3 towns start cut off, where the old railway runs, and where the dominant city sits (coast, river or inland). Kept: one dominant city, the largest town; a river that splits the map; one ridge; every town reachable by building roads; seed 0 is the hand-made map, unchanged. **Guards** reject a seed and draw again: the trunk's length within about ±25% of today's (Ilase-Owode-Ado), so the ladder's prices land as measured (a lane ~14 days of surplus, rail ~28: C2); one dominant city; the river splitting the map; 2-3 cut-off towns. Borrow `engine/map`'s placement and connectivity checks, not the whole generator. No re-tuning: the ladder's numbers are rules (caps as shares of capacity, prices per cell), so they carry over; check with one corridor-probe run on 3 seeds that rail is reachable around day 100-150, then your playtest. P8 re-measured on generated seeds.
   - **Alongside: TAKEN only when it changes.** A toast and a map tag that fades after a few days when a corridor is taken or lost; a corridor that stays taken shows in the Corridors section, not on the map (playtest: about 17 tags, some over town names). Whether taking a corridor should cost real money stays parked until (4) is played (status.md, R1 6: ₦1-10 a day against the brief's 20-40%).
6. **Then (4), once you agree it:** rail reshapes the map.
7. **Then wear** (4 in the order above).

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

## Revision 2 (agreed 2026-10-19): a second economy

**Agreed 2026-10-19, all of it; built in the order below, without waiting on step 1's playtest (your call: "we've agreed on the goods et al."). The late game has problems it doesn't show (step 1, built first), and a map that asks for a fixed amount of building has nothing to ask once it's built; a second economy -- industries that open and close, goods that must be moved, rail with a job of its own -- keeps new problems arriving after every town is connected.** Prompted by your playtest of R1 7 (principles.md §6, Played 2026-10-19, a generated map to day 210): *"I think I have gotten to its end"*, *"nothing more to build"*, and your read that stopping here makes it *Mini Metro with money*. On screen at day 210: 2,865 trips a day with no seat against 3,337 of your riders, three towns falling, and ₦72,385 in the bank. The map still had problems; none of them asked for a move.

What you should be able to say after an hour, revised again: "Ikire turned out to be the hub. The quarry opened on day 90 and its lorries jammed the Ikire road until I put a spur in; when it closed on day 160 I pulled the spur up and the track went to passengers. The truckers took the mill's loads until I undercut them."

Both questions this draft turned on were answered yes (2026-10-19): the informal answer for goods (truckers, market touts) is your game, and step 1 came first.

### Step 1: show the problems the late game already has

**Built first** (2026-10-19). Its playtest was to size the rest; you agreed the rest outright instead, so the steps after it go ahead in order.

What's missing today, from the code (`main.ts` `problemText`, `growthText`):

- **A shrinking town isn't told why.** The card says "shrinking toward 31k" and the service share, not what changed: its service fell (whose: yours, or the danfos' as you took their road), or its cap fell (a lane encroached, worn track under a slow order), or a neighbour it traded with fell.
- **"No seat" names no fix.** The last problem line reads "N% of its trips have a road but no seat: nobody carried them": no corridor, no move. At day 210 that was 2,865 trips a day.
- **The map doesn't carry it** (Information design: "nothing is said only in text that the map could show"). No seat is a chip in the strip and a grey slice of a bar.

Proposed, each a line where the player already looks, each naming one move:

| Where | What it says | The move it names |
| --- | --- | --- |
| Town card, shrinking | "<Town> is shrinking: you carry 6% of its trips, down from 14% on day 120 (you sold the Ikire bus)" / "its lane is 60% encroached" / "its line is under a slow order" | The bus back, enforce the lane, keep the track up |
| Town card, no seat | "212 of its trips a day find no seat, most toward Ikire on the Ikire road" | Another vehicle there, a through-route, or the next rung if that road is full |
| Corridors section | Each corridor's no seat a day, worst first, with the same named move | As above |
| Map | Unserved trips drawn on the corridor: a grey band beside the road, as thick as its no seat a day, the way traffic is drawn now | Read where to act without opening a card |

**Measured** (check C5, below): from day 150 on a good game, the screen names an affordable move on most days. If it already does and you still find nothing to do, the problem isn't legibility, and the rest of this revision is the answer.

### The second economy: industries that open and close

**Industries are sites on the map that want goods moved, and they come and go, so the map keeps asking.** Goods return from slice zero's switch (`goods.ts`: produce to the nearest market, supplies from the port, export from markets, lorries and freight trains, spoilage at the yard), with industries as the new source of what's moved.

- **What an industry is:** a site, not a town (no passengers of its own beyond a few workers), with an input and an output, each a different cargo (principles.md §3: goods stay one-way; reverse flows are different cargo). Three kinds to start, each true here:
  - **Quarry** (granite, laterite): no input; heavy output to the towns that are growing (construction follows growth) and to the port. A quarry near a ridge.
  - **Mill** (rice, cassava, palm oil): produce in from farm towns, food out to markets. Near farm towns.
  - **Factory** (cement, bottling): supplies in from the port, goods out to the big towns. Near the dominant city or the trunk.
- **They open and close.** One opens every 20–40 days (a target), where its kind fits the map, announced like a strike (a toast, a mark on the map) with what it wants and from where; one with nothing moved for its first ~30 days, or with its input cut off, closes, and its line goes quiet. A closed site stays on the map as a ruin, like an emptied town. Towns don't flood the map (your taste: towns appear over time, not a flood); industries are the new arrivals.
- **Why you move them:** goods pay per tonne per cell (Fares), and goods pay only where they go both ways (principles.md §3, measured: one-way lorries lose) -- the decision is which pairs of flows to pair up. An industry you serve grows the towns that trade with it (an input to growth, finally answering "goods into growth", parked since 4c): a quarry's stone feeds construction where towns are growing, so the growth you already caused asks for the next move.

**Built 2026-10-19, the quarry first** (`industries.ts`): goods are back on; a quarry opens from day 20, one every 20–40 days, at most three at once, 8–20 cells from the nearest town on the ridge's flanks, announced with its buyers; it ships 100 t of stone a day (30% to the port, the rest to its three nearest towns by size), closes if nothing moves in 30 days, works out after 90–180, and leaves a ruin. Stone delivered raises a town's cap by up to a quarter of the growth cap. Goods now pay per tonne per cell (₦0.1; Fares), and a lorry loads what waits for each stop ahead in proportion. Measured: a lorry full one way about breaks even (Ilase–Ado +₦8 a day), both ways pays (Ilase–Kuto +₦41), one way short doesn't (Ado–Ogbe −₦47); a quarry's lorries lose ₦36–127 a day on worn dirt -- stone is one-way -- and buy growth instead (35% of Ilase's stone delivered: its cap 180k → 193k). A freight spur is where stone pays: 100 t a day over ~45 cells is ~₦450 a day against a freight train's ₦180. The mill and the factory come after rail's own job.

### When goods expand: real goods, in chains (your requirement, 2026-10-19; not built)

**"Just saying goods is not enough; when we expand it, it needs to feel real", and "the economy can be interconnected, like a refinery will need crude oil and a filling station will need fuel."** Today's goods are generic: stone, produce, supplies. When the mill, the factory and what follows are built, they meet this:

- **Real cargo, where it really comes from.** The map's region (its town names, `generate.ts`) decides its goods: cocoa and kola in the south-west; palm oil, cassava and garri in the south-east and south-south; crude oil in the Delta; groundnuts, cotton, grain and cattle in the north; yams and sesame in the Middle Belt; limestone where the ridges are, timber from the forest belt. (From general knowledge: check before relying on any one.)
- **Chains, not single hops.** One site's output is another's input: crude oil → refinery → fuel → filling stations in the towns; limestone → cement works → building in the towns that grow; cassava → mill → garri to the markets; cocoa → the port. A chain broken anywhere shows downstream, at the town that runs short.
- **The second economy reaches the first.** Fuel is the link, and it's true here: a fuel shortage is when the danfos park and the queues start. A town short of fuel raises danfo fares and thins them out (riders crowd your buses, or stay home), and costs your own vehicles more to run. Goods then aren't a side business; they move the passenger game.
- **Real people own the loads.** Traders and market women, trailer parks and their touts, the truckers (The informal hook in goods, below).
- **Its check, played:** *did the goods feel like this place's economy, and did one chain change what you did with passengers?*

### The informal hook in goods

**Principles.md §1: informal transport stays an antagonist, never a subsystem; and §3: paratransit is passengers-only (informal freight needs capital an okada does not).** Goods as built have no antagonist: nobody else carries freight. Three proposals, cheapest first; the third is the real hook and the real question.

1. **The shared road (built, made visible).** Lorries take 1.5 road space and wear a road ~2× a bus (`goods.ts`, tuning). On the corridors danfos and your buses share, an industry's lorries are the jam: the ladder's pressure now comes from freight as well as growth.
2. **Loading levies at markets and the port.** The agberos' cousins at the loading bays: every load lifted at a market or the port pays a levy, the touts keep their cut, the rest is yours (the park levy's form, Money). Taking a market's freight off the road (a rail spur) cuts that levy, as taking a corridor cuts the park's.
3. **Private truckers: the informal freight rival.** Not paratransit -- a trucker owns a 30-tonne lorry, which an okada rider can't -- so §3's asymmetry stands; but true to the region, where nearly all freight moves by private road haulage and the railway carries a sliver (as commonly reported; check the figures before relying on them). Truckers take the loads you don't (an industry you ignore still ships, by trucker, and its town still grows, a little), undercut the ones you do (they charge less per tonne on short hauls), crowd the corridors, and pay your tolls and loading levies. They're beaten where volume over distance favours rail (principles.md §3: a lorry on a long run loses; a freight train pays). **This is an amendment to principles.md §3's "passengers-only" in spirit, not in letter: it needs your agreement.**

**Built 2026-10-19, all three** (`truckers.ts`): the shared road was already built; truckers pick up goods waiting at a yard (at 1/15 a second on the shortest haul, falling to none at 40 cells), hold them until a 20 t truck is full, and send it as an informal vehicle on the danfos' road budget -- road space, wear, your tolls -- charging 80% of your fare (their earnings, not yours). Every truck loaded at a market or the port pays ₦0.4 a tonne: half to the touts, half to you, a "Loading levies" line in the budget. Their deliveries count at half toward the stone a town gets, and keep an industry open: one you ignore still ships. Measured: a short both-ways lorry run (Ilase–Kuto) went from +₦41 a day to −₦20, the long one-way Ilase–Ado from +₦8 to +₦41 (principles.md §3). C9's levy-lost target is unmeasured.

### Rail gets a job of its own

**Freight is heavy and long, so a line is a choice: this corridor carries ore, that one people.** Today rail is the top rung of a passenger corridor, "a faster bus everywhere" by day 210 (about eight lines). Proposed:

- **A train is passengers or freight, and a line's capacity is shared** (track slots, not unlimited trains): a freight train on a line takes a passenger train's slot. Where both want the same line, you choose, or build a second.
- **Station towns grow** (the proposed (4), folded in): a town with a working station grows past its road's cap, and new desire lines appear once rail opens (pairs that didn't exist: a station town pulling trips from its neighbours), so the map you know stops being the whole map.
- **A spur to an industry** is the cheap rail: short, freight-only, and the brownfield line comes back into it (the colonial export line was built for exactly this; restoring it for ore is the use its geometry fits).

**Built 2026-10-19** (`rail.ts`): a piece of track carries 4 trains (`trackSlots`), passenger and freight together, so a freight train takes a passenger one's slot and a full line refuses the next ("the line is full: 4 of 4 trains"; the Train and Freight previews say "line N of 4"); between two stops of one passenger line, trips rise by a third (`railInducedDemand`, applied with each day's demand); a town a passenger train stops at can grow 0.3 of the growth cap more (`stationCapShare`). A spur to a quarry is the Track tool from a town to the site. Measured (corridor probe, real money): rail now buys 26 days of growth on seed 0 and 21 on seed 1, against 19 before (C1: 20-40), priced at 34.9 and 31.4 days of surplus (C2). C7 (a line is a choice) waits on play: the bots don't run freight.

### The second ladder: an industry's access

| Rung | What it changes | Price (target) | What it costs you besides money |
| --- | --- | --- | --- |
| Dirt track | Joins the site to the network; lorries can reach it | About a road to a cut-off town | Truckers arrive first; wear |
| Paved | Lorries run faster and more of them; tolls on the truckers | About paving | Upkeep; the shared corridor jams sooner |
| Your lorries | You carry its goods; it grows, and its towns with it | A few lorries | Running costs; the truckers' loads you take cut their tolls and levies |
| Rail spur | Freight off the road altogether; volume over distance pays | 20–40 days of surplus, like rail | Loading levies fall; the spur is worth nothing when the site closes |

### Wear returns, made easy

**Built 2026-10-19:** wear is on by default again (`wearEnabled`). Each row of the Corridors section carries its wear as one decision: "Kept up · ₦N/day · Stop", or "Worn: 72% speed · costs your vehicles ₦106/day" with "Keep it up ₦33/day" (the catch-up repair charged at once) and "Fix now ₦499" (a one-off repair to new, `fixRoadNow`). A town card whose road your vehicles pay for is worn names it ("Its road A–B is worn: 72% speed, costing your vehicles ₦N/day"), and keeping it up is one of the moves C5 counts. The Fix tool (F) stays, for track and for clicking a road. Measured (corridor probe, real money, the player keeping its corridor up once paved): seed 0 lane 14.4 days of surplus, rail 35.2 (day 130); seed 1 lane 13.7, rail 35.1 (day 124) -- C2 holds. Left to wear, the same corridor's surplus fell by a third and rail never came (seed 0, 210 days).

### Retiring what you built

**You asked to remove things.** Routes already go (selling a route's last vehicle closes it, `removeBus`); roads and track can't. Proposed:

- **Retire a road** (on its corridor card): its upkeep stops; it stays on the map as an abandoned road, slower and wearing, then gone after ~60 days unless restored (cheaper than building). Brownfield: removal has consequences -- towns that relied on it lose access (a cut-off town is cut off again and starts to shrink), the danfos lose ground, and your tolls there stop.
- **Road to rail on the same alignment:** lay track along a road you retire, cheaper than new track (the earthworks are done: the price breakdown says so), and the corridor's story gains a line ("the road became the railway on day 140").

**Built 2026-10-19** (`retire.ts`): "Retire" on a Corridors row of a road you built or paved stops its upkeep and tolls at once (and takes any lane with it); it draws faded and broken, decays, and is gone after 60 days ("Retired day N · gone day M · Restore ₦X" -- the repair to new). When it goes, every road route is re-pathed round it, keeping each vehicle's place in its cycle, and a route whose towns nothing else joins is sold, with a toast naming the refund. The Track tool between a retired road's towns lays track on its own line at half the price of new track (`railOnRoadShare`), and the road goes at once: "the road became the railway".

### Settlements priced by what the corridor is worth

**Built 2026-10-19, and the draft's premise was backwards.** The price was already proportional to the corridor's value (half its income a day × the strike's two days, at least ₦150: `pushback.ts` `settlementPrice`) -- and far too dear, not too cheap. Measured against a twin without each strike (corridor probe, seed 0, 210 days): a strict lane's strikes cost ₦812–2,069 against quotes of ₦2,581–6,359; with BRT on the lane, ₦86–614 (one earned ₦542) against ₦2,376–6,814; lax, ₦313–835 against ₦2,429–2,586. Letting it pass always won, which is what you did. Now 0.3 of a day's income (`settlementShare` 0.15): settling wins 3 of 5 strikes on the strict bus trunk, never with BRT on the lane, 1 of 2 on a lax lane -- each choice wins somewhere (C10).

### The order

All six built 2026-10-19, in this order, without playtests between (your call); the playtest of the whole revision comes now.

1. **Step 1: show the problems the late game already has.** Alone; played past day 150 (C5). Its playtest sizes the rest of this list.
2. **Settlements priced by corridor value**, and **wear made easy** (per corridor). Both small, both on parts that exist; can ride with step 1's playtest findings.
3. **Industries, goods back on, with the shared road and loading levies** (hooks 1 and 2). One kind of industry first (the quarry: no input, so it plays without a chain).
4. **Rail's own job:** freight trains on shared lines, spurs, station towns growing.
5. **Truckers** (hook 3), if you agree the amendment.
6. **Retiring a road**, and road to rail on the same alignment.

Each played before the next, as before.

### Checks for Revision 2

| # | Check | Passes when |
| --- | --- | --- |
| C5 | The late game still asks | From day 150 to 210 of a good game (the strongest bot, or your playtest), on at least two days in three the screen names an affordable move (a problem line with its fix, priced within ~10 days of the surplus); and in your playtest you make a move after day 150 that you can say why you made |
| C6 | New problems keep arriving | After every town is connected, a new site opens or closes at least every 40 days, and each opening changes what at least one corridor carries within 20 days |
| C7 | A line is a choice | On at least one map, the best use of a line differs between two lines of the strongest strategy: one carries mostly freight, another mostly passengers |
| C8 | Upkeep is a decision per corridor | By day 150, the strongest strategy keeps some corridors and lets others go, and the panel says why for each; no per-piece clicks |
| C9 | The informal sector is in goods too | Truckers (if agreed) carry a measurable share of the goods you don't, and taking a market's freight costs you levies there, felt (target: 20–40% of what your freight gains there, like the park levy's target) |
| C10 | Settling is a choice | Settling a strike wins on one corridor and taking it wins on another (C3's shape), with the settlement priced by the corridor's value |

The Revision 1 checks stay as regression checks.

## Revision 3 (agreed 2026-10-20): goods that feel real, in chains

**Agreed 2026-10-20 ("yeah"), built in the order below, one step at a time, each measured and played. Goods today are a rounding error, so the game runs out of reasons to build once the passenger network is done. Revision 3 makes the second economy real: cargo that belongs to the map's region, industries that feed each other in chains, volumes big enough to need freight rail, and one chain, fuel, that reaches back into the passenger game.**

Prompted by your playtest of Revision 2 (principles.md §6) and its run file (map 543, everything on, to day 136): *"this feel like max"*. What the file shows:

- **Goods earned ₦3,237 in 135 days, against ₦476,860 in fares** (0.7%). All four lorry routes lost ₦108–175 a day, running 4–6% full on 10–12 tonnes a day.
- **For 27 days (95–121) you did nothing.** Funds rose from ₦60k to ₦105k with no move worth making; rail, the next rung, cost about 45 days of surplus.
- **Five of the six routes you added on day 122 lost money**, mostly poached by danfos: the passenger network was done.
- Your asks: *"just saying goods is not enough… it needs to feel real"*; *"the economy can be interconnected, like a refinery will need crude oil and a filling station will need fuel."*

What you should be able to say after an hour: "The refinery at Warri ran dry because the crude came by lorry and the truckers took half of it. I put a freight line in, the filling stations in Opobo filled up, and the danfo fares there came down. Then the cement works opened and Oleh started growing again."

### Chains: one site's output is another's input

A **chain** is sites linked by cargo. Each site turns its inputs into outputs at a rate, and **makes nothing without its input**. A shortage then travels down the chain to the towns at the end, where you see it. Three chains to start, each true here (from general knowledge; check each before relying on it):

| Chain | Sites and cargo | Where it ends | What a shortage does |
| --- | --- | --- | --- |
| **Fuel** | Crude oil (wells, flow station) → refinery → fuel depot → filling stations | Every town's filling stations | Danfo fares rise, fewer danfos run, your vehicles cost more to run; roadside sellers appear (below) |
| **Building** | Limestone quarry → cement works → building sites | Growing towns | The town's growth stalls: "Oleh can't grow: no cement" |
| **Food** | The region's farms → mill or processing → markets; cash crops → the port | Markets and the port | Market towns stop growing; export income stops |

**Fuel reaches the passenger game.** This is the interconnection you asked for, and it's true and dramatic here: when the filling stations run dry, the danfos park, the queues form, and roadside sellers sell fuel in jerrycans at a premium. A town short of fuel raises its danfos' fares and thins them out: its riders crowd your buses, or stay home. Your own vehicles fuel there too, so their running costs rise. Moving fuel then counts as passenger service, not a side business.

**A brownfield refinery.** Many maps start with an old state refinery that doesn't work, like the colonial railway: cheap to restore, but wrongly placed or short of crude. Fuel then comes through the port as imports until you fix the chain. It's true to the country, and it's the brownfield pillar applied to industry.

### Real cargo, by region

The map's region (its town names, `generate.ts`) decides which chains appear and what they carry:

| Region | Fuel | Building | Food and cash crops |
| --- | --- | --- | --- |
| South-south | Crude at the wells, a refinery | Limestone | Palm oil, cassava → garri; export through the port |
| South-west | Imported at the port | Limestone, granite | Cocoa and kola to the port; cassava, maize |
| South-east | Imported, or piped in from the south | Limestone | Palm oil, cassava, yams |
| Middle Belt | Imported | Limestone, granite | Yams, sesame, rice |
| North, north-east | Imported, long haul | Limestone (cement) | Groundnuts, cotton, grain, cattle |

### Volume: big enough to need freight rail

Each chain's long leg (crude to the refinery, fuel to a far town, cement to the cities) moves **hundreds of tonnes a day**, not 10–12. A few lorries can't carry it at a profit, but a freight train can. Short legs stay with lorries and the truckers. Rail's job becomes the backbone of a chain, and a line becomes a choice between freight and passengers (C7).

### Who owns the goods, and the informal sector

You don't run the industries: companies and traders do, and they pay you freight fares per tonne per cell (as today). The informal sector is in every chain:
- **Truckers and tanker drivers** take the loads you don't, and the short hauls (as built).
- **Touts at depots and markets** take their loading levies (as built).
- **Roadside fuel sellers** appear wherever a town runs dry, and the danfos buy from them at a premium. A shortage you leave becomes their market.

### Sites need people, and towns grow around them

A working site is a workplace, not just a dot on a chain (asked for in the step 1 playtest, 2026-10-20). Today a site counts as a town of 2,000 people (`industryWorkers`: 2, in thousands), a placeholder: it makes and draws trips as any town that size would, by gravity, but they aren't commuters, and its output doesn't depend on whether anyone gets there. Instead:
- **Workers come from nearby towns.** A working site employs people by its size (a refinery hundreds, a quarry tens), and they commute from the towns around it: trips to the site, as real as any other, that your buses and the danfos and okadas compete for.
- **Workers are an input.** A site short of workers, because no road reaches it, the road is jammed, or fuel is short and the danfos are parked, makes less, as a refinery short of crude does. A shortage can travel through the passenger game and back into the chain.
- **Towns grow around it.** Jobs draw people: the towns its workers come from grow toward it, and a working site long enough can grow a settlement at its gate (a camp, then a town: Eleme by Port Harcourt's refinery, Ewekoro by its cement works). An idle or closed site stops drawing, and what grew around it shrinks back, never below where it started.
- Growth still follows service (principles.md §3, Growth): the jobs make people *want* to move there, and only reachable jobs count, so the town around a site grows when you or the informal sector carry its workers.

### On screen

- Each site has a card: what it needs and makes, what it got and shipped in the last 5 days, and **what's holding it back** ("short of crude: 40 of 300 t a day").
- The town card gains a **Supplies** line: fuel, cement and food, each fine or short, and what the shortage is doing ("No fuel 3 days: danfo fares +40%").
- Chains are drawn as flows on the map, the way desire lines are for people.

### The order, one at a time, each measured and played

1. **The chain mechanic, with the fuel chain.** Sites with inputs, outputs and stock; fuel reaching danfo fares, danfo numbers and your running costs; roadside sellers; the brownfield refinery.
2. **The building chain,** replacing today's quarry-to-growth link with limestone → cement → towns; and **sites need people**: workers commuting to every site (the refinery and quarry included), output short without them, towns growing around a working site.
3. **The food chain** and exports, by region.

**Built 2026-10-20, step 1a: fuel as a chain** (`fuel.ts`; detail in architecture/engine.md, The fuel chain). Every game starts with a tank farm by the port (imports, 70% of day 1's need), an idle refinery near the second city (restore it for ₦60,000; up to 90% of the need, from crude delivered to it) and a crude source far from it (an oilfield in the south-south, a pipeline terminal elsewhere). Road tankers carry fuel up to 90 cells and get through jammed roads; crude is yours alone to carry. Each town's card says how well it's supplied and from where; each site's card says what holds it back. Measured on map 543: lorries lose on the crude leg (−₦297/day for three), a freight train pays (+₦694/day), and a road out of the refinery lifts supply across the region from 35% to 46%. Step 1b next: what a shortage does.

**Built 2026-10-20, step 1b: what a shortage does.** A short town's danfos charge up to 50% more (riders priced out stay home, by the rule riders already have), up to 35% of them park, its riders wait up to twice as long for you, your vehicles pay up to 30% more to run on routes through it (its own budget line, and in each route's net), and jerrycan sellers stand beside it on the map. Re-tuned with it: imports 1.0 of day 1's need (at 0.7, a replayed run lost 37% of net by day 30 to shortages from day 1; now −15%, trips −17%), tankers reach 200 cells and no longer take the danfos' road budget, fuel waits a week before it's lost. Imports go first and the refinery fills what's short, nearest it, so restoring it can only add: 90% → 90% of people supplied on day-1 towns, 65% → 85% once they've grown. Next: the playtest of step 1, past day 150.

### Step 2, as agreed (2026-10-20: "holding back is fine", "proceed")

Built in three parts, each measured and committed: **2a** the building chain, **2b** workers, **2c** towns growing around sites.

**2a, the building chain.** The quarries become **limestone** quarries, opening and closing as now. Each map has one **cement works** near the ridge (Ewekoro-style), owned by a company, that makes nothing without limestone; its cement goes to the towns.
- **Cement holds growth back, but only past a free stretch.** A town grows its first stretch (about +40% of its start) with local materials; past that, its cap above the stretch is scaled by the cement it gets. "Oleh can't grow: no cement." Scarcity comes with success, as fuel's does (principles §3). Cement replaces stone's growth bonus.
- **Truckers take short hauls only** (as stone's do), so cement for far cities is yours or nobody's: the clearest case for freight rail (C13). When a quarry works out, the works runs short until you connect the next (C14).
- **Randomized per map, by its seed:** the works is either **working** (it starts with a quarry; your job is keeping limestone coming) or **idle** (restore it; until then a little cement comes in through a cement terminal by the port, and quarries only open once the works runs). The new-map card says which.

**2b, sites need people** and **2c, towns grow around them**: as in "Sites need people, and towns grow around them" above.

**Built 2026-10-20, step 2a** (`cement.ts`; detail in architecture/engine.md, The building chain). Quarries are limestone quarries feeding the works (150 t a day each; 1.5 t makes a tonne of cement); the works makes up to 1.2 times day 1's want (towns want 0.25 t a day per thousand people), split over the towns its road reaches by what each wants. A town's room above its free stretch (+40% of its start) is scaled by the cement it gets; the town card says how much growth cement is holding back, and "can't grow: no cement" once that's what stops it. Working maps start with a quarry on an old road to the works; idle ones import 30% of the want through a cement terminal by the port, and no quarry opens until you restore the works (₦45,000). Measured on map 0 (working), paved trunk and six buses, 120 days: without carrying cement, Ilase has 27k and Ado 20k of growth held back; one lorry each from the works lifts them 5k and 8k, the lorries nearly break even (−₦66 and −₦6 a day), and goods earn ₦25,909 against ₦110,421 in fares (19% of income; C11 asks 20–40%).

**Built 2026-10-20, steps 2b–2c** (`workers.ts`; detail in architecture/engine.md, Sites need people). A working site employs people (a refinery 3,000, a cement works 2,000, a quarry or tank farm 500; an idle one a few watchmen) and its only trips are their commutes: 40 a day each way per thousand jobs, from the towns within 35 cells by size over distance. Its output follows its staffing: the share of those commutes made, over half (a full shift), from a quarter with nobody arriving. Crude sources have no commuters (oil workers live at the wells). Jobs give the towns their people commute from room to grow (four people a job, at most half a town's start), and a refinery or works that has worked 30 staffed days grows a camp at its gate, a roadside town that grows and fades with the commuters. Measured on map 543 (refinery restored, a road out, a freight train for crude), 80 days: connected sites fully staffed from day 1, unconnected ones at 25%; Cement Camp (8–9k) and Refinery Camp (5k) grow by days 30–40; Oleh gains room for 5.7k, Oloibiri 5k. A bus from a town to its works loses ₦15–84 a day: a staff bus is a cost, as it is here. Next: the playtest of step 2.

### Step 3, the food chain, as agreed (2026-10-20: "go with recommendations")

**3a, the chain and exports.** Farm towns grow the region's staple instead of generic produce: cassava in the south-west, south-south and south-east, yams and rice in the Middle Belt, grain in the north. One **mill** per map, always working, among the farm towns (a garri, rice or grain mill by region), makes food from it and nothing without it; its food is split over the market towns by what they want. Farm towns also grow the region's **cash crop** -- cocoa and kola in the south-west, palm oil in the south-south and south-east, sesame in the Middle Belt, groundnuts in the north -- straight to the port, replacing markets sending a share on. Exports earn you a payment per tonne from the state on top of the freight fare: when cash crops stop reaching the port, so does that income.

**3b, market trade** (named market days at first; renamed 2026-10-20, since it isn't the calendar). A market town with food draws market trips from the towns around it: riders for you and the danfos. Short of food, those trips shrink, and so does its room to grow. Felt in fares, said on the town card ("Ado's market is half empty: food 40% supplied"). Not a second growth hold like cement: a town would face two walls.

**Built 2026-10-20, steps 3a–3b** (`food.ts`; detail in architecture/engine.md, The food chain). Farm towns send 2 t of staple a day per thousand people to the mill and 0.5 t of cash crop to the port; market towns want 0.5 t of food; the mill makes a tonne from 2 of staple, up to 1.2 times day 1's want, by its staffing (1,000 jobs). The state pays ₦4 a tonne of cash crop reaching the port ("Export payments", not levied) -- raised to ₦20 after the map 2411 run to day 412, where ₦4 came to ₦129 a day against ₦38,000 of income. A market's food adds up to 30% to every trip to and from it, and up to a quarter of its start to its room to grow. Measured on map 2791 from day 1, 40 days: alone, the mill makes 15 t a day (truckers take the short farm hauls only) and every market is unfed; two staple lorries and a food lorry lift the mill to 32 t and feed Abiriba 9%, the food lorry +₦133 a day; an export lorry +₦387 a day on one road, −₦180 on a thinner one. Feeding a big market takes a network of lorries across the farm towns -- the mid-game's work. Next: your playtest of step 3, then the restyle.

**3c, flour (asked for 2026-10-20: "where is flour mill to get flour?", then "option 2").** The north's mill was a flour mill on its own grain, which isn't true: Nigeria's flour mills sit at the ports on imported wheat, and the north's sorghum and millet are milled into meal where they grow. So the north's mill is a **Grain Mill** (sorghum → grain meal), and every map gets a **flour mill by the port** (`<port> Flour Mills`, on an old road to it): imported wheat comes in at day 1's need, 1.3 t a tonne of flour, and its flour goes to the market towns by want. A market's food basket is 60% the region's food and 40% flour; market trade and room to grow read the basket. Measured, 20 days, nobody playing: the port city's flour arrives by trucker on its short road (basket 16–39% on maps 0, 2791, 5), the far markets' waits for you.

**Fixed after the map 2411 playtest (to day 122): farm towns keep farming as they grow.** A town farmed only while under 40k, so growing the region shrank its farms: five of eight farm towns grew past 40k, the mill made 0 of 180 t a day, every market was 0–1% fed, exports 8 t a day. Now a farm town is one that started below market size; it farms its start's land (its staple and cash crop are set by its start) and, grown, is a market too (`farmsByStart`; a run file without it replays as played). Replayed on that run: staple 1 → 66 t a day, the mill 0 → 33 t, Gusau 28% fed, exports doubled. Feeding the markets still takes your lorries.

### Money, from the step 2 playtest (agreed 2026-10-20: "lets do all 3", "proceed")

Your run (map 2791, to day 241; file to day 209) found the game stuck in a bind. Your towns outgrew their fuel (Agulu 6% supplied, Ozubulu 5%), fuel above the pump price rose from ₦300 a day to ₦1,500, and the fix, the refinery, costs ₦60,000 plus a road and a crude line. You never held more than ₦31,861: from day 100 to 160 the treasury took about ₦1,900 a day, nearly all your surplus, and named-project savings cover only lanes and rail. And 21 of your 25 lorry routes lost money, ₦4,500 a day in all, more than the treasury ever took. *"I can't earmark money because to grow I need fuel or cement but it never gets to full... money never grows cause treasury takes it."* In order, each measured on your run:

1. **Goods pay.** A lorry costs ₦108 a day and covers ~75 cells; at ₦0.1 a tonne a cell, full both ways it earns ₦225 at most, one-way full ₦112 -- its running cost, before tolls, fuel and wear. To ₦0.25: one-way full ₦280, half full about break-even. Replayed on your run: 7 of 15 lorry routes pay by day 100 (3 today), goods about 29% of income (C11 asks 20–40%; at ₦0.35, 36%, goods start to rival fares).
2. **The lorry hint.** Picking two towns for a lorry says first how many tonnes a day wait each way on that road, and whether it fills a lorry: you bought and sold 7 lorries on Abiriba ↔ Cement finding out. One line, not an advice panel. *Built 2026-10-20* (`goods.ts lorryEstimate`): the preview adds what truckers take and what one more lorry would carry and earn against its running cost (fuel premium in), "it would lose money" when it would. Checked forward on your run at day 150 (one more lorry on each of 23 routes, 10 days): the pays-or-loses call was right on 19, wrong on 2, borderline on 2.
3. **A levy, not the 80% cut.** The treasury takes a steady small share of what you earn, on every naira, instead of 80% of the surplus above the reserve. Saving becomes possible; the snowball (M10) is held by the share. The rate is measured on your run and two others. *Built 2026-10-20* (`budget.ts treasuryLevy`): 10% of fares, goods, tolls and levies, never the state's allocation; its own line under the net. Replayed with goods at ₦0.25, the first day ₦60,000 is held: map 2791 day 93 (with the 80% cut, 139), 6517 day 145 (177), 543 never (never). Watch for: a strong network banks a lot late (2791: ₦238k by day 209 if nothing more is spent). Named projects no longer lapse: nothing to shelter from.
4. **Bonds.** Borrow for a named project (the refinery, the cement works, a lane, a rail line): the money now, repaid with interest as a fixed daily charge until paid. True here (states issue infrastructure bonds), and the capital/operations split of Open question 9. Bounded: repayments can't exceed a share of your income. *Built 2026-10-20* (`bonds.ts`): for restoring the refinery or the works (done at once) or what your named project still lacks (paid into your funds); repaid over 60 days at 20% interest, the same each day, billed in debt too; all repayments at most 30% of a day's income. A Borrow button beside Restore when you can't pay, and on the Saving-for callout; repayments under the net; the bonds owed listed under the budget. Measured on your run: a refinery bond at day 60 (₦18,585 held), with a road out, a crude road and four lorries, left fuel 78% supplied against 73% by day 120 and cost ₦1,200 a day to save ₦86 in fuel -- too early there, where fuel bites after day 150; it's a choice, not a must. The crude leg by track would cost ₦523,000 on that map; by road ₦1,246, and at ₦0.25 full crude lorries pay (+₦142 a day for four).
5. **The Treasury panel.** Its own docking panel: income and spending by line, what the levy took, bonds and their repayments, saved projects, and each chain in a line ("fuel: 3 towns short, costing you ₦1,500/day"). Variants in the design lab first, for you to pick. *In the lab 2026-10-20* (`/design-lab.html`, the Treasury group): inside the routes panel (today's), its own wing docked left, a drawer above the toolbar (a one-line tab, out on hover, four columns), or a drop from Budget in the strip. Numbers from your run at day 209, under the new rules. *Picked 2026-10-20: the drawer; built* (`main.ts treasuryHtml`, `index.html #treasury`): a one-line tab over the control line -- what you keep a day, the levy, bond repayments, the worst chain -- out on hover into Income, Spending, Treasury and bonds (net, levy, repayments, what you keep, bonds owed, the project you're saving for), and Chains (fuel, cement, workers in a line each); a click on the tab pins it open. The budget left the side panel.

**Your look, picked in the lab 2026-10-20** (applied 2026-10-20: wings, glass, tilt, tucking, round corners, contours with names, no control hint; plus Mini Metro-style parallel route lines at shared roads): glass panels, leaning at rest and flat when used (7°), tucked at the edge and out on hover, two wings (town left, routes right), headline chips, the town card, route cards, mono type, round corners, contours with labels, a flat map plate, no control hint. `/design-lab.html#theme=paper&you=blue&material=glass&pose=rest&dock=tucked&layout=wings&headline=chips&town=card&routes=cards&type=mono&shape=round&terrain=contours-labels&plate=flat&treasury=drawer&hint=off&angle=7`

**Expanding a site (built 2026-10-20, from the map 2411 playtest: day 216, ₦193,748 held, "Cement: 8 towns held back" by a works at capacity).** The refinery, the cement works, the mill and the flour mill each take up to two more lines (`expand.ts`): +50% of their first capacity a time, wanting that much more input and employing that many more people; an expanded works lets one more limestone quarry open at a time. The first line costs 0.8 of the site's restore cost (the refinery ₦48,000, the works ₦36,000, a mill ₦20,000), the second 1.5 times that. An "Expand it" button on the site card; the Treasury's cement line says when the works is at capacity. Replayed on the map 2411 run, a works expansion at day 105 lifted its output 115 → 172 t a day at once (limestone was there); the towns it holds back stay held until the extra cement is carried to them -- expanding is a step, not the answer.

### Checks for Revision 3

| # | Check | Passes when |
| --- | --- | --- |
| C11 | Goods matter | By day 100 of a good game, goods are 20–40% of income (today 0.7%), and at least one chain leg pays on its own |
| C12 | A shortage is felt | A fuel shortage in a town moves its danfo fares and your riders there measurably, against a twin without it, and the town card says so |
| C13 | Rail carries a chain | On at least one map, a freight line on a chain's long leg pays back within C2's 20–40 days, and lorries on the same leg don't pay |
| C14 | No dead stretch | From day 60 to day 150 of your playtest's run file, no stretch of 15 days without a move worth making (today: 27 days) |
| C15 | It feels like this place (played) | You can name the chain that mattered in your game and what it changed for your passengers |

The Revision 1 and 2 checks stay as regression checks.

## Revision 4 (agreed 2026-10-21): the late game

**Agreed 2026-10-21 (your answers: "No player lorries… we can add the action of providing parks for danfos"; "towns expecting better service is a go"; "the second refinery is a go too. even metro"; "lets test out the levy… if it turns out like the last 80% cut off we know it's not a good game mechanic"). Built in the order below, each in a worktree, measured with the strategist (`scripts/game-strategist.ts`), merged on your word.**

Why: your map 2411 game to day 412 and the strategist on three maps to day 250 say the same three things. Goods make the income line, not the money: 45–75% of income, yet lorries net about ₦0 between them (51 routes on 2411, 33 losing; the strategist's 27–44 routes, −₦3,492 to +₦1,020 a day). Lorries are busywork: 105–165 bought a game. And the late game piles money up with nothing to buy: ₦100–590k held after day 200, stretches of 32–55 days with nothing built.

1. **No player lorries; haulage yards.** Road freight is private hauliers', as it is here: the state builds roads and runs freight rail, it doesn't run lorry fleets. You build **haulage yards** at towns and sites: a yard lets hauliers reach further from it and load faster, and you collect a yard levy on what they lift (the touts' cut smaller than at a roadside). The Lorry tool goes; freight trains stay yours, for the long legs (C13). A run file played with lorries replays as played.
2. **Towns expect better service as they grow.** Past a size, a town expects you to carry a share of its trips that rises with it (e.g. 100k: 20%); below it, its growth slows, and the town card and the Treasury say so ("Gusau expects better buses"). Money goes into fleets, lanes, BRT.
3. **The budget-year sweep (a trial).** Every 60 days, cash above your carry-over (the larger of your biggest named project's price and ₦50k) returns to the treasury; money set aside for a named project or borrowed is safe; a countdown in the Treasury drawer. True here (unspent budgets lapse at year end). *If it plays like the 80% cut did -- a confusing tax on progress -- it comes out.*
4. **A second refinery.** Mid-game, a new privately owned refinery opens (the Dangote story): it needs crude brought in and its fuel moved out -- a new problem, a reason for rail.
5. **Motor parks for danfos.** You build a park at a town: danfos load there, not on the road (less jam on the roads into it), and their levies reach you properly (the touts take less). The state's real role with danfos: managed, not fought.
6. **A metro.** Last and biggest: a new mode for the biggest towns. Agreed knowing it stretches the slice.

Alongside: **C11 measures goods by what they unlock** -- the growth cement and food make possible -- not by their share of income. And **an OpenCode player**: a text interface (state in, moves out, a run file saved) so a free model can playtest beside you.

### Checks for Revision 4

| # | Check | Passes when |
| --- | --- | --- |
| C11 (amended) | Goods matter | By day 150 of a good game, the chains (cement, food) account for at least a fifth of the original towns' growth since day 1 |
| C16 | Money stays a decision | From day 150 to 250 of a good game (strategist or your playtest), money held stays under ~60 days of net, and the longest stretch with nothing built is under 20 days |
| C17 | The sweep isn't a tax on progress (played) | You can say what the countdown wanted you to do, and it never took money you were saving for something |



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
2. Bot personas in the probe, run on today's game first, as a baseline before anything changes. First, copy `coldstart.ts`, `connect.ts` and `horizon.ts` into `scripts/` (done 2026-10-17, imports made relative). They report M1–M9, which means adding trips made a day, the no road / no seat split, and that number's daily jitter (M8). Done 2026-10-17: `scripts/game-bots.ts`; baseline in status.md.
3. Switches in `tuning.ts` for wear, goods, rail and the straight alignment, all off. Re-run the personas to see what switching them off did. The bots pick roads by trips unlocked per naira, measured, not the cheapest road (Ikole–Ogbe is cheapest and nobody would build it), and M2 tests that road.
4. Warm-up: 5 game days before day 1 (7 since the post-5b baseline: at 5 the informal share still moved 6 points by day 10, M7's limit is 5; at 7 it moves ~2). Warm-up days count toward neither the day counter nor money (funds untouched, the informal sector's earnings start at 0), and the 5-day averages start already filled from them. Re-run `coldstart.ts` after it (`START=warm`).
4b. Danfo road space (built before the reorder, as 5b): scale `informalRoadSpace` with road capacity (dirt against paved), so paving lets more danfos run. Today the informal sector's road-space budget is one number for every road, so paving adds no danfos and a toll on a paved road would collect from no more of them. The tolls (now step 6) depend on it. First, fix how the space is held: a danfo reserves road space on its whole path when it's dispatched (`tick.ts`, `dispatchInformal`) and releases it only when the trip completes (`reapInformal`), so a long run like Ilaro–Ipaja keeps trunk space long after it has left the trunk. That is the likely cause of roads that lower trips made (status.md, step 3: Ilaro–Ipaja takes 60–80 trips a day off the network). Release each segment as the danfo leaves it, then check the cap still prevents the collapse it was added for (principles.md §3, Paratransit). Done 2026-10-17 (status.md): Ilaro–Ipaja goes from −62 to +31 trips a day, and total throughput never collapses; but with 8 of your buses on the trunk, danfos now crowd it (below half speed 60% of the time, your riders 289 → 180). Decided: one road, one budget -- your road space counts against it (status.md, rule 3: at 8 buses, your riders 225 and the trunk below half speed 34% of the time; the danfos on the trunk fall as you add buses). Part 2 scales that shared budget with road capacity. Done 2026-10-17: by surface, tuned to targets rather than the raw capacity ratio (0.6 against 1.6 would evict every danfo at 4 dirt buses): dirt 9, paved 15 (status.md).
**The order from here, reordered 2026-10-17:** money first (step 5, formerly 6), then price response with tolls (step 6, formerly 5 and 7).

5. Fares by distance, then re-tune the vehicles' running costs, and bring routine upkeep on the roads you built or paved forward (it was step 7's). Money is loose (M10: trips-greedy waits on money 1 day in 46) mostly because wear's rough-road discount is still in the running costs: the bus went 3.5 → 3.0 a second when worn roads began costing your vehicles extra (track 2), then 3.0 → 2.4 for the minibus's balance. With wear off, reverse the discount and keep the bus/minibus per-seat-cell ratio: bus × 3.5/3.0 ≈ 2.8, minibus ≈ 2.45. **From step 5 on, M10 is a gate:** every later step must keep it passing. Watch M1 (opening variety) as costs rise. **Agreed:** roads you build start as dirt (cheaper than ₦15 a cell), and paving is the dear upgrade, priced so paving the trunk costs about 3–4 buses (₦1,500–2,000), through the cost function (`engine/pathing/cost.ts` via `roads.ts`: the cost function is the build price). Routine upkeep (Money, Costs) comes in here too. The surplus is large (trips-greedy ends day 60 with ₦30,915), so expect big moves. Today paving the trunk costs ~₦380–435 and adds ~158 trips a day with no buses (389 → 547) and ~230 with 2: about six times a bus per naira, the dominant opening (status.md, 5b part 2), and every road you build is born paved.
6. Riders respond to price, built together with tolls: the price response is inert until a toll creates a fare gap. Then tolls (passed on to danfo riders), levies and the allocation, tuned until M2, M3, M5 and M6 pass while M10 still passes. In two measured passes. **(1)** Price response, tolls, levies, the allocation; then measure M2, M3, M5 and the four openings' curves (net and trips made a day, to day 60). **(2)** The treasury remittance (Decisions log); then measure M10 and the curves again. *Checked first (2026-10-18):* tolls alone can't close the openings' gap. Infrastructure-first trails vehicles-first by ~₦1,000 a day at day 20, and informal riders a day on the roads you built or paved are ~100 (roads to Ilaro and Ikole) or ~200 (the paved trunk): ₦1,000 a day would be ₦9–10 a rider (1.6–1.9 fares) or ₦5 (0.8 of a fare). The catch-up has to come from the growth allocation, and from the remittance damping the vehicle snowball; tolls are tuned for M3 and the tension (M5), not to carry the openings.
7. The new headline and the panel's budget breakdown. Done 2026-10-19, styled from the design lab's "The brief, step 8" preset (render-and-ui.md §7).
8. The advice moves to `?dev=1`, and the six hints arrive. Done 2026-10-19.
9. The AI harness (`scripts/game-play.ts`), then the A checks and your session.

The order things come back, one per playtest, each with its own check (*superseded if Revision 1 is agreed: pushback comes with the bus lane, rail returns as the top rung, then wear; see Revision 1, The order*):

1. **Wear and the Fix tool.** It creates the late-game choice between keeping what you built and building more, and it meets tolls: a toll road you don't keep up loses traffic. *Check:* you keep some roads and drop others, and can say why.
2. **Pushback, one form.** It completes the informal sector's third role. *Check:* at least once you hold back from a corridor because of it, and it feels fair.
3. **Rail:** new track and passenger trains first, then the old line and halts. The big mid-game project. *Check:* by day 30–60 rail is something you save toward, and you choose between restoring and building.
4. **The straight alignment.** A refinement of road building. *Check:* you use it at least once and can say what it bought you.
5. **Goods:** lorries first, then freight trains and export. The deepest system and the least played. *Check:* you run goods both ways on purpose.

## The carry-over plan (proposed 2026-10-23): what the slice hands the full game

**Proposed, for you to mark up** (Open question 8). Revision 4 is built; before the slice closes, what it proved, what it dropped, and what stays open for the full game. Your answers of 2026-10-23 are in it: goods matter through growth, not money (with freight priced by you); eras are vehicle generations, not calendar ages; sea freight to consider.

**Proven here -- carry over as built** (each played or measured; status.md has the numbers):

- **The corridor's ladder:** dirt → paved → bus lane → rail, each rung buying growth (C1), priced against the surplus it arrives in (C2).
- **The informal sector as rival, revenue and interest group:** danfos, kekes and okadas; the union's strikes against a lane, announced and answerable (settle, relax); enforcement as a real choice (C3); private hauliers as the freight rival; motor parks -- managed, not fought.
- **Goods in chains, mattering through growth:** fuel (tank farm, refinery, crude; a second private refinery mid-game), building (limestone, cement), food (staples, mills, markets, exports); haulage yards; freight rail yours, road freight the hauliers' -- with the rate you charge on each freight line deciding who carries what (built 2026-10-23: dear earns 6-11% more from goods and hands hauliers ~40% more of the line's goods, for 2-5% fewer trips; status.md).
- **Problems named with their move:** a town's or site's card says what's wrong and what fixes it (the road is full, the chain breaks here, the corridor is too thin for a BRT).
- **Generated maps with guards;** industries that open and close; towns that grow along busy roads; towns expecting service as they grow; the metro for the biggest towns.
- **Money as a budget:** fares, tolls, levies, the state allocation, the treasury's 10% levy, bonds, named projects.

**Dropped -- kept behind their switches, not carried over:** your own lorries (busywork; road freight is the hauliers'); the 80% remittance and the budget-year sweep (each a confusing tax on progress -- C17 failed in play).

**How the full game looks** (your answers, 2026-10-23):

- **A flat map, as the slice plays it.** The 3D diorama (principles.md §3, Visual direction) waits until a good one is within reach; then it comes back as a look over the same game, not a rewrite. No 3D model pipeline (Blender or generated) until then.
- **The look moves over with the mechanics,** not as a revision of its own after them.
- **The information design gets a second look first:** the slice's wasn't good enough (your read). Subway Builder is the reference -- what you named from it: what you see at a glance, the side panels, and the revenue screen.

**Information design for the full game (proposed 2026-10-23).** What the slice did badly: cards of up to eleven prose sections with the number buried in a sentence; problems found by hovering and reading, not seen; important changes (a strike, a refinery, a quarry closing) gone with their toast; no two cards phrased alike, so nothing compares. Three layers instead, each answering one question:

1. **At a glance -- the map answers "where".** Everything that matters is drawn, not written: roads and lines by what they carry (width) and how full (colour); towns by size, with a mark when growing, shrinking or held back; problems as marks on the map where they are (a full road, a town short of cement, a corridor with riders left standing, a strike called). Overlays you switch on, one at a time: demand between towns, no seat, the informal share by corridor, each supply chain's flow. The strip at the top keeps a few numbers that move (trips made, your riders, net a day, money) with their trend.
2. **Side panels -- the numbers answer "how much".** One panel a thing you click (town, route, line, site, corridor), every one of a kind laid out the same: a header with the few numbers that matter, a small chart of each over time, then its problem in one line with its move as a button. No paragraphs; the why on hover. Lists that sort (routes worst first, towns by growth) so you can compare.
3. **The revenue screen -- the money answers "how am I doing".** A full screen, opened when you want it: income and costs by line (fares, goods, tolls, levies, allocation, metro; running, upkeep, fuel, levy to the treasury) over time as charts; each route and line's earnings in a sortable table; what the treasury and bonds take. The slice's Treasury drawer becomes this.

Alongside: **a log of what happened** (strikes, sites opening and closing, milestones, corridors taken), kept and clickable, so a change doesn't vanish with its toast. The slice's tags and problem lines survive as map marks and one-line panel problems; its long cards and most toasts don't.

**Settled in the information lab** (`/info-lab.html`, on your map-2418 game; agreed 2026-10-23, "all good"):

- **Roads** drawn by traffic (width) and how full they run: free grey, busy orange, jammed red. Yellow means the informal sector and nothing else.
- **Your service** as a blue line along the roads (width: your riders), and **your vehicles** filled as full as their route runs -- an empty bus reads as white.
- **The other side's vehicles -- detail by speed and zoom:** danfos, kekes and okadas as a yellow band beside each road, trucks as a brown one, each as wide as how many are on it, at every speed and zoom; the vehicles themselves drawn on top whenever there's room (1x or 2x, or zoomed in to 2x or more at 4x). At 4x the swarm of individual vehicles was unreadable in play.
- **Focus:** hover or select a town, route or road (on the map or in a list) and everything not part of it fades.
- **Zoom and pan**, with marks growing slower than the map (its square root), so they spread apart rather than shrink to specks.
- **A town's problem** is its biggest one, by what it costs, not the first kind on a list (a 3% cement shortage hid 480 trips a day with no seat).
- **Neutral cool greys**, light and dark; no paper brown.

**Open -- for the full game, not this slice:**

1. **Road networks with junctions and intersections.** Roads join only at towns here; where two cross they pass over each other. The full game needs real networks: roads that meet, junctions as places, and traffic that slows where roads meet.
2. **Money late in the game.** Without the sweep, money piles up after day 200 (C16 fails: ₦120k-990k held by day 250 in the strategist). The metro takes some; the full game needs late-game decisions that cost.
3. **Eras as vehicle generations** (your framing, 2026-10-23; calendar eras stay scrapped). You start with older public-transport models; newer ones arrive over time -- dearer, better, cheaper to run, carrying more -- so an old fleet becomes a decision: replace or keep running. And the informal sector has the same thing going for it: old danfos give way to newer ones, keke and okada waves come and go, so the rival changes too. Eras are what the two fleets look like over time, not a date.
4. **Sea and river freight** (your question, 2026-10-23; the gateways are in The region, below). A third freight mode: heavy, slow and cheap -- coastal shipping between ports, barges on a navigable river (the Niger and Benue, the Lagos lagoon). It needs a second port or a river that boats can use; the slice has one port and a river that's only an obstacle. In the full game: ports and jetties as places you build, the river as a route as well as a barrier, and the informal sector there too (canoe and boat operators).
5. **Goods' share of growth** (C11 amended: the chains at least a fifth of the original towns' growth by day 150). Measured 2026-10-23: 61-79% on three maps -- passes, largely because cement gates growth past a town's first 40%.

## The region (2026-10-23): the full game's map, and trade through its edges

**Your answers, 2026-10-23:** the slice's map "felt like a metropolitan area, and as we played you get to the end game faster"; how the bigger map opens is open ("since we are playing with existing towns, not building afresh, we can't do the Cities: Skylines route"); sea freight now, "part of the idea is import and export through sea (and of course through land and rail)". Speed (the pairs of towns demand is worked over) goes to another agent.

**What's wrong with today's map.** 100 × 64 cells, nine towns, one river, one ford: every town is a bus ride from every other, so one network of buses and a paved trunk covers it, and by day 150-250 there is nothing left to win (C16). It reads as one city's suburbs, not a country.

**The region.** The same cell, the same prices per cell -- the ladder, fares by distance and the bus's economics stay as measured -- on a map about 2.5 times as wide and as tall (~250 × 160 cells), so distance itself becomes the new thing:

- **Clusters, far apart.** Three to four clusters of towns, each about the size of today's map: one big city's (the start), two or three regional towns', with long empty roads between them (60-120 cells: four to eight of today's trunk legs). About 25-30 towns in all, sized city → regional towns → small towns.
- **Inside a cluster, the game you know.** Buses, danfos, the ladder, a chain or two. **Between clusters, a different game.** A bus line 100 cells long is slow and dear and carries few; long distance is where paved highways, intercity coaches and rail -- passenger and freight -- earn their keep, and where the end game lives.
- **Geography that matters.** A coastline along one edge, two or three rivers (one navigable, later), a range of hills rail must go round or through. The goods chains drawn twice, in different clusters, so where you connect decides what grows.
- **The informal sector everywhere**, as now: the whole region runs from day one, and danfos and hauliers already work the far clusters before you get there.

**How it opens (proposed; you weren't sure).** Nothing locked: the towns are there, as in life. You start as the home cluster's transport agency, the camera framed on it; the rest of the region is on the map, at a zoom out, running without you. What holds you to your cluster is money and distance, not a wall. If a free map turns out to be too open in play, a gate with a reason comes next (the state extending your remit to the next cluster, at a milestone) -- not first.

**Trade through the region's edges** (import and export, by sea, road and rail):

- **The seaport**, on the coast: imports land there (crude, wheat, cement, vehicles), exports leave (cash crops, refined fuel). The port is a place you grow: its handling (tonnes a day) is a rung like a road's.
- **Border crossings**, one or two on land edges: trade with the next country by road (the hauliers') and, once you lay track to it, by rail. Slower and cheaper than the sea, a different mix of goods.
- **Goods choose their way out**: an export goes to whichever gateway is cheapest from where it's made, by what's built. Connecting a border post, or growing the port, moves where the money and the trucks go.
- Coastal shipping between ports and barges on a navigable river (Open item 4) come after the gateways, on the same rules.

**A loading screen** (your ask, 2026-10-23, after the region's cold start held the page blank ~9 s): the warm-up week shown as it runs -- "Day 3 of 7 before you arrive" -- not a blank page.

**Kept from the slice, unchanged:** the generator's guards (every town reachable; prices land as measured; the dominant city dominant); seed 0 the hand-made map; a run file replays as played -- a game started on the region records it in its tuning, and an old file draws the old map.

### The order

1. **This section, agreed or marked up.**
2. **The generator:** the region (clusters, coast, rivers, hills, the inherited roads and an old railway between clusters), behind a tuning key; seed guards as now. The camera starts on the home cluster.
3. **The gateways:** the port and the border crossings as places, imports and exports through them.
4. **Re-measure:** the strategist on region maps to day 250 (C2, C11, C16 again), then your playtest.

### Checks for the region

| # | Check | Passes when |
| --- | --- | --- |
| C18 | The end game is far | In the strategist and your playtest, something worth building is still unbuilt at day 250 (C16's stretch with nothing built under 20 days, to day 250) |
| C19 | Distance changes the vehicle | Between clusters, rail or coaches beat buses per naira on the strategist's best lines; inside one, buses still do |
| C20 | The way out matters | Connecting a second gateway moves at least a fifth of a chain's exports to it |
| C21 | It still reads | At the start, framed on the home cluster, the screen reads like today's map (your playtest: "I knew where to start") |

## Pass/fail checks: when slice zero is done

**Slice zero is done when every check below passes; until then nothing new gets built and nothing moves to the full game.** Measured checks run in the probe (`scripts/game-probe.ts`) and become tests where they can. Played checks come from your sessions; AI checks from the harness (see Playtest protocol).

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
2. **AI playtester: OpenCode's free model, before each of your sessions.** A text harness, `scripts/game-play.ts`:
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

**Forty-three decisions were drafted on 2026-10-17 to 20, three of them from a review of this brief; nineteen are agreed.** Newest first. Change a status as you decide; a rejected decision stays in the log with a line on why.

| Date | Decision | Status |
| --- | --- | --- |
| 2026-10-23 | Goods matter through growth, not money (C11 amended stands); you set what each freight line charges -- cheap, standard or dear -- and face the consequences: dear earns more a tonne and the hauliers take more of its goods by road. Eras are vehicle generations on both sides (your fleet's models and the informal sector's), not calendar ages. Sea and river freight, roads with junctions and money late in the game are for the full game (the carry-over plan, proposed) | Agreed 2026-10-23 (the carry-over plan itself proposed) |
| 2026-10-20 | Revision 3: goods that feel real, in chains -- sites with inputs and outputs that make nothing without their input (fuel, building, food), cargo by the map's region, long legs in hundreds of tonnes a day for freight rail, a brownfield refinery; built in order (fuel chain first), each measured and played | Agreed 2026-10-20 |
| 2026-10-20 | Fuel reaches the passenger game: a town short of fuel raises its danfo fares, thins its danfos and raises your running costs there; roadside sellers appear where it runs dry (C12) | Agreed 2026-10-20 |
| 2026-10-21 | Revision 4, the late game: no player lorries (haulage yards you build, hauliers licensed there; freight rail stays yours); towns expect better service as they grow; the budget-year sweep as a trial; a second refinery; motor parks for danfos; a metro, last. C11 amended to goods' growth effect; C16, C17 added; an OpenCode player | Agreed 2026-10-21 |
| 2026-10-20 | Step 3, the food chain: staples by region from farm towns to one always-working mill, food to the market towns; cash crops by region straight to the port, paying an export payment per tonne; a market town's food draws trade -- more trips -- and room to grow (market trade), not a growth hold. 3a the chain and exports, 3b market trade | Agreed 2026-10-20 |
| 2026-10-20 | Money, from the step 2 playtest: goods pay ₦0.25 a tonne a cell (from 0.1); a lorry hint on picking two towns; a steady levy on income replaces the treasury's 80% of surplus; bonds for named projects, repaid daily with interest, bounded by income; a Treasury panel (variants in the design lab first). In that order, each measured on the map 2791 run | Agreed 2026-10-20 |
| 2026-10-20 | Step 2: cement holds a town's growth back past a free stretch of about +40% of its start (replacing stone's bonus); one cement works per map, working or idle by the seed (idle: imported cement through a terminal by the port until restored); built 2a cement, 2b workers, 2c growth around sites | Agreed 2026-10-20 |
| 2026-10-20 | Sites need people, and towns grow around them: a working site employs workers who commute from nearby towns (trips you and the informal sector compete for), makes less without them, and draws growth -- nearby towns grow toward it and a long-working site can grow a settlement at its gate, shrinking back if it closes; built with step 2 | Agreed 2026-10-20 (asked for) |
| 2026-10-20 | Town names by region: one region per generated map (south-west most likely; a coast only south-west or south-south), real towns of that region; geography unchanged for every seed | Agreed 2026-10-19 (asked for, built) |
| 2026-10-19 | Revision 2, step 1 first and alone: show the problems the late game already has (why a town is shrinking, where "no seat" is and the move that carries it, unserved trips drawn on the corridor), played past day 150 (C5) before any goods. Its playtest sizes the rest | Agreed 2026-10-19 |
| 2026-10-19 | Revision 2: industries that open and close (quarry, mill, factory) as the second reason to build; goods back on; an industry's own ladder (dirt track, paved, your lorries, a rail spur); served industries grow the towns that trade with them | Agreed 2026-10-19 |
| 2026-10-19 | The informal hook in goods: lorries on the shared road (built), loading levies at markets and the port, and private truckers as the informal freight rival -- the last amends principles.md §3's "paratransit is passengers-only" in spirit (truckers aren't paratransit) | Agreed 2026-10-19 (the direction; built after step 1's playtest, as the order says) |
| 2026-10-19 | Rail's own job: a train is passengers or freight on shared track slots; spurs to industries; station towns grow and new desire lines appear (absorbs "rail reshapes the map") | Agreed 2026-10-19 |
| 2026-10-19 | Wear returns per corridor: a "Keep it up" switch with its cost a day, "Fix all on this corridor", the town card naming a worn road | Agreed 2026-10-19 |
| 2026-10-19 | Retire a road (upkeep stops; access lost, consequences kept), and road to rail on the same alignment, cheaper for the earthworks | Agreed 2026-10-19 |
| 2026-10-19 | Settlements priced by the corridor's value to you (a share of its income over a few days), not half a strike's estimated cost with a ₦150 minimum; settling and striking each win somewhere (C10) | Agreed 2026-10-19 |
| 2026-10-19 | Generated maps per seed with guards (town positions, the inherited trunk, cut-off towns, the old railway, the dominant city's setting; trunk length within ~±25% of today's; seed 0 the hand-made map), no re-tuning, one probe check; TAKEN shown only when it changes. Next, before (4) rail reshapes the map and wear. From the playtest: "I think I have played to its end" | Agreed 2026-10-19 |
| 2026-10-19 | Rail reshapes the map: station towns grow, and new desire lines appear once rail opens, so the routes you know aren't the whole map any more. After (1)-(3) below, each played first. From the playtest: "I already know all the routes" | Proposed |
| 2026-10-19 | After the ladder's playtest, in order, each played before the next, ahead of wear: (1) the treasury visible inside the existing budget breakdown, no new panel (a "Treasury took" line, a countdown "₦X over the reserve goes to the treasury in N days; spend it or set it aside", a set-aside progress bar, the 10-day remittance as a toast; a full treasury panel waits for the full game); (2) the score as visible as money (town-growth milestones, the trips-made trend); (3) each corridor's informal share and "corridor taken" as a visible state, with its costs | Agreed 2026-10-19 |
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

**Deferred idea: market days, the calendar (your idea, 2026-10-20).** Small towns trade on their market day -- every fourth day in the Igbo week (Eke, Orie, Afor, Nkwo), weekly elsewhere -- so their trips spike that day and buses fill; a town that grows past market size trades every day, and its trips smooth out. A cheap rule on top of market trade: a small town's demand pulses on its own day. *Trigger:* after the food playtest, if markets feel flat.


**Nine questions are open; each names what would answer it.**

1. **What does a great hour feel like?** You said "connect towns, add buses" feels simplistic. Candidates: bring order to a chaotic corridor; open up the hinterland; out-hustle the danfos without losing the parks. *Answered by:* writing the one sentence you'd want to say after an hour, then holding P6 to it.
2. **Which form of pushback?** A settlement cost, slower boarding at their parks, or strike days. *Answered by:* building the cheapest (a settlement cost) and playing it once. *Revision 1 (proposed 2026-10-19): strikes, with a settlement as the way to call one off.*
3. **Tolls automatic, or a choice per road?** Automatic is simpler; a choice adds "toll it and push traffic elsewhere, or keep it free". *Answered by:* M3 and P3. If tolls never feel like a decision, make them one. Passing the toll on to danfo riders already gives automatic tolls a cost: the budget rises and the headline falls.
4. **Does the allocation reward growth or service?** Mostly answered: growth already requires your service (a town grows only once you carry 10% of its trips; new towns need your riders), so the allocation rewards growth you served. *Answered by:* the probe, which only has to settle how big k is: big enough to pass M2, small enough that buses alone don't win (M6).
5. **Regulation verbs:** ban okadas from a highway, reserve a bus lane. *Revision 1 (agreed) answers the bus lane as a rung of the ladder.* True (from memory, Lagos restricted okadas on major roads in 2020) and powerful, but principles.md §1 makes power framing, not a fantasy. *Answered by:* after pushback is played: does the game want a stick, or are tolls and levies enough?
6. **Hints and "no onboarding".** principles.md §2 rules out onboarding; you want hints at the start. *Answered by:* your call on amending §2 to "up to six state-triggered hints, no tutorial".
7. **Do levies soften the antagonist?** If danfos become too valuable to you, the hook goes slack. *Answered by:* M5, and the levy target (20–40% of what you gain by taking a corridor).
8. **The full game: what carries over first?** The 3D map, eras and studio wait. *Answered by:* a separate plan for moving over, written after slice zero passes. Drafted 2026-10-23: "The carry-over plan" above (proposed).
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
| Industry, site | A quarry, mill or factory: a place that wants goods moved in or out, and that opens and closes (Revision 2, proposed) |
| Interchange | A town where riders change between your routes |
| Jam | A corridor whose traffic holds your vehicles well below free speed and whose "no seat" is rising: the signal for the next rung (Revision 1) |
| Keke | A three-wheeled taxi, 3 seats |
| Ladder, rung | The upgrades a corridor climbs, dirt → paved → bus lane → rail; each is a rung (Revision 1) |
| Levy | What each informal vehicle pays to load at a park |
| Loading levy | What each load lifted at a market or the port pays to the touts there, as a park levy does (Revision 2, proposed) |
| No road / no seat | The two kinds of stayed home: no road joins the towns; or one does, but nobody carried them |
| Okada | A motorcycle taxi, 1 passenger |
| Park | A town's motor park, where danfos load and levies are collected |
| Poached | Your waiting riders taken by a danfo passing through |
| Retire | Stop keeping a road you built: its upkeep stops, it decays, and what relied on it loses access (Revision 2, proposed) |
| Slice zero | The smallest game that tests this brief (see its section) |
| Slow order | A speed limit on worn track |
| Spur | A short line from the network to an industry, freight-only (Revision 2, proposed) |
| Stage | A fare step: fares are called by stop, so the price rises in steps |
| Through-route | One route running through a hub, carrying every trip along it |
| Toll | What every vehicle except yours pays to use a road you built or paved |
| Trucker | A private road haulier with a lorry of their own: the informal freight rival (Revision 2, proposed) |
| Trunk | The busiest corridor: Ilase–Owode on today's map |
| Union | The drivers' union (in Nigeria, the NURTW); the agberos work for it |
