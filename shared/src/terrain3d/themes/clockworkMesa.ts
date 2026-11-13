import { cosDeg, isqrt, sinDeg } from "../../fixed.js";
import {
  fillFromHeightField,
  scatterObjects,
  type Rect,
  type Theme,
  type ThemeCtx,
} from "./kit.js";

// Clockwork Mesa: one great terraced mesa with a gear-tooth rim, ringed by smaller gear plateaus
// and joined to them by belt bridges. Cogwheels, a pendulum clock tower, piston columns and brass
// springs stand on the tiers; tunnels run through the middle tier. All of it is voxels.

const SEABED = 9;

interface Gear {
  cx: number;
  cz: number;
  r: number;
  top: number;
  teeth: number;
  /** The big one gets two more tiers on top. */
  main: boolean;
}

/** Smooth 0..256 ramp (smoothstep) for a 0..256 input. */
function ease(p: number): number {
  return (p * p * (768 - 2 * p)) >> 16;
}

/** A monotone stand-in for the angle, 0..4095 around the circle, from integers only. */
function pseudoAngle(dx: number, dz: number): number {
  const s = Math.abs(dx) + Math.abs(dz);
  if (s === 0) return 0;
  const q = Math.floor((1024 * dz) / s); // -1024..1024
  if (dx >= 0) return dz >= 0 ? q : 4096 + q;
  return 2048 - q;
}

function placeGears(ctx: ThemeCtx): Gear[] {
  const { w, d, rnd } = ctx;
  const edge = Math.min(w, d);
  const count = 3 + ((w * d) >> 15);
  const out: Gear[] = [];
  const gap = 20;
  for (let i = 0; i < count; i++) {
    let r = i === 0 ? Math.floor((edge * 3) / 10) : (edge >> 4) + 10 + rnd(200, i, edge >> 5);
    for (let shrink = 0; shrink < 4; shrink++) {
      const m = r + (r >> 3) + 18;
      let best: { cx: number; cz: number } | undefined;
      let bestD = Infinity;
      for (let tryN = 0; tryN < 40 && w - 2 * m > 0 && d - 2 * m > 0; tryN++) {
        const cx =
          i === 0
            ? (w >> 1) + rnd(201, 0, (w >> 3) + 1) - (w >> 4)
            : m + rnd(202, i * 64 + tryN, w - 2 * m);
        const cz =
          i === 0
            ? (d >> 1) + rnd(203, 0, (d >> 3) + 1) - (d >> 4)
            : m + rnd(204, i * 64 + tryN, d - 2 * m);
        let nearest = Infinity;
        let ok = true;
        for (const o of out) {
          const dd = (o.cx - cx) ** 2 + (o.cz - cz) ** 2;
          const need = o.r + (o.r >> 3) + r + (r >> 3) + gap;
          if (dd < need * need) ok = false;
          if (dd < nearest) nearest = dd;
        }
        if (!ok) continue;
        // Prefer a spot about one belt-length from its nearest neighbour.
        const score = out.length === 0 ? 0 : Math.abs(isqrt(nearest) - (r * 3 + 40));
        if (score < bestD) {
          bestD = score;
          best = { cx, cz };
        }
      }
      if (best) {
        out.push({
          cx: best.cx,
          cz: best.cz,
          r,
          top: i === 0 ? 33 : 35 + rnd(205, i, 8),
          teeth: i === 0 ? 20 : 10 + 2 * rnd(206, i, 3),
          main: i === 0,
        });
        break;
      }
      r = (r * 3) >> 2;
      if (r < 16) break;
    }
  }
  return out;
}

