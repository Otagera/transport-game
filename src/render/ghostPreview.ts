import * as THREE from "three";
import type { GridPoint } from "../engine/pathing/terrainAStar";
import { gridToWorld } from "./gridCoords";

export interface GhostPreviewHandle {
  group: THREE.Group;
  update: (waypoints: GridPoint[], previewPolyline: GridPoint[] | null, width: number, height: number, valid: boolean) => void;
}

export function createGhostPreview(): GhostPreviewHandle {
  const group = new THREE.Group();
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffee55 });
  let waypointMarkers: THREE.Mesh[] = [];
  let previewLine: THREE.Line | null = null;

  function clear(): void {
    for (const marker of waypointMarkers) {
      group.remove(marker);
      marker.geometry.dispose();
    }
    waypointMarkers = [];
    if (previewLine) {
      group.remove(previewLine);
      previewLine.geometry.dispose();
      (previewLine.material as THREE.Material).dispose();
      previewLine = null;
    }
  }

  function update(
    waypoints: GridPoint[],
    previewPolyline: GridPoint[] | null,
    width: number,
    height: number,
    valid: boolean,
  ): void {
    clear();

    for (const waypoint of waypoints) {
      const position = gridToWorld(waypoint.x, waypoint.y, width, height);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), markerMaterial);
      mesh.position.set(position.x, 0.25, position.z);
      group.add(mesh);
      waypointMarkers.push(mesh);
    }

    if (previewPolyline && previewPolyline.length >= 2) {
      const points = previewPolyline.map((p) => {
        const w = gridToWorld(p.x, p.y, width, height);
        return new THREE.Vector3(w.x, 0.25, w.z);
      });
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: valid ? 0x55ff88 : 0xff5555 });
      previewLine = new THREE.Line(geometry, material);
      group.add(previewLine);
    }
  }

  return { group, update };
}
