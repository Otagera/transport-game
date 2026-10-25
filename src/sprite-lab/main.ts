// The sprite lab (sprite-lab.html, dev only): the hand-inked vehicles and towns (game/sprites.ts)
// at four facings and four sizes, and a small live scene in either look, to try before the map
// uses them.
import { drawTown, drawVehicle, townSprite, vehicleSprite, VEHICLE_COLOURS, type TownTier, type VehicleKind } from "../game/sprites";

const NAMES: Record<VehicleKind, string> = { bus: "Your bus", minibus: "Your minibus", brt: "Your BRT", train: "Your train", danfo: "Danfo", keke: "Keke", okada: "Okada", truck: "Haulier's truck", tanker: "Fuel tanker" };
const KINDS = Object.keys(NAMES) as VehicleKind[];

const vehiclesEl = document.querySelector("#vehicles")!;
for (const kind of KINDS) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>${NAMES[kind]}</h3>`;
  const c = document.createElement("canvas");
  c.width = 520;
  c.height = 170;
  const g = c.getContext("2d")!;
  [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4].forEach((heading, i) => {
    g.save();
    g.translate(65 + i * 130, 96);
    g.scale(kind === "train" ? 3.2 : kind === "brt" ? 4 : 5, kind === "train" ? 3.2 : kind === "brt" ? 4 : 5);
    drawVehicle(g, kind, heading);
    g.restore();
  });
  card.append(c);
  vehiclesEl.append(card);
}

const townsEl = document.querySelector("#towns")!;
const TIER_NAMES: Record<TownTier, string> = { village: "Village", town: "Town", regional: "Regional town", city: "The city" };
for (const tier of ["village", "town", "regional", "city"] as TownTier[]) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h3>${TIER_NAMES[tier]}</h3>`;
  const c = document.createElement("canvas");
  c.width = 520;
  c.height = 340;
  const g = c.getContext("2d")!;
  g.translate(260, 200);
  const s = { village: 11, town: 8, regional: 6.4, city: 5.2 }[tier];
  g.scale(s, s);
  drawTown(g, tier, `${tier} lab`);
  card.append(c);
  townsEl.append(card);
}

