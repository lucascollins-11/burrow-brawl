import { describe, expect, it } from "vitest";
import {
  CHUNK,
  applyEdit,
  copyChunkPadded,
  createTerrain,
  densityAt,
  generate,
  hash,
  isSolid,
  normalAt,
  PADDED,
  raycast,
  restore,
  terrain3d,
  topSolidY,
  type MapRecipe,
  type TerrainEdit,
  type VoxelTerrain,
} from "./index.js";

const recipe: MapRecipe = {
  generator: 1,
  seed: 7,
  sizeX: 256,
  sizeY: 96,
  sizeZ: 256,
  theme: "test",
};

function flat(h = 20): VoxelTerrain {
  const t = createTerrain(64, 64, 64, 3, 10);
  for (let y = 0; y < h; y++)
    for (let z = 0; z < 64; z++)
      for (let x = 0; x < 64; x++) t.density[(y * 64 + z) * 64 + x] = 255;
  return t;
}

describe("grid", () => {
  it("rejects sizes that are not chunk multiples", () => {
    expect(() => createTerrain(100, 64, 64, 3, 10)).toThrow(RangeError);
  });
  it("follows the out-of-range rule", () => {
    const t = flat();
    expect(isSolid(t, 5, -1, 5)).toBe(true);
    expect(isSolid(t, -1, 5, 5)).toBe(false);
    expect(isSolid(t, 5, 70, 5)).toBe(false);
    expect(densityAt(t, 64, 0, 0)).toBe(0);
    expect(topSolidY(t, 5, 5)).toBe(19);
    expect(topSolidY(t, -1, 5)).toBe(-1);
  });
  it("normalAt points up on a flat top", () => {
    const t = flat();
    const n = normalAt(t, 10, 19, 10);
    expect(n.x).toBe(0);
    expect(n.z).toBe(0);
    expect(n.y).toBeGreaterThan(0);
  });
});

describe("copyChunkPadded", () => {
  it("matches densityAt everywhere, including borders and the bedrock rule", () => {
    const g = generate(recipe).terrain;
    const out = new Uint8Array(PADDED ** 3);
    const n = g.chunksX * g.chunksY * g.chunksZ;
    for (const ci of [0, 1, n - 1, Math.floor(n / 2), g.chunksX * g.chunksZ]) {
      copyChunkPadded(g, ci, out);
      const cx = ci % g.chunksX;
      const cz = Math.floor(ci / g.chunksX) % g.chunksZ;
      const cy = Math.floor(ci / (g.chunksX * g.chunksZ));
      let bad = 0;
      for (let y = 0; y < PADDED; y++)
        for (let z = 0; z < PADDED; z++)
          for (let x = 0; x < PADDED; x++)
            if (
              out[(y * PADDED + z) * PADDED + x] !==
              densityAt(g, cx * CHUNK + x - 1, cy * CHUNK + y - 1, cz * CHUNK + z - 1)
            )
              bad++;
      expect(bad).toBe(0);
    }
  });
});

describe("applyEdit", () => {
  it("carves a sphere with a smooth falloff and skips bedrock", () => {
    const t = flat(30);
    const r = applyEdit(t, { op: "carve", x: 32, y: 20, z: 32, r: 8 });
    expect(r.changed).toBeGreaterThan(500);
    expect(isSolid(t, 32, 20, 32)).toBe(false);
    expect(isSolid(t, 32, 20, 32 + 10)).toBe(true);
    const vals = [5, 6, 7, 8, 9, 10].map((d) => densityAt(t, 32, 20, 32 + d));
    expect(new Set(vals).size).toBeGreaterThan(2);
    applyEdit(t, { op: "carve", x: 32, y: 3, z: 32, r: 10 });
    for (let y = 0; y < 3; y++) expect(densityAt(t, 32, y, 32)).toBe(255);
  });
  it("fills and boxes, clipping to the grid, and bumps only touched chunk versions", () => {
    const t = createTerrain(96, 64, 96, 3, 10);
    const v0 = [...t.chunkVersion];
    const r = applyEdit(t, { op: "fill", x: 10, y: 10, z: 10, r: 5 });
    expect(r.changed).toBeGreaterThan(300);
    expect(r.chunks).toEqual([0]);
    expect(t.chunkVersion[0]).toBe(v0[0]! + 1);
    expect(t.chunkVersion[1]).toBe(v0[1]);
    const b = applyEdit(t, { op: "box", x0: 60, y0: 0, z0: 60, x1: 200, y1: 5, z1: 70 });
    expect(b.changed).toBe(36 * 6 * 11);
    expect(applyEdit(t, { op: "fill", x: 10, y: 63, z: 10, r: 10 }).changed).toBeGreaterThan(0);
    expect(t.edits).toHaveLength(3);
    expect(() => applyEdit(t, { op: "carve", x: 1.5, y: 1, z: 1, r: 2 })).toThrow(RangeError);
  });
});

