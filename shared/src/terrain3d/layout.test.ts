// The ring of islets every upgraded map gets: each one is walkable from the mainland over its
// bridge (Lucas, 2026-11-14: "some kind of bridge to the mainland").
import { describe, expect, it } from "vitest";
import { generate } from "./generate.js";
import { topSolidY } from "./grid.js";
import { themedRecipe } from "./themes/index.js";
import { icos, isin } from "./themes/layout.js";
import type { VoxelTerrain } from "./api.js";

/** Columns reachable on foot from (sx, sz): dry tops, steps of at most 2 voxels. */
function reach(t: VoxelTerrain, sx: number, sz: number): Uint8Array {
  const seen = new Uint8Array(t.sizeX * t.sizeZ);
  const stack = [sz * t.sizeX + sx];
  seen[stack[0]!] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const x = c % t.sizeX;
    const z = (c - x) / t.sizeX;
    const top = topSolidY(t, x, z);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= t.sizeX || nz >= t.sizeZ) continue;
      const k = nz * t.sizeX + nx;
      if (seen[k]) continue;
      const nt = topSolidY(t, nx, nz);
      if (nt < t.seaY + 1 || Math.abs(nt - top) > 2) continue;
      seen[k] = 1;
      stack.push(k);
    }
  }
  return seen;
}

describe("islets", () => {
  it.each([
    ["toybox-harbor", 384],
    ["toybox-harbor", 512],
    ["picnic-atoll", 384],
  ] as const)(
    "%s at %i: islets round the core, all walkable from the mainland",
    (id, size) => {
      const m = generate(themedRecipe(id, 4, size));
      const t = m.terrain;
      const r = reach(t, m.spawns[0]!.x, m.spawns[0]!.z);
      const lo = (size - 256) / 2;
      const hi = lo + 256;
      // Ground outside the 256 core is islets and their bridges. Count its walkable-height
      // columns (roofs and lamp posts stand higher) and how many of them can be reached on foot.
      let land = 0;
      let reached = 0;
      for (let z = 0; z < size; z++)
        for (let x = 0; x < size; x++) {
          if (x >= lo && x < hi && z >= lo && z < hi) continue;
          const y = topSolidY(t, x, z);
          if (y < t.seaY + 4 || y > t.seaY + 12) continue;
          land++;
          if (r[z * size + x]) reached++;
        }
      // At least one islet per side: each islet top is about 1200 columns.
      expect(land).toBeGreaterThan(4 * 800);
      expect(reached / land).toBeGreaterThan(0.9);
    },
    60_000,
  );

  it("has integer sin and cos on a 256 turn", () => {
    expect([isin(0), isin(64), isin(128), isin(192)]).toEqual([0, 1024, 0, -1024]);
    expect([icos(0), icos(64), icos(128)]).toEqual([1024, 0, -1024]);
    expect(isin(32)).toBe(724);
  });
});
