# dev/

The dev studio: `?studio=1` (with `?tune=1` kept as an alias that opens the Tuning tab).
Everything here is dev-only and must never ship in the production bundle.

- **Gate:** reachable only through the single dynamic-import branch in `src/main.ts`'s
  `maybeMountDevTools`, which is guarded by `import.meta.env.DEV`. In a production build
  that constant folds to `false` and Rollup drops the whole branch — Preact included.
- **Assertion, not promise:** `scripts/verify-prod-bundle.mjs` greps the built bundle for
  a string belonging to each studio surface. Adding a tab means adding a string there.
- **Preact + JSX**, configured at the bundler (`oxc.jsx` in `vite.config.ts`) and matched
  in `tsconfig.json`. `.tsx` exists nowhere else in the tree.

Tabs:

| Tab | File | Authors |
| --- | --- | --- |
| Tuning | `TuningTab.tsx` + `styleFields.ts` | the Module 1 `StyleSpec` |
| Profile Studio | `ProfileStudio.tsx` | `Profile2DDef` road/rail cross-sections |
| Asset Modder | `AssetStudio.tsx` | `VehicleDef` + a `.glb` mesh, as a mod package |
| Scenario Lab | `ScenarioLab.tsx` | `Scenario` |

Every export is Zod-validated against `src/content/schema.ts` before it leaves the tab.
See [docs/architecture/dev-studio.md](../../docs/architecture/dev-studio.md).
