import type { GameMapDef } from "@engine/game/types";

// The slice's one hand-made map (docs/principles.md §6, step 1): no
// generator; since step 3, authored terrain. Nine towns, one dominant city, and an inherited
// road network that leaves three towns cut off -- so building a road has a
// visible job from the first minute.
//
// Kept as a TS constant rather than schema-validated JSON while the slice's
// shape is still moving; it graduates to public/content/ once the loop has
// survived a playtest (architecture hard rule 2).
export const GAME_MAP: GameMapDef = {
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
  // Step 4, goods: Ilase is the port -- supplies leave from here.
  port: "ilase",
  // Step 4, rail: the colonial export line, port to the northern hinterland.
  // It crosses the river on its own old bridge and runs four cells past
  // Owode without stopping -- built for cargo, not for the trips people make
  // now (principles §1, brownfield: its geometry is wrong, and stays wrong).
  // Out of service until restored.
  rails: [{ a: "ilase", b: "ipaja" }],
  // Step 3: a river and a ridge, placed so a road is a decision.
  //   - The river splits the west (Ilase, Owode, Kuto, Ise, Ilaro) from the
  //     east (Ado, Ipaja, Ikole, Ogbe). Only the old Owode-Ado road crosses
  //     it. Cut-off Ikole sits east of it: cheap from Ado (Ilase's riders go
  //     the long way round) or across a bridge from Kuto or Ilase.
  //   - The ridge sits between cut-off Ilaro and Owode: the cheapest road
  //     bends round it (a longer trip), the direct one pays for the climb.
  terrain: {
    rivers: [{ points: [[55, -2], [53, 10], [56, 22], [52, 34], [54, 46], [50, 56], [53, 66]], width: 3 }],
    hills: [
      { x: 21, y: 14, radius: 8, height: 3 },
      { x: 29, y: 18, radius: 7, height: 2.5 },
    ],
  },
};
