// The one piece of state the Inspector, the Lists, the Moments and the
// map all read (docs/module-11-studio-and-ia.md §1). It exists as its own
// tiny store rather than living inside the Inspector because *four* homes
// need to agree on it: a list row, a moment, and a map click must all be
// able to say "this is the thing now," and the Inspector must be able to
// render nothing at all when the answer is "nothing."
export type SelectionKind = "vehicle" | "node" | "segment" | "corridor";

export interface Selection {
  kind: SelectionKind;
  id: string;
}

export type SelectionListener = (selection: Selection | null) => void;

export interface SelectionStore {
  get: () => Selection | null;
  select: (selection: Selection | null) => void;
  clear: () => void;
  subscribe: (listener: SelectionListener) => () => void;
}

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.id === b.id;
}

export function createSelectionStore(): SelectionStore {
  let current: Selection | null = null;
  const listeners = new Set<SelectionListener>();

  function select(selection: Selection | null): void {
    // Re-selecting the same entity is a no-op, not a re-emit: otherwise
    // every click on an already-selected list row would re-trigger a
    // camera flight, which reads as the map twitching rather than
    // responding.
    if (sameSelection(current, selection)) return;
    current = selection;
    for (const listener of listeners) listener(current);
  }

  return {
    get: () => current,
    select,
    clear: () => select(null),
    subscribe(listener: SelectionListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
