import type { Fixed } from "../fixed";
import { FIXED_ONE, isqrt } from "../fixed";
import { isSolid } from "./terrain";
import type { RayHit, Terrain } from "./types";

/** Integer Bresenham line. Returns the first solid cell, starting cell included. */
export function raycast(t: Terrain, x0: number, y0: number, x1: number, y1: number): RayHit {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (isSolid(t, x, y)) return { hit: true, x, y };
    if (x === x1 && y === y1) return { hit: false, x, y };
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Outward surface normal at a cell in Q16.16, pointing from solid toward air
 * (+y is down in mask space, so a flat floor gives ny = -1). Sums the offsets of
 * air cells in a 5x5 window. Returns {0, 0} when the window is uniform.
 */
export function surfaceNormal(t: Terrain, x: number, y: number): { nx: Fixed; ny: Fixed } {
  let sx = 0;
  let sy = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (!isSolid(t, x + dx, y + dy)) {
        sx += dx;
        sy += dy;
      }
    }
  }
  const len = isqrt(sx * sx + sy * sy);
  if (len === 0) return { nx: 0, ny: 0 };
  return {
    nx: Math.trunc((sx * FIXED_ONE) / len) | 0,
    ny: Math.trunc((sy * FIXED_ONE) / len) | 0,
  };
}
