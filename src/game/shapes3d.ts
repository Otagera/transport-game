// Procedural low-poly shapes for the 3D view (view3d.ts; decisions log 2026-10-25: assets
// procedural, in one low-poly style). Nigerian buildings -- zinc-roofed bungalows and compound
// walls, shophouses with awnings, concrete blocks with tanks on the roof, a mosque, a church,
// market stalls under umbrellas, round huts -- and the vehicles the free packs lack: the danfo
// with its stripe and roof rack, the keke, the okada and its rider, a lorry, a tanker. Each a
// recipe of boxes, prisms and cylinders with flat colours, seeded, so a town is always itself
// and no two are the same. A whole town merges into one geometry: one draw call a town.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { paint } from "./palette3d";

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

export const WALLS = [paint("--paint-earth-5"), paint("--paint-earth-19"), paint("--paint-earth-30"), paint("--paint-blue-7"), paint("--paint-green-1"), paint("--paint-light-4"), paint("--paint-earth-16"), paint("--paint-earth-35")];
export const ROOFS = [paint("--paint-grey-3"), paint("--paint-grey-4"), paint("--paint-earth-55"), paint("--paint-earth-53"), paint("--paint-blue-11"), paint("--paint-grey-2")];
export const CONCRETE = [paint("--paint-earth-14"), paint("--paint-earth-10"), paint("--paint-earth-21"), paint("--paint-earth-8")];
/** A town's blocks at its heart (view3d.ts townKit): plastered concrete, paler than the houses. */
export const BLOCK_WALLS = [paint("--paint-earth-4"), paint("--paint-earth-13"), paint("--paint-light-6"), paint("--paint-grey-1"), paint("--paint-earth-9")];
/** A block's window bands. */
export const WINDOWS = paint("--paint-grey-18");

/** A face on a wall: in a kit's own frame turned by ry, `u` along the wall, at `v` out from the centre (+ the front). */
function onWall(kit: Kit, colour: string, x: number, z: number, ry: number, u: number, v: number, w: number, h: number, y: number): void {
  const cos = Math.cos(ry), sin = Math.sin(ry);
  kit.box(w, h, 0.1, colour, x + u * cos + v * sin, z - u * sin + v * cos, y, ry);
}
const PANE = paint("--paint-grey-18");

/** A bungalow in its compound: plastered walls, a zinc hip roof over a veranda, a wall round the yard. */
export function bungalow(kit: Kit, rand: Rand, x: number, z: number, ry: number): void {
  const w = 7 + rand() * 4, d = 6 + rand() * 3, h = 3;
  kit.box(w, h, d, pick(rand, WALLS), x, z, 0, ry);
  kit.cone(Math.hypot(w, d) / 2 + 0.4, 2, pick(rand, ROOFS), x, z, h, 4, ry + Math.PI / 4);
  // Its face: a door, a window either side; windows on the back.
  onWall(kit, PANE, x, z, ry, 0, d / 2 + 0.03, 1, 2.1, 0);
  for (const u of [-w * 0.3, w * 0.3]) {
    onWall(kit, PANE, x, z, ry, u, d / 2 + 0.03, 1.1, 0.9, 1.2);
    onWall(kit, PANE, x, z, ry, u, -d / 2 - 0.03, 1.1, 0.9, 1.2);
  }
  if (rand() < 0.6) {
    // The compound wall: four low runs round the house, a gap for the gate.
    const cw = w + 6, cd = d + 6, wall = paint("--paint-earth-15");
    const cos = Math.cos(ry), sin = Math.sin(ry);
    const at = (u: number, v: number) => ({ x: x + u * cos + v * sin, z: z - u * sin + v * cos });
    for (const [u, v, len, along] of [[0, -cd / 2, cw, true], [0, cd / 2, cw * 0.6, true], [-cw / 2, 0, cd, false], [cw / 2, 0, cd, false]] as const) {
      const p = at(u, v);
      kit.box(along ? len : 0.3, 1.6, along ? 0.3 : len, wall, p.x, p.z, 0, ry);
    }
  }
}

/** A shophouse: a shop below with its awning and signboard, rooms above with their windows. */
export function shophouse(kit: Kit, rand: Rand, x: number, z: number, ry: number): void {
  const w = 8 + rand() * 3, d = 7, floors = 2 + (rand() < 0.3 ? 1 : 0), h = floors * 3;
  kit.box(w, h, d, pick(rand, WALLS), x, z, 0, ry);
  kit.box(w + 0.4, 0.3, d + 0.4, pick(rand, CONCRETE), x, z, h, ry);
  // The shop's open front, its signboard over it, and the rooms' windows above.
  onWall(kit, PANE, x, z, ry, 0, d / 2 + 0.03, w * 0.7, 2.2, 0);
  onWall(kit, pick(rand, [paint("--paint-light-1"), paint("--paint-earth-52"), paint("--paint-blue-12")]), x, z, ry, 0, d / 2 + 0.06, w * 0.6, 0.5, 2.3);
  for (let f = 1; f < floors; f += 1) for (const u of [-w * 0.3, 0, w * 0.3]) onWall(kit, PANE, x, z, ry, u, d / 2 + 0.03, 1, 1, f * 3 + 1);
  const awning = pick(rand, [paint("--paint-red-3"), paint("--paint-blue-12"), paint("--paint-green-24"), paint("--paint-earth-52"), paint("--paint-red-2")]);
  const cos = Math.cos(ry), sin = Math.sin(ry);
  kit.add(new THREE.BoxGeometry(w, 0.2, 2), awning, { x: x + (d / 2 + 1) * sin, y: 2.8, z: z + (d / 2 + 1) * cos, ry, rx: 0.25 });
}

