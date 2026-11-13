import { cosDeg, isqrt, sinDeg } from "../../fixed.js";
import { octave, sample } from "../mapgen.js";
import {
  ease,
  fillFromHeightField,
  scatterObjects,
  type Rect,
  type Theme,
  type ThemeCtx,
} from "./kit.js";

// Garden Patch: a great lawn with a pond, raised beds and molehills, joined by boardwalks.
// Flowerpot towers, a watering-can fort, sunflowers, picket fences and garden gnomes stand about.
// All of it is voxels, so the fort and the towers come down under fire.

const SEABED = 9;

type Kind = "lawn" | "bed" | "mound";

interface Plot {
  kind: Kind;
  cx: number;
  cz: number;
  /** Bounding radius for spacing; beds also use the half sizes. */
  r: number;
  hx: number;
  hz: number;
  top: number;
}

function placePlots(ctx: ThemeCtx): Plot[] {
  const { w, d, rnd } = ctx;
  const edge = Math.min(w, d);
  const extra = 3 + ((w * d) >> 15);
  const out: Plot[] = [];
  const gap = 20;
  const want: Kind[] = [
    "lawn",
    ...Array.from({ length: extra }, (_, i) => (i % 3 === 2 ? "mound" : "bed") as Kind),
  ];
  for (let i = 0; i < want.length; i++) {
    const kind = want[i]!;
    let hx = 0;
    let hz = 0;
    let r = 0;
    if (kind === "lawn") r = Math.floor((edge * 3) / 10) + 4;
    else if (kind === "mound") r = (edge >> 4) + 12 + rnd(360, i, edge >> 5);
    else {
      hx = 18 + rnd(361, i, 12);
      hz = 18 + rnd(362, i, 12);
      r = isqrt(hx * hx + hz * hz);
    }
    for (let shrink = 0; shrink < 4; shrink++) {
      const m = r + 18;
      let best: { cx: number; cz: number } | undefined;
      let bestD = Infinity;
      for (let tryN = 0; tryN < 40 && w - 2 * m > 0 && d - 2 * m > 0; tryN++) {
        const cx =
          i === 0
            ? (w >> 1) + rnd(363, 0, (w >> 3) + 1) - (w >> 4)
            : m + rnd(364, i * 64 + tryN, w - 2 * m);
        const cz =
          i === 0
            ? (d >> 1) + rnd(365, 0, (d >> 3) + 1) - (d >> 4)
            : m + rnd(366, i * 64 + tryN, d - 2 * m);
        let nearest = Infinity;
        let ok = true;
        for (const o of out) {
          const dd = (o.cx - cx) ** 2 + (o.cz - cz) ** 2;
          const need = o.r + r + gap;
          if (dd < need * need) ok = false;
          if (dd < nearest) nearest = dd;
        }
        if (!ok) continue;
        const score = out.length === 0 ? 0 : Math.abs(isqrt(nearest) - (r * 2 + 36));
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
          hx,
          hz,
          top: kind === "lawn" ? 34 : kind === "bed" ? 37 + rnd(367, i, 6) : 35 + rnd(368, i, 4),
        });
        break;
      }
      r = (r * 3) >> 2;
      hx = (hx * 3) >> 2;
      hz = (hz * 3) >> 2;
      if (r < 16) break;
    }
  }
  return out;
}

function heightField(ctx: ThemeCtx, plots: readonly Plot[]): Int32Array {
  const { seed, w, d } = ctx;
  const oWob = octave(seed, 9, w, d, 22);
  const oPond = octave(seed, 10, w, d, 18);
  // Dead flat sea floor: rows of identical columns run-length encode to almost nothing.
  const out = new Int32Array(w * d).fill(SEABED * 256);
  for (const o of plots) {
    const reach = o.r + 12;
    // The pond: a lake inside the lawn, off-centre, with a wobbly shore.
    const px = o.cx + (o.r >> 2);
    const pz = o.cz - (o.r >> 2);
    const pr = Math.floor((o.r * 3) / 10);
    for (let z = Math.max(0, o.cz - reach); z <= Math.min(d - 1, o.cz + reach); z++)
      for (let x = Math.max(0, o.cx - reach); x <= Math.min(w - 1, o.cx + reach); x++) {
        const dx = x - o.cx;
        const dz = z - o.cz;
        let e: number;
        if (o.kind === "bed") {
          e = Math.min(o.hx - Math.abs(dx), o.hz - Math.abs(dz));
        } else {
          e = o.r + ((sample(oWob, x, z) - 32768) >> 12) - isqrt(dx * dx + dz * dz);
          if (o.kind === "lawn") {
            const wob = (sample(oPond, x, z) - 32768) >> 12;
            e = Math.min(e, isqrt((x - px) ** 2 + (z - pz) ** 2) - pr - wob);
          }
        }
        if (e < 0) continue;
        const p = ease(Math.min(256, Math.floor((e * 256) / (o.kind === "bed" ? 6 : 9))));
        const h = SEABED * 256 + p * (o.top - SEABED);
        if (h > out[z * w + x]!) out[z * w + x] = h;
      }
  }
  return out;
}

/** A plant on a stem: leaves and a flower head. */
function plant(ctx: ThemeCtx, x: number, y: number, z: number): void {
  const { box, fill } = ctx;
  box(x, y, z, x, y + 5, z);
  fill(x - 3, y + 3, z, 2);
  fill(x + 3, y + 4, z, 2);
  fill(x, y + 8, z, 3);
}

