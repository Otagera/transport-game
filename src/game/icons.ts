// The icon mock (2026-10-23; your ask after the region: "better icons to show what things
// are, for smaller towns/bigger towns, and the different refineries/cement factories").
// Canvas only, no data: written to be ported into the game's render.ts as it stands.
//
//   - Towns by tier: a village a small plain dot; a town the lab's ring; a regional town a
//     heavier rim; the city a second ring outside. Size still says how many people.
//   - Sites as a rounded tile with a glyph: the glyph says what it is, the colour which
//     family of chain (energy, building, food and crops, trade) -- four colours, validated
//     for colour-blind separation, and never colour alone: the glyph carries identity.
//     Working: a solid tile, white glyph. Idle (built for another age, not running): hollow.
//     Held back (making under 60% of what it could): an amber corner, like a town's "!".
//   - Badges on a town for what it is besides a town: the port (an anchor), a border
//     crossing (a barrier), a farm town (an ear of grain).
//
// The sheet includes the chains agreed next (steel, palm oil, cotton, cattle, cocoa, coal,
// general cargo), so the language holds when they come.

export type Family = "energy" | "building" | "food" | "trade";

/** A colour token's value (tokens.css, the one source: look.md §9). */
const tokenCache = new Map<string, string>();
function tokenColor(name: string): string {
  let value = tokenCache.get(name);
  if (value === undefined) {
    value = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (value) tokenCache.set(name, value);
  }
  return value;
}
/** Each chain's colour, read from its token (look.md §2: fuel, building, food, trade). */
export const FAMILY_COLOR: Record<Family, string> = {
  get energy() { return tokenColor("--fuel"); },
  get building() { return tokenColor("--building"); },
  get food() { return tokenColor("--food"); },
  get trade() { return tokenColor("--trade"); },
};
export const FAMILY_NAME: Record<Family, string> = { energy: "Fuel", building: "Building", food: "Food and crops", trade: "Trade" };

export type Glyph =
  | "oilfield" | "terminal" | "refinery" | "newrefinery" | "depot"
  | "quarry" | "works" | "silo"
  | "mill" | "flourmill"
  | "border" | "gateway" | "station" | "assembly"
  // The chains agreed next.
  | "steelport"
  | "ironmine" | "steelworks" | "plantation" | "palmmill" | "cottonfarm" | "textilemill" | "ranch" | "abattoir" | "cocoa" | "coalmine" | "powerstation" | "warehouse";

export const GLYPHS: Record<Glyph, { family: Family; name: string; next?: true }> = {
  oilfield: { family: "energy", name: "Oilfield" },
  terminal: { family: "energy", name: "Crude terminal" },
  refinery: { family: "energy", name: "Refinery (the state's)" },
  newrefinery: { family: "energy", name: "Private refinery" },
  depot: { family: "energy", name: "Fuel depot" },
  quarry: { family: "building", name: "Quarry" },
  works: { family: "building", name: "Cement works" },
  silo: { family: "building", name: "Cement import silo" },
  mill: { family: "food", name: "Food mill" },
  flourmill: { family: "food", name: "Flour mill" },
  ironmine: { family: "building", name: "Iron ore mine" },
  steelworks: { family: "building", name: "Steel works (Ajaokuta)" },
  steelport: { family: "building", name: "Steel import terminal" },
  border: { family: "trade", name: "Border crossing" },
  gateway: { family: "trade", name: "Coast road (imports, exports)" },
  station: { family: "trade", name: "Station on the old line" },
  assembly: { family: "building", name: "Assembly plant (buses, minibuses)" },
  plantation: { family: "food", name: "Oil-palm plantation", next: true },
  palmmill: { family: "food", name: "Palm-oil mill", next: true },
  cottonfarm: { family: "food", name: "Cotton farms", next: true },
  textilemill: { family: "trade", name: "Textile mill", next: true },
  ranch: { family: "food", name: "Cattle market (herds)", next: true },
  abattoir: { family: "food", name: "Abattoir", next: true },
  cocoa: { family: "food", name: "Cocoa farms", next: true },
  coalmine: { family: "energy", name: "Coal mine", next: true },
  powerstation: { family: "energy", name: "Power station", next: true },
  warehouse: { family: "trade", name: "Cargo depot (imports)", next: true },
};

