import type { Cmd, MatchConfig, MatchState, SimEvent } from "@burrow-brawl/shared";
import { createMatch, stepMatch, TICKS_PER_SECOND } from "@burrow-brawl/shared";

const STEP_MS = 1000 / TICKS_PER_SECOND;
/** Never simulate more than this many ticks per frame (tab was hidden, slow device). */
const MAX_TICKS_PER_FRAME = 5;

/**
 * Hot-seat match driver. It runs the exact code path the online match uses
 * (createMatch / stepMatch with Cmds), at a fixed 60 Hz from variable-rate frames.
 */
export class MatchRunner {
  state: MatchState;
  readonly recentEvents: SimEvent[] = [];
  private acc = 0;

  constructor(
    readonly config: MatchConfig,
    private readonly cmdsFor: (state: MatchState) => Cmd[],
  ) {
    this.state = createMatch(config);
  }

  /** Advance by `dtMs` of real time. Returns every event produced. */
  advance(dtMs: number): SimEvent[] {
    this.acc = Math.min(this.acc + dtMs, STEP_MS * MAX_TICKS_PER_FRAME);
    const out: SimEvent[] = [];
    while (this.acc >= STEP_MS) {
      const r = stepMatch(this.config, this.state, this.cmdsFor(this.state));
      this.state = r.state;
      out.push(...r.events);
      this.acc -= STEP_MS;
    }
    this.recentEvents.push(...out);
    if (this.recentEvents.length > 8) this.recentEvents.splice(0, this.recentEvents.length - 8);
    return out;
  }
}
