import { describe, expect, it } from "vitest";
import {
  add,
  aimDir,
  cosPitch,
  cosYaw,
  cross,
  dot,
  i32,
  length,
  lengthSq,
  mulDiv,
  mulQ,
  normalize,
  reflect,
  scale,
  sinPitch,
  sinYaw,
  sub,
  v3,
  withLength,
  yawDir,
} from "./vec3";
import type { Vec3 as V3 } from "./api";

// --- BigInt reference ----------------------------------------------------------------------------

const B = BigInt;
const floorDiv = (n: bigint, d: bigint): bigint => {
  const q = n / d;
  return n % d !== 0n && n < 0n !== d < 0n ? q - 1n : q;
};
const refMulQ = (a: number, b: number): number => Number(floorDiv(B(a) * B(b), 65536n));
const refDot = (a: V3, b: V3): number =>
  Number(floorDiv(B(a.x) * B(b.x) + B(a.y) * B(b.y) + B(a.z) * B(b.z), 65536n));
const refCross = (a: V3, b: V3): V3 => ({
  x: Number(floorDiv(B(a.y) * B(b.z) - B(a.z) * B(b.y), 65536n)),
  y: Number(floorDiv(B(a.z) * B(b.x) - B(a.x) * B(b.z), 65536n)),
  z: Number(floorDiv(B(a.x) * B(b.y) - B(a.y) * B(b.x), 65536n)),
});
const refIsqrt = (n: bigint): bigint => {
  // Bit-by-bit, independent of the Newton iteration under test.
  let r = 0n;
  for (let bit = 1n << 64n; bit > 0n; bit >>= 1n) if ((r + bit) * (r + bit) <= n) r += bit;
  return r;
};
const refLength = (v: V3): number =>
  Number(refIsqrt(B(v.x) * B(v.x) + B(v.y) * B(v.y) + B(v.z) * B(v.z)));
const refMulDiv = (a: number, b: number, d: number): number => Number((B(a) * B(b)) / B(d)); // BigInt division truncates toward zero

// --- Seeded inputs -------------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const EDGES = [
  0,
  1,
  -1,
  65535,
  -65535,
  65536,
  -65536,
  65537,
  1 << 24,
  -(1 << 25),
  (1 << 25) - 1,
  2147483647,
  -2147483648,
  -2147483647,
  0x7fff0000,
  -0x7fff0000,
];

/** Mix of full-range int32, edge values and small "sim-sized" values (a few voxels). */
function int32Gen(seed: number): () => number {
  const r = rng(seed);
  return () => {
    const k = r() % 4;
    if (k === 0) return EDGES[r() % EDGES.length] ?? 0;
    if (k === 1) return (r() % (1 << 26)) - (1 << 25); // up to 512 voxels
    return r() | 0; // full int32
  };
}

const N = 10000;

function vecs(seed: number): V3[] {
  const g = int32Gen(seed);
  return Array.from({ length: N }, () => v3(g(), g(), g()));
}

/** Small vectors whose cross product and scaled results stay in int32. */
function smallVecs(seed: number, bits: number): V3[] {
  const r = rng(seed);
  const half = 2 ** (bits - 1);
  const c = () => (r() % 2 ** bits) - half;
  return Array.from({ length: N }, () => v3(c(), c(), c()));
}

