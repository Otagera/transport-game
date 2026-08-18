import * as THREE from "three";
import type { ProfileElement, Profile2DDef } from "../content/schema";

// Sweeps a 2D cross-section along a corridor centreline.
//
// The centreline is resampled through a Catmull-Rom curve for the same
// reason pathing/smoothing.ts smooths the *whole* chain at once rather
// than per segment: smoothing joins independently leaves a visible kink at
// every one of them (docs/architecture.md, "Supercover DDA + whole-chain
// Catmull-Rom"). A profile sweep makes those kinks far more obvious than a
// line ever did, because the cross-section fans out at the corner.
//
// This module is pure geometry and has no dev-only dependency: the Profile
// Studio is its first caller, but sweeping an authored profile along a
// built corridor is the eventual production use, which is why it lives in
// render/ rather than dev/. It is currently reached only from dev/, so the
// production bundle drops it as unreferenced code.

export interface Vec2 {
  x: number;
  y: number;
}

export const DEFAULT_SAMPLES_PER_SEGMENT = 8;
const PIER_SPACING = 6;
const PIER_HALF_WIDTH = 0.35;
const FASCIA_DEPTH = 0.6;

/**
 * The outermost silhouette of a set of cross-section elements: the upper
 * envelope walked left-to-right, then the lower envelope walked back.
 *
 * A cross-section is single-valued in the way terrain is -- at any offset
 * across the alignment there is a highest and a lowest point, and what
 * gets swept is the shape between them. That makes a true polygon union
 * unnecessary: the envelope IS the silhouette, and it is exact for every
 * profile that can actually be built (a road does not overhang itself).
 */
export function crossSectionOutline(elements: ProfileElement[]): Vec2[] {
  const byX = new Map<number, { min: number; max: number }>();
  for (const element of elements) {
    for (const vertex of element.vertices) {
      const existing = byX.get(vertex.x);
      if (existing) {
        existing.min = Math.min(existing.min, vertex.y);
        existing.max = Math.max(existing.max, vertex.y);
      } else {
        byX.set(vertex.x, { min: vertex.y, max: vertex.y });
      }
    }
  }

  const xs = [...byX.keys()].sort((a, b) => a - b);
  if (xs.length < 2) return [];

  const top = xs.map((x) => ({ x, y: byX.get(x)!.max }));
  const bottom = [...xs].reverse().map((x) => ({ x, y: byX.get(x)!.min }));
  return [...top, ...bottom];
}

export function outlineWidth(outline: Vec2[]): number {
  if (outline.length === 0) return 0;
  const xs = outline.map((point) => point.x);
  return Math.max(...xs) - Math.min(...xs);
}

/**
 * Resamples a chain of centreline points through a Catmull-Rom curve.
 * A two-point chain is returned as-is: a curve through two points is a
 * straight line, and asking THREE.CatmullRomCurve3 for one costs more
 * than it says.
 */
export function resampleCenterline(points: THREE.Vector3[], samplesPerSegment = DEFAULT_SAMPLES_PER_SEGMENT): THREE.Vector3[] {
  if (points.length < 3) return points.map((point) => point.clone());
  const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.5);
  return curve.getPoints(Math.max(1, (points.length - 1) * samplesPerSegment));
}

/**
 * Frames along the centreline. The up vector is world up, not a
 * Frenet normal: a road banks with the terrain, not with the curvature of
 * its own plan geometry, and a Frenet frame would roll the whole
 * cross-section upside down through an inflection point.
 */
function frameAt(points: THREE.Vector3[], index: number): { position: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } {
  const position = points[index]!;
  const previous = points[Math.max(0, index - 1)]!;
  const next = points[Math.min(points.length - 1, index + 1)]!;
  const tangent = next.clone().sub(previous);
  if (tangent.lengthSq() === 0) tangent.set(1, 0, 0);
  tangent.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(tangent, up).normalize();
  if (right.lengthSq() === 0) right.set(0, 0, 1);
  return { position, right, up };
}

/**
 * Sweeps one closed cross-section polygon along the centreline, producing
 * a closed tube: quads between consecutive rings, plus end caps.
 */
