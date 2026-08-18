import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { crossSectionOutline, elevatedStructure, outlineWidth, resampleCenterline, sweepCrossSection } from "@render/studioProfile";
import { Profile2DDefSchema, type ProfileElement } from "@content/schema";

function rect(id: string, material: ProfileElement["material"], x0: number, x1: number, y0: number, y1: number): ProfileElement {
  return {
    id,
    material,
    vertices: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    channels: {},
  };
}

describe("crossSectionOutline", () => {
  test("wraps a single element as its own silhouette", () => {
    const outline = crossSectionOutline([rect("a", "asphalt", -3, 3, 0, 0.2)]);
    expect(outline).toEqual([
      { x: -3, y: 0.2 },
      { x: 3, y: 0.2 },
      { x: 3, y: 0 },
      { x: -3, y: 0 },
    ]);
  });

  test("takes the upper envelope where a curb stands proud of the carriageway", () => {
    const outline = crossSectionOutline([
      rect("road", "asphalt", -3, 3, 0, 0.2),
      rect("curb", "curb", 3, 3.3, 0, 0.5),
    ]);
    // The shared x = 3 must report the curb's top, not the asphalt's.
    expect(outline.find((point) => point.x === 3 && point.y === 0.5)).toBeDefined();
    expect(outline.at(0)).toEqual({ x: -3, y: 0.2 });
  });

  test("takes the lower envelope where a ditch cuts below ground", () => {
    const outline = crossSectionOutline([
      rect("road", "asphalt", -3, 3, 0, 0.2),
      rect("ditch", "ditch", 3, 4, -0.6, 0),
    ]);
    expect(outline.some((point) => point.y === -0.6)).toBe(true);
  });

  test("a degenerate profile yields no outline rather than a zero-area polygon", () => {
    expect(crossSectionOutline([])).toEqual([]);
  });

  test("outlineWidth is bank to bank", () => {
    const outline = crossSectionOutline([rect("road", "asphalt", -3.5, 3.5, 0, 0.12), rect("curb", "curb", 3.5, 3.7, 0, 0.3)]);
    expect(outlineWidth(outline)).toBeCloseTo(7.2, 6);
  });

  test("the derived outline is a valid Profile2DDef cross-section", () => {
    const elements = [rect("road", "asphalt", -3.5, 3.5, 0, 0.12), rect("curb", "curb", 3.5, 3.7, 0, 0.3)];
    const outline = crossSectionOutline(elements);
    const parsed = Profile2DDefSchema.safeParse({
      id: "p",
      surfaceType: "road",
      width: outlineWidth(outline),
      costPerMeter: 12,
      decayRateMultiplier: 1,
      crossSectionVertices: outline,
      elements,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("resampleCenterline", () => {
  test("a two-point chain is left alone -- a curve through two points is a straight line", () => {
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)];
    expect(resampleCenterline(points).length).toBe(2);
  });

  test("a longer chain is smoothed to many more samples, and still starts and ends where it did", () => {
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(5, 0, 5), new THREE.Vector3(10, 0, 0)];
    const sampled = resampleCenterline(points, 8);
    expect(sampled.length).toBeGreaterThan(points.length);
    expect(sampled.at(0)!.distanceTo(points[0]!)).toBeCloseTo(0, 5);
    expect(sampled.at(-1)!.distanceTo(points.at(-1)!)).toBeCloseTo(0, 5);
  });
});

describe("sweepCrossSection", () => {
  const section = [
    { x: -2, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 0.3 },
    { x: -2, y: 0.3 },
  ];

  test("produces one ring of vertices per centreline sample", () => {
    const centerline = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(20, 0, 0)];
    const geometry = sweepCrossSection(section, centerline);
    expect(geometry.getAttribute("position").count).toBe(section.length * centerline.length);
  });

  test("the section is laid across the alignment, not along it", () => {
    // Centreline runs along +X, so the section's local x must land on Z.
    const centerline = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)];
    const positions = sweepCrossSection(section, centerline).getAttribute("position");
    const first = new THREE.Vector3().fromBufferAttribute(positions, 0);
    const second = new THREE.Vector3().fromBufferAttribute(positions, 1);
    expect(Math.abs(first.x - second.x)).toBeCloseTo(0, 5);
    expect(Math.abs(first.z - second.z)).toBeCloseTo(4, 5);
  });

  test("y in the cross-section is world up, so a raised element sits above a flat one", () => {
    const centerline = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)];
    const positions = sweepCrossSection(section, centerline).getAttribute("position");
    expect(new THREE.Vector3().fromBufferAttribute(positions, 0).y).toBeCloseTo(0, 5);
    expect(new THREE.Vector3().fromBufferAttribute(positions, 2).y).toBeCloseTo(0.3, 5);
  });

  test("a chain too short or a section too thin yields empty geometry rather than a malformed one", () => {
    expect(sweepCrossSection(section, [new THREE.Vector3()]).getAttribute("position")).toBeUndefined();
    expect(sweepCrossSection([{ x: 0, y: 0 }], [new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]).getAttribute("position")).toBeUndefined();
  });
});

describe("elevatedStructure", () => {
  test("a long span gets a fascia plus piers; the fascia sits below the deck", () => {
    const meshes = elevatedStructure(new THREE.Vector3(0, 3, 0), new THREE.Vector3(24, 3, 0), 7);
    expect(meshes.length).toBeGreaterThan(1);
    expect(meshes[0]!.position.y).toBeLessThan(3);
  });

  test("a short span gets a fascia and no piers -- piers under a two-metre hop would be nonsense", () => {
    expect(elevatedStructure(new THREE.Vector3(0, 3, 0), new THREE.Vector3(2, 3, 0), 7)).toHaveLength(1);
  });

  test("piers stand on the ground, never below it", () => {
    const meshes = elevatedStructure(new THREE.Vector3(0, 3, 0), new THREE.Vector3(24, 3, 0), 7);
    for (const pier of meshes.slice(1)) {
      expect(pier.position.y).toBeGreaterThan(0);
    }
  });

  test("a zero-length span produces nothing rather than a degenerate box", () => {
    expect(elevatedStructure(new THREE.Vector3(1, 3, 1), new THREE.Vector3(1, 3, 1), 7)).toEqual([]);
  });
});
