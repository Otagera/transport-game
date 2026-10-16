import type { SliceMapDef } from "@engine/slice/types";

// The slice's one hand-made map (docs/principles.md §6, step 1): no
// generator, no terrain. Nine towns, one dominant city, and an inherited
// road network that leaves three towns cut off -- so building a road has a
// visible job from the first minute.
//
// Kept as a TS constant rather than schema-validated JSON while the slice's
// shape is still moving; it graduates to public/content/ once the loop has
// survived a playtest (architecture hard rule 2).
export const SLICE_MAP: SliceMapDef = {
  width: 100,
  height: 64,
  towns: [
    { id: "ilase", name: "Ilase", x: 22, y: 40, population: 120 },
    { id: "owode", name: "Owode", x: 40, y: 22, population: 45 },
    { id: "ado", name: "Ado", x: 78, y: 20, population: 70 },
    { id: "ikole", name: "Ikole", x: 60, y: 44, population: 30 },
    { id: "kuto", name: "Kuto", x: 46, y: 57, population: 25 },
    { id: "ise", name: "Ise", x: 10, y: 56, population: 15 },
    { id: "ilaro", name: "Ilaro", x: 12, y: 12, population: 18 },
    { id: "ipaja", name: "Ipaja", x: 66, y: 6, population: 22 },
    { id: "ogbe", name: "Ogbe", x: 88, y: 50, population: 12 },
  ],
  roads: [
    { a: "ilase", b: "owode" },
    { a: "owode", b: "ado" },
    { a: "ilase", b: "ise" },
    { a: "ado", b: "ipaja" },
    { a: "ilase", b: "kuto" },
    { a: "ado", b: "ogbe" },
  ],
};
