import { type GeneratedMap, type MapRecipe } from "./api.js";
import { applyEdit } from "./edit.js";
import { createTerrain, topSolidY } from "./grid.js";
import { findSpawns, hashInt } from "./spawns.js";
import { BEDROCK_Y, SEA_Y } from "./generate.js";

// Generator v2: a 2D integer heightfield (island bump + two octaves of value noise) plus sculpt
// ops (blobs, arches, tunnels) applied through the same sphere edits the game uses. Pure integer.

function mix(a: number, b: number, c: number): number {
  return hashInt(a, b, c, 0x1_0000_0000);
}

/** Value noise on a lattice of `cell` voxels, result in [0, 65536). */
function noise2(seed: number, salt: number, x: number, z: number, cell: number): number {
  const gx = Math.floor(x / cell);
  const gz = Math.floor(z / cell);
  const fx = Math.floor(((x - gx * cell) * 256) / cell);
  const fz = Math.floor(((z - gz * cell) * 256) / cell);
  const sx = (fx * fx * (768 - 2 * fx)) >> 16;
  const sz = (fz * fz * (768 - 2 * fz)) >> 16;
  const v = (a: number, b: number): number =>
    mix(seed, salt, (a & 0xffff) * 65536 + (b & 0xffff)) & 0xff;
  const top = v(gx, gz) * (256 - sx) + v(gx + 1, gz) * sx;
  const bot = v(gx, gz + 1) * (256 - sx) + v(gx + 1, gz + 1) * sx;
  return (top * (256 - sz) + bot * sz) >> 8;
}

/** Surface height in 1/256 voxel units. */
function heightAt(seed: number, w: number, d: number, x: number, z: number): number {
  const cx = w >> 1;
  const cz = d >> 1;
  const r2 = ((x - cx) ** 2 + (z - cz) ** 2) * 256;
  const R = Math.min(cx, cz);
  const bump = Math.max(0, 256 - Math.floor(r2 / (R * R)));
  const n1 = noise2(seed, 1, x, z, 32) - 32768;
  const n2 = noise2(seed, 2, x, z, 12) - 32768;
  return 9 * 256 + bump * 30 + (n1 >> 3) + (n2 >> 5) + (bump > 40 ? 0 : -((40 - bump) << 2));
}

export function generateV2(recipe: MapRecipe): GeneratedMap {
  const seed = recipe.seed >>> 0;
  const t = createTerrain(recipe.sizeX, recipe.sizeY, recipe.sizeZ, BEDROCK_Y, SEA_Y);
  const { sizeX: w, sizeY: h, sizeZ: d, density } = t;
  for (let z = 0; z < d; z++)
    for (let x = 0; x < w; x++) {
      const hf = heightAt(seed, w, d, x, z);
      for (let y = 0; y < h; y++) {
        const v = y < BEDROCK_Y ? 255 : 128 + ((hf - y * 256) >> 2);
        density[(y * d + z) * w + x] = v < 0 ? 0 : v > 255 ? 255 : v;
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
