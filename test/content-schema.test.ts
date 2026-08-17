import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EraListSchema, VehicleDefListSchema } from "@content/schema";

describe("content schema", () => {
  test("public/content/eras.json matches EraListSchema", () => {
    const path = join(import.meta.dir, "..", "public", "content", "eras.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    expect(() => EraListSchema.parse(data)).not.toThrow();
  });

  test("eras.json covers the four documented eras in order", () => {
    const path = join(import.meta.dir, "..", "public", "content", "eras.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    const eras = EraListSchema.parse(data);
    expect(eras.map((era) => era.id)).toEqual(["post-independence", "oil-boom", "informal", "modern"]);
    expect(eras.map((era) => era.order)).toEqual([0, 1, 2, 3]);
  });

  test("public/content/vehicles.json matches VehicleDefListSchema", () => {
    const path = join(import.meta.dir, "..", "public", "content", "vehicles.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    expect(() => VehicleDefListSchema.parse(data)).not.toThrow();
  });

  test("vehicles.json purchase costs strictly increase with capacity, and the BRT/danfo ratio holds", () => {
    const path = join(import.meta.dir, "..", "public", "content", "vehicles.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    const vehicles = VehicleDefListSchema.parse(data);
    const sortedByCapacity = [...vehicles].sort((a, b) => a.capacity - b.capacity);
    for (let i = 1; i < sortedByCapacity.length; i += 1) {
      expect(sortedByCapacity[i]!.purchaseCost).toBeGreaterThan(sortedByCapacity[i - 1]!.purchaseCost);
    }

    // docs/rebuild-plan.md §5: "1 BRT ≈ 8 danfos is a meaningful ratio."
    const brt = vehicles.find((v) => v.id === "brt")!;
    const danfo = vehicles.find((v) => v.id === "danfo")!;
    expect(brt.purchaseCost / danfo.purchaseCost).toBeCloseTo(8, 1);
  });

  test("exactly one vehicle def carries goods (the lorry)", () => {
    const path = join(import.meta.dir, "..", "public", "content", "vehicles.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    const vehicles = VehicleDefListSchema.parse(data);
    const goodsVehicles = vehicles.filter((v) => v.carries === "goods");
    expect(goodsVehicles.map((v) => v.id)).toEqual(["lorry"]);
  });
});
