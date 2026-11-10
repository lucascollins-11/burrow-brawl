import { isqrt } from "../fixed";
import { createTerrain } from "./terrain";
import type { Terrain } from "./types";
import { BEDROCK, CLAY, CRUST, DEFAULT_HEIGHT, DEFAULT_WIDTH, DIRT } from "./types";

/**
 * Deterministic hand-rolled hills for the debug client and tests. Integer only.
 * The real procedural generator (H3) replaces this for matches.
 */
export function createDemoTerrain(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT): Terrain {
  const t = createTerrain(width, height);
  const base = Math.floor(height * 0.55);
  for (let x = 0; x < width; x++) {
    // Triangle-wave hills of two frequencies, no floats. Slopes stay under 1 so critters can walk them.
    const w1 = Math.abs((x % 640) - 320) - 160; // -160..160, slope 1
    const w2 = Math.abs(((x * 2) % 80) - 40) - 20; // -20..20, slope 2
    const surface = base - Math.floor(w1 / 2) - Math.floor(w2 / 4);
    for (let y = Math.max(0, surface); y < height; y++) {
      let m = DIRT;
      if (y < surface + 6) m = CRUST;
      else if (isqrt((x % 97) * (x % 97) + ((y * 3) % 61) * ((y * 3) % 61)) < 14) m = CLAY;
      if (y >= height - 8) m = BEDROCK;
      t.cells[y * width + x] = m;
    }
  }
  return t;
}
