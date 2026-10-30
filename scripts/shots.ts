// The five screens, captured on demand (docs/architecture/look.md §9: it measures, it does not
// gate): the map, a town picked, the revenue screen, the term's pledges, and the 3D view -- at
// 1600x1000, twice over, the way the look was settled (seed 0, a few days in). Starts its own dev
// server, headless (never a window on your desktop), and writes PNGs to shots/ (not in git).
//
//   bun scripts/shots.ts [seed]        # default seed 0
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const ROOT = new URL("..", import.meta.url).pathname;
const seed = process.argv[2] ?? "0";
const PORT = 5198;
const OUT = `${ROOT}shots`;
mkdirSync(OUT, { recursive: true });

const server = spawn("bunx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const stop = () => server.kill();
process.on("exit", stop);

const { chromium } = createRequire(`${ROOT}package.json`)("playwright-core");
for (let tries = 0; ; tries += 1) {
  try {
    await fetch(`http://localhost:${PORT}/`);
    break;
  } catch {
    if (tries > 60) throw new Error("the dev server didn't start");
    await new Promise((r) => setTimeout(r, 500));
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on("pageerror", (e: Error) => errors.push(e.message));
await page.addInitScript((s: string) => {
  try {
    localStorage.setItem(`game:handover:${s}`, "1");
  } catch {
    // fine: the handover shows, and the first shot is taken after it's closed
  }
}, seed);
await page.goto(`http://localhost:${PORT}/?seed=${seed}`);
await page.waitForFunction(() => !document.querySelector("#loading"), null, { timeout: 120_000 });
await page.waitForTimeout(800);
await page.keyboard.press("Escape");
// A few days in, then held still for every shot.
await page.keyboard.press("3");
await page.waitForTimeout(8000);
await page.keyboard.press("Space");
const shot = async (name: string) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`shots/${name}.png`);
};

await shot("1-map");
await page.click("#panel button[data-tab=towns]");
await page.click("#panel tr.row");
await shot("2-town");
await page.click("button[data-revenue=open]");
await shot("3-revenue");
await page.click("button[data-revenue=close]");
await page.click("button[data-verdict=pledges]");
await shot("4-pledges");
await page.click("#verdict [data-verdict=close]");
await page.click("#zoom-control button[data-zoom='3d']");
await page.waitForTimeout(6000);
await shot("5-3d");

await browser.close();
stop();
if (errors.length) {
  console.error(`page errors:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
