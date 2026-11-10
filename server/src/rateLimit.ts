/** Fixed-window counter keyed by string (IP, connection id, ...). */
export class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** Records a hit; returns false if the key is over its limit for this window. */
  take(key: string): boolean {
    const t = this.now();
    let e = this.hits.get(key);
    if (!e || t - e.windowStart >= this.windowMs) {
      e = { windowStart: t, count: 0 };
      this.hits.set(key, e);
    }
    e.count++;
    return e.count <= this.limit;
  }

  /** Drop expired windows so the map doesn't grow forever. */
  sweep(): void {
    const t = this.now();
    for (const [k, e] of this.hits) if (t - e.windowStart >= this.windowMs) this.hits.delete(k);
  }
}
