// A dummy of the game in live 3D (lab3d.html, dev only): seed 2418's region as the game draws
// it -- its hills as relief, its rivers and coast, its roads and the home cluster's towns -- built
// from Quaternius's models (CC0) and lit live, with vehicles driving the roads and turning
// smoothly, and a camera you rotate, tilt and zoom. To see whether live 3D is worth it; the
// game's map stays 2D unless it is. No simulation: the vehicles just run the roads.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { GAME_MAP } from "../game/map";
import { regionInfo } from "@engine/game/region";
import { buildGameTerrain } from "@engine/game/terrain";

const M = 8; // metres a map cell
const HEIGHT = 7; // metres an elevation unit
const { map } = regionInfo(GAME_MAP, 2418);
const terrain = buildGameTerrain(map);
const W = map.width;
const H = map.height;
const box = map.home ?? { x: 0, y: 0, width: W, height: H };
const inHome = (t: { x: number; y: number }) => t.x >= box.x && t.x < box.x + box.width && t.y >= box.y && t.y < box.y + box.height;

// --- Renderer, scene, camera, light --------------------------------------------------------
const view = document.querySelector<HTMLElement>("#view")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.append(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
labels.domElement.style.position = "fixed";
labels.domElement.style.inset = "0";
labels.domElement.style.pointerEvents = "none";
view.append(labels.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe3ef);
scene.fog = new THREE.Fog(0xcfe3ef, 900, 2600);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 6000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-400, 700, -300); // from the north-west, as the 2D map's relief is lit
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const shadowBox = 500;
Object.assign(sun.shadow.camera, { left: -shadowBox, right: shadowBox, top: shadowBox, bottom: -shadowBox, near: 10, far: 2500 });
scene.add(sun);
scene.add(sun.target);

// Map cell (x east, y south) to the 3D world (x east, z south, y up), on the ground.
const elevationAt = (cx: number, cy: number) => {
  const x0 = Math.max(0, Math.min(W - 2, Math.floor(cx)));
  const y0 = Math.max(0, Math.min(H - 2, Math.floor(cy)));
  const tx = Math.max(0, Math.min(1, cx - x0));
  const ty = Math.max(0, Math.min(1, cy - y0));
  const e = (x: number, y: number) => terrain.elevation[y * W + x]!;
  return (e(x0, y0) * (1 - tx) + e(x0 + 1, y0) * tx) * (1 - ty) + (e(x0, y0 + 1) * (1 - tx) + e(x0 + 1, y0 + 1) * tx) * ty;
};
const ground = (cx: number, cy: number, lift = 0) => new THREE.Vector3(cx * M, elevationAt(cx, cy) * HEIGHT + lift, cy * M);

