# Transport game — design principles

Why this codebase is shaped the way it is, and the rules that keep it that way. For
*how* it's currently shaped, see [architecture/index.md](architecture/index.md). For
*what's built*, see [status.md](status.md).

This document used to be a build plan for a from-scratch rebuild (the previous build was
lost before reaching a remote). That rebuild — Modules 0 through 10 — is complete; see
status.md. What's left here is the part that doesn't go stale: the premise, the scope
boundary, and §3 (Findings), which is still the most valuable section in the repo — each
line cost at least one diagnostic cycle to learn, several cost weeks. **Read it before
writing simulation, economy, pathing, paratransit, or growth code.**

---

## 1. What this is

A transport infrastructure game set in a lightly fictionalised West African country that
reads as Nigeria. The player builds roads, rail and ferries across four historical eras,
lays vehicle routes on them, and contends with an informal paratransit system that fills
every gap they leave.

### Design pillar: true, not teaching

The filter for every decision is *"is this true to how transport in this place actually
behaves?"* — not "is this fun?" (paralysing) and not "does this teach?" (invites
bolted-on lessons). Truth is also the content engine: a truthful system generates drama
nobody authored.

### The hook

**The player's planned network competes with an emergent one.** Paratransit is not a
vehicle you buy — it is a system that exists whether you like it or not, and it fills
any gap you leave. It competes for passengers *and* for road space.

This is the thing no other transport game has. Protect it. Any change that makes
informal transport a subsystem rather than an antagonist is a change in the wrong
direction.

### Spine

Building infrastructure. Everything else is subordinate:

- Power/authority is *narrative framing*, not a fantasy to be simulated.
- Politics is *terrain* — a cost or constraint on building. Never its own screen.
- Tycoon economics and puzzle optimisation are ingredients, not the spine.

### Brownfield premise

The map is never empty. The player inherits a colonial rail spine built for export
rather than for people, plus some pre-built roads. **The inherited network's geometry
being wrong for present demand is the point.** Never "fix" it.

### Governing principle for terrain

**Terrain is never ignored and never reshaped. It is overcome, and overcoming costs.**

No terraforming. A mountain in the way is a real choice: go around, over (elevated), or
under (tunnel). Water is terrain; a bridge is how you overcome it. Gradient limits
become meaningful rather than obstructive — which is why real railways have far more
tunnels than roads do.

**Corollary, load-bearing:** the cost model must be able to say *why*. A route quoted at
4× the direct price must break down as "1.2km viaduct · 400m tunnel", not just a bigger
number. Otherwise the choice between round, over and under is invisible and pricing
reads as arbitrary.

---

## 2. Scope

### In

**One map scale: regional.** Settlements spread across a large map, corridors running
tens of cells between them. This is the scale that felt playable.

### Out, and staying out

- **City / district scale.** Parcels, catchment, stops-as-nodes, mode choice, the dual
  demand model. Months of work that never looked right; the scale confused everything —
  a district's worth of content at a region's framing.
- **City-builder mechanics.** Zoning, land value, developer models, service coverage.
  Different genre, more crowded, and the hook stops being the hook.
- **Nested scales.** No drilling from region into city.

### The finish line — decided

This was never answered on the first attempt and it is why scope kept expanding.

- *Something others play* → needs onboarding, a goal, and a stopping point.
- *A personal sandbox* → needs neither, and can stay open-ended.
- *A foundation to extract an engine from* → stop at "the systems work".

**Answered: a personal sandbox, and a foundation to extract an engine from.** Not
"something others play." Concretely, this means:

- No onboarding, no authored goal, no stopping point to design toward.
- "Done" for a piece of work means *the systems work and hold up under play*, not
  *polished for a stranger*. Favor clean, modular boundaries (§4's `engine/` purity rule
  matters *more* under this answer, not less, since it's the seam an engine extraction
  would cut along) over onboarding-flavored affordances like tutorials or guided goals.
- The standing test is *"does this hold up as a sandbox, and would the relevant system
  survive being lifted out on its own?"* — not "is this a game someone else could play?"

### Tech stack — kept, not the problem

TypeScript strict + Vite + three.js + vanilla-DOM game UI + Preact for dev-only tooling
+ schema-validated JSON content. None of it was the source of the first attempt's
problems; see [architecture/index.md](architecture/index.md) for how it's actually used
today. Two decisions worth restating because they're easy to relitigate:

- **No framework for the game UI.** The no-cached-display-state discipline (every panel
  re-derives from the snapshot, never stores a mutable view tree) is what a framework's
  reconciliation exists to solve — a framework would be solving a problem this codebase
  doesn't have. Preact is fine for the dev studio, which is forms and sliders and never
  ships.
- **No physics engine.** Vehicles move along corridors as progress values on a graph. No
  forces, no collisions, no rigid bodies — a physics engine would be infrastructure for
  a problem that isn't this game's problem either.

---

## 3. Findings — build these in, do not rediscover them

**This is the most valuable section in the document.** Each line cost at least one
diagnostic cycle to find, several cost weeks. Where a finding produced a specific bug
during the actual rebuild, the deep-dive architecture doc for that area has the
blow-by-blow; this section is the distilled rule.

### Demand

- **Passenger demand must be reciprocal by construction.** Commuting is round-trip.
  Generating one-directional pairs and hoping reverse flows emerge leaves every route
  half-empty.
- **Every inhabited node originates demand**, not just "significant" ones. Excluding
  villages removes rural-to-urban movement, which is the most characteristic flow in the
  setting.
- **Goods stay one-way**, with reverse flows authored separately as *different cargo*.
  Produce does not come back from market; supplies and imports go the other way.
  Mirroring goods flows is untrue and pointless.
- Demand pairs are static topology; growth scales the *rate*, not the graph.
- **Rail pays through the towns, not past them** (slice, §6 step 4d). One train, 40 days:
  new track Ilase–Owode +₦298/day (₦3,146 of track and train; four buses on the same pair
  +₦263 for ₦2,000), Ilase–Owode–Ado +₦437 (₦5,658) — the best strategy measured. Straight
  lines that bypass the towns lose: the restored colonial line Ilase–Ipaja −₦125, new direct
  Ilase–Ado −₦10 (skips Owode). The brownfield line is cheap to restore and wrong — keep it
  that way. A train is fast or it's nothing: frequency is what one vehicle on a route lacks.
- **Worn track needs a slow order to matter** (slice, track wear). At the wear factor every
  vehicle gets (72% at the floor), a worn line cost a fast train ~₦37/day and keeping it up
  was a wash. Railways restrict speed on bad track; with a slow order below 60% condition
  (trains at 60% of that), keeping a busy line up is worth +₦72–102/day for ₦37–67 upkeep.
  And price track *upkeep* like a road's per cell: building pays for formation and rails,
  upkeep for ballast and sleepers — at building rates nobody would keep a line up.
- **Two networks, one map** (slice). Track is a segment on the same map, but everything that
  drives routes on roads only and trains on track only; a train between two towns that also
  share a road must never be read as road traffic (it was, once: route diagnosis looked a
  train's edge up on the road network and reported the road's wear and danfos). Every
  "all segments" loop has to ask which network it means — a bus "running on" to the next
  town found it over the railway.
