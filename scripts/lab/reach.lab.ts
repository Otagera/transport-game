// Why a reach pledge names no move (2026-11-01): the cluster's offer, what arrives, and why not.
import { startRun } from "../../src/engine/game/runlog";
import { GAME_MAP } from "../../src/game/map";
import { clusterOfferShare, fieldId } from "../../src/engine/game/clusters";
import { isCutOff } from "../../src/engine/game/world";
import { goodsFlows, flowKey } from "../../src/engine/game/goods";
import { SECONDS_PER_GAME_DAY as D } from "../../src/engine/economy/state";

for (const seed of [3218, 2411, 949]) {
  const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { warmUpDays: 2 });
  for (const c of w.clusters ?? []) {
    const from = c.offer === "limestone" ? fieldId(c) : c.hub;
    const offer = clusterOfferShare(w, c);
    const kind = c.offer === "limestone" ? "supplies" : "produce";
    const flows = goodsFlows(w).filter((f) => f.kind === kind && (f.from === from || c.towns.includes(f.from)));
    const o = (f: { from: string; to: string; kind: string }) => w.goods.outcomes.get(flowKey(f as never));
    console.log(`map ${seed} ${w.towns.get(c.hub)?.name} (${c.offer}): from ${w.towns.get(from)?.name ?? from} cutOff ${isCutOff(w, from)} yard ${w.yards.has(from)} share ${offer ? Math.round(offer.share * 100) + "% of " + Math.round(offer.perDay) + " t" : "null"} | ${flows.length} flows: ${flows.slice(0, 3).map((f) => `${w.towns.get(f.from)?.name}->${w.towns.get(f.to)?.name} ${Math.round(f.rate * D)} t, ${JSON.stringify(o(f) ?? {})}`).join("; ")}`);
  }
}
