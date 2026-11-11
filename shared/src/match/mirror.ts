// Client-side follower of the authoritative match. Holds relayed commands by
// tick, advances only up to the tick the server has confirmed, and checks
// the server's periodic hashes. Transport-free so the server tests can run
// it against real sockets and the browser can wire it to its connection.

import {
  HASH_EVERY,
  hashMatch,
  loadMatch,
  stepMatch,
  type Cmd,
  type MatchConfig,
  type MatchSnapshot,
  type MatchState,
} from "./match";
import type { SimEvent } from "../sim3d/api";

const HASH_HISTORY = 8; // hashed ticks to remember

/**
 * The server's watermark (protocol section 6): every tick up to `upTo` is
 * final, `cmds` are the commands stamped since the previous batch (all for
 * ticks <= upTo), and `h` is the state hash at `upTo` when upTo % HASH_EVERY
 * is 0. No client simulates past the newest upTo.
 */
export interface TickBatch {
  upTo: number;
  cmds?: { applyTick: number; cmds: Cmd[] }[];
  h?: number;
}

export interface MirrorStep {
  tick: number;
  events: readonly SimEvent[];
  turnChanged: boolean;
}

export class MatchMirror {
  state: MatchState;
  /** Highest tick the server has confirmed (no more commands will arrive for it). */
  confirmed: number;
  /** Set when a hash didn't match; cleared by the next snapshot. */
  desyncedAt: number | null = null;
  private pending = new Map<number, Cmd[]>();
  private hashes = new Map<number, number>();
  private expected = new Map<number, number>();

  constructor(
    readonly config: MatchConfig,
    snapshot: MatchSnapshot,
  ) {
    this.state = loadMatch(this.config, snapshot);
    this.confirmed = snapshot.sim.tick;
  }

  get tick(): number {
    return this.state.sim.tick;
  }

  /** One watermark batch from the server. Returns false once a mismatch is known. */
  onTick(b: TickBatch): boolean {
    for (const c of b.cmds ?? []) this.onInputs(c.applyTick, c.cmds);
    if (b.h !== undefined) return this.onHash(b.upTo, b.h);
    this.onConfirmed(b.upTo);
    return this.desyncedAt === null;
  }

  /** Commands the server stamped for `applyTick`. */
  onInputs(applyTick: number, cmds: readonly Cmd[]): void {
    if (applyTick <= this.tick) return; // already simulated (we got a newer snapshot)
    const list = this.pending.get(applyTick) ?? [];
    list.push(...cmds);
    this.pending.set(applyTick, list);
  }

  onConfirmed(upTo: number): void {
    if (upTo > this.confirmed) this.confirmed = upTo;
  }

  /** Server hash for `tick`. Returns false once a mismatch is known. */
  onHash(tick: number, h: number): boolean {
    this.onConfirmed(tick);
    const mine = this.hashes.get(tick);
    if (mine !== undefined) {
      if (mine !== h && this.desyncedAt === null) this.desyncedAt = tick;
    } else if (tick > this.tick) {
      this.expected.set(tick, h);
    }
    return this.desyncedAt === null;
  }

  /** Replace local state with the server's (join, reconnect, desync repair). */
  onSnapshot(snapshot: MatchSnapshot): void {
    this.state = loadMatch(this.config, snapshot);
    this.confirmed = Math.max(this.confirmed, snapshot.sim.tick);
    for (const t of [...this.pending.keys()]) if (t <= snapshot.sim.tick) this.pending.delete(t);
    this.hashes.clear();
    this.expected.clear();
    this.desyncedAt = null;
  }

  /**
   * Simulate forward, never past the confirmed tick or `targetTick`.
   * Returns the steps taken (for rendering events and sounds).
   */
  advance(targetTick = Number.POSITIVE_INFINITY): MirrorStep[] {
    const out: MirrorStep[] = [];
    const until = Math.min(this.confirmed, targetTick);
    while (this.tick < until) {
      const next = this.tick + 1;
      const cmds = this.pending.get(next) ?? [];
      this.pending.delete(next);
      const r = stepMatch(this.config, this.state, cmds);
      this.state = r.state;
      // Hashing walks the whole map, so only on the ticks the server hashes.
      if (next % HASH_EVERY === 0) {
        const h = hashMatch(this.state);
        this.hashes.set(next, h);
        this.hashes.delete(next - HASH_EVERY * HASH_HISTORY);
        const want = this.expected.get(next);
        if (want !== undefined) {
          this.expected.delete(next);
          if (want !== h && this.desyncedAt === null) this.desyncedAt = next;
        }
      }
      out.push({ tick: next, events: r.events, turnChanged: r.turnChanged });
    }
    return out;
  }
}
