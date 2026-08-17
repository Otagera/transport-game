import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { StyleSpec } from "./style";
import type { GeneratedMap } from "../engine/map/types";
import { createTerrainTexture } from "./terrain";

export interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  resize: () => void;
  render: () => void;
  /** Live update: colors, intensities. Cheap, no geometry rebuild. */
  applyStyle: (style: StyleSpec) => void;
  /** Rebuild: base slab and placeholder geometry/count changed. */
  regenerateGeometry: (style: StyleSpec) => void;
  /**
   * Replaces the placeholder diorama slab with a real terrain-textured
   * ground plane sized to the map, and frames the camera to it. Returns
   * the ground mesh for raycasting (Module 4 authoring).
   */
  setTerrain: (map: GeneratedMap) => THREE.Mesh;
}

function keyLightPosition(style: StyleSpec, distance: number): THREE.Vector3 {
  const elevation = THREE.MathUtils.degToRad(style.lighting.key.elevationDeg);
  const azimuth = THREE.MathUtils.degToRad(style.lighting.key.azimuthDeg);
  return new THREE.Vector3(
    distance * Math.cos(elevation) * Math.cos(azimuth),
    distance * Math.sin(elevation),
    distance * Math.cos(elevation) * Math.sin(azimuth),
  );
}

function cameraPosition(elevationDeg: number, azimuthDeg: number, distance: number): THREE.Vector3 {
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  return new THREE.Vector3(
    distance * Math.cos(elevation) * Math.cos(azimuth),
    distance * Math.sin(elevation),
    distance * Math.cos(elevation) * Math.sin(azimuth),
  );
}

function placeholderLayout(count: number): Array<{ x: number; z: number; height: number }> {
  const layout: Array<{ x: number; z: number; height: number }> = [];
  const spacing = 2.2;
  for (let i = 0; i < count; i += 1) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    layout.push({
      x: (col - 1) * spacing,
      z: row * spacing - (Math.floor((count - 1) / 3) * spacing) / 2,
      height: 0.8 + ((i * 37) % 100) / 100,
    });
  }
  return layout;
}

