export const AIR = 0;
export const CRUST = 1;
export const DIRT = 2;
export const CLAY = 3;
/** Indestructible. Carving skips it. */
export const BEDROCK = 255;

export const DEFAULT_WIDTH = 2048;
export const DEFAULT_HEIGHT = 1024;
export const CHUNK_SIZE = 64;

/** Destructible terrain mask. Origin top-left, +y is down, 1 cell = 1 world unit. */
export interface Terrain {
  readonly width: number;
  readonly height: number;
  /** One byte per cell, row-major: cells[y * width + x]. 0 is air. */
  readonly cells: Uint8Array;
  readonly chunkSize: number;
  readonly chunksX: number;
  readonly chunksY: number;
  /** Render state only (not hashed or serialized). Bumped whenever a chunk changes. */
  readonly chunkVersion: Uint32Array;
  /** Render state only. Chunks needing a mesh rebuild; the renderer consumes this. */
  readonly dirtyChunks: Set<number>;
}

export interface Bounds {
  x0: number;
  y0: number;
  /** Inclusive. */
  x1: number;
  y1: number;
}

export interface CarveResult {
  cellsRemoved: number;
  /** Cells that changed, or null when nothing changed. */
  bounds: Bounds | null;
}

export interface RayHit {
  hit: boolean;
  /** Cell of the first solid hit, or the end point when hit is false. */
  x: number;
  y: number;
}
