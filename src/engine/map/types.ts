// Node kinds (docs/principles.md §3, "Nodes, chains, levels"): `vertex`
// is a fourth kind for unlabeled bend points -- a separate enum value, not
// a flag on `junction`, so every switch site is a compile error until
// handled. The generator (engine/map) never places vertices, only the
// player and the water rule do (engine/pathing, Module 4/5).
export type NodeKind = "settlement" | "village" | "junction" | "vertex";

export interface MapNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
}

// A corridor is a chain of nodes (docs/principles.md §3): terrain facts
// only -- which nodes it connects, in order, and the physical path between
// them. One geometry representation for the whole chain, including a
// straight two-node corridor (a two-point polyline). Segment stays
// separate: type, level, condition, and provenance describe the built
// layer per consecutive pair in the chain, not the corridor itself.
export interface Corridor {
  id: string;
  nodeIds: string[];
  polyline: Array<{ x: number; y: number }>;
}

export type InfrastructureType = "road" | "rail";
export type InfrastructureProvenance = "inherited" | "built";

// underground | ground | elevated. Only `ground` is producible before
// Module 5 (bridges); the field exists now so its later addition costs
// nothing rather than a refactor.
export type SegmentLevel = "underground" | "ground" | "elevated";

// Each segment between two consecutive nodes in a corridor's chain is
// independently typed, levelled, and maintained -- this is what makes
// curves, bridges, stations, and elevation fall out of one graph change
// rather than four separate features.
export interface Segment {
  id: string;
  corridorId: string;
  fromNodeId: string;
  toNodeId: string;
  type: InfrastructureType;
  level: SegmentLevel;
  condition: number;
  provenance: InfrastructureProvenance;
  // Travel length along the alignment, when it isn't the straight line
  // between the two nodes (the slice's terrain-planned roads bend round
  // hills and water). Undefined means straight -- the original game never
  // sets it, so its routing and vehicles are unchanged.
  length?: number;
  // Which authored cross-section this segment was built to (Module 11).
  // A plain string, never the content type: engine/ stays content-unaware
  // and treats this as an opaque key, exactly as it treats a vehicle def
  // id in economy/types.ts. Undefined means "whatever the bootstrap layer
  // considers the default for this infrastructure type" -- the generator
  // places inherited road and rail without knowing content exists.
  profileId?: string;
  // A road's surface, where the game models one (the slice: dirt until
  // paved). Undefined in the original game, which never sets it.
  surface?: "dirt" | "paved";
  // A lane only the player's vehicles use (the slice, Revision 1's bus
  // lane): on a paved road; copied to both halves when a town splits it.
  busLane?: boolean;
  // When the player retired it (the slice, Revision 2): no upkeep, no tolls,
  // decaying until it's gone. Undefined in the original game.
  retiredAt?: number;
}

export interface TerrainField {
  width: number;
  height: number;
  elevation: Float32Array;
  water: Uint8Array;
  settlementDensity: Float32Array;
}

export interface GeneratedMap {
  seed: number;
  terrain: TerrainField;
  nodes: MapNode[];
  corridors: Corridor[];
  segments: Segment[];
}
