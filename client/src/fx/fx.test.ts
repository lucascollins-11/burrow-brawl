import { describe, expect, it } from "vitest";
import { emitExplosion, shakeForRadius } from "./emitters";
import { curveY, hillCurve, parallaxOffset } from "./hills";
import { ParticleSim } from "./particleSim";
import { ScreenShake } from "./shake";

const sim = (capacity = 8) => new ParticleSim({ capacity, gravity: 1000, drag: 0 });
const base = { x: 0, y: 0, vx: 0, vy: 0, size: 1, life: 1, color: 0xffffff };

describe("ParticleSim", () => {
  it("applies gravity (y up) and removes particles at end of life", () => {
    const s = sim();
    s.spawn({ ...base, vy: 100, life: 0.5 });
    s.step(0.1);
    expect(s.count).toBe(1);
    expect(s.vy[0]).toBeCloseTo(0, 5); // 100 - 1000 * 0.1
    s.step(0.5);
    expect(s.count).toBe(0);
  });
  it("swap-removes without skipping a particle", () => {
    const s = sim();
    s.spawn({ ...base, life: 0.05, x: 1 });
    s.spawn({ ...base, life: 5, x: 2 });
    s.spawn({ ...base, life: 0.05, x: 3 });
    s.step(0.1);
    expect(s.count).toBe(1);
    expect(s.x[0]).toBeCloseTo(2);
  });
  it("never grows past capacity", () => {
    const s = sim(4);
    for (let i = 0; i < 20; i++) s.spawn(base);
    expect(s.count).toBe(4);
  });
});

describe("explosion emitter", () => {
  const mk = () => ({ chunks: sim(200), puffs: sim(200), confetti: sim(200) });
  it("spawns all three kinds, more for bigger blasts", () => {
    const small = mk();
    const big = mk();
    emitExplosion(small, 0, 0, 20);
    emitExplosion(big, 0, 0, 120);
    for (const k of ["chunks", "puffs", "confetti"] as const)
      expect(small[k].count).toBeGreaterThan(0);
    expect(big.chunks.count).toBeGreaterThan(small.chunks.count);
  });
  it("is deterministic for the same position and radius", () => {
    const a = mk();
    const b = mk();
    emitExplosion(a, 10, 20, 50);
    emitExplosion(b, 10, 20, 50);
    expect(Array.from(a.chunks.vx.slice(0, a.chunks.count))).toEqual(
      Array.from(b.chunks.vx.slice(0, b.chunks.count)),
    );
  });
  it("shake scales with radius and is capped", () => {
    expect(shakeForRadius(10)).toBeLessThan(shakeForRadius(100));
    expect(shakeForRadius(10_000)).toBeLessThanOrEqual(0.9);
  });
});

describe("ScreenShake", () => {
  it("decays to zero offset", () => {
    const s = new ScreenShake();
    s.add(1);
    s.update(0.016);
    expect(Math.hypot(s.offsetX, s.offsetY)).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) s.update(0.016);
    expect(s.trauma).toBe(0);
    expect(s.offsetX).toBe(0);
  });
  it("clamps trauma to 1 and stays within maxOffset", () => {
    const s = new ScreenShake(20);
    s.add(5);
    expect(s.trauma).toBe(1);
    for (let i = 0; i < 60; i++) {
      s.update(0.016);
      expect(Math.abs(s.offsetX)).toBeLessThanOrEqual(20);
      expect(Math.abs(s.offsetY)).toBeLessThanOrEqual(20);
    }
  });
});

describe("hills and parallax", () => {
  const spec = { seed: 3, x0: 0, x1: 1000, base: -500, amp: 100, wavelength: 600, step: 25 };
  it("is deterministic and stays in the amplitude band", () => {
    const a = hillCurve(spec);
    expect(a).toEqual(hillCurve(spec));
    for (const [, y] of a) expect(Math.abs(y + 500)).toBeLessThanOrEqual(100.001);
  });
  it("interpolates and clamps", () => {
    const pts = hillCurve(spec);
    expect(curveY(pts, -50)).toBe(pts[0]![1]);
    expect(curveY(pts, 5000)).toBe(pts[pts.length - 1]![1]);
    const mid = curveY(pts, 12.5);
    const [a, b] = [pts[0]![1], pts[1]![1]];
    expect(mid).toBeCloseTo((a + b) / 2, 5);
  });
  it("parallax factor 1 tracks the world, 0 tracks the camera", () => {
    expect(parallaxOffset(1500, 1000, 1)).toBe(0);
    expect(parallaxOffset(1500, 1000, 0)).toBe(500);
    expect(parallaxOffset(1500, 1000, 0.25)).toBe(375);
  });
});