- **Freight needs a load back, and export is it** (slice, freight trains). Produce went only
  to the nearest market, so every rail corridor carried goods one way. Export — a market
  sends on to the port half the produce *delivered* to it — gives the trunk a return load,
  and makes it depend on feeders: nothing reaches the port from Ado until lorries bring
  produce to Ado. Measured, 40 days: a freight train alone on Ilase–Owode–Ado +₦160/day
  (one-way, 115 t/day — a lorry on that run loses ₦72: volume over distance is rail's job);
  with two feeder lorries, Ado exports 23 t/day and the train makes +₦230; on the restored
  old line −₦115.
- **Goods pay only where they go both ways** (slice, §6 step 4c). Produce to market, supplies
  from the port: a lorry running one flow comes back empty. Measured, one lorry, 20 days,
  ₦4/t: Ilase–Kuto (produce in, supplies out) +₦66/day, Ilase–Ise +₦26; supplies-only
  Ilase–Owode +₦5, produce-only Ado–Ogbe −₦49, long one-way Ilase–Ado −₦72. At ₦3/t no lorry
  paid at all. That gap *is* the decision — keep it when retuning.
- **With truckers, short hauls are theirs and long ones yours** (Revision 2, private
  truckers; goods per tonne per cell). Truckers pick up what waits at a yard, keenest on the
  shortest runs and not at all past 40 cells. Measured, one lorry, 20 days: Ilase–Kuto (29
  cells, both ways) went from +₦41 a day to −₦20 -- undercut -- while long, one-way Ilase–Ado
  rose from +₦8 to +₦41 (no trucker goes that far, and fewer trucks crowd it). The decision
  moves from "pair the flows" to "take the long hauls, or rail": goods both ways still help,
  but distance decides who carries them.
- **Roll lumpy earnings over longer.** A lorry delivers 30 t at a time, a dozen seconds
  apart; on the 30 s rate a buses route uses, a route making +₦66/day showed +₦15. Lorry
  routes roll over 4× as long.

### Vehicles and carriage

- **Conveyor model.** Vehicles physically carry aggregate `{to, from, passengers,
  goods}` entries. Throughput means *delivered*, not capacity-present.
- **Opportunistic loading, no manifests.** At each node a vehicle loads queued demand
  whose destination lies ahead on its remaining route.
- **Load entries must carry `from`**, or delivered trips cannot be attributed back to
  the origin that generated them — which growth needs.
- **"Ahead" means: before the vehicle next comes back through this stop.** Both simpler
  readings are bugs. The array tail made every A↔B route run its return leg empty —
  reciprocal demand generated, one direction served — and no test caught it for twelve
  modules, because every test checked one direction. The whole cycle made a rider at a
  mid-route stop board a bus heading the wrong way and ride all the way round. Found by a
  headless probe and by designing transfers, not by play.
- **Riders change buses** (slice, §6). Without transfers a network is only a pile of
  separate shuttles, and the one winning play is a direct route per big pair — the
  playtest's thin connector routes all lost money for exactly this reason. Each leg pays a
  fare, as each danfo does; that is what makes a feeder route earn from the riders it hands
  on, and makes connecting things compound. Measured: 4 buses as a chain or hub earn about
  twice what the same 4 buses earn on one route.
- **A new vehicle on a route joins the largest gap**, not a terminus. Starting every bus at
  an end sends them out as a convoy that serves the route exactly as often as one bus:
  measured, 2, 4 and 8 buses earned identically.
- **Player vehicles run cyclic routes. Paratransit is one-shot.** Cyclic paratransit
  drains queues to a comfortable equilibrium and removes the pressure to build.
  Measured, not assumed.

### Paratransit

- **Paratransit is where abandoned passengers go** (slice model, §6). Waiting passengers give
  up at a steady rate; the ones who give up board danfos if a road exists, and stay home if
  not. This bounds every queue by construction (a queue settles at rate × patience) and makes
  frequency worth paying for — a cap on queue length does neither, it just keeps every
  vehicle full forever.
- **Danfos run corridors, not pairs.** Dispatching one danfo per (origin, destination) pair
  splits demand so thin that most never fill: measured, lifting every cap barely moved the
  stayed-home share, while one-seat danfos cut it from 53% to 33%. Group riders by origin and
  first hop; send the danfo where most of them are going; everyone whose stop is on the way
  boards.
- **The informal sector scales its vehicle to the gap.** Danfos first (cheapest per seat);
  people who won't wait for one to fill take a keke or an okada. Without the small modes, a
  dense player network split leftover riders across so many directions that no danfo ever
  filled, and they went home: measured on a 34-bus slice network, danfos fell to 3% and 38%
  stayed home — the antagonist beaten by a modelling gap, not by the player. With kekes and
  okadas the same network leaves informal at 23% and stayed-home at 17% (mostly the one
  town no road reaches). "Stayed home" should mean *no road*, not *no danfo filled*.
- **Cap per corridor, not only per demand pair.** Many pairs route over one corridor;
  without a corridor-level cap, 20+ informal vehicles accumulate on one link and
  collapse throughput to ~10%.
- **Hold road space only ahead of the vehicle.** Held on the whole path until the trip
  ended, a long run kept trunk space it had left: a new long road (Ilaro–Ipaja) took 60–80
  trips a day off the network. Released as the vehicle leaves each segment, the same road
  adds ~30. That held space had been an accidental second cap on the trunk: released,
  danfos crowd your buses there (8 trunk buses: below half speed 60% of the time, your
  riders 289 → 180). The cap must be honest about what it is capping: one road, one
  budget, your vehicles' road space included (225 riders, and the danfos on the trunk fall
  as you add buses; slice zero step 5b).
- **Gate spawning on sustained congestion**, not queue depth alone. A real operator does
  not join a jam that pays nothing.
- **Per-vehicle congestion weight.** An okada occupying the same road space as a bus is
  plainly wrong and inflates the congestion effect.
- **Inside towns, informal is acknowledged, not contested** (slice, §5 answered). Short
  trips and the last mile are kekes' and okadas' for good: the slice shows each town's
  inside trips (10 per thousand people a day, 2–3× what it sends to other towns) and how
  many of your riders reach the park by keke or okada (a share growing with town size), and
  keeps both out of every share and all money. A permanent informal share must not read
  as failure, so every headline says "between towns". There the relationship is feeder,
  not competitor. It's display only, against "a parameter enters only when it creates a
  decision" — taken on purpose, for truth; the formal tier that would make it a decision
  waits on play.
- Paratransit is **passengers-only**. Informal freight needs capital an okada does not.
  The asymmetry is deliberate and historically true. *Amended in spirit (brief, Revision 2,
  agreed 2026-10-19):* private truckers -- hauliers who own a lorry, not paratransit -- are
  the informal sector's freight rival, so goods get an antagonist without paratransit
  carrying freight.
- Paratransit **counts toward service at a discount** (~0.5) for growth purposes:
  informal service *sustains* a place, player service *develops* it.
- **Freight that every town depends on must not ride the danfos' road budget** (slice,
  Revision 3, fuel). Held to it, tankers sat behind a busy dirt trunk with 350 t at the tank
  farm; counted against it, their long slow hauls crowded danfos off and cut trips made by
  27%. A tanker congests the road like anything else, and that's all.

### Congestion

- **Congestion scales effective capacity, not just speed.** Speed-only means more
  vehicles is always better and there is no puzzle.
- **Free first slot** — one vehicle on a corridor is not congested.
- **Congest on flow, not occupancy** (slice, §6 step 2). Feeding the speed curve the
  vehicles *on* a road feeds back on itself — a jam slows vehicles, so more sit on the road,
  so the jam deepens: measured, one bus locked half a split road at the speed floor for
  good. Flow (road space *entering* per second) has the stable feedback: a jammed bus makes
  fewer round trips, so enters less often. Capacity is per road, not per cell — a lane
  carries so many vehicles an hour whatever its length. Speed follows the BPR curve, the
  standard speed-flow relation.
- **Count entries per leg, not per segment.** A shuttle uses the same segment both ways;
  keyed by segment it never re-entered, and its traffic was invisible until something split
  the road. Caught by a feel test, not the probe — the probe's map happened to split it.
- **Paving only pays where riders are being left behind.** Measured on the slice's trunk:
  paving lifts 4 buses from 75% to 95% speed, but fares barely move (₦514 → ₦505/day) —
  78% of riders were already carried, so the faster buses run more empty trips. Where
  buses run full (2 buses, or a chain feeding the trunk), it's worth +₦34–52/day, paying
  back its ₦382 in 7–11 days. Capacity relief is worth what the jam was costing in
  *riders*, not in speed.
