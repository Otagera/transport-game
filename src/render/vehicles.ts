import * as THREE from "three";
import type { Vehicle } from "../engine/simulation/types";
import type { GeneratedMap } from "../engine/map/types";
import { gridToWorld } from "./gridCoords";
import { vehicleGridPosition } from "./picking";

export interface VehicleFleetHandle {
  group: THREE.Group;
  update: (vehicles: Vehicle[], map: GeneratedMap) => void;
}

const VEHICLE_COLORS: Record<Vehicle["carries"], number> = {
  passengers: 0xff8844,
  goods: 0x8866ff,
};
// Paratransit reads as a distinct, informal presence -- not a smaller
// version of a player vehicle (docs/principles.md §1: "the player's
// planned network competes with an emergent one").
const PARATRANSIT_COLOR = 0xffd23f;

function colorFor(vehicle: Vehicle): number {
  return vehicle.lifecycle === "one-shot" ? PARATRANSIT_COLOR : VEHICLE_COLORS[vehicle.carries];
}

// A cheap moving marker per vehicle, interpolated along its current edge
// by edgeProgress -- no heading/rotation (that's the kind of thing that
// tends to hide a sign bug, per the bridge deck; a plain sphere sidesteps
// it entirely, and heading doesn't matter for "is this vehicle here and
// moving").
export function createVehicleFleetRenderer(): VehicleFleetHandle {
  const group = new THREE.Group();
  const meshByVehicleId = new Map<string, THREE.Mesh>();

  function update(vehicles: Vehicle[], map: GeneratedMap): void {
    const seen = new Set<string>();

    for (const vehicle of vehicles) {
      seen.add(vehicle.id);
      let mesh = meshByVehicleId.get(vehicle.id);
      if (!mesh) {
        const radius = vehicle.lifecycle === "one-shot" ? 0.14 : 0.22;
        const geometry = new THREE.SphereGeometry(radius, 10, 8);
        const material = new THREE.MeshStandardMaterial({ color: colorFor(vehicle) });
        mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        group.add(mesh);
        meshByVehicleId.set(vehicle.id, mesh);
      }

      // Position comes from the same function picking uses, so the
      // marker you see and the thing you click can never disagree.
      const grid = vehicleGridPosition(vehicle, map);
      if (!grid) continue;
      const world = gridToWorld(grid.x, grid.y, map.terrain.width, map.terrain.height);
      mesh.position.set(world.x, 0.4, world.z);
    }

    for (const [id, mesh] of meshByVehicleId) {
      if (!seen.has(id)) {
        group.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        meshByVehicleId.delete(id);
      }
    }
  }

  return { group, update };
}
