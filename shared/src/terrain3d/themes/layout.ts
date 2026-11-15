// Shared layout helpers for the upgraded maps: a heightfield from a shape function, centred prefab
// placement, round-tower bits, integer trig, and the ring of bridged islets every map gets
// (Lucas, 2026-11-14: the outer islands must be close enough to play on, with a bridge to the
// mainland). Integers only, so generation stays deterministic everywhere.
import { isqrt } from "../../fixed.js";
import { NX, NZ, PX, PZ, UP, type PrefabBuilder } from "../build/builder.js";
import { plankBridge } from "../build/pieces.js";
import { createTerrain, topSolidY } from "../grid.js";
import { MAT_TIMBER } from "../materials.js";
import { octave, sample } from "../mapgen.js";
import { ensureMaterial, rotatedSize, type Prefab } from "../prefab.js";
import { fillFromHeightField, makeCtx, scatterObjects, type Rect, type ThemeCtx } from "./kit.js";

/** Sea floor height under open water, in voxels. */
export const SEABED = 14;
/** The layouts are drawn on a CORE x CORE grid and set in the middle of the map. */
export const CORE = 256;

// ------------------------------------------------------------------------------ integer trig

/** sin of a 0..255 turn, scaled by 1024 (a quarter-wave table, no floating point). */
const QUARTER = [
  0, 25, 50, 75, 100, 125, 150, 175, 200, 224, 249, 273, 297, 321, 345, 369, 392, 415, 438, 460,
  483, 505, 526, 548, 569, 590, 610, 630, 650, 669, 688, 706, 724, 742, 759, 775, 792, 807, 822,
  837, 851, 865, 878, 891, 903, 915, 926, 936, 946, 955, 964, 972, 980, 987, 993, 999, 1004, 1009,
  1013, 1016, 1019, 1021, 1023, 1024, 1024,
];
export function isin(turn: number): number {
  const a = turn & 255;
  const q = a & 63;
  if (a < 64) return QUARTER[q]!;
  if (a < 128) return QUARTER[64 - q]!;
  if (a < 192) return -QUARTER[q]! | 0;
  return -QUARTER[64 - q]! | 0;
}
export function icos(turn: number): number {
  return isin(turn + 64);
}

// ------------------------------------------------------------------------------ placement

/** Fill the terrain from a height function (voxel units, any shape) plus a sloping shore. */
export function shape(
  ctx: ThemeCtx,
  inside: (x: number, z: number) => number,
  level: (x: number, z: number) => number,
  slope = 3,
): void {
  const { w, d } = ctx;
  const hfs = new Int32Array(w * d);
  for (let z = 0; z < d; z++)
    for (let x = 0; x < w; x++) {
      const s = inside(x, z);
      const top = level(x, z) * 256 + 255;
      hfs[z * w + x] = s <= 0 ? SEABED * 256 : Math.min(top, SEABED * 256 + s * 256 * slope);
    }
  fillFromHeightField(ctx.t, hfs);
}

/** Wobble from a noise octave, about +-amp voxels. */
export function wobble(
  ctx: ThemeCtx,
  salt: number,
  cell: number,
  amp: number,
): (x: number, z: number) => number {
  const o = octave(ctx.seed, salt, ctx.w, ctx.d, cell);
  return (x, z) => Math.floor(((sample(o, x, z) - 32768) * amp) / 32768);
}

/** Stamp a prefab with its rotated footprint centred on (cx, cz); y defaults to the ground there. */
export function put(
  ctx: ThemeCtx,
  p: Prefab,
  cx: number,
  cz: number,
  rot: number,
  salt: number,
  y?: number,
): number {
  const [sx, sz] = rotatedSize(p, rot);
  const g = y ?? ctx.surf(cx, cz) + 1;
  ctx.stamp(p, cx - (sx >> 1), g, cz - (sz >> 1), rot, salt);
  return g;
}

