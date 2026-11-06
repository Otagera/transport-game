import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "./support/worlds"; // built once, copied after
import { applyAction } from "@engine/game/actions";
import { gameTick } from "@engine/game/tick";
import { SIM_DT } from "@engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";
import { checkBoat, jettyLanding, waterWay } from "@engine/game/boats";
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
    const to = towns(w).find((t) => t.id !== port && jettyLanding(w, t.id) && waterWay(w, port, t.id, "barge"));
    if (!jettyLanding(w, port) || !to) return; // the map gives no barge leg from the port
    applyAction(w, { kind: "jetty", townId: port });
    applyAction(w, { kind: "jetty", townId: to.id });
    expect(applyAction(w, { kind: "barge", a: port, b: to.id }).ok).toBe(true);
    days(w, 8);
    expect(lorrySummaries(w).find((r) => r.id.startsWith("barge:"))!.incomePerDay).toBeGreaterThan(0);
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
});