// --- The scene: four towns, roads between, vehicles running both ways -------------------------
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);
const SCALE = 6;
const scene = document.querySelector<HTMLCanvasElement>("#scene")!;
const sg = scene.getContext("2d")!;
const towns: Array<{ name: string; tier: TownTier; x: number; y: number; pop: string }> = [
  { name: "Katsina-Ala", tier: "city", x: 0, y: 0, pop: "182k" },
  { name: "Lokoja", tier: "regional", x: 58, y: 34, pop: "72k" },
  { name: "Doma", tier: "town", x: -40, y: 52, pop: "19k" },
  { name: "Keffi", tier: "village", x: 26, y: 88, pop: "8k" },
];
const roads: Array<[number, number]> = [[0, 1], [0, 2], [1, 3], [2, 3]];
const screen = (x: number, y: number): [number, number] => [640 + (x - y) * COS * SCALE, 110 + (x + y) * SIN * SCALE];
const runners: Array<{ road: number; kind: VehicleKind; t: number; speed: number; back: boolean }> = [];
const mix: VehicleKind[] = ["bus", "danfo", "danfo", "keke", "okada", "truck", "minibus", "danfo", "tanker", "brt", "okada", "keke"];
mix.forEach((kind, i) => runners.push({ road: i % roads.length, kind, t: (i * 0.37) % 1, speed: 0.03 + (i % 4) * 0.012, back: i % 2 === 1 }));
let look: "inked" | "current" = "inked";
document.querySelector(".toggle")!.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-look]");
  if (!b) return;
  look = b.dataset.look as typeof look;
  document.querySelectorAll(".toggle button").forEach((x) => x.classList.toggle("on", x === b));
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  sg.fillStyle = look === "inked" ? "#f3eee2" : "#f4f6f3";
  sg.fillRect(0, 0, scene.width, scene.height);
  // Roads.
  for (const [a, b] of roads) {
    const [ax, ay] = screen(towns[a]!.x, towns[a]!.y);
    const [bx, by] = screen(towns[b]!.x, towns[b]!.y);
    sg.lineCap = "round";
    if (look === "inked") {
      sg.strokeStyle = "#2b2622"; sg.lineWidth = 30; sg.beginPath(); sg.moveTo(ax, ay); sg.lineTo(bx, by); sg.stroke();
      sg.strokeStyle = "#b9b2a4"; sg.lineWidth = 27; sg.stroke();
      sg.setLineDash([8, 10]); sg.strokeStyle = "#f3eee2"; sg.lineWidth = 1.2; sg.stroke(); sg.setLineDash([]);
    } else {
      sg.strokeStyle = "#ffffff"; sg.lineWidth = 12; sg.beginPath(); sg.moveTo(ax, ay); sg.lineTo(bx, by); sg.stroke();
      sg.strokeStyle = "#c3cbd4"; sg.lineWidth = 8; sg.stroke();
    }
  }
  // Vehicles and towns, back to front.
  const things: Array<{ depth: number; draw: () => void }> = [];
  for (const r of runners) {
    r.t = (r.t + r.speed * dt) % 1;
    const [ia, ib] = roads[r.road]!;
    const from = r.back ? towns[ib]! : towns[ia]!;
    const to = r.back ? towns[ia]! : towns[ib]!;
    const t = 0.12 + r.t * 0.76;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const heading = Math.atan2(to.y - from.y, to.x - from.x);
    // Keep to the left of the road, as Nigeria drives on the right: offset to the right of travel.
    const ox = -Math.sin(heading) * 2.2;
    const oy = Math.cos(heading) * 2.2;
    const [sx, sy] = screen(x + ox, y + oy);
    things.push({ depth: x + y, draw: () => {
      if (look === "inked") {
        const sprite = vehicleSprite(r.kind, heading, 2.8);
        sg.drawImage(sprite, sx - sprite.width / 2, sy - sprite.height / 2 - 4);
      } else {
        sg.save(); sg.translate(sx, sy); sg.rotate(Math.atan2((Math.sin(heading) + Math.cos(heading)) * SIN, (Math.cos(heading) - Math.sin(heading)) * COS));
        sg.fillStyle = VEHICLE_COLOURS[r.kind]; sg.strokeStyle = "#ffffff"; sg.lineWidth = 1.5;
        sg.beginPath(); sg.roundRect(-8, -3.5, 16, 7, 3.5); sg.fill(); sg.stroke(); sg.restore();
      }
    } });
  }
  for (const town of towns) {
    const [sx, sy] = screen(town.x, town.y);
    things.push({ depth: town.x + town.y - 6, draw: () => {
      if (look === "inked") {
        const sprite = townSprite(town.tier, town.name, 3.2);
        sg.drawImage(sprite, sx - sprite.width / 2, sy - sprite.height * 0.62);
      } else {
        const r = { village: 6, town: 9, regional: 12, city: 16 }[town.tier];
        sg.beginPath(); sg.arc(sx, sy, r, 0, Math.PI * 2); sg.fillStyle = "#ffffff"; sg.fill(); sg.lineWidth = 3; sg.strokeStyle = "#a3abb5"; sg.stroke();
      }
      sg.font = "600 13px system-ui"; sg.textAlign = "center"; sg.lineWidth = 4; sg.strokeStyle = look === "inked" ? "#f3eee2" : "#ffffff";
      const ly = sy + (look === "inked" ? 74 : 26);
      sg.strokeText(town.name, sx, ly); sg.fillStyle = "#1b2129"; sg.fillText(town.name, sx, ly);
      sg.font = "11px system-ui"; sg.strokeText(town.pop, sx, ly + 14); sg.fillStyle = "#7b8694"; sg.fillText(town.pop, sx, ly + 14);
    } });
  }
  things.sort((p, q) => p.depth - q.depth).forEach((thing) => thing.draw());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
