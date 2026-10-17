import type { PathResult, RoutingContext, SimulationState } from "../simulation/types";
import type { EconomyState } from "../economy/types";
import type { SettlementState } from "./settlement";
import type { DayLedger } from "./ledger";
import type { TripPlans } from "./transfers";
import type { RoadPlan } from "./roads";
import type { GoodsState } from "./goods";
import type { DayHistory } from "./history";

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
}

export interface SliceRoadDef {
  a: string;
  b: string;
}

export interface SliceRiverDef {
  /** Centre line, map cells. */
  points: Array<[number, number]>;
  /** Width in cells. */
  width: number;
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
  /** Informal vehicleId -> what it is and the road space it occupies. */
  active: Map<string, { segmentIds: string[]; weight: number; mode: InformalMode }>;
  /** segmentId -> informal road space in use, in danfo-equivalents. */
  segmentSpace: Map<string, number>;
  /** Fares the informal sector has collected -- money you didn't make. */
  earnings: number;
}

export interface SliceTuning {
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
  informalRoadSpace: number;
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
}

export interface SliceWorld {
  /** Money over the last game day: what the strip and route rows read (ledger.ts). */
  ledger: DayLedger;
  /** Sim time when the player's day 1 began: after the warm-up (start.ts), 0 for a cold world. */
  startSeconds: number;
  /** A sample of the headline and net at the end of each game day, for the 5-day averages (history.ts). */
  history: DayHistory;
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
  /** vehicleId -> the leg (segment#pathIndex) it was on last tick, to detect entering. */
  vehicleSegment: Map<string, string>;
  /** segmentId -> speed as a share of free flow this tick. What slows a bus is what the map draws. */
  segmentSpeed: Map<string, number>;
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
