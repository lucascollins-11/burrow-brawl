// Incremental 32-bit FNV-1a for state hashes (protocol.md section 7). Every
// writer is integer-only: floats in sim state are a determinism bug, so the
// canonical hasher refuses them instead of hashing their bytes.

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export class StateHasher {
  private h = FNV_OFFSET;

  /** Hash of everything written so far (u32). */
  digest(): number {
    return this.h >>> 0;
  }

  u8(v: number): this {
    this.h = Math.imul(this.h ^ (v & 0xff), FNV_PRIME);
    return this;
  }

  /** Any 32-bit integer (signed or unsigned); written as 4 little-endian bytes. */
  i32(v: number): this {
    if (!Number.isInteger(v) || v < -0x8000_0000 || v > 0xffff_ffff) {
      throw new RangeError(`i32 out of range: ${v}`);
    }
    return this.u8(v)
      .u8(v >>> 8)
      .u8(v >>> 16)
      .u8(v >>> 24);
  }

  /** Safe integer up to 2^53, written as two 32-bit words. */
  int(v: number): this {
    if (!Number.isSafeInteger(v)) throw new RangeError(`not a safe integer: ${v}`);
    const lo = v % 0x1_0000_0000;
    const hi = Math.floor(v / 0x1_0000_0000);
    return this.i32(lo < 0 ? lo + 0x1_0000_0000 : lo).i32(hi | 0);
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }

  /** Length-prefixed UTF-16 code units (no locale, no normalization). */
  str(s: string): this {
    this.i32(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.u8(c).u8(c >>> 8);
    }
    return this;
  }

  bytes(b: Uint8Array): this {
    this.i32(b.length);
    for (let i = 0; i < b.length; i++) this.h = Math.imul(this.h ^ b[i]!, FNV_PRIME);
    return this;
  }

  /**
   * Hash a plain value canonically: object keys sorted, arrays in order,
   * typed arrays by bytes. Only integers, strings, booleans, null, arrays,
   * plain objects and integer typed arrays are allowed. Throws with the path
   * on anything else (floats, NaN, undefined, functions, Maps).
   */
  value(v: unknown, path = "$"): this {
    if (v === null) return this.u8(0);
    switch (typeof v) {
      case "boolean":
        return this.u8(1).bool(v);
      case "number":
        if (!Number.isSafeInteger(v)) {
          throw new TypeError(
            `non-integer number at ${path}: ${v} (sim state must be integer/fixed-point)`,
          );
        }
        return this.u8(2).int(v);
      case "string":
        return this.u8(3).str(v);
      case "object":
        break;
      default:
        throw new TypeError(`unhashable ${typeof v} at ${path}`);
    }
    if (Array.isArray(v)) {
      this.u8(4).i32(v.length);
      v.forEach((x, i) => this.value(x, `${path}[${i}]`));
      return this;
    }
    if (v instanceof Uint8Array || v instanceof Int8Array || v instanceof Uint8ClampedArray) {
      return this.u8(5).bytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    }
    if (
      v instanceof Uint16Array ||
      v instanceof Int16Array ||
      v instanceof Uint32Array ||
      v instanceof Int32Array
    ) {
      this.u8(6).u8(v.BYTES_PER_ELEMENT).i32(v.length);
      for (let i = 0; i < v.length; i++) this.i32(v[i]!);
      return this;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`unhashable ${proto?.constructor?.name ?? "object"} at ${path}`);
    }
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    this.u8(7).i32(keys.length);
    for (const k of keys) {
      this.str(k);
      this.value(obj[k], `${path}.${k}`);
    }
    return this;
  }
}

/** One-shot canonical hash of a plain value. */
export function hashValue(v: unknown): number {
  return new StateHasher().value(v).digest();
}
