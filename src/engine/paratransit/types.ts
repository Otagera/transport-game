export interface ActiveParatransit {
  pairKey: string;
  segmentIds: string[];
}

export interface ParatransitState {
  elapsedSeconds: number;
  // Sustained state gates decisions (docs/principles.md §3): a rolling
  // EMA per demand pair, not a single-tick queue-depth check.
  pairUnservedEMA: Map<string, number>;
  pairLastSpawnSeconds: Map<string, number>;
  segmentCounts: Map<string, number>;
  pairCounts: Map<string, number>;
  active: Map<string, ActiveParatransit>;
}

export function createParatransitState(): ParatransitState {
  return {
    elapsedSeconds: 0,
    pairUnservedEMA: new Map(),
    pairLastSpawnSeconds: new Map(),
    segmentCounts: new Map(),
    pairCounts: new Map(),
    active: new Map(),
  };
}
