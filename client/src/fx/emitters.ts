import { PALETTE } from "./palette";
import type { ParticleSim } from "./particleSim";
import { makeRng } from "./rng";

export interface ExplosionSims {
  chunks: ParticleSim;
  puffs: ParticleSim;
  confetti: ParticleSim;
}

/**
 * Spawn the three parts of an explosion at world (x, y): a dirt-chunk burst, an
 * expanding ring of cream puffs and confetti sparks. `radius` is the blast radius in world units.
 */
export function emitExplosion(
  sims: ExplosionSims,
  x: number,
  y: number,
  radius: number,
  rng: () => number = makeRng((x * 7349 + y * 2693) | 0),
): void {
  const r = Math.max(10, radius);
  const nChunks = Math.min(30, Math.round(8 + r * 0.22));
  for (let i = 0; i < nChunks; i++) {
    const a = Math.PI * (0.1 + 0.8 * rng()); // mostly upward fan
    const sp = 180 + rng() * (260 + r * 3);
    sims.chunks.spawn({
      x: x + (rng() - 0.5) * r * 0.5,
      y: y + (rng() - 0.5) * r * 0.3,
      vx: Math.cos(a) * sp * (rng() < 0.5 ? -1 : 1) * 0.8,
      vy: Math.sin(a) * sp,
      size: 9 + rng() * (8 + r * 0.12),
      life: 0.5 + rng() * 0.5,
      color: PALETTE.dirt[Math.floor(rng() * PALETTE.dirt.length)]!,
      spin: (rng() - 0.5) * 16,
      rot: rng() * 6.28,
    });
  }
  const nPuffs = 14;
  for (let i = 0; i < nPuffs; i++) {
    const a = (i / nPuffs) * Math.PI * 2 + rng() * 0.2;
    const sp = r * (2.2 + rng() * 0.8);
    sims.puffs.spawn({
      x: x + Math.cos(a) * r * 0.35,
      y: y + Math.sin(a) * r * 0.35,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size: r * (0.4 + rng() * 0.2),
      life: 0.45 + rng() * 0.15,
      color: PALETTE.puff,
    });
  }
  const nConfetti = Math.min(28, Math.round(10 + r * 0.12));
  for (let i = 0; i < nConfetti; i++) {
    const a = rng() * Math.PI * 2;
    const sp = 200 + rng() * 420;
    sims.confetti.spawn({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp + 120,
      size: 9 + rng() * 6,
      life: 0.8 + rng() * 0.6,
      color: PALETTE.confetti[Math.floor(rng() * PALETTE.confetti.length)]!,
      spin: (rng() - 0.5) * 24,
      rot: rng() * 6.28,
    });
  }
}

/** Screen-shake trauma for a blast of the given radius (small pops barely shake). */
export function shakeForRadius(radius: number): number {
  return Math.min(0.9, 0.12 + radius / 160);
}
