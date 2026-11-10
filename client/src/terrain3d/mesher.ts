// Surface-nets mesher for one 32^3 chunk of the voxel density grid. Pure function of a padded
// sample block, so it runs identically in a Web Worker and in tests. Visual only: collision never
// reads this mesh (the sim works on the voxels), so floats are fine here.
//
// Samples sit at integer voxel coordinates; the surface is where density crosses ISO (128).
// A chunk owns the cells whose lowest corner is inside it. Because quads around an edge touch
// cells one step below the chunk, the mesher also builds the vertices of the -1 layer (the
// neighbour's cells) but only emits quads for edges that start inside the chunk, so adjacent
// chunks meet without gaps or overlaps.

export const CHUNK = 32;
export const ISO = 128;
/** Samples are padded by one on each side: block coordinates are voxel - chunkOrigin + 1. */
export const PAD = 1;

// Samples needed: cells -1..CHUNK-1 (CHUNK+1 cells), each with corners cell..cell+1, so samples
// -1..CHUNK (CHUNK+2 of them) are enough; normals come from each cell's own corners.
export const SAMPLES = CHUNK + 2;

export interface ChunkMesh {
  /** xyz per vertex, in voxel units relative to the chunk origin. */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
}

const CELLS = CHUNK + 1; // cells -1 .. CHUNK-1

/**
 * @param block density samples for voxels origin-1 .. origin+CHUNK (inclusive) on every axis,
 *              laid out (y * SAMPLES + z) * SAMPLES + x, SAMPLES = 34.
 */
