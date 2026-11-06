# Scopes: the five modes

> Saved as given (2026-11-03). Its companion, `SCALES-AND-MODES.md` (the trunk, feeder and inside
> scopes the coach, the okada rule and the urban ladder wait on), is now
> [SCALES-AND-MODES.md](SCALES-AND-MODES.md), and [PROMPT-urban-ladder.md](PROMPT-urban-ladder.md) is (2026-11-04, saved as given, its rationale
> still to be rewritten on the inside scope). **Built so far:** the pipeline (2026-11-03; architecture/engine.md,
> Pipelines), with two calls made with you: it carries refined fuel only, and the inherited line runs
> from the tank farm up the old railway. The airport (2026-11-03; engine.md, The airport), travellers
> and air freight both; its freight by hauliers and, if you lay track, your freight train (your call:
> the game has had no player lorries since Revision 4).

Companion to `SCALES-AND-MODES.md`, which says where each one lives. This says what each
one *is*. Target: `main` at `77e9fe7`.

Every number below is a first guess, to measure with the strategist — the repo's usual
standing for a number nobody has played yet.

Two are ready to build now (pipeline, airport) because they do not touch the scales. Three
wait on a scope: coach on trunk, okada on feeder, water on everything.

---

# 1. Pipeline — ready now

## What it is

A fixed link that carries fuel between two points and nothing else. No vehicles. Enormous
to build, almost free to run. It is the only infrastructure in the game that **takes traffic
off your roads** instead of adding capacity to them.

It carries up to a cap. Demand above the cap still goes by tanker, so the fuel chain stays
alive — quieter, not solved. That was the owner's fix for the endgame worry and it is the
right one.

## The dial, and its price

You choose what share of the flow goes by pipe. The rest goes by truck.

**The union's temperature follows the dial, not the build.** Every tonne through the pipe is
a tonne of work taken off tanker drivers. Building it costs money; *using* it costs you the
chairman.

Which sets the trap: push everything through the pipe because it is cheap, let the trucking
capacity wither, and then a strike or a tap arrives and the trucks you would flip back to
are not there. You either keep paying for redundancy you do not need, or you gamble. **It is
the first mechanic in the game whose right answer is to deliberately run something
inefficiently.**

## Brownfield

`fuel.ts` already fictions *"a pipeline terminal at the map's edge"*. Start one inherited
pipeline, broken, running to that terminal. Restoring it is cheaper than laying new, and it
goes where the colonial economy wanted it rather than where you need it.

## Numbers (first guesses)

| | |
| --- | --- |
| build | ₦2,000 a cell |
| restore an inherited one | ₦700 a cell |
| throughput cap | 250 t a day |
| upkeep | ₦400 a day |
| losses | 2% of throughput, rising to 10% if upkeep is skipped |
| dial | 0–100% in tenths |
| union | temperature rises with tonnes a day through the pipe |

## Checks

- With the dial at zero it changes nothing. With it at 100% and demand under the cap, tanker
  traffic on those corridors falls to near zero and those roads measurably decongest.
- A strike with the dial at 100% and no trucks running costs more than the same strike at
  50%.
- Over a 250-day strategist run the fuel chain still produces decisions — it does not go
  silent.

**Delegable:** yes. It touches goods and the union, both of which have clear seams.

---

# 2. Airport — ready now

## What it is

One airport in the region. **You do not operate flights.** It is a place that produces
demand and you either connect it or you do not.

Two things arrive there: passengers who need to get to towns, and air freight — high value,
low tonnage, so it pays for a road service rather than a freight train.

## Why it is worth having

It is **demand at a point with no people**. Every other source of demand in the game is a
town that also generates its own trips and grows. The airport generates and grows nothing —
it only needs reaching. That makes it the purest possible version of the game's core
question, and it competes for a term's capital against things that serve actual people.

It is also true to the place: Nigerian airports are usually well outside the city with a bad
road to them.

## Brownfield

It exists on day 1, with a poor road, in the wrong place. Nobody has to build it.

## Fits where it was already planned

`brief.md`, *The region*, step 3 — the gateways: the port and border crossings, imports and
exports through them. The airport is the third gateway and should share their machinery.

## Numbers (first guesses)

| | |
| --- | --- |
| arrivals | scales with the region's total population; a few hundred a day at the start |
| air freight | 5–15 t a day, at roughly 8× the standard goods rate per tonne |
| its road on day 1 | dirt, and long |
| growth | arrivals rise as the region's people do, whether or not you serve them |

## Checks

- Unserved, it shows as a visible loss, not as nothing — the forgone trips must be counted
  as generated and unreachable, the way site demand already is.
- Connecting it changes a term's decision: on at least three of five seeds the strategist
  chooses it over something else, rather than always or never.

**Delegable:** yes.

---

# 3. Intercity coach — after Scope 1 (trunk)

> **Shelved 2026-11-06** (brief, decisions log; `scripts/coach-probe.ts`). Its reason is gone:
> fares by distance already make a long bus line pay. On five maps at day 1, a bus on each map's
> three busiest pairs 60+ cells apart netted +₦3 to +₦97 a day -- 15 of 15 positive, to the far
> clusters too (Bewa-Ibakpo, 118 cells, +₦66; Iwimen-Iton, 262 cells, +₦68) -- against +₦58 to
> +₦145 on a short pair: fewer round trips, each paying more. The weakest lose to empty seats
> (51-75% full), not distance. And a coach, stopping nowhere between, would carry only the
> riders going end to end: 43-122 a day on each map's busiest long pair, 20+ on only 6-9 pairs a
> map, where a bus on the same road takes 140-650 a day along it; only one pair 60+ cells apart
> a map is trunk all the way. At the numbers below it would have broken the other way: 50 seats
> at 1.8x the fare, ₦460-970 a day against a bus's ~₦100 of running -- riders here choose on
> waiting, not price, so the fare costs it none. C31 doesn't fail because a bus can't pay its way
> to a far cluster. If it comes back, it needs a job a bus can't do; the scope below is kept as
> it was.

