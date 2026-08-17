import { Accumulator, SIM_DT } from "@engine/loop";
import { loadContent } from "@content/loader";
import { EraListSchema, VehicleDefListSchema } from "@content/schema";
import { generateMap } from "@engine/map/generate";
import { createSimulation, tick } from "@engine/simulation/simulate";
import { createEconomyState } from "@engine/economy/state";
import { computeBurnRate, computeRoutePnL } from "@engine/economy/report";
import { createScene } from "@render/scene";
import { createDefaultStyleSpec } from "@render/style";
import { createNetworkGroup } from "@render/network";
import { createVehicleFleetRenderer } from "@render/vehicles";
import { createAuthoringController } from "@render/authoring";
import { createFleetController } from "@render/fleet";
import { createStatusBar } from "@ui/statusBar";
import { createPnLPanel } from "@ui/pnlPanel";

const DEFAULT_MAP_SEED = 1;
const STARTING_FUNDS = 1000;
const FARE_TABLE = { passengers: 5, produce: 3, supplies: 2 };

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#scene");
  const statusEl = document.querySelector<HTMLDivElement>("#status");
  const costPanelEl = document.querySelector<HTMLDivElement>("#cost-panel");
  const fleetHintEl = document.querySelector<HTMLDivElement>("#fleet-hint");
  const pnlPanelEl = document.querySelector<HTMLDivElement>("#pnl-panel");
  if (!canvas || !statusEl || !costPanelEl || !fleetHintEl || !pnlPanelEl) {
    throw new Error("Missing a required element in index.html");
  }

  const [eras, vehicleCatalog] = await Promise.all([
    loadContent(EraListSchema, "/content/eras.json"),
    loadContent(VehicleDefListSchema, "/content/vehicles.json"),
  ]);
  const currentEraName = eras[0]?.name ?? "unknown";

  const style = createDefaultStyleSpec();
  const sceneHandle = createScene(canvas, style);
  const accumulator = new Accumulator(SIM_DT);
  const statusBar = createStatusBar(statusEl);
  const pnlPanel = createPnLPanel(pnlPanelEl);

  const map = generateMap(DEFAULT_MAP_SEED);
  const groundMesh = sceneHandle.setTerrain(map);
  const networkHandle = createNetworkGroup(map);
  sceneHandle.scene.add(networkHandle.group);

  const simulation = createSimulation(map, []);
  const economy = createEconomyState(FARE_TABLE, STARTING_FUNDS);

  const fleetRenderer = createVehicleFleetRenderer();
  sceneHandle.scene.add(fleetRenderer.group);

  const fleetController = createFleetController(simulation, economy, vehicleCatalog, () => {}, fleetHintEl);

  createAuthoringController(
    sceneHandle,
    groundMesh,
    map,
    networkHandle,
    costPanelEl,
    (event) => fleetController.handleBuild(event),
    (changedMap) => fleetController.handleMapChanged(changedMap),
  );

  let pnlVisible = false;
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "p") {
      pnlVisible = !pnlVisible;
    }
  });

  window.addEventListener("resize", sceneHandle.resize);

  await maybeMountDevTools(canvas, style, sceneHandle);

  let last = performance.now();
  let framesSinceSample = 0;
  let timeSinceSample = 0;
  let fps = 0;

  function frame(now: number): void {
    const elapsed = (now - last) / 1000;
    last = now;

    accumulator.advance(elapsed, (dt) => tick(simulation, dt, economy));

    framesSinceSample += 1;
    timeSinceSample += elapsed;
    if (timeSinceSample >= 0.5) {
      fps = Math.round(framesSinceSample / timeSinceSample);
      framesSinceSample = 0;
      timeSinceSample = 0;
    }

    const burnRate = computeBurnRate(economy);
    statusBar.render({
      tick: Math.round(economy.elapsedSeconds / SIM_DT),
      fps,
      era: currentEraName,
      funds: economy.funds,
      incomePerDay: burnRate.incomePerDay,
      costPerDay: burnRate.costPerDay,
      netPerDay: burnRate.netPerDay,
    });
    pnlPanel.render(pnlVisible, computeRoutePnL(economy));

    fleetRenderer.update(simulation.vehicles, simulation.map);
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
