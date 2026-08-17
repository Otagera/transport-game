export interface StatusSnapshot {
  tick: number;
  fps: number;
  era: string;
}

export interface StatusBar {
  render(snapshot: StatusSnapshot): void;
}

// No cached display state: textContent is set fresh from the snapshot every
// call, never mutated incrementally.
export function createStatusBar(el: HTMLElement): StatusBar {
  return {
    render(snapshot: StatusSnapshot): void {
      el.textContent = `tick ${snapshot.tick} · era: ${snapshot.era} · ${snapshot.fps} fps`;
    },
  };
}
