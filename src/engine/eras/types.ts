// Era identity must be expressed mechanically, not only in prices
// (docs/rebuild-plan.md §5) -- this is that mechanical expression.
// engine/ can't import content/ (hard rule 1), so this is the plain
// engine-side shape the bootstrap layer maps loaded era content into,
// same pattern as Segment.level or Vehicle.carries.
export interface EraModifiers {
  demand: number;
  fuel: number;
  buildCost: number;
  decay: number;
  paratransitPressure: number;
  // Private car ownership as ambient road friction, in the same
  // congestion-weight units vehicles use, per unit of average endpoint
  // demand multiplier (D). Not a vehicle count and not a percentage of
  // anything -- it is "how much road space the private sector takes on a
  // fully-grown approach", which is what makes prosperity legible as
  // traffic. Rail is immune by construction (see simulation/congestion.ts).
  ambientTraffic: number;
}

export interface EraDef {
  id: string;
  order: number;
  durationSeconds: number;
  modifiers: EraModifiers;
  railAvailable: boolean;
}

export interface EraTimeline {
  eras: EraDef[];
  currentIndex: number;
  elapsedInEraSeconds: number;
}
