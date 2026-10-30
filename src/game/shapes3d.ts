// Procedural low-poly shapes for the 3D view (view3d.ts; decisions log 2026-10-25: assets
// procedural, in one low-poly style). Nigerian buildings -- zinc-roofed bungalows and compound
// walls, shophouses with awnings, concrete blocks with tanks on the roof, a mosque, a church,
// market stalls under umbrellas, round huts -- and the vehicles the free packs lack: the danfo
// with its stripe and roof rack, the keke, the okada and its rider, a lorry, a tanker. Each a
// recipe of boxes, prisms and cylinders with flat colours, seeded, so a town is always itself
// and no two are the same. A whole town merges into one geometry: one draw call a town.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type Rand = () => number;
export function seeded(text: string): Rand {
  let s = [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
const pick = <T,>(rand: Rand, list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;

/** Collects coloured pieces, then merges them into one geometry with vertex colours. */
export class Kit {
  private parts: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, colour: string | number, at: { x?: number; y?: number; z?: number; ry?: number; rx?: number; rz?: number } = {}): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const c = new THREE.Color(colour);
    const n = g.attributes.position!.count;
    const colours = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) colours.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(colours, 3));
    g.deleteAttribute("uv");
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(at.x ?? 0, at.y ?? 0, at.z ?? 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(at.rx ?? 0, at.ry ?? 0, at.rz ?? 0)),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m);
    this.parts.push(g);
  }
  /** A piece already coloured (another kit's merged()), moved into place. */
  place(geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0): void {
    this.parts.push(geo.clone().rotateY(ry).translate(x, y, z));
  }
  /** A box standing on y = 0 at its centre (x, z), w along x, d along z. */
  box(w: number, h: number, d: number, colour: string | number, x = 0, z = 0, y = 0, ry = 0): void {
    this.add(new THREE.BoxGeometry(w, h, d), colour, { x, y: y + h / 2, z, ry });
  }
  cylinder(r: number, h: number, colour: string | number, x = 0, z = 0, y = 0, segments = 10): void {
    this.add(new THREE.CylinderGeometry(r, r, h, segments), colour, { x, y: y + h / 2, z });
  }
  cone(r: number, h: number, colour: string | number, x = 0, z = 0, y = 0, segments = 4, ry = Math.PI / 4): void {
    this.add(new THREE.ConeGeometry(r, h, segments), colour, { x, y: y + h / 2, z, ry });
  }
  /** A gable roof: a triangular prism along x, its ridge h above y. */
  gable(w: number, d: number, h: number, colour: string | number, x = 0, z = 0, y = 0, ry = 0): void {
    const shape = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    geo.translate(0, 0, -w / 2);
    geo.rotateY(Math.PI / 2);
    this.add(geo, colour, { x, y, z, ry });
  }
  dome(r: number, colour: string | number, x = 0, z = 0, y = 0): void {
    this.add(new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), colour, { x, y, z });
  }
  get empty(): boolean {
    return this.parts.length === 0;
  }
  merged(): THREE.BufferGeometry {
    const geo = this.parts.length ? mergeGeometries(this.parts, false)! : new THREE.BufferGeometry();
    geo.computeVertexNormals();
    return geo;
  }
}

// --- Buildings -----------------------------------------------------------------------------

export const WALLS = ["#efe3c8", "#e2c79a", "#d9a066", "#9cc5d6", "#b9d3a5", "#f2efe6", "#e8b8a0", "#c98d6a"];
export const ROOFS = ["#a7aeb3", "#9aa3a9", "#8c5a3c", "#a0603e", "#6f8fa8", "#b4b9bc"];
export const CONCRETE = ["#cfc8bb", "#d9d3c7", "#bfb8aa", "#e0d8c8"];
/** A town's blocks at its heart (view3d.ts townKit): plastered concrete, paler than the houses. */
export const BLOCK_WALLS = ["#e6dfd2", "#d8d0c2", "#efe9dd", "#cfd6d8", "#e3d3bd"];
/** A block's window bands. */
export const WINDOWS = "#5b6872";

