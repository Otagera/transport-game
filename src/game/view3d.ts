// The watch-only 3D view (decisions log 2026-10-25: live 3D in stages, beside the core game):
// your real game, as it runs, in three dimensions -- the land's relief and its rivers, every
// road coloured by how full it runs, each town built from procedural Nigerian buildings
// (shapes3d.ts) at the size it has grown to, the sites, and every vehicle the simulation has,
// where it has it. You watch here; you build on the 2D map. Loaded only when you switch to it
// (main.ts imports this module on demand), so three.js costs the 2D game nothing.
//
// Draw calls kept low: the land one mesh, the water one, each road one (its colour changes),
// each town one merged mesh, and each kind of vehicle one InstancedMesh.
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { GameTown, GameWorld } from "@engine/game/types";
import type { Vehicle } from "@engine/simulation/types";
import type { Segment } from "@engine/map/types";
import { privateLoad } from "@engine/game/private";
import { roadCapacity } from "@engine/game/congestion";
import { routingFor } from "@engine/game/rail";
import { polylineLength, segmentPolyline, splitPolyline, type Point } from "@engine/game/roads";
import { inHome } from "@engine/game/fuel";
import { growthTrend } from "@engine/game/growth";
import { MIN_CONDITION } from "@engine/map/decay";
import { isFlooded } from "@engine/game/floods";
import { isWater } from "@engine/pathing/terrainAStar";
import { tierOf, type Tier } from "./icons";
import type { Focus } from "./render";
import { steadyOver, steadyShortage } from "./steady";
import { treeGeometry, type TreeKind } from "./shapes3d";
import { farmTowns } from "@engine/game/food";
import { inFarmBelt } from "@engine/game/clusters";
import { BLOCK_WALLS, CONCRETE, ROOFS, WALLS, WINDOWS, fillingStation, fuelSeller, haulageYard, kiosk, metroEntrance, motorPark, railStation } from "./shapes3d";
import { labelOf, routeLabelKey } from "@engine/game/labels";
import { Kit, block, bungalow, church, hut, market, mosque, seeded, shophouse, site, vehicleGeometry, type VehicleKind3D } from "./shapes3d";

const M = 8; // metres a map cell
// Metres an elevation unit. The map's cells stand for far more than the 8 m they're drawn at,
// so the hills are drawn low: at 7 m a unit, a 2D map's gentle hill stood up as a spike (your
// playtest, 2026-10-26: "see another mountain in 3D").
const HEIGHT = 2.2;
const VEHICLE_SCALE = 1.6; // a little larger than life, to be seen from above
// Haze as distance does it (aerial perspective), not a flat fog: colour drains first, then the land
// goes to a warm harmattan haze near and a cool blue far off. Patched into three's fog chunk once;
// three.js is this module's alone (main.ts loads it on demand).
THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  float drain = smoothstep( fogNear * 0.7, fogFar, vFogDepth );
  float grey = dot( gl_FragColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( grey ), drain * 0.3 );
  vec3 haze = mix( fogColor, vec3( 0.70, 0.79, 0.88 ), smoothstep( fogNear, fogFar * 1.15, vFogDepth ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, haze, fogFactor );
#endif
`;

// --- Water (2026-10-29, after Ultra-Water's ideas, in this map's look) ------------------------
// A flat colour until now. A shader of its own: shallow at the banks, deep mid-channel; ripples
// that run downstream along each river, faster where it narrows; a soft band of foam where it meets
// land (not at the map's cut edge, where the sea is clamped); sun glints and a little sky at low
// angles; moonlight at night. Shaded as if the surface faced straight up with the ripples on top,
// never from the mesh's normals: the sea's wide ribbon folds over itself at sharp bends, and lit
// by its own normals those folds showed as dark slivers (why it was unlit).

const WATER_DAY = { deep: 0x3f86b4, shallow: 0x7fbdd2, sky: 0xd6e6ee, foam: 0xeae6da, glint: 0xfff4dc, glintStrength: 0.55 };
const WATER_NIGHT = { deep: 0x15253c, shallow: 0x253f5c, sky: 0x2a3450, foam: 0x4f5b6a, glint: 0xb8c8ff, glintStrength: 0.35 };
const waterMaterials = new Set<THREE.ShaderMaterial>();

function makeWaterMaterial(): THREE.ShaderMaterial {
  const c = (hex: number) => new THREE.Color(hex);
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(-520, 520, -260).normalize() },
      uDeep: { value: c(WATER_DAY.deep) },
      uShallow: { value: c(WATER_DAY.shallow) },
      uSky: { value: c(WATER_DAY.sky) },
      uFoam: { value: c(WATER_DAY.foam) },
      uGlint: { value: c(WATER_DAY.glint) },
      uGlintStrength: { value: WATER_DAY.glintStrength },
    },
    vertexShader: /* glsl */ `
      attribute float aAcross;
      attribute float aAlong;
      attribute float aWidth;
      attribute vec2 aShore;
      varying float vAcross;
      varying float vAlong;
      varying float vWidth;
      varying vec2 vShore;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vAcross = aAcross;
        vAlong = aAlong;
        vWidth = aWidth;
        vShore = aShore;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSun;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSky;
      uniform vec3 uFoam;
      uniform vec3 uGlint;
      uniform float uGlintStrength;
      varying float vAcross;
      varying float vAlong;
      varying float vWidth;
      varying vec2 vShore;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      // Ripples in the river's own frame (metres along, metres across), carried downstream.
      float ripples(vec2 p, float flow) {
        vec2 q = p - vec2(flow, 0.0);
        return noise(q * vec2(0.09, 0.16)) * 0.6 + noise(q * vec2(0.27, 0.45) + 7.3) * 0.3 + noise(q * 0.8 + 3.1) * 0.1;
      }
      void main() {
        float metres = vWidth; // ribbons are built in metres (a cell is 8 m)
        bool sea = metres > 96.0;
        // Narrower runs faster; the sea barely drifts.
        float speed = sea ? 0.4 : clamp(144.0 / max(metres, 8.0), 2.0, 9.0);
        vec2 p = vec2(vAlong, vAcross * metres * 0.5);
        float flow = uTime * speed;
        float h = ripples(p, flow);
        float e = 0.6;
        vec2 grad = vec2(ripples(p + vec2(e, 0.0), flow) - h, ripples(p + vec2(0.0, e), flow) - h) / e;
        vec3 n = normalize(vec3(-grad.x * 0.9, 1.0, -grad.y * 0.9));
        // Shallow at the banks, deep mid-channel; the sea deepens away from its shore.
        float edge = abs(vAcross);
        float shoreSide = vAcross < 0.0 ? vShore.x : vShore.y;
        float toShore = sea ? (shoreSide > 0.5 ? 1.0 - edge : 1.0) * metres * 0.5 : (1.0 - edge) * metres * 0.5;
        float depth = smoothstep(0.0, sea ? 90.0 : max(6.0, metres * 0.35), toShore);
        vec3 col = mix(uShallow, uDeep, depth);
        // A little sky at low angles, and the sun's glint.
        vec3 view = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(n, view), 0.0), 4.0);
        col = mix(col, uSky, fresnel * 0.55);
        float glint = pow(max(dot(reflect(-uSun, n), view), 0.0), 400.0);
        col += uGlint * glint * uGlintStrength;
        // Foam where it meets land: a soft band, broken up and drifting with the water.
        float band = (1.0 - smoothstep(0.0, sea ? 4.0 : max(0.8, metres * 0.07), toShore)) * (sea ? shoreSide : 1.0);
        float lace = smoothstep(0.55, 0.8, noise(p * vec2(0.35, 0.6) - vec2(flow * 0.6, uTime * 0.3)));
        col = mix(col, uFoam, band * (0.2 + 0.4 * lace));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  waterMaterials.clear(); // one view built at a time: its water's clock
  waterMaterials.add(material);
  return material;
}

function setWaterNight(material: THREE.ShaderMaterial, night: boolean): void {
  const look = night ? WATER_NIGHT : WATER_DAY;
  const u = material.uniforms;
  u.uDeep!.value.setHex(look.deep);
  u.uShallow!.value.setHex(look.shallow);
  u.uSky!.value.setHex(look.sky);
  u.uFoam!.value.setHex(look.foam);
  u.uGlint!.value.setHex(look.glint);
  u.uGlintStrength!.value = look.glintStrength;
}

/** A town's own streets (townKit): paler than the roads between towns, so those still lead. */
const STREET_DIRT = 0xae855e;
const STREET_PAVED = 0x77797b;
/**
 * The land by the map's region (world.region; map version 4 draws its shape, this its look): the
 * plain's dry and green, the banks, high ground, how dry the plain leans and how thick the trees.
 * The north dry and open, the south-south lush, the Middle Belt's high ground grey rock.
 */
const BIOMES: Record<string, { dry: number; green: number; bank: number; high: number; dryness: number; trees: number }> = {
  southwest: { dry: 0xc6b783, green: 0x9fb27a, bank: 0x7c9a55, high: 0x7d8f62, dryness: 0, trees: 1 },
  southeast: { dry: 0xb9b47f, green: 0x8fae68, bank: 0x6f9450, high: 0x6c8a52, dryness: -0.12, trees: 1.35 },
  southSouth: { dry: 0xadb57c, green: 0x84a75f, bank: 0x5c8846, high: 0x6c8a52, dryness: -0.28, trees: 1.7 },
  middleBelt: { dry: 0xc6b783, green: 0x9fb27a, bank: 0x7c9a55, high: 0x948e80, dryness: 0.05, trees: 0.9 },
  north: { dry: 0xd4bf8a, green: 0xb7b37c, bank: 0x8c9c5a, high: 0xa08f74, dryness: 0.32, trees: 0.45 },
  northeast: { dry: 0xd8c18c, green: 0xbab47c, bank: 0x8c9c5a, high: 0xa38f72, dryness: 0.38, trees: 0.4 },
};
const ROAD_COLOURS = { paved: 0x56585b, dirt: 0xa47a55, busy: 0xd99a2b, jammed: 0xc8553d, retired: 0xb9b2a4, flooded: 0x2a6f97 };
/** A selection: your colour (the 2D map's --you), lit on what it's connected to; the rest toward the ground's pale. */
const FOCUS_COLOUR = 0x2a78d6;
const FADED_TO = new THREE.Color(0xd9d3c4);

export interface View3D {
  /** Show it, built for this world (rebuilt if the world is a new one). */
  show(world: GameWorld): void;
  hide(): void;
  /**
   * Draw a frame: the vehicles where they are now; roads and towns as they've changed. With a
   * focus (render.ts focusFor: a selected town or route), what it's connected to stands out.
   */
  frame(world: GameWorld, focus?: Focus | null, selected?: string | null): void;
  readonly shown: boolean;
  /** Turn round the point in view, or tilt toward the horizon (+) or overhead (−), eased over a few frames. */
  turn(radians: number): void;
  tilt(radians: number): void;
  /** Day or night: the light, the sky, lit windows. */
  setNight(night: boolean): void;
}

