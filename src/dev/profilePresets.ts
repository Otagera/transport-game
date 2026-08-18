import type { ProfileElement, ProfileMaterial } from "@content/schema";
import { MATERIAL_COLORS } from "@render/studioProfile";

// Canonical starting shapes, in metres, measured from the centreline at
// (0, 0): x runs across the alignment, y up from the ground plane. They
// are starting points to drag, not fixed parts -- a second curb is added
// by adding another and dragging it to the far side, which is also the
// cheapest way to make the editor's direct manipulation the primary
// gesture rather than a form.
interface Preset {
  material: ProfileMaterial;
  label: string;
  x: [number, number];
  y: [number, number];
  channels: ProfileElement["channels"];
}

export const PROFILE_PRESETS: Preset[] = [
  { material: "asphalt", label: "Asphalt lanes", x: [-3.5, 3.5], y: [0, 0.12], channels: { friction: 0.8, decay: 1 } },
  { material: "curb", label: "Curb", x: [3.5, 3.72], y: [0, 0.3], channels: { structuralIntegrity: 1 } },
  { material: "gutter", label: "Gutter", x: [3.72, 4.3], y: [-0.12, 0], channels: { structuralIntegrity: 0.6 } },
  { material: "ditch", label: "Side ditch", x: [4.3, 5.6], y: [-0.6, 0], channels: { structuralIntegrity: 0.4 } },
  { material: "barrier", label: "Elevated barrier", x: [3.5, 3.72], y: [0.3, 1.2], channels: { structuralIntegrity: 1.5 } },
  { material: "ballast", label: "Rail ballast", x: [-2.4, 2.4], y: [0, 0.4], channels: { decay: 0.8, structuralIntegrity: 1 } },
  { material: "sleeper", label: "Sleepers", x: [-1.4, 1.4], y: [0.4, 0.56], channels: { friction: 0.5, decay: 1.2 } },
];

// Derived from the renderer's own palette rather than restated: two
// copies of "what colour is asphalt" is precisely the kind of duplication
// that drifts, and the editor showing a different colour from the map
// would make the studio lie about what it is authoring.
export const MATERIAL_SWATCHES: Record<ProfileMaterial, string> = Object.fromEntries(
  Object.entries(MATERIAL_COLORS).map(([material, color]) => [material, `#${color.toString(16).padStart(6, "0")}`]),
) as Record<ProfileMaterial, string>;

let nextElementId = 0;

export function elementFromPreset(preset: Preset): ProfileElement {
  nextElementId += 1;
  return {
    id: `${preset.material}-${nextElementId}`,
    material: preset.material,
    // Counter-clockwise in cross-section space, so the swept tube's
    // winding is consistent between elements and computeVertexNormals
    // doesn't hand one of them inside-out shading.
    vertices: [
      { x: preset.x[0], y: preset.y[0] },
      { x: preset.x[1], y: preset.y[0] },
      { x: preset.x[1], y: preset.y[1] },
      { x: preset.x[0], y: preset.y[1] },
    ],
    channels: preset.channels,
  };
}
