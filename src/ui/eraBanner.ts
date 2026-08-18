export interface EraBanner {
  show(message: string): void;
}

const VISIBLE_MS = 4000;

// Deliberately scoped down from the full "sorted deltas by magnitude"
// banner in docs/rebuild-plan.md §5 Findings -- that's a finding about a
// richer treatment, not a Module 8 requirement. This is just "a
// designed absence [or arrival] must be visible in advance, not ambush
// the player": a brief, self-dismissing text notice, nothing more.
export function createEraBanner(el: HTMLElement): EraBanner {
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    show(message: string): void {
      el.textContent = message;
      el.style.opacity = "1";
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        el.style.opacity = "0";
      }, VISIBLE_MS);
    },
  };
}
