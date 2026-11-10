// Original jsfxr-style sound synthesis. Every effect is generated from a
// handful of numbers below: no recorded or copied audio anywhere.

export type Wave = "square" | "saw" | "sine" | "noise" | "triangle";

export interface SfxParams {
  wave: Wave;
  /** Start frequency in Hz. */
  freq: number;
  /** Frequency slide in octaves per second (negative falls). */
  slide: number;
  /** Vibrato depth 0..1 and rate in Hz. */
  vibrato?: number;
  vibratoRate?: number;
  /** Envelope seconds. */
  attack: number;
  sustain: number;
  decay: number;
  volume: number;
  /** Square duty 0..1. */
  duty?: number;
  /** One-pole low-pass cutoff 0..1 (1 = off). */
  lowpass?: number;
}

export const SAMPLE_RATE = 22050;

/** Deterministic PRNG so noise sounds identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synth(p: SfxParams, seed = 1): Float32Array {
  const total = p.attack + p.sustain + p.decay;
  const n = Math.max(1, Math.floor(total * SAMPLE_RATE));
  const out = new Float32Array(n);
  const rnd = mulberry32(seed);
  let phase = 0;
  let lp = 0;
  let held = rnd() * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let env: number;
    if (t < p.attack) env = t / Math.max(p.attack, 1e-6);
    else if (t < p.attack + p.sustain) env = 1;
    else env = 1 - (t - p.attack - p.sustain) / Math.max(p.decay, 1e-6);
    env = Math.max(0, env);
    const vib = p.vibrato
      ? 1 + p.vibrato * 0.1 * Math.sin(2 * Math.PI * (p.vibratoRate ?? 8) * t)
      : 1;
    const f = Math.max(20, p.freq * Math.pow(2, p.slide * t) * vib);
    phase += f / SAMPLE_RATE;
    const ph = phase % 1;
    let s: number;
    switch (p.wave) {
      case "square":
        s = ph < (p.duty ?? 0.5) ? 1 : -1;
        break;
      case "saw":
        s = 2 * ph - 1;
        break;
      case "triangle":
        s = 4 * Math.abs(ph - 0.5) - 1;
        break;
      case "sine":
        s = Math.sin(2 * Math.PI * ph);
        break;
      case "noise":
        // Sample-and-hold noise: pitch controls how crunchy it is.
        if (ph < f / SAMPLE_RATE) held = rnd() * 2 - 1;
        s = held;
        break;
    }
    if (p.lowpass !== undefined && p.lowpass < 1) {
      lp += (s - lp) * p.lowpass;
      s = lp;
    }
    out[i] = s * env * p.volume;
  }
  return out;
}

/** Mix several layers (padded to the longest). */
export function mix(layers: Float32Array[]): Float32Array {
  const n = Math.max(...layers.map((l) => l.length));
  const out = new Float32Array(n);
  for (const l of layers) for (let i = 0; i < l.length; i++) out[i]! += l[i]!;
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, out[i]!));
  return out;
}

/** Encode mono float samples as a 16-bit PCM WAV file. */
export function toWav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const dv = new DataView(bytes.buffer);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  dv.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, SAMPLE_RATE, true);
  dv.setUint32(28, SAMPLE_RATE * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  str(36, "data");
  dv.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => dv.setInt16(44 + i * 2, Math.round(v * 32767), true));
  return bytes;
}

export function toDataUri(wav: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < wav.length; i += 0x8000)
    bin += String.fromCharCode(...wav.subarray(i, i + 0x8000));
  return `data:audio/wav;base64,${btoa(bin)}`;
}
