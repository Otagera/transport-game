import type { GameWorld } from "@engine/game/types";
import { segmentPolyline } from "@engine/game/roads";

// Then and now (docs/brief.md, Revision 5, step 4 rebuilt): beside the correspondent's letter,
// the region on day 1 drawn faint under today's -- the inherited roads and the old line as you
// found them, what you built and paved over them, each town's size now with a ring for its size
// on day 1 -- and the places the letter names pinned. The letter and the picture tell the same
// thing twice. Read off today's map: every road piece carries whether it was inherited or built
// (`provenance`, kept when a town or station splits it), and the towns' day-1 sizes are kept
// (`world.startPopulation`). Nothing stored for it.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The SVG, `width` pixels wide; `pins`, the places the letter names. */
export function thenAndNowSvg(world: GameWorld, pins: string[], width = 460): string {
  const map = world.simulation.map;
  const scale = width / world.width;
  const height = Math.round(world.height * scale);
  const path = (points: Array<{ x: number; y: number }>) => points.map((p, i) => `${i ? "L" : "M"}${(p.x * scale).toFixed(1)} ${(p.y * scale).toFixed(1)}`).join("");
  // The rivers, for where things are (the sea's edge as wide as it's drawn).
  const water = (world.waterLines ?? []).map((river) => `<path class="tn-water" stroke-width="${Math.max(1, Math.min(...(river.widths ?? [river.width])) * scale).toFixed(1)}" d="${path(river.points.map(([x, y]) => ({ x, y })))}"/>`);
  const then: string[] = [];
  const now: string[] = [];
  for (const s of map.segments) {
    const d = path(segmentPolyline(map, s));
    if (s.type === "rail") {
      // The old line as you found it, faint; track running now, as track.
      if (s.provenance === "inherited") then.push(`<path class="tn-then-rail" d="${d}"/>`);
      if (!world.railOutOfService.has(s.id)) now.push(`<path class="tn-rail" d="${d}"/>`);
      continue;
    }
    if (s.retiredAt !== undefined) continue;
    if (s.provenance === "inherited") then.push(`<path class="tn-then" d="${d}"/>`);
    // Today: what you built, and what you paved (built or inherited).
    if (s.provenance === "built" || s.surface === "paved") now.push(`<path class="${s.surface === "paved" ? "tn-paved" : "tn-built"}" d="${d}"/>`);
  }
  const r = (k: number) => Math.max(1.6, Math.sqrt(Math.max(0, k)) * 0.55 * Math.sqrt(scale * 2));
  const towns = [...world.towns.values()].filter((t) => !t.industry);
  const dots = towns.map((t) => {
    const was = world.startPopulation.get(t.id);
    const [x, y] = [(t.x * scale).toFixed(1), (t.y * scale).toFixed(1)];
    // Its day-1 ring over today's dot: inside it where it grew, round it where it shrank.
    return `<circle class="tn-town${was === undefined ? " tn-new" : ""}" cx="${x}" cy="${y}" r="${r(t.population).toFixed(1)}"/>${was !== undefined ? `<circle class="tn-was${was > t.population ? " tn-shrank" : ""}" cx="${x}" cy="${y}" r="${r(was).toFixed(1)}"/>` : ""}`;
  });
  const pinned = [...new Set(pins)].map((id) => world.towns.get(id)).filter((t) => t !== undefined).map((t) => {
    const [x, y] = [t!.x * scale, t!.y * scale];
    // Its name on whichever side has room.
    const left = x > width * 0.7;
    const off = r(t!.population) + 5;
    return `<g class="tn-pin"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r(t!.population) + 3).toFixed(1)}"/><text x="${(left ? x - off : x + off).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${left ? "end" : "start"}">${esc(t!.name)}</text></g>`;
  });
  return `<figure class="thenandnow"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="The region on day 1 and now">
    <rect class="tn-land" width="${width}" height="${height}" rx="6"/>
    <g>${water.join("")}</g><g>${then.join("")}</g><g>${now.join("")}</g><g>${dots.join("")}</g><g>${pinned.join("")}</g>
  </svg><figcaption><span class="tn-key then"></span>as you found it <span class="tn-key built"></span>built <span class="tn-key paved"></span>paved <span class="tn-key rail"></span>track running · a ring is a town's size on day 1</figcaption></figure>`;
}
