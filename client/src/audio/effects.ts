import { mix, synth, type SfxParams } from "./synth";

export const SFX_NAMES = [
  "fire",
  "shot",
  "punch",
  "beep",
  "explosion",
  "jump",
  "land",
  "damage",
  "uiClick",
  "uiHover",
  "uiConfirm",
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

const p = (x: SfxParams): SfxParams => x;

/** Recipes: tweak the numbers to taste. Each returns mono samples in -1..1. */
export const RECIPES: Record<SfxName, () => Float32Array> = {
  // Cartoon "thwoomp": falling sine plus a short noise puff.
  fire: () =>
    mix([
      synth(
        p({
          wave: "sine",
          freq: 520,
          slide: -2.2,
          attack: 0.005,
          sustain: 0.03,
          decay: 0.2,
          volume: 0.7,
        }),
      ),
      synth(
        p({
          wave: "noise",
          freq: 3000,
          slide: -1,
          attack: 0.002,
          sustain: 0.02,
          decay: 0.09,
          volume: 0.35,
          lowpass: 0.5,
        }),
        7,
      ),
    ]),
  // Sharp pepper crack.
  shot: () =>
    mix([
      synth(
        p({
          wave: "noise",
          freq: 2600,
          slide: -1.5,
          attack: 0.001,
          sustain: 0.01,
          decay: 0.12,
          volume: 0.8,
          lowpass: 0.6,
        }),
        5,
      ),
      synth(
        p({
          wave: "square",
          freq: 240,
          slide: -2,
          attack: 0.001,
          sustain: 0.01,
          decay: 0.08,
          volume: 0.35,
        }),
      ),
    ]),
  // Meaty thump.
  punch: () =>
    mix([
      synth(
        p({
          wave: "sine",
          freq: 180,
          slide: -2.5,
          attack: 0.002,
          sustain: 0.03,
          decay: 0.22,
          volume: 0.9,
        }),
      ),
      synth(
        p({
          wave: "noise",
          freq: 1400,
          slide: -1.5,
          attack: 0.001,
          sustain: 0.01,
          decay: 0.07,
          volume: 0.4,
          lowpass: 0.4,
        }),
        9,
      ),
    ]),
  // Two-note mine beep.
  beep: () =>
    synth(
      p({
        wave: "square",
        freq: 880,
        slide: 0.3,
        attack: 0.002,
        sustain: 0.06,
        decay: 0.12,
        volume: 0.35,
        lowpass: 0.6,
      }),
    ),
  // Low rumble + crackle.
  explosion: () =>
    mix([
      synth(
        p({
          wave: "noise",
          freq: 900,
          slide: -1.6,
          attack: 0.005,
          sustain: 0.12,
          decay: 0.55,
          volume: 0.85,
          lowpass: 0.25,
        }),
        3,
      ),
      synth(
        p({
          wave: "sine",
          freq: 110,
          slide: -1.4,
          attack: 0.003,
          sustain: 0.08,
          decay: 0.45,
          volume: 0.8,
        }),
      ),
      synth(
        p({
          wave: "noise",
          freq: 4500,
          slide: -2,
          attack: 0.001,
          sustain: 0.01,
          decay: 0.12,
          volume: 0.35,
          lowpass: 0.7,
        }),
        11,
      ),
    ]),
  // Springy rising boing.
  jump: () =>
    synth(
      p({
        wave: "triangle",
        freq: 260,
        slide: 1.6,
        vibrato: 0.4,
        vibratoRate: 22,
        attack: 0.005,
        sustain: 0.05,
        decay: 0.16,
        volume: 0.6,
      }),
    ),
  // Soft thud.
  land: () =>
    mix([
      synth(
        p({
          wave: "sine",
          freq: 150,
          slide: -1.8,
          attack: 0.002,
          sustain: 0.01,
          decay: 0.12,
          volume: 0.8,
        }),
      ),
      synth(
        p({
          wave: "noise",
          freq: 1200,
          slide: -2,
          attack: 0.001,
          sustain: 0.005,
          decay: 0.05,
          volume: 0.3,
          lowpass: 0.3,
        }),
        5,
      ),
    ]),
  // Squeaky "ow": wobbly square dropping in pitch.
  damage: () =>
    synth(
      p({
        wave: "square",
        duty: 0.35,
        freq: 880,
        slide: -1.3,
        vibrato: 0.7,
        vibratoRate: 30,
        attack: 0.003,
        sustain: 0.06,
        decay: 0.2,
        volume: 0.45,
        lowpass: 0.6,
      }),
    ),
  uiClick: () =>
    synth(
      p({
        wave: "square",
        duty: 0.5,
        freq: 700,
        slide: 1.0,
        attack: 0.001,
        sustain: 0.012,
        decay: 0.05,
        volume: 0.35,
        lowpass: 0.7,
      }),
    ),
  uiHover: () =>
    synth(
      p({
        wave: "sine",
        freq: 900,
        slide: 0.3,
        attack: 0.001,
        sustain: 0.005,
        decay: 0.035,
        volume: 0.2,
      }),
    ),
  // Two quick rising blips.
  uiConfirm: () =>
    mix([
      synth(
        p({
          wave: "square",
          duty: 0.4,
          freq: 520,
          slide: 0,
          attack: 0.001,
          sustain: 0.05,
          decay: 0.04,
          volume: 0.3,
          lowpass: 0.7,
        }),
      ),
      shift(
        synth(
          p({
            wave: "square",
            duty: 0.4,
            freq: 780,
            slide: 0,
            attack: 0.001,
            sustain: 0.07,
            decay: 0.08,
            volume: 0.3,
            lowpass: 0.7,
          }),
        ),
        0.07,
      ),
    ]),
};

function shift(s: Float32Array, seconds: number): Float32Array {
  const pad = Math.floor(seconds * 22050);
  const out = new Float32Array(s.length + pad);
  out.set(s, pad);
  return out;
}
