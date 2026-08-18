import { useMemo, useState } from "preact/hooks";
import type { ProfileElement, Profile2DDef } from "@content/schema";
import { MATERIAL_CHANNELS, Profile2DDefSchema } from "@content/schema";
import { crossSectionOutline, outlineWidth } from "@render/studioProfile";
import { ProfilePreview } from "./ProfilePreview";
import { MATERIAL_SWATCHES, PROFILE_PRESETS, elementFromPreset } from "./profilePresets";
import { button, errorNote, exportJson, note, row, sectionTitle, tabBody } from "./studioChrome";

// The cross-section canvas. Everything is authored relative to the centre
// point (0, 0): x across the alignment, y up from the ground plane, both
// in metres. Drawing to scale against a ruled grid is the point -- a
// cross-section authored in arbitrary units would sweep to a road that is
// the wrong size and nothing on screen would say so.
const VIEW_MIN_X = -8;
const VIEW_MAX_X = 8;
const VIEW_MIN_Y = -1.5;
const VIEW_MAX_Y = 2.5;
const SCALE = 21;
const SNAP = 0.05;
const CANVAS_WIDTH = (VIEW_MAX_X - VIEW_MIN_X) * SCALE;
const CANVAS_HEIGHT = (VIEW_MAX_Y - VIEW_MIN_Y) * SCALE;

function toScreenX(x: number): number {
  return (x - VIEW_MIN_X) * SCALE;
}
function toScreenY(y: number): number {
  return (VIEW_MAX_Y - y) * SCALE;
}
function fromScreen(sx: number, sy: number): { x: number; y: number } {
  return {
    x: Math.round((sx / SCALE + VIEW_MIN_X) / SNAP) * SNAP,
    y: Math.round((VIEW_MAX_Y - sy / SCALE) / SNAP) * SNAP,
  };
}

interface Drag {
  elementId: string;
  vertexIndex: number;
}

