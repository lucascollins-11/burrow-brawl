// Library prefabs baked from CC0 models by tools/assets/bake_prefab.py (see prefabs/*.json).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createTerrain, MATERIAL_NAMES, stampPrefab, type DecorAnchor, type Prefab } from "./index";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "prefabs");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".json"));

function load(file: string): Prefab & { door: unknown } {
  return JSON.parse(readFileSync(join(DIR, file), "utf8"));
}

describe("baked library prefabs", () => {
  it("has the first Lighthouse picks", () => {
    for (const id of [
      "kaykit-windmill",
      "kaykit-church",
      "kaykit-tower",
      "kaykit-watermill",
      "kaykit-tavern",
    ])
      expect(FILES).toContain(`${id}.json`);
  });

  for (const file of FILES) {
    describe(file, () => {
      const p = load(file);

      it("is integer boxes inside its bounds with known materials, footing first", () => {
        expect(p.id).toBe(file.replace(/\.json$/, ""));
        expect(p.parts[0]?.op).toBe("footing");
        for (const q of p.parts) {
          for (const v of [q.x0, q.y0, q.z0, q.x1, q.y1, q.z1, q.mat])
            expect(Number.isInteger(v)).toBe(true);
          expect(
            q.x0 >= 0 && q.x1 < p.sx && q.y0 >= 0 && q.y1 < p.sy && q.z0 >= 0 && q.z1 < p.sz,
          ).toBe(true);
          if (q.op !== "air") expect(q.mat > 0 && q.mat < MATERIAL_NAMES.length).toBe(true);
        }
      });

      it("stamps as a solid building with a walkable hollow inside and a doorway", () => {
        const up = (n: number): number => Math.ceil(n / 32) * 32;
        const t = createTerrain(up(p.sx + 8), up(p.sy + 12), up(p.sz + 8), 2, 1);
        t.density.fill(255, 0, 6 * t.sizeX * t.sizeZ); // ground up to y = 5
        const decor: DecorAnchor[] = [];
        const n = stampPrefab(t, p, 4, 6, 4, 0, 1, decor);
        expect(n).toBeGreaterThan(1000);
        // Inside floors: air voxels in the hollow with solid floor under them, so you can walk in.
        let walkable = 0;
        for (const q of p.parts)
          if (q.op === "air")
            for (let y = q.y0; y <= q.y1; y++)
              for (let x = q.x0; x <= q.x1; x++)
                for (let z = q.z0; z <= q.z1; z++) {
                  const at = (yy: number): number =>
                    ((yy + 6) * t.sizeZ + (z + 4)) * t.sizeX + (x + 4);
                  if (t.density[at(y)] === 0 && t.density[at(y - 1)] === 255) walkable++;
                }
        expect(walkable).toBeGreaterThan(20);
        expect(p.door).not.toBeNull();
      });
    });
  }
});
