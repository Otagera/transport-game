// Hand-inked isometric vehicles and towns (your idea after april-zhu.com/colorfigures,
// 2026-10-24): drawn in code -- flat colour, an ink line that wobbles a little -- once for each
// kind and facing, then stamped onto the map. The sprite lab (sprite-lab.html) shows them; the
// map uses them only when you've zoomed in, keeping its clean marks from further out.
//
// Isometric: a world point (x east, y south, z up) lands at ((x - y)·cos30, (x + y)·sin30 - z).
// A vehicle is a few boxes along its heading; the faces turned toward the viewer are drawn,
// top last. A town is a patch of ground with buildings by its tier, placed from its name, so
// the same town always looks the same, and grows a tier when it grows.

export type VehicleKind = "bus" | "minibus" | "brt" | "danfo" | "keke" | "okada" | "truck" | "tanker" | "train";
export type TownTier = "village" | "town" | "regional" | "city";

const INK = "#2b2622";
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);

type P3 = [number, number, number];
type P2 = [number, number];

const iso = ([x, y, z]: P3): P2 => [(x - y) * COS, (x + y) * SIN - z];

/** A small seeded random stream: the same wobble for the same shape every time. */
function stream(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}
const hash = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** A filled polygon with an inked outline that wobbles a little, as if drawn by hand. */
function inked(g: CanvasRenderingContext2D, points: P2[], fill: string, rand: () => number, line = 1.2): void {
  // The line and its wobble in screen pixels, whatever the drawing's scale.
  const t = g.getTransform();
  const px = 1 / Math.max(0.1, Math.hypot(t.a, t.b));
  g.beginPath();
  points.forEach(([x, y], i) => {
    const jx = (rand() - 0.5) * 0.8 * px;
    const jy = (rand() - 0.5) * 0.8 * px;
    if (i === 0) g.moveTo(x + jx, y + jy);
    else g.lineTo(x + jx, y + jy);
  });
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = line * px;
  g.lineJoin = "round";
  g.stroke();
}

function shade(hex: string, by: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * by)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** A box along a heading (radians, 0 = east), its centre at (cx, cy), from z0 up h: faces toward the viewer, top last. */
function box(g: CanvasRenderingContext2D, cx: number, cy: number, heading: number, length: number, width: number, z0: number, h: number, colour: string, rand: () => number, windows = false): void {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const at = (u: number, v: number, z: number): P2 => iso([cx + u * c - v * s, cy + u * s + v * c, z]);
  const L = length / 2;
  const Wd = width / 2;
  const corners: Array<[number, number]> = [[L, Wd], [L, -Wd], [-L, -Wd], [-L, Wd]];
  // Side faces: each edge's outward normal; facing the viewer when it points toward +x+y.
  for (let k = 0; k < 4; k += 1) {
    const [u1, v1] = corners[k]!;
    const [u2, v2] = corners[(k + 1) % 4]!;
    const nu = (u1 + u2) / 2;
    const nv = (v1 + v2) / 2;
    const nx = nu * c - nv * s;
    const ny = nu * s + nv * c;
    if (nx + ny <= 0) continue;
    const light = nx > ny ? 0.82 : 0.68;
    inked(g, [at(u1, v1, z0), at(u2, v2, z0), at(u2, v2, z0 + h), at(u1, v1, z0 + h)], shade(colour, light + 0.2), rand);
    if (windows && h > 1.6) {
      const t = (a: number) => [u1 + (u2 - u1) * a, v1 + (v2 - v1) * a] as const;
      const [a1, b1] = t(0.1);
      const [a2, b2] = t(0.9);
      inked(g, [at(a1, b1, z0 + h * 0.5), at(a2, b2, z0 + h * 0.5), at(a2, b2, z0 + h * 0.85), at(a1, b1, z0 + h * 0.85)], "#d9eef7", rand, 0.9);
    }
  }
  inked(g, corners.map(([u, v]) => at(u, v, z0 + h)), shade(colour, 1.08), rand);
}

/** Wheels under a box: dark dots at its corners that face the viewer. */
function wheels(g: CanvasRenderingContext2D, cx: number, cy: number, heading: number, length: number, width: number, rand: () => number): void {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  for (const [u, v] of [[length * 0.32, width / 2], [-length * 0.32, width / 2], [length * 0.32, -width / 2], [-length * 0.32, -width / 2]] as const) {
    const x = cx + u * c - v * s;
    const y = cy + u * s + v * c;
    if (x + y < cx + cy - 0.2) continue;
    const [px, py] = iso([x, y, 0.5]);
    g.beginPath();
    g.ellipse(px + (rand() - 0.5) * 0.3, py, 0.9, 0.7, 0, 0, Math.PI * 2);
    g.fillStyle = INK;
    g.fill();
  }
}

export const VEHICLE_COLOURS: Record<VehicleKind, string> = {
  bus: "#2a78d6", minibus: "#4f97e8", brt: "#c0392b", danfo: "#e8b400", keke: "#3fa34d", okada: "#5a5f66", truck: "#8a5a2b", tanker: "#d9822b", train: "#7a2e2e",
};

