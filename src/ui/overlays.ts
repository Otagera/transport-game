// One question asked of the whole map at a time (docs/module-11-studio-
// and-ia.md §1). Exactly one is active, `None` included -- overlays that
// stack stop being readable, and "show relationships, not just state"
// (docs/principles.md §3) only works if the relationship on screen is
// unambiguous about which one it is.
//
// This module owns the *state and the picker*. The three.js layer that
// draws the answer is render/overlayLayer.ts: keeping them apart is what
// lets the picker be plain DOM like every other panel in ui/, and lets
// the drawing live next to the rest of render/.
export type OverlayId =
  | "none"
  | "demand"
  | "flows"
  | "coverage"
  | "stress"
  | "condition"
  | "buildability";

export interface OverlayOption {
  id: OverlayId;
  label: string;
  /** The question this overlay answers. Shown so the picker teaches itself. */
  question: string;
}

export const OVERLAY_OPTIONS: readonly OverlayOption[] = [
  { id: "none", label: "None", question: "the map as built" },
  { id: "demand", label: "Demand", question: "where is demand piling up unserved?" },
  { id: "flows", label: "Commodity flows", question: "what is actually moving, and where?" },
  { id: "coverage", label: "Coverage", question: "which places does my network reach?" },
  { id: "stress", label: "Corridor stress", question: "which link is the bottleneck?" },
  { id: "condition", label: "Condition", question: "what have I let rot?" },
  { id: "buildability", label: "Buildability", question: "what would it cost to build here?" },
] as const;

export interface OverlayController {
  getActive: () => OverlayId;
  setActive: (id: OverlayId) => void;
  cycle: () => void;
  dispose: () => void;
}

export function createOverlayController(
  el: HTMLElement,
  onChange: (id: OverlayId) => void,
): OverlayController {
  let active: OverlayId = "none";

  function render(): void {
    const rows = OVERLAY_OPTIONS.map((option) => {
      const selected = option.id === active;
      const color = selected ? "#ffe08a" : "#ddd";
      const marker = selected ? "▸" : " ";
      return `<div data-overlay="${option.id}" style="cursor:pointer;color:${color}">${marker} ${option.label}</div>`;
    }).join("");
    const current = OVERLAY_OPTIONS.find((option) => option.id === active)!;
    el.innerHTML =
      `<div style="font-weight:bold;margin-bottom:4px">Overlay (O to cycle)</div>` +
      rows +
      `<div style="margin-top:6px;opacity:0.6;font-size:10px">${current.question}</div>`;
  }

  function setActive(id: OverlayId): void {
    if (id === active) return;
    active = id;
    render();
    onChange(active);
  }

  function handleClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-overlay]");
    if (!target) return;
    setActive(target.dataset.overlay as OverlayId);
  }

  function cycle(): void {
    const index = OVERLAY_OPTIONS.findIndex((option) => option.id === active);
    setActive(OVERLAY_OPTIONS[(index + 1) % OVERLAY_OPTIONS.length]!.id);
  }

  el.addEventListener("click", handleClick);
  render();

  return {
    getActive: () => active,
    setActive,
    cycle,
    dispose: () => el.removeEventListener("click", handleClick),
  };
}