- Congestion is what couples informal traffic to player economics. Weak service invites
  the interference that weakens it further. **Keep this asymmetry** — it is the hook
  working — but make sure there is an exit.

### Economy

- **Fares are global per cargo kind**, not per route. A transport authority sets fares
  by policy, and it keeps demand elasticity well-defined.
- **Revenue accrues on unload**, not on carriage.
- **Operating cost is per-tick and unconditional.** Era fuel multipliers drive it, so
  the Informal-era spike bites operationally rather than only at purchase.
- **A bad road's real cost is the vehicles, not the time.** Fuel, tyres, springs and
  breakdowns rise steeply with roughness — the centre of road agencies' maintenance
  economics (World Bank HDM-4). Without it, maintenance never paid: the player paid to
  repair wear mostly made by danfos and okadas and got back only a little speed (lever
  audit: −₦88/day net on the trunk over 30 days). With worn roads raising your vehicles'
  running cost (up to +70%), maintaining a road your buses use pays back in ~10 days,
  paving it in ~9, and maintaining one only danfos use earns nothing — the decision is
  *whose* road it is. Roads must start sound for this to work: started worn, it taxed every
  bus from day one and the early game went negative.
- **Debt allowed** — no interest, no game over. Spending blocked, billing continues.
  Hard failure is wrong for a sandbox.
- **Vehicle resale must be depreciated**, or a player in debt liquidates the fleet and
  is instantly solvent.
- **Per-def purchase costs are essential.** With one flat cost, every roster comparison
  is meaningless — capex held artificially equal. 1 BRT ≈ 8 danfos is a meaningful
  ratio.
- **`eraOut` closes the purchase catalog; owned stock keeps running.** Despawning a
  fleet at an era boundary is an unsurvivable cliff. This is graceful obsolescence.
- **Rising maintenance on obsolete stock** is the other half — without it nothing
  pressures replacement and era turnover never happens.
- **A scarcity must build with success, not be there on day 1** (slice, Revision 3, fuel).
  Imports at 40% of day 1's fuel, then 70%: replayed, shortages from distance alone cost 37%
  of net by day 30, before the player could do anything about them — the early tax already
  removed twice (wear, savings). At 100%, towns start supplied and run short as your
  service grows them, like a jam. Same rule for a second source: **it must only add**.
  Allocating by one share, or the new source first, made restoring the refinery lower
  supply (its fuel crossed the map to towns beside the tank farm); the old source first,
  the new one filling what's short, nearest it, it can only help.
- **Short, split a source over everyone by want, not nearest first** (slice, Revision 3,
  cement). Nearest first, a short cement works gave its neighbours everything and the far
  cities no flow at all — nothing waiting at the works for them, so a lorry to them had
  nothing to carry and the player couldn't help. Split, every town's share waits at the
  works; truckers take the near ones, and the far ones are yours. (Fuel's imports cover the
  map, so nearest first there only decides who's short at the edges.)
- **An input the informal sector already supplies must be calibrated to it** (slice,
  Revision 3, workers). Danfos carry 46–89% of commutes to a connected site on day 1;
  staffing reads full at half of them made, so the dependency bites where it's true (no
  road, a jam, danfos parked by a fuel shortage) and not as a day-1 tax. And a site whose
  workers can't commute by road at all — a crude source fed by your freight line — mustn't
  depend on them: measured, it starved the refinery to a quarter.

### Decay (slice, §6 step 4)

- **Make upkeep a choice of roads, not a chore of clicks.** A maintained road is repaired as
  it wears and billed as it goes; the decision is *which* roads to keep. Repair-on-click
  asks for the same click forever once it's worth it at all.
- **Wear follows use**, plus a little weather. The roads you lean on are the ones that go —
  and the roads only danfos use wear down on the informal sector, not on you.
- **Paving must include repairing the base.** Priced as surface alone, paving a worn dirt
  road (new surface, more capacity, a third of the wear) cost less than repairing it, and
  repair was never the choice.
- **The crossings are where it bites.** Measured: keeping the trunk up pays (+₦80/day over
  neglect on a 4-bus chain); keeping the bridged Owode–Ado road up as well *loses* (₦129/day
  upkeep for ₦72 back). A bridge wears 2× and costs 4× a cell to repair (the build ratio).
- **Starting sound isn't enough if wear is fast: time to the floor is what matters**
  (2026-10-20, from a playtest's run file). Roads started at 0.95, but on generated maps the
  danfos' traffic wore every inherited dirt road to the floor in 5–30 days, and worn roads
  raise your vehicles' running cost: the same early tax as starting worn ("routes kept
  losing"). Replaying the run with five minibus routes, wear cost ₦24,940 over 60 days
  against wear off. On dirt, weather and heavy danfo flows dominate, so cutting the traffic
  term alone did nothing (floor still from day 22); the dirt multiplier was the lever. At
  0.0001 traffic wear and dirt ×1.5, dirt reaches the floor on days 41–68 and wear costs
  ₦14,320. Keeping roads up becomes a mid-game choice again. The cost: paving now cuts wear
  1.5×, not 3×.

- **The fare level scales everyone together; it can't fix a snowball or a skill gap**
  (slice zero step 5, fares by distance). Measured at ₦1 boarding plus ₦0.6, 0.8 and 1.0
  per 10-cell stage: a budget-balancing trips-maximiser either never gets going (₦0.6:
  +₦12 a day, waits on money 42 of 46 days) or snowballs once its early network pays
  (₦0.8: +₦1,065; ₦1.0: +₦2,036, never waits) -- a knife edge, not a dial. And the best
  opening earned about twice the next at every level (₦221 against ₦95; ₦680 against ₦315;
  ₦1,247 against ₦608): cutting fares shrinks every plan alike. Set the fare for the
  opening (a minibus to a newly connected town should pay); cap compounding with
  something that bites only on surplus, and test opening variety with plans of equal skill.

- **A lifeline road buys trips at a premium, and loses a little money** (slice zero step 6,
  M2 read in trips). A road to a cut-off town plus one vehicle adds 28-44 trips a day at
  ₦17-31 per added trip a day, losing ₦18-64 a day; a budget-balancing trips-maximiser's
  moves on days 20-30 cost a median ₦11 (17 moves). The best lifeline (Ikole, a minibus)
  is at 1.5x that, just over; the rest are 2-3x. The losses are easily carried (a fifth of
  that player's net is ₦518 a day). So lifelines aren't bad buys, they're dear ones: what
  makes a player build one is a town left with "no road", not the per-naira ranking.
  (Caveat: the moves it bought were ranked on 5-day twins, the lifelines measured over 60.)

- **A short twin can rank a paving that costs trips over the long run.** On day 1 the best
  paving by trips per naira over days 6-10 (Ado-Ogbe) loses 39 trips a day over 60 days.
  The bots pave by that ranking, so their paving choices are suspect where the two disagree.

- **Price a way out against what it saves, not against what's at stake** (Revision 2,
  settlements). A settlement priced at a day of the corridor's income looked like "the
  corridor's value", but a strike costs a small part of that (₦86-2,069 against quotes of
  ₦2,376-6,814, twin-measured), so paying was never right and strikes were "let pass". A
  choice exists only where the two prices cross: at 0.3 of a day's income, settling wins on
  the strict bus trunk and loses where BRT rides out the strike.

### Balance numbers (from the first attempt — starting points, not gospel)

- Fleet optimum was ~15 vehicles under static demand; revenue plateaued around the
  network's coverage ceiling; net went negative past ~31.
- **Route composition matters more than fleet size.** Pruning the worst 10 of 62 routes
  took net/day from ₦1,164 to ₦4,443 — revenue fell 2.7%, cost fell 11.3%.
- **The failure mode is over-building past what the network reaches.** Not mispriced
  fares.