/** Draws a vehicle centred at the origin of g (already scaled), facing `heading`. */
export function drawVehicle(g: CanvasRenderingContext2D, kind: VehicleKind, heading: number, seed = 1): void {
  const rand = stream(hash(kind) + seed);
  const colour = VEHICLE_COLOURS[kind];
  const along = (d: number): [number, number] => [Math.cos(heading) * d, Math.sin(heading) * d];
  switch (kind) {
    case "bus":
      wheels(g, 0, 0, heading, 12, 4, rand);
      box(g, 0, 0, heading, 12, 4, 0.6, 4.2, colour, rand, true);
      break;
    case "minibus":
      wheels(g, 0, 0, heading, 8, 3.6, rand);
      box(g, 0, 0, heading, 8, 3.6, 0.6, 3.6, colour, rand, true);
      break;
    case "danfo": {
      wheels(g, 0, 0, heading, 8, 3.6, rand);
      box(g, 0, 0, heading, 8, 3.6, 0.6, 3.6, colour, rand, true);
      // The black stripe a Lagos danfo wears, along its side.
      box(g, 0, 0, heading, 8.04, 3.64, 1.4, 0.45, "#222222", rand);
      break;
    }
    case "brt": {
      // Articulated: two halves with a bellows between.
      const [ax, ay] = along(4.6);
      wheels(g, -ax, -ay, heading, 8, 4, rand);
      box(g, -ax, -ay, heading, 8, 4, 0.6, 4.2, colour, rand, true);
      box(g, 0, 0, heading, 1.2, 3.4, 0.9, 3.4, "#555555", rand);
      wheels(g, ax, ay, heading, 8, 4, rand);
      box(g, ax, ay, heading, 8, 4, 0.6, 4.2, colour, rand, true);
      break;
    }
    case "keke": {
      wheels(g, 0, 0, heading, 4.4, 2.6, rand);
      box(g, 0, 0, heading, 4.4, 2.6, 0.6, 1.6, colour, rand);
      box(g, 0, 0, heading, 3.6, 2.6, 2.9, 0.4, "#f2d14b", rand);
      break;
    }
    case "okada": {
      wheels(g, 0, 0, heading, 4, 0.8, rand);
      box(g, 0, 0, heading, 4, 0.9, 0.6, 1.1, colour, rand);
      // The rider: a body and a head.
      box(g, 0, 0, heading, 1.1, 1.2, 1.7, 2.2, "#c56b3f", rand);
      const [hx, hy] = iso([0, 0, 4.8]);
      g.beginPath();
      g.arc(hx, hy, 0.9, 0, Math.PI * 2);
      g.fillStyle = "#3a2a20";
      g.fill();
      g.strokeStyle = INK;
      g.lineWidth = 1 / Math.max(0.1, Math.hypot(g.getTransform().a, g.getTransform().b));
      g.stroke();
      break;
    }
    case "truck":
    case "tanker": {
      const [cx2, cy2] = along(4.6);
      const [bx, by] = along(-1.4);
      wheels(g, bx, by, heading, 9, 3.6, rand);
      wheels(g, cx2, cy2, heading, 3, 3.4, rand);
      if (kind === "truck") box(g, bx, by, heading, 9, 3.6, 0.7, 4.2, colour, rand);
      else {
        box(g, bx, by, heading, 9, 3.4, 0.7, 0.6, "#555555", rand);
        box(g, bx, by, heading, 8.6, 3.2, 1.3, 3.0, colour, rand);
      }
      box(g, cx2, cy2, heading, 3, 3.4, 0.7, 3.8, kind === "truck" ? "#e8e1d4" : "#f2f2f2", rand, true);
      break;
    }
    case "train": {
      const [lx, ly] = along(7.5);
      wheels(g, -lx, -ly, heading, 14, 3.6, rand);
      box(g, -lx, -ly, heading, 14, 3.6, 0.8, 4.4, "#9a3b2e", rand, true);
      wheels(g, lx, ly, heading, 14, 3.6, rand);
      box(g, lx, ly, heading, 14, 3.6, 0.8, 4.6, colour, rand, true);
      break;
    }
  }
}

