import { CHUNK, SOLID, type IVec3, type VoxelTerrain } from "./api.js";

export const PADDED = CHUNK + 2;

export function createTerrain(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  bedrockY: number,
  seaY: number,
): VoxelTerrain {
  for (const s of [sizeX, sizeY, sizeZ]) {
    if (!Number.isInteger(s) || s < CHUNK || s % CHUNK !== 0)
      throw new RangeError(`terrain3d: sizes must be positive multiples of ${CHUNK}, got ${s}`);
  }
  const chunksX = sizeX / CHUNK;
  const chunksY = sizeY / CHUNK;
  const chunksZ = sizeZ / CHUNK;
  return {
    sizeX,
    sizeY,
    sizeZ,
    density: new Uint8Array(sizeX * sizeY * sizeZ),
    bedrockY,
    seaY,
    chunksX,
    chunksY,
    chunksZ,
    chunkVersion: new Uint32Array(chunksX * chunksY * chunksZ),
    edits: [],
  };
}

export function inGrid(t: VoxelTerrain, x: number, y: number, z: number): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < t.sizeX && y < t.sizeY && z < t.sizeZ;
}

/** Below y = 0 is solid bedrock, every other out-of-range voxel is air. */
export function densityAt(t: VoxelTerrain, x: number, y: number, z: number): number {
  if (inGrid(t, x, y, z)) return t.density[(y * t.sizeZ + z) * t.sizeX + x]!;
  return y < 0 ? 255 : 0;
}

export function isSolid(t: VoxelTerrain, x: number, y: number, z: number): boolean {
  return densityAt(t, x, y, z) >= SOLID;
}

export function topSolidY(t: VoxelTerrain, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= t.sizeX || z >= t.sizeZ) return -1;
  for (let y = t.sizeY - 1; y >= 0; y--) {
    if (t.density[(y * t.sizeZ + z) * t.sizeX + x]! >= SOLID) return y;
  }
  return -1;
}

/** Outward direction (toward air): negative central difference of density. Not normalised. */
export function normalAt(t: VoxelTerrain, x: number, y: number, z: number): IVec3 {
  return {
    x: densityAt(t, x - 1, y, z) - densityAt(t, x + 1, y, z),
    y: densityAt(t, x, y - 1, z) - densityAt(t, x, y + 1, z),
    z: densityAt(t, x, y, z - 1) - densityAt(t, x, y, z + 1),
  };
}

/** Copy chunk + 1-voxel border into out ((CHUNK+2)^3), laid out (y*PADDED+z)*PADDED+x. */
export function copyChunkPadded(t: VoxelTerrain, chunkIndex: number, out: Uint8Array): void {
  if (out.length < PADDED ** 3) throw new RangeError("copyChunkPadded: out buffer too small");
  const n = t.chunksX * t.chunksY * t.chunksZ;
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= n)
    throw new RangeError(`copyChunkPadded: bad chunk index ${chunkIndex}`);
  const cx = chunkIndex % t.chunksX;
  const cz = Math.floor(chunkIndex / t.chunksX) % t.chunksZ;
  const cy = Math.floor(chunkIndex / (t.chunksX * t.chunksZ));
  const ox = cx * CHUNK - 1;
  const oy = cy * CHUNK - 1;
  const oz = cz * CHUNK - 1;
  // Column range of x that lies inside the grid, so rows can be copied in one go.
  const xs = Math.max(0, -ox);
  const xe = Math.min(PADDED, t.sizeX - ox);
  for (let y = 0; y < PADDED; y++) {
    const wy = oy + y;
    for (let z = 0; z < PADDED; z++) {
      const wz = oz + z;
      const row = (y * PADDED + z) * PADDED;
      const fill = wy < 0 ? 255 : 0;
      if (wy < 0 || wy >= t.sizeY || wz < 0 || wz >= t.sizeZ || xs >= xe) {
        out.fill(fill, row, row + PADDED);
        continue;
      }
      out.fill(0, row, row + xs);
      const src = (wy * t.sizeZ + wz) * t.sizeX + ox + xs;
      out.set(t.density.subarray(src, src + (xe - xs)), row + xs);
      out.fill(0, row + xe, row + PADDED);
    }
  }
}
