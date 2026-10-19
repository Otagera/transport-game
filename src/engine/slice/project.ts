import type { SliceWorld } from "./types";
import type { SliceEvent } from "./settlement";
import { laneCost, roadChain } from "./world";
import { planRail, railPath, railRouteId } from "./rail";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// The named project (docs/brief.md, Revision 1: "the treasury leaves a named
// project alone, for a while"; Open question 9). Name the rung you're saving
// for -- a corridor and a rung -- and what you hold toward its price isn't
// remitted (budget.ts remit). If it isn't built within projectLapseDays, the
// set-aside lapses to the treasury: a commitment, not a place to hide money.
// One at a time.

export type ProjectRung = "lane" | "rail";

export interface NamedProject {
  a: string;
  b: string;
  rung: ProjectRung;
  price: number;
  namedAt: number;
}

/** What the rung costs: a bus lane on the road; rail is track along the corridor and its first train. */
export function rungPrice(world: SliceWorld, a: string, b: string, rung: ProjectRung): number {
  if (rung === "lane") return laneCost(world, a, b);
  const plan = planRail(world, a, b, "cheapest");
  return plan ? plan.cost + world.tuning.trainPurchaseCost : Infinity;
}

/** Whether the rung is built on that corridor. */
function built(world: SliceWorld, project: NamedProject): boolean {
  if (project.rung === "lane") return (roadChain(world, project.a, project.b) ?? []).every((piece) => piece.busLane);
  return railPath(world, project.a, project.b) !== null && world.routes.some((route) => route.id === railRouteId(project.a, project.b));
}

export function nameProject(world: SliceWorld, a: string, b: string, rung: ProjectRung): { ok: boolean; reason?: string } {
  const price = rungPrice(world, a, b, rung);
  if (!Number.isFinite(price)) return { ok: false, reason: "that can't be built there" };
  world.project = { a, b, rung, price, namedAt: world.economy.elapsedSeconds };
  return { ok: true };
}

export function dropProject(world: SliceWorld): void {
  world.project = null;
}

/** Money the treasury leaves alone now: what you hold toward the project's price, above the reserve. */
export function heldForProject(world: SliceWorld): number {
  const project = world.project;
  if (!project) return 0;
  return Math.max(0, Math.min(project.price, world.economy.funds - world.tuning.remittanceReserve));
}

/** The day a project lapses. */
export function projectLapsesAt(world: SliceWorld, project: NamedProject): number {
  return project.namedAt + world.tuning.projectLapseDays * SECONDS_PER_GAME_DAY;
}

/** Called every tick, before the remittance: a built project is done; an unbuilt one past its time lapses. */
export function updateProject(world: SliceWorld): SliceEvent[] {
  const project = world.project;
  if (!project) return [];
  if (built(world, project)) {
    world.project = null;
    return [{ kind: "project-done", a: project.a, b: project.b, rung: project.rung }];
  }
  if (world.economy.elapsedSeconds < projectLapsesAt(world, project)) return [];
  // Lapsed: the treasury takes its share of what was held, at once.
  const taken = world.tuning.remittanceShare * heldForProject(world);
  world.economy.funds -= taken;
  world.budget.remitted += taken;
  world.project = null;
  return [{ kind: "project-lapsed", a: project.a, b: project.b, rung: project.rung, taken }];
}
