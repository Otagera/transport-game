import type { VehicleDef } from "../content/schema";
import type { GeneratedMap } from "../engine/map/types";
import { planCorridorPrune } from "../engine/map/prune";
import { maintenanceCost } from "../engine/pathing/cost";
import { computeBottleneckMetrics } from "../engine/simulation/bottleneck";
import { vehiclesUsingSegments } from "../engine/simulation/dependents";
import type { SimulationState } from "../engine/simulation/types";
import type { EconomyState } from "../engine/economy/types";
import { SECONDS_PER_GAME_DAY } from "../engine/economy/state";
import type { GrowthState } from "../engine/growth/types";
import { escapeHtml, money, percent } from "./format";
import type { Selection, SelectionStore } from "./selection";

// The Inspector is the only home for per-entity fact and per-entity
// action (docs/module-11-studio-and-ia.md §1). Its defining rule is the
// negative one: **it is empty when nothing is selected.** No default
// summary, no "here's the map overall" fallback -- a fallback would make
// it a second Strip, and then two homes disagree about the same number.
//
// Actions are never gated on funds. Pruning a corridor, selling a vehicle
// and maintaining a segment are the three levers a player in debt has to
// climb out; disabling them when funds go negative is precisely the
// undiagnosable-debt spiral docs/rebuild-plan.md §5 records three
// playthroughs dying to. This is a deliberate exception to
// economy/state.ts's "spending is blocked when it isn't affordable" rule,
// which continues to govern *purchases* -- buying a vehicle adds ongoing
// cost, maintaining a segment removes ongoing loss, and the two do not
// belong in the same category. Prune has one real blocker, and it is not
// money: a corridor still carrying vehicles.

export interface InspectorRow {
  label: string;
  value: string;
  tone?: "good" | "bad";
}

export interface InspectorAction {
  label: string;
  note?: string;
  /** Blocked actions still render, with the reason -- never hidden. */
  blockedReason?: string;
  run: () => void;
}

export interface InspectorLink {
  label: string;
  target: Selection;
}

export interface InspectorSnapshot {
  title: string;
  subtitle: string;
  rows: InspectorRow[];
  actions: InspectorAction[];
  links: InspectorLink[];
}

export interface InspectorEffects {
  sellVehicle: (vehicleId: string) => void;
  pruneCorridor: (corridorId: string) => void;
  maintainSegment: (segmentId: string) => void;
}

export interface InspectorSources {
  simulation: () => SimulationState;
  economy: () => EconomyState;
  growth: () => GrowthState;
  catalog: () => VehicleDef[];
  stranded: () => ReadonlySet<string>;
}

export interface Inspector {
  /** Rebuilds from the current selection. Cheap; safe to call per frame. */
  render: () => void;
  dispose: () => void;
}

export function buildSnapshot(
  selection: Selection | null,
  sources: InspectorSources,
  effects: InspectorEffects,
): InspectorSnapshot | null {
  if (!selection) return null;
  switch (selection.kind) {
    case "vehicle":
      return vehicleSnapshot(selection.id, sources, effects);
    case "node":
      return nodeSnapshot(selection.id, sources);
    case "segment":
      return segmentSnapshot(selection.id, sources, effects);
    case "corridor":
      return corridorSnapshot(selection.id, sources, effects);
  }
}

function vehicleSnapshot(
  vehicleId: string,
  sources: InspectorSources,
  effects: InspectorEffects,
): InspectorSnapshot | null {
  const simulation = sources.simulation();
  const vehicle = simulation.vehicles.find((candidate) => candidate.id === vehicleId);
  if (!vehicle) return null;

  const economy = sources.economy();
  const econ = economy.vehicleEconomics.get(vehicleId);
  const ledger = economy.ledger.get(vehicleId);
  const def = econ ? sources.catalog().find((candidate) => candidate.id === econ.defId) : undefined;
  const load = vehicle.cargo.reduce((total, entry) => total + entry.amount, 0);
  const net = ledger ? ledger.revenue - ledger.cost : 0;

  const rows: InspectorRow[] = [
    { label: "type", value: def ? def.name : vehicle.lifecycle === "one-shot" ? "informal" : "unknown" },
    { label: "carries", value: vehicle.carries },
    { label: "load", value: `${load.toFixed(1)} / ${vehicle.capacity}` },
    { label: "speed", value: vehicle.speed.toFixed(2) },
    { label: "route", value: `${vehicle.path.length} nodes` },
  ];

  if (ledger) {
    rows.push(
      { label: "revenue", value: money(ledger.revenue) },
      { label: "operating cost", value: money(ledger.cost) },
      { label: "net", value: money(net), tone: net < 0 ? "bad" : "good" },
    );
  }
  if (econ && econ.obsoleteSinceSeconds !== null) {
    const days = (economy.elapsedSeconds - econ.obsoleteSinceSeconds) / SECONDS_PER_GAME_DAY;
    rows.push({ label: "obsolete", value: `${days.toFixed(1)} days`, tone: "bad" });
  }

  // Paratransit is not the player's to sell -- it is a system that exists
  // whether they like it or not (docs/rebuild-plan.md, "The hook").
  const actions: InspectorAction[] =
    vehicle.lifecycle === "one-shot" || !econ
      ? []
      : [
          {
            label: "Sell vehicle",
            note: "depreciated resale, allowed in debt",
            run: () => effects.sellVehicle(vehicleId),
          },
        ];

  const links: InspectorLink[] = [];
  const origin = vehicle.path[0];
  if (origin) links.push({ label: `origin: ${origin}`, target: { kind: "node", id: origin } });

  return {
    title: vehicleId,
    subtitle: vehicle.lifecycle === "one-shot" ? "informal vehicle" : "fleet vehicle",
    rows,
    actions,
    links,
  };
}

