import type { Vehicle } from "../simulation/types";
import { rebuildFromMap } from "../simulation/simulate";
import type { SliceTown, SliceWorld } from "./types";
import { emptyOutcome, gravityDemand, pairKey } from "./world";
import { parsePoolKey, parseQueueKey } from "./tick";

// Towns that appear along busy roads, and -- rarely -- fade (step 3 of
// docs/principles.md §6). True to the setting: a roadside market grows
// where traffic stops, and is named for it -- "Mile 12", "Ilase Junction".
//
// Kept sparse by construction rather than by a probability knob: a town
// can only be founded at the middle of a road stretch at least twice the
// spacing long, and founding it splits that stretch into two halves too
// short to found on again. The road network itself bounds how many can
// ever appear; `maxEmergentTowns` is the backstop.
//
// Only emergent towns can fade, and only when the traffic that made them
// goes away (you built a bypass). The map's original towns are permanent.

export type SliceEvent =
  | { kind: "founded"; townId: string; name: string; between: [string, string] }
  | { kind: "abandoned"; townId: string; name: string };

export interface SettlementState {
  /** segmentId -> rolling riders per second passing a point on it. */
  segmentFlowEMA: Map<string, number>;
  /** The same, counting only your buses. */
  segmentPlayerFlowEMA: Map<string, number>;
  lastFoundedAtSeconds: number;
  nextCheckAtSeconds: number;
  /** townIds that grew during play -- the only ones that can fade. */
  emergent: Set<string>;
  elapsedSeconds: number;
}

export function createSettlementState(): SettlementState {
  return { segmentFlowEMA: new Map(), segmentPlayerFlowEMA: new Map(), lastFoundedAtSeconds: -Infinity, nextCheckAtSeconds: 0, emergent: new Set(), elapsedSeconds: 0 };
}

function segmentLength(world: SliceWorld, segmentId: string): number {
  const segment = world.simulation.map.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) return 0;
  const a = world.simulation.routing.positions.get(segment.fromNodeId)!;
  const b = world.simulation.routing.positions.get(segment.toNodeId)!;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Riders per second passing a point on each segment, this tick. Riders,
 * not vehicles: a market grows from people passing through, and counting
 * vehicles let empty buses inflate a town -- measured, 12 buses on one
 * route grew its roadside town to the cap and made over-busing pay for
 * itself, which deletes the fleet-size decision.
 */
function instantaneousFlow(world: SliceWorld, include: (vehicle: Vehicle) => boolean): Map<string, number> {
  const flow = new Map<string, number>();
  const { routing } = world.simulation;
  for (const vehicle of world.simulation.vehicles) {
    if (!include(vehicle)) continue;
    const length = vehicle.path.length;
    if (length < 2 || vehicle.pathIndex >= length) continue;
    const from = vehicle.path[(vehicle.pathIndex - 1 + length) % length]!;
    const to = vehicle.path[vehicle.pathIndex]!;
    const edge = routing.graph.get(from)?.find((candidate) => candidate.to === to);
    if (!edge || edge.weight <= 0) continue;
    // A vehicle at speed v on a segment of length L passes any given point
    // on it v/L times per second, averaged over its time on the segment.
    const riders = vehicle.cargo.reduce((sum, entry) => sum + entry.amount, 0);
    flow.set(edge.segmentId, (flow.get(edge.segmentId) ?? 0) + (riders * vehicle.speed) / edge.weight);
  }
  return flow;
}

