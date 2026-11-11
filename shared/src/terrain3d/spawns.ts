import { SOLID, type SpawnPoint, type VoxelTerrain } from "./api.js";
import { topSolidY } from "./grid.js";

const HEADROOM = 8;
const MAX_SPAWNS = 64;

function mix(a: number, b: number, c: number): number {
  let h =
    Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^
    Math.imul(b + 0x7f4a7c15, 0xc2b2ae35) ^
    Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Deterministic integer in [0, n) from (seed, salt, i). Shared by the generators. */
export function hashInt(seed: number, salt: number, i: number, n: number): number {
  return mix(seed, salt, i) % n;
}

/**
 * Grounded, dry, flat, roomy spots, picked farthest-first so consecutive picks are spread out.
 * Teams take them interleaved (critter j of team t = spawns[j * teams + t]).
 */
export function findSpawns(t: VoxelTerrain, seed: number): SpawnPoint[] {
  const { sizeX: w, sizeY: h, sizeZ: d, density } = t;
  const at = (x: number, y: number, z: number): number => density[(y * d + z) * w + x]!;
  const cands: SpawnPoint[] = [];
  const m = 6;
  for (let z = m; z < d - m; z += 3)
    for (let x = m; x < w - m; x += 3) {
      const jx = Math.min(w - m - 1, x + hashInt(seed, 40, z * w + x, 3));
      const jz = Math.min(d - m - 1, z + hashInt(seed, 41, z * w + x, 3));
      const top = topSolidY(t, jx, jz);
      const y = top + 1;
      if (top < t.seaY + 2 || y + HEADROOM >= h) continue;
      let ok = true;
      for (let dy = 0; dy < HEADROOM && ok; dy++)
        for (let dz = -1; dz <= 1 && ok; dz++)
          for (let dx = -1; dx <= 1 && ok; dx++)
            if (at(jx + dx, y + dy, jz + dz) >= SOLID) ok = false;
      if (!ok) continue;
      for (const [dx, dz] of [
        [3, 0],
        [-3, 0],
        [0, 3],
        [0, -3],
      ] as const)
        if (Math.abs(topSolidY(t, jx + dx, jz + dz) - top) > 2) ok = false;
      if (ok) cands.push({ x: jx, y, z: jz });
    }
  const out: SpawnPoint[] = [];
  if (!cands.length) return out;
  const minD = new Array<number>(cands.length).fill(Infinity);
  let next = hashInt(seed, 42, 0, cands.length);
  while (out.length < MAX_SPAWNS) {
    const c = cands[next]!;
    out.push(c);
    let best = -1;
    let bestD = 0;
    for (let i = 0; i < cands.length; i++) {
      const o = cands[i]!;
      const dd = (o.x - c.x) ** 2 + (o.z - c.z) ** 2 + (o.y - c.y) ** 2;
      if (dd < minD[i]!) minD[i] = dd;
      if (minD[i]! > bestD) {
        bestD = minD[i]!;
        best = i;
      }
    }
    if (best < 0 || bestD < 36) break;
    next = best;
  }
  return out;
}
