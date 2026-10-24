// A site, see-through (your idea after april-zhu.com/colorfigures, 2026-10-24): the plant
// drawn as a machine, from live numbers, so a chain reads as a thing working or stuck rather
// than a column of percentages. What comes in (piped from its source, flowing as fast as it
// arrives), the plant (filled to what it makes of what it could, its shift standing at the
// gate), what goes out (a lane to each town: flowing when it's carried, dashed when it waits,
// red when no road or tanker reaches). Whatever holds it back glows amber, and says so.
//
// Pure: data in, an SVG string out. The panel redraws often; each flow's dashes keep their
// phase from the clock (a negative delay), so a redraw doesn't restart them.

export interface FigureInput {
  name: string;
  from: string;
  /** Arriving of what it could use, 0..1. */
  share: number;
}

export interface FigureOutput {
  to: string;
  perDay: number;
  /** Carried of what's sent, 0..1. */
  carried: number;
  state: "moving" | "waiting" | "far" | "noroad";
}

export interface FigureData {
  product: string;
  /** Makes of what it could, 0..1; and the tonnes a day. */
  running: number;
  madePerDay: number;
  /** Its shift, 0..1; null for a site with none. */
  staffing: number | null;
  limit: "idle" | "input" | "workers" | "capacity";
  inputs: FigureInput[];
  outputs: FigureOutput[];
  /** What the caption says is stuck, or "" when nothing is. */
  stuck: string;
  /** A refinery or tank farm gets its chimneys and tanks; everything else a works shed. */
  kind: "refinery" | "works";
}

const W = 360;
const H = 212;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const short = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Dashes that move: faster the more flows; still (and grey) at none. Phase kept from the clock. */
function flowing(path: string, share: number, color: string, width: number, nowMs: number): string {
  if (share <= 0.02) return `<path d="${path}" fill="none" stroke="var(--line)" stroke-width="${width}" stroke-dasharray="3 5" stroke-linecap="round"/>`;
  const seconds = Math.max(0.35, 2.4 - 2 * Math.min(1, share));
  const delay = -((nowMs / 1000) % seconds);
  return `<path d="${path}" fill="none" stroke="${color}" stroke-opacity="0.25" stroke-width="${width + 3}" stroke-linecap="round"/>
    <path class="flow" d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-dasharray="6 8" stroke-linecap="round" style="animation-duration:${seconds.toFixed(2)}s;animation-delay:${delay.toFixed(2)}s"/>`;
}