export function updateSettlements(world: SliceWorld, dt: number): SliceEvent[] {
  const { settlement, tuning } = world;
  settlement.elapsedSeconds += dt;

  const alpha = 1 - Math.exp(-dt / tuning.flowTauSeconds);
  const flow = instantaneousFlow(world, () => true);
  const playerFlow = instantaneousFlow(world, (vehicle) => vehicle.lifecycle === "cyclic");
  for (const segment of world.simulation.map.segments) {
    const previous = settlement.segmentFlowEMA.get(segment.id) ?? 0;
    settlement.segmentFlowEMA.set(segment.id, previous + ((flow.get(segment.id) ?? 0) - previous) * alpha);
    const previousPlayer = settlement.segmentPlayerFlowEMA.get(segment.id) ?? 0;
    settlement.segmentPlayerFlowEMA.set(segment.id, previousPlayer + ((playerFlow.get(segment.id) ?? 0) - previousPlayer) * alpha);
  }

  // Populations drift every tick; founding and fading are checked once a
  // game day -- sustained state gates decisions (architecture hard rule 7).
  driftPopulations(world, dt);
  if (settlement.elapsedSeconds < settlement.nextCheckAtSeconds) return [];
  settlement.nextCheckAtSeconds = settlement.elapsedSeconds + tuning.settlementCheckSeconds;

  const events: SliceEvent[] = [];
  for (const townId of [...settlement.emergent]) {
    const town = world.towns.get(townId);
    if (town && town.population < tuning.abandonBelowPopulation) events.push(abandonTown(world, townId));
  }
  const founded = tryFoundTown(world);
  if (founded) events.push(founded);
  // Demand follows population; recompute rates once a day, not per tick.
  refreshDemand(world);
  return events;
}

/** Flow through a town: half the flow on every road touching it (each vehicle passing through uses two). */
function flowThrough(world: SliceWorld, townId: string): number {
  let total = 0;
  for (const segment of world.simulation.map.segments) {
    if (segment.fromNodeId === townId || segment.toNodeId === townId) total += world.settlement.segmentFlowEMA.get(segment.id) ?? 0;
  }
  return total / 2;
}

// An emergent town drifts toward the size its traffic supports. Slowly:
// τ is several game days, so a town reads as growing, not spawning big.
function driftPopulations(world: SliceWorld, dt: number): void {
  const { tuning } = world;
  const alpha = 1 - Math.exp(-dt / tuning.townPopulationTauSeconds);
  for (const townId of world.settlement.emergent) {
    const town = world.towns.get(townId);
    if (!town) continue;
    const target = Math.min(tuning.maxEmergentPopulation, flowThrough(world, townId) * tuning.populationPerFlow);
    town.population += (target - town.population) * alpha;
  }
}

function refreshDemand(world: SliceWorld): void {
  world.simulation.demand = gravityDemand([...world.towns.values()], world.tuning.demandK);
  for (const pair of world.simulation.demand) {
    const key = pairKey(pair.from, pair.to);
    if (!world.pairOutcomes.has(key)) world.pairOutcomes.set(key, emptyOutcome());
  }
}

function tryFoundTown(world: SliceWorld): SliceEvent | null {
  const { settlement, tuning, simulation } = world;
  if (settlement.emergent.size >= tuning.maxEmergentTowns) return null;
  if (settlement.elapsedSeconds - settlement.lastFoundedAtSeconds < tuning.minSecondsBetweenTowns) return null;

  let best: { segmentId: string; flow: number; x: number; y: number } | null = null;
  for (const segment of simulation.map.segments) {
    const flow = settlement.segmentFlowEMA.get(segment.id) ?? 0;
    if (flow < tuning.foundTownFlow || (best && flow <= best.flow)) continue;
    // Your service is a necessary condition, not just a contributor
    // (docs/principles.md §3, Growth): danfos sustain places, your buses
    // develop them. Without this, danfo traffic alone sits a hair under
    // the threshold on this map -- an accident, not a rule.
    if ((settlement.segmentPlayerFlowEMA.get(segment.id) ?? 0) < tuning.foundTownPlayerFlow) continue;
    if (segmentLength(world, segment.id) < tuning.townSpacingCells * 2) continue;
    const a = simulation.routing.positions.get(segment.fromNodeId)!;
    const b = simulation.routing.positions.get(segment.toNodeId)!;
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    const crowded = simulation.map.nodes.some((node) => Math.hypot(node.x - x, node.y - y) < tuning.townSpacingCells);
    if (crowded) continue;
    best = { segmentId: segment.id, flow, x, y };
  }
  if (!best) return null;

  const segment = simulation.map.segments.find((candidate) => candidate.id === best.segmentId)!;
  const town: SliceTown = {
    id: `town-${world.nextId++}`,
    name: roadsideName(world, segment.fromNodeId, segment.toNodeId, best.x, best.y),
    x: best.x,
    y: best.y,
    population: tuning.newTownPopulation,
  };
  splitSegment(world, segment.id, town);
  settlement.emergent.add(town.id);
  settlement.lastFoundedAtSeconds = settlement.elapsedSeconds;
  return { kind: "founded", townId: town.id, name: town.name, between: [segment.fromNodeId, segment.toNodeId] };
}

