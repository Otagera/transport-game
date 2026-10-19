import type { SliceMapDef, SliceRiverDef } from "./types";
import { createRng, type Rng } from "../map/random";

// A seeded variation of the hand-made map (docs/brief.md, Revision 1, the
// order, step 3; check P8: a new seed changes at least your first three
// moves). The same geography -- the same towns in the same places, the same
// inherited roads and old railway, the ridge -- with two things a seed moves:
//
//   - Town sizes. Ilase stays the dominant city (a little bigger or smaller);
//     every other town is between half and twice its authored size (a town
//     no inherited road reaches, between a third and three times), and
//     never more than VARIED_TOWN_CAP of Ilase. A cut-off town that comes up
//     big is a road worth building on day 1; one that comes up small isn't.
//   - Where the river is cheap to cross. Its course shifts sideways a few
//     cells between its authored points, and its width varies along it,
//     with one narrow stretch (a ford): a bridge is paid by the water cell
//     (pathing/cost.ts), so where the narrow stretch lands decides which
//     crossing a road takes. Every town stays on its own bank, clear of the
//     water.
//
// Seed 0 is the authored map, unchanged: every measurement before the
// variation was taken on it, and the probes keep it as their default.
// Full map generation waits until this has been played (the brief).

/** Ilase is multiplied by this range; the dominant city stays dominant. */
const DOMINANT_RANGE: [number, number] = [0.85, 1.2];
/** Every other town, between these multiples of its authored size (log-uniform). */
const TOWN_RANGE: [number, number] = [0.5, 2];
/**
 * A town no inherited road reaches, wider (P8 (b)): on some seeds it comes up
 * big enough that an opening without a road to it loses riders, on others
 * small enough that the road waits. At 0.5-2 like the rest, another map's
 * opening served as many of your riders as the map's own (status.md).
 */
const CUT_OFF_RANGE: [number, number] = [1 / 3, 3];
/** No other town grows past this share of the dominant city. */
const VARIED_TOWN_CAP = 0.7;
/** Smallest town, thousands. */
const MIN_TOWN = 8;
/** How far the river's course moves sideways at each authored point, cells. */
const RIVER_SHIFT = 5;
/** The ford's width, and the range of widths elsewhere, cells. */
const FORD_WIDTH = 1.2;
const RIVER_WIDTHS: [number, number] = [2.5, 5];
/** Water stays at least this many cells from any town. */
const TOWN_CLEARANCE = 2;

const between = (rng: Rng, [lo, hi]: [number, number]) => lo + (hi - lo) * rng();

export function variedSliceMap(base: SliceMapDef, seed: number): SliceMapDef {
  const map = structuredClone(base);
  if (seed === 0) return map;
  const rng = createRng(seed);

  varyTownSizes(map, rng);

  const rivers = map.terrain?.rivers ?? [];
  rivers.forEach((_, r) => {
    // A shifted course that puts water on a town, or a town across the river, is drawn again.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = shiftedRiver(base.terrain!.rivers![r]!, rng);
      if (base.towns.every((town) => clearOfTown(base.terrain!.rivers![r]!, candidate, town.x, town.y))) {
        rivers[r] = candidate;
        return;
      }
    }
  });
  return map;
}

/**
 * Varies every town's size in place, from its size now: the dominant city
 * by DOMINANT_RANGE, staying the largest; a town no road in `map.roads`
 * reaches by CUT_OFF_RANGE; the rest by TOWN_RANGE, never past
 * VARIED_TOWN_CAP of the dominant city. Shared with generate.ts, which
 * gives its towns the authored map's sizes first.
 */
export function varyTownSizes(map: SliceMapDef, rng: Rng): void {
  const dominant = map.towns.reduce((big, town) => (town.population > big.population ? town : big));
  const dominantPopulation = Math.round(dominant.population * between(rng, DOMINANT_RANGE));
  for (const town of map.towns) {
    if (town.id === dominant.id) {
      town.population = dominantPopulation;
      continue;
    }
    const range = map.roads.some((road) => road.a === town.id || road.b === town.id) ? TOWN_RANGE : CUT_OFF_RANGE;
    const scale = Math.exp(between(rng, [Math.log(range[0]), Math.log(range[1])]));
    town.population = Math.max(MIN_TOWN, Math.min(Math.round(VARIED_TOWN_CAP * dominantPopulation), Math.round(town.population * scale)));
  }
}

function shiftedRiver(river: SliceRiverDef, rng: Rng): SliceRiverDef {
  const last = river.points.length - 1;
  // The ends run off the map: they stay put, so the river still splits it.
  const points = river.points.map(([x, y], i): [number, number] => [i === 0 || i === last ? x : Math.round(x + (rng() * 2 - 1) * RIVER_SHIFT), y]);
  const widths = river.points.map(() => between(rng, RIVER_WIDTHS));
  // The ford: one point between the ends.
  widths[1 + Math.floor(rng() * (last - 1))] = FORD_WIDTH;
  return { points, width: river.width, widths };
}

/** The river's centre and width where it passes a row (its points run down the map). */
function riverAt(river: SliceRiverDef, y: number): { x: number; width: number } {
  const { points } = river;
  for (let k = 1; k < points.length; k += 1) {
    const [ax, ay] = points[k - 1]!;
    const [bx, by] = points[k]!;
    if (y < ay || y > by) continue;
    const t = by === ay ? 0 : (y - ay) / (by - ay);
    const width = river.widths ? river.widths[k - 1]! + (river.widths[k]! - river.widths[k - 1]!) * t : river.width;
    return { x: ax + (bx - ax) * t, width };
  }
  return { x: points[0]![0], width: river.width };
}

/** A town stays on the bank it was authored on, with dry land round it. */
function clearOfTown(authored: SliceRiverDef, varied: SliceRiverDef, x: number, y: number): boolean {
  const before = riverAt(authored, y);
  const after = riverAt(varied, y);
  // The course bends between rows: check a few rows round the town too.
  const near = [-2, -1, 0, 1, 2].every((dy) => {
    const at = riverAt(varied, y + dy);
    return Math.abs(x - at.x) > at.width / 2 + TOWN_CLEARANCE;
  });
  return near && Math.sign(x - before.x) === Math.sign(x - after.x);
}
