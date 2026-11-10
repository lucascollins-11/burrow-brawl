import { describe, expect, it } from "vitest";
import { SOLID, generateMap } from "./generate.js";

const sum = (a: Uint8Array) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i]!, 0x01000193);
  return h >>> 0;
};

describe("generateMap v2", () => {
  it("is deterministic and seed-sensitive", () => {
    const a = generateMap({ seed: 7 });
    const b = generateMap({ seed: 7 });
    expect(sum(a.density)).toBe(sum(b.density));
    expect(a.spawns).toEqual(b.spawns);
    expect(sum(generateMap({ seed: 8 }).density)).not.toBe(sum(a.density));
  });

  it("has bedrock, sea-level terrain, and some air", () => {
    const m = generateMap({ seed: 3 });
    expect(m.density.length).toBe(256 * 96 * 256);
    const idx = (x: number, y: number, z: number) => (y * m.depth + z) * m.width + x;
    for (let x = 0; x < 256; x += 17) expect(m.density[idx(x, 0, x)]).toBe(255);
    let solid = 0;
    for (const v of m.density) if (v >= SOLID) solid++;
    expect(solid / m.density.length).toBeGreaterThan(0.1);
    expect(solid / m.density.length).toBeLessThan(0.6);
  });

  it("finds 32 distinct, grounded, roomy spawns for 8 teams x 4 across many seeds", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const m = generateMap({ seed });
      const idx = (x: number, y: number, z: number) => (y * m.depth + z) * m.width + x;
      expect(m.spawns.length, `seed ${seed}`).toBeGreaterThanOrEqual(32);
      const keys = new Set(m.spawns.map((s) => `${s.x},${s.y},${s.z}`));
      expect(keys.size).toBe(m.spawns.length);
      for (const s of m.spawns) {
        expect(m.density[idx(s.x, s.y - 1, s.z)]).toBeGreaterThanOrEqual(SOLID);
        for (let dy = 0; dy < 6; dy++)
          expect(m.density[idx(s.x, s.y + dy, s.z)]).toBeLessThan(SOLID);
        expect(s.y).toBeGreaterThan(m.seaLevel);
      }
    }
  });

  it("works at the other sizes", () => {
    for (const [w, d] of [
      [192, 192],
      [384, 256],
      [320, 384],
    ] as const) {
      const m = generateMap({ seed: 5, width: w, depth: d });
      expect(m.density.length).toBe(w * d * 96);
      expect(m.spawns.length).toBeGreaterThanOrEqual(32);
    }
  });
});
