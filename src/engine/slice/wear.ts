import type { Segment } from "../map/types";
import { MIN_CONDITION, conditionSpeedFactor } from "../map/decay";
import { BASE_COST_PER_CELL, BRIDGE_PREMIUM_PER_CELL, maintenanceCost } from "../pathing/cost";
import { canAfford } from "../economy/state";
import { chainOf } from "./world";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import type { SliceWorld } from "./types";
import { isDirt } from "./congestion";
import { overWater, polylineLength, segmentLength, segmentPolyline, splitPolyline } from "./roads";

// Roads wear (docs/principles.md §6, step 4: depth, one at a time -- decay
// first). Wear follows use: every road loses condition with the traffic on
// it, plus a little weathering. Dirt wears faster than paved, and a bridge
// faster still -- the network fails at its crossings, which are exactly the
// links that can't be routed round (principles §3, Bridges). A worn road
// slows everything on it, your buses and the danfos alike
// (map/decay.ts conditionSpeedFactor), floored: friction, not failure
// (§4 defers the failure state).
//
// The decision is which roads to keep up, not when to click "repair": a
// road you maintain is repaired now and then as it wears, billed as it
// goes (pathing/cost.ts maintenanceCost, the one place geometry becomes
// money). Upkeep competes with buses for the same money, and a busy dirt
// road costs the most to keep -- a second reason to pave it.

/** A bridge cell costs (base + premium) / base times a ground cell to build, and the same to repair. */
const BRIDGE_REPAIR_MULTIPLIER = (BASE_COST_PER_CELL + BRIDGE_PREMIUM_PER_CELL) / BASE_COST_PER_CELL;
/** How quickly a road's displayed upkeep follows what it's costing. */
const UPKEEP_TAU_SECONDS = 2 * SECONDS_PER_GAME_DAY;

/** Cells of a road that are bridge (sampled every half cell along it), cached per segment. */
export function bridgeCellsOn(world: SliceWorld, segment: Segment): number {
  const cached = world.bridgeCells.get(segment.id);
  if (cached !== undefined) return cached;
  const line = segmentPolyline(world.simulation.map, segment);
  const length = polylineLength(line);
  let wet = 0;
  for (let at = 0.25; at < length; at += 0.5) if (overWater(world, splitPolyline(line, at)[1][0]!)) wet += 0.5;
  world.bridgeCells.set(segment.id, wet);
  return wet;
}

/** Condition lost per second on this road (or track) at its current traffic. */
export function wearRate(world: SliceWorld, segment: Segment): number {
  const { tuning } = world;
  const bridged = bridgeCellsOn(world, segment) > 0 ? tuning.bridgeWearMultiplier : 1;
  if (segment.type === "rail") {
    // Track: weather, plus every train that runs over it. No dirt to it.
    return (tuning.weatherPerSecond + tuning.railWearPerTrain * (world.railFlowEMA.get(segment.id) ?? 0)) * bridged;
  }
  // A lorry's road space wears `lorryWearMultiplier` times harder: count
  // its share of the flow that many times over.
  const flow = (world.roadFlowEMA.get(segment.id) ?? 0) + (tuning.lorryWearMultiplier - 1) * (world.heavyFlowEMA.get(segment.id) ?? 0);
  const surface = isDirt(segment) ? tuning.dirtWearMultiplier : 1;
  return (tuning.weatherPerSecond + tuning.wearPerFlow * flow) * surface * bridged;
}

/** What buying back `deficit` condition on a road costs, all of it. */
export function repairCost(world: SliceWorld, segment: Segment, deficit: number): number {
  const bridge = bridgeCellsOn(world, segment);
  const ground = Math.max(0, segmentLength(world, segment) - bridge);
  const units = maintenanceCost(ground, deficit) + maintenanceCost(bridge, deficit) * BRIDGE_REPAIR_MULTIPLIER;
  // Track is repaired at a road's price per cell, not track's: building
  // track pays for the formation and the rails, upkeep for ballast and
  // sleepers. At track's price, keeping a line up cost 2-3x what it saved
  // (probe: Ilase-Owode upkeep 112/day for ~60/day back), and nobody would.
  return units * (world.tuning.roadCostPerCell / BASE_COST_PER_CELL) * world.tuning.repairCostScale;
}

