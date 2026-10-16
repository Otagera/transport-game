import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
// @ts-expect-error -- plain .mjs dev-server plugin, no types to import
import { studioModWriter } from "./scripts/studio-mod-writer.mjs";

// Preact JSX, configured at the bundler rather than per-file: the only
// .tsx in the tree is dev-only studio UI (src/dev/), which is dynamically
// imported behind `import.meta.env.DEV` and therefore absent from the
// production bundle -- the transform setting costs the shipped build
// nothing. `automatic` runtime means no `h` import in every component.
export default defineConfig({
  plugins: [studioModWriter()],
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
  },
  // Two pages: the original game (index.html) and the slice (slice.html,
  // docs/principles.md §6).
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        slice: fileURLToPath(new URL("./slice.html", import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("./src/engine", import.meta.url)),
      "@content": fileURLToPath(new URL("./src/content", import.meta.url)),
      "@render": fileURLToPath(new URL("./src/render", import.meta.url)),
      "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
      "@dev": fileURLToPath(new URL("./src/dev", import.meta.url)),
    },
  },
});
