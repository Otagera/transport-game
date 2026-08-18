import type { GridPoint } from "./terrainAStar";

// Supercover DDA: every grid cell a line segment passes through, including
// cells only clipped at a corner -- not endpoint or interval sampling,
// which misses corner clips (docs/principles.md §3). When the line
// crosses exactly through a lattice corner, both edge-adjacent cells are
// included, which is what distinguishes supercover from plain Bresenham
// (which would arbitrarily pick one).
export function walkCellsAlongSegment(x0: number, y0: number, x1: number, y1: number): GridPoint[] {
  const cells: GridPoint[] = [];
  let x = Math.floor(x0);
  let y = Math.floor(y0);
  const endX = Math.floor(x1);
  const endY = Math.floor(y1);
  const dx = x1 - x0;
  const dy = y1 - y0;

  cells.push({ x, y });
  if (x === endX && y === endY) {
    return cells;
  }

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;

  let tMaxX = dx !== 0 ? (stepX > 0 ? x + 1 - x0 : x0 - x) / Math.abs(dx) : Infinity;
  let tMaxY = dy !== 0 ? (stepY > 0 ? y + 1 - y0 : y0 - y) / Math.abs(dy) : Infinity;

  let guard = 0;
  const guardLimit = (Math.abs(endX - x) + Math.abs(endY - y) + 2) * 4;

  while ((x !== endX || y !== endY) && guard < guardLimit) {
    guard += 1;
    if (Math.abs(tMaxX - tMaxY) < 1e-9) {
      cells.push({ x: x + stepX, y });
      cells.push({ x, y: y + stepY });
      x += stepX;
      y += stepY;
      cells.push({ x, y });
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (tMaxX < tMaxY) {
      x += stepX;
      cells.push({ x, y });
      tMaxX += tDeltaX;
    } else {
      y += stepY;
      cells.push({ x, y });
      tMaxY += tDeltaY;
    }
  }

  return cells;
}