// --- The land: the map's elevation as relief, water where the map has it -------------------
{
  const geo = new THREE.PlaneGeometry(W * M, H * M, W - 1, H - 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(((W - 1) * M) / 2, 0, ((H - 1) * M) / 2);
  const pos = geo.attributes.position!;
  const colours = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xd8cfae), green = new THREE.Color(0x9fb27a), hill = new THREE.Color(0x7d8f62);
  for (let i = 0; i < pos.count; i += 1) {
    const cx = Math.round(pos.getX(i) / M);
    const cy = Math.round(pos.getZ(i) / M);
    const e = terrain.elevation[cy * W + cx] ?? 0;
    // Water is drawn from the rivers' own lines (below), smooth; the land under it is just land.
    pos.setY(i, e * HEIGHT);
    const c = e > 0.8 ? hill : green.clone().lerp(sand, 0.35);
    colours.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  const land = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  land.receiveShadow = true;
  scene.add(land);
}

// A ribbon along a polyline of cells, `width` metres, laid on the ground.
function ribbon(points: Array<{ x: number; y: number }>, width: number | number[], colour: number, lift: number): THREE.Mesh {
  // A width each point (in metres), narrowing and widening between them, as a river does.
  const widthAt = (k: number) => (Array.isArray(width) ? width[Math.min(width.length - 1, k)]! : width);
  const verts: number[] = [];
  const steps: Array<{ x: number; y: number; w: number }> = [];
  for (let k = 1; k < points.length; k += 1) {
    const a = points[k - 1]!, b = points[k]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5));
    for (let i = 0; i < n; i += 1) steps.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n, w: widthAt(k - 1) + ((widthAt(k) - widthAt(k - 1)) * i) / n });
  }
  steps.push({ ...points[points.length - 1]!, w: widthAt(points.length - 1) });
  for (let i = 0; i < steps.length; i += 1) {
    const p = steps[i]!, q = steps[Math.min(steps.length - 1, i + 1)]!, o = steps[Math.max(0, i - 1)]!;
    const dx = q.x - o.x, dy = q.y - o.y, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (p.w / M / 2), ny = (dx / len) * (p.w / M / 2);
    const l = ground(p.x + nx, p.y + ny, lift), r = ground(p.x - nx, p.y - ny, lift);
    verts.push(l.x, l.y, l.z, r.x, r.y, r.z);
  }
  const index: number[] = [];
  for (let i = 0; i < steps.length - 1; i += 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  return mesh;
}

// --- Water: the rivers and the coast from their own lines (terrain.ts makes the cells from them) ---
for (const river of map.terrain?.rivers ?? []) {
  const widths = (river.widths ?? river.points.map(() => river.width)).map((w) => w * M);
  scene.add(ribbon(river.points.map(([x, y]) => ({ x, y })), widths, 0x6fa9cf, 0.6));
}

// --- Roads: the map's, along their lines -------------------------------------------------
const townAt = new Map(map.towns.map((t) => [t.id, t]));
const roadLines: Array<Array<{ x: number; y: number }>> = [];
for (const road of map.roads) {
  const a = townAt.get(road.a), b = townAt.get(road.b);
  if (!a || !b) continue;
  const line = [{ x: a.x, y: a.y }, ...(road.via ?? []).map(([x, y]) => ({ x, y })), { x: b.x, y: b.y }];
  roadLines.push(line);
  scene.add(ribbon(line, 9, 0x6e6f70, 0.35));
}

// --- Models: Quaternius (CC0), coloured by part for vehicles, as the 2D map's colours -------
const GLASS = "#bfe3f5", TYRE = "#2b2b2b", LIGHT = "#ffe9a0", TRIM = "#5a5f66";
const van = (body: string, stripe: string): Record<string, string> => ({ White: body, Red: stripe, Grey: TRIM, Material: TYRE, Bumper: TRIM, Lights: LIGHT, Windows: GLASS });
const busColours = (body: string): Record<string, string> => ({ Material: body, Top: body, Bottom: TYRE, Bumper: TRIM, Details: "#f4f4f4", Lights: LIGHT, Windows: GLASS });
async function model(file: string, len: number, colours?: Record<string, string>): Promise<THREE.Object3D> {
  const [dir, name] = file.split("/") as [string, string];
  const mats = await new MTLLoader().setPath(`/models/q/${dir}/`).loadAsync(`${name}.mtl`);
  mats.preload();
  const obj = await new OBJLoader().setMaterials(mats).setPath(`/models/q/${dir}/`).loadAsync(`${name}.obj`);
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const list = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
      const c = (m as THREE.MeshPhongMaterial).clone();
      const want = colours?.[m.name];
      if (want) c.color = new THREE.Color(want);
      else c.color.convertLinearToSRGB();
      c.shininess = 6;
      c.flatShading = true;
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? list : list[0]!;
  });
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  obj.scale.setScalar(len / Math.max(size.x, size.z));
  const b = new THREE.Box3().setFromObject(obj);
  const c = b.getCenter(new THREE.Vector3());
  obj.position.sub(new THREE.Vector3(c.x, b.min.y, c.z));
  // Face +x (east): the transport pack faces -x (the bake found it), so half a turn.
  const holder = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(obj);
  if (size.x < size.z) inner.rotation.y = Math.PI / 2;
  inner.rotation.y += Math.PI;
  holder.add(inner);
  return holder;
}

