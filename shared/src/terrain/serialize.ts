import { createTerrain } from "./terrain";
import type { Terrain } from "./types";
import { CHUNK_SIZE } from "./types";

const HEADER = 8;
const RUN = 5;

/**
 * RLE format (little endian): u32 width, u32 height, then runs of
 * (u8 material, u32 length) covering all cells in row-major order.
 */
export function serializeTerrain(t: Terrain): Uint8Array {
  const runs: Array<[number, number]> = [];
  const c = t.cells;
  let i = 0;
  while (i < c.length) {
    const v = c[i] ?? 0;
    let j = i + 1;
    while (j < c.length && c[j] === v) j++;
    runs.push([v, j - i]);
    i = j;
  }
  const out = new Uint8Array(HEADER + runs.length * RUN);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, t.width, true);
  dv.setUint32(4, t.height, true);
  let o = HEADER;
  for (const [v, n] of runs) {
    dv.setUint8(o, v);
    dv.setUint32(o + 1, n, true);
    o += RUN;
  }
  return out;
}

export function deserializeTerrain(data: Uint8Array, chunkSize = CHUNK_SIZE): Terrain {
  if (data.byteLength < HEADER || (data.byteLength - HEADER) % RUN !== 0) {
    throw new RangeError("deserializeTerrain: malformed data");
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const t = createTerrain(dv.getUint32(0, true), dv.getUint32(4, true), chunkSize);
  let pos = 0;
  for (let o = HEADER; o < data.byteLength; o += RUN) {
    const v = dv.getUint8(o);
    const n = dv.getUint32(o + 1, true);
    if (pos + n > t.cells.length) throw new RangeError("deserializeTerrain: runs exceed map size");
    t.cells.fill(v, pos, pos + n);
    pos += n;
  }
  if (pos !== t.cells.length) throw new RangeError("deserializeTerrain: runs do not cover map");
  return t;
}
