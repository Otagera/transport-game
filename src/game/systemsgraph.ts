import { SYSTEM_NODES, chainFrom, type SystemNode } from "./systems";

// The systems graph drawn (docs/brief.md, Dev tools, step 5): systems.ts's chain as columns, cause
// to outcome, the change at the left lighting what it enters and everything downstream; each
// measured node with its value without and with. An SVG string the drawer puts in its own panel
// over the plate. Dev only.

const W = 124;
const H = 58;
const COL = 140;
const ROW = 66;
const PAD = 8;

/** Where the measure's increase is the good way. */
const LOWER_IS_BETTER = new Set(["noSeat"]);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function shown(node: SystemNode, x: number): string {
  switch (node.unit) {
    case "k": return `${x.toFixed(1)}k`;
    case "%": case "speed": return `${(x * 100).toFixed(1)}%`;
    case "₦": return `₦${Math.round(x).toLocaleString()}`;
    case "t/day": return `${Math.round(x).toLocaleString()} t`;
    default: return Math.round(x).toLocaleString();
  }
}

/** The graph for an answer: `start` the node the change enters by (null: none drawn lit). */
export function systemsSvg(base: Record<string, number>, after: Record<string, number>, start: { label: string; node: string | null }): string {
  const lit = start.node ? chainFrom(start.node) : new Set<string>();
  const at = (n: { col: number; row: number }) => ({ x: PAD + n.col * COL, y: PAD + n.row * ROW });
  const byId = new Map(SYSTEM_NODES.map((n) => [n.id, n]));
  const startRow = start.node ? byId.get(start.node)!.row : 3;
  const width = PAD * 2 + 5 * COL + W;
  const height = PAD * 2 + 6 * ROW + H;

  const edges: string[] = [];
  const link = (from: { x: number; y: number }, to: { x: number; y: number }, on: boolean) => {
    const [x1, y1, x2, y2] = [from.x + W, from.y + H / 2, to.x, to.y + H / 2];
    const mid = (x1 + x2) / 2;
    edges.push(`<path class="sys-edge${on ? " lit" : ""}" d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}" />`);
  };
  for (const node of SYSTEM_NODES) for (const next of node.feeds) link(at(node), at(byId.get(next)!), lit.has(node.id) && lit.has(next));
  const startAt = at({ col: 0, row: startRow });
  if (start.node) link(startAt, at(byId.get(start.node)!), true);

  const boxes = SYSTEM_NODES.map((node) => {
    const { x, y } = at(node);
    const a = base[node.id];
    const b = after[node.id];
    let line = `<text class="sys-value muted" x="${x + 6}" y="${y + 34}">not measured</text>`;
    // Three lines: the name, without → with, the change.
    if (a !== undefined && b !== undefined) {
      const d = b - a;
      const share = Math.abs(a) > 1e-9 ? d / Math.abs(a) : d === 0 ? 0 : Infinity;
      const still = Math.abs(share) < 0.001;
      const better = LOWER_IS_BETTER.has(node.id) ? d < 0 : d > 0;
      const tone = still ? "muted" : better ? "good" : "bad";
      const pct = Number.isFinite(share) ? `${share > 0 ? "+" : share < 0 ? "−" : ""}${Math.abs(share * 100).toFixed(1)}%` : "new";
      line = `<text class="sys-value" x="${x + 6}" y="${y + 33}"><tspan class="muted">${esc(shown(node, a))} → </tspan><tspan class="${tone}">${esc(shown(node, b))}</tspan></text>`
        + `<text class="sys-value ${tone}" x="${x + 6}" y="${y + 49}">${still ? "no change" : pct}</text>`;
    }
    return `<g class="sys-node${lit.has(node.id) ? " lit" : ""}"><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="6" /><text class="sys-label" x="${x + 6}" y="${y + 16}">${esc(node.label)}</text>${line}</g>`;
  });
  const startBox = `<g class="sys-node sys-start lit"><rect x="${startAt.x}" y="${startAt.y}" width="${W}" height="${H}" rx="6" /><foreignObject x="${startAt.x + 4}" y="${startAt.y + 2}" width="${W - 8}" height="${H - 4}"><div class="sys-start-text">${esc(start.label)}</div></foreignObject></g>`;
  return `<svg class="sys-graph" viewBox="0 0 ${width} ${height}" role="img" aria-label="The model: what the change entered and what it moved">${edges.join("")}${boxes.join("")}${startBox}</svg>`;
}
