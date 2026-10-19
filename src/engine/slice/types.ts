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
import type { IndustryState } from "./industries";
import type { BudgetTally, RemittancePeriod } from "./budget";

// The slice (docs/principles.md §6): the smallest loop that can be felt --
// towns, straight roads, one bus type, passengers who give up, and the
// danfos that carry the ones who did. Everything here is a plain mirror;
// engine/ stays content-unaware (architecture hard rule 2), so the
// bootstrap layer hands in a SliceMapDef rather than this module loading
// one.

export interface SliceTown {
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
export type IndustryKind = "quarry";

export interface SliceRoadDef {
  a: string;
  b: string;
}

export interface SliceRiverDef {
  /** Centre line, map cells. */
  points: Array<[number, number]>;
  /** Width in cells. */
  width: number;
  /** Width at each point, in cells, narrowing or widening between them (variation.ts); absent means `width` throughout. */
  widths?: number[];
}

export interface SliceHillDef {
  x: number;
  y: number;
  radius: number;
  /** Elevation at the top; a road pays for every unit it climbs or descends (pathing/cost.ts). */
  height: number;
}

export interface SliceMapDef {
  width: number;
  height: number;
  towns: SliceTown[];
  /** Inherited roads -- the network that already exists at start. Straight: they were built
   * for another age's needs and never fixed (principles §1, brownfield premise). */
  roads: SliceRoadDef[];
  /** Step 3: authored terrain. Absent means flat dry land. */
  terrain?: { rivers?: SliceRiverDef[]; hills?: SliceHillDef[] };
  /** Step 4: the port city, where supplies come from (goods.ts). Absent means no supplies. */
  port?: string;
  /** Step 4: inherited railway, straight and out of service until restored (rail.ts). */
  rails?: SliceRoadDef[];
}

/** A player route: an A<->B shuttle, running however many buses. */
export interface SliceRoute {
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

export type InformalMode = "danfo" | "keke" | "okada";

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

export interface SliceTuning {
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
}

export interface SliceWorld {
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
  width: number;
  height: number;
  towns: Map<string, SliceTown>;
  tuning: SliceTuning;
  simulation: SimulationState;
  economy: EconomyState;
  routes: SliceRoute[];
  informal: InformalState;
  /** pairKey (`from:to`) -> where that trip's passengers went. Town and network shares are sums of these. */
  pairOutcomes: Map<string, OutcomeRates>;
  settlement: SettlementState;
  /** Emergent towns that faded: kept so their names can stay on the map. */
  ruins: Map<string, SliceTown>;
  /** segmentId -> road space on the road this tick (congestion.ts). */
  segmentLoad: Map<string, number>;
  /** segmentId -> rolling road space entering per second: what congests it. */
  roadFlowEMA: Map<string, number>;
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
  lorryRoutes: SliceRoute[];
  /** Goods waiting at each town's yard, and where each flow's goods ended up. */
  goods: GoodsState;
  /** Where supplies come from (the map def's port). */
  port: string | undefined;
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
  /** Planned roads by `a:b` (roads.ts planRoad). Terrain never changes, so plans never go stale. */
  roadPlans: Map<string, RoadPlan | null>;
  nextId: number;
}
