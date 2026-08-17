import { h, render } from "preact";
import type { StyleSpec } from "@render/style";

interface FieldDef {
  label: string;
  kind: "color" | "range";
  min?: number;
  max?: number;
  step?: number;
  regen: boolean;
  get: (style: StyleSpec) => string | number;
  set: (style: StyleSpec, value: string) => void;
}

const fields: FieldDef[] = [
  {
    label: "Background",
    kind: "color",
    regen: false,
    get: (s) => s.background.color,
    set: (s, v) => {
      s.background.color = v;
    },
  },
  {
    label: "Base color",
    kind: "color",
    regen: false,
    get: (s) => s.base.color,
    set: (s, v) => {
      s.base.color = v;
    },
  },
  {
    label: "Base size",
    kind: "range",
    min: 5,
    max: 40,
    step: 1,
    regen: true,
    get: (s) => s.base.size,
    set: (s, v) => {
      s.base.size = Number(v);
    },
  },
  {
    label: "Base thickness",
    kind: "range",
    min: 0.1,
    max: 3,
    step: 0.1,
    regen: true,
    get: (s) => s.base.thickness,
    set: (s, v) => {
      s.base.thickness = Number(v);
    },
  },
  {
    label: "Key light color",
    kind: "color",
    regen: false,
    get: (s) => s.lighting.key.color,
    set: (s, v) => {
      s.lighting.key.color = v;
    },
  },
  {
    label: "Key intensity",
    kind: "range",
    min: 0,
    max: 6,
    step: 0.1,
    regen: false,
    get: (s) => s.lighting.key.intensity,
    set: (s, v) => {
      s.lighting.key.intensity = Number(v);
    },
  },
  {
    label: "Key azimuth",
    kind: "range",
    min: 0,
    max: 360,
    step: 1,
    regen: false,
    get: (s) => s.lighting.key.azimuthDeg,
    set: (s, v) => {
      s.lighting.key.azimuthDeg = Number(v);
    },
  },
  {
    label: "Key elevation",
    kind: "range",
    min: 5,
    max: 85,
    step: 1,
    regen: false,
    get: (s) => s.lighting.key.elevationDeg,
    set: (s, v) => {
      s.lighting.key.elevationDeg = Number(v);
    },
  },
  {
    label: "Fill light color",
    kind: "color",
    regen: false,
    get: (s) => s.lighting.fill.color,
    set: (s, v) => {
      s.lighting.fill.color = v;
    },
  },
  {
    label: "Fill intensity",
    kind: "range",
    min: 0,
    max: 3,
    step: 0.1,
    regen: false,
    get: (s) => s.lighting.fill.intensity,
    set: (s, v) => {
      s.lighting.fill.intensity = Number(v);
    },
  },
  {
    label: "Ambient color",
    kind: "color",
    regen: false,
    get: (s) => s.lighting.ambient.color,
    set: (s, v) => {
      s.lighting.ambient.color = v;
    },
  },
  {
    label: "Ambient intensity",
    kind: "range",
    min: 0,
    max: 1,
    step: 0.05,
    regen: false,
    get: (s) => s.lighting.ambient.intensity,
    set: (s, v) => {
      s.lighting.ambient.intensity = Number(v);
    },
  },
  {
    label: "Placeholder color",
    kind: "color",
    regen: false,
    get: (s) => s.placeholder.color,
    set: (s, v) => {
      s.placeholder.color = v;
    },
  },
  {
    label: "Placeholder count",
    kind: "range",
    min: 0,
    max: 12,
    step: 1,
    regen: true,
    get: (s) => s.placeholder.count,
    set: (s, v) => {
      s.placeholder.count = Number(v);
    },
  },
];

const panelStyle = {
  position: "fixed",
  top: "8px",
  right: "8px",
  width: "220px",
  maxHeight: "calc(100vh - 16px)",
  overflowY: "auto",
  background: "rgba(20, 20, 20, 0.85)",
  color: "#eee",
  font: "11px/1.4 monospace",
  padding: "8px",
  borderRadius: "6px",
  boxSizing: "border-box",
} as const;

const rowStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  marginBottom: "6px",
} as const;

export interface TuningPanelHandle {
  destroy: () => void;
}

export function mountTuningPanel(
  container: HTMLElement,
  style: StyleSpec,
  onChange: (regen: boolean) => void,
): TuningPanelHandle {
  function renderPanel(): void {
    render(view(), container);
  }

  function handleInput(field: FieldDef, event: Event): void {
    field.set(style, (event.target as HTMLInputElement).value);
    onChange(field.regen);
    renderPanel();
  }

  function fieldRow(field: FieldDef) {
    const value = field.get(style);
    return h(
      "label",
      { style: rowStyle },
      h("span", null, field.kind === "range" ? `${field.label}: ${value}` : field.label),
      h("input", {
        type: field.kind,
        min: field.min,
        max: field.max,
        step: field.step,
        value: String(value),
        onInput: (event: Event) => handleInput(field, event),
      }),
    );
  }

  function view() {
    return h(
      "div",
      { style: panelStyle },
      h("div", { style: { fontWeight: "bold", marginBottom: "8px" } }, "Tuning (?tune=1)"),
      ...fields.map((field) => fieldRow(field)),
      h(
        "button",
        {
          style: { width: "100%", padding: "4px", marginTop: "4px" },
          onClick: () => exportStyle(style),
        },
        "Export JSON",
      ),
    );
  }

  renderPanel();

  return {
    destroy: () => {
      render(null, container);
    },
  };
}

function exportStyle(style: StyleSpec): void {
  const json = JSON.stringify(style, null, 2);
  console.log(json);
  navigator.clipboard?.writeText(json).catch(() => {
    // Clipboard access can be denied by the browser; the console.log above is the fallback.
  });
}
