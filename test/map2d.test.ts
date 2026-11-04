import { describe, expect, test } from "bun:test";
import { bundleLines } from "../src/game/bundle";
import { OBSTACLE, Placer, type Box } from "../src/game/density";

// The 2D map's core and labels (2026-11-04, your map 5059: "start with the core and the labels"):
// lines that run together drawn side by side; labels with places to choose from, keeping off the
// towns' marks and, where they can, off the lines.

const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 });

describe("shared corridors side by side (bundle.ts)", () => {
  const a = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const b = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }];
  const cross = [{ x: 50, y: -50 }, { x: 50, y: 50 }];
  const out = bundleLines([{ id: "a", line: a, width: 7, rank: 0 }, { id: "b", line: b, width: 7, rank: 1 }, { id: "c", line: cross, width: 6, rank: 2 }], 5);

  test("two lines on one another come apart by their widths and the gap, mid-way", () => {
    const mid = (id: string) => { const l = out.get(id)!; return l[Math.floor(l.length / 2)]!; };
    const apart = Math.abs(mid("a").y - mid("b").y) * 5;
    expect(apart).toBeGreaterThan(7);
    expect(apart).toBeLessThan(10);
    // Each to its own side, by rank: the same every time.
    expect(Math.sign(mid("a").y)).not.toBe(Math.sign(mid("b").y));
  });

  test("they meet again at their ends (the town), and a line that only crosses is left alone", () => {
    for (const id of ["a", "b"]) {
      const l = out.get(id)!;
      expect(l[0]).toEqual({ x: 0, y: 0 });
      expect(l[l.length - 1]).toEqual({ x: 100, y: 0 });
    }
    expect(out.get("c")).toBe(cross);
  });
});

describe("labels with places to choose from (density.ts Placer)", () => {
  test("a label takes its next place where its first is taken, and says which", () => {
    const p = new Placer();
    p.claim({ id: "event", kind: "event", priority: 2, box: box(0, 0, 50, 20), at: { x: 0, y: 0 } });
    p.claim({ id: "name", kind: "townName", priority: 5, box: box(10, 5, 40, 15), boxes: [box(10, 5, 40, 15), box(10, 30, 40, 40)], at: { x: 0, y: 0 } });
    const { placed, slot } = p.resolve();
    expect(placed.has("name")).toBe(true);
    expect(slot.get("name")).toBe(1);
  });

  test("a town's mark is kept off by every label, whatever its priority", () => {
    const p = new Placer();
    p.claim({ id: "mark", kind: "obstacle", priority: OBSTACLE, box: box(0, 0, 20, 20), at: { x: 10, y: 10 } });
    p.claim({ id: "strike", kind: "event", priority: 2, box: box(5, 5, 60, 15), boxes: [box(5, 5, 60, 15), box(25, 5, 80, 15)], at: { x: 10, y: 10 } });
    const { slot } = p.resolve();
    expect(slot.get("strike")).toBe(1);
  });

  test("of its clear places, the one least over the lines", () => {
    const p = new Placer();
    p.claim({ id: "name", kind: "townName", priority: 5, box: box(0, 0, 10, 10), boxes: [box(0, 0, 10, 10), box(100, 0, 110, 10)], at: { x: 0, y: 0 } });
    // The lines run over the first place: ten cells of them.
    const { slot } = p.resolve([], (b) => (b.x0 < 50 ? 10 : 0));
    expect(slot.get("name")).toBe(1);
  });
});
