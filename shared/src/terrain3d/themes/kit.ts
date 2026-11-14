import {
  SOLID,
  type DecorAnchor,
  type MapObject,
  type SpawnPoint,
  type VoxelTerrain,
} from "../api.js";
import { applyEdit } from "../edit.js";
import { topSolidY } from "../grid.js";
import { hashInt, mix32 } from "../spawns.js";
import { stampPrefab, type Prefab } from "../prefab.js";

/** What a theme gets to work with. Everything goes through the same edits the game uses. */
export interface ThemeCtx {
  readonly t: VoxelTerrain;
  readonly seed: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  /** Deterministic integer in [0, n) from (salt, i). */
  rnd(salt: number, i: number, n: number): number;
  fill(x: number, y: number, z: number, r: number): void;
  carve(x: number, y: number, z: number, r: number): void;
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void;
  /** y of the highest solid voxel in the column (0 when empty). */
  surf(x: number, z: number): number;
  readonly objects: MapObject[];
  /**
   * Stamp a prefab with its rotated footprint's low corner at (x, y, z), after `rot` quarter
   * turns. `salt` seeds the decor variants. Returns voxels written.
   */
  stamp(p: Prefab, x: number, y: number, z: number, rot: number, salt: number): number;
  /** Detail anchors from every stamp so far, in stamp order. */
  readonly decor: DecorAnchor[];
}

export interface Theme {
  readonly id: string;
  readonly name: string;
  /** Smallest grid edge the theme is laid out for. */
  readonly minSize: number;
  /** Grid height in voxels (a multiple of 32); 96 when absent. */
  readonly sizeY?: number;
  /** Shape the terrain and push placements into ctx.objects. Must be pure and integer-only. */
  build(ctx: ThemeCtx): void;
}

export function makeCtx(t: VoxelTerrain, seed: number): ThemeCtx {
  const decor: DecorAnchor[] = [];
  return {
    t,
    seed,
    w: t.sizeX,
    d: t.sizeZ,
    h: t.sizeY,
    rnd: (salt, i, n) => hashInt(seed, salt, i, n),
    fill: (x, y, z, r) => void applyEdit(t, { op: "fill", x, y, z, r }),
    carve: (x, y, z, r) => void applyEdit(t, { op: "carve", x, y, z, r }),
    box: (x0, y0, z0, x1, y1, z1) => void applyEdit(t, { op: "box", x0, y0, z0, x1, y1, z1 }),
    surf: (x, z) => Math.max(0, topSolidY(t, x, z)),
    objects: [],
    decor,
    stamp: (p, x, y, z, rot, salt) =>
      stampPrefab(t, p, x, y, z, rot, mix32(seed, salt, 0x5eed), decor),
  };
}

/**
 * Turn a heightfield (z-major, 1/256 voxel units) into density: v = 128 + ((hf - y * 256) >> 2),
 * clamped. Bedrock and everything well below the lowest surface is solid, everything well above
 * the highest is air, so only the layers in between get a per-voxel pass.
 */
