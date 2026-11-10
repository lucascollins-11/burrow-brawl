// Test helpers: an in-process server with a controllable clock, and a
// scripted WebSocket client that queues messages for awaiting.

import WebSocket from "ws";
import {
  PROTOCOL_VERSION,
  decode,
  encode,
  type RoomState,
  type ServerMessage,
} from "@burrow-brawl/shared/src/net";
import { DEFAULTS, type ServerConfig } from "../config";
import { createGameServer, type GameServer } from "../server";

export const TEST_SECRET = "test-secret-test-secret-test-secret-0123";

export interface Harness {
  server: GameServer;
  port: number;
  url: string;
  clock: { now: number };
  advance(ms: number): void;
  guest(
    nickname?: string,
    headers?: Record<string, string>,
  ): Promise<{ token: string; id: string; nickname: string }>;
  client(opts?: { origin?: string }): Promise<TestClient>;
  /** guest + connect + hello. */
  player(nickname?: string): Promise<TestClient>;
  close(): Promise<void>;
}

export async function startHarness(
  overrides: Partial<ServerConfig> = {},
  codes?: string[],
): Promise<Harness> {
  const clock = { now: 1_700_000_000_000 };
  const queue = codes ? [...codes] : undefined;
  const config: ServerConfig = {
    ...DEFAULTS,
    host: "127.0.0.1",
    port: 0,
    jwtSecret: TEST_SECRET,
    heartbeatMs: 60_000,
    sweepIntervalMs: 60_000,
    // Generous by default so unrelated tests don't trip them.
    roomCreatesPerMinutePerIp: 1000,
    roomJoinsPerMinutePerIp: 1000,
    guestTokensPerMinutePerIp: 1000,
    ...overrides,
  };
  const server = createGameServer(config, {
    now: () => clock.now,
    ...(queue ? { codeGen: () => queue.shift() ?? "ZZZZZ" } : {}),
  });
  const port = await server.listen();
  const base = `http://127.0.0.1:${port}`;
  const clients: TestClient[] = [];
  let n = 0;

  const h: Harness = {
    server,
    port,
    url: `ws://127.0.0.1:${port}/ws`,
    clock,
    advance(ms) {
      clock.now += ms;
    },
    async guest(nickname = `Player${++n}`, headers = {}) {
      const res = await fetch(`${base}/api/guest`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ nickname }),
      });
      if (!res.ok) throw new Error(`guest failed: ${res.status}`);
      return (await res.json()) as { token: string; id: string; nickname: string };
    },
    async client(opts = {}) {
      const c = await TestClient.connect(h.url, opts.origin);
      clients.push(c);
      return c;
    },
    async player(nickname) {
      const g = await h.guest(nickname);
      const c = await h.client();
      c.token = g.token;
      c.id = g.id;
      c.send({ t: "hello", token: g.token, protocolVersion: PROTOCOL_VERSION });
      const w = await c.next("welcome");
      c.resumeToken = w.resumeToken;
      return c;
    },
    async close() {
      for (const c of clients) c.ws.terminate();
      await server.close();
    },
  };
  return h;
}

type Msg<T extends ServerMessage["t"]> = Extract<ServerMessage, { t: T }>;

export class TestClient {
  token = "";
  id = "";
  resumeToken = "";
  closeCode: number | null = null;
  readonly closed: Promise<number>;
  private readonly inbox: ServerMessage[] = [];
  private waiters: (() => void)[] = [];

  private constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      this.inbox.push(decode(data.toString()) as ServerMessage);
      this.wake();
    });
    this.closed = new Promise((res) =>
      ws.on("close", (code) => {
        this.closeCode = code;
        this.wake();
        res(code);
      }),
    );
  }

  static connect(url: string, origin?: string): Promise<TestClient> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url, origin ? { origin } : {});
      const c = new TestClient(ws);
      ws.once("open", () => res(c));
      ws.once("error", rej);
      ws.once("unexpected-response", (_req, r) =>
        rej(new Error(`upgrade refused: ${r.statusCode}`)),
      );
    });
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  send(msg: object): void {
    this.ws.send(encode(msg));
  }

  sendRaw(data: string | Buffer): void {
    this.ws.send(data);
  }

  /** Wait for the next message of type `t`, skipping (and dropping) others before it. */
  async next<T extends ServerMessage["t"]>(t: T, timeoutMs = 2_000): Promise<Msg<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t);
      if (i >= 0) {
        const [m] = this.inbox.splice(0, i + 1).slice(-1);
        return m as Msg<T>;
      }
      if (this.closeCode !== null)
        throw new Error(`socket closed (${this.closeCode}) while waiting for ${t}`);
      const left = deadline - Date.now();
      if (left <= 0)
        throw new Error(
          `timed out waiting for ${t}; inbox: ${this.inbox.map((m) => m.t).join(",")}`,
        );
      await new Promise<void>((res) => {
        const timer = setTimeout(res, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          res();
        });
      });
    }
  }

  /** Wait for a room.update / room.joined whose state satisfies `pred`. */
  async room(pred: (r: RoomState) => boolean = () => true, timeoutMs = 2_000): Promise<RoomState> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.inbox.findIndex(
        (m) => (m.t === "room.update" || m.t === "room.joined") && pred(m.room),
      );
      if (i >= 0) {
        const m = this.inbox.splice(0, i + 1).slice(-1)[0] as Msg<"room.update">;
        return m.room;
      }
      if (this.closeCode !== null)
        throw new Error(`socket closed (${this.closeCode}) while waiting for room state`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("timed out waiting for room state");
      await new Promise<void>((res) => {
        const timer = setTimeout(res, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          res();
        });
      });
    }
  }

  /** Send a request with a seq and wait for its ok or error. */
  async request(
    msg: object,
    seq = Math.floor(Math.random() * 1e9),
  ): Promise<Msg<"ok"> | Msg<"error"> | Msg<"room.joined">> {
    this.send({ ...msg, seq });
    const deadline = Date.now() + 2_000;
    for (;;) {
      const i = this.inbox.findIndex(
        (m) =>
          (m.t === "ok" || m.t === "error" || m.t === "room.joined") && "re" in m && m.re === seq,
      );
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Msg<"ok">;
      if (this.closeCode !== null) throw new Error(`socket closed (${this.closeCode})`);
      if (Date.now() > deadline) throw new Error(`no reply to ${JSON.stringify(msg)}`);
      await new Promise<void>((res) => {
        const timer = setTimeout(res, 50);
        this.waiters.push(() => {
          clearTimeout(timer);
          res();
        });
      });
    }
  }

  close(): Promise<number> {
    this.ws.close();
    return this.closed;
  }
}
