import type { Terrain3dApi } from "./api.js";
import { applyEdit } from "./edit.js";
import { generate, restore } from "./generate.js";
import { copyChunkPadded, densityAt, isSolid, normalAt, topSolidY } from "./grid.js";
import { hash } from "./hash.js";
import { raycast } from "./raycast.js";

export {
  applyEdit,
  copyChunkPadded,
  densityAt,
  generate,
  hash,
  isSolid,
  normalAt,
  raycast,
  restore,
  topSolidY,
};
export { GENERATOR_VERSION, BEDROCK_Y, SEA_Y } from "./generate.js";
export { createTerrain, PADDED } from "./grid.js";
export { findSpawns, hashInt } from "./spawns.js";
export * from "./materials.js";
export {
  ensureMaterial,
  materialHash,
  rotatedSize,
  rotateFace,
  rotateXZ,
  stampPrefab,
  type Prefab,
  type PrefabAnchor,
  type PrefabPart,
} from "./prefab.js";

/** The contract as one object (the free functions above, for callers that want to inject it). */
export const terrain3d: Terrain3dApi = {
  generate,
  restore,
  isSolid,
  densityAt,
  topSolidY,
  raycast,
  normalAt,
  applyEdit,
  hash,
  copyChunkPadded,
};
export { THEMES, MAP_SIZES, isTheme, themedRecipe, THEMED_GENERATOR } from "./themes/index.js";
