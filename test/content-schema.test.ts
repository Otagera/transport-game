import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EraListSchema, ScenarioListSchema, VehicleDefListSchema } from "@content/schema";

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

  test("every vehicle's eraIn and eraOut (when set) reference a real era id", () => {
    const erasPath = join(import.meta.dir, "..", "public", "content", "eras.json");
    const vehiclesPath = join(import.meta.dir, "..", "public", "content", "vehicles.json");
    const eras = EraListSchema.parse(JSON.parse(readFileSync(erasPath, "utf8")));
    const vehicles = VehicleDefListSchema.parse(JSON.parse(readFileSync(vehiclesPath, "utf8")));
    const eraIds = new Set(eras.map((era) => era.id));

    for (const vehicle of vehicles) {
      expect(eraIds.has(vehicle.eraIn)).toBe(true);
      if (vehicle.eraOut !== null) {
        expect(eraIds.has(vehicle.eraOut)).toBe(true);
      }
    }
  });

  test("the catalog changes across every era transition, not just at the start", () => {
    // Module 8 "done when": each era feels different to operate in --
    // guard that against the catalog silently becoming static after the
    // first couple of eras.
    const erasPath = join(import.meta.dir, "..", "public", "content", "eras.json");
    const vehiclesPath = join(import.meta.dir, "..", "public", "content", "vehicles.json");
    const eras = EraListSchema.parse(JSON.parse(readFileSync(erasPath, "utf8")));
    const vehicles = VehicleDefListSchema.parse(JSON.parse(readFileSync(vehiclesPath, "utf8")));
    const orderOf = new Map(eras.map((era) => [era.id, era.order]));

    function availableAt(order: number): Set<string> {
      const ids = new Set<string>();
      for (const vehicle of vehicles) {
        const inOrder = orderOf.get(vehicle.eraIn)!;
        const outOrder = vehicle.eraOut === null ? Infinity : orderOf.get(vehicle.eraOut)!;
        if (inOrder <= order && order <= outOrder) ids.add(vehicle.id);
      }
      return ids;
    }

    for (let order = 1; order < eras.length; order += 1) {
      const previous = availableAt(order - 1);
      const current = availableAt(order);
      const changed = previous.size !== current.size || [...previous].some((id) => !current.has(id));
      expect(changed).toBe(true);
    }
  });

  // "An okada occupying the same road space as a bus is plainly wrong"
  // (docs/rebuild-plan.md §5). Module 7 modelled that, but until Module 11
  // no def supplied a weight, so every player vehicle used the default of
  // 1 and the model had nothing to bite on. This asserts the catalog
  // actually expresses the distinction rather than merely being allowed to.
  test("congestion weight rises with capacity across the catalog", () => {
    const vehiclesPath = join(import.meta.dir, "..", "public", "content", "vehicles.json");
    const vehicles = VehicleDefListSchema.parse(JSON.parse(readFileSync(vehiclesPath, "utf8")));
    const byCapacity = [...vehicles].sort((a, b) => a.capacity - b.capacity);

    for (let i = 1; i < byCapacity.length; i += 1) {
      expect(byCapacity[i]!.congestionWeight).toBeGreaterThanOrEqual(byCapacity[i - 1]!.congestionWeight);
    }
    expect(byCapacity.at(0)!.congestionWeight).toBeLessThan(byCapacity.at(-1)!.congestionWeight);
  });

  test("public/content/scenarios.json matches ScenarioListSchema", () => {
    const path = join(import.meta.dir, "..", "public", "content", "scenarios.json");
    const data = JSON.parse(readFileSync(path, "utf8"));
    expect(() => ScenarioListSchema.parse(data)).not.toThrow();
  });

  test("every scenario's startingEraId references a real era id", () => {
    const erasPath = join(import.meta.dir, "..", "public", "content", "eras.json");
    const scenariosPath = join(import.meta.dir, "..", "public", "content", "scenarios.json");
    const eras = EraListSchema.parse(JSON.parse(readFileSync(erasPath, "utf8")));
    const scenarios = ScenarioListSchema.parse(JSON.parse(readFileSync(scenariosPath, "utf8")));
    const eraIds = new Set(eras.map((era) => era.id));

    for (const scenario of scenarios) {
      expect(eraIds.has(scenario.startingEraId)).toBe(true);
    }
  });

  test("every scenario's seedFleet entries reference a real vehicle def id", () => {
    const vehiclesPath = join(import.meta.dir, "..", "public", "content", "vehicles.json");
    const scenariosPath = join(import.meta.dir, "..", "public", "content", "scenarios.json");
    const vehicles = VehicleDefListSchema.parse(JSON.parse(readFileSync(vehiclesPath, "utf8")));
    const scenarios = ScenarioListSchema.parse(JSON.parse(readFileSync(scenariosPath, "utf8")));
    const vehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));

    for (const scenario of scenarios) {
      for (const entry of scenario.seedFleet) {
        expect(vehicleIds.has(entry.defId)).toBe(true);
      }
    }
  });

  test("scenario ids are unique", () => {
    const path = join(import.meta.dir, "..", "public", "content", "scenarios.json");
    const scenarios = ScenarioListSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  });
});
