// Prefabs: deterministic, integer-only voxel structures with material ids and decor anchors.
// A theme builds a Prefab (usually from parameters, see the builders in themes/), then stamps it
// with a position and a rotation in 90 degree steps. Server and clients agree voxel for voxel
// because stamping writes whole voxels (density 0 or 255) in a fixed order.

import { SOLID, type DecorAnchor, type VoxelTerrain } from "./api.js";
import { mix32 } from "./spawns.js";

/**
 * One step of a prefab, in local voxels with inclusive corners. Parts apply in order, so later
 * parts win: build a solid shell, then cut doors and rooms with "air", then "paint" trims.
 * - solid: density 255 and material `mat`.
 * - air: density 0 (material reset to terrain).
 * - paint: set material `mat` only where the voxel is already solid (stripes, trims).
 * - footing: for each column of the box, fill solid `mat` downward from y0 - 1 until the first
 *   solid voxel (or bedrock), so a building on a slope stands on a foundation.
 */
export interface PrefabPart {
  readonly op: "solid" | "air" | "paint" | "footing";
  readonly mat: number;
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
}

/**
 * A detail mesh the client hangs on a solid voxel (window frame, lamp, railing post...). `face`
 * is the side it sticks out of: 0 = +x, 1 = +z, 2 = -x, 3 = -z, 4 = up, 5 = down. The client
 * drops it when that voxel is no longer solid.
 */
export interface PrefabAnchor {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly face: number;
}

export interface Prefab {
  readonly id: string;
  /** Local bounding box: x in [0, sx), y in [0, sy), z in [0, sz). */
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly parts: readonly PrefabPart[];
  readonly anchors: readonly PrefabAnchor[];
}

/** Size of a prefab's footprint after `rot` quarter turns: [x, z]. */
export function rotatedSize(p: Prefab, rot: number): [number, number] {
  return (rot & 1) === 1 ? [p.sz, p.sx] : [p.sx, p.sz];
}

/** Local (x, z) to offset in the rotated footprint. A quarter turn takes +x to +z. */
export function rotateXZ(p: Prefab, rot: number, x: number, z: number): [number, number] {
  switch (rot & 3) {
    case 0:
      return [x, z];
    case 1:
      return [p.sz - 1 - z, x];
    case 2:
      return [p.sx - 1 - x, p.sz - 1 - z];
    default:
      return [z, p.sx - 1 - x];
  }
}

export function rotateFace(face: number, rot: number): number {
  return face >= 4 ? face : (face + rot) & 3;
}

function checkInts(...v: number[]): void {
  for (const n of v)
    if (!Number.isInteger(n)) throw new RangeError(`prefab: needs integers, got ${n}`);
}

/** The material grid of a terrain, created (all terrain) on first use. */
export function ensureMaterial(t: VoxelTerrain): Uint8Array {
  if (!t.material) (t as { material?: Uint8Array }).material = new Uint8Array(t.density.length);
  return t.material!;
}

/**
 * Stamp `p` with its local origin's rotated footprint corner at world (ox, oy, oz), after `rot`
 * quarter turns about +y. Voxels outside the grid are skipped (below bedrock is never touched).
 * Anchors that land inside the grid are appended to `decor` with a variant drawn from `seed`.
 * Returns the number of voxels written.
 */
export function stampPrefab(
  t: VoxelTerrain,
  p: Prefab,
  ox: number,
  oy: number,
  oz: number,
  rot: number,
  seed: number,
  decor: DecorAnchor[],
): number {
  checkInts(ox, oy, oz, rot, seed);
  const mat = ensureMaterial(t);
  const { sizeX: w, sizeY: h, sizeZ: d, density } = t;
  let n = 0;
  const idx = (x: number, y: number, z: number): number =>
    x < 0 || z < 0 || x >= w || z >= d || y < t.bedrockY || y >= h ? -1 : (y * d + z) * w + x;
  for (const part of p.parts) {
    checkInts(part.x0, part.y0, part.z0, part.x1, part.y1, part.z1, part.mat);
    const x0 = Math.min(part.x0, part.x1);
    const x1 = Math.max(part.x0, part.x1);
    const z0 = Math.min(part.z0, part.z1);
    const z1 = Math.max(part.z0, part.z1);
    const y0 = Math.min(part.y0, part.y1);
    const y1 = Math.max(part.y0, part.y1);
    for (let lz = z0; lz <= z1; lz++)
      for (let lx = x0; lx <= x1; lx++) {
        const [rx, rz] = rotateXZ(p, rot, lx, lz);
        const wx = ox + rx;
        const wz = oz + rz;
        if (part.op === "footing") {
          for (let wy = oy + y0 - 1; wy >= t.bedrockY; wy--) {
            const i = idx(wx, wy, wz);
            if (i < 0) break;
            if (density[i]! >= SOLID) break;
            density[i] = 255;
            mat[i] = part.mat;
            n++;
          }
          continue;
        }
        for (let ly = y0; ly <= y1; ly++) {
          const i = idx(wx, oy + ly, wz);
          if (i < 0) continue;
          if (part.op === "solid") {
            density[i] = 255;
            mat[i] = part.mat;
          } else if (part.op === "air") {
            density[i] = 0;
            mat[i] = 0;
          } else if (density[i]! >= SOLID) {
            mat[i] = part.mat;
          } else continue;
          n++;
        }
      }
  }
  for (let k = 0; k < p.anchors.length; k++) {
    const a = p.anchors[k]!;
    checkInts(a.x, a.y, a.z, a.face);
    const [rx, rz] = rotateXZ(p, rot, a.x, a.z);
    const x = ox + rx;
    const y = oy + a.y;
    const z = oz + rz;
    if (idx(x, y, z) < 0) continue;
    decor.push({
      kind: a.kind,
      x,
      y,
      z,
      face: rotateFace(a.face, rot),
      v: mix32(seed, k, 7) & 255,
    });
  }
  return n;
}

/** FNV-1a over the material grid (0 when there is none), for tests and determinism checks. */
export function materialHash(t: VoxelTerrain): number {
  const m = t.material;
  if (!m) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < m.length; i++) h = Math.imul(h ^ m[i]!, 0x01000193);
  return h >>> 0;
}
