import { describe, expect, it } from "vitest";
import {
  applyEdit,
  createTerrain,
  generate,
  hash,
  MAT_PLASTER,
  MAT_ROOF_TILE,
  MAT_STONE,
  MAT_TIMBER,
  MAT_PAINT_RED,
  materialHash,
  rotatedSize,
  rotateXZ,
  stampPrefab,
  themedRecipe,
  THEMES,
  MAP_SIZES,
  type DecorAnchor,
  type Prefab,
  type VoxelTerrain,
} from "./index";
import { makeCtx } from "./themes/kit";

/** A small test hut: stone floor, plaster walls with a door, a red stripe, a tiled roof. */
const HUT: Prefab = {
  id: "hut",
  sx: 7,
  sy: 8,
  sz: 5,
  parts: [
    { op: "footing", mat: MAT_STONE, x0: 0, y0: 0, z0: 0, x1: 6, y1: 0, z1: 4 },
    { op: "solid", mat: MAT_STONE, x0: 0, y0: 0, z0: 0, x1: 6, y1: 0, z1: 4 },
    { op: "solid", mat: MAT_PLASTER, x0: 0, y0: 1, z0: 0, x1: 6, y1: 5, z1: 4 },
    { op: "air", mat: 0, x0: 1, y0: 1, z0: 1, x1: 5, y1: 5, z1: 3 },
    { op: "air", mat: 0, x0: 3, y0: 1, z0: 0, x1: 3, y1: 3, z1: 0 },
    { op: "paint", mat: MAT_PAINT_RED, x0: 0, y0: 4, z0: 0, x1: 6, y1: 4, z1: 4 },
    { op: "solid", mat: MAT_ROOF_TILE, x0: 0, y0: 6, z0: 0, x1: 6, y1: 6, z1: 4 },
    { op: "solid", mat: MAT_TIMBER, x0: 0, y0: 7, z0: 2, x1: 6, y1: 7, z1: 2 },
  ],
  anchors: [
    { kind: "door", x: 3, y: 0, z: 0, face: 3 },
    { kind: "window", x: 1, y: 3, z: 0, face: 3 },
    { kind: "chimney", x: 5, y: 7, z: 2, face: 4 },
  ],
};

const at = (t: VoxelTerrain, x: number, y: number, z: number): number =>
  (y * t.sizeZ + z) * t.sizeX + x;

function flat(): VoxelTerrain {
  const t = createTerrain(64, 32, 64, 3, 2);
  t.density.fill(255, 0, 10 * 64 * 64); // ground up to y = 9
  return t;
}

