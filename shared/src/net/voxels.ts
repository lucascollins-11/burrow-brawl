// Voxel byte encoding for the view protocol (docs/view-protocol.md section 5): run-length pairs
// [count - 1, value], then standard base64 with padding. Pure TS so the server, the three.js
// debug client and tests share one implementation (the Godot client has its own decoder).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export function base64Encode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const n = (a << 16) | (b << 8) | c;
    chunk +=
      ALPHABET[(n >> 18) & 63]! +
      ALPHABET[(n >> 12) & 63]! +
      (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : "=") +
      (i + 2 < bytes.length ? ALPHABET[n & 63]! : "=");
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = "";
    }
  }
  parts.push(chunk);
  return parts.join("");
}

export function base64Decode(s: string): Uint8Array {
  if (s.length % 4 !== 0) throw new Error("base64: length is not a multiple of 4");
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const ch = s.charCodeAt(i + k);
      const isPad = ch === 61 && i + k >= s.length - pad;
      const v = isPad ? 0 : ch < 128 ? LOOKUP[ch]! : -1;
      if (v < 0) throw new Error("base64: bad character");
      n = (n << 6) | v;
    }
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** Run-length pairs [count - 1, value]; one pair covers 1..256 equal bytes. */
export function rleEncode(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const v = bytes[i]!;
    let n = 1;
    while (n < 256 && i + n < bytes.length && bytes[i + n] === v) n++;
    out.push(n - 1, v);
    i += n;
  }
  return Uint8Array.from(out);
}

/** Decode run-length pairs; throws unless they expand to exactly `length` bytes. */
export function rleDecode(pairs: Uint8Array, length: number): Uint8Array {
  if (pairs.length % 2 !== 0) throw new Error("rle: odd number of bytes");
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    const n = pairs[i]! + 1;
    if (o + n > length) throw new Error("rle: more bytes than the box holds");
    out.fill(pairs[i + 1]!, o, o + n);
    o += n;
  }
  if (o !== length) throw new Error(`rle: ${o} bytes, expected ${length}`);
  return out;
}

/** Voxel bytes -> wire string (RLE, then base64). */
export function encodeVoxels(bytes: Uint8Array): string {
  return base64Encode(rleEncode(bytes));
}

/** Wire string -> voxel bytes; throws unless the total is exactly `length`. */
export function decodeVoxels(s: string, length: number): Uint8Array {
  return rleDecode(base64Decode(s), length);
}
