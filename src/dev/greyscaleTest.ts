// Acceptance check (docs/rebuild-plan.md §6 Module 1): the scene must read
// in value alone. Press 'g' to toggle. CSS filter is enough here — this is
// a dev-time diagnostic, not a shipped rendering feature.
export function installGreyscaleTest(canvas: HTMLCanvasElement): void {
  window.addEventListener("keydown", (event) => {
    if (event.key !== "g" || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    canvas.style.filter = canvas.style.filter ? "" : "grayscale(1)";
  });
}
