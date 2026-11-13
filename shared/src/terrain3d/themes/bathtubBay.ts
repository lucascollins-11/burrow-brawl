import { isqrt } from "../../fixed.js";
import { octave, sample } from "../mapgen.js";
import {
  ease,
  fillFromHeightField,
  scatterObjects,
  type Rect,
  type Theme,
  type ThemeCtx,
} from "./kit.js";

// Bathtub Bay: long rounded soap bars, a porous sponge reef and a chrome drain ring in a tub of
// water, joined by washcloth bridges. Shampoo bottles, a rubber duck, a faucet and floating
// bubbles stand about; the reef is full of holes. All of it is voxels.

const SEABED = 9;

type Kind = "bar" | "reef" | "drain";

interface Spot {
  kind: Kind;
  cx: number;
  cz: number;
  /** Bounding radius, for spacing. */
  r: number;
  top: number;
  /** Bars: half length along x and half width. */
  hl: number;
  hw: number;
}

function placeSpots(ctx: ThemeCtx): Spot[] {
  const { w, d, rnd } = ctx;
  const edge = Math.min(w, d);
  const bars = 3 + ((w * d) >> 15);
  const out: Spot[] = [];
  const gap = 20;
  // The drain ring sits near the middle, the sponge reef off to one side, then the bars.
  const want: Kind[] = ["drain", "reef", ...Array.from({ length: bars }, () => "bar" as Kind)];
  for (let i = 0; i < want.length; i++) {
    const kind = want[i]!;
    let hl = 0;
    let hw = 0;
    let r = 0;
    if (kind === "drain") r = Math.floor((edge * 2) / 10) + 8;
    else if (kind === "reef") r = (edge >> 3) + 10 + rnd(310, i, edge >> 5);
    else {
      hw = 11 + rnd(311, i, 6);
      hl = 22 + rnd(312, i, 14);
      r = hl + hw;
    }
    for (let shrink = 0; shrink < 4; shrink++) {
      const m = r + 18;
      let best: { cx: number; cz: number } | undefined;
      let bestD = Infinity;
      for (let tryN = 0; tryN < 40 && w - 2 * m > 0 && d - 2 * m > 0; tryN++) {
        const cx =
          i === 0
            ? (w >> 1) + rnd(313, 0, (w >> 3) + 1) - (w >> 4)
            : m + rnd(314, i * 64 + tryN, w - 2 * m);
        const cz =
          i === 0
            ? (d >> 1) + rnd(315, 0, (d >> 3) + 1) - (d >> 4)
            : m + rnd(316, i * 64 + tryN, d - 2 * m);
        let nearest = Infinity;
        let ok = true;
        for (const o of out) {
          const dd = (o.cx - cx) ** 2 + (o.cz - cz) ** 2;
          const need = o.r + r + gap;
          if (dd < need * need) ok = false;
          if (dd < nearest) nearest = dd;
        }
        if (!ok) continue;
        const score = out.length === 0 ? 0 : Math.abs(isqrt(nearest) - (r * 2 + 40));
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
          top: kind === "bar" ? 38 + rnd(317, i, 5) : kind === "drain" ? 35 : 33,
          hl,
          hw,
        });
        break;
      }
      r = (r * 3) >> 2;
      hl = (hl * 3) >> 2;
      hw = Math.max(9, (hw * 3) >> 2);
      if (r < 16) break;
    }
  }
  return out;
}

