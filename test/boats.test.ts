import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "./support/worlds"; // built once, copied after
import { applyAction } from "@engine/game/actions";
import { gameTick } from "@engine/game/tick";
import { SIM_DT } from "@engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";
import { checkBoat, crossingsInTheWay, cutLines, hasJetty, jettyLanding, waterWay } from "@engine/game/boats";
import { inRemit } from "@engine/game/remit";
import { waterway } from "@engine/game/waterways";
import { routingFor } from "@engine/game/rail";
import { roadPath, routeSummaries } from "@engine/game/world";
import { lorrySummaries } from "@engine/game/goods";
import type { GameTuning, GameWorld } from "@engine/game/types";

// Jetties and boats (boats.ts, waterways.ts; docs/water.md, Step 2): C51 and C52.

const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 8703, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, startingFunds: 2e5, ...overrides });
const towns = (w: GameWorld) => [...w.towns.values()].filter((t) => !t.industry);
/** Two jetty towns the water joins for a water bus, the busiest-looking first: the home city and its nearest such. */
function waterPair(w: GameWorld, alsoByRoad: boolean): [string, string] {
  const jettied = towns(w).filter((t) => jettyLanding(w, t.id));
  for (const a of jettied) for (const b of jettied) {
    if (a.id >= b.id || !waterWay(w, a.id, b.id, "boat")) continue;
    if (alsoByRoad !== !!roadPath(w, a.id, b.id)) continue;
    return [a.id, b.id];
  }
  throw new Error("no pair");
}
const days = (w: GameWorld, n: number) => {
  for (let i = 0; i < Math.round((n * D) / SIM_DT); i += 1) gameTick(w, SIM_DT);
};