/** `onPick`: a town or site clicked (its mesh or its label) -- main.ts opens its panel. */
export function createView3D(onPick: (townId: string) => void = () => {}): View3D {
  const host = document.createElement("div");
  host.id = "view3d";
  host.style.cssText = "position:fixed;inset:0;display:none;";
  document.querySelector("#map")!.after(host);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // A filmic grade: highlights roll off instead of clipping, the sun's warmth holds in the light.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  host.append(renderer.domElement);
  // A soft vignette: the eye settles on the middle, where the camera's looking.
  const vignette = document.createElement("div");
  vignette.style.cssText = "position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 48%, rgba(0,0,0,0) 55%, rgba(40,30,20,0.22) 100%);";
  host.append(vignette);
  const labels = new CSS2DRenderer();
  labels.domElement.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  host.append(labels.domElement);
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 8000);
  // A map's controls, not an orbit's (your playtest: "the zoom and panning in 3D is bad"): drag
  // moves the land under your hand, right-drag (or ctrl-drag) turns and tilts, the wheel zooms
  // toward the pointer. Panning stays level over the ground, whatever the tilt.
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = false;
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.minPolarAngle = 0.05;
  controls.zoomToCursor = true;
  controls.zoomSpeed = 1.4;
  // No closer than a block or two away: at 25 m a stall stood as big as a house and every prop
  // read as a toy (2026-10-28). And the closer in, the more it looks down: low, close in, the
  // camera sat among the buildings; low from further out, the skyline over the savanna is good.
  controls.minDistance = 120;
  controls.maxDistance = 2400;
  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    labels.setSize(innerWidth, innerHeight);
  };
  addEventListener("resize", resize);
  resize();
  // A click (not a drag that turned the camera) on a town's buildings picks it.
  const ray = new THREE.Raycaster();
  let down: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener("pointerdown", (event) => { down = { x: event.clientX, y: event.clientY }; });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 || !built) return;
    down = null;
    ray.setFromCamera(new THREE.Vector2((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1), camera);
    const hit = ray.intersectObjects(built.pickable, true)[0];
    let found: THREE.Object3D | null = hit?.object ?? null;
    while (found && !found.userData.townId) found = found.parent;
    const id = found?.userData.townId as string | undefined;
    if (id) onPick(id);
  });

  let built: Built | null = null;
  let shown = false;
  let lastSelected: string | null = null;
  let glideTo: THREE.Vector3 | null = null;
  let pendingTurn = 0, pendingTilt = 0;
  let night = false;
  // A drag of your own stops a glide.
  controls.addEventListener("start", () => (glideTo = null));
  return {
    get shown() {
      return shown;
    },
    turn(radians) {
      pendingTurn += radians;
    },
    tilt(radians) {
      pendingTilt += radians;
    },
    setNight(on) {
      night = on;
      built?.setNight(on);
    },
    show(world) {
      if (built?.world !== world) {
        built?.dispose();
        built = build(world, camera, controls, onPick);
        built.setNight(night);
      }
      host.style.display = "block";
      shown = true;
    },
    hide() {
      host.style.display = "none";
      shown = false;
    },
    frame(world, focus = null, selected = null) {
      if (!shown) return;
      if (built?.world !== world) this.show(world);
      built!.focus(focus, selected);
      built!.update(world);
      // A newly selected place: the camera glides over to it, keeping its angle and distance.
      if (selected !== lastSelected) {
        lastSelected = selected;
        glideTo = selected ? built!.centreOf(selected) : null;
      }
      if (glideTo) {
        const step = glideTo.clone().sub(controls.target).multiplyScalar(0.12);
        controls.target.add(step);
        camera.position.add(step);
        if (step.lengthSq() < 0.01) glideTo = null;
      }
      // Up close it looks down more (65° off vertical at the closest, 79° from ~370 m out). At 54°
      // to 620 m (the first cut) a camera zoomed in was already at its limit: "I can't tilt".
      const near = Math.min(1, Math.max(0, (camera.position.distanceTo(controls.target) - controls.minDistance) / 250));
      controls.maxPolarAngle = Math.PI * (0.36 + 0.08 * near);
      // A turn or tilt from the buttons, a fifth of what's left each frame.
      if (Math.abs(pendingTurn) > 1e-4 || Math.abs(pendingTilt) > 1e-4) {
        const turnStep = pendingTurn * 0.2, tiltStep = pendingTilt * 0.2;
        pendingTurn -= turnStep;
        pendingTilt -= tiltStep;
        const offset = camera.position.clone().sub(controls.target);
        const sph = new THREE.Spherical().setFromVector3(offset);
        sph.theta += turnStep;
        sph.phi = Math.max(controls.minPolarAngle, Math.min(controls.maxPolarAngle, sph.phi + tiltStep));
        camera.position.copy(controls.target).add(offset.setFromSpherical(sph));
      }
      controls.update();
      // The point you turn round stays over the land (a pan could carry the map off the screen,
      // leaving nothing but sky), and on the ground, over hill or valley.
      const { size } = built!;
      const keepX = Math.max(0, Math.min(size.x, controls.target.x)) - controls.target.x;
      const keepZ = Math.max(0, Math.min(size.z, controls.target.z)) - controls.target.z;
      controls.target.x += keepX;
      controls.target.z += keepZ;
      camera.position.x += keepX;
      camera.position.z += keepZ;
      const floor = built!.groundAt(controls.target.x, controls.target.z);
      const lift = floor - controls.target.y;
      controls.target.y += lift;
      camera.position.y += lift;
      built!.sky.position.copy(camera.position);
      const seconds = performance.now() / 1000;
      for (const water of waterMaterials) water.uniforms.uTime!.value = seconds;
      built!.cullLabels(camera);
      // The haze by how far out you are: in the distance up close, thin over the whole slab.
      const fog = built!.scene.fog as THREE.Fog;
      const away = camera.position.distanceTo(controls.target);
      fog.near = away * 1.1 + 300;
      fog.far = away * 3 + 1200;
      built!.sun.target.position.copy(controls.target);
      built!.sun.position.copy(controls.target).add(new THREE.Vector3(-520, 520, -260));
      renderer.render(built!.scene, camera);
      labels.render(built!.scene, camera);
    },
  };
}

interface Built {
  world: GameWorld;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  /** The towns' and sites' meshes, for a click. */
  pickable: THREE.Object3D[];
  /** The ground's height under a point of the 3D world. */
  groundAt(x: number, z: number): number;
  /** The land's extent (metres), to keep the camera over it. */
  size: { x: number; z: number };
  /** The sky, kept round the camera. */
  sky: THREE.Mesh;
  setNight(night: boolean): void;
  /** Labels shown only as near as they're readable: a village up close, the city from afar. */
  cullLabels(camera: THREE.Camera): void;
  /** What's selected and what it's connected to: those roads lit, the rest faded, a ring at the town. */
  focus(focus: Focus | null, selected: string | null): void;
  /** Where a town or site stands, on the ground; null when it isn't drawn. */
  centreOf(id: string): THREE.Vector3 | null;
  update(world: GameWorld): void;
  dispose(): void;
}

