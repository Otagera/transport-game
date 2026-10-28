import type { TermState } from "./term";
import type { UnionState } from "./union";
import type { FloodState } from "./floods";
import type { Crossing } from "./crossings";
import type { GameEvent } from "./settlement";
import type { LaneState } from "./pushback";
import type { NamedProject } from "./project";
import type { PathResult, RoutingContext, SimulationState } from "../simulation/types";
import type { EconomyState } from "../economy/types";
import type { SettlementState } from "./settlement";
import type { DayLedger } from "./ledger";
import type { TripPlans } from "./transfers";
import type { RoadPlan } from "./roads";
import type { GoodsState } from "./goods";
import type { DayHistory } from "./history";
import type { MilestoneState } from "./score";
import type { CorridorState } from "./corridors";
import type { FuelState } from "./fuel";
import type { CementState } from "./cement";
import type { SteelState } from "./steel";
import type { SitesState } from "./workers";
import type { Bond } from "./bonds";
import type { FoodState } from "./food";
import type { SweepState } from "./sweep";
import type { OutcomeIndex } from "./world";
import type { IndustryState } from "./industries";
import type { TruckerHeld } from "./truckers";
import type { BudgetTally, RemittancePeriod } from "./budget";

// The slice (docs/principles.md §6): the smallest loop that can be felt --
// towns, straight roads, one bus type, passengers who give up, and the
// danfos that carry the ones who did. Everything here is a plain mirror;
// engine/ stays content-unaware (architecture hard rule 2), so the
// bootstrap layer hands in a GameMapDef rather than this module loading
// one.

export interface GameTown {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Thousands of people. Drives gravity demand; nothing else yet. */
  population: number;
  /** An industrial site, not a town (industries.ts, brief Revision 2): its population is its workers. */
  industry?: IndustryKind;
}

/** The kinds of industrial site (brief, Revision 2: one kind first, the quarry). */
/** A quarry opens and closes (industries.ts); the fuel chain's sites are there from the start (fuel.ts). */
export type IndustryKind = "quarry" | "depot" | "refinery" | "newrefinery" | "oilfield" | "terminal" | "works" | "silo" | "mill" | "flourmill" | "ironmine" | "steelworks" | "steelport" | "border";

export interface GameRoadDef {
  a: string;
  b: string;
  /** The road's line between its towns, map cells (region.ts: the old highways, laid over the land); absent, straight. */
  via?: Array<[number, number]>;
}

export interface GameRiverDef {
  /** Centre line, map cells. */
  points: Array<[number, number]>;
  /** Width in cells. */
  width: number;
  /** Width at each point, in cells, narrowing or widening between them (variation.ts); absent means `width` throughout. */
  widths?: number[];
}

export interface GameHillDef {
  x: number;
  y: number;
  radius: number;
  /** Elevation at the top; a road pays for every unit it climbs or descends (pathing/cost.ts). */
  height: number;
}

export interface GameMapDef {
  width: number;
  height: number;
  towns: GameTown[];
  /** The part of the country its names come from (generate.ts): decides its fuel source (fuel.ts). */
  region?: string;
  /** Inherited roads -- the network that already exists at start. Straight: they were built
   * for another age's needs and never fixed (principles §1, brownfield premise). */
  roads: GameRoadDef[];
  /** Step 3: authored terrain. Absent means flat dry land. */
  /** `valleys`: the rivers cut through the hills (terrain.ts); absent in maps drawn before it. */
  terrain?: { rivers?: GameRiverDef[]; hills?: GameHillDef[]; valleys?: boolean };
  /** Step 4: the port city, where supplies come from (goods.ts). Absent means no supplies. */
  port?: string;
  /** Where imports land from the sea (region.ts): the home city on a coast, else the coast cluster's regional town. */
  seaport?: string;
  /** Step 4: inherited railway, straight and out of service until restored (rail.ts). */
  rails?: GameRoadDef[];
  /** The region (region.ts): the home cluster's box, where you start and the camera frames. Absent: the whole map is home. */
  home?: { x: number; y: number; width: number; height: number };
  /** The region's far clusters: each its regional town, its towns, and what it offers your chains (clusters.ts). */
  clusters?: ClusterDef[];
}

export interface ClusterDef {
  hub: string;
  towns: string[];
  offer: "limestone" | "farm";
}

/** A player route: an A<->B shuttle, running however many buses. */
export interface GameRoute {
  id: string;
  a: string;
  b: string;
  vehicleIds: string[];
  /** When it opened (economy seconds): a route younger than a day reads its fares by its own age. */
  openedAtSeconds: number;
  /** Rolling riders boarding this route's buses, per second. */
  boardingRateEMA: number;
  /** Rolling mean of how full this route's buses are, 0..1. */
  loadFactorEMA: number;
  /** Rolling mean speed of this route's buses as a share of free flow, 0..1. */
  speedEMA: number;
}

/**
 * Where one (origin, destination) pair's passengers ended up, as rolling
 * rates (passengers per second). Every generated passenger lands in
 * exactly one bucket, which is what makes shares comparable:
 *
 * - player:  boarded one of your buses.
 * - poached: a danfo passing through picked them up before your bus came.
 * - gaveUp:  waited too long, then left on a danfo.
 * - lost:    gave up and stayed home (no road, or the danfo never filled).
 *
 * Danfo share is poached + gaveUp; they're kept apart because they answer
 * different questions when a route is losing money.
 */