/** A bungalow in its compound: plastered walls, a zinc hip roof, a wall round the yard. */
export function bungalow(kit: Kit, rand: Rand, x: number, z: number, ry: number): void {
  const w = 7 + rand() * 4, d = 6 + rand() * 3, h = 3;
  kit.box(w, h, d, pick(rand, WALLS), x, z, 0, ry);
  kit.cone(Math.hypot(w, d) / 2 + 0.4, 2, pick(rand, ROOFS), x, z, h, 4, ry + Math.PI / 4);
  if (rand() < 0.6) {
    // The compound wall: four low runs round the house, a gap for the gate.
    const cw = w + 6, cd = d + 6, wall = "#d8cbb0";
    const cos = Math.cos(ry), sin = Math.sin(ry);
    const at = (u: number, v: number) => ({ x: x + u * cos + v * sin, z: z - u * sin + v * cos });
    for (const [u, v, len, along] of [[0, -cd / 2, cw, true], [0, cd / 2, cw * 0.6, true], [-cw / 2, 0, cd, false], [cw / 2, 0, cd, false]] as const) {
      const p = at(u, v);
      kit.box(along ? len : 0.3, 1.6, along ? 0.3 : len, wall, p.x, p.z, 0, ry);
    }
  }
}

/** A shophouse: a shop below with its awning, rooms above. */
export function shophouse(kit: Kit, rand: Rand, x: number, z: number, ry: number): void {
  const w = 8 + rand() * 3, d = 7, floors = 2 + (rand() < 0.3 ? 1 : 0), h = floors * 3;
  kit.box(w, h, d, pick(rand, WALLS), x, z, 0, ry);
  kit.box(w + 0.4, 0.3, d + 0.4, pick(rand, CONCRETE), x, z, h, ry);
  const awning = pick(rand, ["#c0392b", "#2a78d6", "#2b8a3e", "#e0a400", "#8e44ad"]);
  const cos = Math.cos(ry), sin = Math.sin(ry);
  kit.add(new THREE.BoxGeometry(w, 0.2, 2), awning, { x: x + (d / 2 + 1) * sin, y: 2.8, z: z + (d / 2 + 1) * cos, ry, rx: 0.25 });
}

/** A concrete block of flats: balconies as bands, a water tank on the roof. */
export function block(kit: Kit, rand: Rand, x: number, z: number, ry: number, floorsMin: number, floorsMax: number): void {
  const floors = floorsMin + Math.floor(rand() * (floorsMax - floorsMin + 1));
  const w = 12 + rand() * 6, d = 10 + rand() * 4, h = floors * 3;
  const wall = pick(rand, CONCRETE);
  kit.box(w, h, d, wall, x, z, 0, ry);
  for (let f = 1; f < floors; f += 1) kit.box(w + 0.6, 0.25, d + 0.6, "#a59d90", x, z, f * 3, ry);
  kit.cylinder(1.2, 1.8, "#3d6fa8", x + w * 0.2, z, h, 8);
  kit.cylinder(1.1, 1.6, "#2b2b2b", x - w * 0.2, z + d * 0.15, h, 8);
}

/** A mosque: a hall, a green dome, a minaret. */
export function mosque(kit: Kit, rand: Rand, x: number, z: number, scale = 1): void {
  const s = scale;
  kit.box(14 * s, 5 * s, 14 * s, "#f2efe6", x, z);
  kit.dome(5 * s, "#2b8a3e", x, z, 5 * s);
  kit.cylinder(1.1 * s, 16 * s, "#f2efe6", x + 8 * s, z + 8 * s, 0, 8);
  kit.cone(1.4 * s, 3 * s, "#2b8a3e", x + 8 * s, z + 8 * s, 16 * s, 8, 0);
  if (rand() < 0.5) kit.dome(1.6 * s, "#d9b44a", x, z, 9.8 * s);
}

/** A church: a long nave under a gable, a bell tower at its end. */
export function church(kit: Kit, rand: Rand, x: number, z: number, scale = 1): void {
  const s = scale;
  const wall = pick(rand, ["#f2efe6", "#e2c79a", "#d8d2c4"]);
  kit.box(16 * s, 6 * s, 9 * s, wall, x, z);
  kit.gable(16 * s, 9 * s, 4 * s, "#8c5a3c", x, z, 6 * s);
  kit.box(4 * s, 14 * s, 4 * s, wall, x + 10 * s, z);
  kit.cone(3 * s, 4 * s, "#8c5a3c", x + 10 * s, z, 14 * s);
}