export function createScene(canvas: HTMLCanvasElement, style: StyleSpec): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(style.background.color);

  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(
    (-style.camera.viewSize * aspect) / 2,
    (style.camera.viewSize * aspect) / 2,
    style.camera.viewSize / 2,
    -style.camera.viewSize / 2,
    0.1,
    500,
  );
  camera.position.copy(cameraPosition(style.camera.elevationDeg, style.camera.azimuthDeg, 40));
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.zoomToCursor = true;
  controls.minZoom = 0.4;
  controls.maxZoom = 4;
  controls.minPolarAngle = THREE.MathUtils.degToRad(15);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
  controls.target.set(0, 0, 0);
  controls.update();

  const ambientLight = new THREE.AmbientLight(style.lighting.ambient.color, style.lighting.ambient.intensity);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(style.lighting.key.color, style.lighting.key.intensity);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 100;
  keyLight.shadow.camera.left = -style.base.size;
  keyLight.shadow.camera.right = style.base.size;
  keyLight.shadow.camera.top = style.base.size;
  keyLight.shadow.camera.bottom = -style.base.size;
  keyLight.shadow.bias = -0.0015;
  scene.add(keyLight);
  scene.add(keyLight.target);

  const fillLight = new THREE.DirectionalLight(style.lighting.fill.color, style.lighting.fill.intensity);
  fillLight.position.set(-10, 8, -10);
  scene.add(fillLight);

  let baseMesh: THREE.Mesh | null = null;
  const placeholders: THREE.Mesh[] = [];
  const placeholderGroup = new THREE.Group();
  scene.add(placeholderGroup);

  function disposeMesh(mesh: THREE.Mesh): void {
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((m) => m.dispose());
    } else {
      mesh.material.dispose();
    }
  }

  function regenerateGeometry(current: StyleSpec): void {
    if (baseMesh) {
      scene.remove(baseMesh);
      disposeMesh(baseMesh);
    }

    const baseGeometry = new THREE.BoxGeometry(current.base.size, current.base.thickness, current.base.size);
    const baseMaterial = new THREE.MeshStandardMaterial({ color: current.base.color, roughness: 0.9 });
    baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
    baseMesh.position.y = -current.base.thickness / 2;
    baseMesh.receiveShadow = true;
    scene.add(baseMesh);

    for (const placeholder of placeholders) {
      placeholderGroup.remove(placeholder);
      disposeMesh(placeholder);
    }
    placeholders.length = 0;

    const placeholderMaterial = new THREE.MeshStandardMaterial({ color: current.placeholder.color, roughness: 0.7 });
    for (const spot of placeholderLayout(current.placeholder.count)) {
      const geometry = new THREE.BoxGeometry(0.9, spot.height, 0.9);
      const mesh = new THREE.Mesh(geometry, placeholderMaterial);
      mesh.position.set(spot.x, spot.height / 2, spot.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      placeholderGroup.add(mesh);
      placeholders.push(mesh);
    }

    keyLight.shadow.camera.left = -current.base.size;
    keyLight.shadow.camera.right = current.base.size;
    keyLight.shadow.camera.top = current.base.size;
    keyLight.shadow.camera.bottom = -current.base.size;
    keyLight.shadow.camera.updateProjectionMatrix();
  }

  function applyStyle(current: StyleSpec): void {
    (scene.background as THREE.Color).set(current.background.color);

    ambientLight.color.set(current.lighting.ambient.color);
    ambientLight.intensity = current.lighting.ambient.intensity;

    keyLight.color.set(current.lighting.key.color);
    keyLight.intensity = current.lighting.key.intensity;
    keyLight.position.copy(keyLightPosition(current, 30));

    fillLight.color.set(current.lighting.fill.color);
    fillLight.intensity = current.lighting.fill.intensity;

    if (baseMesh) {
      (baseMesh.material as THREE.MeshStandardMaterial).color.set(current.base.color);
    }
    for (const placeholder of placeholders) {
      (placeholder.material as THREE.MeshStandardMaterial).color.set(current.placeholder.color);
    }
  }

  let baseHalfHeight = style.camera.viewSize / 2;

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    const currentAspect = width / height;
    camera.left = -baseHalfHeight * currentAspect;
    camera.right = baseHalfHeight * currentAspect;
    camera.updateProjectionMatrix();
  }

  function render(): void {
    controls.update();
    renderer.render(scene, camera);
  }

  function setTerrain(map: GeneratedMap): THREE.Mesh {
    if (baseMesh) {
      scene.remove(baseMesh);
      disposeMesh(baseMesh);
    }
    for (const placeholder of placeholders) {
      placeholderGroup.remove(placeholder);
      disposeMesh(placeholder);
    }
    placeholders.length = 0;

    const texture = createTerrainTexture(map);
    const geometry = new THREE.PlaneGeometry(map.terrain.width, map.terrain.height);
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    scene.add(mesh);
    baseMesh = mesh;

    const halfSize = Math.max(map.terrain.width, map.terrain.height) / 2;
    keyLight.shadow.camera.left = -halfSize;
    keyLight.shadow.camera.right = halfSize;
    keyLight.shadow.camera.top = halfSize;
    keyLight.shadow.camera.bottom = -halfSize;
    keyLight.shadow.camera.updateProjectionMatrix();

    baseHalfHeight = halfSize * 0.8;
    camera.position.copy(cameraPosition(style.camera.elevationDeg, style.camera.azimuthDeg, halfSize * 3));
    controls.target.set(0, 0, 0);
    controls.minZoom = 0.3;
    controls.maxZoom = 8;
    controls.update();
    resize();

    return mesh;
  }

  regenerateGeometry(style);
  resize();

  return { renderer, scene, camera, controls, resize, render, applyStyle, regenerateGeometry, setTerrain };
}
