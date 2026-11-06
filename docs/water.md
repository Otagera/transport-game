# Water: the scope (proposed 2026-11-06)

Rescopes [five-modes.md](five-modes.md) §5 after a probe of today's maps
(`scripts/water-probe.ts`). Water is the last mode on the list, and not delegated: it touches the
map generator and pathing, the two places `principles.md` §3 says cost most to relearn.

**What water is** (agreed in conversation, 2026-11-06): the river and the coast become something
that carries, as well as something that costs.

- **Passenger boats** -- water buses and ferries, a line between two jetties, as a bus line runs.
- **Cargo boats** -- barges, goods between jetties, as a freight train carries them: slow, big,
  cheap a tonne.
- **Fishing, and trades like it** -- places on the water that make something: fish for the
  markets first; sand from a riverbed or timber floated down, later perhaps.
- **The crossing as a choice of kind** -- a causeway or an old ford lies on the water, and no boat
  passes it; a high bridge lets them through. Raising a ford pays twice (no flood, and the river
  open); a cheap causeway across a river your boats use cuts your own line. Perhaps a third kind,
  a low bridge with one raised span, for small boats only -- decided once we see how often it
  would matter.
- **The rains** close the fords and raise the river: the same season helps one network and hurts
  the other. **No dredging**: a reach's width stands for its depth and caps the boat it takes.

## What the probe found: today's maps give water nothing to carry

Day 1, five maps, a boat needing 2.5+ cells of river, a jetty within 7 cells of a town:

| map | towns within 7 cells of water | river 2.5+ wide | goods a day between waterside places | people a day between waterside towns | seaport to the water |
|---|---|---|---|---|---|
| 8703 | 3 of 27 | 94 cells | 282 t of 2,444 (12%), short hops at Otido | 91 | 9 cells; not joined to home by water |
| 2418 | 4 of 24 | 308 | 65 of 2,854 (2%) | 21 | landlocked (its gateway 50 cells off) |
| 949 | 5 of 27 | 110 | 0 | 0 | the home city, 7 cells |
| 3218 | 4 of 27 | 101 | 0 | 0 | 9 cells; not joined |
| 7585 | 5 of 27 | 237 | 0 | 5 | 9 cells; not joined |

- **The generator keeps towns off the water** (`nodes.ts`: 3 cells from water; a drawn river that
  brings water within 2 of a town is drawn again). The nearest town on any map is 3-5 cells off;
  most are 15-60. Right while water was only a cost; backwards for boats -- the river is where the
  towns of a real region stand (Lokoja, Onitsha, Makurdi, Ajaokuta).
- **The seaport isn't on the sea**: 7-9 cells inland on every coast map.
- **The goods run where the rivers don't**: limestone to the cement works (300 t a day a field),
  fuel from the tank farm, food to the markets. What crosses between waterside places is a few
  short hops.
- **The water is in pieces where it matters**: the rivers near towns are narrow, so at a boat's
  width the home city, the seaport and the far clusters aren't joined by water on any map where
  they're apart (949, whose home city is its seaport, reaches one far hub, 149 cells by water).
- **Opening a river is cheap**: 3-9 fords a map, all on rivers; raising those in the way of the
  few routes there are, ₦4-15k.

So water starts with the map. Jetties and boats on today's maps would have almost nothing to
carry, however they were tuned.

## Step 1: the map (map version 14)

**The rule: add places on the water; move nothing that's there.** Every town, road and site of
version 13 stays where it is -- the home cluster above all, the slice map exactly (C21: the
ladder's prices on its trunk are as measured). Version 14 is drawn after the map, from a stream of
its own, as every version since 2 has been; runs played before it replay their own maps.

1. **River towns.** Three to six new towns (8-30k) on the banks of the big river and the coast,
   between the clusters -- each 1-2 cells from the water's edge (the dry rule eased for them
   alone: their footprint on land, their waterfront on the water), 15 from any town, each joined
   to the network by an old road (a spur, as the generator lays them). They make the river a line
   of places that trade along it, and add demand, so they're measured (C14, C16) as any change to
   the towns is.
2. **Waterfronts.** Every town within ~10 cells of water a boat can use gets a landing on its
   nearest bank -- a place, not yet a jetty (step 2 builds those), joined to the town by an old
   track. A town 6 cells off the river can reach the water without the town moving.
