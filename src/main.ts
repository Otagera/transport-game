import { Accumulator, SIM_DT } from "@engine/loop";
import { createWorld, tickWorld } from "@engine/world";
import { loadContent } from "@content/loader";
import { EraListSchema } from "@content/schema";
import { generateMap } from "@engine/map/generate";
import { createScene } from "@render/scene";
import { createDefaultStyleSpec } from "@render/style";
import { createNetworkGroup } from "@render/network";
import { createAuthoringController } from "@render/authoring";
import { createStatusBar } from "@ui/statusBar";

const DEFAULT_MAP_SEED = 1;

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#scene");
  const statusEl = document.querySelector<HTMLDivElement>("#status");
  const costPanelEl = document.querySelector<HTMLDivElement>("#cost-panel");
  if (!canvas || !statusEl || !costPanelEl) {
    throw new Error("Missing #scene canvas, #status, or #cost-panel element in index.html");
  }

  const eras = await loadContent(EraListSchema, "/content/eras.json");
  const currentEraName = eras[0]?.name ?? "unknown";

  const style = createDefaultStyleSpec();
  const sceneHandle = createScene(canvas, style);
  const world = createWorld();
  const accumulator = new Accumulator(SIM_DT);
  const statusBar = createStatusBar(statusEl);

  const map = generateMap(DEFAULT_MAP_SEED);
  const groundMesh = sceneHandle.setTerrain(map);
  const networkHandle = createNetworkGroup(map);
  sceneHandle.scene.add(networkHandle.group);
  createAuthoringController(sceneHandle, groundMesh, map, networkHandle, costPanelEl);

  window.addEventListener("resize", sceneHandle.resize);

  await maybeMountDevTools(canvas, style, sceneHandle);

  let last = performance.now();
  let framesSinceSample = 0;
  let timeSinceSample = 0;
  let fps = 0;

  function frame(now: number): void {
    const elapsed = (now - last) / 1000;
    last = now;

    accumulator.advance(elapsed, (dt) => tickWorld(world, dt));

    framesSinceSample += 1;
    timeSinceSample += elapsed;
    if (timeSinceSample >= 0.5) {
      fps = Math.round(framesSinceSample / timeSinceSample);
      framesSinceSample = 0;
      timeSinceSample = 0;
    }

    statusBar.render({ tick: world.tickCount, fps, era: currentEraName });

    sceneHandle.render();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

// Kept out of bootstrap() as its own function so the `import.meta.env.DEV`
// guard is a single, easy-to-verify branch: in a production build this
// evaluates to `false` at build time, and Rollup dead-code-eliminates the
// whole body -- the dynamic imports of @dev/* (and Preact) included.
async function maybeMountDevTools(
  canvas: HTMLCanvasElement,
  style: ReturnType<typeof createDefaultStyleSpec>,
  sceneHandle: ReturnType<typeof createScene>,
): Promise<void> {
  if (!import.meta.env.DEV) {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("tune") !== "1") {
    return;
  }

  const [{ mountTuningPanel }, { installGreyscaleTest }] = await Promise.all([
    import("@dev/tuningPanel"),
    import("@dev/greyscaleTest"),
  ]);

  const panelContainer = document.createElement("div");
  document.body.appendChild(panelContainer);
  mountTuningPanel(panelContainer, style, (regen) => {
    if (regen) {
      sceneHandle.regenerateGeometry(style);
    } else {
      sceneHandle.applyStyle(style);
    }
  });
  installGreyscaleTest(canvas);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
});