- **Running cost has to make some routes lose.** In the slice at ~₦48/day a bus, every
  route paid — thin feeders, a road to a cut-off town, even six buses jamming the trunk —
  so the only decision was "more". At ~₦105/day (about a third of a good bus's fares) a
  thin route run alone loses, the trunk peaks at 2 buses, and a 4-bus network nets ~40%
  less. Congestion couldn't do this: it only punishes piling onto one road.

### Growth

- Growth driven by a **paratransit-discounted service ratio**, gated by a smoothstep on
  a **rolling** S̄ (never instantaneous).
- **Growth requires player service as a necessary condition**, not just a weighted
  contributor. Otherwise reachability saturates late-game and everything grows on
  informal service alone.
- **The promotion threshold must sit early in the growth curve**, not near the cap. The
  logistic term halves the rate as you approach the ceiling, so a threshold at ~58% of
  cap arrives far too late to be felt.
- `D_max` must be bounded independently of `D`, or the logistic cap chases the variable
  and growth is uncapped exponential wearing a logistic's clothing.
- **Places grow from people passing, not vehicles.** In the slice, a roadside town's size
  follows riders per second through it. Counting vehicles let empty buses inflate a town:
  measured, 12 buses on one route grew its town to the cap and made over-busing pay for
  itself, which deletes the fleet-size decision.
- **Growth moves the fleet optimum, and loosens money** (slice, §6 step 4b). Serving a town
  grows it, a bigger town makes more trips, and more buses then pay: measured at day 40, 4
  buses on the trunk net +₦263/day with growth against +₦61 without, and a paved trunk
  with 6 buses +₦522. Intended — a served place develops and needs more service — but it
  undoes some of 2b's tightening by the mid-game. Watch it in play.
- **A fixed cap ends the story at the first upgrade; a cap set by the corridor keeps it
  going** (Revision 1, 1a). With the cap a fixed multiple of a town's start, the Ilase-Owode
  trunk jammed on dirt by day 15 and, once paved, never jammed again through day 90: its
  towns stalled under the cap. With the cap set by the town's best road (dirt +50% as
  before, paved +125%), the paved trunk's towns grow into the room and it jams again 26
  days later (27 with buses held to 8: the jam comes from danfos and growth, not only
  over-busing). The probe: `scripts/corridor-probe.ts`. Paved caps of 1.0, 1.5, 2.0 bought
  49, 16 and 13 days: breathing room is steep in the cap.
- Growth **must be visible without reading a number**, or it reads as a treadmill —
  queues rising faster than you can add vehicles — rather than as a place developing.

### Geometry and pathing

- **The A\* cost function IS the build price.** Where a system optimises against one
  function and reports or charges another, they will disagree. This was violated four
  separate times on the first attempt and each was a real bug.
- **Price a straight line as a line** (slice). pathing/plan.ts's "straight" mode prices the
  supercover staircase of cells a line touches, so a straight road on flat ground quoted
  ~2.5× the same road found by search. The slice's `planDirect` finds water with supercover
  (one bridge per crossing, span-capped) and prices the ground by stepping along the true
  line through `stepCost` — every term still from cost.ts. "Cheapest" is then the cheaper of
  the searched bend and the line: the search's own grid steps overcharge diagonals up to ~8%,
  so where nothing's in the way the line wins. Measured: Ilaro–Owode straight over the ridge
  ₦852 and 20% shorter, round it ₦555; a bus through it does ~₦28/day better on the shorter
  road. Track over the same ridge: ₦4,989 straight, ₦1,671 round.
- **Travel length must follow the alignment**, or going round is free (slice, step 3). Routing
  and vehicles measured every road as the straight line between its nodes, so a road bent
  round a ridge cost less *and* drove no slower — "around" always won. A segment now
  carries its alignment's length.
- **A town's size limit must follow what its corridors carry now** (Revision 1,
  2026-10-19), the same rule as travel length following the alignment: a measure that
  ignores the thing it stands for gets gamed. A bus lane left lax kept the lane's growth
  cap while the danfos took it back and paid tolls and levies again in it -- the lane's
  benefit without its cost -- and lax beat strict enforcement on every corridor (trunk,
  120 days: ₦744,038 against ₦717,540). The cap now slides from the lane's share toward a
  paved road's as encroachment grows; fully taken, a lane grows towns like the road it is.
- **One geometry representation.** Everything has a polyline, including straight-line
  corridors (a two-point polyline). Dual representations produce a bug class.
- **No corner cutting in A\*.** A diagonal move between two land cells whose shared
  corner is water must be disallowed, so pathing cost, water measurement and rendered
  geometry all agree.
- **Supercover DDA for all water measurement**, not endpoint or interval sampling,
  which misses corner clips.
- **Smoothing must not change corridor type.** Clamp smoothed geometry back to the
  traversable set — both vertices *and* segments — with a raw-path fallback.
- **Density is a pricing term, not a routing one** at regional scale. Measured: it
  alters ~2% of paths and junction-routing saves at most 3.3%.
- **Heading-aware A\* for rail** gives a real turning radius and makes rail feel
  different to lay.

### Nodes, chains, levels

- **A corridor is a chain of nodes.** Each node costs money. Each segment between two
  nodes is independently typed, levelled and maintained. This makes curves, bridges,
  stations and elevation fall out of one graph change rather than four features.
- **A `vertex` is a fourth node kind**, never named, never labelled. Separate enum
  value, not a flag on `junction`, so every switch site is a compile error until
  handled.
- **Node cost is what keeps shaping a decision rather than a flood.** The generator
  never places vertices; only the player and the water rule do.
- **Segment `level`: underground | ground | elevated.** A bridge is an elevated segment
  over water.
- **An elevated segment must be bank-to-bank.** A corridor-level "crosses water" flag
  raises the deck along its entire length, which renders as a dam.
- **Curve continuity across joins.** Smoothing per segment produces a kink at every
  node. Tangent-match across joins, and apply the turning-radius constraint across
  joins too.
- **Alignment modes** — straight, curve, auto — picked before drawing and switchable
  mid-draw, per segment. Straight does not mean "ignore terrain"; it means "hold this
  line and tell me what holding it costs."
- **Wet waypoints must not create nodes.** Otherwise a span-scaled premium is defeated
  by chunking, exactly as a hard cap was.

### Bridges

- **Premium scales linearly with span**; total cost goes with the square since base
  cost is already proportional. Exponential would make *n* short spans cheaper than one
  long one, handing the discount to whoever clicks most.
- **Bridges decay faster and cost more to repair.** This is where it earns its keep as
  a *game* change: the network stops degrading uniformly and starts failing at the
  crossings, which are exactly the links that cannot be routed around.
- **A\* must weigh a bridge against a detour.** If water is near-prohibitive, roads
  trace shorelines and no bridge is ever chosen — bridges become a manual override
  rather than part of the model.
- The inherited spine gets **no span cap** — it already exists and was not paid for.
  Applying the player's cap severs it.

### Eras

*Paused (2026-10-16): the slice (§6) runs in one present-day setting. These findings stand
for if eras return; they are not live in the slice.*

- **Four compressed eras:** Post-Independence → Oil Boom → Informal → Modern.
- **Palette carries most of the era legibility.** Verified cheap; four
  screenshot-distinct worlds cost very little.
- **Era identity must be expressed mechanically**, not only in prices — per-era
  paratransit parameters made the Informal era feel like informal transport taking
  over.
- **A wrong old line needs a way to be made useful, and must be slower than new track**
  (slice, track 2). Restored as-is, the colonial line always lost money (−₦78/day): a trap,
  not a choice. A halt where it passes a town (a short spur in) made it useful — but then it
  earned exactly what new track did for ₦240 less, and there was nothing to weigh. The old
  line is narrow gauge: at 55% of new track's speed, old-to-Owode-via-a-halt earns +₦249/day
  (12-day payback) against new track's +₦312 (10), and the whole old line to Ipaja is a weak
  but positive +₦145. Cheap and slow, or dear and fast.