export function siteFigure(d: FigureData, nowMs: number): string {
  const amber = "var(--warn)";
  const plant = { x: 126, y: 72, w: 100, h: 70 };
  const parts: string[] = [];

  // In: one pipe for each input, into the plant's left side.
  const inputs = d.inputs.slice(0, 2);
  inputs.forEach((input, i) => {
    const y = plant.y + 22 + i * 24;
    const short_ = d.limit === "input" && i === 0;
    parts.push(flowing(`M 14 ${y} L ${plant.x} ${y}`, input.share, short_ ? amber : "var(--goods)", 4, nowMs));
    parts.push(`<text x="14" y="${y - 8}" class="t">${esc(short(input.name, 10))} · ${esc(short(input.from))}</text>`);
    parts.push(`<text x="14" y="${y + 15}" class="t ${short_ ? "warn" : "muted"}">${Math.round(input.share * 100)}% of what it can use</text>`);
  });

  // The plant: an isometric block, its tank filled to what it makes of what it could.
  const { x, y, w, h } = plant;
  const top = `M ${x} ${y} L ${x + w / 2} ${y - 16} L ${x + w} ${y} L ${x + w / 2} ${y + 16} Z`;
  parts.push(`<path d="${top}" fill="var(--surface)" stroke="var(--ink-2)" stroke-width="1.2"/>`);
  parts.push(`<path d="M ${x} ${y} L ${x} ${y + h} L ${x + w / 2} ${y + h + 16} L ${x + w / 2} ${y + 16} Z" fill="var(--surface-2)" stroke="var(--ink-2)" stroke-width="1.2"/>`);
  parts.push(`<path d="M ${x + w / 2} ${y + 16} L ${x + w / 2} ${y + h + 16} L ${x + w} ${y + h} L ${x + w} ${y} Z" fill="var(--surface)" stroke="var(--ink-2)" stroke-width="1.2"/>`);
  // The gauge on its face: how full it runs.
  const gx = x + w / 2 + 10;
  const gh = h - 18;
  parts.push(`<rect x="${gx}" y="${y + 22}" width="14" height="${gh}" rx="3" fill="var(--surface-2)" stroke="var(--ink-2)" stroke-width="1"/>`);
  parts.push(`<rect x="${gx}" y="${y + 22 + gh * (1 - d.running)}" width="14" height="${gh * d.running}" rx="3" fill="${d.limit === "capacity" ? "var(--good)" : d.running > 0 ? "var(--goods)" : "var(--line)"}"/>`);
  parts.push(`<text x="${gx + 20}" y="${y + 34}" class="t">${Math.round(d.running * 100)}%</text>`);
  parts.push(`<text x="${gx + 20}" y="${y + 48}" class="t muted">${Math.round(d.madePerDay)} t/day</text>`);
  // Chimneys and tanks (a refinery), or a shed roof (a works); smoke while it runs.
  if (d.kind === "refinery") {
    for (const [cx, ch] of [[x + 18, 34], [x + 34, 26]] as const) {
      parts.push(`<rect x="${cx}" y="${y - ch}" width="9" height="${ch}" fill="var(--surface)" stroke="var(--ink-2)" stroke-width="1.2"/>`);
      if (d.running > 0.05) parts.push(`<circle class="smoke" cx="${cx + 4.5}" cy="${y - ch - 6}" r="5" fill="var(--line)" style="animation-delay:${(-((nowMs / 1000) % 2.4)).toFixed(2)}s"/>`);
    }
  } else {
    parts.push(`<path d="M ${x + 10} ${y - 6} L ${x + 26} ${y - 22} L ${x + 42} ${y - 6}" fill="none" stroke="var(--ink-2)" stroke-width="1.2"/>`);
    if (d.running > 0.05) parts.push(`<circle class="smoke" cx="${x + 26}" cy="${y - 30}" r="5" fill="var(--line)" style="animation-delay:${(-((nowMs / 1000) % 2.4)).toFixed(2)}s"/>`);
  }
  if (d.limit === "idle") parts.push(`<text x="${x + w / 2}" y="${y + h / 2 + 10}" class="t warn" text-anchor="middle">idle</text>`);
  // The shift at the gate: five figures, filled as full as it's staffed.
  if (d.staffing !== null) {
    const filled = Math.round(Math.max(0, Math.min(1, d.staffing)) * 5);
    for (let k = 0; k < 5; k += 1) {
      const px = x + 4 + k * 12;
      const fill = k < filled ? "var(--ink-2)" : "none";
      const stroke = d.limit === "workers" ? amber : "var(--ink-2)";
      parts.push(`<circle cx="${px + 4}" cy="${y + h + 26}" r="2.6" fill="${fill}" stroke="${stroke}"/><path d="M ${px} ${y + h + 36} Q ${px + 4} ${y + h + 28} ${px + 8} ${y + h + 36}" fill="${fill}" stroke="${stroke}"/>`);
    }
    parts.push(`<text x="${x + 66}" y="${y + h + 35}" class="t ${d.limit === "workers" ? "warn" : "muted"}">shift ${Math.round(d.staffing * 100)}%</text>`);
  }

  // Out: a lane to each town, fanning from the plant's right side.
  const outs = d.outputs.slice(0, 5);
  const sx = x + w;
  const sy = y + h / 2 + 8;
  outs.forEach((out, i) => {
    const ty = 30 + i * ((H - 70) / Math.max(1, outs.length - 1 || 1));
    const path = `M ${sx} ${sy} C ${sx + 40} ${sy} ${W - 110} ${ty} ${W - 96} ${ty}`;
    if (out.state === "far" || out.state === "noroad") {
      parts.push(`<path d="${path}" fill="none" stroke="var(--bad)" stroke-width="2.5" stroke-dasharray="2 5" stroke-linecap="round"/>`);
      parts.push(`<text x="${W - 92}" y="${ty + 4}" class="t bad">✕ ${esc(short(out.to, 11))}</text>`);
      parts.push(`<text x="${W - 92}" y="${ty + 16}" class="t bad small">${out.state === "far" ? "out of reach" : "no road"}</text>`);
    } else {
      parts.push(flowing(path, out.carried, out.state === "waiting" ? amber : "var(--informal)", 3, nowMs));
      parts.push(`<text x="${W - 92}" y="${ty + 4}" class="t">${esc(short(out.to, 11))} ${Math.round(out.perDay)}t</text>`);
      parts.push(`<text x="${W - 92}" y="${ty + 16}" class="t ${out.state === "waiting" ? "warn" : "muted"} small">${Math.round(out.carried * 100)}% carried</text>`);
    }
  });
  if (d.outputs.length > outs.length) parts.push(`<text x="${W - 92}" y="${H - 10}" class="t muted small">and ${d.outputs.length - outs.length} more</text>`);
  parts.push(`<text x="${x + w / 2}" y="${H - 6}" class="t muted" text-anchor="middle">${esc(d.product)}</text>`);

  return `<figure class="seethrough"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="How this site is working">${parts.join("")}</svg>${d.stuck ? `<figcaption class="warn">${esc(d.stuck)}</figcaption>` : `<figcaption class="muted">Running as it should.</figcaption>`}</figure>`;
}
