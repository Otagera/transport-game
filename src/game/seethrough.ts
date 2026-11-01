// A site, see-through (your idea after april-zhu.com/colorfigures, 2026-10-24; redrawn 2026-11-01
// from the two you picked of three, "flow bands" and "the process column"): read down the panel as
// the goods move. What comes in -- each input a bar filled to what arrives of what the plant could
// use, flowing down into it as thick as it arrives; the plant -- a dial of what it makes of what it
// could, its tonnes, its shift; and where it goes -- a trunk out of the plant as thick as it runs,
// a branch off it to each town as thick as the tonnes sent there, running on along that town's
// row as far as they're carried, the rest left as a track: amber where it waits for hauliers, red
// and dotted where no road or tanker reaches. Whatever holds it back is amber, and the caption
// says so.
//
// Pure: data in, an HTML string out (one SVG at the panel's width, so its words are the page's
// size). The panel redraws often; each flow's dashes keep their phase from the clock (a negative
// delay), so a redraw doesn't restart them.

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
  /** A refinery or tank farm, or a works (the old drawing's chimneys; not drawn since 2026-11-01). */
  kind: "refinery" | "works";
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const tons = (v: number) => (v >= 10 ? `${Math.round(v)}` : v >= 1 ? v.toFixed(1).replace(/\.0$/, "") : v > 0 ? "<1" : "0");
/** A flow's dash speed (faster the more flows) and its phase from the clock, so a redraw doesn't restart it. */
const pace = (share: number, nowMs: number) => {
  const seconds = Math.max(0.5, 2.6 - 2 * Math.min(1, share));
  return `animation-duration:${seconds.toFixed(2)}s;animation-delay:${(-((nowMs / 1000) % seconds)).toFixed(2)}s`;
};
const capacityOf = (d: FigureData) => (d.running > 0.01 ? d.madePerDay / d.running : 0);
const outColour = (o: FigureOutput) => (o.state === "far" || o.state === "noroad" ? "var(--bad)" : o.state === "waiting" ? "var(--warn)" : "var(--goods)");
const caption = (d: FigureData) => (d.stuck ? `<figcaption class="warn">${esc(d.stuck)}</figcaption>` : `<figcaption class="ok">Running as it should.</figcaption>`);

