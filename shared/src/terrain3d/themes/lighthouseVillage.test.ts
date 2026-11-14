import { describe, expect, it } from "vitest";
import { generate, hash, materialHash, restore, themedRecipe, topSolidY } from "../index";
import { SOLID } from "../api";

describe("lighthouse-village", () => {
  const recipe = themedRecipe("lighthouse-village", 1, 512);
  const a = generate(recipe);
  const t = a.terrain;

  it("is a tall 512 map with materials and detail anchors", () => {
    expect(recipe.sizeY).toBe(160);
    expect(t.material).toBeDefined();
    expect(t.decor!.length).toBeGreaterThan(2000);
    let built = 0;
    let loose = 0;
    const m = t.material!;
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      built++;
      if (t.density[i]! < SOLID) loose++;
    }
    expect(built).toBeGreaterThan(200_000);
    expect(loose).toBe(0);
  });

  it("is deterministic", () => {
    const b = generate(recipe);
    expect(hash(b.terrain)).toBe(hash(t));
    expect(materialHash(b.terrain)).toBe(materialHash(t));
    expect(b.terrain.decor).toEqual(t.decor);
    expect(b.spawns).toEqual(a.spawns);
    expect(a.terrain.edits).toHaveLength(0);
  });

  it("has enough grounded, dry spawns and anchors inside the grid", () => {
    expect(a.spawns.length).toBeGreaterThanOrEqual(32);
    for (const s of a.spawns) {
      expect(t.density[((s.y - 1) * t.sizeZ + s.z) * t.sizeX + s.x]).toBeGreaterThanOrEqual(SOLID);
      expect(s.y - 1).toBeGreaterThan(t.seaY);
    }
    for (const d of t.decor!) {
      expect(d.x >= 0 && d.z >= 0 && d.x < 512 && d.z < 512 && d.y >= 0 && d.y < 160).toBe(true);
      expect(d.face).toBeGreaterThanOrEqual(0);
      expect(d.face).toBeLessThanOrEqual(5);
    }
  });

  it("puts the lighthouse lantern high on the headland", () => {
    expect(topSolidY(t, 420, 72)).toBeGreaterThan(140);
    expect(t.decor!.some((d) => d.kind === "lens")).toBe(true);
  });

  it("restores from its recipe and clears materials it blows away", () => {
    const r = restore(recipe, [{ op: "carve", x: 420, y: 100, z: 72, r: 8 }]);
    const i = (100 * r.sizeZ + 72) * r.sizeX + 420;
    expect(r.density[i]).toBeLessThan(SOLID);
    expect(r.material![i]).toBe(0);
  });
});
