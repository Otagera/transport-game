import { describe, expect, test } from "bun:test";
import { assertFullyConnected, UnionFind } from "@engine/map/connectivity";

describe("UnionFind", () => {
  test("unions merge components until one remains", () => {
    const unionFind = new UnionFind(["a", "b", "c", "d"]);
    expect(unionFind.componentCount()).toBe(4);

    unionFind.union("a", "b");
    expect(unionFind.connected("a", "b")).toBe(true);
    expect(unionFind.componentCount()).toBe(3);

    unionFind.union("c", "d");
    unionFind.union("b", "c");
    expect(unionFind.componentCount()).toBe(1);
    expect(unionFind.connected("a", "d")).toBe(true);
  });
});

describe("assertFullyConnected", () => {
  test("passes for a spanning set of edges", () => {
    expect(() =>
      assertFullyConnected(
        ["a", "b", "c"],
        [
          ["a", "b"],
          ["b", "c"],
        ],
      ),
    ).not.toThrow();
  });

  test("throws for a disconnected node", () => {
    expect(() => assertFullyConnected(["a", "b", "c"], [["a", "b"]])).toThrow();
  });
});