/** A concrete block of flats: balconies as bands, a water tank on the roof. */
export function block(kit: Kit, rand: Rand, x: number, z: number, ry: number, floorsMin: number, floorsMax: number): void {
  const floors = floorsMin + Math.floor(rand() * (floorsMax - floorsMin + 1));
  const w = 12 + rand() * 6, d = 10 + rand() * 4, h = floors * 3;
  const wall = pick(rand, CONCRETE);
  kit.box(w, h, d, wall, x, z, 0, ry);
  for (let f = 1; f < floors; f += 1) kit.box(w + 0.6, 0.25, d + 0.6, paint("--paint-grey-5"), x, z, f * 3, ry);
  // Its windows, a band a floor.
  for (let f = 0; f < floors; f += 1) kit.box(w + 0.12, 0.9, d + 0.12, PANE, x, z, f * 3 + 1.1, ry);
  kit.cylinder(1.2, 1.8, paint("--paint-blue-16"), x + w * 0.2, z, h, 8);
  kit.cylinder(1.1, 1.6, paint("--paint-grey-26"), x - w * 0.2, z + d * 0.15, h, 8);
}

/** A mosque: a hall, a green dome, a minaret. */
export function mosque(kit: Kit, rand: Rand, x: number, z: number, scale = 1): void {
  const s = scale;
  kit.box(14 * s, 5 * s, 14 * s, paint("--paint-light-4"), x, z);
  kit.dome(5 * s, paint("--paint-green-24"), x, z, 5 * s);
  kit.cylinder(1.1 * s, 16 * s, paint("--paint-light-4"), x + 8 * s, z + 8 * s, 0, 8);
  kit.cone(1.4 * s, 3 * s, paint("--paint-green-24"), x + 8 * s, z + 8 * s, 16 * s, 8, 0);
  // The minaret's balcony, the hall's arched door and windows (as dark panels), the crescent's mast.
  kit.cylinder(1.6 * s, 0.4 * s, paint("--paint-light-4"), x + 8 * s, z + 8 * s, 12 * s, 10);
  kit.cylinder(0.06 * s, 1.6 * s, paint("--paint-earth-37"), x + 8 * s, z + 8 * s, 19 * s, 4);
  kit.box(2.2 * s, 3.2 * s, 0.1, PANE, x, z + 7.05 * s);
  for (const dx of [-4.5, 4.5]) kit.box(1.4 * s, 2 * s, 0.1, PANE, x + dx * s, z + 7.05 * s, 1.5 * s);
  if (rand() < 0.5) kit.dome(1.6 * s, paint("--paint-earth-37"), x, z, 9.8 * s);
}

/** A church: a long nave under a gable, a bell tower at its end. */
export function church(kit: Kit, rand: Rand, x: number, z: number, scale = 1): void {
  const s = scale;
  const wall = pick(rand, [paint("--paint-light-4"), paint("--paint-earth-19"), paint("--paint-earth-12")]);
  kit.box(16 * s, 6 * s, 9 * s, wall, x, z);
  kit.gable(16 * s, 9 * s, 4 * s, paint("--paint-earth-55"), x, z, 6 * s);
  kit.box(4 * s, 14 * s, 4 * s, wall, x + 10 * s, z);
  kit.cone(3 * s, 4 * s, paint("--paint-earth-55"), x + 10 * s, z, 14 * s);
  // The cross, the door at its tower's foot, tall windows down the nave.
  kit.box(0.25 * s, 2.4 * s, 0.25 * s, paint("--paint-light-4"), x + 10 * s, z, 18 * s);
  kit.box(1.2 * s, 0.25 * s, 0.25 * s, paint("--paint-light-4"), x + 10 * s, z, 19.4 * s);
  kit.box(0.1, 2.6 * s, 1.6 * s, PANE, x + 12.05 * s, z);
  for (let i = 0; i < 4; i += 1) for (const dz of [-4.55, 4.55]) kit.box(1 * s, 2.6 * s, 0.1, PANE, x + (-6 + i * 3.4) * s, z + dz * s, 1.8 * s);
}

/** Market stalls under umbrellas, a few in a row. */
export function market(kit: Kit, rand: Rand, x: number, z: number, stalls: number): void {
  for (let i = 0; i < stalls; i += 1) {
    // At life size (a 3 m umbrella over a 2.4 m table): at 2.2 m a radius they stood as wide as the trees.
    const sx = x + (i % 4) * 3.6 - 5.4, sz = z + Math.floor(i / 4) * 3.8 - 1.9;
    kit.box(2.4, 0.9, 1.6, paint("--paint-earth-54"), sx, sz);
    kit.cylinder(0.07, 2.3, paint("--paint-grey-20"), sx, sz, 0, 4);
    kit.cone(1.5, 0.6, pick(rand, [paint("--paint-red-3"), paint("--paint-earth-52"), paint("--paint-blue-12"), paint("--paint-green-24"), paint("--paint-earth-45"), paint("--paint-light-1")]), sx, sz, 2.15, 8, 0);
  }
}

/** A round hut: mud wall, thatch cone. */
export function hut(kit: Kit, rand: Rand, x: number, z: number): void {
  const r = 2.2 + rand() * 0.8;
  kit.cylinder(r, 2.4, paint("--paint-earth-40"), x, z, 0, 10);
  kit.cone(r + 0.7, 2.4, paint("--paint-earth-36"), x, z, 2.4, 10, 0);
  kit.box(0.9, 1.7, 0.1, PANE, x, z + r + 0.02); // its doorway
}

