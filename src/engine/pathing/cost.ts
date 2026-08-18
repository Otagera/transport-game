import type { TerrainField } from "../map/types";

export const BASE_COST_PER_CELL = 10;
export const GRADIENT_COST_FACTOR = 40;
export const DENSITY_COST_FACTOR = 6;
export const NODE_COST = 25;

// docs/rebuild-plan.md §5 "Bridges": premium scales linearly with span
// (not exponentially -- exponential would make splitting one long
// crossing into several short ones cheaper than a single span, handing
// the discount to whoever clicks most; flat-linear is neutral to
// splitting instead of rewarding it). Span cap ~14 cells, measured on
// straight node-to-node lines.
export const BRIDGE_PREMIUM_PER_CELL = 30;
export const MAX_BRIDGE_SPAN = 14;

export interface StepCost {
  base: number;
  gradient: number;
  water: number;
  density: number;
}

// The A* cost function IS the build price (docs/rebuild-plan.md §5): this
// is the one function both the pathfinder's search and the cost-breakdown
// preview call -- never two functions that could drift apart. That bug
// class was hit four separate times in the previous build.
export function stepCost(terrain: TerrainField, fromIndex: number, toIndex: number, stepDistance: number): StepCost {
  const base = BASE_COST_PER_CELL * stepDistance;
  const gradient = GRADIENT_COST_FACTOR * Math.abs(terrain.elevation[toIndex] - terrain.elevation[fromIndex]);
  const density = DENSITY_COST_FACTOR * terrain.settlementDensity[toIndex] * stepDistance;
  return { base, gradient, water: 0, density };
}

// A bridge jump: base construction cost for the bank-to-bank distance,
// plus the linear span premium. No gradient/density term -- a deck is
// flat and doesn't follow the terrain underneath it.
export function bridgeStepCost(span: number): StepCost {
  return { base: BASE_COST_PER_CELL * span, gradient: 0, water: BRIDGE_PREMIUM_PER_CELL * span, density: 0 };
}

export interface CostBreakdown {
  base: number;
  gradient: number;
  water: number;
  density: number;
  nodes: number;
  total: number;
}

// A profile's costPerMeter is expressed *relative to a reference*, not as
// an absolute price. The map has no stated metre scale -- it is a grid of
// cells at "regional" scale (docs/rebuild-plan.md §2) and nothing anywhere
// says how many metres a cell is. Inventing one here to make costPerMeter
// absolute would silently rebalance every number Modules 4-9 were tuned
// against, to buy precision the model does not actually have. So a
// profile costing twice as much per metre costs twice as much to build,
// and the reference profile leaves the existing balance exactly where it
// was.
export const REFERENCE_COST_PER_METRE = 12;

export function profileCostMultiplier(costPerMeter: number): number {
  return costPerMeter / REFERENCE_COST_PER_METRE;
}

// buildCostMultiplier (docs/rebuild-plan.md §6 Module 8) scales every
// field uniformly, not just `total` -- the breakdown must keep summing to
// its own total, since the UI shows it as a receipt.
//
// profileMultiplier scales only the per-length terms, never `nodes`.
// costPerMeter is a price per metre of alignment and has no claim on a
// point cost: a junction is a junction whichever surface meets there. It
// does scale gradient, water and density along with base, because a wider
// road needs a wider cutting and a wider bridge -- the earthworks follow
// the cross-section, they are not independent of it.
export function sumStepCosts(
  steps: StepCost[],
  newNodeCount: number,
  buildCostMultiplier: number = 1,
  profileMultiplier: number = 1,
): CostBreakdown {
  let base = 0;
  let gradient = 0;
  let water = 0;
  let density = 0;
  for (const step of steps) {
    base += step.base;
    gradient += step.gradient;
    water += step.water;
    density += step.density;
  }
  const nodes = newNodeCount * NODE_COST;
  const perLength = buildCostMultiplier * profileMultiplier;
  base *= perLength;
  gradient *= perLength;
  water *= perLength;
  density *= perLength;
  const scaledNodes = nodes * buildCostMultiplier;
  return { base, gradient, water, density, nodes: scaledNodes, total: base + gradient + water + density + scaledNodes };
}

// Maintenance pricing lives here for the same reason build pricing does
// (docs/rebuild-plan.md §5, architecture.md hard rule 3): this module is
// the only place geometry is allowed to become currency. Restoring a
// segment is priced off the same BASE_COST_PER_CELL its construction was,
// scaled by how much condition is actually being bought back -- so a
// nearly-new segment costs nearly nothing to maintain and a floored one
// costs a real fraction of rebuilding it. Deliberately ignores gradient
// and density: resurfacing an existing alignment doesn't re-pay for the
// terrain it was already cut through.
export const MAINTENANCE_FRACTION_OF_BUILD = 0.35;

export function maintenanceCost(spanCells: number, conditionDeficit: number): number {
  const deficit = Math.max(0, Math.min(1, conditionDeficit));
  return BASE_COST_PER_CELL * spanCells * deficit * MAINTENANCE_FRACTION_OF_BUILD;
}