export function meshBlock(block: Uint8Array): ChunkMesh {
  const S = SAMPLES;
  const cellIndex = new Int32Array(CELLS * CELLS * CELLS).fill(-1);
  const pos: number[] = [];
  const nor: number[] = [];

  const d = (x: number, y: number, z: number): number => block[(y * S + z) * S + x]!;

  // Vertices for every cell (block coords: cell c covers samples c..c+1, c = voxel cell + 1).
  for (let cy = 0; cy < CELLS; cy++) {
    for (let cz = 0; cz < CELLS; cz++) {
      for (let cx = 0; cx < CELLS; cx++) {
        const d000 = d(cx, cy, cz);
        const d100 = d(cx + 1, cy, cz);
        const d010 = d(cx, cy + 1, cz);
        const d110 = d(cx + 1, cy + 1, cz);
        const d001 = d(cx, cy, cz + 1);
        const d101 = d(cx + 1, cy, cz + 1);
        const d011 = d(cx, cy + 1, cz + 1);
        const d111 = d(cx + 1, cy + 1, cz + 1);
        const mask =
          (d000 >= ISO ? 1 : 0) |
          (d100 >= ISO ? 2 : 0) |
          (d010 >= ISO ? 4 : 0) |
          (d110 >= ISO ? 8 : 0) |
          (d001 >= ISO ? 16 : 0) |
          (d101 >= ISO ? 32 : 0) |
          (d011 >= ISO ? 64 : 0) |
          (d111 >= ISO ? 128 : 0);
        if (mask === 0 || mask === 255) continue;

        // Average the iso crossings on the cell's 12 edges.
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        const edge = (
          a: number,
          b: number,
          ax: number,
          ay: number,
          az: number,
          bx: number,
          by: number,
          bz: number,
        ): void => {
          if (a >= ISO === b >= ISO) return;
          const t = (ISO - a) / (b - a);
          sx += ax + (bx - ax) * t;
          sy += ay + (by - ay) * t;
          sz += az + (bz - az) * t;
          n++;
        };
        edge(d000, d100, 0, 0, 0, 1, 0, 0);
        edge(d010, d110, 0, 1, 0, 1, 1, 0);
        edge(d001, d101, 0, 0, 1, 1, 0, 1);
        edge(d011, d111, 0, 1, 1, 1, 1, 1);
        edge(d000, d010, 0, 0, 0, 0, 1, 0);
        edge(d100, d110, 1, 0, 0, 1, 1, 0);
        edge(d001, d011, 0, 0, 1, 0, 1, 1);
        edge(d101, d111, 1, 0, 1, 1, 1, 1);
        edge(d000, d001, 0, 0, 0, 0, 0, 1);
        edge(d100, d101, 1, 0, 0, 1, 0, 1);
        edge(d010, d011, 0, 1, 0, 0, 1, 1);
        edge(d110, d111, 1, 1, 0, 1, 1, 1);

        // Voxel coordinates relative to the chunk: cell index - 1 (block layer 1 is voxel 0).
        pos.push(cx - PAD + sx / n, cy - PAD + sy / n, cz - PAD + sz / n);

        // Normal: points out of the solid, i.e. against the density gradient.
        const gx = d100 + d110 + d101 + d111 - (d000 + d010 + d001 + d011);
        const gy = d010 + d110 + d011 + d111 - (d000 + d100 + d001 + d101);
        const gz = d001 + d101 + d011 + d111 - (d000 + d100 + d010 + d110);
        const len = Math.hypot(gx, gy, gz) || 1;
        nor.push(-gx / len, -gy / len, -gz / len);
        cellIndex[(cy * CELLS + cz) * CELLS + cx] = pos.length / 3 - 1;
      }
    }
  }

  const idx: number[] = [];
  const vi = (cx: number, cy: number, cz: number): number =>
    cellIndex[(cy * CELLS + cz) * CELLS + cx]!;
  const quad = (a: number, b: number, c: number, e: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || e < 0) return;
    if (flip) idx.push(a, c, b, a, e, c);
    else idx.push(a, b, c, a, c, e);
  };

  // Edges starting at samples inside the chunk (voxel 0..CHUNK-1 => block coord 1..CHUNK).
  for (let y = PAD; y < PAD + CHUNK; y++) {
    for (let z = PAD; z < PAD + CHUNK; z++) {
      for (let x = PAD; x < PAD + CHUNK; x++) {
        const here = d(x, y, z) >= ISO;
        // Cell with lowest corner (x-1, y-1, z-1) in block coords has index (x-1, ...).
        // x-edge: sample (x,y,z) -> (x+1,y,z); cells around it: y-1..y, z-1..z, at x.
        if (here !== d(x + 1, y, z) >= ISO && y >= 1 && z >= 1) {
          quad(vi(x, y - 1, z - 1), vi(x, y, z - 1), vi(x, y, z), vi(x, y - 1, z), !here);
        }
        if (here !== d(x, y + 1, z) >= ISO && x >= 1 && z >= 1) {
          quad(vi(x - 1, y, z - 1), vi(x, y, z - 1), vi(x, y, z), vi(x - 1, y, z), here);
        }
        if (here !== d(x, y, z + 1) >= ISO && x >= 1 && y >= 1) {
          quad(vi(x - 1, y - 1, z), vi(x, y - 1, z), vi(x, y, z), vi(x - 1, y, z), !here);
        }
      }
    }
  }

  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    indices: new Uint32Array(idx),
    vertexCount: pos.length / 3,
  };
}

/** Out-of-grid policy for samples: sides and top are air, below the grid is solid floor. */
export function outsideDensity(y: number): number {
  return y < 0 ? 255 : 0;
}

export interface DensityGridLike {
  readonly width: number; // x extent
  readonly depth: number; // z extent
  readonly height: number; // y extent
  /** Flat, indexed (y * depth + z) * width + x. */
  readonly density: Uint8Array;
}

/** Copy the padded sample block for chunk (cx, cy, cz) out of the grid. */
export function extractBlock(
  g: DensityGridLike,
  cx: number,
  cy: number,
  cz: number,
  out: Uint8Array = new Uint8Array(SAMPLES * SAMPLES * SAMPLES),
): Uint8Array {
  const ox = cx * CHUNK - PAD;
  const oy = cy * CHUNK - PAD;
  const oz = cz * CHUNK - PAD;
  let o = 0;
  for (let y = 0; y < SAMPLES; y++) {
    const gy = oy + y;
    for (let z = 0; z < SAMPLES; z++) {
      const gz = oz + z;
      const rowOk = gy >= 0 && gy < g.height && gz >= 0 && gz < g.depth;
      const base = rowOk ? (gy * g.depth + gz) * g.width : 0;
      for (let x = 0; x < SAMPLES; x++) {
        const gx = ox + x;
        out[o++] = rowOk && gx >= 0 && gx < g.width ? g.density[base + gx]! : outsideDensity(gy);
      }
    }
  }
  return out;
}