3. **The harbour.** On a coast map, the seaport's waterfront is its harbour: a site on the shore,
   joined by road, where imports land and exports leave. The seaport stays the town it is.
4. **A river a boat can use.** The big river widened through its lower course (3.5+ cells: big
   boats), its upper course and the home river 2.5+ (small boats), the tributaries canoe water; a
   delta's creeks and a lagoon's channel small-boat water. Widened only where it stays clear of
   towns and roads (as version 4's features), and every road crossing it re-measured -- a wider
   river is a dearer bridge and a longer ford.
5. **A way from the sea to home** (coast maps). The big river, or the coast and an estuary, joins
   the harbour to a waterfront in or beside the home cluster at boat width -- so the imports the
   seaport lands 99-222 cells off (41 of 60 maps) can come by water. On a landlocked map (north,
   north-east, Middle Belt) the river is a trade route between the clusters, not to the sea.
6. **Fishing grounds.** Landings where the fish are: along the coast, in a lagoon or the delta's
   creeks, on the lakes (version 13), on the big river. Small places (a fishing village, a few
   thousand people) that make fish -- step 4 gives it its chain.

**On screen** (render-and-ui.md): river towns and waterfronts drawn as places; the harbour a site
with its own mark; each reach's boat class readable where the river is (width already shows it).
`scripts/region-sheet.ts` draws twelve seeds of version 14 beside version 13, to judge by eye
before anything is played.

**Checks** (`scripts/water-probe.ts` rerun on version 14, same five maps and twelve more):

- 6+ waterside places a map (towns, waterfronts, the harbour), and on a coast map the harbour
  joined to the home cluster by water at boat width;
- the goods that could go by water: a real share of the tonnes (to be set from the first sheet --
  15% is a first guess), not only short hops;
- the people between waterside places: more than today's 0-5%;
- version 13's towns, roads and sites unchanged (a test, as for every version); every town still
  reachable by road; the generator's time per map within its budget.

## The first two tests (2026-11-06; map versions 14 and 15, opt-in, new games still on 13)

The probe with a waterfront for any town within 10 cells of the water, a boat needing 2.5+ cells,
counting only goods and people where the water is at most 1.5x the road:

| map | goods by water: 13 / 14 / 15 | people between waterside towns: 13 / 14 / 15 | the seaport joined to home by water (15) |
|---|---|---|---|
| 8703 | 12% / 12% / 16% | 5% / 7% / 11% | yes, but 392 cells by water against 130 by road |
| 2418 | 2% / 3% / 28% | 1% / 5% / 14% | landlocked; two far hubs joined (137, 253 cells) |
| 949 | 0% / 4% / 5% | 1% / 3% / 4% | the home city is the seaport |
| 3218 | 2% / 2% / 2% | 1% / 5% / 6% | yes, but 484 cells by water |
| 7585 | 0% / 4% / 5% | 0% / 7% / 6% | no: the home city is 18 cells off the water |

- **Version 14, places added** (river towns about 20 cells from the nearest town, fishing villages,
  the big river widened beyond the home box; nothing moved -- tested on five maps): water goes
  from almost nothing to a little. The new pairs are small (5-36 people a day); the heavy goods
  never touch the water.
- **Version 15, the home cluster's rivers widened too** (a break with C21: its fords widen --
  spans 1-2.5 cells to 3-4.5 on four maps, one new ford on 2418, raising them all ₦1-16k to
  ₦4-26k; paving unchanged): water matters on a map whose home towns share a river (2418: 28% of
  the goods, Bewa-Ukpola 137 people a day, 32 cells by water against 25 by road) and stays thin
  elsewhere (2-6%). Where the seaport is joined to home at all, the water runs 3x the road.

So geography decides, map by map: water is worth having where the home cluster's towns sit on a
river that runs on to the clusters or the sea, and the generator draws that by accident. The next
step is the generator itself -- maps drawn with water in them from the start (a river city, towns
along a navigable river, a harbour where it meets the sea) -- which also answers your sense that
the maps' water all looks alike (2026-11-06). Agreed: see Step 1, redrawn, below.

## Step 1, redrawn: water first (agreed 2026-11-06)

