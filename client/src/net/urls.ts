/**
 * Derive the WebSocket and HTTP endpoints from VITE_GAME_SERVER_URL, which
 * may be given as ws(s):// or http(s):// with or without a trailing /ws.
 */
export interface ServerUrls {
  /** e.g. wss://brawl-server.fly.dev/ws */
  ws: string;
  /** e.g. https://brawl-server.fly.dev (no trailing slash) */
  http: string;
}

export function serverUrls(base: string): ServerUrls {
  const u = new URL(base.trim());
  if (u.protocol === "ws:") u.protocol = "http:";
  else if (u.protocol === "wss:") u.protocol = "https:";
  else if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`VITE_GAME_SERVER_URL must be ws(s):// or http(s)://, got ${base}`);
  }
  const path = u.pathname.replace(/\/+$/, "").replace(/\/ws$/, "");
  const http = `${u.protocol}//${u.host}${path}`;
  const ws = `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}${path}/ws`;
  return { ws, http };
}

/** Room code from an invite path like /r/K7QX2, or null. */
export function roomCodeFromPath(pathname: string): string | null {
  const m = /^\/r\/([A-Za-z0-9]{5})\/?$/.exec(pathname);
  return m ? m[1]!.toUpperCase() : null;
}
