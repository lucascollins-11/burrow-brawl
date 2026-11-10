import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { validNickname } from "@burrow-brawl/shared/src/net";
import { signToken } from "./auth/jwt";
import type { ServerConfig } from "./config";
import type { RateLimiter } from "./rateLimit";

export interface HttpContext {
  config: ServerConfig;
  now: () => number;
  guestLimiter: RateLimiter;
  stats: () => { rooms: number; connections: number };
}

/**
 * Is a browser on `origin` allowed to talk to us? Requests with no Origin
 * (curl, server-to-server) are allowed: origin checks only stop other
 * websites from using a visitor's browser, they are not authentication.
 */
export function originAllowed(
  origin: string | undefined,
  host: string | undefined,
  config: ServerConfig,
): boolean {
  if (!origin) return true;
  const o = origin.replace(/\/+$/, "");
  if (config.allowedOrigins.includes("*") || config.allowedOrigins.includes(o)) return true;
  // Same origin (server serving its own client in dev or single-host mode).
  try {
    return host !== undefined && new URL(o).host === host;
  } catch {
    return false;
  }
}

export function clientIp(req: IncomingMessage, config: ServerConfig): string {
  if (config.trustProxy) {
    const fwd = req.headers["x-forwarded-for"];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createHttpHandler(ctx: HttpContext) {
  const { config } = ctx;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const origin = req.headers.origin;

    if (url.pathname.startsWith("/api/")) {
      if (!originAllowed(origin, req.headers.host, config))
        return json(res, 403, { error: "origin_not_allowed" });
      if (origin) {
        res.setHeader("access-control-allow-origin", origin);
        res.setHeader("vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-methods": "POST, GET, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
          "access-control-max-age": "600",
        });
        return void res.end();
      }
      if (url.pathname === "/api/guest" && req.method === "POST") return guest(req, res, ctx);
      return json(res, 404, { error: "not_found" });
    }

    if (url.pathname === "/healthz") return json(res, 200, { ok: true, ...ctx.stats() });

    if (config.clientDir && (req.method === "GET" || req.method === "HEAD")) {
      return serveStatic(config.clientDir, url.pathname, req, res);
    }
    json(res, 404, { error: "not_found" });
  };
}

async function guest(req: IncomingMessage, res: ServerResponse, ctx: HttpContext): Promise<void> {
  if (!ctx.guestLimiter.take(clientIp(req, ctx.config)))
    return json(res, 429, { error: "rate_limited" });
  const body = await readBody(req, 1024);
  if (body === null) return json(res, 413, { error: "too_large" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json(res, 400, { error: "bad_json" });
  }
  const nickname = validNickname((parsed as { nickname?: unknown } | null)?.nickname);
  if (!nickname) return json(res, 400, { error: "name_invalid" });
  const iat = Math.floor(ctx.now() / 1000);
  const exp = iat + ctx.config.guestTokenTtlSec;
  const sub = `guest_${randomBytes(12).toString("base64url")}`;
  const token = signToken({ sub, nickname, iat, exp }, ctx.config.jwtSecret);
  json(res, 200, { token, id: sub, nickname, expiresAt: exp * 1000 });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
};

async function serveStatic(
  root: string,
  pathname: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const base = resolve(root);
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(pathname));
  } catch {
    return json(res, 400, { error: "bad_path" });
  }
  let file = resolve(join(base, rel));
  if (file !== base && !file.startsWith(base + sep)) return json(res, 404, { error: "not_found" });
  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, "index.html");
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile()) {
    // SPA fallback for client routes like /r/ABCDE; real missing assets 404.
    if (extname(pathname)) return json(res, 404, { error: "not_found" });
    file = join(base, "index.html");
    info = await stat(file).catch(() => null);
    if (!info?.isFile()) return json(res, 404, { error: "not_found" });
  }
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "content-type": type,
    "content-length": info.size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).pipe(res);
}
