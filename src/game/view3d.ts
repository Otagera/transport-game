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
import { CLOTHES, SITE_BAY, SITE_LIFE, SITE_STOCK, SITE_YARD, busShelter, excavator, canoe, cargoShip, fishingJetty, personGeometry, reedClump, tugBoat } from "./shapes3d";
import { waitingAt } from "@engine/game/world";
import { parsePoolKey } from "@engine/game/tick";
import { siteProduction } from "@engine/game/production";
import { goodsFlows } from "@engine/game/goods";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
import { pipeLine, type Focus, type Network, type OverlayMark } from "./render";
import { steadyOver, steadyShortage } from "./steady";
import { treeGeometry, type TreeKind } from "./shapes3d";
import { paint as tokenPaint, paintAlpha, paintHex } from "./palette3d";
import { farmTowns } from "@engine/game/food";
import { inFarmBelt } from "@engine/game/clusters";
import { clusterAt, isClosed, landOf, remitOn } from "@engine/game/remit";
import { BLOCK_WALLS, CAR_LENGTH, CONCRETE, COUPLING, LOCO_LENGTH, ROOFS, WALLS, WINDOWS, fillingStation, fuelSeller, haulageYard, kiosk, metroEntrance, motorPark } from "./shapes3d";
import { PLATFORM_WIDTH, THROAT, layStations, onStation, reachAlong, stationAt, stationNodes, throatLine, type Station } from "./stations3d";
import { carsOn } from "@engine/game/rail";
import { labelOf, routeLabelKey } from "@engine/game/labels";
import { Kit, block, bungalow, church, hut, market, mosque, seeded, shophouse, site, vehicleGeometry, type VehicleKind3D } from "./shapes3d";
import { RING_DRIVE, RING_OUTER, RING_ZONE, busPark, hasLorryPark, lorryPark, roundabout, siteScale, yardFence } from "./shapes3d";
import { AIRPORT, airAt, airliner, airportArrival, airportDeparture } from "./shapes3d";
import { airportTravellersPerDay } from "@engine/game/airport";
import { BUS_PARK, inPark, layBusParks, parkDrive, parkEnds, parkPoint, siteParkGround, type BusPark } from "./busparks3d";

const M = 8; // metres a map cell
// Metres an elevation unit. The map's cells stand for far more than the 8 m they're drawn at,
// so the hills are drawn low: at 7 m a unit, a 2D map's gentle hill stood up as a spike (your
// playtest, 2026-10-26: "see another mountain in 3D"). 3.2 since the land got its relief (map
// version 8: broad swells a few units high) -- at 2.2 the region read flat from any height.
const HEIGHT = 3.2;
const VEHICLE_SCALE = 1.6; // a little larger than life, to be seen from above
/** How far right of its road's line a road vehicle drives (metres): the two ways don't overlap. */
const KEEP_RIGHT = 2.4;
/** From a site's point to its yard's front (metres): its park's lane and ground between (busparks3d.ts). */
const PARK_FRONT = 12 + 2 * 13 + 4;
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

// The day's water is the 2D map's dark anchor (look.md §1, §8.2): its deep the --map-water token,
// its shallows that a third of the way to the sky's pale.
const WATER_DAY = { deep: paintHex("--map-water"), shallow: new THREE.Color(paintHex("--map-water")).lerp(new THREE.Color(paintHex("--paint-blue-1")), 0.35).getHex(), sky: paintHex("--paint-blue-1"), foam: paintHex("--paint-earth-2"), glint: paintHex("--paint-light-3"), glintStrength: 0.55 };
const WATER_NIGHT = { deep: paintHex("--paint-dark-1"), shallow: paintHex("--paint-blue-20"), sky: paintHex("--paint-blue-21"), foam: paintHex("--paint-blue-19"), glint: paintHex("--paint-blue-2"), glintStrength: 0.35 };
const waterMaterials = new Set<THREE.ShaderMaterial>();

// --- Weather (the fidelity scope, B5) -------------------------------------------------------------
// Cloud shadows drifting over the land: soft patches of shade, a few hundred metres across, moving
// with the wind -- more cloud in the south, little in the dry north. Patched into the land's, the
// trees', the towns' and the roads' materials (not the water's: its own shader), one clock for all.
const CLOUD = { uCloudTime: { value: 0 }, uCloudCover: { value: 0.5 } };
const clouded = new WeakSet<THREE.Material>();
// Your remit, veiled (remit.ts; 2026-11-02), as the 2D map shows it (render.ts closedCanvas): land
// outside it faded toward the haze and drawn out of colour -- there and running, not yours to build
// in yet -- with a fine dashed line on the ground where your remit ends. Its towns, sites and roads
// stay sharp (they run; the inherited roads are yours to use). A mask the map wide, sampled where a
// material asks for it (VEIL: the land, the skirt, the trees; VEIL_LINE: the land's line): red the
// veil as it stands (lifting when a cluster opens), green where it settles, for the line.
const VEIL = { uVeilMap: { value: null as THREE.Texture | null }, uVeilSize: { value: new THREE.Vector2(1, 1) }, uVeilTint: { value: new THREE.Color() }, uVeilLine: { value: new THREE.Color() } };
/** Mark a material for the veil (and its line). */
function veiled<T extends THREE.Material>(material: T, line = false): T {
  material.defines = { ...(material.defines ?? {}), VEIL: "", ...(line ? { VEIL_LINE: "" } : {}) };
  return material;
}
function withClouds<T extends THREE.Material>(material: T): T {
  if (clouded.has(material)) return material;
  clouded.add(material);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCloudTime = CLOUD.uCloudTime;
    shader.uniforms.uCloudCover = CLOUD.uCloudCover;
    Object.assign(shader.uniforms, VEIL);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec2 vCloudXZ;\nvoid main() {")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vec4 cloudWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cloudWorld = instanceMatrix * cloudWorld;
        #endif
        vCloudXZ = (modelMatrix * cloudWorld).xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `varying vec2 vCloudXZ;
        uniform float uCloudTime;
        uniform float uCloudCover;
        #ifdef VEIL
          uniform sampler2D uVeilMap;
          uniform vec2 uVeilSize;
          uniform vec3 uVeilTint;
          uniform vec3 uVeilLine;
        #endif
        float cloudHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float cloudNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), u.x), mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        void main() {`)
      .replace("#include <fog_fragment>", `{
          vec2 drift = vCloudXZ - vec2(uCloudTime * 9.0, uCloudTime * 4.0);
          float c = cloudNoise(drift / 420.0) * 0.65 + cloudNoise(drift / 160.0 + 3.7) * 0.35;
          float shade = smoothstep(1.0 - uCloudCover, 1.12 - uCloudCover, c);
          gl_FragColor.rgb *= 1.0 - 0.24 * shade;
        }
        #ifdef VEIL
        {
          vec2 veil = texture2D(uVeilMap, vCloudXZ / uVeilSize).rg;
          vec3 grey = vec3(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(grey, uVeilTint, 0.5), veil.r * 0.62);
          #ifdef VEIL_LINE
            // Where it settles: a line a couple of pixels wide at any zoom, dashed by a checker.
            float d = abs(veil.g - 0.5) / max(fwidth(veil.g), 1e-4);
            float dash = abs(step(0.5, fract(vCloudXZ.x / 9.0)) - step(0.5, fract(vCloudXZ.y / 9.0)));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uVeilLine, (1.0 - smoothstep(0.6, 1.8, d)) * dash * 0.7);
          #endif
        }
        #endif
        #include <fog_fragment>`);
  };
  return material;
}
/** How cloudy each region's sky is, and how thick its haze (a share of the usual distance): the north's harmattan dust closer. */
const WEATHER: Record<string, { cover: number; haze: number }> = {
  southwest: { cover: 0.3, haze: 1 }, southeast: { cover: 0.34, haze: 1 }, southSouth: { cover: 0.38, haze: 0.95 },
  middleBelt: { cover: 0.24, haze: 0.9 }, north: { cover: 0.12, haze: 0.62 }, northeast: { cover: 0.1, haze: 0.58 },
};

/** A soft round blob, opaque at the middle and gone at the edge: a contact shadow's alpha (look.md §8.3). */
let blob: THREE.CanvasTexture | null = null;
function softBlob(): THREE.CanvasTexture {
  if (blob) return blob;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d")!;
  const gradient = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, paintAlpha("--ink", 1));
  gradient.addColorStop(0.55, paintAlpha("--ink", 0.55));
  gradient.addColorStop(1, paintAlpha("--ink", 0));
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  blob = new THREE.CanvasTexture(canvas);
  return blob;
}

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
      attribute float aShore;
      attribute float aSea;
      attribute float aDeep;
      varying float vSea;
      varying float vDeep;
      varying float vAcross;
      varying float vAlong;
      varying float vWidth;
      varying float vShore;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vAcross = aAcross;
        vAlong = aAlong;
        vWidth = aWidth;
        vShore = aShore;
        vSea = aSea;
        vDeep = aDeep;
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
      varying float vShore;
      varying float vSea;
      varying float vDeep;
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
        // A river's water in its own frame (metres along it, across it), carried downstream; the
        // sea's in the world's, barely drifting. Blended by how near the sea is (aSea, 0..1), so an
        // estuary fades into the sea instead of meeting it at a line.
        if (vShore < 0.0) discard;
        float metres = max(vWidth, 8.0);
        float speed = clamp(144.0 / metres, 2.0, 9.0);
        vec2 pr = vec2(vAlong, vAcross);
        vec2 ps = vWorld.xz * 0.6;
        float fr = uTime * speed, fs = uTime * 0.4;
        float e = 0.6;
        float hr = ripples(pr, fr), hs = ripples(ps, fs);
        vec2 gr = vec2(ripples(pr + vec2(e, 0.0), fr) - hr, ripples(pr + vec2(0.0, e), fr) - hr) / e;
        vec2 gs = vec2(ripples(ps + vec2(e, 0.0), fs) - hs, ripples(ps + vec2(0.0, e), fs) - hs) / e;
        vec2 grad = mix(gr, gs, vSea);
        vec2 p = mix(pr, ps, vSea);
        float flow = mix(fr, fs, vSea);
        vec3 n = normalize(vec3(-grad.x * 0.9, 1.0, -grad.y * 0.9));
        // Shallow at the shore, deep mid-channel; the sea deepens slowly away from its shore.
        float toShore = vShore;
        // How far out it takes to deepen (aDeep): a river a third of its width, the sea ninety metres,
        // a lake its own size -- at the sea's ninety a lake a few cells across never got deep and
        // read pale as ice (your look, 2026-11-01).
        float depth = smoothstep(0.0, vDeep, toShore);
        vec3 col = mix(uShallow, uDeep, depth);
        // A little sky at low angles, and the sun's glint.
        vec3 view = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(n, view), 0.0), 4.0);
        col = mix(col, uSky, fresnel * 0.55);
        float glint = pow(max(dot(reflect(-uSun, n), view), 0.0), 400.0);
        col += uGlint * glint * uGlintStrength;
        // Foam where it meets land: a soft band, broken up and drifting with the water.
        float band = 1.0 - smoothstep(0.0, mix(max(0.8, metres * 0.07), 4.0, vSea), toShore);
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
const STREET_DIRT = paintHex("--paint-earth-43");
const STREET_PAVED = paintHex("--paint-grey-14");
/**
 * The land by the map's region (world.region; map version 4 draws its shape, this its look): the
 * plain's dry and green, the banks, high ground, how dry the plain leans and how thick the trees.
 * The north dry and open, the south-south lush, the Middle Belt's high ground grey rock.
 */
const BIOMES: Record<string, { dry: number; green: number; bank: number; high: number; dryness: number; trees: number }> = {
  southwest: { dry: paintHex("--paint-earth-28"), green: paintHex("--paint-green-4"), bank: paintHex("--paint-green-12"), high: paintHex("--paint-green-11"), dryness: 0, trees: 1 },
  southeast: { dry: paintHex("--paint-earth-32"), green: paintHex("--paint-green-7"), bank: paintHex("--paint-green-14"), high: paintHex("--paint-green-16"), dryness: -0.12, trees: 1.35 },
  southSouth: { dry: paintHex("--paint-green-3"), green: paintHex("--paint-green-9"), bank: paintHex("--paint-green-20"), high: paintHex("--paint-green-16"), dryness: -0.28, trees: 1.7 },
  middleBelt: { dry: paintHex("--paint-earth-28"), green: paintHex("--paint-green-4"), bank: paintHex("--paint-green-12"), high: paintHex("--paint-grey-11"), dryness: 0.05, trees: 0.9 },
  north: { dry: paintHex("--paint-earth-25"), green: paintHex("--paint-green-2"), bank: paintHex("--paint-green-10"), high: paintHex("--paint-earth-42"), dryness: 0.32, trees: 0.45 },
  northeast: { dry: paintHex("--paint-earth-23"), green: paintHex("--paint-earth-33"), bank: paintHex("--paint-green-10"), high: paintHex("--paint-earth-41"), dryness: 0.38, trees: 0.4 },
};
// Each region's own trees (the scope's B3, 2026-10-30: one savanna had stood for every region):
// what grows in town, on a river's bank, near it, on high ground, and on the open land.
type Mix = Array<[TreeKind, number]>;
const MIXES: Record<string, { town: Mix; bank: Mix; near: Mix; high: Mix; open: Mix }> = {
  southwest: { town: [["palm", 3], ["shade", 2]], bank: [["rainforest", 3], ["shade", 3], ["palm", 3]], near: [["shade", 3], ["palm", 2], ["rainforest", 2], ["bush", 2]], high: [["bush", 4], ["shade", 3], ["boulder", 1]], open: [["shade", 4], ["acacia", 2], ["palm", 2], ["bush", 3]] },
  southeast: { town: [["palm", 4], ["shade", 2]], bank: [["rainforest", 5], ["palm", 3]], near: [["rainforest", 4], ["palm", 3], ["shade", 2]], high: [["rainforest", 3], ["bush", 3]], open: [["rainforest", 3], ["palm", 3], ["shade", 3], ["bush", 2]] },
  southSouth: { town: [["palm", 5], ["shade", 1]], bank: [["mangrove", 6], ["palm", 2]], near: [["mangrove", 2], ["rainforest", 3], ["palm", 3]], high: [["rainforest", 3], ["palm", 2]], open: [["rainforest", 3], ["palm", 4], ["shade", 2]] },
  middleBelt: { town: [["shade", 3], ["palm", 1]], bank: [["shade", 5], ["palm", 2], ["acacia", 2]], near: [["shade", 3], ["acacia", 3], ["bush", 2]], high: [["boulder", 4], ["bush", 3], ["acacia", 1]], open: [["acacia", 4], ["bush", 3], ["shade", 2], ["boulder", 1]] },
  north: { town: [["shade", 3], ["baobab", 1]], bank: [["shade", 4], ["acacia", 3], ["palm", 1]], near: [["acacia", 4], ["shade", 2], ["baobab", 1]], high: [["boulder", 5], ["bush", 2]], open: [["acacia", 5], ["bush", 3], ["baobab", 2]] },
  northeast: { town: [["shade", 3], ["baobab", 1]], bank: [["shade", 3], ["acacia", 4]], near: [["acacia", 4], ["bush", 2], ["baobab", 1]], high: [["boulder", 5], ["bush", 2]], open: [["acacia", 4], ["bush", 4], ["baobab", 2]] },
};

// Busy, jammed and flooded are signal (look.md §2): the same tokens as the 2D map's.
const ROAD_COLOURS = { paved: paintHex("--paint-grey-21"), dirt: paintHex("--paint-earth-48"), busy: paintHex("--road-busy"), jammed: paintHex("--road-jammed"), retired: paintHex("--paint-earth-26"), flooded: paintHex("--flood") };
/** A selection: your colour (the 2D map's --you), lit on what it's connected to; the rest toward the ground's pale. */
const FOCUS_COLOUR = paintHex("--you");
const FADED_TO = new THREE.Color(paintHex("--paint-earth-11"));

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
  /** The layer buttons (main.ts): roads and track or one alone, and the land's trees, rocks and hamlets. */
  setLayers(network: Network, scenery: boolean): void;
  /** An overlay's marks (render.ts overlayMarks), as arcs over the land; none, none drawn. */
  setOverlay(marks: readonly OverlayMark[]): void;
}

/** What a click in 3D picked: a town or site, one of your lines (a vehicle on it), or a road or stretch of track. */
export type Pick3D = { kind: "place" | "route" | "segment" | "pipe"; id: string };

/** `onPick`: something clicked -- a vehicle, a town or site (its mesh or its label), a road or track -- main.ts opens its card. */
export function createView3D(onPick: (pick: Pick3D) => void = () => {}): View3D {
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
  vignette.style.cssText = "position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 48%, transparent 55%, color-mix(in srgb, var(--ink) 22%, transparent) 100%);";
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
  // A click (not a drag that turned the camera) picks what's under it, the smallest first: a
  // vehicle within a few pixels (they're small from any height), then a town's or site's
  // buildings, then the road or track nearest the ground it hit.
  const ray = new THREE.Raycaster();
  let down: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener("pointerdown", (event) => { down = { x: event.clientX, y: event.clientY }; });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 || !built) return;
    down = null;
    const pick = built.pickAt(event.clientX, event.clientY, ray);
    if (pick) onPick(pick);
  });
  // Over something you can click, the pointer says so; checked a few times a second, not every move.
  let hoverAt = 0;
  renderer.domElement.addEventListener("pointermove", (event) => {
    const now = performance.now();
    if (!built || event.buttons || now - hoverAt < 120) return;
    hoverAt = now;
    renderer.domElement.style.cursor = built.pickAt(event.clientX, event.clientY, ray) ? "pointer" : "";
  });

  let built: Built | null = null;
  let shown = false;
  let lastSelected: string | null = null;
  let glideTo: THREE.Vector3 | null = null;
  let pendingTurn = 0, pendingTilt = 0;
  let night = false;
  let layers: { network: Network; scenery: boolean } = { network: "both", scenery: true };
  let marks: readonly OverlayMark[] = [];
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
    setLayers(network, scenery) {
      layers = { network, scenery };
    },
    setOverlay(next) {
      marks = next;
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
      built!.layers(layers.network, layers.scenery);
      built!.arcs(marks);
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
      CLOUD.uCloudTime.value = seconds;
      built!.rain(seconds, camera.position.distanceTo(controls.target));
      built!.cullLabels(camera);
      // The haze by how far out you are: in the distance up close, thin over the whole slab.
      const fog = built!.scene.fog as THREE.Fog;
      const away = camera.position.distanceTo(controls.target);
      const haze = (WEATHER[built!.world.region ?? "southwest"] ?? WEATHER.southwest!).haze;
      fog.near = (away * 1.1 + 300) * haze;
      fog.far = (away * 3 + 1200) * haze;
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
  /** What's under a screen point (CSS pixels): a vehicle, a town or site, a road or track; null for bare land. */
  pickAt(x: number, y: number, ray: THREE.Raycaster): Pick3D | null;
  /** The ground's height under a point of the 3D world. */
  groundAt(x: number, z: number): number;
  /** The land's extent (metres), to keep the camera over it. */
  size: { x: number; z: number };
  /** The sky, kept round the camera. */
  sky: THREE.Mesh;
  /** The rain over flooded fords, falling: a frame's clock, seconds; how far the camera is from what it looks at, metres. */
  rain(seconds: number, away: number): void;
  setNight(night: boolean): void;
  /** Labels shown only as near as they're readable: a village up close, the city from afar. */
  cullLabels(camera: THREE.Camera): void;
  /** What's selected and what it's connected to: those roads lit, the rest faded, a ring at the town. */
  focus(focus: Focus | null, selected: string | null): void;
  /** Where a town or site stands, on the ground; null when it isn't drawn. */
  centreOf(id: string): THREE.Vector3 | null;
  update(world: GameWorld): void;
  /** Show or hide by layer (the buttons): roads, track, and their vehicles; the scenery. */
  layers(network: Network, scenery: boolean): void;
  /** The overlay's arcs, rebuilt when its marks are new ones. */
  arcs(marks: readonly OverlayMark[]): void;
  dispose(): void;
}

