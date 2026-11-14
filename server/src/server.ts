import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import type { ServerConfig } from "./config";
import { Connection, type ConnContext } from "./conn";
import { clientIp, createHttpHandler, originAllowed } from "./http";
import { RateLimiter } from "./rateLimit";
import { Registry } from "./rooms/registry";

export interface GameServerOptions {
  /** Injectable clock (ms). Defaults to Date.now. */
  now?: () => number;
  codeGen?: () => string;
  /** "manual" stops matches from ticking on their own (tests). */
  ticker?: "realtime" | "manual";
}

export interface GameServer {
  http: Server;
  registry: Registry;
  listen(): Promise<number>;
  close(): Promise<void>;
  /** Run cleanup now (also runs on an interval). */
  sweep(): void;
}

const MAX_CLIENT_FRAME = 64 * 1024;

export function createGameServer(config: ServerConfig, opts: GameServerOptions = {}): GameServer {
  const now = opts.now ?? Date.now;
  const registry = new Registry({
    now,
    resumeWindowMs: config.resumeWindowMs,
    emptyRoomTtlMs: config.emptyRoomTtlMs,
    ...(opts.codeGen ? { codeGen: opts.codeGen } : {}),
    ...(opts.ticker ? { ticker: opts.ticker } : {}),
  });
  const live = new Map<string, Connection>();
  const all = new Set<Connection>();
  const limiters = {
    create: new RateLimiter(config.roomCreatesPerMinutePerIp, 60_000, now),
    join: new RateLimiter(config.roomJoinsPerMinutePerIp, 60_000, now),
    guest: new RateLimiter(config.guestTokensPerMinutePerIp, 60_000, now),
  };
  const ctx: ConnContext = {
    config,
    registry,
    now,
    live,
    createLimiter: limiters.create,
    joinLimiter: limiters.join,
  };

  const http = createServer(
    createHttpHandler({
      config,
      now,
      guestLimiter: limiters.guest,
      stats: () => ({ rooms: registry.roomCount, connections: all.size }),
    }),
  );
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_FRAME });

  http.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== "/ws" || !originAllowed(req.headers.origin, req.headers.host, config)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = new Connection(ws, clientIp(req, config), ctx);
      all.add(conn);
      ws.on("close", () => all.delete(conn));
    });
  });

  // When the beat itself fires late, the server was stalled (for example a big map generating on
  // a slow host), not the clients: their pongs are still queued. Forgive the gap instead of
  // dropping everyone at once. Measured in real time, apart from the (fakeable) clock.
  let lastBeat = performance.now();
  const heartbeat = setInterval(() => {
    const t = performance.now();
    const gap = t - lastBeat;
    const stalled = gap > config.heartbeatMs * 1.5;
    lastBeat = t;
    if (stalled) console.warn(`[server] heartbeat ran ${Math.round(gap)} ms apart; not dropping anyone`);
    for (const c of all) c.heartbeat(stalled);
  }, config.heartbeatMs);
  const sweep = () => {
    registry.sweep();
    for (const l of Object.values(limiters)) l.sweep();
  };
  const sweeper = setInterval(sweep, config.sweepIntervalMs);
  heartbeat.unref();
  sweeper.unref();

  return {
    http,
    registry,
    sweep,
    listen: () =>
      new Promise((res, rej) => {
        http.once("error", rej);
        http.listen(config.port, config.host, () => res((http.address() as AddressInfo).port));
      }),
    close: async () => {
      clearInterval(heartbeat);
      clearInterval(sweeper);
      registry.closeAll();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((res) => wss.close(() => res()));
      await new Promise<void>((res) => http.close(() => res()));
    },
  };
}
