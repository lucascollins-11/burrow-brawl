import { describe, expect, it } from "vitest";
import { FIXED_ONE, fdiv, fmul, fromFixed, fsqrt, isqrt, toFixed } from "./fixed";

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