// Roadside places are named for where they are: a milestone from the
// nearer town, else that town's junction or motor garage.
function roadsideName(world: SliceWorld, a: string, b: string, x: number, y: number): string {
  const townA = world.towns.get(a) ?? world.ruins.get(a);
  const townB = world.towns.get(b) ?? world.ruins.get(b);
  const nearer = [townA, townB]
    .filter((town): town is SliceTown => town !== undefined)
    .sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y))[0];
  const taken = new Set([...world.towns.values(), ...world.ruins.values()].map((town) => town.name));
  const miles = nearer ? Math.max(1, Math.round(Math.hypot(nearer.x - x, nearer.y - y) * MILES_PER_CELL)) : 1;
  const candidates = [
    `Mile ${miles}`,
    ...(nearer ? [`${nearer.name} Junction`, `${nearer.name} Garage`, `${nearer.name} Market`] : []),
    "Oja Tuntun",
    "Ilu Titun",
  ];
  return candidates.find((name) => !taken.has(name)) ?? `Mile ${miles} (${world.nextId})`;
}

const MILES_PER_CELL = 0.5;

// A town founded on a road becomes a node in its chain (docs/principles.md
// §3: a corridor is a chain of nodes). Every vehicle whose path crosses the
// old segment now passes through the new town -- so a bus route on that
// road starts serving it for free, which is the point.
function splitSegment(world: SliceWorld, segmentId: string, town: SliceTown): void {
  const { simulation, informal, settlement } = world;
  const map = simulation.map;
  const segment = map.segments.find((candidate) => candidate.id === segmentId)!;
  const { fromNodeId: a, toNodeId: b } = segment;

  map.nodes.push({ id: town.id, kind: "settlement", x: town.x, y: town.y });
  world.towns.set(town.id, town);
  simulation.queues.set(town.id, new Map());

  const first = { ...segment, id: `${segment.id}.1`, corridorId: `corridor-${segment.id}.1`, toNodeId: town.id };
  const second = { ...segment, id: `${segment.id}.2`, corridorId: `corridor-${segment.id}.2`, fromNodeId: town.id };
  map.segments = map.segments.filter((candidate) => candidate.id !== segmentId).concat(first, second);
  const posA = map.nodes.find((node) => node.id === a)!;
  const posB = map.nodes.find((node) => node.id === b)!;
  map.corridors = map.corridors
    .filter((corridor) => corridor.id !== segment.corridorId)
    .concat(
      { id: first.corridorId, nodeIds: [a, town.id], polyline: [{ x: posA.x, y: posA.y }, { x: town.x, y: town.y }] },
      { id: second.corridorId, nodeIds: [town.id, b], polyline: [{ x: town.x, y: town.y }, { x: posB.x, y: posB.y }] },
    );

  for (const vehicle of simulation.vehicles) insertIntoPath(vehicle, a, b, town.id);

  // Informal vehicles already on the road now occupy both halves.
  for (const info of informal.active.values()) {
    if (!info.segmentIds.includes(segmentId)) continue;
    info.segmentIds = info.segmentIds.flatMap((id) => (id === segmentId ? [first.id, second.id] : [id]));
  }
  const space = informal.segmentSpace.get(segmentId) ?? 0;
  informal.segmentSpace.set(first.id, space);
  informal.segmentSpace.set(second.id, space);
  informal.segmentSpace.delete(segmentId);
  for (const flows of [settlement.segmentFlowEMA, settlement.segmentPlayerFlowEMA]) {
    const flow = flows.get(segmentId) ?? 0;
    flows.set(first.id, flow);
    flows.set(second.id, flow);
    flows.delete(segmentId);
  }

  rebuildFromMap(simulation, map);
  world.pathCache.clear();
  world.plans = null; // routes through here now stop here
  refreshDemand(world);
}