function nodeSnapshot(nodeId: string, sources: InspectorSources): InspectorSnapshot | null {
  const simulation = sources.simulation();
  const node = simulation.map.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;

  const queued = [...(simulation.queues.get(nodeId)?.values() ?? [])].reduce((total, amount) => total + amount, 0);
  const degree = simulation.map.segments.filter(
    (segment) => segment.fromNodeId === nodeId || segment.toNodeId === nodeId,
  ).length;
  const isStranded = sources.stranded().has(nodeId);
  const growth = sources.growth().get(nodeId);

  const rows: InspectorRow[] = [
    { label: "kind", value: node.kind },
    { label: "cell", value: `${node.x}, ${node.y}` },
    { label: "connections", value: String(degree) },
    { label: "waiting", value: queued.toFixed(1) },
  ];
  if (growth) {
    rows.push(
      { label: "demand multiplier", value: `${growth.demandMultiplier.toFixed(2)}x` },
      { label: "service (player)", value: percent(growth.playerServiceEMA) },
      { label: "service (with informal)", value: percent(growth.serviceRatioEMA) },
    );
  }
  // Stranded is reachability-based, not "has no built edge"
  // (docs/rebuild-plan.md §5) -- a road to nowhere doesn't un-strand a
  // node, so this row can read "stranded" on a node with connections.
  if (isStranded) {
    rows.push({ label: "stranded", value: "reaches no destination", tone: "bad" });
  }

  const links: InspectorLink[] = simulation.map.segments
    .filter((segment) => segment.fromNodeId === nodeId || segment.toNodeId === nodeId)
    .slice(0, 4)
    .map((segment) => ({ label: `segment ${segment.id}`, target: { kind: "segment" as const, id: segment.id } }));

  return { title: nodeId, subtitle: node.kind, rows, actions: [], links };
}

function segmentSpanCells(map: GeneratedMap, fromNodeId: string, toNodeId: string): number {
  const from = map.nodes.find((node) => node.id === fromNodeId);
  const to = map.nodes.find((node) => node.id === toNodeId);
  if (!from || !to) return 0;
  return Math.hypot(from.x - to.x, from.y - to.y);
}

function segmentSnapshot(
  segmentId: string,
  sources: InspectorSources,
  effects: InspectorEffects,
): InspectorSnapshot | null {
  const simulation = sources.simulation();
  const segment = simulation.map.segments.find((candidate) => candidate.id === segmentId);
  if (!segment) return null;

  const traffic = simulation.segmentTraffic.get(segmentId);
  const metrics = traffic ? computeBottleneckMetrics(traffic) : { health: 1, utilisation: 0 };
  const span = segmentSpanCells(simulation.map, segment.fromNodeId, segment.toNodeId);
  const price = maintenanceCost(span, 1 - segment.condition);

  const rows: InspectorRow[] = [
    { label: "type", value: `${segment.type} · ${segment.level}` },
    { label: "provenance", value: segment.provenance },
    { label: "span", value: `${span.toFixed(1)} cells` },
    { label: "condition", value: percent(segment.condition), tone: segment.condition < 0.6 ? "bad" : "good" },
    { label: "health", value: percent(metrics.health), tone: metrics.health < 0.6 ? "bad" : "good" },
    { label: "utilisation", value: percent(metrics.utilisation) },
  ];

  const actions: InspectorAction[] = [
    price <= 0
      ? { label: "Maintain segment", blockedReason: "already at full condition", run: () => {} }
      : {
          label: `Maintain segment (${money(price)})`,
          note: "allowed in debt -- maintenance removes ongoing loss",
          run: () => effects.maintainSegment(segmentId),
        },
  ];

  return {
    title: segmentId,
    subtitle: `${segment.type} segment`,
    rows,
    actions,
    links: [{ label: `corridor ${segment.corridorId}`, target: { kind: "corridor", id: segment.corridorId } }],
  };
}