function heightField(ctx: ThemeCtx, gears: readonly Gear[]): Int32Array {
  const { w, d } = ctx;
  // Dead flat sea floor: rows of identical columns run-length encode to almost nothing.
  const out = new Int32Array(w * d).fill(SEABED * 256);
  for (const g of gears) {
    const tooth = Math.max(3, g.r >> 4);
    const reach = g.r + tooth + 2;
    const z0 = Math.max(0, g.cz - reach);
    const z1 = Math.min(d - 1, g.cz + reach);
    const x0 = Math.max(0, g.cx - reach);
    const x1 = Math.min(w - 1, g.cx + reach);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const dx = x - g.cx;
        const dz = z - g.cz;
        const dist = isqrt(dx * dx + dz * dz);
        const ti = Math.floor((pseudoAngle(dx, dz) * g.teeth) / 4096);
        const rEff = g.r + ((ti & 1) === 1 ? tooth : 0);
        const e = rEff - dist;
        if (e < 0) continue;
        const p = ease(Math.min(256, Math.floor((e * 256) / 10)));
        let h = SEABED * 256 + p * (g.top - SEABED);
        if (g.main) {
          // Two inner tiers, each eased over ten voxels so they can be walked up.
          const r2 = Math.floor((g.r * 7) / 10);
          const r3 = Math.floor((g.r * 4) / 10);
          if (dist < r2) h += ease(Math.min(256, Math.floor(((r2 - dist) * 256) / 10))) * 6;
          if (dist < r3) h += ease(Math.min(256, Math.floor(((r3 - dist) * 256) / 10))) * 6;
        }
        if (h > out[z * w + x]!) out[z * w + x] = h;
      }
  }
  return out;
}

/** An upright cogwheel: a ring of lumps with spokes, standing in the x-y plane. */
function cogwheel(ctx: ThemeCtx, cx: number, cz: number, radius: number, salt: number): void {
  const { fill, surf, h } = ctx;
  const cy = surf(cx, cz) + radius + 1;
  if (cy + radius + 3 >= h) return;
  const spokes = 8;
  for (let k = 0; k < spokes * 3; k++) {
    const deg = (k * 360) / (spokes * 3);
    const rr = k % 3 === 0 ? radius + 2 : radius;
    fill(
      cx + ((cosDeg(deg) * rr) >> 16),
      cy + ((sinDeg(deg) * rr) >> 16),
      cz,
      k % 3 === 0 ? 2 : 1 + (salt & 1),
    );
  }
  for (let s = 0; s < 4; s++) {
    const deg = s * 90;
    for (let rr = 2; rr < radius; rr += 2)
      fill(cx + ((cosDeg(deg) * rr) >> 16), cy + ((sinDeg(deg) * rr) >> 16), cz, 1);
  }
  fill(cx, cy, cz, 3);
}

/** A square tower with a pendulum hanging from an arm. */
function clockTower(ctx: ThemeCtx, cx: number, cz: number): void {
  const { box, fill, surf, h } = ctx;
  const y = surf(cx, cz) + 1;
  if (y + 40 >= h) return;
  box(cx - 4, y, cz - 4, cx + 4, y + 30, cz + 4);
  box(cx - 5, y + 31, cz - 5, cx + 5, y + 32, cz + 5); // cornice
  fill(cx, y + 36, cz, 3); // bell
  box(cx + 5, y + 24, cz, cx + 12, y + 25, cz); // arm
  box(cx + 12, y + 12, cz, cx + 12, y + 24, cz); // rod
  fill(cx + 12, y + 10, cz, 3); // bob
}

function pistons(ctx: ThemeCtx, cx: number, cz: number, i: number): void {
  const { box, fill, surf, h, rnd } = ctx;
  for (let k = 0; k < 3; k++) {
    const x = cx + k * 7;
    const y = surf(x, cz) + 1;
    const hh = 6 + rnd(210, i * 4 + k, 8);
    if (y + hh + 4 >= h) continue;
    box(x - 1, y, cz - 1, x + 1, y + hh, cz + 1);
    fill(x, y + hh + 2, cz, 2);
  }
}

/** A brass spring: a helix of small lumps around an axis. */
function spring(ctx: ThemeCtx, cx: number, cz: number): void {
  const { fill, surf, h } = ctx;
  const y = surf(cx, cz) + 1;
  if (y + 24 >= h) return;
  for (let k = 0; k < 30; k++) {
    const deg = k * 40;
    fill(cx + ((cosDeg(deg) * 4) >> 16), y + k, cz + ((sinDeg(deg) * 4) >> 16), 1);
  }
}

