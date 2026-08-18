import type { RoutePnL } from "../engine/economy/report";
import { escapeHtml, money } from "./format";

export interface PnLPanel {
  render(visible: boolean, rows: RoutePnL[], selectedVehicleId?: string | null): void;
  dispose(): void;
}

// Per-route P&L, worst-first (docs/rebuild-plan.md §6 Module 6): "you can
// tell which route is bleeding in under ten seconds." No cached state --
// the whole table is rebuilt from `rows` every call.
//
// Select-and-focus (docs/module-11-studio-and-ia.md §1): a List that only
// ranks tells you *which* route is bleeding but not *where* it is, and
// hunting for it on the map is where the ten seconds actually go. Clicking
// a row selects that vehicle (populating the Inspector) and flies the
// camera to it, so diagnosis and location are one gesture. `pointerEvents`
// has to be turned on for the rows -- the panel's own CSS in index.html
// starts it click-through so it never eats a map click while idle.
export function createPnLPanel(el: HTMLElement, onSelectFocus: (vehicleId: string) => void): PnLPanel {
  function handleClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-vehicle]");
    if (!target) return;
    onSelectFocus(target.dataset.vehicle!);
  }

  el.addEventListener("click", handleClick);

  return {
    render(visible: boolean, rows: RoutePnL[], selectedVehicleId: string | null = null): void {
      if (!visible) {
        el.style.display = "none";
        el.style.pointerEvents = "none";
        el.innerHTML = "";
        return;
      }
      el.style.display = "block";
      el.style.pointerEvents = "auto";

      if (rows.length === 0) {
        el.innerHTML = "<div>P&amp;L (P to close)</div><div>No routes running yet.</div>";
        return;
      }

      const rowsHtml = rows
        .map((row) => {
          const color = row.net < 0 ? "#ff8080" : "#80ff9a";
          const selected = row.vehicleId === selectedVehicleId ? "background:rgba(255,224,138,0.18);" : "";
          return (
            `<div data-vehicle="${escapeHtml(row.vehicleId)}" style="color:${color};${selected}cursor:pointer">` +
            `${escapeHtml(row.vehicleId)}: ${money(row.revenue)} - ${money(row.cost)} = ${money(row.net)}</div>`
          );
        })
        .join("");
      el.innerHTML = `<div>P&amp;L, worst first (P to close · click a row to focus)</div>${rowsHtml}`;
    },
    dispose(): void {
      el.removeEventListener("click", handleClick);
    },
  };
}