/** Market stalls under umbrellas, a few in a row. */
export function market(kit: Kit, rand: Rand, x: number, z: number, stalls: number): void {
  for (let i = 0; i < stalls; i += 1) {
    // At life size (a 3 m umbrella over a 2.4 m table): at 2.2 m a radius they stood as wide as the trees.
    const sx = x + (i % 4) * 3.6 - 5.4, sz = z + Math.floor(i / 4) * 3.8 - 1.9;
    kit.box(2.4, 0.9, 1.6, "#8a6a45", sx, sz);
    kit.cylinder(0.07, 2.3, "#5a5f66", sx, sz, 0, 4);
    kit.cone(1.5, 0.6, pick(rand, ["#c0392b", "#e0a400", "#2a78d6", "#2b8a3e", "#e67e22", "#ffffff"]), sx, sz, 2.15, 8, 0);
  }
}

/** A round hut: mud wall, thatch cone. */
export function hut(kit: Kit, rand: Rand, x: number, z: number): void {
  const r = 2.2 + rand() * 0.8;
  kit.cylinder(r, 2.4, "#b98a5e", x, z, 0, 10);
  kit.cone(r + 0.7, 2.4, "#c9a45c", x, z, 2.4, 10, 0);
}

/** An industrial site: a refinery's tanks and columns, a quarry's pit and heaps, a works' sheds and stack. */
export function site(kit: Kit, rand: Rand, kind: string): void {
  if (kind === "refinery" || kind === "newrefinery" || kind === "terminal" || kind === "depot" || kind === "oilfield") {
    const tanks = kind === "oilfield" ? 0 : kind === "depot" ? 3 : 6;
    for (let i = 0; i < tanks; i += 1) kit.cylinder(4.5, 5, "#e8e4dc", -12 + (i % 3) * 11, -6 + Math.floor(i / 3) * 12, 0, 14);
    if (kind.includes("refinery")) {
      kit.cylinder(1.4, 22, "#b4b9bc", 16, -4, 0, 8);
      kit.cylinder(1.1, 16, "#b4b9bc", 20, 4, 0, 8);
      kit.box(10, 6, 8, "#8c9399", 18, 14);
    }
    if (kind === "oilfield") for (let i = 0; i < 4; i += 1) {
      kit.box(1, 4, 1, "#3a3f45", -10 + i * 7, (i % 2) * 8);
      kit.box(5, 0.6, 0.6, "#c0392b", -10 + i * 7, (i % 2) * 8, 4);
    }
    return;
  }
  // A station on the old line (stations.ts): a long low building, its platform and canopy, a water tower.
  if (kind === "station") {
    kit.box(16, 4, 6, "#d9c9a8", 0, -6);
    kit.box(17, 0.5, 7, "#8a3b2a", 0, -6, 4);
    kit.box(24, 0.8, 4, "#bdb6a8", 0, 1);
    kit.box(14, 0.3, 4.4, "#5a5f66", 0, 1, 3.6);
    for (const x of [-5, 0, 5]) kit.box(0.4, 3, 0.4, "#5a5f66", x, 2.6, 0.8);
    kit.cylinder(1.6, 3, "#6f6a60", 13, -8, 5);
    kit.cylinder(0.3, 5, "#5a5f66", 13, -8);
    return;
  }
  // A border crossing (border.ts): the customs post, its barrier across the road, lorries waiting, flags.
  if (kind === "border" || kind === "gateway") {
    kit.box(14, 4, 7, "#e2ddd2", 0, -8);
    kit.box(15, 0.4, 8, "#2b8a3e", 0, -8, 4);
    kit.box(3, 2.6, 3, "#cfc8bb", -6, 2);
    kit.box(10, 0.5, 0.5, "#c0392b", 0, 2, 1.6);
    for (const [x, colour] of [[6, "#2b8a3e"], [8.5, "#e8e4dc"]] as const) {
      kit.cylinder(0.12, 7, "#5a5f66", x, -12, 0, 4);
      kit.box(1.6, 1, 0.1, colour, x + 0.8, -12, 6);
    }
    for (let i = 0; i < 3; i += 1) kit.box(7, 3, 2.4, i % 2 ? "#a0603e" : "#6f8fa8", -14 + i * 9, 10);
    return;
  }
  if (kind === "quarry" || kind === "ironmine") {
    const heap = kind === "quarry" ? "#d8d2c4" : "#8a4b3a";
    for (let i = 0; i < 4; i += 1) kit.cone(4 + rand() * 3, 4 + rand() * 3, heap, -10 + i * 7, (rand() - 0.5) * 12, 0, 7, rand());
    kit.box(8, 3, 5, "#e0a400", 12, 6);
    kit.box(1, 10, 1, "#5a5f66", 16, -6);
    return;
  }
  // A works, mill or silo: long sheds, a stack or the silos' cylinders.
  kit.box(22, 7, 12, "#cfc8bb", 0, 0);
  kit.gable(22, 12, 3, "#8c9399", 0, 0, 7);
  if (kind === "silo" || kind === "mill" || kind === "flourmill") for (let i = 0; i < 3; i += 1) kit.cylinder(3, 14, "#e8e4dc", -8 + i * 7, 12, 0, 12);
  else kit.cylinder(1.6, 24, "#a59d90", 14, 8, 0, 10);
  if (kind === "steelworks" || kind === "steelport") kit.box(14, 10, 10, "#6a6f75", -16, 10);
}

