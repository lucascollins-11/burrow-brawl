import { isqrt } from "../../fixed.js";
import { octave, sample } from "../mapgen.js";
import {
  ease,
  fillFromHeightField,
  pseudoAngle,
  scatterObjects,
  type Rect,
  type Theme,
  type ThemeCtx,
} from "./kit.js";

// Frosted Bakery: a great ring-shaped doughnut with a lagoon in the middle, a tiered layer cake,
// and scalloped cupcakes, joined by cookie paths. Candles, cherries, meringue peaks, sugar cubes
// and cream dollops stand on top, and bites have been taken out of the edges. All voxels.

const SEABED = 9;

type Kind = "doughnut" | "layer" | "cupcake";

interface Treat {
  kind: Kind;
  cx: number;
  cz: number;
  r: number;
  top: number;
}

function placeTreats(ctx: ThemeCtx): Treat[] {
  const { w, d, rnd } = ctx;
  const edge = Math.min(w, d);
  const count = 3 + ((w * d) >> 15);
  const out: Treat[] = [];
  const gap = 20;
  for (let i = 0; i < count; i++) {
    const kind: Kind = i === 0 ? "doughnut" : i === 1 ? "layer" : "cupcake";
    let r =
      i === 0
        ? Math.floor((edge * 3) / 10)
        : kind === "layer"
          ? (edge >> 3) + 8 + rnd(260, i, edge >> 5)
          : (edge >> 4) + 10 + rnd(261, i, edge >> 5);
    for (let shrink = 0; shrink < 4; shrink++) {
      const m = r + 26;
      let best: { cx: number; cz: number } | undefined;
      let bestD = Infinity;
      for (let tryN = 0; tryN < 40 && w - 2 * m > 0 && d - 2 * m > 0; tryN++) {
        const cx =
          i === 0
            ? (w >> 1) + rnd(262, 0, (w >> 3) + 1) - (w >> 4)
            : m + rnd(263, i * 64 + tryN, w - 2 * m);
        const cz =
          i === 0
            ? (d >> 1) + rnd(264, 0, (d >> 3) + 1) - (d >> 4)
            : m + rnd(265, i * 64 + tryN, d - 2 * m);
        let nearest = Infinity;
        let ok = true;
        for (const o of out) {
          const dd = (o.cx - cx) ** 2 + (o.cz - cz) ** 2;
          const need = o.r + r + gap + 16;
          if (dd < need * need) ok = false;
          if (dd < nearest) nearest = dd;
        }
        if (!ok) continue;
        const score = out.length === 0 ? 0 : Math.abs(isqrt(nearest) - (r * 2 + 50));
        if (score < bestD) {
          bestD = score;
          best = { cx, cz };
        }
      }
      if (best) {
        out.push({
          kind,
          cx: best.cx,
          cz: best.cz,
          r,
          top: kind === "doughnut" ? 34 : 36 + rnd(266, i, 7),
        });
        break;
      }
      r = (r * 3) >> 2;
      if (r < 14) break;
    }
  }
  return out;
}

function heightField(ctx: ThemeCtx, treats: readonly Treat[]): Int32Array {
  const { seed, w, d } = ctx;
  const oWob = octave(seed, 7, w, d, 24);
  // Dead flat sea floor: rows of identical columns run-length encode to almost nothing.
  const out = new Int32Array(w * d).fill(SEABED * 256);
  for (const o of treats) {
    const reach = o.r + 12;
    const z0 = Math.max(0, o.cz - reach);
    const z1 = Math.min(d - 1, o.cz + reach);
    const x0 = Math.max(0, o.cx - reach);
    const x1 = Math.min(w - 1, o.cx + reach);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const dx = x - o.cx;
        const dz = z - o.cz;
        const dist = isqrt(dx * dx + dz * dz);
        const pa = pseudoAngle(dx, dz);
        // Organic edges: the radius wobbles by up to 8 voxels; cupcakes also get paper pleats.
        let rEff = o.r + ((sample(oWob, x, z) - 32768) >> 12);
        if (o.kind === "cupcake") rEff -= ((pa * 16) >> 12) & 1 ? 2 : 0;
        let e = rEff - dist;
        if (o.kind === "doughnut") e = Math.min(e, dist - Math.floor((o.r * 4) / 10));
        if (e < 0) continue;
        const p = ease(Math.min(256, Math.floor((e * 256) / 8)));
        let h = SEABED * 256 + p * (o.top - SEABED);
        if (o.kind === "doughnut" && e >= 10 && ((pa >> 6) & 1) === 1) h += 96; // icing drizzle
        if (o.kind === "layer") {
          // Two more layers, each narrower, eased over six voxels (a rise of six).
          const r2 = Math.floor((o.r * 7) / 10);
          const r3 = Math.floor((o.r * 4) / 10);
          if (dist < r2) h += ease(Math.min(256, Math.floor(((r2 - dist) * 256) / 6))) * 6;
          if (dist < r3) h += ease(Math.min(256, Math.floor(((r3 - dist) * 256) / 6))) * 6;
        }
        if (o.kind === "cupcake") {
          // A swirl of frosting on top.
          const rs = Math.floor((o.r * 6) / 10);
          if (dist < rs) h += ease(Math.min(256, Math.floor(((rs - dist) * 256) / 10))) * 4;
        }
        if (h > out[z * w + x]!) out[z * w + x] = h;
      }
  }
  return out;
}

/** A thin candle with a flame. */
function candle(ctx: ThemeCtx, x: number, z: number): void {
  const { box, fill, surf, h } = ctx;
  const y = surf(x, z) + 1;
  if (y + 14 >= h) return;
  box(x, y, z, x, y + 8, z);
  fill(x, y + 10, z, 1);
}

