import { describe, expect, test } from "bun:test";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "./support/worlds"; // built once, copied after
import { gameTick } from "@engine/game/tick";
import { SIM_DT } from "@engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "@engine/economy/state";
import { canoeTotals, canoeWay } from "@engine/game/canoes";
import { fishSold } from "@engine/game/fishing";
import { networkShare } from "@engine/game/world";
import type { GameTuning, GameWorld } from "@engine/game/types";

// The informal canoes (canoes.ts; docs/water.md, Step 5): C61-C63.

const start = (overrides: Partial<GameTuning> = {}) => startRun(GAME_MAP, 949, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, ...overrides });
const days = (w: GameWorld, n: number) => {
  for (let i = 0; i < Math.round((n * D) / SIM_DT); i += 1) gameTick(w, SIM_DT);
};
const sold = (w: GameWorld) => w.fishing!.landings.reduce((s, l) => s + fishSold(w, l), 0);

describe("informal canoes (canoes.ts)", () => {
  test("C61/C62: canoes take riders who'd go home, never one a danfo or okada would take, and carry fish -- they only add", () => {
    const off = start({ canoesEnabled: undefined }), on = start();
    expect(off.canoes).toBeUndefined(); // a game played before them has none
    days(off, 6);
    days(on, 6);
    const c = canoeTotals(on);
    expect(c.riders).toBeGreaterThan(0);
    expect(c.fish).toBeGreaterThan(0);
    // Fewer go home, more go informal; the fish sold's no less.
    expect(networkShare(on).lost).toBeLessThan(networkShare(off).lost);
    expect(networkShare(on).informal).toBeGreaterThan(networkShare(off).informal);
    expect(sold(on)).toBeGreaterThanOrEqual(sold(off));
    // Each stretch carries no more than its cap.
    for (const rate of on.canoes!.riders.values()) expect(rate * D).toBeLessThanOrEqual(on.tuning.canoeRidersPerDay! * 1.01);
  }, 180_000);

  test("C63: a canoe goes only where the water joins two places, any width", () => {
    const w = start();
    const towns = [...w.towns.values()].filter((t) => !t.industry);
    const joined = towns.flatMap((a) => towns.map((b) => [a.id, b.id] as const)).filter(([a, b]) => a !== b && canoeWay(w, a, b));
    expect(joined.length).toBeGreaterThan(0);
    // Wider than any boat needs is no condition: some pair a canoe joins, no water bus could.
    const width = w.tuning.canoeMinWidth!;
    expect(width).toBeLessThan(w.tuning.waterBusMinWidth!);
    expect(canoeWay(w, towns[0]!.id, towns[0]!.id)).toBeNull();
  }, 120_000);
});
