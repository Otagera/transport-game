import { describe, expect, test } from "bun:test";
import { vehiclesUsingSegments } from "@engine/simulation/dependents";
import type { RoutingContext, Vehicle } from "@engine/simulation/types";

// a -- s1 -- b -- s2 -- c, plus the closing edge c -- s3 -- a so a cyclic
// vehicle's loop is a real loop.
function routing(): RoutingContext {
  return {
    graph: new Map([
      ["a", [{ to: "b", segmentId: "s1", weight: 1 }, { to: "c", segmentId: "s3", weight: 1 }]],
      ["b", [{ to: "a", segmentId: "s1", weight: 1 }, { to: "c", segmentId: "s2", weight: 1 }]],
      ["c", [{ to: "b", segmentId: "s2", weight: 1 }, { to: "a", segmentId: "s3", weight: 1 }]],
    ]),
    positions: new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 1, y: 0 }],
      ["c", { x: 2, y: 0 }],
    ]),
  };
}

function vehicle(id: string, path: string[], lifecycle: Vehicle["lifecycle"] = "cyclic"): Vehicle {
  return {
    id,
    path,
    pathIndex: 1,
    edgeProgress: 0,
    speed: 1,
    capacity: 10,
    cargo: [],
    carries: "passengers",
    congestionWeight: 1,
    lifecycle,
  };
}

describe("vehiclesUsingSegments", () => {
  test("finds a vehicle whose route crosses a doomed segment, not just the edge it's on right now", () => {
    // The vehicle sits on s1 (pathIndex 1) but will reach s2 later.
    const blocked = vehiclesUsingSegments([vehicle("v1", ["a", "b", "c"])], routing(), new Set(["s2"]));
    expect(blocked).toEqual(["v1"]);
  });

  test("a cyclic vehicle's wrap-around edge counts -- it comes back around to it", () => {
    const blocked = vehiclesUsingSegments([vehicle("v1", ["a", "b", "c"])], routing(), new Set(["s3"]));
    expect(blocked).toEqual(["v1"]);
  });

  test("a one-shot vehicle's path is not a closed loop, so the wrap-around edge does not count", () => {
    const blocked = vehiclesUsingSegments([vehicle("p1", ["a", "b", "c"], "one-shot")], routing(), new Set(["s3"]));
    expect(blocked).toEqual([]);
  });

  test("reports nothing when the doomed set is empty", () => {
    expect(vehiclesUsingSegments([vehicle("v1", ["a", "b", "c"])], routing(), new Set())).toEqual([]);
  });

  test("leaves unrelated vehicles alone", () => {
    const blocked = vehiclesUsingSegments(
      [vehicle("v1", ["a", "b"]), vehicle("v2", ["b", "c"])],
      routing(),
      new Set(["s2"]),
    );
    expect(blocked).toEqual(["v2"]);
  });
});
