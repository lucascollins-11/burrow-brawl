import { Howl, Howler } from "howler";
import { RECIPES, SFX_NAMES, type SfxName } from "./effects";
import { toDataUri, toWav } from "./synth";

const KEY = "burrowbrawl.audio";

export interface AudioPrefs {
  muted: boolean;
  volume: number; // 0..1
}

/** Plays generated sound effects through Howler. Safe to call before the first user gesture. */
export class AudioManager {
  private howls = new Map<SfxName, Howl>();
  private prefs: AudioPrefs = { muted: false, volume: 0.8 };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.prefs = { ...this.prefs, ...(JSON.parse(raw) as Partial<AudioPrefs>) };
    } catch {
      /* ignore */
    }
    this.apply();
  }

  /** Synthesize all effects up front (about 100 KB total). Call once at startup. */
  preload(): void {
    for (const name of SFX_NAMES) {
      if (this.howls.has(name)) continue;
      const src = toDataUri(toWav(RECIPES[name]()));
      this.howls.set(name, new Howl({ src: [src], format: ["wav"], preload: true }));
    }
  }

  play(name: SfxName, opts: { rate?: number; volume?: number } = {}): void {
    if (this.prefs.muted) return;
    if (this.howls.size === 0) this.preload();
    const howl = this.howls.get(name);
    if (!howl) return;
    const id = howl.play();
    if (opts.rate !== undefined) howl.rate(opts.rate, id);
    if (opts.volume !== undefined) howl.volume(opts.volume, id);
  }

  /** Slight random pitch so repeated sounds (explosions, damage) don't feel robotic. */
  playVaried(name: SfxName, spread = 0.12): void {
    this.play(name, { rate: 1 + (Math.random() * 2 - 1) * spread });
  }

  setMuted(muted: boolean): void {
    this.prefs.muted = muted;
    this.apply();
  }
  setVolume(volume: number): void {
    this.prefs.volume = Math.max(0, Math.min(1, volume));
    this.apply();
  }
  get muted(): boolean {
    return this.prefs.muted;
  }
  get volume(): number {
    return this.prefs.volume;
  }

  private apply(): void {
    Howler.volume(this.prefs.volume);
    Howler.mute(this.prefs.muted);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.prefs));
    } catch {
      /* ignore */
    }
  }
}

/** Shared instance for the whole client. */
export const audio = new AudioManager();
