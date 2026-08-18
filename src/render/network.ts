import * as THREE from "three";
import type { GeneratedMap, NodeKind, Segment } from "../engine/map/types";
import { computeBottleneckMetrics } from "../engine/simulation/bottleneck";
import type { SegmentTraffic } from "../engine/simulation/types";
import type { Selection } from "../ui/selection";
import { segmentCenterlines, straightCenterline, type GridPoint } from "./corridorGeometry";
import { gridToWorld } from "./gridCoords";
import type { ProfileCatalog } from "./profileCatalog";
import {
  WORLD_UNITS_PER_METRE,
  buildSweptProfile,
  profileCrownHeight,
  sweepCrossSection,
  type SweptProfile,
} from "./studioProfile";

export interface NetworkSignalInput {
  segmentTraffic: Map<string, SegmentTraffic>;
  selection: Selection | null;
  /** True while an overlay owns the colour channels. */
  dimmed: boolean;
}

export interface NetworkHandle {
  group: THREE.Group;
  /** Rebuilds geometry. Call when the map itself changed. */
  update: (map: GeneratedMap) => void;
  /** Swaps in the profile catalog and rebuilds. */
  setProfileCatalog: (catalog: ProfileCatalog) => void;
  /** Recolours in place -- no geometry churn. Safe per frame. */
  updateSignals: (input: NetworkSignalInput) => void;
}

const NODE_COLORS: Record<NodeKind, number> = {
  settlement: 0xffcc44,
  village: 0x88cc66,
  junction: 0xcccccc,
  vertex: 0x8899aa,
};

// Streets are neutral by default and take the health hue only where
// service actually runs (docs/rebuild-plan.md §5): "colouring every
// corridor green makes the whole map a lattice and destroys the signal."
// So an unused segment is grey no matter how healthy it technically is --
// health is a question you must act on, and there is nothing to act on
// where nothing runs.
const NEUTRAL_ROAD = 0xe8e8e8;
const NEUTRAL_RAIL = 0x2b2b2b;
const DIMMED_ROAD = 0x5a5a5a;
const DIMMED_RAIL = 0x232323;
const SELECTION_COLOR = 0xfff0a0;
// The signal strip: a painted centreline stripe carrying hue and
// brightness. Once a segment's *body* is an authored cross-section, the
// body's colours belong to its materials (asphalt is asphalt), so the two
// display channels move onto their own mark rather than repainting the
// road a different substance. This is the same separation the overlay
// layer makes, one level down.
const SIGNAL_STRIP_HALF_WIDTH = 0.09;
const SIGNAL_STRIP_LIFT = 0.03;
const GROUND_Y = 0.02;
const UTILISATION_FLOOR = 0.02;
// Brightness = utilisation, the second of the two channels. Floored well
// above zero so a barely-used segment still reads as coloured rather than
// black -- the channel encodes "how busy", not "does it exist".
const MIN_BRIGHTNESS = 0.4;

function disposeObject(object: THREE.Object3D): void {
  if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
    object.geometry.dispose();
    const material = object.material;
    if (Array.isArray(material)) {
      material.forEach((m) => m.dispose());
    } else {
      material.dispose();
    }
  }
}

const BRIDGE_DECK_HEIGHT = 0.9;
const BRIDGE_DECK_THICKNESS = 0.16;
const BRIDGE_DECK_WIDTH = 0.55;

