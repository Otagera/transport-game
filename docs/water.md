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