export function fillFromHeightField(t: VoxelTerrain, hfs: Int32Array): void {
  const { sizeY: h, density } = t;
  const layer = t.sizeX * t.sizeZ;
  let minHf = Infinity;
  let maxHf = -Infinity;
  for (let i = 0; i < hfs.length; i++) {
    const v = hfs[i]!;
    if (v < minHf) minHf = v;
    if (v > maxHf) maxHf = v;
  }
  for (let y = 0; y < h; y++) {
    const base = y * layer;
    if (y < t.bedrockY || y * 256 <= minHf - 508) {
      density.fill(255, base, base + layer);
      continue;
    }
    if (y * 256 > maxHf + 508) break;
    const yy = y * 256;
    for (let i = 0; i < layer; i++) {
      const v = 128 + ((hfs[i]! - yy) >> 2);
      density[base + i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

/** True when the 5x5 patch around (x, z) is dry, flat to within 1 voxel, and open to the sky. */
export function flatDrySpot(ctx: ThemeCtx, x: number, z: number): number {
  const { t, w, d, h } = ctx;
  if (x < 4 || z < 4 || x >= w - 4 || z >= d - 4) return -1;
  const top = topSolidY(t, x, z);
  if (top < t.seaY + 2 || top + 10 >= h) return -1;
  for (let dz = -2; dz <= 2; dz += 2)
    for (let dx = -2; dx <= 2; dx += 2)
      if (Math.abs(topSolidY(t, x + dx, z + dz) - top) > 1) return -1;
  for (let y = top + 1; y < h; y++) if (t.density[(y * d + z) * w + x]! >= 128) return -1;
  return top + 1;
}

/**
 * Keep only spawns in the walkable region that holds the most of them: dry columns whose
 * neighbouring tops differ by at most 2 voxels. Drops spots on top of set pieces nobody can climb.
 */
export function keepWalkableSpawns(
  t: VoxelTerrain,
  spawns: readonly SpawnPoint[],
): readonly SpawnPoint[] {
  const { sizeX: w, sizeZ: d } = t;
  // Column tops, layer by layer from the sky down (contiguous reads, unlike per-column scans).
  const tops = new Int16Array(w * d).fill(-1);
  const layer = w * d;
  let open = layer;
  for (let y = t.sizeY - 1; y >= 0 && open > 0; y--) {
    const base = y * layer;
    for (let i = 0; i < layer; i++)
      if (tops[i]! < 0 && t.density[base + i]! >= SOLID) {
        tops[i] = y;
        open--;
      }
  }
  const label = new Int32Array(w * d);
  const sizes: number[] = [0];
  const stack: number[] = [];
  const labelOf = (s: SpawnPoint): number => {
    const k = s.z * w + s.x;
    if (label[k]) return label[k]!;
    const id = sizes.length;
    sizes.push(0);
    label[k] = id;
    stack.push(k);
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % w;
      const z = (c - x) / w;
      for (let n = 0; n < 4; n++) {
        const nx = x + (n === 0 ? 1 : n === 1 ? -1 : 0);
        const nz = z + (n === 2 ? 1 : n === 3 ? -1 : 0);
        if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
        const nk = nz * w + nx;
        if (label[nk] || tops[nk]! < t.seaY + 1 || Math.abs(tops[nk]! - tops[c]!) > 2) continue;
        label[nk] = id;
        stack.push(nk);
      }
    }
    return id;
  };
  const ids = spawns.map(labelOf);
  const counts = new Map<number, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best = -1;
  let bestN = 0;
  for (const [id, n] of counts) if (n > bestN) [best, bestN] = [id, n];
  return spawns.filter((_, i) => ids[i] === best);
}

/** An axis-aligned land area a theme can scatter placements over (inclusive corners). */
export interface Rect {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** Barrels, mines and crate pads on flat, dry, open ground inside the given areas. */
export function scatterObjects(ctx: ThemeCtx, areas: readonly Rect[], salt: number): void {
  const { rnd, objects } = ctx;
  const budget = 6 + ((ctx.w * ctx.d) >> 12) * 2;
  let n = 0;
  for (let i = 0; i < budget * 8 && n < budget; i++) {
    const a = areas[rnd(salt, i, areas.length)]!;
    const x = a.x0 + rnd(salt + 1, i, a.x1 - a.x0 + 1);
    const z = a.z0 + rnd(salt + 2, i, a.z1 - a.z0 + 1);
    const y = flatDrySpot(ctx, x, z);
    if (y < 0) continue;
    const roll = rnd(salt + 3, i, 6);
    objects.push({ kind: roll < 3 ? "barrel" : roll < 5 ? "mine" : "crate-pad", x, y, z });
    n++;
  }
}

/** Smooth 0..256 ramp (smoothstep) for a 0..256 input. */
export function ease(p: number): number {
  return (p * p * (768 - 2 * p)) >> 16;
}

/** A monotone stand-in for the angle, 0..4095 around the circle, from integers only. */
export function pseudoAngle(dx: number, dz: number): number {
  const s = Math.abs(dx) + Math.abs(dz);
  if (s === 0) return 0;
  const q = Math.floor((1024 * dz) / s); // -1024..1024
  if (dx >= 0) return dz >= 0 ? q : 4096 + q;
  return 2048 - q;
}