// A bridge is an elevated deck with real clearance and a fixed-depth
// fascia band, not a flat line -- "a bridge reads as a bridge rather
// than a dam" (docs/rebuild-plan.md §6 Module 5). castShadow is what
// sells "elevated": the shadow lands on the terrain/water below with a
// visible gap, instead of the deck touching down.
export function createBridgeDeck(
  from: { x: number; z: number },
  to: { x: number; z: number },
  color: number,
): THREE.Mesh {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);

  const geometry = new THREE.BoxGeometry(length, BRIDGE_DECK_THICKNESS, BRIDGE_DECK_WIDTH);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((from.x + to.x) / 2, BRIDGE_DECK_HEIGHT, (from.z + to.z) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Hue = health, brightness = utilisation (docs/rebuild-plan.md §5). Two
 * channels, two meanings, never conflated -- which is also why every other
 * map-wide question lives in render/overlayLayer.ts's separate additive
 * group instead of borrowing one of these.
 */
export function segmentSignalColor(health: number, utilisation: number): THREE.Color {
  const clampedHealth = Math.max(0, Math.min(1, health));
  const good = new THREE.Color(0x33cc55);
  const mid = new THREE.Color(0xe0b040);
  const bad = new THREE.Color(0xdd3322);
  const hue =
    clampedHealth > 0.5 ? mid.clone().lerp(good, (clampedHealth - 0.5) * 2) : bad.clone().lerp(mid, clampedHealth * 2);
  const brightness = MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * Math.max(0, Math.min(1, utilisation));
  return hue.multiplyScalar(brightness);
}

export function createNetworkGroup(map: GeneratedMap, initialCatalog?: ProfileCatalog): NetworkHandle {
  const group = new THREE.Group();
  const segmentMaterials = new Map<string, { material: THREE.Material & { color: THREE.Color }; isRail: boolean }>();
  const nodeMaterials = new Map<string, { material: THREE.MeshStandardMaterial; kind: NodeKind }>();
  const sweptProfiles: SweptProfile[] = [];
  let catalog: ProfileCatalog | undefined = initialCatalog;
  let currentMap: GeneratedMap = map;

  function clear(): void {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeObject(child);
    }
    for (const swept of sweptProfiles) swept.dispose();
    sweptProfiles.length = 0;
    segmentMaterials.clear();
    nodeMaterials.clear();
  }

  function toWorld(points: GridPoint[], y: number, width: number, height: number): THREE.Vector3[] {
    return points.map((point) => {
      const world = gridToWorld(point.x, point.y, width, height);
      return new THREE.Vector3(world.x, y, world.z);
    });
  }

  // Hue and brightness ride on their own thin strip above the
  // carriageway, swept along the same centreline as the body so it
  // follows every curve the profile does.
  function addSignalStrip(segmentId: string, centerline: THREE.Vector3[], crownY: number, isRail: boolean): void {
    const section = [
      { x: -SIGNAL_STRIP_HALF_WIDTH, y: crownY },
      { x: SIGNAL_STRIP_HALF_WIDTH, y: crownY },
      { x: SIGNAL_STRIP_HALF_WIDTH, y: crownY + 0.012 },
      { x: -SIGNAL_STRIP_HALF_WIDTH, y: crownY + 0.012 },
    ];
    const geometry = sweepCrossSection(section, centerline);
    const material = new THREE.MeshBasicMaterial({ color: isRail ? NEUTRAL_RAIL : NEUTRAL_ROAD });
    group.add(new THREE.Mesh(geometry, material));
    segmentMaterials.set(segmentId, { material, isRail });
  }

  function addFallbackLine(segment: Segment, centerline: THREE.Vector3[], isRail: boolean): void {
    const geometry = new THREE.BufferGeometry().setFromPoints(centerline);
    const material = new THREE.LineBasicMaterial({ color: isRail ? NEUTRAL_RAIL : NEUTRAL_ROAD });
    group.add(new THREE.Line(geometry, material));
    segmentMaterials.set(segment.id, { material, isRail });
  }

  function update(current: GeneratedMap): void {
    clear();
    currentMap = current;

    const nodeById = new Map(current.nodes.map((node) => [node.id, node]));
    const { width, height } = current.terrain;

    // One split per corridor, not per segment: splitting is O(polyline)
    // and every segment of a corridor needs the same result.
    const centerlinesBySegment = new Map<string, GridPoint[]>();
    for (const corridor of current.corridors) {
      for (const [segmentId, run] of segmentCenterlines(current, corridor)) {
        centerlinesBySegment.set(segmentId, run);
      }
    }

    for (const segment of current.segments) {
      const from = nodeById.get(segment.fromNodeId);
      const to = nodeById.get(segment.toNodeId);
      if (!from || !to) continue;
      const isRail = segment.type === "rail";
      const grid = centerlinesBySegment.get(segment.id) ?? straightCenterline(current, segment);
      if (!grid || grid.length < 2) continue;

      const profile = catalog?.resolve(segment);
      const elevated = segment.level === "elevated";
      const deckY = elevated ? BRIDGE_DECK_HEIGHT : GROUND_Y;

      if (!profile) {
        // Degrades to the pre-profile rendering rather than blanking the
        // segment: content can be missing, the map still has to read.
        const a = gridToWorld(from.x, from.y, width, height);
        const b = gridToWorld(to.x, to.y, width, height);
        if (elevated) {
          const deck = createBridgeDeck(a, b, isRail ? NEUTRAL_RAIL : NEUTRAL_ROAD);
          group.add(deck);
          segmentMaterials.set(segment.id, { material: deck.material as THREE.MeshStandardMaterial, isRail });
        } else {
          addFallbackLine(segment, toWorld(grid, 0.15, width, height), isRail);
        }
        continue;
      }

      // A bridge deck stays straight bank to bank and is never smoothed
      // (pathing/plan.ts), so an elevated segment sweeps its two ends
      // only -- and gets the fascia and piers that make it read as a
      // bridge rather than a dam.
      const centerGrid = elevated ? [grid[0]!, grid[grid.length - 1]!] : grid;
      const centerline = toWorld(centerGrid, deckY, width, height);
      const swept = buildSweptProfile(profile, centerline, {
        metreScale: WORLD_UNITS_PER_METRE,
        elevatedSpans: elevated ? [{ from: centerline[0]!, to: centerline[centerline.length - 1]! }] : [],
      });
      group.add(swept.group);
      sweptProfiles.push(swept);

      addSignalStrip(
        segment.id,
        centerline,
        profileCrownHeight(profile) * WORLD_UNITS_PER_METRE + SIGNAL_STRIP_LIFT,
        isRail,
      );
    }

    for (const node of current.nodes) {
      const position = gridToWorld(node.x, node.y, width, height);
      // A promoted village growing into a settlement (docs/rebuild-plan.md
      // §6 Module 9) must be visible on the map without reading a number
      // -- the color change alone is subtle, so settlement also renders
      // larger than village.
      const radius = node.kind === "vertex" ? 0.12 : node.kind === "settlement" ? 0.32 : 0.25;
      const geometry = new THREE.SphereGeometry(radius, 12, 8);
      const material = new THREE.MeshStandardMaterial({ color: NODE_COLORS[node.kind] });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(position.x, 0.2, position.z);
      mesh.castShadow = true;
      group.add(mesh);
      nodeMaterials.set(node.id, { material, kind: node.kind });
    }
  }

  function updateSignals(input: NetworkSignalInput): void {
    const selectedSegment = input.selection?.kind === "segment" ? input.selection.id : null;
    const selectedNode = input.selection?.kind === "node" ? input.selection.id : null;

    for (const [segmentId, entry] of segmentMaterials) {
      if (segmentId === selectedSegment) {
        entry.material.color.setHex(SELECTION_COLOR);
        continue;
      }
      const traffic = input.segmentTraffic.get(segmentId);
      const metrics = traffic ? computeBottleneckMetrics(traffic) : null;
      if (input.dimmed || !metrics || metrics.utilisation <= UTILISATION_FLOOR) {
        entry.material.color.setHex(
          input.dimmed ? (entry.isRail ? DIMMED_RAIL : DIMMED_ROAD) : entry.isRail ? NEUTRAL_RAIL : NEUTRAL_ROAD,
        );
        continue;
      }
      entry.material.color.copy(segmentSignalColor(metrics.health, metrics.utilisation));
    }

    for (const [nodeId, entry] of nodeMaterials) {
      entry.material.color.setHex(nodeId === selectedNode ? SELECTION_COLOR : NODE_COLORS[entry.kind]);
    }
  }

  function setProfileCatalog(next: ProfileCatalog): void {
    catalog = next;
    update(currentMap);
  }

  update(map);
  return { group, update, setProfileCatalog, updateSignals };
}
