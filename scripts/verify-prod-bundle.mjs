// Module 1 requires the tuning panel (and its Preact dependency) to be
// verified absent from the production bundle, not just gated by a runtime
// check. Module 11 grew that panel into the four-tab dev studio, so each
// studio surface contributes a string here: "the studio is dev-only" is an
// assertion against the built bundle, not a promise about a code path.
// Run after `vite build`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const distAssets = join(process.cwd(), "dist", "assets");
const forbidden = [
  "preact",
  "Export JSON",
  "installGreyscaleTest",
  "mountStudio",
  "Scenario Lab",
  "Profile Studio",
  "Asset Modder",
  "GLTFLoader",
  "__studio/write-mod",
  "crossSectionOutline",
  "PROFILE_PRESETS",
  "STYLE_FIELDS",
];

const files = readdirSync(distAssets).filter((file) => file.endsWith(".js"));
if (files.length === 0) {
  console.error("No JS assets found in dist/assets -- did the build run first?");
  process.exit(1);
}

let failed = false;
for (const file of files) {
  const content = readFileSync(join(distAssets, file), "utf8");
  for (const term of forbidden) {
    if (content.includes(term)) {
      console.error(`FAIL: "${term}" found in ${file} -- dev-only code leaked into the production bundle`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log("OK: no dev-only strings found in the production bundle");
