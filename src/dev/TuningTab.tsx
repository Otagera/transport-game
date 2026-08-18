import type { StyleSpec } from "@render/style";
import { STYLE_FIELDS, type FieldDef } from "./styleFields";
import { button, exportJson, note, row, tabBody } from "./studioChrome";

export interface TuningTabProps {
  style: StyleSpec;
  onChange: (regen: boolean) => void;
  /** Forces a re-render after a mutation to the (mutable) style spec. */
  onDirty: () => void;
}

// Module 1's tuning panel, unchanged in behaviour and now one tab among
// four. Still bound directly to the single mutable StyleSpec object rather
// than a copy: the whole point of the style spec (docs/rebuild-plan.md §6
// Module 1) is that there is exactly one of it, and a tab holding its own
// draft would immediately become a second source of truth.
export function TuningTab({ style, onChange, onDirty }: TuningTabProps) {
  function handleInput(field: FieldDef, event: Event): void {
    field.set(style, (event.target as HTMLInputElement).value);
    onChange(field.regen);
    onDirty();
  }

  return (
    <div style={tabBody}>
      {STYLE_FIELDS.map((field) => {
        const value = field.get(style);
        return (
          <label key={field.label} style={row}>
            <span>{field.kind === "range" ? `${field.label}: ${value}` : field.label}</span>
            <input
              type={field.kind}
              min={field.min}
              max={field.max}
              step={field.step}
              value={String(value)}
              onInput={(event: Event) => handleInput(field, event)}
            />
          </label>
        );
      })}
      <button style={button} onClick={() => exportJson("style", style)}>
        Export JSON
      </button>
      <div style={note}>Copied to the clipboard, and logged to the console as a fallback.</div>
    </div>
  );
}
