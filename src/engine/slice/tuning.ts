import type { SliceTuning } from "./types";

// Starting points, not gospel (docs/principles.md §3, "Balance numbers").
// Calibrated with scripts/slice-probe.ts, not by feel alone -- rerun it
// after touching any of these. What they were tuned to produce on
// src/slice/map.ts over 20 game days:
//
//   - the best route (ilase-owode) peaks at ~2 buses (+90/day) and goes
//     negative by 6 -- frequency is worth paying for, up to a point;
//   - a thin route makes a little; a road to a cut-off town plus one bus
//     roughly breaks even on fares alone -- it pays in share, not money;
//   - doing nothing, danfos carry ~48% and ~52% stay home (31% of all
//     demand is between towns no road joins), and danfos passing through
//     take a visible bite out of your route's queue.
//
// Time: one game day is 30 seconds (economy/state.ts SECONDS_PER_GAME_DAY).
// Distance: map cells.
export const DEFAULT_SLICE_TUNING: SliceTuning = {
  patienceSeconds: 12,
  demandK: 0.008,
  fare: 4,
  roadCostPerCell: 15,
  busCapacity: 20,
  busSpeed: 3,
  busPurchaseCost: 500,
  busOperatingCostPerSecond: 1.6,
  danfoCapacity: 14,
  danfoSpeed: 3.5,
  // Cap per corridor (docs/principles.md §3). That finding was about
  // congestion collapse; with congestion off in step 1 the cap is set
  // loose enough that danfos visibly fill the gaps, and step 2 revisits it.
  danfoCorridorCap: 12,
  startingFunds: 2500,
  outcomeTauSeconds: 30,
  congestion: false,

  flowTauSeconds: 60,
  settlementCheckSeconds: 30,
  // Riders/sec past a point, measured before any town exists: danfos
  // alone carry ~6.6 on ilase-owode, ~4.3 on owode-ado, ~2.2 on
  // ilase-kuto. Adding your buses barely moves the total (your riders are
  // mostly ones danfos would have carried) but your share is what counts:
  // 1 bus on ilase-owode carries ~1.0 of it. So a town needs a busy road
  // *and* your service on it -- two or three roads on this map qualify
  // once you run them, the rest never do.
  foundTownFlow: 4,
  foundTownPlayerFlow: 0.8,
  townSpacingCells: 10,
  maxEmergentTowns: 4,
  minSecondsBetweenTowns: 120,
  newTownPopulation: 5,
  // ~10 riders/s through a roadside town supports ~13k people. Rider
  // flow, not vehicle flow, so extra empty buses barely grow it.
  populationPerFlow: 1.3,
  maxEmergentPopulation: 30,
  townPopulationTauSeconds: 300,
  abandonBelowPopulation: 2,
};
