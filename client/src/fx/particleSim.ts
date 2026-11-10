import { makeRng } from "./rng";

export interface ParticleKindConfig {
  capacity: number;
  gravity: number; // world units / s^2, positive pulls down
  drag: number; // per-second velocity damping 0..1
}

/** Pure CPU particle state (no three.js) so it can be unit tested. Struct-of-arrays, pooled. */
export class ParticleSim {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  readonly size: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly color: Uint32Array;
  count = 0;

  constructor(private readonly cfg: ParticleKindConfig) {
    const n = cfg.capacity;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.size = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.color = new Uint32Array(n);
  }

  /** Spawn one particle. If the pool is full the oldest-slot (index 0) is overwritten. */
  spawn(p: {
    x: number; y: number; vx: number; vy: number; size: number; life: number;
    color: number; spin?: number; rot?: number;
  }): void {
    const i = this.count < this.cfg.capacity ? this.count++ : 0;
    this.x[i] = p.x; this.y[i] = p.y; this.vx[i] = p.vx; this.vy[i] = p.vy;
    this.size[i] = p.size; this.life[i] = p.life; this.age[i] = 0;
    this.color[i] = p.color; this.spin[i] = p.spin ?? 0; this.rot[i] = p.rot ?? 0;
  }

  step(dt: number): void {
    const damp = Math.pow(1 - this.cfg.drag, dt);
    for (let i = 0; i < this.count; ) {
      this.age[i]! += dt;
      if (this.age[i]! >= this.life[i]!) {
        this.swapRemove(i);
        continue;
      }
      this.vy[i]! -= this.cfg.gravity * dt; // world y is up
      this.vx[i]! *= damp;
      this.vy[i]! *= damp;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.rot[i]! += this.spin[i]! * dt;
      i++;
    }
  }

  /** 0 at birth, 1 at death. */
  progress(i: number): number {
    return this.age[i]! / this.life[i]!;
  }

  private swapRemove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (const a of [this.x, this.y, this.vx, this.vy, this.rot, this.spin, this.size, this.age, this.life] as Float32Array[])
      a[i] = a[last]!;
    this.color[i] = this.color[last]!;
  }
}

export { makeRng };