/** Clear a box of voxels to air (direct edit; generation only). */
export function clear(
  ctx: ThemeCtx,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): void {
  const { t, w, d } = ctx;
  for (let y = Math.max(y0, t.bedrockY); y <= Math.min(y1, ctx.h - 1); y++)
    for (let z = Math.max(0, z0); z <= Math.min(d - 1, z1); z++)
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
        const k = (y * d + z) * w + x;
        t.density[k] = 0;
        if (t.material) t.material[k] = 0;
      }
}

export function lamps(ctx: ThemeCtx, pts: readonly [number, number][], kind = "lamp-post"): void {
  pts.forEach(([x, z], i) => {
    const y = ctx.surf(x, z);
    if (y > ctx.t.seaY) ctx.decor.push({ kind, x, y, z, face: UP, v: ctx.rnd(3200, i, 256) });
  });
}

// ------------------------------------------------------------------------------ prefab bits

/** A disc standing in the x-y plane (a clock face, a gear, a porthole), z0..z1 thick. */
export function faceDisc(
  b: PrefabBuilder,
  op: "solid" | "air" | "paint",
  mat: number,
  cx: number,
  cy: number,
  r: number,
  z0: number,
  z1: number,
): void {
  const rr = r * r + r;
  for (let dy = -r; dy <= r; dy++) {
    const half = isqrt(rr - dy * dy);
    if (op === "solid") b.solid(mat, cx - half, cy + dy, z0, cx + half, cy + dy, z1);
    else if (op === "air") b.air(cx - half, cy + dy, z0, cx + half, cy + dy, z1);
    else b.paint(mat, cx - half, cy + dy, z0, cx + half, cy + dy, z1);
  }
}

/** Windows round a round tower: air slots with a window anchor, every `step` around the rim. */
export function towerWindows(
  b: PrefabBuilder,
  cx: number,
  cz: number,
  r: number,
  y: number,
  kind = "window-arched",
): void {
  for (const [dx, dz, face] of [
    [r, 0, PX],
    [-r, 0, NX],
    [0, r, PZ],
    [0, -r, NZ],
  ] as const) {
    const x = cx + dx;
    const z = cz + dz;
    if (dx === 0) b.air(x - 1, y, z - (dz > 0 ? 1 : 0), x + 1, y + 4, z + (dz > 0 ? 0 : 1));
    else b.air(x - (dx > 0 ? 1 : 0), y, z - 1, x + (dx > 0 ? 0 : 1), y + 4, z + 1);
    // Hang the frame on the wall voxel under the opening.
    b.anchor(kind, x, y - 1, z, face);
  }
}

/** Floors every 11 voxels inside a round hollow, with a stair hole on the -x side. */
export function roundFloors(
  b: PrefabBuilder,
  mat: number,
  cx: number,
  cz: number,
  r: number,
  y0: number,
  y1: number,
): void {
  for (let y = y0; y <= y1; y += 11) {
    b.disc("solid", mat, cx, cz, r, y, y);
    b.air(cx - r + 1, y, cz - 1, cx - r + 4, y, cz + 1);
    for (let j = 0; j < 10 && y + j + 1 < y1 + 11; j++)
      b.solid(MAT_TIMBER, cx - r + 1, y - 10 + j, cz + 2, cx - r + 3, y - 10 + j, cz + 3);
    b.anchor("rug", cx, y, cz, UP);
    b.anchor("ceiling-lamp", cx, y + 10, cz + 2, 5);
  }
}

// ------------------------------------------------------------------------------ islets

export interface IsletOptions {
  /** Houses for the islets, by index (two per islet, one storey reads best). */
  readonly house: (i: number) => Prefab;
  /** Salt for the islets' variants. */
  readonly salt: number;
  /** Islet top, clamped to sea + 2 .. this. */
  readonly maxLevel?: number;
  /** Lines tried either side of each lane when looking for the shore (default [-24, -8, 8, 24]). */
  readonly shifts?: readonly number[];
  /**
   * Only land a bridge on shore at most this far inside the core's edge. Default: anywhere. For
   * layouts with open water inside them (a chain of islands), so an islet never lands in the
   * middle of the map.
   */
  readonly reach?: number;
}

