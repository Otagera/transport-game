import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "@engine/game/runlog";
import { applyAction } from "@engine/game/actions";
import { gameTick } from "@engine/game/tick";
import { SIM_DT } from "@engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";
import { goodsFlows, flowKey } from "@engine/game/goods";
import { shortageAt } from "@engine/game/fuel";
import { roadPath } from "@engine/game/world";
import { pipeId, pipeServes, strikePipe, type Pipeline } from "@engine/game/pipelines";
import { isClosed, landOf, remitOn } from "@engine/game/remit";
import type { GameTuning, GameWorld } from "@engine/game/types";

// Pipelines (pipelines.ts; brief, Decisions log, 2026-11-03, five modes scoped): the scope's
// checks, on map 2418 -- at nothing on the dial it changes nothing; at the full dial its corridor's
// tankers go; a strike costs more the more of it went by pipe; the union follows the dial.

const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 2418, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, startingFunds: 2e6, ...overrides });
const days = (w: GameWorld, n: number, answer?: "pay") => {
  for (let d = 0; d < n; d += 1) {
    for (let i = 0; i < Math.round(D / SIM_DT); i += 1) gameTick(w, SIM_DT);
    if (answer) for (const u of w.unions ?? []) if (u.demand) applyAction(w, { kind: "union", unionId: u.id, answer });
  }
};
/** The town the tank farm sends most fuel, 40+ road cells off it: a pipe's corridor worth the name. */
const farTown = (w: GameWorld) => {
  const depot = w.fuel!.depotId;
  return goodsFlows(w).filter((f) => f.from === depot && !w.towns.get(f.to)?.industry && (roadPath(w, depot, f.to)?.distance ?? 0) >= 40).sort((a, b) => b.rate - a.rate)[0]!.to;
};
const pipeTo = (w: GameWorld, to: string, dial: number) => {
  const depot = w.fuel!.depotId;
  expect(applyAction(w, { kind: "pipe", a: depot, b: to }).ok).toBe(true);
  const id = pipeId(depot, to);
  if (dial > 0) expect(applyAction(w, { kind: "pipeDial", id, dial }).ok).toBe(true);
  return w.pipelines!.find((p) => p.id === id)!;
};
const tankersFor = (w: GameWorld, to: string) => w.simulation.vehicles.filter((v) => v.id.startsWith("truck-") && v.cargo.some((c) => c.from === w.fuel!.depotId && (c.to === to || c.trip?.destination === to))).length;

