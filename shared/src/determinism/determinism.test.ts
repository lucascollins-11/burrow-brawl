import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkDeterminism, scriptedInputs, type DeterminismCase } from "./harness";
import { StateHasher, hashValue } from "./hasher";
import { Prng, type RngLike } from "./prng";

describe("Prng", () => {
  it("is reproducible per seed and pinned (changing this breaks replays)", () => {
    const a = Prng.fromSeed(1);
    const b = Prng.fromSeed(1);
    const seqA = Array.from({ length: 5 }, () => a.nextU32());
    expect(Array.from({ length: 5 }, () => b.nextU32())).toEqual(seqA);
    expect(seqA).toMatchInlineSnapshot(`
      [
        792534090,
        3215351813,
        160231488,
        1151041103,
        1990438114,
      ]
    `);
    expect(Prng.fromSeed(2).nextU32()).not.toBe(seqA[0]);
  });

  it("satisfies the sim's Rng interface", () => {
    const rng: RngLike = Prng.fromSeed(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextInt(10);
      expect(Number.isInteger(v) && v >= 0 && v < 10).toBe(true);
    }
  });

  it("nextInt is roughly uniform and handles edge bounds", () => {
    const rng = Prng.fromSeed(42);
    const buckets = new Array<number>(6).fill(0);
    const n = 60_000;
    for (let i = 0; i < n; i++) buckets[rng.nextInt(6)]!++;
    for (const b of buckets) expect(Math.abs(b - n / 6)).toBeLessThan(n / 6 / 20);
    expect(rng.nextInt(1)).toBe(0);
    const big = rng.nextInt(2 ** 32);
    expect(big >= 0 && big < 2 ** 32).toBe(true);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(1.5)).toThrow(RangeError);
    expect(() => rng.nextInt(2 ** 32 + 1)).toThrow(RangeError);
  });

  it("range, chance, pick and shuffle stay in bounds", () => {
    const rng = Prng.fromSeed(3);
    for (let i = 0; i < 500; i++) {
      const v = rng.nextRange(-5, 5);
      expect(v >= -5 && v <= 5).toBe(true);
    }
    expect(rng.chance(0, 10)).toBe(false);
    expect(rng.chance(10, 10)).toBe(true);
    expect(["a", "b"]).toContain(rng.pick(["a", "b"]));
    expect(rng.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("round-trips state and clones independently", () => {
    const a = Prng.fromSeed(9);
    a.nextU32();
    const saved = a.getState();
    const b = Prng.fromState(JSON.parse(JSON.stringify(saved)));
    const c = a.clone();
    const next = a.nextU32();
    expect(b.nextU32()).toBe(next);
    expect(c.nextU32()).toBe(next);
    expect(() => Prng.fromState([1, 2, 3] as never)).toThrow();
    expect(() => Prng.fromSeed(-1)).toThrow();
  });

  it("forks are stable, labeled, and don't advance the parent", () => {
    const a = Prng.fromSeed(5);
    const before = a.getState();
    const wind1 = a.fork("wind").nextU32();
    expect(a.getState()).toEqual(before);
    expect(a.fork("wind").nextU32()).toBe(wind1);
    expect(a.fork("crates").nextU32()).not.toBe(wind1);
    expect(a.nextU32()).not.toBe(wind1);
  });
});

describe("StateHasher", () => {
  it("is independent of key order and sensitive to values", () => {
    expect(hashValue({ a: 1, b: [2, 3] })).toBe(hashValue({ b: [2, 3], a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
    expect(hashValue([1, 2])).not.toBe(hashValue("12"));
    expect(hashValue([[1], 2])).not.toBe(hashValue([1, [2]]));
    expect(hashValue({ a: "b" })).not.toBe(hashValue({ ab: "" }));
    expect(hashValue(new Uint8Array([1, 2]))).not.toBe(hashValue(new Uint8Array([2, 1])));
    expect(hashValue(new Int32Array([-1]))).toBe(hashValue(new Int32Array([-1])));
    expect(hashValue(-(2 ** 40))).not.toBe(hashValue(2 ** 40));
  });

  it("refuses floats and non-plain values, naming the path", () => {
    expect(() => hashValue({ critters: [{ x: 1.5 }] })).toThrow("$.critters[0].x");
    expect(() => hashValue({ v: NaN })).toThrow();
    expect(() => hashValue({ m: new Map() })).toThrow("Map");
    expect(() => hashValue(new Float32Array([1]))).toThrow();
  });

  it("supports manual writes for hot paths", () => {
    const h1 = new StateHasher().i32(-1).u8(7).bool(true).str("hi").digest();
    const h2 = new StateHasher().i32(0xffffffff).u8(7).bool(true).str("hi").digest();
    expect(h1).toBe(h2);
    expect(() => new StateHasher().i32(2 ** 33)).toThrow();
  });
});

// A toy sim with integer physics and rng-driven events, standing in for the
// real one until S3/S4 land.
interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
interface Toy {
  tick: number;
  balls: Ball[];
  wind: number;
}
type Kick = { ball: number; dx: number };

function toyCase(overrides: Partial<DeterminismCase<Toy, Kick>> = {}): DeterminismCase<Toy, Kick> {
  const ticks = 600;
  return {
    seed: 1234,
    ticks,
    init: (rng) => ({
      tick: 0,
      wind: 0,
      balls: Array.from({ length: 8 }, () => ({
        x: rng.nextRange(0, 2047) << 16,
        y: 0,
        vx: 0,
        vy: 0,
      })),
    }),
    inputs: scriptedInputs(99, ticks, (rng) =>
      rng.chance(1, 10) ? [{ ball: rng.nextInt(8), dx: rng.nextRange(-3, 3) << 16 }] : [],
    ),
    step: (s, inputs, rng) => {
      if (s.tick % 60 === 0) s.wind = rng.nextRange(-100, 100);
      for (const k of inputs) s.balls[k.ball]!.vx += k.dx;
      for (const b of s.balls) {
        b.vy += 1 << 12;
        b.vx += s.wind << 4;
        b.x += b.vx >> 4;
        b.y += b.vy >> 4;
        if (b.y > 1000 << 16) {
          b.y = 1000 << 16;
          b.vy = -((b.vy * 3) >> 2);
          if (rng.chance(1, 4)) b.vx = -b.vx;
        }
      }
      s.tick++;
      return s;
    },
    hash: (s) => hashValue(s),
    save: (s) => structuredClone(s),
    load: (saved) => structuredClone(saved as Toy),
    ...overrides,
  };
}

describe("checkDeterminism", () => {
  it("passes for a deterministic sim, including snapshot resume", () => {
    const r = checkDeterminism(toyCase());
    expect(r).toMatchObject({ ok: true, ticks: 600 });
  });

  it("catches hidden state that differs between runs", () => {
    let calls = 0;
    const base = toyCase();
    const r = checkDeterminism({
      ...base,
      step: (s, i, rng, t) => {
        const out = base.step(s, i, rng, t);
        if (t === 300 && calls++ === 1) out.wind += 1; // second run only
        return out;
      },
    });
    expect(r).toMatchObject({ ok: false, tick: 300 });
  });

  it("catches a snapshot that drops state", () => {
    const r = checkDeterminism(
      toyCase({
        save: (s) => ({ tick: s.tick, balls: structuredClone(s.balls) }), // forgot wind
        load: (saved) => ({ ...(saved as Toy), wind: 0 }),
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("snapshot");
  });
});

// Guard: nothing in /shared may use wall clocks, Math.random, or
// engine-dependent transcendental math (results differ between browsers).
describe("shared/ determinism guard", () => {
  const FORBIDDEN =
    /\bMath\.(random|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt)\b|\bDate\.now\b|\bnew Date\b|\bperformance\.now\b/;
  const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return files(p);
      return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
    });
  }

  it("has no forbidden calls in shared/src (comments ignored)", () => {
    const hits: string[] = [];
    for (const f of files(srcRoot)) {
      const code = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(/\/\/.*$/gm, "");
      code.split("\n").forEach((line, i) => {
        if (FORBIDDEN.test(line)) hits.push(`${relative(srcRoot, f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
