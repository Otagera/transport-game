import { describe, expect, test } from "bun:test";
import { createSelectionStore } from "@ui/selection";

describe("createSelectionStore", () => {
  test("starts empty -- the Inspector's empty state is the default, not a fallback", () => {
    expect(createSelectionStore().get()).toBeNull();
  });

  test("notifies subscribers on a real change", () => {
    const store = createSelectionStore();
    const seen: Array<string | null> = [];
    store.subscribe((selection) => seen.push(selection?.id ?? null));

    store.select({ kind: "node", id: "town" });
    store.select({ kind: "node", id: "market" });
    store.clear();

    expect(seen).toEqual(["town", "market", null]);
  });

  test("re-selecting the same entity does not re-emit -- otherwise every click on an already-selected row re-flies the camera", () => {
    const store = createSelectionStore();
    let emissions = 0;
    store.subscribe(() => {
      emissions += 1;
    });

    store.select({ kind: "vehicle", id: "vehicle-0" });
    store.select({ kind: "vehicle", id: "vehicle-0" });
    expect(emissions).toBe(1);
  });

  test("same id but a different kind is a different selection", () => {
    const store = createSelectionStore();
    let emissions = 0;
    store.subscribe(() => {
      emissions += 1;
    });

    store.select({ kind: "node", id: "shared" });
    store.select({ kind: "segment", id: "shared" });
    expect(emissions).toBe(2);
  });

  test("unsubscribing stops delivery", () => {
    const store = createSelectionStore();
    let emissions = 0;
    const unsubscribe = store.subscribe(() => {
      emissions += 1;
    });

    store.select({ kind: "node", id: "a" });
    unsubscribe();
    store.select({ kind: "node", id: "b" });
    expect(emissions).toBe(1);
  });
});