describe("vec3 multiply paths match a BigInt reference", () => {
  it("mulQ is the exact floor for all int32 pairs", () => {
    const g = int32Gen(1);
    for (let i = 0; i < N * 3; i++) {
      const a = g();
      const b = g();
      expect(mulQ(a, b)).toBe(refMulQ(a, b));
    }
    for (const a of EDGES) for (const b of EDGES) expect(mulQ(a, b)).toBe(refMulQ(a, b));
  });

  it("dot is exact where a float dot loses bits", () => {
    const as = vecs(2);
    const bs = vecs(3);
    let naiveWrong = 0;
    for (let i = 0; i < N; i++) {
      const a = as[i] as V3;
      const b = bs[i] as V3;
      const want = refDot(a, b);
      expect(dot(a, b)).toBe(want);
      const naive = Math.floor((a.x * b.x + a.y * b.y + a.z * b.z) / 65536);
      if (naive !== want) naiveWrong++;
    }
    // The point of this module: the obvious float version is wrong on some of these inputs.
    expect(naiveWrong).toBeGreaterThan(0);
  });

  it("lengthSq is exact", () => {
    for (const v of vecs(4)) expect(lengthSq(v)).toBe(refDot(v, v));
  });

  it("length is the exact floor on both the fast and the BigInt path", () => {
    for (const v of vecs(5)) expect(length(v)).toBe(refLength(v));
    for (const v of smallVecs(6, 26)) expect(length(v)).toBe(refLength(v));
    const max = v3(-2147483648, -2147483648, -2147483648);
    expect(length(max)).toBe(refLength(max));
    // Perfect squares and their neighbours, where an off-by-one would show.
    for (const k of [3, 4, 5, 12, 13, 84, 85, 1 << 24, (1 << 25) - 1, 1 << 25]) {
      const v = v3(k * 3, k * 4, k * 12); // length 13k
      expect(length(v)).toBe(13 * k);
      expect(length(v3(k * 3 + 1, k * 4, k * 12))).toBe(refLength(v3(k * 3 + 1, k * 4, k * 12)));
    }
  });

  it("cross is exact", () => {
    const as = smallVecs(7, 31);
    const bs = smallVecs(8, 17);
    for (let i = 0; i < N; i++) {
      const a = as[i] as V3;
      const b = bs[i] as V3;
      expect(cross(a, b)).toEqual(refCross(a, b));
    }
    const ws = smallVecs(9, 24);
    for (let i = 0; i + 1 < N; i++) {
      const a = ws[i] as V3;
      const b = ws[i + 1] as V3;
      expect(cross(a, b)).toEqual(refCross(a, b));
    }
  });

  it("mulDiv truncates exactly on both the float and the BigInt path", () => {
    const g = int32Gen(10);
    for (let i = 0; i < N * 3; i++) {
      const a = g();
      const b = g();
      const d = g() || 1;
      expect(mulDiv(a, b, d)).toBe(refMulDiv(a, b, d));
    }
    expect(() => mulDiv(1, 1, 0)).toThrow(RangeError);
  });

  it("scale floors each component exactly", () => {
    const vs = smallVecs(11, 30);
    const g = int32Gen(12);
    for (const v of vs) {
      const s = g() % 65536; // keep the result in int32
      expect(scale(v, s)).toEqual(v3(refMulQ(v.x, s), refMulQ(v.y, s), refMulQ(v.z, s)));
    }
  });

  it("withLength and normalize match trunc(c * target / length)", () => {
    for (const v of vecs(13)) {
      const len = refLength(v);
      const n = normalize(v);
      if (len === 0) {
        expect(n).toEqual(v3(0, 0, 0));
        continue;
      }
      expect(n).toEqual(
        v3(refMulDiv(v.x, 65536, len), refMulDiv(v.y, 65536, len), refMulDiv(v.z, 65536, len)),
      );
      // A unit vector is at most one unit short of 1.0 per component's truncation.
      expect(length(n)).toBeLessThanOrEqual(65536);
      expect(length(n)).toBeGreaterThan(65536 - 4);
    }
    const speed = 5 * 65536;
    for (const v of smallVecs(14, 26)) {
      const len = refLength(v);
      if (len === 0) continue;
      expect(withLength(v, speed)).toEqual(
        v3(refMulDiv(v.x, speed, len), refMulDiv(v.y, speed, len), refMulDiv(v.z, speed, len)),
      );
    }
  });

  it("reflect is exact, including when 2 (v . n) leaves int32", () => {
    const vs = smallVecs(15, 31);
    const ns = vecs(16).map(normalize);
    for (let i = 0; i < N; i++) {
      const v = vs[i] as V3;
      const n = ns[i] as V3;
      const d2 = 2n * B(refDot(v, n));
      const want = v3(
        v.x - Number(floorDiv(B(n.x) * d2, 65536n)),
        v.y - Number(floorDiv(B(n.y) * d2, 65536n)),
        v.z - Number(floorDiv(B(n.z) * d2, 65536n)),
      );
      const fits = [want.x, want.y, want.z].every((c) => c >= -2147483648 && c <= 2147483647);
      if (fits) expect(reflect(v, n)).toEqual(want);
      else expect(() => reflect(v, n)).toThrow(RangeError);
    }
    // A ball falling straight down onto flat ground bounces straight up.
    expect(reflect(v3(0, -3 * 65536, 0), v3(0, 65536, 0))).toEqual(v3(0, 3 * 65536, 0));
  });

  it("never returns -0", () => {
    const vals = [
      mulQ(0, -5),
      mulQ(-5, 0),
      dot(v3(0, 0, 0), v3(-1, -1, -1)),
      mulDiv(0, -3, 7),
      sinYaw(512),
      sinPitch(180),
      ...Object.values(normalize(v3(0, -5, 0))),
      ...Object.values(cross(v3(0, 0, 0), v3(-1, -2, -3))),
    ];
    for (const x of vals) expect(Object.is(x, -0)).toBe(false);
  });
});

