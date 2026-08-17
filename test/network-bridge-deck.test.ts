import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createBridgeDeck } from "@render/network";

// Regression test for a real bug found via live browser verification: the
// deck's rotation.y had the wrong sign. Both endpoints' X came out right
// (cosine is even, so a sign error there is invisible), but Z was
// reflected between the two ends -- worldEnd1 landed at bankIn's Z instead
// of bankOut's, and vice versa. An axis-aligned test can't catch this
// (dz=0 makes both signs equal); this one uses a genuinely diagonal
// crossing, matching how the bug was actually found.
describe("createBridgeDeck", () => {
  test("the deck's long-axis endpoints land exactly on the two bank points, in the right order", () => {
    const from = { x: -3.5, z: 5.5 };
    const to = { x: 3.5, z: 3.5 };
    const mesh = createBridgeDeck(from, to, 0xffffff);
    mesh.updateMatrixWorld(true);

    const halfLength = (mesh.geometry as THREE.BoxGeometry).parameters.width / 2;
    const localPositiveX = new THREE.Vector3(halfLength, 0, 0).applyMatrix4(mesh.matrixWorld);
    const localNegativeX = new THREE.Vector3(-halfLength, 0, 0).applyMatrix4(mesh.matrixWorld);

    expect(localPositiveX.x).toBeCloseTo(to.x, 5);
    expect(localPositiveX.z).toBeCloseTo(to.z, 5);
    expect(localNegativeX.x).toBeCloseTo(from.x, 5);
    expect(localNegativeX.z).toBeCloseTo(from.z, 5);
  });

  test("the deck is centered at the midpoint of the two bank points", () => {
    const from = { x: 0, z: 0 };
    const to = { x: 4, z: -6 };
    const mesh = createBridgeDeck(from, to, 0xffffff);
    expect(mesh.position.x).toBeCloseTo(2, 5);
    expect(mesh.position.z).toBeCloseTo(-3, 5);
  });

  test("the deck is elevated above ground level and casts a shadow", () => {
    const mesh = createBridgeDeck({ x: 0, z: 0 }, { x: 5, z: 0 }, 0xffffff);
    expect(mesh.position.y).toBeGreaterThan(0.5);
    expect(mesh.castShadow).toBe(true);
  });
});
