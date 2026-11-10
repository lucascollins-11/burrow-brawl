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

/** Render this many ticks behind the newest confirmed tick to hide jitter (~100 ms). */
export const INTERP_DELAY_TICKS = 6;

export class NetMatch {
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
        for (const p of msg.pending) this.mirror.onInputs(p.applyTick, p.cmds);
        this.mirror.onConfirmed(msg.serverTick);
        return true;
      case "inputs":
        this.mirror?.onInputs(msg.applyTick, msg.cmds);
        return true;
      case "ticks":
        this.mirror?.onConfirmed(msg.upTo);
        return true;
      case "hash":
        if (this.mirror) {
          this.mirror.onConfirmed(msg.tick);
          this.mirror.advance(msg.tick); // hash checks need us to have reached that tick
          this.mirror.onHash(msg.tick, msg.h);
          this.reportDesync();
        }
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

  /** Advance toward the confirmed tick, staying INTERP_DELAY_TICKS behind it. */
  update(): MirrorStep[] {
    const m = this.mirror;
    if (!m) return [];
    const steps = m.advance(Math.max(m.tick, m.confirmed - INTERP_DELAY_TICKS));
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
