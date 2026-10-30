import type { GameTown, GameWorld } from "./types";
import { addSite } from "./fuel";
import { inheritedRoad } from "./cement";
import { nearestOnPolyline, rebuildNetworks, stationTowns } from "./rail";
import { pointAlong, polylineLength, segmentPolyline, splitPolyline } from "./roads";
import { NAMES, REGION_NAMES } from "./generate";
import { SECONDS_PER_GAME_DAY } from "../economy/state";
import type { GameEvent } from "./settlement";

// Stations on the old line (docs/brief.md, Revision 5, Stations on the old line, agreed
// 2026-10-30). The inherited railway was laid for export, and its stations stand where the
// export needed them, not where people live: every 25-35 cells along it, each one of three by
// what stands near it today --
//   - at its town: a town within `stationAtTownCells` of the line is a stop on it (the line
//     runs in to it, as a halt does: rail.ts buildHalt);
//   - out of its town: further off, but within `stationTownReach`, a station of its own on the
//     line, named for the town it served ("Ede Road") with an old dirt road to it;
//   - where the town has gone: nothing near, a station at the ruin of the town it was built for,
//     no road to it.
// Restoring the line reopens them (rail.ts restores any run of the old line at once). A station
// out of its town carries the people who reach it -- a feeder to it, riders changing there
// (transfers.ts), or a halt nearer the town: its distance counts because getting there is a ride.
// Where trains stop and riders change, a station grows a town of its name (foundStationTowns),
// fading back to a station -- never off the line -- if they go. Placed at the start after every
// other site, so they sit where they did, behind `railStations` (absent in older runs: the line as it was).

export type StationKind = "town" | "out" | "gone";

export interface StationInfo {
  kind: StationKind;
  /** The town it was built for: a town's id ("town", "out"), or a ruin's ("gone"). */
  serves: string;
}

/**
 * Towns a line was built for and that have gone, by region: real places of each, not among the
 * generated maps' names (a map can use every one of those -- map 949 does).
 */
const GONE_NAMES: Record<string, string[]> = {
  southwest: ["Igbo-Ora", "Eruwa", "Lanlate", "Iganna", "Ago-Are", "Tede", "Otu", "Ilaro", "Ifetedo", "Iree", "Ikirun", "Inisa"],
  north: ["Bakori", "Kafur", "Musawa", "Matazu", "Dandume", "Sabuwa", "Faskari", "Zangon Aya", "Gwadabawa"],
  northeast: ["Damboa", "Konduga", "Dikwa", "Monguno", "Fika", "Nangere", "Darazo", "Kirfi"],
  middleBelt: ["Kafanchan", "Jema'a", "Toto", "Nasarawa", "Wase", "Zungeru", "Tegina", "Baro", "Egbe"],
  southeast: ["Oji River", "Uzo-Uwani", "Nkalagu", "Ezzamgbo", "Amasiri", "Ihiala", "Awgu", "Udi"],
  southSouth: ["Ughelli", "Sapele", "Burutu", "Forcados", "Ahoada", "Omoku", "Patani", "Opuama"],
};

/** A gone town's name not yet on the map: the region's gone towns first, then its others. */
function freshName(world: GameWorld, salt: number): string {
  const region = world.region ?? "southwest";
  const own = region !== "southwest" ? REGION_NAMES[region as keyof typeof REGION_NAMES] ?? NAMES : NAMES;
  const taken = new Set([...world.towns.values(), ...world.ruins.values()].map((t) => t.name.replace(/ (Station|Road)$/, "")));
  for (const pool of [GONE_NAMES[region] ?? GONE_NAMES.southwest!, own]) {
    for (let k = 0; k < pool.length; k += 1) {
      const name = pool[(salt + k * 7) % pool.length]!;
      if (!taken.has(name)) return name;
    }
  }
  return `Mile ${salt}`;
}

