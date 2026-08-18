import { MAP_WIDTH, MAP_HEIGHT } from "../map/generate";
import { createRng } from "../map/random";
import { generateTerrainField } from "../map/terrain";
import type { GeneratedMap } from "../map/types";
import type { SimulationState } from "../simulation/types";
import { generateDemandPairs } from "../simulation/demand";
import { rebuildFromMap } from "../simulation/simulate";
import type { EconomyState } from "../economy/types";
import type { ParatransitState } from "../paratransit/types";
import type { GrowthState } from "../growth/types";
import type { EraTimeline } from "../eras/types";
import { SAVE_FORMAT_VERSION } from "./types";
import type { RestoreResult, SaveFile } from "./types";

// Everything not listed here is derived and deliberately left out (see
// types.ts's SaveFile doc and docs/handoff-module-10.md §2.2/§2.4):
// terrain regenerates from `map.seed`, and `demand`/`routing`/
// `ambientGeometry`/`segmentLoads`/`ambientLoads` are recomputed by
// rebuildFromMap and the next tick().
export function createSnapshot(
  simulation: SimulationState,
  economy: EconomyState,
  paratransit: ParatransitState,
  growth: GrowthState,
  eraTimeline: EraTimeline,
): SaveFile {
  return {
    version: SAVE_FORMAT_VERSION,
    map: {
      seed: simulation.map.seed,
      nodes: simulation.map.nodes,
      corridors: simulation.map.corridors,
      segments: simulation.map.segments,
    },
    queues: [...simulation.queues].map(([nodeId, inner]) => [nodeId, [...inner]]),
    vehicles: simulation.vehicles,
    segmentTraffic: [...simulation.segmentTraffic],
    economy: {
      funds: economy.funds,
      elapsedSeconds: economy.elapsedSeconds,
      fareTable: economy.fareTable,
      vehicleEconomics: [...economy.vehicleEconomics],
      ledger: [...economy.ledger],
      incomeRateEMA: economy.incomeRateEMA,
      costRateEMA: economy.costRateEMA,
    },
    paratransit: {
      elapsedSeconds: paratransit.elapsedSeconds,
      pairUnservedEMA: [...paratransit.pairUnservedEMA],
      pairLastSpawnSeconds: [...paratransit.pairLastSpawnSeconds],
      segmentCounts: [...paratransit.segmentCounts],
      pairCounts: [...paratransit.pairCounts],
      active: [...paratransit.active],
    },
    growth: [...growth],
    eraTimeline: {
      currentIndex: eraTimeline.currentIndex,
      elapsedInEraSeconds: eraTimeline.elapsedInEraSeconds,
    },
  };
}

// Mutates the given state objects in place rather than returning fresh
// ones -- the same pattern applyPromotion/decaySegments use elsewhere.
// main.ts's controllers (fleetController, authoringController) close over
// these object references directly; replacing them here would leave those
// controllers pointed at stale state.
export function restoreIntoState(
  save: SaveFile,
  simulation: SimulationState,
  economy: EconomyState,
  paratransit: ParatransitState,
  growth: GrowthState,
  eraTimeline: EraTimeline,
): RestoreResult {
  if (save.version !== SAVE_FORMAT_VERSION) {
    return {
      ok: false,
      error: `save format version ${save.version} is not supported (this build reads version ${SAVE_FORMAT_VERSION}).`,
    };
  }

  const terrain = generateTerrainField(createRng(save.map.seed), MAP_WIDTH, MAP_HEIGHT);
  const map: GeneratedMap = {
    seed: save.map.seed,
    terrain,
    nodes: save.map.nodes,
    corridors: save.map.corridors,
    segments: save.map.segments,
  };

  // Sets map/routing/ambientGeometry together -- the one route to a
  // routing rebuild outside the engine (docs/handoff-module-10.md §2.4).
  rebuildFromMap(simulation, map);
  simulation.demand = generateDemandPairs(map);
  simulation.queues = new Map(save.queues.map(([nodeId, inner]) => [nodeId, new Map(inner)]));
  simulation.vehicles.length = 0;
  simulation.vehicles.push(...save.vehicles);
  simulation.segmentTraffic = new Map(save.segmentTraffic);
  simulation.segmentLoads = new Map();
  simulation.ambientLoads = new Map();

  economy.funds = save.economy.funds;
  economy.elapsedSeconds = save.economy.elapsedSeconds;
  economy.fareTable = save.economy.fareTable;
  economy.vehicleEconomics = new Map(save.economy.vehicleEconomics);
  economy.ledger = new Map(save.economy.ledger);
  economy.incomeRateEMA = save.economy.incomeRateEMA;
  economy.costRateEMA = save.economy.costRateEMA;

  paratransit.elapsedSeconds = save.paratransit.elapsedSeconds;
  paratransit.pairUnservedEMA = new Map(save.paratransit.pairUnservedEMA);
  paratransit.pairLastSpawnSeconds = new Map(save.paratransit.pairLastSpawnSeconds);
  paratransit.segmentCounts = new Map(save.paratransit.segmentCounts);
  paratransit.pairCounts = new Map(save.paratransit.pairCounts);
  paratransit.active = new Map(save.paratransit.active);

  growth.clear();
  for (const [nodeId, node] of save.growth) growth.set(nodeId, node);

  eraTimeline.currentIndex = save.eraTimeline.currentIndex;
  eraTimeline.elapsedInEraSeconds = save.eraTimeline.elapsedInEraSeconds;

  return { ok: true };
}
