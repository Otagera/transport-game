import { Accumulator, SIM_DT } from "@engine/loop";
import { loadContent } from "@content/loader";
import { EraListSchema, Profile2DDefListSchema, ScenarioListSchema, VehicleDefListSchema } from "@content/schema";
import type { Era, Scenario, VehicleDef } from "@content/schema";
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
import type { EraDef, EraModifiers } from "@engine/eras/types";
import { createGrowthState } from "@engine/growth/state";
import type { PromotionEvent } from "@engine/growth/types";
import { createSnapshot, restoreIntoState } from "@engine/save/snapshot";
import type { SaveFile } from "@engine/save/types";
import { applyScenario, warmForward } from "@engine/save/scenario";
import type { ScenarioSpec, ScenarioVehicleSpec } from "@engine/save/scenario";
import { createScene } from "@render/scene";
import { createCameraController } from "@render/camera";
import { createDefaultStyleSpec } from "@render/style";
import { createNetworkGroup } from "@render/network";
import { createProfileCatalog } from "@render/profileCatalog";
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
// The brownfield premise (docs/rebuild-plan.md §1): the player inherits a
// colonial rail spine built for export and some pre-built roads. The
// generator places both without knowing content exists, so this is the
// bootstrap layer saying what that inherited network was built to -- a
// neglected colonial line and cheap feeder roads, not the best of each.
// Declared here rather than stamped onto the generated map so a segment
// naming a profile that later disappears from content still renders.
const INHERITED_PROFILES = { road: "feeder-road", rail: "colonial-rail" } as const;
// Reachability is an all-pairs A* sweep; it answers a question that
// changes only when the graph does, so it is refreshed on a slow timer
// rather than per frame.
const STRANDED_REFRESH_SECONDS = 2;

// Module 10 (save/load and scenarios). Both keys are only ever read or
// written from DEV-gated code (see maybeMountDevTools/DevApi below), so
// they -- and the save/scenario machinery they trigger -- tree-shake out
// of the production bundle entirely rather than needing a runtime guard
// around every call site.
const SAVE_STORAGE_KEY = "transport-game:save";
const BOOT_OVERRIDE_KEY = "transport-game:boot-override";

function toEraDef(era: Era): EraDef {
  return { id: era.id, order: era.order, durationSeconds: era.durationSeconds, modifiers: era.modifiers, railAvailable: era.railAvailable };
}

function toScenarioSpec(scenario: Scenario): ScenarioSpec {
  return {
    startingEraId: scenario.startingEraId,
    startingFunds: scenario.startingFunds,
    warmForwardDays: scenario.warmForwardDays,
    seedFleet: scenario.seedFleet.map((entry) => ({ defId: entry.defId, count: entry.count })),
  };
}

function toScenarioVehicleCatalog(catalog: VehicleDef[]): ScenarioVehicleSpec[] {
  return catalog.map((def) => ({
    defId: def.id,
    speed: def.speed,
    capacity: def.capacity,
    carries: def.carries,
    purchaseCost: def.purchaseCost,
    operatingCostPerSecond: def.operatingCostPerSecond,
    congestionWeight: def.congestionWeight,
  }));
}

// Reload-based rather than a hot-swap of the running scene's map/terrain:
// avoids a new class of stale-closure bugs across raycasting/network/
// authoring, at the cost of a page reload. A one-shot pointer in
// sessionStorage (not localStorage -- it must not survive past the reload
// it triggers) tells the next bootstrap() what to restore before any
// scene/network/authoring controller gets constructed.
type BootOverride = { kind: "load" } | { kind: "scenario"; scenarioId: string };

