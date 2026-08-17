// Quick visual sanity check for map generation, since "look like places" is
// part of Module 2's done criteria and isn't something a numeric test can
// verify. Not part of the shipped app.
import { generateMap, MAP_WIDTH, MAP_HEIGHT } from "../src/engine/map/generate";
import type { GeneratedMap } from "../src/engine/map/types";

const ELEVATION_RAMP = " .:-=+*#%@";

function bresenham(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;

  while (true) {
    points.push([x, y]);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

function render(map: GeneratedMap): string {
  const grid: string[][] = [];
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    const row: string[] = [];
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const index = y * MAP_WIDTH + x;
      if (map.terrain.water[index] === 1) {
        row.push("~");
      } else {
        const e = map.terrain.elevation[index];
        const rampIndex = Math.min(ELEVATION_RAMP.length - 1, Math.floor(e * ELEVATION_RAMP.length));
        row.push(ELEVATION_RAMP[rampIndex]!);
      }
    }
    grid.push(row);
  }

  for (const corridor of map.corridors) {
    const infra = map.infrastructure.find((i) => i.corridorId === corridor.id);
    const marker = infra?.type === "rail" ? "=" : "-";
    for (const [x, y] of corridor.polyline.length === 2
      ? bresenham(corridor.polyline[0]!.x, corridor.polyline[0]!.y, corridor.polyline[1]!.x, corridor.polyline[1]!.y)
      : []) {
      if (x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT) {
        grid[y]![x] = marker;
      }
    }
  }

  for (const node of map.nodes) {
    const marker = node.kind === "settlement" ? "S" : node.kind === "village" ? "v" : "j";
    grid[node.y]![node.x] = marker;
  }

  return grid.map((row) => row.join("")).join("\n");
}

const seeds = process.argv.slice(2).map(Number);
const seedsToRender = seeds.length > 0 ? seeds : [1, 2, 3];

for (const seed of seedsToRender) {
  const map = generateMap(seed);
  const settlements = map.nodes.filter((n) => n.kind === "settlement").length;
  const villages = map.nodes.filter((n) => n.kind === "village").length;
  const rail = map.infrastructure.filter((i) => i.type === "rail").length;
  const road = map.infrastructure.filter((i) => i.type === "road").length;
  console.log(`\n=== seed ${seed} (${settlements} settlements, ${villages} villages, ${rail} rail, ${road} road) ===`);
  console.log(render(map));
}
