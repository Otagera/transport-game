// The strategist: a long-game bot for Revision 3's checks (docs/brief.md,
// Checks for Revision 3; status.md: "the bots don't play the ladder"). The
// personas in game-bots.ts play 40 days with buses and roads; the checks
// that matter now -- C2, C4, C5, C11, C14 -- need a game played to day 250
// with the whole ladder and the chains. This plays one the way a sensible
// player does, from the game's own advice, once a game day:
//
//   - connect a cut-off town; add a vehicle where riders find no seat
//     (namedMoves: what the screen names), keep up a worn road it runs on;
//   - climb: a town grown to all its road allows gets the next rung (pave,
//     a bus lane, rail and a train), saved for or borrowed for;
//   - chains: restore the refinery or the works when towns are short (cash,
//     else a bond), give sites a road, buy a lorry where the lorry hint says
//     one more pays, expand a site that's at capacity while towns go short;
//   - prune: sell a route that's lost money five days running.
//
// No forecasts: it's the player who reads the screen, not the oracle, and
// it runs ~250 days a map in a minute or two. It measures as it plays.
//
//   bun scripts/game-strategist.ts                     # maps 0, 543, 2411; 250 days
//   SEEDS=1,2 DAYS=300 bun scripts/game-strategist.ts
//   GAME_TUNING='{"goodsFarePerTonneCell":0.15}' ...  # tuning overrides
//   LOG=1 ...                                           # every move as it's made

import { GAME_MAP } from "../src/game/map";
import { startRun } from "../src/engine/game/runlog";
import { applyAction, type ActionSpec } from "../src/engine/game/actions";
import { gameTick } from "../src/engine/game/tick";
import { SIM_DT } from "../src/engine/loop";
import { SECONDS_PER_GAME_DAY as D } from "../src/engine/economy/state";
import { affordable, namedMoves, noSeatPairs } from "../src/engine/game/problems";
import { diagnoseRoute, pairDemand } from "../src/engine/game/world";
import { isRailRoute, railPath, trackCost } from "../src/engine/game/rail";
import { roadFull } from "../src/engine/game/growth";
import { rungPrice } from "../src/engine/game/project";
import { headline, isCutOff, paveCost, roadPath, routeSummaries, roadCost, tripsFrom } from "../src/engine/game/world";
import { averageNet } from "../src/engine/game/history";
import { flowKey, goodsFlows, lorryEstimate, lorrySummaries } from "../src/engine/game/goods";
import { siteProduction } from "../src/engine/game/production";
import { expandCost } from "../src/engine/game/expand";
import { bondAmount, checkBond as gameCheckBond } from "../src/engine/game/bonds";
import type { BondPurpose } from "../src/engine/game/bonds";
import { seaportLink } from "../src/engine/game/gateways";
import { parkLevyGain } from "../src/engine/game/parks";
import { freightLineSplit } from "../src/engine/game/freightrates";
import { checkMetro, metroLines, metroPrice, metroRiders } from "../src/engine/game/metro";
import { crudeArriving, fuelSupply, newRefinery, newRefineryCapacity, newRefineryCrude, newRefineryOutput } from "../src/engine/game/fuel";
import { townGrowth } from "../src/engine/game/growth";
import { marketFed, marketTowns } from "../src/engine/game/food";
import type { GameWorld } from "../src/engine/game/types";

const SEEDS = (process.env.SEEDS ?? "0,543,2411").split(",").map(Number);
const DAYS = Number(process.env.DAYS ?? 250);
const OVERRIDES = JSON.parse(process.env.GAME_TUNING ?? "{}");
const LOG = !!process.env.LOG;
/** Kept back for running costs and a bad week: no move spends below it. */
const RESERVE = 2500;
/** A lorry is bought where the hint says one more earns this much over its cost. */
const LORRY_MARGIN = 1.15;

interface Day {
  day: number;
  funds: number;
  net: number;
  trips: number;
  people: number;
  fares: number;
  goods: number;
  income: number;
  /** Loading and yard levies to you, the day. */
  loading: number;
  /** Park levies to you that day (motor parks raise them). */
  levies: number;
  moves: number;
  /** Moves that build: not a lorry bought, a route sold, or a road kept up -- C14's "a move worth making". */
  builds: number;
  /** Waiting on money: a rung it wants that it can't afford yet. */
  waiting: boolean;
}

const ticksPerDay = Math.round(D / SIM_DT);
const pop = (world: GameWorld) => [...world.towns.values()].filter((t) => !t.industry).reduce((s, t) => s + t.population, 0);
const spend = (world: GameWorld, price: number) => world.economy.funds - price >= RESERVE;