const TIERS = { village: 15, regional: 45 };
const tierOf = (pop: number, city: boolean) => (city ? "city" : pop >= TIERS.regional ? "regional" : pop >= TIERS.village ? "town" : "village");
const MIX: Record<string, Array<[string, number]>> = {
  village: [["farmbuildings/SmallBarn", 2], ["farmbuildings/OpenBarn", 1], ["buildings/House2", 3], ["farmbuildings/Silo_House", 1], ["farmbuildings/Well", 1]],
  town: [["buildings/House1", 6], ["buildings/House2", 6], ["buildings/Building1_Small", 2], ["buildings/Building2_Small", 2], ["farmbuildings/WaterTower", 1]],
  regional: [["buildings/Building1_Small", 4], ["buildings/Building2_Small", 4], ["buildings/Building3_Small", 3], ["buildings/Building4", 3], ["buildings/Building1_Large", 2], ["buildings/House1", 6], ["buildings/House2", 6]],
  city: [["buildings/Building3_Big", 4], ["buildings/Building2_Large", 4], ["buildings/Building1_Large", 4], ["buildings/Building4", 5], ["buildings/Building3_Small", 5], ["buildings/Building1_Small", 5], ["buildings/House1", 6], ["buildings/House2", 6]],
};
const LENGTHS: Record<string, number> = { Building1_Large: 22, Building1_Small: 12, Building2_Large: 22, Building2_Small: 12, Building3_Big: 24, Building3_Small: 12, Building4: 14, House1: 9, House2: 9, SmallBarn: 9, OpenBarn: 10, Silo_House: 8, Well: 2, WaterTower: 4 };
const RADIUS: Record<string, number> = { village: 30, town: 50, regional: 70, city: 95 };

