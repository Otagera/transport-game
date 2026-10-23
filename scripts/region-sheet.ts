// A contact sheet of generated maps, to judge the generator by eye: each seed's
// map as a new game starts it (sites placed, no warm-up), terrain cell by cell,
// roads and track along their corridors, towns by size, sites as squares, the
// home box outlined. Not part of the shipped app.
//
//   bun scripts/region-sheet.ts out.html [seed ...]
//
// Open the page, or screenshot it (scripts in the scratchpad do).
import { writeFileSync } from "node:fs";
import { GAME_MAP } from "../src/game/map";
import { startRun } from "../src/engine/game/runlog";

const [out = "region-sheet.html", ...rest] = process.argv.slice(2);
const seeds = rest.length > 0 ? rest.map(Number) : [4882, 3, 11, 17, 42, 101, 256, 777, 1234, 2411, 2418, 9001];

const maps = seeds.map((seed) => {
  const w = startRun(GAME_MAP, seed, { all: false, goodsOff: false, wearOff: false }, null, { maxEmergentTowns: 0, warmUpDays: 0 });
  const { terrain, corridors, segments } = w.simulation.map;
  const highest = terrain.elevation.reduce((top, e) => Math.max(top, e), 0) || 1;
  const kind = new Map(segments.map((s) => [s.corridorId, s.type]));
  return {
    seed,
    width: terrain.width,
    height: terrain.height,
    home: w.home ?? null,
    port: w.port ?? null,
    water: Buffer.from(terrain.water).toString("base64"),
    height8: Buffer.from(terrain.elevation.map((e) => Math.round((e / highest) * 255))).toString("base64"),
    lines: corridors.map((c) => ({ rail: kind.get(c.id) === "rail", points: c.polyline.map((p) => [p.x, p.y]) })),
    towns: [...w.towns.values()].map((t) => ({ name: t.name, x: t.x, y: t.y, population: t.population, site: t.industry ?? null })),
  };
});

const page = `<!doctype html><meta charset="utf-8"><title>Region sheet</title>
<style>body{margin:0;background:#e9e7e1;font:12px system-ui}main{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:8px}figure{margin:0;background:#fff}figcaption{padding:2px 6px}canvas{width:100%;display:block}</style>
<main></main><script>
const maps = ${JSON.stringify(maps)};
const S = 4;
for (const m of maps) {
  const fig = document.createElement("figure");
  const c = document.createElement("canvas");
  c.width = m.width * S; c.height = m.height * S;
  const g = c.getContext("2d");
  const water = Uint8Array.from(atob(m.water), (ch) => ch.charCodeAt(0));
  const h = Uint8Array.from(atob(m.height8), (ch) => ch.charCodeAt(0));
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const i = y * m.width + x;
    if (water[i]) g.fillStyle = "#a9c8e4"; else { const v = 246 - h[i] * 0.35; g.fillStyle = "rgb(" + v + "," + (v - 2) + "," + (v - 10) + ")"; }
    g.fillRect(x * S, y * S, S, S);
  }
  if (m.home) { g.strokeStyle = "#c33"; g.setLineDash([6, 4]); g.strokeRect(m.home.x * S, m.home.y * S, m.home.width * S, m.home.height * S); g.setLineDash([]); }
  for (const l of m.lines) {
    g.strokeStyle = l.rail ? "#6b4a2b" : "#888"; g.lineWidth = l.rail ? 2.5 : 1.5;
    g.beginPath(); l.points.forEach(([x, y], k) => (k ? g.lineTo : g.moveTo).call(g, x * S, y * S)); g.stroke();
  }
  g.font = "11px system-ui"; g.textAlign = "center";
  for (const t of m.towns) {
    if (t.site) { g.fillStyle = "#c0782b"; g.fillRect(t.x * S - 4, t.y * S - 4, 8, 8); g.fillStyle = "#7a4a14"; g.fillText(t.site, t.x * S, t.y * S + 14); continue; }
    const r = 2 + Math.sqrt(t.population) / 2;
    g.fillStyle = t.name && m.port && t.name.toLowerCase().replace(/[^a-z]/g, "") === m.port.replace(/[^a-z]/g, "") ? "#1f5fa8" : "#333";
    g.beginPath(); g.arc(t.x * S, t.y * S, r, 0, 7); g.fill();
    g.fillText(t.name + " " + Math.round(t.population) + "k", t.x * S, t.y * S - r - 3);
  }
  const cap = document.createElement("figcaption"); cap.textContent = "seed " + m.seed + "  (" + m.width + "x" + m.height + ")";
  fig.append(c, cap); document.querySelector("main").append(fig);
}
</script>`;
writeFileSync(out, page);
console.log(`${out}: ${seeds.length} maps`);