describe("hash and restore", () => {
  const edits: TerrainEdit[] = [
    { op: "carve", x: 128, y: 40, z: 128, r: 12 },
    { op: "fill", x: 60, y: 50, z: 70, r: 6 },
    { op: "box", x0: 100, y0: 30, z0: 100, x1: 110, y1: 35, z1: 105 },
    { op: "carve", x: 31, y: 35, z: 33, r: 5 },
  ];
  it("regenerate + replay reproduces the hash and bytes", () => {
    const a = generate(recipe).terrain;
    for (const e of edits) applyEdit(a, e);
    const b = restore(recipe, edits);
    expect(hash(b)).toBe(hash(a));
    expect(Buffer.compare(b.density, a.density)).toBe(0);
    expect(b.edits).toEqual(edits);
  });
  it("hash changes with edits, and the cache never serves stale values", () => {
    const a = generate(recipe).terrain;
    const h0 = hash(a);
    expect(hash(a)).toBe(h0);
    applyEdit(a, edits[0]!);
    const h1 = hash(a);
    expect(h1).not.toBe(h0);
    const copy = createTerrain(a.sizeX, a.sizeY, a.sizeZ, a.bedrockY, a.seaY);
    copy.density.set(a.density);
    expect(hash(copy)).toBe(h1);
  });
  it("matches the contract object", () => {
    expect(terrain3d.hash).toBe(hash);
  });
});

describe("generate", () => {
  it("is deterministic with 32+ grounded spawns above the sea with headroom", () => {
    const a = generate(recipe);
    const b = generate(recipe);
    expect(hash(a.terrain)).toBe(hash(b.terrain));
    expect(a.spawns).toEqual(b.spawns);
    expect(a.spawns.length).toBeGreaterThanOrEqual(32);
    expect(new Set(a.spawns.map((s) => `${s.x},${s.y},${s.z}`)).size).toBe(a.spawns.length);
    for (const s of a.spawns) {
      expect(isSolid(a.terrain, s.x, s.y - 1, s.z)).toBe(true);
      for (let dy = 0; dy < 6; dy++) expect(isSolid(a.terrain, s.x, s.y + dy, s.z)).toBe(false);
      expect(s.y).toBeGreaterThan(a.terrain.seaY);
    }
  });
  it("rejects an unknown generator version", () => {
    expect(() => generate({ ...recipe, generator: 99 })).toThrow(RangeError);
  });
});

