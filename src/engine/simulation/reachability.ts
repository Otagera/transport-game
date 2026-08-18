import type { DemandPair, RoutingContext } from "./types";
import { findPath } from "./routing";

// Stranded is reachability-based (docs/principles.md §3): a node that
// originates demand but cannot reach ANY of its demand destinations via the
// current graph -- not "has no built edge at all."
export function computeStranded(demand: DemandPair[], context: RoutingContext): Set<string> {
  const byOrigin = new Map<string, Set<string>>();
  for (const pair of demand) {
    if (!byOrigin.has(pair.from)) {
      byOrigin.set(pair.from, new Set());
    }
    byOrigin.get(pair.from)!.add(pair.to);
  }

  const stranded = new Set<string>();
  for (const [origin, destinations] of byOrigin) {
    const reachesAny = [...destinations].some((destination) => findPath(context, origin, destination) !== null);
    if (!reachesAny) {
      stranded.add(origin);
    }
  }

  return stranded;
}
