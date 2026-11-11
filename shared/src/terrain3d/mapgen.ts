import { type GeneratedMap, type MapRecipe } from "./api.js";
import { applyEdit } from "./edit.js";
import { createTerrain, topSolidY } from "./grid.js";
import { findSpawns, hashInt, mix32 } from "./spawns.js";
import { BEDROCK_Y, SEA_Y } from "./generate.js";

// Generator v2: a 2D integer heightfield (island bump + two octaves of value noise) plus sculpt
// ops (blobs, arches, tunnels) applied through the same sphere edits the game uses. Pure integer.

/**
 * Reference value noise on a lattice of `cell` voxels, result in [0, 65536). The generator uses the
 * table version below; this one stays as the readable definition the tests compare against.
 */
function noise2(seed: number, salt: number, x: number, z: number, cell: number): number {
  const gx = Math.floor(x / cell);
  const gz = Math.floor(z / cell);
  const fx = Math.floor(((x - gx * cell) * 256) / cell);
  const fz = Math.floor(((z - gz * cell) * 256) / cell);
  const sx = (fx * fx * (768 - 2 * fx)) >> 16;
  const sz = (fz * fz * (768 - 2 * fz)) >> 16;
  const v = (a: number, b: number): number =>
    mix32(seed, salt, (a & 0xffff) * 65536 + (b & 0xffff)) & 0xff;
  const top = v(gx, gz) * (256 - sx) + v(gx + 1, gz) * sx;
  const bot = v(gx, gz + 1) * (256 - sx) + v(gx + 1, gz + 1) * sx;
  return (top * (256 - sz) + bot * sz) >> 8;
}

/** Surface height in 1/256 voxel units (reference definition; `heightField` computes the same). */
export function heightAt(seed: number, w: number, d: number, x: number, z: number): number {
  const cx = w >> 1;
  const cz = d >> 1;
  const r2 = ((x - cx) ** 2 + (z - cz) ** 2) * 256;
  const R = Math.min(cx, cz);
  const bump = Math.max(0, 256 - Math.floor(r2 / (R * R)));
  const n1 = noise2(seed, 1, x, z, 32) - 32768;
  const n2 = noise2(seed, 2, x, z, 12) - 32768;
  return 9 * 256 + bump * 30 + (n1 >> 3) + (n2 >> 5) + (bump > 40 ? 0 : -((40 - bump) << 2));
}

/** One noise octave on a `cell`-voxel lattice, with everything that depends on one axis tabulated. */
interface Octave {
  lat: Uint8Array;
  stride: number;
  gx: Int32Array;
  sx: Int32Array;
  gz: Int32Array;
  sz: Int32Array;
}

function axisTable(n: number, cell: number): { g: Int32Array; s: Int32Array } {
  const g = new Int32Array(n);
  const s = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const gi = Math.floor(i / cell);
    const f = Math.floor(((i - gi * cell) * 256) / cell);
    g[i] = gi;
    s[i] = (f * f * (768 - 2 * f)) >> 16;
  }
  return { g, s };
}

function octave(seed: number, salt: number, w: number, d: number, cell: number): Octave {
  const ax = axisTable(w, cell);
  const az = axisTable(d, cell);
  const stride = Math.floor((w - 1) / cell) + 2;
  const rows = Math.floor((d - 1) / cell) + 2;
  const lat = new Uint8Array(stride * rows);
  for (let b = 0; b < rows; b++)
    for (let a = 0; a < stride; a++)
      lat[b * stride + a] = mix32(seed, salt, (a & 0xffff) * 65536 + (b & 0xffff)) & 0xff;
  return { lat, stride, gx: ax.g, sx: ax.s, gz: az.g, sz: az.s };
}

/** Same value as `noise2` at (x, z). */
function sample(o: Octave, x: number, z: number): number {
  const i = o.gz[z]! * o.stride + o.gx[x]!;
  const sx = o.sx[x]!;
  const sz = o.sz[z]!;
  const top = o.lat[i]! * (256 - sx) + o.lat[i + 1]! * sx;
  const bot = o.lat[i + o.stride]! * (256 - sx) + o.lat[i + o.stride + 1]! * sx;
  return (top * (256 - sz) + bot * sz) >> 8;
}

/** `heightAt` for every column, z-major: result[z * w + x]. */
export function heightField(seed: number, w: number, d: number): Int32Array {
  const cx = w >> 1;
  const cz = d >> 1;
  const R = Math.min(cx, cz);
  const o1 = octave(seed, 1, w, d, 32);
  const o2 = octave(seed, 2, w, d, 12);
  const out = new Int32Array(w * d);
  for (let z = 0; z < d; z++) {
    const dz2 = (z - cz) ** 2;
    for (let x = 0; x < w; x++) {
      const r2 = ((x - cx) ** 2 + dz2) * 256;
      const bump = Math.max(0, 256 - Math.floor(r2 / (R * R)));
      const n1 = sample(o1, x, z) - 32768;
      const n2 = sample(o2, x, z) - 32768;
      out[z * w + x] =
        9 * 256 + bump * 30 + (n1 >> 3) + (n2 >> 5) + (bump > 40 ? 0 : -((40 - bump) << 2));
    }
  }
  return out;
}