## What it is

The real Nigerian intercity sector: ABC, GUO, Chisco, The Young Shall Grow. Terminal to
terminal, booked seats, high fare, long run, **does not stop in between**.

## Why it is not just a bus

Because it may only serve **long pairs**, and only between terminals. That restriction is
the whole mode. A bus can run anywhere and loses money over distance — the `long` verdict
already fires. A coach is priced and permitted for exactly the trips a bus cannot make pay.

## What it unlocks

It is the mode that makes a far cluster worth reaching, which is **C31 — "the far clusters
pull" — currently failing**. Not by subsidy; by there being a service that works at that
distance.

## What it needs

- a **terminal** build, a sibling of the motor park you already have;
- scope 1's trunk class — a coach runs trunks only;
- the long-pair restriction in route validation.

## Numbers (first guesses)

| | |
| --- | --- |
| minimum pair distance | 60 cells |
| fare | 1.8× the standard schedule |
| capacity | 50 seats |
| loads | slowly, at a terminal only |
| runs | at the trunk's speed, unaffected by feeder congestion |
| terminal | ₦30,000, one a town |

## Checks

- On a long pair, a coach nets positive where a bus on the same pair nets negative.
- On a short pair it is refused, with a reason that names the distance.
- C31 passes: by the end of term 2 the strategist connects a far cluster because the coach
  made it pay.

**Delegable:** yes, once trunk class exists and the numbers above are fixed.

---

# 4. Okada permission — after Scope 2 (feeder)

## What it is

Not a new button. A rule: **okadas and kekes may not run on a trunk.** Danfos may, and pay
its toll.

The only player action is the one scope 1 already adds — declaring a road a trunk when you
build it.

## What it changes in play

You lane the Agbara–Iwo trunk. Today the okadas keep running it. With this they cannot —
they were never legally allowed — so they leave, and **appear thicker on the feeders into
Agbara and Iwo**. Your BRT gets the corridor; the last mile stays informal and becomes
visibly so.

The informal sector reorganises *around* your investment rather than fighting it head-on,
which is both truer to Lagos and a better rival than one that only pushes back harder.

## The cost

Declaring a trunk takes a road off the union's members. Expect a named demand, with a
deadline, from the chairman who already exists.

## Checks

- After declaring a trunk, okada volume on it is zero and feeder volume at both ends rises
  by a comparable amount — they move, they do not vanish.
- The union reacts within a term.
- Trips made does not fall: the journeys are still happening, by a different mode on a
  different leg.

**Delegable: no.** It is inside the paratransit controller, which `CLAUDE.md` reserves, and
it changes where demand goes.

---

# 5. Water — last, and not delegated

## What it is

The river and the coast become something that carries, instead of only something that costs.

Jetties as a build; boats as a vehicle class — slow, high capacity, cheap per tonne, only
serving towns on the water. The route itself costs nothing to lay, because the river is
already there. What you buy is the jetty and the boat.

## Why it is the biggest of the five

It **inverts the game's own terrain rule**. Today water is pure cost: it floods your fords,
it charges ₦1,200 a cell to bridge, it forces roads round. Make it a corridor and the
obstacle becomes an asset, using geography the generator already produces — a river draining
to the sea, tributaries, a coast, a port.

## The detail that makes it a real decision

**The rains already exist.** `floods.ts` closes two fords for twenty days, twice a year. The
same rains that cripple a road network **raise the river for the boats**. One shock,
opposite effects, depending on what you invested in — and no new shock system to build.

## The rule not to break

**No dredging.** That is terraforming and it breaks the fifth pillar. Channel depth is
terrain you work with: it caps boat size, and you take the bigger boat only where the river
allows.

## Brownfield

The colonial line ran to the coast for export. The port and the river *are* the
historically correct route, sitting there unused — which is the premise stated as geography
rather than as text.

## Why it is last

It needs a water corridor type in pathing — the area `principles.md` §3 says cost the most
to relearn, and where a plausible-looking wrong answer is expensive — plus generator work to
place jetty sites. Both at once is the worst thing to hand off.

## Checks

- A bulk chain delivered by boat is cheaper per tonne than by lorry and slower, measurably.
- During the rains, a river route's throughput rises while the flooded road's falls.
- Towns off the water are not disadvantaged into irrelevance: measure their share before and
  after.

**Delegable: no.**

---

# Already scoped, needing one correction

**The urban ladder** (`PROMPT-urban-ladder.md`) is written and should not be run as it
stands. Its three rungs and their numbers hold; its *reason* does not. It justifies a city
line by fares and a growth-cap lift. After the inside scope, a city line exists mainly to
**take cars off your own approach roads**, and the three rungs should differ in how much of
the car slice each takes. Rewrite that section first.

---

## To add to `docs/brief.md`, Decisions log

> **2026-11-03, five modes scoped (proposed).** Pipeline (a capped link with a truck/pipe
> dial whose political price follows the dial, not the build) and the airport (a third
> gateway: demand at a point with no people) are ready and delegable. Intercity coach waits
> on the trunk class and answers C31 — it is not a long bus, it is the only mode permitted on
> trips a bus cannot make pay. Okada permission waits on the feeder scope and moves the
> informal onto the feeders rather than removing it. Water is last and not delegated: it
> inverts the terrain rule, uses the rains already built, and needs pathing plus generator
> work. The urban ladder's prompt needs its rationale rewritten on top of the inside scope.