export function ProfileStudio() {
  const [id, setId] = useState("trunk-road");
  const [surfaceType, setSurfaceType] = useState<"road" | "rail">("road");
  const [costPerMeter, setCostPerMeter] = useState(12);
  const [decayRateMultiplier, setDecayRateMultiplier] = useState(1);
  const [elements, setElements] = useState<ProfileElement[]>(() => [
    elementFromPreset(PROFILE_PRESETS[0]!),
    elementFromPreset(PROFILE_PRESETS[1]!),
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const outline = useMemo(() => crossSectionOutline(elements), [elements]);

  // Validated on every keystroke, not on export: the export button being
  // disabled with the reason on screen is a far better failure than a
  // successful export of something the loader will reject later.
  const candidate = {
    id,
    surfaceType,
    width: Number(outlineWidth(outline).toFixed(3)) || 0,
    costPerMeter,
    decayRateMultiplier,
    crossSectionVertices: outline,
    elements,
  };
  const parsed = Profile2DDefSchema.safeParse(candidate);
  const problems = parsed.success
    ? []
    : parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  const profile: Profile2DDef | null = parsed.success ? parsed.data : null;

  function updateVertex(elementId: string, vertexIndex: number, point: { x: number; y: number }): void {
    setElements((current) =>
      current.map((element) =>
        element.id === elementId
          ? { ...element, vertices: element.vertices.map((vertex, index) => (index === vertexIndex ? point : vertex)) }
          : element,
      ),
    );
  }

  function setChannel(elementId: string, channel: "friction" | "decay" | "structuralIntegrity", value: number): void {
    setElements((current) =>
      current.map((element) => {
        if (element.id !== elementId) return element;
        const channels = { ...element.channels };
        // Zero means "this material doesn't express that channel here",
        // and the schema requires positive values -- so it is removed
        // rather than exported as a zero that would read as "no friction".
        if (value > 0) channels[channel] = value;
        else delete channels[channel];
        return { ...element, channels };
      }),
    );
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!drag) return;
    const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    updateVertex(drag.elementId, drag.vertexIndex, fromScreen(event.clientX - rect.left, event.clientY - rect.top));
  }

  const selected = elements.find((element) => element.id === selectedId) ?? null;

  return (
    <div style={tabBody}>
      <div style={sectionTitle}>Cross-section (metres, from centre)</div>
      <svg
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        style={{ background: "#101014", borderRadius: "3px", touchAction: "none", cursor: drag ? "grabbing" : "default" }}
        onPointerMove={handlePointerMove}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
      >
        {/* One-metre rule, so the shape is read at its true size. */}
        {Array.from({ length: VIEW_MAX_X - VIEW_MIN_X + 1 }, (_, i) => VIEW_MIN_X + i).map((x) => (
          <line key={`gx${x}`} x1={toScreenX(x)} y1={0} x2={toScreenX(x)} y2={CANVAS_HEIGHT} stroke={x === 0 ? "#4a6a8a" : "#22242a"} />
        ))}
        {Array.from({ length: Math.round(VIEW_MAX_Y - VIEW_MIN_Y) + 1 }, (_, i) => VIEW_MIN_Y + i).map((y) => (
          <line key={`gy${y}`} x1={0} y1={toScreenY(y)} x2={CANVAS_WIDTH} y2={toScreenY(y)} stroke={y === 0 ? "#4a6a8a" : "#22242a"} />
        ))}

        {outline.length >= 3 && (
          <polygon
            points={outline.map((point) => `${toScreenX(point.x)},${toScreenY(point.y)}`).join(" ")}
            fill="none"
            stroke="#ffe08a"
            stroke-dasharray="3 3"
          />
        )}

        {elements.map((element) => (
          <polygon
            key={element.id}
            points={element.vertices.map((vertex) => `${toScreenX(vertex.x)},${toScreenY(vertex.y)}`).join(" ")}
            fill={MATERIAL_SWATCHES[element.material]}
            stroke={element.id === selectedId ? "#ffe08a" : "#00000066"}
            stroke-width={element.id === selectedId ? 2 : 1}
            style={{ cursor: "pointer" }}
            onClick={() => setSelectedId(element.id)}
          />
        ))}

        {selected?.vertices.map((vertex, index) => (
          <circle
            key={`${selected.id}-${index}`}
            cx={toScreenX(vertex.x)}
            cy={toScreenY(vertex.y)}
            r={4}
            fill="#ffe08a"
            style={{ cursor: "grab" }}
            onPointerDown={() => setDrag({ elementId: selected.id, vertexIndex: index })}
          />
        ))}
      </svg>
      <div style={note}>
        Click an element to select it, then drag its handles. The dashed line is the swept silhouette
        (`crossSectionVertices`). Grid is 1 m.
      </div>

      <div style={sectionTitle}>Add element</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
        {PROFILE_PRESETS.map((preset) => (
          <button
            key={preset.material}
            style={{ ...button, width: "auto", marginTop: "0", flex: "1 1 45%" }}
            onClick={() => {
              const element = elementFromPreset(preset);
              setElements((current) => [...current, element]);
              setSelectedId(element.id);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div style={sectionTitle}>{`${selected.material} — ${selected.id}`}</div>
          {MATERIAL_CHANNELS[selected.material].map((channel) => (
            <label key={channel} style={row}>
              <span>{channel}</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={String(selected.channels[channel] ?? 0)}
                onInput={(e) => setChannel(selected.id, channel, Number((e.target as HTMLInputElement).value))}
              />
            </label>
          ))}
          <div style={note}>
            Only the channels this material carries are offered — the schema rejects the others, so they are not
            editable here either.
          </div>
          <button
            style={button}
            onClick={() => {
              setElements((current) => current.filter((element) => element.id !== selected.id));
              setSelectedId(null);
            }}
          >
            Remove element
          </button>
        </>
      )}

      <div style={sectionTitle}>Profile</div>
      <label style={row}>
        <span>id</span>
        <input value={id} onInput={(e) => setId((e.target as HTMLInputElement).value)} />
      </label>
      <label style={row}>
        <span>surface type</span>
        <select value={surfaceType} onChange={(e) => setSurfaceType((e.target as HTMLSelectElement).value as "road" | "rail")}>
          <option value="road">road</option>
          <option value="rail">rail</option>
        </select>
      </label>
      <label style={row}>
        <span>cost per metre</span>
        <input
          type="number"
          step="0.5"
          value={String(costPerMeter)}
          onInput={(e) => setCostPerMeter(Number((e.target as HTMLInputElement).value))}
        />
      </label>
      <label style={row}>
        <span>decay rate multiplier</span>
        <input
          type="number"
          step="0.05"
          value={String(decayRateMultiplier)}
          onInput={(e) => setDecayRateMultiplier(Number((e.target as HTMLInputElement).value))}
        />
      </label>
      <div style={note}>{`derived width: ${candidate.width} m`}</div>

      <div style={sectionTitle}>Swept preview</div>
      <ProfilePreview profile={profile} width={CANVAS_WIDTH} height={190} />
      <div style={note}>
        Swept along a Catmull-Rom S-curve with an elevated run — a straight test piece would hide fan-out at
        curvature and a frame flip through the inflection.
      </div>

      {problems.length > 0 && <div style={errorNote}>{problems.join("\n")}</div>}

      <button style={button} disabled={!profile} onClick={() => profile && exportJson("profile", [profile])}>
        Export profile JSON
      </button>
    </div>
  );
}
