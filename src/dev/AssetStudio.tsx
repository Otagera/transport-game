import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Era, VehicleAnchors, VehicleDef } from "@content/schema";
import { VehicleDefSchema } from "@content/schema";
import { bytesToBase64, meshTooLargeMessage } from "./encodeMesh";
import { button, downloadBlob, errorNote, note, row, sectionTitle, tabBody } from "./studioChrome";

// Drag a .glb in, click the mesh to drop anchors, fill in the def, export
// a mod package.
//
// Anchors are placed by clicking the model, not by typing coordinates.
// That is the whole point: a boarding door typed as [0.8, 0.4, -1.2] is
// unverifiable until something is standing in the wrong place at runtime,
// whereas a click lands on the surface you can see. Same reasoning as
// render/picking.ts using the geometry the player actually sees rather
// than a parallel model of it.
const VIEWPORT_WIDTH = 350;
const VIEWPORT_HEIGHT = 240;

type AnchorKind = keyof VehicleAnchors;

const ANCHOR_KINDS: Array<{ id: AnchorKind; label: string; color: number; hint: string }> = [
  { id: "axlePositions", label: "Axles", color: 0xff5555, hint: "wheel placement and turning radius" },
  { id: "boardingDoors", label: "Doors", color: 0x55ff88, hint: "where passengers board and alight" },
  { id: "cargoNodes", label: "Cargo", color: 0x66aaff, hint: "where goods stack visually" },
  { id: "particleEmitters", label: "Exhaust", color: 0xffcc44, hint: "exhaust and dust origins" },
];

function emptyAnchors(): VehicleAnchors {
  return { axlePositions: [], boardingDoors: [], cargoNodes: [], particleEmitters: [] };
}

export interface AssetStudioProps {
  eras: Era[];
}

interface Viewport {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  modelGroup: THREE.Group;
  gizmoGroup: THREE.Group;
  frame: number;
}

