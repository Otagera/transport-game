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
  // Informal modes, from the original game's catalog (public/content/
  // vehicles.json): capacity, speed, and congestion weight as road space.
  danfoCapacity: 14,
  danfoSpeed: 3.5,
  kekeCapacity: 3,
  kekeSpeed: 4.5,
  okadaCapacity: 1,
  okadaSpeed: 6,
  danfoRoadSpace: 1,
  kekeRoadSpace: 0.5,
  okadaRoadSpace: 0.3,
  // Cap per corridor (docs/principles.md §3), as road space: a dozen danfos
  // or forty okadas. That finding was about congestion collapse; with
  // congestion off the cap is loose enough that the informal sector
  // visibly fills the gaps, and step 2 revisits it.
  informalRoadSpace: 12,
  startingFunds: 2500,
  outcomeTauSeconds: 30,
  // Shared road (congestion.ts). Capacity is road space entering per
  // second. With no service the busiest dirt road carries ~0.5-0.8/s
  // (free flow); 2-4 buses on ilase-owode lift it to ~1.0-1.4 and slow it
  // to ~80%, which is that route's best count; 6 jam it, 12 lose money.
  congestion: true,
  busRoadSpace: 1.2,
  roadFlowCapacity: 1.6,
  dirtRoadCapacity: 0.6,
  minSpeedFactor: 0.15,
  informalMinSpeed: 0.35,

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
