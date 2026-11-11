// Authoritative match: runs the shared match model at 60 Hz, stamps the
// active player's commands with the tick they apply on, and every
// CONFIRM_EVERY ticks broadcasts one watermark batch (`tick`: upTo, the
// commands stamped since the last batch, and the hash on HASH_EVERY ticks).
// Full snapshots go out for join, reconnect and desync repair.
// See docs/protocol.md sections 5 to 8.

import { randomBytes, randomInt } from "node:crypto";
import {
  HASH_EVERY,
  TICKS_PER_SECOND,
  MATCH_TURNS,
  createMatch,
  hashMatch,
  mapRecipeFor,
  saveMatch,
  stepMatch,
  type Cmd,
  type MatchConfig,
  type MatchState,
} from "@burrow-brawl/shared";
import type { ServerMessage } from "@burrow-brawl/shared/src/net";

/** Broadcast a watermark batch every N ticks (20/s). */
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
  /** The step function. Tests swap in a throwing one; production always uses stepMatch. */
  step?: typeof stepMatch;
}

export class MatchRunner {
  readonly id = randomBytes(8).toString("hex");
  private state: MatchState;
  /** applyTick -> commands, for ticks not simulated yet. */
  private readonly pending = new Map<number, Cmd[]>();
  /** Stamped commands not yet broadcast; flushed with the next watermark. */
  private outbox: { applyTick: number; cmds: Cmd[] }[] = [];
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
    // mapSeed 0 means "random each match".
    const seed = settings.mapSeed !== 0 ? settings.mapSeed : randomInt(1, 0xffffffff);
    return {
      seed,
      teamSizes: new Array<number>(teams).fill(settings.crittersPerTeam),
      turnTicks: settings.turnSeconds * TICKS_PER_SECOND,
      retreatTicks: settings.retreatSeconds * TICKS_PER_SECOND,
      settleCapTicks: 15 * TICKS_PER_SECOND,
      startHealth: settings.startHealth,
      windMax: settings.windMax,
      map: mapRecipeFor(seed, teams),
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

  /**
   * Full state for (re)joining clients, at the current tick. Commands stamped
   * after it reach them in the next watermark batch (which may also repeat
   * commands the snapshot already includes; mirrors drop those by tick).
   */
  startMessage(): Extract<ServerMessage, { t: "match.start" }> {
    return {
      t: "match.start",
      matchId: this.id,
      config: this.config,
      teamIds: this.teamIds,
      snapshot: saveMatch(this.state),
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
  }

  /**
   * Commands from a member. Returns an error code when rejected.
   * Only the controller of the team with control right now may send.
   */
  onInput(memberId: string, turn: number, cmds: Cmd[]): "not_your_turn" | "input_rejected" | null {
    if (this.ended) return "input_rejected";
    const team = MATCH_TURNS.activeTeam(this.state.turns);
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
    this.outbox.push({ applyTick, cmds });
  }

  /** Broadcast the watermark: everything up to the current tick is final. */
  private flush(withHash: boolean): void {
    const t = this.tick;
    const msg: Extract<ServerMessage, { t: "tick" }> = { t: "tick", upTo: t };
    if (this.outbox.length) msg.cmds = this.outbox;
    if (withHash) msg.h = hashMatch(this.state);
    this.outbox = [];
    this.host.broadcast(msg);
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
    let r: ReturnType<typeof stepMatch>;
    try {
      r = (this.opts.step ?? stepMatch)(this.config, this.state, cmds);
    } catch (err) {
      // A sim bug must end this match only, never the process or other rooms.
      console.error(`[match ${this.id}] step failed at tick ${next}`, err);
      this.ended = true;
      this.host.broadcast({ t: "match.end", winnerTeamId: null, tick: this.tick, reason: "error" });
      this.stop();
      this.host.onEnd(null);
      return;
    }
    this.state = r.state;
    const t = this.tick;

    const over = this.state.turns.phase === "over";
    if (over || t % CONFIRM_EVERY === 0) this.flush(t % HASH_EVERY === 0);

    if (over) {
      this.ended = true;
      const w = this.state.turns.winnerTeam;
      const winner = w === null ? null : (this.teamIds[w] ?? null);
      this.host.broadcast({ t: "match.end", winnerTeamId: winner, tick: t });
      this.stop();
      this.host.onEnd(winner);
      return;
    }
    if (r.turnChanged) this.checkAbsent();
  }

  /**
   * A turn that starts with its controller absent is skipped right away
   * (protocol section 8). Mid-turn drops just let the timer run; a reconnect
   * gets control back for the rest of the turn.
   */
  private checkAbsent(): void {
    const team = MATCH_TURNS.activeTeam(this.state.turns);
    if (team === null || this.state.turns.activeCritter === null) return;
    const who = this.controllers[team];
    if (who === undefined || !this.host.isConnected(who)) this.stamp([{ k: "skip" }]);
  }
}