function heightField(ctx: ThemeCtx, spots: readonly Spot[]): Int32Array {
  const { seed, w, d } = ctx;
  const oWob = octave(seed, 8, w, d, 20);
  // The tub floor falls away to a funnel under the drain; the rest is dead flat (cheap to encode).
  const out = new Int32Array(w * d).fill(SEABED * 256);
  const drain = spots.find((s) => s.kind === "drain");
  if (drain) {
    const fr = drain.r + 14;
    for (let z = Math.max(0, drain.cz - fr); z <= Math.min(d - 1, drain.cz + fr); z++)
      for (let x = Math.max(0, drain.cx - fr); x <= Math.min(w - 1, drain.cx + fr); x++) {
        const dist = isqrt((x - drain.cx) ** 2 + (z - drain.cz) ** 2);
        if (dist < fr) out[z * w + x] = Math.max(4 * 256, SEABED * 256 - (fr - dist) * 64);
      }
  }
  for (const o of spots) {
    const reach = o.r + 12;
    for (let z = Math.max(0, o.cz - reach); z <= Math.min(d - 1, o.cz + reach); z++)
      for (let x = Math.max(0, o.cx - reach); x <= Math.min(w - 1, o.cx + reach); x++) {
        const dx = x - o.cx;
        const dz = z - o.cz;
        let e: number;
        let ramp = 8;
        if (o.kind === "bar") {
          // Distance to the bar's spine, so the ends are round too; soft pillow edges.
          const ex = Math.max(Math.abs(dx) - o.hl, 0);
          e = o.hw - isqrt(ex * ex + dz * dz);
          ramp = Math.max(6, o.hw >> 1);
        } else {
          const dist = isqrt(dx * dx + dz * dz);
          const wob = (sample(oWob, x, z) - 32768) >> (o.kind === "reef" ? 11 : 13);
          e = o.r + wob - dist;
          if (o.kind === "drain") e = Math.min(e, dist - Math.floor((o.r * 6) / 10));
        }
        if (e < 0) continue;
        const p = ease(Math.min(256, Math.floor((e * 256) / ramp)));
        const h = SEABED * 256 + p * (o.top - SEABED);
        if (h > out[z * w + x]!) out[z * w + x] = h;
      }
  }
  return out;
}

/** A shampoo bottle: body, shoulder, cap and nozzle. */
function bottle(ctx: ThemeCtx, x: number, z: number): void {
  const { box, surf, h } = ctx;
  const y = surf(x, z) + 1;
  if (y + 24 >= h) return;
  box(x - 3, y, z - 2, x + 3, y + 14, z + 2);
  box(x - 2, y + 15, z - 1, x + 2, y + 16, z + 1);
  box(x - 1, y + 17, z - 1, x + 1, y + 19, z + 1);
  box(x + 1, y + 19, z, x + 3, y + 20, z);
}

function duck(ctx: ThemeCtx, x: number, z: number): void {
  const { box, fill, surf, h } = ctx;
  const y = surf(x, z) + 1;
  if (y + 16 >= h) return;
  fill(x, y + 4, z, 5);
  fill(x + 3, y + 9, z, 3);
  box(x + 6, y + 8, z - 1, x + 8, y + 9, z + 1);
  fill(x - 5, y + 6, z, 2);
}

function faucet(ctx: ThemeCtx, x: number, z: number): void {
  const { box, fill, surf, h } = ctx;
  const y = surf(x, z) + 1;
  if (y + 24 >= h) return;
  box(x - 1, y, z - 1, x + 1, y + 16, z + 1);
  box(x - 1, y + 16, z - 1, x + 9, y + 18, z + 1);
  box(x + 8, y + 12, z - 1, x + 9, y + 16, z + 1);
  fill(x, y + 19, z, 2);
}

function bubbles(ctx: ThemeCtx, x: number, z: number, i: number): void {
  const { fill, rnd, surf, h } = ctx;
  const y = surf(x, z) + 8 + rnd(320, i, 6);
  if (y + 8 >= h) return;
  fill(x, y, z, 4);
  fill(x + 5, y + 2, z + 2, 3);
  fill(x - 4, y + 3, z - 3, 2);
}