/** A tower of terracotta pots, each wider at the rim, with a plant on top. */
function potTower(ctx: ThemeCtx, x: number, z: number, i: number): void {
  const { box, rnd, surf, h } = ctx;
  const n = 2 + rnd(370, i, 3);
  let y = surf(x, z) + 1;
  if (y + n * 6 + 14 >= h) return;
  for (let k = 0; k < n; k++) {
    box(x - 2, y, z - 2, x + 2, y + 1, z + 2); // base
    box(x - 3, y + 2, z - 3, x + 3, y + 4, z + 3); // belly
    box(x - 4, y + 5, z - 4, x + 4, y + 6, z + 4); // rim
    y += 7;
  }
  plant(ctx, x, y, z);
}

/** The watering-can fort: a hollow body with a doorway, a rising spout, a handle and a rose. */
function wateringCan(ctx: ThemeCtx, x: number, z: number): void {
  const { box, carve, fill, surf, h } = ctx;
  const y = surf(x, z) + 1;
  if (y + 22 >= h) return;
  box(x - 6, y, z - 4, x + 6, y + 10, z + 4);
  carve(x - 3, y + 5, z, 3);
  carve(x + 3, y + 5, z, 3);
  carve(x, y + 3, z - 4, 2); // doorway
  for (let s = 0; s <= 8; s++) box(x + 7 + s, y + 3 + s, z - 1, x + 7 + s, y + 4 + s, z + 1);
  fill(x + 16, y + 13, z, 3); // rose
  for (let deg = 0; deg <= 180; deg += 30)
    fill(x - 6, y + 5 + ((sinDeg(deg) * 6) >> 16), z + ((cosDeg(deg) * 5) >> 16), 1);
}

function sunflower(ctx: ThemeCtx, x: number, z: number, i: number): void {
  const { box, fill, rnd, surf, h } = ctx;
  const y = surf(x, z) + 1;
  const hh = 10 + rnd(372, i, 6);
  if (y + hh + 6 >= h) return;
  box(x, y, z, x, y + hh, z);
  fill(x, y + hh + 2, z, 4);
}

function fence(ctx: ThemeCtx, x: number, z: number, i: number): void {
  const { box, rnd, surf } = ctx;
  for (let k = 0; k < 9; k++) {
    if (rnd(374, i * 16 + k, 5) === 0) continue; // a missing picket
    const px = x + 2 * k;
    const y = surf(px, z) + 1;
    box(px, y, z, px, y + 4, z);
  }
}

function gnome(ctx: ThemeCtx, x: number, z: number): void {
  const { box, fill, surf, h } = ctx;
  const y = surf(x, z) + 1;
  if (y + 14 >= h) return;
  box(x - 1, y, z - 1, x + 1, y + 4, z + 1);
  fill(x, y + 6, z, 2);
  fill(x, y + 9, z, 2);
  fill(x, y + 11, z, 1);
}

function edgePoint(ctx: ThemeCtx, o: Plot, ux: number, uz: number, len: number): [number, number] {
  const { surf, t } = ctx;
  const limit = o.r + 24;
  let s = limit;
  const dry = (v: number): boolean => {
    const x = o.cx + Math.floor((ux * v) / len);
    const z = o.cz + Math.floor((uz * v) / len);
    return surf(x, z) >= t.seaY + 6;
  };
  // Walk in from outside to the first dry ground (the lawn's middle may be pond), then 2 inside.
  while (s > 0 && !dry(s)) s--;
  s = Math.max(0, s - 2);
  return [o.cx + Math.floor((ux * s) / len), o.cz + Math.floor((uz * s) / len)];
}

/** A boardwalk: a five-wide deck. */
function boardwalk(ctx: ThemeCtx, a: Plot, b: Plot): void {
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

export const gardenPatch: Theme = {
  id: "garden-patch",
  name: "Garden Patch",
  minSize: 192,
  build(ctx) {
    const { t, rnd } = ctx;
    const plots = placePlots(ctx);
    fillFromHeightField(t, heightField(ctx, plots));

    for (let i = 1; i < plots.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < i; j++) {
        const dd = (plots[i]!.cx - plots[j]!.cx) ** 2 + (plots[i]!.cz - plots[j]!.cz) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = j;
        }
      }
      boardwalk(ctx, plots[best]!, plots[i]!);
    }

    plots.forEach((o, k) => {
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
      if (o.kind === "lawn") {
        place((x, z) => wateringCan(ctx, x, z), 380, 1);
        place((x, z, i) => potTower(ctx, x, z, i), 382, 4);
        place((x, z, i) => sunflower(ctx, x, z, i), 384, 5);
        place((x, z, i) => fence(ctx, x, z, i), 386, 3);
        place((x, z) => gnome(ctx, x, z), 388, 2);
      } else if (o.kind === "bed") {
        place((x, z, i) => potTower(ctx, x, z, i), 390, 1);
        place((x, z, i) => sunflower(ctx, x, z, i), 392, 3);
        place((x, z) => gnome(ctx, x, z), 394, 1);
      } else {
        place((x, z, i) => sunflower(ctx, x, z, i), 396, 2);
      }
    });

    const areas: Rect[] = plots.map((o) => ({
      x0: o.cx - o.r,
      z0: o.cz - o.r,
      x1: o.cx + o.r,
      z1: o.cz + o.r,
    }));
    scatterObjects(ctx, areas, 400);
  },
};
