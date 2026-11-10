import { isqrt } from "../fixed";
import { markDirty } from "./terrain";
import type { Bounds, CarveResult, Terrain } from "./types";
import { AIR, BEDROCK } from "./types";

const NOTHING: CarveResult = { cellsRemoved: 0, bounds: null };

function finish(t: Terrain, changed: number, b: Bounds): CarveResult {
  if (changed === 0) return { ...NOTHING };
  markDirty(t, b);
  return { cellsRemoved: changed, bounds: b };
}

/** Remove every non-bedrock cell with (x-cx)^2 + (y-cy)^2 <= r^2. All inputs are integers. */
export function carveCircle(t: Terrain, cx: number, cy: number, r: number): CarveResult {
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || !Number.isInteger(r)) {
    throw new RangeError("carveCircle: integer arguments required");
  }
  if (r < 0) return { ...NOTHING };
  const b: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let changed = 0;
  const yStart = Math.max(0, cy - r);
  const yEnd = Math.min(t.height - 1, cy + r);
  for (let y = yStart; y <= yEnd; y++) {
    const dy = y - cy;
    const span = isqrt(r * r - dy * dy);
    const xStart = Math.max(0, cx - span);
    const xEnd = Math.min(t.width - 1, cx + span);
    for (let x = xStart; x <= xEnd; x++) {
      const i = y * t.width + x;
      const v = t.cells[i] ?? AIR;
      if (v === AIR || v === BEDROCK) continue;
      t.cells[i] = AIR;
      changed++;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
  }
  return finish(t, changed, b);
}

/** Remove every non-bedrock cell in the inclusive rectangle. */
export function carveRect(t: Terrain, x0: number, y0: number, x1: number, y1: number): CarveResult {
  const b: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let changed = 0;
  for (let y = Math.max(0, y0); y <= Math.min(t.height - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(t.width - 1, x1); x++) {
      const i = y * t.width + x;
      const v = t.cells[i] ?? AIR;
      if (v === AIR || v === BEDROCK) continue;
      t.cells[i] = AIR;
      changed++;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
  }
  return finish(t, changed, b);
}

/** Fill air cells inside the circle with `material` (bridge/girder style weapons). Never overwrites solids. */
export function addCircle(
  t: Terrain,
  cx: number,
  cy: number,
  r: number,
  material: number,
): CarveResult {
  if (material === AIR) throw new RangeError("addCircle: material must not be air");
  const b: Bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let changed = 0;
  for (let y = Math.max(0, cy - r); y <= Math.min(t.height - 1, cy + r); y++) {
    const span = isqrt(r * r - (y - cy) * (y - cy));
    for (let x = Math.max(0, cx - span); x <= Math.min(t.width - 1, cx + span); x++) {
      const i = y * t.width + x;
      if ((t.cells[i] ?? AIR) !== AIR) continue;
      t.cells[i] = material;
      changed++;
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
  }
  return finish(t, changed, b);
}

/** Set a single cell directly (map generation and tests). Marks the affected chunks dirty. */
export function setCell(t: Terrain, x: number, y: number, material: number): void {
  if (x < 0 || y < 0 || x >= t.width || y >= t.height) return;
  const i = y * t.width + x;
  if (t.cells[i] === material) return;
  t.cells[i] = material;
  markDirty(t, { x0: x, y0: y, x1: x, y1: y });
}