// --- Vehicles: each facing +x, standing on y = 0, a little larger than life ---------------

export type VehicleKind3D = "bus" | "brt" | "minibus" | "danfo" | "keke" | "okada" | "truck" | "tanker" | "train" | "freight";
const TYRE = "#2b2b2b", GLASS = "#9fd0e6";
function wheels(kit: Kit, len: number, wid: number, r = 0.45, axles = 2): void {
  for (let a = 0; a < axles; a += 1) {
    const x = axles === 1 ? 0 : -len / 2 + 0.9 + (a * (len - 1.8)) / (axles - 1);
    for (const z of [-wid / 2, wid / 2]) kit.add(new THREE.CylinderGeometry(r, r, 0.3, 8), TYRE, { x, y: r, z, rx: Math.PI / 2 });
  }
}
export function vehicleGeometry(kind: VehicleKind3D): THREE.BufferGeometry {
  const kit = new Kit();
  const glassBand = (len: number, wid: number, y: number, h: number) => kit.box(len * 0.9, h, wid + 0.06, GLASS, 0, 0, y);
  switch (kind) {
    case "bus":
    case "brt": {
      // White: each is tinted by its route's colour, or its kind's (view3d.ts placeVehicles).
      const body = "#ffffff";
      const len = kind === "bus" ? 12 : 9;
      const halves = kind === "bus" ? [0] : [-4.8, 4.8];
      for (const off of halves) {
        const k2 = new Kit();
        k2.box(len, 2.6, 2.5, body, 0, 0, 0.5);
        k2.box(len * 0.9, 0.9, 2.56, GLASS, 0, 0, 1.6);
        k2.box(0.2, 1.2, 2.2, GLASS, len / 2, 0, 1.3);
        wheels(k2, len, 2.5);
        kit.place(k2.merged(), off, 0, 0); // its own colours kept: windows, tyres
      }
      if (kind === "brt") kit.box(0.8, 2.3, 2.2, "#4a4f55", 0, 0, 0.6);
      break;
    }
    case "minibus":
    case "danfo": {
      const body = kind === "minibus" ? "#ffffff" : "#e8b400";
      kit.box(5.5, 2, 2.2, body, 0, 0, 0.45);
      glassBand(5.5, 2.2, 1.45, 0.7);
      if (kind === "danfo") {
        kit.box(5.52, 0.3, 2.24, "#1e1e1e", 0, 0, 0.9);
        kit.box(3.6, 0.15, 1.9, "#3a3a3a", -0.4, 0, 2.5);
        kit.box(1.2, 0.6, 1, "#7a5a3a", -1, 0.3, 2.65);
        kit.box(0.9, 0.5, 0.8, "#2a6f97", 0.4, -0.35, 2.65);
      }
      wheels(kit, 5.5, 2.2, 0.4);
      break;
    }
    case "keke": {
      kit.box(2.4, 1.1, 1.3, "#e8b400", 0, 0, 0.35);
      kit.box(0.7, 0.9, 0.9, "#2b8a3e", 1.3, 0, 0.35);
      for (const [px, pz] of [[-1, -0.6], [-1, 0.6], [0.9, -0.6], [0.9, 0.6]] as const) kit.cylinder(0.05, 1.2, "#3a3a3a", px, pz, 1.45, 4);
      kit.box(2.4, 0.12, 1.5, "#2b8a3e", 0, 0, 2.6);
      kit.add(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 8), TYRE, { x: 1.3, y: 0.35, rx: Math.PI / 2 });
      for (const z of [-0.6, 0.6]) kit.add(new THREE.CylinderGeometry(0.35, 0.35, 0.2, 8), TYRE, { x: -0.9, y: 0.35, z, rx: Math.PI / 2 });
      break;
    }
    case "okada": {
      kit.box(1.8, 0.35, 0.35, "#3a3f45", 0, 0, 0.55);
      for (const x of [-0.75, 0.75]) kit.add(new THREE.CylinderGeometry(0.35, 0.35, 0.12, 8), TYRE, { x, y: 0.35, rx: Math.PI / 2 });
      kit.box(0.45, 0.8, 0.5, "#c56b3f", -0.15, 0, 0.95);
      kit.add(new THREE.SphereGeometry(0.22, 8, 6), "#3a2a20", { x: -0.1, y: 2, z: 0 });
      kit.box(0.4, 0.6, 0.45, "#2a78d6", -0.55, 0, 0.9);
      break;
    }
    case "truck":
    case "tanker": {
      kit.box(2.2, 2.4, 2.4, "#e8e1d4", 3.2, 0, 0.5);
      kit.box(0.15, 1, 2, GLASS, 4.3, 0, 1.6);
      if (kind === "truck") kit.box(6, 2.8, 2.5, "#8a5a2b", -1.2, 0, 0.6);
      else kit.add(new THREE.CylinderGeometry(1.15, 1.15, 6, 12), "#d9822b", { x: -1.2, y: 1.85, rz: Math.PI / 2 });
      wheels(kit, 8.5, 2.4, 0.5, 3);
      break;
    }
    case "train":
    case "freight": {
      const body = kind === "train" ? "#ffffff" : "#8a5a2b";
      kit.box(18, 3.2, 3, body, 0, 0, 0.8);
      if (kind === "train") kit.box(16.5, 1, 3.06, GLASS, 0, 0, 2.1);
      else for (let i = 0; i < 4; i += 1) kit.box(0.2, 3.3, 3.05, "#5a3a1d", -6.75 + i * 4.5, 0, 0.75);
      kit.box(18, 0.5, 2.6, "#3a3a3a", 0, 0, 0.3);
      break;
    }
  }
  return kit.merged();
}