/** A building: a box with a roof -- pitched (corrugated iron, silver-grey), flat, or a hut's cone (thatch). */
function building(g: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number, wall: string, roof: "pitched" | "flat" | "thatch", rand: () => number): void {
  if (roof === "thatch") {
    box(g, x, y, Math.PI / 4, w, d, 0, h, wall, rand);
    const apex = iso([x, y, h + w * 0.9]);
    const ring: P2[] = [];
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      ring.push(iso([x + Math.cos(a) * w * 0.75, y + Math.sin(a) * w * 0.75, h]));
    }
    // The cone's near half: from each point of the ring facing us, up to the apex.
    const near = ring.filter((_, k) => Math.cos((k / 8) * Math.PI * 2) + Math.sin((k / 8) * Math.PI * 2) > -0.2);
    inked(g, [...near, apex], "#c9a45c", rand);
    return;
  }
  box(g, x, y, 0, w, d, 0, h, wall, rand, h > 4);
  if (roof === "pitched") {
    const a = iso([x - w / 2, y + d / 2, h]);
    const b = iso([x + w / 2, y + d / 2, h]);
    const c = iso([x + w / 2, y - d / 2, h]);
    const ridgeA = iso([x - w / 2, y, h + d * 0.45]);
    const ridgeB = iso([x + w / 2, y, h + d * 0.45]);
    inked(g, [a, b, ridgeB, ridgeA], "#b9c1c8", rand);
    inked(g, [b, c, ridgeB], "#9aa4ad", rand);
  }
}

const TIERS: Record<TownTier, { radius: number; count: number; tall: number; towers: number }> = {
  village: { radius: 9, count: 4, tall: 0, towers: 0 },
  town: { radius: 13, count: 8, tall: 0, towers: 0 },
  regional: { radius: 17, count: 11, tall: 3, towers: 0 },
  city: { radius: 22, count: 13, tall: 5, towers: 3 },
};
const WALLS = ["#e9dcc3", "#d9c7a7", "#cfd8dc", "#f0e3cf", "#c8b8a0", "#e2d0b8"];

/** A town of a tier, its buildings placed from its name: the same town always looks the same. */
export function drawTown(g: CanvasRenderingContext2D, tier: TownTier, name: string): void {
  const t = TIERS[tier];
  const rand = stream(hash(name) + hash(tier));
  // Its ground: a dusty patch.
  const ground: P2[] = [];
  for (let k = 0; k < 10; k += 1) {
    const a = (k / 10) * Math.PI * 2;
    const r = t.radius * (0.92 + rand() * 0.16);
    ground.push(iso([Math.cos(a) * r, Math.sin(a) * r, 0]));
  }
  inked(g, ground, "#e7dcc6", rand, 1);
  // Buildings: placed in rings, then drawn back to front (by x + y), so near ones cover far.
  const spots: Array<{ x: number; y: number; kind: "house" | "tall" | "tower" | "hut" }> = [];
  for (let k = 0; k < t.count + t.tall + t.towers; k += 1) {
    const a = rand() * Math.PI * 2;
    const r = (k < t.towers ? 0.25 : k < t.towers + t.tall ? 0.45 : 0.75) * t.radius * (0.5 + rand() * 0.5);
    const kind = tier === "village" ? "hut" : k < t.towers ? "tower" : k < t.towers + t.tall ? "tall" : "house";
    spots.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, kind });
  }
  spots.sort((p, q) => p.x + p.y - (q.x + q.y));
  for (const spot of spots) {
    const wall = WALLS[Math.floor(rand() * WALLS.length)]!;
    if (spot.kind === "hut") building(g, spot.x, spot.y, 2.6, 2.6, 2.2, "#c8a06a", "thatch", rand);
    else if (spot.kind === "house") building(g, spot.x, spot.y, 3.2 + rand() * 1.4, 2.8 + rand(), 2.4 + rand() * 0.8, wall, "pitched", rand);
    else if (spot.kind === "tall") building(g, spot.x, spot.y, 3.6, 3.6, 6 + rand() * 3, wall, "flat", rand);
    else building(g, spot.x, spot.y, 4, 4, 12 + rand() * 6, "#bcc8d1", "flat", rand);
  }
}

// --- Stamped once, reused: each kind and facing drawn to its own small canvas -----------------

const vehicleSprites = new Map<string, HTMLCanvasElement>();
/** A vehicle's sprite at a scale, its facing rounded to one of 16; drawn once, then reused. */
export function vehicleSprite(kind: VehicleKind, heading: number, scale: number): HTMLCanvasElement {
  const facing = Math.round((((heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 8)) % 16;
  const key = `${kind}|${facing}|${scale}`;
  let sprite = vehicleSprites.get(key);
  if (!sprite) {
    const size = Math.ceil(36 * scale);
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = size;
    const g = sprite.getContext("2d")!;
    g.translate(size / 2, size / 2 + 4 * scale);
    g.scale(scale, scale);
    drawVehicle(g, kind, (facing * Math.PI) / 8);
    vehicleSprites.set(key, sprite);
  }
  return sprite;
}

const townSprites = new Map<string, HTMLCanvasElement>();
/** A town's sprite at a scale, by its tier and name; drawn once, then reused. */
export function townSprite(tier: TownTier, name: string, scale: number): HTMLCanvasElement {
  const key = `${tier}|${name}|${scale}`;
  let sprite = townSprites.get(key);
  if (!sprite) {
    const size = Math.ceil(64 * scale);
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = size;
    const g = sprite.getContext("2d")!;
    g.translate(size / 2, size * 0.62);
    g.scale(scale, scale);
    drawTown(g, tier, name);
    townSprites.set(key, sprite);
  }
  return sprite;
}
