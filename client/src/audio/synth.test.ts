import { describe, expect, it } from "vitest";
import { RECIPES, SFX_NAMES } from "./effects";
import { mix, synth, toWav } from "./synth";

describe("synth", () => {
  it("is deterministic", () => {
    const a = RECIPES.explosion();
    const b = RECIPES.explosion();
    expect(Array.from(a.slice(0, 200))).toEqual(Array.from(b.slice(0, 200)));
  });
  it("produces audible, clipped-safe, non-silent samples for every effect", () => {
    for (const name of SFX_NAMES) {
      const s = RECIPES[name]();
      expect(s.length, name).toBeGreaterThan(500);
      expect(s.length, name).toBeLessThan(22050); // under 1s
      let peak = 0;
      for (const v of s) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak, name).toBeGreaterThan(0.05);
      expect(peak, name).toBeLessThanOrEqual(1);
    }
  });
  it("mix pads to the longest layer", () => {
    expect(mix([new Float32Array(3), new Float32Array(5)]).length).toBe(5);
  });
  it("writes a valid WAV header", () => {
    const wav = toWav(
      synth({ wave: "sine", freq: 440, slide: 0, attack: 0, sustain: 0.01, decay: 0, volume: 1 }),
    );
    const text = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(text(36)).toBe("data");
  });
});
