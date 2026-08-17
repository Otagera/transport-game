import type { GeneratedMap, MapNode } from "../map/types";
import type { DemandPair } from "./types";

const PASSENGER_BASE_RATE = 0.5;
const GOODS_BASE_RATE = 0.2;

function nodeWeight(node: MapNode): number {
  return node.kind === "settlement" ? 2 : node.kind === "village" ? 1 : 0;
}

function distance(a: MapNode, b: MapNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nearestSettlement(village: MapNode, settlements: MapNode[]): MapNode | null {
  let nearest: MapNode | null = null;
  let best = Infinity;
  for (const settlement of settlements) {
    const d = distance(village, settlement);
    if (d < best) {
      best = d;
      nearest = settlement;
    }
  }
  return nearest;
}

// Demand pairs are static topology (docs/rebuild-plan.md §5); growth scales
// the rate, not the graph -- so this runs once per map, not per tick.
export function generateDemandPairs(map: GeneratedMap): DemandPair[] {
  const inhabited = map.nodes.filter((node) => node.kind !== "junction");
  const settlements = inhabited.filter((node) => node.kind === "settlement");
  const pairs: DemandPair[] = [];

  // Passenger demand must be reciprocal by construction: both directions
  // generated together, not hoped into existence by a one-directional pass.
  for (let i = 0; i < inhabited.length; i += 1) {
    for (let j = i + 1; j < inhabited.length; j += 1) {
      const a = inhabited[i]!;
      const b = inhabited[j]!;
      const d = distance(a, b);
      if (d === 0) continue;
      const rate = (PASSENGER_BASE_RATE * nodeWeight(a) * nodeWeight(b)) / d;
      pairs.push({ from: a.id, to: b.id, kind: "passengers", rate });
      pairs.push({ from: b.id, to: a.id, kind: "passengers", rate });
    }
  }

  // Goods stay one-way, with reverse flows authored as a *different* cargo
  // kind (produce vs. supplies) -- mirroring the same kind would be untrue.
  for (const village of inhabited.filter((node) => node.kind === "village")) {
    const market = nearestSettlement(village, settlements);
    if (!market) continue;
    const d = distance(village, market) || 1;
    const rate = GOODS_BASE_RATE / d;
    pairs.push({ from: village.id, to: market.id, kind: "produce", rate });
    pairs.push({ from: market.id, to: village.id, kind: "supplies", rate });
  }

  return pairs;
}
