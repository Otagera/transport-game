// Why a seats pledge doesn't move (2026-11-01): one pair's trips -- wanted, yours, the danfos', no seat --
// as buses go on it one at a time.
import { startRun } from "../../src/engine/game/runlog";
import { GAME_MAP } from "../../src/game/map";
import { gameTick } from "../../src/engine/game/tick";
import { applyAction } from "../../src/engine/game/actions";
import { noSeatPairs } from "../../src/engine/game/problems";
import { SIM_DT } from "../../src/engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "../../src/engine/economy/state";

const seed = Number(process.argv[2] ?? 2411);
const kind = (process.argv[3] ?? "bus") as "bus" | "minibus";
const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, {});
w.economy.funds = 1e7;
const pledge = w.term!.pledges.find((p) => p.kind === "seats");
const town = pledge?.townId ?? [...w.towns.values()].sort((a, b) => b.population - a.population)[0]!.id;
const worst = noSeatPairs(w).find((p) => p.a === town || p.b === town)!;
const other = worst.a === town ? worst.b : worst.a;
const name = (id: string) => w.towns.get(id)?.name ?? id;
const day = () => { for (let i = 0; i < D / SIM_DT; i++) gameTick(w, SIM_DT); };
const read = () => {
  const r = [`${town}:${other}`, `${other}:${town}`].map((k) => w.pairOutcomes.get(k)).filter(Boolean);
  const sum = (f: (x: NonNullable<(typeof r)[0]>) => number) => Math.round(r.reduce((s, x) => s + f(x!), 0) * D);
  return `wanted ${sum((x) => x.player + x.poached + x.lost + x.gaveUp)}, yours ${sum((x) => x.player)}, danfos ${sum((x) => x.poached)}, no seat ${sum((x) => x.lost)}, gave up ${sum((x) => x.gaveUp)}`;
};
console.log(`${name(town)} <-> ${name(other)}: ${read()}`);
for (let n = 1; n <= 8; n++) {
  const r = applyAction(w, { kind, a: town, b: other });
  for (let d = 0; d < 4; d++) day();
  console.log(`${n} ${kind}${n > 1 ? "es" : ""}${r.ok ? "" : ` (refused: ${r.reason})`}, 4 days on: ${read()}`);
}