// --- Trees: the savanna's, standing on y = 0, about life size ------------------------------

export type TreeKind = "acacia" | "shade" | "palm" | "bush";
/** A tree's shape; each kind one InstancedMesh, scaled and turned per tree. */
export function treeGeometry(kind: TreeKind): THREE.BufferGeometry {
  const kit = new Kit();
  const bark = "#6b4f36";
  switch (kind) {
    case "acacia": {
      // The savanna's flat-topped tree: a forked trunk, a wide thin crown.
      kit.add(new THREE.CylinderGeometry(0.25, 0.35, 4.5, 5), bark, { y: 2.25, rz: 0.12 });
      kit.add(new THREE.CylinderGeometry(3.2, 2.6, 1.1, 7), "#6f8a3c", { y: 4.9 });
      kit.add(new THREE.CylinderGeometry(2.2, 2.6, 0.7, 7), "#7f9a46", { x: 0.6, y: 5.6, z: -0.3 });
      break;
    }
    case "shade": {
      // A mango or shea: a short trunk under a round, dark crown.
      kit.add(new THREE.CylinderGeometry(0.35, 0.45, 3, 5), bark, { y: 1.5 });
      kit.add(new THREE.IcosahedronGeometry(3, 0), "#4f7a34", { y: 4.6 });
      kit.add(new THREE.IcosahedronGeometry(2.2, 0), "#5c8a3c", { x: 1.6, y: 4, z: 0.8 });
      break;
    }
    case "palm": {
      // An oil palm: a tall bending trunk, a burst of fronds.
      kit.add(new THREE.CylinderGeometry(0.22, 0.32, 8, 5), "#7a6448", { y: 4, rz: 0.08 });
      for (let k = 0; k < 7; k += 1) {
        const a = (k / 7) * Math.PI * 2;
        kit.add(new THREE.BoxGeometry(3.4, 0.08, 0.7), k % 2 ? "#4f8a3a" : "#5e9a42", { x: Math.cos(a) * 1.5 + 0.6, y: 8, z: Math.sin(a) * 1.5, ry: -a, rz: -0.35 });
      }
      break;
    }
    case "bush": {
      kit.add(new THREE.IcosahedronGeometry(1.3, 0), "#6e8b45", { y: 0.9 });
      kit.add(new THREE.IcosahedronGeometry(1, 0), "#7d9a4e", { x: 1, y: 0.7, z: 0.4 });
      break;
    }
  }
  return kit.merged();
}