function build(world: GameWorld, camera: THREE.PerspectiveCamera, controls: MapControls, onPick: (pick: Pick3D) => void): Built {
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
  // The north's horizon dusty with the harmattan (B5), the rest as it was.
  const weather = WEATHER[world.region ?? "southwest"] ?? WEATHER.southwest!;
  const HORIZON = new THREE.Color(paintHex("--paint-earth-6")).lerp(new THREE.Color(paintHex("--paint-earth-23")), (1 - weather.haze) * 1.2).getHex();
  CLOUD.uCloudCover.value = weather.cover;
  scene.background = new THREE.Color(HORIZON);
  scene.fog = new THREE.Fog(HORIZON, 900, 3000);
  const hemi = new THREE.HemisphereLight(paintHex("--paint-light-2"), paintHex("--paint-earth-50"), 1.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(paintHex("--paint-light-5"), 2.5);
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
  // Dunes (map version 13): ridges in the 3D ground only -- the map's heights, and its prices, are
  // the terrain's. Crests across the north-east wind, taller in the field's middle.
  const dunes = world.features?.dunes ?? [];
  const duneAt = (cx: number, cy: number) => {
    let share = 0;
    for (const d of dunes) {
      const c = Math.cos(d.turn), sn = Math.sin(d.turn);
      const u = ((cx - d.x) * c + (cy - d.y) * sn) / d.rx, v = (-(cx - d.x) * sn + (cy - d.y) * c) / d.ry;
      const r = Math.hypot(u, v);
      if (r < 1) share = Math.max(share, Math.min(1, (1 - r) * 3));
    }
    return share;
  };
  for (const d of dunes) {
    const reach = Math.max(d.rx, d.ry) + 1;
    for (let y = Math.max(0, Math.floor(d.y - reach)); y <= Math.min(H - 1, Math.ceil(d.y + reach)); y += 1) {
      for (let x = Math.max(0, Math.floor(d.x - reach)); x <= Math.min(W - 1, Math.ceil(d.x + reach)); x += 1) {
        const share = duneAt(x, y);
        if (share <= 0 || terrain.water[y * W + x] === 1) continue;
        const along = (x + y) * 0.62 + Math.sin(y * 0.31) * 1.4;
        field[y * W + x] = field[y * W + x]! + share * 0.55 * (0.5 + 0.5 * Math.sin(along)) ** 2;
      }
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
  // The sea's depth from the land, not from its own line: the sea is drawn as a wide line running
  // off the map, and measured from that line's far side it shoaled to a pale band along the map's
  // edge (the land beyond the edge, 2026-10-31). Distance to the nearest dry cell, the world past
  // the map's edge counted as water.
  const toLand = new Float32Array(W * H).fill(1e6);
  for (let i = 0; i < W * H; i += 1) if (terrain.water[i] !== 1) toLand[i] = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    const order = pass === 0 ? [...Array(W * H).keys()] : [...Array(W * H).keys()].reverse();
    for (const i of order) {
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy, cost] of [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.4], [1, -1, 1.4]] as const) {
        const sx = pass === 0 ? dx : -dx, sy = pass === 0 ? dy : -dy;
        const nx = x + sx, ny = y + sy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const v = toLand[ny * W + nx]! + cost;
        if (v < toLand[i]!) toLand[i] = v;
      }
    }
  }
  const landAt = (x: number, y: number) => {
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(x))), y0 = Math.max(0, Math.min(H - 2, Math.floor(y)));
    const tx = Math.max(0, Math.min(1, x - x0)), ty = Math.max(0, Math.min(1, y - y0));
    const v = (xx: number, yy: number) => toLand[yy * W + xx]!;
    return (v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty;
  };

  const disposables: Array<{ dispose(): void }> = [];
  const own = <T extends { dispose(): void }>(thing: T): T => (disposables.push(thing), thing);
  /** The land's scenery -- rocks, hamlets, reeds, the clouds -- for the Scenery button (trees are `groves`). */
  const scenery: THREE.Object3D[] = [];
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
  paintSky(paintHex("--paint-blue-6"), HORIZON, paintHex("--paint-blue-4"));
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
  const windowMaterial = own(new THREE.MeshLambertMaterial({ color: paintHex("--paint-light-1") }));
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

  // The savanna's own grain (2026-10-30, the scope's B1: "blotchy, like camouflage"): the broad
  // patches alone are 14 cells across and smooth, so at the region's scale the land read as a few
  // soft blobs. Finer noise layered on them (5.5 and 2.2 cells), and the broad pattern warped by a
  // slow one so its edges wander: patchy ground, dry and green at every scale.
  const landSeed = [...`${W}x${H}${startPeople.map((t) => t.id).join("")}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 17);
  const hash = (ix: number, iy: number, k: number) => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(landSeed + k, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x: number, y: number, k: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (hash(x0, y0, k) * (1 - sx) + hash(x0 + 1, y0, k) * sx) * (1 - sy) + (hash(x0, y0 + 1, k) * (1 - sx) + hash(x0 + 1, y0 + 1, k) * sx) * sy;
  };
  const smooth01 = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
  const savanna = (cx: number, cy: number) => {
    const wx = (noise(cx / 9, cy / 9, 1) - 0.5) * 6, wy = (noise(cx / 9, cy / 9, 2) - 0.5) * 6;
    return 0.55 * patch(cx + wx, cy + wy) + 0.3 * noise(cx / 5.5, cy / 5.5, 3) + 0.15 * noise(cx / 2.2, cy / 2.2, 4);
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
    const high = new THREE.Color(biome.high), c = new THREE.Color(), rgb = { r: 0, g: 0, b: 0 }, rock = new THREE.Color(paintHex("--paint-grey-27")).lerp(new THREE.Color(paintHex("--paint-earth-21")), 0.35);
    const dry = new THREE.Color(biome.dry), green = new THREE.Color(biome.green), bankGreen = new THREE.Color(biome.bank), earth = new THREE.Color(paintHex("--paint-earth-39"));
    for (let py = 0; py < small.height; py += 1) for (let px = 0; px < small.width; px += 1) {
      const cx = (px + 0.5) / BASE, cy = (py + 0.5) / BASE;
      const dryness = Math.max(0, Math.min(1, (savanna(cx, cy) - 0.3 + biome.dryness) * 1.9));
      c.copy(green).lerp(dry, dryness);
      // Albedo separation before lighting (look.md §8.1): the dry savanna paler, the green deeper,
      // so the plate isn't one sage.
      c.offsetHSL(0, 0.05 * (1 - dryness), 0.11 * (dryness - 0.5));
      c.lerp(high, Math.min(1, elevationAt(cx, cy) / top) * 0.8);
      // Bare rock where the ground is steep (the scope's B2): an escarpment's face, an inselberg's
      // dome, a ridge's crest -- the land's shape read in its colour as well as its shading.
      const slope = (Math.hypot(elevationAt(cx + 0.5, cy) - elevationAt(cx - 0.5, cy), elevationAt(cx, cy + 0.5) - elevationAt(cx, cy - 0.5)) * HEIGHT) / M;
      // In outcrops, not a wash: broken by fine noise, so the grey reads as rock showing through.
      if (slope > 0.12) c.lerp(rock, Math.min(0.7, (slope - 0.12) * 3) * (0.25 + 0.75 * smooth01((noise(cx / 1.6, cy / 1.6, 9) - 0.3) * 2.2)));
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
      g.fillStyle = fleck() < 0.5 ? paintAlpha("--ink", 0.05 + fleck() * 0.07) : paintAlpha("--surface", 0.04 + fleck() * 0.06);
      g.fillRect(Math.floor(fleck() * 128), Math.floor(fleck() * 128), 1 + Math.floor(fleck() * 2), 1 + Math.floor(fleck() * 2));
    }
    paint.fillStyle = paint.createPattern(grain, "repeat")!;
    paint.fillRect(0, 0, groundCanvas.width, groundCanvas.height);
    // The rivers' banks, under their water: a darker damp margin, then pale sand at the edge.
    paint.lineJoin = paint.lineCap = "round";
    for (const [extra, style] of [[2.6, paintAlpha("--paint-bank", 0.28)], [1.1, paintAlpha("--paint-sand", 0.95)]] as const) {
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
    // Map version 13's scenery, painted in: swamp in patches of dark reedy green with standing pools;
    // the dry beds of seasonal streams, pale sand with a darker lip; dunes, the palest sand.
    const features = world.features ?? {};
    const marsh = seeded(`marsh-${W}-${H}`);
    for (const m of features.wetlands ?? []) {
      const g = paint.createRadialGradient(m.x * PX, m.y * PX, 0, m.x * PX, m.y * PX, m.r * PX);
      g.addColorStop(0, paintAlpha("--paint-green-20", 0.7));
      g.addColorStop(0.7, paintAlpha("--paint-green-14", 0.45));
      g.addColorStop(1, paintAlpha("--paint-green-14", 0));
      paint.fillStyle = g;
      paint.fillRect((m.x - m.r) * PX, (m.y - m.r) * PX, 2 * m.r * PX, 2 * m.r * PX);
      for (let k = 0; k < 3 + Math.floor(m.r); k += 1) {
        const a = marsh() * Math.PI * 2, d = marsh() * m.r * 0.6;
        paint.fillStyle = paintAlpha("--paint-blue-13", 0.55);
        paint.beginPath();
        paint.ellipse((m.x + Math.cos(a) * d) * PX, (m.y + Math.sin(a) * d) * PX, (0.25 + marsh() * 0.45) * PX, (0.15 + marsh() * 0.3) * PX, marsh() * Math.PI, 0, Math.PI * 2);
        paint.fill();
      }
    }
    for (const bed of features.dryBeds ?? []) {
      for (const [extra, style] of [[0.9, paintAlpha("--paint-earth-38", 0.45)], [0, paintAlpha("--paint-sand", 0.9)]] as const) {
        paint.strokeStyle = style;
        paint.lineWidth = (bed.width + extra) * PX;
        paint.beginPath();
        bed.points.forEach(([x, y], k) => (k ? paint.lineTo(x * PX, y * PX) : paint.moveTo(x * PX, y * PX)));
        paint.stroke();
      }
    }
    for (const d of features.dunes ?? []) {
      paint.save();
      paint.translate(d.x * PX, d.y * PX);
      paint.rotate(d.turn);
      const g = paint.createRadialGradient(0, 0, 0, 0, 0, Math.max(d.rx, d.ry) * PX);
      g.addColorStop(0, paintAlpha("--paint-earth-17", 0.95));
      g.addColorStop(0.75, paintAlpha("--paint-earth-17", 0.7));
      g.addColorStop(1, paintAlpha("--paint-earth-17", 0));
      paint.scale(1, d.ry / d.rx);
      paint.fillStyle = g;
      paint.beginPath();
      paint.arc(0, 0, d.rx * PX, 0, Math.PI * 2);
      paint.fill();
      paint.restore();
    }
    groundTexture.needsUpdate = true;
  }
  /** The land beyond the edge, recoloured to the horizon it fades into (day or night). */
  let recolourSkirt: (horizonHex: number) => void = () => {};
  /** The land's mesh, where a click's ray meets the ground (pickAt). */
  let landMesh: THREE.Mesh | null = null;
  {
    const geo = own(new THREE.PlaneGeometry((W - 1) * M, (H - 1) * M, (W - 1) * 2, (H - 1) * 2));
    geo.rotateX(-Math.PI / 2);
    geo.translate(((W - 1) * M) / 2, 0, ((H - 1) * M) / 2);
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i += 1) pos.setY(i, elevationAt(pos.getX(i) / M, pos.getZ(i) / M) * HEIGHT);
    geo.computeVertexNormals();
    const land = new THREE.Mesh(geo, own(withClouds(veiled(new THREE.MeshLambertMaterial({ map: groundTexture }), true))));
    land.receiveShadow = true;
    scene.add(land);
    landMesh = land;
    // Beyond the map's edge (your word, 2026-10-31: "land fades off", in place of the diorama's cut
    // slab): the land runs on -- the edge's own ground and height, rolling gently, the sea or a river
    // carried outward where they meet the edge -- and fades into the horizon's haze, so there is no
    // edge to see. A grid fine at the map and coarser outward, nothing on it; recoloured at night.
    const OUT = [2, 4, 6, 8, 11, 14, 18, 24, 32, 42, 56, 74, 98, 130, 170, 220, 290, 380];
    const axis = (n: number) => {
      const inner: number[] = [];
      for (let v = 0; v < n - 1; v += 2) inner.push(v);
      inner.push(n - 1);
      return [...OUT.map((d) => -d).reverse(), ...inner, ...OUT.map((d) => n - 1 + d)];
    };
    const xs = axis(W), ys = axis(H);
    /** The land beyond the edge: the edge's height gone within 12 cells (stretched further it drew the
     * edge's hills out as long straight ridges), and a gentle roll of its own coming in. */
    const skirtGround = (x: number, y: number) => {
      const cx = Math.max(0, Math.min(W - 1, x)), cy = Math.max(0, Math.min(H - 1, y));
      const d = Math.hypot(x - cx, y - cy);
      return elevationAt(cx, cy) * HEIGHT * Math.max(0, 1 - d / 12) + (noise(x / 34, y / 34, 21) - 0.5) * 9 * smooth01(d / 30);
    };
    // The sea at the edge carries on as sea, drawn with the map's own water so the two can't be told
    // apart; a river leaving the map runs on a little way and is lost in the land; the rest is land.
    const seaLines = (world.waterLines ?? []).filter((r) => !r.lake && [...(r.widths ?? [r.width])].sort((a, b) => a - b)[Math.floor((r.widths ?? [r.width]).length / 2)]! > 12);
    const seaCache = new Map<number, boolean>();
    const isSea = (cx: number, cy: number) => {
      const key = Math.round(cy) * W + Math.round(cx);
      let sea = seaCache.get(key);
      if (sea === undefined) {
        sea = terrain.water[key] === 1 && seaLines.some((r) => r.points.some(([px, py], k) => {
          const w = (r.widths?.[k] ?? r.width) / 2 + 1.5;
          return Math.hypot(px - cx, py - cy) < w;
        }));
        seaCache.set(key, sea);
      }
      return sea;
    };
    const skirtPos: number[] = [], landIndex: number[] = [], waterIndex: number[] = [], base: Array<{ c: THREE.Color; fade: number }> = [];
    const wetPos: number[] = [], wetShore: number[] = [];
    const vertexWater: boolean[] = [];
    const c = new THREE.Color(), dry = new THREE.Color(biome.dry), green = new THREE.Color(biome.green), high = new THREE.Color(biome.high);
    const top = terrain.elevation.reduce((m, e) => Math.max(m, e), 0) || 1;
    for (const y of ys) for (const x of xs) {
      const cx = Math.max(0, Math.min(W - 1, x)), cy = Math.max(0, Math.min(H - 1, y));
      const d = Math.hypot(x - cx, y - cy);
      const wetEdge = terrain.water[Math.round(cy) * W + Math.round(cx)] === 1;
      const water = wetEdge && isSea(cx, cy);
      vertexWater.push(water);
      const edge = elevationAt(cx, cy) * HEIGHT;
      // The edge's height gone within 12 cells (stretched further it drew the edge's hills out as
      // long straight ridges), and a gentle roll of its own coming in.
      const ground = skirtGround(x, y);
      // Tucked a hair under the map's own edge, so no seam shows where the two meet.
      skirtPos.push(x * M, d === 0 ? ground - 0.25 : ground, y * M);
      wetPos.push(x * M, edge + 0.6, y * M);
      // As deep as the map's own sea at the edge, deepening outward: no line where the two meet.
      wetShore.push((Math.max(0, landAt(cx, cy) - 0.5) + d) * M);
      // The savanna's patches near the map, settling to the region's average out where the grid is
      // coarse (sampled on its long cells, the patches smeared into streaks).
      const near = Math.max(0, Math.min(1, (savanna(x, y) - 0.3 + biome.dryness) * 1.9));
      const dryness = near + (Math.max(0, Math.min(1, (0.5 - 0.3 + biome.dryness) * 1.9)) - near) * smooth01(d / 24);
      c.copy(green).lerp(dry, dryness).offsetHSL(0, 0.05 * (1 - dryness), 0.11 * (dryness - 0.5));
      c.lerp(high, Math.min(1, elevationAt(cx, cy) / top) * 0.8 * Math.max(0, 1 - d / 12));
      base.push({ c: c.clone(), fade: smooth01(d / 230) ** 0.8 });
    }
    const skirtColours = new Float32Array(base.length * 3);
    const paintSkirt = (horizonHex: number) => {
      const horizon = new THREE.Color(horizonHex), mixed = new THREE.Color();
      base.forEach((b, i) => {
        mixed.copy(b.c).lerp(horizon, b.fade);
        skirtColours.set([mixed.r, mixed.g, mixed.b], i * 3);
      });
      skirtGeo.attributes.color!.needsUpdate = true;
    };
    const NX = xs.length;
    for (let j = 0; j < ys.length - 1; j += 1) for (let i = 0; i < NX - 1; i += 1) {
      // Not where the map is: only the ring round it.
      const inside = xs[i]! >= 0 && xs[i + 1]! <= W - 1 && ys[j]! >= 0 && ys[j + 1]! <= H - 1;
      if (inside) continue;
      const a = j * NX + i, b = a + 1, cc = a + NX, dd = cc + 1;
      const wetCorners = [a, b, cc, dd].filter((v) => vertexWater[v]).length;
      if (wetCorners >= 3) waterIndex.push(a, cc, b, b, cc, dd);
      if (wetCorners < 4) landIndex.push(a, cc, b, b, cc, dd);
    }
    const skirtGeo = own(new THREE.BufferGeometry());
    skirtGeo.setAttribute("position", new THREE.Float32BufferAttribute(skirtPos, 3));
    skirtGeo.setAttribute("color", new THREE.BufferAttribute(skirtColours, 3));
    skirtGeo.setIndex(landIndex);
    skirtGeo.computeVertexNormals();
    paintSkirt(HORIZON);
    const skirt = new THREE.Mesh(skirtGeo, own(withClouds(veiled(new THREE.MeshLambertMaterial({ vertexColors: true })))));
    skirt.receiveShadow = true;
    scene.add(skirt);
    recolourSkirt = paintSkirt;
    // A river that leaves the map runs on the way it was going, bending a little, narrowing to nothing
    // over 30 cells: lost in the land, not cut at the edge (nor carried on as a straight pipe).
    for (const river of world.waterLines ?? []) {
      if (river.lake || seaLines.includes(river)) continue;
      for (const end of [0, river.points.length - 1]) {
        const step = end === 0 ? 1 : -1;
        // From the last point on the map, outward along the line's last stretch.
        let k = end;
        while (k + step >= 0 && k + step < river.points.length && (river.points[k]![0] < 0 || river.points[k]![1] < 0 || river.points[k]![0] > W - 1 || river.points[k]![1] > H - 1)) k += step;
        const [ix, iy] = river.points[k]!, [px, py] = river.points[Math.max(0, Math.min(river.points.length - 1, k + step * 3))]!;
        const nearEdge = Math.min(ix, iy, W - 1 - ix, H - 1 - iy);
        // Not a creek that ends in the sea: it's arrived.
        if (nearEdge > 3 || isSea(Math.max(0, Math.min(W - 1, ix)), Math.max(0, Math.min(H - 1, iy)))) continue;
        let dir = Math.atan2(iy - py, ix - px);
        const w0 = river.widths?.[k] ?? river.width;
        const verts: number[] = [], acr: number[] = [], alo: number[] = [], wid: number[] = [], sho: number[] = [], idx: number[] = [];
        let x = ix, y = iy;
        const bend = ((ix * 31 + iy * 17) % 7) / 7 - 0.5;
        for (let n = 0; n <= 30; n += 1) {
          const t = n / 30, half = (w0 / 2) * (1 - t) ** 1.3;
          const nx = -Math.sin(dir), ny = Math.cos(dir);
          const h = Math.max(skirtGround(x, y), elevationAt(Math.max(0, Math.min(W - 1, x)), Math.max(0, Math.min(H - 1, y))) * HEIGHT) + 0.6;
          for (const side of [-1, 0, 1]) {
            verts.push((x + nx * half * side) * M, h, (y + ny * half * side) * M);
            acr.push(side * half * M);
            alo.push(n * M);
            wid.push(2 * half * M);
            sho.push((1 - Math.abs(side)) * half * M);
          }
          if (n > 0) {
            const a = (n - 1) * 3, b = n * 3;
            idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
          }
          dir += bend * 0.06;
          x += Math.cos(dir);
          y += Math.sin(dir);
        }
        const geo = own(new THREE.BufferGeometry());
        geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
        geo.setAttribute("aAcross", new THREE.Float32BufferAttribute(acr, 1));
        geo.setAttribute("aAlong", new THREE.Float32BufferAttribute(alo, 1));
        geo.setAttribute("aWidth", new THREE.Float32BufferAttribute(wid, 1));
        geo.setAttribute("aShore", new THREE.Float32BufferAttribute(sho, 1));
        geo.setAttribute("aSea", new THREE.Float32BufferAttribute(new Float32Array(verts.length / 3), 1));
        geo.setAttribute("aDeep", new THREE.Float32BufferAttribute(wid.map((w) => Math.max(6, Math.max(w, 8) * 0.35)), 1));
        geo.setIndex(idx);
        scene.add(new THREE.Mesh(geo, waterMaterial));
      }
    }
    if (waterIndex.length) {
      const n = wetPos.length / 3;
      const wetGeo = own(new THREE.BufferGeometry());
      wetGeo.setAttribute("position", new THREE.Float32BufferAttribute(wetPos, 3));
      wetGeo.setAttribute("aAcross", new THREE.Float32BufferAttribute(new Float32Array(n), 1));
      wetGeo.setAttribute("aAlong", new THREE.Float32BufferAttribute(new Float32Array(n), 1));
      wetGeo.setAttribute("aWidth", new THREE.Float32BufferAttribute(new Float32Array(n).fill(200), 1));
      wetGeo.setAttribute("aShore", new THREE.Float32BufferAttribute(wetShore, 1));
      wetGeo.setAttribute("aSea", new THREE.Float32BufferAttribute(new Float32Array(n).fill(1), 1));
      wetGeo.setAttribute("aDeep", new THREE.Float32BufferAttribute(new Float32Array(n).fill(90), 1));
      wetGeo.setIndex(waterIndex);
      scene.add(new THREE.Mesh(wetGeo, waterMaterial));
    }
  }

  // A ribbon along a polyline of cells, `width` metres (one each point, or one for all).
  // Where a bridge deck runs, by cell: the vehicles on it ride it, not the river bed.
  const decks = new Map<number, number>();
  const cellKey = (cx: number, cy: number) => Math.round(cy) * W + Math.round(cx);
  /** `piers`: bridge it over water, its piers added to this kit. */
  function ribbonGeometry(points: Point[], width: number | number[], lift: number, piers?: Kit): THREE.BufferGeometry {
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
          piers.box(2, height - foot, 2, tokenPaint("--paint-grey-7"), p.x * M, p.y * M, foot);
        }
      }
    }
    const verts: number[] = [], across: number[] = [], along: number[] = [];
    let run = 0;
    for (let i = 0; i < steps.length; i += 1) {
      const p = steps[i]!, q = steps[Math.min(steps.length - 1, i + 1)]!, o = steps[Math.max(0, i - 1)]!;
      if (i > 0) run += Math.hypot(p.x - steps[i - 1]!.x, p.y - steps[i - 1]!.y) * M;
      across.push(-1, 1);
      along.push(run, run);
      const dx = q.x - o.x, dy = q.y - o.y, len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (p.w / M / 2), ny = (dx / len) * (p.w / M / 2);
      const l = ground(p.x + nx, p.y + ny, lift), r = ground(p.x - nx, p.y - ny, lift);
      // A strip laid on a road (its lane, its centre line, a track's rails) rides the road's deck.
      if (!piers) {
        const under = decks.get(cellKey(p.x, p.y));
        if (under !== undefined) { l.y = Math.max(l.y, under + 0.12); r.y = Math.max(r.y, under + 0.12); }
      }
      const level = deck[i];
      if (level !== null) {
        l.y = Math.max(l.y, level + lift);
        r.y = Math.max(r.y, level + lift);
        decks.set(cellKey(p.x, p.y), Math.max(decks.get(cellKey(p.x, p.y)) ?? -Infinity, level + lift));
      }
      verts.push(l.x, l.y, l.z, r.x, r.y, r.z);
    }
    const index: number[] = [];
    for (let i = 0; i < steps.length - 1; i += 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    // Where across it (-1 its left edge, 1 its right) and how far along (metres) each point is: the
    // road's surface is painted from them (roadSurface).
    geo.setAttribute("aRoadAcross", new THREE.Float32BufferAttribute(across, 1));
    geo.setAttribute("aRoadAlong", new THREE.Float32BufferAttribute(along, 1));
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
    // One surface over all the water, not a ribbon a river (your look, 2026-10-30, map 8042's
    // delta: a ribbon wider than its bend folded into a fan where the estuary met the sea, and a
    // creek's sharp corners drew a sawtooth). A grid every half cell over the water; at each point
    // the distance to the shore (the water's lines as the 2D map draws them: a capsule each
    // stretch, so corners come out round), and its river's frame for the ripples -- metres along
    // the nearest line and across it. The shader cuts the edge where the distance reaches nought.
    const STEP = 0.5;
    const GW = Math.floor((W - 1) / STEP) + 1, GH = Math.floor((H - 1) / STEP) + 1;
    const shoreOf = new Float32Array(GW * GH).fill(1e6); // cells past the shore (negative: in the water)
    const riverOf = new Float32Array(GW * GH).fill(1e6), seaOf = new Float32Array(GW * GH).fill(1e6);
    const alongOf = new Float32Array(GW * GH), acrossOf = new Float32Array(GW * GH), widthOf = new Float32Array(GW * GH);
    // How far out still water takes to deepen: the sea ninety metres, a lake its own size.
    const stillDeep = new Float32Array(GW * GH).fill(90);
    for (const river of world.waterLines ?? []) {
      const widths = river.widths ?? river.points.map(() => river.width);
      // The sea: wide along its length (its typical width), not a river with one wide mouth.
      // A lake (map version 13) is still water too: the sea's slow drift, not a river's run.
      const sea = !!river.lake || [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)]! > 12;
      let run = 0;
      for (let k = 1; k < river.points.length; k += 1) {
        const [ax, ay] = river.points[k - 1]!, [bx, by] = river.points[k]!;
        const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-6;
        const wa = widths[k - 1]!, wb = widths[k]!;
        const reach = Math.max(wa, wb) / 2 + 1;
        const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / STEP)), x1 = Math.min(GW - 1, Math.ceil((Math.max(ax, bx) + reach) / STEP));
        const y0 = Math.max(0, Math.floor((Math.min(ay, by) - reach) / STEP)), y1 = Math.min(GH - 1, Math.ceil((Math.max(ay, by) + reach) / STEP));
        for (let gy = y0; gy <= y1; gy += 1) for (let gx = x0; gx <= x1; gx += 1) {
          const x = gx * STEP, y = gy * STEP;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (len * len)));
          const cx = ax + dx * t, cy = ay + dy * t;
          const d = Math.hypot(x - cx, y - cy) - (wa + (wb - wa) * t) / 2;
          const i = gy * GW + gx;
          if (d < shoreOf[i]!) shoreOf[i] = d;
          if (sea) {
            if (d < seaOf[i]!) { seaOf[i] = d; stillDeep[i] = river.lake ? Math.max(8, (river.width / 2) * M * 0.6) : 90; }
            continue;
          }
          if (d >= riverOf[i]!) continue;
          riverOf[i] = d;
          alongOf[i] = (run + t * len) * M;
          acrossOf[i] = (((x - ax) * -dy + (y - ay) * dx) / len) * M;
          widthOf[i] = (wa + (wb - wa) * t) * M;
        }
        run += len;
      }
    }
    // A quad wherever a corner is in the water or within a step of it, so the cut edge has room.
    const verts: number[] = [], across: number[] = [], along: number[] = [], wide: number[] = [], shore: number[] = [], seaness: number[] = [], deep: number[] = [], index: number[] = [];
    const vertexAt = new Int32Array(GW * GH).fill(-1);
    const vertex = (gx: number, gy: number) => {
      const i = gy * GW + gx;
      if (vertexAt[i]! >= 0) return vertexAt[i]!;
      const x = gx * STEP, y = gy * STEP;
      verts.push(x * M, elevationAt(x, y) * HEIGHT + 0.6, y * M);
      across.push(acrossOf[i]!);
      along.push(alongOf[i]!);
      wide.push(widthOf[i]! || 8);
      // The sea's share: 1 well inside it, 0 well inside a river, between over six cells.
      const sea = Math.max(0, Math.min(1, 0.5 + (riverOf[i]! - seaOf[i]!) / 6));
      seaness.push(sea);
      deep.push(Math.max(6, Math.max(widthOf[i]! || 8, 8) * 0.35) * (1 - sea) + stillDeep[i]! * sea);
      // In the sea, the shore is the land's: never nearer than the line's own edge says, never shallower
      // than the dry land's distance allows (the line's far side, off the map, isn't a shore).
      const line = -shoreOf[i]! * M;
      shore.push(line <= 0 ? line : line + (Math.max(line, Math.max(0, landAt(x, y) - 0.5) * M) - line) * sea);
      return (vertexAt[i] = verts.length / 3 - 1);
    };
    for (let gy = 0; gy < GH - 1; gy += 1) for (let gx = 0; gx < GW - 1; gx += 1) {
      const corners = [gy * GW + gx, gy * GW + gx + 1, (gy + 1) * GW + gx, (gy + 1) * GW + gx + 1];
      if (corners.every((c) => shoreOf[c]! > STEP)) continue;
      const a = vertex(gx, gy), b = vertex(gx + 1, gy), c = vertex(gx, gy + 1), d = vertex(gx + 1, gy + 1);
      index.push(a, c, b, b, c, d);
    }
    const geo = own(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 1));
    geo.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
    geo.setAttribute("aWidth", new THREE.Float32BufferAttribute(wide, 1));
    geo.setAttribute("aShore", new THREE.Float32BufferAttribute(shore, 1));
    geo.setAttribute("aSea", new THREE.Float32BufferAttribute(seaness, 1));
    geo.setAttribute("aDeep", new THREE.Float32BufferAttribute(deep, 1));
    geo.setIndex(index);
    scene.add(new THREE.Mesh(geo, waterMaterial));
  }

  // --- Roads: one mesh each, rebuilt when the network changes, recoloured as traffic does ----
  /** `line`, `lift`: where it runs and how high, for its focus line (drawn the first time it's lit). */
  const roads = new Map<string, { mesh: THREE.Mesh; material: THREE.MeshLambertMaterial; retired: boolean; rail: boolean; base: number; look: string; line: Point[]; lift: number; focusLine?: THREE.Mesh }>();
  const focusLineMaterial = own(new THREE.MeshBasicMaterial({ color: FOCUS_COLOUR, side: THREE.DoubleSide }));
  // Track in its parts (2026-11-02, your word: "since the vehicles look better we could improve the
  // roads/rails"): sleepers across the ballast, two steel rails on them -- rust on a line out of
  // service, grass through its ballast -- telegraph poles along it, barriers where a road crosses.
  const railMaterial = own(new THREE.MeshLambertMaterial({ color: paintHex("--paint-grey-4"), side: THREE.DoubleSide }));
  const rustMaterial = own(new THREE.MeshLambertMaterial({ color: paintHex("--paint-earth-51"), side: THREE.DoubleSide }));
  const sleeperShape = own(new THREE.BoxGeometry(2.6, 0.2, 0.34));
  const sleeperMaterial = own(new THREE.MeshLambertMaterial({ color: paintHex("--paint-earth-55") }));
  const oldSleeperMaterial = own(new THREE.MeshLambertMaterial({ color: paintHex("--paint-grey-11") }));
  const tuftShape = own(new THREE.ConeGeometry(0.45, 0.7, 5).translate(0, 0.35, 0));
  const tuftMaterial = own(new THREE.MeshLambertMaterial({ color: paintHex("--paint-green-13") }));
  const poleShape = own((() => {
    const k = new Kit();
    k.cylinder(0.13, 7, paintHex("--paint-earth-57"), 0, 0, 0, 6);
    k.box(1.8, 0.15, 0.15, paintHex("--paint-earth-57"), 0, 0, 6.3);
    for (const x of [-0.7, 0, 0.7]) k.box(0.1, 0.25, 0.1, paintHex("--paint-light-4"), x, 0, 6.45);
    return k.merged();
  })());
  const poleMaterial = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  // Every line a road runs (for keeping buildings off them).
  let roadLines: Point[][] = [];
  const pierMaterial = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const drop = (mesh: THREE.Mesh) => {
    scene.remove(mesh);
    mesh.geometry.dispose();
    for (const child of mesh.children) (child as THREE.Mesh).geometry?.dispose();
  };
  /** A line with `from` cells cut off its start and `to` off its end. */
  function trimmed(line: Point[], from: number, to: number): Point[] {
    const [, rest] = splitPolyline(line, from);
    const [kept] = splitPolyline(rest, Math.max(0, polylineLength(rest) - to));
    return kept.length >= 2 ? kept : rest.slice(0, 2);
  }
  /** A polyline moved `off` cells to its left (negative: right), for a lane down a road's side. */
  function offsetLine(points: Point[], off: number): Point[] {
    return points.map((p, k) => {
      const a = points[Math.max(0, k - 1)]!, b = points[Math.min(points.length - 1, k + 1)]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: p.x - ((b.y - a.y) / len) * off, y: p.y + ((b.x - a.x) / len) * off };
    });
  }
  const laneMaterial = own(new THREE.MeshLambertMaterial({ color: paintHex("--paint-red-1"), side: THREE.DoubleSide }));
  // A road's surface, painted in its shader from where across and how far along it is (2026-11-02):
  // a dirt road's laterite grain, the two ruts its wheels wear, its ragged dusty edge; a paved
  // road's asphalt, its shoulders, white edge lines and dashed centre; a retired road going back
  // to grass; a track's ballast. Its wear (the condition the game keeps) breaks it up: potholes,
  // and patching on asphalt. The traffic tint (colourRoad) is its colour underneath, as before.
  const ROAD_KIND = { dirt: 0, paved: 1, retired: 2, ballast: 3 };
  function roadSurface(material: THREE.MeshLambertMaterial, kind: number, width: number): THREE.MeshLambertMaterial {
    const u = { uRoadKind: { value: kind }, uRoadWear: { value: 0 }, uRoadWidth: { value: width }, uRoadPaint: { value: new THREE.Color(paintHex("--paint-light-4")) }, uRoadVerge: { value: new THREE.Color(paintHex("--paint-earth-31")) }, uRoadGrass: { value: new THREE.Color(paintHex("--paint-green-12")) } };
    material.userData.road = u;
    const before = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      before.call(material, shader, renderer);
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aRoadAcross;\nattribute float aRoadAlong;\nvarying float vRoadAcross;\nvarying float vRoadAlong;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRoadAcross = aRoadAcross;\nvRoadAlong = aRoadAlong;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", /* glsl */ `#include <common>
          varying float vRoadAcross;
          varying float vRoadAlong;
          uniform float uRoadKind, uRoadWear, uRoadWidth;
          uniform vec3 uRoadPaint, uRoadVerge, uRoadGrass;
          float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float rNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 w = f * f * (3.0 - 2.0 * f);
            return mix(mix(rHash(i), rHash(i + vec2(1.0, 0.0)), w.x), mix(rHash(i + vec2(0.0, 1.0)), rHash(i + vec2(1.0, 1.0)), w.x), w.y);
          }`)
        .replace("#include <color_fragment>", /* glsl */ `#include <color_fragment>
          {
            float a = vRoadAcross, s = vRoadAlong, x = a * uRoadWidth * 0.5;
            vec2 p = vec2(s, x);
            float grain = rHash(floor(p * 4.0)) * 0.5 + rNoise(p * 0.8) * 0.5;
            vec3 col = diffuseColor.rgb;
            if (uRoadKind < 0.5) {
              // Laterite: grain, two ruts where the wheels run, a dusty ragged edge.
              float rut = exp(-pow((abs(x) - uRoadWidth * 0.22) / 0.5, 2.0));
              col *= 0.88 + grain * 0.2 - rut * 0.18;
              float edge = abs(a) + (rNoise(vec2(s * 0.3, a * 9.0)) - 0.5) * 0.22;
              if (edge > 0.98) discard;
              col = mix(col, col * 1.15, smoothstep(0.72, 0.96, edge));
            } else if (uRoadKind < 1.5) {
              // Asphalt: its grain, the shoulders, a white line each edge, the centre dashed.
              col *= 0.92 + grain * 0.12;
              col = mix(col, uRoadVerge, smoothstep(0.86, 0.9, abs(a)));
              float edgeLine = 1.0 - smoothstep(0.012, 0.03, abs(abs(a) - 0.8));
              float dash = (1.0 - smoothstep(0.1, 0.16, abs(x))) * step(fract(s / 9.0), 0.36);
              col = mix(col, uRoadPaint, max(edgeLine, dash) * (0.9 - uRoadWear * 0.55));
            } else if (uRoadKind < 2.5) {
              // Retired: the grass coming back through it.
              float back = smoothstep(0.4, 0.75, rNoise(p * 0.35) + abs(a) * 0.35);
              col = mix(col * (0.9 + grain * 0.15), uRoadGrass, back * 0.8);
            } else {
              // Ballast: stones, darker down its shoulders.
              float stones = rHash(floor(p * 7.0));
              col *= (0.78 + stones * 0.32) * (1.0 - smoothstep(0.55, 1.0, abs(a)) * 0.22);
            }
            if (uRoadWear > 0.05 && uRoadKind < 1.5) {
              // Worn: potholes, and on asphalt the patches over the old ones.
              float hole = smoothstep(1.0 - uRoadWear * 0.2, 1.0 - uRoadWear * 0.16, rNoise(p * 0.5 + 17.0)) * (1.0 - step(0.78, abs(a)));
              if (uRoadKind > 0.5) {
                float patchy = step(1.0 - uRoadWear * 0.3, rHash(floor(vec2(s / 3.5, x / 2.2) + 31.0))) * (1.0 - step(0.76, abs(a)));
                col = mix(col, col * 0.7, patchy);
              }
              col = mix(col, col * 0.42, hole);
            }
            diffuseColor.rgb = col;
          }`);
    };
    return material;
  }
  /** What a road is drawn as: rebuilt when it changes -- paved, laned, retired (what you've done to it shows). */
  const roadLook = (segment: { retiredAt?: number; surface?: string; busLane?: boolean; type: string }) => `${segment.type}:${segment.retiredAt !== undefined}:${segment.surface ?? ""}:${!!segment.busLane}`;
  function syncRoads(w: GameWorld): void {
    const segments = w.simulation.map.segments;
    const seen = new Set<string>();
    // Track's parts once the roads are known: no sleepers where a road runs over the track.
    const pendingTracks: Array<{ mesh: THREE.Mesh; line: Point[]; lift: number; disused: boolean }> = [];
    const atStations = stationNodes(w);
    for (const segment of segments) {
      seen.add(segment.id);
      const retired = segment.retiredAt !== undefined;
      const known = roads.get(segment.id);
      const disused = segment.type === "rail" && w.railOutOfService.has(segment.id);
      // Track stops short of a station: its throats and platforms carry it in (stations3d.ts).
      const whole = segmentPolyline(w.simulation.map, segment);
      const length = polylineLength(whole);
      const cutFrom = segment.type === "rail" && !retired ? reachAlong(w, segment.fromNodeId, length, atStations) / M : 0;
      const cutTo = segment.type === "rail" && !retired ? reachAlong(w, segment.toNodeId, length, atStations) / M : 0;
      const look = `${roadLook(segment)}:${disused}:${cutFrom.toFixed(2)}:${cutTo.toFixed(2)}`;
      if (known && known.look === look) continue;
      if (known) {
        drop(known.mesh);
        known.material.dispose();
      }
      const line = cutFrom || cutTo ? trimmed(whole, cutFrom, cutTo) : whole;
      const rail = segment.type === "rail";
      // Track: a ballast bed with the rails' dark band on it; a road: tarmac or dirt, coloured by its traffic.
      // A dirt road is laterite and narrower; a paved one is asphalt with a centre line; a bus lane
      // a red band down its side. What you've paved and laned reads from the air.
      const paved = segment.surface === "paved";
      const base = rail ? paintHex("--paint-grey-9") : retired ? ROAD_COLOURS.retired : paved ? ROAD_COLOURS.paved : ROAD_COLOURS.dirt;
      const width = rail ? 4.6 : retired ? 5 : paved ? 10 : 7.5;
      const material = roadSurface(withClouds(new THREE.MeshLambertMaterial({ color: base, side: THREE.DoubleSide })), rail ? ROAD_KIND.ballast : retired ? ROAD_KIND.retired : paved ? ROAD_KIND.paved : ROAD_KIND.dirt, width);
      // Each a hair above the last: two roads on one line don't flicker through each other.
      const piers = new Kit();
      const lift = 0.35 + (roads.size % 6) * 0.04;
      const mesh = new THREE.Mesh(ribbonGeometry(line, width, lift, piers), material);
      mesh.receiveShadow = true;
      // Track by its own width and surface, never hue (look.md §8.5): a narrow ballast bed, sleepers
      // across it, two steel rails on them -- against a road's one wide surface.
      if (rail) pendingTracks.push({ mesh, line, lift, disused });
      if (!rail && !retired && segment.busLane) for (const side of [1, -1]) mesh.add(new THREE.Mesh(ribbonGeometry(offsetLine(line, (side * 3.4) / M), 2.4, lift + 0.06), laneMaterial));
      if (!piers.empty) {
        const legs = new THREE.Mesh(piers.merged(), pierMaterial);
        legs.castShadow = true;
        mesh.add(legs);
      }
      scene.add(mesh);
      roads.set(segment.id, { mesh, material, retired, rail, base, look, line, lift });
      crossingsKey = "";
    }
    for (const [id, road] of roads) {
      if (seen.has(id)) continue;
      drop(road.mesh);
      road.material.dispose();
      roads.delete(id);
    }
    roadLines = segments.filter((s) => s.retiredAt === undefined).map((s) => segmentPolyline(w.simulation.map, s));
    if (pendingTracks.length) {
      const ways = segments.filter((s) => s.type === "road" && s.retiredAt === undefined).map((s) => segmentPolyline(w.simulation.map, s));
      for (const t of pendingTracks) trackParts(t.mesh, t.line, t.lift, t.disused, ways);
    }
    if (!crossingsKey) buildCrossings();
  }
  /** Points every `spacing` metres along a line (cells), with its heading there. */
  function along(line: Point[], spacing: number, from = spacing / 2): Array<{ x: number; y: number; heading: number }> {
    const out: Array<{ x: number; y: number; heading: number }> = [];
    let next = from, run = 0;
    for (let k = 1; k < line.length; k += 1) {
      const a = line[k - 1]!, b = line[k]!, len = Math.hypot(b.x - a.x, b.y - a.y) * M;
      while (next <= run + len) {
        const t = (next - run) / len;
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading: Math.atan2(b.y - a.y, b.x - a.x) });
        next += spacing;
      }
      run += len;
    }
    return out;
  }
  /** The ground (or the deck it's on) under a point, in metres. */
  const floorAt = (x: number, y: number) => {
    const deck = decks.get(cellKey(x, y));
    return Math.max(elevationAt(x, y) * HEIGHT, deck === undefined ? -Infinity : deck);
  };
  const up3 = new THREE.Vector3(0, 1, 0);
  /** A line of track's parts on its ballast: sleepers, rails, poles beside it; grass where it's out of service. */
  function trackParts(mesh: THREE.Mesh, line: Point[], lift: number, disused: boolean, ways: Point[][], withPoles = true): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
    const near = ways.filter((way) => way.some((p) => line.some((r) => Math.hypot(p.x - r.x, p.y - r.y) < 12)));
    const underRoad = (x: number, y: number) => near.some((way) => way.some((p, k) => k > 0 && distToSegment(x, y, way[k - 1]!, p) < 5.6 / M));
    const sleepers = along(line, 1.4).filter((p) => !underRoad(p.x, p.y));
    const ties = new THREE.InstancedMesh(sleeperShape, disused ? oldSleeperMaterial : sleeperMaterial, Math.max(1, sleepers.length));
    sleepers.forEach((p, i) => {
      q.setFromAxisAngle(up3, -p.heading + Math.PI / 2);
      ties.setMatrixAt(i, m.compose(at.set(p.x * M, floorAt(p.x, p.y) + lift + 0.12, p.y * M), q, one));
    });
    ties.count = sleepers.length;
    ties.receiveShadow = true;
    mesh.add(ties);
    for (const side of [1, -1]) mesh.add(new THREE.Mesh(ribbonGeometry(offsetLine(line, (side * 0.75) / M), 0.22, lift + 0.42), disused ? rustMaterial : railMaterial));
    // Telegraph poles along the line, a few metres off it, not in the water.
    const poles = !withPoles ? [] : along(line, 46, 20).filter((p) => !wetNear(p.x - Math.sin(p.heading) * 0.6, p.y + Math.cos(p.heading) * 0.6));
    if (poles.length) {
      const posts = new THREE.InstancedMesh(poleShape, poleMaterial, poles.length);
      poles.forEach((p, i) => {
        const x = p.x - Math.sin(p.heading) * 0.6, y = p.y + Math.cos(p.heading) * 0.6;
        q.setFromAxisAngle(up3, -p.heading);
        posts.setMatrixAt(i, m.compose(at.set(x * M, elevationAt(x, y) * HEIGHT - 0.2, y * M), q, one));
      });
      posts.castShadow = true;
      mesh.add(posts);
    }
    // Out of service: grass in tufts through the ballast.
    if (disused) {
      const tufts = along(line, 2.2, 1).filter((p) => !underRoad(p.x, p.y));
      const grass = new THREE.InstancedMesh(tuftShape, tuftMaterial, Math.max(1, tufts.length));
      const rand = seeded(`tufts-${line[0]!.x},${line[0]!.y}`);
      tufts.forEach((p, i) => {
        const off = (rand() - 0.5) * 3.6;
        const x = p.x - Math.sin(p.heading) * (off / M), y = p.y + Math.cos(p.heading) * (off / M);
        q.setFromAxisAngle(up3, rand() * 6);
        grass.setMatrixAt(i, m.compose(at.set(x * M, floorAt(x, y) + lift + 0.1, y * M), q, one.clone().setScalar(0.6 + rand() * 0.8)));
      });
      grass.count = tufts.length;
      mesh.add(grass);
    }
  }
  // Level crossings: where a road crosses the track between towns, its boards, a barrier each side
  // and the cross-buck signs. One mesh for all, rebuilt when the network changes.
  let crossings: THREE.Mesh | null = null;
  let crossingsKey = "";
  function buildCrossings(): void {
    crossingsKey = "built";
    if (crossings) { scene.remove(crossings); crossings.geometry.dispose(); crossings = null; }
    const tracks = [...roads.values()].filter((r) => r.rail).map((r) => r.line);
    const ways = [...roads.values()].filter((r) => !r.rail && !r.retired).map((r) => r.line);
    const kit = new Kit();
    for (const way of ways) for (const track of tracks) for (let i = 1; i < way.length; i += 1) for (let j = 1; j < track.length; j += 1) {
      const a = way[i - 1]!, b = way[i]!, c = track[j - 1]!, d = track[j]!;
      const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (Math.abs(den) < 1e-9) continue;
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den, u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      // Not at a town or station, where they meet anyway; not on a bridge.
      const ends = [way[0]!, way[way.length - 1]!, track[0]!, track[track.length - 1]!];
      if (ends.some((e) => Math.hypot(e.x - x, e.y - y) < 2) || decks.has(cellKey(x, y))) continue;
      const roadDir = Math.atan2(b.y - a.y, b.x - a.x), railDir = Math.atan2(d.y - c.y, d.x - c.x);
      const floor = elevationAt(x, y) * HEIGHT;
      const one = new Kit();
      one.box(5.2, 0.12, 9, paintHex("--paint-earth-57"), 0, 0, 0.5);
      kit.place(one.merged(), x * M, floor, y * M, -railDir);
      // A barrier on the road each side of the track, on its right, its boom lowered across.
      for (const side of [1, -1]) {
        const bx = x + Math.cos(roadDir) * side * (7 / M) + Math.sin(roadDir) * side * (5.5 / M), by = y + Math.sin(roadDir) * side * (7 / M) - Math.cos(roadDir) * side * (5.5 / M);
        const post = new Kit();
        post.box(0.5, 1.3, 0.5, paintHex("--paint-grey-20"), 0, 0);
        post.box(0.18, 0.18, 7, paintHex("--paint-light-1"), 0, 3.4, 1.1);
        for (let k = 0; k < 3; k += 1) post.box(0.2, 0.2, 0.9, paintHex("--paint-red-3"), 0, 1.4 + k * 2, 1.1);
        post.cylinder(0.08, 3.2, paintHex("--paint-grey-20"), 0, -1.2, 0, 4);
        post.box(1.8, 0.18, 0.06, paintHex("--paint-light-1"), 0, -1.2, 2.9, Math.PI / 4);
        post.box(1.8, 0.18, 0.06, paintHex("--paint-light-1"), 0, -1.2, 2.9, -Math.PI / 4);
        kit.place(post.merged(), bx * M, elevationAt(bx, by) * HEIGHT, by * M, -roadDir + (side > 0 ? Math.PI : 0));
      }
    }
    if (kit.empty) return;
    crossings = new THREE.Mesh(kit.merged(), material);
    crossings.castShadow = true;
    scene.add(crossings);
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
    const byId = new Map(w.simulation.map.segments.map((s) => [s.id, s]));
    for (const [id, road] of roads) {
      if (road.retired) continue;
      colourRoad(w, id, road);
      // Its wear, as the game keeps it (wear.ts: the condition, toward its floor): potholes and patches.
      const surface = road.material.userData.road as { uRoadWear: { value: number } } | undefined;
      const segment = byId.get(id);
      if (surface && segment && !road.rail) surface.uRoadWear.value = Math.max(0, Math.min(1, (1 - segment.condition) / (1 - MIN_CONDITION)));
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
      road.material.color.setHex(w.railOutOfService.has(id) ? paintHex("--paint-earth-18") : paintHex("--paint-grey-9"));
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
  const material = own(withClouds(new THREE.MeshLambertMaterial({ vertexColors: true })));
  /** Whether a point (cells) is in a river as drawn, `pad` cells wide of it: for places near `at`. */
  function wetAround(at: { x: number; y: number }, reach: number): (x: number, y: number, pad: number) => boolean {
    const banks = (world.waterLines ?? []).flatMap((river) => river.points.slice(1).map((b, k) => ({ a: { x: river.points[k]![0], y: river.points[k]![1] }, b: { x: b[0], y: b[1] }, half: ((river.widths?.[k] ?? river.width) + (river.widths?.[k + 1] ?? river.width)) / 4 })))
      .filter(({ a, b }) => Math.min(Math.hypot(a.x - at.x, a.y - at.y), Math.hypot(b.x - at.x, b.y - at.y)) < reach);
    return (x, y, pad) => isWater(terrain, Math.round(x), Math.round(y)) || banks.some((s) => distToSegment(x, y, s.a, s.b) < s.half + pad);
  }
  /** Where each site's buildings stand (cells), once it's been set beside its roads. */
  /** Where each site is drawn (cells) and which way it's turned (siteKit). */
  const siteAt = new Map<string, { x: number; y: number; ry: number }>();
  /** Within `pad` metres of this site's yard (SITE_YARD, turned as it's drawn). */
  function yardHas(site: GameTown, cx: number, cy: number, pad: number): boolean {
    const at = siteAt.get(site.id) ?? { x: site.x, y: site.y, ry: 0 };
    const yard = SITE_YARD[site.industry ?? ""] ?? { w: 40, d: 30 }, S = siteScale(site.industry ?? "");
    const wx = (cx - at.x) * M, wz = (cy - at.y) * M, c = Math.cos(at.ry), sn = Math.sin(at.ry);
    return Math.abs(wx * c - wz * sn) < (yard.w * S) / 2 + pad && Math.abs(wx * sn + wz * c) < (yard.d * S) / 2 + pad;
  }
  /** Within `pad` metres of any site's yard: the towns build round them. */
  function inYard(cx: number, cy: number, pad: number): boolean {
    return sites.some((s) => yardHas(s, cx, cy, pad));
  }
  let sites: GameTown[] = [];
  let people: GameTown[] = [];
  /** A house of a town's fabric, in its town's frame: drawn as instances, walls and roof apart. */
  /** `floors`: a block's, each banded with windows (0 for a house). */
  interface House { x: number; y: number; z: number; w: number; d: number; h: number; rh: number; ry: number; floors: number; wall: string; roof: string }
  let fabric: House[] = [];
  /** A piece of a town's own street, in its town's frame: one plot long, laid along `ry`. */
  interface Street { x: number; y: number; z: number; long: number; wide: number; ry: number; colour: number }
  let streets: Street[] = [];
  /** A town's markets, in its town's frame (metres): where its shoppers are (syncPeople). */
  let markets: Array<{ x: number; z: number; big: boolean }> = [];
  /** And everything it built, in its frame (metres, each with its radius): what you build there keeps clear. */
  let footprint: Array<{ x: number; z: number; r: number }> = [];
  function townKit(town: GameTown, tier: Tier, boom = false): Kit {
    fabric = [];
    streets = [];
    markets = [];
    footprint = [];
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
    // And off its heart, kept for a roundabout (syncRings) as a road is.
    const nearRoad = (x: number, y: number, clear: number) =>
      Math.hypot(x - town.x, y - town.y) < RING_OUTER / M + clear ||
      local.some((line) => line.some((p, k) => k > 0 && distToSegment(x, y, line[k - 1]!, p) < clear)) || onStationGround(x, y, clear * M) || onParkGround(x, y, clear);
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
        if (inYard(cx, cy, r + 4) || onQuay(cx, cy, (r + 4) / M)) continue;
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
      if (put(14, 0.35, (k, rr) => market(k, rr, 0, 0, tier === "town" ? 6 : 12))) markets.push({ ...placed[placed.length - 1]!, big: true });
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
        if (inYard(cx, cy, r + 3) || onQuay(cx, cy, (r + 4) / M)) continue;
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
        if (inYard(cx, cy, 0) || onQuay(cx, cy, 0.5)) return;
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
    // Along its roads out, past its edge (the fidelity scope, B4): a Nigerian town ribbons along its
    // highways -- compounds and shops lining the road for a way, thinning as they go -- so from afar
    // a town reads as a star along its roads, not a disc. Not past half way to the next town; its own
    // stream of chance, so the rest of the town is drawn as before.
    {
      const rr = seeded(`ribbon-${town.id}`);
      const inner = (radius / M) * 0.85;
      const nearest = people.reduce((d, t) => (t.id === town.id ? d : Math.min(d, Math.hypot(t.x - town.x, t.y - town.y))), Infinity);
      const outer = Math.min(radius / M + (tier === "village" ? 2 : 3 + Math.sqrt(town.population) * 0.55), nearest * 0.45);
      for (const line of local) {
        let from = -1, gap = Infinity;
        line.forEach((p, k) => { const d = Math.hypot(p.x - town.x, p.y - town.y); if (d < gap) [gap, from] = [d, k]; });
        if (gap > inner + 1) continue;
        for (const step of [1, -1]) {
          for (let k = from; k + step >= 0 && k + step < line.length; k += step) {
            const a = line[k]!, b = line[k + step]!;
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-6;
            const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
            let done = false;
            for (let t = 0; t < len; t += 1.3) {
              const px = a.x + tx * t, py = a.y + ty * t;
              const e = Math.hypot(px - town.x, py - town.y);
              if (e > outer) { done = true; break; }
              if (e < inner) continue;
              const chance = 0.8 * (1 - (e - inner) / Math.max(1, outer - inner));
              for (const side of [1, -1]) {
                if (rr() > chance) continue;
                const off = (8.5 + rr() * 3) / M;
                const cx = px - ty * off * side, cy = py + tx * off * side;
                const x = (cx - town.x) * M, z = (cy - town.y) * M;
                if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 3.2)) continue;
                if (wet(cx, cy, 4.2 / M) || nearRoad(cx, cy, 7.5 / M)) continue;
                if (inYard(cx, cy, 4) || onQuay(cx, cy, 1)) continue;
                placed.push({ x, z, r: 3.2 });
                const y = Math.min(elevationAt(cx - 0.4, cy), elevationAt(cx + 0.4, cy), elevationAt(cx, cy - 0.4), elevationAt(cx, cy + 0.4)) * HEIGHT - base - 0.2;
                const flat = rr() < 0.3;
                fabric.push({
                  x, y, z, w: 5 + rr() * 2.5, d: 4.5 + rr() * 2, h: 3, rh: flat ? 0.25 : 1.3 + rr() * 0.6, ry: -Math.atan2(ty, tx), floors: 0,
                  wall: WALLS[Math.floor(rr() * WALLS.length)]!, roof: flat ? CONCRETE[Math.floor(rr() * CONCRETE.length)]! : ROOFS[Math.floor(rr() * ROOFS.length)]!,
                });
              }
            }
            if (done) break;
          }
        }
      }
    }
    // A town growing past its size (growth.ts growthTrend): trade spills out -- more market
    // umbrellas and stalls through its streets. Placed last, so the rest of it stays put.
    if (boom && tier !== "village") {
      const extra = tier === "city" ? 10 : tier === "regional" ? 7 : 4;
      for (let i = 0; i < extra; i += 1) if (put(7, 0.75, (k, rr) => market(k, rr, 0, 0, 2 + Math.floor(rr() * 3)))) markets.push({ ...placed[placed.length - 1]!, big: false });
    }
    footprint = placed.map((b) => ({ ...b }));
    return kit;
  }
  // Where a site goes (your look, 2026-11-02: a quarry left as two strips of wall, a road through its
  // pit; 2026-11-04: its plant to scale, a lorry park before its gate). A site with a lorry park (and
  // the airport, its bus park) is set like a field: its gate toward its point, behind the park's
  // ground (PARK_FRONT) and pushed back as far as it must be, any of 16 ways round, off the road in;
  // its plant drawn SITE_SCALE larger, its pieces tested along their length, graded level on a bank,
  // its fence and the drive to its gate at their own size. The rest (a border post, a station) as
  // before: beside its roads, whichever of four ways loses least to roads and water. Its pieces are
  // surveyed once, dry, and tried at each place against a map of how far the roads are.
  function siteKit(town: GameTown): { kit: Kit; extras: Kit | null; scale: number; x: number; z: number; ry: number; floor: number; clear: (x: number, z: number, r: number) => boolean } {
    const kind = town.industry!;
    const airport = kind === "airport", field = airport || hasLorryPark(kind), S = siteScale(kind);
    const local = roadLines.filter((line) => line.some((p) => Math.hypot(p.x - town.x, p.y - town.y) < (field ? 60 : 30)));
    const wet = wetAround(town, field ? 70 : 40);
    const STEP = field ? 4 : 2, HALF = field ? (airport ? 80 : 64) : 48, SIDE = HALF * 2 + 1;
    // How far the roads are, a grid round its point (metres), each cell worked out when first asked.
    const roadDist = new Float32Array(SIDE * SIDE).fill(-1);
    const roadAt = (gx: number, gy: number) => {
      const i = gy * SIDE + gx;
      if (roadDist[i]! < 0) {
        const x = town.x + ((gx - HALF) * STEP) / M, y = town.y + ((gy - HALF) * STEP) / M;
        let d = Infinity;
        for (const line of local) for (let k = 1; k < line.length; k += 1) d = Math.min(d, distToSegment(x, y, line[k - 1]!, line[k]!));
        roadDist[i] = d * M;
      }
      return roadDist[i]!;
    };
    // And the yards already placed near it (sites are placed one by one): a neighbour's is taken ground.
    const neighbours = sites.filter((s) => s.id !== town.id && siteAt.has(s.id) && Math.hypot(siteAt.get(s.id)!.x - town.x, siteAt.get(s.id)!.y - town.y) < (field ? 45 : 20));
    // And their parks' ground, before their gates (laid once every site is set: syncParks).
    const neighbourParks = neighbours.filter((s) => s.industry === "airport" || hasLorryPark(s.industry ?? "")).map((s) => {
      const at = siteAt.get(s.id)!;
      return siteParkGround(s.id, { x: s.x, y: s.y }, Math.atan2(-Math.cos(at.ry), -Math.sin(at.ry)));
    });
    // A field keeps off the stations; it shies from the towns (their houses then keep off it, as off any yard).
    const nearTowns = field ? people.filter((t) => Math.hypot(t.x - town.x, t.y - town.y) < 70).map((t) => ({ x: t.x, y: t.y, reach: reachOf(t, tierOf(t.population, false), people).radius / M })) : [];
    /** Clear to stand a piece of radius r at (wx, wz) metres from the site's point. */
    const clearAt = (wx: number, wz: number, r: number) => {
      const gx = Math.round(wx / STEP) + HALF, gy = Math.round(wz / STEP) + HALF;
      const road = gx >= 0 && gy >= 0 && gx < SIDE && gy < SIDE ? roadAt(gx, gy) : Infinity;
      if (road < r + 5) return false;
      const cx = town.x + wx / M, cy = town.y + wz / M;
      if (field && onStationGround(cx, cy, r)) return false;
      return !wet(cx, cy, r / M) && !neighbours.some((s) => yardHas(s, cx, cy, r + 2)) && !neighbourParks.some((p) => inPark(p, { x: cx, y: cy }, r + 2));
    };
    const placed = (ox: number, oz: number, ry: number) => {
      const c = Math.cos(ry), sn = Math.sin(ry);
      return (x: number, z: number, r: number) => clearAt(ox + x * c + z * sn, oz - x * sn + z * c, r);
    };
    // Surveyed in its tables' metres, tried at its drawn size.
    const survey = new SurveyKit(field);
    site(survey, seeded(town.id), kind, !field);
    const pieces = survey.pieces.map(([x, z, r]) => [x * S, z * S, r * S] as const);
    const table = SITE_YARD[kind] ?? { w: 40, d: 30, gate: 0 };
    const yard = { w: table.w * S, d: table.d * S, gate: table.gate * S };
    // The ground under the yard, in metres: 5 by 5 points over it. Set at their mean, and a site
    // on a slope half buried, so flat ground counts in the choosing (2026-11-02: a quarry moved up
    // a hillside sank its crusher and dump truck into it).
    const groundUnder = (ox: number, oz: number, ry: number) => {
      const c = Math.cos(ry), sn = Math.sin(ry);
      let low = Infinity, high = -Infinity, sum = 0;
      for (let i = 0; i <= 4; i += 1) for (let j = 0; j <= 4; j += 1) {
        const x = (i / 4 - 0.5) * yard.w, z = (j / 4 - 0.5) * yard.d;
        const h = elevationAt(town.x + (ox + x * c + z * sn) / M, town.y + (oz - x * sn + z * c) / M) * HEIGHT;
        low = Math.min(low, h);
        high = Math.max(high, h);
        sum += h;
      }
      return { mean: sum / 25, rise: high - low, high };
    };
    let best = { ox: 0, oz: 0, ry: 0, score: Infinity };
    if (field) {
      const arms = local.filter((line) => Math.hypot(line[0]!.x - town.x, line[0]!.y - town.y) < 0.5 || Math.hypot(line[line.length - 1]!.x - town.x, line[line.length - 1]!.y - town.y) < 0.5)
        .map((line) => { const from = Math.hypot(line[0]!.x - town.x, line[0]!.y - town.y) < 0.5 ? line : [...line].reverse(); const q = from[Math.min(from.length - 1, 3)]!; return Math.atan2(q.y - town.y, q.x - town.x); });
      for (let k = 0; k < 16; k += 1) {
        const ry = (k / 16) * Math.PI * 2, c = Math.cos(ry), sn = Math.sin(ry);
        // Out from the point toward the yard (map frame): the yard's -z.
        const axis = Math.atan2(-c, -sn);
        let turn = 0;
        for (const a of arms) { const off = Math.abs(Math.atan2(Math.sin(axis - a), Math.cos(axis - a))); if (off < 1) turn += 60 * (1 - off); }
        for (const push of [0, 16, 32, 48, 64, 88, 112]) {
          // Its gate on the line out from the point: the yard set back, and aside by where its gate is.
          const L = PARK_FRONT + yard.d / 2 + push, ox = -L * sn - yard.gate * c, oz = -L * c + yard.gate * sn;
          const clear = placed(ox, oz, ry);
          let lost = 0;
          for (const [x, z, r] of pieces) {
            if (!clear(x, z, r)) lost += 1 + r;
            const cx = town.x + (ox + x * c + z * sn) / M, cy = town.y + (oz - x * sn + z * c) / M;
            if (nearTowns.some((t) => Math.hypot(cx - t.x, cy - t.y) < t.reach + r / M)) lost += 0.5;
          }
          // Its park's ground and the drive to the gate, in front.
          for (let f = 14; f < PARK_FRONT + push; f += 8) for (const x of [-30, -15, 0, 15, 30]) if (Math.abs(x) < 10 || f < PARK_FRONT) if (!clear(yard.gate + x, yard.d / 2 + f, 4)) lost += 3;
          const score = lost + turn + push * 0.12 + groundUnder(ox, oz, ry).rise * 2;
          if (score < best.score) best = { ox, oz, ry, score };
        }
      }
    }
    const offsets: Array<[number, number]> = [[0, 0]];
    for (const reach of [12, 22, 34, 46]) for (let k = 0; k < 12; k += 1) offsets.push([Math.cos((k / 12) * Math.PI * 2) * reach, Math.sin((k / 12) * Math.PI * 2) * reach]);
    for (const ry of field ? [] : [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const c = Math.cos(ry), sn = Math.sin(ry);
      for (const [ox, oz] of offsets) {
        const clear = placed(ox, oz, ry);
        let lost = 0;
        for (const [x, z, r] of pieces) if (!clear(x, z, r)) lost += 1 + r;
        const gx = ox + yard.gate * c + (yard.d / 2) * sn, gz = oz - yard.gate * sn + (yard.d / 2) * c;
        const score = lost + Math.hypot(gx, gz) * 0.08 + groundUnder(ox, oz, ry).rise * 2;
        if (score < best.score) best = { ox, oz, ry, score };
      }
    }
    const placedAt = placed(best.ox, best.oz, best.ry);
    // In its tables' metres (its kit's), as the plant is drawn: scaled to the ground.
    const clear = (x: number, z: number, r: number) => placedAt(x * S, z * S, r * S);
    const kit = new ClearKit(clear, field);
    site(kit, seeded(town.id), kind, !field);
    const under = groundUnder(best.ox, best.oz, best.ry);
    let floor = under.mean - 0.1;
    let extras: Kit | null = null;
    if (field) {
      // Graded level at its highest ground, on a bank down to its lowest: a thin slab (a runway, a
      // yard's paving) on rolling ground at its mean sank out of sight wherever the ground rose.
      // At its own size, in the yard's metres: the bank, the drive out to its point, its fence.
      floor = under.high - 0.05;
      const bank = under.rise + 0.6;
      extras = new Kit();
      extras.box(yard.w + 2, bank, yard.d + 2, tokenPaint(airport ? "--paint-green-20" : "--paint-earth-17"), 0, 0, -bank + 0.02);
      // From its gate out to the back of its park (which stands PARK_FRONT - 4 from its point).
      const push = Math.max(0, Math.hypot(best.ox + yard.gate * Math.cos(best.ry), best.oz - yard.gate * Math.sin(best.ry)) - yard.d / 2 - PARK_FRONT);
      const reach = push + 5;
      extras.box(9, 0.12 + bank, reach, tokenPaint("--paint-grey-21"), yard.gate, yard.d / 2 + reach / 2 - 1, -bank);
      yardFence(extras, yard.w, yard.d, yard.gate);
    }
    siteAt.set(town.id, { x: town.x + best.ox / M, y: town.y + best.oz / M, ry: best.ry });
    return { kit, extras, scale: S, x: best.ox, z: best.oz, ry: best.ry, floor, clear };
  }
  // --- A site at work (the fidelity list, 2026-11-01: "sites that show their state") --------------
  // What a working site gives off (shapes3d.ts SITE_LIFE): a stack's smoke, a refinery's flare, a
  // mill's steam, a quarry's dust, an oilfield's nodding pump jacks -- each as strong as the site runs
  // (production.ts: what it makes of what it could), and still when it stands idle. The smoke and dust
  // are one set of points for the whole map, moved on the graphics card; only whether each is on
  // changes, twice a second.
  const PUFFS = 2400;
  const puffBase = new Float32Array(PUFFS * 3), puffPhase = new Float32Array(PUFFS), puffKind = new Float32Array(PUFFS), puffOn = new Float32Array(PUFFS);
  let puffsUsed = 0;
  const puffGeo = own(new THREE.BufferGeometry());
  puffGeo.setAttribute("position", new THREE.BufferAttribute(puffBase, 3));
  puffGeo.setAttribute("aPhase", new THREE.BufferAttribute(puffPhase, 1));
  puffGeo.setAttribute("aKind", new THREE.BufferAttribute(puffKind, 1));
  puffGeo.setAttribute("aOn", new THREE.BufferAttribute(puffOn, 1));
  puffGeo.setDrawRange(0, 0);
  const puffMaterial = own(new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uHalfH: { value: 500 },
      uSmoke: { value: new THREE.Color(paintHex("--paint-grey-1")) },
      uDark: { value: new THREE.Color(paintHex("--paint-grey-23")) },
      uSteam: { value: new THREE.Color(paintHex("--paint-light-2")) },
      uDust: { value: new THREE.Color(paintHex("--paint-earth-17")) },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aKind;
      attribute float aOn;
      uniform float uTime;
      uniform float uHalfH;
      varying float vAlpha;
      varying float vKind;
      #include <fog_pars_vertex>
      void main() {
        // A puff's life: rising and spreading as it drifts downwind, fading out. Smoke climbs high,
        // steam less, dust hangs low.
        float rise = aKind < 1.5 ? 70.0 : aKind < 2.5 ? 30.0 : 9.0;
        float grow = aKind < 1.5 ? 16.0 : aKind < 2.5 ? 9.0 : 8.0;
        float speed = aKind < 2.5 ? 0.09 : 0.14;
        float t = fract(uTime * speed + aPhase);
        vec3 p = position + vec3(t * t * 55.0 + sin(aPhase * 40.0 + t * 6.0) * 2.0, t * rise, t * t * 22.0 + cos(aPhase * 31.0) * 2.0);
        vAlpha = aOn * pow(1.0 - t, 0.6) * smoothstep(0.0, 0.06, t);
        vKind = aKind;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        // Its size in metres, as the camera's lens sees it (as three's own points: the projection over
        // the depth, times half the drawing's height in pixels).
        gl_PointSize = (2.5 + t * grow) * projectionMatrix[1][1] * uHalfH / max(1.0, -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSmoke;
      uniform vec3 uDark;
      uniform vec3 uSteam;
      uniform vec3 uDust;
      varying float vAlpha;
      varying float vKind;
      #include <fog_pars_fragment>
      void main() {
        if (vAlpha <= 0.01) discard;
        float r = length(gl_PointCoord - 0.5) * 2.0;
        // A full round puff, lit from above: its top catches the sun, its underside is in shade.
        float soft = 1.0 - smoothstep(0.5, 1.0, r);
        if (soft <= 0.01) discard;
        vec3 c = vKind < 0.5 ? uSmoke : vKind < 1.5 ? uDark : vKind < 2.5 ? uSteam : uDust;
        c *= mix(1.1, 0.5, gl_PointCoord.y);
        // Smoke and steam thick by the stack; dust a thin haze -- it hung over a quarry's crusher and
        // its lorries like a wall.
        gl_FragColor = vec4(c, soft * (vKind < 2.5 ? min(1.0, vAlpha * 1.6) * (vKind < 1.5 ? 0.95 : 0.85) : vAlpha * 0.3));
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  }));
  const puffs = new THREE.Points(puffGeo, puffMaterial);
  puffs.frustumCulled = false;
  puffs.renderOrder = 3;
  scene.add(puffs);
  // A flare: a yellow root and a long orange tongue, unlit, so it burns by night as by day.
  const flareMaterial = own(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const flareShape = own(new Kit().merged());
  {
    const k = new Kit();
    k.cone(1.9, 3.5, paintHex("--paint-earth-49"), 0, 0, 0, 7, 0);
    k.cone(1.5, 8, paintHex("--paint-earth-45"), 0, 0, 1, 7, 0);
    flareShape.copy(k.merged());
  }
  const beamShape = own(new Kit().merged());
  {
    const k = new Kit();
    k.box(6, 0.6, 0.6, paintHex("--paint-red-3"));
    k.box(0.9, 1.4, 0.9, paintHex("--paint-grey-23"), 2.8, 0, -1.2);
    beamShape.copy(k.merged());
  }
  interface SiteLife {
    id: string; puffs: Array<[number, number]>; flares: THREE.Mesh[]; jacks: THREE.Mesh[]; diggers: THREE.Object3D[]; share: number; angle: number;
    /** What it can't get away, piled in its yard: one mesh, drawn as far as `ends[k]` for k items. */
    stock: { mesh: THREE.Mesh; ends: number[] } | null;
    /** Its lorries at the loading bay: one mesh, drawn as far as `ends[k]` for k of them. */
    bay: { mesh: THREE.Mesh; ends: number[] } | null;
  }
  const diggerShape = (() => { const e = excavator(); return { base: own(e.base), upper: own(e.upper) }; })();
  /** Pieces built one after another into one mesh, and where each ends, so it can be drawn up to any of them. */
  function pieces(count: number, make: (kit: Kit, i: number) => void): { geo: THREE.BufferGeometry; ends: number[] } | null {
    const parts: THREE.BufferGeometry[] = [], ends: number[] = [0];
    for (let i = 0; i < count; i += 1) {
      const kit = new Kit();
      make(kit, i);
      if (kit.empty) continue;
      const geo = kit.merged();
      parts.push(geo);
      ends.push(ends[ends.length - 1]! + geo.attributes.position!.count);
    }
    if (!parts.length) return null;
    const geo = mergeGeometries(parts, false)!;
    for (const part of parts) part.dispose();
    geo.setDrawRange(0, 0);
    return { geo, ends };
  }
  const lives = new Map<string, SiteLife>();
  function addSiteLife(town: GameTown, mesh: THREE.Mesh, clear: (x: number, z: number, r: number) => boolean): void {
    const plan = SITE_LIFE[town.industry!] ?? [];
    const life: SiteLife = { id: town.id, puffs: [], flares: [], jacks: [], diggers: [], share: 0, angle: 0, stock: null, bay: null };
    const rand = seeded(`life-${town.id}`);
    const kind = town.industry!;
    // Its stock pile, and its lorries at the bay: each a mesh of pieces, drawn as far as needed.
    // Where its kind keeps it (laid out clear of its buildings: shapes3d.ts); on a road, it goes without.
    const room = (x: number, z: number, r: number): [number, number] | undefined => (clear(x, z, r) ? [x, z] : undefined);
    const store = SITE_STOCK[kind];
    const storeAt = store && room(store.x, store.z, 4);
    if (store && storeAt) {
      const built = pieces(store.n, (kit, i) => store.item(kit, rand, i));
      if (built) {
        const pile = new THREE.Mesh(own(built.geo), material);
        pile.position.set(storeAt[0], 0, storeAt[1]);
        // A heap is the plant's (scaled with it); sacks, coils and cars are their own size.
        if (kind !== "quarry" && kind !== "ironmine" && kind !== "coalmine") pile.scale.setScalar(1 / mesh.scale.x);
        pile.castShadow = true;
        pile.receiveShadow = true;
        mesh.add(pile);
        life.stock = { mesh: pile, ends: built.ends };
      }
    }
    const bay = SITE_BAY[kind];
    const bayAt = bay && room(bay.x, bay.z, 5);
    if (bay && bayAt) {
      const lorry = vehicleGeometry(bay.vehicle);
      // Side by side across the bay, scaled as the vehicles on the roads are.
      const built = pieces(3, (kit, i) => kit.place(lorry, (i - 1) * 3.4, 0.35 / VEHICLE_SCALE, 0, Math.PI / 2));
      lorry.dispose();
      if (built) {
        // As the vehicles on the roads are, whatever the plant's scale.
        const k = VEHICLE_SCALE / mesh.scale.x;
        built.geo.scale(k, k, k);
        const lorries = new THREE.Mesh(own(built.geo), material);
        lorries.position.set(bayAt[0], 0, bayAt[1]);
        lorries.rotation.y = bay.ry;
        lorries.castShadow = true;
        mesh.add(lorries);
        life.bay = { mesh: lorries, ends: built.ends };
      }
    }
    for (const e of plan) {
      // Not where its piece was left out (on a road, in the water): nothing to come out of.
      if (!clear(e.x, e.z, 1.5)) continue;
      if (e.what === "flare") {
        const flare = new THREE.Mesh(flareShape, flareMaterial);
        flare.position.set(e.x, e.y, e.z);
        flare.visible = false;
        mesh.add(flare);
        life.flares.push(flare);
      } else if (e.what === "digger") {
        if (!clear(e.x, e.z, 6)) continue;
        const digger = new THREE.Group();
        const base = new THREE.Mesh(diggerShape.base, material);
        const upper = new THREE.Mesh(diggerShape.upper, material);
        base.castShadow = upper.castShadow = true;
        upper.position.y = 1.4;
        digger.add(base, upper);
        digger.position.set(e.x, e.y, e.z);
        digger.scale.setScalar(VEHICLE_SCALE / mesh.scale.x);
        digger.rotation.y = rand() * Math.PI * 2;
        mesh.add(digger);
        life.diggers.push(upper);
      } else if (e.what === "pumpjack") {
        const beam = new THREE.Mesh(beamShape, material);
        beam.position.set(e.x, e.y, e.z);
        beam.castShadow = true;
        mesh.add(beam);
        life.jacks.push(beam);
      } else {
        const n = e.what === "dust" ? 18 : e.what === "steam" ? 14 : 26;
        if (puffsUsed + n > PUFFS) continue;
        const kind = e.what === "smoke" ? 0 : e.what === "darkSmoke" ? 1 : e.what === "steam" ? 2 : 3;
        const c = Math.cos(mesh.rotation.y), sn = Math.sin(mesh.rotation.y), S = mesh.scale.x;
        const ex = (e.x * c + e.z * sn) * S, ez = (-e.x * sn + e.z * c) * S;
        for (let i = 0; i < n; i += 1) {
          const k = puffsUsed + i;
          puffBase.set([mesh.position.x + ex + (rand() - 0.5) * (kind === 3 ? 8 : 1), mesh.position.y + e.y * S, mesh.position.z + ez + (rand() - 0.5) * (kind === 3 ? 8 : 1)], k * 3);
          puffPhase[k] = i / n + rand() * 0.02;
          puffKind[k] = kind;
          puffOn[k] = 0;
        }
        life.puffs.push([puffsUsed, n]);
        puffsUsed += n;
      }
    }
    puffGeo.setDrawRange(0, puffsUsed);
    for (const name of ["position", "aPhase", "aKind", "aOn"]) puffGeo.attributes[name]!.needsUpdate = true;
    lives.set(town.id, life);
  }
  function dropSiteLife(id: string | undefined): void {
    const life = id ? lives.get(id) : undefined;
    if (!life) return;
    for (const [from, n] of life.puffs) puffOn.fill(0, from, from + n);
    puffGeo.attributes.aOn!.needsUpdate = true;
    lives.delete(life.id);
  }
  /** Twice a second: how hard each site works, its smoke and flare by it. */
  function syncSiteLife(w: GameWorld): void {
    if (!lives.size) return;
    const flows = goodsFlows(w);
    for (const life of lives.values()) {
      const p = siteProduction(w, life.id, flows);
      life.share = p && p.capacity > 0 ? Math.min(1, p.made / p.capacity) : 0;
      for (const [from, n] of life.puffs) puffOn.fill(life.share > 0.02 ? 0.45 + 0.55 * life.share : 0, from, from + n);
      for (const f of life.flares) f.visible = life.share > 0.05;
      // The stock it can't get away: as much as waits (made, not carried); none while it's idle.
      // Its lorries loading: as many as it ships, one at least while it's working.
      const made = p ? Math.min(1, p.made / Math.max(1e-9, p.capacity)) : 0;
      const waiting = made > 0.02 ? Math.min(1, 0.15 + (1 - (p?.shipped ?? 1)) * 1.1) : 0;
      if (life.stock) life.stock.mesh.geometry.setDrawRange(0, life.stock.ends[Math.round(waiting * (life.stock.ends.length - 1))]!);
      const loading = made > 0.02 ? Math.max(1, Math.min(3, Math.round((p?.shipped ?? 0) * 3 + 0.3))) : 0;
      if (life.bay) life.bay.mesh.geometry.setDrawRange(0, life.bay.ends[Math.min(loading, life.bay.ends.length - 1)]!);
    }
    puffGeo.attributes.aOn!.needsUpdate = true;
  }
  // The seaport's harbour: where imports land (gateways.ts), drawn at the coast nearest its city -- a
  // jetty into the sea, an apron of containers, gantry cranes swinging, a ship moored alongside and
  // more out in the roads; a crane and a ship more for each rung the port has grown (upgradePort).
  const harbourCranes: THREE.Object3D[] = [];
  const harbourTugs: Array<{ mesh: THREE.Mesh; x: number; z: number; ux: number; uz: number }> = [];
  // A ship's wake: a V of foam spreading behind her, fading -- painted once, laid flat behind each.
  const wakeShape = own(new THREE.PlaneGeometry(80, 34).rotateX(-Math.PI / 2));
  const wakeMaterial = own(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: own((() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const g = canvas.getContext("2d")!;
    for (let i = 0; i < 26; i += 1) {
      const t = i / 26;
      g.strokeStyle = paintAlpha("--paint-light-1", 0.8 * (1 - t) ** 1.2);
      g.lineWidth = 4 + t * 7;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(256 - t * 256, 64 + side * (8 + t * 54));
        g.lineTo(256 - (t + 0.05) * 256, 64 + side * (8 + (t + 0.05) * 54));
        g.stroke();
      }
      // The churned water right behind her: broad and white, thinning back.
      g.fillStyle = paintAlpha("--paint-light-1", 0.6 * (1 - t) ** 2.5);
      g.fillRect(256 - (t + 0.04) * 256, 64 - 9 - t * 12, 0.04 * 256 + 1, 18 + t * 24);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  })()) }));
  const harbourShips: Array<{ mesh: THREE.Mesh; cx: number; cz: number; r: number; speed: number; phase: number }> = [];
  const harbourParts: THREE.Object3D[] = [];
  let harbourLevel = -1;
  // Its quay is chosen once, before any town is drawn, so the city's houses keep off it (onQuay): the
  // nearest stretch of coast past the city's centre and clear of other towns and the old roads -- dry
  // ground at the water's edge, open sea off it (four cells or more from land), room behind for the apron.
  let quay: { cx: number; cy: number; ux: number; uy: number } | null | undefined;
  function quaySpot(): { cx: number; cy: number; ux: number; uy: number } | null {
    if (quay !== undefined) return quay;
    quay = null;
    const id = world.seaport ?? world.port;
    const city = id ? world.towns.get(id) : undefined;
    if (!city || city.industry) return null;
    const lines = roadLines.filter((line) => line.some((p) => Math.hypot(p.x - city.x, p.y - city.y) < 60));
    const dry = (x: number, y: number) => {
      const i = Math.round(y) * W + Math.round(x);
      return x >= 0 && y >= 0 && x < W && y < H && terrain.water[i] !== 1 && bankDist[i]! >= 0.6 && !lines.some((line) => line.some((p, k) => k > 0 && distToSegment(x, y, line[k - 1]!, p) < 1));
    };
    const others = [...world.towns.values()].filter((t) => t.id !== city.id);
    const near = (x: number, y: number) =>
      Math.hypot(city.x - x, city.y - y) < (reachCells.get(city.id) ?? 3) * 0.8 ||
      others.some((t) => Math.hypot(t.x - x, t.y - y) < (t.industry ? 5 : (reachCells.get(t.id) ?? 3) + 3));
    const coast: Array<{ x: number; y: number; d: number }> = [];
    for (let y = Math.max(1, Math.floor(city.y - 45)); y <= Math.min(H - 2, Math.ceil(city.y + 45)); y += 1)
      for (let x = Math.max(1, Math.floor(city.x - 45)); x <= Math.min(W - 2, Math.ceil(city.x + 45)); x += 1) {
        const i = y * W + x;
        if (terrain.water[i] === 1 || (terrain.water[i - 1] !== 1 && terrain.water[i + 1] !== 1 && terrain.water[i - W] !== 1 && terrain.water[i + W] !== 1)) continue;
        coast.push({ x, y, d: Math.hypot(x - city.x, y - city.y) });
      }
    coast.sort((a, b) => a.d - b.d);
    for (const c of coast) {
      if (near(c.x, c.y)) continue;
      // Which way the open sea lies: the nearest water cell well out from land.
      let open: { x: number; y: number; d: number } | null = null;
      for (let y = c.y - 7; y <= c.y + 7; y += 1) for (let x = c.x - 7; x <= c.x + 7; x += 1) {
        if (x < 0 || y < 0 || x >= W || y >= H || terrain.water[y * W + x] !== 1 || toLand[y * W + x]! < 4) continue;
        const d = Math.hypot(x - c.x, y - c.y);
        if (!open || d < open.d) open = { x, y, d };
      }
      if (!open) continue;
      const ux = (open.x - c.x) / open.d, uy = (open.y - c.y) / open.d;
      let clear = !near(c.x - ux * 5, c.y - uy * 5);
      for (let a = -5; a <= -1 && clear; a += 1) for (let b = -4; b <= 4 && clear; b += 2) clear = dry(c.x + ux * a - uy * b, c.y + uy * a + ux * b);
      if (clear) return (quay = { cx: c.x, cy: c.y, ux, uy });
    }
    return null;
  }
  /** Within `pad` cells of the quay's apron: the city builds round it. */
  function onQuay(x: number, y: number, pad: number): boolean {
    const q = quaySpot();
    return !!q && Math.hypot(q.cx - q.ux * 2.5 - x, q.cy - q.uy * 2.5 - y) < 5.2 + pad;
  }
  /** Built when the land is planted; built again when the port grows a rung. */
  function syncHarbour(w: GameWorld): void {
    if ((w.portLevel ?? 0) === harbourLevel) return;
    for (const part of harbourParts.splice(0)) {
      scene.remove(part);
      part.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    harbourCranes.length = 0;
    harbourShips.length = 0;
    harbourTugs.length = 0;
    harbourLevel = w.portLevel ?? 0;
    buildHarbour(w);
  }
  function buildHarbour(w: GameWorld): void {
    const spot = quaySpot();
    if (!spot) return;
    const { cx, cy, ux, uy } = spot, px = -uy, py = ux;
    const level = w.portLevel ?? 0;
    const kit = new Kit();
    const turn = -Math.atan2(uy, ux);
    const at = (along: number, across: number) => ({ x: (cx + ux * along + px * across) * M, z: (cy + uy * along + py * across) * M });
    const top = elevationAt(cx, cy) * HEIGHT;
    // The jetty, on piles, out into the sea; the apron behind it.
    const jetty = at(3.5, 0);
    kit.add(new THREE.BoxGeometry(9 * M, 1.2, 1.4 * M), paintHex("--paint-earth-14"), { x: jetty.x, y: 2, z: jetty.z, ry: turn });
    for (let i = 0; i < 8; i += 1) {
      const pile = at(0.5 + i, 0.5);
      kit.cylinder(0.5, 3, paintHex("--paint-grey-20"), pile.x, pile.z, -0.6, 6);
    }
    const apron = at(-2.5, 0);
    kit.add(new THREE.BoxGeometry(5 * M, 0.6, 9 * M), paintHex("--paint-grey-21"), { x: apron.x, y: top + 0.1, z: apron.z, ry: turn });
    const rand = seeded(`harbour-${w.seaport ?? w.port}`);
    const boxes = [paintHex("--paint-red-3"), paintHex("--paint-blue-12"), paintHex("--paint-earth-52"), paintHex("--paint-green-24"), paintHex("--paint-grey-4")];
    for (let i = 0; i < 10 + level * 6; i += 1) {
      const stack = at(-1.5 - (i % 3) * 1.1, -3.5 + Math.floor(i / 3) * 1.2);
      const tiers = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < tiers; k += 1) kit.add(new THREE.BoxGeometry(6, 2.5, 2.5), boxes[Math.floor(rand() * boxes.length)]!, { x: stack.x, y: top + 1.6 + k * 2.6, z: stack.z, ry: turn });
    }
    // No trees on the apron: its own turned rectangle, and a cell round it.
    for (let y = Math.floor(cy - 8); y <= Math.ceil(cy + 8); y += 1) for (let x = Math.floor(cx - 8); x <= Math.ceil(cx + 8); x += 1) {
      const along = (x - cx) * ux + (y - cy) * uy, across = (x - cx) * px + (y - cy) * py;
      if (along >= -6 && along <= 1 && Math.abs(across) <= 5.5 && x >= 0 && y >= 0 && x < W && y < H && (occupied[y * W + x] === FREE || occupied[y * W + x] === TOWN)) occupied[y * W + x] = QUAY;
    }
    // A shed across the back of the apron, where cargo waits for its lorries; lorries queued along
    // its side for the next load.
    const shed = at(-4.4, 0);
    kit.add(new THREE.BoxGeometry(9, 7, 7 * M), paintHex("--paint-grey-6"), { x: shed.x, y: top + 3.5, z: shed.z, ry: turn });
    kit.gable(7 * M, 10, 2.4, paintHex("--paint-grey-13"), shed.x, shed.z, top + 7, turn + Math.PI / 2);
    for (let i = 0; i < 2 + level; i += 1) {
      const bay = at(-3.6 + i * 1.3, 4.6);
      kit.place(vehicleGeometry("truck").clone().scale(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE), bay.x, top + 0.4, bay.z, turn);
    }
    // A breakwater on the open side: a rubble arm out from the coast, its end hooked round to
    // shelter the jetty -- stones only where there's sea under them.
    const arm: Array<[number, number]> = [];
    for (let a = 1; a <= 13; a += 0.32) arm.push([a, -5.5]);
    for (let k = 1; k <= 8; k += 1) arm.push([13 + Math.sin((k / 8) * Math.PI / 2) * 2.2, -5.5 + (1 - Math.cos((k / 8) * Math.PI / 2)) * 3.6]);
    for (const [along, across] of arm) {
      const stone = at(along + (rand() - 0.5) * 0.25, across + (rand() - 0.5) * 0.35);
      const cell = Math.round(stone.z / M) * W + Math.round(stone.x / M);
      if (terrain.water[cell] !== 1) continue;
      kit.add(new THREE.DodecahedronGeometry(1.7 + rand() * 1.1, 0), rand() < 0.5 ? paintHex("--paint-grey-14") : paintHex("--paint-grey-12"), { x: stone.x, y: 0.7 + rand() * 0.6, z: stone.z, rx: rand() * 3, ry: rand() * 3 });
    }
    const harbour = new THREE.Mesh(kit.merged(), material);
    harbour.castShadow = true;
    harbour.receiveShadow = true;
    scene.add(harbour);
    harbourParts.push(harbour);
    // Gantry cranes on the quay, their booms out over the water, swinging as they work.
    for (let i = 0; i <= level; i += 1) {
      const base = at(0, -2 + i * 2.2);
      const crane = new THREE.Group();
      const legs = new Kit();
      for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]] as const) legs.box(0.8, 22, 0.8, paintHex("--paint-earth-52"), lx, lz);
      legs.box(8, 2, 8, paintHex("--paint-earth-52"), 0, 0, 22);
      const legMesh = new THREE.Mesh(legs.merged(), material);
      legMesh.castShadow = true;
      crane.add(legMesh);
      const boom = new THREE.Group();
      const arm = new Kit();
      arm.box(40, 1.6, 1.6, paintHex("--paint-earth-52"), 14, 0);
      arm.box(1, 6, 1, paintHex("--paint-grey-20"), 28, 0, -6);
      const armMesh = new THREE.Mesh(arm.merged(), material);
      armMesh.castShadow = true;
      boom.add(armMesh);
      boom.position.y = 23;
      crane.add(boom);
      crane.position.set(base.x, top, base.z);
      crane.rotation.y = turn;
      scene.add(crane);
      harbourParts.push(crane);
      harbourCranes.push(boom);
    }
    // A ship moored alongside the jetty; more in the roads, sailing slowly round.
    const moored = at(4.5, 2);
    const ship = new THREE.Mesh(cargoShip(rand), material);
    ship.position.set(moored.x, 0.6, moored.z);
    ship.rotation.y = turn;
    ship.castShadow = true;
    scene.add(ship);
    harbourParts.push(ship);
    // A tug at her bow, nudging.
    const tugAt = at(9.6, 2.9);
    const tug = new THREE.Mesh(own(tugBoat()), material);
    tug.castShadow = true;
    tug.position.set(tugAt.x, 0.6, tugAt.z);
    tug.rotation.y = turn + Math.PI / 2;
    scene.add(tug);
    harbourParts.push(tug);
    harbourTugs.push({ mesh: tug, x: tugAt.x, z: tugAt.z, ux, uz: uy });
    const taken: Array<{ x: number; z: number; r: number }> = [];
    for (let i = 0; i < 1 + level; i += 1) {
      // Out in the roads, the nearest place whose whole circle is open sea, clear of the jetty, its
      // ship and the others. Where the map's sea is a coastal strip (the open water past its edge),
      // the circle may run out over the sea beyond -- where the edge is sea, never over land.
      const r = 6 + i * 2;
      const seaAt = (x: number, y: number) => {
        if (x >= 1 && y >= 1 && x <= W - 2 && y <= H - 2) return terrain.water[y * W + x] === 1 && toLand[y * W + x]! >= 3;
        const ex = Math.max(1, Math.min(W - 2, x)), ey = Math.max(1, Math.min(H - 2, y));
        return terrain.water[ey * W + ex] === 1;
      };
      let centre: { x: number; z: number } | null = null, best = Infinity;
      for (let along = 14; along <= 48; along += 2) for (let across = -30; across <= 30; across += 3) {
        const c = at(along, across);
        const d = Math.hypot(along, across);
        if (d >= best) continue;
        let open = true;
        for (let a = 0; a < 20 && open; a += 1) open = seaAt(Math.round(c.x / M + Math.cos((a / 20) * Math.PI * 2) * r), Math.round(c.z / M + Math.sin((a / 20) * Math.PI * 2) * r));
        if (!open || taken.some((t) => Math.hypot(t.x - c.x, t.z - c.z) < (t.r + r * M) * 1.2)) continue;
        best = d;
        centre = c;
      }
      if (!centre) continue;
      taken.push({ ...centre, r: r * M });
      const sailing = new THREE.Mesh(cargoShip(rand), material);
      sailing.castShadow = true;
      // Her wake, fanning out behind the stern.
      const wake = new THREE.Mesh(wakeShape, wakeMaterial);
      wake.position.set(-33 - 40, 0.15, 0);
      sailing.add(wake);
      scene.add(sailing);
      harbourParts.push(sailing);
      harbourShips.push({ mesh: sailing, cx: centre.x, cz: centre.z, r: r * M, speed: 0.012 + rand() * 0.01, phase: rand() * Math.PI * 2 });
    }
  }

  // --- Lakes (map version 13), with things whose size you know (your look, 2026-11-01: "the scale
  // makes it hard to tell"): reeds in stands along the shore, a fishing jetty from the shore nearest
  // a town or hamlet with its hut and drying racks, a dugout or two drifting on the open water.
  const driftBoats: Array<{ mesh: THREE.Mesh; cx: number; cz: number; y: number; r: number; speed: number; phase: number }> = [];
  /** How far a point is from a lake's edge, in cells: negative in the water. */
  function lakeDistance(lake: { points: Array<[number, number]>; width: number; widths?: number[] }, x: number, y: number): number {
    const widths = lake.widths ?? lake.points.map(() => lake.width);
    let best = Infinity;
    for (let k = 1; k < lake.points.length; k += 1) {
      const [ax, ay] = lake.points[k - 1]!, [bx, by] = lake.points[k]!;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-6;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)) - (widths[k - 1]! + (widths[k]! - widths[k - 1]!) * t) / 2);
    }
    return best;
  }
  function buildLakes(w: GameWorld): void {
    const lakes = (w.waterLines ?? []).filter((r) => r.lake);
    if (!lakes.length) return;
    const kit = new Kit();
    const homes = [...w.towns.values()].filter((t) => !t.industry).map((t) => ({ x: t.x, y: t.y })).concat(w.hamlets ?? []);
    for (const [n, lake] of lakes.entries()) {
      const rand = seeded(`lake-${n}-${lake.points[0]!.join(",")}`);
      const xs = lake.points.map((q) => q[0]), ys = lake.points.map((q) => q[1]), pad = lake.width / 2 + 3;
      const shore: Array<{ x: number; y: number }> = [], open: Array<{ x: number; y: number; d: number }> = [];
      for (let y = Math.max(1, Math.floor(Math.min(...ys) - pad)); y <= Math.min(H - 2, Math.ceil(Math.max(...ys) + pad)); y += 0.5)
        for (let x = Math.max(1, Math.floor(Math.min(...xs) - pad)); x <= Math.min(W - 2, Math.ceil(Math.max(...xs) + pad)); x += 0.5) {
          const d = lakeDistance(lake, x, y);
          if (d < -1.4) open.push({ x, y, d });
          else if (d > 0.15 && d < 1) shore.push({ x, y });
        }
      // The jetty first, where a town or hamlet is nearest, so the reeds leave it room.
      const near = (q: { x: number; y: number }) => Math.min(...homes.map((h) => Math.hypot(h.x - q.x, h.y - q.y)));
      const landing = shore.filter((q) => occupied[Math.round(q.y) * W + Math.round(q.x)] === FREE).sort((a, b) => near(a) - near(b))[0];
      if (landing) {
        const cx = xs.reduce((a, b) => a + b, 0) / xs.length, cy = ys.reduce((a, b) => a + b, 0) / ys.length;
        const len = Math.hypot(cx - landing.x, cy - landing.y) || 1, ux = (cx - landing.x) / len, uy = (cy - landing.y) / len;
        const one = new Kit();
        fishingJetty(one, rand, 2.6 * M);
        kit.place(one.merged(), landing.x * M, elevationAt(landing.x, landing.y) * HEIGHT, landing.y * M, -Math.atan2(uy, ux));
        for (let k = -1; k <= 1; k += 0.5) {
          const x = Math.round(landing.x - ux * k), y = Math.round(landing.y - uy * k);
          if (occupied[y * W + x] === FREE) occupied[y * W + x] = QUAY;
        }
      }
      // Reeds in stands along the shore.
      for (const q of shore) {
        const cell = Math.round(q.y) * W + Math.round(q.x);
        // On the wet bank (what keeps trees and houses off it is where reeds grow), never in the water.
        if ((occupied[cell] !== FREE && occupied[cell] !== WET) || terrain.water[cell] === 1 || rand() > 0.55) continue;
        const one = new Kit();
        reedClump(one, rand, 0, 0);
        kit.place(one.merged(), q.x * M, elevationAt(q.x, q.y) * HEIGHT - 0.1, q.y * M);
      }
      // A dugout or two, drifting slowly where the water's open.
      for (let b = 0; b < (lake.width > 7 ? 2 : 1) && open.length; b += 1) {
        const spot = open[Math.floor(rand() * open.length)]!;
        const mesh = new THREE.Mesh(canoe(rand), material);
        mesh.castShadow = true;
        scene.add(mesh);
        driftBoats.push({ mesh, cx: spot.x * M, cz: spot.y * M, y: elevationAt(spot.x, spot.y) * HEIGHT + 0.65, r: Math.max(2, Math.min(1.6, -spot.d - 0.9) * M), speed: 0.025 + rand() * 0.03, phase: rand() * Math.PI * 2 });
      }
    }
    if (kit.empty) return;
    const mesh = new THREE.Mesh(kit.merged(), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    scenery.push(mesh);
  }

  /** Every frame: the clock, the flares' flicker, the pump jacks' nod. */
  let lifeAt = performance.now();
  function animateSiteLife(seconds: number): void {
    puffMaterial.uniforms.uTime!.value = seconds;
    peopleTime.value = seconds;
    animateVeil();
    puffMaterial.uniforms.uHalfH!.value = (innerHeight * Math.min(2, devicePixelRatio)) / 2;
    const dt = Math.min(0.1, (performance.now() - lifeAt) / 1000);
    lifeAt = performance.now();
    for (const life of lives.values()) {
      for (const [i, f] of life.flares.entries()) {
        const flick = 0.8 + 0.25 * Math.sin(seconds * 11 + i * 2) + 0.15 * Math.sin(seconds * 23 + i);
        f.scale.set(flick, flick * (0.9 + 0.3 * Math.sin(seconds * 7 + i)), flick);
      }
      life.angle += dt * 1.8 * life.share;
      life.jacks.forEach((jack, i) => (jack.rotation.z = Math.sin(life.angle + i * 1.3) * 0.32));
      // The excavator swings between the face and the truck, as fast as the site works.
      life.diggers.forEach((upper, i) => (upper.rotation.y = Math.sin(life.angle * 0.6 + i) * 1.1));
    }
    harbourCranes.forEach((boom, i) => (boom.rotation.y = Math.sin(seconds * 0.25 + i * 1.7) * 0.6));
    for (const [i, tug] of harbourTugs.entries()) {
      const push = Math.sin(seconds * 0.35 + i) * 2.5;
      tug.mesh.position.set(tug.x + tug.ux * push, 0.6 + Math.sin(seconds * 1.1 + i) * 0.08, tug.z + tug.uz * push);
    }
    for (const boat of driftBoats) {
      const a = seconds * boat.speed + boat.phase;
      boat.mesh.position.set(boat.cx + Math.cos(a) * boat.r, boat.y + Math.sin(seconds * 1.3 + boat.phase) * 0.05, boat.cz + Math.sin(a) * boat.r);
      boat.mesh.rotation.y = -(a + Math.PI / 2);
    }
    for (const ship of harbourShips) {
      const a = seconds * ship.speed + ship.phase;
      ship.mesh.position.set(ship.cx + Math.cos(a) * ship.r, 0.6, ship.cz + Math.sin(a) * ship.r);
      // Bow along her way round (local +x along the circle's tangent).
      ship.mesh.rotation.y = -(a + Math.PI / 2);
    }
  }

  // The fabric's two shapes, shared: a unit box for walls, a unit hip roof.
  const wallShape = own(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const roofShape = own(new THREE.ConeGeometry(0.75, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0));
  const fabricMaterial = own(withClouds(new THREE.MeshLambertMaterial({ color: paintHex("--paint-light-1") })));
  // Contact shadows (look.md §8.3): a soft dark footprint where each building meets the ground --
  // geometry, one instanced quad a building, never a full-frame AO (it would eat the roads' colours).
  const contactShape = own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  // A house's face, in its wall's unit box (x, z -0.5..0.5, y 0..1 a storey): a door and windows on
  // the front, windows on the back and the ends -- a storey above the ground, windows only. Drawn as
  // instances in the window colour, a touch proud of the wall, so a town reads as houses, not blocks.
  const facadeShape = (door: boolean) => {
    const parts: THREE.BufferGeometry[] = [];
    const pane = (w: number, h: number, x: number, y: number, z: number, side: boolean) =>
      parts.push(new THREE.BoxGeometry(side ? 0.012 : w, h, side ? w : 0.012).translate(x, y, z));
    if (door) pane(0.16, 0.66, 0, 0.33, 0.505, false);
    for (const x of door ? [-0.3, 0.3] : [-0.3, 0, 0.3]) pane(0.15, 0.26, x, 0.56, 0.505, false);
    for (const x of [-0.25, 0.25]) pane(0.15, 0.26, x, 0.56, -0.505, false);
    for (const x of [-0.505, 0.505]) pane(0.2, 0.26, x, 0.56, 0, true);
    return own(mergeGeometries(parts)!);
  };
  const doorFace = facadeShape(true), upperFace = facadeShape(false);
  // A black water tank on a flat roof -- on most houses with one, and every block.
  const tankShape = own(new THREE.CylinderGeometry(0.6, 0.6, 1.4, 10).translate(0, 0.7, 0));
  const contactMaterial = own(new THREE.MeshBasicMaterial({ map: softBlob(), color: paintHex("--ink"), transparent: true, opacity: 0.38, depthWrite: false }));
  function houses(list: House[]): THREE.InstancedMesh[] {
    const contact = new THREE.InstancedMesh(contactShape, contactMaterial, list.length);
    const walls = new THREE.InstancedMesh(wallShape, fabricMaterial, list.length);
    const roofs = new THREE.InstancedMesh(roofShape, fabricMaterial, list.length);
    // A block's windows: a dark band round each floor above the ground, a touch proud of the wall.
    const bands = new THREE.InstancedMesh(wallShape, windowMaterial, Math.max(1, list.reduce((n, h) => n + Math.max(0, h.floors - 1), 0)));
    const houseCount = list.filter((h) => h.floors === 0).length;
    const doors = new THREE.InstancedMesh(doorFace, windowMaterial, Math.max(1, houseCount));
    const uppers = new THREE.InstancedMesh(upperFace, windowMaterial, Math.max(1, list.filter((h) => h.floors === 0 && h.h > 3.5).length));
    const tanks = new THREE.InstancedMesh(tankShape, fabricMaterial, Math.max(1, list.filter((h) => h.rh < 0.5).length));
    let door = 0, upper = 0, tank = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    let band = 0;
    list.forEach((h, i) => {
      q.setFromAxisAngle(up, h.ry);
      walls.setMatrixAt(i, m.compose(new THREE.Vector3(h.x, h.y, h.z), q, new THREE.Vector3(h.w, h.h, h.d)));
      roofs.setMatrixAt(i, m.compose(new THREE.Vector3(h.x, h.y + h.h, h.z), q, new THREE.Vector3(h.w * 1.04, h.rh, h.d * 1.04)));
      contact.setMatrixAt(i, m.compose(new THREE.Vector3(h.x, h.y + 0.04, h.z), q, new THREE.Vector3(h.w * 1.45, 1, h.d * 1.45)));
      walls.setColorAt(i, c.set(h.wall));
      roofs.setColorAt(i, c.set(h.roof));
      if (h.floors === 0) {
        // Its face: the ground storey's door and windows, the upper storey's windows.
        doors.setMatrixAt(door, m.compose(new THREE.Vector3(h.x, h.y, h.z), q, new THREE.Vector3(h.w, 3, h.d)));
        doors.setColorAt(door, c.set(WINDOWS));
        door += 1;
        if (h.h > 3.5) {
          uppers.setMatrixAt(upper, m.compose(new THREE.Vector3(h.x, h.y + 3, h.z), q, new THREE.Vector3(h.w, 3, h.d)));
          uppers.setColorAt(upper, c.set(WINDOWS));
          upper += 1;
        }
      }
      // A flat roof's water tank, set to a back corner (by its place, so a redraw keeps it there).
      if (h.rh < 0.5 && (h.floors > 0 || (Math.abs(h.x * 7 + h.z * 13) % 10) < 7)) {
        const off = new THREE.Vector3(h.w * 0.25, 0, -h.d * 0.22).applyQuaternion(q);
        tanks.setMatrixAt(tank, m.compose(new THREE.Vector3(h.x + off.x, h.y + h.h + h.rh, h.z + off.z), q, new THREE.Vector3(1, 1, 1)));
        tanks.setColorAt(tank, c.set(paintHex("--paint-grey-26")));
        tank += 1;
      }
      for (let f = 1; f < h.floors; f += 1) {
        bands.setMatrixAt(band, m.compose(new THREE.Vector3(h.x, h.y + f * 3 + 1.1, h.z), q, new THREE.Vector3(h.w + 0.12, 0.9, h.d + 0.12)));
        bands.setColorAt(band, c.set(WINDOWS));
        band += 1;
      }
    });
    bands.count = band;
    doors.count = door;
    uppers.count = upper;
    tanks.count = tank;
    for (const mesh of [walls, roofs, bands, tanks]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    contact.renderOrder = -1;
    return [contact, walls, roofs, bands, doors, uppers, tanks];
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
    dropSiteLife(mesh.userData.townId as string | undefined);
    mesh.geometry.dispose();
    for (const child of mesh.children) (child as THREE.InstancedMesh).dispose?.();
  }
  function syncTowns(w: GameWorld): void {
    people = [...w.towns.values()].filter((t) => !t.industry);
    sites = [...w.towns.values()].filter((t) => t.industry);
    const cityId = people.reduce<GameTown | null>((big, t) => (!big || t.population > big.population ? t : big), null)?.id;
    // Sites first: the towns' buildings keep clear of where they've been set -- and of their parks,
    // laid as soon as the sites are (syncParks: a site's park is turned with its yard).
    let parksLaid = false;
    for (const town of [...sites, ...people]) {
      if (!town.industry && !parksLaid) {
        parksLaid = true;
        syncParks(w);
      }
      const tier = town.industry ? "village" : tierOf(town.population, town.id === cityId);
      // A step every fifth of its size (or a tier change): a growing town rebuilds now and then.
      const boom = !town.industry && growthTrend(w, town.id) === "growing";
      const key = town.industry ? `site:${town.industry}` : `${tier}:${Math.round(Math.log(Math.max(1, town.population)) * 5)}${boom ? ":boom" : ""}|${stations.get(town.id)?.key ?? ""}|${parks.get(town.id)?.key ?? ""}`;
      const known = towns.get(town.id);
      if (known && known.key !== key) {
        scene.remove(known.mesh, known.label);
        dropTown(known.mesh);
        towns.delete(town.id);
      }
      if (!towns.has(town.id)) {
        const built = town.industry ? siteKit(town) : { kit: townKit(town, tier, boom), extras: null, scale: 1, x: 0, z: 0, ry: 0, floor: null, clear: null };
        const { kit, x, z } = built;
        const mesh = new THREE.Mesh(kit.merged(), material);
        mesh.position.copy(ground(town.x, town.y)).add(new THREE.Vector3(x, 0, z));
        mesh.rotation.y = built.ry;
        if (built.floor !== null) mesh.position.y = built.floor;
        // A site's plant at its scale (SITE_SCALE); its bank, drive and fence at their own.
        mesh.scale.setScalar(built.scale);
        if (built.extras && !built.extras.empty) {
          const extra = new THREE.Mesh(built.extras.merged(), material);
          extra.scale.setScalar(1 / built.scale);
          extra.castShadow = true;
          extra.receiveShadow = true;
          mesh.add(extra);
        }
        if (!town.industry && fabric.length) mesh.add(...houses(fabric));
        if (!town.industry) {
          marketsAt.set(town.id, markets.map((m) => ({ x: mesh.position.x + m.x, z: mesh.position.z + m.z, big: m.big })));
          builtAt.set(town.id, footprint.map((b) => ({ x: mesh.position.x + b.x, z: mesh.position.z + b.z, r: b.r })));
        }
        if (!town.industry && streets.length) mesh.add(streetMesh(streets));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.townId = town.id;
        scene.add(mesh);
        if (town.industry && built.clear) addSiteLife(town, mesh, built.clear);
        const text = document.createElement("div");
        text.className = town.industry ? "label3d site" : `label3d ${tier}`;
        text.addEventListener("click", () => onPick({ kind: "place", id: town.id }));
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
  // --- Roundabouts (your look, 2026-11-04: the buses "reaching and turning back ... just looks weird")
  // A town where three roads or more meet, or where a road route of yours ends, has a roundabout at
  // its heart: a kerbed island with its monument, a ring of road round it. What drives through goes
  // round it keeping right (anticlockwise seen from above), and a bus at its route's end goes all the
  // way round and back the way it came -- before, it drove into the town's point, jumped across the
  // road and spun there, and everything else bunched on that one point. Drawn only: the engine's
  // vehicles still pass through the point (vehicle.ts); this bends the last and the first
  // RING_ZONE metres of the roads either side round the island, a little faster there.
  /** Each town's node (cells) where it has a roundabout; rebuilt when that set changes. */
  const rings = new Map<string, Point>();
  let ringsKey = "";
  let ringMesh: THREE.Mesh | null = null;
  /** How many roads meet at each node. */
  function roadDegree(w: GameWorld): Map<string, number> {
    const degree = new Map<string, number>();
    for (const s of w.simulation.map.segments) {
      if (s.type !== "road" || s.retiredAt !== undefined) continue;
      degree.set(s.fromNodeId, (degree.get(s.fromNodeId) ?? 0) + 1);
      degree.set(s.toNodeId, (degree.get(s.toNodeId) ?? 0) + 1);
    }
    return degree;
  }
  function syncRings(w: GameWorld): void {
    const degree = roadDegree(w);
    const isTown = (id: string) => { const t = w.towns.get(id); return !!t && !t.industry; };
    const want = new Set<string>();
    for (const [id, d] of degree) if (d >= 3 && isTown(id)) want.add(id);
    // A route's end where no bus park could be laid: its buses turn round a roundabout instead.
    for (const id of parkEnds(w).keys()) if (degree.has(id) && !parks.has(id)) want.add(id);
    const key = [...want].sort().join("|");
    if (key === ringsKey) return;
    ringsKey = key;
    rings.clear();
    roadEdges.clear();
    passages.clear();
    if (ringMesh) { scene.remove(ringMesh); ringMesh.geometry.dispose(); ringMesh = null; }
    const kit = new Kit();
    const { positions } = w.simulation.routing;
    for (const id of want) {
      const at = positions.get(id) ?? w.towns.get(id)!;
      rings.set(id, { x: at.x, y: at.y });
      // Level at its highest ground, a plinth down to its lowest: no ring half buried on a slope.
      let low = Infinity, high = -Infinity;
      for (let k = 0; k < 12; k += 1) {
        const a = (k / 12) * Math.PI * 2;
        const h = elevationAt(at.x + (Math.cos(a) * RING_OUTER) / M, at.y + (Math.sin(a) * RING_OUTER) / M) * HEIGHT;
        low = Math.min(low, h);
        high = Math.max(high, h);
      }
      high = Math.max(high, elevationAt(at.x, at.y) * HEIGHT);
      const one = new Kit();
      roundabout(one, seeded(`ring-${id}`), high - low + 0.3);
      kit.place(one.merged(), at.x * M, high, at.y * M);
    }
    if (kit.empty) return;
    ringMesh = new THREE.Mesh(kit.merged(), material);
    ringMesh.castShadow = true;
    ringMesh.receiveShadow = true;
    scene.add(ringMesh);
  }
  // --- Bus parks (busparks3d.ts; your word, 2026-11-04: "a bus park like the rail stations") ------
  // Where a road route of yours ends at a town, its motor park beside the town's heart: laid with
  // the stations, before the towns build (their houses keep off it, as off a station), drawn as one
  // mesh each, and its buses driven through it (onPark) -- off the road down its lane, round its
  // island to their bay, a moment there, and back out.
  let parks = new Map<string, BusPark>();
  let parksInput = "";
  const parkMeshes = new Map<string, { key: string; mesh: THREE.Mesh; top: number }>();
  function syncParks(w: GameWorld): void {
    const ends = parkEnds(w);
    const freight = w.lorryRoutes.filter((r) => r.vehicleIds[0] && !w.railVehicles.has(r.vehicleIds[0])).map((r) => r.id).sort().join(",");
    const input = `${network}|${[...ends].map(([id, r]) => `${id}:${[...r].sort().join(",")}`).sort().join("|")}|${freight}|${stationsInput.length}|${siteAt.size}`;
    if (input === parksInput) return;
    parksInput = input;
    passages.clear();
    const degree = roadDegree(w);
    const roadsOnly = w.simulation.map.segments.filter((x) => x.retiredAt === undefined).map((x) => segmentPolyline(w.simulation.map, x));
    const blocked = (x: number, y: number) => x < 1 || y < 1 || x > W - 2 || y > H - 2 || terrain.water[Math.round(y) * W + Math.round(x)] === 1 || inYard(x, y, 6) || onQuay(x, y, 1) || onStationGround(x, y, 3);
    // A site's, before its gate (the airport's, its terminal): turned the way its yard was set (siteKit).
    const fixed = new Map<string, number>();
    for (const [id, at] of siteAt) {
      const kind = w.towns.get(id)?.industry ?? "";
      if (kind === "airport" || hasLorryPark(kind)) fixed.set(id, Math.atan2(-Math.cos(at.ry), -Math.sin(at.ry)));
    }
    parks = layBusParks(w, roadsOnly, blocked, (id) => (degree.get(id) ?? 0) >= 3, RING_OUTER, fixed);
    for (const [id, built] of parkMeshes) {
      if (parks.get(id)?.key === built.key) continue;
      scene.remove(built.mesh);
      built.mesh.geometry.dispose();
      parkMeshes.delete(id);
    }
    for (const park of parks.values()) {
      if (parkMeshes.has(park.id)) continue;
      // Level at its highest ground, a plinth down to its lowest.
      let low = Infinity, high = -Infinity;
      for (const [s, o] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.6]] as const) {
        const q = parkPoint(park, s * (park.straight / 2 + BUS_PARK.pave), o * BUS_PARK.pave);
        const h = elevationAt(q.x, q.y) * HEIGHT;
        low = Math.min(low, h);
        high = Math.max(high, h);
      }
      const kit = new Kit();
      const colours = [...park.bays].map(([routeId, bay]) => {
        return { ...bay, colour: labelOf(w, routeLabelKey(routeId))?.colour || tokenPaint("--you") };
      });
      const ringed = rings.has(park.id) || (degree.get(park.id) ?? 0) >= 3;
      if (park.kind === "lorry") lorryPark(kit, seeded(`lorrypark-${park.id}`), { straight: park.straight, gap: park.gap, ringed, depth: high - low + 0.3, bays: park.spots });
      else busPark(kit, seeded(`buspark-${park.id}`), { straight: park.straight, gap: park.gap, ringed, depth: high - low + 0.3, bays: colours, you: tokenPaint("--you") });
      const mesh = new THREE.Mesh(kit.merged(), material);
      mesh.position.set(park.centre.x * M, high, park.centre.y * M);
      mesh.rotation.y = Math.atan2(-Math.cos(park.axis), -Math.sin(park.axis));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      parkMeshes.set(park.id, { key: park.key, mesh, top: high });
    }
    if (planted) clearTrees((cell) => onParkGround(cell % W, Math.floor(cell / W), 0.6));
  }
  function onParkGround(x: number, y: number, clear: number): boolean {
    for (const park of parks.values()) if (inPark(park, { x, y }, clear * M)) return true;
    return false;
  }
  /**
   * A bus's (or a lorry's) way through a park, from the road in to the road out (cells), how long,
   * and where its bay is along it; where its trip ends at the park, from the road to its bay; where
   * it starts there, from its bay to the road.
   */
  interface Passage { points: Point[]; along: number[]; total: number; bay: number | null; ends: boolean; starts: boolean }
  const passages = new Map<string, Passage | null>();
  /** The way from one arm of a town's junction to another (cells): round its roundabout, or a curve through its point. */
  function junctionWay(at: Point, inn: { line: Point[]; length: number }, out: { line: Point[]; length: number }, ringed: boolean): Point[] {
    const R = (ringed ? RING_DRIVE : 6) / M;
    const enter = keptRight(inn.line, inn.length - R), leave = keptRight(out.line, Math.min(R, out.length));
    const way: Point[] = [];
    if (ringed) {
      const from = Math.atan2(enter.y - at.y, enter.x - at.x), to = Math.atan2(leave.y - at.y, leave.x - at.x);
      let turn = (((from - to) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (turn < 0.05) turn += Math.PI * 2;
      const r1 = Math.hypot(enter.x - at.x, enter.y - at.y), r2 = Math.hypot(leave.x - at.x, leave.y - at.y);
      const steps = Math.max(4, Math.ceil(turn * 8));
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps, phi = from - turn * t, r = r1 + (r2 - r1) * t;
        way.push({ x: at.x + Math.cos(phi) * r, y: at.y + Math.sin(phi) * r });
      }
      return way;
    }
    // A curve by the point: from where it leaves the one road to where it joins the other.
    const c = { x: at.x + (enter.x + leave.x - 2 * at.x) * 0.15, y: at.y + (enter.y + leave.y - 2 * at.y) * 0.15 };
    for (let i = 0; i <= 10; i += 1) {
      const t = i / 10, u = 1 - t;
      way.push({ x: u * u * enter.x + 2 * u * t * c.x + t * t * leave.x, y: u * u * enter.y + 2 * u * t * c.y + t * t * leave.y });
    }
    return way;
  }
  function passageThrough(park: BusPark, bay: { s: number; o: number } | undefined, inn: { line: Point[]; length: number } | null, out: { line: Point[]; length: number } | null, z1: number, z2: number): Passage | null {
    const ringed = rings.has(park.id);
    const R = (ringed ? RING_DRIVE : 6) / M;
    if ((inn && z1 < R + 0.3) || (out && z2 < R + 0.3) || (!inn && !out)) return null;
    const lane = { line: [park.node, parkPoint(park, 0, -BUS_PARK.pave)], length: park.gap / M };
    const back = { line: [lane.line[1]!, park.node], length: lane.length };
    // The drive round the island (the lane's ends join the junction's ways, R out along it); cut at
    // its bay where the trip ends or starts there.
    let drive = parkDrive(park, R * M).map((q) => parkPoint(park, q.s, q.o));
    if (bay && (!inn || !out)) {
      const target = parkPoint(park, bay.s, bay.o);
      let at = 0, best = Infinity;
      drive.forEach((q, i) => { const d = Math.hypot(q.x - target.x, q.y - target.y); if (d < best) { best = d; at = i; } });
      drive = out ? drive.slice(at) : drive.slice(0, at + 1);
    }
    const points: Point[] = [];
    if (inn) {
      for (let d = inn.length - z1; d < inn.length - R; d += 0.25) points.push(keptRight(inn.line, d));
      points.push(...junctionWay(park.node, inn, lane, ringed));
    }
    points.push(...drive);
    if (out) {
      points.push(...junctionWay(park.node, back, out, ringed));
      for (let d = R + 0.25; d <= z2; d += 0.25) points.push(keptRight(out.line, d));
    }
    const along = [0];
    for (let i = 1; i < points.length; i += 1) along.push(along[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
    // Its bay: the point of the drive nearest it.
    let at: number | null = null;
    if (bay) {
      const target = parkPoint(park, bay.s, bay.o);
      let best = Infinity;
      points.forEach((q, i) => { const d = Math.hypot(q.x - target.x, q.y - target.y); if (d < best) { best = d; at = along[i]!; } });
    }
    return { points, along, total: along[along.length - 1]!, bay: at, ends: !out, starts: !inn };
  }
  /** Of the time a bus spends going through a park, the share it stands at its bay. */
  const PARK_DWELL = 0.12;
  /**
   * A bus at its route's end, drawn going through the town's bus park -- or a lorry at a site,
   * through its lorry park (the airport's bus park): your freight's to its route's bay, a haulier's
   * to a bay by its number, its trip ending there (it stands at the bay till it's gone) or starting
   * (it pulls out of one). Null where it's elsewhere.
   */
  function onPark(w: GameWorld, v: Vehicle, routeId: string | undefined): { x: number; y: number; angle: number } | null {
    const n = v.path.length;
    if (!parks.size || n < 2 || v.pathIndex >= n) return null;
    const cyclic = v.lifecycle === "cyclic";
    const lorry = v.carries === "goods" || (!cyclic && v.id.startsWith("truck-"));
    const route = routeId ? w.routes.find((r) => r.id === routeId) ?? w.lorryRoutes.find((r) => r.id === routeId) : undefined;
    if (!lorry && (!route || !cyclic)) return null;
    // Where it may go through a park: a bus at its route's ends, a lorry at any site's.
    const here = (id: string) => {
      const park = parks.get(id);
      if (!park) return undefined;
      if (lorry) return w.towns.get(id)?.industry ? park : undefined;
      return route && (id === route.a || id === route.b) ? park : undefined;
    };
    const i = v.pathIndex;
    const from = v.path[(i - 1 + n) % n]!, to = v.path[i]!;
    const edge = roadEdge(w, from, to, v);
    const along = edge.length * v.edgeProgress;
    const zone = (length: number) => Math.min(PARK_ZONE / M, length / 2 - 0.05);
    let park: BusPark | undefined, inn: { line: Point[]; length: number } | null, out: { line: Point[]; length: number } | null, s: number, innKey: string, outKey: string;
    if ((park = here(to)) && edge.length - along < zone(edge.length)) {
      const next = i + 1 < n ? v.path[i + 1] : cyclic ? v.path[(i + 1) % n] : undefined;
      inn = edge; out = next !== undefined ? roadEdge(w, to, next, v) : null;
      innKey = `${from}>${to}`; outKey = next !== undefined ? `${to}>${next}` : "";
      s = zone(edge.length) - (edge.length - along);
    } else if ((park = here(from)) && along < zone(edge.length)) {
      const prev = i - 2 >= 0 ? v.path[i - 2] : cyclic ? v.path[(i - 2 + n) % n] : undefined;
      inn = prev !== undefined ? roadEdge(w, prev, from, v) : null; out = edge;
      innKey = prev !== undefined ? `${prev}>${from}` : ""; outKey = `${from}>${to}`;
      s = (inn ? zone(inn.length) : 0) + along;
    } else return null;
    const z1 = inn ? zone(inn.length) : 0, z2 = out ? zone(out.length) : 0;
    // Its bay: its route's, or one of the park's by its number.
    let bayKey = routeId && park.bays.has(routeId) ? routeId : "";
    let bay = bayKey ? park.bays.get(bayKey) : undefined;
    if (!bay && park.spots.length) {
      let h = 0;
      for (let c = 0; c < v.id.length; c += 1) h = (h * 31 + v.id.charCodeAt(c)) | 0;
      const k = Math.abs(h) % park.spots.length;
      bay = park.spots[k];
      bayKey = `#${k}`;
    }
    const key = `${park.id}|${innKey}|${outKey}|${bayKey}`;
    let passage = passages.get(key);
    if (passage === undefined) passages.set(key, (passage = passageThrough(park, bay, inn, out, z1, z2)));
    if (!passage) return null;
    // Through it at an even pace, but for a moment at its bay (on arriving, or before setting off).
    const t = Math.max(0, Math.min(1, s / (z1 + z2)));
    const dwell = passage.bay === null ? 0 : PARK_DWELL, moving = 1 - dwell, total = passage.total;
    let q: number;
    if (passage.ends) q = t < moving ? (t / moving) * total : total;
    else if (passage.starts) q = t < dwell ? 0 : ((t - dwell) / moving) * total;
    else {
      const reach = passage.bay ?? 0, reachAt = (reach / total) * moving;
      q = t < reachAt ? (t / moving) * total : t < reachAt + dwell ? reach : ((t - dwell) / moving) * total;
    }
    let k = 1;
    while (k < passage.along.length - 1 && passage.along[k]! < q) k += 1;
    const a = passage.points[k - 1]!, b = passage.points[k]!;
    const span = passage.along[k]! - passage.along[k - 1]! || 1;
    const f = Math.max(0, Math.min(1, (q - passage.along[k - 1]!) / span));
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  /** How far either side of its town's point a bus's way through a park reaches along the roads (metres). */
  const PARK_ZONE = 120;
  /** A road edge's line (cells) and its length, for the roundabouts; cleared with the network. */
  const roadEdges = new Map<string, { line: Point[]; length: number }>();
  function roadEdge(w: GameWorld, from: string, to: string, v: Vehicle) {
    const key = `${from}>${to}`;
    let edge = roadEdges.get(key);
    if (!edge) {
      const line = edgeLine(w, from, to, v);
      edge = { line, length: polylineLength(line) };
      roadEdges.set(key, edge);
    }
    return edge;
  }
  /** How far either side of a roundabout its traffic is bent round it (cells): RING_ZONE, or half a short road. */
  const ringZone = (length: number) => Math.min(RING_ZONE / M, length / 2 - 0.05);
  /** `d` cells along `line`, kept right (as every road vehicle is), and its heading there. */
  function keptRight(line: Point[], d: number): { x: number; y: number; angle: number } {
    let left = Math.max(0, d);
    for (let k = 1; k < line.length; k += 1) {
      const a = line[k - 1]!, b = line[k]!;
      const step = Math.hypot(b.x - a.x, b.y - a.y);
      if (left <= step || k === line.length - 1) {
        const t = step > 0 ? Math.min(1, left / step) : 0;
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const side = KEEP_RIGHT / M;
        return { x: a.x + (b.x - a.x) * t - Math.sin(angle) * side, y: a.y + (b.y - a.y) * t + Math.cos(angle) * side, angle };
      }
      left -= step;
    }
    const p = line[0]!;
    return { x: p.x, y: p.y, angle: 0 };
  }
  /**
   * Where a vehicle passing roundabout `at` is drawn: `s` cells into its passage, which runs from
   * ringZone before the town's point on the road in (`inn`, ending there) to ringZone after it on
   * the road out (`out`, starting there). Either is null where the vehicle's trip starts or ends at
   * the town: it comes off the ring, or pulls up at it. Null where a road is too short to go round.
   */
  function ringPoint(at: Point, inn: { line: Point[]; length: number } | null, out: { line: Point[]; length: number } | null, s: number): { x: number; y: number; angle: number } | null {
    const R = RING_DRIVE / M;
    const z1 = inn ? ringZone(inn.length) : 0, z2 = out ? ringZone(out.length) : 0;
    if ((inn && z1 < R + 0.3) || (out && z2 < R + 0.3)) return null;
    if (!inn) return keptRight(out!.line, R + (s * (z2 - R)) / z2);
    if (!out) return keptRight(inn.line, inn.length - z1 + (s * (z1 - R)) / z1);
    const enter = keptRight(inn.line, inn.length - R), leave = keptRight(out.line, R);
    const from = Math.atan2(enter.y - at.y, enter.x - at.x), to = Math.atan2(leave.y - at.y, leave.x - at.x);
    // Round to the right, the island on the left: the angle (map y down) falls.
    let turn = (((from - to) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (turn < 0.05) turn += Math.PI * 2;
    const r1 = Math.hypot(enter.x - at.x, enter.y - at.y), r2 = Math.hypot(leave.x - at.x, leave.y - at.y);
    const a = z1 - R, b = turn * (r1 + r2) / 2, c = z2 - R;
    const q = (s * (a + b + c)) / (z1 + z2);
    if (q < a) return keptRight(inn.line, inn.length - z1 + q);
    if (q > a + b) return keptRight(out.line, R + (q - a - b));
    const t = (q - a) / b, phi = from - turn * t, r = r1 + (r2 - r1) * t;
    return { x: at.x + Math.cos(phi) * r, y: at.y + Math.sin(phi) * r, angle: phi - Math.PI / 2 };
  }
  /** A road vehicle near a roundabout, drawn going round it; null where it's on the plain road. */
  function onRing(w: GameWorld, v: Vehicle): { x: number; y: number; angle: number } | null {
    const n = v.path.length;
    if (!rings.size || n < 2 || v.pathIndex >= n) return null;
    const i = v.pathIndex, cyclic = v.lifecycle === "cyclic";
    const from = v.path[(i - 1 + n) % n]!, to = v.path[i]!;
    const edge = roadEdge(w, from, to, v);
    const along = edge.length * v.edgeProgress;
    const toward = rings.get(to);
    if (toward && edge.length - along < ringZone(edge.length)) {
      const next = i + 1 < n ? v.path[i + 1] : cyclic ? v.path[(i + 1) % n] : undefined;
      return ringPoint(toward, edge, next !== undefined && next !== to ? roadEdge(w, to, next, v) : null, ringZone(edge.length) - (edge.length - along));
    }
    const leaving = rings.get(from);
    if (leaving && along < ringZone(edge.length)) {
      const prev = i - 2 >= 0 ? v.path[i - 2] : cyclic ? v.path[(i - 2 + n) % n] : undefined;
      const inn = prev !== undefined && prev !== from ? roadEdge(w, prev, from, v) : null;
      return ringPoint(leaving, inn, edge, (inn ? ringZone(inn.length) : 0) + along);
    }
    return null;
  }
  // --- The airport's airliners (shapes3d airportArrival, airportDeparture; your look, 2026-11-04)
  // One lands, rolls out, turns off and taxis to the stand the last one left; the one at the other
  // stand is pushed back, taxis out and takes off; and again -- each pair the sooner the more
  // travellers the airport has (`airportTravellersPerDay`, in steps, so a day's change doesn't jump
  // them), on the game's clock: they stop when it's paused, hurry when it's fast. Their runway and
  // taxiway times never overlap. Children of the airport's mesh, in its frame.
  let airliners: { site: THREE.Mesh; planes: THREE.Mesh[] } | null = null;
  let airlinerShape: THREE.BufferGeometry | null = null;
  function animateAirport(w: GameWorld): void {
    const id = w.airport;
    const site = id && w.towns.get(id)?.industry === "airport" ? towns.get(id)?.mesh : undefined;
    if (!site) {
      if (airliners) for (const plane of airliners.planes) plane.visible = false;
      return;
    }
    if (!airliners || airliners.site !== site) {
      if (!airlinerShape) {
        const kit = new Kit();
        airliner(kit, 0, 0, 0);
        airlinerShape = own(kit.merged());
      }
      const planes = [0, 1].map(() => {
        const plane = new THREE.Mesh(airlinerShape!, material);
        plane.castShadow = true;
        plane.rotation.order = "YXZ";
        site.add(plane);
        return plane;
      });
      airliners = { site, planes };
    }
    const travellers = airportTravellersPerDay(w);
    const period = travellers >= 400 ? 50 : travellers >= 250 ? 75 : travellers >= 120 ? 100 : 150;
    const now = w.economy.elapsedSeconds, k = Math.floor(now / period), into = now - k * period;
    const arrival = airportArrival(AIRPORT.stands[k % 2]!), departure = airportDeparture(AIRPORT.stands[(k + 1) % 2]!);
    const put = (plane: THREE.Mesh, at: ReturnType<typeof airAt> | null) => {
      plane.visible = !!at;
      if (!at) return;
      plane.position.set(at.x, at.y + 0.1, at.z);
      plane.rotation.set(-at.pitch, at.ry, 0);
    };
    put(airliners.planes[0]!, airAt(arrival, into));
    const leaving = into - period / 2, last = departure[departure.length - 1]!.t;
    put(airliners.planes[1]!, leaving >= last ? null : airAt(departure, Math.max(0, leaving)));
  }
  const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), scale = new THREE.Vector3().setScalar(VEHICLE_SCALE), up = new THREE.Vector3(0, 1, 0);
  const headings = new Map<string, number>();
  let placedAt = performance.now();
  // Your vehicles in their route's colour where you've given it one (labels.ts), else their kind's.
  const tintColour = new THREE.Color();
  const KIND_TINT: Partial<Record<VehicleKind3D, string>> = { bus: tokenPaint("--you"), minibus: tokenPaint("--paint-blue-9"), brt: tokenPaint("--paint-red-3"), train: tokenPaint("--you"), coach: tokenPaint("--you") };
  const tinted = new Set<VehicleKind3D>(["bus", "minibus", "brt", "train", "coach"]);
  // A rail edge's line and length, and its segment: asked for every car of every train each frame.
  const railEdges = new Map<string, { line: Point[]; length: number; segmentId: string | null }>();
  let railEdgesFor = "";
  function railEdge(w: GameWorld, from: string, to: string, v: Vehicle) {
    const key = `${from}>${to}`;
    let edge = railEdges.get(key);
    if (!edge) {
      const line = edgeLine(w, from, to, v);
      edge = { line, length: polylineLength(line) * M, segmentId: routingFor(w, v).graph.get(from)?.find((c) => c.to === to)?.segmentId ?? null };
      railEdges.set(key, edge);
    }
    return edge;
  }
  /**
   * A point `back` metres behind a train's front along its path -- back through the edges it has
   * come along -- drawn where the station puts it: in a throat on its curve, at the platforms on
   * its line's own track (stations3d.ts onStation).
   */
  function railPoint(w: GameWorld, v: Vehicle, back: number, routeId: string | undefined): Point | null {
    const n = v.path.length;
    if (n < 2 || v.pathIndex >= n) return null;
    let idx = v.pathIndex;
    let from = v.path[(idx - 1 + n) % n]!, to = v.path[idx]!;
    let edge = railEdge(w, from, to, v);
    let at = edge.length * v.edgeProgress - back;
    for (let hop = 0; at < 0 && hop < 8; hop += 1) {
      if (v.lifecycle !== "cyclic" && idx <= 1) { at = 0; break; }
      idx = (idx - 1 + n) % n;
      from = v.path[(idx - 1 + n) % n]!;
      to = v.path[idx]!;
      edge = railEdge(w, from, to, v);
      at += edge.length;
    }
    at = Math.max(0, Math.min(edge.length, at));
    if (edge.segmentId) {
      const a = stations.get(from), b = stations.get(to);
      const p = (a && onStation(a, edge.segmentId, at, routeId)) || (b && onStation(b, edge.segmentId, edge.length - at, routeId));
      if (p) return p;
    }
    const [, ahead] = splitPolyline(edge.line, at / M);
    return ahead[0] ?? edge.line[edge.line.length - 1]!;
  }
  // Laterite dust behind whatever drives a worn road: rough enough to cost your buses
  // (wear.ts roughCostFactor), it shows. One instanced mesh of puffs, three a vehicle.
  const DUST_MAX = 3000;
  const dust = new THREE.InstancedMesh(own(new THREE.IcosahedronGeometry(1, 1)), own(new THREE.MeshBasicMaterial({ color: paintHex("--paint-earth-24"), transparent: true, opacity: 0.22, depthWrite: false })), DUST_MAX);
  dust.frustumCulled = false;
  dust.count = 0;
  scene.add(dust);
  const puffAt = new THREE.Vector3(), puffScale = new THREE.Vector3(), still = new THREE.Quaternion();
  /** Where each vehicle was drawn this frame, and on what, for a click (pickAt). */
  let drawnVehicles: Array<{ id: string; at: THREE.Vector3; rail: boolean }> = [];
  function placeVehicles(w: GameWorld): void {
    drawnVehicles = [];
    let puffs = 0;
    const routeOf = new Map<string, string>();
    for (const route of w.routes) for (const id of route.vehicleIds) routeOf.set(id, route.id);
    for (const route of w.lorryRoutes) for (const id of route.vehicleIds) routeOf.set(id, route.id);
    const shape = `${w.simulation.map.segments.length}:${w.railRouting.graph.size}`;
    if (shape !== railEdgesFor) { railEdgesFor = shape; railEdges.clear(); }
    const now = performance.now();
    const turn = Math.min(1, ((now - placedAt) / 1000) * 10);
    placedAt = now;
    const seen = new Set<string>();
    const byKind = new Map<VehicleKind3D, Array<{ at: THREE.Vector3; heading: number; tint?: string }>>();
    for (const v of w.simulation.vehicles) {
      const pose = poseOf(w, v);
      if (!pose) continue;
      const kind = kindOf(w, v);
      if (kind === "train" || kind === "freight") {
        // A train in its pieces: its engine, then each car, every one along the track behind the
        // last -- round a throat's curve, in along its own platform (VEHICLE_SCALE as the rest).
        const route = routeOf.get(v.id);
        const cars = route ? carsOn(w, route) : 1;
        const joints = [0, LOCO_LENGTH * VEHICLE_SCALE];
        for (let c = 0; c < cars; c += 1) {
          const start = joints[joints.length - 1]! + COUPLING * VEHICLE_SCALE;
          joints.push(start, start + CAR_LENGTH * VEHICLE_SCALE);
        }
        const points = joints.map((d) => railPoint(w, v, d, route));
        if (points.every((p) => p)) {
          seen.add(v.id);
          for (let k = 0; k * 2 + 1 < points.length; k += 1) {
            const front = points[k * 2]!, rear = points[k * 2 + 1]!;
            const cx = (front.x + rear.x) / 2, cy = (front.y + rear.y) / 2;
            const at = ground(cx, cy, 0.4);
            const deck = decks.get(cellKey(cx, cy));
            if (deck !== undefined) at.y = Math.max(at.y, deck + 0.4);
            const heading = Math.atan2(front.y - rear.y, front.x - rear.x);
            const piece: VehicleKind3D = k === 0 ? kind : kind === "train" ? "coach" : "wagon";
            if (k === 0) drawnVehicles.push({ id: v.id, at, rail: true });
            (byKind.get(piece) ?? byKind.set(piece, []).get(piece)!).push({ at, heading, tint: tinted.has(piece) ? (route && labelOf(w, routeLabelKey(route))?.colour) || KIND_TINT[piece] : undefined });
          }
          continue;
        }
      }
      // Keep right, as the 2D map does: opposite directions on one road don't overlap -- and round a
      // town's roundabout, keeping right, where there is one.
      const rail = kind === "train" || kind === "freight";
      const ringed = rail ? null : (onPark(w, v, routeOf.get(v.id)) ?? onRing(w, v));
      if (ringed) { pose.x = ringed.x; pose.y = ringed.y; pose.angle = ringed.angle; }
      const side = (rail || ringed ? 0 : KEEP_RIGHT) / M;
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
      drawnVehicles.push({ id: v.id, at, rail: kind === "train" || kind === "freight" });
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
  const FREE = 0, WET = 1, ROAD = 2, TOWN = 3, FIELD = 4, ROCK = 5, QUAY = 6;
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
  const treeMaterial = own(withClouds(veiled(new THREE.MeshLambertMaterial({ vertexColors: true }))));
  const trees: Array<{ kind: TreeKind; cell: number; at: THREE.Matrix4 }> = [];
  const groves = new Map<TreeKind, THREE.InstancedMesh>();
  let planted = false;

  function plant(w: GameWorld): void {
    planted = true;
    const rand = seeded(`plant-${W}-${H}-${startPeople.map((t) => t.id).join("")}`);
    for (let i = 0; i < W * H; i += 1) if (terrain.water[i] === 1 || bankDist[i]! < 0.6) occupied[i] = WET;
    markRoads(roadLines);
    for (const t of [...w.towns.values()]) {
      // A site's yard, where it's drawn (siteAt: set to one side of its roads), kept clear whole.
      const at = t.industry ? siteAt.get(t.id) : undefined;
      if (at) {
        // As far as its yard reaches (the airport's is a field, 236 m long).
        const yard = SITE_YARD[t.industry ?? ""], reach = Math.max(4.5, yard ? (Math.hypot(yard.w, yard.d) * siteScale(t.industry ?? "")) / 2 / M + 1 : 0);
        for (let y = Math.max(0, Math.floor(at.y - reach)); y <= Math.min(H - 1, Math.ceil(at.y + reach)); y += 1)
          for (let x = Math.max(0, Math.floor(at.x - reach)); x <= Math.min(W - 1, Math.ceil(at.x + reach)); x += 1)
            if ((occupied[y * W + x] === FREE || occupied[y * W + x] === TOWN) && yardHas(t, x, y, 4)) occupied[y * W + x] = QUAY;
        continue;
      }
      const r = t.industry ? 3 : reachCells.get(t.id) ?? 3;
      for (let y = Math.max(0, Math.floor(t.y - r)); y <= Math.min(H - 1, Math.ceil(t.y + r)); y += 1)
        for (let x = Math.max(0, Math.floor(t.x - r)); x <= Math.min(W - 1, Math.ceil(t.x + r)); x += 1)
          if (Math.hypot(x - t.x, y - t.y) <= r && occupied[y * W + x] === FREE) occupied[y * W + x] = TOWN;
    }

    syncHarbour(w);
    buildLakes(w);
    // Inselbergs: a small steep hill (the north's and the Middle Belt's rocks, map version 4) gets a
    // bare granite dome on its top, sheeted and streaked, a boulder or two at its foot -- the land's
    // shape is the map's, this its rock showing. Drawn, not priced: one mesh for all of them.
    const domes = new Kit();
    const granite = [paintHex("--paint-grey-27"), paintHex("--paint-grey-28"), paintHex("--paint-grey-11")];
    for (const hill of w.hills ?? []) {
      if (hill.radius > 4.5 || hill.height < 2.8) continue;
      const cx = hill.x, cy = hill.y;
      if (cx < 2 || cy < 2 || cx > W - 3 || cy > H - 3 || occupied[Math.round(cy) * W + Math.round(cx)] !== FREE) continue;
      const hr = seeded(`dome-${cx}-${cy}`);
      const r = hill.radius * M * (0.45 + hr() * 0.15);
      const geo = new THREE.IcosahedronGeometry(1, 3);
      // A dome, lumpy as granite weathers: the sphere's upper half, pushed in and out.
      const pos = geo.attributes.position!;
      for (let i = 0; i < pos.count; i += 1) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        // By position only: the faces share corners, and one corner moved two ways would crack it.
        const bump = 1 + 0.12 * Math.sin(x * 5.1 + cx) * Math.cos(z * 4.3 + cy) + 0.06 * Math.sin(y * 9.7);
        pos.setXYZ(i, x * r * bump, Math.max(-0.2, y) * r * 0.55 * bump, z * r * bump);
      }
      const top = elevationAt(cx, cy) * HEIGHT;
      domes.add(geo, granite[Math.floor(hr() * granite.length)]!, { x: cx * M, y: top - r * 0.18, z: cy * M, ry: hr() * Math.PI });
      for (let k = 0; k < 3 + Math.floor(hr() * 4); k += 1) {
        const a = hr() * Math.PI * 2, d = (r * (0.9 + hr() * 0.6)) / M;
        const bx = cx + Math.cos(a) * d, by = cy + Math.sin(a) * d;
        domes.add(new THREE.DodecahedronGeometry(1.5 + hr() * 2.5, 0), granite[k % granite.length]!, { x: bx * M, y: elevationAt(bx, by) * HEIGHT + 0.6, z: by * M, ry: hr() * Math.PI });
      }
      const reachCells = Math.ceil(r / M);
      for (let y = Math.round(cy) - reachCells; y <= Math.round(cy) + reachCells; y += 1) for (let x = Math.round(cx) - reachCells; x <= Math.round(cx) + reachCells; x += 1)
        if (x >= 0 && y >= 0 && x < W && y < H && Math.hypot(x - cx, y - cy) * M < r && occupied[y * W + x] === FREE) occupied[y * W + x] = ROCK;
    }
    if (!domes.empty) {
      const rocks = new THREE.Mesh(domes.merged(), material);
      rocks.castShadow = true;
      rocks.receiveShadow = true;
      scene.add(rocks);
      scenery.push(rocks);
    }

    // Hamlets (map version 12): the land's small places between the towns -- a few compounds, round
    // huts in the north and the Middle Belt, bungalows in the south, each with a field or two (painted
    // below with the towns'). One mesh for them all. Clear of the water, the roads and the sites.
    const sitesAt = [...w.towns.values()].filter((t) => t.industry);
    const southern = ["southwest", "southeast", "southSouth"].includes(world.region ?? "southwest");
    const hamletKit = new Kit();
    const hamletFields: Array<{ x: number; y: number; size: number }> = [];
    for (const h of w.hamlets ?? []) {
      if (sitesAt.some((s) => Math.hypot(s.x - h.x, s.y - h.y) < 6)) continue;
      const hr = seeded(`hamlet-${h.x}-${h.y}`);
      const compounds = Math.round(2 + h.size * 2.5);
      let placed = 0;
      for (let n = 0; n < compounds * 3 && placed < compounds; n += 1) {
        const a = hr() * Math.PI * 2, d = Math.sqrt(hr()) * (0.6 + h.size * 0.45);
        const cx = h.x + Math.cos(a) * d, cy = h.y + Math.sin(a) * d;
        const cell = Math.round(cy) * W + Math.round(cx);
        if (cx < 1 || cy < 1 || cx > W - 2 || cy > H - 2 || occupied[cell] !== FREE || duneAt(cx, cy) > 0.25) continue;
        occupied[cell] = TOWN;
        const one = new Kit();
        if (southern ? hr() < 0.25 : hr() < 0.75) hut(one, hr, 0, 0);
        else bungalow(one, hr, 0, 0, hr() * Math.PI);
        hamletKit.place(one.merged(), cx * M, elevationAt(cx, cy) * HEIGHT - 0.2, cy * M);
        placed += 1;
      }
      if (placed > 0) hamletFields.push(h);
    }
    if (!hamletKit.empty) {
      const hamlets = new THREE.Mesh(hamletKit.merged(), material);
      hamlets.castShadow = true;
      hamlets.receiveShadow = true;
      scene.add(hamlets);
      scenery.push(hamlets);
    }

    // Fields: a ring round each town, beyond its houses; farm towns (food.ts) farm more, and a
    // farm belt's (clusters.ts) most. Some in rows (ridged yam and maize), some plain.
    const farming = new Set(farmTowns(w).map((t) => t.id));
    // Painted into the ground (the land's texture), not laid on it as quads: those had hard
    // edges, cut into slopes at their corners, and their colours stood off the land like stickers.
    // Colours a step from the savanna's; corners nudged, so no field is a perfect rectangle.
    const PALETTE = [tokenPaint("--paint-green-6"), tokenPaint("--paint-green-5"), tokenPaint("--paint-earth-29"), tokenPaint("--paint-earth-38"), tokenPaint("--paint-green-8"), tokenPaint("--paint-earth-27"), tokenPaint("--paint-earth-44")];
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
            quad([at(i0, -fh / 2), at(i1, -fh / 2), at(i1, fh / 2), at(i0, fh / 2)], tokenPaint("--paint-earth-57"), 0.22);
          }
        }
      }
    }
    // A hamlet's fields: a few, close in.
    for (const h of hamletFields) {
      const hr = seeded(`hamlet-fields-${h.x}-${h.y}`);
      for (let n = 0; n < 2 + h.size * 2; n += 1) {
        const a = hr() * Math.PI * 2, d = 1.5 + h.size * 0.6 + hr() * 2;
        const cx = h.x + Math.cos(a) * d, cy = h.y + Math.sin(a) * d;
        const fw = 0.8 + hr() * 1.4, fh = 0.7 + hr() * 1.1, turn = hr() * Math.PI;
        const u = { x: Math.cos(turn), y: Math.sin(turn) }, v = { x: -u.y, y: u.x };
        const cell = Math.round(cy) * W + Math.round(cx);
        if (cx < 1 || cy < 1 || cx > W - 2 || cy > H - 2 || occupied[cell] !== FREE) continue;
        occupied[cell] = FIELD;
        const at = (i: number, j: number) => ({ x: cx + u.x * i + v.x * j, y: cy + u.y * i + v.y * j });
        quad([at(-fw / 2, -fh / 2), at(fw / 2, -fh / 2), at(fw / 2, fh / 2), at(-fw / 2, fh / 2)], PALETTE[Math.floor(hr() * PALETTE.length)]!);
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
    // Map version 13's scenery, cell by cell: swamp (1) and a dry bed's banks (2).
    const SWAMP = 1, BED = 2;
    const featureOf = new Uint8Array(W * H);
    for (const m of world.features?.wetlands ?? []) {
      for (let y = Math.max(0, Math.floor(m.y - m.r)); y <= Math.min(H - 1, Math.ceil(m.y + m.r)); y += 1)
        for (let x = Math.max(0, Math.floor(m.x - m.r)); x <= Math.min(W - 1, Math.ceil(m.x + m.r)); x += 1)
          if (Math.hypot(x - m.x, y - m.y) < m.r * 0.8) featureOf[y * W + x] = SWAMP;
    }
    for (const bed of world.features?.dryBeds ?? []) {
      for (const [x, y] of bed.points) for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && featureOf[yy * W + xx] === 0) featureOf[yy * W + xx] = BED;
      }
    }
    const swampMix: Array<[TreeKind, number]> = world.region === "southSouth" ? [["mangrove", 5], ["palm", 2]] : [["bush", 4], ["palm", 1], ["shade", 1]];
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
      if (what === WET || what === ROAD || what === FIELD || what === ROCK || what === QUAY) continue;
      const bank = bankDist[cell]!;
      const hill = elevationAt(cx, cy) / top;
      let chance: number, kind: TreeKind;
      const mix = MIXES[world.region ?? "southwest"] ?? MIXES.southwest!;
      const feature = featureOf[cell]!;
      // Dunes: nothing grows on the open sand.
      if (what !== TOWN && duneAt(cx, cy) > 0.25) continue;
      if (what === TOWN) { chance = 0.05; kind = pick(mix.town); }
      else if (feature === SWAMP) { chance = 0.55; kind = pick(swampMix); }
      else if (feature === BED) { chance = 0.3; kind = pick([["shade", 3], ["acacia", 3], ["baobab", 1]]); }
      else if (bank < 3) { chance = 0.75; kind = pick(mix.bank); }
      else if (bank < 7) { chance = 0.35; kind = pick(mix.near); }
      else if (hill > 0.3) { chance = 0.3; kind = pick(mix.high); }
      else { chance = 0.1 + 0.12 * patch(cx, cy); kind = pick(mix.open); }
      // Away from the banks' gallery forest, trees gather in groves with gaps between (the
      // reference flights' "stand structure"): thicker in a grove's heart, bare between.
      const g = grove(cx, cy);
      const clump = what === TOWN || bank < 3 ? 1 : Math.max(0.12, Math.min(2.4, (g - 0.35) * 5));
      if (rand() > chance * clump * (what === TOWN ? 1 : biome.trees)) continue;
      // Taller in a grove's heart, young at its edge; now and then one stands above the rest.
      const cohort = what === TOWN ? 1 : 0.65 + Math.max(0, g - 0.35) * 1.1;
      // Boulders big enough to read from the air: granite heaps, not pebbles.
      const size = (0.55 + rand() * 0.45) * cohort * (rand() < 0.03 ? 1.5 : 1) * (kind === "boulder" ? 2.2 : 1);
      m.compose(ground(cx, cy, -0.1), q.setFromAxisAngle(up, rand() * Math.PI * 2), sc.set(size, size * (0.85 + rand() * 0.3), size));
      trees.push({ kind, cell, at: m.clone() });
    }
    for (const kind of ["acacia", "shade", "palm", "bush", "rainforest", "mangrove", "baobab", "boulder"] as TreeKind[]) {
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
  // yard, metro entrances (a rail station is its own: syncStations). Each stands just outside its
  // town's houses, on its own side; one mesh, rebuilt when any of them changes.
  let builds: THREE.Mesh | null = null;
  let buildsKey = "";
  function syncBuilds(w: GameWorld): void {
    const key = `${[...w.parks].sort()}|${[...w.yards].sort()}|${[...w.metros].map(([t, n]) => `${t}:${n}`).sort()}`;
    if (key === buildsKey) return;
    buildsKey = key;
    if (builds) { scene.remove(builds); builds.geometry.dispose(); builds = null; }
    const kit = new Kit();
    const cleared: number[] = [];
    parkAt.clear();
    // `size`: its half-width in metres -- it keeps that clear of the town's buildings (a town's
    // outskirts run past its reach), stepping outward till it is.
    const standAt = (town: GameTown, angle: number, make: (k: Kit, ry: number) => void, size = 16): { x: number; y: number; z: number; ry: number } | null => {
      const houses = builtAt.get(town.id) ?? [];
      for (let k = 0; k < 48; k += 1) {
        const r = (town.industry ? 2.5 : reachCells.get(town.id) ?? 3) + 1.6 + Math.floor(k / 16) * 2.5;
        const a = angle + (k % 16) * 0.4 * (k % 2 ? 1 : -1);
        const cx = town.x + Math.cos(a) * r, cy = town.y + Math.sin(a) * r;
        if (houses.some((h) => Math.hypot(h.x - cx * M, h.z - cy * M) < h.r + size)) continue;
        const cell = Math.round(cy) * W + Math.round(cx);
        if (cx < 2 || cy < 2 || cx > W - 3 || cy > H - 3 || terrain.water[cell] === 1 || occupied[cell] === ROAD || occupied[cell] === WET || onQuay(cx, cy, 2.5) || onParkGround(cx, cy, size / M)) continue;
        const one = new Kit();
        make(one, a + Math.PI / 2);
        kit.place(one.merged(), cx * M, elevationAt(cx, cy) * HEIGHT - 0.15, cy * M);
        for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) cleared.push(cell + dy * W + dx);
        return { x: cx * M, y: elevationAt(cx, cy) * HEIGHT, z: cy * M, ry: a + Math.PI / 2 };
      }
      return null;
    };
    for (const id of w.parks) {
      const t = w.towns.get(id);
      const at = t && standAt(t, 0.3, (k, ry) => motorPark(k, seeded(`park-${id}`), ry));
      if (at) parkAt.set(id, at);
    }
    for (const id of w.yards) { const t = w.towns.get(id); if (t) standAt(t, 2.4, (k, ry) => haulageYard(k, seeded(`yard-${id}`), ry)); }
    for (const [id, lines] of w.metros) {
      const t = w.towns.get(id);
      for (let n = 0; t && n < lines; n += 1) standAt(t, 4.2 + n * 1.3, (k, ry) => metroEntrance(k, ry), 4);
    }
    if (kit.empty) return;
    builds = new THREE.Mesh(kit.merged(), material);
    builds.castShadow = true;
    builds.receiveShadow = true;
    scene.add(builds);
    const gone = new Set(cleared);
    clearTrees((cell) => gone.has(cell));
  }
  // --- Pipelines (pipelines.ts) --------------------------------------------------------------------
  // A steel pipe beside its road (as the 2D map draws it, PIPE_SIDE off), on a support every dozen
  // metres, a pumping station where it leaves its source; rust and gaps where it's broken. One mesh a
  // pipe, rebuilt when it's restored or laid.
  const pipeMeshes = new Map<string, { key: string; group: THREE.Group; line: Point[] }>();
  const pipeSteel = own(new THREE.MeshLambertMaterial({ color: paintHex("--paint-grey-14") }));
  const pipeRust = own(new THREE.MeshLambertMaterial({ color: paintHex("--paint-earth-26") }));
  /**
   * A line kept off the towns' hearts (cells), where their roundabouts stand: a pipe beside the road
   * into a town goes round the ring, not over it; one to the town stops at its edge.
   */
  function offHearts(w: GameWorld, line: Point[]): Point[] {
    const reach = (RING_OUTER + 4) / M;
    const near = [...w.towns.values()].filter((t) => !t.industry).filter((t) => line.some((q) => Math.hypot(q.x - t.x, q.y - t.y) < reach + 8));
    if (!near.length) return line;
    const dense: Point[] = [];
    line.forEach((q, k) => {
      if (k) {
        const a = line[k - 1]!, steps = Math.ceil(Math.hypot(q.x - a.x, q.y - a.y) / 0.4);
        for (let i = 1; i < steps; i += 1) dense.push({ x: a.x + ((q.x - a.x) * i) / steps, y: a.y + ((q.y - a.y) * i) / steps });
      }
      dense.push(q);
    });
    return dense.map((q) => {
      for (const t of near) {
        const d = Math.hypot(q.x - t.x, q.y - t.y);
        if (d < reach) return d < 1e-6 ? { x: t.x + reach, y: t.y } : { x: t.x + ((q.x - t.x) * reach) / d, y: t.y + ((q.y - t.y) * reach) / d };
      }
      return q;
    });
  }
  function syncPipes(w: GameWorld): void {
    const seen = new Set<string>();
    for (const p of w.pipelines ?? []) {
      seen.add(p.id);
      const key = `${p.working}|${p.line.length}|${p.cells.toFixed(2)}`;
      if (pipeMeshes.get(p.id)?.key === key) continue;
      const old = pipeMeshes.get(p.id);
      if (old) { scene.remove(old.group); old.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); }
      const group = new THREE.Group();
      const line = offHearts(w, pipeLine(p.line));
      const points = along(line, 5, 0).map((q) => new THREE.Vector3(q.x * M, floorAt(q.x, q.y) + 1.4, q.y * M));
      const last = line[line.length - 1]!;
      points.push(new THREE.Vector3(last.x * M, floorAt(last.x, last.y) + 1.4, last.y * M));
      if (points.length >= 2) {
        // Broken: in lengths, with gaps where it's been cut or rotted through.
        const runs = p.working ? [points] : points.reduce<THREE.Vector3[][]>((out, q, i) => { if (i % 9 === 0) out.push([]); if (i % 9 < 7) out[out.length - 1]!.push(q); return out; }, []).filter((r) => r.length >= 2);
        for (const run of runs) {
          const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(run), Math.max(2, run.length * 2), 0.65, 7, false), p.working ? pipeSteel : pipeRust);
          tube.castShadow = true;
          group.add(tube);
        }
      }
      const kit = new Kit();
      for (const q of along(line, 12, 4)) {
        const one = new Kit();
        one.box(0.5, 1.0, 2.0, tokenPaint("--paint-grey-20"), 0, 0, 0);
        kit.place(one.merged(), q.x * M, floorAt(q.x, q.y) - 0.1, q.y * M, -q.heading);
      }
      // A pumping station where it leaves its source: a shed, a manifold, two small tanks.
      const first = line[0]!, next = line[1] ?? first;
      const heading = Math.atan2(next.y - first.y, next.x - first.x);
      const station = new Kit();
      station.box(8, 4.2, 6, tokenPaint("--paint-light-4"), 0, -6, 0);
      station.gable(8.6, 6.6, 1.4, tokenPaint("--paint-red-4"), 0, -6, 4.2);
      for (const z of [5, 10]) station.cylinder(2.2, 4.5, tokenPaint("--paint-light-1"), -2, z, 0, 14);
      station.box(3, 1.6, 1.6, p.working ? tokenPaint("--paint-earth-52") : tokenPaint("--paint-earth-26"), 4, 0, 0.6);
      kit.place(station.merged(), first.x * M, floorAt(first.x, first.y) - 0.1, first.y * M, -heading);
      const parts = new THREE.Mesh(kit.merged(), material);
      parts.castShadow = true;
      parts.receiveShadow = true;
      group.add(parts);
      scene.add(group);
      pipeMeshes.set(p.id, { key, group, line });
    }
    for (const [id, built] of pipeMeshes) {
      if (seen.has(id)) continue;
      scene.remove(built.group);
      built.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      pipeMeshes.delete(id);
    }
  }

  // --- Stations (stations3d.ts; your playtest, map 8703 day 482: Otido's trains in one heap) ------
  // Each rail town's station in its parts: a platform track for each line, island platforms with
  // canopies, benches and lamps, a footbridge, the station building on its own platform with its
  // clock tower; freight on loops outside them past a goods shed; the throats fanning each line's
  // track in from the open line. One group a station, rebuilt when its layout changes.
  let stations = new Map<string, Station>();
  const stationMeshes = new Map<string, { key: string; group: THREE.Group; ballast: THREE.Material }>();
  let stationsInput = "";
  /** Station tracks and throats as lines (cells), and the cells under them: towns and trees keep off. */
  let stationLines: Point[][] = [];
  let stationCells = new Set<number>();
  function syncStations(w: GameWorld): void {
    const lines = [...w.routes, ...w.lorryRoutes].filter((r) => r.id.startsWith("rail:") || r.id.startsWith("freight:")).map((r) => r.id).sort().join(",");
    const rails = w.simulation.map.segments.filter((s) => s.type === "rail" && s.retiredAt === undefined).map((s) => s.id).join(",");
    const roadsNow = w.simulation.map.segments.filter((s) => s.type === "road" && s.retiredAt === undefined);
    // The sites' yards once they're placed (syncTowns): a station stands clear of them.
    const input = `${lines}|${rails}|${roadsNow.length}|${siteAt.size}`;
    if (input === stationsInput) return;
    stationsInput = input;
    const roadsOnly = roadsNow.map((s) => segmentPolyline(w.simulation.map, s));
    // Off the towns' hearts too, kept for their roundabouts (syncRings).
    const heart = (RING_OUTER + 5) / M, hearts = [...w.towns.values()].filter((t) => !t.industry);
    const blocked = (x: number, y: number) => x < 1 || y < 1 || x > W - 2 || y > H - 2 || terrain.water[Math.round(y) * W + Math.round(x)] === 1 || inYard(x, y, 6) || onQuay(x, y, 1) || hearts.some((t) => Math.abs(t.x - x) < heart && Math.abs(t.y - y) < heart && Math.hypot(t.x - x, t.y - y) < heart);
    stations = layStations(w, roadsOnly, blocked);
    for (const [id, built] of stationMeshes) {
      if (stations.get(id)?.key === built.key) continue;
      scene.remove(built.group);
      built.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      built.ballast.dispose();
      stationMeshes.delete(id);
    }
    for (const st of stations.values()) if (!stationMeshes.has(st.id)) stationMeshes.set(st.id, buildStation(st, roadsOnly));
    stationLines = [...stations.values()].flatMap((st) => [
      ...st.tracks.map((t) => [stationAt(st, -st.half, t.offset), stationAt(st, st.half, t.offset)]),
      ...[...st.throats].flatMap(([segmentId, idx]) => idx.map((i) => throatLine(st, st.ends.get(segmentId)!, st.tracks[i]!.offset, 8))),
    ]);
    stationCells = new Set<number>();
    for (const st of stations.values()) for (let u = -st.half - 6; u <= st.half + 6; u += 4) for (let v = -st.width / 2 - 18; v <= st.width / 2 + 18; v += 4) {
      const p = stationAt(st, u, v);
      stationCells.add(Math.round(p.y) * W + Math.round(p.x));
    }
    for (const line of stationLines) for (let k = 1; k < line.length; k += 1) for (let t = 0; t <= 1; t += 0.25) {
      const a = line[k - 1]!, b = line[k]!;
      stationCells.add(Math.round(a.y + (b.y - a.y) * t) * W + Math.round(a.x + (b.x - a.x) * t));
    }
    if (planted) clearTrees((cell) => stationCells.has(cell));
  }
  /** Whether a point (cells) is on a station's ground or its track, `clear` metres to spare: towns build round it. */
  function onStationGround(x: number, y: number, clear: number): boolean {
    for (const st of stations.values()) {
      const dx = (x - st.centre.x) * M, dy = (y - st.centre.y) * M;
      if (Math.hypot(dx, dy) > st.half + st.width + THROAT + clear + 30) continue;
      const u = dx * Math.cos(st.axis) + dy * Math.sin(st.axis), v = -dx * Math.sin(st.axis) + dy * Math.cos(st.axis);
      if (Math.abs(u) < st.half + 4 + clear && Math.abs(v) < st.width / 2 + 18 + clear) return true;
    }
    return stationLines.some((line) => line.some((p, k) => k > 0 && distToSegment(x, y, line[k - 1]!, p) < (clear + 4) / M));
  }
  const STATION = {
    platform: tokenPaint("--paint-earth-14"), edge: tokenPaint("--paint-earth-52"), post: tokenPaint("--paint-grey-20"),
    roof: tokenPaint("--paint-red-4"), canopy: tokenPaint("--paint-light-4"), bench: tokenPaint("--paint-earth-26"),
    wall: tokenPaint("--paint-earth-5"), trim: tokenPaint("--paint-light-4"), glass: tokenPaint("--paint-blue-17"),
    dark: tokenPaint("--paint-dark-2"), clock: tokenPaint("--paint-light-1"), steel: tokenPaint("--paint-grey-14"),
    shed: tokenPaint("--paint-grey-11"), paving: tokenPaint("--paint-earth-10"), buffer: tokenPaint("--paint-red-3"),
  };
  function buildStation(st: Station, roads: Point[][]): { key: string; group: THREE.Group; ballast: THREE.Material } {
    const group = new THREE.Group();
    const ballast = roadSurface(withClouds(new THREE.MeshLambertMaterial({ color: paintHex("--paint-grey-9"), side: THREE.DoubleSide })), ROAD_KIND.ballast, 4.6);
    const lift = 0.38;
    const track = (line: Point[]) => {
      const mesh = new THREE.Mesh(ribbonGeometry(line, 4.6, lift), ballast);
      mesh.receiveShadow = true;
      trackParts(mesh, line, lift, false, roads, false);
      group.add(mesh);
    };
    for (const t of st.tracks) track([stationAt(st, -st.half, t.offset), stationAt(st, st.half, t.offset)]);
    for (const [segmentId, idx] of st.throats) for (const i of idx) track(throatLine(st, st.ends.get(segmentId)!, st.tracks[i]!.offset));
    const kit = new Kit();
    // A piece at (u along the tracks, v across), metres, on the ground there; its own x along, z across.
    const put = (one: Kit, u: number, v: number, y = 0) => {
      const p = stationAt(st, u, v);
      kit.place(one.merged(), p.x * M, floorAt(p.x, p.y) + y, p.y * M, -st.axis);
    };
    const H = st.half, C = STATION;
    // The island platforms: a metre up, yellow lines at their edges, a canopy over their middle
    // on a row of posts, benches under it, lamps and the station's name toward their ends.
    const platforms = [...new Set(st.tracks.map((t) => t.platform).filter((p): p is number => p !== null))];
    const islands: Array<{ v: number; w: number }> = platforms.map((v) => ({ v, w: PLATFORM_WIDTH }));
    // The building's own platform, beside the outermost passenger track on its side: toward the
    // town's middle where the station stands off it, else the side with a passenger track outermost.
    const across = { x: -Math.sin(st.axis), y: Math.cos(st.axis) };
    const toward = (st.node.x - st.centre.x) * across.x + (st.node.y - st.centre.y) * across.y;
    const lo = st.tracks[0], hi = st.tracks[st.tracks.length - 1];
    const sideOk = (side: number) => (side > 0 ? hi && !hi.freight : lo && !lo.freight);
    let side = Math.abs(toward) > 0.5 ? Math.sign(toward) : sideOk(1) ? 1 : -1;
    if (!sideOk(side) && sideOk(-side)) side = -side;
    const outer = side > 0 ? hi : lo;
    let buildingV = 0;
    if (outer) {
      const ownPlatform = outer.offset + side * (2.3 + 2.6);
      if (!outer.freight) islands.push({ v: ownPlatform, w: 5.2 });
      buildingV = outer.offset + side * (2.3 + (outer.freight ? 4 : 5.2) + 6.5);
    }
    // Where a road still crosses the station (a town's middle has nowhere else), the platforms
    // break for it: the road runs through at grade between their sections.
    const nearRoads = roads.filter((line) => line.some((p) => Math.hypot(p.x - st.centre.x, p.y - st.centre.y) * M < H + st.width + 40));
    const roadAt = (u: number, v: number, pad: number) => {
      const p = stationAt(st, u, v);
      return nearRoads.some((line) => line.some((q, k) => k > 0 && distToSegment(p.x, p.y, line[k - 1]!, q) < pad / M));
    };
    for (const { v, w } of islands) {
      for (let u = -H + 4; u < H; u += 8) {
        if (roadAt(u, v, 8.5)) continue;
        const one = new Kit();
        one.box(8.05, 1.0, w, C.platform);
        for (const e of [w / 2 - 0.45, -(w / 2 - 0.45)]) one.box(8.05, 0.05, 0.4, C.edge, 0, e, 1.0);
        put(one, u, v, -0.1);
      }
      for (let u = -0.55 * H; u <= 0.55 * H + 0.1; u += 9) {
        if (roadAt(u, v, 9)) continue;
        const one = new Kit();
        one.box(0.3, 3.3, 0.3, C.post, 0, 0, 0.9);
        one.box(9.1, 0.22, w - 1.2, C.canopy, 0, 0, 4.2);
        one.gable(9.1, w - 1.2, 0.55, C.canopy, 0, 0, 4.42);
        if (Math.round(u / 9) % 2 === 0) for (const z of [-1.2, 1.2]) { one.box(1.8, 0.45, 0.5, C.bench, 2.5, z, 0.9); one.box(1.8, 0.5, 0.1, C.bench, 2.5, z + Math.sign(z) * 0.25, 1.35); }
        put(one, u, v, -0.1);
      }
      for (const u of [-0.82 * H, 0.82 * H]) {
        const one = new Kit();
        one.box(0.16, 4, 0.16, C.post, 0, 0, 0.9);
        one.box(0.7, 0.22, 0.4, C.dark, 0, 0, 4.85);
        one.box(0.12, 1.6, 0.12, C.post, 3, -0.8, 0.9);
        one.box(0.12, 1.6, 0.12, C.post, 3, 0.8, 0.9);
        one.box(0.1, 0.65, 2.6, C.glass, 3, 0, 2.4);
        put(one, u, v, -0.1);
      }
    }
    // A footbridge across every track toward one end: its deck on steel, steps down to each platform.
    const vs = [...st.tracks.map((t) => t.offset), ...islands.map((i) => i.v)];
    const v0 = Math.min(...vs) - 3, v1 = Math.max(...vs) + 3, ub = 0.6 * H;
    for (let v = v0; v < v1; v += 6) {
      const one = new Kit();
      one.box(2.8, 0.45, Math.min(6.05, v1 - v + 0.05), C.steel, 0, 0, 6.6);
      for (const x of [-1.35, 1.35]) one.box(0.12, 1.1, Math.min(6.05, v1 - v + 0.05), C.steel, x, 0, 7.05);
      put(one, ub, v + Math.min(3, (v1 - v) / 2));
    }
    for (const { v } of islands) {
      const one = new Kit();
      for (let i = 0; i < 7; i += 1) one.box(1.05, 0.8, 2.2, C.steel, -1.9 - i * 1.0, 0, 6.6 - (i + 1) * 0.8);
      put(one, ub, v, 0.9);
    }
    for (const v of [v0, v1]) {
      const one = new Kit();
      one.box(3, 6.6, 3, C.steel, 0, 0, 0);
      put(one, ub, v);
    }
    // The building, two floors and a clock tower, behind its own platform, its forecourt toward the town.
    if (outer) {
      const L = Math.min(42, H * 0.9), D = 11, s = side;
      const one = new Kit();
      one.box(L, 7.2, D, C.wall);
      one.gable(L + 0.8, D + 0.8, 3.2, C.roof, 0, 0, 7.2);
      for (let x = -L / 2 + 3; x < L / 2 - 2; x += 3.2) for (const y of [1.4, 4.6]) if (Math.abs(x) > 3.5 || y > 3) one.box(1.4, 1.7, D + 0.1, C.glass, x, 0, y);
      one.box(5, 13.5, 5, C.trim);
      one.cone(3.9, 3.4, C.roof, 0, 0, 13.5, 4);
      one.box(2.4, 2.4, 5.12, C.clock, 0, 0, 10.4);
      one.box(0.2, 1.0, 5.2, C.dark, 0, 0, 11.6);
      one.box(0.8, 0.2, 5.2, C.dark, 0.35, 0, 11.6);
      one.box(3.2, 3.0, 0.2, C.dark, 0, s * (D / 2 + 0.05), 0);
      one.box(L, 0.25, 4, C.canopy, 0, -s * (D / 2 + 2), 4.0);
      for (let x = -L / 2 + 2; x <= L / 2 - 2; x += 6) one.box(0.25, 4.0, 0.25, C.post, x, -s * (D / 2 + 3.6), 0);
      one.box(10, 0.25, 3.5, C.canopy, 0, s * (D / 2 + 1.75), 3.6);
      one.box(L + 14, 0.12, 14, C.paving, 0, s * (D / 2 + 7), 0);
      put(one, 0, buildingV, -0.1);
    }
    // Freight on its loops outside: a goods shed beside the outermost.
    const freight = st.tracks.filter((t) => t.freight);
    if (freight.length) {
      const f = freight.reduce((a, t) => (Math.abs(t.offset) > Math.abs(a.offset) ? t : a));
      const s = Math.sign(f.offset) || 1;
      const one = new Kit();
      const L = Math.min(32, H * 0.8);
      one.box(L, 1.1, 6, C.platform, 0, 0, 0);
      one.box(L, 6.2, 9, C.shed, 0, s * 1.5, 0);
      one.gable(L + 0.6, 9.6, 2.2, C.steel, 0, s * 1.5, 6.2);
      for (let x = -L / 2 + 4; x < L / 2 - 2; x += 7) one.box(3.4, 4, 9.1, C.dark, x, s * 1.5, 0);
      put(one, -0.25 * H, f.offset + s * (2.3 + 3), -0.1);
    }
    // A buffer stop where a track's platform ends with no throat beyond it: a line ends here.
    st.tracks.forEach((t, i) => {
      for (const end of [1, -1]) {
        const fed = [...st.ends.values()].some((e) => e.side === end && (st.throats.get(e.segmentId) ?? []).includes(i));
        if (fed) continue;
        const one = new Kit();
        one.box(1.2, 1.2, 3.0, C.buffer, 0, 0, 0.3);
        one.box(0.5, 0.35, 3.1, C.edge, -end * 0.6, 0, 1.1);
        put(one, end * (H + 0.6), t.offset);
      }
    });
    const mesh = new THREE.Mesh(kit.merged(), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    scene.add(group);
    return { key: st.key, group, ballast };
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

  // --- Your remit's veil (VEIL above) ------------------------------------------------------------
  // Two texels a cell, softened so its line runs smooth rather than stepping cell by cell; worked
  // out again only when a cluster opens, and lifted over two seconds where it does.
  const VR = 2, TW = (W - 1) * VR, TH = (H - 1) * VR;
  const veilData = new Uint8Array(TW * TH * 4);
  const veilTexture = own(new THREE.DataTexture(veilData, TW, TH));
  veilTexture.magFilter = veilTexture.minFilter = THREE.LinearFilter;
  veilTexture.needsUpdate = true;
  VEIL.uVeilMap.value = veilTexture;
  VEIL.uVeilSize.value.set((W - 1) * M, (H - 1) * M);
  VEIL.uVeilLine.value.setHex(paintHex("--paint-grey-23"));
  let veilKey = "";
  let veilNow: Float32Array = new Float32Array(TW * TH), veilFrom: Float32Array | null = null, veilTo: Float32Array = new Float32Array(TW * TH), veilAt = 0;
  const closedTowns = new Set<string>();
  function closedMask(w: GameWorld): Float32Array {
    let mask: Float32Array = new Float32Array(TW * TH);
    if (!remitOn(w)) return mask;
    for (let v = 0; v < TH; v += 1) for (let u = 0; u < TW; u += 1) mask[v * TW + u] = isClosed(w, landOf(w, { x: (u + 0.5) / VR, y: (v + 0.5) / VR })) ? 1 : 0;
    for (let pass = 0; pass < 2; pass += 1) {
      const next = new Float32Array(TW * TH);
      for (let v = 0; v < TH; v += 1) for (let u = 0; u < TW; u += 1) {
        let sum = 0, n = 0;
        for (let dv = -1; dv <= 1; dv += 1) for (let du = -1; du <= 1; du += 1) {
          const uu = u + du, vv = v + dv;
          if (uu < 0 || vv < 0 || uu >= TW || vv >= TH) continue;
          sum += mask[vv * TW + uu]!;
          n += 1;
        }
        next[v * TW + u] = sum / n;
      }
      mask = next;
    }
    return mask;
  }
  function writeVeil(): void {
    for (let i = 0; i < TW * TH; i += 1) {
      veilData[i * 4] = Math.round(veilNow[i]! * 255);
      veilData[i * 4 + 1] = Math.round(veilTo[i]! * 255);
    }
    veilTexture.needsUpdate = true;
  }
  /** Twice a second: a cluster opened (or the first look), and its closed towns' names dimmed. */
  function syncVeil(w: GameWorld): void {
    const key = remitOn(w) ? `open:${w.remit!.open.join("|")}` : "off";
    if (key !== veilKey) {
      const first = veilKey === "";
      veilKey = key;
      veilTo = closedMask(w);
      if (first) veilNow = veilTo.slice();
      else { veilFrom = veilNow.slice(); veilAt = performance.now(); }
      writeVeil();
      closedTowns.clear();
      for (const t of w.towns.values()) if (isClosed(w, clusterAt(w, t.id))) closedTowns.add(t.id);
    }
    for (const [id, entry] of towns) entry.text.classList.toggle("closed", closedTowns.has(id));
  }
  /** Every frame: the veil lifting where a cluster opened; the tint the haze's. */
  function animateVeil(): void {
    VEIL.uVeilTint.value.copy((scene.fog as THREE.Fog).color);
    if (!veilFrom) return;
    const t = Math.min(1, (performance.now() - veilAt) / 2000);
    const ease = t * t * (3 - 2 * t);
    for (let i = 0; i < TW * TH; i += 1) veilNow[i] = veilFrom[i]! + (veilTo[i]! - veilFrom[i]!) * ease;
    writeVeil();
    if (t >= 1) veilFrom = null;
  }

  // --- People (the fidelity list, 2026-11-01: "people who show the game") ----------------------
  // Riders at your stops, as many as wait there (waitingAt: a figure for every six, up to 30, shared
  // between a town's stops); passengers and touts at your motor parks, by the riders who gave up on
  // you waiting there for a danfo to fill (the informal pool); shoppers at a town's markets, by its
  // size, more while it grows. One instanced mesh for their clothes (each tinted), one for the
  // rest, the same matrices; each shuffles where it stands, or wanders (aWander, metres), on the
  // graphics card. Rebuilt only when a crowd's size changes.
  const marketsAt = new Map<string, Array<{ x: number; z: number; big: boolean }>>();
  const builtAt = new Map<string, Array<{ x: number; z: number; r: number }>>();
  const parkAt = new Map<string, { x: number; y: number; z: number; ry: number }>();
  const PEOPLE = 3000, PERSON_SCALE = 1.3;
  const personShape = personGeometry();
  const wander = new THREE.InstancedBufferAttribute(new Float32Array(PEOPLE), 1);
  const peopleTime = { value: 0 };
  const peopleMaterial = own(new THREE.MeshLambertMaterial({ vertexColors: true }));
  peopleMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = peopleTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aWander;\nuniform float uTime;")
      .replace("#include <begin_vertex>", /* glsl */ `#include <begin_vertex>
        // A slow loop about where it stands (as far as aWander), a little bob in the step; standing
        // still, a shift of the weight.
        float id = float(gl_InstanceID);
        float a = uTime * (0.18 + fract(id * 0.618) * 0.2) + id * 2.39;
        float reach = max(aWander, 0.12);
        transformed.x += sin(a) * reach / ${PERSON_SCALE.toFixed(2)};
        transformed.z += cos(a * 0.83) * reach / ${PERSON_SCALE.toFixed(2)};
        transformed.y += step(0.5, aWander) * abs(sin(uTime * 4.0 + id)) * 0.05;`);
  };
  const crowdOf = (geometry: THREE.BufferGeometry, tinted: boolean) => {
    const g = own(geometry);
    g.setAttribute("aWander", wander);
    const mesh = new THREE.InstancedMesh(g, peopleMaterial, PEOPLE);
    if (tinted) mesh.setColorAt(0, new THREE.Color());
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  };
  const clothes = crowdOf(personShape.clothes, true), bodies = crowdOf(personShape.rest, false);
  const clothesColours = CLOTHES.map((name) => new THREE.Color(paintHex(name)));
  // Each of your stops: beside the road the route takes out of the town, on its near side, a shelter.
  const stopSpots = new Map<string, { x: number; y: number; z: number; ry: number } | null>();
  let stops: THREE.Mesh | null = null;
  let stopsKey = "";
  function stopSpot(w: GameWorld, at: GameTown, toward: GameTown): { x: number; y: number; z: number; ry: number } | null {
    const key = `${at.id}>${toward.id}`;
    if (stopSpots.has(key)) return stopSpots.get(key)!;
    const want = Math.atan2(toward.y - at.y, toward.x - at.x);
    let best: { line: Point[]; off: number } | null = null;
    for (const seg of w.simulation.map.segments) {
      if (seg.type !== "road" || seg.retiredAt !== undefined || (seg.fromNodeId !== at.id && seg.toNodeId !== at.id)) continue;
      const line = segmentPolyline(w.simulation.map, seg);
      const out = seg.fromNodeId === at.id ? line : [...line].reverse();
      const [, rest] = splitPolyline(out, Math.min(polylineLength(out) * 0.5, 3));
      const p = rest[0] ?? out[out.length - 1]!;
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(p.y - at.y, p.x - at.x) - want), Math.cos(Math.atan2(p.y - at.y, p.x - at.x) - want)));
      if (!best || off < best.off) best = { line: out, off };
    }
    let spot: { x: number; y: number; z: number; ry: number } | null = null;
    if (best) {
      const [, rest] = splitPolyline(best.line, Math.min(polylineLength(best.line) * 0.4, Math.max((RING_OUTER + 7) / M, (reachCells.get(at.id) ?? 3) * 0.3)));
      const p = rest[0]!, q = rest[1] ?? best.line[best.line.length - 1]!;
      // On the near side of the road -- or the far side, where a railway runs along the near one.
      const rails = w.simulation.map.segments.filter((sg) => sg.type === "rail" && sg.retiredAt === undefined).map((sg) => segmentPolyline(w.simulation.map, sg)).filter((line) => line.some((r) => Math.hypot(r.x - p.x, r.y - p.y) < 8));
      const railAt = (x: number, y: number) => rails.some((line) => line.some((r, k) => k > 0 && distToSegment(x, y, line[k - 1]!, r) < 2.2));
      let dir = Math.atan2(q.y - p.y, q.x - p.x);
      if (railAt(p.x - Math.sin(dir) * (8 / M), p.y + Math.cos(dir) * (8 / M))) dir += Math.PI;
      const sx = p.x - Math.sin(dir) * (8 / M), sy = p.y + Math.cos(dir) * (8 / M);
      spot = { x: sx * M, y: elevationAt(sx, sy) * HEIGHT, z: sy * M, ry: Math.PI - dir };
    }
    stopSpots.set(key, spot);
    return spot;
  }
  let crowdKey = "";
  function syncPeople(w: GameWorld): void {
    // Where your road routes stop (both ends), and which way each leaves.
    const served = new Map<string, Array<{ x: number; y: number; z: number; ry: number }>>();
    for (const route of w.routes) {
      const v = w.simulation.vehicles.find((x) => x.id === route.vehicleIds[0]);
      if (!v || v.carries === "goods" || w.railVehicles.has(v.id)) continue;
      for (const [from, to] of [[route.a, route.b], [route.b, route.a]] as const) {
        const a = w.towns.get(from), b = w.towns.get(to);
        if (!a || !b || a.industry || parks.has(from)) continue;
        const spot = stopSpot(w, a, b);
        if (!spot) continue;
        const list = served.get(from) ?? served.set(from, []).get(from)!;
        if (!list.some((s) => Math.hypot(s.x - spot.x, s.z - spot.z) < 6)) list.push(spot);
      }
    }
    const shelterKey = [...served].map(([id, list]) => `${id}:${list.length}`).sort().join("|");
    if (shelterKey !== stopsKey) {
      stopsKey = shelterKey;
      if (stops) { scene.remove(stops); stops.geometry.dispose(); stops = null; }
      const kit = new Kit();
      for (const list of served.values()) for (const spot of list) {
        const one = new Kit();
        busShelter(one, spot.ry, tokenPaint("--you"));
        kit.place(one.merged(), spot.x, spot.y - 0.1, spot.z);
      }
      if (!kit.empty) {
        stops = new THREE.Mesh(kit.merged(), material);
        stops.castShadow = true;
        stops.receiveShadow = true;
        scene.add(stops);
      }
    }
    // The crowds: where, how many, how they stand.
    type Crowd = { key: string; n: number; at: { x: number; z: number; ry: number }; place: (rand: () => number, i: number) => [number, number, number]; lift?: number };
    const crowds: Crowd[] = [];
    // On the station's platforms, as many as wait in the town, between its lines' tracks.
    for (const st of stations.values()) {
      const islands = [...new Set(st.tracks.map((t) => t.platform).filter((p): p is number => p !== null))];
      if (!islands.length) continue;
      const n = Math.max(2, Math.min(24, Math.round(waitingAt(w, st.id) / 8 / islands.length)));
      islands.forEach((v, k) => {
        const p = stationAt(st, 0, v);
        crowds.push({ key: `station:${st.id}:${k}`, n, at: { x: p.x * M, z: p.y * M, ry: -st.axis }, place: (r) => [(r() - 0.5) * st.half * 1.3, (r() - 0.5) * (PLATFORM_WIDTH - 2.2), 0.3], lift: 0.9 });
      });
    }
    // At a bus park's bays, on the island's edge beside each, its route's share of the town's wait.
    for (const park of parks.values()) {
      const built = parkMeshes.get(park.id);
      if (!built) continue;
      const n = Math.max(1, Math.min(30, Math.round(waitingAt(w, park.id) / 6 / Math.max(1, park.bays.size))));
      const ry = Math.atan2(-Math.cos(park.axis), -Math.sin(park.axis));
      const centre = parkPoint(park, 0, 0);
      const lift = built.top - elevationAt(centre.x, centre.y) * HEIGHT + 0.95;
      [...park.bays].forEach(([routeId, bay]) => crowds.push({
        key: `buspark:${park.id}:${routeId}`, n, at: { x: centre.x * M, z: centre.y * M, ry }, lift,
        // In the kit's frame (busPark): x along the island, z toward the town (-o).
        place: (r) => [bay.s + (r() - 0.5) * 15, -Math.sign(bay.o) * (BUS_PARK.island - 1.2 - r() * 1.6), 0.15],
      }));
    }
    for (const [id, list] of served) {
      const n = Math.max(1, Math.min(30, Math.round(waitingAt(w, id) / 6 / list.length)));
      // In front of the shelter, between it and the kerb; a long wait spills along the road.
      list.forEach((spot, k) => crowds.push({ key: `stop:${id}:${k}`, n, at: spot, place: (r, i) => [(r() - 0.5) * Math.min(18, 3.5 + i * 0.55), 0.6 + r() * 1.9, 0.12] }));
    }
    const pooled = new Map<string, number>();
    for (const pool of [w.informal.pool, w.informal.smallPool]) for (const [key, amount] of pool) {
      const { at } = parsePoolKey(key);
      if (parkAt.has(at)) pooled.set(at, (pooled.get(at) ?? 0) + amount);
    }
    for (const [id, park] of parkAt) {
      // Passengers under the union's shelter; touts working the rows of danfos.
      crowds.push({ key: `park:${id}`, n: Math.min(30, 2 + Math.round((pooled.get(id) ?? 0) / 8)), at: park, place: (r) => [(r() - 0.5) * 11, 7 + r() * 3, 0.15] });
      crowds.push({ key: `touts:${id}`, n: 3, at: park, place: (r) => [(r() - 0.5) * 22, (r() - 0.5) * 2, 3] });
    }
    for (const [id, list] of marketsAt) {
      const town = w.towns.get(id);
      if (!town) continue;
      const busy = growthTrend(w, id) === "growing" ? 1.3 : 1;
      list.forEach((m, k) => crowds.push({ key: `market:${id}:${k}`, n: Math.round((m.big ? Math.min(24, 5 + Math.sqrt(town.population) * 1.4) : 3) * busy), at: { x: m.x, z: m.z, ry: 0 }, place: (r) => [(r() - 0.5) * 14, (r() - 0.5) * 9, 2] }));
    }
    const key = crowds.map((c) => `${c.key}=${c.n}`).join(",");
    if (key === crowdKey) return;
    crowdKey = key;
    let i = 0;
    const where = new THREE.Vector3(), turned = new THREE.Quaternion(), size = new THREE.Vector3().setScalar(PERSON_SCALE), m = new THREE.Matrix4(), colour = new THREE.Color();
    for (const crowd of crowds) {
      const rand = seeded(`crowd-${crowd.key}`);
      const cos = Math.cos(crowd.at.ry), sin = Math.sin(crowd.at.ry);
      for (let k = 0; k < crowd.n && i < PEOPLE; k += 1) {
        const [lx, lz, roam] = crowd.place(rand, k);
        const x = crowd.at.x + lx * cos + lz * sin, z = crowd.at.z - lx * sin + lz * cos;
        // Facing the road (or the stalls, give or take), clothes from the town's prints.
        turned.setFromAxisAngle(up, crowd.at.ry + (rand() - 0.5) * (roam > 1 ? 6 : 1.2));
        m.compose(where.set(x, elevationAt(x / M, z / M) * HEIGHT + (crowd.lift ?? 0), z), turned, size);
        clothes.setMatrixAt(i, m);
        bodies.setMatrixAt(i, m);
        clothes.setColorAt(i, colour.copy(clothesColours[Math.floor(rand() * clothesColours.length)]!));
        wander.setX(i, roam);
        i += 1;
      }
    }
    clothes.count = bodies.count = i;
    clothes.instanceMatrix.needsUpdate = bodies.instanceMatrix.needsUpdate = true;
    if (clothes.instanceColor) clothes.instanceColor.needsUpdate = true;
    wander.needsUpdate = true;
  }

  // --- Frame the home cluster's biggest town ------------------------------------------------
  {
    const home = [...world.towns.values()].filter((t) => !t.industry && inHome(world, t)).reduce<GameTown | null>((big, t) => (!big || t.population > big.population ? t : big), null);
    const target = home ? ground(home.x, home.y) : ground(W / 2, H / 2);
    controls.target.copy(target);
    camera.position.set(target.x + 320, target.y + 380, target.z + 320);
  }

  // Rain over a flooded ford (floods.ts; B5): while the water's up, a dark cloud low over the ford
  // and streaks falling under it. Rebuilt when which fords are under changes; the rains season
  // clouds the whole sky a little more.
  const rainMaterial = own(new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 }, uColour: { value: new THREE.Color(paintHex("--paint-light-2")) } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aEnd;
      uniform float uTime;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        float fall = mod(uTime * 55.0 + aSeed * 130.0, 130.0);
        p.y += 125.0 - fall - aEnd * 5.0;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColour;
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(uColour, 0.55);
        #include <fog_fragment>
      }
    `,
  }));
  const stormMaterial = own(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.72 }));
  // The clouds themselves (your look, 2026-10-31: "I saw cloud shadows but didn't see the clouds"):
  // the same drifting field as their shadows, as soft white shapes CLOUD_HEIGHT above the land, set
  // up-sun of the shade they cast so each sits over its own shadow. Seen only from afar -- they fade
  // as the camera comes in, so close up they never veil what you're looking at.
  const CLOUD_HEIGHT = 260;
  const cloudLayer = new THREE.Mesh(own(new THREE.PlaneGeometry((W - 1) * M, (H - 1) * M, 1, 1).rotateX(-Math.PI / 2).translate(((W - 1) * M) / 2, CLOUD_HEIGHT, ((H - 1) * M) / 2)), own(new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    side: THREE.DoubleSide,
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uCloudTime: CLOUD.uCloudTime, uCloudCover: CLOUD.uCloudCover, uFade: { value: 0 }, uColour: { value: new THREE.Color(paintHex("--paint-light-1")) }, uShade: { value: new THREE.Color(paintHex("--paint-grey-1")) }, uMin: { value: new THREE.Vector2(0, 0) }, uMax: { value: new THREE.Vector2((W - 1) * M, (H - 1) * M) } },
    vertexShader: /* glsl */ `
      varying vec2 vXZ;
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vXZ = world.xz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uCloudTime;
      uniform float uCloudCover;
      uniform float uFade;
      uniform vec3 uColour;
      uniform vec3 uShade;
      uniform vec2 uMin;
      uniform vec2 uMax;
      varying vec2 vXZ;
      #include <fog_pars_fragment>
      float cloudHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float cloudNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), u.x), mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        if (uFade <= 0.0) discard;
        // Over the ground its shadow falls on: the sun is up and to the north-west.
        vec2 drift = vXZ + vec2(${CLOUD_HEIGHT.toFixed(1)}, ${(CLOUD_HEIGHT / 2).toFixed(1)}) - vec2(uCloudTime * 9.0, uCloudTime * 4.0);
        float c = cloudNoise(drift / 420.0) * 0.65 + cloudNoise(drift / 160.0 + 3.7) * 0.35;
        float body = smoothstep(1.0 - uCloudCover - 0.04, 1.2 - uCloudCover, c);
        if (body <= 0.01) discard;
        // Puffy, not a sheet: broken up within, thinner at its edges; and gone toward the map's edge,
        // so none is cut off by it.
        float puff = cloudNoise(drift / 55.0 + 11.0) * 0.6 + cloudNoise(drift / 22.0 + 5.0) * 0.4;
        vec2 toEdge = min(vXZ - uMin, uMax - vXZ);
        float inside = smoothstep(0.0, 260.0, min(toEdge.x, toEdge.y));
        float alpha = body * smoothstep(0.25, 0.75, puff * (0.6 + 0.6 * body)) * 0.55 * uFade * inside;
        if (alpha <= 0.01) discard;
        gl_FragColor = vec4(mix(uShade, uColour, 0.45 + 0.55 * puff), alpha);
        #include <fog_fragment>
      }
    `,
  })));
  cloudLayer.renderOrder = 2;
  scene.add(cloudLayer);
  scenery.push(cloudLayer);
  const cloudMaterial = cloudLayer.material as THREE.ShaderMaterial;

  let rainKey = "";
  let rainGroup: THREE.Group | null = null;
  function syncRain(w: GameWorld): void {
    const floods = w.floods;
    const under = floods?.phase === "flood" ? floods.under : [];
    const key = under.join("|");
    if (key === rainKey) return;
    rainKey = key;
    CLOUD.uCloudCover.value = Math.min(0.8, weather.cover + (under.length ? 0.2 : 0));
    if (rainGroup) {
      scene.remove(rainGroup);
      rainGroup.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      rainGroup = null;
    }
    if (!under.length) return;
    rainGroup = new THREE.Group();
    for (const id of under) {
      const ford = floods!.fords.find((f) => f.id === id);
      if (!ford) continue;
      const rr = seeded(`rain-${id}`);
      const base = ground(ford.x, ford.y);
      // The cloud: a few grey puffs, flattened, low over the ford, casting its shade.
      const puffs = new Kit();
      // Many small puffs, a little ragged, darker underneath (a rain cloud), not a few big lumps.
      for (let k = 0; k < 16; k += 1) {
        const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * 95, r = 26 + rr() * 26;
        puffs.add(new THREE.IcosahedronGeometry(r, 2), k % 3 ? paintHex("--paint-grey-11") : paintHex("--paint-grey-12"), { x: Math.cos(a) * d, y: (rr() - 0.3) * 18, z: Math.sin(a) * d });
      }
      const cloud = new THREE.Mesh(puffs.merged(), stormMaterial);
      cloud.scale.y = 0.38;
      cloud.position.set(base.x, base.y + 150, base.z);
      cloud.castShadow = true;
      rainGroup.add(cloud);
      // The rain: streaks falling under it.
      const verts: number[] = [], seeds: number[] = [], ends: number[] = [];
      for (let n = 0; n < 900; n += 1) {
        const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * 150;
        const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d, y = elevationAt(x / M, z / M) * HEIGHT, seed = rr();
        verts.push(x, y, z, x, y, z);
        seeds.push(seed, seed);
        ends.push(0, 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
      geo.setAttribute("aEnd", new THREE.Float32BufferAttribute(ends, 1));
      const streaks = new THREE.LineSegments(geo, rainMaterial);
      streaks.frustumCulled = false;
      rainGroup.add(streaks);
    }
    scene.add(rainGroup);
  }

  let network = "";
  let slowAt = 0;
  // --- A click: what's under it ------------------------------------------------------------------
  const PICK_PX = 12;
  const projected = new THREE.Vector3();
  function pickAt(px: number, py: number, ray: THREE.Raycaster): Pick3D | null {
    const w = world;
    const roadsOn = shown.network !== "rail", railOn = shown.network !== "roads";
    // A vehicle: the nearest drawn within a few pixels, of a layer that's showing.
    let best: { id: string; d: number } | null = null;
    for (const v of drawnVehicles) {
      if (v.rail ? !railOn : !roadsOn) continue;
      projected.copy(v.at).project(camera);
      if (projected.z > 1) continue;
      const d = Math.hypot(((projected.x + 1) / 2) * innerWidth - px, ((1 - projected.y) / 2) * innerHeight - py);
      if (d < PICK_PX && (!best || d < best.d)) best = { id: v.id, d };
    }
    if (best) {
      const line = [...w.routes, ...w.lorryRoutes].find((r) => r.vehicleIds.includes(best!.id));
      if (line) return { kind: "route", id: line.id };
      // The danfos' and hauliers': the road they're on.
      const vehicle = w.simulation.vehicles.find((x) => x.id === best!.id);
      const under = vehicle && segmentUnder(w, vehicle);
      if (under) return { kind: "segment", id: under.id };
    }
    ray.setFromCamera(new THREE.Vector2((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1), camera);
    const hit = ray.intersectObjects([...towns.values()].map((t) => t.mesh), true)[0];
    let found: THREE.Object3D | null = hit?.object ?? null;
    while (found && !found.userData.townId) found = found.parent;
    const id = found?.userData.townId as string | undefined;
    if (id) return { kind: "place", id };
    // A road or track: the nearest to where the ray meets the land, within a few pixels' worth.
    const ground = landMesh && ray.intersectObject(landMesh, false)[0]?.point;
    if (!ground) return null;
    const metresPerPx = (2 * camera.position.distanceTo(ground) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / innerHeight;
    const reach = Math.max(6, PICK_PX * metresPerPx) / M;
    const gx = ground.x / M, gy = ground.z / M;
    let road: { id: string; d: number } | null = null;
    for (const [segmentId, r] of roads) {
      if (!r.mesh.visible || r.retired) continue;
      for (let i = 1; i < r.line.length; i += 1) {
        const d = distToSegment(gx, gy, r.line[i - 1]!, r.line[i]!);
        if (d < reach && (!road || d < road.d)) road = { id: segmentId, d };
      }
    }
    // A pipeline beside its road: whichever of the two is nearer.
    let pipe: { id: string; d: number } | null = null;
    for (const [id, built] of pipeMeshes) {
      for (let i = 1; i < built.line.length; i += 1) {
        const d = distToSegment(gx, gy, built.line[i - 1]!, built.line[i]!);
        if (d < reach && (!pipe || d < pipe.d)) pipe = { id, d };
      }
    }
    if (pipe && (!road || pipe.d < road.d)) return { kind: "pipe", id: pipe.id };
    return road ? { kind: "segment", id: road.id } : null;
  }

  // --- Layers and overlays (the buttons over the log, as on the 2D map) ---------------------------
  const shown: { network: Network } = { network: "both" };
  function layers(network: Network, showScenery: boolean): void {
    shown.network = network;
    const roadsOn = network !== "rail", railOn = network !== "roads";
    for (const road of roads.values()) road.mesh.visible = road.rail ? railOn : roadsOn;
    if (crossings) crossings.visible = roadsOn && railOn;
    for (const [kind, mesh] of fleets) mesh.visible = kind === "train" || kind === "freight" || kind === "coach" || kind === "wagon" ? railOn : roadsOn;
    dust.visible = roadsOn;
    for (const thing of scenery) thing.visible = showScenery;
    for (const mesh of groves.values()) mesh.visible = showScenery;
    if (roadside) roadside.visible = showScenery && roadsOn;
    for (const built of stationMeshes.values()) built.group.visible = railOn;
  }
  // An overlay's marks as arcs over the land, town to town -- the 2D map's curves stood up, as high
  // as they're long -- in the overlay's own colours, unlit, through the haze.
  const arcGroup = new THREE.Group();
  scene.add(arcGroup);
  let arcsFor: readonly OverlayMark[] | null = null;
  const cssColour = document.createElement("canvas").getContext("2d")!;
  /**
   * The arcs read from afar; close in they fade away (2026-11-04: zoomed to a town, its arcs to
   * every neighbour, high above it, crossed the view as broad dark bands over everything).
   */
  let arcFade = 1;
  function fadeArcs(away: number): void {
    const fade = Math.max(0, Math.min(1, (away - 600) / 900));
    if (Math.abs(fade - arcFade) < 0.01) return;
    arcFade = fade;
    arcGroup.visible = fade > 0.01;
    for (const child of arcGroup.children as THREE.Mesh[]) (child.material as THREE.MeshBasicMaterial).opacity = (child.userData.opacity as number) * fade;
  }
  function arcs(next: readonly OverlayMark[]): void {
    if (next === arcsFor) return;
    arcsFor = next;
    for (const child of [...arcGroup.children] as THREE.Mesh[]) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
      arcGroup.remove(child);
    }
    for (const m of next) {
      const p = ground(m.a.x, m.a.y, 12), q = ground(m.b.x, m.b.y, 12);
      const span = p.distanceTo(q);
      const mid = p.clone().add(q).multiplyScalar(0.5);
      mid.y = Math.max(p.y, q.y) + (m.straight ? 0.12 : 0.28) * span + 20;
      const curve = new THREE.QuadraticBezierCurve3(p, mid, q);
      cssColour.fillStyle = m.color;
      const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(cssColour.fillStyle as string), transparent: true, opacity: Math.max(0.4, m.alpha), depthWrite: false, fog: false });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(12, Math.round(span / 25)), 1.5 + m.width * 1.4, 8, false), material);
      tube.userData.opacity = material.opacity;
      material.opacity *= arcFade;
      tube.renderOrder = 3;
      arcGroup.add(tube);
    }
  }

  return {
    layers,
    arcs,
    pickAt,
    rain(seconds, away) {
      animateSiteLife(seconds);
      fadeArcs(away);
      rainMaterial.uniforms.uTime!.value = seconds;
      // Close in, under the cloud, it thins away -- else it veils the view -- and the rain shows.
      stormMaterial.opacity = Math.max(0.08, Math.min(0.72, (away - 250) / 600));
      // The clouds: from afar only.
      cloudMaterial.uniforms.uFade!.value = Math.max(0, Math.min(1, (away - 1000) / 900));
    },
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
      paintSky(dark ? paintHex("--paint-dark-4") : paintHex("--paint-blue-6"), dark ? paintHex("--paint-blue-21") : HORIZON, dark ? paintHex("--paint-dark-3") : paintHex("--paint-blue-4"));
      hemi.color.setHex(dark ? paintHex("--paint-blue-10") : paintHex("--paint-light-2"));
      hemi.groundColor.setHex(dark ? paintHex("--paint-dark-2") : paintHex("--paint-earth-50"));
      hemi.intensity = dark ? 0.6 : 1.45;
      sun.color.setHex(dark ? paintHex("--paint-blue-3") : paintHex("--paint-light-5"));
      sun.intensity = dark ? 0.5 : 2.5;
      setWaterNight(waterMaterial, dark);
      edgeMaterial.color.setScalar(dark ? 0.3 : 1);
      recolourSkirt(dark ? paintHex("--paint-blue-21") : HORIZON);
      windowMaterial.emissive.setHex(dark ? paintHex("--paint-earth-20") : paintHex("--paint-dark-6"));
      windowMaterial.emissiveIntensity = dark ? 1.1 : 0;
      cloudMaterial.uniforms.uColour!.value.setHex(dark ? paintHex("--paint-blue-21") : paintHex("--paint-light-1"));
      cloudMaterial.uniforms.uShade!.value.setHex(dark ? paintHex("--paint-dark-3") : paintHex("--paint-grey-1"));
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
        const scaled = entry.mesh.scale.x;
        const radius = Math.max(20, Math.min(160, sphere.radius * scaled * 0.55));
        const x = entry.mesh.position.x + sphere.center.x * scaled;
        const z = entry.mesh.position.z + sphere.center.z * scaled;
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
        roadEdges.clear();
        passages.clear();
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
        syncStations(w);
        syncParks(w);
        syncRings(w);
        syncPipes(w);
        syncTowns(w);
        if (planted) syncSellers(w);
        syncSiteLife(w);
        if (planted) syncHarbour(w);
        syncRain(w);
        if (planted) syncBuilds(w);
        if (planted) syncPeople(w);
        syncVeil(w);
        if (!planted) {
          plant(w);
          buildRoadside(w);
          clearTrees((cell) => stationCells.has(cell));
        }
      }
      placeVehicles(w);
      animateAirport(w);
    },
    dispose() {
      arcs([]);
      for (const built of stationMeshes.values()) {
        built.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        built.ballast.dispose();
      }
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
/** A site's kit, dry: where each piece would stand and how big, without building it -- to choose where the site goes. */
/**
 * A box's footprint as discs (centre and radius each, metres): `fine`, a long or broad one is a
 * row or grid of them -- a runway near a road isn't one disc as wide as it is long -- else one.
 */
function footprintOf(w: number, d: number, x: number, z: number, ry: number, fine: boolean): Array<[number, number, number]> {
  const long = Math.max(w, d), short = Math.min(w, d);
  if (!fine || (long < short * 2.5 && long <= 30)) return [[x, z, long / 2]];
  const size = short >= 3 ? Math.min(short, 30) : 30, nx = Math.ceil(w / size), nz = Math.ceil(d / size), r = Math.max(w / nx, d / nz) / 2 + 0.5;
  const c = Math.cos(ry), sn = Math.sin(ry), out: Array<[number, number, number]> = [];
  for (let i = 0; i < nx; i += 1) for (let j = 0; j < nz; j += 1) {
    const lx = -w / 2 + (w / nx) * (i + 0.5), lz = -d / 2 + (d / nz) * (j + 0.5);
    out.push([x + lx * c + lz * sn, z - lx * sn + lz * c, r]);
  }
  return out;
}
class SurveyKit extends Kit {
  pieces: Array<[number, number, number]> = [];
  constructor(private fine = false) {
    super();
  }
  override add(): void {}
  override box(w: number, _h: number, d: number, _c: string | number, x = 0, z = 0, _y = 0, ry = 0): void {
    this.pieces.push(...footprintOf(w, d, x, z, ry, this.fine));
  }
  override cylinder(r: number, _h: number, _c: string | number, x = 0, z = 0): void {
    this.pieces.push([x, z, r]);
  }
  override cone(r: number, _h: number, _c: string | number, x = 0, z = 0): void {
    this.pieces.push([x, z, r]);
  }
  override gable(w: number, d: number, _h: number, _c: string | number, x = 0, z = 0): void {
    this.pieces.push([x, z, Math.max(w, d) / 2]);
  }
  override fits(x: number, z: number, r: number): boolean {
    this.pieces.push([x, z, r]);
    return true;
  }
}
class ClearKit extends Kit {
  dropped = 0;
  private unchecked = false;
  constructor(private ok: (x: number, z: number, r: number) => boolean, private fine = false) {
    super();
  }
  private clear(x: number, z: number, r: number): boolean {
    if (this.unchecked || this.ok(x, z, r)) return true;
    this.dropped += 1;
    return false;
  }
  /** Pieces put down whatever stands there (an airport's drive, out to its point). */
  always(put: (kit: Kit) => void): void {
    this.unchecked = true;
    put(this);
    this.unchecked = false;
  }
  override box(w: number, h: number, d: number, colour: string | number, x = 0, z = 0, y = 0, ry = 0): void {
    if (footprintOf(w, d, x, z, ry, this.fine).every(([cx, cz, r]) => this.clear(cx, cz, r))) super.box(w, h, d, colour, x, z, y, ry);
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
  override fits(x: number, z: number, r: number): boolean {
    return this.clear(x, z, r);
  }
}
