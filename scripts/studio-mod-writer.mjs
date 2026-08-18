import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// A dev-server-only endpoint that lets the Asset Modder tab write a mod
// package to disk. `apply: "serve"` keeps it out of `vite build` entirely,
// so this is not a "gated at runtime" path -- it does not exist in a
// production build at all.
//
// The browser alternative is a download, which the tab still offers as a
// fallback. But a download lands in ~/Downloads and then has to be
// unzipped into the right directory by hand, which is exactly the
// error-prone step the studio exists to remove: an authored mod should be
// loadable the moment it is exported.
const MOD_ROOT = resolve(process.cwd(), "public", "mods");
const MAX_BYTES = 32 * 1024 * 1024;
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function studioModWriter() {
  return {
    name: "studio-mod-writer",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__studio/write-mod", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }

        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.statusCode = 413;
            res.end("mod package too large");
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });

        req.on("end", () => {
          if (res.writableEnded) return;
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            // The mod id becomes a directory name, so it is validated
            // against an allowlist rather than sanitised -- a rejected id
            // is a clear error, a sanitised one silently writes somewhere
            // the author did not intend.
            if (!SAFE_ID.test(payload.modId ?? "")) {
              res.statusCode = 400;
              res.end("modId must be lowercase alphanumeric with dashes");
              return;
            }

            const dir = join(MOD_ROOT, payload.modId);
            if (!dir.startsWith(MOD_ROOT)) {
              res.statusCode = 400;
              res.end("refused: path escapes public/mods");
              return;
            }
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, "vehicle.json"), JSON.stringify(payload.vehicle, null, 2));
            if (payload.meshBase64 && payload.meshName) {
              writeFileSync(join(dir, payload.meshName), Buffer.from(payload.meshBase64, "base64"));
            }

            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, path: `public/mods/${payload.modId}/` }));
          } catch (error) {
            res.statusCode = 400;
            res.end(String(error));
          }
        });
      });
    },
  };
}
