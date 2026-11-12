import { isqrt } from "../../fixed.js";
import {
  fillFromHeightField,
  scatterObjects,
  type Rect,
  type Theme,
  type ThemeCtx,
} from "./kit.js";

// Toybox Harbor: square-edged block islands around a long quay, joined by toy-train bridges.
// A jack-in-the-box and a crane stand on the quay, alphabet-block stacks and stepped tiers on the
// islands. Everything is boxes and spheres, so it all comes apart under fire.

const SEABED = 9;

interface Platform extends Rect {
  top: number;
  quay: boolean;
}

/** Smooth 0..256 ramp (smoothstep) for a 0..256 input. */
function ease(p: number): number {
  return (p * p * (768 - 2 * p)) >> 16;
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.z0 - gap <= b.z1 && b.z0 - gap <= a.z1;
}

function layout(ctx: ThemeCtx): Platform[] {
  const { w, d, rnd } = ctx;
  const out: Platform[] = [];
  // The quay runs along one edge, on a side the seed picks.
  const along = rnd(100, 0, 2) === 0; // true: long in x
  const longSide = along ? w : d;
  const shortSide = along ? d : w;
  const len = Math.floor((longSide * 6) / 10);
  const depth = 26 + rnd(101, 0, 9);
  const start = 20 + rnd(102, 0, longSide - 40 - len + 1);
  const off = rnd(103, 0, 2) === 0 ? 18 : shortSide - 18 - depth;
  out.push(
    along
      ? { x0: start, x1: start + len, z0: off, z1: off + depth, top: 33, quay: true }
      : { z0: start, z1: start + len, x0: off, x1: off + depth, top: 33, quay: true },
  );
  const count = 3 + ((w * d) >> 15);
  for (let i = 0; i < count; i++) {
    const sx = 28 + rnd(110, i, 17);
    const sz = 28 + rnd(111, i, 17);
    let best: Platform | undefined;
    let bestD = Infinity;
    for (let tryN = 0; tryN < 40; tryN++) {
      const x0 = 16 + rnd(112, i * 64 + tryN, w - 32 - sx);
      const z0 = 16 + rnd(113, i * 64 + tryN, d - 32 - sz);
      const p: Platform = {
        x0,
        z0,
        x1: x0 + sx,
        z1: z0 + sz,
        top: 36 + rnd(114, i, 11),
        quay: false,
      };
      if (out.some((o) => overlaps(p, o, 22))) continue;
      const cx = (x0 + p.x1) >> 1;
      const cz = (z0 + p.z1) >> 1;
      let near = Infinity;
      for (const o of out) {
        const dx = cx - ((o.x0 + o.x1) >> 1);
        const dz = cz - ((o.z0 + o.z1) >> 1);
        near = Math.min(near, dx * dx + dz * dz);
      }
      // Prefer a spot about one bridge-length (75 voxels) from its neighbour: spread but connected.
      const score = Math.abs(isqrt(near) - 75);
      if (score < bestD) {
        bestD = score;
        best = p;
      }
    }
    if (best) out.push(best);
  }
  return out;
}

function heightField(ctx: ThemeCtx, plats: readonly Platform[]): Int32Array {
  const { w, d } = ctx;
  // Dead flat sea floor (cheap to encode) and flat-topped blocks with 7-voxel eased walls.
  const out = new Int32Array(w * d).fill(SEABED * 256);
  for (const p of plats)
    for (let z = p.z0; z <= p.z1; z++)
      for (let x = p.x0; x <= p.x1; x++) {
        const e = Math.min(x - p.x0, p.x1 - x, z - p.z0, p.z1 - z);
        const h = SEABED * 256 + ease(Math.min(256, Math.floor((e * 256) / 7))) * (p.top - SEABED);
        if (h > out[z * w + x]!) out[z * w + x] = h;
      }
  return out;
}

/** Cubes stacked a little off true, like a toddler left them. */
function blockStack(ctx: ThemeCtx, x: number, z: number, i: number): void {
  const { rnd, box, surf, h } = ctx;
  const s = 3 + rnd(120, i, 2); // half side
  const n = 1 + rnd(121, i, 3);
  let y = surf(x, z) + 1;
  let ox = 0;
  let oz = 0;
  for (let k = 0; k < n && y + 2 * s + 2 < h; k++) {
    box(x + ox - s, y, z + oz - s, x + ox + s, y + 2 * s - 1, z + oz + s);
    y += 2 * s;
    ox = rnd(122, i * 8 + k, 3) - 1;
    oz = rnd(123, i * 8 + k, 3) - 1;
  }
}

/** A raised tier with a staircase down one side, so it can be walked up. */
function steppedTier(ctx: ThemeCtx, p: Platform, i: number): void {
  const { box, rnd } = ctx;
  const cx = (p.x0 + p.x1) >> 1;
  const cz = (p.z0 + p.z1) >> 1;
  const hw = 6 + rnd(130, i, 3);
  const hd = 6 + rnd(131, i, 3);
  const y = p.top + 1;
  box(cx - hw, y, cz - hd, cx + hw, y + 3, cz + hd);
  // Stairs on the -x side: four steps, two voxels deep each.
  for (let s = 0; s < 4; s++)
    box(cx - hw - 2 * (4 - s), y, cz - 1, cx - hw - 2 * (3 - s) - 1, y + s, cz + 1);
}

