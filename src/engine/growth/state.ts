import type { GeneratedMap, NodeKind } from "../map/types";
import type { GrowableTier, GrowthState, NodeDemandSample, NodeGrowthState, PromotionEvent } from "./types";

export const INITIAL_DEMAND_MULTIPLIER = 1;

// D_max bounded by tier, independent of D itself (docs/rebuild-plan.md
// §5) -- a constant per tier, not derived from the variable it caps, or
// the logistic cap chases D and growth is uncapped exponential wearing a
// logistic's clothing. "Starting points, not gospel": tuned for a
// compressed, testable playthrough, not a real urbanization timescale.
export const D_MAX: Record<GrowableTier, number> = { village: 2.5, settlement: 6 };

// The promotion threshold must sit early in the growth curve, not near
// the cap (docs/rebuild-plan.md §5): a logistic curve halves its rate
// well before the cap, so the old build's ~58%-of-cap threshold arrived
// too late to be felt. Measured as a fraction of the *growable range*
// above INITIAL_DEMAND_MULTIPLIER, not of D_MAX outright -- a flat
// fraction of D_MAX can land below the starting multiplier itself
// (2.5 * 0.3 = 0.75 < 1), which would promote every village on its first
// tick regardless of service. This form is safe by construction: any
// fraction below 1 keeps the threshold strictly above D0.
export const PROMOTION_THRESHOLD_FRACTION = 0.3;

export const GROWTH_EMA_TAU_SECONDS = 10;
// Below this rolling player-served share, growth is zero regardless of
// how strong paratransit service is -- the necessary-condition gate.
export const PLAYER_SERVICE_EPSILON = 0.02;
// Paratransit counts toward service at a discount (docs/rebuild-plan.md
// §5, ~0.5): informal service sustains a place, player service develops
// it.
export const PARATRANSIT_SERVICE_DISCOUNT = 0.5;
export const BASE_GROWTH_RATE_PER_SECOND = 0.05;
export const SMOOTHSTEP_LOW = 0.15;
export const SMOOTHSTEP_HIGH = 0.6;

function isGrowableTier(kind: NodeKind): kind is GrowableTier {
  return kind === "village" || kind === "settlement";
}

export function createGrowthState(map: GeneratedMap): GrowthState {
  const state: GrowthState = new Map();
  for (const node of map.nodes) {
    if (!isGrowableTier(node.kind)) continue;
    state.set(node.id, {
      nodeId: node.id,
      tier: node.kind,
      demandMultiplier: INITIAL_DEMAND_MULTIPLIER,
      generatedRateEMA: 0,
      playerServedRateEMA: 0,
      paratransitServedRateEMA: 0,
      playerServiceEMA: 0,
      paratransitServiceEMA: 0,
      serviceRatioEMA: 0,
    });
  }
  return state;
}

export function demandMultiplierFor(growth: GrowthState, nodeId: string): number {
  return growth.get(nodeId)?.demandMultiplier ?? INITIAL_DEMAND_MULTIPLIER;
}

function emaUpdate(previous: number, instantaneous: number, dt: number, tau: number): number {
  const alpha = 1 - Math.exp(-dt / tau);
  return previous + (instantaneous - previous) * alpha;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function smoothstep(low: number, high: number, x: number): number {
  const t = clamp01((x - low) / (high - low));
  return t * t * (3 - 2 * t);
}

function updateNode(node: NodeGrowthState, sample: NodeDemandSample, dt: number): PromotionEvent | null {
  // EMA the raw rates, then take the ratio -- not the other way around.
  // See NodeGrowthState's doc comment: EMA-ing a per-tick clamped ratio
  // would badly undercount lumpy, periodic service (a vehicle visiting
  // every few seconds) against smooth per-tick generation.
  node.generatedRateEMA = emaUpdate(node.generatedRateEMA, sample.generated / dt, dt, GROWTH_EMA_TAU_SECONDS);
  node.playerServedRateEMA = emaUpdate(node.playerServedRateEMA, sample.playerServed / dt, dt, GROWTH_EMA_TAU_SECONDS);
  node.paratransitServedRateEMA = emaUpdate(
    node.paratransitServedRateEMA,
    sample.paratransitServed / dt,
    dt,
    GROWTH_EMA_TAU_SECONDS,
  );

  node.playerServiceEMA =
    node.generatedRateEMA > 0 ? clamp01(node.playerServedRateEMA / node.generatedRateEMA) : 0;
  node.paratransitServiceEMA =
    node.generatedRateEMA > 0 ? clamp01(node.paratransitServedRateEMA / node.generatedRateEMA) : 0;
  node.serviceRatioEMA = clamp01(node.playerServiceEMA + PARATRANSIT_SERVICE_DISCOUNT * node.paratransitServiceEMA);

  // Growth requires player service as a necessary condition, not just a
  // weighted contributor (docs/rebuild-plan.md §5): however high
  // paratransit's discounted contribution pushes serviceRatioEMA, growth
  // stays exactly zero unless a sustained share of demand was actually
  // player-served.
  const gated = node.playerServiceEMA > PLAYER_SERVICE_EPSILON;
  const growthRate = gated
    ? BASE_GROWTH_RATE_PER_SECOND * smoothstep(SMOOTHSTEP_LOW, SMOOTHSTEP_HIGH, node.serviceRatioEMA)
    : 0;

  const dMax = D_MAX[node.tier];
  node.demandMultiplier += growthRate * node.demandMultiplier * (1 - node.demandMultiplier / dMax) * dt;
  node.demandMultiplier = Math.min(dMax, node.demandMultiplier);

  const promotionThreshold =
    INITIAL_DEMAND_MULTIPLIER + PROMOTION_THRESHOLD_FRACTION * (D_MAX.village - INITIAL_DEMAND_MULTIPLIER);
  if (node.tier === "village" && node.demandMultiplier >= promotionThreshold) {
    const promotion: PromotionEvent = { nodeId: node.nodeId, from: "village", to: "settlement" };
    node.tier = "settlement";
    return promotion;
  }
  return null;
}

export function updateGrowthState(growth: GrowthState, samples: NodeDemandSample[], dt: number): PromotionEvent[] {
  const promotions: PromotionEvent[] = [];
  for (const sample of samples) {
    const node = growth.get(sample.nodeId);
    if (!node) continue;
    const promotion = updateNode(node, sample, dt);
    if (promotion) promotions.push(promotion);
  }
  return promotions;
}

// Growth must be visible on the map without reading a number (docs/
// rebuild-plan.md §5): mutates the node's kind in place, same pattern as
// decaySegments mutating Segment.condition -- the caller re-renders from
// this same GeneratedMap afterward, which is what makes the promotion
// show up as a marker/color change for free.
export function applyPromotion(map: GeneratedMap, promotion: PromotionEvent): void {
  const node = map.nodes.find((candidate) => candidate.id === promotion.nodeId);
  if (node) node.kind = promotion.to;
}
