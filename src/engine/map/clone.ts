import type { GeneratedMap } from "./types";

// Undo is implemented as snapshot history (engine/map, not the authoring
// controller), so it needs a real deep copy -- typed arrays included.
// At this map's scale (a 48x48 grid, a handful of nodes/corridors) a full
// clone per build is cheap; correctness matters more than cleverness here.
export function cloneMap(map: GeneratedMap): GeneratedMap {
  return {
    seed: map.seed,
    terrain: {
      width: map.terrain.width,
      height: map.terrain.height,
      elevation: map.terrain.elevation.slice(),
      water: map.terrain.water.slice(),
      settlementDensity: map.terrain.settlementDensity.slice(),
    },
    nodes: map.nodes.map((node) => ({ ...node })),
    corridors: map.corridors.map((corridor) => ({
      ...corridor,
      nodeIds: [...corridor.nodeIds],
      polyline: corridor.polyline.map((point) => ({ ...point })),
    })),
    segments: map.segments.map((segment) => ({ ...segment })),
  };
}
