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

/** Q16.16 divide, truncating toward zero. Throws on division by zero. */
export function fdiv(a: Fixed, b: Fixed): Fixed {
  if (b === 0) throw new RangeError("fdiv: division by zero");
  return Math.trunc((a * FIXED_ONE) / b) | 0;
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