/** Splits an inherited rail segment at `along`, the stop `nodeId` at `point` (on the line, or a town it runs in to). */
function splitRail(world: GameWorld, segmentId: string, along: number, nodeId: string, point: { x: number; y: number }): void {
  const map = world.simulation.map;
  const segment = map.segments.find((s) => s.id === segmentId)!;
  const [before, after] = splitPolyline(segmentPolyline(map, segment), along);
  const firstLine = [...before.slice(0, -1), point];
  const secondLine = [point, ...after.slice(1)];
  const first = { ...segment, id: `${segment.id}.a`, corridorId: `corridor-${segment.id}.a`, toNodeId: nodeId, length: polylineLength(firstLine) };
  const second = { ...segment, id: `${segment.id}.b`, corridorId: `corridor-${segment.id}.b`, fromNodeId: nodeId, length: polylineLength(secondLine) };
  map.segments = map.segments.filter((s) => s !== segment).concat(first, second);
  map.corridors = map.corridors
    .filter((c) => c.id !== segment.corridorId)
    .concat({ id: first.corridorId, nodeIds: [segment.fromNodeId, nodeId], polyline: firstLine }, { id: second.corridorId, nodeIds: [nodeId, segment.toNodeId], polyline: secondLine });
  if (world.railOutOfService.delete(segment.id)) {
    world.railOutOfService.add(first.id);
    world.railOutOfService.add(second.id);
  }
}

/** Places the old line's stations (see above): at the start, before the warm-up, after every other site. */
export function placeStations(world: GameWorld): void {
  const t = world.tuning;
  if (!t.railStations || !t.railEnabled || world.stations) return;
  world.stations = new Map();
  const map = world.simulation.map;
  const spacing = t.stationSpacingCells ?? 30;
  const atTown = t.stationAtTownCells ?? 4;
  const reach = t.stationTownReach ?? 20;
  let made = 0;
  // A town served once, on whichever line reaches it first (two lines can pass the same town).
  const used = new Set<string>();
  for (const original of map.segments.filter((s) => s.type === "rail" && s.id.startsWith("inherited-rail-"))) {
    const line = segmentPolyline(map, original);
    const length = polylineLength(line);
    const count = Math.floor(length / spacing) - 1;
    if (count < 1) continue;
    const ends = new Set([original.fromNodeId, original.toNodeId]);
    // Each town's nearest approach to the line: where a station built for it would stand.
    const approach = [...world.towns.values()]
      .filter((town) => !town.industry && !ends.has(town.id))
      .map((town) => ({ town, ...nearestOnPolyline(line, town) }));
    const stops: Array<{ along: number; make: () => { id: string; point: { x: number; y: number } } }> = [];
    for (let k = 1; k <= count; k += 1) {
      // Every 25-35 cells: evenly, then nudged by the seed's hand (a crossing, a market of the time).
      const jitter = (((original.id.length * 37 + k * 101 + Math.round(length) * 13) % 21) - 10) / 100;
      const at = (length * k) / (count + 1) + spacing * jitter;
      if (at < 12 || at > length - 12) continue;
      const window = spacing / 2;
      const near = approach
        .filter((a) => !used.has(a.town.id) && Math.abs(a.along - at) <= window)
        .sort((p, q) => p.distance - q.distance)[0];
      if (near && near.distance <= atTown) {
        used.add(near.town.id);
        const town = near.town;
        stops.push({ along: near.along, make: () => {
          world.stations!.set(town.id, { kind: "town", serves: town.id });
          return { id: town.id, point: { x: town.x, y: town.y } };
        } });
      } else if (near && near.distance <= reach) {
        used.add(near.town.id);
        const town = near.town;
        const point = { x: Math.round(near.point.x), y: Math.round(near.point.y) };
        stops.push({ along: near.along, make: () => {
          const id = `station-${made++}`;
          addSite(world, id, `${town.name} Road`, "station", point).population = 0;
          world.stations!.set(id, { kind: "out", serves: town.id });
          inheritedRoad(world, `${id}-road`, id, town.id);
          return { id, point };
        } });
      } else {
        const p = pointAlong(line, at);
        const point = { x: Math.round(p.x), y: Math.round(p.y) };
        stops.push({ along: at, make: () => {
          const id = `station-${made++}`;
          const ruin: GameTown = { id: `ruin-${id}`, name: freshName(world, made * 5 + Math.round(at)), x: point.x + 2, y: point.y + 2, population: 0 };
          world.ruins.set(ruin.id, ruin);
          addSite(world, id, `${ruin.name} Station`, "station", point).population = 0;
          world.stations!.set(id, { kind: "gone", serves: ruin.id });
          return { id, point };
        } });
      }
    }
    // Split from the far end back, so each split's `along` is still on the piece left.
    // Never two within half a spacing (two towns' approaches can fall close together).
    let current = original.id;
    const kept = stops.sort((p, q) => p.along - q.along).filter((s, i, all) => i === 0 || s.along - all[i - 1]!.along > spacing * 0.5);
    for (const stop of [...kept].reverse()) {
      const { id, point } = stop.make();
      splitRail(world, current, stop.along, id, point);
      current = `${current}.a`;
    }
  }
  rebuildNetworks(world);
  world.plans = null;
}

