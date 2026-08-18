import { useState } from "preact/hooks";
import type { Era, Scenario, VehicleDef } from "@content/schema";
import { ScenarioSchema } from "@content/schema";
import { button, errorNote, exportJson, note, row, sectionTitle, tabBody } from "./studioChrome";

export interface ScenarioLabProps {
  eras: Era[];
  catalog: VehicleDef[];
}

// Scenarios are content, not code (docs/principles.md §3, "Content is
// data"). This tab authors one and validates it against the same
// ScenarioSchema the loader will, so an exported scenario is known-good
// before it is ever pasted into public/content/ -- rather than discovered
// to be malformed at runtime, which is how hand-edited JSON usually fails.
//
// It deliberately does not *apply* the scenario. Applying one is Module
// 10's job and needs a warm-forward pass over a real simulation; authoring
// the definition is a separate, useful thing on its own.
function draftScenario(eras: Era[]): Scenario {
  return {
    id: "scenario-1",
    name: "New scenario",
    mapSeed: 1,
    startingEraId: eras[0]?.id ?? "post-independence",
    startingFunds: 1000,
    warmForwardDays: 0,
    seedFleet: [],
  };
}

export function ScenarioLab({ eras, catalog }: ScenarioLabProps) {
  const [scenario, setScenario] = useState<Scenario>(() => draftScenario(eras));

  const parsed = ScenarioSchema.safeParse(scenario);
  const problems = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);

  function patch(changes: Partial<Scenario>): void {
    setScenario((current) => ({ ...current, ...changes }));
  }

  function setFleetCount(defId: string, count: number): void {
    setScenario((current) => {
      const others = current.seedFleet.filter((entry) => entry.defId !== defId);
      // A count of zero means "not in this scenario", not "zero of them":
      // the schema requires a positive count, so the entry is dropped
      // rather than exported as a valid-looking no-op.
      return { ...current, seedFleet: count > 0 ? [...others, { defId, count }] : others };
    });
  }

  return (
    <div style={tabBody}>
      <div style={sectionTitle}>Scenario</div>

      <label style={row}>
        <span>id</span>
        <input value={scenario.id} onInput={(e) => patch({ id: (e.target as HTMLInputElement).value })} />
      </label>
      <label style={row}>
        <span>name</span>
        <input value={scenario.name} onInput={(e) => patch({ name: (e.target as HTMLInputElement).value })} />
      </label>
      <label style={row}>
        <span>map seed</span>
        <input
          type="number"
          value={String(scenario.mapSeed)}
          onInput={(e) => patch({ mapSeed: Number((e.target as HTMLInputElement).value) })}
        />
      </label>
      <label style={row}>
        <span>starting era</span>
        <select
          value={scenario.startingEraId}
          onChange={(e) => patch({ startingEraId: (e.target as HTMLSelectElement).value })}
        >
          {eras.map((era) => (
            <option key={era.id} value={era.id}>
              {era.name}
            </option>
          ))}
        </select>
      </label>
      <label style={row}>
        <span>starting funds</span>
        <input
          type="number"
          value={String(scenario.startingFunds)}
          onInput={(e) => patch({ startingFunds: Number((e.target as HTMLInputElement).value) })}
        />
      </label>
      <label style={row}>
        <span>warm-forward days</span>
        <input
          type="number"
          step="0.5"
          value={String(scenario.warmForwardDays)}
          onInput={(e) => patch({ warmForwardDays: Number((e.target as HTMLInputElement).value) })}
        />
      </label>

      <div style={sectionTitle}>Seed fleet</div>
      <div style={note}>
        How many of each def to start with. A scenario is a starting point for tuning, not a curated layout -- where
        they run is decided when it is applied.
      </div>
      {catalog.map((def) => {
        const entry = scenario.seedFleet.find((candidate) => candidate.defId === def.id);
        return (
          <label key={def.id} style={row}>
            <span>{`${def.name} (${def.id})`}</span>
            <input
              type="number"
              min="0"
              value={String(entry?.count ?? 0)}
              onInput={(e) => setFleetCount(def.id, Number((e.target as HTMLInputElement).value))}
            />
          </label>
        );
      })}

      {problems.length > 0 && <div style={errorNote}>{problems.join("\n")}</div>}

      <button
        style={button}
        disabled={!parsed.success}
        onClick={() => parsed.success && exportJson("scenario", [parsed.data])}
      >
        Export scenario JSON
      </button>
      <div style={note}>Exported as a one-element array, matching public/content/*.json.</div>
    </div>
  );
}