export type SiteState = "working" | "idle" | "short";

/** A site: a rounded tile `size` across, centred on (x, y), its glyph in it. */
export function drawSite(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, glyph: Glyph, state: SiteState, surface = tokenColor("--on-fill")): void {
  const color = FAMILY_COLOR[GLYPHS[glyph].family];
  const s = size;
  ctx.save();
  roundRect(ctx, x - s / 2, y - s / 2, s, s, s * 0.24);
  ctx.fillStyle = state === "idle" ? surface : color;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, s * 0.09);
  ctx.strokeStyle = state === "idle" ? color : surface;
  ctx.stroke();
  if (state === "idle") {
    // Idle: dashed inner rim, so hollow reads as "not running", not "a different thing".
    ctx.setLineDash([s * 0.12, s * 0.1]);
    roundRect(ctx, x - s / 2 + s * 0.12, y - s / 2 + s * 0.12, s * 0.76, s * 0.76, s * 0.16);
    ctx.lineWidth = Math.max(0.8, s * 0.04);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const ink = state === "idle" ? color : tokenColor("--on-fill");
  ctx.translate(x, y);
  ctx.scale(s / 24, s / 24); // glyphs are drawn on a 24-unit tile, centred
  drawGlyph(ctx, glyph, ink);
  ctx.restore();
  if (state === "short") {
    ctx.save();
    ctx.fillStyle = tokenColor("--warn");
    ctx.beginPath();
    ctx.arc(x + s / 2, y - s / 2, Math.max(3, s * 0.2), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = surface;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}

/** The glyph on a 24-unit tile centred on 0,0 (drawable area about ±8). */
function drawGlyph(ctx: CanvasRenderingContext2D, glyph: Glyph, ink: string): void {
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const path = (fn: () => void, fill = true) => {
    ctx.beginPath();
    fn();
    if (fill) ctx.fill();
    else ctx.stroke();
  };
  switch (glyph) {
    case "oilfield": // a drop
      drop(ctx, 0, 0, 1);
      break;
    case "terminal": // a drop over the sea
      drop(ctx, 0, -2.5, 0.75);
      path(() => wave(ctx, 6.5), false);
      break;
    case "refinery":
    case "newrefinery": // two columns, a flame on the taller
      ctx.fillRect(-6.5, -2, 4, 10);
      ctx.fillRect(0.5, -6, 4, 14);
      path(() => {
        ctx.moveTo(2.5, -12.5);
        ctx.quadraticCurveTo(6.5, -9, 2.5, -7);
        ctx.quadraticCurveTo(-1.5, -9, 2.5, -12.5);
      });
      if (glyph === "newrefinery") { // private: a third, newer column
        ctx.fillRect(6, 1, 2.5, 7);
      }
      break;
    case "depot": // a tank
      path(() => ctx.ellipse(0, -4.5, 7, 2.6, 0, 0, Math.PI * 2));
      ctx.fillRect(-7, -4.5, 14, 10);
      path(() => ctx.ellipse(0, 5.5, 7, 2.6, 0, 0, Math.PI));
      break;
    case "quarry": { // a heap of broken stone: limestone as it leaves the face
      const rock = (pts: Array<[number, number]>) => path(() => { ctx.moveTo(pts[0]![0], pts[0]![1]); for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py); ctx.closePath(); });
      rock([[-9, 8], [-8, 2], [-4, -1], [0, 1], [1, 8]]);
      rock([[2, 8], [1, 2], [4, -1], [8.5, 1], [9, 8]]);
      rock([[-4, -2], [-3, -7], [1, -9], [4, -6], [3, -2], [0, 0]]);
      // The facets: a line of the tile's colour across each stone, so they read as broken rock, not blobs.
      ctx.strokeStyle = ink === tokenColor("--on-fill") ? FAMILY_COLOR.building : tokenColor("--on-fill");
      ctx.lineWidth = 1.1;
      for (const [x1, y1, x2, y2] of [[-8, 3, -3, 5], [2, 3, 7, 5], [-3, -6, 2, -4]] as const) path(() => { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }, false);
      break;
    }
    case "works": // a silo and a kiln's stack
      path(() => { ctx.moveTo(-7, 8); ctx.lineTo(-7, -3); ctx.arc(-3.5, -3, 3.5, Math.PI, 0); ctx.lineTo(0, 8); ctx.closePath(); });
      ctx.fillRect(2.5, -8, 3, 16);
      ctx.fillRect(1, 2, 7, 6);
      break;
    case "silo": // a silo by the sea
      path(() => { ctx.moveTo(-4, 4); ctx.lineTo(-4, -4); ctx.arc(0, -4, 4, Math.PI, 0); ctx.lineTo(4, 4); ctx.closePath(); });
      path(() => wave(ctx, 7.5), false);
      break;
    case "mill": // an ear of grain
    case "cottonfarm":
    case "cocoa":
      if (glyph === "mill") grain(ctx);
      else if (glyph === "cottonfarm") { // a boll
        for (const [cx, cy] of [[-3, -1], [3, -1], [0, -5], [0, 2]] as const) path(() => ctx.arc(cx, cy, 3.6, 0, Math.PI * 2));
        path(() => { ctx.moveTo(0, 4); ctx.lineTo(0, 9); }, false);
      } else { // a pod
        path(() => ctx.ellipse(0, 0, 4.8, 8, 0.5, 0, Math.PI * 2));
        ctx.strokeStyle = ink === tokenColor("--on-fill") ? FAMILY_COLOR.food : tokenColor("--on-fill");
        ctx.lineWidth = 1.2;
        path(() => { ctx.moveTo(-3.5, -5); ctx.quadraticCurveTo(0, 0, 3.5, 5); }, false);
      }
      break;
    case "flourmill": // a sack, tied
      path(() => {
        ctx.moveTo(-3, -6);
        ctx.quadraticCurveTo(-8, 0, -6, 8);
        ctx.lineTo(6, 8);
        ctx.quadraticCurveTo(8, 0, 3, -6);
        ctx.closePath();
      });
      path(() => { ctx.moveTo(-3.5, -8); ctx.lineTo(0, -5.5); ctx.lineTo(3.5, -8); ctx.closePath(); });
      break;
    case "ironmine": // a pick
      path(() => { ctx.moveTo(-7, -4); ctx.quadraticCurveTo(0, -10, 7, -4); }, false);
      path(() => { ctx.moveTo(0, -7); ctx.lineTo(0, 8); }, false);
      break;
    case "assembly": // a bus, side on: what it makes
      ctx.fillRect(-8, -5, 16, 9);
      ctx.fillRect(-8, 5, 4, 2.6);
      ctx.fillRect(4, 5, 4, 2.6);
      ctx.strokeStyle = ink === tokenColor("--on-fill") ? FAMILY_COLOR.building : tokenColor("--on-fill");
      ctx.lineWidth = 1.2;
      for (const xx of [-5, -1, 3]) path(() => { ctx.rect(xx, -3, 3, 3); }, false);
      break;
    case "station": // a platform canopy over the rails
      ctx.fillRect(-8, -7, 16, 2.4);
      ctx.fillRect(-6, -5, 2.2, 6);
      ctx.fillRect(3.8, -5, 2.2, 6);
      ctx.fillRect(-9, 3, 18, 1.6);
      ctx.fillRect(-9, 6.4, 18, 1.6);
      break;
    case "border": // a barrier pole across the road, its post
    case "gateway":
      ctx.fillRect(-8, -1.2, 16, 2.4);
      ctx.fillRect(-8, -6, 2.6, 12);
      break;
    case "steelport": // an I-beam by the sea
      ctx.fillRect(-6, -8, 12, 2.6);
      ctx.fillRect(-6, -0.6, 12, 2.6);
      ctx.fillRect(-1.3, -5.6, 2.6, 5);
      ctx.beginPath();
      wave(ctx, 6.5);
      ctx.stroke();
      break;
    case "steelworks": // an I-beam
      ctx.fillRect(-7, -7, 14, 3.2);
      ctx.fillRect(-7, 3.8, 14, 3.2);
      ctx.fillRect(-1.6, -4, 3.2, 8);
      break;
    case "plantation": // a palm
      path(() => { ctx.moveTo(0, 8); ctx.quadraticCurveTo(1, 1, 0, -3); }, false);
      for (const a of [-2.6, -1.9, -1.2, -0.5]) path(() => { ctx.moveTo(0, -3); ctx.quadraticCurveTo(Math.cos(a) * 5, -3 + Math.sin(a) * 5 - 2, Math.cos(a) * 8, -3 + Math.sin(a) * 8 + 2); }, false);
      break;
    case "palmmill": // a drop of oil over a press
      drop(ctx, 0, -3, 0.65);
      ctx.fillRect(-7, 4, 14, 3);
      break;
    case "textilemill": // a spool
      ctx.fillRect(-6, -8, 12, 2.6);
      ctx.fillRect(-6, 5.4, 12, 2.6);
      ctx.fillRect(-4, -5.4, 8, 10.8);
      ctx.strokeStyle = ink === tokenColor("--on-fill") ? FAMILY_COLOR.trade : tokenColor("--on-fill");
      ctx.lineWidth = 1;
      for (const yy of [-3, 0, 3]) path(() => { ctx.moveTo(-4, yy); ctx.lineTo(4, yy + 1.5); }, false);
      break;
    case "ranch": // horns
      path(() => { ctx.moveTo(-8, -6); ctx.quadraticCurveTo(-7, 1, 0, 1); ctx.quadraticCurveTo(7, 1, 8, -6); }, false);
      path(() => ctx.ellipse(0, 4, 3.6, 4.4, 0, 0, Math.PI * 2));
      break;
    case "abattoir": // a cleaver
      ctx.fillRect(-7, -6, 10, 8);
      ctx.fillRect(3, -3, 5, 2.5);
      break;
    case "coalmine": // a lump on a wheel's frame
      path(() => { ctx.moveTo(-7, 8); ctx.lineTo(0, -8); ctx.lineTo(7, 8); }, false);
      path(() => ctx.arc(0, -3, 3, 0, Math.PI * 2));
      break;
    case "powerstation": // a bolt
      path(() => { ctx.moveTo(1.5, -9); ctx.lineTo(-5, 1); ctx.lineTo(0, 1); ctx.lineTo(-1.5, 9); ctx.lineTo(5, -1); ctx.lineTo(0, -1); ctx.closePath(); });
      break;
    case "warehouse": // a container
      ctx.fillRect(-8, -5, 16, 10);
      ctx.strokeStyle = ink === tokenColor("--on-fill") ? FAMILY_COLOR.trade : tokenColor("--on-fill");
      ctx.lineWidth = 1.2;
      for (const xx of [-4, 0, 4]) path(() => { ctx.moveTo(xx, -3.5); ctx.lineTo(xx, 3.5); }, false);
      break;
  }
}

function drop(ctx: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - 9 * k);
  ctx.bezierCurveTo(x + 7 * k, y - 1 * k, x + 7 * k, y + 8 * k, x, y + 8 * k);
  ctx.bezierCurveTo(x - 7 * k, y + 8 * k, x - 7 * k, y - 1 * k, x, y - 9 * k);
  ctx.fill();
}
function wave(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.moveTo(-8, y);
  ctx.quadraticCurveTo(-6, y - 2.2, -4, y);
  ctx.quadraticCurveTo(-2, y + 2.2, 0, y);
  ctx.quadraticCurveTo(2, y - 2.2, 4, y);
  ctx.quadraticCurveTo(6, y + 2.2, 8, y);
}
function grain(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(0, 9);
  ctx.lineTo(0, -8);
  ctx.stroke();
  for (let k = 0; k < 4; k += 1) {
    const yy = -6 + k * 3.6;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 2.6, yy, 2.6, 1.4, side * -0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// --- Towns by tier ---------------------------------------------------------------------

export type Tier = "village" | "town" | "regional" | "city";
export const TIER_NAME: Record<Tier, string> = { village: "Village (under 15k)", town: "Town", regional: "Regional town (45k+)", city: "The city" };

/** A town's tier by its people (thousands); the region's biggest is the city. */
export function tierOf(population: number, isCity: boolean): Tier {
  if (isCity) return "city";
  if (population >= 45) return "regional";
  if (population >= 15) return "town";
  return "village";
}

/** The radius a tier draws at, before the zoom's growth. */
export function tierRadius(tier: Tier, population: number): number {
  if (tier === "village") return 3.5;
  return Math.max(5, Math.sqrt(population) * 1.1);
}

/**
 * A town: its body, the share ring (you / informal / stayed home) and the tier's rim. A
 * village is a small dot with a thin ring: the map's many small places stay quiet.
 */
export function drawTown(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tier: Tier, share: { you: number; informal: number; lost: number }, colors: { surface: string; ink: string; you: string; informal: string; home: string }): void {
  ctx.save();
  const ring = tier === "village" ? 2 : 4;
  ctx.fillStyle = colors.surface;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  let start = -Math.PI / 2;
  for (const [part, color] of [[share.you, colors.you], [share.informal, colors.informal], [share.lost, colors.home]] as const) {
    const end = start + part * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x, y, r + ring / 2 + 0.5, start, end);
    ctx.lineWidth = ring;
    ctx.strokeStyle = color;
    ctx.stroke();
    start = end;
  }
  if (tier === "regional" || tier === "city") {
    // A heavier rim inside the ring: a place the region's roads run to.
    ctx.beginPath();
    ctx.arc(x, y, r - 1.5, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.ink;
    ctx.stroke();
  }
  if (tier === "city") {
    ctx.beginPath();
    ctx.arc(x, y, r + ring + 3.5, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = colors.ink;
    ctx.stroke();
  }
  ctx.restore();
}

// --- Badges: what a town is besides a town -----------------------------------------------

export type Badge = "port" | "border" | "farm";
export const BADGE_NAME: Record<Badge, string> = { port: "Seaport", border: "Border crossing", farm: "Farm town" };

/** A small round badge at (x, y), `size` across. */
export function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, badge: Badge, surface = tokenColor("--on-fill")): void {
  const color = badge === "farm" ? FAMILY_COLOR.food : badge === "port" ? FAMILY_COLOR.trade : tokenColor("--ink-2");
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = surface;
  ctx.stroke();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = tokenColor("--on-fill");
  ctx.strokeStyle = tokenColor("--on-fill");
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  if (badge === "port") { // an anchor
    ctx.beginPath(); ctx.arc(0, -6.5, 2.2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-4, -1.5); ctx.lineTo(4, -1.5); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 1.5, 6.5, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  } else if (badge === "border") { // a barrier
    ctx.beginPath(); ctx.moveTo(-6, 7); ctx.lineTo(-6, -4); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(8, -3); ctx.stroke();
  } else { // a field's furrows: not the food mill's ear of grain
    ctx.lineWidth = 2.2;
    for (const yy of [-5, 0, 5]) { ctx.beginPath(); ctx.moveTo(-7, yy + 2); ctx.quadraticCurveTo(0, yy - 2, 7, yy + 2); ctx.stroke(); }
  }
  ctx.restore();
}
