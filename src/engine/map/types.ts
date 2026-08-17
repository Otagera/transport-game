// Node kinds (docs/rebuild-plan.md §5, "Nodes, chains, levels"): a fourth
// kind, `vertex`, exists for unlabeled bend points, but it's never placed by
// the generator -- only by the player or the water rule (Module 4/5). The
// generator only ever produces settlement, village, and junction nodes.
export type NodeKind = "settlement" | "village" | "junction";

export interface MapNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
}

// Terrain facts only: which nodes a corridor connects and the physical path
// between them. Hard rule (§4): Corridor and BuiltInfrastructure stay
// separate -- type, condition, and provenance describe the built layer, not
// the corridor itself.
export interface Corridor {
  id: string;
  nodeIds: [string, string];
  polyline: Array<{ x: number; y: number }>;
}

export type InfrastructureType = "road" | "rail";
export type InfrastructureProvenance = "inherited" | "built";

export interface BuiltInfrastructure {
  corridorId: string;
  type: InfrastructureType;
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
  infrastructure: BuiltInfrastructure[];
}
