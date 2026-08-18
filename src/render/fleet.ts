import type { Era, VehicleDef } from "../content/schema";
import type { GeneratedMap } from "../engine/map/types";
import type { SimulationState } from "../engine/simulation/types";
import { rebuildFromMap } from "../engine/simulation/simulate";
import { createVehicle } from "../engine/simulation/vehicle";
import type { EconomyState } from "../engine/economy/types";
import { canAfford, markVehicleObsolete, registerPurchase } from "../engine/economy/state";
import type { BuildEvent } from "./authoring";

export interface FleetController {
  handleBuild: (event: BuildEvent) => void;
  handleMapChanged: (map: GeneratedMap) => void;
  handleEraChanged: () => void;
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
// eraIn/eraOut close the purchase catalog without despawning owned stock
// (docs/principles.md §3, "graceful obsolescence"): getCurrentEraId is a
// live getter, not a value captured at construction, since the era
// timeline advances on its own after this controller is built. The
// catalog itself stays the full static list -- Module 8's "catalog
// timeline visible in advance" bullet wants a vehicle's era window shown
// while cycling, not hidden until it's purchasable.
export function createFleetController(
  simulation: SimulationState,
  economy: EconomyState,
  catalog: VehicleDef[],
  onFleetChanged: () => void,
  hintEl: HTMLElement,
  eras: Era[],
  getCurrentEraId: () => string,
): FleetController {
  let selectedIndex = Math.max(0, catalog.findIndex((v) => v.id === "danfo"));
  let pendingRoute: string[] | null = null;

  const orderOf = new Map(eras.map((era) => [era.id, era.order]));
  const nameOf = new Map(eras.map((era) => [era.id, era.name]));

  function eraWindowLabel(def: VehicleDef): string {
    const inName = nameOf.get(def.eraIn) ?? def.eraIn;
    if (def.eraOut === null) return `${inName}+`;
    const outName = nameOf.get(def.eraOut) ?? def.eraOut;
    return `${inName} – ${outName}`;
  }

  function isAvailableNow(def: VehicleDef): boolean {
    const currentOrder = orderOf.get(getCurrentEraId()) ?? 0;
    const inOrder = orderOf.get(def.eraIn) ?? 0;
    const outOrder = def.eraOut === null ? Infinity : (orderOf.get(def.eraOut) ?? Infinity);
    return inOrder <= currentOrder && currentOrder <= outOrder;
  }

  function renderHint(): void {
    if (catalog.length === 0) {
      hintEl.textContent = "";
      return;
    }
    const def = catalog[selectedIndex]!;
    const window = eraWindowLabel(def);
    if (!isAvailableNow(def)) {
      hintEl.textContent = `${def.name} (${window}) -- not available this era · [ ] to pick a vehicle`;
      return;
    }
    const affordable = canAfford(economy, def.purchaseCost);
    const routeHint = pendingRoute
      ? `V: buy ${def.name} (₦${def.purchaseCost}, ${window}) for the route you just built`
      : `Build a route, then V to buy a ${def.name} (₦${def.purchaseCost}, ${window}) for it`;
    hintEl.textContent = `${routeHint}${affordable ? "" : " -- can't afford it"} · [ ] to pick a vehicle`;
  }

  function handleBuild(event: BuildEvent): void {
    pendingRoute = event.nodeIds;
    rebuildFromMap(simulation, event.map);
    renderHint();
  }

  function handleMapChanged(map: GeneratedMap): void {
    rebuildFromMap(simulation, map);
  }

  function buySelectedForPendingRoute(): void {
    if (!pendingRoute || pendingRoute.length < 2) return;
    const def = catalog[selectedIndex];
    if (!def) return;
    if (!isAvailableNow(def)) return;
    if (!canAfford(economy, def.purchaseCost)) return;

    const id = `vehicle-${nextVehicleIdCounter}`;
    nextVehicleIdCounter += 1;

    const vehicle = createVehicle(
      id,
      pendingRoute,
      simulation.routing,
      def.speed,
      def.capacity,
      simulation.queues,
      def.carries,
      // Threaded from the def rather than left at createVehicle's default
      // of 1: an okada and a BRT occupying the same road space equally
      // was exactly the thing congestion weighting exists to prevent
      // (docs/principles.md §3), and until now no player vehicle ever
      // supplied a value.
      def.congestionWeight,
    );
    simulation.vehicles.push(vehicle);
    registerPurchase(economy, id, def.purchaseCost, def.operatingCostPerSecond, def.id);
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

  // Rising maintenance on obsolete stock (docs/principles.md §3): a
  // vehicle is obsolete once the era timeline moves past its def's
  // eraOut. Owned stock keeps running -- this only marks it, it never
  // despawns it (graceful obsolescence).
  function markObsoleteStock(): void {
    const currentOrder = orderOf.get(getCurrentEraId()) ?? 0;
    for (const [vehicleId, econ] of economy.vehicleEconomics) {
      const def = catalog.find((v) => v.id === econ.defId);
      if (!def || def.eraOut === null) continue;
      const outOrder = orderOf.get(def.eraOut) ?? Infinity;
      if (currentOrder > outOrder) {
        markVehicleObsolete(economy, vehicleId);
      }
    }
  }

  function handleEraChanged(): void {
    markObsoleteStock();
    renderHint();
  }

  function dispose(): void {
    window.removeEventListener("keydown", handleKeyDown);
  }

  return { handleBuild, handleMapChanged, handleEraChanged, dispose };
}
