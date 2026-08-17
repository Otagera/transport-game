import { describe, expect, test } from "bun:test";
import { generateMap } from "@engine/map/generate";

describe("map generation determinism", () => {
  test("same seed produces an identical map", () => {
    const a = generateMap(12345);
    const b = generateMap(12345);

    expect(Array.from(a.terrain.elevation)).toEqual(Array.from(b.terrain.elevation));
    expect(Array.from(a.terrain.water)).toEqual(Array.from(b.terrain.water));
    expect(Array.from(a.terrain.settlementDensity)).toEqual(Array.from(b.terrain.settlementDensity));
    expect(a.nodes).toEqual(b.nodes);
    expect(a.corridors).toEqual(b.corridors);
    expect(a.infrastructure).toEqual(b.infrastructure);
  });

  test("different seeds produce different terrain", () => {
    const a = generateMap(1);
    const b = generateMap(2);
    expect(Array.from(a.terrain.elevation)).not.toEqual(Array.from(b.terrain.elevation));
  });
});
