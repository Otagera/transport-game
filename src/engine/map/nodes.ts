import type { MapNode, NodeKind, TerrainField } from "./types";

const SETTLEMENT_MIN_SPACING = 6;
const VILLAGE_MIN_SPACING = 3;
const SETTLEMENT_COUNT = 5;
const VILLAGE_COUNT = 10;
const DENSITY_THRESHOLD = 0.15;

interface Candidate {
  x: number;
  y: number;
  density: number;
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

// Every inhabited node originates demand (docs/rebuild-plan.md §5), so
// placement must not skip low-density spots entirely -- villages are placed
// from the same density-sorted candidate pool as settlements, just with a
// tighter spacing requirement.
export function placeNodes(terrain: TerrainField): MapNode[] {
  const candidates: Candidate[] = [];
  for (let y = 0; y < terrain.height; y += 1) {
    for (let x = 0; x < terrain.width; x += 1) {
      const index = y * terrain.width + x;
      if (terrain.water[index] === 1) {
        continue;
      }
      const density = terrain.settlementDensity[index];
      if (density >= DENSITY_THRESHOLD) {
        candidates.push({ x, y, density });
      }
    }
  }
  candidates.sort((a, b) => b.density - a.density);

  const nodes: MapNode[] = [];
  let nextId = 0;

  function place(kind: NodeKind, minSpacing: number, maxCount: number): void {
    let placed = 0;
    for (const candidate of candidates) {
      if (placed >= maxCount) {
        break;
      }
      const tooClose = nodes.some(
        (node) => distance(node.x, node.y, candidate.x, candidate.y) < minSpacing,
      );
      if (tooClose) {
        continue;
      }
      nodes.push({ id: `node-${nextId}`, kind, x: candidate.x, y: candidate.y });
      nextId += 1;
      placed += 1;
    }
  }

  place("settlement", SETTLEMENT_MIN_SPACING, SETTLEMENT_COUNT);
  place("village", VILLAGE_MIN_SPACING, VILLAGE_COUNT);

  return nodes;
}
