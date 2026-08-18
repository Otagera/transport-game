import { Accumulator, SIM_DT } from "@engine/loop";
import { loadContent } from "@content/loader";
import { EraListSchema, VehicleDefListSchema } from "@content/schema";
import type { Era } from "@content/schema";
import { generateMap } from "@engine/map/generate";
import { createSimulation, tick } from "@engine/simulation/simulate";
import { createParatransitState } from "@engine/paratransit/types";
import { createEconomyState } from "@engine/economy/state";
import { computeBurnRate, computeRoutePnL } from "@engine/economy/report";
import { advanceEraTimeline, createEraTimeline, currentEra, type EraTransition } from "@engine/eras/timeline";
import type { EraDef } from "@engine/eras/types";
import { createGrowthState } from "@engine/growth/state";
import type { PromotionEvent } from "@engine/growth/types";
import { createScene } from "@render/scene";
import { createDefaultStyleSpec } from "@render/style";
import { createNetworkGroup } from "@render/network";
import { createVehicleFleetRenderer } from "@render/vehicles";
import { createAuthoringController } from "@render/authoring";
import { createFleetController } from "@render/fleet";
import { createStatusBar } from "@ui/statusBar";
import { createPnLPanel } from "@ui/pnlPanel";
import { createEraBanner } from "@ui/eraBanner";

const DEFAULT_MAP_SEED = 1;
const STARTING_FUNDS = 1000;
const FARE_TABLE = { passengers: 5, produce: 3, supplies: 2 };

function toEraDef(era: Era): EraDef {
  return { id: era.id, order: era.order, durationSeconds: era.durationSeconds, modifiers: era.modifiers, railAvailable: era.railAvailable };
}

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#scene");
  const statusEl = document.querySelector<HTMLDivElement>("#status");
  const costPanelEl = document.querySelector<HTMLDivElement>("#cost-panel");
  const fleetHintEl = document.querySelector<HTMLDivElement>("#fleet-hint");
  const pnlPanelEl = document.querySelector<HTMLDivElement>("#pnl-panel");
  const eraBannerEl = document.querySelector<HTMLDivElement>("#era-banner");
  if (!canvas || !statusEl || !costPanelEl || !fleetHintEl || !pnlPanelEl || !eraBannerEl) {
    throw new Error("Missing a required element in index.html");
  }

  const [eras, vehicleCatalog] = await Promise.all([
    loadContent(EraListSchema, "/content/eras.json"),
    loadContent(VehicleDefListSchema, "/content/vehicles.json"),
  ]);
  const eraContentById = new Map(eras.map((era) => [era.id, era]));
  const eraTimeline = createEraTimeline(eras.map(toEraDef));
  const currentEraContent = (): Era => eraContentById.get(currentEra(eraTimeline).id)!;
  const eraBanner = createEraBanner(eraBannerEl);

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
  const paratransit = createParatransitState();
  const growth = createGrowthState(map);

  const fleetRenderer = createVehicleFleetRenderer();
  sceneHandle.scene.add(fleetRenderer.group);

  const fleetController = createFleetController(
    simulation,
    economy,
    vehicleCatalog,
    () => {},
    fleetHintEl,
    eras,
    () => currentEra(eraTimeline).id,
  );

  const authoringController = createAuthoringController(
    sceneHandle,
    groundMesh,
    map,
    networkHandle,
    costPanelEl,
    (event) => fleetController.handleBuild(event),
    (changedMap) => fleetController.handleMapChanged(changedMap),
    () => currentEraContent().modifiers.buildCost,
    () => currentEraContent().railAvailable,
  );

  // Cheap, high-leverage visual era identity (docs/rebuild-plan.md §5):
  // background + fill light tint from the era's palette. Applied once at
  // startup, then again on every transition.
  function applyEraPalette(era: Era): void {
    style.background.color = era.palette.primary;
    style.lighting.fill.color = era.palette.secondary;
    sceneHandle.applyStyle(style);
  }
  applyEraPalette(currentEraContent());

  function handleEraTransition(transition: EraTransition): void {
    const toContent = eraContentById.get(transition.to.id)!;
    applyEraPalette(toContent);
    fleetController.handleEraChanged();
    authoringController.reconcileEraGating();
    eraBanner.show(`Era: ${toContent.name}`);
  }

  // Growth must be visible on the map without reading a number (docs/
  // rebuild-plan.md §5 Module 9): tick() already mutated the promoted
  // node's kind in place on `simulation.map`, so re-running the network
  // renderer from that same map is what turns it into a marker/color
  // change -- no separate "apply promotion visually" step needed.
  function handlePromotions(promotions: PromotionEvent[]): void {
    networkHandle.update(simulation.map);
    const [first] = promotions;
    if (!first) return;
    const message =
      promotions.length === 1
        ? `${first.nodeId} grew into a settlement!`
        : `${promotions.length} villages grew into settlements!`;
    eraBanner.show(message);
  }

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

    accumulator.advance(elapsed, (dt) => {
      const promotions = tick(simulation, dt, economy, paratransit, currentEra(eraTimeline).modifiers, growth);
      if (promotions.length > 0) handlePromotions(promotions);

      const transition = advanceEraTimeline(eraTimeline, dt);
      if (transition) handleEraTransition(transition);
    });

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
      era: currentEraContent().name,
      funds: economy.funds,
      incomePerDay: burnRate.incomePerDay,
      costPerDay: burnRate.costPerDay,
      netPerDay: burnRate.netPerDay,
      paratransitCount: simulation.vehicles.filter((v) => v.lifecycle === "one-shot").length,
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
