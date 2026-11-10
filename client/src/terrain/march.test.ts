import { carveCircle, createDemoTerrain, createTerrain, DIRT } from "@burrow-brawl/shared";
import { describe, expect, it } from "vitest";
import { fillArea, marchChunk, SQUARE_POLYGONS, SQUARE_SEGMENTS, squareCase } from "./march";

const EXPECTED_AREA = [
  0, 0.125, 0.125, 0.5, 0.125, 0.25, 0.5, 0.875, 0.125, 0.5, 0.25, 0.875, 0.5, 0.875, 0.875, 1,
];
const EXPECTED_SEGMENTS = [0, 1, 1, 1, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1, 1, 0];

function polyArea(poly: ReadonlyArray<readonly [number, number]>): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

describe("marching squares tables", () => {
  it.each(EXPECTED_AREA.map((a, i) => [i, a] as const))(
    "case %i has the right solid area",
    (c, area) => {
      const total = SQUARE_POLYGONS[c]!.reduce((s, p) => s + polyArea(p), 0);
      expect(total).toBeCloseTo(area, 10);
    },
  );

  it.each(EXPECTED_SEGMENTS.map((n, i) => [i, n] as const))("case %i has %i segments", (c, n) => {
    expect(SQUARE_SEGMENTS[c]).toHaveLength(n);
  });
});

/** Slow reference: sum of per-square table areas with no run merging. */
function referenceArea(t: ReturnType<typeof createTerrain>): number {
  let a = 0;
  for (let y = 0; y < t.height; y++) {
    for (let x = 0; x < t.width; x++) a += EXPECTED_AREA[squareCase(t, x, y)]!;
  }
  return a;
}

describe("marchChunk", () => {
  it("returns nothing for an empty chunk", () => {
    const t = createTerrain(32, 32, 16);
    const g = marchChunk(t, 0, 0);
    expect(g.fill).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });

  it("merges full squares without changing area, and only emits the border as edges", () => {
    const t = createTerrain(24, 24, 24);
    for (let y = 4; y < 20; y++) for (let x = 4; x < 20; x++) t.cells[y * 24 + x] = DIRT;
    const g = marchChunk(t, 0, 0);
    expect(fillArea(g)).toBeCloseTo(referenceArea(t), 10);
    // Perimeter contour only: 4 sides of 15 straight segments + 4 corner cuts.
    expect(g.edges.length / 4).toBe(4 * 15 + 4);
    // Merged: far fewer triangles than one pair per full square.
    expect(g.fill.length / 6).toBeLessThan(15 * 15 * 2);
  });

  it("chunk areas sum to the whole-map area on a carved demo map", () => {
    const t = createDemoTerrain(160, 96);
    carveCircle(t, 80, 60, 20);
    let sum = 0;
    for (let cy = 0; cy < t.chunksY; cy++)
      for (let cx = 0; cx < t.chunksX; cx++) sum += fillArea(marchChunk(t, cx, cy));
    expect(sum).toBeCloseTo(referenceArea(t), 6);
  });
});
