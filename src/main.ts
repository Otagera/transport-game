import { Accumulator, SIM_DT } from "@engine/loop";
import { loadContent } from "@content/loader";
import { EraListSchema, VehicleDefListSchema } from "@content/schema";
import type { Era, VehicleDef } from "@content/schema";
import { generateMap } from "@engine/map/generate";
import { pruneCorridor } from "@engine/map/prune";
import { restoreSegmentCondition } from "@engine/map/decay";
import { maintenanceCost } from "@engine/pathing/cost";
import { createSimulation, tick } from "@engine/simulation/simulate";
import { computeStranded } from "@engine/simulation/reachability";
import { createParatransitState } from "@engine/paratransit/types";
import { createEconomyState, sellVehicle } from "@engine/economy/state";
import { computeBurnRate, computeRoutePnL } from "@engine/economy/report";
import { advanceEraTimeline, createEraTimeline, currentEra, type EraTransition } from "@engine/eras/timeline";
import type { EraDef } from "@engine/eras/types";
import { createGrowthState } from "@engine/growth/state";
import type { PromotionEvent } from "@engine/growth/types";
import { createScene } from "@render/scene";
import { createCameraController } from "@render/camera";
import { createDefaultStyleSpec } from "@render/style";
import { createNetworkGroup } from "@render/network";
import { createOverlayLayer } from "@render/overlayLayer";
import { createVehicleFleetRenderer } from "@render/vehicles";
import { createAuthoringController, type InteractionMode } from "@render/authoring";
import { createFleetController } from "@render/fleet";
import { pickAt, selectionGridPosition } from "@render/picking";
import { gridToWorld, worldToGrid } from "@render/gridCoords";
import { createStatusBar } from "@ui/statusBar";
import { createPnLPanel } from "@ui/pnlPanel";
import { createEraBanner } from "@ui/eraBanner";
import { createInspector } from "@ui/inspector";
import { createOverlayController } from "@ui/overlays";
import { createSelectionStore } from "@ui/selection";
import * as THREE from "three";

const DEFAULT_MAP_SEED = 1;
const STARTING_FUNDS = 1000;
const FARE_TABLE = { passengers: 5, produce: 3, supplies: 2 };
// Reachability is an all-pairs A* sweep; it answers a question that
// changes only when the graph does, so it is refreshed on a slow timer
// rather than per frame.
const STRANDED_REFRESH_SECONDS = 2;

function toEraDef(era: Era): EraDef {
  return { id: era.id, order: era.order, durationSeconds: era.durationSeconds, modifiers: era.modifiers, railAvailable: era.railAvailable };
}