/**
 * Build the map's own layout on a CORE grid, turn it a quarter step per seed and set it in the
 * middle of the map, then ring it with playable islets: islands of their own, each joined to the
 * mainland by a plank bridge, with two houses, a moored boat and a lamp. One islet off each side,
 * two per side once the map has the room (512). Also scatters the barrels, mines and crate pads.
 */
export function withIslets(ctx: ThemeCtx, layout: (c: ThemeCtx) => void, opts: IsletOptions): void {
  const off = (ctx.w - CORE) >> 1;
  const offZ = (ctx.d - CORE) >> 1;
  const core = makeCtx(createTerrain(CORE, ctx.h, CORE, ctx.t.bedrockY, ctx.t.seaY), ctx.seed);
  layout(core);
  const turn = ctx.seed & 3;
  const to = (x: number, z: number): [number, number] => {
    const e = CORE - 1;
    const [rx, rz] =
      turn === 0 ? [x, z] : turn === 1 ? [e - z, x] : turn === 2 ? [e - x, e - z] : [z, e - x];
    return [rx + off, rz + offZ];
  };
  // Sea floor everywhere, then the core copied in (turned).
  shape(
    ctx,
    () => -1,
    () => SEABED,
  );
  const big = ctx.t;
  const cm = core.t.material;
  const bm = cm ? ensureMaterial(big) : null;
  for (let z = 0; z < CORE; z++)
    for (let x = 0; x < CORE; x++) {
      const [bx, bz] = to(x, z);
      for (let y = 0; y < ctx.h; y++) {
        const src = (y * CORE + z) * CORE + x;
        const dst = (y * ctx.d + bz) * ctx.w + bx;
        big.density[dst] = core.t.density[src]!;
        if (cm && bm) bm[dst] = cm[src]!;
      }
    }
  for (const a of core.decor) {
    const [x, z] = to(a.x, a.z);
    // Side faces turn with the core; props on top turn their quarter step the same way.
    const face = a.face < 4 ? (a.face + turn) & 3 : a.face;
    const v = a.face < 4 ? a.v : (a.v & ~3) | ((a.v - turn) & 3);
    ctx.decor.push({ ...a, x, z, face, v });
  }
  const sea = big.seaY;
  const top = (x: number, z: number): number => topSolidY(big, x, z);
  const lanes = ctx.w >= 512 ? [-56, 56] : [0];
  const areas: Rect[] = [{ x0: off, z0: offZ, x1: off + CORE - 1, z1: offZ + CORE - 1 }];
  let n = 0;
  // Inward directions: from the west, north, east and south edges.
  for (const [dx, dz] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const)
    for (const lane of lanes) {
      const k = n++;
      // March in from the map edge along a few lines near this lane; keep the one whose shore is
      // furthest out (the shortest bridge).
      let best: { x: number; z: number; depth: number } | null = null;
      const edge = dx !== 0 ? off : offZ;
      for (const shift of opts.shifts ?? [-24, -8, 8, 24]) {
        const along = (dx !== 0 ? ctx.d : ctx.w) / 2 + lane + shift + ctx.rnd(opts.salt, k, 9) - 4;
        for (let depth = 0; depth < (dx !== 0 ? ctx.w : ctx.d) / 2; depth++) {
          const x = dx === 1 ? depth : dx === -1 ? ctx.w - 1 - depth : along;
          const z = dz === 1 ? depth : dz === -1 ? ctx.d - 1 - depth : along;
          if (top(x, z) > sea + 1) {
            // Land the bridge on open ground, not against a building, crane or cliff.
            const ok =
              top(x + dx * 6, z + dz * 6) <= (opts.maxLevel ?? 40) + 2 &&
              depth - edge <= (opts.reach ?? CORE);
            if (ok && (!best || depth < best.depth)) best = { x, z, depth };
            break;
          }
        }
      }
      if (!best || best.depth < 70) continue; // no room for an islet off this shore
      const R = 30;
      const GAP = 14;
      const ix = best.x - dx * (GAP + R + 2);
      const iz = best.z - dz * (GAP + R + 2);
      const lvl = Math.max(
        sea + 2,
        Math.min(top(best.x + dx * 6, best.z + dz * 6), opts.maxLevel ?? 40),
      );
      const wob = wobble(ctx, opts.salt + 10 + k, 12, 3);
      for (let z = iz - R - 4; z <= iz + R + 4; z++)
        for (let x = ix - R - 4; x <= ix + R + 4; x++) {
          if (x < 0 || z < 0 || x >= ctx.w || z >= ctx.d) continue;
          const sdf = R - isqrt((x - ix) ** 2 + (z - iz) ** 2) + wob(x, z);
          if (sdf <= 0) continue;
          const hf = Math.min(lvl * 256 + 255, SEABED * 256 + sdf * 256 * 2);
          for (let y = 0; y < ctx.h; y++) {
            const v = Math.max(0, Math.min(255, 128 + ((hf - y * 256) >> 2)));
            const i = (y * ctx.d + z) * ctx.w + x;
            if (v > big.density[i]!) big.density[i] = v;
          }
        }
      areas.push({ x0: ix - 14, z0: iz - 14, x1: ix + 14, z1: iz + 14 });
      // Bridge: from where the islet's flat top ends to where the mainland's begins, plus a
      // couple of voxels onto each, deck level with the lower end.
      let a = 0;
      while (a < 40 && top(ix + dx * a, iz + dz * a) >= lvl - 1) a++;
      // Down the islet's shore to open water, then across to where the mainland is up again.
      let b = a;
      while (b < a + 20 && top(ix + dx * b, iz + dz * b) > sea) b++;
      while (b < a + 80 && top(ix + dx * b, iz + dz * b) < lvl - 2) b++;
      const s0 = a - 3;
      const s1 = b + 3;
      const y0 = top(ix + dx * s0, iz + dz * s0);
      const y1 = top(ix + dx * s1, iz + dz * s1);
      const mid = (s0 + s1) >> 1;
      put(
        ctx,
        plankBridge(s1 - s0 + 1, 7),
        ix + dx * mid,
        iz + dz * mid,
        dx !== 0 ? 0 : 1,
        opts.salt + 20 + k,
        Math.min(y0, y1) - 2,
      );
      // Two houses either side of the bridge's line, doors toward it; a boat on the far side.
      const doorRot = dx === 1 ? 1 : dx === -1 ? 3 : dz === 1 ? 2 : 0;
      for (const side of [-1, 1]) {
        const hx = ix - dx * 2 + dz * side * 12;
        const hz = iz - dz * 2 + dx * side * 12;
        const p = opts.house(k * 2 + (side > 0 ? 1 : 0));
        put(ctx, p, hx, hz, doorRot, opts.salt + 30 + k * 2 + (side > 0 ? 1 : 0), lvl + 1);
      }
      const fx = ix - dx * (R - 9);
      const fz = iz - dz * (R - 9);
      const face = dx === 1 ? NX : dx === -1 ? PX : dz === 1 ? NZ : PZ;
      ctx.decor.push({ kind: "bollard", x: fx, y: lvl, z: fz, face: UP, v: k * 5 });
      ctx.decor.push({ kind: "moored-boat", x: fx, y: lvl, z: fz, face, v: k * 11 + 3 });
      lamps(ctx, [[ix + dx * (a - 5) + dz * 5, iz + dz * (a - 5) + dx * 5]]);
    }
  scatterObjects(ctx, areas, opts.salt + 90);
}
