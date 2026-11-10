// The terrain3d calls sim3d makes, in one place.
//
// TEMPORARY: terrain3d's implementation has not landed yet, so this file holds minimal versions
// written against the terrain3d contract. isSolid and the out-of-range rule are fully specified
// there, so they are final. applyEdit is a plain binary stand-in (no smooth rim) and normalAt is
// a 3x3x3 density gradient. When terrain3d's first PR merges, this file becomes re-exports of
// its isSolid / normalAt / applyEdit, and sim3d's tests should keep passing unchanged.

import type { EditResult, IVec3, TerrainEdit, VoxelTerrain } from "../terrain3d/api";
import { CHUNK, SOLID } from "../terrain3d/api";

/** Density with the contract's out-of-range rule: below y = 0 is bedrock, anything else is air. */
export function densityAt(t: VoxelTerrain, x: number, y: number, z: number): number {
  if (y < 0) return 255;
  if (x < 0 || z < 0 || x >= t.sizeX || y >= t.sizeY || z >= t.sizeZ) return 0;
  return t.density[(y * t.sizeZ + z) * t.sizeX + x] ?? 0;
}

export function isSolid(t: VoxelTerrain, x: number, y: number, z: number): boolean {
  return densityAt(t, x, y, z) >= SOLID;
}

/** Outward direction (towards air) from a 3x3x3 density gradient. (0,0,0) when flat-ambiguous. */
export function normalAt(t: VoxelTerrain, x: number, y: number, z: number): IVec3 {
  let gx = 0;
  let gy = 0;
  let gz = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const d = densityAt(t, x + dx, y + dy, z + dz);
        gx -= dx * d;
        gy -= dy * d;
        gz -= dz * d;
      }
  return { x: gx, y: gy, z: gz };
}

function setVoxel(t: VoxelTerrain, x: number, y: number, z: number, d: number, bump: Set<number>) {
  if (x < 0 || y < 0 || z < 0 || x >= t.sizeX || y >= t.sizeY || z >= t.sizeZ) return 0;
  const i = (y * t.sizeZ + z) * t.sizeX + x;
  const before = t.density[i] ?? 0;
  if (before === d) return 0;
  t.density[i] = d;
  bump.add(((y >> 5) * t.chunksZ + (z >> 5)) * t.chunksX + (x >> 5));
  return before >= SOLID !== d >= SOLID ? 1 : 0;
}

/** Binary stand-in for terrain3d.applyEdit: same edit semantics, no density falloff at the rim. */
export function applyEdit(t: VoxelTerrain, edit: TerrainEdit): EditResult {
  const bump = new Set<number>();
  let changed = 0;
  if (edit.op === "box") {
    for (let y = edit.y0; y <= edit.y1; y++)
      for (let z = edit.z0; z <= edit.z1; z++)
        for (let x = edit.x0; x <= edit.x1; x++) changed += setVoxel(t, x, y, z, 255, bump);
  } else {
    const r = edit.r;
    for (let dy = -r; dy <= r; dy++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy + dz * dz > r * r) continue;
          const y = edit.y + dy;
          if (edit.op === "carve" && y < t.bedrockY) continue;
          changed += setVoxel(t, edit.x + dx, y, edit.z + dz, edit.op === "carve" ? 0 : 255, bump);
        }
  }
  for (const c of bump) t.chunkVersion[c] = ((t.chunkVersion[c] ?? 0) + 1) >>> 0;
  t.edits.push(edit);
  return { changed, chunks: [...bump].sort((a, b) => a - b) };
}

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