export interface OutcomeRates {
  player: number;
  poached: number;
  gaveUp: number;
  lost: number;
}

export type InformalMode = "danfo" | "keke" | "okada" | "truck";

export interface InformalState {
  /** Pool key (at>origin>destination) -> people who gave up on you, waiting for a danfo to fill. */
  pool: Map<string, number>;
  /** Same keys -- people who won't wait any longer for a danfo, looking for a keke or okada. */
  smallPool: Map<string, number>;
  /**
   * Informal vehicleId -> what it is and the road space it holds: its path's
   * segments from `released` on (the ones it has left are given back).
   */
  active: Map<string, { segmentIds: string[]; weight: number; mode: InformalMode; released: number }>;
  /** segmentId -> informal road space in use, in danfo-equivalents. */
  segmentSpace: Map<string, number>;
  /** Fares the informal sector has collected -- money you didn't make. */
  earnings: number;
}

export interface GameTuning {
  /** Tolls (budget.ts): per road of yours on a path, per danfo-equivalent of road space. */
  tollPerRoad: number;
  /** Riders priced out of a danfo: this times the toll's share of their fare. */
  priceElasticity: number;
  /** Park levy per seat of each informal departure, and the agberos' share of it. */
  levyPerSeat: number;
  agberoCut: number;
  /** The state's allocation a game day: a base, plus this per thousand people grown since day 1. */
  allocationBase: number;
  allocationPerThousand: number;
  /** The treasury remittance (budget.ts): on, the share taken, the reserve kept, and the period. */
  /** The treasury's levy (budget.ts treasuryLevy): on, and its share of what you earn, taken as you earn it. */
  levyEnabled: boolean;
  levyShare: number;
  /**
   * The food chain (food.ts, brief Revision 3, step 3): on; food a market town wants and cash crop a
   * farm town grows, tonnes per thousand people a day; the mill's capacity, a share of the markets'
   * want at the start, and tonnes of staple a tonne of food takes; the state's export payment a tonne
   * of cash crop reaching the port; the mill's jobs (thousands); a fed market's extra trips (market
   * days, at full food) and room to grow, a share of its start.
   */
  foodEnabled: boolean;
  foodPerThousandPerDay: number;
  cashCropPerThousandPerDay: number;
  millShare: number;
  staplePerFood: number;
  exportPayPerTonne: number;
  /** Exports paid into funds once a tick (tick.ts). Run files without it replay paying them twice, as played. */
  exportsPaidOnce: boolean;
  /**
   * A town's growth reads your service on its trips to other towns, not its commutes to sites
   * (growth.ts): a new site with no road counted every commute as unserved and shrank the town
   * beside it (map 543, the second refinery). Run files without it replay as played.
   */
  growthIgnoresCommutes: boolean;
  jobsMill: number;
  marketTripBoost: number;
  foodCapShare: number;
  /**
   * Flour (food.ts, step 3c): flour a market town wants, tonnes per thousand people a day; wheat
   * imported through the port, a share of the wheat day 1's flour takes; tonnes of wheat a tonne of
   * flour takes; the flour mill's capacity, a share of day 1's want; its jobs (thousands); flour's
   * share of a market's food basket.
   */
  /** Flour on (a run file without it replays without, as played). */
  flourEnabled: boolean;
  /** Farm towns are those that started below market size, and farm their start's land (food.ts); a run file without it replays as played. */
  farmsByStart: boolean;
  flourPerThousandPerDay: number;
  wheatImportShare: number;
  wheatPerFlour: number;
  flourMillShare: number;
  jobsFlourMill: number;
  flourWeight: number;
  /**
   * Revision 4, 1: the player runs no lorries (goods.ts checkLorry); road freight is hauliers'.
   * A run file without it replays with lorries, as it was played.
   */
  noPlayerLorries: boolean;
  /**
   * Hauliers' trucks don't wait for the danfos' share of the road (truckers.ts), as tankers
   * don't; and they hold at most this many truckloads a destination, the rest left at the yard.
   * Run files without them replay as played.
   */
  trucksFreeOfDanfoBudget: boolean;
  truckerHoldLoads: number;
  /**
   * Towns expect better service as they grow (growth.ts expectedShare, Revision 4, 2): on; from
   * what size (thousands); the share expected there; added a thousand people; at most.
   */
  /** Terms and pledges (term.ts, Revision 5, 2): on; a term's length, days. Absent in runs played before them: off. */
  /** The union as a party (union.ts): on; days between an against-you chairman's demands; a demand's deadline, days; its price, a base and per thousand of his towns' people; how long he remembers, days. Absent in older runs: off. */
  unionEnabled?: boolean;
  unionDemandEveryDays?: number;
  unionDemandDays?: number;
  unionPriceBase?: number;
  unionPricePerThousand?: number;
  unionMemoryDays?: number;
  /** The far clusters' offers (clusters.ts): on; a limestone field's output against a quarry's; a farm belt's staple against a farm town's. Absent in older runs: off. */
  clusterOffersEnabled?: boolean;
  /** The rains (floods.ts, Revision 5, step 6): on; the first rains between these days; then every so many days; named this many days ahead; lasting; fords a season; how fast a flooded road runs; an all-weather bridge's price a cell of water. Absent in older runs: off. */
  /** Named crossings and the way a road goes (crossings.ts, Revision 5, step 6): on. Absent in older runs: off. */
  crossingsEnabled?: boolean;
  /** A limestone field on the hill range between two clusters (crossings.ts): on. Absent in older runs: off. */
  ridgeFieldEnabled?: boolean;
  floodsEnabled?: boolean;
  /** A new road over water: a causeway that floods, or a high bridge (floods.ts). Absent in older runs: off. */
  causewaysEnabled?: boolean;
  /** Your road vehicles re-plan at either end of their route, round a flooded road where a dry one is quicker (world.ts takeShortestRoad). Absent in older runs: off, at the start only, by length. */
  floodDetour?: boolean;
  /** Rivers cut valleys through the hills (terrain.ts). Absent in older runs: off, their maps as drawn. */
  riverValleys?: boolean;
  /**
   * Which drawing of a seed's map (region.ts gameMap): 1 as first drawn; 2 rivers smoothed and
   * meandering, the old railway laid over the land; 3 the sites round a town placed past where
   * it's built up, on one side of it (fuel.ts ringSpot); 4 the land beyond the home cluster drawn
   * by region, and the coast with an estuary and bays (regionalLand); 5 a southern region's coast
   * along its south (coastToSouth). Absent in older runs: 1, so a run file
   * replays on the map it was played on.
   */
  mapVersion?: number;
  /** A fuel pledge offered only where it has a move to name (term.ts). Absent in older runs: off, offered as it was. */
  fuelPledgeNeedsMove?: boolean;
  /** Imports land at the seaport and a share reaches the home city (gateways.ts). Absent in older runs: off, landing at the home city. */
  seaportImports?: boolean;
  /** The share of imports long-haul trucks bring up a dirt road from the seaport, and up a road paved end to end. */
  importsOverDirt?: number;
  importsOverPaved?: number;
  /** One border crossing a map, cash crops leaving by it where it nets more (border.ts, gateways.ts). Absent in older runs: none. */
  borderCrossing?: boolean;
  /** What the state pays a tonne of cash crop over the border, as a share of the sea's. */
  borderPayShare?: number;
  floodFirstDayMin?: number;
  floodFirstDayMax?: number;
  floodEveryDays?: number;
  floodWarnDays?: number;
  floodDays?: number;
  floodFordsPerSeason?: number;
  floodSpeed?: number;
  fordBridgePerCell?: number;
  fieldOutputScale?: number;
  farmBeltScale?: number;
  /** Private traffic (private.ts): on; the load a thousand people's cars make (danfo-equivalents a second), the share of a town's size that drives (its growth since day 1 drives whole), how far from a town it fades, cells. Absent in older runs: off. */
  privateTrafficEnabled?: boolean;
  privatePerThousand?: number;
  privateBaseShare?: number;
  privateReachCells?: number;
  /** Fuel goes only to towns its source reaches, by tanker or rail (fuel.ts; map 2418, day 230). Absent in older runs: off. */
  fuelWithinReach?: boolean;
  pledgesEnabled?: boolean;
  termDays?: number;
  /** The mandate (term.ts, Revision 5, 3): on; the term grant's base, per pledge kept, per thousand people grown. */
  mandateEnabled?: boolean;
  termGrantBase?: number;
  termGrantPerPledge?: number;
  termGrantPerThousand?: number;
  /** The grant term 1 opens with (absent in runs played before it: none). */
  termOpeningGrant?: number;
  /** The budget-year sweep (sweep.ts, Revision 4, 3, a trial): on; the year, days; the least you may carry over. */
  sweepEnabled: boolean;
  sweepPeriodDays: number;
  sweepCarryMin: number;
  serviceExpectEnabled: boolean;
  serviceExpectFrom: number;
  serviceExpectBase: number;
  serviceExpectPerThousand: number;
  serviceExpectMax: number;
  /**
   * Haulage yards (yards.ts): on; what one costs; how far hauliers reach from one (cells); how much
   * faster they load there; the yard levy a tonne lifted, and the touts' share of it.
   */
  /**
   * Motor parks (parks.ts, Revision 4, 5): on; what one costs; how much more the roads touching
   * a parked town carry before they jam; the agberos' cut of the levy on a departure from one.
   * Run files without them replay with none.
   */
  /**
   * A metro (metro.ts, Revision 4, 6): on; the smallest town (thousands); the first line's
   * price and each more's; most lines; the share of a town's inside trips a line carries; fare a
   * rider; running cost a line a day; how far all its lines lift growth, as a share of the town's
   * start. Run files without them replay with none.
   */
  metroEnabled: boolean;
  metroMinPopulation: number;
  metroCost: number;
  metroLineCost: number;
  metroMaxLines: number;
  metroLineShare: number;
  metroFare: number;
  metroRunningPerLine: number;
  metroCapShare: number;
  parksEnabled: boolean;
  parkCost: number;
  parkCapacityBoost: number;
  parkAgberoCut: number;
  yardsEnabled: boolean;
  yardCost: number;
  yardReachCells: number;
  yardPickupBoost: number;
  yardLevyPerTonne: number;
  yardToutShare: number;
  /**
   * Expanding a site (expand.ts): on; capacity added a time, a share of what it was built with;
   * how many times; a first expansion's cost, a share of the site's restore cost (the mills' own
   * base), each next one dearer by this factor.
   */
  expandEnabled: boolean;
  expandStep: number;
  expandMaxLevel: number;
  expandCostShare: number;
  expandCostGrowth: number;
  millExpandCost: number;
  /** Bonds (bonds.ts): on; interest over the whole term, a share of what was lent; the term, days; all repayments at most this share of a day's income. */
  bondsEnabled: boolean;
  bondInterest: number;
  bondTermDays: number;
  bondIncomeCap: number;
  remittanceEnabled: boolean;
  remittanceShare: number;
  remittanceReserve: number;
  remittancePeriodDays: number;
  /** Fares by distance (fares.ts): boarding fare, price per stage, and a stage's length in cells. */
  fareBoarding: number;
  farePerStage: number;
  fareStageCells: number;
  /** Routine upkeep per cell per game day, on roads you built or paved (upkeep.ts). */
  routineUpkeepDirtPerCell: number;
  routineUpkeepPavedPerCell: number;
  /** Bridge cells cost this many times a road cell to keep. */
  routineUpkeepBridgeMultiplier: number;
  /** Game days the world runs before the player arrives (start.ts). */
  warmUpDays: number;
  /**
   * Systems switched on (docs/brief.md, Slice zero). Slice zero is roads,
   * buses and danfos; each of these comes back one per playtest. Off means
   * the system doesn't run and its actions are refused -- built and tested,
   * not deleted.
   */
  wearEnabled: boolean;
  goodsEnabled: boolean;
  railEnabled: boolean;
  straightAlignmentEnabled: boolean;
  /** Mean seconds a waiting passenger stays before giving up. */
  patienceSeconds: number;
  /** Gravity demand: passengers/sec = k * popA * popB / distance. */
  demandK: number;
  fare: number;
  roadCostPerCell: number;
  busCapacity: number;
  busSpeed: number;
  busPurchaseCost: number;
  busOperatingCostPerSecond: number;
  /** A minibus for thin routes (world.ts addMinibus): fewer seats, much cheaper to run. */
  minibusCapacity: number;
  minibusSpeed: number;
  minibusPurchaseCost: number;
  minibusOperatingCostPerSecond: number;
  minibusRoadSpace: number;
  /** Revision 1: a BRT bus (world.ts addBrt) -- articulated, many seats, runs only on bus lanes. */
  brtCapacity: number;
  brtSpeed: number;
  brtPurchaseCost: number;
  brtOperatingCostPerSecond: number;
  brtRoadSpace: number;
  danfoCapacity: number;
  danfoSpeed: number;
  kekeCapacity: number;
  kekeSpeed: number;
  okadaCapacity: number;
  okadaSpeed: number;
  /** Road space each informal mode takes, in danfo-equivalents (its congestion weight). */
  danfoRoadSpace: number;
  kekeRoadSpace: number;
  okadaRoadSpace: number;
  /** Informal road space per segment, in danfo-equivalents (principles §3: cap per corridor). */
  /** Informal road budget on a paved road, danfo-equivalents, your vehicles included. */
  informalRoadSpace: number;
  /** The same on a dirt road. */
  informalRoadSpaceDirt: number;
  /** Revision 1, 1b: the bus lane (world.ts addBusLane, pushback.ts). */
  /** The danfos' road space on a road with a bus lane (they lost a lane). */
  informalRoadSpaceLane: number;
  /** General traffic's share of a road's capacity once a lane is yours. */
  laneGeneralCapacity: number;
  /** A bus lane's own capacity, road space entering per second (as roadFlowCapacity): past it your buses bunch and slow. */
  busLaneCapacity: number;
  /** A bus lane's price, as a share of what paving that road costs. */
  busLaneCostShare: number;
  /** Of townGrowthCap, what a town whose best road has a bus lane can reach (paved: 1). */
  growthCapLaneShare: number;
  /** Of townGrowthCap, what a town with a working station (or halt) can reach. */
  growthCapRailShare: number;
  /** "Road is full" suggests a bus lane only where this many trips a day are wanted along the road (a few BRT loads). */
  laneMinTripsPerDay: number;
  /** Days after a lane opens before the first strike (strictly enforced); days between strikes, strict and lax; how long one lasts. */
  strikeDelayDays: number;
  /** The union announces a strike this many days ahead (Decisions log, proposed). */
  strikeNoticeDays: number;
  /** A named project's set-aside lapses to the treasury after this many days unbuilt (project.ts). */
  projectLapseDays: number;
  /** Settling an announced strike: this share of what it would cost you, at least settlementMin. */
  settlementShare: number;
  settlementMin: number;
  strikeEveryStrictDays: number;
  strikeEveryLaxDays: number;
  strikeDays: number;
  /** Lax enforcement: the share of the lane danfos take a day; strict: the share cleared a day. */
  encroachmentPerDay: number;
  encroachmentClearPerDay: number;
  /** Strict enforcement's cost, a cell of lane a day. */
  enforcementPerCellPerDay: number;
  startingFunds: number;
  /** Time constant for every rolling rate the player reads. */
  outcomeTauSeconds: number;
  // Rail (step 4, rail.ts).
  /** New track per flat cell -- the rail exchange rate onto pathing/cost.ts. */
  railCostPerCell: number;
  /** How much harder gradients bite rail than road (track hates climbs). */
  railGradientMultiplier: number;
  /** Restoring inherited track, per cell of it. */
  railRestoreCostPerCell: number;
  /** A halt: how near a line must pass a town, and the platform's fixed price (plus the spur, at railCostPerCell). */
  haltReachCells: number;
  /** The inherited narrow-gauge line's speed limit, as a share of a train's speed on new track (wear.ts lineSpeed). */
  oldLineSpeed: number;
  haltCost: number;
  trainCapacity: number;
  trainSpeed: number;
  trainPurchaseCost: number;
  trainOperatingCostPerSecond: number;
  /** Condition track loses per second per train entering it per second (wear.ts); weather as for roads. */
  railWearPerTrain: number;
  /** Below this condition, track is under a slow order... */
  railSlowOrderBelow: number;
  /** ...and trains on it run at this share of their speed. */
  railSlowOrderSpeed: number;
  // Goods (step 4, goods.ts).
  /** Towns at least this big (thousands) are markets: produce goes to the nearest one. */
  marketPopulation: number;
  /** Share of the produce delivered to a market that it sends on to the port as export. */
  exportShare: number;
  /** Freight trains (goods.ts): goods on track. */
  freightCapacity: number;
  freightSpeed: number;
  freightPurchaseCost: number;
  freightOperatingCostPerSecond: number;
  /** Tonnes of produce a farm town sends a day, per thousand people. */
  producePerThousandPerDay: number;
  /** Tonnes of supplies the port sends a town a day, per thousand people there. */
  suppliesPerThousandPerDay: number;
  /** Mean seconds goods wait at a yard before spoiling. */
  goodsSpoilSeconds: number;
  /** Freight fares, per tonne delivered. */
  produceFare: number;
  suppliesFare: number;
  /** Goods pay this per tonne per cell along the road or track (fares.ts goodsFares). */
  goodsFarePerTonneCell: number;
  /**
   * Freight rates (freightrates.ts): on; what a cheap and a dear line earn, as a multiple of the
   * goods fare; how much keener the hauliers are against a dear line (and less against a cheap
   * one); the rate every line starts at (for measuring). Run files without them replay as played.
   */
  freightRatesEnabled: boolean;
  /**
   * The region (region.ts; brief, The region): the seed's map as the home cluster of a region
   * 2.5 times as wide and tall, with three more clusters, a coast and its port. Run files
   * without it drew the slice map, and replay on it.
   */
  regionEnabled: boolean;
  /**
   * The steel chain (steel.ts; brief, More industries, more chains): on; steel a town wants,
   * tonnes per thousand people a day; the works' capacity and the port's imports as shares of
   * day 1's want; tonnes of ore a tonne of steel takes; what the mine digs a day; restoring the
   * idle works; how far past its start a town grows before it needs steel; jobs at the works,
   * the mine and the terminal, thousands. Run files without it replay without steel.
   */
  steelEnabled: boolean;
  steelPerThousandPerDay: number;
  steelWorksShare: number;
  steelImportShare: number;
  orePerSteel: number;
  mineOutputPerDay: number;
  steelRestoreCost: number;
  steelFreeShare: number;
  jobsSteelworks: number;
  jobsMine: number;
  freightRateCheap: number;
  freightRateDear: number;
  freightHaulierPull: number;
  freightRateDefault?: "cheap" | "standard" | "dear";
  lorryCapacity: number;
  lorrySpeed: number;
  lorryPurchaseCost: number;
  lorryOperatingCostPerSecond: number;
  /** Road space a lorry takes, in danfo-equivalents. */
  lorryRoadSpace: number;
  /** A lorry's road space wears a road this many times what the same road space of anything else does. */
  lorryWearMultiplier: number;
  // Growth of the original towns (step 4, growth.ts).
  /** A town can grow to this much above its starting size (0.5 = +50%). */
  townGrowthCap: number;
  /** Revision 1: the share of townGrowthCap a town whose best road is dirt can reach (paved: all of it). */
  growthCapDirtShare: number;
  /** Below this share of a town's trips carried by you, it doesn't grow. */
  growthMinPlayerShare: number;
  /** Service (yours + half the informal share) where growth starts, and where it's full. */
  growthServiceFloor: number;
  growthServiceFull: number;
  /** How slowly a town's population follows the size its service supports. */
  townGrowthTauSeconds: number;
  // Wear (step 4, wear.ts).
  /** Condition the inherited roads start at, 0.3..1 (map/decay.ts floors it at 0.3). */
  inheritedRoadCondition: number;
  /** Condition a paved road loses per second to weather alone. */
  weatherPerSecond: number;
  /** Condition a paved road loses per second per unit of traffic flow (road space entering per second). */
  wearPerFlow: number;
  /** Dirt wears this many times faster than paved. */
  dirtWearMultiplier: number;
  /** A road with a bridge on it wears this many times faster. */
  bridgeWearMultiplier: number;
  /** Repair price as a multiple of pathing/cost.ts maintenanceCost at the slice's exchange rate. */
  repairCostScale: number;
  /** Extra running cost of a road vehicle on a road at the wear floor, as a share of its own (wear.ts roughCostFactor). */
  roughRoadCostMax: number;
  /** Inside-town trips per thousand people per day -- informal's own ground (world.ts localTravel). */
  localTripsPerThousandPerDay: number;
  /** Town size (thousands) at which half your riders reach the bus by keke or okada. */
  walkableTownPopulation: number;
  /** Danfos and buses slow each other down on shared road (step 2, congestion.ts). */
  congestion: boolean;
  /** Road space a bus takes, in danfo-equivalents. */
  busRoadSpace: number;
  /** Capacity of a built road: road space (danfo-equivalents) entering per second before it slows. */
  roadFlowCapacity: number;
  /** An inherited dirt road carries this fraction of a built road. */
  dirtRoadCapacity: number;
  /** Jammed traffic still crawls: speed never falls below this share of free flow. */
  minSpeedFactor: number;
  /** An informal operator won't set off onto a road slower than this (principles §3). */
  informalMinSpeed: number;

