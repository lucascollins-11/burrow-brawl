import { isqrt } from "../../fixed.js";
import { octave, sample } from "../mapgen.js";
import { fillFromHeightField, flatDrySpot, type Theme, type ThemeCtx } from "./kit.js";

// Picnic Atoll: a ring of table-top islands in a soda sea, joined by plank bridges. Each island is
// a plateau with a raised, checkered "cloth" tier in the middle. Sandwich towers, spilled-cup
// craters and crumbs are voxel set pieces, so every one of them can be blown apart.

const SEABED = 9;

interface Island {
  cx: number;
  cz: number;
  r: number;
  /** Plateau height in voxels, and the extra height of the middle tier. */
  top: number;
  inner: number;
}

/** Smooth 0..256 ramp (smoothstep) for a 0..256 input. */
function ease(p: number): number {
  return (p * p * (768 - 2 * p)) >> 16;
}

function placeIslands(ctx: ThemeCtx): Island[] {
  const { w, d, rnd } = ctx;
  const edge = Math.min(w, d);
  const count = 3 + ((w * d) >> 15);
  const out: Island[] = [];
  const gap = 20;
  for (let i = 0; i < count; i++) {
    let r = i === 0 ? edge >> 2 : (edge >> 3) + rnd(50, i, edge >> 4);
    for (let shrink = 0; shrink < 4; shrink++) {
      // Of 40 random spots that clear every other island, take the one nearest an existing island
      // (the first island just goes near the middle), so bridges stay short.
      let best: { cx: number; cz: number } | undefined;
      let bestD = Infinity;
      const m = r + 18;
      for (let tryN = 0; tryN < 40 && w - 2 * m > 0 && d - 2 * m > 0; tryN++) {
        const cx =
          i === 0
            ? (w >> 1) + rnd(51, 0, (w >> 3) + 1) - (w >> 4)
            : m + rnd(52, i * 64 + tryN, w - 2 * m);
        const cz =
          i === 0
            ? (d >> 1) + rnd(53, 0, (d >> 3) + 1) - (d >> 4)
            : m + rnd(54, i * 64 + tryN, d - 2 * m);
        let nearest = 0;
        let ok = true;
        for (const o of out) {
          const dd = (o.cx - cx) ** 2 + (o.cz - cz) ** 2;
          if (dd < (o.r + r + gap) ** 2) ok = false;
          if (nearest === 0 || dd < nearest) nearest = dd;
        }
        if (ok && nearest < bestD) {
          bestD = nearest;
          best = { cx, cz };
        }
      }
      const placed = best !== undefined;
      if (best)
        out.push({
          cx: best.cx,
          cz: best.cz,
          r,
          top: 34 + rnd(55, i, 11),
          inner: r >= 30 ? 6 + rnd(56, i, 4) : 0,
        });
      if (placed) break;
      r = (r * 3) >> 2;
      if (r < 16) break;
    }
  }
  return out;
}

function heightField(ctx: ThemeCtx, isl: readonly Island[]): Int32Array {
  const { seed, w, d } = ctx;
  const oBig = octave(seed, 1, w, d, 32);
  const oWarpA = octave(seed, 3, w, d, 28);
  const oWarpB = octave(seed, 4, w, d, 28);
  const out = new Int32Array(w * d);
  for (let z = 0; z < d; z++)
    for (let x = 0; x < w; x++) {
      const big = sample(oBig, x, z) - 32768;
      // A dead-flat seabed keeps rows of identical columns, which run-length encode to almost nothing.
      let hf = SEABED * 256;
      for (const o of isl) {
        const reach = o.r + 22;
        if (x < o.cx - reach || x > o.cx + reach || z < o.cz - reach || z > o.cz + reach) continue;
        const wx = (sample(oWarpA, x, z) - 32768) >> 11;
        const wz = (sample(oWarpB, x, z) - 32768) >> 11;
        const dx = x - o.cx + wx;
        const dz = z - o.cz + wz;
        const d2 = dx * dx + dz * dz;
        const r2 = o.r * o.r;
        if (d2 >= r2) continue;
        const u = Math.floor(((r2 - d2) * 256) / r2);
        const p = ease(Math.min(256, Math.floor((u * 256) / 110)));
        let h = SEABED * 256 + p * (o.top - SEABED) + ((big >> 7) * p) / 256;
        if (o.inner > 0) {
          const ri2 = Math.floor((r2 * 36) / 100);
          if (d2 < ri2) {
            const ui = Math.floor(((ri2 - d2) * 256) / ri2);
            h += Math.min(256, ui * 2) * o.inner;
            // Checkered cloth: every other 6x6 square sits half a voxel higher.
            if (ui >= 140 && (Math.floor(x / 6) + Math.floor(z / 6)) % 2 === 1) h += 128;
          }
        }
        h = Math.floor(h);
        if (h > hf) hf = h;
      }
      out[z * w + x] = hf;
    }
  return out;
}

