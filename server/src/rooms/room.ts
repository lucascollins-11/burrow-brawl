import {
  CHAT_MAX,
  CloseCodes,
  DEFAULT_SETTINGS,
  mapOptions,
  HAT_COLORS,
  HAT_STYLES,
  MAX_CRITTERS,
  MAX_MEMBERS,
  MAX_TEAMS,
  MIN_TEAMS,
  cleanText,
  type ClientMessage,
  type ErrorCode,
  type MatchSettings,
  type Member,
  type RoomPhase,
  type RoomState,
  type ServerMessage,
  type TeamSetup,
  type ViewServerMessage,
} from "@burrow-brawl/shared/src/net";
import type { MatchConfig } from "@burrow-brawl/shared";
import { MatchRunner } from "../match/runner";

/** What a room needs from a live connection. */
export interface Peer {
  /** True for a view client (hello.view); it gets streamed state instead of tick batches. */
  readonly view?: boolean;
  send(msg: ServerMessage | ViewServerMessage): void;
  close(code: number, reason: string): void;
}

interface MemberRec extends Member {
  joinedAt: number;
  disconnectedAt: number | null;
  peer: Peer | null;
  lastChatAt: number;
}

export type LobbyMessage = Extract<
  ClientMessage,
  | { t: `lobby.${string}` }
  | { t: "match.rematch" }
  | { t: "chat" }
  | { t: "room.sync" }
  | { t: "input" }
  | { t: "desync" }
>;

export interface RoomOptions {
  /** Match tick source; tests use "manual" and drive Room.match.advance(). */
  ticker: "realtime" | "manual";
}

const DEFAULT_CRITTER_NAMES = ["Pip", "Nib", "Moss", "Tuck"];
const CHAT_MIN_INTERVAL_MS = 1_000;
/** Practice: this many still target dummies, and long turns with no wind to learn in. */
const PRACTICE_DUMMIES = 3;
const PRACTICE_TURN_SECONDS = 90;
const TICKS_PER_SECOND = 60;

export class Room {
  phase: RoomPhase = "lobby";
  hostId: string;
  version = 0;
  /** Last time any member was connected (for empty-room cleanup). */
  lastActiveAt: number;

  private readonly members = new Map<string, MemberRec>();
  private teams: TeamSetup[] = [];
  private settings: MatchSettings = { ...DEFAULT_SETTINGS };
  private nextTeamNo = 1;
  /** The running match, while phase is "match". */
  match: MatchRunner | null = null;

  constructor(
    readonly code: string,
    hostId: string,
    private readonly now: () => number,
    private readonly onRemove: (id: string) => void = () => {},
    private readonly opts: RoomOptions = { ticker: "realtime" },
  ) {
    this.hostId = hostId;
    this.lastActiveAt = now();
    for (let i = 0; i < MIN_TEAMS; i++) this.teams.push(this.newTeam());
  }

  // ------------------------------------------------------------ queries

  get size(): number {
    return this.members.size;
  }

  has(id: string): boolean {
    return this.members.has(id);
  }

  connectedCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.connected) n++;
    return n;
  }

  state(): RoomState {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      members: [...this.members.values()]
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map(({ id, nickname, teamId, ready, connected, pingMs }) => ({
          id,
          nickname,
          teamId,
          ready,
          connected,
          pingMs,
        })),
      teams: this.teams.map((t) => ({ ...t, critterNames: [...t.critterNames] })),
      settings: { ...this.settings },
      mapOptions: mapOptions(),
      version: this.version,
    };
  }

  // ------------------------------------------------------------ membership

  /**
   * Add a new member, or reattach a known member's new connection.
   * Sends room.joined to them and room.update to everyone else.
   */
  attach(id: string, nickname: string, peer: Peer, re?: number): ErrorCode | null {
    const existing = this.members.get(id);
    // A room.join on the connection that is already seated (e.g. a client that resumed in hello
    // and then also joined): answer it, but don't resend the full match state.
    const alreadyAttached = existing !== undefined && existing.peer === peer;
    if (existing) {
      if (existing.peer && existing.peer !== peer) {
        existing.peer.close(CloseCodes.replaced, "replaced by a newer connection");
      }
      existing.peer = peer;
      existing.connected = true;
      existing.disconnectedAt = null;
      existing.nickname = nickname;
    } else {
      if (this.phase !== "lobby") return "match_in_progress";
      if (this.members.size >= MAX_MEMBERS) return "room_full";
      this.members.set(id, {
        id,
        nickname,
        teamId: null,
        ready: false,
        connected: true,
        pingMs: 0,
        joinedAt: this.joinOrder(),
        disconnectedAt: null,
        peer,
        lastChatAt: 0,
      });
      // First free team, so a fresh lobby is playable without clicks.
      const free = this.teams.find((t) => t.controllerId === null);
      if (free) this.assignTeam(id, free.id);
    }
    if (!this.members.get(this.hostId)?.connected) this.hostId = id;
    this.lastActiveAt = this.now();
    this.bump();
    peer.send(
      re === undefined
        ? { t: "room.joined", room: this.state() }
        : { t: "room.joined", re, room: this.state() },
    );
    this.broadcast({ t: "room.update", room: this.state() }, id);
    // Back into a running match: full snapshot plus stamped commands.
    if (existing && this.match && !alreadyAttached) this.match.resync(id);
    return null;
  }

  /** A connection closed. Only acts if `peer` is still the member's current one. */
  detach(id: string, peer: Peer): void {
    const m = this.members.get(id);
    if (!m || m.peer !== peer) return;
    m.peer = null;
    m.connected = false;
    m.ready = false;
    m.disconnectedAt = this.now();
    if (this.connectedCount() === 0) this.lastActiveAt = this.now();
    if (this.hostId === id) this.migrateHost();
    this.bump();
    this.broadcast({ t: "room.update", room: this.state() });
  }

  remove(id: string, reason: "left" | "kicked" | "closed"): void {
    const m = this.members.get(id);
    if (!m) return;
    if (m.teamId) this.releaseTeam(id);
    this.members.delete(id);
    this.onRemove(id);
    if (m.peer) {
      m.peer.send({ t: "room.left", reason });
      if (reason === "kicked") m.peer.close(CloseCodes.kicked, "kicked by host");
    }
    if (this.hostId === id) this.migrateHost();
    if (this.connectedCount() === 0) this.lastActiveAt = this.now();
    this.bump();
    this.broadcast({ t: "room.update", room: this.state() });
  }

  setPing(id: string, pingMs: number): void {
    const m = this.members.get(id);
    if (m) m.pingMs = Math.round(pingMs);
  }

  /**
   * Drop members whose seat expired. Returns the removed ids.
   * v1: seats only expire in the lobby; O3 decides match behavior.
   */
  sweep(resumeWindowMs: number): string[] {
    const t = this.now();
    const removed: string[] = [];
    if (this.phase !== "lobby") return removed;
    for (const m of [...this.members.values()]) {
      if (!m.connected && m.disconnectedAt !== null && t - m.disconnectedAt >= resumeWindowMs) {
        removed.push(m.id);
        this.remove(m.id, "closed");
      }
    }
    return removed;
  }

  closeAll(): void {
    this.match?.stop();
    this.match = null;
    for (const m of this.members.values()) {
      this.onRemove(m.id);
      if (m.peer) {
        m.peer.send({ t: "room.left", reason: "closed" });
        m.peer.close(CloseCodes.roomClosed, "room closed");
      }
    }
    this.members.clear();
  }

  // ------------------------------------------------------------ lobby

  handle(id: string, msg: LobbyMessage): ErrorCode | null {
    const me = this.members.get(id);
    if (!me) return "not_in_room";
    const lobbyOnly = msg.t.startsWith("lobby.");
    if (lobbyOnly && this.phase !== "lobby") return "match_in_progress";
    const isHost = this.hostId === id;

    switch (msg.t) {
      case "input": {
        if (this.phase !== "match" || !this.match) return "not_allowed";
        return this.match.onInput(id, msg.turn, msg.cmds);
      }

      case "desync":
        if (this.phase !== "match" || !this.match) return "not_allowed";
        this.match.onDesync(id, msg.tick, msg.h);
        return null;

      case "room.sync":
        // No connection attached means this member's seat was not resumed on this socket (for
        // example the resume window passed): say so, so the client joins by code instead of
        // getting an ok with no room.update.
        if (!me.peer) return "not_in_room";
        me.peer.send({ t: "room.update", room: this.state() });
        return null;

      case "chat": {
        const text = cleanText(msg.text).slice(0, CHAT_MAX);
        if (!text) return "bad_message";
        const t = this.now();
        if (t - me.lastChatAt < CHAT_MIN_INTERVAL_MS) return "rate_limited";
        me.lastChatAt = t;
        this.broadcast({ t: "chat", from: id, text, at: t });
        return null;
      }

      case "lobby.setTeam": {
        if (msg.teamId === null) {
          if (me.teamId) this.releaseTeam(id);
        } else {
          const team = this.teams.find((t) => t.id === msg.teamId);
          if (!team) return "bad_message";
          if (team.controllerId !== null && team.controllerId !== id) return "team_taken";
          if (team.controllerId !== id) this.assignTeam(id, team.id);
        }
        me.ready = false;
        break;
      }

      case "lobby.editTeam": {
        const team = this.teams.find((t) => t.id === msg.teamId);
        if (!team) return "bad_message";
        if (team.controllerId !== id && !isHost) return "not_allowed";
        Object.assign(team, msg.patch);
        break;
      }

      case "lobby.addTeam":
        if (!isHost) return "not_host";
        if (this.teams.length >= MAX_TEAMS) return "not_allowed";
        this.teams.push(this.newTeam());
        this.unreadyAll();
        break;

      case "lobby.removeTeam": {
        if (!isHost) return "not_host";
        const team = this.teams.find((t) => t.id === msg.teamId);
        if (!team) return "bad_message";
        if (this.teams.length <= MIN_TEAMS) return "not_allowed";
        if (team.controllerId) this.releaseTeam(team.controllerId);
        this.teams = this.teams.filter((t) => t !== team);
        this.unreadyAll();
        break;
      }

      case "lobby.setSettings":
        if (!isHost) return "not_host";
        this.settings = { ...this.settings, ...msg.patch };
        this.unreadyAll();
        break;

      case "lobby.ready":
        if (msg.ready && !me.teamId) return "not_allowed";
        me.ready = msg.ready;
        break;

      case "lobby.kick": {
        if (!isHost) return "not_host";
        if (msg.memberId === id || !this.members.has(msg.memberId)) return "not_allowed";
        this.remove(msg.memberId, "kicked");
        return null; // remove() already broadcast
      }

      case "match.rematch":
        // Results screen -> lobby, keeping teams and settings.
        if (!isHost) return "not_host";
        if (this.phase !== "results") return "not_allowed";
        this.phase = "lobby";
        this.unreadyAll();
        break;

      case "lobby.start": {
        if (!isHost) return "not_host";
        const members = [...this.members.values()];
        const controlled = this.teams.filter((t) => t.controllerId !== null);
        const everyoneSet = members.every((m) => m.connected && m.teamId !== null && m.ready);
        if (controlled.length < MIN_TEAMS || !everyoneSet) return "not_allowed";
        this.startMatch();
        return null; // startMatch broadcast the new phase
      }

      case "lobby.practice": {
        // One player against target dummies: only for a host alone in the room, with a team.
        if (!isHost) return "not_host";
        const mine = this.teams.find((t) => t.controllerId === id);
        const dummies = this.teams.find((t) => t.controllerId === null);
        if (this.members.size !== 1 || !mine || !dummies) return "not_allowed";
        this.startMatch({ dummies: dummies.id });
        return null;
      }
    }
    this.bump();
    this.broadcast({ t: "room.update", room: this.state() });
    return null;
  }

  // ------------------------------------------------------------ match

  /**
   * Start the match with every controlled team. `practice.dummies` adds that uncontrolled team as
   * target dummies: nobody controls it, so the runner skips its turns.
   */
  private startMatch(practice?: { dummies: string }): void {
    const teams = this.teams.filter((t) => t.controllerId !== null || t.id === practice?.dummies);
    this.phase = "match";
    for (const m of this.members.values()) m.ready = false;
    this.bump();
    this.broadcast({ t: "room.update", room: this.state() });
    const t0 = performance.now();
    let config: MatchConfig;
    try {
      config = this.configFor(teams, practice);
      this.match = this.buildRunner(config, teams);
      this.match.start();
    } catch (err) {
      // Generation or setup failed: say so and put everyone back in the lobby, instead of leaving
      // the room in "match" with no match (which looks like being asked to ready up again).
      console.error(`[room ${this.code}] match failed to start`, err);
      this.match?.stop();
      this.match = null;
      this.phase = "lobby";
      this.bump();
      this.broadcast({
        t: "error",
        code: "internal",
        message: "The match could not start. Try again, or pick another map.",
      });
      this.broadcast({ t: "room.update", room: this.state() });
      return;
    }
    const map = config.map;
    const ms = Math.round(performance.now() - t0);
    console.log(`[room ${this.code}] match started: ${map.theme} ${map.sizeX} in ${ms} ms`);
  }

  private configFor(teams: { id: string }[], practice?: { dummies: string }): MatchConfig {
    const config = MatchRunner.configFor(this.settings, teams.length);
    if (!practice) return config;
    return {
      ...config,
      practice: true,
      dummyTeam: teams.findIndex((t) => t.id === practice.dummies),
      teamSizes: teams.map((t) => (t.id === practice.dummies ? PRACTICE_DUMMIES : 1)),
      turnTicks: PRACTICE_TURN_SECONDS * TICKS_PER_SECOND,
      windMax: 0,
    };
  }

  private buildRunner(
    config: MatchConfig,
    teams: { id: string; controllerId: string | null }[],
  ): MatchRunner {
    return new MatchRunner(
      config,
      teams.map((t) => t.id),
      // "" is nobody: a dummy team's turn starts with its controller absent and is skipped.
      teams.map((t) => t.controllerId ?? ""),
      {
        broadcast: (msg) => this.broadcast(msg),
        broadcastTo: (kind, msg) => {
          for (const m of this.members.values())
            if (m.peer && (m.peer.view === true) === (kind === "view")) m.peer.send(msg);
        },
        sendTo: (memberId, msg) => this.members.get(memberId)?.peer?.send(msg),
        isView: (memberId) => this.members.get(memberId)?.peer?.view === true,
        isConnected: (memberId) => this.members.get(memberId)?.connected ?? false,
        onEnd: () => this.endMatch(),
      },
      { ticker: this.opts.ticker },
    );
  }

  /** The match finished: show results until the host sends match.rematch. */
  private endMatch(): void {
    this.match = null;
    this.phase = "results";
    this.unreadyAll();
    // Members who left during the match free their teams now.
    this.bump();
    this.broadcast({ t: "room.update", room: this.state() });
  }

  // ------------------------------------------------------------ helpers

  private joinSeq = 0;
  private joinOrder(): number {
    // Monotonic even if the clock doesn't move between joins.
    return this.now() * 1000 + (this.joinSeq++ % 1000);
  }

  private bump(): void {
    this.version++;
  }

  private broadcast(msg: ServerMessage, exceptId?: string): void {
    for (const m of this.members.values()) {
      if (m.id !== exceptId && m.peer) m.peer.send(msg);
    }
  }

  private migrateHost(): void {
    const next = [...this.members.values()]
      .filter((m) => m.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) this.hostId = next.id;
  }

  private assignTeam(memberId: string, teamId: string): void {
    const m = this.members.get(memberId);
    const team = this.teams.find((t) => t.id === teamId);
    if (!m || !team) return;
    if (m.teamId) this.releaseTeam(memberId);
    team.controllerId = memberId;
    m.teamId = teamId;
  }

  private releaseTeam(memberId: string): void {
    const m = this.members.get(memberId);
    if (!m?.teamId) return;
    const team = this.teams.find((t) => t.id === m.teamId);
    if (team && team.controllerId === memberId) team.controllerId = null;
    m.teamId = null;
    m.ready = false;
  }

  private unreadyAll(): void {
    for (const m of this.members.values()) m.ready = false;
  }

  private newTeam(): TeamSetup {
    const n = this.nextTeamNo++;
    const used = new Set(this.teams.map((t) => t.hatColor));
    const hatColor = HAT_COLORS.find((c) => !used.has(c)) ?? HAT_COLORS[0];
    return {
      id: `t${n}`,
      name: `Team ${n}`,
      hatColor,
      hatStyle: HAT_STYLES[(n - 1) % HAT_STYLES.length]!,
      critterNames: DEFAULT_CRITTER_NAMES.slice(0, MAX_CRITTERS),
      controllerId: null,
    };
  }
}
