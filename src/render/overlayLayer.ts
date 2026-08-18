import * as THREE from "three";
import type { GeneratedMap } from "../engine/map/types";
import { MIN_CONDITION } from "../engine/map/decay";
import { stepCost } from "../engine/pathing/cost";
import { FREE_SLOT_WEIGHT, congestionFactor } from "../engine/simulation/congestion";
import type { CargoKind, NodeQueues, RoutingContext, Vehicle } from "../engine/simulation/types";
import type { GrowthState } from "../engine/growth/types";
import type { OverlayId } from "../ui/overlays";
import { gridToWorld } from "./gridCoords";

// The overlay layer is *additive*: its own group drawn above the base
// network, never a recolour of it. That is what protects the base map's
// two-channel contract -- hue = health, brightness = utilisation
// (docs/rebuild-plan.md §5) -- from an overlay that needs to say something
// those channels are not for. While an overlay is active the base network
// is dimmed to neutral by the caller, so exactly one thing on screen is
// speaking in colour at a time.
//
// Rebuilt on a timer rather than per frame: every overlay is a
// whole-map aggregate, and at 60fps the disposal churn would dwarf the
// simulation itself. A quarter second is well under the time it takes to
// read one.
const REFRESH_SECONDS = 0.25;
const OVERLAY_Y = 0.55;

const CARGO_COLORS: Record<CargoKind, number> = {
  passengers: 0xff8844,
  produce: 0x66cc55,
  supplies: 0x6688ff,
};

export interface OverlayContext {
  map: GeneratedMap;
  vehicles: Vehicle[];
  queues: NodeQueues;
  routing: RoutingContext;
  growth: GrowthState;
  stranded: ReadonlySet<string>;
  /** The tick's own total road occupancy, ambient private cars included. */
  segmentLoads: ReadonlyMap<string, number>;
}

export interface OverlayLayerHandle {
  group: THREE.Group;
  setOverlay: (id: OverlayId) => void;
  update: (context: OverlayContext, dt: number) => void;
}

/** Green -> amber -> red. 1 is good, 0 is bad. */
function healthColor(value: number): THREE.Color {
  const clamped = Math.max(0, Math.min(1, value));
  const good = new THREE.Color(0x33cc55);
  const mid = new THREE.Color(0xe0b040);
  const bad = new THREE.Color(0xdd3322);
  return clamped > 0.5
    ? mid.clone().lerp(good, (clamped - 0.5) * 2)
    : bad.clone().lerp(mid, clamped * 2);
}

function disposeObject(object: THREE.Object3D): void {
  if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
    object.geometry.dispose();
    const material = object.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  }
}

