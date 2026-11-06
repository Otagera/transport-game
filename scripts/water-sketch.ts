// A probe, not the generator: water drawn first, by region, varied by seed -- to judge by eye
// whether maps stop looking alike before any of it goes into region.ts. Water only, plus where
// the home city would stand. bun water-sketch.ts out.html
import { writeFileSync } from "node:fs";

type P = [number, number];
interface River { pts: P[]; widths: number[]; kind: "big" | "river" | "creek" }
interface Water { region: string; shape: string; coast: P[] | null; rivers: River[]; lakes: Array<{ x: number; y: number; rx: number; ry: number }>; city: { p: P; why: string } }

const W = 250, H = 160;
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const between = (r: () => number, a: number, b: number) => a + (b - a) * r();

/** A river from a to b in unit space: meanders swinging smoothly, width from w0 to w1. */
function meander(r: () => number, a: P, b: P, w0: number, w1: number, swing = 0.06): River {
  const n = 24, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
  const phase = r() * 6.28, f1 = between(r, 2, 4), f2 = between(r, 5, 9), amp2 = between(r, 0.2, 0.5);
  const pts: P[] = [], widths: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, env = Math.sin(Math.PI * t);
    const off = swing * len * env * (Math.sin(phase + f1 * 6.28 * t) + amp2 * Math.sin(phase * 2 + f2 * 6.28 * t));
    pts.push([a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off]);
    widths.push(w0 + (w1 - w0) * t);
  }
  return { pts, widths, kind: w1 >= 3 ? "big" : w1 >= 1.8 ? "river" : "creek" };
}
const at = (rv: River, t: number): P => rv.pts[Math.round(t * (rv.pts.length - 1))]!;
/** The coast, in unit space with the sea below y = depth(x): bays and headlands. */
function coastLine(r: () => number, base: number): P[] {
  const out: P[] = []; let d = base;
  for (let x = -0.05; x <= 1.05; x += 0.04) { d = Math.max(base - 0.07, Math.min(base + 0.07, d + between(r, -0.025, 0.025))); out.push([x, d]); }
  return out;
}