function cherry(ctx: ThemeCtx, x: number, z: number): void {
  const { box, fill, surf, h } = ctx;
  const y = surf(x, z) + 1;
  if (y + 12 >= h) return;
  fill(x, y + 3, z, 4);
  box(x, y + 7, z, x, y + 11, z);
}

/** A meringue peak: stacked, shrinking lumps. */
function meringue(ctx: ThemeCtx, x: number, z: number): void {
  const { fill, surf, h } = ctx;
  const y = surf(x, z) + 1;
  if (y + 16 >= h) return;
  fill(x, y + 3, z, 4);
  fill(x, y + 7, z, 3);
  fill(x, y + 10, z, 2);
  fill(x, y + 12, z, 1);
}

function sugarCubes(ctx: ThemeCtx, x: number, z: number, i: number): void {
  const { box, rnd, surf, h } = ctx;
  const y = surf(x, z) + 1;
  const n = 1 + rnd(270, i, 3);
  for (let k = 0; k < n && y + 5 * (k + 1) < h; k++) {
    const o = rnd(271, i * 8 + k, 3) - 1;
    box(x + o - 2, y + 5 * k, z - 2, x + o + 2, y + 5 * k + 4, z + 2);
  }
}

function edgePoint(ctx: ThemeCtx, o: Treat, ux: number, uz: number, len: number): [number, number] {
  const { surf, t } = ctx;
  let s = o.kind === "doughnut" ? Math.floor((o.r * 7) / 10) : o.r >> 1;
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

/** A cookie path: a chain of fat round cookies, top surface about a voxel above the ends. */
function cookiePath(ctx: ThemeCtx, a: Treat, b: Treat): void {
  const { fill, surf } = ctx;
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  const len = isqrt(dx * dx + dz * dz);
  if (len === 0) return;
  const [x0, z0] = edgePoint(ctx, a, dx, dz, len);
  const [x1, z1] = edgePoint(ctx, b, -dx, -dz, len);
  const y0 = surf(x0, z0);
  const y1 = surf(x1, z1);
  const span = isqrt((x1 - x0) ** 2 + (z1 - z0) ** 2);
  const n = Math.max(1, span >> 1);
  for (let s = 0; s <= n; s++) {
    const x = x0 + Math.floor(((x1 - x0) * s) / n);
    const z = z0 + Math.floor(((z1 - z0) * s) / n);
    const y = y0 + Math.floor(((y1 - y0) * s) / n);
    fill(x, y - 2, z, 3);
  }
}

export const frostedBakery: Theme = {
  id: "frosted-bakery",
  name: "Frosted Bakery",
  minSize: 192,
  build(ctx) {
    const { t, rnd, carve } = ctx;
    const treats = placeTreats(ctx);
    fillFromHeightField(t, heightField(ctx, treats));

    // Cookie paths first, so toppings never block them: each treat to its nearest earlier one.
    for (let i = 1; i < treats.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < i; j++) {
        const dd = (treats[i]!.cx - treats[j]!.cx) ** 2 + (treats[i]!.cz - treats[j]!.cz) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = j;
        }
      }
      cookiePath(ctx, treats[best]!, treats[i]!);
    }

    treats.forEach((o, k) => {
      // A spot on the ring (doughnut) or within the top of the treat.
      const spot = (salt: number, i: number): [number, number] => {
        if (o.kind === "doughnut") {
          const ring = Math.floor((o.r * 7) / 10);
          const a = rnd(salt, i, 2 * ring + 1) - ring;
          const b = rnd(salt + 1, i, 2 * ring + 1) - ring;
          return [o.cx + a, o.cz + b];
        }
        const span = Math.max(1, o.r);
        return [
          o.cx + rnd(salt, i, span) - (span >> 1),
          o.cz + rnd(salt + 1, i, span) - (span >> 1),
        ];
      };
      const tries = o.kind === "doughnut" ? 24 : 8;
      const place = (
        fn: (x: number, z: number, i: number) => void,
        salt: number,
        n: number,
      ): void => {
        let done = 0;
        for (let i = 0; i < tries && done < n; i++) {
          const [x, z] = spot(salt, k * 32 + i);
          // Only on dry, high ground (not the lagoon, not the sea).
          if (ctx.surf(x, z) >= t.seaY + 6) {
            fn(x, z, k * 32 + i);
            done++;
          }
        }
      };
      if (o.kind === "doughnut") {
        place((x, z) => candle(ctx, x, z), 280, 6);
        place((x, z) => meringue(ctx, x, z), 282, 4);
        place((x, z, i) => sugarCubes(ctx, x, z, i), 284, 4);
        // Bites out of the doughnut.
        place((x, z) => carve(x, ctx.surf(x, z) + 2, z, 6 + rnd(286, x + z, 4)), 288, 3);
      } else if (o.kind === "layer") {
        const top = ctx.surf(o.cx, o.cz);
        if (top > 0) cherry(ctx, o.cx, o.cz);
        place((x, z) => candle(ctx, x, z), 290, 6);
        place((x, z, i) => sugarCubes(ctx, x, z, i), 292, 2);
      } else {
        const top = ctx.surf(o.cx, o.cz);
        if (top > 0) cherry(ctx, o.cx, o.cz);
        place((x, z) => meringue(ctx, x, z), 294, 1);
      }
    });

    const areas: Rect[] = treats.map((o) => ({
      x0: o.cx - o.r,
      z0: o.cz - o.r,
      x1: o.cx + o.r,
      z1: o.cz + o.r,
    }));
    scatterObjects(ctx, areas, 300);
  },
};
