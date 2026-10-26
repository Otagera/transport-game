import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
// The commit the game was built from, for run files (src/engine/game/runlog.ts):
// read when the dev server starts, so a long-running server reports where it began.
// A Coolify build has no .git; it passes the commit as SOURCE_COMMIT (see Dockerfile).
function gameBuild(): string {
  if (process.env.SOURCE_COMMIT) return process.env.SOURCE_COMMIT.slice(0, 7);
  try {
    const hash = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim() !== "";
    return dirty ? `${hash}-dirty` : hash;
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  define: { "import.meta.env.VITE_GAME_BUILD": JSON.stringify(gameBuild()) },
  // One page: the game (index.html). The 3D original was retired on 2026-10-23
  // (tag original-3d); the labs (design-lab.html, info-lab.html) are dev-only, never inputs.
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
      },
    },
  },
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("./src/engine", import.meta.url)),
    },
  },
});
