import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTROLS } from "./helpContent";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  NORMAL_SHAKE,
  sanitizeSettings,
  saveSettings,
  shakeFor,
} from "./settings";

describe("help content", () => {
  const input = readFileSync(new URL("../game/input.ts", import.meta.url), "utf8");
  const camera = readFileSync(new URL("../camera.ts", import.meta.url), "utf8");
  it("only lists keys that game/input.ts or camera.ts really bind", () => {
    for (const g of CONTROLS)
      for (const r of g.rows)
        for (const k of r.bound) {
          const bound = [`"${k}"`].some(
            (needle) => input.includes(needle) || camera.includes(needle),
          );
          expect(
            bound,
            `${r.action}: key ${JSON.stringify(k)} not found in input.ts/camera.ts`,
          ).toBe(true);
        }
  });
  it("has rows for every group", () => {
    for (const g of CONTROLS) expect(g.rows.length).toBeGreaterThan(0);
  });
});

describe("settings", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };
  it("round-trips and sanitizes", () => {
    const s = mem();
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
    saveSettings({ reduceShake: true }, s);
    expect(loadSettings(s)).toEqual({ reduceShake: true });
    expect(sanitizeSettings({ reduceShake: "yes" })).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
  it("survives broken or throwing storage", () => {
    expect(loadSettings({ getItem: () => "{not json" })).toEqual(DEFAULT_SETTINGS);
    expect(
      loadSettings({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual(DEFAULT_SETTINGS);
    expect(() =>
      saveSettings(
        { reduceShake: true },
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
      ),
    ).not.toThrow();
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
  it("maps reduce-shake to zero offset", () => {
    expect(shakeFor({ reduceShake: true })).toBe(0);
    expect(shakeFor({ reduceShake: false })).toBe(NORMAL_SHAKE);
  });
});
