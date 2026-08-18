import type { Selection } from "./selection";

export interface Moment {
  message: string;
  /** What the moment is *about*, if anything. Clicking selects it. */
  subject?: Selection;
}

export interface EraBanner {
  show(message: string, subject?: Selection): void;
  dispose(): void;
}

const VISIBLE_MS = 4000;

// Moments: brief, self-dismissing events (docs/architecture/render-and-ui.md
// §2). Deliberately scoped down from the full "sorted deltas by
// magnitude" banner in docs/principles.md §3 Findings -- that's a
// finding about a richer treatment, not a Module 8 requirement. This is
// just "a designed absence [or arrival] must be visible in advance, not
// ambush the player."
//
// What Module 11 adds is the pointer: a moment that names a subject is
// clickable, and clicking it selects that subject. A moment that tells you
// a village grew and then leaves you to find it is a dead end; the whole
// value of a moment is that it is the fastest possible route into the
// Inspector.
export function createEraBanner(el: HTMLElement, onSelect: (subject: Selection) => void): EraBanner {
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let subject: Selection | null = null;

  function handleClick(): void {
    if (subject) onSelect(subject);
  }

  el.addEventListener("click", handleClick);

  return {
    show(message: string, nextSubject?: Selection): void {
      subject = nextSubject ?? null;
      el.textContent = subject ? `${message}  ▸` : message;
      el.style.opacity = "1";
      el.style.pointerEvents = subject ? "auto" : "none";
      el.style.cursor = subject ? "pointer" : "default";
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        subject = null;
      }, VISIBLE_MS);
    },
    dispose(): void {
      el.removeEventListener("click", handleClick);
      if (hideTimer) clearTimeout(hideTimer);
    },
  };
}
