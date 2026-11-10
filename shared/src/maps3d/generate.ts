// Map generator v2 (3D). Pure integer: a 2D heightfield plus a list of sculpt
// ops (blobs, arches, tunnels), written into one flat density array indexed
// (y*depth+z)*width+x. Solid means density >= 128. No floats, no Math.random,
// so every client regenerates the same map from the seed.
//
// NOTE: sphere ops here are internal until the terrain3d contract lands; swap
// them for the contract's carve/fill then.

import { isqrt } from "../fixed.js";

export const SOLID = 128;

export interface GenOptions {
  seed: number;
  width?: number; // x, multiple of 32
  depth?: number; // z, multiple of 32
  height?: number; // y
}

export interface Spawn {
  x: number;
  y: number; // first air voxel above the ground
  z: number;
}

export interface GeneratedMap {
  seed: number;
  width: number;
  depth: number;
  height: number;
  density: Uint8Array;
  seaLevel: number;
  bedrockY: number;
  /** Spread-out spawn candidates, farthest-first. Critter j of team t = spawns[j * teams + t]. */
  spawns: Spawn[];
}

export const MAP_HEIGHT = 96;
export const SEA_LEVEL = 26;
export const BEDROCK_Y = 3;
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

/** Deterministic integer in [0, n). */
function rnd(seed: number, salt: number, i: number, n: number): number {
  return mix(seed, salt, i) % n;
}

/** Value noise on a lattice of `cell` voxels, result in [0, 256*256). */
function noise2(seed: number, salt: number, x: number, z: number, cell: number): number {
  const gx = Math.floor(x / cell);
  const gz = Math.floor(z / cell);
  const fx = Math.floor(((x - gx * cell) * 256) / cell);
  const fz = Math.floor(((z - gz * cell) * 256) / cell);
  const sx = (fx * fx * (768 - 2 * fx)) >> 16; // smoothstep, 0..256
  const sz = (fz * fz * (768 - 2 * fz)) >> 16;
  const v = (a: number, b: number) => mix(seed, salt, (a & 0xffff) * 65536 + (b & 0xffff)) & 0xff;
  const top = v(gx, gz) * (256 - sx) + v(gx + 1, gz) * sx;
  const bot = v(gx, gz + 1) * (256 - sx) + v(gx + 1, gz + 1) * sx;
  return (top * (256 - sz) + bot * sz) >> 8; // 0..65535 -> 8-bit * 256
}

/** Heightfield in 1/256 voxel units. */
function heightAt(seed: number, w: number, d: number, x: number, z: number): number {
  const cx = w >> 1;
  const cz = d >> 1;
  const dx = x - cx;
  const dz = z - cz;
  const r2 = (dx * dx + dz * dz) * 256;
  const R2 = Math.min(cx, cz) * Math.min(cx, cz);
  // Island bump: plateau in the middle, falling off to the seabed at the rim.
  const bump = Math.max(0, 256 - Math.floor(r2 / R2));
  const n1 = noise2(seed, 1, x, z, 32) - 32768; // +-128 voxels*256/256
  const n2 = noise2(seed, 2, x, z, 12) - 32768;
  const base = 9 * 256 + Math.floor((bump * 30 * 256) / 256) * 1;
  return base + (n1 >> 3) + (n2 >> 5) + (bump > 40 ? 0 : -((40 - bump) << 2));
}

type Sphere = (cx: number, cy: number, cz: number, r: number, carve: boolean) => void;

function makeSphere(
  density: Uint8Array,
  w: number,
  d: number,
  h: number,
  bedrockY: number,
): Sphere {
  return (cx, cy, cz, r, carve) => {
    const r16 = r * 16;
    const y0 = Math.max(carve ? bedrockY : 0, cy - r - 1);
    const y1 = Math.min(h - 1, cy + r + 1);
    const z0 = Math.max(0, cz - r - 1);
    const z1 = Math.min(d - 1, cz + r + 1);
    const x0 = Math.max(0, cx - r - 1);
    const x1 = Math.min(w - 1, cx + r + 1);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
          if (d2 > (r + 1) * (r + 1)) continue;
          const dist16 = isqrt(d2 << 8);
          const k = Math.max(0, Math.min(127, (r16 - dist16) * 4)); // falloff 0..127 inside
          const i = (y * d + z) * w + x;
          if (carve) {
            const cap = dist16 >= r16 ? 255 : 127 - k;
            if (density[i]! > cap) density[i] = cap < 0 ? 0 : cap;
          } else if (dist16 < r16 + 16) {
            const val = Math.min(255, 128 + k);
            if (dist16 < r16 && density[i]! < val) density[i] = val;
          }
        }
  };
}

function topSolid(
  density: Uint8Array,
  w: number,
  d: number,
  h: number,
  x: number,
  z: number,
): number {
  for (let y = h - 1; y >= 0; y--) if (density[(y * d + z) * w + x]! >= SOLID) return y;
  return -1;
}

