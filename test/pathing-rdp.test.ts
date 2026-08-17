import { describe, expect, test } from "bun:test";
import { simplifyPolyline, type Point } from "@engine/pathing/rdp";

describe("simplifyPolyline", () => {
  test("simplifies a straight line down to its two endpoints", () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ];
    expect(simplifyPolyline(line, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 4 },
    ]);
  });

  test("keeps a zigzag with a tiny epsilon but flattens it with a large one", () => {
    const zigzag: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 0 },
      { x: 3, y: 2 },
      { x: 4, y: 0 },
    ];

    expect(simplifyPolyline(zigzag, 0.01)).toEqual(zigzag);
    expect(simplifyPolyline(zigzag, 10)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  test("returns a copy, not the same array, for two points or fewer", () => {
    const single: Point[] = [{ x: 5, y: 5 }];
    const singleResult = simplifyPolyline(single, 1);
    expect(singleResult).toEqual(single);
    expect(singleResult).not.toBe(single);

    const pair: Point[] = [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
    ];
    const pairResult = simplifyPolyline(pair, 1);
    expect(pairResult).toEqual(pair);
    expect(pairResult).not.toBe(pair);
  });

  test("returns a copy, not the same array, when epsilon is non-positive", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 3 },
      { x: 2, y: 1 },
    ];

    const zeroEpsilon = simplifyPolyline(points, 0);
    expect(zeroEpsilon).toEqual(points);
    expect(zeroEpsilon).not.toBe(points);

    const negativeEpsilon = simplifyPolyline(points, -5);
    expect(negativeEpsilon).toEqual(points);
    expect(negativeEpsilon).not.toBe(points);
  });

  test("does not throw or produce NaN with duplicate consecutive points", () => {
    const duplicated: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 0 },
      { x: 4, y: 4 },
    ];

    let result: Point[] = [];
    expect(() => {
      result = simplifyPolyline(duplicated, 1);
    }).not.toThrow();

    expect(result.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});