/** An industrial site: a refinery's tanks and columns, a quarry's pit and heaps, a works' sheds and stack. */
export function site(kit: Kit, rand: Rand, kind: string): void {
  if (kind === "refinery" || kind === "newrefinery" || kind === "terminal" || kind === "depot" || kind === "oilfield") {
    const tanks = kind === "oilfield" ? 0 : kind === "depot" ? 3 : 6;
    for (let i = 0; i < tanks; i += 1) kit.cylinder(4.5, 5, paint("--paint-earth-1"), -12 + (i % 3) * 11, -6 + Math.floor(i / 3) * 12, 0, 14);
    if (kind.includes("refinery")) {
      kit.cylinder(1.4, 22, paint("--paint-grey-2"), 16, -4, 0, 8);
      kit.cylinder(1.1, 16, paint("--paint-grey-2"), 20, 4, 0, 8);
      kit.box(10, 6, 8, paint("--paint-grey-6"), 18, 14);
    }
    // The pump jacks' posts; their beams nod, drawn by view3d.ts (SITE_LIFE) so they move.
    if (kind === "oilfield") for (let i = 0; i < 4; i += 1) kit.box(1, 4, 1, paint("--paint-grey-23"), -10 + i * 7, (i % 2) * 8);
    return;
  }
  // A station on the old line (stations.ts): a long low building, its platform and canopy, a water tower.
  if (kind === "station") {
    kit.box(16, 4, 6, paint("--paint-earth-17"), 0, -6);
    kit.box(17, 0.5, 7, paint("--paint-red-6"), 0, -6, 4);
    kit.box(24, 0.8, 4, paint("--paint-earth-22"), 0, 1);
    kit.box(14, 0.3, 4.4, paint("--paint-grey-20"), 0, 1, 3.6);
    for (const x of [-5, 0, 5]) kit.box(0.4, 3, 0.4, paint("--paint-grey-20"), x, 2.6, 0.8);
    kit.cylinder(1.6, 3, paint("--paint-grey-17"), 13, -8, 5);
    kit.cylinder(0.3, 5, paint("--paint-grey-20"), 13, -8);
    return;
  }
  // A border crossing (border.ts): the customs post, its barrier across the road, lorries waiting, flags.
  if (kind === "border" || kind === "gateway") {
    kit.box(14, 4, 7, paint("--paint-earth-7"), 0, -8);
    kit.box(15, 0.4, 8, paint("--paint-green-24"), 0, -8, 4);
    kit.box(3, 2.6, 3, paint("--paint-earth-14"), -6, 2);
    kit.box(10, 0.5, 0.5, paint("--paint-red-3"), 0, 2, 1.6);
    for (const [x, colour] of [[6, paint("--paint-green-24")], [8.5, paint("--paint-earth-1")]] as const) {
      kit.cylinder(0.12, 7, paint("--paint-grey-20"), x, -12, 0, 4);
      kit.box(1.6, 1, 0.1, colour, x + 0.8, -12, 6);
    }
    for (let i = 0; i < 3; i += 1) kit.box(7, 3, 2.4, i % 2 ? paint("--paint-earth-53") : paint("--paint-blue-11"), -14 + i * 9, 10);
    return;
  }
  if (kind === "quarry" || kind === "ironmine") {
    const heap = kind === "quarry" ? paint("--paint-earth-12") : paint("--paint-red-5");
    for (let i = 0; i < 4; i += 1) kit.cone(4 + rand() * 3, 4 + rand() * 3, heap, -10 + i * 7, (rand() - 0.5) * 12, 0, 7, rand());
    kit.box(8, 3, 5, paint("--paint-earth-52"), 12, 6);
    kit.box(1, 10, 1, paint("--paint-grey-20"), 16, -6);
    return;
  }
  // A works, mill or silo: long sheds, a stack or the silos' cylinders.
  kit.box(22, 7, 12, paint("--paint-earth-14"), 0, 0);
  kit.gable(22, 12, 3, paint("--paint-grey-6"), 0, 0, 7);
  if (kind === "silo" || kind === "mill" || kind === "flourmill") for (let i = 0; i < 3; i += 1) kit.cylinder(3, 14, paint("--paint-earth-1"), -8 + i * 7, 12, 0, 12);
  else kit.cylinder(1.6, 24, paint("--paint-grey-5"), 14, 8, 0, 10);
  if (kind === "steelworks" || kind === "steelport") kit.box(14, 10, 10, paint("--paint-grey-16"), -16, 10);
}

/**
 * What a working site gives off, in its kit's own frame (site() above): where, and what -- a stack's
 * smoke, a refinery's flare, a mill's steam, a quarry's dust, a pump jack's nodding beam. view3d.ts
 * runs them while the site works and stills them when it stands idle.
 */
export type SiteEffect = "smoke" | "darkSmoke" | "flare" | "steam" | "dust" | "pumpjack";
export const SITE_LIFE: Record<string, Array<{ x: number; z: number; y: number; what: SiteEffect }>> = {
  refinery: [{ x: 16, z: -4, y: 22.5, what: "flare" }, { x: 20, z: 4, y: 16.5, what: "steam" }],
  newrefinery: [{ x: 16, z: -4, y: 22.5, what: "flare" }, { x: 20, z: 4, y: 16.5, what: "steam" }],
  oilfield: [0, 1, 2, 3].map((i) => ({ x: -10 + i * 7, z: (i % 2) * 8, y: 4.2, what: "pumpjack" as const })),
  works: [{ x: 14, z: 8, y: 24.5, what: "smoke" }],
  assembly: [{ x: 14, z: 8, y: 24.5, what: "steam" }],
  steelworks: [{ x: 14, z: 8, y: 24.5, what: "darkSmoke" }, { x: -16, z: 10, y: 10.5, what: "smoke" }],
  mill: [{ x: -1, z: 12, y: 14.5, what: "steam" }],
  flourmill: [{ x: -1, z: 12, y: 14.5, what: "steam" }],
  silo: [{ x: -1, z: 12, y: 14.5, what: "dust" }],
  quarry: [{ x: -10, z: 0, y: 2, what: "dust" }, { x: 4, z: 0, y: 2, what: "dust" }],
  ironmine: [{ x: -10, z: 0, y: 2, what: "dust" }, { x: 4, z: 0, y: 2, what: "dust" }],
};

