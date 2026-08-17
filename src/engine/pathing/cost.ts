import type { TerrainField } from "../map/types";

export const BASE_COST_PER_CELL = 10;
export const GRADIENT_COST_FACTOR = 40;
export const DENSITY_COST_FACTOR = 6;
export const NODE_COST = 25;

export interface StepCost {
  base: number;
  gradient: number;
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
  return { base, gradient, density };
}

export interface CostBreakdown {
  base: number;
  gradient: number;
  water: number;
  density: number;
  nodes: number;
  total: number;
}

export function sumStepCosts(steps: StepCost[], newNodeCount: number): CostBreakdown {
  let base = 0;
  let gradient = 0;
  let density = 0;
  for (const step of steps) {
    base += step.base;
    gradient += step.gradient;
    density += step.density;
  }
  // Water is always 0 here: ground-level segments cannot cross water at
  // all (no bridges until Module 5), so a successfully found path never
  // includes a water step. The field stays in the breakdown now so its
  // later use costs nothing -- the "ship with ground only" pattern.
  const water = 0;
  const nodes = newNodeCount * NODE_COST;
  return { base, gradient, water, density, nodes, total: base + gradient + water + density + nodes };
}
