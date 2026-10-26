import type { TerrainField } from "../map/types";
import type { GameMapDef } from "./types";

// The slice's terrain (docs/principles.md §6, step 3): authored, like the
// rest of its hand-made map, rather than generated -- a river and a ridge
// placed where they make a road a decision. Same TerrainField shape as
// engine/map, so engine/pathing plans and prices over it unchanged.
//
// Cells are sampled at their integer coordinates, the same points towns
// and the terrain A* use.

/** Distance from a point to a segment, and how far along the segment (0..1) the nearest point is. */
function nearestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { distance: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return { distance: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

export function buildGameTerrain(def: GameMapDef): TerrainField {
  const { width, height } = def;
  const elevation = new Float32Array(width * height);
  const water = new Uint8Array(width * height);
  const rivers = def.terrain?.rivers ?? [];
  const hills = def.terrain?.hills ?? [];

  // Rivers cut their valleys (your playtest, 2026-10-26: "the river through the mountain" --
  // a river ran over the range, in 2D and 3D): the ground falls to the water's level at its
  // banks, back to the hill's own height VALLEY cells out. A range a river crosses has a gorge.
  const valleys = !!def.terrain?.valleys;
  const VALLEY = 5;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      let bank = Infinity;
      for (const river of rivers) {
        for (let k = 1; k < river.points.length; k += 1) {
          const [ax, ay] = river.points[k - 1]!;
          const [bx, by] = river.points[k]!;
          const { distance, t } = nearestOnSegment(x, y, ax, ay, bx, by);
          // A river narrows and widens between its points: a narrow stretch is a cheap crossing.
          const width = river.widths ? river.widths[k - 1]! + (river.widths[k]! - river.widths[k - 1]!) * t : river.width;
          if (distance <= width / 2) water[i] = 1;
          bank = Math.min(bank, distance - width / 2);
        }
      }
      // A hill is a smooth bump: full height at its centre, zero at its
      // radius. Elevation isn't bounded to 0..1 here -- the slice decides
      // water explicitly, so a hill is as high as its climb should cost.
      for (const hill of hills) {
        const d = Math.hypot(x - hill.x, y - hill.y) / hill.radius;
        if (d < 1) elevation[i] += hill.height * (1 - d * d) ** 2;
      }
      if (valleys && elevation[i]! > 0) {
        const v = Math.max(0, Math.min(1, bank / VALLEY));
        elevation[i] = elevation[i]! * v * v * (3 - 2 * v);
      }
    }
  }

  for (const town of def.towns) {
    if (water[Math.round(town.y) * width + Math.round(town.x)] === 1) throw new Error(`slice map: town ${town.id} is in water`);
  }
  return { width, height, elevation, water, settlementDensity: new Float32Array(width * height) };
}