// A bond only where its repayments fit in half of what it nets a day (2026-10-29): the game lends
// up to 30% of income, and on region maps the bot borrowed ₦60k for a refinery at ₦1,200 a day
// against a net of ~₦500, and sank into debt.
function checkBond(world: GameWorld, purpose: BondPurpose): { ok: boolean } {
  const t = world.tuning;
  const lent = bondAmount(world, purpose) ?? 0;
  const perDay = (lent * (1 + t.bondInterest)) / t.bondTermDays;
  return gameCheckBond(world, purpose).ok && perDay <= 0.5 * averageNet(world) ? { ok: true } : { ok: false };
}

// Routes it sold, and the day: it doesn't buy back into a loser for SOLD_DAYS (the screen
// keeps naming a seat move on a route that can't pay; a player learns, so does this).
const SOLD_DAYS = 40;
const sold = new Map<string, number>();
/** Every move made, by kind, and the building ones made today. */
const made = new Map<string, number>();
let buildsToday = 0;
const pairOf = (action: ActionSpec) => ("a" in action && "b" in action ? [action.a, action.b].sort().join("~") : null);

function act(world: GameWorld, day: number, action: ActionSpec, why: string): boolean {
  const pair = pairOf(action);
  if (pair && ["bus", "minibus", "lorry"].includes(action.kind) && day - (sold.get(`${action.kind}:${pair}`) ?? -Infinity) < SOLD_DAYS) return false;
  const result = applyAction(world, action);
  if (result.ok) {
    made.set(action.kind, (made.get(action.kind) ?? 0) + 1);
    if (!["lorry", "sell", "fix"].includes(action.kind)) buildsToday += 1;
  }
  if (result.ok && LOG) console.log(`  day ${day}: ${why} -- ${JSON.stringify(action)}`);
  return result.ok;
}

