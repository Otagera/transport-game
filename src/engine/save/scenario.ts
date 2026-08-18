import { SIM_DT } from "../loop";
import type { SimulationState, Vehicle } from "../simulation/types";
import { createVehicle } from "../simulation/vehicle";
import { tick } from "../simulation/simulate";
import type { EconomyState } from "../economy/types";
import { registerPurchase } from "../economy/state";
import type { ParatransitState } from "../paratransit/types";
import type { GrowthState } from "../growth/types";
import { advanceEraTimeline } from "../eras/timeline";
import type { EraModifiers, EraTimeline } from "../eras/types";

export const SECONDS_PER_WARM_DAY = 30;

// Content is data (docs/rebuild-plan.md §5): a scenario is authored in
// public/content/scenarios.json and validated by @content/schema's
// ScenarioSchema. engine/ never imports content types directly (hard rule
// 2) -- this is the plain mirrored shape, same pattern as EraDef. The
// bootstrap layer maps a loaded Scenario into it.
export interface ScenarioSeedFleetEntry {
  defId: string;
  count: number;
}

export interface ScenarioSpec {
  startingEraId: string;
  startingFunds: number;
  warmForwardDays: number;
  seedFleet: ScenarioSeedFleetEntry[];
}

// What applyScenario needs to know about a vehicle def to actually place
// one -- a plain mirror of the fields of @content/schema's VehicleDef that
// matter here, same pattern as ScenarioSpec.
export interface ScenarioVehicleSpec {
  defId: string;
  speed: number;
  capacity: number;
  carries: Vehicle["carries"];
  purchaseCost: number;
  operatingCostPerSecond: number;
  congestionWeight: number;
}

let seedVehicleCounter = 0;

// Seed-fleet vehicles are placed round-robin over pairs of inhabited
// nodes on the map's already-connected inherited network -- no corridor
// authoring needed, since generateMap guarantees full connectivity
// (Module 2). A scenario is a starting point for tuning, not a curated
// layout (docs/handoff-module-10.md §5): seedFleet only says how many of
// a def to start with, this decides where they run.
//
// Registered as real purchases (funds deducted, ledger/vehicleEconomics
// entries created) rather than free stock: startingFunds and seedFleet
// are both scenario-author knobs shown side by side in the Scenario Lab,
// so the author reconciles them directly rather than the engine guessing
// at a "free starter fleet" exemption.
export function applyScenario(
  spec: ScenarioSpec,
  simulation: SimulationState,
  economy: EconomyState,
  eraTimeline: EraTimeline,
  vehicleCatalog: ScenarioVehicleSpec[],
): void {
  const eraIndex = eraTimeline.eras.findIndex((era) => era.id === spec.startingEraId);
  eraTimeline.currentIndex = eraIndex === -1 ? 0 : eraIndex;
  eraTimeline.elapsedInEraSeconds = 0;

  economy.funds = spec.startingFunds;

  const inhabited = simulation.map.nodes.filter((node) => node.kind === "settlement" || node.kind === "village");
  if (inhabited.length < 2) return;

  let cursor = 0;
  for (const entry of spec.seedFleet) {
    const def = vehicleCatalog.find((candidate) => candidate.defId === entry.defId);
    if (!def) continue;

    for (let i = 0; i < entry.count; i += 1) {
      const from = inhabited[cursor % inhabited.length]!;
      const to = inhabited[(cursor + 1) % inhabited.length]!;
      cursor += 1;

      const id = `seed-vehicle-${seedVehicleCounter}`;
      seedVehicleCounter += 1;
      const vehicle = createVehicle(
        id,
        [from.id, to.id],
        simulation.routing,
        def.speed,
        def.capacity,
        simulation.queues,
        def.carries,
        def.congestionWeight,
      );
      simulation.vehicles.push(vehicle);
      registerPurchase(economy, id, def.purchaseCost, def.operatingCostPerSecond, def.defId);
    }
  }
}

// Runs real ticks rather than skipping time, so a warm-forward produces an
// economy, a paratransit sector, and grown settlements that actually
// exist for the target era -- not a clock set forward over an empty
// world (docs/handoff-module-10.md §3). Reproducible from the same seed:
// nothing in the tick path but paratransit spawn-id derivation uses
// randomness, and that derives from `paratransit.elapsedSeconds`, which is
// deterministic.
//
// All of eraModifiers/growth/profileDecayById must be threaded through --
// omitting any one warms the wrong world silently (no ambient traffic, no
// settlement growth, or uniform decay regardless of profile).
export function warmForward(
  simulation: SimulationState,
  economy: EconomyState,
  paratransit: ParatransitState,
  growth: GrowthState,
  eraTimeline: EraTimeline,
  days: number,
  eraModifiersById: ReadonlyMap<string, EraModifiers>,
  profileDecayById: ReadonlyMap<string, number>,
): void {
  let remaining = days * SECONDS_PER_WARM_DAY;
  while (remaining > 0) {
    const dt = Math.min(SIM_DT, remaining);
    const currentEra = eraTimeline.eras[eraTimeline.currentIndex]!;
    const eraModifiers = eraModifiersById.get(currentEra.id);
    tick(simulation, dt, economy, paratransit, eraModifiers, growth, profileDecayById);
    advanceEraTimeline(eraTimeline, dt);
    remaining -= dt;
  }
}