/** The station a place is on the old line, if it is one. */
export function stationOf(world: GameWorld, id: string): StationInfo | undefined {
  return world.stations?.get(id);
}

/**
 * A station of its own (out of its town, or where the town has gone) grows a town of its name
 * where trains stop and riders change there -- `stationTownRiders` a day -- as a roadside town
 * appears where traffic stops (settlement.ts), and capped the same way (`maxEmergentTowns`).
 * Once a game day (settlement.ts).
 */
export function foundStationTowns(world: GameWorld): GameEvent | null {
  const t = world.tuning;
  if (!world.stations || !t.stationTownRiders) return null;
  const { settlement } = world;
  if (settlement.emergent.size >= t.maxEmergentTowns) return null;
  if (settlement.elapsedSeconds - settlement.lastFoundedAtSeconds < t.minSecondsBetweenTowns) return null;
  const served = stationTowns(world);
  for (const [id, info] of world.stations) {
    const place = world.towns.get(id);
    if (info.kind === "town" || !place || place.industry !== "station" || !served.has(id)) continue;
    if ((world.transferRateEMA.get(id) ?? 0) * SECONDS_PER_GAME_DAY < t.stationTownRiders) continue;
    delete place.industry;
    place.population = t.newTownPopulation;
    // Where the town had gone, it comes back by its old name, and its ruin goes.
    if (info.kind === "gone") {
      place.name = place.name.replace(/ Station$/, "");
      world.ruins.delete(info.serves);
    }
    settlement.emergent.add(id);
    settlement.lastFoundedAtSeconds = settlement.elapsedSeconds;
    return { kind: "founded", townId: id, name: place.name, between: [info.serves, id], site: id };
  }
  return null;
}

/** A town grown at a station, emptied: back to a station on the line, not off the map (settlement.ts). */
export function backToStation(world: GameWorld, townId: string): boolean {
  const info = world.stations?.get(townId);
  const place = world.towns.get(townId);
  if (!info || info.kind === "town" || !place || place.industry) return false;
  place.industry = "station";
  place.population = 0;
  if (info.kind === "gone") {
    world.ruins.set(info.serves, { id: info.serves, name: place.name, x: place.x + 2, y: place.y + 2, population: 0 });
    place.name = `${place.name} Station`;
  }
  world.settlement.emergent.delete(townId);
  return true;
}

/** The size riders changing trains at a station town hold it to: a new town's at `stationTownRiders` a day, more with more. 0 elsewhere. */
export function stationPull(world: GameWorld, townId: string): number {
  const info = world.stations?.get(townId);
  const t = world.tuning;
  if (!info || info.kind === "town" || !t.stationTownRiders) return 0;
  const riders = (world.transferRateEMA.get(townId) ?? 0) * SECONDS_PER_GAME_DAY;
  return (riders / t.stationTownRiders) * t.newTownPopulation;
}

/** Whether the old line is open at a station: a stretch of track to it restored (rail.ts). */
export function stationOpen(world: GameWorld, id: string): boolean {
  return world.simulation.map.segments.some((s) => s.type === "rail" && (s.fromNodeId === id || s.toNodeId === id) && !world.railOutOfService.has(s.id));
}
