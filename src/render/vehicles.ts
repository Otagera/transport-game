import * as THREE from "three";
import type { Vehicle } from "../engine/simulation/types";
import type { GeneratedMap } from "../engine/map/types";
import { gridToWorld } from "./gridCoords";

export interface VehicleFleetHandle {
  group: THREE.Group;
  update: (vehicles: Vehicle[], map: GeneratedMap) => void;
}

const VEHICLE_COLORS: Record<Vehicle["carries"], number> = {
  passengers: 0xff8844,
  goods: 0x8866ff,
};
// Paratransit reads as a distinct, informal presence -- not a smaller
// version of a player vehicle (docs/rebuild-plan.md: "the player's
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
    const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
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

      const pathLength = vehicle.path.length;
      if (pathLength < 2 || vehicle.pathIndex >= pathLength) continue;
      const fromIndex = (vehicle.pathIndex - 1 + pathLength) % pathLength;
      const fromNode = nodeById.get(vehicle.path[fromIndex]!);
      const toNode = nodeById.get(vehicle.path[vehicle.pathIndex]!);
      if (!fromNode || !toNode) continue;

      const a = gridToWorld(fromNode.x, fromNode.y, map.terrain.width, map.terrain.height);
      const b = gridToWorld(toNode.x, toNode.y, map.terrain.width, map.terrain.height);
      const t = vehicle.edgeProgress;
      mesh.position.set(a.x + (b.x - a.x) * t, 0.4, a.z + (b.z - a.z) * t);
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
