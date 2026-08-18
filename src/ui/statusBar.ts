import { money } from "./format";

// The Strip: ambient state, never behind a click (docs/module-11-studio-
// and-ia.md §1). Funds, burn rate and era are the three things a player
// must never have to ask for -- "balance without rate is unreadable"
// (docs/rebuild-plan.md §5) is the whole reason the rate lives here rather
// than in the P&L list.
//
// Frame rate and tick count are *diagnostics*, not ambient game state, so
// they are DEV-only: shipping them would put a developer's number in the
// one home reserved for the player's.
export interface StatusSnapshot {
  era: string;
  funds: number;
  incomePerDay: number;
  costPerDay: number;
  netPerDay: number;
  paratransitCount: number;
  diagnostics?: {
    tick: number;
    fps: number;
  };
}

export interface StatusBar {
  render(snapshot: StatusSnapshot): void;
}

// No cached display state: textContent is set fresh from the snapshot
// every call.
export function createStatusBar(el: HTMLElement): StatusBar {
  return {
    render(snapshot: StatusSnapshot): void {
      const debtFlag = snapshot.funds < 0 ? " (debt)" : "";
      const diagnostics = snapshot.diagnostics
        ? `tick ${snapshot.diagnostics.tick} · ${snapshot.diagnostics.fps} fps · `
        : "";
      el.textContent =
        `${diagnostics}era: ${snapshot.era}` +
        ` · funds: ${money(snapshot.funds)}${debtFlag}` +
        ` · ${money(snapshot.incomePerDay)}/day in · ${money(snapshot.costPerDay)}/day out` +
        ` · net ${money(snapshot.netPerDay)}/day` +
        ` · ${snapshot.paratransitCount} informal`;
    },
  };
}
