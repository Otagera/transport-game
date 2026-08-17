export type Rng = () => number;

// mulberry32: small, fast, deterministic. Same seed -> same sequence,
// which is the whole requirement for reproducible map generation.
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
