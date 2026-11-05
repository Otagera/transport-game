import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "./support/worlds"; // built once, copied after
import { applyAction } from "@engine/game/actions";
import { gameTick } from "@engine/game/tick";
import { SIM_DT } from "@engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";
import { chainOf } from "@engine/game/world";
import { clusterAt } from "@engine/game/remit";
import { segmentLength } from "@engine/game/roads";
import { roadClass, trunkPrice, trunkSet } from "@engine/game/trunks";
import type { GameTuning, GameWorld } from "@engine/game/types";

// Trunks and feeders (trunks.ts; docs/SCALES-AND-MODES.md, scopes 1 and 2; five-modes.md, 4. Okada
// permission): a road's class, derived for the old network and declared by you; no okadas or kekes
// on a trunk, the journeys going on by danfo along it and okada off it; the union's demand.

const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 2418, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, startingFunds: 2e6, ...overrides });
const days = (w: GameWorld, n: number, each?: () => void) => { for (let i = 0; i < Math.round((n * D) / SIM_DT); i += 1) { gameTick(w, SIM_DT); if (each && i % 15 === 0) each(); } };
const tripsMade = (w: GameWorld) => { let n = 0; for (const [, r] of w.pairOutcomes) n += r.player + r.poached + r.gaveUp; return n * D; };

describe("trunks and feeders (trunks.ts; the three scales, scopes 1 and 2)", () => {
  test("derived for the old network: a highway joining two clusters is a trunk, a road you build a feeder; none in games before", () => {
    const w = start();
    const highways = w.simulation.map.segments.filter((s) => {
      if (s.type !== "road" || s.provenance !== "inherited") return false;
      const a = clusterAt(w, s.fromNodeId), b = clusterAt(w, s.toNodeId);
      return !!a && !!b && a.hub !== b.hub;
    });
    expect(highways.length).toBeGreaterThan(0);
    for (const s of highways) expect(roadClass(w, s)).toBe("trunk");
    // A road you build is a feeder until you declare it.
    const town = [...w.towns.values()].filter((t) => !t.industry);
    const built = town.flatMap((a) => town.map((b) => [a, b] as const)).find(([a, b]) => a !== b && applyAction(w, { kind: "road", a: a.id, b: b.id, alignment: "cheapest" }).ok);
    if (built) {
      const road = w.simulation.map.segments[w.simulation.map.segments.length - 1]!;
      expect(road.provenance).toBe("built");
      expect(roadClass(w, road)).toBe("feeder");
    }
    expect(trunkSet(start({ trunksEnabled: undefined })).size).toBe(0);
  }, 120_000);

  test("declared at the signs' price a cell, made a feeder again for nothing; the union asks for it back, and conceding does", () => {
    const w = start();
    const road = w.simulation.map.segments.find((s) => s.type === "road" && roadClass(w, s) === "feeder" && chainOf(w, s.id))!;
    const chain = chainOf(w, road.id)!;
    const cells = chain.pieces.reduce((n, p) => n + segmentLength(w, p), 0);
    expect(trunkPrice(w, road.id)).toBe(Math.round(cells * (w.tuning.trunkCostPerCell ?? 50)));
    const funds = w.economy.funds;
    expect(applyAction(w, { kind: "trunk", segmentId: road.id, on: true }).ok).toBe(true);
    expect(w.economy.funds).toBeCloseTo(funds - Math.round(cells * (w.tuning.trunkCostPerCell ?? 50)), 6);
    for (const p of chain.pieces) expect(trunkSet(w).has(p.id)).toBe(true);
    // His demand, the trunk's, with a deadline.
    const union = w.unions?.find((u) => u.demand?.kind === "trunk");
    if (union) {
      expect(union.demand!.deadlineAt).toBeGreaterThan(w.economy.elapsedSeconds);
      expect(applyAction(w, { kind: "union", unionId: union.id, answer: "coop" }).ok).toBe(false);
      expect(applyAction(w, { kind: "union", unionId: union.id, answer: "concede" }).ok).toBe(true);
      for (const p of chain.pieces) expect(trunkSet(w).has(p.id)).toBe(false);
    }
    // Back and forth by hand: a feeder again is free.
    expect(applyAction(w, { kind: "trunk", segmentId: road.id, on: true }).ok).toBe(true);
    const before = w.economy.funds;
    expect(applyAction(w, { kind: "trunk", segmentId: road.id, on: false }).ok).toBe(true);
    expect(w.economy.funds).toBe(before);
    expect(applyAction(w, { kind: "trunk", segmentId: road.id, on: false }).ok).toBe(false);
  }, 120_000);

  test("no okada or keke on a trunk; the journeys go on -- trips made don't fall against the same game without trunks", () => {
    const on = start(), off = start({ trunksEnabled: false });
    let onTrunk = 0, small = 0;
    days(on, 6, () => {
      const trunks = trunkSet(on);
      for (const [, info] of on.informal.active) {
        if (info.mode !== "okada" && info.mode !== "keke") continue;
        small += 1;
        for (const id of info.segmentIds.slice(info.released)) if (trunks.has(id)) onTrunk += 1;
      }
    });
    days(off, 6);
    expect(trunkSet(on).size).toBeGreaterThan(0);
    expect(small).toBeGreaterThan(0);
    expect(onTrunk).toBe(0);
    expect(tripsMade(on)).toBeGreaterThan(tripsMade(off) * 0.97);
  }, 360_000);
});
