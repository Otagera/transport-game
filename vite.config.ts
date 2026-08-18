import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// Preact JSX, configured at the bundler rather than per-file: the only
// .tsx in the tree is dev-only studio UI (src/dev/), which is dynamically
// imported behind `import.meta.env.DEV` and therefore absent from the
// production bundle -- the transform setting costs the shipped build
// nothing. `automatic` runtime means no `h` import in every component.
export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic", importSource: "preact" },
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
