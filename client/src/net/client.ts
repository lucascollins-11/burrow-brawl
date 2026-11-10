// High-level game client for the UI: one object with typed methods for the
// lobby and match, and events to subscribe to. Wraps GameConnection (socket,
// resume, backoff) and NetMatch (deterministic mirror).
//
//   const game = await GameClient.connect({ nickname: "Pip" });
//   game.on("room", (room) => render(room));
//   const room = await game.createRoom();          // or game.joinRoom("K7QX2")
//   await game.setReady(true);
//   await game.startMatch();                        // host only
//   game.on("matchStart", () => ...); each frame: game.match.update(); read game.match.state

import type {
  ErrorCode,
  MatchSettings,
  RoomState,
  ServerMessage,
  TeamPatch,
} from "@burrow-brawl/shared/src/net";
import type { Cmd } from "@burrow-brawl/shared";
import { GAME_SERVER_URL } from "../config";
import { GameConnection, type ConnectionStatus, type WebSocketLike } from "./connection";
import { NetMatch } from "./match";
import { ensureSession, type Session } from "./session";
import { serverUrls } from "./urls";

/** A request the server refused; `code` is the protocol error code. */
export class NetError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NetError";
  }
}

export interface ChatMessage {
  from: string;
  text: string;
  at: number;
}

export interface GameClientEvents {
  /** Every room change (members, teams, settings, ready, phase). */
  room: (room: RoomState) => void;
  /** We left or were removed from the room. */
  roomLeft: (reason: "left" | "kicked" | "closed") => void;
  chat: (msg: ChatMessage) => void;
  /** Connection state; "reconnecting" means the UI should show a banner. */
  status: (status: ConnectionStatus, detail?: { code?: number; reason?: string }) => void;
  /** A match started, or we got back into one after reconnecting. */
  matchStart: (match: NetMatch) => void;
  matchEnd: (winnerTeamId: string | null) => void;
  /** Server errors not tied to a request (e.g. rejected match input). */
  error: (code: ErrorCode, message: string) => void;
}

type Listeners = { [K in keyof GameClientEvents]: Set<GameClientEvents[K]> };

export interface ConnectOptions {
  nickname: string;
  /** Defaults to VITE_GAME_SERVER_URL. */
  serverUrl?: string;
  /**
   * Status while connecting, before `connect` resolves (later changes also
   * go to the "status" event). "waking" means the server is cold-starting.
   */
  onStatus?: (status: ConnectionStatus, detail?: { code?: number; reason?: string }) => void;
  /** For tests. */
  fetchImpl?: typeof fetch;
  createSocket?: (url: string) => WebSocketLike;
}

export class GameClient {
  room: RoomState | null = null;
  readonly match: NetMatch;
  private readonly listeners: Listeners = {
    room: new Set(),
    roomLeft: new Set(),
    chat: new Set(),
    status: new Set(),
    matchStart: new Set(),
    matchEnd: new Set(),
    error: new Set(),
  };

  private constructor(
    readonly session: Session,
    private readonly conn: GameConnection,
  ) {
    this.match = new NetMatch(conn);
  }

  /** Get (or reuse) a guest session, open the socket and wait for the server's welcome. */
  static async connect(opts: ConnectOptions): Promise<GameClient> {
    // wss://host -> https://host for /api/guest (see serverUrls).
    const urls = serverUrls(opts.serverUrl ?? GAME_SERVER_URL);
    const session = await ensureSession(urls.http, opts.nickname, opts.fetchImpl, {
      onWaking: () => opts.onStatus?.("waking"),
    });
    const ref: { client?: GameClient } = {};
    let ready!: () => void;
    let failed!: (e: Error) => void;
    const opened = new Promise<void>((res, rej) => {
      ready = res;
      failed = rej;
    });
    const conn = new GameConnection({
      url: urls.ws,
      token: session.token,
      ...(opts.createSocket ? { createSocket: opts.createSocket } : {}),
      onMessage: (m) => ref.client?.onMessage(m),
      onStatus: (s, d) => {
        if (s === "open") ready();
        if (s === "closed") failed(new Error(d?.reason || "connection closed"));
        opts.onStatus?.(s, d);
        ref.client?.emit("status", s, d);
      },
    });
    const client = new GameClient(session, conn);
    ref.client = client;
    conn.connect();
    await opened;
    return client;
  }