function requireElement(id: string): HTMLDivElement {
  const el = document.querySelector<HTMLDivElement>(`#${id}`);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
}

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#scene");
  if (!canvas) throw new Error("Missing #scene in index.html");
  const statusEl = requireElement("status");
  const costPanelEl = requireElement("cost-panel");
  const fleetHintEl = requireElement("fleet-hint");
  const pnlPanelEl = requireElement("pnl-panel");
  const eraBannerEl = requireElement("era-banner");
  const inspectorEl = requireElement("inspector");
  const overlayPickerEl = requireElement("overlay-picker");
  const modeHintEl = requireElement("mode-hint");

  const [eras, vehicleCatalog] = await Promise.all([
    loadContent(EraListSchema, "/content/eras.json"),
    loadContent(VehicleDefListSchema, "/content/vehicles.json"),
  ]);
  const eraContentById = new Map(eras.map((era) => [era.id, era]));
  const eraTimeline = createEraTimeline(eras.map(toEraDef));
  const currentEraContent = (): Era => eraContentById.get(currentEra(eraTimeline).id)!;

  const style = createDefaultStyleSpec();
  const sceneHandle = createScene(canvas, style);
  const cameraController = createCameraController(sceneHandle.camera, sceneHandle.controls);
  const accumulator = new Accumulator(SIM_DT);
  const statusBar = createStatusBar(statusEl);

  const map = generateMap(DEFAULT_MAP_SEED);
  const groundMesh = sceneHandle.setTerrain(map);
  const networkHandle = createNetworkGroup(map);
  sceneHandle.scene.add(networkHandle.group);
  const overlayLayer = createOverlayLayer();
  sceneHandle.scene.add(overlayLayer.group);

  const simulation = createSimulation(map, []);
  const economy = createEconomyState(FARE_TABLE, STARTING_FUNDS);
  const paratransit = createParatransitState();
  const growth = createGrowthState(map);

  const fleetRenderer = createVehicleFleetRenderer();
  sceneHandle.scene.add(fleetRenderer.group);

  // The one piece of state four homes have to agree on
  // (docs/module-11-studio-and-ia.md §1).
  const selection = createSelectionStore();
  const eraBanner = createEraBanner(eraBannerEl, (subject) => selection.select(subject));
  const pnlPanel = createPnLPanel(pnlPanelEl, (vehicleId) => selection.select({ kind: "vehicle", id: vehicleId }));

  const fleetController = createFleetController(
    simulation,
    economy,
    vehicleCatalog,
    () => {},
    fleetHintEl,
    eras,
    () => currentEra(eraTimeline).id,
  );

  // Build and inspect compete for the click and most of the keyboard, so
  // they are explicit modes rather than modifier conventions. Tab toggles;
  // the mode is always on screen, since a mode you can't see is a mode
  // that eats your input.
  let interactionMode: InteractionMode = "build";

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
    () => interactionMode,
  );

  let stranded: ReadonlySet<string> = new Set<string>();
  let sinceStrandedRefresh = Infinity;

  const inspector = createInspector(
    inspectorEl,
    selection,
    {
      simulation: () => simulation,
      economy: () => economy,
      growth: () => growth,
      catalog: () => vehicleCatalog,
      stranded: () => stranded,
    },
    {
      sellVehicle(vehicleId: string): void {
        const index = simulation.vehicles.findIndex((vehicle) => vehicle.id === vehicleId);
        if (index === -1) return;
        simulation.vehicles.splice(index, 1);
        sellVehicle(economy, vehicleId);
        selection.clear();
      },
      pruneCorridor(corridorId: string): void {
        // Routed through the authoring controller rather than applied
        // directly, so the prune lands on the same snapshot undo stack a
        // build does.
        authoringController.applyMapChange(pruneCorridor(authoringController.getMap(), corridorId));
        selection.clear();
      },
      maintainSegment(segmentId: string): void {
        const current = authoringController.getMap();
        const segment = current.segments.find((candidate) => candidate.id === segmentId);
        if (!segment) return;
        const from = current.nodes.find((node) => node.id === segment.fromNodeId);
        const to = current.nodes.find((node) => node.id === segment.toNodeId);
        const span = from && to ? Math.hypot(from.x - to.x, from.y - to.y) : 0;
        // Restore first, price the deficit that was actually bought back
        // -- never price a repair that didn't happen.
        const deficit = restoreSegmentCondition(current, segmentId);
        economy.funds -= maintenanceCost(span, deficit);
      },
    },
  );

  const overlayController = createOverlayController(overlayPickerEl, (id) => overlayLayer.setOverlay(id));

  // Select-and-focus: every route into the Inspector -- list row, moment,
  // map click, inspector link -- flies the camera, so selection always
  // means "and here it is."
  selection.subscribe((next) => {
    if (!next) return;
    const grid = selectionGridPosition(next, authoringController.getMap(), simulation.vehicles);
    if (!grid) return;
    const { width, height } = authoringController.getMap().terrain;
    cameraController.focusOn(gridToWorld(grid.x, grid.y, width, height));
  });

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
  // rebuild-plan.md §6 Module 9): tick() already mutated the promoted
  // node's kind in place on `simulation.map`, so re-running the network
  // renderer from that same map is what turns it into a marker/color
  // change -- no separate "apply promotion visually" step needed. The
  // moment now carries the promoted node as its subject, so the
  // notification is a route into the Inspector rather than a dead end.
  function handlePromotions(promotions: PromotionEvent[]): void {
    networkHandle.update(simulation.map);
    const [first] = promotions;
    if (!first) return;
    const message =
      promotions.length === 1
        ? `${first.nodeId} grew into a settlement!`
        : `${promotions.length} villages grew into settlements!`;
    eraBanner.show(message, { kind: "node", id: first.nodeId });
  }

  function setInteractionMode(next: InteractionMode): void {
    if (next === interactionMode) return;
    interactionMode = next;
    if (next === "inspect") authoringController.cancelDraw();
    renderModeHint();
  }

  function renderModeHint(): void {
    modeHintEl.textContent =
      interactionMode === "build"
        ? "BUILD · Tab to inspect · O overlay"
        : "INSPECT · click an entity · Tab to build · O overlay · Esc deselect";
  }
  renderModeHint();

  let pnlVisible = false;
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === "p") {
      pnlVisible = !pnlVisible;
    } else if (event.key === "Tab") {
      event.preventDefault();
      setInteractionMode(interactionMode === "build" ? "inspect" : "build");
    } else if (key === "o") {
      overlayController.cycle();
    } else if (event.key === "Escape" && interactionMode === "inspect") {
      selection.clear();
    }
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  canvas.addEventListener("click", (event) => {
    if (interactionMode !== "inspect") return;
    const rect = sceneHandle.renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, sceneHandle.camera);
    const hits = raycaster.intersectObject(groundMesh, false);
    if (hits.length === 0) return;
    const currentMap = authoringController.getMap();
    const grid = worldToGrid(hits[0]!.point.x, hits[0]!.point.z, currentMap.terrain.width, currentMap.terrain.height);
    selection.select(pickAt(grid, currentMap, simulation.vehicles));
  });

  window.addEventListener("resize", sceneHandle.resize);

  await maybeMountDevTools(canvas, style, sceneHandle, eras, vehicleCatalog);

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

    sinceStrandedRefresh += elapsed;
    if (sinceStrandedRefresh >= STRANDED_REFRESH_SECONDS) {
      sinceStrandedRefresh = 0;
      stranded = computeStranded(simulation.demand, simulation.routing);
    }

    const burnRate = computeBurnRate(economy);
    statusBar.render({
      era: currentEraContent().name,
      funds: economy.funds,
      incomePerDay: burnRate.incomePerDay,
      costPerDay: burnRate.costPerDay,
      netPerDay: burnRate.netPerDay,
      paratransitCount: simulation.vehicles.filter((v) => v.lifecycle === "one-shot").length,
      diagnostics: import.meta.env.DEV ? { tick: Math.round(economy.elapsedSeconds / SIM_DT), fps } : undefined,
    });

    const active = selection.get();
    pnlPanel.render(pnlVisible, computeRoutePnL(economy), active?.kind === "vehicle" ? active.id : null);
    inspector.render();

    const overlayActive = overlayController.getActive() !== "none";
    networkHandle.updateSignals({
      segmentTraffic: simulation.segmentTraffic,
      selection: active,
      dimmed: overlayActive,
    });
    overlayLayer.update(
      {
        map: authoringController.getMap(),
        vehicles: simulation.vehicles,
        queues: simulation.queues,
        routing: simulation.routing,
        growth,
        stranded,
      },
      elapsed,
    );

    cameraController.update(elapsed);
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
  eras: Era[],
  catalog: VehicleDef[],
): Promise<void> {
  if (!import.meta.env.DEV) {
    return;
  }
  // `?tune=1` is kept as an alias for `?studio=1` rather than retired:
  // Module 1's workflow (and the muscle memory around it) still opens the
  // same style controls, now as the studio's first tab.
  const params = new URLSearchParams(window.location.search);
  if (params.get("studio") !== "1" && params.get("tune") !== "1") {
    return;
  }

  const [{ mountStudio }, { installGreyscaleTest }] = await Promise.all([
    import("@dev/Studio"),
    import("@dev/greyscaleTest"),
  ]);

  const panelContainer = document.createElement("div");
  document.body.appendChild(panelContainer);
  mountStudio(panelContainer, {
    style,
    eras,
    catalog,
    onStyleChange: (regen: boolean) => {
      if (regen) {
        sceneHandle.regenerateGeometry(style);
      } else {
        sceneHandle.applyStyle(style);
      }
    },
  });
  installGreyscaleTest(canvas);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
});
