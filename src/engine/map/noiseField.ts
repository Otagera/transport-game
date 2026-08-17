import type { Rng } from "./random";

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Deterministic value noise: a coarse random lattice, upsampled to the full
// field with smoothstep interpolation. No external noise dependency needed
// for a scalar field this simple.
function valueNoiseLayer(rng: Rng, width: number, height: number, cells: number): Float32Array {
  const latticeSize = cells + 1;
  const lattice = new Float32Array(latticeSize * latticeSize);
  for (let i = 0; i < lattice.length; i += 1) {
    lattice[i] = rng();
  }

  const field = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const fy = (y / height) * cells;
    const y0 = Math.floor(fy);
    const ty = smoothstep(fy - y0);
    for (let x = 0; x < width; x += 1) {
      const fx = (x / width) * cells;
      const x0 = Math.floor(fx);
      const tx = smoothstep(fx - x0);

      const v00 = lattice[y0 * latticeSize + x0];
      const v10 = lattice[y0 * latticeSize + x0 + 1];
      const v01 = lattice[(y0 + 1) * latticeSize + x0];
      const v11 = lattice[(y0 + 1) * latticeSize + x0 + 1];

      const top = lerp(v00, v10, tx);
      const bottom = lerp(v01, v11, tx);
      field[y * width + x] = lerp(top, bottom, ty);
    }
  }
  return field;
}

export interface NoiseOctave {
  cells: number;
  weight: number;
}

export function generateNoiseField(rng: Rng, width: number, height: number, octaves: NoiseOctave[]): Float32Array {
  const field = new Float32Array(width * height);
  let totalWeight = 0;

  for (const octave of octaves) {
    const layer = valueNoiseLayer(rng, width, height, octave.cells);
    totalWeight += octave.weight;
    for (let i = 0; i < field.length; i += 1) {
      field[i] += layer[i] * octave.weight;
    }
  }

  if (totalWeight > 0) {
    for (let i = 0; i < field.length; i += 1) {
      field[i] /= totalWeight;
    }
  }

  return field;
}