function build(world: GameWorld, camera: THREE.PerspectiveCamera, controls: MapControls, onPick: (townId: string) => void): Built {
  const { terrain } = world.simulation.map;
  const W = terrain.width;
  const H = terrain.height;
  const scene = new THREE.Scene();
  // A warm, lowish sun from the north-west (as the 2D map's relief is lit), a pale sky, and the
  // harmattan's haze in the distance.
  // A sky, not a flat colour: blue overhead, a warm haze at the horizon -- the fog's own colour,
  // so far land melts into it (with a blue-grey background and a beige fog, the land's far end
  // went to a beige wedge against the sky) -- and a cool blue-grey below it, round and under the
  // map, so the warm land stands off it (beige there, the slab sank into its backdrop).
  const HORIZON = 0xe4e0d2;
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 900, 3000);
  const hemi = new THREE.HemisphereLight(0xe8f0f8, 0x8a7a5a, 1.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d4, 2.5);
  sun.shadow.radius = 3;
  sun.shadow.bias = -0.0004;
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -500, right: 500, top: 500, bottom: -500, near: 10, far: 2500 });
  scene.add(sun, sun.target);

  // The ground's heights, blurred once: the map's cells are 8 m, and drawn as they are the
  // hills step like terraces. Everything stands on this field, so nothing floats or sinks.
  const field = new Float32Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        sum += terrain.elevation[yy * W + xx]!;
        n += 1;
      }
      field[y * W + x] = sum / n;
    }
  }
  // Map cell (x east, y south) to the 3D world (x east, z south, y up), on the ground.
  const elevationAt = (cx: number, cy: number) => {
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(cx)));
    const y0 = Math.max(0, Math.min(H - 2, Math.floor(cy)));
    const tx = Math.max(0, Math.min(1, cx - x0));
    const ty = Math.max(0, Math.min(1, cy - y0));
    const e = (x: number, y: number) => field[y * W + x]!;
    return (e(x0, y0) * (1 - tx) + e(x0 + 1, y0) * tx) * (1 - ty) + (e(x0, y0 + 1) * (1 - tx) + e(x0 + 1, y0 + 1) * tx) * ty;
  };
  const ground = (cx: number, cy: number, lift = 0) => new THREE.Vector3(cx * M, elevationAt(cx, cy) * HEIGHT + lift, cy * M);
  const disposables: Array<{ dispose(): void }> = [];
  const own = <T extends { dispose(): void }>(thing: T): T => (disposables.push(thing), thing);
  const skyGeo = new THREE.SphereGeometry(5000, 32, 24);
  skyGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position!.count * 3), 3));
  /** The sky's colours: overhead, at the horizon (the fog's too), and below it. */
  const paintSky = (zenithHex: number, horizonHex: number, belowHex: number) => {
    const zenith = new THREE.Color(zenithHex), horizon = new THREE.Color(horizonHex), below = new THREE.Color(belowHex), c = new THREE.Color();
    const pos = skyGeo.attributes.position!, colours = skyGeo.attributes.color!;
    for (let i = 0; i < pos.count; i += 1) {
      const up = pos.getY(i) / 5000;
      if (up >= 0) c.copy(horizon).lerp(zenith, Math.min(1, Math.pow(up, 0.6) * 1.1));
      else c.copy(horizon).lerp(below, Math.min(1, Math.pow(-up * 3, 0.7)));
      colours.setXYZ(i, c.r, c.g, c.b);
    }
    colours.needsUpdate = true;
    (scene.fog as THREE.Fog).color.setHex(horizonHex);
  };
  paintSky(0x9dbfdc, HORIZON, 0xbcc7d0);
  const sky = (() => {
    const geo = skyGeo;
    const mesh = new THREE.Mesh(own(geo), own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
    mesh.renderOrder = -1;
    scene.add(mesh);
    return mesh;
  })();
  // What's drawn unlit (a flat colour whatever the light), dimmed by hand at night.
  const edgeMaterial = own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const waterMaterial = own(makeWaterMaterial());
  // The blocks' windows: their own material, lit from inside at night.
  const windowMaterial = own(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const wetNear = (cx: number, cy: number) => {
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (isWater(terrain, Math.round(cx) + dx, Math.round(cy) + dy)) return true;
    return false;
  };

  /** How far out a town builds (metres): with its people, but not past its share of the gap to the next. */
  function reachOf(town: GameTown, tier: Tier, among: GameTown[]): { wanted: number; radius: number } {
    const wanted = (tier === "village" ? 3 : 4 + Math.sqrt(town.population) * 0.9) * M;
    let limit = Infinity;
    for (const t of among) {
      if (t.id === town.id) continue;
      const share = Math.sqrt(town.population) / (Math.sqrt(town.population) + Math.sqrt(t.population));
      limit = Math.min(limit, Math.hypot(t.x - town.x, t.y - town.y) * 0.85 * share);
    }
    return { wanted, radius: Math.min(wanted, Math.max(2.5, limit) * M) };
  }
  const startPeople = [...world.towns.values()].filter((t) => !t.industry);
  const startCity = startPeople.reduce<GameTown | null>((big, t) => (!big || t.population > big.population ? t : big), null)?.id;
  /** Each town's reach at the start, in cells: its red earth, and where its fields begin. */
  const reachCells = new Map(startPeople.map((t) => [t.id, reachOf(t, tierOf(t.population, t.id === startCity), startPeople).radius / M]));

  // How far each cell is from a river's bank (cells; 0 in the water): the gallery forest along
  // them, and their darker, greener banks.
  const bankDist = new Float32Array(W * H).fill(99);
  for (const river of world.waterLines ?? []) {
    for (let k = 1; k < river.points.length; k += 1) {
      const [ax, ay] = river.points[k - 1]!, [bx, by] = river.points[k]!;
      const half = ((river.widths?.[k - 1] ?? river.width) + (river.widths?.[k] ?? river.width)) / 4;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - half - 8)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + half + 8));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - half - 8)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + half + 8));
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
        const d = Math.max(0, distToSegment(x, y, { x: ax, y: ay }, { x: bx, y: by }) - half);
        if (d < bankDist[y * W + x]!) bankDist[y * W + x] = d;
      }
    }
  }
  // Soft patches across the land (value noise, seeded by the map): dry savanna and green.
  const noiseSeed = seeded(`land-${W}-${H}-${startPeople.map((t) => t.id).join("")}`);
  const LW = Math.ceil(W / 14) + 2;
  const lattice = Array.from({ length: LW * (Math.ceil(H / 14) + 2) }, () => noiseSeed());
  // Groves: the same noise finer, so trees stand in clumps with open ground between.
  const LG = Math.ceil(W / 5) + 2;
  const groveLattice = Array.from({ length: LG * (Math.ceil(H / 5) + 2) }, () => noiseSeed());
  const grove = (cx: number, cy: number) => {
    const gx = Math.max(0, cx) / 5, gy = Math.max(0, cy) / 5, x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = gx - x0, ty = gy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const v = (x: number, y: number) => groveLattice[y * LG + x] ?? 0.5;
    return (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
  };
  const patch = (cx: number, cy: number) => {
    const gx = Math.max(0, cx) / 14, gy = Math.max(0, cy) / 14, x0 = Math.floor(gx), y0 = Math.floor(gy);
    const tx = gx - x0, ty = gy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const v = (x: number, y: number) => lattice[y * LW + x] ?? 0.5;
    return (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
  };

  // --- The land: savanna in patches, greener by the rivers, red earth in the towns, olive on the hills
  // Painted, not coloured by vertex (2026-10-28, "the ground looks like stickers"): a vertex is
  // 4 m apart, so the land could only change colour in soft blobs, and the fields sat on it as
  // separate flat quads with hard edges. One texture instead, 8 px a cell: the broad colour
  // worked out at 2 px a cell and scaled up smooth, a grain over it, sandy banks along the
  // rivers, and the fields painted in once they're laid (plant).
  const PX = 8;
  const biome = BIOMES[world.region ?? "southwest"] ?? BIOMES.southwest!;
  const groundCanvas = document.createElement("canvas");
  groundCanvas.width = (W - 1) * PX;
  groundCanvas.height = (H - 1) * PX;
  const paint = groundCanvas.getContext("2d")!;
  const groundTexture = own(new THREE.CanvasTexture(groundCanvas));
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.anisotropy = 8;
  {
    const BASE = 2;
    const small = document.createElement("canvas");
    small.width = (W - 1) * BASE;
    small.height = (H - 1) * BASE;
    const image = small.getContext("2d")!.createImageData(small.width, small.height);
    // Each town's red earth, worked out over its own square only.
    const earthShare = new Float32Array(small.width * small.height);
    for (const t of startPeople) {
      const r = reachCells.get(t.id)!;
      for (let py = Math.max(0, Math.floor((t.y - r) * BASE)); py < Math.min(small.height, Math.ceil((t.y + r) * BASE)); py += 1) {
        for (let px = Math.max(0, Math.floor((t.x - r) * BASE)); px < Math.min(small.width, Math.ceil((t.x + r) * BASE)); px += 1) {
          const d = Math.hypot(t.x - (px + 0.5) / BASE, t.y - (py + 0.5) / BASE);
          if (d < r) earthShare[py * small.width + px] = Math.max(earthShare[py * small.width + px]!, 0.42 * (1 - (d / r) ** 2));
        }
      }
    }
    const top = terrain.elevation.reduce((m, e) => Math.max(m, e), 0) || 1;
    const high = new THREE.Color(biome.high), c = new THREE.Color(), rgb = { r: 0, g: 0, b: 0 };
    const dry = new THREE.Color(biome.dry), green = new THREE.Color(biome.green), bankGreen = new THREE.Color(biome.bank), earth = new THREE.Color(0xb98a62);
    for (let py = 0; py < small.height; py += 1) for (let px = 0; px < small.width; px += 1) {
      const cx = (px + 0.5) / BASE, cy = (py + 0.5) / BASE;
      c.copy(green).lerp(dry, Math.max(0, Math.min(1, (patch(cx, cy) - 0.3 + biome.dryness) * 1.8)));
      c.lerp(high, Math.min(1, elevationAt(cx, cy) / top) * 0.8);
      const bank = bankDist[Math.min(H - 1, Math.round(cy)) * W + Math.min(W - 1, Math.round(cx))]!;
      if (bank < 5) c.lerp(bankGreen, 0.7 * (1 - bank / 5));
      const e = earthShare[py * small.width + px]!;
      if (e > 0) c.lerp(earth, e);
      // three's colours are linear; a canvas holds sRGB (written as they were, the land came out dark).
      c.getRGB(rgb, THREE.SRGBColorSpace);
      const k = (py * small.width + px) * 4;
      image.data[k] = rgb.r * 255;
      image.data[k + 1] = rgb.g * 255;
      image.data[k + 2] = rgb.b * 255;
      image.data[k + 3] = 255;
    }
    small.getContext("2d")!.putImageData(image, 0, 0);
    paint.imageSmoothingEnabled = true;
    paint.imageSmoothingQuality = "high";
    paint.drawImage(small, 0, 0, groundCanvas.width, groundCanvas.height);
    // A grain: flecks a shade lighter and darker, so a plain reads as ground, not paint.
    const grain = document.createElement("canvas");
    grain.width = grain.height = 128;
    const g = grain.getContext("2d")!;
    const fleck = seeded(`grain-${W}-${H}`);
    for (let i = 0; i < 2600; i += 1) {
      g.fillStyle = fleck() < 0.5 ? `rgba(60,45,25,${0.05 + fleck() * 0.07})` : `rgba(255,250,230,${0.04 + fleck() * 0.06})`;
      g.fillRect(Math.floor(fleck() * 128), Math.floor(fleck() * 128), 1 + Math.floor(fleck() * 2), 1 + Math.floor(fleck() * 2));
    }
    paint.fillStyle = paint.createPattern(grain, "repeat")!;
    paint.fillRect(0, 0, groundCanvas.width, groundCanvas.height);
    // The rivers' banks, under their water: a darker damp margin, then pale sand at the edge.
    paint.lineJoin = paint.lineCap = "round";
    for (const [extra, style] of [[2.6, "rgba(70,90,45,0.28)"], [1.1, "rgba(214,196,150,0.95)"]] as const) {
      for (const river of world.waterLines ?? []) {
        for (let k = 1; k < river.points.length; k += 1) {
          const [ax, ay] = river.points[k - 1]!, [bx, by] = river.points[k]!;
          paint.strokeStyle = style;
          paint.lineWidth = (((river.widths?.[k - 1] ?? river.width) + (river.widths?.[k] ?? river.width)) / 2 + extra) * PX;
          paint.beginPath();
          paint.moveTo(ax * PX, ay * PX);
          paint.lineTo(bx * PX, by * PX);
          paint.stroke();
        }
      }
    }
    groundTexture.needsUpdate = true;
  }
  {
    const geo = own(new THREE.PlaneGeometry((W - 1) * M, (H - 1) * M, (W - 1) * 2, (H - 1) * 2));
    geo.rotateX(-Math.PI / 2);
    geo.translate(((W - 1) * M) / 2, 0, ((H - 1) * M) / 2);
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i += 1) pos.setY(i, elevationAt(pos.getX(i) / M, pos.getZ(i) / M) * HEIGHT);
    geo.computeVertexNormals();
    const land = new THREE.Mesh(geo, own(new THREE.MeshLambertMaterial({ map: groundTexture })));
    land.receiveShadow = true;
    scene.add(land);
    // The map's edge as a diorama's (your word: "good visuals for the cliff off"): the land
    // ends in a clean cut, its side showing the ground below -- topsoil, red laterite,
    // sandstone, rock -- rather than a plain running on, or the sea onto grass.
    // Crisp bands: each a depth and the colour down to the next (a grass lip, topsoil, red
    // laterite, sandstone, rock); a band's top and bottom rows apart, so its edges are sharp.
    // 90 m deep (2026-10-28: at 48 m under a 2 km slab it read as a sheet of card), and shaded by
    // side and depth rather than lit -- the face you mostly see looks south, away from the sun,
    // and lit it sat in shadow, its laterite and sandstone muddied to one brown.
    const BANDS: Array<[number, number]> = [[0, 0x6f8a45], [1, 0x5e4630], [4, 0xa65d3a], [24, 0xc9a36b], [52, 0x9a9083], [90, 0x8a8277]];
    const DEEPEST = 90;
    const SIDE_SHADE = [1, 0.8, 0.9, 0.94]; // north, east, south, west faces
    const STRATA: Array<[number, number]> = BANDS.slice(0, -1).flatMap(([depth, hex], k) => [[depth, hex], [BANDS[k + 1]![0] - 0.01, hex]] as Array<[number, number]>);
    const sides = [
      Array.from({ length: W }, (_, x) => ({ x, y: 0 })),
      Array.from({ length: H }, (_, y) => ({ x: W - 1, y })),
      Array.from({ length: W }, (_, x) => ({ x: W - 1 - x, y: H - 1 })),
      Array.from({ length: H }, (_, y) => ({ x: 0, y: H - 1 - y })),
    ];
    const verts: number[] = [], cols: number[] = [], index: number[] = [];
    const tint = new THREE.Color();
    sides.forEach((edge, side) => {
      const start = verts.length / 3;
      for (const p of edge) {
        const top = elevationAt(p.x, p.y) * HEIGHT + (terrain.water[p.y * W + p.x] === 1 ? 0.6 : 0);
        for (const [depth, hex] of STRATA) {
          verts.push(p.x * M, depth < 4 ? top - depth : Math.min(top - 4, -depth), p.y * M); // the lip and topsoil follow the ground
          tint.setHex(depth < 1 && terrain.water[p.y * W + p.x] === 1 ? 0x4f86ad : hex).multiplyScalar(SIDE_SHADE[side]! * (1 - 0.3 * (depth / DEEPEST)));
          cols.push(tint.r, tint.g, tint.b);
        }
      }
      const rows = STRATA.length;
      for (let i = 0; i < edge.length - 1; i += 1) for (let k = 0; k < rows - 1; k += 1) {
        const a = start + i * rows + k, b = a + rows;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    });
    const sideGeo = own(new THREE.BufferGeometry());
    sideGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    sideGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    sideGeo.setIndex(index);
    sideGeo.computeVertexNormals();
    scene.add(new THREE.Mesh(sideGeo, edgeMaterial));
    // Its underside, closed.
    const under = new THREE.Mesh(own(new THREE.PlaneGeometry((W - 1) * M, (H - 1) * M)), own(new THREE.MeshLambertMaterial({ color: 0x6f675e, side: THREE.DoubleSide })));
    under.rotation.x = -Math.PI / 2;
    under.position.set(((W - 1) * M) / 2, -DEEPEST, ((H - 1) * M) / 2);
    scene.add(under);
  }

  // A ribbon along a polyline of cells, `width` metres (one each point, or one for all).
  // Where a bridge deck runs, by cell: the vehicles on it ride it, not the river bed.
  const decks = new Map<number, number>();
  const cellKey = (cx: number, cy: number) => Math.round(cy) * W + Math.round(cx);
  /** `piers`: bridge it over water, its piers added to this kit. */
  function ribbonGeometry(points: Point[], width: number | number[], lift: number, piers?: Kit, clampToMap = false, water = false): THREE.BufferGeometry {
    const widthAt = (k: number) => (Array.isArray(width) ? width[Math.min(width.length - 1, k)]! : width);
    const steps: Array<{ x: number; y: number; w: number }> = [];
    for (let k = 1; k < points.length; k += 1) {
      const a = points[k - 1]!, b = points[k]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5));
      for (let i = 0; i < n; i += 1) steps.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n, w: widthAt(k - 1) + ((widthAt(k) - widthAt(k - 1)) * i) / n });
    }
    steps.push({ ...points[points.length - 1]!, w: widthAt(points.length - 1) });
    // A road over water rides a deck: level, a little above its higher bank, ramping up to it,
    // on piers. (The rivers are drawn on the ground; a road laid on them went under.)
    const deck: Array<number | null> = steps.map(() => null);
    if (piers) {
      const wet = steps.map((p) => wetNear(p.x, p.y));
      for (let i = 0; i < steps.length; i += 1) {
        if (!wet[i] || (i > 0 && wet[i - 1])) continue;
        let j = i;
        while (j + 1 < steps.length && wet[j + 1]) j += 1;
        const bank = (k: number) => elevationAt(steps[Math.max(0, Math.min(steps.length - 1, k))]!.x, steps[Math.max(0, Math.min(steps.length - 1, k))]!.y) * HEIGHT;
        const height = Math.max(bank(i - 1), bank(j + 1)) + 3;
        for (let k = i; k <= j; k += 1) deck[k] = height;
        // Ramps: two steps each side, from the bank up to the deck.
        for (let r = 1; r <= 2; r += 1) {
          for (const k of [i - r, j + r]) if (k >= 0 && k < steps.length && deck[k] === null) deck[k] = bank(k) + 3 * (1 - r / 3);
        }
        for (let k = i; k <= j; k += 2) {
          const p = steps[k]!;
          const foot = elevationAt(p.x, p.y) * HEIGHT - 1;
          piers.box(2, height - foot, 2, "#9a9488", p.x * M, p.y * M, foot);
        }
      }
    }
    const verts: number[] = [];
    // For water (waterMaterial): across its width (-1 one bank, 1 the other), metres along it, its
    // width, and whether each edge is a shore (not the map's cut edge, where the sea is clamped).
    const across: number[] = [], along: number[] = [], wide: number[] = [], shore: number[] = [];
    let run = 0;
    for (let i = 0; i < steps.length; i += 1) {
      const p = steps[i]!, q = steps[Math.min(steps.length - 1, i + 1)]!, o = steps[Math.max(0, i - 1)]!;
      if (i > 0) run += Math.hypot(p.x - steps[i - 1]!.x, p.y - steps[i - 1]!.y) * M;
      const dx = q.x - o.x, dy = q.y - o.y, len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (p.w / M / 2), ny = (dx / len) * (p.w / M / 2);
      const l = ground(p.x + nx, p.y + ny, lift), r = ground(p.x - nx, p.y - ny, lift);
      // A strip laid on a road (its lane, its centre line, a track's rails) rides the road's deck.
      if (!piers && !clampToMap) {
        const under = decks.get(cellKey(p.x, p.y));
        if (under !== undefined) { l.y = Math.max(l.y, under + 0.12); r.y = Math.max(r.y, under + 0.12); }
      }
      const level = deck[i];
      if (level !== null) {
        l.y = Math.max(l.y, level + lift);
        r.y = Math.max(r.y, level + lift);
        decks.set(cellKey(p.x, p.y), Math.max(decks.get(cellKey(p.x, p.y)) ?? -Infinity, level + lift));
      }
      const lx = l.x, lz = l.z, rx = r.x, rz = r.z;
      if (clampToMap) {
        // Water cut at the map's edge, as the land is: the sea runs to the diorama's side, not past it.
        for (const v of [l, r]) {
          v.x = Math.max(0, Math.min((W - 1) * M, v.x));
          v.z = Math.max(0, Math.min((H - 1) * M, v.z));
          v.y = elevationAt(v.x / M, v.z / M) * HEIGHT + lift;
        }
      }
      verts.push(l.x, l.y, l.z, r.x, r.y, r.z);
      if (water) {
        const leftShore = l.x === lx && l.z === lz ? 1 : 0, rightShore = r.x === rx && r.z === rz ? 1 : 0;
        across.push(-1, 1);
        along.push(run, run);
        wide.push(p.w, p.w);
        shore.push(leftShore, rightShore, leftShore, rightShore);
      }
    }
    const index: number[] = [];
    for (let i = 0; i < steps.length - 1; i += 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    if (water) {
      geo.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 1));
      geo.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
      geo.setAttribute("aWidth", new THREE.Float32BufferAttribute(wide, 1));
      geo.setAttribute("aShore", new THREE.Float32BufferAttribute(shore, 2));
    }
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  }

  // --- Water: the rivers and the coast from their own lines, as the 2D map draws them -------
  {
    // No shadows on the water: at a low sun they fell on it as long dark streaks (your
    // playtest, 2026-10-26: "the water glitching"). Drawn a hair toward the eye of the land.
    // Unlit, one flat colour: the sea is one wide ribbon, and where it bends sharply it folds
    // over itself -- lit, the folded triangles faced down and showed as dark slivers.
    const water = waterMaterial;
    for (const river of world.waterLines ?? []) {
      const widths = (river.widths ?? river.points.map(() => river.width)).map((w) => w * M);
      const mesh = new THREE.Mesh(own(ribbonGeometry(river.points.map(([x, y]) => ({ x, y })), widths, 0.6, undefined, true, true)), water);
      scene.add(mesh);
    }
  }

  // --- Roads: one mesh each, rebuilt when the network changes, recoloured as traffic does ----
  /** `line`, `lift`: where it runs and how high, for its focus line (drawn the first time it's lit). */
  const roads = new Map<string, { mesh: THREE.Mesh; material: THREE.MeshLambertMaterial; retired: boolean; rail: boolean; base: number; look: string; line: Point[]; lift: number; focusLine?: THREE.Mesh }>();
  const focusLineMaterial = own(new THREE.MeshBasicMaterial({ color: FOCUS_COLOUR, side: THREE.DoubleSide }));
  const railMaterial = own(new THREE.MeshLambertMaterial({ color: 0x3b3a38, side: THREE.DoubleSide }));
  // Every line a road runs (for keeping buildings off them).
  let roadLines: Point[][] = [];
  const pierMaterial = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const drop = (mesh: THREE.Mesh) => {
    scene.remove(mesh);
    mesh.geometry.dispose();
    for (const child of mesh.children) (child as THREE.Mesh).geometry?.dispose();
  };
  /** A polyline moved `off` cells to its left (negative: right), for a lane down a road's side. */
  function offsetLine(points: Point[], off: number): Point[] {
    return points.map((p, k) => {
      const a = points[Math.max(0, k - 1)]!, b = points[Math.min(points.length - 1, k + 1)]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: p.x - ((b.y - a.y) / len) * off, y: p.y + ((b.x - a.x) / len) * off };
    });
  }
  const laneMaterial = own(new THREE.MeshLambertMaterial({ color: 0xb8433a, side: THREE.DoubleSide }));
  const lineMaterial = own(new THREE.MeshBasicMaterial({ color: 0xf2efe6, side: THREE.DoubleSide }));
  /** What a road is drawn as: rebuilt when it changes -- paved, laned, retired (what you've done to it shows). */
  const roadLook = (segment: { retiredAt?: number; surface?: string; busLane?: boolean; type: string }) => `${segment.type}:${segment.retiredAt !== undefined}:${segment.surface ?? ""}:${!!segment.busLane}`;
  function syncRoads(w: GameWorld): void {
    const segments = w.simulation.map.segments;
    const seen = new Set<string>();
    for (const segment of segments) {
      seen.add(segment.id);
      const retired = segment.retiredAt !== undefined;
      const known = roads.get(segment.id);
      if (known && known.look === roadLook(segment)) continue;
      if (known) {
        drop(known.mesh);
        known.material.dispose();
      }
      const line = segmentPolyline(w.simulation.map, segment);
      const rail = segment.type === "rail";
      // Track: a ballast bed with the rails' dark band on it; a road: tarmac or dirt, coloured by its traffic.
      // A dirt road is laterite and narrower; a paved one is asphalt with a centre line; a bus lane
      // a red band down its side. What you've paved and laned reads from the air.
      const paved = segment.surface === "paved";
      const base = rail ? 0x9a9184 : retired ? ROAD_COLOURS.retired : paved ? ROAD_COLOURS.paved : ROAD_COLOURS.dirt;
      const material = new THREE.MeshLambertMaterial({ color: base, side: THREE.DoubleSide });
      // Each a hair above the last: two roads on one line don't flicker through each other.
      const piers = new Kit();
      const lift = 0.35 + (roads.size % 6) * 0.04;
      const mesh = new THREE.Mesh(ribbonGeometry(line, rail ? 6 : retired ? 5 : paved ? 10 : 7.5, lift, piers), material);
      mesh.receiveShadow = true;
      if (rail) mesh.add(new THREE.Mesh(ribbonGeometry(line, 2.6, lift + 0.25), railMaterial));
      if (!rail && !retired && paved) mesh.add(new THREE.Mesh(ribbonGeometry(line, 0.35, lift + 0.08), lineMaterial));
      if (!rail && !retired && segment.busLane) for (const side of [1, -1]) mesh.add(new THREE.Mesh(ribbonGeometry(offsetLine(line, (side * 3.4) / M), 2.4, lift + 0.06), laneMaterial));
      if (!piers.empty) {
        const legs = new THREE.Mesh(piers.merged(), pierMaterial);
        legs.castShadow = true;
        mesh.add(legs);
      }
      scene.add(mesh);
      roads.set(segment.id, { mesh, material, retired, rail, base, look: roadLook(segment), line, lift });
    }
    for (const [id, road] of roads) {
      if (seen.has(id)) continue;
      drop(road.mesh);
      road.material.dispose();
      roads.delete(id);
    }
    roadLines = segments.filter((s) => s.retiredAt === undefined).map((s) => segmentPolyline(w.simulation.map, s));
  }
  let focused: Focus | null = null;
  let selectedId: string | null = null;
  let focusKey = "";
  // A ring on the ground round the selected town, pulsing a little.
  const ringMaterial = own(new THREE.MeshBasicMaterial({ color: FOCUS_COLOUR, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
  const ring = new THREE.Mesh(own(new THREE.RingGeometry(0.96, 1, 96)), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 2;
  scene.add(ring);
  function colourRoads(w: GameWorld): void {
    for (const [id, road] of roads) {
      if (road.retired) continue;
      colourRoad(w, id, road);
      // A selected town's or route's roads carry a line in your colour down their middle; the
      // rest fade a little (outside review, 2026-10-26: selecting a place should show what it's
      // connected to, or 3D is scenery). The line, not the road: recoloured whole, 7.5-10 m of
      // glowing blue covered the map round a selection and hid each road's own traffic colour.
      const lit = !!focused?.segments.has(id);
      if (lit && !road.focusLine) {
        road.focusLine = new THREE.Mesh(ribbonGeometry(road.line, road.rail ? 1.6 : 2.2, road.lift + 0.35), focusLineMaterial);
        road.mesh.add(road.focusLine);
      }
      if (road.focusLine) road.focusLine.visible = lit;
      if (focused && !lit) road.material.color.lerp(FADED_TO, 0.45);
    }
  }
  function colourRoad(w: GameWorld, id: string, road: { material: THREE.MeshLambertMaterial; rail: boolean; base: number }): void {
    if (road.rail) {
      // Disused track fades, as on the 2D map.
      road.material.color.setHex(w.railOutOfService.has(id) ? 0xc9c2b4 : 0x9a9184);
      return;
    }
    const speed = w.segmentSpeed.get(id) ?? 1;
    const load = ((w.roadFlowEMA.get(id) ?? 0) + privateLoad(w, id)) / Math.max(1e-6, roadCapacity(w, id));
    // Grey when free, amber as it fills, red when jammed: the 2D map's road, in its weight too.
    // Under the flood (floods.ts): the water's colour.
    // Its own surface when free; tinted amber as it fills, red when jammed.
    if (isFlooded(w, id)) road.material.color.setHex(ROAD_COLOURS.flooded);
    else road.material.color.setHex(road.base).lerp(new THREE.Color(speed < 0.7 ? ROAD_COLOURS.jammed : speed < 0.9 || load > 0.8 ? ROAD_COLOURS.busy : road.base), 0.75);
  }

  // --- Towns: each one merged mesh, rebuilt when its tier or size step changes ------------
  /** `rank`: whose label wins where two would overlap (lower first): city, regional, town, village, site. */
  const towns = new Map<string, { mesh: THREE.Mesh; key: string; label: CSS2DObject; text: HTMLElement; reach: number; rank: number; size?: { w: number; h: number; text: string } }>();
  const RANK: Record<string, number> = { city: 0, regional: 1, town: 2, village: 3, site: 4 };
  // How far off (metres) each kind of label still shows.
  const REACH: Record<string, number> = { city: 3000, regional: 1500, town: 900, village: 420, site: 600 };
  const material = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  /** Whether a point (cells) is in a river as drawn, `pad` cells wide of it: for places near `at`. */
  function wetAround(at: { x: number; y: number }, reach: number): (x: number, y: number, pad: number) => boolean {
    const banks = (world.waterLines ?? []).flatMap((river) => river.points.slice(1).map((b, k) => ({ a: { x: river.points[k]![0], y: river.points[k]![1] }, b: { x: b[0], y: b[1] }, half: ((river.widths?.[k] ?? river.width) + (river.widths?.[k + 1] ?? river.width)) / 4 })))
      .filter(({ a, b }) => Math.min(Math.hypot(a.x - at.x, a.y - at.y), Math.hypot(b.x - at.x, b.y - at.y)) < reach);
    return (x, y, pad) => isWater(terrain, Math.round(x), Math.round(y)) || banks.some((s) => distToSegment(x, y, s.a, s.b) < s.half + pad);
  }
  /** Where each site's buildings stand (cells), once it's been set beside its roads. */
  const siteAt = new Map<string, { x: number; y: number }>();
  let sites: GameTown[] = [];
  let people: GameTown[] = [];
  /** A house of a town's fabric, in its town's frame: drawn as instances, walls and roof apart. */
  /** `floors`: a block's, each banded with windows (0 for a house). */
  interface House { x: number; y: number; z: number; w: number; d: number; h: number; rh: number; ry: number; floors: number; wall: string; roof: string }
  let fabric: House[] = [];
  /** A piece of a town's own street, in its town's frame: one plot long, laid along `ry`. */
  interface Street { x: number; y: number; z: number; long: number; wide: number; ry: number; colour: number }
  let streets: Street[] = [];
  function townKit(town: GameTown, tier: Tier, boom = false): Kit {
    fabric = [];
    streets = [];
    const rand = seeded(town.id);
    const kit = new Kit();
    const base = elevationAt(town.x, town.y) * HEIGHT;
    // How far out, and how many buildings: grows with its people -- but not into the next
    // town (a close pair read as one sprawl). The gap between them is shared by size, and a
    // town hemmed in builds denser, not out.
    const { wanted, radius } = reachOf(town, tier, people);
    const room = Math.max(0.4, radius / wanted);
    const count = Math.round(room * Math.min(160, tier === "village" ? 5 + town.population * 0.5 : 8 + town.population * 0.9));
    const grid = rand() * Math.PI; // the way its streets run
    // three turns about y the other way to the grid's cos/sin: a building faces its street at -grid
    // (at +grid every house stood mirrored to its grid -- unseen until the streets were drawn).
    const facing = -grid;
    // Keep off the roads: only those passing near this town are checked.
    const reachCells = radius / M + 3;
    const local = roadLines.filter((line) => line.some((p) => Math.hypot(p.x - town.x, p.y - town.y) < reachCells + 20));
    const nearRoad = (x: number, y: number, clear: number) =>
      local.some((line) => line.some((p, k) => k > 0 && distToSegment(x, y, line[k - 1]!, p) < clear));
    // And out of the rivers as they're drawn (their lines are wider than their wet cells).
    const wet = wetAround(town, reachCells * 1.5 + 30);
    const placed: Array<{ x: number; z: number; r: number }> = [];
    const put = (r: number, reach: number, make: (k: Kit, rr: () => number, ry: number) => void) => {
      for (let tries = 0; tries < 40; tries += 1) {
        const a = rand() * Math.PI * 2;
        // Further out the more tries fail: a centre full of roads pushes building outward.
        const d = reach * radius * Math.sqrt(rand()) * (1 + (tries / 40) * 0.6);
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        const cx = town.x + x / M, cy = town.y + z / M;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r)) continue;
        if (wet(cx, cy, (r + 2) / M) || nearRoad(cx, cy, (r + 6) / M)) continue;
        // Clear of the sites: a tank farm isn't in anyone's back yard.
        if (sites.some((s) => {
          const at = siteAt.get(s.id) ?? s;
          return Math.hypot(at.x - cx, at.y - cy) < (r + 24) / M;
        })) continue;
        placed.push({ x, z, r });
        const one = new Kit();
        make(one, rand, facing + (rand() < 0.8 ? 0 : Math.PI / 2));
        // Sunk a little where the ground falls away, so nothing floats.
        const y = Math.min(elevationAt(cx - r / M, cy), elevationAt(cx + r / M, cy), elevationAt(cx, cy - r / M), elevationAt(cx, cy + r / M)) * HEIGHT - base - 0.2;
        kit.place(one.merged(), x, y, z);
        return true;
      }
      return false;
    };
    // The centre first (the big things), then the rest outwards.
    if (tier !== "village") {
      put(14, 0.35, (k, rr) => market(k, rr, 0, 0, tier === "town" ? 6 : 12));
      put(12, 0.6, (k, rr) => (rand() < 0.5 ? mosque(k, rr, 0, 0, tier === "city" ? 1.4 : 1) : church(k, rr, 0, 0, tier === "city" ? 1.3 : 1)));
      if (tier !== "town") put(12, 0.6, (k, rr) => (rand() < 0.5 ? church(k, rr, 0, 0) : mosque(k, rr, 0, 0)));
    }
    // Its fabric (your word: "it all looks sparse"): houses packed on its street grid, densest
    // in the middle, thinning outwards, a lane every few plots; at its heart, blocks that rise
    // with its people. Drawn as instances, so a city can have hundreds. Size shows as density
    // and height, not spread: a cell is 8 m and towns stand 15-20 cells apart, so the capital
    // (135k, map 2418) had room for a radius of 88 m -- on a 10 m grid with a street every
    // third plot, 21 houses and ~75 buildings all told, fewer than a 95k town with no
    // neighbour (2026-10-28). Plots 8.5 m apart, a lane every fourth and fifth.
    if (tier !== "village") {
      const spacing = 8.5, cos = Math.cos(grid), sin = Math.sin(grid);
      const n = Math.ceil(radius / spacing);
      // A city is packed: fewer lanes, and it thins less toward its edge.
      const dense = tier === "city" ? 1 : tier === "regional" ? 0.88 : 0.72;
      const thins = tier === "city" ? 0.45 : 0.65;
      const lanes = tier === "city" ? [6, 5] : [5, 4];
      // The heart, and how high it rises: 135k up to 9 floors, 52k 6, 20k 4.
      const core = tier === "city" ? 0.65 : tier === "regional" ? 0.45 : 0.25;
      const tallest = Math.max(2, Math.round(1 + Math.sqrt(town.population) * 0.7));
      const built = new Set<string>();
      for (let i = -n; i <= n; i += 1) for (let j = -n; j <= n; j += 1) {
        if (i % lanes[0]! === 0 || j % lanes[1]! === 0) continue; // the lanes
        const lx = i * spacing + (rand() - 0.5) * 1.5, lz = j * spacing + (rand() - 0.5) * 1.5;
        const x = lx * cos - lz * sin, z = lx * sin + lz * cos;
        const d = Math.hypot(x, z) / radius;
        if (d > 1 || rand() > dense - thins * d ** 1.5) continue;
        const cx = town.x + x / M, cy = town.y + z / M, r = 3.6;
        if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r)) continue;
        if (wet(cx, cy, (r + 1) / M) || nearRoad(cx, cy, (r + 4) / M)) continue;
        if (sites.some((s) => { const at = siteAt.get(s.id) ?? s; return Math.hypot(at.x - cx, at.y - cy) < (r + 22) / M; })) continue;
        placed.push({ x, z, r: 3.2 });
        built.add(`${i},${j}`);
        const y = Math.min(elevationAt(cx - 0.4, cy), elevationAt(cx + 0.4, cy), elevationAt(cx, cy - 0.4), elevationAt(cx, cy + 0.4)) * HEIGHT - base - 0.2;
        const ry = facing + (rand() < 0.15 ? Math.PI / 2 : 0);
        if (d < core) {
          // A block: concrete, flat-roofed, its floors banded with windows, tallest in the middle.
          const t = 1 - d / core;
          const floors = Math.max(2, Math.round(2 + (tallest - 2) * t * (0.6 + 0.4 * rand())));
          fabric.push({
            x, y, z, w: 6.5 + rand() * 1.5, d: 6 + rand() * 1.5, h: 3 * floors, rh: 0.25, ry, floors,
            wall: BLOCK_WALLS[Math.floor(rand() * BLOCK_WALLS.length)]!, roof: CONCRETE[Math.floor(rand() * CONCRETE.length)]!,
          });
          continue;
        }
        const storeys = d < 0.6 && rand() < (tier === "city" ? 0.5 : 0.25) ? 2 : 1;
        const flat = rand() < (d < 0.4 ? 0.45 : 0.15);
        fabric.push({
          x, y, z, w: 5 + rand() * 2, d: 4.5 + rand() * 2, h: 3 * storeys, rh: flat ? 0.25 : 1.3 + rand() * 0.6, ry, floors: 0,
          wall: WALLS[Math.floor(rand() * WALLS.length)]!, roof: flat ? CONCRETE[Math.floor(rand() * CONCRETE.length)]! : ROOFS[Math.floor(rand() * ROOFS.length)]!,
        });
      }
      // Its streets: the grid's lanes, where they serve a house on either side -- a lane into
      // empty ground isn't one -- with one-plot gaps closed and lone pieces dropped, so they read
      // as a network, not dashes (a small town's lanes came out as scattered stubs). Paved in a
      // city's or regional town's heart, laterite elsewhere; a little narrower and paler than
      // the roads between towns, and under them where they cross.
      const has = (i: number, j: number) => built.has(`${i},${j}`);
      const laneI = (i: number) => i % lanes[0]! === 0, laneJ = (j: number) => j % lanes[1]! === 0;
      const serves = (i: number, j: number) =>
        laneI(i) && laneJ(j) ? has(i - 1, j - 1) || has(i + 1, j - 1) || has(i - 1, j + 1) || has(i + 1, j + 1)
        : laneI(i) ? has(i - 1, j) || has(i + 1, j)
        : laneJ(j) ? has(i, j - 1) || has(i, j + 1) : false;
      const street = new Set<string>();
      for (let i = -n; i <= n; i += 1) for (let j = -n; j <= n; j += 1) if (serves(i, j)) street.add(`${i},${j}`);
      const on = (i: number, j: number) => street.has(`${i},${j}`);
      // Gaps of one plot along a lane, closed.
      for (let i = -n; i <= n; i += 1) for (let j = -n; j <= n; j += 1) {
        if (on(i, j)) continue;
        if ((laneI(i) && on(i, j - 1) && on(i, j + 1)) || (laneJ(j) && on(i - 1, j) && on(i + 1, j))) street.add(`${i},${j}`);
      }
      // Joined to the roads into town: a run that stops short carries on along its lane, up to
      // three plots, if that reaches a road (houses stand back from the roads, so the streets
      // between them ended a plot or two short and the grid sat apart from the town's roads).
      // A town none of whose runs gets there takes its shortest way out, up to eight plots
      // (map 2418: Bida's and Kontagora's roads pass 50-60 m from their nearest street).
      const toRoad = (i: number, j: number, di: number, dj: number, most: number): string[] | null => {
        const path: string[] = [];
        for (let step = 1; step <= most; step += 1) {
          const a = i + di * step, b = j + dj * step;
          if (on(a, b)) return null;
          const lx = a * spacing, lz = b * spacing;
          const cx = town.x + (lx * cos - lz * sin) / M, cy = town.y + (lx * sin + lz * cos) / M;
          if (wet(cx, cy, 0.3)) return null;
          path.push(`${a},${b}`);
          if (nearRoad(cx, cy, 4 / M)) return path;
        }
        return null;
      };
      const ways = (most: number) => [...street].flatMap((key) => {
        const [i, j] = key.split(",").map(Number) as [number, number];
        const out: Array<string[] | null> = [];
        if (laneI(i)) for (const dj of [-1, 1]) if (!on(i, j + dj)) out.push(toRoad(i, j, 0, dj, most));
        if (laneJ(j)) for (const di of [-1, 1]) if (!on(i + di, j)) out.push(toRoad(i, j, di, 0, most));
        return out.filter((p): p is string[] => p !== null);
      });
      const short = ways(3);
      const joins = short.length > 0 ? short : ways(8).sort((a, b) => a.length - b.length).slice(0, 1);
      for (const path of joins) for (const key of path) street.add(key);
      // Each piece runs along its lane; a crossing, along whichever lanes go on from it.
      const alongJ = (i: number, j: number) => laneI(i) && (on(i, j - 1) || on(i, j + 1));
      const alongI = (i: number, j: number) => laneJ(j) && (on(i - 1, j) || on(i + 1, j));
      const lay = (i: number, j: number, along: "i" | "j") => {
        const lx = i * spacing, lz = j * spacing;
        const x = lx * cos - lz * sin, z = lx * sin + lz * cos;
        const cx = town.x + x / M, cy = town.y + z / M;
        if (wet(cx, cy, 0.3)) return;
        if (sites.some((s) => { const at = siteAt.get(s.id) ?? s; return Math.hypot(at.x - cx, at.y - cy) < 18 / M; })) return;
        const paved = tier !== "town" && Math.hypot(x, z) / radius < core;
        streets.push({
          x, z, y: elevationAt(cx, cy) * HEIGHT - base + 0.15, long: spacing + 0.4, wide: paved ? 4.6 : 4,
          ry: along === "i" ? facing : facing - Math.PI / 2, colour: paved ? STREET_PAVED : STREET_DIRT,
        });
      };
      for (const key of street) {
        const [i, j] = key.split(",").map(Number) as [number, number];
        const j_ = alongJ(i, j), i_ = alongI(i, j);
        if (j_) lay(i, j, "j");
        if (i_) lay(i, j, "i"); // neither: a lone piece, dropped
      }
      // Still not joined (its roads run alongside its lanes, never across them): a spur at its own
      // angle, from the street nearest a road to the nearest point on that road.
      if (joins.length === 0 && street.size > 0) {
        let best: { from: { x: number; z: number }; to: { x: number; z: number }; d: number } | null = null;
        for (const key of street) {
          const [i, j] = key.split(",").map(Number) as [number, number];
          const lx = i * spacing, lz = j * spacing;
          const x = lx * cos - lz * sin, z = lx * sin + lz * cos;
          const cx = town.x + x / M, cy = town.y + z / M;
          for (const line of local) for (let k = 1; k < line.length; k += 1) {
            const p = line[k - 1]!, q = line[k]!, dx = q.x - p.x, dy = q.y - p.y;
            const t = Math.max(0, Math.min(1, ((cx - p.x) * dx + (cy - p.y) * dy) / (dx * dx + dy * dy || 1)));
            const to = { x: (p.x + dx * t - town.x) * M, z: (p.y + dy * t - town.y) * M };
            const d = Math.hypot(to.x - x, to.z - z);
            if (!best || d < best.d) best = { from: { x, z }, to, d };
          }
        }
        if (best && best.d < 12 * spacing) {
          const mx = (best.from.x + best.to.x) / 2, mz = (best.from.z + best.to.z) / 2;
          const cx = town.x + mx / M, cy = town.y + mz / M;
          if (!wet(cx, cy, 0.3)) streets.push({
            x: mx, z: mz, y: elevationAt(cx, cy) * HEIGHT - base + 0.15, long: best.d + 2, wide: 4,
            ry: -Math.atan2(best.to.z - best.from.z, best.to.x - best.from.x), colour: STREET_DIRT,
          });
        }
      }
    }
    for (let i = 0; i < (tier === "village" ? count : Math.round(count * 0.7)); i += 1) {
      const centre = i < count * 0.25;
      if (tier === "village") put(5, 1, (k, rr, ry) => (rand() < 0.55 ? hut(k, rr, 0, 0) : bungalow(k, rr, 0, 0, ry)));
      else if (tier === "city" && centre) put(11, 0.45, (k, rr, ry) => block(k, rr, 0, 0, ry, 3, 9));
      else if (tier === "regional" && centre) put(10, 0.5, (k, rr, ry) => (rand() < 0.5 ? block(k, rr, 0, 0, ry, 2, 4) : shophouse(k, rr, 0, 0, ry)));
      else if (centre) put(7, 0.55, (k, rr, ry) => shophouse(k, rr, 0, 0, ry));
      else put(9, 1, (k, rr, ry) => (rand() < 0.75 ? bungalow(k, rr, 0, 0, ry) : shophouse(k, rr, 0, 0, ry)));
    }
    // A town growing past its size (growth.ts growthTrend): trade spills out -- more market
    // umbrellas and stalls through its streets. Placed last, so the rest of it stays put.
    if (boom && tier !== "village") {
      const extra = tier === "city" ? 10 : tier === "regional" ? 7 : 4;
      for (let i = 0; i < extra; i += 1) put(7, 0.75, (k, rr) => market(k, rr, 0, 0, 2 + Math.floor(rr() * 3)));
    }
    return kit;
  }
  function siteKit(town: GameTown): { kit: Kit; x: number; z: number } {
    // The roads into it run to its middle: it's set to one side of them (whichever side keeps
    // most of it), and any piece still on a road is left out.
    const local = roadLines.filter((line) => line.some((p) => Math.hypot(p.x - town.x, p.y - town.y) < 30));
    const wet = wetAround(town, 40);
    const kitAt = (ox: number, oz: number) => {
      const kit = new ClearKit((x, z, r) => {
        const cx = town.x + (x + ox) / M, cy = town.y + (z + oz) / M;
        return !wet(cx, cy, r / M) && !local.some((line) => line.some((p, k) => k > 0 && distToSegment(cx, cy, line[k - 1]!, p) < (r + 5) / M));
      });
      site(kit, seeded(town.id), town.industry!);
      return { kit, ox, oz };
    };
    let best = kitAt(0, 0);
    if (best.kit.dropped > 0) {
      for (let k = 0; k < 8 && best.kit.dropped > 0; k += 1) {
        const a = (k / 8) * Math.PI * 2;
        for (const reach of [16, 26]) {
          const next = kitAt(Math.cos(a) * reach, Math.sin(a) * reach);
          if (next.kit.dropped < best.kit.dropped) best = next;
        }
      }
    }
    siteAt.set(town.id, { x: town.x + best.ox / M, y: town.y + best.oz / M });
    return { kit: best.kit, x: best.ox, z: best.oz };
  }
  // The fabric's two shapes, shared: a unit box for walls, a unit hip roof.
  const wallShape = own(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const roofShape = own(new THREE.ConeGeometry(0.75, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0));
  const fabricMaterial = own(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  function houses(list: House[]): THREE.InstancedMesh[] {
    const walls = new THREE.InstancedMesh(wallShape, fabricMaterial, list.length);
    const roofs = new THREE.InstancedMesh(roofShape, fabricMaterial, list.length);
    // A block's windows: a dark band round each floor above the ground, a touch proud of the wall.
    const bands = new THREE.InstancedMesh(wallShape, windowMaterial, Math.max(1, list.reduce((n, h) => n + Math.max(0, h.floors - 1), 0)));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    let band = 0;
    list.forEach((h, i) => {
      q.setFromAxisAngle(up, h.ry);
      walls.setMatrixAt(i, m.compose(new THREE.Vector3(h.x, h.y, h.z), q, new THREE.Vector3(h.w, h.h, h.d)));
      roofs.setMatrixAt(i, m.compose(new THREE.Vector3(h.x, h.y + h.h, h.z), q, new THREE.Vector3(h.w * 1.04, h.rh, h.d * 1.04)));
      walls.setColorAt(i, c.set(h.wall));
      roofs.setColorAt(i, c.set(h.roof));
      for (let f = 1; f < h.floors; f += 1) {
        bands.setMatrixAt(band, m.compose(new THREE.Vector3(h.x, h.y + f * 3 + 1.1, h.z), q, new THREE.Vector3(h.w + 0.12, 0.9, h.d + 0.12)));
        bands.setColorAt(band, c.set(WINDOWS));
        band += 1;
      }
    });
    bands.count = band;
    for (const mesh of [walls, roofs, bands]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    return [walls, roofs, bands];
  }
  /** A town's streets: one instanced draw, a flat slab a plot long each. */
  function streetMesh(list: Street[]): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(wallShape, fabricMaterial, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    list.forEach((s, i) => {
      q.setFromAxisAngle(up, s.ry);
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, s.y - 0.12, s.z), q, new THREE.Vector3(s.long, 0.12, s.wide)));
      mesh.setColorAt(i, c.setHex(s.colour));
    });
    mesh.receiveShadow = true;
    return mesh;
  }
  /** A town's mesh gone: its fabric's instances with it (the shapes are shared, and stay). */
  function dropTown(mesh: THREE.Mesh): void {
    mesh.geometry.dispose();
    for (const child of mesh.children) (child as THREE.InstancedMesh).dispose?.();
  }
  function syncTowns(w: GameWorld): void {
    people = [...w.towns.values()].filter((t) => !t.industry);
    sites = [...w.towns.values()].filter((t) => t.industry);
    const cityId = people.reduce<GameTown | null>((big, t) => (!big || t.population > big.population ? t : big), null)?.id;
    // Sites first: the towns' buildings keep clear of where they've been set.
    for (const town of [...sites, ...people]) {
      const tier = town.industry ? "village" : tierOf(town.population, town.id === cityId);
      // A step every fifth of its size (or a tier change): a growing town rebuilds now and then.
      const boom = !town.industry && growthTrend(w, town.id) === "growing";
      const key = town.industry ? `site:${town.industry}` : `${tier}:${Math.round(Math.log(Math.max(1, town.population)) * 5)}${boom ? ":boom" : ""}`;
      const known = towns.get(town.id);
      if (known && known.key !== key) {
        scene.remove(known.mesh, known.label);
        dropTown(known.mesh);
        towns.delete(town.id);
      }
      if (!towns.has(town.id)) {
        const { kit, x, z } = town.industry ? siteKit(town) : { kit: townKit(town, tier, boom), x: 0, z: 0 };
        const mesh = new THREE.Mesh(kit.merged(), material);
        mesh.position.copy(ground(town.x, town.y)).add(new THREE.Vector3(x, 0, z));
        if (!town.industry && fabric.length) mesh.add(...houses(fabric));
        if (!town.industry && streets.length) mesh.add(streetMesh(streets));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.townId = town.id;
        scene.add(mesh);
        const text = document.createElement("div");
        text.className = town.industry ? "label3d site" : `label3d ${tier}`;
        text.addEventListener("click", () => onPick(town.id));
        const label = new CSS2DObject(text);
        label.position.copy(ground(town.x + x / M, town.y + z / M, town.industry ? 30 : 45));
        scene.add(label);
        towns.set(town.id, { mesh, key, label, text, reach: REACH[town.industry ? "site" : tier] ?? 900, rank: RANK[town.industry ? "site" : tier] ?? 4 });
      }
      const entry = towns.get(town.id)!;
      const words = town.industry ? town.name : `${town.name} · ${Math.round(town.population)}k`;
      if (entry.text.textContent !== words) entry.text.textContent = words;
    }
    for (const [id, entry] of towns) {
      if (w.towns.has(id)) continue;
      scene.remove(entry.mesh, entry.label);
      dropTown(entry.mesh);
      towns.delete(id);
    }
  }

  // --- Vehicles: one InstancedMesh a kind, grown as the fleet does --------------------------
  const vehicleMaterial = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const fleets = new Map<VehicleKind3D, THREE.InstancedMesh>();
  const fuelSites = new Set(["refinery", "newrefinery", "terminal", "depot", "oilfield"]);
  function kindOf(w: GameWorld, v: Vehicle): VehicleKind3D {
    const rail = w.railVehicles.has(v.id);
    if (v.lifecycle === "one-shot") {
      const mode = w.informal.active.get(v.id)?.mode ?? (v.id.startsWith("truck-") ? "truck" : "danfo");
      return mode === "keke" || mode === "okada" || mode === "danfo" ? mode : "truck";
    }
    if (v.carries === "goods") {
      if (rail) return "freight";
      const from = v.cargo[0]?.from;
      return from && fuelSites.has(w.towns.get(from)?.industry ?? "") ? "tanker" : "truck";
    }
    if (rail) return "train";
    return v.id.startsWith("minibus-") ? "minibus" : v.id.startsWith("brt-") ? "brt" : "bus";
  }
  function fleet(kind: VehicleKind3D, need: number): THREE.InstancedMesh {
    let mesh = fleets.get(kind);
    if (!mesh || mesh.instanceMatrix.count < need) {
      const size = Math.max(16, 2 ** Math.ceil(Math.log2(need)));
      const geometry = mesh?.geometry ?? own(vehicleGeometry(kind));
      if (mesh) {
        scene.remove(mesh);
        mesh.dispose();
      }
      mesh = new THREE.InstancedMesh(geometry, vehicleMaterial, size);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      fleets.set(kind, mesh);
    }
    return mesh;
  }
  const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), scale = new THREE.Vector3().setScalar(VEHICLE_SCALE), up = new THREE.Vector3(0, 1, 0);
  const headings = new Map<string, number>();
  let placedAt = performance.now();
  // Your vehicles in their route's colour where you've given it one (labels.ts), else their kind's.
  const tintColour = new THREE.Color();
  const KIND_TINT: Partial<Record<VehicleKind3D, string>> = { bus: "#2a78d6", minibus: "#4f97e8", brt: "#c0392b", train: "#2a78d6" };
  const tinted = new Set<VehicleKind3D>(["bus", "minibus", "brt", "train"]);
  // Laterite dust behind whatever drives a worn road: rough enough to cost your buses
  // (wear.ts roughCostFactor), it shows. One instanced mesh of puffs, three a vehicle.
  const DUST_MAX = 3000;
  const dust = new THREE.InstancedMesh(own(new THREE.IcosahedronGeometry(1, 1)), own(new THREE.MeshBasicMaterial({ color: 0xd8b48c, transparent: true, opacity: 0.22, depthWrite: false })), DUST_MAX);
  dust.frustumCulled = false;
  dust.count = 0;
  scene.add(dust);
  const puffAt = new THREE.Vector3(), puffScale = new THREE.Vector3(), still = new THREE.Quaternion();
  function placeVehicles(w: GameWorld): void {
    let puffs = 0;
    const routeOf = new Map<string, string>();
    for (const route of w.routes) for (const id of route.vehicleIds) routeOf.set(id, route.id);
    const now = performance.now();
    const turn = Math.min(1, ((now - placedAt) / 1000) * 10);
    placedAt = now;
    const seen = new Set<string>();
    const byKind = new Map<VehicleKind3D, Array<{ at: THREE.Vector3; heading: number; tint?: string }>>();
    for (const v of w.simulation.vehicles) {
      const pose = poseOf(w, v);
      if (!pose) continue;
      const kind = kindOf(w, v);
      // Keep right, as the 2D map does: opposite directions on one road don't overlap.
      const side = (kind === "train" || kind === "freight" ? 0 : 2.4) / M;
      const cx = pose.x - Math.sin(pose.angle) * side, cy = pose.y + Math.cos(pose.angle) * side;
      const at = ground(cx, cy, 0.4);
      const deck = decks.get(cellKey(cx, cy));
      if (deck !== undefined) at.y = Math.max(at.y, deck + 0.4);
      // Turn toward the way it's heading rather than snap: a corner reads as a turn.
      const was = headings.get(v.id);
      const heading = was === undefined ? pose.angle : was + Math.atan2(Math.sin(pose.angle - was), Math.cos(pose.angle - was)) * turn;
      headings.set(v.id, heading);
      seen.add(v.id);
      const road = kind === "train" || kind === "freight" ? null : segmentUnder(w, v);
      const rough = road && road.type === "road" ? (1 - road.condition) / (1 - MIN_CONDITION) : 0;
      if (rough > 0.45 && puffs + 3 <= DUST_MAX) {
        for (let i = 0; i < 3; i += 1) {
          const back = (2.5 + i * 2.2) * VEHICLE_SCALE;
          const swell = 0.8 + i * 0.7 + 0.25 * Math.sin(now / 180 + i * 2 + at.x);
          puffAt.set(at.x - Math.cos(heading) * back, at.y + 0.6 + i * 0.6, at.z - Math.sin(heading) * back);
          const size = swell * Math.min(1, rough * 1.4);
          dust.setMatrixAt(puffs++, matrix.compose(puffAt, still, puffScale.set(size * 1.3, size * 0.8, size * 1.3)));
        }
      }
      const route = routeOf.get(v.id);
      (byKind.get(kind) ?? byKind.set(kind, []).get(kind)!).push({ at, heading, tint: tinted.has(kind) ? (route && labelOf(w, routeLabelKey(route))?.colour) || KIND_TINT[kind] : undefined });
    }
    dust.count = puffs;
    dust.instanceMatrix.needsUpdate = true;
    for (const id of headings.keys()) if (!seen.has(id)) headings.delete(id);
    for (const [kind, mesh] of fleets) if (!byKind.has(kind)) mesh.count = 0;
    for (const [kind, list] of byKind) {
      const mesh = fleet(kind, list.length);
      list.forEach(({ at, heading, tint }, i) => {
        quat.setFromAxisAngle(up, -heading);
        mesh.setMatrixAt(i, matrix.compose(at, quat, scale));
        if (tint) mesh.setColorAt(i, tintColour.set(tint));
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  // --- Fields and trees: the land between the towns ------------------------------------------
  // What's where, a cell at a time, so neither lands on water, a road, a town or each other.
  const FREE = 0, WET = 1, ROAD = 2, TOWN = 3, FIELD = 4;
  const occupied = new Uint8Array(W * H);
  const markRoads = (lines: Point[][]) => {
    for (const line of lines) {
      for (let k = 1; k < line.length; k += 1) {
        const a = line[k - 1]!, b = line[k]!;
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
        for (let i = 0; i <= n; i += 1) {
          const x = Math.round(a.x + ((b.x - a.x) * i) / n), y = Math.round(a.y + ((b.y - a.y) * i) / n);
          if (x >= 0 && y >= 0 && x < W && y < H && occupied[y * W + x] !== WET) occupied[y * W + x] = ROAD;
        }
      }
    }
  };
  const treeMaterial = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const trees: Array<{ kind: TreeKind; cell: number; at: THREE.Matrix4 }> = [];
  const groves = new Map<TreeKind, THREE.InstancedMesh>();
  let planted = false;

  function plant(w: GameWorld): void {
    planted = true;
    const rand = seeded(`plant-${W}-${H}-${startPeople.map((t) => t.id).join("")}`);
    for (let i = 0; i < W * H; i += 1) if (terrain.water[i] === 1 || bankDist[i]! < 0.6) occupied[i] = WET;
    markRoads(roadLines);
    for (const t of [...w.towns.values()]) {
      const r = t.industry ? 3 : reachCells.get(t.id) ?? 3;
      for (let y = Math.max(0, Math.floor(t.y - r)); y <= Math.min(H - 1, Math.ceil(t.y + r)); y += 1)
        for (let x = Math.max(0, Math.floor(t.x - r)); x <= Math.min(W - 1, Math.ceil(t.x + r)); x += 1)
          if (Math.hypot(x - t.x, y - t.y) <= r && occupied[y * W + x] === FREE) occupied[y * W + x] = TOWN;
    }

    // Fields: a ring round each town, beyond its houses; farm towns (food.ts) farm more, and a
    // farm belt's (clusters.ts) most. Some in rows (ridged yam and maize), some plain.
    const farming = new Set(farmTowns(w).map((t) => t.id));
    // Painted into the ground (the land's texture), not laid on it as quads: those had hard
    // edges, cut into slopes at their corners, and their colours stood off the land like stickers.
    // Colours a step from the savanna's; corners nudged, so no field is a perfect rectangle.
    const PALETTE = ["#9fae69", "#b0b770", "#c4b27d", "#b39a6c", "#93a660", "#cbbd8c", "#a88a62"];
    const nudge = () => (rand() - 0.5) * 0.25;
    const quad = (corners: Point[], hex: string, alpha = 0.82) => {
      paint.globalAlpha = alpha;
      paint.fillStyle = hex;
      paint.beginPath();
      corners.forEach((p, k) => (k ? paint.lineTo((p.x + nudge()) * PX, (p.y + nudge()) * PX) : paint.moveTo((p.x + nudge()) * PX, (p.y + nudge()) * PX)));
      paint.closePath();
      paint.fill();
      paint.globalAlpha = 1;
    };
    for (const town of startPeople) {
      const r = reachCells.get(town.id) ?? 3;
      const keen = (farming.has(town.id) ? 1.8 : 1) * (inFarmBelt(w, town.id) ? 1.6 : 1);
      const ring = (3 + Math.sqrt(town.population) * 0.45) * keen;
      const tries = Math.round((25 + town.population * 0.8) * keen);
      const grid = rand() * Math.PI;
      for (let n = 0; n < tries; n += 1) {
        const a = rand() * Math.PI * 2, d = r + 0.5 + rand() * ring;
        const cx = town.x + Math.cos(a) * d, cy = town.y + Math.sin(a) * d;
        const fw = 1.2 + rand() * 2.4, fh = 1 + rand() * 1.8, turn = grid + (rand() - 0.5) * 0.3;
        const u = { x: Math.cos(turn), y: Math.sin(turn) }, v = { x: -u.y, y: u.x };
        const cells: number[] = [];
        let clear = true;
        for (let i = -fw / 2; i <= fw / 2 && clear; i += 0.5) for (let j = -fh / 2; j <= fh / 2 && clear; j += 0.5) {
          const x = Math.round(cx + u.x * i + v.x * j), y = Math.round(cy + u.y * i + v.y * j);
          if (x < 0 || y < 0 || x >= W || y >= H || occupied[y * W + x] !== FREE) clear = false;
          else cells.push(y * W + x);
        }
        if (!clear) continue;
        for (const c of cells) occupied[c] = FIELD;
        const at = (i: number, j: number) => ({ x: cx + u.x * i + v.x * j, y: cy + u.y * i + v.y * j });
        const hex = PALETTE[Math.floor(rand() * PALETTE.length)]!;
        const whole = [at(-fw / 2, -fh / 2), at(fw / 2, -fh / 2), at(fw / 2, fh / 2), at(-fw / 2, fh / 2)];
        quad(whole, hex);
        if (rand() < 0.5) {
          // In rows (ridged yam and maize): darker furrows across it, faint, a third of a cell apart.
          const strips = Math.max(2, Math.round(fw / 0.33));
          for (let k = 1; k < strips; k += 2) {
            const i0 = -fw / 2 + (fw * k) / strips, i1 = -fw / 2 + (fw * (k + 1)) / strips;
            quad([at(i0, -fh / 2), at(i1, -fh / 2), at(i1, fh / 2), at(i0, fh / 2)], "#7d6544", 0.22);
          }
        }
      }
    }
    groundTexture.needsUpdate = true;

    // Trees: thin on the open savanna, a gallery forest along the rivers, bush on the hills,
    // palms by the water and in the towns. Each kind one InstancedMesh.
    const top = terrain.elevation.reduce((m, e) => Math.max(m, e), 0) || 1;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const pick = (weights: Array<[TreeKind, number]>) => {
      let r = rand() * weights.reduce((t, [, wgt]) => t + wgt, 0);
      for (const [kind, wgt] of weights) if ((r -= wgt) <= 0) return kind;
      return weights[0]![0];
    };
    // Over the whole land, then again along the banks: the gallery forest is thick.
    const riverside: number[] = [];
    for (let i = 0; i < W * H; i += 1) if (bankDist[i]! > 0.6 && bankDist[i]! < 3.5) riverside.push(i);
    const samples = Math.round(W * H * 1.3);
    for (let n = 0; n < samples + riverside.length * 3; n += 1) {
      let cx: number, cy: number;
      if (n < samples) { cx = rand() * (W - 1); cy = rand() * (H - 1); }
      else { const c = riverside[Math.floor(rand() * riverside.length)]!; cx = (c % W) + rand() - 0.5; cy = Math.floor(c / W) + rand() - 0.5; }
      const cell = Math.round(cy) * W + Math.round(cx);
      const what = occupied[cell];
      if (what === WET || what === ROAD || what === FIELD) continue;
      const bank = bankDist[cell]!;
      const hill = elevationAt(cx, cy) / top;
      let chance: number, kind: TreeKind;
      if (what === TOWN) { chance = 0.05; kind = pick([["palm", 3], ["shade", 2]]); }
      else if (bank < 3) { chance = 0.75; kind = pick([["shade", 5], ["palm", 3], ["acacia", 2]]); }
      else if (bank < 7) { chance = 0.35; kind = pick([["shade", 3], ["acacia", 3], ["palm", 1], ["bush", 2]]); }
      else if (hill > 0.3) { chance = 0.3; kind = pick([["bush", 5], ["acacia", 3]]); }
      else { chance = 0.1 + 0.12 * patch(cx, cy); kind = pick([["acacia", 5], ["bush", 3], ["shade", 2]]); }
      // Away from the banks' gallery forest, trees gather in groves with gaps between (the
      // reference flights' "stand structure"): thicker in a grove's heart, bare between.
      const g = grove(cx, cy);
      const clump = what === TOWN || bank < 3 ? 1 : Math.max(0.12, Math.min(2.4, (g - 0.35) * 5));
      if (rand() > chance * clump * (what === TOWN ? 1 : biome.trees)) continue;
      // Taller in a grove's heart, young at its edge; now and then one stands above the rest.
      const cohort = what === TOWN ? 1 : 0.65 + Math.max(0, g - 0.35) * 1.1;
      const size = (0.55 + rand() * 0.45) * cohort * (rand() < 0.03 ? 1.5 : 1);
      m.compose(ground(cx, cy, -0.1), q.setFromAxisAngle(up, rand() * Math.PI * 2), sc.set(size, size * (0.85 + rand() * 0.3), size));
      trees.push({ kind, cell, at: m.clone() });
    }
    for (const kind of ["acacia", "shade", "palm", "bush"] as TreeKind[]) {
      const mine = trees.filter((t) => t.kind === kind);
      if (!mine.length) continue;
      const mesh = new THREE.InstancedMesh(own(treeGeometry(kind)), treeMaterial, mine.length);
      mine.forEach((t, i) => mesh.setMatrixAt(i, t.at));
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      groves.set(kind, mesh);
    }
  }
  // Fuel sellers (fuel.ts): where a town is a third or more short, jerrycans line the roads into
  // it, as the town card says ("Roadside sellers sell fuel at a premium"). A mesh a town, built
  // the first time it's short and then shown or hidden: a town's shortage is a sawtooth, rising
  // until a tanker lands and dropping to nothing, so which towns are short changed at half the
  // half-second checks, and rebuilding them all each time was a sixth of a 3D frame's work.
  // Built again only when the roads change.
  const sellers = new Map<string, THREE.Mesh | null>();
  let sellersRoads = -1;
  function syncSellers(w: GameWorld): void {
    if (sellersRoads !== roadLines.length) {
      sellersRoads = roadLines.length;
      for (const mesh of sellers.values()) if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      sellers.clear();
    }
    for (const town of w.towns.values()) {
      if (town.industry) continue;
      const short = steadyOver(w, `sellers:${town.id}`, steadyShortage(w, town.id), 0.35);
      if (short && !sellers.has(town.id)) sellers.set(town.id, buildSellers(town));
      const mesh = sellers.get(town.id);
      if (mesh) mesh.visible = short;
    }
  }
  function buildSellers(town: GameTown): THREE.Mesh | null {
    const kit = new Kit();
    const rand = seeded(`sellers-${town.id}`);
    const r = reachCells.get(town.id) ?? 3;
    for (const line of roadLines) {
      if (!line.some((p) => Math.hypot(p.x - town.x, p.y - town.y) < r + 4)) continue;
      const length = polylineLength(line);
      for (let along = 0.3; along < length; along += 0.45) {
        const [, rest] = splitPolyline(line, along);
        const p = rest[0]!, q = rest.find((o) => Math.hypot(o.x - p.x, o.y - p.y) > 1e-6) ?? line[line.length - 1]!;
        const d = Math.hypot(p.x - town.x, p.y - town.y);
        if (d < r * 0.6 || d > r + 3.5 || rand() > 0.7) continue;
        const dir = Math.atan2(q.y - p.y, q.x - p.x);
        const side = rand() < 0.5 ? 1 : -1;
        const nx = -Math.sin(dir) * side, ny = Math.cos(dir) * side;
        const cx = p.x + nx * 0.9, cy = p.y + ny * 0.9;
        const cell = Math.round(cy) * W + Math.round(cx);
        if (cx < 1 || cy < 1 || cx > W - 2 || cy > H - 2 || terrain.water[cell] === 1 || occupied[cell] === WET) continue;
        const one = new Kit();
        fuelSeller(one, rand, 0, 0, Math.atan2(-nx, -ny));
        kit.place(one.merged(), cx * M, elevationAt(cx, cy) * HEIGHT - 0.05, cy * M);
      }
    }
    if (kit.empty) return null;
    const mesh = new THREE.Mesh(kit.merged(), material);
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  }
  // Roadside life: kiosks strung along the roads just outside each town, and a filling station
  // on each road out of a town of some size. One mesh, rebuilt when the network changes.
  let roadside: THREE.Mesh | null = null;
  function buildRoadside(w: GameWorld): void {
    if (roadside) { scene.remove(roadside); roadside.geometry.dispose(); }
    const kit = new Kit();
    const rand = seeded(`roadside-${roadLines.length}`);
    const people = [...w.towns.values()].filter((t) => !t.industry);
    const taken: number[] = [];
    const stand = (cx: number, cy: number, make: (k: Kit) => void) => {
      const cell = Math.round(cy) * W + Math.round(cx);
      if (cx < 1 || cy < 1 || cx > W - 2 || cy > H - 2 || occupied[cell] === WET || occupied[cell] === ROAD || terrain.water[cell] === 1) return;
      const one = new Kit();
      make(one);
      kit.place(one.merged(), cx * M, elevationAt(cx, cy) * HEIGHT - 0.1, cy * M);
      taken.push(cell);
    };
    for (const line of roadLines) {
      const length = polylineLength(line);
      for (let along = 0.75; along < length; along += 1.4) {
        const [, rest] = splitPolyline(line, along);
        const p = rest[0]!, q = rest.find((r) => Math.hypot(r.x - p.x, r.y - p.y) > 1e-6) ?? line[line.length - 1]!;
        const dir = Math.atan2(q.y - p.y, q.x - p.x);
        const near = people.reduce<{ t: GameTown; d: number } | null>((best, t) => { const d = Math.hypot(t.x - p.x, t.y - p.y); return !best || d < best.d ? { t, d } : best; }, null);
        if (!near) continue;
        const r = reachCells.get(near.t.id) ?? 3;
        if (near.d < r + 0.3 || near.d > r + 6 || rand() > 0.45) continue;
        const side = rand() < 0.5 ? 1 : -1;
        const nx = -Math.sin(dir) * side, ny = Math.cos(dir) * side;
        // Facing the road: its front (+z) turned toward it.
        stand(p.x + nx * 1.3, p.y + ny * 1.3, (k) => kiosk(k, rand, 0, 0, Math.atan2(-nx, -ny)));
      }
    }
    // A filling station on each road out of a town of 30k and more, just past its houses.
    for (const town of people.filter((t) => t.population >= 30)) {
      const r = reachCells.get(town.id) ?? 3;
      for (const line of roadLines) {
        const first = line[0]!, last = line[line.length - 1]!;
        const out = Math.hypot(first.x - town.x, first.y - town.y) < 1 ? line : Math.hypot(last.x - town.x, last.y - town.y) < 1 ? [...line].reverse() : null;
        if (!out || polylineLength(out) < r + 4) continue;
        const [, rest] = splitPolyline(out, r + 2.5);
        const p = rest[0]!, q = rest[1] ?? out[out.length - 1]!;
        const dir = Math.atan2(q.y - p.y, q.x - p.x);
        const nx = -Math.sin(dir), ny = Math.cos(dir);
        stand(p.x + nx * 2, p.y + ny * 2, (k) => fillingStation(k, rand, 0, 0, Math.atan2(-nx, -ny)));
      }
    }
    if (kit.empty) { roadside = null; return; }
    roadside = new THREE.Mesh(kit.merged(), material);
    roadside.castShadow = true;
    roadside.receiveShadow = true;
    scene.add(roadside);
    const cleared = new Set(taken);
    clearTrees((cell) => cleared.has(cell));
  }
  // What you've built at towns (your word: make 3D show your own work): a motor park, a haulage
  // yard, a rail station where the track stops, metro entrances. Each stands just outside its
  // town's houses, on its own side; one mesh, rebuilt when any of them changes.
  let builds: THREE.Mesh | null = null;
  let buildsKey = "";
  function syncBuilds(w: GameWorld): void {
    const stations = new Set(w.simulation.map.segments.filter((s) => s.type === "rail" && s.retiredAt === undefined).flatMap((s) => [s.fromNodeId, s.toNodeId]));
    const key = `${[...w.parks].sort()}|${[...w.yards].sort()}|${[...stations].sort()}|${[...w.metros].map(([t, n]) => `${t}:${n}`).sort()}`;
    if (key === buildsKey) return;
    buildsKey = key;
    if (builds) { scene.remove(builds); builds.geometry.dispose(); builds = null; }
    const kit = new Kit();
    const cleared: number[] = [];
    const standAt = (town: GameTown, angle: number, make: (k: Kit, ry: number) => void) => {
      const r = (town.industry ? 2.5 : reachCells.get(town.id) ?? 3) + 1.6;
      // Round the town from its own side until a dry, roadless spot.
      for (let k = 0; k < 16; k += 1) {
        const a = angle + k * 0.4 * (k % 2 ? 1 : -1);
        const cx = town.x + Math.cos(a) * r, cy = town.y + Math.sin(a) * r;
        const cell = Math.round(cy) * W + Math.round(cx);
        if (cx < 2 || cy < 2 || cx > W - 3 || cy > H - 3 || terrain.water[cell] === 1 || occupied[cell] === ROAD || occupied[cell] === WET) continue;
        const one = new Kit();
        make(one, a + Math.PI / 2);
        kit.place(one.merged(), cx * M, elevationAt(cx, cy) * HEIGHT - 0.15, cy * M);
        for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) cleared.push(cell + dy * W + dx);
        return;
      }
    };
    for (const id of w.parks) { const t = w.towns.get(id); if (t) standAt(t, 0.3, (k, ry) => motorPark(k, seeded(`park-${id}`), ry)); }
    for (const id of w.yards) { const t = w.towns.get(id); if (t) standAt(t, 2.4, (k, ry) => haulageYard(k, seeded(`yard-${id}`), ry)); }
    for (const id of stations) {
      const t = w.towns.get(id);
      if (!t || t.industry) continue;
      // Beside the track, where it comes into the town.
      const seg = w.simulation.map.segments.find((s) => s.type === "rail" && (s.fromNodeId === id || s.toNodeId === id))!;
      const line = segmentPolyline(w.simulation.map, seg);
      const out = seg.fromNodeId === id ? line : [...line].reverse();
      const [, rest] = splitPolyline(out, Math.min(polylineLength(out) * 0.5, (reachCells.get(id) ?? 3) * 0.6));
      const p = rest[0]!, q = rest[1] ?? out[out.length - 1]!;
      const dir = Math.atan2(q.y - p.y, q.x - p.x);
      const sx = p.x - Math.sin(dir) * 1.1, sy = p.y + Math.cos(dir) * 1.1;
      const one = new Kit();
      railStation(one, seeded(`station-${id}`), -dir);
      kit.place(one.merged(), sx * M, elevationAt(sx, sy) * HEIGHT - 0.1, sy * M);
    }
    for (const [id, lines] of w.metros) {
      const t = w.towns.get(id);
      for (let n = 0; t && n < lines; n += 1) standAt(t, 4.2 + n * 1.3, (k, ry) => metroEntrance(k, ry));
    }
    if (kit.empty) return;
    builds = new THREE.Mesh(kit.merged(), material);
    builds.castShadow = true;
    builds.receiveShadow = true;
    scene.add(builds);
    const gone = new Set(cleared);
    clearTrees((cell) => gone.has(cell));
  }
  /** A road built since, or a town grown: the trees in its way go. */
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function clearTrees(gone: (cell: number) => boolean): void {
    for (const kind of groves.keys()) {
      const mesh = groves.get(kind)!;
      let i = 0, changed = false;
      for (const t of trees) {
        if (t.kind !== kind) continue;
        if (gone(t.cell)) { mesh.setMatrixAt(i, zero); changed = true; }
        i += 1;
      }
      if (changed) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // --- Frame the home cluster's biggest town ------------------------------------------------
  {
    const home = [...world.towns.values()].filter((t) => !t.industry && inHome(world, t)).reduce<GameTown | null>((big, t) => (!big || t.population > big.population ? t : big), null);
    const target = home ? ground(home.x, home.y) : ground(W / 2, H / 2);
    controls.target.copy(target);
    camera.position.set(target.x + 320, target.y + 380, target.z + 320);
  }

  let network = "";
  let slowAt = 0;
  return {
    world,
    scene,
    sun,
    get pickable() {
      return [...towns.values()].map((t) => t.mesh);
    },
    groundAt: (x, z) => elevationAt(x / M, z / M) * HEIGHT,
    size: { x: (W - 1) * M, z: (H - 1) * M },
    sky,
    setNight(dark) {
      // Night: a dark sky and haze, a dim blue moon for the sun, lit windows; what's drawn unlit
      // (the water, road lines, the map's cut edge) dimmed by hand, or it would glow.
      paintSky(dark ? 0x0c1830 : 0x9dbfdc, dark ? 0x2a3450 : HORIZON, dark ? 0x1a2232 : 0xbcc7d0);
      hemi.color.setHex(dark ? 0x7088c0 : 0xe8f0f8);
      hemi.groundColor.setHex(dark ? 0x22222c : 0x8a7a5a);
      hemi.intensity = dark ? 0.6 : 1.45;
      sun.color.setHex(dark ? 0xa8bcff : 0xfff0d4);
      sun.intensity = dark ? 0.5 : 2.5;
      setWaterNight(waterMaterial, dark);
      lineMaterial.color.setHex(dark ? 0x77756e : 0xf2efe6);
      edgeMaterial.color.setScalar(dark ? 0.3 : 1);
      windowMaterial.emissive.setHex(dark ? 0xffc46a : 0x000000);
      windowMaterial.emissiveIntensity = dark ? 1.1 : 0;
    },
    cullLabels(cam) {
      // As near as each is readable; a selected place's connections keep their names whatever the
      // distance. Then none on top of another (pulled back, a city's name, its four sites' and its
      // neighbour's piled into one knot): placed in order -- the selected place, its connections,
      // then city, regional town, town, village, site -- and any that would overlap one already
      // placed is hidden, as the 2D map's labels are.
      const wanted = [...towns].filter(([id, t]) => cam.position.distanceTo(t.label.position) < t.reach || !!focused?.towns.has(id));
      for (const [, t] of towns) t.label.visible = false;
      const order = (id: string, t: { rank: number }) => (id === selectedId ? -2 : focused?.towns.has(id) ? -1 : 0) * 10 + t.rank;
      wanted.sort(([a, s], [b, t]) => order(a, s) - order(b, t));
      const halfW = innerWidth / 2, halfH = innerHeight / 2, taken: Array<{ l: number; r: number; t: number; b: number }> = [];
      const p = new THREE.Vector3();
      for (const [, t] of wanted) {
        p.copy(t.label.position).project(cam);
        if (p.z > 1) continue; // behind the camera
        // Its size on screen, measured once a text (a measure is a layout; the text rarely changes).
        // A label not yet shown measures nothing (display: none): estimated until it has been.
        const words = t.text.textContent ?? "";
        if ((!t.size || t.size.text !== words) && t.text.offsetWidth > 0) t.size = { w: t.text.offsetWidth, h: t.text.offsetHeight, text: words };
        const size = t.size?.text === words ? t.size : { w: words.length * 7 + 14, h: 20 };
        const x = (p.x + 1) * halfW, y = (1 - p.y) * halfH;
        const box = { l: x - size.w / 2 - 3, r: x + size.w / 2 + 3, t: y - size.h / 2 - 2, b: y + size.h / 2 + 2 };
        if (taken.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) continue;
        taken.push(box);
        t.label.visible = true;
      }
      if (ring.visible) ringMaterial.opacity = 0.45 + 0.2 * Math.sin(performance.now() / 300);
    },
    centreOf(id) {
      const entry = towns.get(id);
      return entry ? entry.label.position.clone().setY(entry.mesh.position.y) : null;
    },
    focus(focus, selected) {
      const key = focus ? `${selected}|${focus.segments.size}|${focus.towns.size}|${focus.routes.size}` : "";
      if (key === focusKey) return;
      focusKey = key;
      focused = focus;
      selectedId = selected;
      colourRoads(world);
      const entry = selected ? towns.get(selected) : undefined;
      ring.visible = !!entry;
      if (entry) {
        const geometry = entry.mesh.geometry;
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        const sphere = geometry.boundingSphere!;
        // The town's built-up heart, not its whole spread of fields and houses.
        const radius = Math.max(20, Math.min(160, sphere.radius * 0.55));
        const x = entry.mesh.position.x + sphere.center.x;
        const z = entry.mesh.position.z + sphere.center.z;
        ring.position.set(x, elevationAt(x / M, z / M) * HEIGHT + 1.5, z);
        ring.scale.setScalar(radius);
      }
    },
    update(w) {
      // The network's shape changes rarely; check it cheaply, rebuild only then.
      const segments = w.simulation.map.segments;
      const shape = `${segments.length}:${segments.reduce((n, s) => n + (s.retiredAt !== undefined ? 1 : 0), 0)}:${segments[segments.length - 1]?.id ?? ""}`;
      if (shape !== network) {
        network = shape;
        syncRoads(w);
        if (planted) {
          markRoads(roadLines);
          clearTrees((cell) => occupied[cell] === ROAD);
          buildRoadside(w);
        }
      }
      const now = performance.now();
      if (now - slowAt > 500) {
        slowAt = now;
        colourRoads(w);
        syncTowns(w);
        if (planted) syncSellers(w);
        if (planted) syncBuilds(w);
        if (!planted) {
          plant(w);
          buildRoadside(w);
        }
      }
      placeVehicles(w);
    },
    dispose() {
      for (const road of roads.values()) {
        drop(road.mesh);
        road.material.dispose();
      }
      for (const town of towns.values()) {
        town.mesh.geometry.dispose();
        town.label.element.remove();
      }
      for (const mesh of fleets.values()) mesh.dispose();
      for (const mesh of sellers.values()) mesh?.geometry.dispose();
      for (const thing of disposables) thing.dispose();
    },
  };
}

/** Where a vehicle is on its road, in map cells, and the way it faces: render.ts's vehiclePose, unprojected. */
function poseOf(world: GameWorld, vehicle: Vehicle): { x: number; y: number; angle: number } | null {
  const length = vehicle.path.length;
  if (length < 2 || vehicle.pathIndex >= length) return null;
  const line = edgeLine(world, vehicle.path[(vehicle.pathIndex - 1 + length) % length]!, vehicle.path[vehicle.pathIndex]!, vehicle);
  const [, ahead] = splitPolyline(line, polylineLength(line) * vehicle.edgeProgress);
  const here = ahead[0]!;
  const next = ahead.find((q) => Math.hypot(q.x - here.x, q.y - here.y) > 1e-6) ?? line[line.length - 1]!;
  const prev = line[0]!;
  const angle = next === here ? Math.atan2(here.y - prev.y, here.x - prev.x) : Math.atan2(next.y - here.y, next.x - here.x);
  return { x: here.x, y: here.y, angle };
}
/** The road piece a vehicle is on now; null between pieces or off the map's segments. */
function segmentUnder(world: GameWorld, vehicle: Vehicle): Segment | null {
  const length = vehicle.path.length;
  if (length < 2 || vehicle.pathIndex >= length) return null;
  const edge = routingFor(world, vehicle).graph.get(vehicle.path[(vehicle.pathIndex - 1 + length) % length]!)?.find((c) => c.to === vehicle.path[vehicle.pathIndex]);
  return (edge && world.simulation.map.segments.find((c) => c.id === edge.segmentId)) || null;
}
function edgeLine(world: GameWorld, from: string, to: string, vehicle: Vehicle): Point[] {
  const routing = routingFor(world, vehicle);
  const edge = routing.graph.get(from)?.find((c) => c.to === to);
  const segment = edge && world.simulation.map.segments.find((c) => c.id === edge.segmentId);
  if (!segment) {
    const { positions } = world.simulation.routing;
    return [positions.get(from)!, positions.get(to)!];
  }
  const line = segmentPolyline(world.simulation.map, segment);
  return segment.fromNodeId === from ? line : [...line].reverse();
}
function distToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
}

/** A kit that leaves out any piece whose footprint `clear` refuses (shapes3d's sites, round a road). */
class ClearKit extends Kit {
  dropped = 0;
  constructor(private ok: (x: number, z: number, r: number) => boolean) {
    super();
  }
  private clear(x: number, z: number, r: number): boolean {
    if (this.ok(x, z, r)) return true;
    this.dropped += 1;
    return false;
  }
  override box(w: number, h: number, d: number, colour: string | number, x = 0, z = 0, y = 0, ry = 0): void {
    if (this.clear(x, z, Math.max(w, d) / 2)) super.box(w, h, d, colour, x, z, y, ry);
  }
  override cylinder(r: number, h: number, colour: string | number, x = 0, z = 0, y = 0, segments = 10): void {
    if (this.clear(x, z, r)) super.cylinder(r, h, colour, x, z, y, segments);
  }
  override cone(r: number, h: number, colour: string | number, x = 0, z = 0, y = 0, segments = 4, ry = Math.PI / 4): void {
    if (this.clear(x, z, r)) super.cone(r, h, colour, x, z, y, segments, ry);
  }
  override gable(w: number, d: number, h: number, colour: string | number, x = 0, z = 0, y = 0, ry = 0): void {
    if (this.clear(x, z, Math.max(w, d) / 2)) super.gable(w, d, h, colour, x, z, y, ry);
  }
}
