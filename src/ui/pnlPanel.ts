import type { RoutePnL } from "../engine/economy/report";

export interface PnLPanel {
  render(visible: boolean, rows: RoutePnL[]): void;
}

function money(amount: number): string {
  return `₦${Math.round(amount).toLocaleString()}`;
}

// Per-route P&L, worst-first (docs/rebuild-plan.md §6 Module 6): "you can
// tell which route is bleeding in under ten seconds." No cached state --
// the whole table is rebuilt from `rows` every call.
export function createPnLPanel(el: HTMLElement): PnLPanel {
  return {
    render(visible: boolean, rows: RoutePnL[]): void {
      if (!visible) {
        el.style.display = "none";
        el.innerHTML = "";
        return;
      }
      el.style.display = "block";

      if (rows.length === 0) {
        el.innerHTML = "<div>P&amp;L (P to close)</div><div>No routes running yet.</div>";
        return;
      }

      const rowsHtml = rows
        .map((row) => {
          const color = row.net < 0 ? "#ff8080" : "#80ff9a";
          return `<div style="color:${color}">${row.vehicleId}: ${money(row.revenue)} - ${money(row.cost)} = ${money(row.net)}</div>`;
        })
        .join("");
      el.innerHTML = `<div>P&amp;L, worst first (P to close)</div>${rowsHtml}`;
    },
  };
}
