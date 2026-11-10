// One WebSocket to the game server: hello/auth, resume on reconnect with
// backoff, ping/RTT, seq-tagged requests. All framing goes through the shared
// codec. Knows nothing about rooms or matches; it just delivers messages.

import {
  CloseCodes,
  PROTOCOL_VERSION,
  decode,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "@burrow-brawl/shared/src/net";

/**
 * - connecting: first attempt in progress
 * - waking: the first connection hasn't succeeded yet and we're retrying
 *   (a sleeping free-tier server can take 30 to 60 s); show a "waking the
 *   server" notice
 * - open: hello accepted
 * - reconnecting: we were connected and lost it; retrying with backoff
 * - closed: gave up, or a close code that retrying can't fix
 */
export type ConnectionStatus = "connecting" | "waking" | "open" | "reconnecting" | "closed";

/** Close codes after which reconnecting would not help. */
const FATAL_CLOSES = new Set<number>([
  CloseCodes.replaced,
  CloseCodes.kicked,
  CloseCodes.versionMismatch,
  CloseCodes.unauthorized,
  CloseCodes.tooManyInvalid,
]);

type Reply = Extract<ServerMessage, { t: "ok" } | { t: "error" } | { t: "room.joined" }>;
type Outgoing = ClientMessage extends infer M
  ? M extends { t: "hello" }
    ? never
    : Omit<M, "seq">
  : never;

export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface ConnectionOptions {
  url: string;
  token: string;
  onMessage: (msg: ServerMessage) => void;
  onStatus?: (status: ConnectionStatus, detail?: { code?: number; reason?: string }) => void;
  /** Injected for tests; defaults to the browser WebSocket. */
  createSocket?: (url: string) => WebSocketLike;
  /** Give up reconnecting after this long (ms). */
  reconnectWindowMs?: number;
  /** Before the first successful connection: keep trying this long (ms) for a sleeping server. */
  wakeWindowMs?: number;
  pingIntervalMs?: number;
  now?: () => number;
  random?: () => number;
}

const OPEN = 1;

export class GameConnection {
  status: ConnectionStatus = "connecting";
  /** Smoothed round-trip time in ms. */
  rttMs = 0;
  /** serverTime - localTime, in ms (from pong). */
  clockOffsetMs = 0;
  private ws: WebSocketLike | null = null;
  private resumeToken: string | null = null;
  private seq = 1;
  private readonly waiting = new Map<number, (r: Reply) => void>();
  private readonly queue: string[] = [];
  private attempt = 0;
  private droppedAt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;
  private helloDone = false;
  private everOpened = false;

  constructor(private readonly opts: ConnectionOptions) {}

  private get now(): number {
    return (this.opts.now ?? Date.now)();
  }

  connect(): void {
    this.closedByUs = false;
    this.open();
  }

  /** Send now if connected, otherwise after the next successful hello. */
  send(msg: Outgoing): void {
    this.sendObject(msg);
  }

  private sendObject(msg: object): void {
    const frame = encode(msg);
    if (this.ws?.readyState === OPEN && this.helloDone) this.ws.send(frame);
    else this.queue.push(frame);
  }

  /** Send with a seq and resolve with the server's ok / error / room.joined reply. */
  request(msg: Outgoing, timeoutMs = 10_000): Promise<Reply> {
    const seq = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(seq);
        reject(new Error(`no reply to ${msg.t}`));
      }, timeoutMs);
      this.waiting.set(seq, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.sendObject({ ...msg, seq });
    });
  }

  close(): void {
    this.closedByUs = true;
    this.clearTimers();
    this.ws?.close(1000, "bye");
    this.setStatus("closed");
  }

  // ------------------------------------------------------------ internals

  private open(): void {
    const create =
      this.opts.createSocket ?? ((u: string) => new WebSocket(u) as unknown as WebSocketLike);
    const ws = create(this.opts.url);
    this.ws = ws;
    this.helloDone = false;
    ws.onopen = () => {
      const hello: ClientMessage = {
        t: "hello",
        token: this.opts.token,
        protocolVersion: PROTOCOL_VERSION,
        ...(this.resumeToken ? { resumeToken: this.resumeToken } : {}),
      };
      ws.send(encode(hello));
    };
    ws.onmessage = (ev) => this.onFrame(ev.data);
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = (ev) => this.onClose(ev.code, ev.reason);
  }

  private onFrame(data: unknown): void {
    let msg: ServerMessage;
    try {
      msg = decode(typeof data === "string" ? data : (data as ArrayBuffer)) as ServerMessage;
    } catch {
      return;
    }
    if (msg.t === "welcome") {
      this.resumeToken = msg.resumeToken;
      this.helloDone = true;
      this.everOpened = true;
      this.attempt = 0;
      this.clockOffsetMs = msg.serverTime - this.now;
      for (const f of this.queue.splice(0)) this.ws?.send(f);
      this.startPing();
      this.setStatus("open");
    } else if (msg.t === "pong") {
      const rtt = this.now - msg.clientTime;
      this.rttMs = this.rttMs === 0 ? rtt : this.rttMs * 0.8 + rtt * 0.2;
      this.clockOffsetMs = msg.serverTime + rtt / 2 - this.now;
      return;
    }
    if ((msg.t === "ok" || msg.t === "error" || msg.t === "room.joined") && msg.re !== undefined) {
      const w = this.waiting.get(msg.re);
      if (w) {
        this.waiting.delete(msg.re);
        w(msg);
      }
    }
    this.opts.onMessage(msg);
  }

  private onClose(code: number, reason: string): void {
    this.clearTimers();
    this.ws = null;
    this.helloDone = false;
    if (this.closedByUs) return;
    if (FATAL_CLOSES.has(code)) {
      this.setStatus("closed", { code, reason });
      return;
    }
    if (this.attempt === 0) this.droppedAt = this.now;
    const windowMs = this.everOpened
      ? (this.opts.reconnectWindowMs ?? 5 * 60_000)
      : (this.opts.wakeWindowMs ?? 90_000);
    if (this.now - this.droppedAt > windowMs) {
      this.setStatus("closed", { code, reason: "gave up reconnecting" });
      return;
    }
    // 0.5 s, 1 s, 2 s, 4 s, then every 5 s, with +-20% jitter (protocol section 8).
    const base = Math.min(500 * 2 ** this.attempt, 5_000);
    const delay = base * (0.8 + 0.4 * (this.opts.random ?? Math.random)());
    this.attempt++;
    this.setStatus(this.everOpened ? "reconnecting" : "waking", { code, reason });
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private startPing(): void {
    const every = this.opts.pingIntervalMs ?? 2_000;
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === OPEN) this.ws.send(encode({ t: "ping", clientTime: this.now }));
    }, every);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
  }

  private setStatus(s: ConnectionStatus, detail?: { code?: number; reason?: string }): void {
    this.status = s;
    this.opts.onStatus?.(s, detail);
  }
}
