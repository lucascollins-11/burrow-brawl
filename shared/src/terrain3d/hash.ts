import { CHUNK, type VoxelTerrain } from "./api.js";

interface Cache {
  /** version + 1 the hash was computed at (0 = never). */
  at: Uint32Array;
  h: Uint32Array;
}
const caches = new WeakMap<VoxelTerrain, Cache>();

function chunkHash(t: VoxelTerrain, cx: number, cy: number, cz: number): number {
  let h = 0x811c9dc5;
  for (let y = cy * CHUNK; y < (cy + 1) * CHUNK; y++)
    for (let z = cz * CHUNK; z < (cz + 1) * CHUNK; z++) {
      const base = (y * t.sizeZ + z) * t.sizeX + cx * CHUNK;
      for (let x = 0; x < CHUNK; x++) h = Math.imul(h ^ t.density[base + x]!, 0x01000193);
    }
  return h >>> 0;
}

/** u32 hash of the grid: a fold of per-chunk hashes in chunk order, each cached by chunk version. */
export function hash(t: VoxelTerrain): number {
  const n = t.chunksX * t.chunksY * t.chunksZ;
  let c = caches.get(t);
  if (!c) {
    c = { at: new Uint32Array(n), h: new Uint32Array(n) };
    caches.set(t, c);
  }
  let acc = 0x811c9dc5 ^ (t.sizeX | (t.sizeY << 10) | (t.sizeZ << 20));
  for (let i = 0; i < n; i++) {
    const v = (t.chunkVersion[i]! + 1) >>> 0;
    if (c.at[i] !== v) {
      const cx = i % t.chunksX;
      const cz = Math.floor(i / t.chunksX) % t.chunksZ;
      const cy = Math.floor(i / (t.chunksX * t.chunksZ));
      c.h[i] = chunkHash(t, cx, cy, cz);
      c.at[i] = v;
    }
    acc = Math.imul(acc ^ c.h[i]!, 0x01000193);
    acc = ((acc << 13) | (acc >>> 19)) >>> 0;
  }
  return acc >>> 0;
}
