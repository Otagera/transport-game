import type { Rng } from "./random";
import { generateNoiseField } from "./noiseField";
import type { TerrainField } from "./types";

const WATER_THRESHOLD = 0.32;

export function generateTerrainField(rng: Rng, width: number, height: number): TerrainField {
  const elevation = generateNoiseField(rng, width, height, [
    { cells: 4, weight: 0.6 },
    { cells: 8, weight: 0.3 },
    { cells: 16, weight: 0.1 },
  ]);

  const water = new Uint8Array(width * height);
  for (let i = 0; i < elevation.length; i += 1) {
    water[i] = elevation[i] < WATER_THRESHOLD ? 1 : 0;
  }

  const settlementDensity = generateNoiseField(rng, width, height, [{ cells: 6, weight: 1 }]);
  for (let i = 0; i < settlementDensity.length; i += 1) {
    if (water[i] === 1) {
      settlementDensity[i] = 0;
    }
  }

  return { width, height, elevation, water, settlementDensity };
}
