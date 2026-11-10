// Seeded PRNG for the deterministic sim. sfc32 (Chris Doty-Humphrey's Small
// Fast Counting generator): 128-bit state, all 32-bit integer ops, so it
// gives identical sequences in every JS engine. Never use Math.random in
// /shared.

/**
 * Structural match for the sim's injected `Rng` (shared/src/sim/types.ts).
 * Kept here too so this module doesn't depend on the sim.
 */
export interface RngLike {
  /** Integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
}

/** Serializable generator state: four u32 words. */
export type PrngState = readonly [number, number, number, number];

const U32 = 0x1_0000_0000;

/** splitmix32: spreads a u32 seed into well-mixed words. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** FNV-1a over a label, for deriving named sub-streams. */
function labelHash(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Prng implements RngLike {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  private constructor(a: number, b: number, c: number, d: number) {
    this.a = a >>> 0;
    this.b = b >>> 0;
    this.c = c >>> 0;
    this.d = d >>> 0;
  }

  /** New generator from a u32 seed (non-integers and out-of-range values are rejected). */
  static fromSeed(seed: number): Prng {
    if (!Number.isInteger(seed) || seed < 0 || seed >= U32) {
      throw new RangeError(`seed must be a u32, got ${seed}`);
    }
    const sm = splitmix32(seed);
    const p = new Prng(sm(), sm(), sm(), 1);
    // Warm up so nearby seeds diverge fully.
    for (let i = 0; i < 12; i++) p.nextU32();
    return p;
  }

  static fromState(state: PrngState): Prng {
    if (state.length !== 4 || !state.every((w) => Number.isInteger(w) && w >= 0 && w < U32)) {
      throw new RangeError("bad PRNG state");
    }
    return new Prng(state[0], state[1], state[2], state[3]);
  }

  getState(): PrngState {
    return [this.a, this.b, this.c, this.d];
  }

  clone(): Prng {
    return new Prng(this.a, this.b, this.c, this.d);
  }

  /**
   * Independent stream derived from this one's current state and a label,
   * e.g. `match.fork("wind")`. Does not advance this generator, so adding a
   * new fork doesn't shift existing sequences.
   */
  fork(label: string): Prng {
    const sm = splitmix32((this.a ^ Math.imul(this.d, 0x9e3779b9) ^ labelHash(label)) >>> 0);
    const p = new Prng(sm() ^ this.b, sm() ^ this.c, sm(), 1);
    for (let i = 0; i < 12; i++) p.nextU32();
    return p;
  }

  /** Uniform u32. */
  nextU32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = (this.b ^ (this.b >>> 9)) >>> 0;
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Unbiased integer in [0, maxExclusive), 1 <= maxExclusive <= 2^32. */
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > U32) {
      throw new RangeError(`nextInt bound must be an integer in [1, 2^32], got ${maxExclusive}`);
    }
    if (maxExclusive === 1) return 0;
    // Rejection sampling: drop the top partial bucket.
    const limit = U32 - (U32 % maxExclusive);
    for (;;) {
      const x = this.nextU32();
      if (x < limit) return x % maxExclusive;
    }
  }

  /** Integer in [min, max] inclusive. */
  nextRange(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`bad range [${min}, ${max}]`);
    }
    return min + this.nextInt(max - min + 1);
  }

  /** True with probability num/den (integers, 0 <= num <= den). */
  chance(num: number, den: number): boolean {
    if (!Number.isInteger(num) || !Number.isInteger(den) || den < 1 || num < 0 || num > den) {
      throw new RangeError(`bad chance ${num}/${den}`);
    }
    return this.nextInt(den) < num;
  }

  /** Pick one element. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("pick from empty array");
    return items[this.nextInt(items.length)] as T;
  }

  /** Fisher-Yates shuffle in place; returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }
}
