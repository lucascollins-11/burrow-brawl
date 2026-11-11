// The terrain3d calls sim3d makes, in one place, plus a flat test terrain.

import type { VoxelTerrain } from "../terrain3d/api";
import { CHUNK } from "../terrain3d/api";

export { applyEdit, densityAt, isSolid, normalAt } from "../terrain3d/impl";

/** A flat slab terrain for tests and the sandbox: solid for y < top, bedrock below bedrockY. */
export function flatSlab(
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  top: number,
  seaY = 0,
  bedrockY = 1,
): VoxelTerrain {
  const density = new Uint8Array(sizeX * sizeY * sizeZ);
  density.fill(255, 0, Math.max(0, Math.min(sizeY, top)) * sizeX * sizeZ);
  const chunksX = Math.ceil(sizeX / CHUNK);
  const chunksY = Math.ceil(sizeY / CHUNK);
  const chunksZ = Math.ceil(sizeZ / CHUNK);
  return {
    sizeX,
    sizeY,
    sizeZ,
    density,
    bedrockY,
    seaY,
    chunksX,
    chunksY,
    chunksZ,
    chunkVersion: new Uint32Array(chunksX * chunksY * chunksZ),
    edits: [],
  };
}
