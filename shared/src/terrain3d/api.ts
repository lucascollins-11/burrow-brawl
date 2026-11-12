// terrain3d contract. Types and signatures only: the implementation lives next to this file
// (owner: terrain3d). Changes to this file go through the architect.
//
// Rules that every implementation and caller relies on:
// - Sim space is measured in voxels. +y is up. Voxel (x, y, z) covers [x, x+1) on each axis.
// - Everything here is integer math. No floats, no Math.sin/cos/sqrt on game state.
// - Collision is binary: a voxel is solid when its density is >= SOLID. The smooth mesh the
//   client draws is never used for collision.
// - Outside the grid: below y = 0 is solid bedrock, every other out-of-range voxel is air.
// - The terrain is mutated in place by edits. There is no rollback, so nothing keeps old copies.

/** Density at or above this is solid. Densities are 0..255. */
export const SOLID = 128;
/** Chunk edge in voxels. Chunks exist for versions, hashing and meshing only, not for storage. */
export const CHUNK = 32;
/** Default grid. X and Z sizes are multiples of CHUNK: 192, 256, 320 or 384. Height is 96. */
export const DEFAULT_SIZE_X = 256;
export const DEFAULT_SIZE_Y = 96;
export const DEFAULT_SIZE_Z = 256;

export interface VoxelTerrain {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  /** One byte per voxel: density[(y * sizeZ + z) * sizeX + x]. */
  readonly density: Uint8Array;
  /** Voxels with y < bedrockY can never be carved. */
  readonly bedrockY: number;
  /** Voxel row of the soda surface. A critter whose feet are below it is knocked out. */
  readonly seaY: number;
  readonly chunksX: number;
  readonly chunksY: number;
  readonly chunksZ: number;
  /**
   * Bumped whenever any voxel in the chunk changes: chunkVersion[(cy * chunksZ + cz) * chunksX + cx].
   * Drives remeshing and the cached per-chunk hash. Not part of the hash itself.
   */
  readonly chunkVersion: Uint32Array;
  /**
   * Every edit applied since generation, in order. A snapshot is the map recipe plus this log:
   * regenerate, replay, compare hashes. Appended to by applyEdit only.
   */
  readonly edits: TerrainEdit[];
}

/** How a map is rebuilt from nothing. Sent in match.start and snapshots in place of voxel bytes. */
export interface MapRecipe {
  /** Bumped whenever generator output changes for the same inputs. */
  readonly generator: number;
  readonly seed: number;
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  /** Theme id, original to this game (see plan/content.md). */
  readonly theme: string;
}

/**
 * The only ways terrain changes. Integer voxel coordinates and radii.
 * - carve: remove a sphere, with a smooth density falloff at the rim. Skips bedrock.
 * - fill: add a sphere of solid (build weapons). Never fills above sizeY - 1.
 * - box: add an axis-aligned solid box, inclusive corners (blocks).
 */
export type TerrainEdit =
  | {
      readonly op: "carve";
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly r: number;
    }
  | {
      readonly op: "fill";
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly r: number;
    }
  | {
      readonly op: "box";
      readonly x0: number;
      readonly y0: number;
      readonly z0: number;
      readonly x1: number;
      readonly y1: number;
      readonly z1: number;
    };

export interface EditResult {
  /** Voxels that crossed the SOLID threshold in either direction. */
  readonly changed: number;
  /** Indices of chunks whose version was bumped (for the renderer). */
  readonly chunks: readonly number[];
}

export interface VoxelHit {
  readonly hit: boolean;
  /** First solid voxel on the path, or the last voxel visited when hit is false. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The empty voxel just before the hit (where a bouncing shot rests or a blast is centred). */
  readonly px: number;
  readonly py: number;
  readonly pz: number;
}

/** Integer direction, not normalised. (0, 0, 0) when the surface is flat-ambiguous. */
export interface IVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** What terrain3d exports. Free functions, same style as the 2D terrain module. */
export interface Terrain3dApi {
  /** Build a map from its recipe. Pure function of the recipe; integer only. */
  generate(recipe: MapRecipe): GeneratedMap;
  /** Rebuild from a snapshot: generate, then replay edits in order. */
  restore(recipe: MapRecipe, edits: readonly TerrainEdit[]): VoxelTerrain;

  isSolid(t: VoxelTerrain, x: number, y: number, z: number): boolean;
  densityAt(t: VoxelTerrain, x: number, y: number, z: number): number;
  /** y of the highest solid voxel in the column, or -1 if the column is empty. */
  topSolidY(t: VoxelTerrain, x: number, z: number): number;
  /**
   * Walk the voxels from (x0,y0,z0) to (x1,y1,z1) with an integer 3D DDA, visiting every voxel
   * the segment passes through, in order. Stops at the first solid voxel.
   */
  raycast(
    t: VoxelTerrain,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
  ): VoxelHit;
  /** Outward surface direction at a voxel from central differences of density (points to air). */
  normalAt(t: VoxelTerrain, x: number, y: number, z: number): IVec3;

  /** Apply one edit in place, append it to t.edits, bump touched chunk versions. */
  applyEdit(t: VoxelTerrain, edit: TerrainEdit): EditResult;

  /** u32 hash of the whole grid: a fold of per-chunk hashes, each cached by chunk version. */
  hash(t: VoxelTerrain): number;

  /**
   * Copy one chunk plus a 1-voxel border into `out` ((CHUNK + 2)^3 bytes) for the meshing worker.
   * Voxels outside the grid follow the out-of-range rule above.
   */
  copyChunkPadded(t: VoxelTerrain, chunkIndex: number, out: Uint8Array): void;
}

export interface SpawnPoint {
  /** Feet voxel: the air voxel directly above solid ground. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A thing the generator places for the sim to turn into a world object later (ignored for now). */
export interface MapObject {
  readonly kind: "barrel" | "mine" | "crate-pad";
  /** Feet voxel: the air voxel directly above solid ground. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GeneratedMap {
  readonly terrain: VoxelTerrain;
  /** Placements from themed generators (generator 3 and up); absent for older generators. */
  readonly objects?: readonly MapObject[];
  /**
   * At least 32 spawn points in a fixed, deterministic order: grounded, above the sea, with
   * headroom for a critter, and spread out. Teams take them interleaved.
   */
  readonly spawns: readonly SpawnPoint[];
}