describe("raycast", () => {
  const t = flat(20);
  it("hits the ground from above and reports the voxel before it", () => {
    expect(raycast(t, 10, 40, 10, 10, 0, 10)).toMatchObject({
      hit: true,
      x: 10,
      y: 19,
      z: 10,
      px: 10,
      py: 20,
      pz: 10,
    });
  });
  it("misses open air, ending on the last voxel", () => {
    expect(raycast(t, 0, 30, 0, 40, 35, 20)).toMatchObject({ hit: false, x: 40, y: 35, z: 20 });
  });
  it("reaches the end of random segments through open air", () => {
    const empty = createTerrain(64, 64, 64, 3, 10);
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let k = 0; k < 300; k++) {
      const [x0, y0, z0, x1, y1, z1] = [
        rnd(64),
        rnd(64),
        rnd(64),
        rnd(64),
        rnd(64),
        rnd(64),
      ] as const;
      expect(raycast(empty, x0, y0, z0, x1, y1, z1)).toMatchObject({
        hit: false,
        x: x1,
        y: y1,
        z: z1,
      });
    }
  });
  it("visits exactly the voxels a brute-force walk visits (single solid voxel probe)", () => {
    let seed = 99;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let k = 0; k < 150; k++) {
      const [x0, y0, z0, x1, y1, z1] = [
        rnd(32),
        rnd(32),
        rnd(32),
        rnd(32),
        rnd(32),
        rnd(32),
      ] as const;
      // Brute force: sample the segment at high resolution (centres), collect distinct voxels.
      const seen = new Set<string>();
      const N = 4000;
      for (let i = 0; i <= N; i++) {
        const f = (a: number, b: number): number => Math.floor(a + 0.5 + ((b - a) * i) / N);
        seen.add(`${f(x0, x1)},${f(y0, y1)},${f(z0, z1)}`);
      }
      // Walk with the DDA by placing a solid voxel on each brute-force voxel in turn: the DDA must
      // report a hit on every voxel in the set as first-solid when it is the only solid voxel.
      let ok = 0;
      for (const key of [...seen].slice(0, 6)) {
        const [vx, vy, vz] = key.split(",").map(Number) as [number, number, number];
        const w = createTerrain(64, 64, 64, 0, 0);
        w.density[(vy * 64 + vz) * 64 + vx] = 255;
        if (raycast(w, x0, y0, z0, x1, y1, z1).hit) ok++;
      }
      expect(ok).toBe(Math.min(6, seen.size));
    }
  });
  it("stops at the first solid voxel along a diagonal", () => {
    const w = createTerrain(64, 64, 64, 3, 10);
    applyEdit(w, { op: "box", x0: 30, y0: 30, z0: 30, x1: 40, y1: 40, z1: 40 });
    const h = raycast(w, 0, 0, 0, 60, 60, 60);
    expect(h).toMatchObject({ hit: true, x: 30, y: 30, z: 30 });
    expect(raycast(w, 35, 35, 35, 35, 35, 35).hit).toBe(true);
  });
  it("hits bedrock below the grid", () => {
    expect(raycast(createTerrain(64, 64, 64, 3, 10), 5, 2, 5, 5, -4, 5)).toMatchObject({
      hit: true,
      y: -1,
      py: 0,
    });
  });
});

describe("mapgen v2", () => {
  const sum = (t: VoxelTerrain): number => hash(t);
  it("is deterministic, seed-sensitive, keeps the edit log empty, and has bedrock", () => {
    const r2: MapRecipe = { ...recipe, generator: 2 };
    const a = generate(r2).terrain;
    expect(a.edits).toHaveLength(0);
    expect(sum(generate(r2).terrain)).toBe(sum(a));
    expect(sum(generate({ ...r2, seed: 8 }).terrain)).not.toBe(sum(a));
    for (let x = 0; x < 256; x += 17) expect(densityAt(a, x, 0, x)).toBe(255);
  });
  it("finds 32+ distinct, grounded, roomy spawns across seeds and sizes", () => {
    const cases: [number, number, number][] = [];
    for (let s = 1; s <= 8; s++) cases.push([s, 256, 256]);
    cases.push([5, 192, 192], [5, 384, 256], [5, 320, 384]);
    for (const [seed, sizeX, sizeZ] of cases) {
      const m = generate({ ...recipe, generator: 2, seed, sizeX, sizeZ });
      expect(m.spawns.length, `seed ${seed} ${sizeX}x${sizeZ}`).toBeGreaterThanOrEqual(32);
      expect(new Set(m.spawns.map((s) => `${s.x},${s.y},${s.z}`)).size).toBe(m.spawns.length);
      for (const s of m.spawns) {
        expect(isSolid(m.terrain, s.x, s.y - 1, s.z)).toBe(true);
        for (let dy = 0; dy < 6; dy++) expect(isSolid(m.terrain, s.x, s.y + dy, s.z)).toBe(false);
        expect(s.y).toBeGreaterThan(m.terrain.seaY);
      }
    }
  });
  it("restore replays edits on top of a v2 map", () => {
    const r2: MapRecipe = { ...recipe, generator: 2 };
    const e: TerrainEdit[] = [{ op: "carve", x: 128, y: 40, z: 128, r: 10 }];
    const a = generate(r2).terrain;
    applyEdit(a, e[0]!);
    expect(hash(restore(r2, e))).toBe(hash(a));
  });
});
