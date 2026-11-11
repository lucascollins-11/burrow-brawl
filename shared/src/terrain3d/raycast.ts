import type { VoxelHit, VoxelTerrain } from "./api.js";
import { isSolid } from "./grid.js";

/**
 * Integer 3D DDA between voxel centres. Coordinates are doubled so voxel centres are odd and cell
 * borders even; crossing times are compared by cross-multiplication, so nothing is rounded. When
 * the segment crosses an edge or corner exactly, the tied axes advance together (it only touches
 * the voxels in between).
 */
export function raycast(
  t: VoxelTerrain,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): VoxelHit {
  for (const v of [x0, y0, z0, x1, y1, z1])
    if (!Number.isInteger(v)) throw new RangeError("terrain3d: raycast needs integer voxels");
  let x = x0;
  let y = y0;
  let z = z0;
  let px = x;
  let py = y;
  let pz = z;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const dz = Math.abs(z1 - z0);
  const sx = x1 > x0 ? 1 : -1;
  const sy = y1 > y0 ? 1 : -1;
  const sz = z1 > z0 ? 1 : -1;
  // Time of the next crossing on each axis is nx/dx (nx starts at 1: centre to border, doubled).
  let nx = 1;
  let ny = 1;
  let nz = 1;
  const steps = dx + dy + dz + 1;
  for (let i = 0; i < steps; i++) {
    if (isSolid(t, x, y, z)) return { hit: true, x, y, z, px, py, pz };
    if (x === x1 && y === y1 && z === z1) break;
    px = x;
    py = y;
    pz = z;
    // Axis with the smallest n/d steps (cross-multiplied); an axis with d = 0 never crosses.
    const xBeforeY = dx !== 0 && (dy === 0 || nx * dy <= ny * dx);
    const xBeforeZ = dx !== 0 && (dz === 0 || nx * dz <= nz * dx);
    const yBeforeZ = dy !== 0 && (dz === 0 || ny * dz <= nz * dy);
    const yBeforeX = dy !== 0 && (dx === 0 || ny * dx <= nx * dy);
    const zBeforeX = dz !== 0 && (dx === 0 || nz * dx <= nx * dz);
    const zBeforeY = dz !== 0 && (dy === 0 || nz * dy <= ny * dz);
    const stepX = xBeforeY && xBeforeZ;
    const stepY = yBeforeX && yBeforeZ;
    const stepZ = zBeforeX && zBeforeY;
    if (stepX) {
      x += sx;
      nx += 2;
    }
    if (stepY) {
      y += sy;
      ny += 2;
    }
    if (stepZ) {
      z += sz;
      nz += 2;
    }
  }
  return { hit: false, x, y, z, px: x, py: y, pz: z };
}
