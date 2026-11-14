import type { WebSocket, RawData } from "ws";
import {
  CloseCodes,
  CodecError,
  PROTOCOL_VERSION,
  decode,
  encode,
  normalizeRoomCode,
  parseClientMessage,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
  type ViewServerMessage,
} from "@burrow-brawl/shared/src/net";
import { verifyToken } from "./auth/jwt";
import type { ServerConfig } from "./config";
import { RateLimiter } from "./rateLimit";
import type { Registry } from "./rooms/registry";
import type { LobbyMessage, Peer } from "./rooms/room";

export interface ConnContext {
  config: ServerConfig;
  registry: Registry;
  now: () => number;
  /** Live connection per sub. A newer hello replaces the older connection. */
  live: Map<string, Connection>;
  createLimiter: RateLimiter;
  joinLimiter: RateLimiter;
}

/**
 * Encoded frames by message object. A broadcast hands the same object to every peer, so a big
 * message (a view match.start is up to 2 MB) is serialised once, not once per connection.
 */
const frames = new WeakMap<object, string>();

function frameFor(msg: object): string {
  let f = frames.get(msg);
  if (f === undefined) {
    f = encode(msg);
    frames.set(msg, f);
  }
  return f;
}

export class Connection implements Peer {
  sub: string | null = null;
  nickname = "";
  /** Set by hello.view: this connection draws streamed state and never simulates. */
  view = false;
  private lastSeen: number;
  private pingSentAt: number | null = null;
  private readonly helloTimer: NodeJS.Timeout;
  private readonly frameLimiter: RateLimiter;
  private readonly invalidLimiter: RateLimiter;
  private closed = false;

  constructor(
    private readonly ws: WebSocket,
    readonly ip: string,
    private readonly ctx: ConnContext,
  ) {
    this.lastSeen = ctx.now();
    this.frameLimiter = new RateLimiter(ctx.config.maxFramesPerSecond, 1_000, ctx.now);
    this.invalidLimiter = new RateLimiter(ctx.config.maxInvalidPerMinute, 60_000, ctx.now);
    this.helloTimer = setTimeout(() => {
      if (!this.sub) this.close(CloseCodes.noHello, "no hello");
    }, ctx.config.helloTimeoutMs);
    ws.on("message", (data, isBinary) => this.onFrame(data, isBinary));
    ws.on("pong", () => this.onPong());
    ws.on("close", () => this.onClose());
    ws.on("error", () => ws.terminate());
  }

  // ------------------------------------------------------------ Peer

  send(msg: ServerMessage | ViewServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(frameFor(msg));
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.ws.close(code, reason);
  }

  // ------------------------------------------------------------ heartbeat

  /**
   * Called on the server's heartbeat interval. `stalled` means the server itself was blocked since
   * the last beat, so silence from the peer proves nothing: start the count again.
   */
  heartbeat(stalled = false): void {
    const t = this.ctx.now();
    if (stalled) this.lastSeen = t;
    else if (t - this.lastSeen > this.ctx.config.heartbeatMs * 1.5) {
      this.ws.terminate();
      return;
    }
    this.pingSentAt = t;
    this.ws.ping();
  }

  private onPong(): void {
    const t = this.ctx.now();
    this.lastSeen = t;
    if (this.pingSentAt !== null && this.sub) {
      this.ctx.registry.roomFor(this.sub)?.setPing(this.sub, t - this.pingSentAt);
      this.pingSentAt = null;
    }
  }

  // ------------------------------------------------------------ inbound

