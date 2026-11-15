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
    golden: { 256: 2855479326, 384: 3677026463, 512: 1716054583 } as Record<number, number>,
  },
  {
    id: "toybox-harbor",
    golden: { 384: 1991564246, 512: 2273277046 } as Record<number, number>,
  },
  {
    id: "clockwork-mesa",
    golden: { 256: 1621764385, 384: 3512871344, 512: 2703441375 } as Record<number, number>,
  },
  {
    id: "frosted-bakery",
    golden: { 256: 3991439380, 384: 879165735, 512: 774246827 } as Record<number, number>,
  },
  {
    id: "bathtub-bay",
    golden: { 256: 870537865, 384: 705710305, 512: 1361670801 } as Record<number, number>,
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

  it("stays roomy and connected across seeds", () => {
    for (let seed = 1; seed <= 12; seed++) {
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
    for (const size of [256, 384]) {
      const a = generate(themedRecipe("clockwork-mesa", 3, size));
      const tiers = new Set(a.spawns.map((s) => s.y - 1));
      for (const y of [34, 46, 62, 78]) expect(tiers.has(y)).toBe(true);
      const reach = walkable(a.terrain, a.spawns[0]!.x, a.spawns[0]!.z);
      for (const s of a.spawns) expect(reach.has(s.z * a.terrain.sizeX + s.x)).toBe(true);
    }
  });
});
