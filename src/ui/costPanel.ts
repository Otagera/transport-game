import type { CostBreakdown } from "../engine/pathing/cost";

export interface CostPanelSnapshot {
  visible: boolean;
  mode: string;
  infrastructureType: string;
  breakdown: CostBreakdown | null;
  valid: boolean;
  hint: string;
}

export interface CostPanel {
  render: (snapshot: CostPanelSnapshot) => void;
}

// No cached display state: innerHTML is set fresh from the snapshot every
// call. All interpolated values are internally computed (numbers, and
// enum-like mode/type strings), never raw user text.
export function createCostPanel(el: HTMLElement): CostPanel {
  return {
    render(snapshot: CostPanelSnapshot): void {
      if (!snapshot.visible) {
        el.style.display = "none";
        el.innerHTML = "";
        return;
      }
      el.style.display = "block";

      if (!snapshot.breakdown) {
        el.innerHTML = `<div>${snapshot.mode} · ${snapshot.infrastructureType}</div><div>${snapshot.hint}</div>`;
        return;
      }

      const b = snapshot.breakdown;
      el.innerHTML = `
        <div>${snapshot.mode} · ${snapshot.infrastructureType}${snapshot.valid ? "" : " · BLOCKED"}</div>
        <div>base: ${b.base.toFixed(0)}</div>
        <div>gradient: ${b.gradient.toFixed(0)}</div>
        <div>water: ${b.water.toFixed(0)}</div>
        <div>density: ${b.density.toFixed(0)}</div>
        <div>nodes: ${b.nodes.toFixed(0)}</div>
        <div><strong>total: ${b.total.toFixed(0)}</strong></div>
        <div>${snapshot.hint}</div>
      `;
    },
  };
}
