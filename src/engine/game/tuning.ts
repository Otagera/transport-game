import type { GameTuning } from "./types";

// Starting points, not gospel (docs/principles.md §3, "Balance numbers").
// Calibrated with scripts/game-probe.ts, not by feel alone -- rerun it
// after touching any of these. What they were tuned to produce on
// src/game/map.ts over 20 game days:
//
//   - the best route (ilase-owode) peaks at ~2 buses (+228/day on the
//     route; 1 bus +194, 4 buses +90) and goes negative by 6 (-69) --
//     frequency is worth paying for, up to a point;
//   - a thin route run on its own loses a little (ilase-ise -26/day) and
//     says "thin"; as a feeder in a hub it about breaks even, because the
//     riders it hands on pay a fare on its leg too;
//   - a road to a cut-off town plus one bus loses ~40/day -- it pays in
//     share, not money;
//   - a 4-bus chain nets ~+258/day over 20 days, ~+305 over 40;
//   - doing nothing, danfos carry ~48% and ~52% stay home (31% of all
//     demand is between towns no road joins), and danfos passing through
//     take a visible bite out of your route's queue.
//
// Time: one game day is 30 seconds (economy/state.ts SECONDS_PER_GAME_DAY).
// Distance: map cells.
export const DEFAULT_GAME_TUNING: GameTuning = {
  // Slice zero (docs/brief.md) switched wear, goods, rail and the straight
  // alignment off, to return one per playtest. Wear is back (brief, Revision
  // 2: wear returns, per corridor); goods and the straight alignment wait.
  wearEnabled: true,
  // Routine upkeep (step 5, upkeep.ts): per cell per game day on every road
  // you built or paved, wear or no wear. More on paved roads, more again on
  // bridges. Inherited roads you haven't paved are the state's, and free.
  routineUpkeepDirtPerCell: 1,
  routineUpkeepPavedPerCell: 3,
  routineUpkeepBridgeMultiplier: 3,
  // The world runs 5 game days before day 1 (docs/brief.md, Slice zero:
  // warm-up), so the danfos are running and queues have settled when you
  // arrive. A cold start broke the brownfield pillar and put the day-1
  // forecasts wrong in sign (brief, Evidence 2).
  // 7 since the post-5b baseline: at 5 the informal share still moved 6
  // points by day 10 (M7's limit is 5); at 7, about 2.
  warmUpDays: 7,
  goodsEnabled: true,
  // Rail returns as the ladder's top rung (brief, Revision 1, 2026-10-19).
  railEnabled: true,
  straightAlignmentEnabled: false,
  patienceSeconds: 12,
  demandK: 0.008,
  // Fares by distance (fares.ts): boarding fare plus a price per 10-cell
  // stage, rounded up. Started so a typical leg pays the old flat ₦4: the
  // trunk (~25 cells) ₦4, a short hop ₦3, Ilase to Ado ~₦7. `fare` is the
  // goods-era flat fare the original economy's fare table still carries.
  fare: 4,
  // Step 6 (budget.ts). Measured (status.md): at a ₦10 toll and ₦20 per
  // thousand grown, the trunk's paving paid back in 7 days (M3 wants 10-30)
  // and the allocation was 59% of naive's income. At ₦4 and ₦7, paving
  // the trunk pays back in 29 days and a quiet road's never (M3 passes),
  // builder's minibuses pay, but the allocation's share fell to ~20% for a
  // well-connected network (the brief wants a quarter to a third) and M2
  // slipped: ₦10. The levy: doing nothing collects ~₦80 a day, the agberos
  // the same. With the remittance on, ₦10 left M2 failing (no road to a
  // cut-off town plus a vehicle paid back in 60 days), but ₦15 let
  // trips-greedy build out as if money were unlimited (M10: +3% at day 20,
  // against +15% at ₦10): back to ₦10, with M2 read in trips (brief).
  tollPerRoad: 4,
  priceElasticity: 1,
  levyPerSeat: 0.6,
  agberoCut: 0.5,
  allocationBase: 50,
  allocationPerThousand: 10,
  // Treasury remittance (step 6 pass 2, budget.ts): every 10 game days, 80%
  // of funds above a ₦3,000 reserve, never more than the period's surplus.
  // The reserve rises when rail returns (bigger projects to save for).
  // The treasury's levy (budget.ts treasuryLevy; brief, Revision 3, money):
  // 10% of what you earn, as you earn it, in place of the remittance below.
  // Replayed with goods at ₦0.25, the first day ₦60,000 (the refinery) is
  // held: map 2791 day 93 (remittance: 139), 6517 day 145 (177), 543 never
  // (never) -- a strong network can save for its next step, a weak one
  // stays tight. At 5% 2791 held ₦406k by day 209, at 15% 6517 never got
  // there. The remittance stays, switched off, for the runs played with it.
  levyEnabled: true,
  levyShare: 0.1,
  // The food chain (food.ts; brief, Revision 3, step 3). Farm towns grow 2 t
  // of staple a day per thousand people (producePerThousandPerDay, as their
  // produce did) and 0.5 t of cash crop for the port; market towns want 0.5
  // t of food. A mill makes a tonne of food from 2 of staple, up to 1.2 times
  // the markets' day-1 want: on map 2791, 268 t of staple from 134k farm
  // people makes 134 t, against 135 t wanted by 270k in the markets. The
  // state pays ₦20 a tonne of cash crop reaching the port: at ₦4 it was
  // noise -- map 2411 to day 412 exported 34 t a day for ₦129 a day against
  // ₦38,000 of income -- so 5x, ~₦700 a day there, ~₦1,300 with every farm
  // town's crop carried. Run files keep the rate they were played at. A fed market draws 30% more trips (market trade) and
  // grows up to a quarter of its start more. First guesses, to be measured.
  foodEnabled: true,
  foodPerThousandPerDay: 0.5,
  cashCropPerThousandPerDay: 0.5,
  millShare: 1.2,
  staplePerFood: 2,
  exportPayPerTonne: 20,
  // Paid once: from the food chain (a4eeb21) to 2026-10-23 the tick paid them twice.
  exportsPaidOnce: true,
  // Growth reads service between towns, not commutes to sites (2026-10-23: map
  // 543's Opobo fell 155k -> 112k when the second refinery opened next to it
  // with no road -- its 3,000 jobs' commutes all counted as unserved).
  growthIgnoresCommutes: true,
  jobsMill: 1,
  marketTripBoost: 0.3,
  foodCapShare: 0.25,
  // Flour (step 3c): a market town wants 0.2 t a day per thousand people
  // (Nigeria mills ~5 Mt of imported wheat a year: about 0.06 t a day per
  // thousand everyone; markets eat it all here, so more). Wheat comes in at
  // day 1's need, 1.3 t a tonne of flour; the mill at the port makes up to
  // 1.2 times day 1's want. Flour is 40% of a market's food basket: a map's
  // markets near the port eat well from day 1, the far ones wait for you.
  flourEnabled: true,
  farmsByStart: true,
  flourPerThousandPerDay: 0.2,
  wheatImportShare: 1,
  wheatPerFlour: 1.3,
  flourMillShare: 1.2,
  jobsFlourMill: 0.5,
  flourWeight: 0.4,
  // Revision 4, 1 (brief): no player lorries; road freight is hauliers',
  // reaching further from the haulage yards you build (yards.ts). A yard
  // costs about a paved stretch; from it hauliers reach 120 cells (40
  // elsewhere) and load twice as fast; you take ₦1 a tonne lifted there
  // (₦0.4 at a market), the touts a fifth (half at a market). First
  // guesses, to measure with the strategist.
  noPlayerLorries: true,
  // Hauliers' trucks: free of the danfos' road share (their traffic still slows the
  // road), and holding at most two loads a destination -- map 2418 to day 233, held
  // 4,214 t of cement for one town and delivered none.
  trucksFreeOfDanfoBudget: true,
  truckerHoldLoads: 2,
  // Towns expect better service as they grow (Revision 4, 2): from 80k, 15%
  // of their trips, a point more each 10k, 35% at most (280k). Short of it, a
  // town keeps only part of what your service would grow it to. First
  // guesses, to measure with the strategist (C16: money stays a decision).
  // The budget-year sweep (Revision 4, 3, a trial): every 60 days, cash above
  // the larger of ₦50k and your named project's price (plus this year's
  // borrowing) lapses to the treasury. Off since 2026-10-23: C17 failed in
  // play ("I was waiting for the money to grow and it ate it" -- money saved
  // for rail went), and the brief's trial said it comes out if it played like
  // the 80% cut. Kept behind the switch, for the runs played with it.
  sweepEnabled: false,
  sweepPeriodDays: 60,
  sweepCarryMin: 50000,
  serviceExpectEnabled: true,
  serviceExpectFrom: 80,
  serviceExpectBase: 0.15,
  serviceExpectPerThousand: 0.001,
  serviceExpectMax: 0.35,
  // Motor parks (Revision 4, 5): danfos load in a park, not at the roadside,
  // so the roads touching the town carry a quarter more before they jam, and
  // the agberos keep 15% of the levy there instead of half. First guesses, to
  // measure with the strategist.
  // A metro (Revision 4, 6): towns of 200k+, ₦150k for the first line and
  // ₦100k each more, three at most; each line carries 15% of the town's
  // inside trips, at ₦3 a rider and ₦300 a line a day to run, and lifts its
  // growth limit by a tenth of its start. A 400k town (4,000 inside trips a
  // day): a line nets ~₦1,500 a day, so the first pays back in ~100 days and
  // each more in ~70. (First cut: 1,500 riders a line under a 35% cap -- a
  // second line carried nobody in a town under ~430k.)
  metroEnabled: true,
  metroMinPopulation: 200,
  metroCost: 150000,
  metroLineCost: 100000,
  metroMaxLines: 3,
  metroLineShare: 0.15,
  metroFare: 3,
  metroRunningPerLine: 300,
  metroCapShare: 0.3,
  parksEnabled: true,
  parkCost: 20000,
  parkCapacityBoost: 0.25,
  parkAgberoCut: 0.15,
  yardsEnabled: true,
  yardCost: 6000,
  yardReachCells: 120,
  yardPickupBoost: 2,
  yardLevyPerTonne: 1,
  yardToutShare: 0.2,
  // Expanding a site (expand.ts; the map 2411 playtest, day 216: ₦193,748
  // held, 8 towns short of cement from a works at capacity). Each line adds
  // half the site's first capacity, twice at most; the first costs 0.8 of
  // its restore (refinery ₦48,000, works ₦36,000, a mill ₦20,000), the
  // second 1.5 times that. First guesses, to measure on a late game.
  expandEnabled: true,
  expandStep: 0.5,
  expandMaxLevel: 2,
  expandCostShare: 0.8,
  expandCostGrowth: 1.5,
  millExpandCost: 25000,
  // Bonds (bonds.ts; brief, Revision 3, money): repaid over 60 days with 20%
  // interest, the same each day; all repayments at most 30% of a day's
  // income. A ₦60,000 refinery bond is ₦1,200 a day: on map 2791 around day
  // 100, income ~₦9,000 a day, 13% -- and fuel above the pump price there
  // was costing ₦300-1,500 a day. First guesses, to be measured.
  bondsEnabled: true,
  bondInterest: 0.2,
  bondTermDays: 60,
  bondIncomeCap: 0.3,
  remittanceEnabled: false,
  remittanceShare: 0.8,
  remittanceReserve: 3000,
  remittancePeriodDays: 10,
  fareBoarding: 1,
  farePerStage: 1,
  fareStageCells: 10,
  // A dirt road you build, per flat cell (step 5: roads are born dirt and
  // paving is the dear upgrade, pathing/cost.ts PAVE_COST_PER_CELL). Was 15
  // when a built road came paved.
  roadCostPerCell: 10,
  busCapacity: 20,
  busSpeed: 3,
  busPurchaseCost: 500,
  // Running cost, ~105/day a bus: about a third of what the trunk's first
  // bus earns, more than a thin route's bus does. At 1.6 (~48/day) every
  // route paid, even six buses on the trunk (+257/day), so which routes to
  // run was never a decision; route composition is the lever that matters
  // (docs/principles.md §3, Balance numbers).
  // Track 2 (2026-10-17): 3.5 -> 3.0 when worn roads began costing buses
  // extra to run (roughRoadCostMax). At 3.5 plus rough roads, a bus on the
  // busiest route took 100 days to pay back and the early game went
  // negative from two buses (lever audit + probe).
  // 3.0 -> 2.4 with the minibus: a big vehicle must be the cheaper way to
  // move many people (₦1.20 per seat-cell against the minibus's ₦1.50), or
  // the minibus wins everywhere -- it did at 3.0, being faster as well as
  // cheaper (playtest: "if I buy a normal bus it bleeds money").
  // Step 5 (2026-10-17): most of the rough-road discount reversed. With
  // wear off, nothing charges a bus for worn roads, so 3.0 -> 2.4 was money
  // handed back for a cost that no longer exists; trips-greedy never once
  // waited for money (M10). The full reversal (2.8) sank every opening but
  // greedy's -- a builder's minibuses to the towns it connected never broke
  // even -- so 2.6, with the money taken from roads instead (routine upkeep
  // on paved roads, upkeep.ts). Minibus at the same ratio (₦1.30 per
  // seat-cell against the minibus's ₦1.63).
  busOperatingCostPerSecond: 2.6,
  // Small and nimble against big and roomy. Cheaper to run in total (₦63/day
  // against the bus's ₦72), dearer per seat-cell carried (₦1.50 against
  // ₦1.20): so the minibus is for routes too thin to fill a bus, and the bus
  // is how a busy route grows. Forecasts at the start, against four targets:
  //   - thin pairs: minibus +₦35 vs bus −₦8 (Ilase-Ise);
  //   - top pairs: bus +₦113 vs minibus +₦61 (Owode-Ise), +₦55 vs +₦23 (Ilase-Ado);
  //   - a busy route's second vehicle: bus +₦130 vs minibus +₦60 (Ilase-Owode);
  //   - both show up among the best next moves.
  // Getting here: at 14 seats / ₦42 the minibus beat the bus everywhere; at
  // 12 seats / ₦54 it still did, because being faster made it cheaper per
  // seat-cell too; at a bus's speed it rescued no thin route.
  // A BRT bus (Revision 1, for C3: the lane must carry more than it
  // displaces): articulated, 80 seats, lane-only. Four buses' seats for
  // three buses' price, at twice a bus's running cost -- ₦0.81 per
  // seat-cell against the bus's ₦1.30 -- and twice its road space (in the
  // lane, its own). First guesses, measured with scripts/corridor-probe.ts.
  brtCapacity: 80,
  brtSpeed: 3,
  brtPurchaseCost: 1500,
  brtOperatingCostPerSecond: 5.2,
  brtRoadSpace: 2,
  minibusCapacity: 12,
  minibusSpeed: 3.5,
  minibusPurchaseCost: 250,
  minibusOperatingCostPerSecond: 2.275,
  minibusRoadSpace: 1,
  // Informal modes, from the original game's catalog (public/content/
  // vehicles.json): capacity, speed, and congestion weight as road space.
  danfoCapacity: 14,
  danfoSpeed: 3.5,
  kekeCapacity: 3,
  kekeSpeed: 4.5,
  okadaCapacity: 1,
  okadaSpeed: 6,
  danfoRoadSpace: 1,
  kekeRoadSpace: 0.5,
  okadaRoadSpace: 0.3,
  // Cap per road (docs/principles.md §3), as road space in danfo-equivalents
  // (a dozen danfos or forty okadas), your vehicles' road space included
  // (tick.ts, step 5b). By surface (5b part 2), tuned to targets with your
  // buses on the dirt trunk (roads to Ilaro and Ikole built), not to the raw
  // capacity ratio -- 0.6 against 1.6 would evict every danfo at 4 dirt buses:
  //   - dirt 9: idle trunk never below half speed; 2 buses below half 16% of
  //     the time and carry 87 riders a day; 4 buses leave the danfos 52
  //     trunk trips of their 99. At 12, 2 buses jammed 63% of the time; at
  //     10 they carried 77; at 5 the danfos were all but evicted.
  //   - paved 15 (dirt's 9 by the capacity ratio): the paved trunk is never
  //     below half speed with 2 to 8 buses, and carries more danfo trips
  //     (81 against 62 at 2 buses) and more trips in all (813 against 583).
  //     Anywhere from 12 to 20 met the targets: on a paved road demand,
  //     not road space, limits the danfos.
  informalRoadSpace: 15,
  informalRoadSpaceDirt: 9,
  // Revision 1, 1b, the bus lane (scripts/corridor-probe.ts, C3): the
  // danfos lose a lane. At dirt's 9 their road space didn't fall at all --
  // your buses left the shared space, freeing it -- and the corridor's tolls
  // and levies rose 5% against a twin without the lane; at 6, -3%; at 4,
  // -12% (279 -> 245 a day over the lane's first 10 days): 4. General
  // traffic keeps 60% of the road's capacity; a lane costs what paving that
  // road did; its towns can grow 1.6x the paved cap's share (a first guess,
  // C1 not yet met: below). The union strikes 5 days after a lane opens,
  // then (Decisions log, lane encroachment) as often as enforcement provokes
  // it: every 12 days held strictly, every 60 left lax; a strike lasts a day.
  // Lax, danfos take 5% of the lane a day (all of it in 20); strict, wardens
  // clear 25% a day, at 1 a cell a day (the trunk's lane ~₦30). First
  // guesses.
  informalRoadSpaceLane: 4,
  laneGeneralCapacity: 0.6,
  // The lane's own capacity (C1 for the lane, corridor probe, the player
  // adding buses while full). Judged by speed it sat on a knife edge (1.6 ->
  // 18 days, 1.65 -> 33, 1.7 -> never). Judged by consequences (the jam rule
  // since 2026-10-19: no seat rising, towns falling), the lane's towns grow
  // 18-23 days at any capacity from 1.3 to 3.0; below ~1.0 the buses crawl.
  // 2.0: the middle of that flat stretch.
  busLaneCapacity: 2.0,
  // C2 (Revision 1, stage 2): a bus lane costs 10-20 days of the surplus it's
  // wanted in, rail 20-40. Corridor probe with real money (the player saves
  // for a rung through a named project, buys nothing else meanwhile): at the
  // old prices a lane (₦1,655) and rail (₦3,146) were each half a day's
  // surplus. A lane at 30x paving, ₦49,639 on the trunk: 14 days of the
  // ₦3,538 a day it was wanted in, 5 days' wait.
  busLaneCostShare: 30,
  growthCapLaneShare: 1.6,
  // Rail, the top rung (Revision 1, stage 2): a town with a working station
  // (track in service, or a halt) can grow this share of townGrowthCap. A
  // first guess above the lane's 1.6, measured with the corridor probe (C1).
  growthCapRailShare: 2.4,
  // Three BRT loads a day: between Ilase-Kuto's 37 (a lane loses there)
  // and the trunk's 700+ (it pays) -- corridor probe, C3.
  laneMinTripsPerDay: 240,
  // Strikes, made legible (playtest 2026-10-19, "did a strike land? I
  // couldn't tell"): announced 4 days ahead, two days long, half as often
  // (strict every ~24 days, lax ~120).
  strikeDelayDays: 5,
  strikeNoticeDays: 4,
  // A named project's set-aside is safe from the remittance this long (brief, Revision 1).
  projectLapseDays: 30,
  // Settling (the brief's pushback form (a)), priced by the corridor's
  // value: settlementShare x its income a day (your fares along it, its
  // tolls and levies) x strikeDays, at least ₦150. At 0.5 (a day's income)
  // settling cost 2.5-20x what each strike really cost against a twin
  // (corridor probe, seed 0, 210 days: strict lane strikes ₦812-2,069 against
  // quotes of ₦2,581-6,359; BRT ₦86-614 against ₦2,376-6,814), so letting it
  // pass always won -- the playtest's "let pass, or paid once". At 0.15 (0.3
  // of a day's income) each choice wins somewhere (brief C10): settling wins
  // 3 of 5 strikes on the strict bus trunk, never with BRT on the lane, 1 of
  // 2 on a lax one.
  settlementShare: 0.15,
  settlementMin: 150,
  strikeEveryStrictDays: 24,
  strikeEveryLaxDays: 120,
  strikeDays: 2,
  encroachmentPerDay: 0.05,
  encroachmentClearPerDay: 0.25,
  enforcementPerCellPerDay: 1,
  startingFunds: 2500,
  // Inside towns (docs/principles.md §5, answered "acknowledge it"): short
  // trips and the last mile, which kekes and okadas carry and nothing you
  // run reaches. Display only -- no money, no share. 10 per thousand puts
  // every town's inside trips at 2-3x everything it sends to other towns
  // (Ilase: ~1,200/day against ~375), so informal's own ground reads as
  // bigger than the contest. A ~40k town is about as far as people walk to
  // the park: Ilase 75% of your riders arrive by keke/okada, Ise 27%.
  localTripsPerThousandPerDay: 10,
  // Rail (step 4, rail.ts). New track ~3x a road per cell; gradients bite
  // 3x harder relative to that, so track bends round hills more readily
  // than a road does. Trains tuned with the probe's "rail:" strategies, one
  // train, 40 days, whole-game net/day (track + train capital excluded):
  //   - track through the towns pays: Ilase-Owode +298 (N3,146; 4 buses on
  //     the same pair: +263 for N2,000), Ilase-Owode-Ado +437 (N5,658) --
  //     the best strategy in the probe;
  //   - straight lines that bypass them don't: the restored export line
  //     Ilase-Ipaja -125, new direct Ilase-Ado -10 (skips Owode);
  //   - a second train on Ilase-Owode: +204 -- one is enough there.
  // At 300/day and speed 5 a train lost to buses everywhere: one train
  // came round too rarely, and a third of its riders gave up between.
  // Rail priced for C2: track ₦6,000 a cell and a ₦20,000 train -- the trunk's
  // track and first train ₦172,735, 27.8 days of the ₦6,207 a day it was
  // wanted in, 18 days' wait, built day 123 (C4: rail by day 100-150). At
  // 4,000 a cell, 19.6 days. Restoring and halts scaled with it, so the
  // wrong old line stays the cheap choice.
  // 2026-10-20: 6,000 -> 4,200 (restoring and halts x0.7 with it). On
  // generated maps rail had drifted to 34-43 days of surplus (the
  // playtest's map 543: ~45, and 27 idle days waiting for it); at 4,200 the
  // corridor probe's REAL_MONEY C2 reads 25.5 (seed 0) and 25.8 (seed 1).
  railCostPerCell: 4200,
  railGradientMultiplier: 3,
  railRestoreCostPerCell: 1050,
  // Halts and the narrow-gauge line (rail.ts, wear.ts lineSpeed). Audit,
  // 20 days on: old line to Owode via a halt + train +₦249/day (~12 days),
  // new track Ilase-Owode + train +₦312 (~10), the whole old line to Ipaja
  // +₦145 (~22). At 0.7 the old line beat new track; at 0.4 the long run
  // to Ipaja barely paid.
  haltReachCells: 6,
  oldLineSpeed: 0.55,
  haltCost: 21000,
  trainCapacity: 80,
  trainSpeed: 8,
  trainPurchaseCost: 20000,
  trainOperatingCostPerSecond: 6,
  // Track wear (wear.ts). Probe "track wear:", one train, 40 days: kept up,
  // Ilase-Owode +265/day (upkeep 37) against +193 left alone; Ilase-Owode-
  // Ado +365 (upkeep 67) against +263. Left alone, a busy line is at the
  // floor in ~3 weeks, under a slow order. Without the slow order worn track
  // barely touched a train (+4/day to keep it up): no decision.
  railWearPerTrain: 0.003,
  railSlowOrderBelow: 0.6,
  railSlowOrderSpeed: 0.6,
  // Goods (step 4, goods.ts). Lorry from the original catalog
  // (public/content/vehicles.json): 30 t, slow, heavy. Fares tuned with the
  // probe's "goods:" strategies, one lorry, 20 days, whole-game net/day:
  // both ways pays -- Ilase-Kuto +66, Ilase-Ise +26; one-way doesn't --
  // Ilase-Owode (supplies) +5, Ado-Ogbe (produce) -49, Ilase-Ado (long)
  // -72; a second lorry on Ilase-Kuto takes the pair to +10. At 3/t no
  // lorry paid at all.
  marketPopulation: 40,
  // Export and freight trains. Probe "freight:", 40 days, whole-game
  // net/day: a freight train alone on Ilase-Owode-Ado track +160 (supplies
  // only, 115 t/day out -- a lorry on that run loses 72: volume over distance
  // is what rail is for); with two lorries feeding produce to Ado, Ado
  // exports 23 t/day back and the train makes +230 (+217 all told); on the
  // restored old line -115. Lorry routes are unchanged by export: no farm
  // town's produce goes to Owode.
  exportShare: 0.5,
  freightCapacity: 150,
  freightSpeed: 6,
  freightPurchaseCost: 2500,
  freightOperatingCostPerSecond: 6,
  producePerThousandPerDay: 2,
  suppliesPerThousandPerDay: 1,
  goodsSpoilSeconds: 60,
  produceFare: 4,
  suppliesFare: 4,
  // Per tonne per cell (brief, Fares; Revision 2), replacing the flat ₦4 a
  // tonne above (still in the fare table, unused by the slice). A lorry full
  // one way earns about 1,125 x this a day whatever the distance (30 t a
  // trip, 2.5 cells a second, empty back): at 0.1, ₦112 against ₦108 of
  // running cost -- one way breaks even, both ways pays (principles.md §3,
  // Demand: goods pay only where they go both ways). 0.1 -> 0.25 (the step 2
  // playtest, map 2791): chains are one-way, and at 0.1 21 of 25 lorry
  // routes lost, ₦4,500 a day. At 0.25 one way full earns ~₦280, half full
  // breaks even, both ways twice that: the gap kept as a ratio. Replayed:
  // 7 of 15 lorry routes pay by day 100 (3 at 0.1); goods ~29% of income.
  goodsFarePerTonneCell: 0.25,
  // Freight rates (2026-10-23): a cheap line earns 0.6 of the goods fare, a
  // dear one 1.6; against a dear line hauliers load and reach 1.5 times as
  // far, against a cheap one two-thirds. First guesses, to measure.
  freightRatesEnabled: true,
  // The region (2026-10-23): new games are drawn on it.
  regionEnabled: true,
  freightRateCheap: 0.6,
  freightRateDear: 1.6,
  freightHaulierPull: 0.5,
  lorryCapacity: 30,
  lorrySpeed: 2.5,
  lorryPurchaseCost: 550,
  // Track 2: 4 -> 3.6 with rough-road costs. Lorries wear roads hardest and
  // pay the most on worn ones: a lorry on dirt Ilase-Kuto pays back in ~20
  // days, on the same road paved in ~5 -- goods want good roads.
  lorryOperatingCostPerSecond: 3.6,
  lorryRoadSpace: 1.5,
  // 1.5 road space x 1.6 = 2.4 against a bus's 1.2: a lorry wears a road
  // about twice what a bus does.
  lorryWearMultiplier: 1.6,
  // Growth of the original towns (step 4, growth.ts). Probe, day 40: doing
  // nothing grows nothing (danfos alone); 2 buses on the trunk grow Ilase
  // 120->147k and Owode 45->53k; 4 buses 155k/61k; the hub grows Ise
  // 15->19k too. tau = 10 game days: a day of good service moves a town a
  // few percent. It moves the fleet optimum: 4 trunk buses net +263/day
  // with growth against +61 without.
  //
  // Revision 1, 1a (docs/brief.md; growth.ts bestRung): the cap is set by a
  // town's best road. Paved allows townGrowthCap, dirt 40% of it -- 1.25 x
  // 0.4 = +50%, exactly the old cap, so dirt corridors behave as before.
  // Corridor probe (scripts/corridor-probe.ts, Ilase-Owode, a player adding
  // buses while they run full): the dirt trunk jams on day ~15; paved, at a
  // paved cap of 1.0 it held 49 days before jamming again, 1.15 34 days,
  // 1.25 26 (27 with buses held to 8), 1.5 16, 2.0 13. Brief C1 wants 20-40.
  townGrowthCap: 1.25,
  growthCapDirtShare: 0.4,
  growthMinPlayerShare: 0.1,
  growthServiceFloor: 0.25,
  growthServiceFull: 0.75,
  townGrowthTauSeconds: 300,
  // Wear (step 4, wear.ts). Tuned with the probe's wear strategies, a
  // 2+2-bus chain over 40 days (no wear at all: +305/day):
  //   - left alone, every busy dirt road reaches the floor (72% speed)
  //     within ~2 weeks, and the chain nets +154/day;
  //   - maintaining the trunk (~47/day upkeep, dirt) nets +234 -- it pays;
  //   - maintaining the Owode-Ado road too nets +140: its old bridge wears
  //     2x and costs 4x a cell to repair, ~129/day, more than it gives back;
  //   - paving the trunk and maintaining it (~15/day) nets +296.
  // The step 2-3 numbers in the comments above were measured before wear.
  // Track 2: 0.75 -> 0.95. With rough-road costs, starting every inherited
  // road worn taxed every bus from day one; starting them sound lets your
  // own traffic wear them, so keeping roads up becomes a mid-game decision.
  inheritedRoadCondition: 0.95,
  weatherPerSecond: 0.0001,
  // 2026-10-20: 0.00045 -> 0.0001 and dirt 3 -> 1.5. On generated maps the
  // danfos' traffic wore every inherited dirt road to the floor in 5-30
  // days, and worn roads raise your vehicles' running cost (roughRoadCostMax):
  // the early tax principles.md §3 warns of, behind the playtest's "routes
  // kept losing". Replaying a run (map 543, five minibus routes, 60 days):
  // wear cost ₦24,940 today (running +₦15,495, fares -₦9,445 against wear
  // off), ₦14,320 at these numbers, with dirt roads reaching the floor on
  // days 41, 63 and 68 instead of 5-30. Keeping dirt at 3 and only cutting
  // wearPerFlow didn't do it (at 0.00005 the floor still came from day 22):
  // on dirt, weather and heavy danfo flows dominate. Paving now cuts wear by
  // 1.5x, not 3x; it still carries 1.7x the traffic and earns tolls.
  wearPerFlow: 0.0001,
  dirtWearMultiplier: 1.5,
  bridgeWearMultiplier: 2,
  repairCostScale: 8,
  // Worn roads cost your road vehicles extra to run (wear.ts): up to +70% at
  // the floor, inside the range road agencies' vehicle-operating-cost models
  // give for buses on very poor roads. Lever audit, 20 days after acting:
  //   - maintaining a road 3 of your buses use pays back in ~10 days;
  //   - paving it, ~9 days; maintaining a road only danfos use earns nothing;
  //   - a bus on the busiest route pays back in ~10 days, a thin new route ~17.
  roughRoadCostMax: 0.7,
  walkableTownPopulation: 40,
  outcomeTauSeconds: 30,
  // Shared road (congestion.ts). Capacity is road space entering per
  // second. With no service the busiest dirt road carries ~0.5-0.8/s
  // (free flow); 2-4 buses on ilase-owode lift it to ~1.0-1.4 and slow it
  // to ~80%, which is that route's best count; 6 jam it, 12 lose money.
  congestion: true,
  busRoadSpace: 1.2,
  roadFlowCapacity: 1.6,
  dirtRoadCapacity: 0.6,
  minSpeedFactor: 0.15,
  informalMinSpeed: 0.35,

  flowTauSeconds: 60,
  settlementCheckSeconds: 30,
  // Riders/sec past a point, measured before any town exists: danfos
  // alone carry ~6.6 on ilase-owode, ~4.3 on owode-ado, ~2.2 on
  // ilase-kuto. Adding your buses barely moves the total (your riders are
  // mostly ones danfos would have carried) but your share is what counts:
  // 1 bus on ilase-owode carries ~1.0 of it. So a town needs a busy road
  // *and* your service on it -- two or three roads on this map qualify
  // once you run them, the rest never do.
  foundTownFlow: 4,
  foundTownPlayerFlow: 0.8,
  townSpacingCells: 10,
  maxEmergentTowns: 4,
  minSecondsBetweenTowns: 120,
  newTownPopulation: 5,
  // ~10 riders/s through a roadside town supports ~13k people. Rider
  // flow, not vehicle flow, so extra empty buses barely grow it.
  populationPerFlow: 1.3,
  maxEmergentPopulation: 30,
  townPopulationTauSeconds: 300,
  abandonBelowPopulation: 2,

  // "Corridor taken" (R1 6, corridors.ts): the brief's pushback threshold,
  // your share of a corridor's trips at ~40% (The informal sector), used
  // here as a visible state, not yet a trigger. Released at 30%, so a
  // corridor near the line doesn't flip back and forth day to day. Not
  // tuned by the bots: a display line, to be played.
  corridorTakenShare: 0.4,
  corridorReleaseShare: 0.3,

  // Industries (brief, Revision 2: industries that open and close, one kind
  // first -- the quarry). Targets from the brief, first guesses to measure:
  // one opens every 20-40 days from day 20, at most three at once; one
  // nothing is moved from in its first 30 days closes, and a quarry works
  // out after 90-180 days. A lorry (30 t, ₦108/day) filling every trip on a
  // ~15-cell spur makes ~₦270/day at ₦4/t, so ~100 t/day pays a lorry one
  // way. Stone feeds construction: a town getting all it wants can grow a
  // quarter of the growth cap more.
  industriesEnabled: true,
  industryFirstDay: 20,
  industryEveryMinDays: 20,
  industryEveryMaxDays: 40,
  industryMaxOpen: 3,
  industryGraceDays: 30,
  industryMinDeliveredPerDay: 5,
  industryWorkers: 2,
  quarryOutputPerDay: 150,
  quarryLifeMinDays: 90,
  quarryLifeMaxDays: 180,
  quarryExportShare: 0.3,
  stoneCapShare: 0.25,

  // The fuel chain (fuel.ts; brief, Revision 3, step 1): a tank farm by the
  // port imports fuel, an idle refinery waits to be restored, and crude
  // comes from an oilfield (south-south) or a pipeline terminal. A town
  // burns a tonne a day per thousand people: on a ~600k map, ~600 t a day,
  // the volumes freight rail is for. Imports cover day 1's need (see
  // below), less what's lost on the long hauls, so the towns far from the
  // tank farm run short until the refinery runs; it can make 90%, from
  // crude delivered to it, and fills what imports don't. First guesses: to
  // be measured (C11, goods 20-40% of income by day 100). Imports 0.4 ->
  // 0.7 -> 1.0 of day 1's need: replaying a played run, shortages from day 1
  // cost 37% of net by day 30, the early tax we've removed twice (wear,
  // savings). At 1.0 the towns tankers reach start supplied; as your service
  // grows them they burn more than the imports bring, so scarcity builds
  // with success, like a jam, and the refinery becomes the mid-game project.
  fuelEnabled: true,
  fuelPerThousandPerDay: 1,
  fuelImportShare: 1,
  refineryShare: 0.9,
  crudeShare: 1,
  refineryRestoreCost: 60000,
  // Revision 4, step 4: a privately owned refinery opens mid-game (the Dangote
  // story), by the port, already built: crude has to reach it from the source
  // (the long leg, rail's) and its fuel has to get out. It's bigger than the
  // old one -- as much as the towns burnt on day 1 -- and fills what imports
  // and the old refinery leave short; the rest leaves through the port. First
  // guesses, to measure with the strategist.
  newRefineryEnabled: true,
  newRefineryDayMin: 90,
  newRefineryDayMax: 120,
  newRefineryShare: 1,
  newRefineryCrudeShare: 1.1,
  // About a week, against produce's two days: at two days the port city got
  // half its fuel with the tank farm next door.
  fuelLossSeconds: 180,
  // What a shortage does (fuel.ts, step 1b), at a total shortage: danfo
  // fares up 60% (in a scarcity fares here roughly double), half the danfos
  // parked, riders waiting twice as long for your vehicles, your running
  // costs up 30% (less than the danfos': the state buys fuel in bulk).
  // 0.6 / 0.5 -> 0.5 / 0.35: replayed to day 30, the shortages distance alone
  // makes cost 20% of trips before you could do anything about them.
  fuelFarePremium: 0.5,
  fuelParked: 0.35,
  fuelPatience: 1,
  fuelCostPremium: 0.3,

  // The building chain (cement.ts; brief, Revision 3, step 2a). A town
  // wants 0.25 t of cement a day per thousand people (Nigeria uses about 25
  // Mt a year: 0.3), so ~150 t a day on a ~600k map. The works makes up to
  // 1.2 times day 1's want, from 1.5 t of limestone a tonne: a quarry's
  // 150 t a day makes 100, so it takes two quarries to run near capacity,
  // and three once the towns grow. A town grows its first 40% without
  // cement; past that, only as far as its cement lets it. An idle works'
  // map imports 30% of the want through the terminal. First guesses, to be
  // measured (C11, C13, C14).
  cementEnabled: true,
  cementPerThousandPerDay: 0.25,
  cementWorksShare: 1.2,
  cementImportShare: 0.3,
  limestonePerCement: 1.5,
  worksRestoreCost: 45000,
  cementIdleChance: 0.5,
  quarryAfterRestoreDays: 3,
  cementFreeShare: 0.4,

  // Sites need people (workers.ts; brief, Revision 3, step 2b). A refinery
  // employs about 3,000, a cement works 2,000, a quarry or depot 500. Each
  // thousand jobs makes 40 commutes a day each way, from towns within 35
  // cells: a refinery's 120 a day is a bus route's worth (the trunk carries
  // 700-1,000). Danfos carry 16-76% of the trips to sites on day 1, so a
  // full shift is half the commutes made: a tank farm by the port is fully
  // staffed from the start, a works on dirt roads at ~60% until someone
  // runs a bus. Nobody arriving, a site still makes a quarter (some live on
  // site, or walk). First guesses, to be measured.
  workersEnabled: true,
  jobsRefinery: 3,
  jobsWorks: 2,
  jobsQuarry: 0.5,
  jobsDepot: 0.5,
  jobsSilo: 0.3,
  jobsIdle: 0.05,
  commutePerThousandJobs: 40,
  commuteReachCells: 35,
  staffFloor: 0.25,
  staffFullShare: 0.5,
  // Towns around sites (step 2c): each job held brings four people (the
  // household and the trade), at most half a town's start -- a refinery's
  // 3,000 jobs is ~12k people spread over the towns nearby. A refinery or
  // cement works that has worked 30 staffed days grows a camp at its gate.
  peoplePerJob: 4,
  jobsCapShare: 0.5,
  gateTownMinJobs: 1.5,
  gateTownDays: 30,

  // Rail's own job (brief, Revision 2). A line carries `trackSlots` trains,
  // passenger and freight together: a freight train takes a passenger one's
  // slot, so a busy line is a choice (C7). Rail makes trips that weren't made
  // before -- between two stops of one passenger line, a third more -- and a
  // station town can grow past its rail rung. First guesses, to measure.
  // Private truckers (brief, Revision 2, agreed): goods waiting at a yard
  // are picked up at 1/15 a second on the shortest hauls, falling to none at
  // 40 cells -- a long run is yours or rail's. Their trucks carry 20 t, a
  // little slower than your lorry, and charge 80% of your fare (the
  // undercut, kept as the informal sector's earnings). Loads lifted at a
  // market or the port pay ₦0.4 a tonne; the touts keep half. First guesses.
  truckersEnabled: true,
  truckerPickupSeconds: 15,
  truckerMaxHaulCells: 40,
  // Fuel goes by road tanker, and far: nearly all of it does here (fuel.ts).
  // At truckers' 40 cells, only the towns by the tank farm got any fuel; at
  // 90, a map with its port in a corner (6517) left its far third dry for
  // good. At 200 the far towns get less, never none.
  tankerMaxHaulCells: 200,
  truckLoad: 20,
  truckSpeed: 2.2,
  truckerFareShare: 0.8,
  loadingLevyPerTonne: 0.4,
  // Retiring a road (brief, Revision 2): gone 60 days after you retire it
  // unless restored; track laid on a retired road's alignment costs half of
  // new track -- the earthworks are done.
  retireGoneDays: 60,
  railOnRoadShare: 0.5,
  trackSlots: 4,
  railInducedDemand: 0.3,
  stationCapShare: 0.3,
};

/** Every system on: what the calibration probe and lever audit measure, and most tests. */
export const ALL_SYSTEMS_ON: Pick<GameTuning, "wearEnabled" | "goodsEnabled" | "railEnabled" | "straightAlignmentEnabled"> = {
  wearEnabled: true,
  goodsEnabled: true,
  railEnabled: true,
  straightAlignmentEnabled: true,
};

/** Why an action is refused when its system is off. */
export const SWITCHED_OFF = "not in slice zero";
