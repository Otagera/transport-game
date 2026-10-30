// C14, no dead stretch (docs/brief.md, Checks for Revision 3): from day 60 to day 150, no stretch of
// 15 days without a move worth making -- read off the strategist, which plays the game's own advice
// (scripts/game-strategist.ts: a day with nothing built counts as quiet). And after day 150, where
// status.md has it failing (stretches up to 32 days past ~200), so a fix -- or a slide -- shows.
import type { Scenario } from "./run";

export const scenarios: Scenario[] = [
  {
    check: "C14",
    title: "no dead stretch, days 60-150",
    seeds: [0, 543, 2411],
    days: 300,
    verdict: (r) => ({ pass: r.c14.early.length < 15, measured: `${r.c14.early.length} days from day ${r.c14.early.start}`, wanted: "< 15" }),
  },
  {
    check: "C14 late",
    title: "no dead stretch, days 150-300 (failing since ~day 200: status.md)",
    seeds: [0, 543, 2411],
    days: 300,
    verdict: (r) => ({ pass: r.c14.late.length < 15, measured: `${r.c14.late.length} days from day ${r.c14.late.start}`, wanted: "< 15" }),
  },
];
