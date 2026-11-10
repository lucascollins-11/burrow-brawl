/**
 * Q16.16 fixed-point helpers stored in plain JS numbers holding int32 values.
 * All game-state math in /shared uses these (or plain integers) so results are
 * identical on every platform. Float conversions are for rendering/UI only.
 */

export type Fixed = number;

export const FIXED_SHIFT = 16;
export const FIXED_ONE: Fixed = 1 << FIXED_SHIFT;
export const FIXED_HALF: Fixed = FIXED_ONE >> 1;

/** Convert a float (or integer) to Q16.16, rounding to nearest. */
export function toFixed(n: number): Fixed {
  return Math.round(n * FIXED_ONE) | 0;
}

/** Convert Q16.16 to a float. For rendering and debugging only. */
export function fromFixed(f: Fixed): number {
  return f / FIXED_ONE;
}

/** Q16.16 multiply. Exact in doubles, wraps like int32 on overflow. */
export function fmul(a: Fixed, b: Fixed): Fixed {
  return ((a >> FIXED_SHIFT) * b + Math.floor(((a & 0xffff) * b) / FIXED_ONE)) | 0;
}

/**
 * Exact integer division truncating toward zero, for safe integers. The float quotient is only a
 * first guess; it is corrected with integer multiplication so rounding can never change the result.
 */
export function idiv(a: number, b: number): number {
  if (b === 0) throw new RangeError("idiv: division by zero");
  const sign = a < 0 !== b < 0 ? -1 : 1;
  const absA = Math.abs(a);
  const absB = Math.abs(b);
  let q = Math.trunc(absA / absB);
  while (q * absB > absA) q--;
  while ((q + 1) * absB <= absA) q++;
  return sign * q;
}

/** Q16.16 divide, truncating toward zero. Throws on division by zero. */
export function fdiv(a: Fixed, b: Fixed): Fixed {
  if (b === 0) throw new RangeError("fdiv: division by zero");
  return idiv(a * FIXED_ONE, b) | 0;
}

/** Floor of the square root of a non-negative safe integer. */
export function isqrt(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError("isqrt: need a non-negative safe integer");
  let r = Math.floor(Math.sqrt(n));
  // sqrt is correctly rounded in IEEE-754, but guard the edges anyway.
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** Q16.16 square root of a non-negative Q16.16 value. */
export function fsqrt(f: Fixed): Fixed {
  if (f < 0) throw new RangeError("fsqrt: negative input");
  return isqrt(f * FIXED_ONE) | 0;
}

export function fabs(f: Fixed): Fixed {
  return f < 0 ? -f | 0 : f;
}

// Deterministic trig. Math.sin/cos are not guaranteed bit-identical across JS engines, so the
// table is built once with a fixed-point Taylor series using only integer-exact operations.

const DEG_TO_RAD: Fixed = 1144; // pi / 180 in Q16.16

function taylorSin(x: Fixed): Fixed {
  const x2 = fmul(x, x);
  let term = x;
  let sum = x;
  const divisors = [6, 20, 42, 72]; // successive x^2 / ((2k)(2k+1)) terms
  for (let k = 0; k < divisors.length; k++) {
    term = Math.trunc(fmul(term, x2) / (divisors[k] ?? 1)) | 0;
    sum += k % 2 === 0 ? -term : term;
  }
  return sum | 0;
}

const SIN_TABLE: readonly Fixed[] = Array.from({ length: 91 }, (_, d) =>
  d === 0 ? 0 : d === 90 ? FIXED_ONE : taylorSin(d * DEG_TO_RAD),
);

/** Sine of an integer number of degrees, Q16.16. */
export function sinDeg(deg: number): Fixed {
  const d = (((Math.trunc(deg) % 360) + 360) % 360) | 0;
  if (d <= 90) return SIN_TABLE[d] ?? 0;
  if (d <= 180) return SIN_TABLE[180 - d] ?? 0;
  if (d <= 270) return -(SIN_TABLE[d - 180] ?? 0) | 0;
  return -(SIN_TABLE[360 - d] ?? 0) | 0;
}

/** Cosine of an integer number of degrees, Q16.16. */
export function cosDeg(deg: number): Fixed {
  return sinDeg(deg + 90);
}
