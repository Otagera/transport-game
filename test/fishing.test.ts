import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "./support/worlds"; // built once, copied after
import { applyAction } from "@engine/game/actions";
import { gameTick } from "@engine/game/tick";
import { SIM_DT } from "@engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";
import { fishFlows, fishGrowth, landingAt, landingSplit } from "@engine/game/fishing";
import { marketFed, marketTowns } from "@engine/game/food";
import { goodsFares } from "@engine/game/fares";
import { jettyLanding } from "@engine/game/boats";
import { roadPath } from "@engine/game/world";
import type { GameTuning, GameWorld } from "@engine/game/types";

// Fishing (fishing.ts; docs/water.md, Step 4): C58-C60.

const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 8703, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, startingFunds: 2e5, ...overrides });
const days = (w: GameWorld, n: number) => {
  for (let i = 0; i < Math.round((n * D) / SIM_DT); i += 1) gameTick(w, SIM_DT);
};

describe("fishing (fishing.ts)", () => {
  test("a landing at each town on the water's edge, beside it on the bank; none in a game played before fishing", () => {
    const w = start();
    const landings = w.fishing!.landings;
    expect(landings.length).toBeGreaterThan(0);
    for (const l of landings) {
      const site = w.towns.get(l.siteId)!, town = w.towns.get(l.townId)!;
      expect(site.industry).toBe("landing");
      expect(Math.hypot(site.x - town.x, site.y - town.y)).toBeLessThanOrEqual(4);
      expect(jettyLanding(w, l.townId)!.edge).toBeLessThanOrEqual(w.tuning.fishLandingEdge!);
      expect(roadPath(w, l.siteId, l.townId)).not.toBeNull();
    }
    expect(start({ fishingEnabled: undefined }).fishing).toBeUndefined();
  }, 120_000);

  test("C58: fresh fish only to the markets near its landing; a smokehouse sends the rest to the markets further off", () => {
    const w = start();
    const reach = w.tuning.fishFreshReachCells!;
    for (const f of fishFlows(w).filter((f) => f.kind === "produce")) expect(roadPath(w, f.from, f.to)!.distance).toBeLessThanOrEqual(reach);
    expect(fishFlows(w).some((f) => f.kind === "supplies")).toBe(false);
    const l = [...w.fishing!.landings].sort((p, q) => landingSplit(w, q.siteId)!.wasted - landingSplit(w, p.siteId)!.wasted)[0]!;
    const before = landingSplit(w, l.siteId)!;
    expect(before.wasted).toBeGreaterThan(0);
    const funds = w.economy.funds;
    expect(applyAction(w, { kind: "smokehouse", siteId: l.siteId }).ok).toBe(true);
    expect(funds - w.economy.funds).toBe(w.tuning.smokehouseCost!);
    expect(applyAction(w, { kind: "smokehouse", siteId: l.siteId }).ok).toBe(false);
    expect(applyAction(w, { kind: "smokehouse", siteId: marketTowns(w)[0]!.id }).ok).toBe(false); // only at a landing
    const after = landingSplit(w, l.siteId)!;
    expect(after.smoked).toBeGreaterThan(0);
    expect(after.wasted).toBeLessThan(before.wasted);
    expect(landingAt(w, l.siteId)!.smokehouse).toBe(true);
  }, 120_000);

  test("C59: fresh fish pays a premium on its fare, and spoils faster where it waits than smoked fish", () => {
    const w = start({ truckersEnabled: false }); // nobody lifts it: what waits, spoils
    const l = w.fishing!.landings[0]!;
    const town = marketTowns(w)[0]!.id;
    const entry = (kind: "produce" | "supplies") => [{ entry: { from: l.siteId, to: town, kind, amount: 10 }, amount: 10 }] as never;
    expect(goodsFares(w, entry("produce"))).toBeCloseTo(goodsFares(w, entry("supplies")) * w.tuning.fishFreshRate!, 6);
    applyAction(w, { kind: "smokehouse", siteId: l.siteId });
    days(w, 2);
    const spoiled = (kind: "produce" | "supplies") => {
      const outs = [...w.goods.outcomes].filter(([k]) => k.startsWith(`${l.siteId}|`) && k.endsWith(`|${kind}`)).map(([, o]) => o.spoiled);
      return outs.reduce((s, x) => s + x, 0);
    };
    const flows = fishFlows(w).filter((f) => f.from === l.siteId);
    const rate = (kind: string) => flows.filter((f) => f.kind === kind).reduce((s, f) => s + f.rate, 0);
    // The share of what's made that's lost: fresh's far above smoked's.
    if (rate("produce") > 0 && rate("supplies") > 0) expect(spoiled("produce") / rate("produce")).toBeGreaterThan(5 * (spoiled("supplies") / rate("supplies")));
  }, 120_000);

  test("C60: fish only adds -- it's no part of a market's food basket, and its room to grow is never less than none", () => {
    const w = start();
    days(w, 3);
    const fed = new Map(marketTowns(w).map((m) => [m.id, marketFed(w, m.id)]));
    const fishGot = marketTowns(w).reduce((s, m) => s + fishGrowth(w, m.id), 0);
    // Every fish delivery wiped: the basket is the same to the last digit, and fish's room falls to none.
    for (const key of [...w.goods.outcomes.keys()]) if (key.startsWith("landing-")) w.goods.outcomes.delete(key);
    for (const m of marketTowns(w)) {
      expect(marketFed(w, m.id)).toBe(fed.get(m.id)!);
      expect(fishGrowth(w, m.id)).toBe(0);
    }
    expect(fishGot).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
