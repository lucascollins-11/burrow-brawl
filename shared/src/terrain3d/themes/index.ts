import { type DecorAnchor, type GeneratedMap, type MapRecipe } from "../api.js";
import { createTerrain, isSolid } from "../grid.js";
import { BEDROCK_Y, SEA_Y } from "../generate.js";
import { findSpawns } from "../spawns.js";
import { keepWalkableSpawns, makeCtx, type Theme } from "./kit.js";
import { gardenPatch } from "./gardenPatch.js";
import { bathtubBay } from "./bathtubBay.js";
import { frostedBakery } from "./frostedBakery.js";
import { picnicAtoll } from "./picnicAtoll.js";
import { clockworkMesa } from "./clockworkMesa.js";
import { toyboxHarbor } from "./toyboxHarbor.js";
import { lighthouseVillage } from "./lighthouseVillage.js";

export { type Theme, type ThemeCtx } from "./kit.js";

/** Generator version that dispatches on `recipe.theme`. Version 2 is the older unthemed map. */
export const THEMED_GENERATOR = 3;

const ALL: readonly Theme[] = [
  picnicAtoll,
  toyboxHarbor,
  clockworkMesa,
  frostedBakery,
  bathtubBay,
  gardenPatch,
  lighthouseVillage,
];

/** Themes the lobby can offer. */
export const THEMES: readonly {
  readonly id: string;
  readonly name: string;
  readonly minSize: number;
}[] = ALL.map((t) => ({ id: t.id, name: t.name, minSize: t.minSize }));

export function isTheme(id: string): boolean {
  return ALL.some((t) => t.id === id);
}

export function getTheme(id: string): Theme {
  const theme = ALL.find((t) => t.id === id);
  if (!theme) throw new RangeError(`terrain3d: unknown theme ${id}`);
  return theme;
}

/** Map sizes the lobby offers: small, medium, large. */
export const MAP_SIZES = [256, 384, 512] as const;

/** A recipe for a themed map: the one place that knows which generator version themes use. */
export function themedRecipe(theme: string, seed: number, size: number): MapRecipe {
  return {
    generator: THEMED_GENERATOR,
    seed: seed >>> 0,
    sizeX: size,
    sizeY: ALL.find((t) => t.id === theme)?.sizeY ?? 96,
    sizeZ: size,
    theme,
  };
}

/** Face directions of DecorAnchor.face (0 +x, 1 +z, 2 -x, 3 -z, 4 up, 5 down). */
const FACE_DIR: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [0, 0, 1],
  [-1, 0, 0],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
];

/**
 * Anchors that still make sense after the whole theme is built: the voxel they hang on is solid and
 * the cell they face is open. Later carving (gorges, stairs, other buildings) can bury or strand
 * detail that an earlier stamp placed.
 */
export function liveDecor(
  t: Parameters<typeof isSolid>[0],
  decor: readonly DecorAnchor[],
): DecorAnchor[] {
  return decor.filter((a) => {
    if (!isSolid(t, a.x, a.y, a.z)) return false;
    const d = FACE_DIR[a.face] ?? FACE_DIR[4]!;
    return !isSolid(t, a.x + d[0], a.y + d[1], a.z + d[2]);
  });
}

/** Generator 3: build the theme named by the recipe, then pick spawns with open sky above. */
export function generateThemed(recipe: MapRecipe): GeneratedMap {
  const theme = getTheme(recipe.theme);
  if (Math.min(recipe.sizeX, recipe.sizeZ) < theme.minSize)
    throw new RangeError(`terrain3d: theme ${theme.id} needs at least ${theme.minSize} voxels`);
  const t = createTerrain(recipe.sizeX, recipe.sizeY, recipe.sizeZ, BEDROCK_Y, SEA_Y);
  const ctx = makeCtx(t, recipe.seed >>> 0);
  theme.build(ctx);
  // Generation edits are part of the recipe, not the edit log.
  t.edits.length = 0;
  t.chunkVersion.fill(0);
  const decor = liveDecor(t, ctx.decor);
  if (decor.length) (t as { decor?: readonly DecorAnchor[] }).decor = decor;
  return {
    terrain: t,
    spawns: keepWalkableSpawns(t, findSpawns(t, recipe.seed >>> 0, true)),
    objects: ctx.objects,
  };
}
