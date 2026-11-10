import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signToken, verifyToken, type SessionClaims } from "./jwt";

const SECRET = "x".repeat(32);
const claims: SessionClaims = { sub: "guest_abcdefgh1234", nickname: "Pip", iat: 1000, exp: 2000 };

function b64(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

describe("jwt", () => {
  it("round-trips claims", () => {
    const t = signToken(claims, SECRET);
    expect(verifyToken(t, SECRET, 1500)).toEqual({ ok: true, claims });
  });

  it("rejects expired tokens", () => {
    const t = signToken(claims, SECRET);
    expect(verifyToken(t, SECRET, 2000)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a wrong secret and a tampered payload", () => {
    const t = signToken(claims, SECRET);
    expect(verifyToken(t, "y".repeat(32), 1500)).toMatchObject({
      ok: false,
      reason: "bad_signature",
    });
    const [h, , s] = t.split(".");
    const forged = `${h}.${b64({ ...claims, sub: "user_admin0000" })}.${s}`;
    expect(verifyToken(forged, SECRET, 1500)).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("rejects alg none and other headers even with a valid HMAC", () => {
    const none = `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`;
    expect(verifyToken(none, SECRET, 1500).ok).toBe(false);
    const h = b64({ alg: "HS512", typ: "JWT" });
    const body = `${h}.${b64(claims)}`;
    const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(verifyToken(`${body}.${sig}`, SECRET, 1500)).toMatchObject({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects garbage and bad claim shapes", () => {
    expect(verifyToken("nope", SECRET, 0).ok).toBe(false);
    expect(verifyToken("a.b.c.d", SECRET, 0).ok).toBe(false);
    const bad = signToken({ ...claims, sub: "admin" }, SECRET);
    expect(verifyToken(bad, SECRET, 1500)).toMatchObject({ ok: false, reason: "malformed" });
  });
});