describe("jetties and boats (boats.ts)", () => {
  test("a jetty only where a boat can use the water, at its price; none in a game played before them", () => {
    const w = start();
    const dry = towns(w).find((t) => !jettyLanding(w, t.id))!;
    expect(applyAction(w, { kind: "jetty", townId: dry.id }).ok).toBe(false);
    const wet = towns(w).find((t) => jettyLanding(w, t.id))!;
    const funds = w.economy.funds;
    expect(applyAction(w, { kind: "jetty", townId: wet.id }).ok).toBe(true);
    expect(funds - w.economy.funds).toBe(w.tuning.jettyCost!);
    expect(applyAction(w, { kind: "jetty", townId: wet.id }).ok).toBe(false);
    const old = start({ boatsEnabled: undefined });
    expect(applyAction(old, { kind: "jetty", townId: wet.id }).ok).toBe(false);
    // Not outside your remit (remit.ts), as no other site is.
    const far = towns(w).find((t) => !inRemit(w, t.id) && jettyLanding(w, t.id) && !hasJetty(w, t.id));
    if (far) expect(applyAction(w, { kind: "jetty", townId: far.id }).reason).toMatch(/outside your remit/);
  }, 120_000);

  test("C51: a boat only between two jetties the water joins at its width; a barge never on water under its width", () => {
    const w = start();
    const [a, b] = waterPair(w, true);
    expect(checkBoat(w, a, b, "boat").ok).toBe(false); // no jetties yet
    applyAction(w, { kind: "jetty", townId: a });
    applyAction(w, { kind: "jetty", townId: b });
    expect(checkBoat(w, a, b, "boat").ok).toBe(true);
    // Every way a barge is offered keeps to water at least its width (or the sea): with a barge
    // needing 3 cells, every point of every way lies on such water, and some pairs a water bus
    // joins are refused it.
    w.tuning.bargeMinWidth = 3;
    const way = waterway(w);
    const at = new Map(way.nodes.map((n) => [`${n.x},${n.y}`, n]));
    const jettied = towns(w).filter((t) => jettyLanding(w, t.id));
    let refused = 0, passed = 0;
    for (const p of jettied) for (const q of jettied) {
      if (p.id >= q.id || !waterWay(w, p.id, q.id, "boat")) continue;
      const barge = waterWay(w, p.id, q.id, "barge");
      if (!barge) {
        refused += 1;
        continue;
      }
      passed += 1;
      for (const [x, y] of barge.points.slice(1, -1)) {
        const n = at.get(`${x},${y}`)!;
        expect(n.sea || n.width >= 3).toBe(true);
      }
    }
    expect(refused).toBeGreaterThan(0);
    expect(passed).toBeGreaterThan(0);
  }, 120_000);

  test("C52: a boat between two towns that share a road is never on it -- no flow, no wear, no danfo's space -- and carries riders who pay by the water", () => {
    const w = start();
    const [a, b] = waterPair(w, true);
    for (const t of [a, b]) expect(applyAction(w, { kind: "jetty", townId: t }).ok).toBe(true);
    expect(applyAction(w, { kind: "boat", a, b }).ok).toBe(true);
    const boat = [...w.boatVehicles!][0]!;
    const vehicle = w.simulation.vehicles.find((v) => v.id === boat)!;
    expect(routingFor(w, vehicle)).not.toBe(w.simulation.routing);
    for (let day = 0; day < 6; day += 1) {
      for (let i = 0; i < Math.round(D / SIM_DT); i += 1) {
        gameTick(w, SIM_DT);
        expect(w.vehicleSegment.has(boat)).toBe(false); // never on a road (or track)
      }
    }
    const line = routeSummaries(w).find((r) => r.id.startsWith("boat:"))!;
    expect(line.incomePerDay).toBeGreaterThan(0);
  }, 240_000);

  test("selling a line's last boat takes its way off the water; a barge carries goods between jetties", () => {
    const w = start();
    const [a, b] = waterPair(w, true);
    for (const t of [a, b]) applyAction(w, { kind: "jetty", townId: t });
    expect(applyAction(w, { kind: "boat", a, b }).ok).toBe(true);
    expect(w.waterLinks).toHaveLength(1);
    const id = w.routes.find((r) => r.id.startsWith("boat:"))!.id;
    expect(applyAction(w, { kind: "sell", routeId: id }).ok).toBe(true);
    expect(w.waterLinks).toHaveLength(0);
    expect(w.boatVehicles!.size).toBe(0);
    // A barge from the home city (the port's supplies leave from it) to a jetty town it reaches.
    const port = w.port!;
    // A long haul, past the hauliers' reach: a short one is theirs (principles §3), and they lift it first.
    const to = towns(w).filter((t) => t.id !== port && jettyLanding(w, t.id) && waterWay(w, port, t.id, "barge")).sort((p, q) => waterWay(w, port, q.id, "barge")!.length - waterWay(w, port, p.id, "barge")!.length)[0];
    if (!jettyLanding(w, port) || !to) return; // the map gives no barge leg from the port
    applyAction(w, { kind: "jetty", townId: port });
    applyAction(w, { kind: "jetty", townId: to.id });
    expect(applyAction(w, { kind: "barge", a: port, b: to.id }).ok).toBe(true);
    // A long haul at a barge's pace delivers every few days: what it carried over the run, not its last day's.
    const barge = w.simulation.vehicles.find((v) => v.carries === "goods" && w.boatVehicles!.has(v.id))!;
    let loaded = 0;
    for (let day = 0; day < 16; day += 1) {
      days(w, 1);
      loaded = Math.max(loaded, barge.cargo.reduce((sum, c) => sum + c.amount, 0));
    }
    expect(loaded).toBeGreaterThan(0);
    expect(lorrySummaries(w).some((r) => r.id.startsWith("barge:"))).toBe(true);
  }, 240_000);

  test("replays as played: the same moves on the same seed end the same", () => {
    const run = () => {
      const w = start();
      const [a, b] = waterPair(w, true);
      for (const t of [a, b]) applyAction(w, { kind: "jetty", townId: t });
      applyAction(w, { kind: "boat", a, b });
      days(w, 3);
      return [w.economy.funds, w.informal.earnings];
    };
    expect(run()).toEqual(run());
  }, 240_000);

  // The crossings (water.md, Step 3, agreed 2026-11-09): a ford stops a barge, not a water bus; a
  // causeway you build stops every boat; raised, either lets every boat by; under the rains too.
  /** Two jetty towns a water bus joins, past an old ford a barge can't cross. */
  function fordedPair(w: GameWorld): [string, string] {
    const jettied = towns(w).filter((t) => jettyLanding(w, t.id));
    for (const a of jettied) for (const b of jettied) {
      if (a.id >= b.id || !waterWay(w, a.id, b.id, "boat")) continue;
      if (crossingsInTheWay(w, a.id, b.id, "barge").length > 0 && !waterWay(w, a.id, b.id, "barge")) return [a.id, b.id];
    }
    throw new Error("no forded pair");
  }

  test("C55: an old ford stops a barge, named with its price, not a water bus; raised, the barge passes", () => {
    const w = start();
    const [a, b] = fordedPair(w);
    for (const t of [a, b]) applyAction(w, { kind: "jetty", townId: t });
    expect(checkBoat(w, a, b, "boat").ok).toBe(true);
    const refused = checkBoat(w, a, b, "barge");
    expect(refused.ok).toBe(false);
    const fords = crossingsInTheWay(w, a, b, "barge");
    expect((refused as { reason: string }).reason).toContain(fords[0]!.name);
    for (const ford of fords) expect(applyAction(w, { kind: "bridgeFord", fordId: ford.id }).ok).toBe(true);
    expect(checkBoat(w, a, b, "barge").ok).toBe(true);
    // Absent in a game played before it: no ford stops anything.
    const old = start({ boatsBlockedByFords: undefined });
    expect(waterWay(old, a, b, "barge")).not.toBeNull();
  }, 240_000);

  test("C56: a causeway you build across your line stops its boats until you raise it", () => {
    const w = start();
    const [a, b] = waterPair(w, true);
    for (const t of [a, b]) applyAction(w, { kind: "jetty", townId: t });
    expect(applyAction(w, { kind: "boat", a, b }).ok).toBe(true);
    const link = w.waterLinks![0]!;
    // A causeway across the middle of its way, as buildRoad's addCauseways records one.
    const [x, y] = link.points[Math.floor(link.points.length / 2)]!;
    w.floods!.fords.push({ id: `ford-${w.floods!.fords.length}`, name: "Test causeway", x, y, span: 2, a, b, bridged: false, built: true });
    expect(cutLines(w).has(link.id)).toBe(true);
    const boat = w.simulation.vehicles.find((v) => v.id === [...w.boatVehicles!][0])!;
    const where = () => `${boat.pathIndex}:${boat.edgeProgress}`;
    const before = where();
    days(w, 1);
    expect(where()).toBe(before); // waits at the bank
    expect(applyAction(w, { kind: "bridgeFord", fordId: w.floods!.fords.at(-1)!.id }).ok).toBe(true);
    expect(cutLines(w).has(link.id)).toBe(false);
    days(w, 1);
    expect(where()).not.toBe(before);
  }, 240_000);

  test("C57: under the rains, a barge passes the ford they flood", () => {
    const w = start();
    const [a, b] = fordedPair(w);
    const fords = crossingsInTheWay(w, a, b, "barge");
    expect(waterWay(w, a, b, "barge")).toBeNull();
    w.floods!.phase = "flood";
    w.floods!.under = fords.map((f) => f.id);
    expect(waterWay(w, a, b, "barge")).not.toBeNull();
  }, 240_000);
});
