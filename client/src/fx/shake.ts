/**
 * Trauma-based screen shake. Call `add()` when something goes boom, `update(dt)` each frame,
 * then add `offsetX/offsetY` to the camera position just before rendering and subtract after.
 */
export class ScreenShake {
  trauma = 0;
  offsetX = 0;
  offsetY = 0;
  private t = 0;

  constructor(
    /** World units of offset at full trauma. */
    public maxOffset = 28,
    /** Trauma lost per second. */
    public decay = 1.6,
  ) {}

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
    const s = this.trauma * this.trauma; // squared feels punchier
    // Smooth pseudo-noise from sines at unrelated frequencies.
    this.offsetX = s * this.maxOffset * (Math.sin(this.t * 53.1) + Math.sin(this.t * 31.7 + 1)) * 0.5;
    this.offsetY = s * this.maxOffset * (Math.sin(this.t * 47.3 + 2) + Math.sin(this.t * 29.9 + 5)) * 0.5;
  }
}
