import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EraListSchema } from "@content/schema";

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
});