export function createOverlayLayer(): OverlayLayerHandle {
  const group = new THREE.Group();
  let overlay: OverlayId = "none";
  let sinceRefresh = Infinity;
  let buildabilityTexture: THREE.CanvasTexture | null = null;
  let buildabilityForMap: GeneratedMap | null = null;

  function clear(): void {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeObject(child);
    }
  }

  function setOverlay(id: OverlayId): void {
    if (id === overlay) return;
    overlay = id;
    sinceRefresh = Infinity;
  }

  function addRibbon(
    from: { x: number; z: number },
    to: { x: number; z: number },
    color: THREE.Color,
    thickness: number,
    y: number,
  ): void {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length === 0) return;
    const geometry = new THREE.BoxGeometry(length, 0.02, thickness);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((from.x + to.x) / 2, y, (from.z + to.z) / 2);
    // Same sign convention as the bridge deck (render/network.ts): world Z
    // is the negated grid axis, so the yaw is -atan2(dz, dx). Getting it
    // wrong reflects the ribbon about its midpoint and is invisible on any
    // axis-aligned segment -- see status.md, Module 5.
    mesh.rotation.y = -Math.atan2(dz, dx);
    group.add(mesh);
  }

  function forEachSegment(
    map: GeneratedMap,
    visit: (segmentId: string, a: { x: number; z: number }, b: { x: number; z: number }) => void,
  ): void {
    const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
    const { width, height } = map.terrain;
    for (const segment of map.segments) {
      const from = nodeById.get(segment.fromNodeId);
      const to = nodeById.get(segment.toNodeId);
      if (!from || !to) continue;
      visit(segment.id, gridToWorld(from.x, from.y, width, height), gridToWorld(to.x, to.y, width, height));
    }
  }

  function renderDemand(context: OverlayContext): void {
    const { width, height } = context.map.terrain;
    for (const node of context.map.nodes) {
      const queue = context.queues.get(node.id);
      if (!queue) continue;
      const waiting = [...queue.values()].reduce((total, amount) => total + amount, 0);
      if (waiting <= 0.05) continue;
      const barHeight = Math.min(4, waiting * 0.12);
      const position = gridToWorld(node.x, node.y, width, height);
      const geometry = new THREE.BoxGeometry(0.28, barHeight, 0.28);
      const material = new THREE.MeshBasicMaterial({ color: 0x44d6e0, transparent: true, opacity: 0.8 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(position.x, barHeight / 2 + 0.3, position.z);
      group.add(mesh);
    }
  }

  function renderFlows(context: OverlayContext): void {
    // What is actually moving right now, attributed to the edge each
    // vehicle currently occupies -- not cumulative traffic, which would
    // answer a different (and already-answered) question.
    const bySegment = new Map<string, Map<CargoKind, number>>();
    for (const vehicle of context.vehicles) {
      const pathLength = vehicle.path.length;
      if (pathLength < 2) continue;
      const fromIndex = (vehicle.pathIndex - 1 + pathLength) % pathLength;
      const edge = context.routing.graph
        .get(vehicle.path[fromIndex]!)
        ?.find((candidate) => candidate.to === vehicle.path[vehicle.pathIndex]);
      if (!edge) continue;
      const kinds = bySegment.get(edge.segmentId) ?? new Map<CargoKind, number>();
      for (const entry of vehicle.cargo) {
        kinds.set(entry.kind, (kinds.get(entry.kind) ?? 0) + entry.amount);
      }
      bySegment.set(edge.segmentId, kinds);
    }

    forEachSegment(context.map, (segmentId, a, b) => {
      const kinds = bySegment.get(segmentId);
      if (!kinds || kinds.size === 0) return;
      let dominant: CargoKind = "passengers";
      let best = -1;
      let total = 0;
      for (const [kind, amount] of kinds) {
        total += amount;
        if (amount > best) {
          best = amount;
          dominant = kind;
        }
      }
      if (total <= 0) return;
      addRibbon(a, b, new THREE.Color(CARGO_COLORS[dominant]), Math.min(0.6, 0.12 + total * 0.01), OVERLAY_Y);
    });
  }

  function renderCoverage(context: OverlayContext): void {
    const { width, height } = context.map.terrain;
    for (const node of context.map.nodes) {
      if (node.kind !== "settlement" && node.kind !== "village") continue;
      const growth = context.growth.get(node.id);
      const served = growth ? Math.min(1, growth.playerServiceEMA * 5) : 0;
      const position = gridToWorld(node.x, node.y, width, height);
      const geometry = new THREE.CircleGeometry(node.kind === "settlement" ? 1.1 : 0.8, 20);
      const material = new THREE.MeshBasicMaterial({
        color: healthColor(served),
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(position.x, 0.06, position.z);
      group.add(mesh);

      // Stranded is reachability-based (docs/rebuild-plan.md §5), so it is
      // its own mark rather than "the reddest end of the served ramp": a
      // node can be well-connected and still reach nothing it needs.
      if (context.stranded.has(node.id)) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1.2, 1.4, 24),
          new THREE.MeshBasicMaterial({ color: 0xff4444, side: THREE.DoubleSide }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(position.x, 0.07, position.z);
        group.add(ring);
      }
    }
  }

  function renderStress(context: OverlayContext): void {
    // Read, never recomputed. The overlay used to call computeSegmentLoads
    // itself, which was harmless while vehicles were the only thing on the
    // road -- but ambient private traffic is added in simulate.ts, so a
    // recomputing overlay would now draw a *different, emptier* road than
    // the one actually slowing the player's buses down.
    forEachSegment(context.map, (segmentId, a, b) => {
      const load = context.segmentLoads.get(segmentId) ?? 0;
      // congestionFactor is the same function the simulation moves
      // vehicles with -- the overlay must never compute its own idea of
      // stress, or the picture and the model drift apart.
      const factor = congestionFactor(load);
      // Only *stressed* links get a mark. The old guard was "any load at
      // all", which was fine while vehicles were the only thing on the
      // road -- but ambient private traffic puts a non-zero load on every
      // road in every motorised era, so that guard would ribbon the entire
      // network and "colouring every corridor destroys the signal"
      // (docs/rebuild-plan.md §5). A free-flowing link is not an answer to
      // "which link is the bottleneck?"
      if (load <= FREE_SLOT_WEIGHT) return;
      addRibbon(a, b, healthColor(factor), 0.14 + (1 - factor) * 0.4, OVERLAY_Y);
    });
  }

  function renderCondition(context: OverlayContext): void {
    const conditionById = new Map(context.map.segments.map((segment) => [segment.id, segment.condition]));
    forEachSegment(context.map, (segmentId, a, b) => {
      const condition = conditionById.get(segmentId) ?? 1;
      // Rescaled across the range condition can actually occupy: decay
      // floors at MIN_CONDITION, so mapping 0..1 would leave the worst
      // possible segment reading as two-thirds healthy.
      const normalised = (condition - MIN_CONDITION) / (1 - MIN_CONDITION);
      addRibbon(a, b, healthColor(normalised), 0.2, OVERLAY_Y);
    });
  }

  function buildabilityCanvasTexture(map: GeneratedMap): THREE.CanvasTexture {
    const { width, height, water } = map.terrain;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const image = ctx.createImageData(width, height);

    // Priced through pathing/cost.ts's stepCost, never a lookalike of it
    // (architecture.md hard rule 3). What the overlay shows and what the
    // player is charged are the same function; a second "roughly what it
    // costs" formula here is the exact drift that rule exists to stop.
    const costs = new Float32Array(width * height);
    let max = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (water[index] === 1) continue;
        let total = 0;
        let samples = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbour = ny * width + nx;
          if (water[neighbour] === 1) continue;
          const step = stepCost(map.terrain, neighbour, index, 1);
          total += step.base + step.gradient + step.density;
          samples += 1;
        }
        const cost = samples > 0 ? total / samples : 0;
        costs[index] = cost;
        if (cost > max) max = cost;
      }
    }

    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      if (water[index] === 1) {
        image.data[offset] = 20;
        image.data[offset + 1] = 40;
        image.data[offset + 2] = 90;
        image.data[offset + 3] = 200;
        continue;
      }
      const cheapness = max > 0 ? 1 - costs[index]! / max : 1;
      const color = healthColor(cheapness);
      image.data[offset] = Math.round(color.r * 255);
      image.data[offset + 1] = Math.round(color.g * 255);
      image.data[offset + 2] = Math.round(color.b * 255);
      image.data[offset + 3] = 150;
    }

    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    return texture;
  }

  function renderBuildability(context: OverlayContext): void {
    if (!buildabilityTexture || buildabilityForMap !== context.map) {
      buildabilityTexture?.dispose();
      buildabilityTexture = buildabilityCanvasTexture(context.map);
      buildabilityForMap = context.map;
    }
    const geometry = new THREE.PlaneGeometry(context.map.terrain.width, context.map.terrain.height);
    const material = new THREE.MeshBasicMaterial({ map: buildabilityTexture, transparent: true, opacity: 0.75 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.04;
    group.add(mesh);
  }

  function rebuild(context: OverlayContext): void {
    clear();
    switch (overlay) {
      case "none":
        return;
      case "demand":
        return renderDemand(context);
      case "flows":
        return renderFlows(context);
      case "coverage":
        return renderCoverage(context);
      case "stress":
        return renderStress(context);
      case "condition":
        return renderCondition(context);
      case "buildability":
        return renderBuildability(context);
    }
  }

  function update(context: OverlayContext, dt: number): void {
    sinceRefresh += dt;
    if (sinceRefresh < REFRESH_SECONDS) return;
    sinceRefresh = 0;
    rebuild(context);
  }

  return { group, setOverlay, update };
}
