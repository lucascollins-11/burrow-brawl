import type { SimEvent, SimState } from "@burrow-brawl/shared";
import { stepWorld, TICK_RATE } from "@burrow-brawl/shared";

const STEP_MS = 1000 / TICK_RATE;
/** Never simulate more than this many ticks per frame (tab was hidden, slow device). */
const MAX_TICKS_PER_FRAME = 5;

/**
 * Drives the deterministic sim at a fixed 60 Hz from variable-rate frames.
 * Rendering reads `state` directly; the sim never reads the clock.
 */
export class SimRunner {
  private acc = 0;
  readonly recentEvents: SimEvent[] = [];

  constructor(
    public state: SimState,
    private readonly inputsFor: () => Parameters<typeof stepWorld>[1],
  ) {}

  /** Advance by `dtMs` of real time. Returns the events produced. */
  advance(dtMs: number): SimEvent[] {
    this.acc = Math.min(this.acc + dtMs, STEP_MS * MAX_TICKS_PER_FRAME);
    const out: SimEvent[] = [];
    while (this.acc >= STEP_MS) {
      const r = stepWorld(this.state, this.inputsFor());
      this.state = r.state;
      out.push(...r.events);
      this.acc -= STEP_MS;
    }
    this.recentEvents.push(...out);
    if (this.recentEvents.length > 6) this.recentEvents.splice(0, this.recentEvents.length - 6);
    return out;
  }
}
