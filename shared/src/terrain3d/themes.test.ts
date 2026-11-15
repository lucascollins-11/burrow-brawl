import { describe, expect, it } from "vitest";
import {
  generate,
  hash,
  isTheme,
  MAP_SIZES,
  restore,
  themedRecipe,
  THEMES,
  topSolidY,
  type VoxelTerrain,
} from "./index";
import { SOLID } from "./api";

function solid(t: VoxelTerrain, x: number, y: number, z: number): boolean {
  return t.density[(y * t.sizeZ + z) * t.sizeX + x]! >= SOLID;
}

/** Columns reachable on foot from (sx, sz): dry land, neighbouring tops within 2 voxels. */
function walkable(t: VoxelTerrain, sx: number, sz: number): Set<number> {
  const seen = new Set<number>([sz * t.sizeX + sx]);
  const stack = [[sx, sz]] as [number, number][];
  while (stack.length) {
    const [x, z] = stack.pop()!;
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
      if (seen.has(k)) continue;
      const nt = topSolidY(t, nx, nz);
      if (nt < t.seaY + 1 || Math.abs(nt - top) > 2) continue;
      seen.add(k);
      stack.push([nx, nz]);
    }
  }
  return seen;
}

describe("theme registry", () => {
  it("lists Picnic Atoll", () => {
    expect(THEMES.map((t) => t.id)).toContain("picnic-atoll");
    expect(isTheme("picnic-atoll")).toBe(true);
    expect(isTheme("nope")).toBe(false);
  });

  it("rejects unknown themes and grids that are too small", () => {
    expect(() => generate(themedRecipe("nope", 1, 256))).toThrow(RangeError);
    expect(() => generate(themedRecipe("picnic-atoll", 1, 160))).toThrow(RangeError);
  });
});

// Recorded when each theme landed: any change to its output must bump the generator on purpose.
const THEME_CASES = [
  {
    id: "picnic-atoll",
    golden: { 384: 4285207213, 512: 3225110002 } as Record<number, number>,
  },
  {
    id: "toybox-harbor",
    golden: { 384: 1991564246, 512: 2273277046 } as Record<number, number>,
  },
  {
    id: "clockwork-mesa",
    golden: { 384: 3177638315, 512: 3744573976 } as Record<number, number>,
  },
  {
    id: "frosted-bakery",
    golden: { 256: 3991439380, 384: 879165735, 512: 774246827 } as Record<number, number>,
  },
  {
    id: "bathtub-bay",
    golden: { 384: 1435844129, 512: 2299029629 } as Record<number, number>,
  },
  {
    id: "garden-patch",
    golden: { 256: 3559672557, 384: 774145394, 512: 1649571672 } as Record<number, number>,
  },
];

describe.each(THEME_CASES)("$id", ({ id, golden }) => {
  const min = Math.max(256, THEMES.find((t) => t.id === id)!.minSize);
  const sizes = MAP_SIZES.filter((s) => s >= min);
  it.each(sizes)("size %i is deterministic, roomy and walkable", (size) => {
    const recipe = themedRecipe(id, 1, size);
    const a = generate(recipe);
    const b = generate(recipe);
    expect(hash(a.terrain)).toBe(hash(b.terrain));
    expect(a.spawns).toEqual(b.spawns);
    expect(a.objects).toEqual(b.objects);
    expect(a.terrain.edits).toHaveLength(0);
    expect(a.terrain.chunkVersion.every((v) => v === 0)).toBe(true);
    expect(hash(a.terrain)).toBe(golden[size]);

    const t = a.terrain;
    expect(a.spawns.length).toBeGreaterThanOrEqual(32);
    for (const s of a.spawns) {
      expect(solid(t, s.x, s.y - 1, s.z)).toBe(true);
      expect(s.y - 1).toBeGreaterThanOrEqual(t.seaY + 2);
      for (let y = s.y; y < t.sizeY; y++) expect(solid(t, s.x, y, s.z)).toBe(false);
    }
    for (const o of a.objects!) {
      expect(solid(t, o.x, o.y - 1, o.z)).toBe(true);
      expect(solid(t, o.x, o.y, o.z)).toBe(false);
    }
    expect(a.objects!.length).toBeGreaterThan(8);
    // Every island is reachable on foot: all spawns share one walkable region.
    const reach = walkable(t, a.spawns[0]!.x, a.spawns[0]!.z);
    for (const s of a.spawns) expect(reach.has(s.z * t.sizeX + s.x)).toBe(true);
  });

  it("changes with the seed and restores from its recipe", () => {
    const r1 = themedRecipe(id, 1, min);
    const r2 = themedRecipe(id, 2, min);
    expect(hash(generate(r1).terrain)).not.toBe(hash(generate(r2).terrain));
    const edits = [{ op: "carve", x: 128, y: 40, z: 128, r: 6 } as const];
    const t = restore(r1, edits);
    expect(t.edits).toHaveLength(1);
  });

  it("stays roomy and connected across seeds", async () => {
    for (let seed = 1; seed <= 12; seed++) {
      // Yield between seeds: a big map takes over a second, and a worker that never yields
      // misses vitest's own RPC deadlines (onTaskUpdate timeouts) even when every check passes.
      await new Promise((r) => setImmediate(r));
      const a = generate(themedRecipe(id, seed, min));
      expect(a.spawns.length).toBeGreaterThanOrEqual(32);
      expect(a.objects!.length).toBeGreaterThan(8);
      const reach = walkable(a.terrain, a.spawns[0]!.x, a.spawns[0]!.z);
      for (const sp of a.spawns) expect(reach.has(sp.z * min + sp.x)).toBe(true);
    }
  }, 60_000);
});

describe("clockwork-mesa layout", () => {
  it("has players on every tier, all joined by the cliff stairs and pipe shafts", () => {
    for (const size of [384]) {
      const a = generate(themedRecipe("clockwork-mesa", 3, size));
      const tiers = new Set(a.spawns.map((s) => s.y - 1));
      for (const y of [34, 46, 62, 78]) expect(tiers.has(y)).toBe(true);
      const reach = walkable(a.terrain, a.spawns[0]!.x, a.spawns[0]!.z);
      for (const s of a.spawns) expect(reach.has(s.z * a.terrain.sizeX + s.x)).toBe(true);
    }
  });
});

describe("bathtub-bay layout", () => {
  it("joins all five soap bars on foot through the gutter pipes", () => {
    for (const seed of [2, 3]) {
      const size = 384;
      const a = generate(themedRecipe("bathtub-bay", seed, size));
      // The bar centres in the 256 core, turned a quarter step per seed and centred (withIslets).
      const off = (size - 256) >> 1;
      const turn = seed & 3;
      const bars = [
        [72, 86],
        [188, 74],
        [196, 164],
        [86, 196],
        [122, 142],
      ].map(([x, z]) => {
        const [rx, rz] =
          turn === 0
            ? [x!, z!]
            : turn === 1
              ? [255 - z!, x!]
              : turn === 2
                ? [255 - x!, 255 - z!]
                : [z!, 255 - x!];
        return [rx + off, rz + off] as const;
      });
      const seen = new Set<number>();
      for (const s of a.spawns) {
        if (s.y - 1 !== 36) continue; // islets and rooftops are not bars
        let best = 0;
        let bestD = Infinity;
        bars.forEach(([x, z], i) => {
          const dd = (s.x - x) ** 2 + (s.z - z) ** 2;
          if (dd < bestD) [best, bestD] = [i, dd];
        });
        seen.add(best);
      }
      expect(seen.size).toBe(5);
    }
  });
});
