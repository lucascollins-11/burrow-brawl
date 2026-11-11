import { type GeneratedMap, type MapRecipe, type TerrainEdit, type VoxelTerrain } from "./api.js";
import { applyEdit } from "./edit.js";
import { createTerrain } from "./grid.js";
import { findSpawns } from "./spawns.js";
import { generateV2 } from "./mapgen.js";

/** Bumped whenever generator output changes for the same inputs. */
export const GENERATOR_VERSION = 2;
export const BEDROCK_Y = 3;
export const SEA_Y = 26;

/**
 * Generator v1: a simple dome island (placeholder until mapgen proper). Pure integer, so every
 * client rebuilds the same bytes. The seed only picks the spawn order for now.
 */
export function generate(recipe: MapRecipe): GeneratedMap {
  if (recipe.generator === 2) return generateV2(recipe);
  if (recipe.generator !== 1)
    throw new RangeError(`terrain3d: unknown generator version ${recipe.generator}`);
  const t = createTerrain(recipe.sizeX, recipe.sizeY, recipe.sizeZ, BEDROCK_Y, SEA_Y);
  const { sizeX: w, sizeY: h, sizeZ: d, density } = t;
  const cx = w >> 1;
  const cz = d >> 1;
  const R = Math.min(cx, cz) - 8;
  const R2 = R * R;
  for (let z = 0; z < d; z++)
    for (let x = 0; x < w; x++) {
      const r2 = (x - cx) ** 2 + (z - cz) ** 2;
      // Surface height in 1/256 voxels: a seabed at 10 with a parabolic dome up to ~44.
      const top = 10 * 256 + Math.floor((Math.max(0, R2 - r2) * 34 * 256) / R2);
      for (let y = 0; y < h; y++) {
        const v = y < BEDROCK_Y ? 255 : 128 + ((top - y * 256) >> 2);
        density[(y * d + z) * w + x] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  return { terrain: t, spawns: findSpawns(t, recipe.seed >>> 0) };
}

export function restore(recipe: MapRecipe, edits: readonly TerrainEdit[]): VoxelTerrain {
  const { terrain } = generate(recipe);
  for (const e of edits) applyEdit(terrain, e);
  return terrain;
}