/** A cargo ship, facing +x, its waterline at y = 0: hull, containers on deck, the bridge aft, its funnel. */
export function cargoShip(rand: Rand): THREE.BufferGeometry {
  const kit = new Kit();
  const hull = pick(rand, [paint("--paint-red-6"), paint("--paint-blue-20"), paint("--paint-dark-5")]);
  rounded(kit, 70, 7, 12, 2.5, hull, 0, 0, -3);
  kit.box(68, 0.4, 11.6, paint("--paint-grey-21"), 0, 0, 4);
  // The bow drawn in: a wedge forward.
  kit.add(new THREE.ConeGeometry(6, 10, 4).rotateZ(-Math.PI / 2).scale(1, 0.7, 1), hull, { x: 38, y: 0.5, ry: Math.PI / 4 });
  const boxes = [paint("--paint-red-3"), paint("--paint-blue-12"), paint("--paint-earth-52"), paint("--paint-green-24"), paint("--paint-grey-4"), paint("--paint-earth-47")];
  for (let i = 0; i < 7; i += 1) for (let j = 0; j < 3; j += 1) {
    const tiers = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < tiers; k += 1) kit.box(6, 2.4, 3.2, pick(rand, boxes), -14 + i * 6.6, -3.4 + j * 3.4, 4.4 + k * 2.5);
  }
  kit.box(9, 9, 11, paint("--paint-light-4"), -28, 0, 4.4);
  kit.box(9.4, 1.2, 11.4, PANE_DARK, -28, 0, 11);
  kit.cylinder(1.4, 5, pick(rand, boxes), -31, 0, 13.4, 10);
  return kit.merged();
}
const PANE_DARK = paint("--paint-grey-18");

// --- Vehicles: each facing +x, standing on y = 0, a little larger than life ---------------

export type VehicleKind3D = "bus" | "brt" | "minibus" | "danfo" | "keke" | "okada" | "truck" | "tanker" | "train" | "freight";
const TYRE = paint("--paint-grey-26"), GLASS = paint("--paint-blue-5"), HUB = paint("--paint-grey-2"), DARK = paint("--paint-dark-5");
const HEADLAMP = paint("--paint-light-3"), TAIL = paint("--paint-red-3"), TRIM = paint("--paint-grey-22");
/** A body with rounded edges, standing on y at its centre (x, z). */
function rounded(kit: Kit, w: number, h: number, d: number, r: number, colour: string, x = 0, z = 0, y = 0): void {
  kit.add(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, h / 2 - 0.01, d / 2 - 0.01, w / 2 - 0.01)), colour, { x, y: y + h / 2, z });
}
function wheels(kit: Kit, len: number, wid: number, r = 0.45, axles = 2, at?: number[]): void {
  const xs = at ?? Array.from({ length: axles }, (_, a) => (axles === 1 ? 0 : -len / 2 + 1 + (a * (len - 2)) / (axles - 1)));
  for (const x of xs) for (const z of [-wid / 2, wid / 2]) {
    kit.add(new THREE.CylinderGeometry(r, r, 0.32, 10), TYRE, { x, y: r, z, rx: Math.PI / 2 });
    kit.add(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.34, 8), HUB, { x, y: r, z: z + Math.sign(z) * 0.01, rx: Math.PI / 2 });
  }
}
/** Side windows as panes between pillars, both sides, from `x0` to `x1` at height y (h tall). */
function panes(kit: Kit, x0: number, x1: number, y: number, h: number, wid: number, n: number, colour = GLASS): void {
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i += 1) kit.box(step * 0.82, h, wid + 0.04, colour, x0 + step * (i + 0.5), 0, y);
}
/** Lamps: headlamps at the front (+x), tail lamps at the back. */
function lamps(kit: Kit, len: number, wid: number, y: number, back = len): void {
  for (const z of [-wid / 2 + 0.3, wid / 2 - 0.3]) {
    kit.box(0.08, 0.22, 0.38, HEADLAMP, len / 2 + 0.01, z, y);
    kit.box(0.08, 0.26, 0.22, TAIL, -back / 2 - 0.01, z, y);
  }
}
/** A person standing (a conductor, a rider): legs, body in its colour, head. */
function person(kit: Kit, colour: string, x: number, z: number, y: number, sitting = false): void {
  if (!sitting) kit.box(0.3, 0.8, 0.22, DARK, x, z, y);
  kit.box(0.42, 0.65, 0.26, colour, x, z, y + (sitting ? 0.1 : 0.78));
  kit.add(new THREE.SphereGeometry(0.15, 8, 6), paint("--paint-earth-63"), { x, y: y + (sitting ? 0.92 : 1.6), z });
}

