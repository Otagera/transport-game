import * as THREE from "three";
import type { GeneratedMap, InfrastructureType } from "../engine/map/types";
import type { AlignmentMode } from "../engine/pathing/plan";
import { planCorridor } from "../engine/pathing/plan";
import { commitCorridor, type WaypointSpec } from "../engine/map/build";
import { cloneMap } from "../engine/map/clone";
import { isWater } from "../engine/pathing/terrainAStar";
import { worldToGrid } from "./gridCoords";
import { createGhostPreview } from "./ghostPreview";
import type { NetworkHandle } from "./network";
import { createCostPanel } from "../ui/costPanel";
import type { SceneHandle } from "./scene";

const SNAP_RADIUS = 1.2;

export interface AuthoringController {
  dispose: () => void;
}

// The interactive authoring loop for Module 4: click to place waypoints,
// see a live cost breakdown, build (Enter) or cancel (Escape), undo
// (Ctrl/Cmd+Z) via snapshot history. Lives in render/ rather than
// engine/ because it owns DOM events and raycasting -- the actual
// pathing/build logic it calls into (planCorridor, commitCorridor) is
// pure engine code.
export function createAuthoringController(
  sceneHandle: SceneHandle,
  groundMesh: THREE.Mesh,
  initialMap: GeneratedMap,
  networkHandle: NetworkHandle,
  costPanelEl: HTMLElement,
): AuthoringController {
  let map = initialMap;
  const history: GeneratedMap[] = [];

  let mode: AlignmentMode = "auto";
  let infrastructureType: InfrastructureType = "road";
  const waypoints: WaypointSpec[] = [];

  const ghostPreview = createGhostPreview();
  sceneHandle.scene.add(ghostPreview.group);
  const costPanel = createCostPanel(costPanelEl);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function pointerToGrid(event: PointerEvent): { x: number; y: number } | null {
    const rect = sceneHandle.renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, sceneHandle.camera);
    const hits = raycaster.intersectObject(groundMesh, false);
    if (hits.length === 0) return null;
    const hit = hits[0]!.point;
    const grid = worldToGrid(hit.x, hit.z, map.terrain.width, map.terrain.height);
    if (grid.x < 0 || grid.x >= map.terrain.width || grid.y < 0 || grid.y >= map.terrain.height) {
      return null;
    }
    return grid;
  }

  function findNearbyNode(grid: { x: number; y: number }): string | undefined {
    let best: { id: string; distance: number } | null = null;
    for (const node of map.nodes) {
      const distance = Math.hypot(node.x - grid.x, node.y - grid.y);
      if (distance <= SNAP_RADIUS && (!best || distance < best.distance)) {
        best = { id: node.id, distance };
      }
    }
    return best?.id;
  }

  function refreshPreview(cursor: { x: number; y: number } | null): void {
    if (waypoints.length === 0) {
      costPanel.render({ visible: false, mode, infrastructureType, breakdown: null, valid: true, hint: "" });
      ghostPreview.update([], null, map.terrain.width, map.terrain.height, true);
      return;
    }

    const points = waypoints.map((w) => w.point);
    const previewPoints = cursor ? [...points, cursor] : points;

    if (previewPoints.length < 2) {
      ghostPreview.update(points, null, map.terrain.width, map.terrain.height, true);
      costPanel.render({
        visible: true,
        mode,
        infrastructureType,
        breakdown: null,
        valid: true,
        hint: "Click to add another waypoint.",
      });
      return;
    }

    const existingIndices = new Set<number>();
    waypoints.forEach((w, i) => {
      if (w.existingNodeId) existingIndices.add(i);
    });

    const plan = planCorridor(map.terrain, previewPoints, mode, existingIndices);
    if (!plan) {
      ghostPreview.update(points, previewPoints, map.terrain.width, map.terrain.height, false);
      costPanel.render({
        visible: true,
        mode,
        infrastructureType,
        breakdown: null,
        valid: false,
        hint: "No valid route -- water blocks this line at ground level.",
      });
      return;
    }

    ghostPreview.update(points, plan.polyline, map.terrain.width, map.terrain.height, true);
    costPanel.render({
      visible: true,
      mode,
      infrastructureType,
      breakdown: plan.breakdown,
      valid: true,
      hint: "Enter build · Esc cancel · Ctrl/Cmd+Z undo · 1/2/3 mode · R road/rail",
    });
  }

  function handlePointerMove(event: PointerEvent): void {
    refreshPreview(pointerToGrid(event));
  }

  function handleClick(event: PointerEvent): void {
    const grid = pointerToGrid(event);
    if (!grid) return;
    // Wet waypoints must not create nodes (docs/rebuild-plan.md §5) -- no
    // bridges yet, so a water click is simply rejected.
    if (isWater(map.terrain, grid.x, grid.y)) return;

    const existingNodeId = findNearbyNode(grid);
    waypoints.push({ point: grid, existingNodeId });
    // Not `refreshPreview(grid)`: the just-placed point is already the
    // last entry in `waypoints`, so passing it again as "cursor" would
    // append it a second time and overcount both the preview's node cost
    // and its geometry. The next pointermove supplies the real live
    // cursor extension.
    refreshPreview(null);
  }

  function cancelDraw(): void {
    waypoints.length = 0;
    refreshPreview(null);
  }

  function build(): void {
    if (waypoints.length < 2) return;
    const points = waypoints.map((w) => w.point);
    const existingIndices = new Set<number>();
    waypoints.forEach((w, i) => {
      if (w.existingNodeId) existingIndices.add(i);
    });

    const plan = planCorridor(map.terrain, points, mode, existingIndices);
    if (!plan) return;

    history.push(cloneMap(map));
    map = commitCorridor(map, waypoints, plan, infrastructureType);
    networkHandle.update(map);
    waypoints.length = 0;
    refreshPreview(null);
  }

  function undo(): void {
    const previous = history.pop();
    if (!previous) return;
    map = previous;
    networkHandle.update(map);
    waypoints.length = 0;
    refreshPreview(null);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      cancelDraw();
    } else if (event.key === "Enter") {
      build();
    } else if (event.key.toLowerCase() === "z" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      undo();
    } else if (event.key === "1") {
      mode = "auto";
      refreshPreview(null);
    } else if (event.key === "2") {
      mode = "straight";
      refreshPreview(null);
    } else if (event.key === "3") {
      mode = "curve";
      refreshPreview(null);
    } else if (event.key.toLowerCase() === "r") {
      infrastructureType = infrastructureType === "road" ? "rail" : "road";
      refreshPreview(null);
    }
  }

  const canvas = sceneHandle.renderer.domElement;
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("click", handleClick);
  window.addEventListener("keydown", handleKeyDown);

  costPanel.render({ visible: false, mode, infrastructureType, breakdown: null, valid: true, hint: "" });

  function dispose(): void {
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("click", handleClick);
    window.removeEventListener("keydown", handleKeyDown);
  }

  return { dispose };
}
