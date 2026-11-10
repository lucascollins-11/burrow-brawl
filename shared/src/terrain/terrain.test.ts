import { describe, expect, it } from "vitest";
import { FIXED_ONE, fromFixed } from "../fixed";
import {
  AIR,
  BEDROCK,
  DIRT,
  addCircle,
  carveCircle,
  carveRect,
  chunkIndex,
  createDemoTerrain,
  createTerrain,
  deserializeTerrain,
  hashTerrain,
  isSolid,
  raycast,
  serializeTerrain,
  surfaceNormal,
} from "./index";

function solidTerrain(w: number, h: number, cs = 16) {
  const t = createTerrain(w, h, cs);
  t.cells.fill(DIRT);
  t.dirtyChunks.clear();
  return t;
}

describe("carveCircle", () => {
  it("removes exactly the cells within the radius and never bedrock", () => {
    const t = solidTerrain(40, 40);
    for (let x = 0; x < 40; x++) t.cells[20 * 40 + x] = BEDROCK;
    const r = 8;
    const res = carveCircle(t, 20, 20, r);
    let expected = 0;
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const inside = (x - 20) ** 2 + (y - 20) ** 2 <= r * r;
        const v = t.cells[y * 40 + x];
        if (inside && y !== 20) {
          expected++;
          expect(v).toBe(AIR);
        } else if (y === 20) {
          expect(v).toBe(BEDROCK);
        } else {
          expect(v).toBe(DIRT);
        }
      }
    }
    expect(res.cellsRemoved).toBe(expected);
  });

  it("is a no-op outside the map or on air", () => {
    const t = solidTerrain(32, 32);
    const before = hashTerrain(t);
    expect(carveCircle(t, -100, -100, 5)).toEqual({ cellsRemoved: 0, bounds: null });
    expect(hashTerrain(t)).toBe(before);
    expect(t.dirtyChunks.size).toBe(0);
    carveCircle(t, 16, 16, 4);
    t.dirtyChunks.clear();
    expect(carveCircle(t, 16, 16, 4).cellsRemoved).toBe(0);
    expect(t.dirtyChunks.size).toBe(0);
  });

  it("clamps at map edges", () => {
    const t = solidTerrain(32, 32);
    const res = carveCircle(t, 0, 0, 5);
    expect(res.cellsRemoved).toBeGreaterThan(0);
    expect(isSolid(t, 0, 0)).toBe(false);
    expect(isSolid(t, 10, 10)).toBe(true);
  });

  it("dirties the chunks it touches, including neighbours sampled across the border", () => {
    const t = solidTerrain(64, 64, 16);
    carveCircle(t, 8, 8, 2); // well inside chunk (0,0)
    expect([...t.dirtyChunks]).toEqual([chunkIndex(t, 0, 0)]);
    t.dirtyChunks.clear();
    carveCircle(t, 16, 8, 2); // straddles chunk x border at 16
    expect(t.dirtyChunks).toEqual(new Set([chunkIndex(t, 0, 0), chunkIndex(t, 1, 0)]));
  });

  it("bumps chunk versions", () => {
    const t = solidTerrain(32, 32);
    const i = chunkIndex(t, 0, 0);
    const v = t.chunkVersion[i] ?? 0;
    carveCircle(t, 4, 4, 2);
    expect(t.chunkVersion[i]).toBe(v + 1);
  });
});

describe("carveRect / addCircle", () => {
  it("carves rectangles and fills air without overwriting", () => {
    const t = solidTerrain(32, 32);
    expect(carveRect(t, 4, 4, 7, 7).cellsRemoved).toBe(16);
    expect(addCircle(t, 5, 5, 10, DIRT).cellsRemoved).toBe(16);
    expect(isSolid(t, 5, 5)).toBe(true);
  });
});

describe("hash and serialize", () => {
  it("is stable and sequence-sensitive", () => {
    const a = createDemoTerrain(256, 128);
    const b = createDemoTerrain(256, 128);
    expect(hashTerrain(a)).toBe(hashTerrain(b));
    carveCircle(a, 100, 70, 12);
    carveCircle(b, 100, 70, 12);
    expect(hashTerrain(a)).toBe(hashTerrain(b));
    carveCircle(b, 10, 70, 12);
    expect(hashTerrain(a)).not.toBe(hashTerrain(b));
  });

  it("round-trips through RLE", () => {
    const t = createDemoTerrain(300, 120);
    carveCircle(t, 150, 70, 25);
    const data = serializeTerrain(t);
    const back = deserializeTerrain(data);
    expect(back.width).toBe(300);
    expect(back.height).toBe(120);
    expect(hashTerrain(back)).toBe(hashTerrain(t));
    expect(data.byteLength).toBeLessThan(t.cells.length);
  });

  it("rejects malformed data", () => {
    expect(() => deserializeTerrain(new Uint8Array(3))).toThrow();
    const good = serializeTerrain(solidTerrain(8, 8));
    expect(() => deserializeTerrain(good.slice(0, good.length - 5))).toThrow();
  });
});

describe("raycast", () => {
  it("finds the first solid cell on axis-aligned and diagonal lines", () => {
    const t = createTerrain(32, 32);
    carveRect(t, 0, 0, 0, 0);
    for (let y = 20; y < 32; y++) for (let x = 0; x < 32; x++) t.cells[y * 32 + x] = DIRT;
    expect(raycast(t, 5, 0, 5, 31)).toEqual({ hit: true, x: 5, y: 20 });
    expect(raycast(t, 0, 0, 31, 31)).toMatchObject({ hit: true, y: 20 });
    expect(raycast(t, 0, 0, 31, 19)).toMatchObject({ hit: false });
    expect(raycast(t, 5, 25, 5, 25)).toEqual({ hit: true, x: 5, y: 25 });
  });
});

describe("surfaceNormal", () => {
  it("points up on a flat floor", () => {
    const t = createTerrain(40, 40);
    for (let y = 20; y < 40; y++) for (let x = 0; x < 40; x++) t.cells[y * 40 + x] = DIRT;
    const n = surfaceNormal(t, 20, 20);
    expect(n.nx).toBe(0);
    expect(n.ny).toBe(-FIXED_ONE);
  });

  it("is about 45 degrees on a slope", () => {
    const t = createTerrain(60, 60);
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 60; x++) if (y >= x) t.cells[y * 60 + x] = DIRT;
    const n = surfaceNormal(t, 30, 30);
    expect(fromFixed(n.nx)).toBeCloseTo(0.707, 1);
    expect(fromFixed(n.ny)).toBeCloseTo(-0.707, 1);
  });

  it("returns zero for uniform areas", () => {
    const t = solidTerrain(40, 40);
    expect(surfaceNormal(t, 20, 20)).toEqual({ nx: 0, ny: 0 });
  });
});