/** One game day's decisions. Returns the moves made, and whether it's waiting on money for a rung. */
function decide(world: GameWorld, day: number, losing: Map<string, number>): { moves: number; waiting: boolean } {
  let moves = 0;
  let waiting = false;
  const did = (ok: boolean) => (ok ? (moves += 1, true) : false);

  // Prune: a route a week in the red, past its first fortnight (riders take days to find a
  // new one), loses a vehicle -- unless its card says it's short of vehicles, not riders.
  const now = world.economy.elapsedSeconds;
  const opened = new Map([...world.routes, ...world.lorryRoutes].map((r) => [r.id, r.openedAtSeconds]));
  for (const route of [...routeSummaries(world), ...lorrySummaries(world)]) {
    const days = route.netPerDay < -10 ? (losing.get(route.id) ?? 0) + 1 : 0;
    losing.set(route.id, days);
    const age = (now - (opened.get(route.id) ?? now)) / D;
    const verdict = diagnoseRoute(world, route.id)?.verdict;
    if (days >= 7 && age >= 15 && verdict !== "full" && verdict !== "waiting") {
      did(act(world, day, { kind: "sell", routeId: route.id }, `sell, ${Math.round(route.netPerDay)}/day`));
      losing.set(route.id, 0);
      const kind = route.id.startsWith("lorry:") ? "lorry" : route.id.startsWith("mini:") ? "minibus" : "bus";
      sold.set(`${kind}:${[route.a, route.b].sort().join("~")}`, day);
    }
  }
  // Losing money overall: only pruning until it's back above water.
  if (averageNet(world) < 0 && world.economy.funds < 3 * RESERVE) return { moves, waiting };

  // Climb: the first town grown to all its road allows gets the next rung.
  const full = [...world.basePopulation.keys()].map((id) => roadFull(world, id)).find((f) => f?.road && !f.thin);
  if (full?.road) {
    const { a, b } = full.road;
    if (full.next === "paved") {
      if (spend(world, paveCost(world, a, b))) did(act(world, day, { kind: "pave", a, b }, "the road is full: pave it"));
    } else {
      const rung = full.next;
      const price = rungPrice(world, a, b, rung);
      if (Number.isFinite(price) && spend(world, price)) {
        if (rung === "lane") {
          if (did(act(world, day, { kind: "lane", a, b }, "the road is full: a lane"))) act(world, day, { kind: "brt", a, b }, "a BRT bus on it");
        } else if (did(act(world, day, { kind: "track", a, b, alignment: "cheapest" }, "the road is full: rail"))) act(world, day, { kind: "train", a, b }, "a train on it");
      } else if (Number.isFinite(price)) {
        waiting = true;
        if (!world.project) act(world, day, { kind: "project", a, b, rung }, "save for it");
        else if (checkBond(world, "project").ok && world.project.a === a && world.project.b === b) did(act(world, day, { kind: "bond", purpose: "project" }, "borrow the rest"));
      }
    }
  }

  // Connect a cut-off town: the cheapest road from it to one on the network.
  const cut = [...world.basePopulation.keys()].filter((id) => isCutOff(world, id));
  for (const id of cut.slice(0, 1)) {
    const town = world.towns.get(id)!;
    const near = [...world.towns.values()].filter((t) => !t.industry && !isCutOff(world, t.id)).sort((p, q) => Math.hypot(p.x - town.x, p.y - town.y) - Math.hypot(q.x - town.x, q.y - town.y))[0];
    if (near && spend(world, roadCost(world, id, near.id))) did(act(world, day, { kind: "road", a: id, b: near.id, alignment: "cheapest" }, "connect a cut-off town"));
  }

  // The seaport (gateways.ts): where imports come up a road from a far coast, pave it a leg a day
  // (60% of them arriving over dirt, 90% paved end to end: ₦11-21k on maps 1, 4, 5), and restore the
  // old railway to it -- all of them, ₦166-252k -- once it can pay for that outright.
  const link = seaportLink(world);
  if (link.by === "road" && world.port && day >= 10) {
    const path = roadPath(world, world.port, link.seaport);
    const leg = path?.nodeIds.slice(1).map((b, k) => ({ a: path.nodeIds[k]!, b })).find(({ a, b }) => Number.isFinite(paveCost(world, a, b)) && paveCost(world, a, b) > 0);
    const rail = trackCost(world, world.port, link.seaport);
    if (Number.isFinite(rail) && spend(world, rail)) did(act(world, day, { kind: "track", a: world.port, b: link.seaport, alignment: "cheapest" }, `imports: restore the railway to the seaport (${Math.round(link.share * 100)}% arriving)`));
    else if (leg && spend(world, paveCost(world, leg.a, leg.b))) did(act(world, day, { kind: "pave", a: leg.a, b: leg.b }, `imports: pave the road to the seaport (${Math.round(link.share * 100)}% arriving)`));
  }

  // Passengers, by the route cards: another vehicle where a route is full or its riders wait,
  // and one vehicle earns more than it costs. Two a day at most.
  let added = 0;
  for (const route of routeSummaries(world)) {
    if (added >= 2 || isRailRoute(route.id)) continue;
    const d = diagnoseRoute(world, route.id);
    if (!d || (d.verdict !== "full" && d.verdict !== "waiting" && d.verdict !== "poached") || d.incomePerVehicle < (d.verdict === "full" ? 0.9 : 1.1) * d.costPerVehicle) continue;
    const kind = route.id.startsWith("mini:") ? "minibus" : route.id.startsWith("brt:") ? "brt" : "bus";
    const price = kind === "minibus" ? world.tuning.minibusPurchaseCost : kind === "brt" ? world.tuning.brtPurchaseCost : world.tuning.busPurchaseCost;
    if (spend(world, price) && did(act(world, day, { kind, a: route.a, b: route.b }, `${d.verdict}: another ${kind}`))) added += 1;
  }
  // A new route on the worst no-seat pair nobody of yours serves: a bus where it's busy, else a minibus. One a day.
  const served = (a: string, b: string) => [...world.routes].some((r) => {
    const v = world.simulation.vehicles.find((x) => x.id === r.vehicleIds[0]);
    return v && v.path.includes(a) && v.path.includes(b);
  });
  let pair = noSeatPairs(world).find((p) => p.perDay >= 60 && !served(p.a, p.b));
  // With money to spare, the busiest trip nobody of yours carries, whoever does now: a player
  // reads the desire lines, not only the empty platforms.
  if (!pair && world.economy.funds > 20000) {
    const towns = [...world.towns.values()].filter((t) => !t.industry && !isCutOff(world, t.id));
    let best: { a: string; b: string; perDay: number } | null = null;
    for (let i = 0; i < towns.length; i += 1) for (let j = i + 1; j < towns.length; j += 1) {
      const a = towns[i]!.id, b = towns[j]!.id;
      if (served(a, b) || !roadPath(world, a, b)) continue;
      const perDay = pairDemand(world, a, b) * D;
      if (perDay >= 80 && (!best || perDay > best.perDay)) best = { a, b, perDay };
    }
    if (best && day - (sold.get(`bus:${[best.a, best.b].sort().join("~")}`) ?? -Infinity) >= SOLD_DAYS) pair = best;
  }
  if (pair) {
    const kind = pair.perDay >= 150 ? "bus" : "minibus";
    if (spend(world, kind === "bus" ? world.tuning.busPurchaseCost : world.tuning.minibusPurchaseCost)) did(act(world, day, { kind, a: pair.a, b: pair.b }, `${Math.round(pair.perDay)} a day find no seat: a ${kind}`));
  }
  // A big town expecting more of you than it gets (Revision 4, 2): a bus on its biggest trip,
  // or another vehicle on a route through it. One a day.
  const wanting = [...world.basePopulation.keys()]
    .map((id) => ({ id, g: townGrowth(world, id) }))
    .filter((x) => x.g && x.g.expected > 0 && x.g.playerShare < x.g.expected)
    .sort((p, q) => q.g!.expected - q.g!.playerShare - (p.g!.expected - p.g!.playerShare))[0];
  if (wanting) {
    const trip = tripsFrom(world, wanting.id).find((t) => t.reachable && !served(wanting.id, t.to));
    const through = world.routes.find((r) => !isRailRoute(r.id) && world.simulation.vehicles.find((v) => v.id === r.vehicleIds[0])?.path.includes(wanting.id));
    if (trip && spend(world, world.tuning.busPurchaseCost)) did(act(world, day, { kind: "bus", a: wanting.id, b: trip.to }, `${world.towns.get(wanting.id)!.name} expects ${Math.round(wanting.g!.expected * 100)}% (you ${Math.round(wanting.g!.playerShare * 100)}%): a bus`));
    else if (through && spend(world, world.tuning.busPurchaseCost)) did(act(world, day, { kind: through.id.startsWith("mini:") ? "minibus" : "bus", a: through.a, b: through.b }, `${world.towns.get(wanting.id)!.name} expects more: another vehicle`));
  }
  // What else the screen names that builds: a worn road kept up, a road paved. One a day.
  for (const move of namedMoves(world).filter((m) => ["fix", "pave", "road"].includes(m.action.kind)).sort((p, q) => p.price - q.price).slice(0, 1)) {
    if (affordable(world, move) && spend(world, move.price)) did(act(world, day, move.action, move.label));
  }

  // Chains. The refinery: restored once three towns run short; a road out; crude by lorry.
  const fuel = world.fuel;
  if (fuel) {
    const short = [...world.basePopulation.keys()].filter((id) => (fuelSupply(world, id)?.supplied ?? 1) < 0.6).length;
    // Not without a way for crude to reach it (2026-10-29: on region maps it borrowed ₦60k for a
    // refinery its crude could never reach -- "crude in 0 of 842 t/day" -- and repaid ₦1,200 a day
    // into debt): the crude road first, then the refinery.
    const crudeWay = roadPath(world, fuel.sourceId, fuel.refineryId) || railPath(world, fuel.sourceId, fuel.refineryId);
    if (!fuel.restored && short >= 3 && !crudeWay && spend(world, roadCost(world, fuel.sourceId, fuel.refineryId))) {
      did(act(world, day, { kind: "road", a: fuel.sourceId, b: fuel.refineryId, alignment: "cheapest" }, "towns short of fuel: first a road for crude to the refinery"));
    }
    if (!fuel.restored && short >= 3 && (roadPath(world, fuel.sourceId, fuel.refineryId) || railPath(world, fuel.sourceId, fuel.refineryId))) {
      if (spend(world, world.tuning.refineryRestoreCost)) did(act(world, day, { kind: "restoreRefinery" }, "towns short of fuel: restore the refinery"));
      else if (checkBond(world, "refinery").ok) did(act(world, day, { kind: "bond", purpose: "refinery" }, "towns short of fuel: borrow for the refinery"));
    }
    if (fuel.restored) siteRoads(world, day, fuel.refineryId, did);
    if (fuel.restored && !roadPath(world, fuel.sourceId, fuel.refineryId) && spend(world, roadCost(world, fuel.sourceId, fuel.refineryId))) {
      did(act(world, day, { kind: "road", a: fuel.sourceId, b: fuel.refineryId, alignment: "cheapest" }, "a road for crude"));
    }
  }
  // The second, private refinery (Revision 4, 4): when it opens, a road for its crude (the
  // yards below put hauliers on it), then track and a freight train once the track's affordable.
  const second = newRefinery(world);
  if (fuel && second) {
    secondOpened ??= day;
    if (!roadPath(world, fuel.sourceId, second.id) && spend(world, roadCost(world, fuel.sourceId, second.id))) {
      did(act(world, day, { kind: "road", a: fuel.sourceId, b: second.id, alignment: "cheapest" }, "the private refinery opened: a road for its crude"));
    }
    if (!railPath(world, fuel.sourceId, second.id) && spend(world, trackCost(world, fuel.sourceId, second.id))) {
      if (did(act(world, day, { kind: "track", a: fuel.sourceId, b: second.id, alignment: "cheapest" }, "crude to the private refinery: rail"))) act(world, day, { kind: "freight", a: fuel.sourceId, b: second.id }, "a freight train for crude");
    }
  }
  // Motor parks (Revision 4, 5): one every ten days at the biggest town (50k+) whose roads jam --
  // what a park pays for is clearer roads; its levy gain is a few naira a day (measured 2026-10-23).
  if (world.tuning.parksEnabled && day % 10 === 0) {
    const slowest = (id: string) => Math.min(...world.simulation.map.segments.filter((seg) => seg.fromNodeId === id || seg.toNodeId === id).map((seg) => world.segmentSpeed.get(seg.id) ?? 1));
    const best = [...world.basePopulation.keys()].filter((id) => !world.parks.has(id) && world.towns.get(id)!.population >= 50 && slowest(id) < 0.8).sort((p, q) => world.towns.get(q)!.population - world.towns.get(p)!.population)[0];
    if (best && spend(world, world.tuning.parkCost)) did(act(world, day, { kind: "park", townId: best }, `a motor park: the roads into ${world.towns.get(best)!.name} jam (${Math.round(slowest(best) * 100)}% speed), ~₦${Math.round(parkLevyGain(world, best))}/day more levy`));
  }
  // A metro (Revision 4, 6): the biggest town that can take one, a line at a time, every five
  // days at most.
  if (world.tuning.metroEnabled && day % 5 === 0) {
    const town = [...world.towns.values()].filter((t) => !t.industry && checkMetro(world, t.id).ok).sort((p, q) => q.population - p.population)[0];
    if (town && spend(world, metroPrice(world, town.id))) did(act(world, day, { kind: "metro", townId: town.id }, `${town.name} (${Math.round(town.population)}k): ${metroLines(world, town.id) === 0 ? "a metro" : "another metro line"}`));
  }
  // The works: restored once cement holds 10k people back.
  const cement = world.cement;
  if (cement && !cement.working) {
    const held = [...world.basePopulation.keys()].reduce((s, id) => s + (townGrowth(world, id)?.cementHeld ?? 0), 0);
    if (held >= 10) {
      if (spend(world, world.tuning.worksRestoreCost)) did(act(world, day, { kind: "restoreWorks" }, "cement short: restore the works"));
      else if (checkBond(world, "works").ok) did(act(world, day, { kind: "bond", purpose: "works" }, "cement short: borrow for the works"));
    }
  }
  // The steel works (steel.ts): restored once steel holds 10k people back, as the cement works is.
  const steel = world.steel;
  if (steel?.worksId && !steel.working) {
    const held = [...world.basePopulation.keys()].reduce((s, id) => s + (townGrowth(world, id)?.steelHeld ?? 0), 0);
    if (held >= 10) {
      if (spend(world, world.tuning.steelRestoreCost)) did(act(world, day, { kind: "restoreSteel" }, "steel short: restore the steel works"));
      else if (checkBond(world, "steel").ok) did(act(world, day, { kind: "bond", purpose: "steel" }, "steel short: borrow for the steel works"));
    }
  }
  // Every working site and open quarry gets a road to the network.
  for (const site of [...world.towns.values()].filter((t) => t.industry && t.industry !== "oilfield" && t.industry !== "terminal")) siteRoads(world, day, site.id, did);

  // No player lorries (Revision 4): a haulage yard where the most goods sit unmoved, so the
  // hauliers reach further from there. One every five days at most.
  if (world.tuning.noPlayerLorries) {
    if (day % 5 === 0) {
      const unmoved = new Map<string, number>();
      for (const flow of goodsFlows(world)) {
        const outcome = world.goods.outcomes.get(flowKey(flow));
        const left = Math.max(0, flow.rate - (outcome?.delivered ?? 0) - (outcome?.trucked ?? 0)) * D;
        unmoved.set(flow.from, (unmoved.get(flow.from) ?? 0) + left);
      }
      const best = [...unmoved].filter(([id, t]) => t >= 30 && !world.yards.has(id) && !isCutOff(world, id)).sort((x, y) => y[1] - x[1])[0];
      if (best && spend(world, world.tuning.yardCost)) did(act(world, day, { kind: "yard", townId: best[0] }, `${Math.round(best[1])} t a day sit unmoved: a haulage yard`));
    }
  } else {
    // Lorries where one more pays, by the hint: one a day at most, best first.
    const pairs = new Map<string, { a: string; b: string; margin: number }>();
    for (const flow of goodsFlows(world)) {
      const [a, b] = flow.from < flow.to ? [flow.from, flow.to] : [flow.to, flow.from];
      if (pairs.has(`${a}~${b}`) || !roadPath(world, a, b)) continue;
      const e = lorryEstimate(world, a, b);
      if (e && e.tonnesPerDay >= 5) pairs.set(`${a}~${b}`, { a, b, margin: e.incomePerDay / e.costPerDay });
    }
    for (const pair of [...pairs.values()].filter((p) => p.margin >= LORRY_MARGIN).sort((p, q) => q.margin - p.margin).slice(0, 1)) {
      if (spend(world, world.tuning.lorryPurchaseCost)) did(act(world, day, { kind: "lorry", a: pair.a, b: pair.b }, `a lorry pays here (${pair.margin.toFixed(2)}x)`));
    }
  }

  // Expand a site at capacity while its towns go short.
  const shortOf = (siteId: string) => {
    const kind = world.towns.get(siteId)?.industry;
    if (kind === "works") return [...world.basePopulation.keys()].reduce((s, id) => s + (townGrowth(world, id)?.cementHeld ?? 0), 0) >= 10;
    if (kind === "refinery") return [...world.basePopulation.keys()].some((id) => (fuelSupply(world, id)?.supplied ?? 1) < 0.6);
    return marketTowns(world).some((t) => marketFed(world, t.id) < 0.5);
  };
  for (const site of [...world.towns.values()].filter((t) => t.industry)) {
    const p = siteProduction(world, site.id);
    const cost = expandCost(world, site.id);
    if (!p || cost === null || p.limit !== "capacity" || !shortOf(site.id)) continue;
    if (spend(world, cost)) did(act(world, day, { kind: "expand", siteId: site.id }, `${site.name} at capacity: expand it`));
  }
  return { moves, waiting };
}

