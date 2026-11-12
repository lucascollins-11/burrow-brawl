import { randomBytes } from "node:crypto";

export interface ServerConfig {
  port: number;
  host: string;
  /** HS256 secret for session tokens. Must be at least 32 bytes in production. */
  jwtSecret: string;
  /**
   * Origins allowed to open a WebSocket and call /api. Empty list means
   * "same origin only" (plus requests with no Origin header, like curl).
   * "*" allows any origin (dev only).
   */
  allowedOrigins: string[];
  /** Directory with the built client to serve as static files; null = API/WS only. */
  clientDir: string | null;
  /** Use the X-Forwarded-For header for client IPs (behind Fly/Render proxies). */
  trustProxy: boolean;

  guestTokenTtlSec: number;
  helloTimeoutMs: number;
  /** Server WebSocket ping interval; a connection with no traffic for 1.5x this is dropped. */
  heartbeatMs: number;
  /** How long a disconnected seat (and its resume token) is kept. */
  resumeWindowMs: number;
  /** Delete a room once nobody has been connected for this long. */
  emptyRoomTtlMs: number;
  sweepIntervalMs: number;
  /** Per-connection hard cap. */
  maxFramesPerSecond: number;
  /** Invalid messages per minute before the socket is closed. */
  maxInvalidPerMinute: number;
  roomCreatesPerMinutePerIp: number;
  roomJoinsPerMinutePerIp: number;
  guestTokensPerMinutePerIp: number;
}

export const DEFAULTS: Omit<ServerConfig, "jwtSecret"> = {
  port: 8080,
  host: "0.0.0.0",
  allowedOrigins: [],
  clientDir: null,
  trustProxy: false,
  guestTokenTtlSec: 30 * 24 * 3600,
  helloTimeoutMs: 5_000,
  heartbeatMs: 10_000,
  resumeWindowMs: 5 * 60_000,
  emptyRoomTtlMs: 10 * 60_000,
  sweepIntervalMs: 5_000,
  maxFramesPerSecond: 60,
  maxInvalidPerMinute: 20,
  roomCreatesPerMinutePerIp: 5,
  roomJoinsPerMinutePerIp: 20,
  guestTokensPerMinutePerIp: 10,
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === "production";
  let jwtSecret = env.JWT_SECRET ?? "";
  if (!jwtSecret) {
    if (production) throw new Error("JWT_SECRET must be set in production");
    jwtSecret = randomBytes(32).toString("hex");
    console.warn(
      "[config] JWT_SECRET not set; using a random dev secret (tokens reset on restart)",
    );
  } else if (Buffer.byteLength(jwtSecret) < 32) {
    throw new Error("JWT_SECRET must be at least 32 bytes");
  }
  const origins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (production && origins.includes("*")) {
    throw new Error('ALLOWED_ORIGINS="*" is not allowed in production');
  }
  const port = Number(env.PORT ?? DEFAULTS.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT is invalid");
  // Slow test clients (a software-rendered CI run) can go many seconds between frames.
  const heartbeatMs = Number(env.HEARTBEAT_MS ?? DEFAULTS.heartbeatMs);
  if (!Number.isInteger(heartbeatMs) || heartbeatMs < 1_000 || heartbeatMs > 600_000)
    throw new Error("HEARTBEAT_MS must be 1000..600000");
  return {
    ...DEFAULTS,
    port,
    heartbeatMs,
    host: env.HOST ?? DEFAULTS.host,
    jwtSecret,
    allowedOrigins: origins,
    clientDir: env.CLIENT_DIR || null,
    trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
  };
}
