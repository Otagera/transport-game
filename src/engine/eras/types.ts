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
