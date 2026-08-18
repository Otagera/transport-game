# Module 11 — Dev Studio (`?studio=1`) and the information-architecture refactor

Two changes that travel together because they are the same problem seen from two sides:
**where does a fact live, and who is allowed to author it.**

- The **IA refactor** (`src/ui/`) gives every player-facing fact exactly one home, so a
  reading isn't duplicated in three panels that can disagree.
- The **Dev Studio** (`src/dev/`) gives every *authored* fact — style values, road
  cross-sections, vehicle definitions, scenarios — one dev-only tool that writes
  schema-validated content instead of hand-edited JSON.

Neither ships. `src/dev/` stays dead-code-eliminated from production; the IA refactor is
a reshuffle of panels that already existed plus the overlay layer they were missing.

---

## 1. The six homes

Every player-facing fact lands in exactly one of these. The rule that makes it useful is
the *negative* one: a fact in one home does not also appear in another.

| Home | Files | What it holds | The rule that keeps it honest |
| --- | --- | --- | --- |
| **Inspector** | `ui/inspector.ts` | Everything about the one selected entity: stats and the actions you can take on it. | **Empty when nothing is selected.** No "default" content, no fallback summary — an empty inspector is the correct render of an empty selection. |
| **Overlays** | `ui/overlays.ts` | One question asked of the whole map at once. | **Exactly one active at a time**, `None` included. Overlays that stack stop being readable. |
| **Lists** | `ui/pnlPanel.ts`, `render/fleet.ts` | Ranked comparisons across many entities. | **Worst-first by default**, and every row is a **select-and-focus** target: clicking it selects the entity and flies the camera to it. |
| **Strip** | `ui/statusBar.ts` | Ambient state you must never have to ask for. | **Never behind a click.** Funds, burn-rate EMA, era. Nothing that needs a decision to reveal. |
| **Moments** | `ui/eraBanner.ts` | Brief, self-dismissing events. | Clicking a moment **selects its subject** — a moment is a pointer into the Inspector, not a dead-end toast. |
| **Map** | `render/*` | The world itself. | **Hue = health, brightness = utilisation.** Two channels, two meanings, never conflated (docs/rebuild-plan.md §5). |

### Visual channel discipline

`docs/rebuild-plan.md` §5 already fixes the base map's two channels: **hue carries
health** (green → red) and **brightness carries utilisation**. Both are spoken for. An
overlay that needs to say something else must therefore say it in a *third* channel —
a separate additive layer drawn above the base network, not a recolour of it — which is
exactly why `overlays.ts` owns its own render group rather than reaching into
`network.ts`'s materials.

Streets stay **neutral by default** and only take the health hue where service actually
runs. Colouring every corridor turns the map into a lattice and destroys the signal.

---

## 2. Dev Studio

One dev-only surface at `?studio=1`, tabbed:

```
[ Tuning ] [ Profile Studio ] [ Asset Modder ] [ Scenario Lab ]
```

- **Tuning** — the existing Module 1 style-spec panel, moved into a tab. Unchanged
  behaviour: live where possible, regenerate where geometry is affected, export JSON.
- **Profile Studio** — a 2D cross-section composer. Draw a road/rail profile once
  (lanes, curbs, gutters, ditches, barriers, ballast, sleepers), and
  `render/studioProfile.ts` sweeps it along a Catmull-Rom spline to produce the 3D
  corridor geometry. Exports a `Profile2DDef`.
- **Asset Modder** — drag a `.glb` in, click the mesh to drop anchor gizmos (axles,
  boarding doors, cargo nodes, particle emitters), fill in the `VehicleDef` form, export
  a mod package.
- **Scenario Lab** — edits the `Scenario` content type (map seed, starting era, starting
  funds, warm-forward, seed fleet) and validates it against `ScenarioSchema`.

### Gating

`?studio=1` **and** `import.meta.env.DEV`, the same double gate Module 1 established.
`?tune=1` stays as an alias that opens the studio on the Tuning tab, so the Module 1
workflow and any muscle memory around it keep working.

`scripts/verify-prod-bundle.mjs` grows a forbidden string per studio surface, so
"the studio is dev-only" is asserted against the built bundle rather than trusted.

---

## 3. Boundaries this work must not cross

Restating them here because this module touches more layers at once than any before it:

1. `src/engine/` imports nothing from `render/`, `content/`, `ui/`, `dev/`, or three.js.
2. `src/dev/` is reachable only through a dynamic import behind `import.meta.env.DEV`.
3. `engine/pathing/cost.ts` stays the only place geometry becomes currency. A profile's
   `costPerMeter` is **authored content that feeds** the cost function, never a second
   cost path around it.
4. Content is data: everything the studio exports is Zod-validated against
   `src/content/schema.ts` before it counts as content.