export function vehicleGeometry(kind: VehicleKind3D): THREE.BufferGeometry {
  const kit = new Kit();
  switch (kind) {
    case "bus":
    case "brt": {
      // White: each is tinted by its route's colour, or its kind's (view3d.ts placeVehicles).
      const body = paint("--paint-light-1");
      const len = kind === "bus" ? 12 : 9;
      const halves = kind === "bus" ? [0] : [-4.85, 4.85];
      halves.forEach((off, half) => {
        const k2 = new Kit();
        rounded(k2, len, 2.75, 2.5, 0.3, body, 0, 0, 0.4);
        panes(k2, -len / 2 + 0.6, len / 2 - 1.6, 1.55, 1, 2.5, kind === "bus" ? 7 : 5);
        // The front: a raked windscreen and its destination board, on the leading half only.
        if (half === halves.length - 1) {
          k2.add(new THREE.BoxGeometry(0.1, 1.35, 2.25), GLASS, { x: len / 2 + 0.02, y: 1.75, rz: -0.08 });
          k2.box(0.06, 0.28, 1.6, paint("--paint-earth-20"), len / 2 + 0.05, 0, 2.62);
          k2.box(0.2, 0.3, 2.45, TRIM, len / 2, 0, 0.35);
        }
        k2.box(1, 2, 0.04, DARK, len / 2 - 1.3, 1.27, 0.55); // the door
        if (half === 0) k2.box(0.2, 0.3, 2.45, TRIM, -len / 2, 0, 0.35);
        lamps(k2, len, 2.5, 0.8);
        k2.box(len * 0.4, 0.35, 1.6, paint("--paint-grey-4"), -len * 0.1, 0, 3.15); // the roof's air unit
        wheels(k2, len, 2.5, 0.5, 2, [len / 2 - 2.2, -len / 2 + 2.6]);
        kit.place(k2.merged(), off, 0, 0); // its own colours kept: windows, tyres
      });
      if (kind === "brt") kit.add(new THREE.CylinderGeometry(1.2, 1.2, 0.8, 12), paint("--paint-grey-22"), { y: 1.75, rz: Math.PI / 2 });
      break;
    }
    case "minibus":
    case "danfo": {
      // A danfo is the old Volkswagen in the informal sector's yellow (look.md §2), two black bands
      // down its sides, its roof rack piled and its conductor hanging out of the open door; a
      // minibus is yours, white and tinted, a flat-fronted van.
      const danfo = kind === "danfo";
      const body = danfo ? paint("--informal") : paint("--paint-light-1");
      rounded(kit, 5.2, 1.95, 2.1, danfo ? 0.42 : 0.28, body, 0, 0, 0.4);
      panes(kit, -2.3, 1.6, 1.55, 0.7, 2.1, 4);
      kit.add(new THREE.BoxGeometry(0.1, 0.78, 1.9), GLASS, { x: 2.6, y: 1.72, rz: danfo ? -0.2 : -0.1 });
      lamps(kit, 5.2, 2.1, 0.75);
      kit.box(0.14, 0.24, 2.1, TRIM, 2.6, 0, 0.42);
      if (danfo) {
        for (const y of [0.92, 1.24]) kit.box(5.24, 0.1, 2.14, DARK, 0, 0, y);
        // The roof rack and its load.
        for (const z of [-0.85, 0.85]) kit.box(3.8, 0.08, 0.08, paint("--paint-grey-24"), -0.4, z, 2.5);
        for (const [x, z, w, h, c] of [[-1.6, 0.35, 1.1, 0.55, paint("--paint-earth-59")], [-0.4, -0.35, 0.9, 0.5, paint("--paint-blue-18")], [0.6, 0.3, 0.8, 0.4, paint("--paint-red-3")], [-0.9, -0.3, 0.7, 0.35, paint("--paint-green-24")]] as const) {
          rounded(kit, w, h, 0.65, 0.12, c, x, z, 2.38);
        }
        kit.box(1, 1.5, 0.05, DARK, 0.6, 1.07, 0.45); // the open door
        person(kit, paint("--paint-blue-12"), 0.6, 1.25, 0.25); // the conductor, hanging out
      } else {
        kit.box(0.9, 1.4, 0.04, DARK, 0.5, 1.07, 0.55);
      }
      wheels(kit, 5.2, 2.1, 0.42, 2, [1.6, -1.7]);
      break;
    }
    case "keke": {
      rounded(kit, 2.5, 1, 1.3, 0.3, paint("--informal"), -0.2, 0, 0.35);
      rounded(kit, 0.9, 1.1, 1.0, 0.35, paint("--informal"), 1.25, 0, 0.3); // the nose
      kit.add(new THREE.BoxGeometry(0.08, 0.7, 1.0), GLASS, { x: 1.55, y: 1.65, rz: -0.25 });
      for (const [px, pz] of [[-1.3, -0.6], [-1.3, 0.6], [1.0, -0.55], [1.0, 0.55]] as const) kit.cylinder(0.04, 1.25, paint("--paint-grey-24"), px, pz, 1.35, 4);
      rounded(kit, 2.8, 0.14, 1.5, 0.06, paint("--paint-green-24"), -0.15, 0, 2.55); // the canopy
      person(kit, paint("--paint-light-4"), 0.75, 0, 0.75, true);
      kit.add(new THREE.CylinderGeometry(0.33, 0.33, 0.18, 10), TYRE, { x: 1.4, y: 0.33, rx: Math.PI / 2 });
      for (const z of [-0.62, 0.62]) kit.add(new THREE.CylinderGeometry(0.33, 0.33, 0.18, 10), TYRE, { x: -0.95, y: 0.33, z, rx: Math.PI / 2 });
      break;
    }
    case "okada": {
      rounded(kit, 1.5, 0.35, 0.3, 0.1, paint("--paint-grey-23"), 0, 0, 0.45);
      rounded(kit, 0.55, 0.3, 0.35, 0.12, paint("--paint-red-3"), 0.25, 0, 0.75); // the tank
      kit.box(0.7, 0.12, 0.34, DARK, -0.35, 0, 0.82); // the seat
      kit.box(0.08, 0.6, 0.06, paint("--paint-grey-20"), 0.72, 0, 0.6);
      kit.box(0.06, 0.06, 0.7, paint("--paint-grey-20"), 0.74, 0, 1.18); // the bars
      for (const x of [-0.72, 0.72]) {
        kit.add(new THREE.CylinderGeometry(0.33, 0.33, 0.12, 12), TYRE, { x, y: 0.33, rx: Math.PI / 2 });
        kit.add(new THREE.CylinderGeometry(0.14, 0.14, 0.14, 8), HUB, { x, y: 0.33, rx: Math.PI / 2 });
      }
      person(kit, paint("--paint-earth-46"), 0, 0, 0.88, true); // the rider
      kit.add(new THREE.SphereGeometry(0.18, 8, 6), paint("--paint-red-4"), { x: 0, y: 1.82, z: 0 }); // his helmet
      person(kit, paint("--paint-blue-12"), -0.48, 0, 0.88, true); // the passenger
      break;
    }
    case "truck":
    case "tanker": {
      // The cab: a bonnet and its grille, a raked windscreen; the load behind.
      rounded(kit, 2.4, 2.3, 2.4, 0.25, paint("--paint-earth-3"), 3.1, 0, 0.55);
      rounded(kit, 1.1, 1.1, 2.2, 0.15, paint("--paint-earth-3"), 4.55, 0, 0.55);
      kit.box(0.08, 0.7, 1.4, DARK, 5.11, 0, 0.75); // the grille
      kit.add(new THREE.BoxGeometry(0.1, 0.95, 2.1), GLASS, { x: 4.28, y: 2.25, rz: -0.18 });
      for (const z of [-0.85, 0.85]) kit.box(0.08, 0.2, 0.3, HEADLAMP, 5.11, z, 0.95);
      kit.box(8.2, 0.3, 2.3, TRIM, -0.5, 0, 0.55); // the chassis
      if (kind === "truck") {
        // Its load under a tarpaulin, roped, bulging over the top.
        kit.box(5.8, 2.2, 2.5, paint("--goods"), -1.6, 0, 0.85);
        const tarp = new THREE.CylinderGeometry(1.24, 1.24, 5.8, 14);
        tarp.scale(0.45, 1, 1); // flattened (its x is up once turned): a bulge over the load, not a drum
        kit.add(tarp, paint("--paint-blue-18"), { x: -1.6, y: 3.0, rz: Math.PI / 2 });
        for (let i = 0; i < 4; i += 1) kit.box(0.06, 2.5, 2.56, DARK, -4.2 + i * 1.75, 0, 0.85);
      } else {
        // The tank: rounded ends, a catwalk on top, a band round it.
        kit.add(new THREE.CylinderGeometry(1.15, 1.15, 5.4, 16), paint("--paint-earth-47"), { x: -1.6, y: 1.95, rz: Math.PI / 2 });
        for (const x of [-4.3, 1.1]) kit.add(new THREE.SphereGeometry(1.15, 16, 8), paint("--paint-earth-47"), { x, y: 1.95 });
        kit.box(5.2, 0.08, 0.5, paint("--paint-grey-20"), -1.6, 0, 3.15);
        kit.add(new THREE.CylinderGeometry(1.17, 1.17, 0.3, 16), paint("--paint-light-4"), { x: -1.6, y: 1.95, rz: Math.PI / 2 });
      }
      for (const z of [-1.15, 1.15]) kit.box(0.08, 0.26, 0.22, TAIL, -4.65, z, 0.75);
      wheels(kit, 8.5, 2.4, 0.5, 3, [3.6, -2.4, -3.6]);
      break;
    }
    case "train":
    case "freight": {
      // The locomotive: a long hood, its cab at the front, a headlamp; behind it a coach (windows
      // in a row) or a covered wagon (ribbed, the goods' brown).
      // Yours (a passenger train) white, as your buses are, so the route's colour tints it whole; a freight
      // train's engine the railway's yellow.
      const loco = kind === "train" ? paint("--paint-light-4") : paint("--paint-earth-52");
      kit.box(7, 0.5, 2.6, paint("--paint-grey-24"), 5.3, 0, 0.3);
      rounded(kit, 5, 2.3, 2.4, 0.3, loco, 4.3, 0, 0.8);
      rounded(kit, 2, 3.0, 2.8, 0.25, loco, 7.6, 0, 0.8);
      kit.box(0.08, 0.9, 2.3, GLASS, 8.62, 0, 2.6);
      kit.box(0.1, 0.25, 0.4, HEADLAMP, 8.63, 0, 1.6);
      kit.box(5, 0.12, 2.42, DARK, 4.3, 0, 1.6);
      const car = kind === "train" ? paint("--paint-light-1") : paint("--paint-earth-58");
      kit.box(10.5, 0.5, 2.6, paint("--paint-grey-24"), -3.6, 0, 0.3);
      rounded(kit, 10.5, 2.9, 2.9, 0.3, car, -3.6, 0, 0.8);
      if (kind === "train") panes(kit, -8.4, 1.2, 2.2, 0.85, 2.9, 8);
      else for (let i = 0; i < 6; i += 1) kit.box(0.14, 3.0, 2.98, paint("--paint-earth-62"), -8.3 + i * 1.9, 0, 0.75);
      for (const x of [7, 3.2, 0.6, -7.8]) for (const z of [-1.1, 1.1]) kit.add(new THREE.CylinderGeometry(0.42, 0.42, 0.2, 10), TYRE, { x, y: 0.42, z, rx: Math.PI / 2 });
      break;
    }
  }
  return kit.merged();
}

