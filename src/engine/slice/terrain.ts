import type { TerrainField } from "../map/types";
import type { SliceMapDef } from "./types";

// The slice's terrain (docs/principles.md §6, step 3): authored, like the
// rest of its hand-made map, rather than generated -- a river and a ridge
// placed where they make a road a decision. Same TerrainField shape as
// engine/map, so engine/pathing plans and prices over it unchanged.
//
// Cells are sampled at their integer coordinates, the same points towns
// and the terrain A* use.

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function buildSliceTerrain(def: SliceMapDef): TerrainField {
  const { width, height } = def;
  const elevation = new Float32Array(width * height);
  const water = new Uint8Array(width * height);
  const rivers = def.terrain?.rivers ?? [];
  const hills = def.terrain?.hills ?? [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      for (const river of rivers) {
        for (let k = 1; k < river.points.length; k += 1) {
          const [ax, ay] = river.points[k - 1]!;
          const [bx, by] = river.points[k]!;
          if (distanceToSegment(x, y, ax, ay, bx, by) <= river.width / 2) water[i] = 1;
        }
      }
      // A hill is a smooth bump: full height at its centre, zero at its
      // radius. Elevation isn't bounded to 0..1 here -- the slice decides
      // water explicitly, so a hill is as high as its climb should cost.
      for (const hill of hills) {
        const d = Math.hypot(x - hill.x, y - hill.y) / hill.radius;
        if (d < 1) elevation[i] += hill.height * (1 - d * d) ** 2;
      }
    }
  }

  for (const town of def.towns) {
    if (water[Math.round(town.y) * width + Math.round(town.x)] === 1) throw new Error(`slice map: town ${town.id} is in water`);
  }
  return { width, height, elevation, water, settlementDensity: new Float32Array(width * height) };
}