- **Rail goes dark through Informal and returns as standard gauge in Modern.**
  Historically exact. But a *designed absence* must be visible in advance via a catalog
  timeline, or it ambushes the player.

### Display and legibility

- **A visual must not say something the model doesn't mean.** Every audit found its
  bugs at the display boundary, never in sim logic. This is the single most reliable
  rule in the project — see the orthographic-camera and bridge-deck-rotation bugs in
  [architecture/render-and-ui.md](architecture/render-and-ui.md) for two real instances.
- **Colour encodes a question the player must act on**, not a fact they already know.
  Hue = health, brightness = utilisation. Two channels, two meanings, never conflated.
- **Streets should be neutral by default** and take the health hue only where service
  runs. Colouring every corridor green makes the whole map a lattice and destroys the
  signal.
- **Show relationships, not just state.** Every legibility win came from making a
  connection visible, not a number bigger.
- **Stranded must be reachability-based** — "originates demand that can't reach any
  destination" — not "has no built edge". A road to nowhere doesn't un-strand a node.
- **Per-route P&L with worst-first sorting** is what makes the economy diagnosable.
  Three playthroughs on the first attempt ended in undiagnosable debt without it.
- **Show a route's reach along its whole path, and point thin shuttles onward** (slice
  playtest, day 14). The bus preview counted only the two towns clicked, so a shuttle
  looked as good as a through-route that carries every trip on the way. Suggesting the
  extension needs two guards, both measured: one hop only, and at least as many trips per
  cell — on reach alone the longest route always won (Kuto–Ikole "should" start at Ipaja,
  five towns away); and 1.5× one bus's break-even — Owode–Ogbe via Ado reached 1.1× and
  still lost ₦72/day, while Ilase–Ise → Owode–Ise via Ilase went from ₦0 to +₦63/day.
- **A refusal must not hide the price.** "Can't afford a train" without the price leaves the
  player nothing to plan toward; keep the full preview and add what they have.
- **Group tools by what they act on.** Ten flat buttons read as one list; captioned groups
  (vehicles by network, infrastructure, settings, time), tinted like the thing they act
  on, read at a glance. A setting is a switch, not a tool.
- **Debt needs its exit named** (slice playtest, day 14). "Spending blocked, billing
  continues" is right, but a player in debt can't buy the bus that would earn, and reads
  the situation as stuck. Say the way out — which buses to sell, for how much, saving how
  much a day — the moment money becomes a worry, not after.
- **A route's diagnosis must rank causes, and low load alone isn't overcapacity.** Measured:
  2 buses on the slice's best route run ~35% full yet beat 1 bus, because they still catch
  riders who'd otherwise be lost. "Too many buses" needs low load *and* most riders already
  carried. Likewise "thin" means the trips can't pay for even one bus; comparing against
  the whole fleet's cost called an over-bused strong route thin. And "pay for one bus" is
  what one bus can *catch* (about half its trips, measured), not the whole ceiling: once
  running cost bit, the ceiling test called a losing thin route "waiting" — add buses.
- **No network-wide number can show one action.** The slice's daily earnings genuinely vary
  ±₦75 day to day; a good bus adds ~₦90. Smoothing the total helps (a rolling one-day
  ledger halved the jitter) but can't fix it, and before/after comparisons drown in the
  same noise. What works is a counterfactual: copy the world just before the action, run
  the copy without it, report the difference — exact, because the sim is deterministic,
  and cheap (~1% extra per action being measured). Report after the action has *settled*:
  a new bus starts empty mid-route, and its first day read as a loss when it settled at a
  profit. (Lever audit + receipts, 2026-10-17.)
- **Forecast before the action, not just a receipt after.** A playtester reached day 31 on a
  long direct bus route and two new roads; the receipts said so, after the money had gone.
  The same counterfactual that writes a receipt can run before the click (copy the world,
  perform the action on the copy, run two days in a worker): forecast and receipt use one
  machinery, so they agree to the last decimal if nothing else happens. It also beats rules
  of thumb: "long routes lose" was wrong — a long route *through* towns (Ilase–Ado via
  Owode) forecast better than a short one, because every stop feeds it; the playtester's
  route lost because its straight road passed only small roadside towns.
- **A forecast must sit in the way of the click, not beside it.** At 4× the playtester never
  read it ("whatever the forecast says I don't really pay attention"). What works: the
  preview line turns green or red as soon as the forecast lands, a move forecast to lose
  money needs a second click, and a ranked list of best next moves (forecast in a worker
  pool) answers "where's the best path?" before it's asked. The best paths weren't the
  obvious ones — through-routes via the hub beat neighbour shuttles.
- **Vehicle size is a decision, so the small one must cost more per seat *carried*.** With
  only a 20-seat bus, 14 of 21 first routes lost money: most town pairs can't fill it. A
  12-seat minibus fixes thin routes only if it's cheaper in total but dearer per seat-cell
  (seats × speed) than the bus — otherwise it wins everywhere. Measure capacity as seats ×
  speed: a minibus pricier per seat but faster was still cheaper per seat-cell, and beat the
  bus on every route (playtest: "if I buy a normal bus it bleeds money"). Now ₦63/day for
  12 seats at 3.5 against ₦72 for 20 at 3: minibus on thin routes, bus on top routes and as
  a busy route's second vehicle.
- **Burn rate in the status strip** — income, cost, net per day. Balance without rate is
  unreadable.

### Visual direction

- **Diorama.** A bounded miniature world reading as a made object: base with visible
  thickness, strong value structure, directional lighting, ambient occlusion. This
  resolves out-of-bounds — a model is allowed to have edges.
- Commits to the **middle-distance view**. No street-level flying. That is a trade and
  it saves a lot of building detail.
- **Grounding is the biggest cheap win.** Contact shadow where things meet. Without it
  everything floats.
- **Albedo separation before lighting.** Large areas sharing one albedo reads as flat
  regardless of how the lighting is set up.
- **Full-framebuffer AO conflicts with the corridor signal channel.** GTAO darkens
  corridor strips along with everything else. Ground buildings with geometry and
  contact shadows instead.
- **Water should be a strong value area** the built mass reads against. A flat tinted
  plane does nothing.
- **Roofs carry the colour**, not walls. From this camera the roof is most of what you
  see.
- **Road and rail need a distinct visual channel** — width, surface treatment,
  sleepers. Not hue or brightness, which are taken.

### Maps

- **Varying town sizes alone changes the game only when a cut-off town comes up big.** The
  seeded variation (Revision 1, step 3) kept the hand-made map's towns, roads and trunk and
  drew sizes and the river's crossings. It changed the order of the first moves on every seed,
  but another map's opening, replayed, made about as many trips by day 20 on most seeds: an
  opening of minibuses among the same nine towns serves the same pairs whatever their sizes.
  It fell behind clearly only where a town no road reaches came up big enough to need a road
  on day 1 (status.md, P8). What makes a map play differently is its network (which towns are
  cut off, which corridor is the trunk), not its numbers.