/** How fast a road's (or track's) condition lets traffic go, 0..1 of free speed. */
export function wearSpeed(world: SliceWorld, segment: Segment): number {
  return conditionSpeedFactor(segment.condition) * slowOrder(world, segment);
}

/**
 * Track below `railSlowOrderBelow` runs under a slow order: trains held to
 * `railSlowOrderSpeed` of line speed, on top of the wear every vehicle
 * feels. How railways actually degrade -- and without it worn track barely
 * touched a fast train (probe: a line at the floor still made all but
 * ~37/day of its fares), so keeping track up was never worth deciding.
 * 1 for roads and sound track. congestion.ts publishes it as the track's
 * speed, so it slows the train the map draws.
 */
export function slowOrder(world: SliceWorld, segment: Segment): number {
  if (segment.type !== "rail" || segment.condition >= world.tuning.railSlowOrderBelow) return 1;
  return world.tuning.railSlowOrderSpeed;
}

/**
 * How fast a train may run on track, before wear: the old line is narrow
 * gauge -- tight curves, light rail, a low line speed -- and new track is
 * built to standard gauge (principles §3, Eras: rail "returns as standard
 * gauge"). It's what makes restoring the old line a real trade: cheap and
 * slow against dear and fast. Without it, the old line restored as far as
 * a new halt at Owode earned exactly what new track did (+₦318 vs +₦312 a
 * day) for ₦240 less, and there was nothing to weigh. Times the slow
 * order on worn track. 1 for roads.
 */
export function lineSpeed(world: SliceWorld, segment: Segment): number {
  if (segment.type !== "rail") return 1;
  return (segment.provenance === "inherited" ? world.tuning.oldLineSpeed : 1) * slowOrder(world, segment);
}

/**
 * Wears every road for this tick and repairs the maintained ones as they
 * go. Returns what the repairs cost, for the tick to charge with the rest
 * of the running costs (so it shows in net/day).
 */
export function updateRoadWear(world: SliceWorld, dt: number): number {
  let spent = 0;
  const alpha = 1 - Math.exp(-dt / UPKEEP_TAU_SECONDS);
  for (const segment of world.simulation.map.segments) {
    // Disused track stays as it is until restored: nothing runs on it.
    if (world.railOutOfService.has(segment.id)) continue;
    const before = segment.condition;
    const worn = Math.max(MIN_CONDITION, before - wearRate(world, segment) * dt);
    let cost = 0;
    if (world.maintained.has(segment.id)) {
      cost = repairCost(world, segment, before - worn);
      segment.condition = before;
    } else {
      segment.condition = worn;
    }
    spent += cost;
    const previous = world.upkeepRateEMA.get(segment.id) ?? 0;
    world.upkeepRateEMA.set(segment.id, previous + (cost / dt - previous) * alpha);
  }
  return spent;
}

/** What a maintained road costs a day, at its traffic now. */
export function upkeepPerDay(world: SliceWorld, segment: Segment): number {
  // Steady state: wear repaired as it happens, so cost per second is the
  // repair price of one second's wear.
  return repairCost(world, segment, wearRate(world, segment)) * SECONDS_PER_GAME_DAY;
}

export type MaintainResult = { ok: true; charged: number } | { ok: false; reason: string };

/**
 * Starts or stops maintaining a road. Starting repairs it to new now (the
 * catch-up is charged at once, and refused if you can't afford it), then
 * keeps it there. Stopping costs nothing; the road starts wearing again.
 */
export function setMaintained(world: SliceWorld, segmentId: string, on: boolean): MaintainResult {
  const segment = world.simulation.map.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) return { ok: false, reason: "no such road" };
  if (!on) {
    world.maintained.delete(segmentId);
    return { ok: true, charged: 0 };
  }
  const catchUp = repairCost(world, segment, 1 - segment.condition);
  if (!canAfford(world.economy, catchUp)) return { ok: false, reason: "can't afford the repair" };
  world.economy.funds -= catchUp;
  segment.condition = 1;
  world.maintained.add(segmentId);
  return { ok: true, charged: catchUp };
}

/**
 * Maintains (or stops maintaining) the whole road a piece belongs to --
 * through any roadside towns that have split it -- as one decision. Track
 * is kept per piece. The catch-up repair for all of it is charged at once,
 * and refused as one if you can't afford it.
 */
