import type { Bounds, Terrain } from "./types";
import { AIR, CHUNK_SIZE } from "./types";

export function createTerrain(width: number, height: number, chunkSize = CHUNK_SIZE): Terrain {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("createTerrain: width and height must be positive integers");
  }
  const chunksX = Math.ceil(width / chunkSize);
  const chunksY = Math.ceil(height / chunkSize);
  const t: Terrain = {
    width,
    height,
    cells: new Uint8Array(width * height),
    chunkSize,
    chunksX,
    chunksY,
    chunkVersion: new Uint32Array(chunksX * chunksY),
    dirtyChunks: new Set<number>(),
  };
  markAllDirty(t);
  return t;
}

export function inBounds(t: Terrain, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < t.width && y < t.height;
}

/** Material at a cell. Out of bounds is air (see terrain-spec 2.1). */
export function materialAt(t: Terrain, x: number, y: number): number {
  return inBounds(t, x, y) ? (t.cells[y * t.width + x] ?? AIR) : AIR;
}

export function isSolid(t: Terrain, x: number, y: number): boolean {
  return materialAt(t, x, y) !== AIR;
}

export function chunkIndex(t: Terrain, cx: number, cy: number): number {
  return cy * t.chunksX + cx;
}

function markChunk(t: Terrain, cx: number, cy: number): void {
  if (cx < 0 || cy < 0 || cx >= t.chunksX || cy >= t.chunksY) return;
  const i = chunkIndex(t, cx, cy);
  t.chunkVersion[i] = ((t.chunkVersion[i] ?? 0) + 1) >>> 0;
  t.dirtyChunks.add(i);
}

/**
 * Mark every chunk whose mesh depends on a cell in `b` as dirty. A chunk's
 * squares sample one cell right/down of the chunk, so we expand by one cell.
 */
export function markDirty(t: Terrain, b: Bounds): void {
  const cs = t.chunkSize;
  const cx0 = Math.floor(Math.max(0, b.x0 - 1) / cs);
  const cy0 = Math.floor(Math.max(0, b.y0 - 1) / cs);
  const cx1 = Math.floor(Math.min(t.width - 1, b.x1) / cs);
  const cy1 = Math.floor(Math.min(t.height - 1, b.y1) / cs);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) markChunk(t, cx, cy);
}

export function markAllDirty(t: Terrain): void {
  for (let cy = 0; cy < t.chunksY; cy++)
    for (let cx = 0; cx < t.chunksX; cx++) markChunk(t, cx, cy);
}

/** FNV-1a over dimensions and cells. Render state is excluded. */
export function hashTerrain(t: Terrain): number {
  let h = 0x811c9dc5;
  const mix = (b: number): void => {
    h = Math.imul(h ^ (b & 0xff), 0x01000193) >>> 0;
  };
  for (const n of [t.width, t.height]) {
    mix(n);
    mix(n >>> 8);
    mix(n >>> 16);
    mix(n >>> 24);
  }
  const c = t.cells;
  for (let i = 0; i < c.length; i++) {
    h = Math.imul(h ^ (c[i] ?? 0), 0x01000193) >>> 0;
  }
  return h >>> 0;
}