- **A generated network changes what a wrong opening costs; sizes alone didn't.** Generated
  maps (R1 7: positions, trunk, cut-off towns, the river and the city's setting drawn per
  seed) put seed 0's opening, replayed by role, 13-17% behind the best on day 20 on all three
  seeds measured (2 of 3 past P8's 15%), where the size-only variation managed it on 1 of 5.
  Guard what prices rely on at the grain they're priced at: a guard on the trunk's total
  length let one leg run 26% long, and rail on it cost 48 days of surplus (status.md, R1 7).
- **A bot's opening isn't the best opening.** Trips-greedy ranks by trips per naira, so it
  buys cheap openings; on your riders, a replayed opening beat it on 3 of 5 seeds. Compare
  openings against the best of several, never against one bot's.

### Process

- **Sim logic keeps auditing clean; failures land at the display boundary.**
- **Analytical models are wrong on first contact, every time.** The error is usually
  calibration, not structure. Prototype the smallest version that can be felt before
  building the full model.
- **Measure the failing case, not a proxy.** Fixes were twice validated against
  scenarios that weren't broken, on the first attempt.
- **Fix the model before tuning content.** Three balance conclusions were invalidated
  by upstream model bugs found later.
- **Sustained state gates decisions.** Spawn, despawn, notification and promotion read
  EMAs, never a single tick. This bit five times on the first attempt and twice more
  during the rebuild — see the growth service-ratio bug and the income-rate-EMA bug in
  [architecture/engine.md](architecture/engine.md).
- **Small steps with playtests between** worked for mechanics and failed for visual
  work, where half-built looks worse than either end.

---

## 4. Deferred, with triggers

| Item | Trigger |
|---|---|
| Stations ("no station, no service") | Its own pass with its own playtest — it inverts a core assumption and re-litigates the economy |
| Underground / tunnels | When elevated is proven and terrain is worth defeating |
| Corridor failure state | When decay is visibly biting and repair needs to compete with expansion |
| Paratransit on dirt roads | After failure state, sharing a usable-set concept |
| Real-world map import | When the generator is proven and recognition is worth the OSM work |
| ~~Onboarding, goals~~ | Dropped: §2 answered "personal sandbox," not "something others play" |
| LTM traffic model | Only if spillback would change a player decision |
| Scripting / events | When there is a concrete thing JSON cannot express |

---

## 5. Open questions

- **Do settlements need visual richness**, or is the map's problem terrain, water and
  lighting rather than what sits on it?
- **What is a ferry for?** On the first attempt it ended at ~8% of crossings with one
  vehicle type — close to dead content. Either give it a reason to be chosen where a
  bridge is legal (cheap and immediate versus expensive and permanent), or accept it as
  a fallback and stop giving it character.
- **Does rail belong at this demand scale?** An informed player avoided it once the
  catalog showed it goes dark in Informal. *Partly answered by the slice (§6 step 4d):* track
  through the towns people travel between is the best investment in the probe — but only
  once trains are fast (speed 8 to a bus's 3) and cheap to run; at ₦300/day and speed 5 one
  train came round too rarely and lost to buses everywhere. Still open: whether it holds
  once played, and in the slice there are no eras for it to go dark in.
- ~~What does a warm-forwarded Modern-era game feel like?~~ Answered by a headless probe
  (2026-10-16): nothing to decide — queues pinned at cap, growth over in ~2 days, costs
  negligible. That answer is what started §6.
- ~~**Can paratransit be replaced everywhere, or only on the trunk roads?**~~ *(Raised
  2026-10-16; answered "acknowledge it" the same day — see §6 step 2d and Findings,
  Paratransit. "Make it fixable" stays open, for if play makes you want those trips.)* On major roads, formal service can plausibly displace danfos.
  That's what a BRT corridor does. Inside towns, on the short local trips and the last mile,
  it probably can't. Kekes and okadas persist there because nothing formal reaches that
  finely. Two ways to answer it:
  - **Acknowledge it:** model a permanent informal share inside towns that the player
    can't win, and show it as such so it doesn't read as failure. The relationship flips
    there from competitor to feeder.
  - **Make it fixable:** the player addresses it with stops and lighter forms of transport
    (a formal keke or minibus tier) that can reach inside.

  Either way it touches the Stations row in §4 and brushes against §2's "no city scale".
  Inside-town service must stay abstract (a town's internal share), not streets and
  stops-as-nodes.
- **Does the slice's loop hold up?** Step 1's question (§6): does being undercut by danfos
  feel true, and make you want to act?

---

## 6. The reset: one loop, felt first (2026-10-16)

The module build order (0–12) shipped every system and none of them had been played
together: a headless probe of the Modern-era scenario showed queues pinned at their cap
(every vehicle full forever, so no fleet-size decision), growth finished in ~2 game-days,
operating cost at 5–20% of revenue, and a top-down map where nothing visibly happened. The
build went bottom-up — systems first, play last. The reset inverts that.

**Eras are paused.** Four eras × five modifiers on an untuned base made calibration
impossible. The slice runs one present-day setting. The era code stays in the repo, unused
by the slice.

**The slice** lives beside the original game, not instead of it: `slice.html` +
`src/slice/` (2D canvas, DOM panels) over `src/engine/slice/` (pure, tested), importing the
existing engine modules — vehicles, routing, economy — rather than rewriting them. The rest
of the codebase is a library to pull from as each step needs it.

Steps, each played before the next:

1. **The smallest loop** — hand-made map, straight roads, one bus type, passengers who give
   up, danfos that carry them, tight money, a market-share headline. *Question: does being
   undercut by danfos feel true, and make you want to act?* Played 2026-10-16: the
   connecting loop read, and it plays like Mini Metro in a good way — but there was no way
   to see where people wanted to go, nor why a route lost money. So, before step 2:
   - **1b. Legibility** — desire lines on hover (where a town's people want to go, and who
     carries them), and a one-line diagnosis per route.
   - **1c. Towns along busy roads** — pulled forward from step 4 at the playtester's
     request. Sparse by construction, and an emergent town can rarely fade.

   Played again 2026-10-16 (to day 61): *fun, but grindy later — chasing money.* The
   screenshot showed why: long connector routes between towns that barely want each other,
   all losing money, because riders couldn't change buses. So:
   - **1d. Transfers** — riders plan the fewest-buses trip across your routes and change
     at interchanges; each leg pays a fare. Watch next playtest: whether money now
     loosens too far once a network exists.

   Played again (to day 91): transfers worked — 58% share, +₦313/day — but danfos fell to
   2% and 40% stayed home. The antagonist was beaten by a modelling gap (see Findings,
   Paratransit), and money stopped being a constraint (₦19k). So:
   - **1e. Kekes and okadas** — people who won't wait for a danfo to fill take a smaller
     vehicle; road space is a budget in danfo-equivalents. Money is now looser still
     (a 4-bus chain nets ~₦590/day by day 40): step 2's congestion is where density
     should start costing.
2. **Shared road** — danfos and buses congest each other (`tuning.congestion`), closing
   "weak service invites the interference that weakens it further." *Built 2026-10-16,*
   flow-based BPR (see Findings, Congestion). Measured on ilase-owode: 2–4 buses is the
   best count (+₦315/day, road at ~80% speed); 6 buses jam it (63%, +₦184); 12 lose money
   (−₦95). A well-spread network stays at free speed — congestion punishes piling onto a
   trunk, not breadth — so it does *not* tighten money for a spread network. If play says
   money is still too loose, that's an economy lever (running cost), not a traffic one.
   - **Running cost** (before step 2 was played): a bus's running cost went from ~₦48 to
     ~₦105/day, so thin routes run alone lose and the trunk peaks at 2 buses (6 now lose,
     −₦85/day); a 4-bus chain nets ~₦305/day by day 40, down from ~₦533. "Thin" now
     judges what one bus can catch, not the whole ceiling. Watch next playtest: is
     money now a constraint, or a grind?
   - **2c. Paving** (before step 2 was played): the Road tool on two towns a dirt road
     joins paves it, at the price of building it (₦382 for the trunk), so it carries 1.7×
     the traffic. It pays only where riders are left behind (see Findings, Congestion):
     a bus first, paving later. A jammed route on dirt now names the roads to pave.
   - **2d. Inside towns** (answering §5, "acknowledge it"): each town panel says how many
     short trips its kekes and okadas carry (~1,200/day in Ilase) and how many of your riders
     they bring to your buses; none of it counts against you. Headlines now say "between
     towns". Watch next playtest: does it read as informal's ground, or as a loss after all?
3. **A place to build in** — terrain, terrain-priced pathing, bridges, ported from `engine/map`
   and `engine/pathing`. The map stops being a diagram. *Built 2026-10-16, before step 2
   was played* (at the user's call): a river splitting west from east (only the old
   Owode–Ado road crosses it) and a ridge before Ilaro, authored into the hand-made map.
   Roads plan the cheapest way and the quote says why. Measured, Ikole: a ₦581 bridge from
   Kuto with a bus from Ilase loses ₦12/day and serves ₦452/day of trips; a direct ₦850
   bridge from Ilase loses ₦63 (₦181); the dry ₦472 road from Ado loses ₦67 (₦134). The
   cheap crossing that a bus can also serve on the way wins. "Hold the line and pay for it"
   came later (alignment toggle, A): see Findings, Geometry.
   Watch: do bends read as "longer trip", and does the river make you think about where to
   cross?
4. **Depth, one at a time** — decay, goods, rail, growth of the original towns — each played
   before the next. Each must create a decision.
   - **4a. Decay** (built 2026-10-16, user's pick of the four, still before any of 2–3 was
     played): roads wear with traffic and weather, dirt 3× and bridges 2× faster, slowing
     everything on them to a 72% floor; inherited roads start at 75%. The Fix tool (F) marks
     a road maintained: repaired now, then kept new for upkeep that counts in net/day.
     Worn routes say so. See Findings, Decay for what it measured. Watch: is choosing which
     roads to keep a decision, or does everything simply get maintained (or nothing)? And
     the "worn" verdict ranks above full/poached/waiting, so under neglect nearly every
     route says "worn" — true (maintenance is the cheapest fix), but it can hide a bigger
     leak (the long Ilase–Ado route says "worn" with 50% giving up). Re-rank if play says so.
   - **4b. Growth of the original towns** (built 2026-10-16, the user's next pick): a town
     drifts (τ 10 days) toward its start × up to 1.5, on a smoothstep over service (your
     share + half the informal share, 25%→75%), and only once you carry 10% of its trips;
     it shrinks back if service falls, never below its start. ▲/▼ on the map, a sentence in
     the town panel. See Findings, Growth. Watch: does a growing town read as a place
     developing, or as a treadmill of queues? And is money loose again by day 40?
   - **4c. Goods** (built 2026-10-16, the user's pick: produce + supplies, freight fares only,
     no growth link yet): farm towns (< 40k) send produce to the nearest market; Ilase, the
     port, sends supplies to every town. Goods wait at the yard and spoil; nobody else
     carries freight. Lorry tool (L): 30 t, ₦550, ₦120/day, 1.5 road space, wears a road ~2× a
     bus. Lorry routes are their own list (`world.lorryRoutes`) so no passenger system sees
     them; roadside towns count people, not tonnes. See Findings, Demand. Watch: is "which
     routes carry goods both ways" a decision you make, and do lorries crowd the buses'
     roads?
   - **4d. Rail** (built 2026-10-16, the user's pick: an inherited line plus new track,
     passenger trains): the map's colonial export line Ilase→Ipaja is straight, crosses the
     river on its own bridge, runs past Owode without stopping, and is out of service. Track
     tool (K): restore it (₦612) or lay new track (terrain-planned, ~3× a road, gradients 3×
     worse). Train tool (T): ₦2,000, ₦180/day, 80 seats, speed 8. Trains are passenger
     routes, so riders change bus ↔ train anywhere; no danfo or road traffic on the line;
     track doesn't wear yet. See Findings, Demand. Watch: restore the wrong line or build
     the right one — is that a choice you feel? Is rail a mid-game goal or out of reach?
   - **Track wear** (built 2026-10-16): track wears with trains and weather (bridges 2×),
     disused track doesn't; below 60% condition a slow order holds trains to 60% speed on
     top of the usual wear. The Fix tool keeps track up like a road, at a road's upkeep
     price per cell; kept track draws on a pale bed. A worn train route says "worn track",
     never "jammed". See Findings, Demand.
   - **Alignment** (built 2026-10-16): the Road and Track tools take `A` to switch between the
     cheapest alignment and the straight line; the preview prices both ("straight ₦852, 20%
     shorter" / "round it ₦555, 24% longer"). See Findings, Geometry. Watch: is "round or
     over" a choice you make, or always the cheap one?
   - **Goods trains + export** (built 2026-10-16; export was the user's call): markets
     export half the produce delivered to them to the port; freight trains (Freight tool,
     G: ₦2,500, ₦180/day, 150 t, speed 6) are goods routes on track, loaded like lorries,
     wearing track like a lorry wears a road. See Findings, Demand. Watch: do you build
     feeders to fill a freight train, or does it pay without them?

   **Played 2026-10-16 (to day 14), steps 2–4b at once:** *"felt stuck, didn't know how to
   get out of debt."* The screenshot: −₦404, −₦40/day; four routes of one bus each — a
   bridge to Ikole run as a Kuto–Ikole shuttle (thin, −₦74), Ado–Ogbe (thin, −₦73),
   Owode–Ado (≈0), and Ilase–Owode, the only earner (+₦80), 100% full — which said only
   "worn". Nothing maintained. Read as: debt blocks spending, so the one move that earns
   (another bus on the full trunk) was out of reach, and nothing named the exit (sell the
   thin buses). So:
   - **The way out, said outright:** in debt, or under a week from it, the routes panel
     opens with the losing routes, what selling their buses returns now and saves a day
     (`debtAdvice`; the refund quote is `resaleValue`, the sale's own computation).
   - **"full" now ranks above "worn":** a route that leaves riders behind asks for a bus
     first; ranked the other way, "worn" hid the earning move.
   - **Through-routes, pointed at** (the user's follow-up): the Ikole bridge got a Kuto
     shuttle, not the Ilase bus through Kuto the probe found worth ~4×. A thin route now
     leads with "Run it through: a bus Ilase ↔ Ikole (via Kuto) reaches ₦456/day of trips,
     against ₦76"; the debt note offers the same; the bus preview counts every trip along
     its road and draws the road it would take. See Findings, Display.
   - **Toolbar feedback** (later the same day): *"I can't see the price for train, it just
     says I can't afford it"* and *"bus and lorry are for road, freight and train for rail;
     road and rail are infra; fix and the cheapest toggle are their own thing."* So a refusal
     never hides the price — short of money, the whole preview stays (route, riders, price,
     "you have ₦…"); and the toolbar is grouped with captions: On roads (tan), On rail
     (dark), Build, Line (a Cheapest | Straight switch, not a tool), Upkeep, Time. Then
     *"the key panel covers part of the map"*: the map's bottom inset is now measured
     from the toolbar and the open key, not a fixed guess, and the key stacks above the
     toolbar when they'd collide.
   - **No ▼ for noise:** a town reads as growing or shrinking only when its target is more
     than 5% of its *starting* size away (was 2% of its current size), so a town a
     thousand or two over its start, settling back, reads as steady (`growthTrend`, one
     rule for the map's arrow and the panel's sentence).

   **Played 2026-10-19, slice zero after steps 7-8 (to day 33 and day 57; brief P1-P6):**
   *"The game is 'fun' for just a few minutes, I have played the same map over and over
   again so no joy. Plus even if it changed not much to do. Ideally we might want to have
   some story for the player to tell using the game like I wanted to connect this 2 places
   but we start with one type of road then we change it then rail then something else I
   guess. ... the money is not tight. which is good in one sense but no sense of struggle so
   its just about pointing one place to another and adding busses."* On screen at day 33:
   ₦25,644 in funds, +₦5,467 a day, no town without a road, 227 trips a day with no seat:
   the map was solved by about day 30. Three findings, none fixed yet:
   - **One map, played to exhaustion.** Nothing differs between games, so nothing is
     discovered the second time.
   - **No story.** The arc you wanted -- one corridor taken from dirt road to paved road to
     rail and beyond as it outgrows each -- has nothing to push it: demand never outruns the
     mode, and rail, wear and the straight line are switched off.
   - **No struggle.** Money never makes you wait, so every decision is "point two towns,
     add buses" (bots: M10 passes only at 14.6%).

   This playtest prompted Revision 1 of the brief (proposed 2026-10-19, brief "Revision 1:
   the corridor's story"): a corridor climbs dirt → paved → bus lane → rail as its towns
   outgrow each rung, each rung buying about 20–40 days before the next jam; the bus lane
   takes road space from the danfos and brings pushback; saving for the next rung is the
   struggle; calendar eras stay paused; then a seeded variation of this map for replay.

   **Played 2026-10-19, Revision 1's ladder (dirt → paved → lane, to day 43; P7):** *"I liked
   the building of the road multiple times. And the enforcement. I guess we need more. Did a
   strike land? I couldn't tell."* On screen at day 43: strict lanes on three corridors out of
   Ilase, ₦29,395 in funds and +₦5,909 a day (money still loose), Ilase grown 120k -> 302k,
   and "no seat" 871 against 1,792 trips made -- the lanes squeezing the danfos out, as the
   corridor probe's C3 runs found. Findings:
   - **The ladder lands:** building the same road up several times, and the enforcement
     switch, were the parts you liked. More rungs wanted (rail next, per the order).
   - **A strike you can't tell happened isn't pushback.** It lasts one game day (7.5 s at 4×),
     shown by a toast and a red road; strict lanes strike every ~12 days, so several almost
     certainly landed unseen. Pushback has to leave a mark that outlasts the day.

   **Played 2026-10-19, Revision 1's whole ladder (dirt → paved → lane → rail, to day 138,
   the authored map; P7):** rail after 100+ days, with idle waiting before it. Played for
   money: *"how much I could build to get as much money as possible."* The treasury went
   unnoticed, felt only as incidental loss. Rail's payoff was temporary: *"I already know all
   the routes"*, and unsure whether paratransit can be eliminated. Strikes let pass, or paid
   once. On screen at day 138: ₦43,657, +₦7,911 a day, the old line restored with one train,
   1,231 trips a day with no seat against 1,507 of your riders; Ado, Ise, Ilaro and Ogbe
   falling. Findings:
   - **Money is the score you see, so money is the game you play.** Trips made and town
     growth, the brief's score, sit in the strip but nothing marks them; money moves every
     second on the budget.
   - **The treasury is a rule you can't see working.** Every 10 days 80% above ₦3,000 goes,
     and it read as money leaking, not as a deadline to spend or set aside.
   - **Waiting with nothing to do isn't struggle.** Saving for rail was idle time, not a
     choice.
   - **Rail ended the story instead of starting one.** Once built, the map didn't change:
     the same routes, the same towns.
   - **The informal sector's ground isn't legible.** Whether paratransit can be pushed off a
     corridor, and what that costs, isn't something the game shows.
   - **Strikes were an expense, not a decision.** Let pass or paid once; nothing about them
     asked for a choice.

   Next, in order, each played before the next (brief, Revision 1, "After the ladder's
   playtest"): (1) the treasury visible; (2) the score as visible as money; (3) each
   corridor's informal share, and "corridor taken" as a visible state with its costs. Then,
   proposed: (4) rail reshaping the map.

   **Played 2026-10-19, R1 4-6 (built together; past day 300, map 3788):** the treasury's
   messages and the set-aside were seen ("I saw the treasury took messages"; "the treasury
   button to stash money"), and so were the town-growth messages. *"With the current state, I
   think I have played to its end."* Seeds still read as the same map ("the same map just the
   names rearranged"). On screen: rail on four or five corridors, a bus or train on nearly every
   pair, about 17 TAKEN tags (some over town names), Ipaja, Ado and Ogbe falling. Findings:
   - **R1 4 and R1 5 land as events:** a message you read is noticed where a number that moves
     wasn't.
   - **A state that's everywhere isn't a state.** With nearly every corridor taken, TAKEN is
     clutter; and taking costs ₦1-10 a day (status.md, R1 6), so it was never a decision.
   - **The slice has an end, and it's when no new problem arrives.** Past rail, nothing the map
     does asks for a move you haven't made.

   **Played 2026-10-19, R1 7 (a generated map, to day 210):** *"I think I have gotten to its
   end."* P8 by your account: *"it did feel different."* The map's story (P7, of a map rather
   than one corridor): *"Ido started as the largest but Ikire turned out to be the connecting
   hub. Ejigbo was just in its corner."* Money bound at the top rung: you waited and used "Save
   for it" for the last track. Why it ended: *"it felt like no need to wait for the money to
   build up when I had somewhat connected everywhere"*; *"nothing more to build."* How you
   played: *"connected everywhere by road and put buses, then upgraded the roads so I can get
   the money up as fast as possible."* On screen at day 210: ₦72,385, +₦21,833 a day, 5,220
   trips made (▼14, flat), 2,865 with no seat against 3,337 of your riders, rail on about eight
   lines, Erin, Ilugun and Oyan falling. Findings:
   - **Generated maps work:** a different place, and a story of its own (the hub that wasn't
     the biggest town).
   - **The end is "nothing more to build".** The map asks for a fixed amount of building;
     once it's built, nothing new is asked. Not a balance problem: money bound where it should.
   - **Still played for money**: money buys the next thing, so it stays the goal even with
     growth and trips shown.
   - **Stopping here makes it Mini Metro with money** (your read). A transport-infrastructure
     game needs a second reason to build: goods and industries (Revision 2, to draft).
   - **Upkeep should be easy to do**: per corridor, not per piece. And you asked to remove
     things: a road you no longer want, or a road replaced by rail.

   **Played 2026-10-19, Revision 2, two games past day 150** (both maps since renamed by
   region, their geography unchanged):
   - **Goods and wear off** (`?goods=off&wear=off`, map 8687, to day 224): ₦144,872 at
     +₦24,069 a day, 5,404 trips made (▲413), your riders 3,500, no seat 2,807, strikes landing.
     Every move the game suggested cost ₦500. Money is loose late by design: the treasury keeps
     taking 80% of each period's surplus, so 20% piles up.
   - **Everything on** (map 543, to day 185): *"its harder, see how long it took me to get
     here"*; *"waiting for money mostly, routes kept losing."* ₦6,315 at +₦881 a day, 900 trips
     made, your riders 181 against informal 719; most route cards red ("thin", "danfos take its
     riders, sell one"); two quarries closed, two working.
   - **Not yet a fair comparison:** different maps. 8687's largest town reached 476k, 543's
     147k, and demand grows with town sizes multiplied. Next: everything on, on map 8687.
   - *"This mini metro style is not the end please. We are looking at the core game mechanics
     at play."* Goods and industries are core to a transport-infrastructure game: playtests
     tune them, never size them away.
   - *"On goods, just saying good is not enough... when we expand it, it needs to feel real"*,
     and *"the economy can be interconnected, like refinery will need crude oil and filling
     station will need fuel"*: the brief, Revision 2, "When goods expand".
   - Asked for: town names from all over Nigeria (built, one region per map); save files of a
     run, readable by hand or by a script.

Rules for working this way:

- **Every step is played before the next starts.** Every finding that mattered came from
  playing or from measuring the failing case.
- **`scripts/slice-probe.ts` is the calibration instrument.** It runs real ticks headlessly
  and prints money, shares and per-route P&L for scripted strategies. Rerun it after any
  tuning change; record what the numbers were tuned *to* next to the numbers
  (`engine/slice/tuning.ts`).
- **Feel tests, not just mechanics tests.** `test/slice.test.ts` pins what the player should
  experience — queues settle, more buses have diminishing returns, enough of them lose
  money, a cut-off town only ever stays home.
- **A parameter enters only when it creates a player decision.**
- **Legibility before looks.** Flat and top-down until the loop holds; a richer look can
  come back over a loop that works.

The standing test is unchanged: *"does this hold up as a sandbox, and would the relevant
system survive being lifted out on its own?"* (§2).
