import type { SliceTuning } from "./types";

// Starting points, not gospel (docs/principles.md §3, "Balance numbers").
// Calibrated with scripts/slice-probe.ts, not by feel alone -- rerun it
// after touching any of these. What they were tuned to produce on
// src/slice/map.ts over 20 game days:
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
export const DEFAULT_SLICE_TUNING: SliceTuning = {
  // Slice zero (docs/brief.md): wear, goods, rail and the straight
  // alignment are off, and return one per playtest in the brief's order.
  wearEnabled: false,
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
  goodsEnabled: false,
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
  remittanceEnabled: true,
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
  busLaneCostShare: 1,
  growthCapLaneShare: 1.6,
  // Rail, the top rung (Revision 1, stage 2): a town with a working station
  // (track in service, or a halt) can grow this share of townGrowthCap. A
  // first guess above the lane's 1.6, measured with the corridor probe (C1).
  growthCapRailShare: 2.4,
  // Strikes, made legible (playtest 2026-10-19, "did a strike land? I
  // couldn't tell"): announced 4 days ahead, two days long, half as often
  // (strict every ~24 days, lax ~120).
  strikeDelayDays: 5,
  strikeNoticeDays: 4,
  // Settling (the brief's pushback form (a)): half what the strike would
  // cost you, at least ₦150 -- always cheaper than striking, never free.
  settlementShare: 0.5,
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
  railCostPerCell: 45,
  railGradientMultiplier: 3,
  railRestoreCostPerCell: 11,
  // Halts and the narrow-gauge line (rail.ts, wear.ts lineSpeed). Audit,
  // 20 days on: old line to Owode via a halt + train +₦249/day (~12 days),
  // new track Ilase-Owode + train +₦312 (~10), the whole old line to Ipaja
  // +₦145 (~22). At 0.7 the old line beat new track; at 0.4 the long run
  // to Ipaja barely paid.
  haltReachCells: 6,
  oldLineSpeed: 0.55,
  haltCost: 300,
  trainCapacity: 80,
  trainSpeed: 8,
  trainPurchaseCost: 2000,
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
  wearPerFlow: 0.00045,
  dirtWearMultiplier: 3,
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
};

/** Every system on: what the calibration probe and lever audit measure, and most tests. */
export const ALL_SYSTEMS_ON: Pick<SliceTuning, "wearEnabled" | "goodsEnabled" | "railEnabled" | "straightAlignmentEnabled"> = {
  wearEnabled: true,
  goodsEnabled: true,
  railEnabled: true,
  straightAlignmentEnabled: true,
};

/** Why an action is refused when its system is off. */
export const SWITCHED_OFF = "not in slice zero";