export function siteFigure(d: FigureData, nowMs: number): string {
  const W = 290, X = 54, END = W - 4, ROW = 36, TRUNK = 22;
  const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const p: string[] = [];
  let y = 0;
  const band = (path: string, width: number, colour: string, opacity = 1) => `<path d="${path}" fill="none" stroke="${colour}" stroke-width="${width.toFixed(1)}" stroke-opacity="${opacity}" stroke-linecap="butt" stroke-linejoin="round"/>`;
  const moving = (path: string, width: number, share: number) => (share > 0.02 && width >= 2 ? `<path class="flow" d="${path}" fill="none" stroke="var(--surface)" stroke-opacity="0.85" stroke-width="${Math.min(2, width / 2).toFixed(1)}" stroke-dasharray="2 9" style="${pace(share, nowMs)}"/>` : "");
  const tag = (text: string, at: number) => `<text x="${X}" y="${at + 9}" class="tag">${text}</text>`;

  // In.
  p.push(tag("In", y));
  y += 14;
  const inputs = d.inputs.slice(0, 3);
  const inTop = y;
  const inWidths = inputs.map((input) => 3 + 9 * Math.max(0, Math.min(1, input.share)));
  const plantTop = inTop + Math.max(1, inputs.length) * ROW + 10;
  const lanes = (widths: number[], from: number) => {
    let x = from;
    return widths.map((w) => { const c = x + w / 2; x += w; return c; });
  };
  const inLanes = lanes(inWidths, 26 - inWidths.reduce((s, w) => s + w, 0) / 2);
  inputs.forEach((input, i) => {
    const top = inTop + i * ROW, yc = top + 24;
    const warn = d.limit === "input" && i === 0;
    const colour = warn ? "var(--warn)" : "var(--goods)";
    p.push(`<text x="${X}" y="${top + 12}" class="t b">${esc(input.name)}${input.from ? ` <tspan class="m" font-weight="400">from ${esc(short(input.from, 20))}</tspan>` : ""}</text>`);
    p.push(`<text x="${END}" y="${top + 12}" class="t ${warn ? "warn" : ""}" text-anchor="end">${pct(input.share)}</text>`);
    // Its bar: the full length what the plant could use, filled to what arrives.
    p.push(`<rect x="${X}" y="${yc - 6}" width="${END - X}" height="12" rx="3" fill="var(--line)" fill-opacity="0.6"/>`);
    const fillTo = X + (END - X) * Math.max(0, Math.min(1, input.share));
    if (input.share > 0.01) p.push(`<rect x="${X}" y="${yc - 6}" width="${fillTo - X}" height="12" rx="3" fill="${colour}" fill-opacity="0.9"/>`, moving(`M ${X + 3} ${yc} L ${fillTo - 3} ${yc}`, 6, input.share));
    // Down into the plant, as thick as it arrives.
    const lx = inLanes[i]!, r = 8;
    const path = `M ${X} ${yc} L ${lx + r} ${yc} Q ${lx} ${yc} ${lx} ${yc + r} L ${lx} ${plantTop}`;
    p.push(band(path, inWidths[i]!, colour, input.share > 0.01 ? 0.85 : 0.3));
    p.push(moving(path, inWidths[i]!, input.share));
  });
  if (!inputs.length) {
    p.push(`<text x="${X}" y="${inTop + 12}" class="t b">Nothing goes in</text><text x="${X}" y="${inTop + 26}" class="t m">it starts here</text>`);
    const w = Math.max(3, 12 * d.running);
    p.push(band(`M 26 ${inTop} L 26 ${plantTop}`, w, "var(--goods)", 0.85), moving(`M 26 ${inTop} L 26 ${plantTop}`, w, d.running));
  }

  // The plant: a dial where the flows meet, what it makes of what it could, its shift.
  const PH = 56, mid = plantTop + PH / 2;
  const dial = d.limit === "idle" ? "var(--line)" : d.limit === "capacity" ? "var(--good)" : d.limit === "input" || d.limit === "workers" ? "var(--warn)" : "var(--goods)";
  const R = 17, C = 2 * Math.PI * R;
  p.push(`<rect x="1" y="${plantTop}" width="${W - 2}" height="${PH}" rx="9" fill="var(--surface)" stroke="var(--line)" stroke-width="1.5"/>`);
  p.push(`<circle cx="26" cy="${mid}" r="${R}" fill="var(--surface)" stroke="var(--line)" stroke-width="6"/><circle cx="26" cy="${mid}" r="${R}" fill="none" stroke="${dial}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(C * Math.max(0, Math.min(1, d.running))).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 26 ${mid})"/>`);
  p.push(`<text x="${X}" y="${mid - 3}" class="big">${d.limit === "idle" ? "Idle" : pct(d.running)} <tspan class="prod">${esc(d.product)}</tspan></text>`);
  p.push(`<text x="${X}" y="${mid + 14}" class="t m">${d.running > 0.01 ? `${tons(d.madePerDay)} of ${tons(capacityOf(d))} t a day` : "makes nothing"}</text>`);
  if (d.staffing !== null) {
    const filled = Math.round(Math.max(0, Math.min(1, d.staffing)) * 5);
    const warn = d.limit === "workers";
    for (let k = 0; k < 5; k += 1) p.push(`<circle cx="${END - 66 + k * 9}" cy="${mid + 10}" r="3" fill="${k < filled ? (warn ? "var(--warn)" : "var(--ink-2)") : "none"}" stroke="${warn ? "var(--warn)" : "var(--ink-2)"}" stroke-width="1.2"/>`);
    p.push(`<text x="${END}" y="${mid - 3}" class="t ${warn ? "warn" : "m"}" text-anchor="end">shift ${pct(d.staffing)}</text>`);
  }

  // Out: a trunk as thick as it runs, a branch to each town as thick as its tonnes.
  y = plantTop + PH + 6;
  p.push(tag("Out", y));
  const outTop = y + 14;
  const outs = d.outputs.slice(0, 5);
  const rest = d.outputs.slice(5);
  const sent = d.outputs.reduce((s, o) => s + o.perDay, 0) || 1;
  const thickOf = (perDay: number) => Math.min(12, Math.max(3, TRUNK * (perDay / sent)));
  const outWidths = outs.map((o) => thickOf(o.perDay));
  if (rest.length) outWidths.push(thickOf(rest.reduce((s, o) => s + o.perDay, 0)));
  // The first branch leaves first, so it runs on the trunk's right; the rest to its left, uncrossed.
  const outLanes = lanes([...outWidths].reverse(), 26 - outWidths.reduce((s, w) => s + w, 0) / 2).reverse();
  outs.forEach((o, i) => {
    const top = outTop + i * ROW, yc = top + 24;
    const bad = o.state === "far" || o.state === "noroad";
    const colour = outColour(o);
    const carried = bad ? 0 : Math.max(0, Math.min(1, o.carried));
    const w = outWidths[i]!, lx = outLanes[i]!, r = 8;
    p.push(`<text x="${X}" y="${top + 12}" class="t ${bad ? "bad" : "b"}">${bad ? "✕ " : ""}${esc(short(o.to, 18))} <tspan class="m" font-weight="400">${tons(o.perDay)} t a day</tspan></text>`);
    p.push(`<text x="${END}" y="${top + 12}" class="t ${bad ? "bad" : o.state === "waiting" ? "warn" : ""}" text-anchor="end">${bad ? (o.state === "far" ? "out of reach" : "no road") : o.state === "waiting" ? `${pct(carried)} · waits` : `${pct(carried)} carried`}</text>`);
    // The branch, and its track along the row: as far as it's carried, solid and moving.
    const branch = `M ${lx} ${plantTop + PH} L ${lx} ${yc - r} Q ${lx} ${yc} ${lx + r} ${yc} L ${X} ${yc}`;
    const track = `M ${X} ${yc} L ${END} ${yc}`;
    const tw = Math.max(5, w);
    if (bad) {
      // Nothing gets there: the branch reaches the row and stops, its track dotted red.
      p.push(band(branch, w, colour, 0.6), `<path d="${track}" stroke="${colour}" stroke-width="${tw.toFixed(1)}" stroke-dasharray="2 4" stroke-opacity="0.45"/>`);
      return;
    }
    p.push(band(branch, w, "var(--goods)", 0.9), moving(branch, w, carried));
    // Its track: the full length what's sent, filled as far as it's carried; waiting, amber.
    p.push(`<path d="${track}" stroke="${o.state === "waiting" ? colour : "var(--line)"}" stroke-width="${tw.toFixed(1)}" stroke-opacity="${o.state === "waiting" ? 0.35 : 0.7}"/>`);
    if (carried > 0.01) {
      const run = `M ${X} ${yc} L ${(X + (END - X) * carried).toFixed(1)} ${yc}`;
      p.push(band(run, tw, "var(--goods)", 0.9), moving(run, tw, carried));
    }
  });
  if (rest.length) {
    const top = outTop + outs.length * ROW, yc = top + 9;
    const lx = outLanes[outs.length]!, w = outWidths[outs.length]!;
    p.push(band(`M ${lx} ${plantTop + PH} L ${lx} ${yc - 6} Q ${lx} ${yc} ${lx + 6} ${yc} L ${X - 6} ${yc}`, w, "var(--goods)", 0.4));
    p.push(`<text x="${X}" y="${yc + 4}" class="t m">and ${rest.length} more towns</text>`);
  }
  if (!outs.length) p.push(`<text x="${X}" y="${outTop + 12}" class="t m">Nowhere yet</text>`);
  const H = outTop + Math.max(1, outs.length) * ROW + (rest.length ? 20 : 0) + 4;
  return `<figure class="seethrough"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="How this site is working">${p.join("")}</svg>${caption(d)}</figure>`;
}