// --- Roadside life: kiosks and a filling station ------------------------------------------

/** A roadside kiosk: a small shop with its bright awning, facing the road (+z). */
export function kiosk(kit: Kit, rand: Rand, x: number, z: number, ry: number): void {
  const k = new Kit();
  k.box(3, 2.4, 2.4, pick(rand, WALLS));
  k.add(new THREE.BoxGeometry(3.4, 0.12, 1.6), pick(rand, ["#c0392b", "#2a78d6", "#2b8a3e", "#e0a400", "#8e44ad", "#e67e22"]), { y: 2.3, z: 1.7, rx: 0.3 });
  if (rand() < 0.5) k.box(1.2, 0.8, 0.8, "#8a6a45", 1.8, 2);
  kit.place(k.merged(), x, 0, z, ry);
}
/** A roadside fuel seller (a town short of fuel): a bench, jerrycans lined up beside it, a funnel, a shade. */
export function fuelSeller(kit: Kit, rand: Rand, x: number, z: number, ry: number): void {
  const k = new Kit();
  k.box(1.8, 0.7, 0.8, "#8a6a45");
  const cans = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < cans; i += 1) k.box(0.45, 0.65, 0.3, pick(rand, ["#e0a400", "#e0a400", "#2b8a3e", "#c0392b"]), -1.4 + i * 0.55, 1, 0);
  k.cone(0.2, 0.3, "#5a5f66", 0.4, 0, 0.75, 6, 0);
  if (rand() < 0.6) {
    k.cylinder(0.05, 2.2, "#5a5f66", -0.4, 0, 0, 4);
    k.cone(1.4, 0.5, pick(rand, ["#c0392b", "#2a78d6", "#e67e22", "#ffffff"]), -0.4, 0, 2.1, 8, 0);
  }
  kit.place(k.merged(), x, 0, z, ry);
}
/** A filling station: a canopy on posts over two pumps, its shop behind, its sign by the road. */
export function fillingStation(kit: Kit, rand: Rand, x: number, z: number, ry: number): void {
  const k = new Kit();
  const brand = pick(rand, ["#c0392b", "#2b8a3e", "#e0a400", "#1c7ed6"]);
  for (const [px, pz] of [[-5, -3], [5, -3], [-5, 3], [5, 3]] as const) k.box(0.4, 4.5, 0.4, "#d9d3c7", px, pz);
  // The canopy's roof above its coloured fascia: their faces never level with each other (they
  // shared a top and flickered: "those green roofs, they are like glitching").
  k.box(12, 0.35, 8, "#f2efe6", 0, 0, 4.85);
  k.box(12.3, 0.45, 8.3, brand, 0, 0, 4.4);
  for (const px of [-2.5, 2.5]) k.box(0.8, 1.6, 0.6, brand, px, 0);
  k.box(8, 3.2, 5, "#e2ddd2", 0, -8);
  k.box(0.3, 6, 0.3, "#5a5f66", 7.5, 5);
  k.box(1.8, 1.4, 0.3, brand, 7.5, 5, 6);
  kit.place(k.merged(), x, 0, z, ry);
}

