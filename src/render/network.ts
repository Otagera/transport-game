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
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, 0.15, a.z),
        new THREE.Vector3(b.x, 0.15, b.z),
      ]);
      const color = segment.type === "rail" ? 0x2b2b2b : 0xe8e8e8;
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