export function generateV2(recipe: MapRecipe): GeneratedMap {
  const seed = recipe.seed >>> 0;
  const t = createTerrain(recipe.sizeX, recipe.sizeY, recipe.sizeZ, BEDROCK_Y, SEA_Y);
  const { sizeX: w, sizeY: h, sizeZ: d, density } = t;
  // Heightfield once per column, then fill layer by layer (rows are contiguous in memory).
  // v = 128 + ((hf - y * 256) >> 2), clamped to 0..255: bedrock and everything well below the
  // lowest surface is solid, everything well above the highest is air, so only the layers in
  // between need a per-voxel pass. Same bytes as evaluating every voxel.
  const hfs = heightField(seed, w, d);
  let minHf = Infinity;
  let maxHf = -Infinity;
  for (let i = 0; i < hfs.length; i++) {
    const hf = hfs[i]!;
    if (hf < minHf) minHf = hf;
    if (hf > maxHf) maxHf = hf;
  }
  const layer = w * d;
  for (let y = 0; y < h; y++) {
    const base = y * layer;
    if (y < BEDROCK_Y || y * 256 <= minHf - 508) {
      density.fill(255, base, base + layer);
      continue;
    }
    if (y * 256 > maxHf + 508) break; // this layer and every layer above is already 0
    const yy = y * 256;
    for (let i = 0; i < layer; i++) {
      const v = 128 + ((hfs[i]! - yy) >> 2);
      density[base + i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }

  const rnd = (salt: number, i: number, n: number): number => hashInt(seed, salt, i, n);
  const fill = (x: number, y: number, z: number, r: number): void => {
    applyEdit(t, { op: "fill", x, y, z, r });
  };
  const carve = (x: number, y: number, z: number, r: number): void => {
    applyEdit(t, { op: "carve", x, y, z, r });
  };
  const area = (w * d) >> 12;
  const margin = 24;
  const px = (i: number, s: number): number => margin + rnd(s, i, w - 2 * margin);
  const pz = (i: number, s: number): number => margin + rnd(s, i, d - 2 * margin);
  const surf = (x: number, z: number): number => Math.max(0, topSolidY(t, x, z));

  // Blobs: lumps of clay on and above the ground.
  for (let i = 0; i < area; i++) {
    const x = px(i, 10);
    const z = pz(i, 11);
    fill(x, surf(x, z) + 6 + rnd(13, i, 14), z, 4 + rnd(12, i, 7));
  }
  // Arches: a fill ring along a parabola between two ground points.
  for (let i = 0; i < (area >> 1) + 2; i++) {
    const x0 = px(i, 20);
    const z0 = pz(i, 21);
    const len = 14 + rnd(22, i, 14);
    const alongX = rnd(23, i, 2) === 1;
    const x1 = Math.min(w - 2, alongX ? x0 + len : x0);
    const z1 = Math.min(d - 2, alongX ? z0 : z0 + len);
    const y0 = surf(x0, z0);
    const y1 = surf(x1, z1);
    const lift = 8 + rnd(24, i, 8);
    const n = 12;
    for (let s = 0; s <= n; s++) {
      fill(
        x0 + Math.floor(((x1 - x0) * s) / n),
        y0 + Math.floor(((y1 - y0) * s) / n) + Math.floor((4 * lift * s * (n - s)) / (n * n)),
        z0 + Math.floor(((z1 - z0) * s) / n),
        3,
      );
    }
  }
  // Tunnels: a wobbly line of carved spheres through the land.
  for (let i = 0; i < (area >> 1) + 2; i++) {
    let x = px(i, 30);
    let z = pz(i, 31);
    const y = Math.max(SEA_Y + 3, surf(x, z) - 8 - rnd(32, i, 5));
    const steps = 16 + rnd(33, i, 12);
    let dx = rnd(34, i, 3) - 1;
    let dz = rnd(35, i, 3) - 1;
    if (!dx && !dz) dx = 1;
    for (let s = 0; s < steps; s++) {
      carve(x, y + (rnd(36, i * 64 + s, 3) - 1), z, 3);
      x = Math.max(4, Math.min(w - 5, x + dx * 2));
      z = Math.max(4, Math.min(d - 5, z + dz * 2));
      if (s % 5 === 4) {
        dx = Math.max(-1, Math.min(1, dx + rnd(37, i * 64 + s, 3) - 1));
        dz = Math.max(-1, Math.min(1, dz + rnd(38, i * 64 + s, 3) - 1));
        if (!dx && !dz) dz = 1;
      }
    }
  }

  // Generation edits are part of the recipe, not the edit log.
  t.edits.length = 0;
  t.chunkVersion.fill(0);
  return { terrain: t, spawns: findSpawns(t, seed) };
}