/** A stack of bread and filling layers topped with an olive. */
function sandwichTower(ctx: ThemeCtx, x: number, z: number, i: number): void {
  const { rnd, box, fill, surf, h } = ctx;
  const hw = 4 + rnd(60, i, 2);
  const layers = 3 + rnd(61, i, 2) * 2; // odd: bread, filling, bread, ...
  let y = surf(x, z) + 1;
  for (let l = 0; l < layers && y + 6 < h; l++) {
    const bread = l % 2 === 0;
    const half = bread ? hw : hw - 1 - rnd(62, i * 16 + l, 2);
    const thick = bread ? 3 : 2;
    box(x - half, y, z - half, x + half, y + thick - 1, z + half);
    y += thick;
  }
  fill(x, y + 1, z, 2);
}

/** Last point along the ray from an island's centre that is still dry plateau, 2 voxels in. */
function edgePoint(
  ctx: ThemeCtx,
  o: Island,
  ux: number,
  uz: number,
  len: number,
): [number, number] {
  const { surf, t } = ctx;
  let s = o.r >> 1;
  const limit = o.r + 24;
  while (s < limit) {
    const x = o.cx + Math.floor((ux * s) / len);
    const z = o.cz + Math.floor((uz * s) / len);
    if (surf(x, z) < t.seaY + 6) break;
    s++;
  }
  s = Math.max(0, s - 2);
  return [o.cx + Math.floor((ux * s) / len), o.cz + Math.floor((uz * s) / len)];
}

function bridge(ctx: ThemeCtx, a: Island, b: Island): void {
  const { box, surf, w, d } = ctx;
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  const len = isqrt(dx * dx + dz * dz);
  if (len === 0) return;
  const [x0, z0] = edgePoint(ctx, a, dx, dz, len);
  const [x1, z1] = edgePoint(ctx, b, -dx, -dz, len);
  const y0 = surf(x0, z0) + 1;
  const y1 = surf(x1, z1) + 1;
  const span = isqrt((x1 - x0) ** 2 + (z1 - z0) ** 2);
  const n = Math.max(1, span >> 1);
  for (let s = 0; s <= n; s++) {
    const x = x0 + Math.floor(((x1 - x0) * s) / n);
    const z = z0 + Math.floor(((z1 - z0) * s) / n);
    const y = y0 + Math.floor(((y1 - y0) * s) / n);
    box(
      Math.max(0, x - 2),
      y - 1,
      Math.max(0, z - 2),
      Math.min(w - 1, x + 2),
      y,
      Math.min(d - 1, z + 2),
    );
  }
}

function placeObjects(ctx: ThemeCtx, isl: readonly Island[]): void {
  const { rnd, objects } = ctx;
  const budget = 6 + ((ctx.w * ctx.d) >> 12) * 2;
  let n = 0;
  for (let i = 0; i < budget * 8 && n < budget; i++) {
    const o = isl[rnd(70, i, isl.length)]!;
    const a = rnd(71, i, o.r * 2 + 1) - o.r;
    const b = rnd(72, i, o.r * 2 + 1) - o.r;
    const x = o.cx + a;
    const z = o.cz + b;
    const y = flatDrySpot(ctx, x, z);
    if (y < 0) continue;
    const roll = rnd(73, i, 6);
    objects.push({ kind: roll < 3 ? "barrel" : roll < 5 ? "mine" : "crate-pad", x, y, z });
    n++;
  }
}

export const picnicAtoll: Theme = {
  id: "picnic-atoll",
  name: "Picnic Atoll",
  minSize: 192,
  build(ctx) {
    const { t, rnd, fill, carve, surf } = ctx;
    const isl = placeIslands(ctx);
    fillFromHeightField(t, heightField(ctx, isl));

    // Bridges first, so towers and craters never block a deck: connect each island to its nearest
    // earlier neighbour (a tree over all islands) when the gap is crossable.
    for (let i = 1; i < isl.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < i; j++) {
        const dd = (isl[i]!.cx - isl[j]!.cx) ** 2 + (isl[i]!.cz - isl[j]!.cz) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = j;
        }
      }
      bridge(ctx, isl[best]!, isl[i]!);
    }

    isl.forEach((o, k) => {
      // Sandwich towers on the rim ring of the plateau.
      const towers = 1 + (o.r >> 5);
      for (let s = 0; s < towers; s++) {
        const i = k * 8 + s;
        const x = o.cx + rnd(80, i, o.r) - (o.r >> 1);
        const z = o.cz + rnd(81, i, o.r) - (o.r >> 1);
        if (surf(x, z) >= ctx.t.seaY + 4) sandwichTower(ctx, x, z, i);
      }
      // A spilled cup: a pit that cuts into the plateau.
      if (o.r >= 28) {
        const x = o.cx + rnd(82, k, o.r >> 1) - (o.r >> 2);
        const z = o.cz + rnd(83, k, o.r >> 1) - (o.r >> 2);
        carve(x, surf(x, z) + 2, z, 5 + rnd(84, k, 3));
      }
      // Crumbs: small clay lumps on the plateau.
      for (let c = 0; c < o.r >> 3; c++) {
        const i = k * 16 + c;
        const x = o.cx + rnd(85, i, o.r) - (o.r >> 1);
        const z = o.cz + rnd(86, i, o.r) - (o.r >> 1);
        if (surf(x, z) >= ctx.t.seaY + 4) fill(x, surf(x, z) + 2, z, 2 + rnd(87, i, 2));
      }
    });

    placeObjects(ctx, isl);
  },
};