// Each region's kinds of water (Nigeria's, as characters, not one layout), in unit space with the sea (if any) at the bottom.
function southwest(r: () => number): Omit<Water, "region"> {
  const shore = coastLine(r, between(r, 0.86, 0.92));
  const lagoonY = shore[Math.floor(shore.length / 2)]![1] - 0.06;
  const lagoon = meander(r, [-0.05, lagoonY], [1.05, lagoonY + between(r, -0.03, 0.03)], 2.4, 2.4, 0.01);
  const rivers = [lagoon];
  const n = 2 + Math.floor(r() * 2);
  for (let k = 0; k < n; k++) { const x = between(r, 0.1, 0.9); rivers.push(meander(r, [x + between(r, -0.2, 0.2), between(r, -0.05, 0.3)], [x, lagoonY], 1.2, k === 0 ? 3 : 2)); }
  const style = r();
  const city = style < 0.5 ? { p: at(lagoon, between(r, 0.3, 0.7)), why: "on the lagoon (Lagos)" } : style < 0.8 ? { p: at(rivers[1]!, 0.75), why: "on a river near the coast" } : { p: at(rivers[1]!, 0.35), why: "inland, by a river (Ibadan)" };
  return { shape: "coast with a lagoon behind it", coast: shore, rivers, lakes: [], city };
}
function southsouth(r: () => number): Omit<Water, "region"> {
  const shore = coastLine(r, between(r, 0.8, 0.88));
  const apex: P = [between(r, 0.35, 0.65), between(r, 0.35, 0.5)];
  const trunk = meander(r, [apex[0] + between(r, -0.25, 0.25), -0.05], apex, 3, 4.5);
  const rivers = [trunk];
  const arms = 4 + Math.floor(r() * 3);
  for (let k = 0; k < arms; k++) { const x = apex[0] + (k / (arms - 1) - 0.5) * between(r, 0.6, 0.9); rivers.push(meander(r, apex, [x, 0.95], 2.4, 1.6, 0.04)); }
  for (let k = 0; k < 4; k++) { const a = at(rivers[1 + Math.floor(r() * arms)]!, between(r, 0.5, 0.9)), b = at(rivers[1 + Math.floor(r() * arms)]!, between(r, 0.5, 0.9)); rivers.push(meander(r, a, b, 1, 1, 0.08)); }
  const city = r() < 0.6 ? { p: at(rivers[1 + Math.floor(arms / 2)]!, 0.7), why: "in the delta, on a creek (Port Harcourt)" } : { p: apex, why: "at the delta's head (Onitsha)" };
  return { shape: "a delta fanning to the sea", coast: shore, rivers, lakes: [], city };
}
function southeast(r: () => number): Omit<Water, "region"> {
  const shore = coastLine(r, between(r, 0.9, 0.95));
  const fromLeft = r() < 0.5;
  const big = meander(r, [fromLeft ? -0.05 : 1.05, between(r, 0.05, 0.3)], [between(r, 0.3, 0.7), 0.95], 3, 5, 0.05);
  const rivers = [big];
  for (let k = 0; k < 3; k++) rivers.push(meander(r, [between(r, 0, 1), between(r, -0.05, 0.4)], at(big, between(r, 0.3, 0.8)), 1.2, 2.2));
  const city = r() < 0.5 ? { p: at(big, 0.92), why: "on the estuary (Calabar)" } : { p: at(big, between(r, 0.4, 0.6)), why: "a river port on the big river" };
  return { shape: "a big river the map's length to an estuary", coast: shore, rivers, lakes: [], city };
}
function middleBelt(r: () => number): Omit<Water, "region"> {
  const meet: P = [between(r, 0.3, 0.7), between(r, 0.3, 0.7)];
  const a = meander(r, [between(r, -0.05, 0.3), -0.05], meet, 3, 4);
  const b = meander(r, [1.05, between(r, 0, 0.6)], meet, 3, 4);
  const exitSide = r();
  const out: P = exitSide < 0.5 ? [between(r, 0.2, 0.8), 1.05] : [-0.05, between(r, 0.5, 1)];
  const on = meander(r, meet, out, 5, 5.5);
  const rivers = [a, b, on];
  for (let k = 0; k < 2; k++) rivers.push(meander(r, [between(r, 0, 1), between(r, 0, 1)], at(rivers[Math.floor(r() * 3)]!, between(r, 0.3, 0.8)), 1, 2));
  const city = r() < 0.6 ? { p: meet, why: "at the confluence (Lokoja)" } : { p: at(b, 0.5), why: "on one of the two rivers (Makurdi)" };
  return { shape: "two big rivers meeting in a Y", coast: null, rivers, lakes: r() < 0.5 ? [{ x: between(r, 0.15, 0.85), y: between(r, 0.15, 0.85), rx: 0.06, ry: 0.035 }] : [], city };
}
function north(r: () => number): Omit<Water, "region"> {
  const corner: P = [r() < 0.5 ? 0.1 : 0.9, r() < 0.5 ? 0.15 : 0.85];
  const lake = { x: corner[0], y: corner[1], rx: between(r, 0.1, 0.16), ry: between(r, 0.08, 0.14) };
  const rivers: River[] = [];
  const feeders = 1 + Math.floor(r() * 2);
  for (let k = 0; k < feeders; k++) rivers.push(meander(r, [1 - corner[0] + between(r, -0.15, 0.15), between(r, 0, 1)], corner, 1, 2.4, 0.07));
  if (r() < 0.6) rivers.push(meander(r, [between(r, 0.2, 0.8), -0.05], [between(r, 0.2, 0.8), 1.05], 1.4, 2, 0.05));
  const city = r() < 0.4 ? { p: at(rivers[0]!, 0.5), why: "on the one river" } : r() < 0.7 ? { p: [lake.x + (0.5 - lake.x) * 0.45, lake.y + (0.5 - lake.y) * 0.45] as P, why: "by the lake (Maiduguri)" } : { p: [between(r, 0.35, 0.65), between(r, 0.35, 0.65)], why: "inland, off the water (Kano)" };
  return { shape: "a dry plain, a lake basin, a river or two", coast: null, rivers, lakes: [lake], city };
}
const REGIONS: Record<string, (r: () => number) => Omit<Water, "region">> = { southwest, southsouth, southeast, middleBelt, north };

