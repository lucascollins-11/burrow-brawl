/**
 * Exact Q16.16 3D vector math for sim3d.
 *
 * Components are Q16.16 values in int32 range (see ../fixed). A product of two Q16.16 values needs
 * up to 62 bits and a 3D dot product up to 64, but a JS number only holds 53 bits exactly, so the
 * naive `(a * b) / 65536` silently drops low bits once values grow. Every helper here either
 * splits one operand into 16-bit halves so each partial product stays under 2^48, or falls back
 * to BigInt. Results are exact (floor or trunc, as documented), identical on every engine, and
 * property-tested against a BigInt reference in vec3.test.ts.
 *
 * Results are plain numbers and are NOT wrapped to int32: a dot product or squared length can
 * legitimately exceed it. Use `i32` where a value goes back into state, so overflow throws
 * instead of wrapping.
 */

import type { Fixed } from "../fixed";
import { FIXED_ONE, idiv, isqrt } from "../fixed";
import { YAW_STEPS, type Vec3 } from "./api";

type V3 = Vec3;

export const V3_ZERO: V3 = { x: 0, y: 0, z: 0 };

export function v3(x: Fixed, y: Fixed, z: Fixed): V3 {
  return { x, y, z };
}

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/** Return n unchanged if it is an int32, else throw. Use before storing a computed value in state. */
export function i32(n: number): number {
  if (!Number.isInteger(n) || n < INT32_MIN || n > INT32_MAX)
    throw new RangeError(`i32: ${n} is not an int32`);
  return n;
}

/**
 * floor(a * b / 2^16) for int32 Q16.16 a and b, exact. a = hi * 2^16 + lo with lo in [0, 2^16),
 * so both partial products are below 2^47 and the floor only touches the fractional part.
 */
export function mulQ(a: Fixed, b: Fixed): number {
  // `|| 0` turns -0 (e.g. 0 * -5) into 0, so hashes and Object.is comparisons never see it.
  return (a >> 16) * b + Math.floor(((a & 0xffff) * b) / FIXED_ONE) || 0;
}

/** floor(a * b / 2^16) for any safe integers, exact (BigInt when the product passes 2^52). */
function mulQWide(a: number, b: number): number {
  if (Math.abs(a) * Math.abs(b) < 4503599627370496) return Math.floor((a * b) / FIXED_ONE) || 0;
  return Number(floorDivBig(BigInt(a) * BigInt(b), 65536n));
}

function floorDivBig(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d !== 0n && n < 0n !== d < 0n ? q - 1n : q;
}

/** floor((a1*b1 + a2*b2 + a3*b3) / 2^16), exact. Partial sums stay below 2^49. */
function sum3Q(a1: Fixed, b1: number, a2: Fixed, b2: number, a3: Fixed, b3: number): number {
  const hi = (a1 >> 16) * b1 + (a2 >> 16) * b2 + (a3 >> 16) * b3;
  const lo = (a1 & 0xffff) * b1 + (a2 & 0xffff) * b2 + (a3 & 0xffff) * b3;
  return hi + Math.floor(lo / FIXED_ONE) || 0;
}

/** floor((a1*b1 - a2*b2) / 2^16), exact. */
function diff2Q(a1: Fixed, b1: Fixed, a2: Fixed, b2: Fixed): number {
  return sum3Q(a1, b1, a2, -b2, 0, 0);
}

/**
 * trunc(a * b / d) for safe integers a, b and non-zero d, exact. Uses doubles when the product is
 * certainly safe and BigInt otherwise. The building block for "scale a by the ratio b / d".
 */
export function mulDiv(a: number, b: number, d: number): number {
  if (d === 0) throw new RangeError("mulDiv: division by zero");
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(d))
    throw new RangeError("mulDiv: need safe integers");
  const p = Math.abs(a) * Math.abs(b);
  // p is a correctly rounded double, so p < 2^52 means the true product is below 2^53.
  if (p < 4503599627370496) return idiv(a * b, d) || 0;
  return Number((BigInt(a) * BigInt(b)) / BigInt(d));
}

export function add(a: V3, b: V3): V3 {
  return { x: i32(a.x + b.x), y: i32(a.y + b.y), z: i32(a.z + b.z) };
}

export function sub(a: V3, b: V3): V3 {
  return { x: i32(a.x - b.x), y: i32(a.y - b.y), z: i32(a.z - b.z) };
}

/** v * s for a Q16.16 scalar s, each component floored. */
export function scale(v: V3, s: Fixed): V3 {
  return { x: i32(mulQ(v.x, s)), y: i32(mulQ(v.y, s)), z: i32(mulQ(v.z, s)) };
}

/** Dot product in Q16.16, floored. Exact even when the true value needs 64 bits; may exceed int32. */
export function dot(a: V3, b: V3): number {
  return sum3Q(a.x, b.x, a.y, b.y, a.z, b.z);
}

/** Squared length in Q16.16, floored. May exceed int32. */
export function lengthSq(v: V3): number {
  return dot(v, v);
}

/** Cross product in Q16.16, each component floored. */
export function cross(a: V3, b: V3): V3 {
  return {
    x: i32(diff2Q(a.y, b.z, a.z, b.y)),
    y: i32(diff2Q(a.z, b.x, a.x, b.z)),
    z: i32(diff2Q(a.x, b.y, a.y, b.x)),
  };
}

/** Below this magnitude, x^2 + y^2 + z^2 < 3 * 2^50 is a safe integer. */
const SAFE_COMPONENT = 1 << 25;