  // Towns along busy roads (settlement.ts).
  /** Time constant for each road's rolling traffic flow. */
  flowTauSeconds: number;
  settlementCheckSeconds: number;
  /** Riders/sec past a point a road needs before a town grows on it. */
  foundTownFlow: number;
  /** ...of which at least this much must be your buses. */
  foundTownPlayerFlow: number;
  /** No town within this many cells of another; roads shorter than twice this never get one. */
  townSpacingCells: number;
  maxEmergentTowns: number;
  minSecondsBetweenTowns: number;
  newTownPopulation: number;
  /** Thousands of people an emergent town supports per rider/sec passing through it. */
  populationPerFlow: number;
  maxEmergentPopulation: number;
  townPopulationTauSeconds: number;
  /** An emergent town that shrinks below this is abandoned. */
  abandonBelowPopulation: number;
  /** A corridor is taken when you carry this share of the trips along it, judged daily (corridors.ts; brief: pushback at ~40%). */
  corridorTakenShare: number;
  /** ...and let go only below this, so one near the line doesn't flicker. */
  corridorReleaseShare: number;
  /** Industries (industries.ts, brief Revision 2): on, when the first opens, the gap between openings, how many at once. */
  industriesEnabled: boolean;
  industryFirstDay: number;
  industryEveryMinDays: number;
  industryEveryMaxDays: number;
  industryMaxOpen: number;
  /** An industry nothing is moved from in its first this-many days closes. */
  industryGraceDays: number;
  industryMinDeliveredPerDay: number;
  /** Its workers, thousands: the site's own (small) passenger demand. */
  industryWorkers: number;
  /** A quarry's output, tonnes a day, its working life (days, min-max), and the share of its stone that goes to the port. */
  quarryOutputPerDay: number;
  quarryLifeMinDays: number;
  quarryLifeMaxDays: number;
  quarryExportShare: number;
  /** A town getting all the stone it wants can grow this share of townGrowthCap more (growth.ts). */
  stoneCapShare: number;
  /**
   * The fuel chain (fuel.ts, brief Revision 3): on; fuel a town burns, tonnes per thousand people a
   * day; the tank farm's imports and a restored refinery's capacity, each a share of the towns' need
   * at the start; the crude source's output, the same way; what restoring the refinery costs.
   */
  fuelEnabled: boolean;
  fuelPerThousandPerDay: number;
  fuelImportShare: number;
  refineryShare: number;
  crudeShare: number;
  refineryRestoreCost: number;
  /**
   * The second refinery (fuel.ts, Revision 4, step 4): a private one that opens mid-game,
   * between these days; what it can make and the crude it wants, as shares of day 1's fuel
   * need. Run files without them replay without it, as played.
   */
  newRefineryEnabled: boolean;
  newRefineryDayMin: number;
  newRefineryDayMax: number;
  newRefineryShare: number;
  newRefineryCrudeShare: number;
  /** Fuel and crude waiting at a yard are lost far slower than produce spoils (seconds, the time constant). */
  fuelLossSeconds: number;
  /**
   * What a shortage does (fuel.ts, step 1b), each at a total shortage: danfo fares rise by this
   * share; this share of the danfos' road space on roads into the town is parked; riders wait this
   * much longer for your vehicles (1: twice as long); your vehicles pay this much more to run.
   */
  fuelFarePremium: number;
  fuelParked: number;
  fuelPatience: number;
  fuelCostPremium: number;
  /**
   * The building chain (cement.ts, brief Revision 3, step 2a): on; cement a town wants, tonnes per
   * thousand people a day; the works' capacity and an idle map's imports, each a share of the towns'
   * want at the start; tonnes of limestone a tonne of cement takes; restoring an idle works; the
   * chance a map's works starts idle; how soon a quarry opens once it's restored (days); the stretch a
   * town grows without cement, a share of its start.
   */
  cementEnabled: boolean;
  cementPerThousandPerDay: number;
  cementWorksShare: number;
  cementImportShare: number;
  limestonePerCement: number;
  worksRestoreCost: number;
  cementIdleChance: number;
  quarryAfterRestoreDays: number;
  cementFreeShare: number;
  /**
   * Sites need people (workers.ts, brief Revision 3, step 2b): on; jobs at each kind of site,
   * thousands, working (an idle one keeps `jobsIdle`); commute trips a day each way per thousand
   * jobs, from towns within `commuteReachCells`; a site's output at nobody arriving
   * (`staffFloor`), and the share of its commutes made that's a full shift (`staffFullShare`).
   */
  workersEnabled: boolean;
  jobsRefinery: number;
  jobsWorks: number;
  jobsQuarry: number;
  jobsDepot: number;
  jobsSilo: number;
  jobsIdle: number;
  commutePerThousandJobs: number;
  commuteReachCells: number;
  staffFloor: number;
  staffFullShare: number;
  /**
   * Towns grow around sites (workers.ts, step 2c): people a town's room to grow gains per job its
   * people hold at a site they reach, at most `jobsCapShare` of its start; a site with at least
   * `gateTownMinJobs` (thousands) that has worked staffed for `gateTownDays` grows a camp at its gate.
   */
  peoplePerJob: number;
  jobsCapShare: number;
  gateTownMinJobs: number;
  gateTownDays: number;
  /** Private truckers (truckers.ts, brief Revision 2): on, how fast they take waiting goods, the longest haul they take, their trucks, their cut of the fare, the loading levy. */
  truckersEnabled: boolean;
  truckerPickupSeconds: number;
  truckerMaxHaulCells: number;
  /** How far tankers take fuel (fuel.ts): much further than truckers take other goods. */
  tankerMaxHaulCells: number;
  truckLoad: number;
  truckSpeed: number;
  truckerFareShare: number;
  loadingLevyPerTonne: number;
  /** A retired road is gone after this many days (retire.ts), and track on its alignment costs this share of new track. */
  retireGoneDays: number;
  railOnRoadShare: number;
  /** Trains a piece of track carries, passenger and freight together (rail.ts lineSlots). */
  trackSlots: number;
  /** Trips between two stops of the same passenger line rise by this share (rail.ts applyRailDemand). */
  railInducedDemand: number;
  /** A town a passenger train stops at can grow this share of townGrowthCap more (growth.ts). */
  stationCapShare: number;
}

