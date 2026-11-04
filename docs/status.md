# Status

Current state and what's next. This is what a new conversation should read first. For *how*
the code is shaped, see [architecture/index.md](architecture/index.md); for *why*, see
[principles.md](principles.md); lessons live by topic in the architecture deep-dives.
Everything older -- step-by-step measurements, bot runs, handoffs, earlier "what's next"
lists -- is in [status-archive.md](status-archive.md); a reference elsewhere to "status.md, step N" or "status.md, R1 N" from before 2026-10-19 now resolves there.

**778 tests passing** across the files (`bun test`). Typecheck / test / build /
verify:bundle all green.

## Next: a game around the simulation (2026-10-24)

After 482 days on the region (map 2418) you were disappointed and couldn't name why. An
outside designer's review named it: "a very good simulation with no game wrapped around it
yet" -- no stakes, pressure, arc or counterpart. Your answers set the direction: the
builder's story, a save you keep returning to, terms with pledges from the world's own
problems (principles §2 amended), sacking possible, the union with you or against you.
**[brief.md, Revision 5](brief.md) (agreed; its cuts table pending)** has the shape, the screen and the order;
step 1, *Waiting on you*, is built and merged (2026-10-24: the moves with a consequence pinned atop the panel, with their buttons -- the cement works' restore had been hidden under More -- and only their places marked on the map; screen.ts `waitingOnYou`); step 2, the pledge probe, built (your verdict: "the pledges are good, a good way to nudge the player"); step 3, the mandate (term grants, a verdict, replaced after two failed terms, your record, the design console), built on branch `pledges-2`. Then, all merged 2026-10-24/25: **private traffic** (private.ts: a growing town's cars fill its approaches); **the see-through site view** (seethrough.ts); **the term-start pledge card, an opening grant, Fix's whole upkeep**; **dev mode without the best-moves workers** (`?moves=1`) and lane encroachment once a tick; **a reason for each far cluster** (clusters.ts: a limestone field or a farm belt, pledges from term 2 to bring it home); the **sprite lab** (dev only; the art isn't good enough yet -- Kenney's packs, blocked on the work network, are the next try). **The union as a party** merged 2026-10-25 (union.ts: a chairman a cluster, his stance and memory, demands with deadlines, pay / ease the lane / hand him the route / refuse). **The look** (decisions log, 2026-10-25): the baked pictures dropped; a live 3D dummy (lab3d.html, branch `lab3d`) was "encouraging" -- **the watch-only 3D view** merged 2026-10-25 (view3d.ts, shapes3d.ts: a 3D button beside the zoom loads three.js on demand; the live game with relief, rivers, bridges on piers, roads coloured by traffic, towns of procedural Nigerian buildings that grow and keep clear of roads, rivers and sites, every simulated vehicle by kind; building stays on the 2D map; track drawn as track, and a town or site clicked in 3D opens its panel, 2026-10-26). **The first shock, the rains** (floods.ts, branch `shocks`, 2026-10-26): the old roads' river crossings are named fords; twice a year two flood for 20 days, named two weeks ahead with a bridge to raise at each (the one your vehicles cross first); ignored, that road crawls at 8% speed. **Crossings, straight or round, the ridge's limestone** (crossings.ts, branch `crossings`, 2026-10-26): rivers' narrows and crossings beside towns named; straight-or-round back where a river or ridge makes it a choice (A); a limestone field on the hill range between clusters. Routing by a named crossing was tried and dropped (never a real choice at today's bridge prices). **Causeways or high bridges** (branch `causeways`, 2026-10-26): a new road over water is a causeway that floods with the rains, or a high bridge for ₦1,200 a cell more (C). **Names and colours** (labels.ts, branch `names`, 2026-10-26; brief step 7, part 1): your routes take a name and a line colour (their vehicles drawn in it), your roads a name drawn along them. **3D polish and river valleys** (branch `polish3d`, 2026-10-26, from your playtest): rivers cut valleys through the hills (terrain.ts, `riverValleys`; a river had run over the range in 2D and 3D); the 3D hills drawn low (2.2 m a unit, from 7: a gentle hill had stood up as a spike); map controls in 3D (drag pans, right-drag turns, the wheel zooms to the pointer); labels shown only as near as they're readable. Then the land between the towns (your word: "it all looks sparse"): savanna in patches, greener by the rivers, red earth in the towns; fields round every town, some in rows, more round farm towns and in farm belts; trees -- acacias on the open plain, a gallery forest along the rivers, bush on the hills, palms by water and in towns -- each kind one instanced draw, cleared where you build a road. Then the rest: towns with a fabric (houses packed on a street grid, densest in the middle, walls and roofs drawn as instances, two draws a town); kiosks along the roads just outside towns and a filling station on each road out of a 30k town; a warmer, lower sun and haze that follows the zoom; and the map as a diorama -- the land ends in a cut edge showing its strata, the sea cut with it (your word: "good visuals for the cliff off"); the water no longer takes shadows (it had streaked: "the water glitching"). Then your own work in 3D: dirt roads in laterite, paved ones in asphalt with a centre line, bus lanes as red bands, traffic tinting each; a motor park, a haulage yard, a rail station where the track stops, metro entrances, each beside its town; your buses, minibuses, BRT and trains in their route's colour (labels.ts), else their kind's. Then shocks. **Truck convoys: tried and dropped** (2026-10-26): on the day-83 save, hauliers' trucks are 296 of 445 vehicles and about 30% of a tick (1.96 ms against 1.39 without them); sending long hauls as convoys (a truck a 40 cells, up to 5) cut them only to 205, held 23% more tonnes on the road waiting, and delivered 28% less a day (fares -7%). Not worth ~0.4 ms a tick: they run as single trucks.
The region's map rework and a 45% faster tick (same results) are merged into `main` (2026-10-24).
**From an outside review of seed 7585** (2026-10-26, brief Revision 5, Built so far): pledges name
their move and price; a fuel pledge only where a town is really short and a source can reach it
(the reviewer's fuel pledge kept itself); the map's modes clearer; selection in 3D lights its
connections; 3D's look (a filmic grade, haze, trees in groves) and its state (fuel sellers, dust,
a growing town's market); your buses go round a flooded ford by a dry road you built
(`floodDetour`). **A steadier screen** (2026-10-28, from your "some buttons are not clickable"):
3D and the 2D map without their stutter, the panel redrawn in place (`patch.ts`), fuel, food and
sites shown as two-day averages (`steady.ts`; render-and-ui.md, The screen); the styles out of
`index.html` into `src/game/styles/`, one set of tokens the map reads too. **The map's
generation** (2026-10-28, behind `mapVersion`, so saved runs replay as played): rivers that wind
and an old railway over the land (2), the port's sites outside the city on one side (3), the land
beyond the home cluster drawn by region with a coast of estuary and bays (4), a southern map's
sea along its south (5), and 3D in the region's colours (engine.md, The region). **The gateways**
(brief, The region, agreed 2026-10-28): step 1, the seaport, built -- imports land there and 60-100%
reach the home city by its link (gateways.ts); step 2, one border crossing a map, cash crops out
whichever way nets more (border.ts); step 3, the north landlocked, its sea trade by the coast road
(map version 6). Then the port's two rungs (a berth, a container terminal) and fuel over the
Benin and Niger crossings (2026-10-29). Then, from your map 949 playtest ("I even connect them by road but they don't get there"): **goods get there over connected roads** (haulage.ts; brief, The gateways, 4) -- cement, steel and fuel go in legs town to town, a yard stretching a town's legs to 120 cells, off a freight train onward by road; served read over 10 days; part loads after a week; steel imported from today's towns on a map without a works; the cards name the real blocker (no road, the gap a yard at a named town bridges, too many legs, the port). Replayed to day 241: cement 65-100% in every town (17 of 26 had none), steel 39-77%, people grown 138k -> 157k, trips made 2,354 -> 2,191, ~50 more trucks (engine.md, Goods relayed town to town). Shown: the Goods overlay draws them by their legs, a town's card says what's on the way and where it waits, and the Yard tool names the towns a yard would bring them to (render-and-ui.md §7). Then the cards' buttons frame and ring the places they name on the map; names that don't pile up (the town picked in the panel always named, sites' and closed sites' only where they fit); the pager as "12 of 44"; No seat opening its overlay; how long a waiting item has stood. Then the brief's Revision 5 step 4, rebuilt around the correspondent (agreed, not built), and **stations on the old line** (stations.ts, built 2026-10-30): inherited at a town, out of one ("Ede Road") or where the town has gone, restored a run at a time, reached by a feeder or a halt, growing a town where riders change (engine.md, Stations on the old line). Then **the correspondent** (src/game/correspondent.ts, built 2026-10-30): the Permanent Secretary's day-1 handover note and a letter heading each term's verdict, read from the seed and the term records, C32 a test over every template; and then and now beside the letter -- day 1's network faint under today's, the letter's towns pinned (render-and-ui.md §7). Revision 5's step 4 is built. Then **the look** (docs/architecture/look.md, agreed 2026-10-30), in its order: the palette (ink-and-cream chrome, the river the dark anchor), the Board layout (controls left, the panel right with the pledges, the toolbar docked, nothing over the plate, three stats), four control roles with keys in `<kbd>` and the type, spacing and radius tokens, `bun run verify` with its four checks (no literals anywhere in src/game), and the 3D view on the same tokens with its five steps. The labs were discarded. Then **the corridor** (look.md §6a-6b): width the rung, colour congestion on a four-stop ramp with headroom, the centreline core your service -- the yellow and brown bands beside the road gone (they read as two lanes); mitred offsets, junction plates, casings and bodies in passes by rung; a road you build pulled taut (`tautRoads`). Then from the Shallot assessment (brief, decisions log): a determinism test across frame budgets, `.lab.ts` and `scripts/lab/`, `#plate-overlay` with a fifth look check, and `gym/` with C14 first. Then map density (look.md §6c) and **the assembly plant** (assembly.ts, brief: Chains: convergent): the first two-input site, steel and fuel into cheaper buses and minibuses; then a site's recipe card and chain strip (render-and-ui.md §7); then **room for them**, map version 7 (engine.md): the far clusters spread over the frame by the land each reaches, land far from any town 47% -> 38% on 24 seeds, the tick unchanged, the frame kept at 250 × 160. Your map 3218 day-433 run doesn't replay exactly, even on its own commit: the screen's reads between ticks filled a once-a-tick cache the next tick then used (gateways.ts), so a live game parted from its replay (₦1 on day 40). Fixed (`epoch.ts`, engine.md, runlog): games played from now replay as played; that file's replays still aren't evidence of what you played. Later: coastal shipping and river barges. Next: the gateways (brief, The region, step 3) -- to discuss. **Open for you:**
morphdom in place of `patch.ts`, or a lit-html spike on one panel. **3D fidelity and map generation** (scoped 2026-10-30: the stylised diorama improved; fictional but
Nigerian; the home cluster left as it plays for now, its land redrawn under its towns later): B1 no
ghost buildings under the slab, savanna with grain at every scale; A1-A2 **map version 8, the land
first** -- a relief shaped by the water beyond the home box, tributaries narrow at the source and
meeting their river at a slant (engine.md, The region); B2-B3 the relief drawn taller with granite
where it's steep, and each region its own trees (look.md §8). After your look ("the plateau shows a bit",
"rivers are not good yet", "on some level this is amazing"): mouths in their river's water, streams
rising in headwater hills, sharp bends eased, the plateau higher and clear of the water. A5 **map
version 9, fictional names** by the region's sounds (names.ts). **Map version 10, the home cluster's
land** at a share its trunk's prices allow (roads between home towns ~16% dearer where the land rises).
**Version 11, old roads by the land** (planned again over the
relief, their corners eased); **version 12, hamlets** between the towns (drawn, not simulated); towns
ribboning out along their roads in 3D. **Weather in 3D** (B5): cloud shadows, the north's harmattan
haze, rain over a flooded ford; the clouds themselves from afar; inselbergs; made-up names for the border and
coast road; hamlets on the 2D map; **map version 13**, lakes (water) and swamps, dry beds and dunes
(scenery); vehicles and buildings in detail; and the land running on past the map's edge into haze
(look.md §8). Your frame-time check: "not much stutter". Then, in your order (2026-11-01; render-and-ui.md,
The map layer and The start): **sites at work in 3D** (smoke, steam, dust, a refinery's flare, pump
jacks, each as hard as the site runs; the seaport's harbour, growing with the port); **people** (riders
at your stops by who's waiting, passengers and touts at your motor parks, shoppers at the markets);
**the site see-through redrawn** (of three tried, you liked flow bands and the process column: both
together); **the arrival as one movement** (the loading card lifting away, the letter, pledges and
verdict as a card over the dimmed map); and **saved games** (it saves itself; the loading card offers
your games; engine.md, snapshot.ts). The remit in 3D is next. **The remit opens** (remit.ts, brief, Chains: convergent, built 2026-11-01): you start with the home cluster's land, a kept term's verdict opens one of the two nearest closed clusters (your choice, in Waiting on you), closed land veiled on the map; pledges made keepable (the worst seat pair cut by a third; a pledge with no move in your remit not offered). Measured to day 400 on three maps against an all-open twin: terms kept 7 of 9, 2-3 clusters opened, C35 (something built in a newly opened cluster the day it opens) and C36 (net -9% to +27%, people within 5%) hold, once the strategist chose only among places its remit allowed (engine.md, Your remit). **Dev tools** (brief, Dev tools: the console and the what-if, agreed 2026-11-02): step 1, the console drawer, built -- the `` ` `` key with `?dev=1`: end the term, rains, pledges now, a cluster opened now, money, any tuning number live, and Inspect on the panel's pick, every move in the run file (render-and-ui.md, The design console's drawer); step 2, fork from day N, built (a new save cut at that day's start, replayed to there, the original kept); step 3, the what-if's engine and its table, built (whatif.ts in a worker: a number or the last previewed move, without and with, 1-30 days on; the run without kept, so a second question costs half). step 4, the map graph, built (an answer's trips or goods over the live map, green grew, red shrank, a picked town's links in the drawer). step 5, the systems graph, built (the model's chain, a change lighting what it enters and what that feeds, each node without and with; D5 holds the hand-kept table to the tuning). The dev tools' order is done; and `?dev=1` no longer forecasts every previewed move or runs a receipt's shadow world after every move unless the drawer's switch is on (D1). **Open for you:** the term-1 grant against the ₦45-80k restores (brief, same place). **Your playtest of map 2327, 2026-11-02**, answered: **rail room by passes a day**, not
trains a piece -- a train bound far costs a shared stretch little (`trackPassesPerDay`, rail.ts);
**carriages and wagons**, up to four cars a train, more seats or tonnes without more room
(`addCar`); **far limestone tails off** instead of stopping dead past the hauliers' reach
(`longHaulTail`; one game per setting moves trips 6-8% by chance, so its measured cost was
noise). **A phone at day 200 drew 3 frames a second at 4x:** the game now steps within 10 ms a
frame and the time controls say the speed it manages (architecture/index.md, The tick loop).
**Coal and power** (brief, A chain at each opening, first) is built and **off** (`coalEnabled`):
measured, power wasn't felt and no line reached the coal. **Reworked, not yet committed:** the mine
45-76 cells from the station (₦271-493k of track), coal bulk (hauliers 40 cells, a yard or not),
+40%, and a freight line you can save for; being measured on five maps to day 300. Diagrams now in
the docs: the frame and the step (architecture/index.md); the chains, hauliers' reach, a line's
room, the remit opening, coal and power (engine.md). Coal's rework was committed off: C38 held,
C37 didn't -- and the reason was bigger than coal: **towns barely grew** (median 0% past their start
at day 287; cement and steel held back 2% of people). **Towns now grow where you serve them**
(brief, same name; `growthServiceFloor` 0.15, `growthServiceFull` 0.55): served towns +24 to +55%
by day 300, people +8 to +21%. **Your playtest of map 8703 to day 482** ("the most fun in a
while"; people 730k -> 1.71M): late on, hard to know what to connect, and shrinking towns hard to
fix though you did what the cards said. Answered (brief, The advice that didn't work): the cement
works sat at capacity from day 280 and the card said carry, not expand; your cement trains ran a
fifth full because hauliers from your yards took the cement first (`freightFirst`: now your
line's goods are yours); a shrinking town said "short of cement" while your share of its trips
fell -- now it says why it's shrinking first. **Open for you:** play it; then step 2 (goods decide
how much of that room gets built), then cotton. **Where next** (brief, same name) built after it:
a pane under the pledges ranking the four towns with the most people to gain, what's in the way,
and the move -- C41 holds on two of four on map 8703. **Cotton and the textile mill** (brief, same
name; textile.ts) built after it: an idle mill at home on every map, cotton from a northern map's far
farm towns or over the border, cloth to the markets (trade) and the rest exported, the biggest
employer. C42 mostly holds on five maps, C43 fails (the strategist builds no cotton line). **Open for
you:** play it; then the south's oil palms and palm-oil mill. **Your map 5059 playtest** (2026-11-04, day 653,
1.34M people): the airport's card said "can't get to or from it" over 18 vehicles on seven lines to
it -- now it says why they're not carried and names the move that pays (problems.ts `airportAdvice`;
engine.md, The airport). Replaced on day 361 and nothing changed: parked as story or sandbox at the
start (brief, Ideas parked). **Your bus station** agreed (brief, same name): people change there,
the depot, the board of its lines; measured on your replay, 9% of those who give up do so at a
change, 40% of changers at Odun; on three more saved games 4-19%, about half of changers lost at two to four hub towns. **Built** (busstations.ts; engine.md and render-and-ui.md, Your bus station): the Station tool (S), changing riders 3x as patient, the depot half the rough roads' cost, the board on the town's card with Sell, Waiting on you naming the worst hubs. On your replay a station at Odun paid back in 27 days, at Ofabo (nobody changing) never. Next: the strategist's stations (C44, C45), then your playtest (C46).

**The info layer, first pass** (2026-11-02, merged 2026-11-03; render-and-ui.md, Held still while
you aim and The network): from your "to click on some things are difficult ... between tick the
information is changing" -- the presentation, not the engine: lists re-sorted four times a second,
Waiting on you's lines came and went, nothing held still under the pointer. Now it does, measured
(96-100% of aims land, from 76-88%). And everything you run is one kind of line on one kind of way:
the Network tab (each road or stretch of track with its lines; lorries and freight trains with
cards of their own; the corridors folded into the roads' rows and cards), and the revenue screen as
a flow, a statement whose net is the strip's, and every line's money. **Opening polish** (2026-11-03,
brief, Information design): the first hint opens Demand before explaining it, Towns opens largest
first, the strip labels the not-yet-available 10-day comparison, and Revenue explains its early
empty charts while surfacing chain state. Next there: the restore lines
that still come and go at a day's turn (their shortages' lines want a band), and the train card's
cars once the other session's carriages land.

**Layers, 3D you can click, stations, and the first of five modes** (2026-11-03; branches
`layers` → `stations` → `pipeline`, merged 2026-11-04). Roads and rail apart in both views, the
scenery off in 3D, the overlays as arcs in 3D, and a click on anything in 3D opens its card
(render-and-ui.md, Layers; Click anything in 3D). Each rail town's station laid out from the network
-- a platform track a line, the throats fanning in -- so a hub's trains stand side by side, each
drawn with its cars (render-and-ui.md, Stations and trains). And your scope of five modes
([five-modes.md](five-modes.md)): **the pipeline built** (engine.md, Pipelines) -- refined fuel from
the tank farm or a refinery to a town, its dial what share goes by pipe, the union following the
tonnes, the tankers drifting off its corridor and slow to return when a strike or a tap stops it;
an inherited line broken up the old railway. **The airport built** (engine.md, The airport): there
on day 1 on a long dirt road, a few hundred travellers a day each way stranded until you reach it,
8-10 t of air freight a day by hauliers or your freight train. Next: the coach, the okada rule and
the urban ladder wait on `SCALES-AND-MODES.md`; water last. The strategist taught both (engine.md,
the scope's checks measured): the fuel chain keeps deciding after a pipe on 4 of 5 maps, but the
union's price is mild when you can pay; the airport is served on day 1-2 everywhere, so its check
("rather than always") is open -- a capital decision only if reaching it costs more than a bus.

**Bus parks, roundabouts, the airport to scale** (2026-11-04; branch `terminus`; your look on map 5059
day 654: the airport's scale, and the buses "reaching and turning back ... just looks weird"). Where a
road route of yours ends at a town, a bus park beside its heart, laid out the way a station is -- its
lane in from the junction, a drive round an island under a canopy, a bay a route with its riders --
and its buses come off the road to their bay and back out; a roundabout where three roads or more
meet, its traffic going round it; the airport a field to scale, an airliner twice a bus, its runway
whole, its own bus park before the terminal (render-and-ui.md, Bus parks and roundabouts). Drawn
only: the engine's buses still turn at the town's point.

Deployed: the `Dockerfile` builds the game for the Coolify VPS (architecture/index.md §Deploy),
live at transport-game.otagera.xyz.

## The carry-over (2026-10-23)

**The slice is the game.** On your answers: the original 3D game -- its three.js renderer,
six-homes UI, dev studio, content schemas, calendar eras, save/scenarios and their tests --
is retired from the build and the tree, kept whole under the git tag `original-3d`; the code
is renamed from "slice" to "game" (`src/engine/game`, `src/game`, `index.html`, `GameWorld`,
`gameTick`, `scripts/game-*.ts`, the `GAME_TUNING` override); `main` is the working branch
again. Saved runs and your saved preferences keep their old names inside, so both still work.
The engine's foundation (map, pathing, simulation, economy, paratransit) stays.

**Next: play the information design** (brief, the carry-over plan; settled in the information
lab, `/info-lab.html`). Built 2026-10-23 on branch `map-layer`, all three layers at once (the
user: "go fully into the new lab design; if I play and miss something I will call it out"),
**not yet played**:

1. **The map at a glance** (render-and-ui.md §7, the map layer): roads by traffic and how
   full (grey, orange, red), your service and your vehicles' fill, the other side's vehicles
   as bands with individuals on top when there's room, focus, zoom and pan, problem marks.
2. **The screen** (render-and-ui.md §7, the screen): the lab's strip with ten-day trends,
   the log on the left, the side panel on the right (lists that sort; one layout for a town,
   route, site or road with its problem line and a real move), the revenue screen. The old
   wings and Treasury drawer are gone; their cards live whole under each panel's "More".

**The region** (brief, The region): step 2, the generator, built 2026-10-23 on branch
`region`, **not yet played** (engine.md, The region): new games are drawn on a 250 × 160
region -- the seed's slice map as the home cluster, three more clusters, a coast with the
port, more rivers, a range, old highways and railway between clusters -- and the camera
starts on the home cluster. **Reworked 2026-10-23 on branch `region-map`** (the user: "look
at the state of this"; engine.md, The region): the chains placed in the home cluster (an
oilfield had sat in the far corner), an inland home city a dry port, water that drains (a
wandering coast, a big river to the sea, the home river joining it, tributaries), a hill range,
highways laid over the land, clusters spread apart; on the screen, smooth water, hills in
relief with contours, labels that don't overlap. Next: the gateways (step 3: the port and border crossings,
imports and exports through them), then the strategist on regions (step 4). Speed: a tick
costs ~5.4x the slice map's and the warm-up holds the page ~9 s -- with the optimisation
work.

**More chains** (brief, More industries, more chains): **steel** built 2026-10-23 on branch
`region`, not yet played or measured (engine.md, The steel chain) -- an idle works and its far
mine on Middle Belt and South-South maps, a steel terminal by every port, steel gating towns
past +80%. Next: measure C22/C24 with the strategist, then palm oil and cocoa. The icons
(render-and-ui.md §7, Icons) are in the game.

Then the open items for the full game (brief, the carry-over plan): roads with junctions,
money late in the game, eras as vehicle generations, sea and river freight.

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
| C14 no dead stretch (days 60–150) | Passes in play (longest 13 days, map 2411); **fails after ~day 200** (stretches up to 32 days, ₦100–340k idle) -- site expansion is the first answer, in your playtest now. **The gym (2026-10-30, `bun run gym C14`, the strategist to day 300):** fails on all three maps in days 60-150 too -- 24 days (map 0), 86 (543), 32 (2411); after 150, 40, 151 and 8. The strategist, not a player: an 86-day stretch is likelier the bot stuck than nothing to do, and that is the next thing to find out |
| C15 it feels like this place | Yours to answer |

**Revision 4, the late game** (brief): steps 1-3 merged 2026-10-21 -- no player lorries, haulage
yards (Y; a yard at the crude source lets hauliers truck crude), towns expecting service (the
town card's Service line), the budget-year sweep as a trial (the Treasury's countdown). The
strategist on maps 0 and 2411: money held peaks ₦139-175k (was ₦305k), the sweep took
₦85-196k, the bot already meets the expectations; late-game stretches with nothing built
remain -- steps 4-6 (a second refinery, motor parks, a metro) are for that. `scripts/game-play.ts`
plays the game from a terminal for an OpenCode player.

**Revision 4, step 4, the second refinery** (merged 2026-10-21): a private refinery opens once,
on a seeded day 90-120, by the port and far from the crude, working but with no road
(`fuel.ts` `updateNewRefinery`; a toast that pauses the game once). It wants crude from the
same source, fills what imports and the old refinery leave short, and sends the rest to the
port. Strategist: maps 0 and 2411 lay rail for its crude, goods 5-12% of income where it was 0.
It makes only 23-46% of its capacity with crude arriving (probably its workers; unchecked).

**2026-10-23, on branch `r4-next` (not merged):**
- **Exports paid once** (`exportsPaidOnce`): since `a4eeb21`, `payExports` paid cash-crop
  exports into funds and `tick.ts` paid them again through the allocation.
- **The sweep off** (`sweepEnabled: false`, kept behind its switch): C17 failed in your
  2026-10-21 playtest -- it took money saved for rail. Without it money piles up again late
  (the strategist holds ₦122k-995k by day 250): C16 fails, as it did before the trial.
- **Growth reads service between towns, not commutes to sites** (`growthIgnoresCommutes`):
  map 543's collapse after the second refinery was Opobo's share falling 43% -> 28% the day it
  opened -- its 3,000 jobs' commutes, with no road, all counted as unserved -- and Opobo shrank
  155k -> 112k. Day 250, fix off -> on: people 806k -> 840k (map 0), 326k -> 339k (543), 457k ->
  518k (2411). 543 still trails the same branch without the second refinery (397k, 882 trips):
  open.
- **Step 5, motor parks** (`parks.ts`; the Park tool, O): a park at a town lets its danfos
  load off the road -- roads touching it carry 25% more before they jam -- and the agberos keep
  15% of its levy, not half. Strategist (a park where a big town's roads jam), day 250, off ->
  on: map 2411 people 518k -> 752k, trips 1,100 -> 2,232, net ₦6.0k -> ₦10.6k; 543 339k ->
  353k; map 0 840k -> 798k (it built 3 lanes instead of 5: clearer roads for the danfos too).
  **The levy part is negligible:** all park levies come to ₦130-300 a day against a net of
  ₦2-13k, so a ₦20k park pays only through clearer roads. Yours: whether levies should matter.
- **Step 6, a metro** (`metro.ts`; on the town card of a town of 200k+): a line at a time
  (₦150k, then ₦100k, three at most), each carrying 15% of the town's inside trips -- the
  kekes' and okadas' until now -- at ₦3 a rider, ₦300 a line a day to run, and lifting the
  town's growth limit by a tenth of its start. (First cut capped the metro at 35% of inside
  trips: a second line carried nobody in a town under ~430k.) Strategist, day 250, off -> on:
  map 0 (Ilase, 3 lines) net ₦12.2k -> ₦18.9k a day, people 798k -> 891k, trips 3,129 -> 3,798;
  map 2411 (Gusau, 2 lines) ₦10.6k -> ₦12.0k, money held ₦256k -> ₦18k; 543 has no town big
  enough. Metro riders stay out of the trips-made headline.
- **From the OpenCode playtest of 2026-10-23** (map 543 to day 151): the second refinery
  noticed at once and a top earner; Opobo grew 108k -> 212k (no collapse with growth between
  towns). Fixed since: a park now says what it's doing (its card: the roads into it, its levy
  yours and the agberos'); pave and lane refusals name the roads to work on instead of "no
  road joins them"; the BRT preview and the lane's toast say when a corridor is too thin for
  an 80-seat bus (under 240 riders a day along it); a cement shortage names where the chain
  breaks (works idle, no quarry working and when the next opens, a quarry not connected, or
  cement not reaching the town).
- **Freight rates** (`freightrates.ts`, branch `r5-freight`; the freight line's card, or
  `{"kind":"freightRate"}`): each freight line cheap, standard or dear -- 0.6x, 1x or 1.6x the
  goods fare; against a dear line hauliers load faster and reach 1.5x as far for its goods,
  against a cheap one two-thirds. Strategist, every line at one rate, maps 0 / 2411 at day 250,
  cheap -> standard -> dear: your trains carry 92 -> 71 -> 45 / 109 -> 86 -> 56 t a day along the
  line, hauliers 228 -> 281 -> 328 / 232 -> 283 -> 337; goods income ₦90k -> ₦115k -> ₦122k /
  ₦41k -> ₦54k -> ₦60k all game; spoiling 21 -> 14 -> 10 / 20 -> 14 -> 10 t a day; trucks on the
  road ~240-260 at every rate; trips made 3,717 -> 3,798 -> 3,636 / 2,212 -> 2,324 -> 2,204. The
  trade-off is there but mild: dear earns 6-11% more from goods for 2-5% fewer trips. Hauliers
  carry most of a line's goods at any rate (its short hauls are theirs).
- **C11 (amended) passes:** by day 150 the chains unlock 79% of the original towns' growth
  on map 0 (357k of 450k), 61% on 543 (47k of 77k), 71% on 2411 (54k of 75k), against the 20%
  wanted (strategist; each town's target with cement and food as delivered, against a copy
  with none delivered). Read with care: cement gates growth past a town's first 40%, so much
  of what it "unlocks" is growth it would otherwise hold back -- a gate, not only a gift.
- **Revision 4 is built.** Before the slice closes (brief, Open question 8): the goods /
  passengers balance -- goods were 45-60% of income with your lorries, ~2-12% now -- and the
  carry-over plan.

**Before that:** your playtest of expansion, exports at ₦20, the look.
In a worktree meanwhile: **the strategist** (`scripts/game-strategist.ts`), a long-game bot
that plays the ladder and the chains from the game's own advice and measures C2, C11 and C14
on several maps -- the bots in `game-bots.ts` predate rail and the chains. **Then the
goods/passengers balance** (a decision for you). **Then the slice closes:** the carry-over plan
(brief, Open question 8).

## How to run it

- Play: `bun run dev`, open `/` (the game). `?seed=N` picks a
  map (0 is the hand-made one); `?dev=1` shows forecasts, receipts and best next moves;
  `?dev=1&funds=N` starts with money, for checks.
- Bots and the brief's checks: `bun scripts/game-bots.ts` (`BOTS=...`, `CHECKS=0`, `SEED=n`,
  `BOTS_WORKERS=2` by default; 6 only on a machine that can take it).
- One corridor up the ladder: `bun scripts/corridor-probe.ts [days]` (`SEED=n`,
  `REAL_MONEY=1`, `BRT=1`, `LAX=1`, ...).
- A played game: "Save run" (beside "New map") downloads it; `bun scripts/game-run.ts run.json`
  prints the timeline, what you did, what the game announced and the last day (`--day N` for
  one day in full, `--verify` replays it and checks it reproduces). `?goods=off` and
  `?wear=off` switch those systems off.
- Calibrate: `bun scripts/game-probe.ts [days]`, with `GAME_TUNING='{"fare":5}'` to try
  overrides.
- Deploy: the `Dockerfile` builds the game for the Coolify VPS (served by nginx);
  [architecture/index.md](architecture/index.md) §Deploy.
- Detail: [architecture/engine.md](architecture/engine.md) §slice/,
  [architecture/render-and-ui.md](architecture/render-and-ui.md) §7.

## What was built for the original 3D game (Modules 0–12; retired 2026-10-23, tag `original-3d`)

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