  private onFrame(data: RawData, isBinary: boolean): void {
    this.lastSeen = this.ctx.now();
    if (!this.frameLimiter.take("f")) {
      this.error("rate_limited", "too many messages");
      return;
    }
    let raw: unknown;
    try {
      const frame = Array.isArray(data) ? Buffer.concat(data) : data;
      raw = decode(isBinary ? new Uint8Array(frame as ArrayBuffer) : frame.toString());
    } catch (e) {
      this.invalid(e instanceof CodecError ? e.message : "undecodable frame");
      return;
    }
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      const seq =
        typeof (raw as { seq?: unknown })?.seq === "number"
          ? (raw as { seq: number }).seq
          : undefined;
      this.invalid(parsed.error, seq);
      return;
    }
    try {
      this.dispatch(parsed.value);
    } catch (e) {
      console.error("[conn] handler error", e);
      this.error("internal", "internal error", parsed.value.seq);
    }
  }

  private dispatch(msg: ClientMessage): void {
    const re = msg.seq;
    if (msg.t === "hello") {
      this.onHello(msg);
      return;
    }
    if (!this.sub) {
      this.error("unauthorized", "send hello first", re);
      return;
    }
    const sub = this.sub;
    const { registry } = this.ctx;

    switch (msg.t) {
      case "ping":
        this.send({
          t: "pong",
          ...(re === undefined ? {} : { re }),
          clientTime: msg.clientTime,
          serverTime: this.ctx.now(),
        });
        return;

      case "room.create":
        if (!this.ctx.createLimiter.take(this.ip))
          return this.error("rate_limited", "too many rooms", re);
        registry.create(sub, this.nickname, this, re);
        return;

      case "room.join": {
        if (!this.ctx.joinLimiter.take(this.ip))
          return this.error("rate_limited", "too many joins", re);
        const code = normalizeRoomCode(msg.code);
        if (!code) return this.error("room_not_found", "no such room", re);
        const err = registry.join(sub, this.nickname, code, this, re);
        if (err) this.error(err, describe(err), re);
        return;
      }

      case "room.leave":
        registry.leave(sub);
        this.send({ t: "room.left", reason: "left" });
        return;

      default: {
        const room = registry.roomFor(sub);
        if (!room) return this.error("not_in_room", "join a room first", re);
        const err = room.handle(sub, msg as LobbyMessage);
        if (err) this.error(err, describe(err), re);
        else if (re !== undefined) this.send({ t: "ok", re });
      }
    }
  }

  private onHello(msg: Extract<ClientMessage, { t: "hello" }>): void {
    const re = msg.seq;
    if (this.sub) return this.error("bad_message", "already said hello", re);
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      this.error("version_mismatch", `server speaks protocol ${PROTOCOL_VERSION}`, re);
      this.close(CloseCodes.versionMismatch, "version mismatch");
      return;
    }
    const v = verifyToken(msg.token, this.ctx.config.jwtSecret, Math.floor(this.ctx.now() / 1000));
    if (!v.ok) {
      this.error("unauthorized", `token ${v.reason}`, re);
      this.close(CloseCodes.unauthorized, "unauthorized");
      return;
    }
    clearTimeout(this.helloTimer);
    const sub = v.claims.sub;
    this.sub = sub;
    this.nickname = v.claims.nickname;
    this.view = msg.view === true;

    const { registry, live } = this.ctx;
    const previous = live.get(sub);
    live.set(sub, this);
    const resumed =
      msg.resumeToken !== undefined && registry.consumeResumeToken(sub, msg.resumeToken);

    this.send({
      t: "welcome",
      you: { id: sub, nickname: this.nickname },
      serverTime: this.ctx.now(),
      resumeToken: registry.issueResumeToken(sub),
      protocolVersion: PROTOCOL_VERSION,
    });

    // Take the seat back on a valid resume, or when replacing a live
    // connection of the same player (second tab, network switch).
    const room = registry.roomFor(sub);
    if (room && (resumed || previous)) {
      registry.join(sub, this.nickname, room.code, this);
    }
    if (previous && previous !== this)
      previous.close(CloseCodes.replaced, "replaced by a newer connection");
  }

  private onClose(): void {
    this.closed = true;
    clearTimeout(this.helloTimer);
    const sub = this.sub;
    if (!sub) return;
    const { live, registry } = this.ctx;
    if (live.get(sub) === this) {
      live.delete(sub);
      registry.startResumeClock(sub);
    }
    registry.roomFor(sub)?.detach(sub, this);
  }

  // ------------------------------------------------------------ errors

  private error(code: ErrorCode, message: string, re?: number): void {
    this.send(re === undefined ? { t: "error", code, message } : { t: "error", re, code, message });
  }

  private invalid(message: string, re?: number): void {
    this.error("bad_message", message, re);
    if (!this.invalidLimiter.take("i"))
      this.close(CloseCodes.tooManyInvalid, "too many invalid messages");
  }
}

function describe(code: ErrorCode): string {
  switch (code) {
    case "room_not_found":
      return "no such room";
    case "room_full":
      return "room is full";
    case "match_in_progress":
      return "a match is in progress";
    case "team_taken":
      return "that team already has a player";
    case "not_host":
      return "only the host can do that";
    case "not_in_room":
      return "join a room first";
    case "not_allowed":
      return "not allowed right now";
    case "rate_limited":
      return "slow down";
    default:
      return code;
  }
}