function edgePoint(ctx: ThemeCtx, g: Gear, ux: number, uz: number, len: number): [number, number] {
  const { surf, t } = ctx;
  let s = g.r >> 1;
  const limit = g.r + 24;
  while (s < limit) {
    const x = g.cx + Math.floor((ux * s) / len);
    const z = g.cz + Math.floor((uz * s) / len);
    if (surf(x, z) < t.seaY + 6) break;
    s++;
  }
  s = Math.max(0, s - 2);
  return [g.cx + Math.floor((ux * s) / len), g.cz + Math.floor((uz * s) / len)];
}

/** A belt bridge: a five-wide deck with a cog-tooth ridge every few voxels. */
function belt(ctx: ThemeCtx, a: Gear, b: Gear): void {
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
  const lo = (v: number, m: number): number => Math.max(0, v - m);
  for (let s = 0; s <= n; s++) {
    const x = x0 + Math.floor(((x1 - x0) * s) / n);
    const z = z0 + Math.floor(((z1 - z0) * s) / n);
    const y = y0 + Math.floor(((y1 - y0) * s) / n);
    box(lo(x, 2), y - 1, lo(z, 2), Math.min(w - 1, x + 2), y, Math.min(d - 1, z + 2));
    if (s % 3 === 0)
      box(lo(x, 2), y + 1, lo(z, 2), Math.min(w - 1, x + 2), y + 1, Math.min(d - 1, z + 2));
  }
}

export const clockworkMesa: Theme = {
  id: "clockwork-mesa",
  name: "Clockwork Mesa",
  minSize: 192,
  build(ctx) {
    const { t, rnd, carve } = ctx;
    const gears = placeGears(ctx);
    fillFromHeightField(t, heightField(ctx, gears));

    // Belts first, so set pieces never block a deck: each gear to its nearest earlier neighbour.
    for (let i = 1; i < gears.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < i; j++) {
        const dd = (gears[i]!.cx - gears[j]!.cx) ** 2 + (gears[i]!.cz - gears[j]!.cz) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = j;
        }
      }
      belt(ctx, gears[best]!, gears[i]!);
    }

    gears.forEach((g, k) => {
      const at = (salt: number, i: number, frac: number): [number, number] => {
        // A spot within `frac`/10 of the radius, off the centre.
        const span = Math.max(1, Math.floor((g.r * frac * 2) / 10));
        return [
          g.cx + rnd(salt, i, span) - (span >> 1),
          g.cz + rnd(salt + 1, i, span) - (span >> 1),
        ];
      };
      if (g.main) {
        clockTower(ctx, ...at(220, k, 2));
        for (let c = 0; c < 3; c++) cogwheel(ctx, ...at(222, c, 6), 6 + rnd(224, c, 4), c);
        for (let c = 0; c < 2; c++) spring(ctx, ...at(226, c, 7));
        for (let c = 0; c < 3; c++) pistons(ctx, ...at(228, c, 7), c);
        // Tunnels through the tiers: a wobbly chain of carved spheres at plateau height.
        for (let c = 0; c < 2; c++) {
          const x = g.cx - (g.r >> 1);
          const z0 = g.cz + rnd(230, c, g.r >> 1) - (g.r >> 2);
          const y = g.top + 2 + rnd(231, c, 3);
          for (let s = 0; s < g.r; s += 2) {
            carve(x + s, y, z0 + (rnd(232, c * 256 + s, 3) - 1), 3);
          }
        }
      } else {
        if (rnd(240, k, 2) === 0) cogwheel(ctx, ...at(241, k, 4), 5 + rnd(243, k, 3), k);
        else spring(ctx, ...at(244, k, 4));
        pistons(ctx, ...at(246, k, 5), k);
      }
    });

    const areas: Rect[] = gears.map((g) => ({
      x0: g.cx - g.r,
      z0: g.cz - g.r,
      x1: g.cx + g.r,
      z1: g.cz + g.r,
    }));
    scatterObjects(ctx, areas, 250);
  },
};