export function sweepCrossSection(crossSection: Vec2[], centerline: THREE.Vector3[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  if (crossSection.length < 3 || centerline.length < 2) return geometry;

  const ringSize = crossSection.length;
  const positions: number[] = [];
  for (let i = 0; i < centerline.length; i += 1) {
    const { position, right, up } = frameAt(centerline, i);
    for (const vertex of crossSection) {
      positions.push(
        position.x + right.x * vertex.x + up.x * vertex.y,
        position.y + right.y * vertex.x + up.y * vertex.y,
        position.z + right.z * vertex.x + up.z * vertex.y,
      );
    }
  }

  const indices: number[] = [];
  for (let ring = 0; ring < centerline.length - 1; ring += 1) {
    const a = ring * ringSize;
    const b = (ring + 1) * ringSize;
    for (let v = 0; v < ringSize; v += 1) {
      const next = (v + 1) % ringSize;
      indices.push(a + v, b + v, a + next);
      indices.push(a + next, b + v, b + next);
    }
  }

  // End caps as a triangle fan from the first vertex of each ring. Valid
  // for the convex-in-y envelope crossSectionOutline produces.
  const lastRing = (centerline.length - 1) * ringSize;
  for (let v = 1; v < ringSize - 1; v += 1) {
    indices.push(0, v + 1, v);
    indices.push(lastRing, lastRing + v, lastRing + v + 1);
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export interface SweptProfile {
  group: THREE.Group;
  dispose: () => void;
}

const MATERIAL_COLORS: Record<ProfileElement["material"], number> = {
  asphalt: 0x3a3a3e,
  curb: 0xb8b4ac,
  gutter: 0x8f8b84,
  ditch: 0x5a5142,
  barrier: 0xd7d2c6,
  ballast: 0x6b625a,
  sleeper: 0x4a3a2c,
};

export interface SweepOptions {
  /**
   * Chain indices whose *following* segment is elevated, as
   * `pathing/plan.ts`'s segmentLevels reports them. Elevated runs get a
   * bank-to-bank deck fascia and support piers -- "a bridge reads as a
   * bridge rather than a dam" (docs/rebuild-plan.md §6 Module 5).
   */
  elevatedSpans?: Array<{ from: THREE.Vector3; to: THREE.Vector3 }>;
  samplesPerSegment?: number;
}

export function buildSweptProfile(
  profile: Profile2DDef,
  chainPoints: THREE.Vector3[],
  options: SweepOptions = {},
): SweptProfile {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const centerline = resampleCenterline(chainPoints, options.samplesPerSegment);

  // Each element sweeps separately rather than as one merged solid, so a
  // curb reads as a curb: material is a per-element fact, and merging
  // would throw away exactly the distinction the profile exists to make.
  for (const element of profile.elements) {
    const geometry = sweepCrossSection(element.vertices, centerline);
    const material = new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS[element.material], roughness: 0.85 });
    group.add(new THREE.Mesh(geometry, material));
    disposables.push(geometry, material);
  }

  for (const span of options.elevatedSpans ?? []) {
    for (const object of elevatedStructure(span.from, span.to, profile.width)) {
      group.add(object);
      disposables.push(object.geometry, object.material as THREE.Material);
    }
  }

  return {
    group,
    dispose: () => disposables.forEach((item) => item.dispose()),
  };
}

/**
 * Deck fascia plus piers for one elevated span. The fascia is a single
 * bank-to-bank band rather than per-sample quads: a deck's edge beam is
 * continuous, and segmenting it produces visible seams at exactly the
 * places the eye is already looking for structure.
 */
export function elevatedStructure(from: THREE.Vector3, to: THREE.Vector3, width: number): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  const delta = to.clone().sub(from);
  const length = delta.length();
  if (length === 0) return meshes;

  const fasciaMaterial = new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.75 });
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(length, FASCIA_DEPTH, width), fasciaMaterial);
  fascia.position.copy(from).add(to).multiplyScalar(0.5).setY((from.y + to.y) / 2 - FASCIA_DEPTH / 2);
  // Same sign convention as render/network.ts's bridge deck: world Z is
  // the negated grid axis, so the yaw is -atan2(dz, dx).
  fascia.rotation.y = -Math.atan2(delta.z, delta.x);
  fascia.castShadow = true;
  meshes.push(fascia);

  const pierMaterial = new THREE.MeshStandardMaterial({ color: 0x7d786f, roughness: 0.9 });
  const pierCount = Math.max(0, Math.floor(length / PIER_SPACING) - 1);
  for (let i = 1; i <= pierCount; i += 1) {
    const t = i / (pierCount + 1);
    const deckY = from.y + (to.y - from.y) * t - FASCIA_DEPTH;
    if (deckY <= 0) continue;
    const pier = new THREE.Mesh(new THREE.BoxGeometry(PIER_HALF_WIDTH * 2, deckY, PIER_HALF_WIDTH * 2), pierMaterial);
    pier.position.set(from.x + delta.x * t, deckY / 2, from.z + delta.z * t);
    pier.castShadow = true;
    meshes.push(pier);
  }

  return meshes;
}
