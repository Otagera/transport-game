import { useEffect, useRef } from "preact/hooks";
import * as THREE from "three";
import type { Profile2DDef } from "@content/schema";
import { buildSweptProfile } from "@render/studioProfile";

// The preview owns its own tiny three.js scene rather than borrowing the
// game's. Two reasons: the studio must be able to show a profile that is
// not built anywhere on the map yet, and a preview that mutated the live
// scene would make "did I break the game or the preview?" an unanswerable
// question every time something looked wrong.
//
// The demo alignment is deliberately an S-curve with an elevated run in
// the middle. A straight test piece hides exactly the failures that
// matter: cross-section fan-out at curvature, and the frame flipping
// through an inflection point.
const DEMO_CHAIN = [
  new THREE.Vector3(-14, 0, 6),
  new THREE.Vector3(-5, 0, -4),
  new THREE.Vector3(5, 0, 5),
  new THREE.Vector3(14, 0, -3),
];
const DEMO_ELEVATED = [{ from: new THREE.Vector3(-2, 2.2, 0.6), to: new THREE.Vector3(6, 2.2, 3.4) }];

export interface ProfilePreviewProps {
  profile: Profile2DDef | null;
  width: number;
  height: number;
}

export function ProfilePreview({ profile, width, height }: ProfilePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    swept: { group: THREE.Group; dispose: () => void } | null;
    frame: number;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(width, height, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15161a);
    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200);
    camera.position.set(0, 16, 26);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xfff4e0, 2.2);
    key.position.set(10, 18, 8);
    scene.add(key);

    const state = { renderer, scene, camera, swept: null as null | { group: THREE.Group; dispose: () => void }, frame: 0 };
    sceneRef.current = state;

    let rotation = 0;
    function tick(): void {
      rotation += 0.0035;
      camera.position.set(Math.sin(rotation) * 30, 16, Math.cos(rotation) * 30);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      state.frame = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelAnimationFrame(state.frame);
      state.swept?.dispose();
      renderer.dispose();
      sceneRef.current = null;
    };
  }, [width, height]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (state.swept) {
      state.scene.remove(state.swept.group);
      state.swept.dispose();
      state.swept = null;
    }
    if (!profile) return;
    const swept = buildSweptProfile(profile, DEMO_CHAIN, { elevatedSpans: DEMO_ELEVATED });
    state.scene.add(swept.group);
    state.swept = swept;
  }, [profile]);

  return <canvas ref={canvasRef} width={width} height={height} style={{ width: `${width}px`, height: `${height}px`, borderRadius: "3px" }} />;
}
