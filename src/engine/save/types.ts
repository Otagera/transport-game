import type { Corridor, MapNode, Segment } from "../map/types";
import type { SegmentTraffic, Vehicle } from "../simulation/types";
import type { FareTable, RouteLedgerEntry, VehicleEconomics } from "../economy/types";
import type { ActiveParatransit } from "../paratransit/types";
import type { NodeGrowthState } from "../growth/types";

// docs/architecture/engine.md §save/: "versioned format, old versions
// rejected clearly." Bump this whenever SaveFile's shape changes, and
// restoreIntoState refuses anything that doesn't match exactly -- no
// partial/best-effort load of an older save.
export const SAVE_FORMAT_VERSION = 1;

// A save is state, not content: this type is hand-written, not derived
// from src/content/schema.ts. The content schemas' `.default()` calls
// (congestionWeight, channels) are correct for a hand-authored catalog
// where an absent field means "assume the common case" -- they are wrong
// for a save, where an absent field means "this save predates it" and
// must fail the version check, not silently backfill a plausible value.
// See docs/architecture/engine.md §save/ and docs/architecture/content.md.
export interface SavedMap {
  seed: number;
  nodes: MapNode[];
  corridors: Corridor[];
  segments: Segment[];
}

export interface SavedEconomy {
  funds: number;
  elapsedSeconds: number;
  fareTable: FareTable;
  vehicleEconomics: Array<[string, VehicleEconomics]>;
  ledger: Array<[string, RouteLedgerEntry]>;
  incomeRateEMA: number;
  costRateEMA: number;
}

export interface SavedParatransit {
  elapsedSeconds: number;
  pairUnservedEMA: Array<[string, number]>;
  pairLastSpawnSeconds: Array<[string, number]>;
  segmentCounts: Array<[string, number]>;
  pairCounts: Array<[string, number]>;
  active: Array<[string, ActiveParatransit]>;
}

export interface SavedEraTimeline {
  currentIndex: number;
  elapsedInEraSeconds: number;
}

export interface SaveFile {
  version: number;
  // Terrain is the only thing derivable from `map.seed` alone (§2.2):
  // generateMap is deterministic, so regenerating it on load is cheaper
  // and drift-proof compared to serialising ~7k floats. Everything else
  // in SavedMap -- promoted node.kind, decayed segment.condition, authored
  // corridors/segments, and segment.profileId -- has moved away from what
  // the seed alone would produce, and must be stored.
  map: SavedMap;
  queues: Array<[string, Array<[string, number]>]>;
  vehicles: Vehicle[];
  segmentTraffic: Array<[string, SegmentTraffic]>;
  economy: SavedEconomy;
  paratransit: SavedParatransit;
  growth: Array<[string, NodeGrowthState]>;
  eraTimeline: SavedEraTimeline;
}

export type RestoreResult = { ok: true } | { ok: false; error: string };
