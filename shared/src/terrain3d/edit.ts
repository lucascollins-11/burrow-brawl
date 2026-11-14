import { CHUNK, SOLID, type EditResult, type TerrainEdit, type VoxelTerrain } from "./api.js";

export const MAX_EDIT_RADIUS = 64;

function checkInt(...vals: number[]): void {
  for (const v of vals)
    if (!Number.isInteger(v)) throw new RangeError(`terrain3d: edit needs integers, got ${v}`);
}

export function applyEdit(t: VoxelTerrain, edit: TerrainEdit): EditResult {
  const touched = new Set<number>();
  let changed = 0;
  const d = t.density;
  const m = t.material;

  const set = (x: number, y: number, z: number, v: number): void => {
    const i = (y * t.sizeZ + z) * t.sizeX + x;
    const old = d[i]!;
    if (old === v) return;
    d[i] = v;
    if (old >= SOLID !== v >= SOLID) {
      changed++;
      // Shared rule (materials.ts): material resets whenever solidity flips.
      if (m) m[i] = 0;
    }
    touched.add(
      (Math.floor(y / CHUNK) * t.chunksZ + Math.floor(z / CHUNK)) * t.chunksX +
        Math.floor(x / CHUNK),
    );
  };

  if (edit.op === "box") {
    checkInt(edit.x0, edit.y0, edit.z0, edit.x1, edit.y1, edit.z1);
    for (let y = Math.max(0, edit.y0); y <= Math.min(t.sizeY - 1, edit.y1); y++)
      for (let z = Math.max(0, edit.z0); z <= Math.min(t.sizeZ - 1, edit.z1); z++)
        for (let x = Math.max(0, edit.x0); x <= Math.min(t.sizeX - 1, edit.x1); x++)
          set(x, y, z, 255);
  } else {
    checkInt(edit.x, edit.y, edit.z, edit.r);
    if (edit.r < 0 || edit.r > MAX_EDIT_RADIUS)
      throw new RangeError(`terrain3d: radius ${edit.r} out of range`);
    const carve = edit.op === "carve";
    const r16 = edit.r * 16;
    const reach = edit.r + 2;
    const y0 = Math.max(carve ? t.bedrockY : 0, edit.y - reach);
    const y1 = Math.min(t.sizeY - 1, edit.y + reach);
    const zLo = Math.max(0, edit.z - reach);
    const zHi = Math.min(t.sizeZ - 1, edit.z + reach);
    const xLo = Math.max(0, edit.x - reach);
    const xHi = Math.min(t.sizeX - 1, edit.x + reach);
    const reach2 = reach * reach;
    for (let y = y0; y <= y1; y++) {
      const dy2 = (y - edit.y) ** 2;
      for (let z = zLo; z <= zHi; z++) {
        const dyz2 = dy2 + (z - edit.z) ** 2;
        if (dyz2 > reach2) continue;
        const row = (y * t.sizeZ + z) * t.sizeX;
        for (let x = xLo; x <= xHi; x++) {
          const dx = x - edit.x;
          const d2 = dx * dx + dyz2;
          if (d2 > reach2) continue;
          // Same as sphereLevel: floor(sqrt(d2 * 256)) is exact for these small integers.
          const level = 128 + (r16 - Math.floor(Math.sqrt(d2 * 256))) * 4;
          const old = d[row + x]!;
          if (carve) {
            // Cap the density: 255 - level is 127 at the rim and falls to 0 two voxels inside.
            const cap = level >= 255 ? 0 : level <= 0 ? 255 : 255 - level;
            if (old > cap) set(x, y, z, cap);
          } else {
            const val = level < 0 ? 0 : level > 255 ? 255 : level;
            if (old < val) set(x, y, z, val);
          }
        }
      }
    }
  }

  t.edits.push(edit);
  const chunks = [...touched].sort((a, b) => a - b);
  for (const c of chunks) t.chunkVersion[c] = (t.chunkVersion[c]! + 1) >>> 0;
  return { changed, chunks };
}
