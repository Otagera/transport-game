import type { SliceMapDef, SliceTuning, SliceWorld } from "./types";
import { createSliceWorld } from "./world";
import { createBudgetTally, createRemittancePeriod } from "./budget";
import { createDayLedger } from "./ledger";
import { resetCorridors } from "./corridors";
import { sliceTick } from "./tick";
import { DEFAULT_SLICE_TUNING } from "./tuning";
import { SIM_DT } from "../loop";
import { SECONDS_PER_GAME_DAY } from "../economy/state";

// A game as the player meets it: the world already running (docs/brief.md,
// Slice zero: warm-up; principles §1, brownfield). createSliceWorld makes a
// cold world -- empty queues, no danfos on the road, the informal share at
// 0% climbing to half by day 10 -- which is what the tests want and what no
// player should see. This runs it `warmUpDays` with nobody playing, then
// day 1 begins.

export function startSliceGame(map: SliceMapDef, tuning: SliceTuning = DEFAULT_SLICE_TUNING): SliceWorld {
  const world = createSliceWorld(map, tuning);
  const ticks = Math.round((tuning.warmUpDays * SECONDS_PER_GAME_DAY) / SIM_DT);
  for (let i = 0; i < ticks; i += 1) sliceTick(world, SIM_DT);
  world.startSeconds = world.economy.elapsedSeconds;
  // The strip's "informal sector earned" counts from when you arrived, and
  // so does your budget; the allocation pays on growth from day 1.
  world.informal.earnings = 0;
  world.budget = createBudgetTally();
  world.history.tallyAtLastDay = createBudgetTally();
  // Levies and the allocation flow during the warm-up too; none of it is yours.
  world.economy.funds = tuning.startingFunds;
  world.ledger = createDayLedger();
  world.remittance = createRemittancePeriod(world.economy.elapsedSeconds, tuning);
  world.startPopulation = new Map([...world.towns.values()].map((town) => [town.id, town.population]));
  world.milestones = new Map(); // growth during the warm-up isn't yours
  resetCorridors(world);
  return world;
}