function bigIsqrt(n: bigint): bigint {
  if (n < 2n) return n;
  // Newton from a power of two above the root; decreases monotonically to floor(sqrt(n)).
  let x = 1n << BigInt((n.toString(2).length >> 1) + 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/**
 * Length in Q16.16, floored: floor(sqrt(x^2 + y^2 + z^2)) on the raw values, which is exactly the
 * Q16.16 length. Fast path for components below 2^25 (512 voxels); BigInt beyond that.
 */
export function length(v: V3): number {
  const { x, y, z } = v;
  if (
    x < SAFE_COMPONENT &&
    x > -SAFE_COMPONENT &&
    y < SAFE_COMPONENT &&
    y > -SAFE_COMPONENT &&
    z < SAFE_COMPONENT &&
    z > -SAFE_COMPONENT
  )
    return isqrt(x * x + y * y + z * z);
  const bx = BigInt(x);
  const by = BigInt(y);
  const bz = BigInt(z);
  return Number(bigIsqrt(bx * bx + by * by + bz * bz));
}

/**
 * v scaled to length `target` (Q16.16), each component truncated toward zero. The zero vector
 * stays zero. normalize(v) is withLength(v, FIXED_ONE).
 */
export function withLength(v: V3, target: Fixed): V3 {
  const len = length(v);
  if (len === 0) return V3_ZERO;
  return {
    x: i32(mulDiv(v.x, target, len)),
    y: i32(mulDiv(v.y, target, len)),
    z: i32(mulDiv(v.z, target, len)),
  };
}

/** Unit vector (Q16.16) in the direction of v, truncated; zero for the zero vector. */
export function normalize(v: V3): V3 {
  return withLength(v, FIXED_ONE);
}

/**
 * Reflect v off a surface with unit normal n: v - 2 (v . n) n. n need not be exactly unit (it is
 * usually a normalized density gradient); the result is floored per component.
 */
export function reflect(v: V3, n: V3): V3 {
  // 2 (v . n) can leave int32 for large v, so the second multiply goes through mulQWide.
  const d2 = 2 * dot(v, n);
  return {
    x: i32(v.x - mulQWide(n.x, d2)),
    y: i32(v.y - mulQWide(n.y, d2)),
    z: i32(v.z - mulQWide(n.z, d2)),
  };
}

// --- Angles --------------------------------------------------------------------------------------
// Yaw is 0..1023 per full turn (0 = +x, 256 = +z) and pitch is whole degrees (0 = level, + = up),
// per the sim3d contract. Both tables are built once with BigInt fixed-point Taylor series in
// 64-bit precision and rounded to Q16.16, so they are exact to the last bit on every engine.

const YAW_QUARTER = YAW_STEPS / 4;

/** round(pi * 2^64). */
const PI_Q64 = 57952155664616982739n;
const Q64 = 1n << 64n;

/** sin(PI_Q64 * num / den / 2^64) rounded to Q16.16, for angles in [0, pi/2]. */
function sinQ16(num: number, den: number): Fixed {
  const x = (PI_Q64 * BigInt(num)) / BigInt(den);
  const x2 = (x * x) / Q64;
  let term = x;
  let sum = x;
  for (let k = 1; term !== 0n; k++) {
    term = -(term * x2) / Q64 / BigInt(2 * k * (2 * k + 1));
    sum += term;
  }
  return Number((sum + (1n << 47n)) >> 48n);
}

const YAW_SIN: readonly Fixed[] = Array.from({ length: YAW_QUARTER + 1 }, (_, k) =>
  sinQ16(k, 2 * YAW_QUARTER),
);
const DEG_SIN: readonly Fixed[] = Array.from({ length: 91 }, (_, d) => sinQ16(d, 180));

function quarterWave(table: readonly Fixed[], quarter: number, a: number): Fixed {
  const full = quarter * 4;
  const t = ((Math.trunc(a) % full) + full) % full;
  if (t <= quarter) return table[t] ?? 0;
  if (t <= 2 * quarter) return table[2 * quarter - t] ?? 0;
  // 0 - x rather than -x, so sin(180) is 0 and not -0.
  if (t <= 3 * quarter) return 0 - (table[t - 2 * quarter] ?? 0);
  return 0 - (table[full - t] ?? 0);
}

/** Sine of a yaw in 1/1024 turns, Q16.16. Any integer is accepted and wrapped. */
export function sinYaw(yaw: number): Fixed {
  return quarterWave(YAW_SIN, YAW_QUARTER, yaw);
}

export function cosYaw(yaw: number): Fixed {
  return quarterWave(YAW_SIN, YAW_QUARTER, yaw + YAW_QUARTER);
}

/** Sine of a whole number of degrees, Q16.16 (correctly rounded, unlike the 2D sinDeg). */
export function sinPitch(deg: number): Fixed {
  return quarterWave(DEG_SIN, 90, deg);
}

export function cosPitch(deg: number): Fixed {
  return quarterWave(DEG_SIN, 90, deg + 90);
}

/** Horizontal unit heading for a yaw: (cos, 0, sin). */
export function yawDir(yaw: number): V3 {
  return { x: cosYaw(yaw), y: 0, z: sinYaw(yaw) };
}

/** Unit aim direction for a yaw and a pitch: (cos y cos p, sin p, sin y cos p), floored. */
export function aimDir(yaw: number, pitch: number): V3 {
  const cp = cosPitch(pitch);
  return { x: mulQ(cosYaw(yaw), cp), y: sinPitch(pitch), z: mulQ(sinYaw(yaw), cp) };
}
