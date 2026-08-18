import type { StyleSpec } from "@render/style";

// The Module 1 style spec's editable surface, lifted out of the panel that
// used to be the whole of src/dev/. It is data, not markup, so the Tuning
// tab is a loop rather than a hand-written form -- and adding a value to
// StyleSpec means adding one entry here, not a new component.
export interface FieldDef {
  label: string;
  kind: "color" | "range";
  min?: number;
  max?: number;
  step?: number;
  regen: boolean;
  get: (style: StyleSpec) => string | number;
  set: (style: StyleSpec, value: string) => void;
}

export const STYLE_FIELDS: FieldDef[] = [
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
