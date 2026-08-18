import { render } from "preact";
import { useState } from "preact/hooks";
import type { Era, VehicleDef } from "@content/schema";
import type { StyleSpec } from "@render/style";
import { AssetStudio } from "./AssetStudio";
import { ProfileStudio } from "./ProfileStudio";
import { ScenarioLab } from "./ScenarioLab";
import { TuningTab } from "./TuningTab";
import { drawer, tabBar, tabButton } from "./studioChrome";

// One dev-only surface, four tabs (docs/module-11-studio-and-ia.md §2).
// Everything authored here is Zod-validated against src/content/schema.ts
// before it counts as content -- the studio's job is to make authored
// facts schema-correct by construction, so the failure mode of
// hand-edited JSON (malformed, discovered at runtime) stops existing.
export type StudioTabId = "tuning" | "profile" | "asset" | "scenario";

export interface StudioProps {
  style: StyleSpec;
  onStyleChange: (regen: boolean) => void;
  eras: Era[];
  catalog: VehicleDef[];
}

const TABS: Array<{ id: StudioTabId; label: string }> = [
  { id: "tuning", label: "Tuning" },
  { id: "profile", label: "Profile Studio" },
  { id: "asset", label: "Asset Modder" },
  { id: "scenario", label: "Scenario Lab" },
];

export function Studio({ style, onStyleChange, eras, catalog }: StudioProps) {
  const [active, setActive] = useState<StudioTabId>("tuning");
  // The style spec is a single mutable object by design, so editing it
  // does not change any prop identity -- this counter is what turns a
  // mutation into a re-render without cloning the spec into component
  // state and creating a second source of truth.
  const [, setRevision] = useState(0);

  return (
    <div style={drawer}>
      <div style={tabBar}>
        {TABS.map((tab) => (
          <button key={tab.id} style={tabButton(tab.id === active)} onClick={() => setActive(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      {active === "tuning" && (
        <TuningTab style={style} onChange={onStyleChange} onDirty={() => setRevision((n) => n + 1)} />
      )}
      {active === "profile" && <ProfileStudio />}
      {active === "asset" && <AssetStudio eras={eras} />}
      {active === "scenario" && <ScenarioLab eras={eras} catalog={catalog} />}
    </div>
  );
}

export interface StudioHandle {
  destroy: () => void;
}

export function mountStudio(container: HTMLElement, props: StudioProps): StudioHandle {
  render(<Studio {...props} />, container);
  return {
    destroy: () => render(null, container),
  };
}
