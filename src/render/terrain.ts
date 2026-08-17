import * as THREE from "three";
import type { GeneratedMap } from "../engine/map/types";

// A rasterized canvas texture, not a displaced 3D heightmap mesh -- real
// elevation-driven geometry is visual-direction territory (docs/rebuild-
// plan.md §8 open question: "do settlements need visual richness"),
// explicitly still open. This is enough to see water and elevation while
// authoring, which is what Module 4 actually needs.
export function createTerrainTexture(map: GeneratedMap): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = map.terrain.width;
  canvas.height = map.terrain.height;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(canvas.width, canvas.height);

  for (let y = 0; y < map.terrain.height; y += 1) {
    for (let x = 0; x < map.terrain.width; x += 1) {
      const srcIndex = y * map.terrain.width + x;
      const dstIndex = srcIndex * 4;

      if (map.terrain.water[srcIndex] === 1) {
        image.data[dstIndex] = 30;
        image.data[dstIndex + 1] = 90;
        image.data[dstIndex + 2] = 140;
      } else {
        const e = map.terrain.elevation[srcIndex];
        const value = Math.round(60 + e * 120);
        image.data[dstIndex] = value;
        image.data[dstIndex + 1] = value + 10;
        image.data[dstIndex + 2] = value - 10;
      }
      image.data[dstIndex + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  return texture;
}
