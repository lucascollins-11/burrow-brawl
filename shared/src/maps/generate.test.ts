import { describe, expect, it } from "vitest";
import { Prng } from "../determinism/prng";
import { BEDROCK, hashTerrain, isSolid, type Terrain } from "../terrain";
import { generateMap, isValidSpawn, SPAWN_CLEARANCE } from "./generate";

/** Row of the first solid cell in column x, or -1 if the column is empty. */
function groundRow(t: Terrain, x: number): number {
  for (let y = 0; y < t.height; y++) if (isSolid(t, x, y)) return y;
  return -1;
}

describe("generateMap determinism", () => {
  it("gives the same terrain hash for the same seed", () => {
    const a = generateMap(Prng.fromSeed(1234));
    const b = generateMap(Prng.fromSeed(1234));
    expect(hashTerrain(a.terrain)).toBe(hashTerrain(b.terrain));
    expect(a.spawns).toEqual(b.spawns);
  });

  it("gives different terrain for different seeds", () => {
    const a = generateMap(Prng.fromSeed(1));
    const b = generateMap(Prng.fromSeed(2));
    expect(hashTerrain(a.terrain)).not.toBe(hashTerrain(b.terrain));
  });

  it("does not depend on anything but the rng and options", () => {
    const withIslands = generateMap(Prng.fromSeed(9), { islands: 3 });
    const noIslands = generateMap(Prng.fromSeed(9), { islands: 0 });
    expect(hashTerrain(withIslands.terrain)).not.toBe(hashTerrain(noIslands.terrain));
    expect(hashTerrain(generateMap(Prng.fromSeed(9), { islands: 3 }).terrain)).toBe(
      hashTerrain(withIslands.terrain),
    );
  });
});

describe("generateMap spawns", () => {
  const seeds = [1, 2, 3, 77, 4096];

  it.each(seeds)("places the requested number of valid spawns (seed %i)", (seed) => {
    const map = generateMap(Prng.fromSeed(seed));

    expect(map.spawns).toHaveLength(4);
    for (const s of map.spawns) {
      expect(isValidSpawn(map.terrain, s.x, s.y)).toBe(true);
    }
  });

  it.each(seeds)("keeps spawns flat and spaced apart (seed %i)", (seed) => {
    const map = generateMap(Prng.fromSeed(seed));
    const { halfWidth } = SPAWN_CLEARANCE;

    for (const s of map.spawns) {
      const ground = s.y + 1;
      for (let dx = -halfWidth; dx <= halfWidth; dx++) {
        expect(groundRow(map.terrain, s.x + dx)).toBe(ground);
      }
    }
    for (let i = 0; i < map.spawns.length; i++) {
      for (let j = i + 1; j < map.spawns.length; j++) {
        const a = map.spawns[i];
        const b = map.spawns[j];
        expect(Math.abs((a?.x ?? 0) - (b?.x ?? 0))).toBeGreaterThanOrEqual(160);
      }
    }
  });

  it("keeps every spawn above the water line", () => {
    const map = generateMap(Prng.fromSeed(5));
    for (const s of map.spawns) expect(s.y + 1).toBeLessThan(map.waterY);
  });

  it("returns fewer spawns rather than invalid ones when the map is too small", () => {
    const map = generateMap(Prng.fromSeed(3), { width: 256, height: 256, spawnCount: 8 });
    expect(map.spawns.length).toBeLessThanOrEqual(8);
    for (const s of map.spawns) expect(isValidSpawn(map.terrain, s.x, s.y)).toBe(true);
  });
});

describe("generateMap layout", () => {
  it("has a bedrock floor across the bottom", () => {
    const map = generateMap(Prng.fromSeed(11));
    const t = map.terrain;
    for (let y = t.height - 8; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        expect(t.cells[y * t.width + x]).toBe(BEDROCK);
      }
    }
  });

  it("keeps all destructible soil above the water line", () => {
    const map = generateMap(Prng.fromSeed(11));
    const t = map.terrain;
    for (let y = map.waterY; y < t.height - 8; y++) {
      for (let x = 0; x < t.width; x++) {
        expect(isSolid(t, x, y)).toBe(false);
      }
    }
  });

  it("has ground that is hilly, not one flat line", () => {
    const map = generateMap(Prng.fromSeed(21));
    const rows = new Set<number>();
    for (let x = 0; x < map.terrain.width; x += 16) rows.add(groundRow(map.terrain, x));
    expect(rows.size).toBeGreaterThan(10);
  });
});
