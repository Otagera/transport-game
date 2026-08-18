import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Select-and-focus (docs/architecture/render-and-ui.md §2): clicking a row in
// a List must both select the entity and bring it on screen. A hard jump
// makes the player re-orient from scratch every time -- the whole point of
// the diorama register (docs/principles.md §3, "Visual direction") is
// that the world is one legible object, and teleporting the camera breaks
// that continuity. So this eases.
//
// It moves `controls.target` and the camera position by the *same* delta,
// which preserves the orbit angle exactly. Recomputing the camera position
// from an angle instead would silently discard whatever rotation the
// player had set up, and they'd have to redo it after every list click.
const FOCUS_DURATION_SECONDS = 0.55;

export interface CameraController {
  focusOn: (point: { x: number; z: number }) => void;
  /** Call once per frame, before controls.update()/render. */
  update: (dt: number) => void;
  isMoving: () => boolean;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createCameraController(camera: THREE.Camera, controls: OrbitControls): CameraController {
  const fromTarget = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const offset = new THREE.Vector3();
  let elapsed = FOCUS_DURATION_SECONDS;

  function focusOn(point: { x: number; z: number }): void {
    fromTarget.copy(controls.target);
    toTarget.set(point.x, controls.target.y, point.z);
    // Captured once at the start of the flight, not read live: reading it
    // per-frame while we are also moving the camera would feed the
    // camera's own motion back into the offset.
    offset.copy(camera.position).sub(controls.target);
    elapsed = 0;
  }

  function update(dt: number): void {
    if (elapsed >= FOCUS_DURATION_SECONDS) return;
    elapsed = Math.min(FOCUS_DURATION_SECONDS, elapsed + dt);
    const t = easeInOutCubic(elapsed / FOCUS_DURATION_SECONDS);
    controls.target.lerpVectors(fromTarget, toTarget, t);
    camera.position.copy(controls.target).add(offset);
  }

  return { focusOn, update, isMoving: () => elapsed < FOCUS_DURATION_SECONDS };
}