describe("prefab stamping", () => {
  it("writes solids, cuts air, paints and fills footings", () => {
    const t = flat();
    // Hill under one corner, a gap under the rest: footings reach down to y = 10.
    const decor: DecorAnchor[] = [];
    stampPrefab(t, HUT, 10, 14, 20, 0, 1, decor);
    const m = t.material!;
    expect(m[at(t, 10, 14, 20)]).toBe(MAT_STONE);
    expect(t.density[at(t, 10, 12, 20)]).toBe(255);
    expect(m[at(t, 10, 10, 20)]).toBe(MAT_STONE);
    expect(m[at(t, 10, 9, 20)]).toBe(0); // the ground below is untouched
    expect(m[at(t, 10, 15, 20)]).toBe(MAT_PLASTER);
    expect(t.density[at(t, 12, 16, 22)]).toBe(0); // room
    expect(t.density[at(t, 13, 15, 20)]).toBe(0); // door
    expect(m[at(t, 10, 18, 20)]).toBe(MAT_PAINT_RED);
    expect(m[at(t, 13, 18, 20)]).toBe(MAT_PAINT_RED); // above the door
    expect(m[at(t, 12, 18, 22)]).toBe(0); // paint skips air
    expect(m[at(t, 10, 20, 20)]).toBe(MAT_ROOF_TILE);
    expect(decor.map((d) => d.kind)).toEqual(["door", "window", "chimney"]);
    expect(decor[0]).toMatchObject({ x: 13, y: 14, z: 20, face: 3 });
    for (const d of decor) expect(d.v).toBeGreaterThanOrEqual(0);
  });

  it("rotates footprints, voxels and faces by quarter turns", () => {
    expect(rotatedSize(HUT, 1)).toEqual([5, 7]);
    for (let rot = 0; rot < 4; rot++) {
      const [w, d] = rotatedSize(HUT, rot);
      const seen = new Set<string>();
      for (let z = 0; z < HUT.sz; z++)
        for (let x = 0; x < HUT.sx; x++) {
          const [rx, rz] = rotateXZ(HUT, rot, x, z);
          expect(rx >= 0 && rz >= 0 && rx < w && rz < d).toBe(true);
          seen.add(`${rx},${rz}`);
        }
      expect(seen.size).toBe(HUT.sx * HUT.sz); // a bijection
    }
    const t = flat();
    const decor: DecorAnchor[] = [];
    stampPrefab(t, HUT, 10, 14, 20, 1, 1, decor);
    // A quarter turn takes +x to +z, so the door wall (local -z) now faces +x.
    expect(decor[0]!.face).toBe(0);
    const [rx, rz] = rotateXZ(HUT, 1, 3, 0);
    expect(t.density[at(t, 10 + rx, 15, 20 + rz)]).toBe(0);
    expect(t.material![at(t, 10 + rx, 15, 20 + rz - 1)]).toBe(MAT_PLASTER);
  });

  it("is deterministic and clips at the grid edge", () => {
    const run = (): [number, number, DecorAnchor[]] => {
      const t = flat();
      const decor: DecorAnchor[] = [];
      stampPrefab(t, HUT, 60, 14, -2, 2, 7, decor);
      stampPrefab(t, HUT, 30, 25, 30, 3, 8, decor);
      return [hash(t), materialHash(t), decor];
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(a[2].every((d) => d.x >= 0 && d.z >= 0 && d.x < 64 && d.z < 64 && d.y < 32)).toBe(true);
  });

  it("rejects non-integer placement", () => {
    expect(() => stampPrefab(flat(), HUT, 1.5, 14, 2, 0, 1, [])).toThrow(RangeError);
  });

  it("goes through ThemeCtx.stamp with seeded decor variants", () => {
    const variants = (seed: number): number[] => {
      const ctx = makeCtx(flat(), seed);
      ctx.stamp(HUT, 10, 14, 20, 0, 3);
      return ctx.decor.map((d) => d.v);
    };
    expect(variants(1)).toEqual(variants(1));
    expect(variants(1)).not.toEqual(variants(2));
  });
});

describe("materials and edits", () => {
  it("resets material when a voxel's solidity flips, keeps it on partial damage", () => {
    const t = flat();
    stampPrefab(t, HUT, 10, 14, 20, 0, 1, []);
    applyEdit(t, { op: "carve", x: 10, y: 16, z: 20, r: 2 });
    expect(t.density[at(t, 10, 16, 20)]).toBeLessThan(128);
    expect(t.material![at(t, 10, 16, 20)]).toBe(0);
    for (let i = 0; i < t.density.length; i++)
      if (t.material![i]) expect(t.density[i]).toBeGreaterThanOrEqual(128);
    // Refill with a build weapon: the new solid is plain terrain.
    applyEdit(t, { op: "fill", x: 10, y: 16, z: 20, r: 2 });
    expect(t.density[at(t, 10, 16, 20)]).toBeGreaterThanOrEqual(128);
    expect(t.material![at(t, 10, 16, 20)]).toBe(0);
    // A wall voxel outside the carve keeps its plaster.
    expect(t.material![at(t, 16, 16, 22)]).toBe(MAT_PLASTER);
  });

  it("leaves the themes that build no prefabs without materials or decor", () => {
    // These build with prefabs, so they carry materials and decor on purpose.
    const built = new Set(["lighthouse-village", "clockwork-mesa", "toybox-harbor"]);
    for (const th of THEMES) {
      if (built.has(th.id)) continue;
      const m = generate(themedRecipe(th.id, 1, MAP_SIZES[0]));
      // Compare booleans: a failing match on a whole voxel grid would print millions of values.
      expect(m.terrain.material === undefined).toBe(true);
      expect(m.terrain.decor === undefined).toBe(true);
    }
  });
});
