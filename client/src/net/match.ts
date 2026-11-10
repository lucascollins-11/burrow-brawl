// Online match on the client: feeds server messages into the shared
// MatchMirror, sends the local player's commands, and reports desyncs.
// The render loop calls update() every frame and reads `state`.

import {
  MatchMirror,
  hashMatch,
  type Cmd,
  type MatchState,
  type MirrorStep,
} from "@burrow-brawl/shared";
import type { ServerMessage } from "@burrow-brawl/shared/src/net";
import type { GameConnection } from "./connection";

const STEP_MS = 1000 / 60;
/** Backlog (ticks) above which playback runs at double speed to catch up. */
export const CATCHUP_BACKLOG = 10;
/** Backlog above which we jump straight to the watermark (hidden tab, long stall). */
export const FAST_FORWARD_BACKLOG = 60;

export interface NetStep extends MirrorStep {
  /** Simulated in a fast-forward jump: skip its sounds and effects. */
  fastForwarded: boolean;
}

export class NetMatch {
  private acc = 0;
  mirror: MatchMirror | null = null;
  matchId: string | null = null;
  /** Room team id for each sim team index. */
  teamIds: string[] = [];
  winnerTeamId: string | null | undefined = undefined;
  private desyncReported = -1;

  constructor(private readonly conn: Pick<GameConnection, "send">) {}

  get state(): MatchState | null {
    return this.mirror?.state ?? null;
  }

  /** Feed every server message here. Returns true if it was a match message. */
  handle(msg: ServerMessage): boolean {
    switch (msg.t) {
      case "match.start":
        // Also sent again after a reconnect: rebuild from the snapshot.
        this.matchId = msg.matchId;
        this.teamIds = msg.teamIds;
        this.winnerTeamId = undefined;
        this.mirror = new MatchMirror(msg.config, msg.snapshot);
        return true;
      case "tick":
        this.mirror?.onTick(msg);
        return true;
      case "snapshot":
        this.mirror?.onSnapshot(msg.snapshot);
        return true;
      case "match.end":
        this.winnerTeamId = msg.winnerTeamId;
        this.mirror?.onConfirmed(msg.tick);
        return true;
      default:
        return false;
    }
  }

  /**
   * Play the confirmed backlog at 60 Hz from frame time `dtMs`: one tick per
   * 16.7 ms, double speed when more than CATCHUP_BACKLOG ticks behind, and a
   * jump to the watermark (steps flagged fastForwarded) beyond
   * FAST_FORWARD_BACKLOG. Never drops a tick and never passes the watermark.
   * Without `dtMs` it drains the whole backlog at once (tests, tools).
   */
  update(dtMs?: number): NetStep[] {
    const m = this.mirror;
    if (!m) return [];
    const backlog = m.confirmed - m.tick;
    let steps: NetStep[];
    if (dtMs === undefined) {
      steps = m.advance().map((s) => ({ ...s, fastForwarded: false }));
    } else if (backlog > FAST_FORWARD_BACKLOG) {
      this.acc = 0;
      steps = m.advance().map((s) => ({ ...s, fastForwarded: true }));
    } else {
      const speed = backlog > CATCHUP_BACKLOG ? 2 : 1;
      this.acc += Math.max(0, Math.min(dtMs, 250)) * speed;
      const n = Math.min(Math.floor(this.acc / STEP_MS), backlog);
      // Don't bank time while waiting on the server, or we'd burst later.
      this.acc = n === backlog ? Math.min(this.acc - n * STEP_MS, STEP_MS) : this.acc - n * STEP_MS;
      steps = m.advance(m.tick + n).map((s) => ({ ...s, fastForwarded: false }));
    }
    this.reportDesync();
    return steps;
  }

  /** Send commands for the current turn (the server rejects them if it isn't ours). */
  sendCmds(cmds: Cmd[]): void {
    const m = this.mirror;
    if (!m || cmds.length === 0) return;
    this.conn.send({ t: "input", turn: m.state.turns.turn, cmds });
  }

  private reportDesync(): void {
    const m = this.mirror;
    if (!m || m.desyncedAt === null || m.desyncedAt === this.desyncReported) return;
    this.desyncReported = m.desyncedAt;
    this.conn.send({ t: "desync", tick: m.desyncedAt, h: hashMatch(m.state) });
  }
}