function corridorSnapshot(
  corridorId: string,
  sources: InspectorSources,
  effects: InspectorEffects,
): InspectorSnapshot | null {
  const simulation = sources.simulation();
  const corridor = simulation.map.corridors.find((candidate) => candidate.id === corridorId);
  if (!corridor) return null;

  const segments = simulation.map.segments.filter((segment) => segment.corridorId === corridorId);
  const meanCondition =
    segments.length === 0 ? 1 : segments.reduce((total, segment) => total + segment.condition, 0) / segments.length;
  const length = segments.reduce(
    (total, segment) => total + segmentSpanCells(simulation.map, segment.fromNodeId, segment.toNodeId),
    0,
  );

  const plan = planCorridorPrune(simulation.map, corridorId);
  const blockers = plan
    ? vehiclesUsingSegments(simulation.vehicles, simulation.routing, new Set(plan.segmentIds))
    : [];

  const rows: InspectorRow[] = [
    { label: "nodes", value: String(corridor.nodeIds.length) },
    { label: "segments", value: String(segments.length) },
    { label: "length", value: `${length.toFixed(1)} cells` },
    { label: "mean condition", value: percent(meanCondition), tone: meanCondition < 0.6 ? "bad" : "good" },
  ];
  if (segments.some((segment) => segment.level === "elevated")) {
    rows.push({ label: "includes", value: "bridge span(s)" });
  }

  const actions: InspectorAction[] = [
    blockers.length > 0
      ? {
          label: "Prune corridor",
          blockedReason: `${blockers.length} vehicle(s) still run on it: ${blockers.slice(0, 3).join(", ")}`,
          run: () => {},
        }
      : {
          label: "Prune corridor",
          note: "removes the corridor and any vertices it created",
          run: () => effects.pruneCorridor(corridorId),
        },
  ];

  const links: InspectorLink[] = blockers
    .slice(0, 3)
    .map((vehicleId) => ({ label: `vehicle ${vehicleId}`, target: { kind: "vehicle" as const, id: vehicleId } }));

  return { title: corridorId, subtitle: "corridor", rows, actions, links };
}

// No cached display state: the panel is rebuilt from the snapshot on every
// render call, matching every other panel in ui/.
export function createInspector(
  el: HTMLElement,
  selectionStore: SelectionStore,
  sources: InspectorSources,
  effects: InspectorEffects,
): Inspector {
  const pending = new Map<string, () => void>();

  function handleClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!target) return;
    const handler = pending.get(target.dataset.action!);
    handler?.();
    render();
  }

  function render(): void {
    const snapshot = buildSnapshot(selectionStore.get(), sources, effects);
    pending.clear();

    // Empty when nothing is selected -- including when the selected
    // entity has since disappeared (sold, pruned, paratransit reaped).
    if (!snapshot) {
      el.style.display = "none";
      el.innerHTML = "";
      return;
    }
    el.style.display = "block";

    const rowsHtml = snapshot.rows
      .map((row) => {
        const color = row.tone === "bad" ? "#ff8080" : row.tone === "good" ? "#80ff9a" : "#ddd";
        return `<div><span style="opacity:0.65">${escapeHtml(row.label)}</span> <span style="color:${color};float:right">${escapeHtml(row.value)}</span></div>`;
      })
      .join("");

    const actionsHtml = snapshot.actions
      .map((action, index) => {
        const key = `action-${index}`;
        if (action.blockedReason) {
          return `<div style="margin-top:6px;opacity:0.5">${escapeHtml(action.label)}<div style="font-size:10px">${escapeHtml(action.blockedReason)}</div></div>`;
        }
        pending.set(key, action.run);
        return (
          `<div style="margin-top:6px"><button data-action="${key}" style="width:100%;padding:4px;cursor:pointer">${escapeHtml(action.label)}</button>` +
          (action.note ? `<div style="font-size:10px;opacity:0.6">${escapeHtml(action.note)}</div>` : "") +
          `</div>`
        );
      })
      .join("");

    const linksHtml = snapshot.links
      .map((link, index) => {
        const key = `link-${index}`;
        pending.set(key, () => selectionStore.select(link.target));
        return `<div data-action="${key}" style="margin-top:2px;cursor:pointer;text-decoration:underline;opacity:0.8">${escapeHtml(link.label)}</div>`;
      })
      .join("");

    el.innerHTML =
      `<div style="font-weight:bold">${escapeHtml(snapshot.title)}</div>` +
      `<div style="opacity:0.6;margin-bottom:6px">${escapeHtml(snapshot.subtitle)}</div>` +
      rowsHtml +
      actionsHtml +
      linksHtml +
      `<div style="margin-top:8px;opacity:0.5;font-size:10px">Esc to deselect</div>`;
  }

  el.addEventListener("click", handleClick);
  const unsubscribe = selectionStore.subscribe(render);
  render();

  return {
    render,
    dispose: () => {
      el.removeEventListener("click", handleClick);
      unsubscribe();
    },
  };
}
