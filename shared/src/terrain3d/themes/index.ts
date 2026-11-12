import { type GeneratedMap, type MapRecipe } from "../api.js";
import { createTerrain } from "../grid.js";
import { BEDROCK_Y, SEA_Y } from "../generate.js";
import { findSpawns } from "../spawns.js";
import { keepWalkableSpawns, makeCtx, type Theme } from "./kit.js";
import { picnicAtoll } from "./picnicAtoll.js";
import { toyboxHarbor } from "./toyboxHarbor.js";

export { type Theme, type ThemeCtx } from "./kit.js";

/** Generator version that dispatches on `recipe.theme`. Version 2 is the older unthemed map. */
export const THEMED_GENERATOR = 3;

const ALL: readonly Theme[] = [picnicAtoll, toyboxHarbor];

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
    sizeY: 96,
    sizeZ: size,
    theme,
  };
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
  return {
    terrain: t,
    spawns: keepWalkableSpawns(t, findSpawns(t, recipe.seed >>> 0, true)),
    objects: ctx.objects,
  };
}
