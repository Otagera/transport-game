// One conversion used everywhere (texture, node/segment placement,
// raycasting) so the map stays self-consistent.
//
// Derivation, because this is exactly the kind of thing that's easy to get
// backwards: the ground mesh is a PlaneGeometry rotated -PI/2 around X to
// lie flat. That rotation sends local (x, y, 0) to world (x, 0, -y) --
// local Y flips sign into world Z, it does not carry through unchanged.
// The terrain texture is written with texture.flipY = false and canvas
// row `y` holding grid row `y` directly (no manual row-flip), so texture
// V and PlaneGeometry's local Y both increase with grid Y. Composing
// that with the rotation's sign flip gives worldZ = height/2 - y - 0.5
// (cell-centered) -- NOT height/2 + y. Getting this backwards produces a
// vertically mirrored click-to-grid mapping: clicks still land somewhere
// on the mesh, so nothing throws, but the resolved grid cell is wrong,
// which surfaces as authored corridors connecting to the wrong nodes
// entirely -- not a crash, a silently wrong result. Covered by
// test/grid-coords.test.ts specifically so this doesn't regress quietly.
export function gridToWorld(x: number, y: number, width: number, height: number): { x: number; z: number } {
  return { x: x - width / 2 + 0.5, z: height / 2 - y - 0.5 };
}

export function worldToGrid(worldX: number, worldZ: number, width: number, height: number): { x: number; y: number } {
  return { x: Math.floor(worldX + width / 2), y: Math.floor(height / 2 - worldZ) };
}
