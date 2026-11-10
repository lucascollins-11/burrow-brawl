import { describe, expect, it } from "vitest";
import { FIXED_ONE, cosDeg, fdiv, fmul, fromFixed, fsqrt, isqrt, sinDeg, toFixed } from "./fixed";

describe("fixed", () => {
  it("round-trips simple values", () => {
    expect(toFixed(1)).toBe(FIXED_ONE);
    expect(fromFixed(toFixed(2.5))).toBe(2.5);
    expect(fromFixed(toFixed(-0.25))).toBe(-0.25);
  });

  it("multiplies and divides", () => {
    expect(fmul(toFixed(2.5), toFixed(4))).toBe(toFixed(10));
    expect(fmul(toFixed(-1.5), toFixed(2))).toBe(toFixed(-3));
    expect(fdiv(toFixed(10), toFixed(4))).toBe(toFixed(2.5));
    expect(() => fdiv(1, 0)).toThrow();
  });

  it("computes integer and fixed square roots", () => {
    expect(isqrt(0)).toBe(0);
    expect(isqrt(15)).toBe(3);
    expect(isqrt(16)).toBe(4);
    expect(isqrt(2 ** 52)).toBe(2 ** 26);
    expect(fsqrt(toFixed(4))).toBe(toFixed(2));
    expect(() => isqrt(-1)).toThrow();
  });
});

describe("trig", () => {
  it("matches known values closely and is exact at the axes", () => {
    expect(sinDeg(0)).toBe(0);
    expect(sinDeg(90)).toBe(FIXED_ONE);
    expect(cosDeg(0)).toBe(FIXED_ONE);
    expect(cosDeg(90)).toBe(0);
    expect(sinDeg(180)).toBe(0);
    expect(sinDeg(270)).toBe(-FIXED_ONE);
    for (let d = -360; d <= 720; d += 7) {
      expect(Math.abs(fromFixed(sinDeg(d)) - Math.sin((d * Math.PI) / 180))).toBeLessThan(0.002);
      expect(Math.abs(fromFixed(cosDeg(d)) - Math.cos((d * Math.PI) / 180))).toBeLessThan(0.002);
    }
  });
});