// --- Trees: the savanna's, standing on y = 0, about life size ------------------------------

export type TreeKind = "acacia" | "shade" | "palm" | "bush" | "rainforest" | "mangrove" | "baobab" | "boulder";
/** A tree's shape; each kind one InstancedMesh, scaled and turned per tree. */
export function treeGeometry(kind: TreeKind): THREE.BufferGeometry {
  const kit = new Kit();
  const bark = paint("--paint-earth-60");
  switch (kind) {
    case "acacia": {
      // The savanna's flat-topped tree: a forked trunk, a wide thin crown.
      kit.add(new THREE.CylinderGeometry(0.25, 0.35, 4.5, 5), bark, { y: 2.25, rz: 0.12 });
      kit.add(new THREE.CylinderGeometry(3.2, 2.6, 1.1, 7), paint("--paint-green-22"), { y: 4.9 });
      kit.add(new THREE.CylinderGeometry(2.2, 2.6, 0.7, 7), paint("--paint-green-15"), { x: 0.6, y: 5.6, z: -0.3 });
      break;
    }
    case "shade": {
      // A mango or shea: a short trunk under a round, dark crown.
      kit.add(new THREE.CylinderGeometry(0.35, 0.45, 3, 5), bark, { y: 1.5 });
      kit.add(new THREE.IcosahedronGeometry(3, 0), paint("--paint-green-25"), { y: 4.6 });
      kit.add(new THREE.IcosahedronGeometry(2.2, 0), paint("--paint-green-21"), { x: 1.6, y: 4, z: 0.8 });
      break;
    }
    case "palm": {
      // An oil palm: a tall bending trunk, a burst of fronds.
      kit.add(new THREE.CylinderGeometry(0.22, 0.32, 8, 5), paint("--paint-earth-56"), { y: 4, rz: 0.08 });
      for (let k = 0; k < 7; k += 1) {
        const a = (k / 7) * Math.PI * 2;
        kit.add(new THREE.BoxGeometry(3.4, 0.08, 0.7), k % 2 ? paint("--paint-green-23") : paint("--paint-green-17"), { x: Math.cos(a) * 1.5 + 0.6, y: 8, z: Math.sin(a) * 1.5, ry: -a, rz: -0.35 });
      }
      break;
    }
    case "bush": {
      kit.add(new THREE.IcosahedronGeometry(1.3, 0), paint("--paint-green-18"), { y: 0.9 });
      kit.add(new THREE.IcosahedronGeometry(1, 0), paint("--paint-green-13"), { x: 1, y: 0.7, z: 0.4 });
      break;
    }
    case "rainforest": {
      // The south's forest giant: a tall clean trunk, its crown in deep layers above the rest.
      kit.add(new THREE.CylinderGeometry(0.4, 0.6, 11, 6), bark, { y: 5.5 });
      kit.add(new THREE.IcosahedronGeometry(3.6, 0), paint("--paint-green-27"), { y: 11.5 });
      kit.add(new THREE.IcosahedronGeometry(2.8, 0), paint("--paint-green-26"), { x: 2.2, y: 10.2, z: 1 });
      kit.add(new THREE.IcosahedronGeometry(2.5, 0), paint("--paint-green-26"), { x: -1.8, y: 10.6, z: -1.4 });
      break;
    }
    case "mangrove": {
      // The delta's: stilt roots arching into the water, a low dense crown.
      for (let k = 0; k < 6; k += 1) {
        const a = (k / 6) * Math.PI * 2;
        kit.add(new THREE.CylinderGeometry(0.08, 0.12, 2.4, 4), paint("--paint-earth-64"), { x: Math.cos(a) * 0.9, y: 1, z: Math.sin(a) * 0.9, rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5 });
      }
      kit.add(new THREE.CylinderGeometry(0.2, 0.25, 1.6, 5), paint("--paint-earth-64"), { y: 2.6 });
      kit.add(new THREE.IcosahedronGeometry(2.3, 0), paint("--paint-green-28"), { y: 4.2 });
      kit.add(new THREE.IcosahedronGeometry(1.7, 0), paint("--paint-green-25"), { x: 1.5, y: 3.7, z: 0.5 });
      break;
    }
    case "baobab": {
      // The north's: a great swollen trunk, stubby branches, a thin crown.
      kit.add(new THREE.CylinderGeometry(1.1, 1.8, 6, 8), paint("--paint-grey-27"), { y: 3 });
      for (let k = 0; k < 5; k += 1) {
        const a = (k / 5) * Math.PI * 2;
        kit.add(new THREE.CylinderGeometry(0.15, 0.35, 2.6, 4), paint("--paint-grey-27"), { x: Math.cos(a) * 1.2, y: 6.6, z: Math.sin(a) * 1.2, rx: Math.sin(a) * 0.7, rz: -Math.cos(a) * 0.7 });
        kit.add(new THREE.IcosahedronGeometry(0.9, 0), paint("--paint-green-15"), { x: Math.cos(a) * 2.1, y: 7.8, z: Math.sin(a) * 2.1 });
      }
      break;
    }
    case "boulder": {
      // Granite: rounded blocks heaped, as on the plateau and round the inselbergs.
      kit.add(new THREE.DodecahedronGeometry(1.6, 0), paint("--paint-grey-27"), { y: 0.9 });
      kit.add(new THREE.DodecahedronGeometry(1.1, 0), paint("--paint-grey-28"), { x: 1.5, y: 0.6, z: 0.6, ry: 0.7 });
      kit.add(new THREE.DodecahedronGeometry(0.8, 0), paint("--paint-grey-27"), { x: -1.2, y: 0.4, z: 1.1, ry: 1.9 });
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
  k.add(new THREE.BoxGeometry(3.4, 0.12, 1.6), pick(rand, [paint("--paint-red-3"), paint("--paint-blue-12"), paint("--paint-green-24"), paint("--paint-earth-52"), paint("--paint-red-2"), paint("--paint-earth-45")]), { y: 2.3, z: 1.7, rx: 0.3 });
  if (rand() < 0.5) k.box(1.2, 0.8, 0.8, paint("--paint-earth-54"), 1.8, 2);
  kit.place(k.merged(), x, 0, z, ry);
}
/** A roadside fuel seller (a town short of fuel): a bench, jerrycans lined up beside it, a funnel, a shade. */
export function fuelSeller(kit: Kit, rand: Rand, x: number, z: number, ry: number): void {
  const k = new Kit();
  k.box(1.8, 0.7, 0.8, paint("--paint-earth-54"));
  const cans = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < cans; i += 1) k.box(0.45, 0.65, 0.3, pick(rand, [paint("--paint-earth-52"), paint("--paint-earth-52"), paint("--paint-green-24"), paint("--paint-red-3")]), -1.4 + i * 0.55, 1, 0);
  k.cone(0.2, 0.3, paint("--paint-grey-20"), 0.4, 0, 0.75, 6, 0);
  if (rand() < 0.6) {
    k.cylinder(0.05, 2.2, paint("--paint-grey-20"), -0.4, 0, 0, 4);
    k.cone(1.4, 0.5, pick(rand, [paint("--paint-red-3"), paint("--paint-blue-12"), paint("--paint-earth-45"), paint("--paint-light-1")]), -0.4, 0, 2.1, 8, 0);
  }
  kit.place(k.merged(), x, 0, z, ry);
}
/** A filling station: a canopy on posts over two pumps, its shop behind, its sign by the road. */
export function fillingStation(kit: Kit, rand: Rand, x: number, z: number, ry: number): void {
  const k = new Kit();
  const brand = pick(rand, [paint("--paint-red-3"), paint("--paint-green-24"), paint("--paint-earth-52"), paint("--paint-blue-15")]);
  for (const [px, pz] of [[-5, -3], [5, -3], [-5, 3], [5, 3]] as const) k.box(0.4, 4.5, 0.4, paint("--paint-earth-10"), px, pz);
  // The canopy's roof above its coloured fascia: their faces never level with each other (they
  // shared a top and flickered: "those green roofs, they are like glitching").
  k.box(12, 0.35, 8, paint("--paint-light-4"), 0, 0, 4.85);
  k.box(12.3, 0.45, 8.3, brand, 0, 0, 4.4);
  for (const px of [-2.5, 2.5]) k.box(0.8, 1.6, 0.6, brand, px, 0);
  k.box(8, 3.2, 5, paint("--paint-earth-7"), 0, -8);
  k.box(0.3, 6, 0.3, paint("--paint-grey-20"), 7.5, 5);
  k.box(1.8, 1.4, 0.3, brand, 7.5, 5, 6);
  kit.place(k.merged(), x, 0, z, ry);
}

// --- What you build at a town: each centred on (0, 0), its front toward +z, placed by view3d.ts ---

/** A motor park: a paved lot, danfos in rows, the union's shelter and its sign. */
export function motorPark(kit: Kit, rand: Rand, ry: number): void {
  const k = new Kit();
  k.box(30, 0.3, 20, paint("--paint-grey-8"));
  for (let row = 0; row < 2; row += 1) for (let i = 0; i < 6; i += 1) {
    k.box(2.2, 2, 4.8, rand() < 0.85 ? paint("--paint-earth-49") : paint("--paint-light-4"), -11 + i * 4.4, -4 + row * 9, 0.3);
    k.box(2.24, 0.25, 4.84, paint("--paint-dark-5"), -11 + i * 4.4, -4 + row * 9, 1.1);
  }
  k.box(12, 0.3, 4, paint("--paint-green-24"), 0, 8.5, 3.6);
  for (const px of [-5.5, 5.5]) k.box(0.3, 3.6, 0.3, paint("--paint-grey-20"), px, 8.5);
  k.box(0.3, 5, 0.3, paint("--paint-grey-20"), 14, 9);
  k.box(3, 1.4, 0.2, paint("--paint-green-24"), 14, 9, 5);
  kit.place(k.merged(), 0, 0, 0, ry);
}
/** A haulage yard: a fenced gravel lot, lorries, stacked goods, a gantry. */
export function haulageYard(kit: Kit, rand: Rand, ry: number): void {
  const k = new Kit();
  k.box(34, 0.25, 24, paint("--paint-earth-31"));
  for (const [w, d, x, z] of [[34, 0.3, 0, -12], [34, 0.3, 0, 12], [0.3, 24, -17, 0], [0.3, 24, 17, 0]] as const) k.box(w, 1.8, d, paint("--paint-grey-13"), x, z);
  for (let i = 0; i < 4; i += 1) {
    k.box(2.6, 2.6, 7, paint("--paint-earth-58"), -12 + i * 5, -5, 0.25);
    k.box(2.4, 2.4, 2.2, paint("--paint-earth-3"), -12 + i * 5, -0.3, 0.25);
  }
  for (let i = 0; i < 6; i += 1) k.box(3, 1.2 + rand() * 1.6, 3, pick(rand, [paint("--paint-earth-34"), paint("--paint-earth-54"), paint("--paint-blue-11"), paint("--paint-grey-2")]), 6 + (i % 3) * 3.6, 5 + Math.floor(i / 3) * 3.6, 0.25);
  for (const px of [3, 15]) k.box(0.6, 8, 0.6, paint("--paint-earth-52"), px, 0);
  k.box(13, 0.8, 0.8, paint("--paint-earth-52"), 9, 0, 8);
  kit.place(k.merged(), 0, 0, 0, ry);
}
/** A rail station: a platform along the track (+x), its house with a red roof. */
export function railStation(kit: Kit, rand: Rand, ry: number): void {
  const k = new Kit();
  k.box(40, 1, 4, paint("--paint-earth-14"));
  k.box(12, 4, 6, pick(rand, [paint("--paint-earth-5"), paint("--paint-earth-19"), paint("--paint-light-4")]), 0, 5.5);
  k.gable(12.6, 6.6, 2.4, paint("--paint-red-4"), 0, 5.5, 4);
  k.box(16, 0.25, 3, paint("--paint-red-4"), -14, 0, 3.6);
  for (const px of [-21, -7]) k.box(0.25, 2.6, 0.25, paint("--paint-grey-20"), px, 1, 1);
  kit.place(k.merged(), 0, 0, 0, ry);
}
/** A metro entrance: a glazed pavilion over the stairs, its blue M. */
export function metroEntrance(kit: Kit, ry: number): void {
  const k = new Kit();
  k.box(8, 0.3, 6, paint("--paint-earth-14"));
  k.box(7, 3, 4.5, paint("--paint-blue-5"), 0, 0, 0.3);
  k.box(7.6, 0.4, 5, paint("--paint-blue-17"), 0, 0, 3.3);
  k.box(0.3, 5, 0.3, paint("--paint-grey-20"), 4.5, 2.5);
  k.box(1.8, 1.8, 0.3, paint("--paint-blue-17"), 4.5, 2.5, 5);
  kit.place(k.merged(), 0, 0, 0, ry);
}