function jackInTheBox(ctx: ThemeCtx, cx: number, cz: number): void {
  const { box, fill, surf, h } = ctx;
  const y = surf(cx, cz) + 1;
  if (y + 30 >= h) return;
  box(cx - 4, y, cz - 4, cx + 4, y + 8, cz + 4);
  for (let k = 0; k < 5; k++) fill(cx + (k % 2 === 0 ? -1 : 1), y + 10 + 2 * k, cz, 2);
  fill(cx, y + 21, cz, 5);
  fill(cx, y + 27, cz, 2);
}

function crane(ctx: ThemeCtx, cx: number, cz: number): void {
  const { box, surf, h } = ctx;
  const y = surf(cx, cz) + 1;
  if (y + 30 >= h) return;
  box(cx - 1, y, cz - 1, cx + 1, y + 25, cz + 1);
  box(cx - 1, y + 25, cz - 1, cx + 15, y + 26, cz + 1);
  box(cx + 15, y + 12, cz, cx + 15, y + 24, cz);
}

function edgePoint(p: Platform, ux: number, uz: number, len: number): [number, number] {
  const cx = (p.x0 + p.x1) >> 1;
  const cz = (p.z0 + p.z1) >> 1;
  let last: [number, number] = [cx, cz];
  for (let s = 0; s <= 200; s++) {
    const x = cx + Math.floor((ux * s) / len);
    const z = cz + Math.floor((uz * s) / len);
    // Stay 8 voxels in: the walls ease down over the outer 7, below the water line at 3.
    if (x < p.x0 + 8 || x > p.x1 - 8 || z < p.z0 + 8 || z > p.z1 - 8) break;
    last = [x, z];
  }
  return last;
}

/** A toy-train bridge: a five-wide deck with a sleeper ridge every few voxels. */
function bridge(ctx: ThemeCtx, a: Platform, b: Platform): void {
  const { box, surf, w, d } = ctx;
  const ax = (a.x0 + a.x1) >> 1;
  const az = (a.z0 + a.z1) >> 1;
  const dx = ((b.x0 + b.x1) >> 1) - ax;
  const dz = ((b.z0 + b.z1) >> 1) - az;
  const len = isqrt(dx * dx + dz * dz);
  if (len === 0) return;
  const [x0, z0] = edgePoint(a, dx, dz, len);
  const [x1, z1] = edgePoint(b, -dx, -dz, len);
  const y0 = surf(x0, z0) + 1;
  const y1 = surf(x1, z1) + 1;
  const span = isqrt((x1 - x0) ** 2 + (z1 - z0) ** 2);
  const n = Math.max(1, span >> 1);
  for (let s = 0; s <= n; s++) {
    const x = x0 + Math.floor(((x1 - x0) * s) / n);
    const z = z0 + Math.floor(((z1 - z0) * s) / n);
    const y = y0 + Math.floor(((y1 - y0) * s) / n);
    const lo = (v: number, m: number): number => Math.max(0, v - m);
    box(lo(x, 2), y - 1, lo(z, 2), Math.min(w - 1, x + 2), y, Math.min(d - 1, z + 2));
    if (s % 2 === 0)
      box(lo(x, 3), y + 1, lo(z, 3), Math.min(w - 1, x + 3), y + 1, Math.min(d - 1, z + 3));
  }
}

export const toyboxHarbor: Theme = {
  id: "toybox-harbor",
  name: "Toybox Harbor",
  minSize: 192,
  build(ctx) {
    const { t, rnd } = ctx;
    const plats = layout(ctx);
    fillFromHeightField(t, heightField(ctx, plats));

    for (let i = 1; i < plats.length; i++) {
      let best = 0;
      let bestD = Infinity;
      const cx = (plats[i]!.x0 + plats[i]!.x1) >> 1;
      const cz = (plats[i]!.z0 + plats[i]!.z1) >> 1;
      for (let j = 0; j < i; j++) {
        const dx = cx - ((plats[j]!.x0 + plats[j]!.x1) >> 1);
        const dz = cz - ((plats[j]!.z0 + plats[j]!.z1) >> 1);
        if (dx * dx + dz * dz < bestD) {
          bestD = dx * dx + dz * dz;
          best = j;
        }
      }
      bridge(ctx, plats[best]!, plats[i]!);
    }

    plats.forEach((p, k) => {
      if (p.quay) {
        const mid = (p.x0 + p.x1) >> 1;
        const midZ = (p.z0 + p.z1) >> 1;
        const longX = p.x1 - p.x0 >= p.z1 - p.z0;
        const q = (f: number): [number, number] =>
          longX
            ? [p.x0 + Math.floor(((p.x1 - p.x0) * f) / 10), midZ]
            : [mid, p.z0 + Math.floor(((p.z1 - p.z0) * f) / 10)];
        jackInTheBox(ctx, ...q(3));
        crane(ctx, ...q(8));
        for (let s = 0; s < 4; s++) {
          const [x, z] = q(1 + s * 2 + rnd(140, k * 8 + s, 2));
          blockStack(ctx, x + rnd(141, s, 5) - 2, z + rnd(142, s, 7) - 3, k * 8 + s);
        }
        return;
      }
      steppedTier(ctx, p, k);
      const stacks = 1 + rnd(143, k, 2);
      for (let s = 0; s < stacks; s++) {
        const x = p.x0 + 6 + rnd(144, k * 8 + s, p.x1 - p.x0 - 11);
        const z = p.z0 + 6 + rnd(145, k * 8 + s, p.z1 - p.z0 - 11);
        blockStack(ctx, x, z, k * 8 + s + 100);
      }
    });

    scatterObjects(ctx, plats, 150);
  },
};