/**
 * Inserts `mid` between every consecutive a,b (either direction) in a
 * vehicle's path, keeping the vehicle where it physically is: a vehicle
 * partway along a->b ends up on the matching half, at the matching
 * progress.
 */
export function insertIntoPath(vehicle: Vehicle, a: string, b: string, mid: string): void {
  const cyclic = vehicle.lifecycle === "cyclic";
  const old = vehicle.path;
  const length = old.length;
  if (length < 2) return;
  const isSplit = (x: string, y: string) => (x === a && y === b) || (x === b && y === a);

  // For each old index, its new index; and which old edges (keyed by the
  // index of their *to* node) were split.
  const next: string[] = [];
  const newIndexOf: number[] = [];
  const splitEdgeTo = new Set<number>();
  for (let i = 0; i < length; i += 1) {
    if (i > 0 && isSplit(old[i - 1]!, old[i]!)) {
      next.push(mid);
      splitEdgeTo.add(i);
    }
    newIndexOf.push(next.length);
    next.push(old[i]!);
  }
  if (cyclic && isSplit(old[length - 1]!, old[0]!)) {
    next.push(mid); // the wrap-around edge
    splitEdgeTo.add(0);
  }

  // A one-shot vehicle that already finished keeps its sentinel.
  if (vehicle.pathIndex >= length) {
    vehicle.path = next;
    vehicle.pathIndex = next.length;
    return;
  }

  const toIndex = vehicle.pathIndex;
  let newTo = newIndexOf[toIndex]!;
  if (splitEdgeTo.has(toIndex)) {
    const midIndex = toIndex === 0 ? next.length - 1 : newTo - 1;
    if (vehicle.edgeProgress < 0.5) {
      newTo = midIndex;
      vehicle.edgeProgress *= 2;
    } else {
      vehicle.edgeProgress = (vehicle.edgeProgress - 0.5) * 2;
    }
  }
  vehicle.path = next;
  vehicle.pathIndex = newTo;
}

// A faded town stops generating and attracting trips. Its node stays as a
// plain junction -- the road keeps its bend there -- and its name stays on
// the map as a ruin, so the loss reads.
function abandonTown(world: SliceWorld, townId: string): SliceEvent {
  const { simulation, informal, settlement } = world;
  const town = world.towns.get(townId)!;
  world.towns.delete(townId);
  world.ruins.set(townId, town);
  settlement.emergent.delete(townId);
  const node = simulation.map.nodes.find((candidate) => candidate.id === townId);
  if (node) node.kind = "junction";

  simulation.queues.set(townId, new Map());
  for (const queue of simulation.queues.values()) {
    for (const key of [...queue.keys()]) {
      const { destination, origin } = parseQueueKey(key);
      if (destination === townId || origin === townId) queue.delete(key);
    }
  }
  for (const pool of [informal.pool, informal.smallPool]) {
    for (const key of [...pool.keys()]) {
      const { at, origin, destination } = parsePoolKey(key);
      if (at === townId || origin === townId || destination === townId) pool.delete(key);
    }
  }
  world.plans = null;
  for (const key of [...world.pairOutcomes.keys()]) {
    if (key.startsWith(`${townId}:`) || key.endsWith(`:${townId}`)) world.pairOutcomes.delete(key);
  }
  refreshDemand(world);
  return { kind: "abandoned", townId, name: town.name };
}