/** The seed's region (evenly), its water in unit space, then turned: the sea on any side, the rivers any way. */
function sketch(seed: number): Water & { turn: number; flip: boolean } {
  const r = rng(seed * 7919 + 13);
  const names = Object.keys(REGIONS);
  const region = names[Math.floor(r() * names.length)]!;
  const w = REGIONS[region]!(r);
  // Turned a quarter at a time and mirrored at will: the coast at the bottom, a side, or (rarely) the top.
  const turn = [0, 0, 1, 3, 2][Math.floor(r() * 5)]!;
  const flip = r() < 0.5;
  return { region, ...w, turn, flip };
}
function place(p: P, turn: number, flip: boolean): P {
  let [x, y] = p; if (flip) x = 1 - x;
  for (let k = 0; k < turn; k++) [x, y] = [1 - y, x];
  return [x * W, y * H];
}

const seeds = process.argv.slice(3).map(Number);
const list = seeds.length ? seeds : [8703, 2418, 949, 3218, 7585, 5059, 1201, 4420, 6633, 9187, 3305, 7741];
const svg = (s: number) => {
  const w = sketch(s);
  const pl = (p: P) => place(p, w.turn, w.flip).map((v) => v.toFixed(1)).join(",");
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#e9dfb9"/>`];
  if (w.coast) {
    const sea = [...w.coast, [1.05, 1.2] as P, [-0.05, 1.2] as P];
    parts.push(`<polygon points="${sea.map(pl).join(" ")}" fill="#8fb6dc"/>`);
  }
  for (const l of w.lakes) { const c = place([l.x, l.y], w.turn, w.flip); const sw = w.turn % 2 === 1; parts.push(`<ellipse cx="${c[0]}" cy="${c[1]}" rx="${(sw ? l.ry * H : l.rx * W).toFixed(1)}" ry="${(sw ? l.rx * W : l.ry * H).toFixed(1)}" fill="#8fb6dc"/>`); }
  for (const rv of w.rivers) for (let i = 1; i < rv.pts.length; i++) parts.push(`<line x1="${pl(rv.pts[i - 1]!).split(",")[0]}" y1="${pl(rv.pts[i - 1]!).split(",")[1]}" x2="${pl(rv.pts[i]!).split(",")[0]}" y2="${pl(rv.pts[i]!).split(",")[1]}" stroke="#8fb6dc" stroke-width="${(rv.widths[i]! * 1.3).toFixed(2)}" stroke-linecap="round"/>`);
  const c = place(w.city.p, w.turn, w.flip);
  parts.push(`<circle cx="${c[0]}" cy="${c[1]}" r="4.5" fill="#1f5fa8" stroke="#fff" stroke-width="1.5"/>`);
  return `<figure><svg viewBox="0 0 ${W} ${H}" width="560" height="${(560 * H) / W}">${parts.join("")}</svg><figcaption>seed ${s} · <b>${w.region}</b> · ${w.shape} · home city ${w.city.why}</figcaption></figure>`;
};
writeFileSync(process.argv[2]!, `<!doctype html><meta charset="utf-8"><style>body{font:13px system-ui;background:#ddd;margin:8px;display:grid;grid-template-columns:repeat(3,560px);gap:8px}figure{margin:0;background:#fff;padding:4px}figcaption{padding:4px 2px}</style>${list.map(svg).join("")}`);
console.log("wrote", process.argv[2]);