describe("vec3 add/sub and int32 guard", () => {
  it("adds and subtracts, and throws instead of wrapping", () => {
    expect(add(v3(1, 2, 3), v3(4, 5, 6))).toEqual(v3(5, 7, 9));
    expect(sub(v3(1, 2, 3), v3(4, 5, 6))).toEqual(v3(-3, -3, -3));
    expect(() => add(v3(2147483647, 0, 0), v3(1, 0, 0))).toThrow(RangeError);
    expect(i32(-2147483648)).toBe(-2147483648);
    expect(() => i32(0.5)).toThrow(RangeError);
  });
});

describe("angle tables", () => {
  // Tests may use Math.sin: it only checks the BigInt-built tables, which are what the sim uses.
  it("yaw sine is correctly rounded for every step", () => {
    for (let k = 0; k < 1024; k++) {
      const want = Math.round(Math.sin((2 * Math.PI * k) / 1024) * 65536);
      expect(Math.abs(sinYaw(k) - want)).toBeLessThanOrEqual(0); // exact
      expect(cosYaw(k)).toBe(sinYaw(k + 256));
    }
    expect([sinYaw(0), sinYaw(256), sinYaw(512), sinYaw(768)]).toEqual([0, 65536, 0, -65536]);
    expect(sinYaw(-1)).toBe(sinYaw(1023));
    expect(sinYaw(1024 + 5)).toBe(sinYaw(5));
  });

  it("pitch sine is correctly rounded for every whole degree", () => {
    for (let d = -180; d <= 180; d++) {
      const want = Math.round(Math.sin((Math.PI * d) / 180) * 65536);
      expect(sinPitch(d)).toBe(want === 0 ? 0 : want);
      expect(cosPitch(d)).toBe(sinPitch(d + 90));
    }
  });

  it("aim directions are unit length within rounding", () => {
    for (let yaw = 0; yaw < 1024; yaw += 7) {
      expect(Math.abs(length(yawDir(yaw)) - 65536)).toBeLessThanOrEqual(2);
      for (let p = -89; p <= 89; p += 11) {
        expect(Math.abs(length(aimDir(yaw, p)) - 65536)).toBeLessThanOrEqual(3);
      }
    }
    expect(aimDir(0, 0)).toEqual(v3(65536, 0, 0));
    expect(aimDir(256, 0)).toEqual(v3(0, 0, 65536));
    expect(aimDir(0, 90)).toEqual(v3(0, 65536, 0));
  });
});
