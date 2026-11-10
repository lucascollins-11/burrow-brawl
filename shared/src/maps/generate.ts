import type { RngLike } from "../determinism/prng";
import {
  addCircle,
  AIR,
  BEDROCK,
  CLAY,
  createTerrain,
  CRUST,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  DIRT,
  isSolid,
} from "../terrain";
import type { Terrain } from "../terrain";

/**
 * Procedural map generator v1.
 *
 * Everything here is integer math. Randomness comes only from the injected rng, so the same seed gives the same
 * terrain on every platform. Value noise (hashed lattice + smoothstep) is used instead of Math.sin.
 */

/** Critter body, in cells. Keep in sync with CRITTER_HALF_WIDTH and CRITTER_HEIGHT in shared/src/sim/constants.ts. */
export const SPAWN_CLEARANCE = { halfWidth: 5, height: 20 } as const;

/** Spawn pads are levelled this many cells either side of the spawn column. */
const PAD_HALF_WIDTH = 12;

const CRUST_ROWS = 6;
const BEDROCK_ROWS = 8;
/** Water (soda) line: rows at or below this are lethal. */
const WATER_ROWS_FROM_BOTTOM = 48;
/** Solid soil ends this many rows above the water line, leaving a gap of air above the soda. */
const SOIL_GAP_ABOVE_WATER = 32;
/** Spawns must be this many rows above the water line. */
const SPAWN_WATER_MARGIN = 60;

/** Layers of 1D value noise that make up the hill profile: [lattice cell size, weight]. */
const HILL_OCTAVES: ReadonlyArray<readonly [number, number]> = [
  [256, 96],
  [128, 48],
  [64, 24],
  [32, 12],
];

export interface MapOptions {
  readonly width?: number;
  readonly height?: number;
  /** Floating islands above the ground. Default 3. */
  readonly islands?: number;
  /** Spawn points to place. Default 4. */
  readonly spawnCount?: number;
  /** Minimum horizontal distance between spawn columns, in cells. Default 160. */
  readonly minSpawnSpacing?: number;
  /** Attempts when searching for spawn columns. Default 4000. */
  readonly maxSpawnAttempts?: number;
}

/** Feet cell of a spawn. The body occupies columns x-5..x+5 and rows y-19..y; the ground is row y+1. */
export interface SpawnPoint {
  readonly x: number;
  readonly y: number;
}

/** A generated map: the destructible mask plus the metadata the match needs. */
export interface TerrainMask {
  readonly terrain: Terrain;
  readonly spawns: readonly SpawnPoint[];
  /** Cell row. Feet at or below this row are lethal (soda). */
  readonly waterY: number;
}

/** Integer hash to 0..255, mixed with a seed. */
function hashByte(n: number, seed: number): number {
  let h = (Math.imul(n, 0x27d4eb2d) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) & 0xff;
}

/** Integer in [min, max] inclusive, from an rng that only offers nextInt. */
function range(rng: RngLike, min: number, max: number): number {
  return min + rng.nextInt(max - min + 1);
}

/** Smoothstep of f within a cell of size c, scaled to 0..c. Integer only. */
function smoothstep(f: number, c: number): number {
  return Math.floor((3 * f * f * c - 2 * f * f * f) / (c * c));
}

/** 1D value noise at x with lattice spacing `cell`. Returns 0..255. */
function valueNoise(x: number, cell: number, seed: number): number {
  const i = Math.floor(x / cell);
  const f = x - i * cell;
  const a = hashByte(i, seed);
  const b = hashByte(i + 1, seed);
  const s = smoothstep(f, cell);
  return Math.floor((a * (cell - s) + b * s) / cell);
}

/** Hill height profile for column x: 0..179, higher is taller. */
function hillProfile(x: number, seed: number): number {
  let sum = 0;
  HILL_OCTAVES.forEach(([cell, weight], k) => {
    const octaveSeed = (seed ^ Math.imul(k + 1, 0x9e3779b9)) >>> 0;
    sum += weight * valueNoise(x, cell, octaveSeed);
  });
  return Math.floor(sum / 256);
}