export function generateMap(opts: GenOptions): GeneratedMap {
  const width = opts.width ?? 256;
  const depth = opts.depth ?? 256;
  const height = opts.height ?? MAP_HEIGHT;
  if (width % 32 || depth % 32 || width < 96 || depth < 96)
    throw new RangeError("width/depth must be multiples of 32 (>= 96)");
  const seed = opts.seed >>> 0;
  const density = new Uint8Array(width * depth * height);
  const bedrockY = BEDROCK_Y;

  // 1. heightfield -> density with a smooth ramp across the surface voxel.
  for (let z = 0; z < depth; z++)
    for (let x = 0; x < width; x++) {
      const hf = heightAt(seed, width, depth, x, z);
      for (let y = 0; y < height; y++) {
        const v = y < bedrockY ? 255 : 128 + ((hf - y * 256) >> 2);
        density[(y * depth + z) * width + x] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }

  const sphere = makeSphere(density, width, depth, height, bedrockY);
  const area = (width * depth) >> 12; // 16 for 256x256
  const margin = 24;
  const px = (i: number, s: number) => margin + rnd(seed, s, i, width - 2 * margin);
  const pz = (i: number, s: number) => margin + rnd(seed, s, i, depth - 2 * margin);
  const surfY = (x: number, z: number) =>
    Math.max(0, topSolid(density, width, depth, height, x, z));

  // 2. blobs: floating and ground-attached lumps of clay.
  for (let i = 0; i < area; i++) {
    const x = px(i, 10);
    const z = pz(i, 11);
    const r = 4 + rnd(seed, 12, i, 7);
    sphere(x, surfY(x, z) + 6 + rnd(seed, 13, i, 14), z, r, false);
  }

  // 3. arches: a fill ring along a parabola between two ground points.
  for (let i = 0; i < (area >> 1) + 2; i++) {
    const x0 = px(i, 20);
    const z0 = pz(i, 21);
    const len = 14 + rnd(seed, 22, i, 14);
    const dir = rnd(seed, 23, i, 2);
    const x1 = Math.min(width - 2, dir ? x0 + len : x0);
    const z1 = Math.min(depth - 2, dir ? z0 : z0 + len);
    const y0 = surfY(x0, z0);
    const y1 = surfY(x1, z1);
    const lift = 8 + rnd(seed, 24, i, 8);
    const n = 12;
    for (let t = 0; t <= n; t++) {
      const x = x0 + Math.floor(((x1 - x0) * t) / n);
      const z = z0 + Math.floor(((z1 - z0) * t) / n);
      const y =
        y0 + Math.floor(((y1 - y0) * t) / n) + Math.floor((4 * lift * t * (n - t)) / (n * n));
      sphere(x, y, z, 3, false);
    }
  }

  // 4. tunnels: carve a wobbly line of spheres through the land.
  for (let i = 0; i < (area >> 1) + 2; i++) {
    let x = px(i, 30);
    let z = pz(i, 31);
    const y = Math.max(SEA_LEVEL + 3, surfY(x, z) - 8 - rnd(seed, 32, i, 5));
    const steps = 16 + rnd(seed, 33, i, 12);
    let dx = rnd(seed, 34, i, 3) - 1;
    let dz = rnd(seed, 35, i, 3) - 1;
    if (!dx && !dz) dx = 1;
    for (let t = 0; t < steps; t++) {
      sphere(x, y + (rnd(seed, 36, i * 64 + t, 3) - 1), z, 3, true);
      x = Math.max(4, Math.min(width - 5, x + dx * 2));
      z = Math.max(4, Math.min(depth - 5, z + dz * 2));
      if (t % 5 === 4) {
        dx = Math.max(-1, Math.min(1, dx + rnd(seed, 37, i * 64 + t, 3) - 1));
        dz = Math.max(-1, Math.min(1, dz + rnd(seed, 38, i * 64 + t, 3) - 1));
        if (!dx && !dz) dz = 1;
      }
    }
  }

  return {
    seed,
    width,
    depth,
    height,
    density,
    seaLevel: SEA_LEVEL,
    bedrockY,
    spawns: findSpawns(seed, density, width, depth, height),
  };
}

/** Grounded, flat, roomy, dry spots; greedy farthest-first so they spread out. */
function findSpawns(seed: number, density: Uint8Array, w: number, d: number, h: number): Spawn[] {
  const at = (x: number, y: number, z: number) => density[(y * d + z) * w + x]!;
  const cands: Spawn[] = [];
  const m = 6;
  for (let z = m; z < d - m; z += 3)
    for (let x = m; x < w - m; x += 3) {
      const jx = Math.min(w - m - 1, x + rnd(seed, 40, z * w + x, 3));
      const jz = Math.min(d - m - 1, z + rnd(seed, 41, z * w + x, 3));
      const top = topSolid(density, w, d, h, jx, jz);
      const y = top + 1;
      if (top < SEA_LEVEL + 2 || y + HEADROOM >= h) continue;
      // headroom: a column of air as wide as the critter
      let ok = true;
      for (let dy = 0; dy < HEADROOM && ok; dy++)
        for (let dz = -1; dz <= 1 && ok; dz++)
          for (let dx = -1; dx <= 1 && ok; dx++)
            if (at(jx + dx, y + dy, jz + dz) >= SOLID) ok = false;
      if (!ok) continue;
      // flat footprint: ground within 2 voxels of the same height around
      for (const [dx, dz] of [
        [3, 0],
        [-3, 0],
        [0, 3],
        [0, -3],
      ] as const) {
        const t2 = topSolid(density, w, d, h, jx + dx, jz + dz);
        if (Math.abs(t2 - top) > 2) ok = false;
      }
      if (ok) cands.push({ x: jx, y, z: jz });
    }
  const out: Spawn[] = [];
  if (!cands.length) return out;
  const minD = new Array<number>(cands.length).fill(Infinity);
  let next = rnd(seed, 42, 0, cands.length);
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
    if (best < 0 || bestD < 36) break; // nothing at least 6 voxels from every pick
    next = best;
  }
  return out;
}