export function setRoadMaintained(world: SliceWorld, segmentId: string, on: boolean): MaintainResult & { pieces: number } {
  const pieces = chainOf(world, segmentId)?.pieces.map((piece) => piece.id) ?? [segmentId];
  if (on) {
    const catchUp = pieces.reduce((sum, id) => {
      const segment = world.simulation.map.segments.find((candidate) => candidate.id === id);
      return sum + (segment && !world.maintained.has(id) ? repairCost(world, segment, 1 - segment.condition) : 0);
    }, 0);
    if (!canAfford(world.economy, catchUp)) return { ok: false, reason: "can't afford the repair", pieces: pieces.length };
  }
  let charged = 0;
  for (const id of pieces) {
    if (on && world.maintained.has(id)) continue;
    const result = setMaintained(world, id, on);
    if (result.ok) charged += result.charged;
  }
  return { ok: true, charged, pieces: pieces.length };
}

/**
 * Extra running cost a road vehicle pays on this road, as a share of its
 * own: 0 on a road in good condition, `roughRoadCostMax` at the floor.
 *
 * The biggest real cost of a bad road isn't time, it's the vehicles: fuel,
 * tyres, springs, breakdowns -- what road agencies' vehicle-operating-cost
 * models (World Bank HDM-4) put at the centre of every maintenance case.
 * Without it the lever audit found maintenance never paid: you paid to
 * repair wear mostly made by danfos and okadas, and got back only a little
 * speed (−₦88/day net on the trunk over 30 days). With it, keeping up a
 * road your own buses wear down pays; keeping up one only danfos use
 * doesn't -- which is the decision.
 *
 * Track: none here -- worn track costs through slow orders instead.
 */
export function roughCostFactor(world: SliceWorld, segment: Segment): number {
  if (segment.type === "rail") return 0;
  const roughness = (1 - segment.condition) / (1 - MIN_CONDITION);
  return world.tuning.roughRoadCostMax * Math.max(0, Math.min(1, roughness));
}

/**
 * Charges your road vehicles the extra running cost of the road each is on
 * this tick. Returns the total (for the funds), per route (for its row) and
 * per road (for the Fix tool: what a worn road is costing *you*).
 */
export function chargeRoughRoads(world: SliceWorld, dt: number, routeOf: ReadonlyMap<string, string>): { total: number; byRoute: Map<string, number> } {
  const byRoute = new Map<string, number>();
  const bySegment = new Map<string, number>();
  let total = 0;
  for (const vehicle of world.simulation.vehicles) {
    const routeId = routeOf.get(vehicle.id);
    const econ = world.economy.vehicleEconomics.get(vehicle.id);
    const leg = world.vehicleSegment.get(vehicle.id);
    if (!routeId || !econ || !leg) continue;
    const segmentId = leg.slice(0, leg.lastIndexOf("#"));
    const segment = world.simulation.map.segments.find((candidate) => candidate.id === segmentId);
    if (!segment) continue;
    const extra = econ.operatingCostPerSecond * roughCostFactor(world, segment) * dt;
    if (extra <= 0) continue;
    total += extra;
    byRoute.set(routeId, (byRoute.get(routeId) ?? 0) + extra);
    bySegment.set(segmentId, (bySegment.get(segmentId) ?? 0) + extra);
  }
  const alpha = 1 - Math.exp(-dt / UPKEEP_TAU_SECONDS);
  for (const segment of world.simulation.map.segments) {
    const previous = world.roughCostRateEMA.get(segment.id) ?? 0;
    world.roughCostRateEMA.set(segment.id, previous + ((bySegment.get(segment.id) ?? 0) / dt - previous) * alpha);
  }
  world.economy.funds -= total;
  return { total, byRoute };
}

/** What this road's wear costs your vehicles a day, at the traffic now (rolling). */
export function roughCostPerDay(world: SliceWorld, segment: Segment): number {
  return (world.roughCostRateEMA.get(segment.id) ?? 0) * SECONDS_PER_GAME_DAY;
}

/** Each road's condition, keyed by segment, for tickVehicle's speed. */
export function segmentConditions(world: SliceWorld): Map<string, number> {
  return new Map(world.simulation.map.segments.map((segment) => [segment.id, segment.condition]));
}
