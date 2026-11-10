// Authoritative match: runs the shared match model at 60 Hz, stamps the
// active player's commands with the tick they apply on, relays them to
// everyone, confirms ticks, and sends periodic hashes plus full snapshots
// for join, reconnect and desync repair. See docs/protocol.md sections 5 to 8.

import { randomBytes, randomInt } from "node:crypto";
import {
  HASH_EVERY,
  TICKS_PER_SECOND,
  basicTurns,
  createMatch,
  hashMatch,
  saveMatch,
  stepMatch,
  type Cmd,
  type MatchConfig,
  type MatchState,
} from "@burrow-brawl/shared";
import type { ServerMessage } from "@burrow-brawl/shared/src/net";

/** Send confirmations every N ticks (20/s); clients render ~100 ms behind. */
export const CONFIRM_EVERY = 3;
/** Keep stamped commands this many ticks back for late joiners. */
const MAX_PENDING_AHEAD = 4;

export interface MatchHost {
  /** Send to every connected member. */
  broadcast(msg: ServerMessage): void;
  /** Send to one member if connected. */
  sendTo(memberId: string, msg: ServerMessage): void;
  isConnected(memberId: string): boolean;
  /** The match finished; winner is a room team id or null for a draw. */
  onEnd(winnerTeamId: string | null): void;
}

export interface MatchRunnerOptions {
  /** "realtime" runs its own 60 Hz loop; "manual" waits for advance() (tests). */
  ticker: "realtime" | "manual";
}

export class MatchRunner {
  readonly id = randomBytes(8).toString("hex");
  private state: MatchState;
  /** applyTick -> commands, for ticks not simulated yet. */
  private readonly pending = new Map<number, Cmd[]>();
  private lastApplyTick = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastRealTime = 0;
  private acc = 0;
  private ended = false;

  constructor(
    readonly config: MatchConfig,
    /** Room team id for each sim team index. */
    readonly teamIds: string[],
    /** Member id controlling each sim team index. */
    private readonly controllers: string[],
    private readonly host: MatchHost,
    private readonly opts: MatchRunnerOptions,
  ) {
    this.state = createMatch(config);
  }

  static configFor(
    settings: {
      turnSeconds: number;
      retreatSeconds: number;
      crittersPerTeam: number;
      startHealth: number;
      mapSeed: number;
      windMax: number;
    },
    teams: number,
  ): MatchConfig {
    return {
      // mapSeed 0 means "random each match".
      seed: settings.mapSeed !== 0 ? settings.mapSeed : randomInt(1, 0xffffffff),
      teamSizes: new Array<number>(teams).fill(settings.crittersPerTeam),
      turnTicks: settings.turnSeconds * TICKS_PER_SECOND,
      retreatTicks: settings.retreatSeconds * TICKS_PER_SECOND,
      settleCapTicks: 15 * TICKS_PER_SECOND,
      startHealth: settings.startHealth,
      windMax: settings.windMax,
      mapWidth: 2048,
      mapHeight: 1024,
    };
  }

  get tick(): number {
    return this.state.sim.tick;
  }

  get turn(): number {
    return this.state.turns.turn;
  }

  get matchState(): MatchState {
    return this.state;
  }

  start(): void {
    this.host.broadcast(this.startMessage());
    this.checkAbsent();
    if (this.opts.ticker === "realtime") {
      this.lastRealTime = performance.now();
      // 4 ms timer + accumulator: steady 60 Hz without drift, catch up after stalls.
      this.timer = setInterval(() => this.pump(), 4);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Full state for (re)joining clients: snapshot plus commands already stamped. */
  startMessage(): Extract<ServerMessage, { t: "match.start" }> {
    return {
      t: "match.start",
      matchId: this.id,
      config: this.config,
      teamIds: this.teamIds,
      snapshot: saveMatch(this.state),
      pending: [...this.pending.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([applyTick, cmds]) => ({ applyTick, cmds })),
      serverTick: this.tick,
    };
  }

  /** Resend everything a member needs after reconnecting. */
  resync(memberId: string): void {
    this.host.sendTo(memberId, this.startMessage());
  }

  /** Client reported a hash mismatch: send it a snapshot (and log it, it's a bug). */
  onDesync(memberId: string, tick: number, h: number): void {
    console.warn(
      `[match ${this.id}] desync from ${memberId} at tick ${tick} (client hash ${h >>> 0})`,
    );
    this.host.sendTo(memberId, { t: "snapshot", snapshot: saveMatch(this.state) });
    for (const [applyTick, cmds] of [...this.pending.entries()].sort((a, b) => a[0] - b[0])) {
      this.host.sendTo(memberId, { t: "inputs", applyTick, cmds });
    }
  }

  /**
   * Commands from a member. Returns an error code when rejected.
   * Only the controller of the team with control right now may send.
   */
  onInput(memberId: string, turn: number, cmds: Cmd[]): "not_your_turn" | "input_rejected" | null {
    if (this.ended) return "input_rejected";
    const team = basicTurns.activeTeam(this.state.turns);
    if (team === null || this.controllers[team] !== memberId) return "not_your_turn";
    if (turn !== this.state.turns.turn) return "input_rejected";
    if (this.pending.size > MAX_PENDING_AHEAD) return "input_rejected";
    this.stamp(cmds);
    return null;
  }

  /** Run `n` ticks now (manual ticker, or catch-up). */
  advance(n = 1): void {
    for (let i = 0; i < n && !this.ended; i++) this.stepOnce();
  }

  // ------------------------------------------------------------ internals

  private stamp(cmds: Cmd[]): void {
    const applyTick = Math.max(this.tick + 1, this.lastApplyTick);
    this.lastApplyTick = applyTick;
    const list = this.pending.get(applyTick) ?? [];
    list.push(...cmds);
    this.pending.set(applyTick, list);
    this.host.broadcast({ t: "inputs", applyTick, cmds });
  }

  private pump(): void {
    const now = performance.now();
    this.acc = Math.min(this.acc + (now - this.lastRealTime), 250); // cap catch-up after a stall
    this.lastRealTime = now;
    const step = 1000 / TICKS_PER_SECOND;
    while (this.acc >= step && !this.ended) {
      this.acc -= step;
      this.stepOnce();
    }
  }

  private stepOnce(): void {
    const next = this.tick + 1;
    const cmds = this.pending.get(next) ?? [];
    this.pending.delete(next);
    const r = stepMatch(this.config, this.state, cmds);
    this.state = r.state;
    const t = this.tick;

    if (t % HASH_EVERY === 0) this.host.broadcast({ t: "hash", tick: t, h: hashMatch(this.state) });
    else if (t % CONFIRM_EVERY === 0) this.host.broadcast({ t: "ticks", upTo: t });

    if (this.state.turns.phase === "over") {
      this.ended = true;
      this.host.broadcast({ t: "ticks", upTo: t });
      const w = this.state.turns.winnerTeam;
      const winner = w === null ? null : (this.teamIds[w] ?? null);
      this.host.broadcast({ t: "match.end", winnerTeamId: winner, tick: t });
      this.stop();
      this.host.onEnd(winner);
      return;
    }
    if (r.turnChanged) this.checkAbsent();
  }

  /** A turn for a disconnected player is skipped right away (protocol section 8). */
  private checkAbsent(): void {
    const team = basicTurns.activeTeam(this.state.turns);
    if (team === null) return;
    const who = this.controllers[team];
    if (who === undefined || !this.host.isConnected(who)) this.stamp([{ k: "skip" }]);
  }
}
