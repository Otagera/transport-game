// The gym (the Shallot assessment, 2026-10-30): the brief's checks as scenarios with verdicts a
// machine reads, so a check that has slipped says so instead of waiting for someone to remember it.
// Each `*.gym.ts` names its check, its seeds and horizon, and the assertion that makes it pass; this
// plays them (the strategist, GYM=1: one JSON line a map) and prints a table. Minutes, not seconds:
// on demand, not in `bun run verify`.
//
//   bun gym/run.ts            # every scenario
//   bun gym/run.ts C14        # the scenarios for one check
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

/** What the strategist reports a map (scripts/game-strategist.ts, GYM=1). */
export interface StrategistResult {
  seed: number;
  days: number;
  c14: { early: { length: number; start: number }; late: { length: number; start: number } };
  c11: { chains: number | null; goods80to100: number };
  c2: { waited: number };
}

export interface Scenario {
  check: string;
  title: string;
  seeds: number[];
  days: number;
  verdict: (r: StrategistResult) => { pass: boolean; measured: string; wanted: string };
}

const ROOT = new URL("..", import.meta.url).pathname;
const only = process.argv[2];
const scenarios: Scenario[] = [];
for (const file of readdirSync(`${ROOT}gym`).filter((f) => f.endsWith(".gym.ts")).sort()) {
  const mod = (await import(`${ROOT}gym/${file}`)) as { scenarios: Scenario[] };
  scenarios.push(...mod.scenarios.filter((s) => !only || s.check === only || s.check.startsWith(`${only} `)));
}
if (scenarios.length === 0) {
  console.error(only ? `no scenario for ${only}` : "no scenarios in gym/");
  process.exit(2);
}

// One strategist run per (seeds, days), shared by every scenario that asks for it.
const runs = new Map<string, StrategistResult[]>();
for (const s of scenarios) {
  const key = `${s.seeds.join(",")}|${s.days}`;
  if (runs.has(key)) continue;
  console.error(`playing seeds ${s.seeds.join(", ")} to day ${s.days}...`);
  const out = spawnSync("bun", ["scripts/game-strategist.ts"], { cwd: ROOT, env: { ...process.env, GYM: "1", SEEDS: s.seeds.join(","), DAYS: String(s.days) }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) {
    console.error(out.stderr);
    process.exit(1);
  }
  runs.set(key, out.stdout.split("\n").filter((l) => l.startsWith("GYM ")).map((l) => JSON.parse(l.slice(4)) as StrategistResult));
}

const rows: string[][] = [["check", "map", "measured", "wanted", "verdict"]];
let failed = 0;
for (const s of scenarios) {
  for (const r of runs.get(`${s.seeds.join(",")}|${s.days}`) ?? []) {
    const v = s.verdict(r);
    if (!v.pass) failed += 1;
    rows.push([s.check, String(r.seed), v.measured, v.wanted, v.pass ? "pass" : "FAIL"]);
  }
}
const widths = rows[0]!.map((_, c) => Math.max(...rows.map((row) => row[c]!.length)));
for (const row of rows) console.log(row.map((cell, c) => cell.padEnd(widths[c]!)).join("  "));
console.log(`\n${rows.length - 1 - failed} pass, ${failed} fail`);
process.exit(failed > 0 ? 1 : 0);
