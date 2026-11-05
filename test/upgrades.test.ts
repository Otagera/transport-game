import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "@engine/game/runlog";
import { applyAction } from "@engine/game/actions";
import { gameTick } from "@engine/game/tick";
import { SIM_DT } from "@engine/loop";
import { lineUpgrade, roadUpgrade } from "@engine/game/problems";
import { paveCost, roadChain, roadCost } from "@engine/game/world";
import { planRoad } from "@engine/game/roads";
import type { GameWorld } from "@engine/game/types";

// Upgrading where you're looking (problems.ts roadUpgrade, lineUpgrade; your map 5059 playtest:
// "upgrading hurt more"): a road's card names its next rung; a line's card paves all its dirt roads.

const start = () => startRun(GAME_MAP, 8703, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, startingFunds: 5e6 });

/** Two towns one dirt road joins, from the home city. */
function dirtPair(w: GameWorld): { a: string; b: string } {
  for (const t of w.towns.values()) {
    if (t.industry || t.id === w.port) continue;
    const chain = roadChain(w, w.port!, t.id);
    if (chain && chain.some((s) => s.surface !== "paved")) return { a: w.port!, b: t.id };
  }
  throw new Error("no dirt road from the home city");
}

describe("upgrading from the cards", () => {
  test("a road's card: paved, then a lane, then rail, each priced as the Road and Track tools price it", () => {
    const w = start();
    const { a, b } = dirtPair(w);
    const first = roadUpgrade(w, a, b)!;
    expect(first.move.action).toEqual({ kind: "pave", a, b });
    expect(first.move.price).toBe(paveCost(w, a, b));
    expect(applyAction(w, first.move.action).ok).toBe(true);
    const second = roadUpgrade(w, a, b)!;
    expect(second.move.action.kind).toBe("lane");
    expect(applyAction(w, second.move.action).ok).toBe(true);
    const third = roadUpgrade(w, a, b)!;
    expect(third.move.action.kind).toBe("track");
    expect(third.move.label).toContain("the road becomes the railway");
  }, 120_000);

  test("a line's card: all its dirt roads paved at once, one action a road, then nothing until it jams", () => {
    const w = start();
    const { a, b } = dirtPair(w);
    expect(applyAction(w, { kind: "bus", a, b }).ok).toBe(true);
    gameTick(w, SIM_DT);
    const routeId = w.routes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a))!.id;
    const up = lineUpgrade(w, routeId)!;
    expect(up.rung).toBe("paved");
    expect(up.roads.length).toBeGreaterThan(0);
    expect(up.price).toBe(up.roads.reduce((s, r) => s + r.price, 0));
    for (const road of up.roads) expect(applyAction(w, road.action).ok).toBe(true);
    expect(roadChain(w, a, b)!.every((s) => s.surface === "paved")).toBe(true);
    // Paved all the way and not jammed: a lane would buy nothing, so none is offered.
    expect(lineUpgrade(w, routeId)).toBeNull();
  }, 120_000);

  test("a road bent through a point you chose passes it, costs what its longer way costs, and replays", () => {
    const w = start();
    // Two towns no road joins directly.
    const towns = [...w.towns.values()].filter((t) => !t.industry);
    let pair: [string, string] | null = null;
    for (const p of towns) for (const q of towns) if (!pair && p.id < q.id && !roadChain(w, p.id, q.id) && Math.hypot(p.x - q.x, p.y - q.y) > 12 && Math.hypot(p.x - q.x, p.y - q.y) < 30 && planRoad(w, p.id, q.id)) pair = [p.id, q.id];
    const [a, b] = pair!;
    const A = w.towns.get(a)!, B = w.towns.get(b)!;
    // A point off to one side of the straight line, a third of its length away.
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const side = { x: mid.x - ((B.y - A.y) / len) * len / 3, y: mid.y + ((B.x - A.x) / len) * len / 3 };
    const plain = planRoad(w, a, b)!;
    const bent = planRoad(w, a, b, "cheapest", [side]);
    if (!bent) return; // over water or off the map: nothing to bend through here
    expect(bent.length).toBeGreaterThan(plain.length);
    expect(Math.min(...bent.polyline.map((p) => Math.hypot(p.x - side.x, p.y - side.y)))).toBeLessThan(2);
    expect(roadCost(w, a, b, "cheapest", false, [side])).toBe(bent.cost);
    const funds = w.economy.funds;
    expect(applyAction(w, { kind: "road", a, b, alignment: "cheapest", via: [side] }).ok).toBe(true);
    expect(funds - w.economy.funds).toBe(bent.cost);
    expect(roadChain(w, a, b)).not.toBeNull();
  }, 120_000);
});
