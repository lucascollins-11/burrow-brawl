// Determinism test harness: same seed + same inputs => same state hash at
// every tick, and a snapshot taken mid-run resumes to the same hashes.
// Used by sim tests (S3/S4) and by O3 to prove client and server agree.

import { Prng } from "./prng";

export interface DeterminismCase<S, I> {
  /** Match seed (u32). */
  seed: number;
  /** Number of ticks to run. */
  ticks: number;
  /** Fresh initial state. Must not share mutable data between calls. */
  init(rng: Prng): S;
  /** Inputs applied on `tick` (same for every run). */
  inputs(tick: number): readonly I[];
  /** Advance one tick. May mutate and return `state` or return a new one. */
  step(state: S, inputs: readonly I[], rng: Prng, tick: number): S;
  /** u32 hash of the full sim state. */
  hash(state: S): number;
  /**
   * Optional: serialize state for snapshot/resume checks. Should produce what
   * the server would send in `snapshot`; the harness adds the PRNG state.
   */
  save?(state: S): unknown;
  load?(saved: unknown): S;
}

export interface Trace {
  /** hashes[i] = hash after tick i (hashes[-1] is the initial state, kept as `initial`). */
  initial: number;
  hashes: number[];
}

export function runTrace<S, I>(
  c: DeterminismCase<S, I>,
  fromTick = 0,
  start?: { state: S; rng: Prng },
): Trace {
  const rng = start?.rng ?? Prng.fromSeed(c.seed);
  let state = start?.state ?? c.init(rng);
  const initial = c.hash(state);
  const hashes: number[] = [];
  for (let tick = fromTick; tick < c.ticks; tick++) {
    state = c.step(state, c.inputs(tick), rng, tick);
    hashes.push(c.hash(state));
  }
  return { initial, hashes };
}

export type DeterminismResult =
  | { ok: true; finalHash: number; ticks: number }
  | { ok: false; reason: string; tick: number; expected: number; actual: number };

function compare(a: Trace, b: Trace, offset: number, what: string): DeterminismResult | null {
  for (let i = 0; i < b.hashes.length; i++) {
    const expected = a.hashes[i + offset];
    const actual = b.hashes[i];
    if (expected !== actual) {
      return {
        ok: false,
        reason: `${what}: hashes diverge at tick ${i + offset}`,
        tick: i + offset,
        expected: expected ?? -1,
        actual: actual ?? -1,
      };
    }
  }
  return null;
}

/**
 * Runs the case `runs` times from scratch and, if `save`/`load` exist,
 * resumes from snapshots at `resumeAt` ticks. Returns the first divergence.
 */
export function checkDeterminism<S, I>(
  c: DeterminismCase<S, I>,
  opts: { runs?: number; resumeAt?: number[] } = {},
): DeterminismResult {
  const runs = opts.runs ?? 3;
  const base = runTrace(c);
  for (let r = 1; r < runs; r++) {
    const t = runTrace(c);
    if (t.initial !== base.initial) {
      return {
        ok: false,
        reason: `run ${r}: initial state differs`,
        tick: -1,
        expected: base.initial,
        actual: t.initial,
      };
    }
    const bad = compare(base, t, 0, `run ${r}`);
    if (bad) return bad;
  }

  if (c.save && c.load) {
    const points = opts.resumeAt ?? [Math.floor(c.ticks / 3), Math.floor((2 * c.ticks) / 3)];
    for (const at of points) {
      if (at <= 0 || at >= c.ticks) continue;
      // Play to `at`, snapshot through a JSON round trip (like the wire), resume.
      const rng = Prng.fromSeed(c.seed);
      let state = c.init(rng);
      for (let tick = 0; tick < at; tick++) state = c.step(state, c.inputs(tick), rng, tick);
      const wire = JSON.parse(JSON.stringify({ state: c.save(state), rng: rng.getState() })) as {
        state: unknown;
        rng: [number, number, number, number];
      };
      const resumed = runTrace(c, at, { state: c.load(wire.state), rng: Prng.fromState(wire.rng) });
      if (resumed.initial !== base.hashes[at - 1]) {
        return {
          ok: false,
          reason: `snapshot at tick ${at} does not restore the same state (save/load misses something)`,
          tick: at - 1,
          expected: base.hashes[at - 1] ?? -1,
          actual: resumed.initial,
        };
      }
      const bad = compare(base, resumed, at, `resume from tick ${at}`);
      if (bad) return bad;
    }
  }

  return { ok: true, finalHash: base.hashes.at(-1) ?? base.initial, ticks: c.ticks };
}

/** Deterministic pseudo-random input script for fuzzing a case. */
export function scriptedInputs<I>(
  seed: number,
  ticks: number,
  gen: (rng: Prng, tick: number) => readonly I[],
): (tick: number) => readonly I[] {
  const rng = Prng.fromSeed(seed);
  const script: (readonly I[])[] = [];
  for (let t = 0; t < ticks; t++) script.push(gen(rng, t));
  return (tick) => script[tick] ?? [];
}