**What you saw:** "the shape of the water was the same" on every seed. A sheet of twelve seeds of
version 13 shows why: nearly every map has one frame -- the sea along one edge, a river down each
side, one big river straight across the middle through or beside the home box, a small lake or two
-- and ten of the twelve draw the south-west. Two reasons, both yours: the generator draws a fixed,
Nigeria-shaped skeleton (`region.ts` `drawCoast`, `drawMainRiver`: the sea on one edge, the big river
across to it above or below the home box, the home river joined to it, a tributary or two; version
4's regions dress it, never redraw it); and every version since 2 adds to the last and moves
nothing, so the skeleton was never redrawn -- which also kept the checks' old numbers comparable.

**What changes** (a new map version, its own path in the generator; versions 1-15 kept as they are,
so every run replays the map it was played on):

1. **The water is drawn first, by region, varied by seed** -- each region a character of Nigeria's,
   not one layout:
   - **south-west:** a coast with a lagoon behind it and creeks, rivers running down to the lagoon;
   - **south-south:** a delta fanning into the sea from a head inland, its arms joined by creeks;
   - **south-east:** one big river the map's length to an estuary, tributaries joining it;
   - **Middle Belt:** two big rivers meeting in a Y and running on as one (Lokoja); no sea;
   - **north:** a dry plain, a lake basin (Lake Chad) fed by a river or two; no sea.
   The whole turned and mirrored by the seed: the sea on any side or none (rarely the top -- or
   only as a lagoon's edge), the rivers running any way. The seed's region as today, with the
   skew to the south-west corrected (twelve seeds: ten south-west).
2. **Rivers as a tree.** Every river drains into another, a lake or the sea; rivers join, they never
   cross (the probe's sketch crossed them on two of twelve). A river widens downstream; its width
   at each point is its boat class (no dredging: water.md above).
3. **The home city by the water, mostly.** Placed on the water's character: at a confluence, on a
   river through it (London, Lokoja), on a lagoon (Lagos), at a delta's head (Onitsha) or on a creek
   in it (Port Harcourt), on an estuary (Calabar), by a lake (Maiduguri) -- and now and then inland,
   near the water but not on it (Ibadan, Kano). The home cluster round it is drawn by the slice
   generator's rules, but no longer pinned as the measured slice map: **C21 changes** -- it still
   reads like a map you know at the start, and the ladder's prices on its trunk are measured again
   on the new maps instead of guaranteed (your call, 2026-11-06).
4. **Towns placed relative to the water.** River towns along the navigable reaches, a harbour where
   the big river meets the sea (the seaport on its shore, not 7-9 cells inland), fishing villages on
   the coast, lagoon, creeks and lakes; the far clusters' regional towns on water where their
   region has it. The dry rule (3 cells from water) becomes a footprint rule: a town's land on land,
   its waterfront on the water. Roads and the old railway as today, over the new land.
5. **The checks start again.** C14, C16, C21, C31 and the strategist's baselines were measured on
   version 13's maps; on the new version the five test maps (8703, 2418, 949, 3218, 7585) get new
   geography, so every number is measured afresh and the old ones kept beside them for what they
   were. The cost of a redraw, taken on purpose.

**How it's judged, in order:** a water-only sheet (done: the probe's sketch, twelve seeds, five
characters, no two framed alike -- `scripts/water-sketch.ts`, a probe, not the generator); then the real
version opt-in, with a sheet of twelve maps with towns and roads for you to approve; then the map
tests (deterministic, every town reachable, earlier versions unchanged); the water probe (C47-C48);
the strategist on the five maps; and only then the default.

**Checks** (in the brief, Water first):

| # | Check | Passes when |
| --- | --- | --- |
| C47 | Maps don't look alike | Of twelve seeds, no two share a water layout by eye (your verdict on the sheet), and every region appears |
| C48 | The water carries | The water probe on the five test maps: a real share of the goods could go by water (15% a first guess) and the people between waterside towns well above today's 0-5%, on at least 3 of 5 |
| C49 | The home city is a water city | On at least 8 of 12 seeds the home city is on a river, lagoon, estuary, delta or lake; on the rest within 15 cells of it |
| C50 | Rivers are rivers | No two rivers cross on any of 50 seeds; every river reaches the sea, a lake or another river |

## Map version 16 built (opt-in, 2026-11-06; new games still on 13)

`src/engine/game/waterfirst.ts`: the first stage of a region drawn water first (the characters
above, turned and mirrored; rivers as a tree, a tributary ending on its host; the home city on the
bank its character chose, else inland; the home box round it; the trunk built leg by leg to the
hand-made map's lengths, then the rest of the home cluster by spacing, the dry rule 2 cells; the far
clusters by version 7's reach, a spot on navigable water counting a third more, the first on the
coast -- the sea, or a lagoon, delta arm or estuary that reaches it -- when the home city isn't;
three to five river towns and two to four fishing villages on the banks, each with an old spur).
Then `gameMap`'s passes that don't redraw the water: roads by the land, land forms, hamlets, laid
over the land, names. Versions 1-15 take their old path. Draws: 120 seeds, none failed, the slowest
0.8 s; regions 16-23 each; the home city inland on 13 of 120 (C49). Tests: `test/waterfirst.test.ts`
(the same seed the same map; every region; no rivers crossing on 50 seeds, C50; C49 on the twelve;
a game starts on a delta, a lake basin and a lagoon map).

**The probe on the five test maps** (boats 2.5+ cells, jetties within 10 cells, only where the
water is at most 1.5x the road). First drawn, the main channels tapered under a boat's width (a
delta's arms to 2 cells at the sea, the home city on a creek 2.3 wide, the far hubs only on narrow
tributaries): people took to the water, goods didn't (0-14% on four maps). The probe at 1.5 cells
said why -- 27% of 8703's goods could go by canoe, 0% by boat: the network was there, too narrow.
Widened -- a delta's arms 3.2 to 2.7, the north's river and the north-east's feeder 2.6+, the
south-west's big river 2.6+, one tributary a boat can take in the south-east and the Middle Belt,
creeks and the rest narrow (canoe water); the delta's city on an arm:

| map | v16 water | home city | people between waterside towns: v13 / v16 | goods by water: v13 / v16 |
|---|---|---|---|---|
| 8703 | a delta, the sea south | in the delta | 9% / 28% | 12% / 21% |
| 2418 | a lake basin (north-east) | on the river | 1% / 13% | 2% / 36% |
| 949 | a lake basin (north-east) | by the lake | 1% / 16% | 0% / 32% |
| 3218 | a delta, the sea west | in the delta | 2% / 17% | 2% / 17% |
| 7585 | a lagoon coast, the sea east | on the lagoon | 5% / 24% | 0% / 40% |

**C48 holds**: goods 17-40% and people 13-28% on all five. Most of those water routes have a ford
in the way (raising them the home cluster's ₦12-37k) -- step 3's decision, as planned. Sites by the
water weren't needed for it. Your verdict on the sheet (C47, 2026-11-06): "it looks better". Not yet
done: the strategist on the five maps, then the default.

## After the map

- **Step 2, jetties and boats.** A jetty at a waterfront (your build); a waterway network built
  from each river's drawn line (its centre, its width at each point), not A* over water cells --
  rail's own graph is the pattern; passenger boats and cargo boats as vehicles on it; a reach's
  width capping the boat. Numbers from the probe, then measured as the ladder was.
- **Step 3, the crossings.** A causeway or ford blocks a boat; a high bridge lets it pass; the
  rains raise the river while they close the fords. Whether a third kind is worth it, decided
  from step 2's map of what crosses where.
- **Step 4, fishing.** Fish from the landings to the markets as food (`food.ts`: a market's
  food, beside the mill's and the flour), by boat, canoe or road; whether it spoils unless smoked,
  and whether the rains change the catch, decided then. The informal canoes and boat operators as
  water's rival (brief, open item 4), last.

Each step is measured before the next: the probe first, then the strategist, as for every mode.

## For you to decide before step 1

1. **Add places, don't move towns** (recommended above) -- or move a far cluster onto the big
   river and the coast cluster's regional town onto the shore, which is truer but redraws every
   new map round them.
2. **How many river towns**, and how big: three to six of 8-30k is a first guess.
3. **The sea-to-home route on every coast map** -- a guarantee the generator keeps (recommended:
   it's the freight case water exists for), or left to the draw.
4. **Fishing grounds on the map now**, with their chain in step 4 -- or the whole of fishing
   later.