export interface GameWorld {
  /** The home cluster's box on a region map (region.ts): where the camera starts. Absent: all of it. */
  /** Each cluster's union and its chairman (union.ts); absent when the union is off. */
  unions?: UnionState[];
  /** What the union did between ticks (an answer, an action's effect), reported with the next tick's events. */
  union?: { events: GameEvent[] };
  /** The region's far clusters and their offers (clusters.ts); absent on the slice map. */
  /** The fords and the rains (floods.ts); absent when the floods are off. */
  floods?: FloodState;
  /** Your names and colours for routes and roads (labels.ts), by key; absent until you name one. */
  labels?: Record<string, import("./labels").Label>;
  /** Each river's named crossings (crossings.ts); absent when they're off. */
  crossings?: Crossing[];
  clusters?: ClusterDef[];
  home?: { x: number; y: number; width: number; height: number };
  /** The map's rivers and sea as drawn lines, for the screen to draw smooth (the terrain's water is their cells). */
  waterLines?: GameRiverDef[];
  /** Money over the last game day: what the strip and route rows read (ledger.ts). */
  ledger: DayLedger;
  /** Sim time when the player's day 1 began: after the warm-up (start.ts), 0 for a cold world. */
  startSeconds: number;
  /** A sample of the headline and net at the end of each game day, for the 5-day averages (history.ts). */
  history: DayHistory;
  /** Money in since day 1, by line (budget.ts). */
  budget: BudgetTally;
  /** The treasury remittance's current period (budget.ts). */
  remittance: RemittancePeriod;
  /** The rung you're saving for, which the remittance leaves alone for a while (project.ts). */
  project: NamedProject | null;
  /** Each town's population (thousands) on day 1: the allocation pays on growth since. */
  startPopulation: Map<string, number>;
  /** Each town's growth milestones passed since day 1 (score.ts). */
  milestones: Map<string, MilestoneState>;
  /** Each corridor's levies and whether you've taken it, keyed routeKey(a, b) of its end towns (corridors.ts). */
  corridors: Map<string, CorridorState>;
  /** Industrial sites open now, and the drawing of the next (industries.ts). */
  industries: Map<string, IndustryState>;
  industrySchedule: { nextAtSeconds: number; rngState: number; opened: number };
  /** The fuel chain's sites and state (fuel.ts); null until placed, or with fuel off. */
  fuel: FuelState | null;
  /** The building chain's works and state (cement.ts); null until placed, or with it off. */
  cement: CementState | null;
  /** The steel chain (steel.ts); null until placed, with it off, or in a run file from before it. */
  steel: SteelState | null;
  /** Each site's staffed days and the camp at its gate (workers.ts). */
  sites: SitesState;
  /** Bonds issued, paid off or not (bonds.ts). */
  bonds: Bond[];
  /** The budget year and its sweep (sweep.ts). */
  sweep: SweepState;
  /** The term, its pledges and the record of terms past (term.ts); absent when pledges are off. */
  term?: TermState;
  /** Towns and sites with a haulage yard (yards.ts). */
  yards: Set<string>;
  /** Towns with a motor park (parks.ts). */
  parks: Set<string>;
  /** At each parked town, the park levy a second, rolling: yours, and the agberos' (parks.ts, the town card). */
  parkTakings: Map<string, { yours: number; agberos: number }>;
  /** Metro lines built, by town (metro.ts). */
  metros: Map<string, number>;
  /** Freight lines charging other than the standard rate (freightrates.ts), by route id. */
  freightRates: Map<string, "cheap" | "dear">;
  /** Times each site has been expanded (expand.ts), by its id. */
  expansions: Map<string, number>;
  /** The food chain's mill and crops (food.ts); null until placed, or with food off. */
  food: FoodState | null;
  /** Goods truckers hold at yards, filling a truck (truckers.ts). */
  truckers: TruckerHeld;
  width: number;
  height: number;
  towns: Map<string, GameTown>;
  tuning: GameTuning;
  simulation: SimulationState;
  economy: EconomyState;
  routes: GameRoute[];
  informal: InformalState;
  /** pairKey (`from:to`) -> where that trip's passengers went. Town and network shares are sums of these. */
  pairOutcomes: Map<string, OutcomeRates>;
  /** pairOutcomes summed by town, this tick (world.ts indexOutcomes); null when not built or stale. */
  outcomeIndex: OutcomeIndex | null;
  settlement: SettlementState;
  /** Emergent towns that faded: kept so their names can stay on the map. */
  ruins: Map<string, GameTown>;
  /** segmentId -> road space on the road this tick (congestion.ts). */
  segmentLoad: Map<string, number>;
  /** segmentId -> rolling road space entering per second: what congests it. */
  roadFlowEMA: Map<string, number>;
  /** Private cars on each road (private.ts), worked out once a game day; absent when private traffic is off. */
  privateFlow?: Map<string, number>;
  privateFlowAtSeconds?: number;
  /** segmentId -> rolling flow of your vehicles in a bus lane, and the speed it allows (congestion.ts). */
  laneFlowEMA: Map<string, number>;
  laneSpeed: Map<string, number>;
  /** vehicleId -> the leg (segment#pathIndex) it was on last tick, to detect entering. */
  vehicleSegment: Map<string, string>;
  /** segmentId -> speed as a share of free flow this tick. What slows a bus is what the map draws. */
  segmentSpeed: Map<string, number>;
  /** Corridors with a bus lane: enforcement, encroachment, the union's strikes (pushback.ts). */
  lanes: LaneState[];
  /** The rail network (rail.ts): in-service track only. `simulation.routing` is roads only. */
  railRouting: RoutingContext;
  railPathCache: Map<string, PathResult | null>;
  /** Planned new track by `a:b` (rail.ts planRail). */
  railPlans: Map<string, RoadPlan | null>;
  /** Inherited track not yet restored -- on the map, not in the rail network. */
  railOutOfService: Set<string>;
  /** Vehicles that run on rail (trains): road systems skip them. */
  railVehicles: Set<string>;
  /** segmentId -> rolling trains entering each stretch of track per second (wear.ts). */
  railFlowEMA: Map<string, number>;
  /** Lorry routes (goods.ts) -- apart from `routes`, which every passenger system reads. */
  lorryRoutes: GameRoute[];
  /** Goods waiting at each town's yard, and where each flow's goods ended up. */
  goods: GoodsState;
  /** Where supplies come from (the map def's port). */
  port: string | undefined;
  /** The map's seaport (gateways.ts); absent on maps drawn before it was kept. */
  seaport?: string;
  /** The border crossing's site id (border.ts); absent without one. */
  border?: string;
  /** segmentId -> rolling road space entering per second from lorries alone (heavier wear). */
  heavyFlowEMA: Map<string, number>;
  /** The original towns' starting sizes, thousands (growth.ts caps growth relative to these). */
  basePopulation: Map<string, number>;
  /** Roads you maintain (wear.ts): repaired as they wear, billed as they go. */
  maintained: Set<string>;
  /** segmentId -> what maintaining it is costing, currency per second, rolling. */
  upkeepRateEMA: Map<string, number>;
  /** segmentId -> cells of it that are bridge (wear.ts bridgeCellsOn). */
  bridgeCells: Map<string, number>;
  /** segmentId -> rolling extra running cost your vehicles pay on it for its wear, per second (wear.ts). */
  roughCostRateEMA: Map<string, number>;
  /** townId -> rolling riders per second changing buses there. */
  transferRateEMA: Map<string, number>;
  /** How riders cross your network (transfers.ts). Null = stale; rebuilt on next use. */
  plans: TripPlans | null;
  /** pairKey -> road path, or null if the pair isn't connected. Cleared on every road change. */
  pathCache: Map<string, PathResult | null>;
  /** The map's region (generate.ts NameRegion: "north", "southSouth"...): what the 3D view draws its land as. Nothing simulated reads it. */
  region?: string;
  /** Planned roads by `a:b` (roads.ts planRoad). Terrain never changes, so plans never go stale. */
  roadPlans: Map<string, RoadPlan | null>;
  nextId: number;
}
