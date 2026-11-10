// Minimal HS256 JWT. Only what we need: sign, verify (alg pinned, exp
// checked, constant-time signature compare). No external dependency.

import { createHmac, timingSafeEqual } from "node:crypto";

export interface SessionClaims {
  /** "guest_<id>" or "user_<id>" */
  sub: string;
  nickname: string;
  iat: number;
  exp: number;
}

const HEADER = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function signToken(claims: SessionClaims, secret: string): string {
  const body = `${HEADER}.${base64url(JSON.stringify(claims))}`;
  return `${body}.${sign(body, secret).toString("base64url")}`;
}

export type VerifyResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

const B64URL = /^[A-Za-z0-9_-]+$/;

export function verifyToken(token: string, secret: string, nowSec: number): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [h, p, s] = parts as [string, string, string];
  if (!B64URL.test(h) || !B64URL.test(p) || !B64URL.test(s))
    return { ok: false, reason: "malformed" };
  // Pin the header byte-for-byte: rejects alg "none", RS/HS confusion, etc.
  if (h !== HEADER) return { ok: false, reason: "malformed" };
  const expected = sign(`${h}.${p}`, secret);
  const given = Buffer.from(s, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" };
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isClaims(claims)) return { ok: false, reason: "malformed" };
  if (claims.exp <= nowSec) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}

function isClaims(c: unknown): c is SessionClaims {
  if (typeof c !== "object" || c === null) return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.sub === "string" &&
    /^(guest|user)_[A-Za-z0-9_-]{8,64}$/.test(o.sub) &&
    typeof o.nickname === "string" &&
    Number.isInteger(o.iat) &&
    Number.isInteger(o.exp)
  );
}
