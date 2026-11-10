import type { Terrain } from "../terrain";
import { isSolid } from "../terrain";
import { CRITTER_HALF_WIDTH, CRITTER_HEIGHT, SIDE_CLEARANCE } from "./constants";

/**
 * True if the critter body, with feet at cell (x, y), overlaps terrain. The body is a capsule-ish
 * shape: the centre columns reach down to the feet, but the outer columns only start SIDE_CLEARANCE
 * cells above them, so slopes and small bumps are climbed by the feet instead of blocking the sides.
 */
export function bodyBlocked(t: Terrain, x: number, y: number): boolean {
  for (let dx = -CRITTER_HALF_WIDTH; dx <= CRITTER_HALF_WIDTH; dx++) {
    const from = Math.abs(dx) <= 1 ? 0 : SIDE_CLEARANCE;
    // Every row is sampled, so thin overhangs and ledges cannot slip between probes.
    for (let dy = from; dy < CRITTER_HEIGHT; dy++) {
      if (isSolid(t, x + dx, y - dy)) return true;
    }
  }
  return false;
}

/** True if solid ground lies directly under the feet (cell row y + 1), checked under the centre columns. */
export function hasGround(t: Terrain, x: number, y: number): boolean {
  for (let dx = -1; dx <= 1; dx++) {
    if (isSolid(t, x + dx, y + 1)) return true;
  }
  return false;
}