  get me(): { id: string; nickname: string } {
    return { id: this.session.id, nickname: this.session.nickname };
  }

  get isHost(): boolean {
    return this.room?.hostId === this.session.id;
  }

  on<K extends keyof GameClientEvents>(event: K, cb: GameClientEvents[K]): () => void {
    (this.listeners[event] as Set<GameClientEvents[K]>).add(cb);
    return () => (this.listeners[event] as Set<GameClientEvents[K]>).delete(cb);
  }

  // ------------------------------------------------------------ room

  async createRoom(): Promise<RoomState> {
    return this.expectRoom(await this.conn.request({ t: "room.create" }));
  }

  /** Join by code (case-insensitive). Also takes your seat back after a disconnect. */
  async joinRoom(code: string): Promise<RoomState> {
    return this.expectRoom(await this.conn.request({ t: "room.join", code }));
  }

  leaveRoom(): void {
    this.conn.send({ t: "room.leave" });
  }

  // ------------------------------------------------------------ lobby

  setTeam(teamId: string | null): Promise<void> {
    return this.ok({ t: "lobby.setTeam", teamId });
  }

  editTeam(teamId: string, patch: TeamPatch): Promise<void> {
    return this.ok({ t: "lobby.editTeam", teamId, patch });
  }

  addTeam(): Promise<void> {
    return this.ok({ t: "lobby.addTeam" });
  }

  removeTeam(teamId: string): Promise<void> {
    return this.ok({ t: "lobby.removeTeam", teamId });
  }

  setSettings(patch: Partial<MatchSettings>): Promise<void> {
    return this.ok({ t: "lobby.setSettings", patch });
  }

  setReady(ready: boolean): Promise<void> {
    return this.ok({ t: "lobby.ready", ready });
  }

  kick(memberId: string): Promise<void> {
    return this.ok({ t: "lobby.kick", memberId });
  }

  /** Host only; everyone must be on a team and ready. `matchStart` fires when it begins. */
  startMatch(): Promise<void> {
    return this.ok({ t: "lobby.start" });
  }

  chat(text: string): Promise<void> {
    return this.ok({ t: "chat", text });
  }

  // ------------------------------------------------------------ match

  /** Host only, on the results screen: take the room back to the lobby (phase "lobby"). */
  rematch(): Promise<void> {
    return this.ok({ t: "match.rematch" });
  }

  /** Send commands for your turn; ignored by the server if it's not your turn. */
  sendCmds(cmds: Cmd[]): void {
    this.match.sendCmds(cmds);
  }

  close(): void {
    this.conn.close();
  }

  // ------------------------------------------------------------ internals

  private emit<K extends keyof GameClientEvents>(
    event: K,
    ...args: Parameters<GameClientEvents[K]>
  ): void {
    for (const cb of this.listeners[event])
      (cb as (...a: Parameters<GameClientEvents[K]>) => void)(...args);
  }

  private async ok(msg: Parameters<GameConnection["request"]>[0]): Promise<void> {
    const r = await this.conn.request(msg);
    if (r.t === "error") throw new NetError(r.code, r.message);
  }

  private expectRoom(r: Extract<ServerMessage, { t: "ok" | "error" | "room.joined" }>): RoomState {
    if (r.t === "error") throw new NetError(r.code, r.message);
    if (r.t !== "room.joined") throw new Error("unexpected reply");
    return r.room;
  }

  private onMessage(m: ServerMessage): void {
    if (this.match.handle(m)) {
      if (m.t === "match.start") this.emit("matchStart", this.match);
      if (m.t === "match.end") this.emit("matchEnd", m.winnerTeamId);
      return;
    }
    switch (m.t) {
      case "room.joined":
      case "room.update":
        this.room = m.room;
        this.emit("room", m.room);
        break;
      case "room.left":
        this.room = null;
        this.emit("roomLeft", m.reason);
        break;
      case "chat":
        this.emit("chat", { from: m.from, text: m.text, at: m.at });
        break;
      case "error":
        if (m.re === undefined) this.emit("error", m.code, m.message);
        break;
    }
  }
}