async function build(): Promise<void> {
  // Each building model once; towns clone them (geometry shared).
  const kinds = new Set(Object.values(MIX).flat().map(([f]) => f));
  const proto = new Map<string, THREE.Object3D>();
  for (const f of kinds) proto.set(f, await model(f, LENGTHS[f.split("/")[1]!] ?? 10));
  const city = map.towns.reduce((big, t) => (t.population > big.population ? t : big));
  for (const town of map.towns.filter(inHome)) {
    const tier = tierOf(town.population, town.id === city.id);
    let s = [...town.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) || 1;
    const rand = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
    const placed: Array<{ x: number; z: number; r: number }> = [];
    for (const [file, count] of MIX[tier]!) {
      for (let i = 0; i < count; i += 1) {
        const r = (LENGTHS[file.split("/")[1]!] ?? 10) * 0.75;
        for (let tries = 0; tries < 40; tries += 1) {
          const a = rand() * Math.PI * 2;
          const d = (r > 14 ? 0.45 : 1) * RADIUS[tier]! * Math.sqrt(rand());
          const x = Math.cos(a) * d, z = Math.sin(a) * d;
          if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r)) continue;
          placed.push({ x, z, r });
          const b = proto.get(file)!.clone();
          const at = ground(town.x + x / M, town.y + z / M);
          b.position.copy(at);
          b.rotation.y = Math.floor(rand() * 4) * (Math.PI / 2);
          scene.add(b);
          break;
        }
      }
    }
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = `${town.name} · ${Math.round(town.population)}k`;
    const tag = new CSS2DObject(label);
    tag.position.copy(ground(town.x, town.y, 40));
    scene.add(tag);
  }

  // Vehicles: each runs a road there and back, turning smoothly along it.
  const fleet: Array<[string, number, Record<string, string> | undefined, number]> = [
    ["publictransport/Bus", 12, busColours("#2a78d6"), 8], ["publictransport/Bus", 14, busColours("#c0392b"), 3],
    ["publictransport/Ambulance", 5.5, van("#e8b400", "#1e1e1e"), 16], ["publictransport/Ambulance", 5.5, van("#4f97e8", "#ffffff"), 5],
    ["publictransport/Ambulance", 7.5, van("#8a5a2b", "#6b4520"), 10], ["cars/Taxi", 3, { Yellow: "#3fa34d" }, 10],
  ];
  const homeRoads = roadLines.filter((l) => inHome(l[0]!) && inHome(l[l.length - 1]!));
  for (const [file, len, colours, count] of fleet) {
    const proto2 = await model(file, len * 1.6, colours);
    for (let i = 0; i < count; i += 1) {
      const line = homeRoads[(i * 7 + count) % homeRoads.length]!;
      const lengths = line.slice(1).map((p, k) => Math.hypot(p.x - line[k]!.x, p.y - line[k]!.y));
      const total = lengths.reduce((a, b) => a + b, 0);
      const v = proto2.clone();
      scene.add(v);
      runners.push({ v, line, lengths, total, t: Math.random(), speed: (len > 10 ? 1.4 : 2) / Math.max(1, total), dir: i % 2 ? 1 : -1 });
    }
  }
}
const runners: Array<{ v: THREE.Object3D; line: Array<{ x: number; y: number }>; lengths: number[]; total: number; t: number; speed: number; dir: number }> = [];
/** A point a share `t` along a polyline, and its heading. */
function along(line: Array<{ x: number; y: number }>, lengths: number[], total: number, t: number): { x: number; y: number; heading: number } {
  let d = t * total;
  for (let k = 0; k < lengths.length; k += 1) {
    if (d <= lengths[k]! || k === lengths.length - 1) {
      const a = line[k]!, b = line[k + 1]!;
      const f = lengths[k]! > 0 ? Math.min(1, d / lengths[k]!) : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, heading: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    d -= lengths[k]!;
  }
  return { ...line[0]!, heading: 0 };
}

// --- Frame the home city; run ---------------------------------------------------------------
const home = map.towns.reduce((big, t) => (t.population > big.population ? t : big));
const target = ground(home.x, home.y);
controls.target.copy(target);
camera.position.set(target.x + 260, target.y + 300, target.z + 260);
sun.target.position.copy(target);
sun.position.set(target.x - 400, 700, target.z - 300);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
});
const fps = document.querySelector("#fps")!;
let last = performance.now(), frames = 0, fpsAt = last;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const r of runners) {
    r.t += r.dir * r.speed * dt * 6;
    if (r.t > 1) { r.t = 1; r.dir = -1; }
    if (r.t < 0) { r.t = 0; r.dir = 1; }
    const p = along(r.line, r.lengths, r.total, r.t);
    // Keep to the right of travel; face the way it's going, turning smoothly.
    const heading = r.dir > 0 ? p.heading : p.heading + Math.PI;
    const side = 2.2 / M;
    const at = ground(p.x - Math.sin(heading) * side, p.y + Math.cos(heading) * side, 0.4);
    r.v.position.copy(at);
    const want = -heading;
    const diff = Math.atan2(Math.sin(want - r.v.rotation.y), Math.cos(want - r.v.rotation.y));
    r.v.rotation.y += diff * Math.min(1, dt * 8);
  }
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
  frames += 1;
  if (now - fpsAt > 1000) { fps.textContent = `${frames} frames a second · ${renderer.info.render.calls} draw calls`; frames = 0; fpsAt = now; }
  requestAnimationFrame(frame);
}
build().then(() => requestAnimationFrame(frame)).catch((e) => { document.querySelector("#hud")!.insertAdjacentHTML("beforeend", `<br><span style="color:#c92a2a">${String(e)}</span>`); });
