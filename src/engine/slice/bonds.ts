import type { SliceWorld } from "./types";
import type { ActionResult } from "./world";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import { SWITCHED_OFF } from "./tuning";
import { restoreRefinery } from "./fuel";
import { restoreWorks } from "./cement";
import { heldForProject } from "./project";

// Bonds (docs/brief.md, Revision 3, money, from the step 2 playtest): borrow
// for a named purpose -- restoring the refinery, restoring the cement works,
// or what you still lack for your named project -- and repay it with
// interest, a fixed sum a day, until it's paid. True here (states issue
// infrastructure bonds), and the capital/operations split of Open question
// 9: the build now, out of income over time. The playtest's bind was a fix
// costing a lump the player couldn't hold (map 2791: the refinery
// ₦60,000, ₦31,861 the most held).
//
//   - A bond for a restore restores it at once; one for a project pays the
//     rest of its price into your funds, to build it with.
//   - Repaid over `bondTermDays`, `1 + bondInterest` times what was lent,
//     the same each day, billed in debt too (principles §3, Economy: debt
//     allowed, billing continues).
//   - Bounded: all repayments together at most `bondIncomeCap` of what you
//     take in a day, so a bond can't buy the game.

export type BondPurpose = "refinery" | "works" | "project";

export interface Bond {
  id: string;
  purpose: BondPurpose;
  /** What it was for, as the screen says it. */
  label: string;
  lent: number;
  perDay: number;
  /** Still to repay. */
  owed: number;
  issuedAtSeconds: number;
}

/** What a bond for this purpose would lend now; null when there's nothing to borrow for. */
export function bondAmount(world: SliceWorld, purpose: BondPurpose): number | null {
  const t = world.tuning;
  if (purpose === "refinery") return world.fuel && !world.fuel.restored ? t.refineryRestoreCost : null;
  if (purpose === "works") return world.cement && !world.cement.working ? t.worksRestoreCost : null;
  const project = world.project;
  if (!project) return null;
  const short = Math.ceil(project.price - heldForProject(world));
  return short > 0 ? short : null;
}

/** Repayments a day on every bond still owed. */
export function bondRepaymentsPerDay(world: SliceWorld): number {
  return world.bonds.reduce((sum, bond) => sum + (bond.owed > 0 ? bond.perDay : 0), 0);
}

/** What you take in a day (all income, the rolling rate the strip reads): what repayments are bounded by. */
function incomePerDay(world: SliceWorld): number {
  return world.economy.incomeRateEMA * SECONDS_PER_GAME_DAY;
}

/** A bond's daily repayment for `lent`. */
export function bondPerDay(world: SliceWorld, lent: number): number {
  return (lent * (1 + world.tuning.bondInterest)) / world.tuning.bondTermDays;
}

export function checkBond(world: SliceWorld, purpose: BondPurpose): ActionResult {
  if (!world.tuning.bondsEnabled) return { ok: false, reason: SWITCHED_OFF };
  const lent = bondAmount(world, purpose);
  if (lent === null) return { ok: false, reason: "nothing to borrow for" };
  if (world.bonds.some((bond) => bond.purpose === purpose && bond.owed > 0 && purpose !== "project")) return { ok: false, reason: "already borrowed for" };
  const cap = world.tuning.bondIncomeCap * incomePerDay(world);
  if (bondRepaymentsPerDay(world) + bondPerDay(world, lent) > cap) {
    return { ok: false, reason: `repayments would pass ${Math.round(world.tuning.bondIncomeCap * 100)}% of your income (₦${Math.round(cap).toLocaleString()} a day)` };
  }
  return { ok: true };
}

/** Issues a bond for a purpose: restores it, or pays the project's shortfall into your funds. */
export function issueBond(world: SliceWorld, purpose: BondPurpose): ActionResult & { lent?: number } {
  const check = checkBond(world, purpose);
  if (!check.ok) return check;
  const lent = bondAmount(world, purpose)!;
  world.economy.funds += lent;
  world.budget.borrowed += lent;
  world.sweep.borrowed += lent; // a bond's money is for its purpose: safe from the year-end sweep
  let label = "";
  if (purpose === "refinery") {
    const done = restoreRefinery(world);
    if (!done.ok) return undo(world, lent, done.reason);
    label = `restoring ${world.towns.get(world.fuel!.refineryId)?.name ?? "the refinery"}`;
  } else if (purpose === "works") {
    const done = restoreWorks(world);
    if (!done.ok) return undo(world, lent, done.reason);
    label = `restoring ${world.towns.get(world.cement!.worksId)?.name ?? "the cement works"}`;
  } else {
    const p = world.project!;
    label = `the ${p.rung === "lane" ? "bus lane" : "rail line"} on ${world.towns.get(p.a)?.name} – ${world.towns.get(p.b)?.name}`;
  }
  const perDay = bondPerDay(world, lent);
  world.bonds.push({ id: `bond-${world.nextId++}`, purpose, label, lent, perDay, owed: perDay * world.tuning.bondTermDays, issuedAtSeconds: world.economy.elapsedSeconds });
  return { ok: true, lent };
}

function undo(world: SliceWorld, lent: number, reason?: string): ActionResult {
  world.economy.funds -= lent;
  world.budget.borrowed -= lent;
  return { ok: false, reason: reason ?? "couldn't" };
}

/** Every tick: each bond's repayment for the tick, until it's paid. Returns what was paid. */
export function repayBonds(world: SliceWorld, dt: number): number {
  let paid = 0;
  for (const bond of world.bonds) {
    if (bond.owed <= 0) continue;
    const due = Math.min(bond.owed, (bond.perDay * dt) / SECONDS_PER_GAME_DAY);
    bond.owed -= due;
    paid += due;
  }
  world.economy.funds -= paid;
  world.budget.bonds += paid;
  return paid;
}
