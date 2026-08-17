// Node kinds (docs/rebuild-plan.md §5, "Nodes, chains, levels"): `vertex`
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

// A corridor is a chain of nodes (docs/rebuild-plan.md §5): terrain facts
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
