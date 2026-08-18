export interface StatusSnapshot {
  tick: number;
  fps: number;
  era: string;
  funds: number;
  incomePerDay: number;
  costPerDay: number;
  netPerDay: number;
  paratransitCount: number;
}

export interface StatusBar {
  render(snapshot: StatusSnapshot): void;
}

function money(amount: number): string {
  return `₦${Math.round(amount).toLocaleString()}`;
}

// No cached display state: textContent is set fresh from the snapshot
// every call. Burn rate in the status strip (docs/rebuild-plan.md §5):
// "balance without rate is unreadable."
export function createStatusBar(el: HTMLElement): StatusBar {
  return {
    render(snapshot: StatusSnapshot): void {
      const debtFlag = snapshot.funds < 0 ? " (debt)" : "";
      el.textContent =
        `tick ${snapshot.tick} · era: ${snapshot.era} · ${snapshot.fps} fps` +
        ` · funds: ${money(snapshot.funds)}${debtFlag}` +
        ` · ${money(snapshot.incomePerDay)}/day in · ${money(snapshot.costPerDay)}/day out` +
        ` · net ${money(snapshot.netPerDay)}/day` +
        ` · ${snapshot.paratransitCount} informal`;
    },
  };
}