/** A road from a site to the nearest town on the network, if it has none. */
function siteRoads(world: GameWorld, day: number, siteId: string, did: (ok: boolean) => boolean): void {
  if (!isCutOff(world, siteId)) return;
  const site = world.towns.get(siteId)!;
  const near = [...world.towns.values()].filter((t) => !t.industry && !isCutOff(world, t.id)).sort((p, q) => Math.hypot(p.x - site.x, p.y - site.y) - Math.hypot(q.x - site.x, q.y - site.y))[0];
  if (near && spend(world, roadCost(world, siteId, near.id))) did(act(world, day, { kind: "road", a: siteId, b: near.id, alignment: "cheapest" }, `a road to ${site.name}`));
}

function play(seed: number): { seed: number; days: Day[]; world: GameWorld } {
  const world = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, OVERRIDES);
  const losing = new Map<string, number>();
  const days: Day[] = [];
  let last = { ...world.budget };
  for (let day = 1; day <= DAYS; day += 1) {
    buildsToday = 0;
    const { moves, waiting } = decide(world, day, losing);
    const builds = buildsToday;
    for (let i = 0; i < ticksPerDay; i += 1) gameTick(world, SIM_DT);
    const b = world.budget;
    const fares = b.fares - last.fares;
    const goods = b.goods - last.goods;
    const income = fares + goods + (b.tolls - last.tolls) + (b.levies - last.levies) + (b.loading - last.loading) + (b.allocation - last.allocation) + (b.exports - last.exports);
    const prevLoading = last.loading;
    const prevLevies = last.levies;
    last = { ...b };
    days.push({ day, funds: world.economy.funds, net: averageNet(world), trips: headline(world).tripsPerDay, people: pop(world), fares, goods, income, loading: b.loading - prevLoading, levies: b.levies - prevLevies, moves, builds, waiting });
    // C11 (amended): at day 150, the share of the original towns' growth since day 1 that the
    // chains unlock -- each town's target with cement and food as delivered, against a copy
    // with none delivered.
    if (day === 150) c11Share = chainsGrowthShare(world);
    // DIAG=from-to: every 10 days in that window, each original town's size against what limits it.
    const diag = process.env.DIAG?.split("-").map(Number);
    if (diag && day >= diag[0]! && day <= diag[1]! && day % 10 === 0) {
      const vehicles = world.routes.reduce((n, r) => n + r.vehicleIds.length, 0);
      console.log(`  DIAG day ${day}: funds ${k(world.economy.funds)}, ${world.routes.length} routes, ${vehicles} vehicles, trips ${Math.round(headline(world).tripsPerDay)}`);
      for (const id of world.basePopulation.keys()) {
        const g = townGrowth(world, id)!;
        const t = world.towns.get(id)!;
        console.log(`    ${t.name.padEnd(12)} ${Math.round(t.population)}k -> target ${Math.round(g.target)}k cap ${Math.round(g.cap)}k (${g.rung}), service ${Math.round(g.service * 100)}% yours ${Math.round(g.playerShare * 100)}% expects ${Math.round(g.expected * 100)}%, fuel ${Math.round((fuelSupply(world, id)?.supplied ?? 1) * 100)}%, cement held ${Math.round(g.cementHeld)}k`);
      }
    }
  }
  return { seed, days, world };
}

