import type { Terrain } from "@burrow-brawl/shared";
import { materialAt } from "@burrow-brawl/shared";

/**
 * Marching squares over the binary terrain mask. A square's corners are four
 * neighbouring cells: a = top-left, b = top-right, c = bottom-right, d = bottom-left.
 * Case index = a*8 + b*4 + c*2 + d. Vertices sit on edge midpoints (the mask is
 * binary, so no interpolation is needed and contours stay stable).
 * A chunk owns the squares whose origin lies inside it, so it samples one cell
 * right/down of its own area; neighbours never overlap or leave gaps.
 */

type P = readonly [number, number];
const TL: P = [0, 0];
const TR: P = [1, 0];
const BR: P = [1, 1];
const BL: P = [0, 1];
const T: P = [0.5, 0];
const R: P = [1, 0.5];
const B: P = [0.5, 1];
const L: P = [0, 0.5];

/** Convex solid polygons per case (counter-clockwise on screen with +y down is irrelevant; fan-triangulated). */
export const SQUARE_POLYGONS: ReadonlyArray<ReadonlyArray<ReadonlyArray<P>>> = [
  [],
  [[BL, L, B]],
  [[B, BR, R]],
  [[L, R, BR, BL]],
  [[T, TR, R]],
  [
    [T, TR, R],
    [L, B, BL],
  ],
  [[T, TR, BR, B]],
  [[T, TR, BR, BL, L]],
  [[TL, T, L]],
  [[TL, T, B, BL]],
  [
    [TL, T, L],
    [B, BR, R],
  ],
  [[TL, T, R, BR, BL]],
  [[TL, TR, R, L]],
  [[TL, TR, R, B, BL]],
  [[TL, TR, BR, B, L]],
  [[TL, TR, BR, BL]],
];

/** Contour segments per case (between edge midpoints). */
export const SQUARE_SEGMENTS: ReadonlyArray<ReadonlyArray<readonly [P, P]>> = [
  [],
  [[L, B]],
  [[B, R]],
  [[L, R]],
  [[T, R]],
  [
    [T, R],
    [L, B],
  ],
  [[T, B]],
  [[T, L]],
  [[T, L]],
  [[T, B]],
  [
    [T, L],
    [B, R],
  ],
  [[T, R]],
  [[L, R]],
  [[B, R]],
  [[L, B]],
  [],
];

export interface ChunkGeometry {
  /** Triangle vertex xy pairs in mask space (+y down). 6 numbers per triangle. */
  fill: number[];
  /** One material id per triangle. */
  fillMaterial: number[];
  /** Contour segments as x0,y0,x1,y1 in mask space. */
  edges: number[];
}

/** Mask-space case for the square whose top-left corner is cell (x, y). */
export function squareCase(t: Terrain, x: number, y: number): number {
  return (
    (materialAt(t, x, y) !== 0 ? 8 : 0) |
    (materialAt(t, x + 1, y) !== 0 ? 4 : 0) |
    (materialAt(t, x + 1, y + 1) !== 0 ? 2 : 0) |
    (materialAt(t, x, y + 1) !== 0 ? 1 : 0)
  );
}

/** Material that colours a square: the first solid corner (a, b, c, d). */
function squareMaterial(t: Terrain, x: number, y: number): number {
  return (
    materialAt(t, x, y) ||
    materialAt(t, x + 1, y) ||
    materialAt(t, x + 1, y + 1) ||
    materialAt(t, x, y + 1)
  );
}

export function marchChunk(t: Terrain, cx: number, cy: number): ChunkGeometry {
  const out: ChunkGeometry = { fill: [], fillMaterial: [], edges: [] };
  const x0 = cx * t.chunkSize;
  const y0 = cy * t.chunkSize;
  const x1 = Math.min(t.width, x0 + t.chunkSize);
  const y1 = Math.min(t.height, y0 + t.chunkSize);

  for (let y = y0; y < y1; y++) {
    let x = x0;
    while (x < x1) {
      const c = squareCase(t, x, y);
      if (c === 0) {
        x++;
        continue;
      }
      if (c === 15) {
        // Merge a horizontal run of full squares of one material into one quad.
        const m = squareMaterial(t, x, y);
        let end = x + 1;
        while (end < x1 && squareCase(t, end, y) === 15 && squareMaterial(t, end, y) === m) end++;
        out.fill.push(x, y, end, y, end, y + 1, x, y, end, y + 1, x, y + 1);
        out.fillMaterial.push(m, m);
        x = end;
        continue;
      }
      const m = squareMaterial(t, x, y);
      for (const poly of SQUARE_POLYGONS[c] ?? []) {
        for (let i = 1; i < poly.length - 1; i++) {
          const a = poly[0]!;
          const b = poly[i]!;
          const d = poly[i + 1]!;
          out.fill.push(x + a[0], y + a[1], x + b[0], y + b[1], x + d[0], y + d[1]);
          out.fillMaterial.push(m);
        }
      }
      for (const [p, q] of SQUARE_SEGMENTS[c] ?? []) {
        out.edges.push(x + p[0], y + p[1], x + q[0], y + q[1]);
      }
      x++;
    }
  }
  return out;
}

/** Total triangle area (mask units squared). Used by tests. */
export function fillArea(g: ChunkGeometry): number {
  let area = 0;
  for (let i = 0; i < g.fill.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = g.fill.slice(i, i + 6) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  }
  return area;
}