// --- What you build at a town: each centred on (0, 0), its front toward +z, placed by view3d.ts ---

/** A motor park: a paved lot, danfos in rows, the union's shelter and its sign. */
export function motorPark(kit: Kit, rand: Rand, ry: number): void {
  const k = new Kit();
  k.box(30, 0.3, 20, "#8e9093");
  for (let row = 0; row < 2; row += 1) for (let i = 0; i < 6; i += 1) {
    k.box(2.2, 2, 4.8, rand() < 0.85 ? "#e8b400" : "#f2efe6", -11 + i * 4.4, -4 + row * 9, 0.3);
    k.box(2.24, 0.25, 4.84, "#1e1e1e", -11 + i * 4.4, -4 + row * 9, 1.1);
  }
  k.box(12, 0.3, 4, "#2b8a3e", 0, 8.5, 3.6);
  for (const px of [-5.5, 5.5]) k.box(0.3, 3.6, 0.3, "#5a5f66", px, 8.5);
  k.box(0.3, 5, 0.3, "#5a5f66", 14, 9);
  k.box(3, 1.4, 0.2, "#2b8a3e", 14, 9, 5);
  kit.place(k.merged(), 0, 0, 0, ry);
}
/** A haulage yard: a fenced gravel lot, lorries, stacked goods, a gantry. */
export function haulageYard(kit: Kit, rand: Rand, ry: number): void {
  const k = new Kit();
  k.box(34, 0.25, 24, "#b3a58c");
  for (const [w, d, x, z] of [[34, 0.3, 0, -12], [34, 0.3, 0, 12], [0.3, 24, -17, 0], [0.3, 24, 17, 0]] as const) k.box(w, 1.8, d, "#7a7f85", x, z);
  for (let i = 0; i < 4; i += 1) {
    k.box(2.6, 2.6, 7, "#8a5a2b", -12 + i * 5, -5, 0.25);
    k.box(2.4, 2.4, 2.2, "#e8e1d4", -12 + i * 5, -0.3, 0.25);
  }
  for (let i = 0; i < 6; i += 1) k.box(3, 1.2 + rand() * 1.6, 3, pick(rand, ["#c9a36b", "#8a6a45", "#6f8fa8", "#b4b9bc"]), 6 + (i % 3) * 3.6, 5 + Math.floor(i / 3) * 3.6, 0.25);
  for (const px of [3, 15]) k.box(0.6, 8, 0.6, "#e0a400", px, 0);
  k.box(13, 0.8, 0.8, "#e0a400", 9, 0, 8);
  kit.place(k.merged(), 0, 0, 0, ry);
}
/** A rail station: a platform along the track (+x), its house with a red roof. */
export function railStation(kit: Kit, rand: Rand, ry: number): void {
  const k = new Kit();
  k.box(40, 1, 4, "#cfc8bb");
  k.box(12, 4, 6, pick(rand, ["#efe3c8", "#e2c79a", "#f2efe6"]), 0, 5.5);
  k.gable(12.6, 6.6, 2.4, "#a0392b", 0, 5.5, 4);
  k.box(16, 0.25, 3, "#a0392b", -14, 0, 3.6);
  for (const px of [-21, -7]) k.box(0.25, 2.6, 0.25, "#5a5f66", px, 1, 1);
  kit.place(k.merged(), 0, 0, 0, ry);
}
/** A metro entrance: a glazed pavilion over the stairs, its blue M. */
export function metroEntrance(kit: Kit, ry: number): void {
  const k = new Kit();
  k.box(8, 0.3, 6, "#cfc8bb");
  k.box(7, 3, 4.5, "#9fd0e6", 0, 0, 0.3);
  k.box(7.6, 0.4, 5, "#1c5aa6", 0, 0, 3.3);
  k.box(0.3, 5, 0.3, "#5a5f66", 4.5, 2.5);
  k.box(1.8, 1.8, 0.3, "#1c5aa6", 4.5, 2.5, 5);
  kit.place(k.merged(), 0, 0, 0, ry);
}