/** Pores through the sponge: short chains of carved spheres. */
function pores(ctx: ThemeCtx, o: Spot, i: number): void {
  const { carve, rnd, surf } = ctx;
  const x = o.cx + rnd(330, i, o.r) - (o.r >> 1);
  const z = o.cz + rnd(331, i, o.r) - (o.r >> 1);
  const top = surf(x, z);
  if (top < ctx.t.seaY + 4) return;
  for (let s = 0; s < 4; s++)
    carve(x + s * 2, top - 2 - rnd(332, i * 8 + s, 4), z + rnd(333, i * 8 + s, 3) - 1, 2 + (s & 1));
}

function edgePoint(ctx: ThemeCtx, o: Spot, ux: number, uz: number, len: number): [number, number] {
  const { surf, t } = ctx;
  // Walk out from the middle of a bar or reef; the drain ring starts on its band.
  let s = o.kind === "drain" ? Math.floor((o.r * 8) / 10) : 0;
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

/** A washcloth bridge: a five-wide deck. */
function washcloth(ctx: ThemeCtx, a: Spot, b: Spot): void {
  const { box, surf, w, d } = ctx;
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  const len = isqrt(dx * dx + dz * dz);
  if (len === 0) return;
  const [x0, z0] = edgePoint(ctx, a, dx, dz, len);
  const [x1, z1] = edgePoint(ctx, b, -dx, -dz, len);
  const y0 = surf(x0, z0) + 1;
  const y1 = surf(x1, z1) + 1;
  const n = Math.max(1, isqrt((x1 - x0) ** 2 + (z1 - z0) ** 2) >> 1);
  const lo = (v: number): number => Math.max(0, v - 2);
  for (let s = 0; s <= n; s++) {
    const x = x0 + Math.floor(((x1 - x0) * s) / n);
    const z = z0 + Math.floor(((z1 - z0) * s) / n);
    const y = y0 + Math.floor(((y1 - y0) * s) / n);
    box(lo(x), y - 1, lo(z), Math.min(w - 1, x + 2), y, Math.min(d - 1, z + 2));
  }
}

export const bathtubBay: Theme = {
  id: "bathtub-bay",
  name: "Bathtub Bay",
  minSize: 192,
  build(ctx) {
    const { t, rnd } = ctx;
    const spots = placeSpots(ctx);
    fillFromHeightField(t, heightField(ctx, spots));

    for (let i = 1; i < spots.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < i; j++) {
        const dd = (spots[i]!.cx - spots[j]!.cx) ** 2 + (spots[i]!.cz - spots[j]!.cz) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = j;
        }
      }
      washcloth(ctx, spots[best]!, spots[i]!);
    }

    spots.forEach((o, k) => {
      // Spots on the dry top of this piece (the drain's hole is water, so it is skipped).
      const place = (
        fn: (x: number, z: number, i: number) => void,
        salt: number,
        n: number,
      ): void => {
        let done = 0;
        for (let i = 0; i < 30 && done < n; i++) {
          const span = Math.max(1, o.r);
          const x = o.cx + rnd(salt, k * 32 + i, span) - (span >> 1);
          const z = o.cz + rnd(salt + 1, k * 32 + i, span) - (span >> 1);
          if (ctx.surf(x, z) >= t.seaY + 6) {
            fn(x, z, k * 32 + i);
            done++;
          }
        }
      };
      if (o.kind === "bar") {
        place((x, z) => bottle(ctx, x, z), 340, 2);
        place((x, z, i) => bubbles(ctx, x, z, i), 342, 2);
      } else if (o.kind === "reef") {
        place((x, z) => duck(ctx, x, z), 344, 1);
        for (let i = 0; i < 6 + (o.r >> 3); i++) pores(ctx, o, k * 32 + i);
      } else {
        place((x, z) => faucet(ctx, x, z), 346, 1);
        place((x, z, i) => bubbles(ctx, x, z, i), 348, 3);
      }
    });

    const areas: Rect[] = spots.map((o) => ({
      x0: o.cx - o.r,
      z0: o.cz - o.r,
      x1: o.cx + o.r,
      z1: o.cz + o.r,
    }));
    scatterObjects(ctx, areas, 350);
  },
};