/** Chunky soil: crust on top, dirt below, clay speckles deeper down. */
function soilMaterial(x: number, y: number, surface: number, seed: number): number {
  if (y < surface + CRUST_ROWS) return CRUST;
  const speck = hashByte(Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77), seed ^ 0x51ed270b);
  return speck < 18 ? CLAY : DIRT;
}

/** Levels a spawn pad: air above row `ground`, solid soil from `ground` down to the soil bottom. */
function levelPad(
  t: Terrain,
  centre: number,
  ground: number,
  soilBottom: number,
  seed: number,
): void {
  for (let x = centre - PAD_HALF_WIDTH; x <= centre + PAD_HALF_WIDTH; x++) {
    for (let y = 0; y < t.height; y++) {
      const i = y * t.width + x;
      if (y < ground) t.cells[i] = AIR;
      else if (y < soilBottom) t.cells[i] = soilMaterial(x, y, ground, seed);
    }
  }
}

/**
 * True if a critter standing with its feet at (x, y) has ground under it and clear air around it.
 * Checks the same rectangle the sim's body uses, so a spawn that passes can't start inside terrain.
 */
export function isValidSpawn(t: Terrain, x: number, y: number): boolean {
  const { halfWidth, height } = SPAWN_CLEARANCE;
  if (!isSolid(t, x, y + 1)) return false;
  for (let dx = -halfWidth; dx <= halfWidth; dx++) {
    for (let dy = 0; dy < height; dy++) {
      if (isSolid(t, x + dx, y - dy)) return false;
    }
  }
  return true;
}

/**
 * Generates a map from an injected rng. Output depends only on the rng state and the options.
 *
 * Layout, top to bottom: air, hilly soil (crust, dirt, clay), a gap of air above the soda, the water line, and a
 * bedrock floor at the bottom. Islands float above the ground. Spawn pads are levelled so they are flat and valid.
 */
export function generateMap(rng: RngLike, options: MapOptions = {}): TerrainMask {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const islandCount = options.islands ?? 3;
  const spawnCount = options.spawnCount ?? 4;
  const minSpacing = options.minSpawnSpacing ?? 160;
  const maxAttempts = options.maxSpawnAttempts ?? 4000;

  const t = createTerrain(width, height);
  const seed = rng.nextInt(0x1_0000_0000);

  const waterY = height - WATER_ROWS_FROM_BOTTOM;
  const soilBottom = waterY - SOIL_GAP_ABOVE_WATER;
  const base = Math.floor(height * 0.55);

  // 1. Hilly ground: solid soil from the surface down to soilBottom, bedrock across the bottom.
  const surface = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    const s = base + 90 - hillProfile(x, seed);
    surface[x] = s;
    for (let y = s; y < soilBottom; y++) {
      t.cells[y * width + x] = soilMaterial(x, y, s, seed);
    }
  }
  for (let y = height - BEDROCK_ROWS; y < height; y++) {
    for (let x = 0; x < width; x++) t.cells[y * width + x] = BEDROCK;
  }

  // 2. Floating islands. They sit well above the ground, so they never touch it.
  const minIslandX = Math.floor(width * 0.15);
  const maxIslandX = Math.floor(width * 0.85);
  const minIslandY = Math.floor(height * 0.12);
  const maxIslandY = Math.floor(height * 0.34);
  for (let i = 0; i < islandCount; i++) {
    const cx = range(rng, minIslandX, maxIslandX);
    const cy = range(rng, minIslandY, maxIslandY);
    const r = range(rng, 28, 56);
    addCircle(t, cx, cy, r, DIRT);
  }

  // 3. Spawn pads on random columns, spaced apart, above the water.
  const spawns: SpawnPoint[] = [];
  const margin = PAD_HALF_WIDTH + SPAWN_CLEARANCE.halfWidth;
  for (let attempt = 0; attempt < maxAttempts && spawns.length < spawnCount; attempt++) {
    const x = range(rng, margin, width - 1 - margin);
    const ground = surface[x] ?? 0;
    if (ground >= waterY - SPAWN_WATER_MARGIN) continue;
    if (spawns.some((s) => Math.abs(s.x - x) < minSpacing)) continue;
    levelPad(t, x, ground, soilBottom, seed);
    spawns.push({ x, y: ground - 1 });
  }

  return { terrain: t, spawns, waterY };
}