describe("pipelines (pipelines.ts; five modes scoped, the pipeline)", () => {
  test("the inherited line: broken, from the tank farm up the old railway; restored at ₦700 a cell, at nothing on the dial", () => {
    const w = start();
    const old = w.pipelines!.find((p) => p.inherited)!;
    expect(old.a).toBe(w.fuel!.depotId);
    expect(old.working).toBe(false);
    expect(old.cells).toBeGreaterThan(40);
    const funds = w.economy.funds;
    expect(applyAction(w, { kind: "pipeDial", id: old.id, dial: 1 }).ok).toBe(false); // broken: restore it first
    const restored = applyAction(w, { kind: "restorePipe", id: old.id });
    if (restored.ok) {
      expect(w.economy.funds).toBeCloseTo(funds - Math.round(old.cells * 700), 6);
      expect(old.working).toBe(true);
      expect(old.dial).toBe(0);
    } else expect(restored.reason).toMatch(/remit/); // its far end in a cluster not yet yours
  }, 120_000);

  test("at nothing on the dial a pipe changes nothing: the fuel goes as it would without it", () => {
    const a = start(), b = start();
    pipeTo(b, farTown(b), 0);
    days(a, 4);
    days(b, 4);
    const depot = a.fuel!.depotId;
    for (const f of goodsFlows(a).filter((x) => x.from === depot)) {
      const ka = a.goods.outcomes.get(flowKey(f)), kb = b.goods.outcomes.get(flowKey(f));
      expect(kb?.trucked ?? 0).toBeCloseTo(ka?.trucked ?? 0, 9);
      expect(kb?.delivered ?? 0).toBeCloseTo(ka?.delivered ?? 0, 9);
    }
    expect(b.unions!.find((u) => u.id === "home")!.stance).toBe(a.unions!.find((u) => u.id === "home")!.stance);
  }, 180_000);

  test("at the full dial, under its cap, its corridor's tankers go and the fuel comes by pipe", () => {
    const w = start();
    const to = farTown(w);
    const before = (() => { const v = start(); days(v, 6, "pay"); return tankersFor(v, to); })();
    const pipe = pipeTo(w, to, 1);
    days(w, 6, "pay");
    expect(before).toBeGreaterThan(0);
    expect(tankersFor(w, to)).toBeLessThanOrEqual(Math.max(1, Math.floor(before / 4)));
    expect(pipe.carried * D).toBeGreaterThan(0);
    expect(pipe.carried * D).toBeLessThanOrEqual((w.tuning.pipeCapPerDay ?? 250) + 1e-6);
    expect(pipe.tankers).toBeLessThan(1);
  }, 180_000);

  test("a strike costs more at the full dial than at half: the tankers it would fall back on have gone", () => {
    const shortfall = (dial: number) => {
      const w = start();
      const to = farTown(w);
      const pipe = pipeTo(w, to, dial);
      days(w, 16, "pay");
      const served = goodsFlows(w).filter((f) => f.from === w.fuel!.depotId && pipeServes(w, pipe, f.to)).map((f) => f.to);
      expect(strikePipe(w, pipe.a, pipe.b)?.kind).toBe("pipe-out");
      let sum = 0;
      for (let d = 0; d < 9; d += 1) {
        days(w, 1, "pay");
        sum += served.reduce((s, t) => s + shortageAt(w, t), 0) / served.length;
      }
      return { mean: sum / 9, tankers: pipe.tankers };
    };
    const full = shortfall(1), half = shortfall(0.5);
    expect(full.mean).toBeGreaterThan(half.mean);
  }, 300_000);

  test("the union follows the dial: up brings a demand; conceding halves it; refusing shuts the pipe; off meets it", () => {
    const w = start();
    const pipe: Pipeline = pipeTo(w, farTown(w), 0);
    const home = w.unions!.find((u) => u.id === "home")!;
    expect(home.demand).toBeNull(); // building it alone costs money, not the chairman
    expect(applyAction(w, { kind: "pipeDial", id: pipe.id, dial: 0.8 }).ok).toBe(true);
    expect(home.demand?.kind).toBe("pipeline");
    expect(home.stance).toBeLessThan(0);
    expect(applyAction(w, { kind: "union", unionId: home.id, answer: "concede" }).ok).toBe(true);
    expect(pipe.dial).toBe(0.4);
    expect(applyAction(w, { kind: "pipeDial", id: pipe.id, dial: 0.9 }).ok).toBe(true);
    expect(applyAction(w, { kind: "union", unionId: home.id, answer: "refuse" }).ok).toBe(true);
    expect(pipe.outReason).toBe("strike");
    expect(pipe.outUntil).toBeGreaterThan(w.economy.elapsedSeconds);
    // A demand for it, then turned off: met.
    const w2 = start();
    const p2 = pipeTo(w2, farTown(w2), 0.5);
    const h2 = w2.unions!.find((u) => u.id === "home")!;
    expect(h2.demand?.kind).toBe("pipeline");
    expect(applyAction(w2, { kind: "pipeDial", id: p2.id, dial: 0 }).ok).toBe(true);
    expect(h2.demand).toBeNull();
  }, 180_000);

  test("the tonnes push him against you day by day: the temperature follows the flow, not the build", () => {
    // The same game with and without the push a tonne gives (pipeUnionPerTonneDay): the gap is the tonnes'.
    const run = (perTonne: number) => {
      const w = start({ pipeUnionPerTonneDay: perTonne });
      const pipe = pipeTo(w, farTown(w), 1);
      days(w, 8, "pay");
      return { stance: w.unions!.find((u) => u.id === "home")!.stance, tonnes: pipe.carried * D };
    };
    const pushed = run(start().tuning.pipeUnionPerTonneDay ?? 0), not = run(0);
    expect(pushed.tonnes).toBeGreaterThan(10);
    expect(pushed.stance).toBeLessThan(not.stance - 0.002);
  }, 240_000);

  test("a pipe ends at a town and starts at the tank farm or a refinery; the remit holds", () => {
    const w = start();
    const town = farTown(w);
    expect(applyAction(w, { kind: "pipe", a: town, b: w.fuel!.depotId }).ok).toBe(false);
    expect(applyAction(w, { kind: "pipe", a: w.fuel!.depotId, b: w.fuel!.refineryId }).ok).toBe(false);
    const far = [...w.towns.values()].find((t) => !t.industry && remitOn(w) && isClosed(w, landOf(w, t)) && roadPath(w, w.fuel!.depotId, t.id));
    if (far) {
      const r = applyAction(w, { kind: "pipe", a: w.fuel!.depotId, b: far.id });
      expect(r.ok).toBe(false);
    }
  }, 120_000);
});