function consumeBootOverride(): BootOverride | null {
  const raw = sessionStorage.getItem(BOOT_OVERRIDE_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(BOOT_OVERRIDE_KEY);
  try {
    return JSON.parse(raw) as BootOverride;
  } catch {
    return null;
  }
}

interface BootPlan {
  mapSeed: number;
  pendingSave: SaveFile | null;
  pendingScenario: Scenario | null;
}

function resolveBootPlan(scenarios: Scenario[]): BootPlan {
  const fallback: BootPlan = { mapSeed: DEFAULT_MAP_SEED, pendingSave: null, pendingScenario: null };
  if (!import.meta.env.DEV) return fallback;

  const override = consumeBootOverride();
  if (!override) return fallback;

  if (override.kind === "load") {
    const raw = localStorage.getItem(SAVE_STORAGE_KEY);
    if (!raw) {
      console.error("transport-game: no save found; starting a fresh map instead.");
      return fallback;
    }
    try {
      const save = JSON.parse(raw) as SaveFile;
      return { mapSeed: save.map.seed, pendingSave: save, pendingScenario: null };
    } catch {
      console.error("transport-game: save data is corrupted; starting a fresh map instead.");
      return fallback;
    }
  }

  const scenario = scenarios.find((candidate) => candidate.id === override.scenarioId);
  if (!scenario) {
    console.error(`transport-game: unknown scenario "${override.scenarioId}"; starting a fresh map instead.`);
    return fallback;
  }
  return { mapSeed: scenario.mapSeed, pendingSave: null, pendingScenario: scenario };
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

  const [eras, vehicleCatalog, profiles, scenarios] = await Promise.all([
    loadContent(EraListSchema, "/content/eras.json"),
    loadContent(VehicleDefListSchema, "/content/vehicles.json"),
    loadContent(Profile2DDefListSchema, "/content/profiles.json"),
    loadContent(ScenarioListSchema, "/content/scenarios.json"),
  ]);
  const profileCatalog = createProfileCatalog(profiles, INHERITED_PROFILES);
  const eraContentById = new Map(eras.map((era) => [era.id, era]));
  const eraModifiersById = new Map<string, EraModifiers>(eras.map((era) => [era.id, era.modifiers]));
  const eraTimeline = createEraTimeline(eras.map(toEraDef));
  const currentEraContent = (): Era => eraContentById.get(currentEra(eraTimeline).id)!;

  const style = createDefaultStyleSpec();
  const sceneHandle = createScene(canvas, style);
  const cameraController = createCameraController(sceneHandle.camera, sceneHandle.controls);
  const accumulator = new Accumulator(SIM_DT);
  const statusBar = createStatusBar(statusEl);

  // Save/scenario restoration happens before any scene/network/authoring
  // controller is built, and mutates simulation/economy/paratransit/growth/
  // eraTimeline in place (docs/handoff-module-10.md): `map` below is read
  // back off `simulation.map` afterward rather than the freshly generated
  // one, so the scene is built from whatever topology actually won --
  // restored corridors and promotions, an authored scenario's clean map,
  // or, on the ordinary path, the map just generated.
  const bootPlan = resolveBootPlan(scenarios);
  const initialMap = generateMap(bootPlan.mapSeed);
  const simulation = createSimulation(initialMap, []);
  const economy = createEconomyState(FARE_TABLE, STARTING_FUNDS);
  const paratransit = createParatransitState();
  const growth = createGrowthState(initialMap);

  if (bootPlan.pendingSave) {
    const result = restoreIntoState(bootPlan.pendingSave, simulation, economy, paratransit, growth, eraTimeline);
    if (!result.ok) console.error(`transport-game: ${result.error}`);
  } else if (bootPlan.pendingScenario) {
    applyScenario(
      toScenarioSpec(bootPlan.pendingScenario),
      simulation,
      economy,
      eraTimeline,
      toScenarioVehicleCatalog(vehicleCatalog),
    );
    if (bootPlan.pendingScenario.warmForwardDays > 0) {
      warmForward(
        simulation,
        economy,
        paratransit,
        growth,
        eraTimeline,
        bootPlan.pendingScenario.warmForwardDays,
        eraModifiersById,
        profileCatalog.decayMultipliers,
      );
    }
  }

  const map = simulation.map;
  const groundMesh = sceneHandle.setTerrain(map);
  const networkHandle = createNetworkGroup(map, profileCatalog);
  sceneHandle.scene.add(networkHandle.group);
  const overlayLayer = createOverlayLayer();
  sceneHandle.scene.add(overlayLayer.group);

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
    (type) => profileCatalog.buildable(type),
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
      profileFor: (segment) => profileCatalog.resolve(segment),
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
  // A restored save or a warmed-forward scenario can already own stock
  // that's obsolete for the era it's starting in -- handleEraChanged marks
  // that stock, same as it would after a live transition, rather than
  // waiting for the next one to notice.
  fleetController.handleEraChanged();

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

  // docs/rebuild-plan.md §6 Module 10: "window.dev console API for era,
  // funds, warm, save, load." A separate surface from the ?studio=1 UI --
  // installed whenever the build is DEV regardless of that query param, so
  // it's reachable from the console alone. era/funds/warm act live, since
  // neither changes map/terrain identity; save/load/scenario go through a
  // reload (see BootOverride above).
  //
  // Built inside this `if` rather than unconditionally: an object literal
  // constructed at the top level of bootstrap() is never dead code no
  // matter what its methods reference, so the save/scenario machinery
  // (and their storage-key strings) would ship in prod regardless of
  // maybeMountDevTools' own DEV check. This is the branch that actually
  // makes it tree-shake out -- verified by scripts/verify-prod-bundle.mjs.
  if (import.meta.env.DEV) {
    const devApi: DevApi = {
      era(id: string): void {
        const index = eraTimeline.eras.findIndex((candidate) => candidate.id === id);
        if (index === -1) {
          console.error(`transport-game: unknown era "${id}". Valid ids: ${eraTimeline.eras.map((e) => e.id).join(", ")}`);
          return;
        }
        const from = currentEra(eraTimeline);
        eraTimeline.currentIndex = index;
        eraTimeline.elapsedInEraSeconds = 0;
        const to = currentEra(eraTimeline);
        if (from.id !== to.id) handleEraTransition({ from, to });
      },
      funds(amount: number): void {
        economy.funds = amount;
      },
      warm(days: number): void {
        warmForward(simulation, economy, paratransit, growth, eraTimeline, days, eraModifiersById, profileCatalog.decayMultipliers);
        networkHandle.update(simulation.map);
        applyEraPalette(currentEraContent());
        fleetController.handleEraChanged();
        eraBanner.show(`Warmed forward ${days} day${days === 1 ? "" : "s"}`);
      },
      save(): void {
        const snapshot = createSnapshot(simulation, economy, paratransit, growth, eraTimeline);
        localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(snapshot));
        console.log("transport-game: saved.");
      },
      load(): void {
        if (!localStorage.getItem(SAVE_STORAGE_KEY)) {
          console.error("transport-game: no save found.");
          return;
        }
        sessionStorage.setItem(BOOT_OVERRIDE_KEY, JSON.stringify({ kind: "load" } satisfies BootOverride));
        location.reload();
      },
      scenario(id: string): void {
        if (!scenarios.some((candidate) => candidate.id === id)) {
          console.error(`transport-game: unknown scenario "${id}". Valid ids: ${scenarios.map((s) => s.id).join(", ")}`);
          return;
        }
        sessionStorage.setItem(BOOT_OVERRIDE_KEY, JSON.stringify({ kind: "scenario", scenarioId: id } satisfies BootOverride));
        location.reload();
      },
    };

    await maybeMountDevTools(canvas, style, sceneHandle, eras, vehicleCatalog, devApi);
  }

  let last = performance.now();
  let framesSinceSample = 0;
  let timeSinceSample = 0;
  let fps = 0;

  function frame(now: number): void {
    const elapsed = (now - last) / 1000;
    last = now;

    accumulator.advance(elapsed, (dt) => {
      const promotions = tick(
        simulation,
        dt,
        economy,
        paratransit,
        currentEra(eraTimeline).modifiers,
        growth,
        profileCatalog.decayMultipliers,
      );
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
        segmentLoads: simulation.segmentLoads,
      },
      elapsed,
    );

    // Ambient private traffic is a rendering of the engine's ambient load,
    // never a source of it -- see engine/simulation/congestion.ts.
    networkHandle.updateAmbientTraffic(simulation.ambientLoads, elapsed);
    cameraController.update(elapsed);
    fleetRenderer.update(simulation.vehicles, simulation.map);
    sceneHandle.render();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

// Module 10's console API (docs/rebuild-plan.md §6): "you can reach any
// era in seconds for tuning." Built in bootstrap(), where it can close
// over live state, and installed here alongside the studio so both
// DEV-only surfaces share one gate.
interface DevApi {
  era: (id: string) => void;
  funds: (amount: number) => void;
  warm: (days: number) => void;
  save: () => void;
  load: () => void;
  scenario: (id: string) => void;
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
  devApi: DevApi,
): Promise<void> {
  if (!import.meta.env.DEV) {
    return;
  }
  (window as unknown as { dev: DevApi }).dev = devApi;
  console.log("transport-game: dev console ready -- window.dev.{era,funds,warm,save,load,scenario}");

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
