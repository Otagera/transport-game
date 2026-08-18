// Only village and settlement grow (docs/architecture/engine.md §growth/) --
// junction and vertex nodes are never inhabited, so they never originate
// demand and never grow. `tier` mirrors NodeKind rather than inventing a
// parallel enum: settlement is already the top of the existing kind
// hierarchy, so "tier promotion" IS "a village becomes a settlement,"
// nothing more elaborate.
export type GrowableTier = "village" | "settlement";

export interface NodeGrowthState {
  nodeId: string;
  tier: GrowableTier;
  // D: scales this node's outbound demand rate (docs/principles.md §3:
  // "growth scales the rate, not the graph"). Starts at 1 -- the
  // authored baseline -- and only ever grows; there is no decline
  // mechanic (out of scope, see docs/principles.md §4 "Corridor failure
  // state").
  demandMultiplier: number;
  // Rolling (EMA) rates in units/second -- the actual smoothed state.
  // Never instantaneous (docs/principles.md §3): averaging *rates* over
  // the window and dividing afterward, rather than averaging a per-tick
  // clamped ratio, avoids a real bias -- a vehicle visiting every few
  // seconds delivers service in a burst against a smooth per-tick
  // generation rate, and a naive per-tick ratio clamps that burst's
  // contribution to 1.0, throwing away most of its weight.
  generatedRateEMA: number;
  playerServedRateEMA: number;
  paratransitServedRateEMA: number;
  // Derived each update from the rate EMAs above (rolling ratios, not
  // separately-smoothed state) and kept on the object for
  // inspection/tests. `playerServiceEMA` is the "necessary condition"
  // gate -- growth requires player service, not just a weighted
  // contributor (docs/principles.md §3) -- tracked separately from the
  // combined, paratransit-discounted `serviceRatioEMA` (S̄) the smoothstep
  // gate reads.
  playerServiceEMA: number;
  paratransitServiceEMA: number;
  serviceRatioEMA: number;
}

export type GrowthState = Map<string, NodeGrowthState>;

export interface PromotionEvent {
  nodeId: string;
  from: GrowableTier;
  to: GrowableTier;
}

export interface NodeDemandSample {
  nodeId: string;
  generated: number;
  playerServed: number;
  paratransitServed: number;
}
