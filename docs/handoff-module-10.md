# Handoff: merging `feat/dev-studio-and-ia-refactor` before Module 10

Written for the agent that owns **Module 10 (save/load and scenarios)**. This branch was
built in parallel and does not touch Module 10 — but it changes several things Module 10
has to account for, and two of them will silently corrupt a save if missed.

Branch: `feat/dev-studio-and-ia-refactor` · 318 tests · typecheck / test / build /
verify:bundle all green.

---

## 1. What landed

| Module | What it is |
| --- | --- |
| **11** | Six-homes IA refactor (`ui/inspector.ts`, `ui/overlays.ts`, `ui/selection.ts`), the `?studio=1` dev studio with four tabs, entity picking, camera focus |
| **11b** | Authored `Profile2DDef` cross-sections applied to real corridors: rendering, decay, and build cost |
| **11c** | Fix for an Asset Modder crash on any real-sized `.glb` |
| **12** | Ambient private traffic — prosperity as road friction |

Full detail per module in [status.md](status.md). Architectural rules in
[architecture.md](architecture.md). The IA taxonomy is
[module-11-studio-and-ia.md](module-11-studio-and-ia.md).

---

## 2. Read this before designing the save format

### 2.1 A save is state, not content — and the content schemas will lie to you

`src/content/schema.ts` now contains several **`.default()`** calls that are correct for
content and dangerous for a save:

```ts
congestionWeight: z.number().positive().default(1)   // VehicleDefSchema
channels: z.object({ ... }).default({})              // ProfileElementSchema
```

A default is right for hand-written content: `vehicles.json` should be allowed to omit a
field. It is wrong for a save, where a missing field means the save predates the field and
should be **rejected clearly** (which is exactly what `rebuild-plan.md` §6 Module 10
asks). If the save format reuses the content schemas, every `.default()` becomes a silent,
undeclared migration that produces a plausible-looking wrong state.

**Recommendation:** a separate `SaveState` schema with no defaults and a required
`version`.

### 2.2 Terrain is the only thing derivable from the seed — nothing else is

`generateMap(seed)` is deterministic (`test/map-determinism.test.ts` asserts it), so a
save can store `seed` and regenerate the ~7k terrain floats rather than serialising them.

Everything else has drifted from the seed by save time and **must** be stored:

- authored corridors, segments and nodes (`commitCorridor`)
- promoted `node.kind` (`applyPromotion` mutates in place)
- decayed `segment.condition` (`decaySegments` mutates in place)
- **`segment.profileId`** — see below

### 2.3 Fields added by this branch that a save must carry

| Field | Added in | What breaks if you drop it |
| --- | --- | --- |
| `Segment.profileId?: string` | 11b | Every corridor silently reverts to the inherited default cross-section — wrong width, wrong decay rate, wrong cost basis. Renders fine, which is what makes it nasty. |
| `VehicleDef.congestionWeight` | 11 | Every vehicle weighs 1 again; an okada occupies the same road space as a BRT. |
| `VehicleDef.mesh` / `.anchors` | 11 | Mod vehicles lose their model. |
| `EraModifiers.ambientTraffic` | 12 | Roads render empty; the whole prosperity loop is off. |

### 2.4 `SimulationState` gained four fields — three are derived, one is not

```ts
ambientGeometry: AmbientGeometry            // derived from map topology
segmentLoads: Map<string, number>           // derived, per tick
ambientLoads: Map<string, number>           // derived, per tick
routing: RoutingContext                     // derived (pre-existing)
```

**None of these belong in a save.** They are all rebuilt: `routing` and `ambientGeometry`
by `rebuildFromMap(state, map)`, the two load maps by the next `tick()`. Serialising them
would bloat the save and create a second source of truth for something the engine already
recomputes.

**Call `rebuildFromMap(state, map)` after loading a map**, not `buildRoutingContext`
directly. It sets `map`, `routing` and `ambientGeometry` together. `render/fleet.ts` used
to set routing by hand at two call sites; that was consolidated precisely so a third
derived cache could not be forgotten. A stale `ambientGeometry` is the quiet kind of
wrong — traffic keeps clustering around a settlement that has since been pruned away from.

---

## 3. `tick()` changed signature — this matters for warm-forward

```ts
tick(state, dt, economy?, paratransit?, eraModifiers?, growth?, profileDecayById?)
```

Every argument after `dt` is optional, so existing calls still compile. But a
**warm-forward that omits them silently warms the wrong world**:

- omit `eraModifiers` → no era demand/fuel/decay scaling, and **no ambient traffic at all**
- omit `growth` → no demand growth, so settlements never develop and `D` stays at 1
- omit `profileDecayById` → every segment decays at the base rate regardless of profile

For a scenario warm-forward to mean anything, pass all of them. The values come from
`main.ts`: `currentEra(eraTimeline).modifiers` and `profileCatalog.decayMultipliers`.

**A design question worth deciding rather than discovering:** warm-forward runs real
ticks, so it also runs paratransit spawning and growth. That is almost certainly what you
want — warming to the Informal era should produce an informal sector that actually exists
— but it means a warmed scenario is **not reproducible from its JSON alone** unless the
spawn path is seeded. `trySpawnParatransit` currently derives vehicle ids from
`paratransit.elapsedSeconds`, which is deterministic; nothing else in the tick path uses
randomness. Worth confirming before relying on it.

---

## 4. Where merge conflicts are likely

| File | Why |
| --- | --- |
| `src/content/schema.ts` | Heavily appended (profiles, anchors, congestion weight). `ScenarioSchema` itself is **untouched** and sits exactly where it was — profile schemas were appended *after* it. |
| `src/main.ts` | Substantially rewritten (selection store, overlays, inspector, profile catalog, ambient traffic). Bootstrap changes for `applyScenario` / `window.dev` land here. |
| `src/engine/simulation/simulate.ts` | New `rebuildFromMap` export, new `tick` parameter, ambient load merge. |
| `src/engine/simulation/types.ts` | Four new `SimulationState` fields. |
| `public/content/eras.json` | One field appended per era, inline — four-line diff. |

Everything else added new files rather than editing existing ones.

---

## 5. Already done, so don't rebuild it

- **`ScenarioSchema`** exists and validates. The studio's **Scenario Lab** tab
  (`src/dev/ScenarioLab.tsx`) already authors a `Scenario` live-validated against it and
  exports it as JSON. What is missing is `applyScenario` — nothing consumes
  `warmForwardDays` yet.
- **`?studio=1`** already has a tabbed shell. A `window.dev` console API is a separate
  surface, but if you want it as a tab, `src/dev/Studio.tsx` takes one more entry in
  `TABS` plus one string in `scripts/verify-prod-bundle.mjs`.
- **`scripts/verify-prod-bundle.mjs` carries one forbidden string per dev-only surface.**
  Adding a studio tab means adding a string there, or the dev-only gate stops being an
  assertion against the built bundle and becomes a promise about a code path.

---

## 6. Two known limitations, both recorded and neither a blocker

1. **Sleepers sweep as a continuous band, not discrete cross-ties.** A swept cross-section
   cannot express repetition along the alignment; discrete ties would need instanced
   geometry. Fine at the diorama's middle-distance register.
2. **Ambient traffic is uncalibrated.** The era factors are starting points from the design
   table, and no one has yet played a real Modern-era game with grown settlements — which
   needs a warm-forward, i.e. Module 10. Expect to tune `eras.json`'s `ambientTraffic`
   once that exists. It is content precisely so tuning needs no code change.