/** The longest run of days in [from, to] with no move made. */
function longestQuiet(days: Day[], from: number, to: number): { length: number; start: number } {
  let best = { length: 0, start: 0 };
  let run = 0;
  for (const d of days.filter((x) => x.day >= from && x.day <= to)) {
    run = d.builds === 0 ? run + 1 : 0;
    if (run > best.length) best = { length: run, start: d.day - run + 1 };
  }
  return best;
}

const k = (n: number) => `₦${Math.round(n / 1000)}k`;
/** C11, measured at day 150 (null before). */
let c11Share: { share: number; unlocked: number; grown: number } | null = null;

function chainsGrowthShare(world: GameWorld): { share: number; unlocked: number; grown: number } {
  const without = structuredClone(world);
  for (const flow of goodsFlows(without)) {
    const site = without.towns.get(flow.from)?.industry;
    if (site === "works" || site === "silo" || site === "mill" || site === "flourmill") without.goods.outcomes.delete(flowKey(flow));
  }
  let unlocked = 0;
  let grown = 0;
  for (const [id, base] of world.basePopulation) {
    const town = world.towns.get(id);
    const g = townGrowth(world, id);
    const g0 = townGrowth(without, id);
    if (!town || !g || !g0) continue;
    grown += Math.max(0, town.population - base);
    unlocked += Math.max(0, g.target - g0.target);
  }
  return { share: grown > 0 ? Math.min(1, unlocked / grown) : 0, unlocked, grown };
}
/** The day the private refinery was first seen open, this map (reset per map). */
let secondOpened: number | undefined;
for (const seed of SEEDS) {
  const started = performance.now();
  const { days, world } = play(seed);
  const at = (day: number) => days[Math.min(day, days.length) - 1]!;
  const window = (from: number, to: number) => days.filter((d) => d.day > from && d.day <= to);
  const share = (from: number, to: number) => {
    const w = window(from, to);
    const income = w.reduce((s, d) => s + d.income, 0);
    return income > 0 ? w.reduce((s, d) => s + d.goods, 0) / income : 0;
  };
  console.log(`\nmap ${seed} (${((performance.now() - started) / 1000).toFixed(0)} s)`);
  console.log("  day   funds    net/day  trips  people  goods share  moves (last 50 days)");
  for (const day of [60, 100, 150, 200, 250, 300].filter((d) => d <= DAYS)) {
    const d = at(day);
    console.log(`  ${String(day).padStart(3)}  ${k(d.funds).padStart(7)}  ${String(Math.round(d.net)).padStart(7)}  ${String(Math.round(d.trips)).padStart(5)}  ${String(Math.round(d.people)).padStart(5)}k  ${String(Math.round(share(day - 20, day) * 100)).padStart(9)}%  ${window(day - 50, day).reduce((s, x) => s + x.moves, 0)}`);
  }
  const q1 = longestQuiet(days, 60, 150);
  const q2 = longestQuiet(days, 150, DAYS);
  const waited = window(20, 60).filter((d) => d.waiting).length;
  const lorries = lorrySummaries(world);
  const rungs = new Map<string, number>();
  for (const s of world.simulation.map.segments) {
    const r = s.type === "rail" ? "rail" : s.busLane ? "lane" : s.surface === "paved" ? "paved" : "dirt";
    rungs.set(r, (rungs.get(r) ?? 0) + 1);
  }
  console.log(`  C11 (amended) the chains' share of the original towns' growth by day 150: ${c11Share ? `${Math.round(c11Share.share * 100)}% (${Math.round(c11Share.unlocked)}k of ${Math.round(c11Share.grown)}k grown; wanted >= 20%)` : "n/a (run to day 150)"}`);
  // For the gym (gym/run.ts): the measures as one line a machine reads.
  if (process.env.GYM) console.log(`GYM ${JSON.stringify({ seed, days: DAYS, c14: { early: q1, late: q2 }, c11: { chains: c11Share?.share ?? null, goods80to100: share(80, 100) }, c2: { waited } })}`);
  c11Share = null;
  console.log(`  C11 goods share of income, days 80-100: ${Math.round(share(80, 100) * 100)}% (wanted 20-40%)`);
  console.log(`  C14 longest stretch with nothing built (lorries, selling, upkeep aside), days 60-150: ${q1.length} days from day ${q1.start} (wanted < 15); after 150: ${q2.length} from day ${q2.start}`);
  console.log(`  C2 days 20-60 waiting on money for a rung: ${waited} of 40 (wanted >= 10)`);
  console.log(`  rungs (road pieces): ${[...rungs].map(([r, n]) => `${r} ${n}`).join(", ")} | most money held ${k(Math.max(...days.map((d) => d.funds)))}`);
  console.log(`  moves: ${[...made].sort((x, y) => y[1] - x[1]).map(([kind, n]) => `${kind} ${n}`).join(", ")}`);
  made.clear();
  sold.clear();
  const short = [...world.basePopulation.keys()].map((id) => ({ id, g: townGrowth(world, id) })).filter((x) => x.g && x.g.expected > 0);
  console.log(`  service expected (Revision 4, 2): ${short.map((x) => `${world.towns.get(x.id)!.name} ${Math.round(x.g!.playerShare * 100)}/${Math.round(x.g!.expected * 100)}%`).join(", ") || "no town big enough"} | swept to the treasury: ₦${Math.round(world.budget.swept)}`);
  const levy = window(DAYS - 20, DAYS).reduce((s, d) => s + d.loading, 0) / 20;
  console.log(`  yards: ${world.yards.size} (${[...world.yards].map((id) => world.towns.get(id)?.name).join(", ")}); loading and yard levies to you, last 20 days: ₦${Math.round(levy)}/day`);
  const second = newRefinery(world);
  const shortOfFuel = [...world.basePopulation.keys()].filter((id) => (fuelSupply(world, id)?.supplied ?? 1) < 0.6).length;
  console.log(`  second refinery (Revision 4, 4): ${second ? `opened day ${secondOpened ?? "?"} (${second.name}); crude in ${Math.round(crudeArriving(world, second.id) * D)} of ${Math.round(newRefineryCrude(world) * D)} t/day by rail ${railPath(world, world.fuel!.sourceId, second.id) ? "yes" : "no"}; fuel made ${Math.round(newRefineryOutput(world) * D)} of ${Math.round(newRefineryCapacity(world) * D)} t/day` : "not open"} | towns under 60% fuel: ${shortOfFuel}`);
  secondOpened = undefined;
  const lines = world.lorryRoutes.filter((r) => r.id.startsWith("freight:"));
  const split = lines.reduce((sum, r) => { const x = freightLineSplit(world, r.id); return { yours: sum.yours + x.yours, hauliers: sum.hauliers + x.hauliers, spoiled: sum.spoiled + x.spoiled }; }, { yours: 0, hauliers: 0, spoiled: 0 });
  const trucks = world.simulation.vehicles.filter((v) => String(v.id).startsWith("truck-")).length;
  console.log(`  freight (rate ${world.tuning.freightRateDefault ?? "standard"}): ${lines.length} line(s); along them your trains ${Math.round(split.yours)} t/day, hauliers ${Math.round(split.hauliers)}, spoiling ${Math.round(split.spoiled)}; trucks on the road now ${trucks}; goods income ₦${Math.round(world.budget.goods / 1000)}k all game`);
  console.log(`  metros (Revision 4, 6): ${[...world.metros].map(([id, lines]) => `${world.towns.get(id)?.name} ${lines} line(s), ${Math.round(metroRiders(world, id).riders)} riders/day`).join("; ") || "none"}; metro fares ₦${Math.round(world.budget.metro / 1000)}k all game`);
  console.log(`  motor parks (Revision 4, 5): ${world.parks.size} (${[...world.parks].map((id) => world.towns.get(id)?.name).join(", ")}); levies last 20 days ₦${Math.round(window(DAYS - 20, DAYS).reduce((s, d) => s + d.levies, 0) / 20)}/day`);
  console.log(`  lorries: ${lorries.length} routes, net ₦${Math.round(lorries.reduce((s, l) => s + l.netPerDay, 0))}/day, ${lorries.filter((l) => l.netPerDay < 0).length} losing`);
}
