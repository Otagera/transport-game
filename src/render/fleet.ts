import type { VehicleDef } from "../content/schema";
import type { GeneratedMap } from "../engine/map/types";
import type { SimulationState } from "../engine/simulation/types";
import { buildRoutingContext } from "../engine/simulation/routing";
import { createVehicle } from "../engine/simulation/vehicle";
import type { EconomyState } from "../engine/economy/types";
import { canAfford, registerPurchase } from "../engine/economy/state";
import type { BuildEvent } from "./authoring";

export interface FleetController {
  handleBuild: (event: BuildEvent) => void;
  handleMapChanged: (map: GeneratedMap) => void;
  dispose: () => void;
}

let nextVehicleIdCounter = 0;

// Buying a vehicle for a route the player just built. Lives alongside
// authoring rather than inside it: authoring.ts owns corridor building,
// this owns "what runs on it" -- the two only share a `BuildEvent`, not
// each other's internals. Routing has to be rebuilt on every map change
// (build or undo) since a freshly-built corridor's nodes don't exist in
// the simulation's graph until then, and a newly bought vehicle needs
// that graph to plan its route.
export function createFleetController(
  simulation: SimulationState,
  economy: EconomyState,
  catalog: VehicleDef[],
  onFleetChanged: () => void,
  hintEl: HTMLElement,
): FleetController {
  let selectedIndex = Math.max(0, catalog.findIndex((v) => v.id === "danfo"));
  let pendingRoute: string[] | null = null;

  function renderHint(): void {
    if (catalog.length === 0) {
      hintEl.textContent = "";
      return;
    }
    const def = catalog[selectedIndex]!;
    const affordable = canAfford(economy, def.purchaseCost);
    const routeHint = pendingRoute
      ? `V: buy ${def.name} (₦${def.purchaseCost}) for the route you just built`
      : `Build a route, then V to buy a ${def.name} (₦${def.purchaseCost}) for it`;
    hintEl.textContent = `${routeHint}${affordable ? "" : " -- can't afford it"} · [ ] to pick a vehicle`;
  }

  function handleBuild(event: BuildEvent): void {
    pendingRoute = event.nodeIds;
    simulation.routing = buildRoutingContext(event.map);
    simulation.map = event.map;
    renderHint();
  }

  function handleMapChanged(map: GeneratedMap): void {
    simulation.routing = buildRoutingContext(map);
    simulation.map = map;
  }

  function buySelectedForPendingRoute(): void {
    if (!pendingRoute || pendingRoute.length < 2) return;
    const def = catalog[selectedIndex];
    if (!def) return;
    if (!canAfford(economy, def.purchaseCost)) return;

    const id = `vehicle-${nextVehicleIdCounter}`;
    nextVehicleIdCounter += 1;

    const vehicle = createVehicle(id, pendingRoute, simulation.routing, def.speed, def.capacity, simulation.queues, def.carries);
    simulation.vehicles.push(vehicle);
    registerPurchase(economy, id, def.purchaseCost, def.operatingCostPerSecond);
    pendingRoute = null;
    onFleetChanged();
    renderHint();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key.toLowerCase() === "v") {
      buySelectedForPendingRoute();
    } else if (event.key === "[") {
      selectedIndex = (selectedIndex - 1 + catalog.length) % catalog.length;
      renderHint();
    } else if (event.key === "]") {
      selectedIndex = (selectedIndex + 1) % catalog.length;
      renderHint();
    }
  }

  window.addEventListener("keydown", handleKeyDown);
  renderHint();

  function dispose(): void {
    window.removeEventListener("keydown", handleKeyDown);
  }

  return { handleBuild, handleMapChanged, dispose };
}
