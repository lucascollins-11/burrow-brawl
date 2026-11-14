// Per-voxel material ids. Material is cosmetic: the sim and collision only read density. The
// server keeps it so a (re)joining client gets the same look, and sends it in match.start.
//
// Rule shared by server and clients: a voxel's material is reset to TERRAIN (0) whenever its
// solidity flips (carved to air, or filled from air by a build weapon). So material can only be
// non-zero on solid voxels, and a terrain.patch (density only) is enough to keep it in sync.

/** Natural ground: the client shades it by height and slope (grass, soil, rock, sand). */
export const MAT_TERRAIN = 0;
export const MAT_PLASTER = 1;
export const MAT_TIMBER = 2;
export const MAT_ROOF_TILE = 3;
export const MAT_STONE = 4;
export const MAT_BRICK = 5;
export const MAT_PLANKS = 6;
export const MAT_PAINT_RED = 7;
export const MAT_PAINT_WHITE = 8;
export const MAT_GLASS = 9;
export const MAT_SLATE = 10;
export const MAT_COBBLE = 11;
export const MAT_METAL = 12;
export const MAT_THATCH = 13;
export const MAT_PAINT_BLUE = 14;
export const MAT_PAINT_YELLOW = 15;

/** Names, by id, for docs, tests and the client's palette table. */
export const MATERIAL_NAMES: readonly string[] = [
  "terrain",
  "plaster",
  "timber",
  "roof-tile",
  "stone",
  "brick",
  "planks",
  "paint-red",
  "paint-white",
  "glass",
  "slate",
  "cobble",
  "metal",
  "thatch",
  "paint-blue",
  "paint-yellow",
];

/** Materials that are built, not grown: the client never smooths these. */
export function isStructureMaterial(id: number): boolean {
  return id !== MAT_TERRAIN;
}
