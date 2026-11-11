import { describe, expect, it } from "vitest";
import { generate, hash } from "./index";
import { heightAt, heightField } from "./mapgen";

// Golden hashes recorded before the mapgen speed-up: the optimised generator must stay byte-identical.
const GOLDEN: [seed: number, sizeX: number, sizeZ: number, generator: number, hash: number][] = [
  [1, 256, 256, 2, 2719144588],
  [2, 256, 256, 2, 3965326699],
  [3, 256, 256, 2, 3182633155],
  [4, 256, 256, 2, 2135025326],
  [5, 256, 256, 2, 1707205333],
  [6, 256, 256, 2, 400920855],
  [5, 192, 192, 2, 3511503829],
  [5, 384, 256, 2, 3906400662],
  [5, 320, 384, 2, 4084161238],
  [9, 256, 256, 1, 630573274],
  [3, 192, 320, 2, 909174693],
];

describe("mapgen golden", () => {
  it.each(GOLDEN)("seed %i %ix%i gen %i", (seed, sizeX, sizeZ, generator, expected) => {
    const m = generate({ generator, seed, sizeX, sizeY: 96, sizeZ, theme: "t" });
    expect(hash(m.terrain)).toBe(expected);
    expect(m.spawns).toHaveLength(64);
  });

  it("heightField matches the reference heightAt", () => {
    const w = 100;
    const d = 70;
    const f = heightField(11, w, d);
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++) expect(f[z * w + x]).toBe(heightAt(11, w, d, x, z));
  });
});
