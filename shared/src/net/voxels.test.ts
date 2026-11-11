import { describe, expect, it } from "vitest";
import {
  base64Decode,
  base64Encode,
  base64EncodePortable,
  decodeVoxels,
  encodeVoxels,
  rleEncode,
} from "./voxels";

describe("voxel encoding", () => {
  it("base64 matches Node's Buffer for every length mod 3", () => {
    for (let n = 0; n < 40; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n) & 255);
      const want = Buffer.from(b).toString("base64");
      expect(base64Encode(b)).toBe(want);
      expect(base64EncodePortable(b)).toBe(want);
      expect(Array.from(base64Decode(want))).toEqual(Array.from(b));
    }
  });

  it("run-length pairs are [count - 1, value] and split at 256", () => {
    const b = new Uint8Array(300).fill(255);
    b.fill(7, 290);
    expect(Array.from(rleEncode(b))).toEqual([255, 255, 33, 255, 9, 7]);
    expect(Array.from(rleEncode(new Uint8Array(0)))).toEqual([]);
  });

  it("round-trips a terrain-like grid and stays small", () => {
    const n = 64 * 32 * 64;
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = i < n / 2 ? 255 : i % 977 === 0 ? 140 : 0;
    const s = encodeVoxels(b);
    expect(s.length).toBeLessThan(n / 20);
    expect(decodeVoxels(s, n)).toEqual(b);
  });

  it("rejects a payload whose size does not match the box", () => {
    const s = encodeVoxels(new Uint8Array(10).fill(3));
    expect(() => decodeVoxels(s, 9)).toThrow();
    expect(() => decodeVoxels(s, 11)).toThrow();
    expect(() => decodeVoxels("abc", 3)).toThrow();
    expect(() => decodeVoxels("****", 3)).toThrow();
  });
});
