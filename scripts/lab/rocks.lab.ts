// Where a map's granite outcrops are (the 3D view's inselbergs).   bun scripts/lab/rocks.lab.ts seed
import { GAME_MAP } from "../../src/game/map";
import { gameMap } from "../../src/engine/game/region";
import { DEFAULT_GAME_TUNING } from "../../src/engine/game/tuning";
const map = gameMap(GAME_MAP, Number(process.argv[2] ?? 42), DEFAULT_GAME_TUNING);
const rocks = (map.terrain?.hills ?? []).filter((h) => h.radius <= 4.5 && h.height >= 2.8);
console.log(map.region, rocks.length, "rocks:", rocks.slice(0, 8).map((h) => `${h.x},${h.y}`).join(" "));
const home = map.towns.reduce((a, b) => (b.population > a.population ? b : a));
console.log("home city", home.name, home.x, home.y);
