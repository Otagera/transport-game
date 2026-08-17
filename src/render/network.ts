import * as THREE from "three";
import type { GeneratedMap, NodeKind } from "../engine/map/types";
import { gridToWorld } from "./gridCoords";

export interface NetworkHandle {
  group: THREE.Group;
  update: (map: GeneratedMap) => void;
}

const NODE_COLORS: Record<NodeKind, number> = {
  settlement: 0xffcc44,
  village: 0x88cc66,
  junction: 0xcccccc,
  vertex: 0x8899aa,
};

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

export function createNetworkGroup(map: GeneratedMap): NetworkHandle {
  const group = new THREE.Group();

  function clear(): void {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeObject(child);
    }
  }

  function update(current: GeneratedMap): void {
    clear();

    const nodeById = new Map(current.nodes.map((node) => [node.id, node]));
    const { width, height } = current.terrain;

    for (const segment of current.segments) {
      const from = nodeById.get(segment.fromNodeId);
      const to = nodeById.get(segment.toNodeId);
      if (!from || !to) continue;
      const a = gridToWorld(from.x, from.y, width, height);
      const b = gridToWorld(to.x, to.y, width, height);
      const color = segment.type === "rail" ? 0x2b2b2b : 0xe8e8e8;

      if (segment.level === "elevated") {
        group.add(createBridgeDeck(a, b, color));
        continue;
      }

      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, 0.15, a.z),
        new THREE.Vector3(b.x, 0.15, b.z),
      ]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
      group.add(line);
    }

    for (const node of current.nodes) {
      const position = gridToWorld(node.x, node.y, width, height);
      const radius = node.kind === "vertex" ? 0.12 : 0.25;
      const geometry = new THREE.SphereGeometry(radius, 12, 8);
      const material = new THREE.MeshStandardMaterial({ color: NODE_COLORS[node.kind] });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(position.x, 0.2, position.z);
      mesh.castShadow = true;
      group.add(mesh);
    }
  }

  update(map);
  return { group, update };
}
