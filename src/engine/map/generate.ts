import { createRng } from "./random";
import { generateTerrainField } from "./terrain";
import { placeNodes } from "./nodes";
import { generateInheritedNetwork } from "./corridors";
import { assertFullyConnected } from "./connectivity";
import type { GeneratedMap } from "./types";

// Regional scale (docs/rebuild-plan.md §2): settlements spread across a
// large map, corridors running tens of cells between them.
export const MAP_WIDTH = 48;
export const MAP_HEIGHT = 48;

export function generateMap(seed: number): GeneratedMap {
  const rng = createRng(seed);
  const terrain = generateTerrainField(rng, MAP_WIDTH, MAP_HEIGHT);
  const nodes = placeNodes(terrain);

  if (nodes.length === 0) {
    throw new Error(`Map generation produced zero nodes for seed ${seed}.`);
  }

  const { corridors, infrastructure } = generateInheritedNetwork(nodes);

  assertFullyConnected(
    nodes.map((node) => node.id),
    corridors.map((corridor) => corridor.nodeIds),
  );

  return { seed, terrain, nodes, corridors, infrastructure };
}