export function AssetStudio({ eras }: AssetStudioProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const [meshName, setMeshName] = useState<string | null>(null);
  const [meshBase64, setMeshBase64] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [anchors, setAnchors] = useState<VehicleAnchors>(emptyAnchors);
  const [activeKind, setActiveKind] = useState<AnchorKind>("axlePositions");
  const [modId, setModId] = useState("my-mod");
  const [writeResult, setWriteResult] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    id: "custom-bus",
    name: "Custom bus",
    carries: "passengers" as VehicleDef["carries"],
    capacity: 30,
    speed: 3,
    purchaseCost: 700,
    operatingCostPerSecond: 1.4,
    runsOn: "petrol",
    eraIn: eras[0]?.id ?? "post-independence",
    eraOut: null as string | null,
    congestionWeight: 1.2,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15161a);
    const camera = new THREE.PerspectiveCamera(40, VIEWPORT_WIDTH / VIEWPORT_HEIGHT, 0.05, 100);
    camera.position.set(4, 3, 5);
    camera.lookAt(0, 0.5, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xfff4e0, 2.4);
    key.position.set(4, 8, 6);
    scene.add(key);
    scene.add(new THREE.GridHelper(6, 12, 0x445566, 0x2a2f36));

    const modelGroup = new THREE.Group();
    const gizmoGroup = new THREE.Group();
    scene.add(modelGroup, gizmoGroup);

    const state: Viewport = { renderer, scene, camera, modelGroup, gizmoGroup, frame: 0 };
    viewportRef.current = state;

    let rotation = 0.6;
    function tick(): void {
      rotation += 0.004;
      camera.position.set(Math.sin(rotation) * 6, 3.2, Math.cos(rotation) * 6);
      camera.lookAt(0, 0.5, 0);
      renderer.render(scene, camera);
      state.frame = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelAnimationFrame(state.frame);
      renderer.dispose();
      viewportRef.current = null;
    };
  }, []);

  // Gizmos are rebuilt from the anchor state rather than added as a side
  // effect of the click that created them -- so removing an anchor is
  // just removing it from state, with no chance of a stale marker
  // outliving the anchor it stood for.
  useEffect(() => {
    const state = viewportRef.current;
    if (!state) return;
    for (const child of [...state.gizmoGroup.children]) {
      state.gizmoGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    for (const kind of ANCHOR_KINDS) {
      for (const point of anchors[kind.id]) {
        const gizmo = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 10, 8),
          new THREE.MeshBasicMaterial({ color: kind.color }),
        );
        gizmo.position.set(point.x, point.y, point.z);
        state.gizmoGroup.add(gizmo);
      }
    }
  }, [anchors]);

  async function loadFile(file: File): Promise<void> {
    const state = viewportRef.current;
    if (!state) return;
    setLoadError(null);
    try {
      const buffer = await file.arrayBuffer();
      const tooLarge = meshTooLargeMessage(buffer.byteLength);
      if (tooLarge) {
        setLoadError(tooLarge);
        return;
      }
      const gltf = await new GLTFLoader().parseAsync(buffer, "");
      for (const child of [...state.modelGroup.children]) state.modelGroup.remove(child);
      state.modelGroup.add(gltf.scene);

      // Framed to a consistent size so anchors placed on a model authored
      // in centimetres and one authored in metres end up in the same
      // coordinate space. Without this an anchor's numbers would mean
      // something different per source file.
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const scale = 2.5 / Math.max(size.x, size.y, size.z, 0.001);
      gltf.scene.scale.setScalar(scale);
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
      gltf.scene.position.set(-center.x, -box.min.y * scale, -center.z);

      // Encoded BEFORE any state is set, so the two always move together.
      // Setting the name first and letting the encode throw is what made
      // the original failure so much worse than a crash: the panel said
      // "Loaded <file>" while no bytes had been captured, and the mod
      // package then wrote a vehicle.json whose `mesh` named a file that
      // was never uploaded alongside it.
      const encoded = bytesToBase64(new Uint8Array(buffer));
      setMeshName(file.name);
      setMeshBase64(encoded);
      setAnchors(emptyAnchors());
    } catch (error) {
      setLoadError(String(error));
    }
  }

  function handleViewportClick(event: MouseEvent): void {
    const state = viewportRef.current;
    if (!state || state.modelGroup.children.length === 0) return;
    const rect = (event.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      state.camera,
    );
    const hit = raycaster.intersectObject(state.modelGroup, true)[0];
    if (!hit) return;
    const point = {
      x: Number(hit.point.x.toFixed(3)),
      y: Number(hit.point.y.toFixed(3)),
      z: Number(hit.point.z.toFixed(3)),
    };
    setAnchors((current) => ({ ...current, [activeKind]: [...current[activeKind], point] }));
  }

  // `mesh` is claimed only when both the name and its bytes are held: a
  // def naming a mesh the package does not contain is a dangling
  // reference, and a silently broken mod is worse than an obviously
  // meshless one.
  const hasMesh = meshName !== null && meshBase64 !== null;
  const parsed = VehicleDefSchema.safeParse({
    ...draft,
    ...(hasMesh ? { mesh: meshName } : {}),
    anchors,
  });
  const problems = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);

  async function writeModPackage(): Promise<void> {
    if (!parsed.success) return;
    setWriteResult(null);
    try {
      const response = await fetch("/__studio/write-mod", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          modId,
          vehicle: parsed.data,
          meshName: hasMesh ? meshName : null,
          meshBase64: hasMesh ? meshBase64 : null,
        }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text);
      setWriteResult(`Wrote ${JSON.parse(text).path}`);
    } catch (error) {
      // The dev-server endpoint is the happy path; the download is the
      // fallback so the tab still produces a usable artifact if it isn't
      // reachable (a `vite preview`, say).
      setWriteResult(`Dev-server write failed (${String(error)}). Downloading instead.`);
      downloadBlob("vehicle.json", new Blob([JSON.stringify(parsed.data, null, 2)], { type: "application/json" }));
    }
  }

  function patch(changes: Partial<typeof draft>): void {
    setDraft((current) => ({ ...current, ...changes }));
  }

  return (
    <div style={tabBody}>
      <div style={sectionTitle}>Model</div>
      <canvas
        ref={canvasRef}
        width={VIEWPORT_WIDTH}
        height={VIEWPORT_HEIGHT}
        style={{ width: `${VIEWPORT_WIDTH}px`, height: `${VIEWPORT_HEIGHT}px`, borderRadius: "3px", cursor: "crosshair" }}
        onClick={handleViewportClick}
        onDragOver={(event: DragEvent) => event.preventDefault()}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          const file = event.dataTransfer?.files?.[0];
          if (file) void loadFile(file);
        }}
      />
      <div style={note}>{meshName ? `Loaded ${meshName} — click the model to drop a ${activeKind} anchor.` : "Drag a .glb or .gltf onto the viewport."}</div>
      {loadError && <div style={errorNote}>{loadError}</div>}

      <div style={sectionTitle}>Anchors</div>
      <div style={{ display: "flex", gap: "4px" }}>
        {ANCHOR_KINDS.map((kind) => (
          <button
            key={kind.id}
            style={{
              ...button,
              marginTop: "0",
              borderColor: kind.id === activeKind ? "#ffe08a" : "#444",
              color: kind.id === activeKind ? "#ffe08a" : "#eee",
            }}
            onClick={() => setActiveKind(kind.id)}
          >
            {`${kind.label} (${anchors[kind.id].length})`}
          </button>
        ))}
      </div>
      <div style={note}>{ANCHOR_KINDS.find((kind) => kind.id === activeKind)!.hint}</div>
      {anchors[activeKind].map((point, index) => (
        <div key={`${activeKind}-${index}`} style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{`[${point.x}, ${point.y}, ${point.z}]`}</span>
          <span
            style={{ cursor: "pointer", opacity: 0.7 }}
            onClick={() =>
              setAnchors((current) => ({
                ...current,
                [activeKind]: current[activeKind].filter((_, i) => i !== index),
              }))
            }
          >
            remove
          </span>
        </div>
      ))}

      <div style={sectionTitle}>Vehicle definition</div>
      <label style={row}>
        <span>id</span>
        <input value={draft.id} onInput={(e) => patch({ id: (e.target as HTMLInputElement).value })} />
      </label>
      <label style={row}>
        <span>name</span>
        <input value={draft.name} onInput={(e) => patch({ name: (e.target as HTMLInputElement).value })} />
      </label>
      <label style={row}>
        <span>carries</span>
        <select value={draft.carries} onChange={(e) => patch({ carries: (e.target as HTMLSelectElement).value as VehicleDef["carries"] })}>
          <option value="passengers">passengers</option>
          <option value="goods">goods</option>
        </select>
      </label>
      {(
        [
          ["capacity", "capacity", 1],
          ["speed", "speed", 0.1],
          ["purchaseCost", "purchase cost", 5],
          ["operatingCostPerSecond", "operating cost / sec", 0.05],
          ["congestionWeight", "congestion weight", 0.1],
        ] as const
      ).map(([field, label, step]) => (
        <label key={field} style={row}>
          <span>{label}</span>
          <input
            type="number"
            step={String(step)}
            value={String(draft[field])}
            onInput={(e) => patch({ [field]: Number((e.target as HTMLInputElement).value) })}
          />
        </label>
      ))}
      <label style={row}>
        <span>runs on</span>
        <input value={draft.runsOn} onInput={(e) => patch({ runsOn: (e.target as HTMLInputElement).value })} list="runs-on-values" />
        <datalist id="runs-on-values">
          <option value="petrol" />
          <option value="diesel" />
          <option value="electric" />
        </datalist>
      </label>
      <div style={note}>
        `runsOn` is the propulsion/fuel channel the existing catalog uses (all "petrol" today), kept as free text so a
        future electric Modern-era bus needs no schema change. Road vs. rail is a property of the segment a vehicle
        routes over, not of the def.
      </div>
      <label style={row}>
        <span>era in</span>
        <select value={draft.eraIn} onChange={(e) => patch({ eraIn: (e.target as HTMLSelectElement).value })}>
          {eras.map((era) => (
            <option key={era.id} value={era.id}>
              {era.name}
            </option>
          ))}
        </select>
      </label>
      <label style={row}>
        <span>era out</span>
        <select
          value={draft.eraOut ?? ""}
          onChange={(e) => patch({ eraOut: (e.target as HTMLSelectElement).value || null })}
        >
          <option value="">never (still purchasable)</option>
          {eras.map((era) => (
            <option key={era.id} value={era.id}>
              {era.name}
            </option>
          ))}
        </select>
      </label>

      <div style={sectionTitle}>Package</div>
      <label style={row}>
        <span>mod id (directory under public/mods/)</span>
        <input value={modId} onInput={(e) => setModId((e.target as HTMLInputElement).value)} />
      </label>
      {problems.length > 0 && <div style={errorNote}>{problems.join("\n")}</div>}
      <button style={button} disabled={!parsed.success} onClick={() => void writeModPackage()}>
        Write mod package
      </button>
      {writeResult && <div style={note}>{writeResult}</div>}
    </div>
  );
}
