import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CloseCodes, PROTOCOL_VERSION } from "@burrow-brawl/shared/src/net";
import { signToken } from "./auth/jwt";
import { startHarness, TEST_SECRET, type Harness, type TestClient } from "./testing/harness";

let h: Harness;
afterEach(async () => {
  await h?.close();
});

/** Host creates a room; returns host and the code. */
async function lobby(n = 1): Promise<{ host: TestClient; code: string; others: TestClient[] }> {
  const host = await h.player("Hosty");
  host.send({ t: "room.create" });
  const { code } = await host.room();
  const others: TestClient[] = [];
  for (let i = 0; i < n - 1; i++) {
    const c = await h.player();
    c.send({ t: "room.join", code });
    await c.next("room.joined");
    others.push(c);
  }
  return { host, code, others };
}

describe("http", () => {
  it("issues guest tokens and validates nicknames", async () => {
    h = await startHarness();
    const g = await h.guest("  Pip ");
    expect(g.nickname).toBe("Pip");
    expect(g.id).toMatch(/^guest_/);
    await expect(h.guest("x")).rejects.toThrow("400");
  });

  it("rate limits guest tokens per IP", async () => {
    h = await startHarness({ guestTokensPerMinutePerIp: 2 });
    await h.guest();
    await h.guest();
    await expect(h.guest()).rejects.toThrow("429");
    h.advance(60_000);
    await expect(h.guest()).resolves.toBeTruthy();
  });

  it("enforces the origin allowlist on /api and /ws", async () => {
    h = await startHarness({ allowedOrigins: ["https://brawl.example"] });
    await expect(h.guest("Pip", { origin: "https://evil.example" })).rejects.toThrow("403");
    await expect(h.guest("Pip", { origin: "https://brawl.example" })).resolves.toBeTruthy();
    await expect(h.client({ origin: "https://evil.example" })).rejects.toThrow("403");
    await expect(h.client({ origin: "https://brawl.example" })).resolves.toBeTruthy();
    // Same origin is always fine (server serving its own client).
    await expect(h.client({ origin: `http://127.0.0.1:${h.port}` })).resolves.toBeTruthy();
  });

  it("answers CORS preflight for allowed origins", async () => {
    h = await startHarness({ allowedOrigins: ["https://brawl.example"] });
    const res = await fetch(`http://127.0.0.1:${h.port}/api/guest`, {
      method: "OPTIONS",
      headers: { origin: "https://brawl.example", "access-control-request-method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://brawl.example");
  });

  it("serves the client with SPA fallback and no path traversal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-client-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html>hi");
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
    h = await startHarness({ clientDir: dir });
    const base = `http://127.0.0.1:${h.port}`;
    expect(await (await fetch(`${base}/`)).text()).toContain("hi");
    expect(await (await fetch(`${base}/r/K7QX2`)).text()).toContain("hi");
    const js = await fetch(`${base}/assets/app.js`);
    expect(js.headers.get("content-type")).toContain("javascript");
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    for (const p of ["/..%2F..%2Fetc%2Fpasswd", "/%2e%2e/%2e%2e/etc/passwd", "/x%00y"]) {
      expect(await (await fetch(`${base}${p}`)).text()).not.toContain("root:");
    }
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});

describe("hello", () => {
  it("closes sockets that never say hello", async () => {
    h = await startHarness({ helloTimeoutMs: 100 });
    const c = await h.client();
    expect(await c.closed).toBe(CloseCodes.noHello);
  });

  it("closes on protocol version mismatch", async () => {
    h = await startHarness();
    const g = await h.guest();
    const c = await h.client();
    c.send({ t: "hello", token: g.token, protocolVersion: PROTOCOL_VERSION + 1 });
    expect((await c.next("error")).code).toBe("version_mismatch");
    expect(await c.closed).toBe(CloseCodes.versionMismatch);
  });

  it("rejects bad and expired tokens", async () => {
    h = await startHarness();
    const c = await h.client();
    c.send({ t: "hello", token: "a.b.c", protocolVersion: PROTOCOL_VERSION });
    expect((await c.next("error")).code).toBe("unauthorized");
    expect(await c.closed).toBe(CloseCodes.unauthorized);

    const nowSec = Math.floor(h.clock.now / 1000);
    const expired = signToken(
      { sub: "guest_aaaaaaaaaa", nickname: "Old", iat: nowSec - 10, exp: nowSec - 1 },
      TEST_SECRET,
    );
    const c2 = await h.client();
    c2.send({ t: "hello", token: expired, protocolVersion: PROTOCOL_VERSION });
    expect((await c2.next("error")).message).toContain("expired");
  });

  it("requires hello before anything else", async () => {
    h = await startHarness();
    const c = await h.client();
    c.send({ t: "room.create", seq: 1 });
    expect(await c.next("error")).toMatchObject({ code: "unauthorized", re: 1 });
  });

  it("answers ping with pong", async () => {
    h = await startHarness();
    const c = await h.player();
    c.send({ t: "ping", seq: 9, clientTime: 123 });
    expect(await c.next("pong")).toMatchObject({ re: 9, clientTime: 123, serverTime: h.clock.now });
  });
});

describe("rooms", () => {
  it("creates a room and lets others join by code, case-insensitively", async () => {
    h = await startHarness();
    const host = await h.player("Hosty");
    host.send({ t: "room.create" });
    const r = await host.room();
    expect(r.code).toMatch(/^[A-HJKMNP-Z2-9]{5}$/);
    expect(r.hostId).toBe(host.id);
    expect(r.teams).toHaveLength(2);
    expect(r.members[0]).toMatchObject({
      id: host.id,
      nickname: "Hosty",
      teamId: "t1",
      connected: true,
    });

    const b = await h.player("Bean");
    b.send({ t: "room.join", code: r.code.toLowerCase() });
    const joined = await b.next("room.joined");
    expect(joined.room.members.map((m) => m.nickname)).toEqual(["Hosty", "Bean"]);
    expect(joined.room.members[1]?.teamId).toBe("t2");
    const seen = await host.room((s) => s.members.length === 2);
    expect(seen.version).toBe(joined.room.version);
  });

  it("errors on unknown codes and full rooms", async () => {
    h = await startHarness();
    const { code } = await lobby(8);
    const late = await h.player();
    expect(await late.request({ t: "room.join", code: "ZZZZZ" })).toMatchObject({
      code: "room_not_found",
    });
    expect(await late.request({ t: "room.join", code })).toMatchObject({ code: "room_full" });
  });

  it("rate limits room creation per IP", async () => {
    h = await startHarness({ roomCreatesPerMinutePerIp: 2 });
    const c = await h.player();
    c.send({ t: "room.create" });
    await c.next("room.joined");
    c.send({ t: "room.create" });
    await c.next("room.joined");
    expect(await c.request({ t: "room.create" })).toMatchObject({ code: "rate_limited" });
  });

  it("removes a player who leaves and deletes empty rooms", async () => {
    h = await startHarness();
    const { host, others, code } = await lobby(2);
    const [b] = others as [TestClient];
    b.send({ t: "room.leave" });
    await b.next("room.left");
    expect((await host.room((s) => s.members.length === 1)).teams[1]?.controllerId).toBeNull();
    host.send({ t: "room.leave" });
    await host.next("room.left");
    expect(h.server.registry.get(code)).toBeUndefined();
  });

  it("rejects joins once the match has started", async () => {
    h = await startHarness();
    const { host, others, code } = await lobby(2);
    const [b] = others as [TestClient];
    b.send({ t: "lobby.ready", ready: true });
    host.send({ t: "lobby.ready", ready: true });
    await host.room((s) => s.members.every((m) => m.ready));
    expect(await host.request({ t: "lobby.start" })).toMatchObject({ t: "ok" });
    const late = await h.player();
    expect(await late.request({ t: "room.join", code })).toMatchObject({
      code: "match_in_progress",
    });
  });
});

describe("lobby", () => {
  it("enforces one player per team", async () => {
    h = await startHarness();
    const { host, others } = await lobby(2);
    const [b] = others as [TestClient];
    expect(await b.request({ t: "lobby.setTeam", teamId: "t1" })).toMatchObject({
      code: "team_taken",
    });
    expect(await b.request({ t: "lobby.setTeam", teamId: null })).toMatchObject({ t: "ok" });
    expect(await host.request({ t: "lobby.setTeam", teamId: "t2" })).toMatchObject({ t: "ok" });
    const r = await b.room((s) => s.teams[1]?.controllerId === host.id);
    expect(r.teams[0]?.controllerId).toBeNull();
    expect(r.members.find((m) => m.id === host.id)?.teamId).toBe("t2");
  });

  it("only the controller or host can edit a team", async () => {
    h = await startHarness();
    const { host, others } = await lobby(3);
    const [b, c] = others as [TestClient, TestClient];
    expect(
      await b.request({ t: "lobby.editTeam", teamId: "t2", patch: { name: "Mudlarks" } }),
    ).toMatchObject({
      t: "ok",
    });
    // c has no team (only 2 teams exist) and is not host.
    expect(
      await c.request({ t: "lobby.editTeam", teamId: "t2", patch: { name: "Nope" } }),
    ).toMatchObject({
      code: "not_allowed",
    });
    expect(
      await host.request({ t: "lobby.editTeam", teamId: "t2", patch: { hatStyle: "chef" } }),
    ).toMatchObject({
      t: "ok",
    });
    const r = await c.room((s) => s.teams[1]?.hatStyle === "chef");
    expect(r.teams[1]?.name).toBe("Mudlarks");
  });

  it("host-only settings and teams, and changes clear ready", async () => {
    h = await startHarness();
    const { host, others } = await lobby(2);
    const [b] = others as [TestClient];
    expect(await b.request({ t: "lobby.setSettings", patch: { turnSeconds: 30 } })).toMatchObject({
      code: "not_host",
    });
    expect(await b.request({ t: "lobby.ready", ready: true })).toMatchObject({ t: "ok" });
    expect(
      await host.request({ t: "lobby.setSettings", patch: { turnSeconds: 30 } }),
    ).toMatchObject({ t: "ok" });
    const r = await b.room((s) => s.settings.turnSeconds === 30);
    expect(r.members.every((m) => !m.ready)).toBe(true);

    for (let i = 0; i < 6; i++) {
      expect(await host.request({ t: "lobby.addTeam" })).toMatchObject({ t: "ok" });
    }
    expect(await host.request({ t: "lobby.addTeam" })).toMatchObject({ code: "not_allowed" });
    const eight = await b.room((s) => s.teams.length === 8);
    expect(new Set(eight.teams.map((t) => t.hatColor)).size).toBe(8);
    expect(await host.request({ t: "lobby.removeTeam", teamId: "t2" })).toMatchObject({ t: "ok" });
    const seven = await b.room((s) => s.teams.length === 7);
    expect(seven.members.find((m) => m.id === b.id)?.teamId).toBeNull();
  });

  it("start needs every member on a team and ready", async () => {
    h = await startHarness();
    const { host, others } = await lobby(3);
    const [b, c] = others as [TestClient, TestClient];
    host.send({ t: "lobby.ready", ready: true });
    b.send({ t: "lobby.ready", ready: true });
    expect(await c.request({ t: "lobby.ready", ready: true })).toMatchObject({
      code: "not_allowed",
    });
    await host.room((s) => s.members.filter((m) => m.ready).length === 2);
    expect(await host.request({ t: "lobby.start" })).toMatchObject({ code: "not_allowed" });
    host.send({ t: "lobby.kick", memberId: c.id });
    expect(await c.closed).toBe(CloseCodes.kicked);
    await host.room((s) => s.members.length === 2);
    expect(await b.request({ t: "lobby.start" })).toMatchObject({ code: "not_host" });
    expect(await host.request({ t: "lobby.start" })).toMatchObject({ t: "ok" });
    expect((await b.room((s) => s.phase === "match")).phase).toBe("match");
    expect(await host.request({ t: "lobby.addTeam" })).toMatchObject({ code: "match_in_progress" });
  });

  it("relays chat with cleaning and a rate limit", async () => {
    h = await startHarness();
    const { host, others } = await lobby(2);
    const [b] = others as [TestClient];
    host.send({ t: "chat", text: " hi\u0000 there " });
    expect(await b.next("chat")).toMatchObject({ from: host.id, text: "hi there" });
    expect(await host.request({ t: "chat", text: "again" })).toMatchObject({
      code: "rate_limited",
    });
    h.advance(1_000);
    expect(await host.request({ t: "chat", text: "again" })).toMatchObject({ t: "ok" });
  });
});

describe("abuse", () => {
  it("closes sockets that keep sending invalid messages", async () => {
    h = await startHarness({ maxInvalidPerMinute: 3 });
    const c = await h.player();
    for (let i = 0; i < 4; i++) c.sendRaw("{bad json");
    expect(await c.closed).toBe(CloseCodes.tooManyInvalid);
  });

  it("drops frames over the per-second cap", async () => {
    h = await startHarness({ maxFramesPerSecond: 3 });
    const c = await h.player();
    for (let i = 0; i < 5; i++) c.send({ t: "ping", clientTime: i });
    expect(await c.next("error")).toMatchObject({ code: "rate_limited" });
  });

  it("refuses frames over 64 KB", async () => {
    h = await startHarness();
    const c = await h.player();
    c.sendRaw(JSON.stringify({ t: "chat", text: "x".repeat(70_000) }));
    expect(await c.closed).toBe(1009);
  });
});

describe("disconnect and reconnect", () => {
  it("keeps the seat and restores it with the resume token", async () => {
    h = await startHarness();
    const { host, others, code } = await lobby(2);
    const [b] = others as [TestClient];
    b.ws.terminate();
    const r = await host.room((s) => s.members.some((m) => m.id === b.id && !m.connected));
    expect(r.members.find((m) => m.id === b.id)?.teamId).toBe("t2");

    h.advance(60_000);
    const b2 = await h.client();
    b2.send({
      t: "hello",
      token: b.token,
      protocolVersion: PROTOCOL_VERSION,
      resumeToken: b.resumeToken,
    });
    const w = await b2.next("welcome");
    expect(w.resumeToken).not.toBe(b.resumeToken);
    const joined = await b2.next("room.joined");
    expect(joined.room.code).toBe(code);
    expect(joined.room.members.find((m) => m.id === b.id)).toMatchObject({
      connected: true,
      teamId: "t2",
    });
    await host.room((s) => s.members.every((m) => m.connected));
  });

  it("an expired or foreign resume token does not restore the seat", async () => {
    h = await startHarness();
    const { host, others } = await lobby(2);
    const [b] = others as [TestClient];
    b.ws.terminate();
    await host.room((s) => s.members.some((m) => !m.connected));
    h.advance(5 * 60_000 + 1);

    const b2 = await h.client();
    b2.send({
      t: "hello",
      token: b.token,
      protocolVersion: PROTOCOL_VERSION,
      resumeToken: b.resumeToken,
    });
    await b2.next("welcome");
    // Someone else's token can't be used either.
    const thief = await h.player();
    thief.ws.close();
    const c = await h.client();
    c.send({
      t: "hello",
      token: thief.token,
      protocolVersion: PROTOCOL_VERSION,
      resumeToken: host.resumeToken,
    });
    await c.next("welcome");
    c.send({ t: "ping", clientTime: 1 });
    await c.next("pong");
    b2.send({ t: "ping", clientTime: 1 });
    await b2.next("pong");
    expect(b2["inbox"].some((m: { t: string }) => m.t === "room.joined")).toBe(false);
    expect(c["inbox"].some((m: { t: string }) => m.t === "room.joined")).toBe(false);
  });

  it("can rejoin a kept seat by code without a resume token", async () => {
    h = await startHarness();
    const { host, others, code } = await lobby(2);
    const [b] = others as [TestClient];
    b.ws.terminate();
    await host.room((s) => s.members.some((m) => !m.connected));
    const b2 = await h.client();
    b2.send({ t: "hello", token: b.token, protocolVersion: PROTOCOL_VERSION });
    await b2.next("welcome");
    b2.send({ t: "room.join", code });
    const r = await b2.next("room.joined");
    expect(r.room.members).toHaveLength(2);
    expect(r.room.members.find((m) => m.id === b.id)?.teamId).toBe("t2");
  });

  it("a second connection replaces the first and takes the seat", async () => {
    h = await startHarness();
    const { host, others } = await lobby(2);
    const [b] = others as [TestClient];
    const b2 = await h.client();
    b2.send({ t: "hello", token: b.token, protocolVersion: PROTOCOL_VERSION });
    await b2.next("welcome");
    await b2.next("room.joined");
    expect(await b.closed).toBe(CloseCodes.replaced);
    // The old socket closing must not mark the new one disconnected.
    b2.send({ t: "room.sync" });
    const r = await b2.room();
    expect(r.members.find((m) => m.id === b.id)?.connected).toBe(true);
    host.send({ t: "room.sync" });
    expect((await host.room()).members.every((m) => m.connected)).toBe(true);
  });

  it("migrates host to the oldest connected member", async () => {
    h = await startHarness();
    const { host, others } = await lobby(3);
    const [b, c] = others as [TestClient, TestClient];
    host.ws.terminate();
    expect((await c.room((s) => s.hostId !== host.id)).hostId).toBe(b.id);
    expect(await b.request({ t: "lobby.addTeam" })).toMatchObject({ t: "ok" });
  });

  it("sweeps expired seats and idle rooms", async () => {
    h = await startHarness();
    const { host, others, code } = await lobby(2);
    const [b] = others as [TestClient];
    b.ws.terminate();
    await host.room((s) => s.members.some((m) => !m.connected));
    h.advance(5 * 60_000);
    h.server.sweep();
    expect((await host.room((s) => s.members.length === 1)).teams[1]?.controllerId).toBeNull();

    host.ws.terminate();
    await new Promise((r) => setTimeout(r, 50));
    h.advance(5 * 60_000);
    h.server.sweep();
    expect(h.server.registry.get(code)).toBeUndefined();
  });

  it("terminates connections that stop answering pings", async () => {
    h = await startHarness({ heartbeatMs: 50 });
    const c = await h.player();
    // Nothing heard from the client for longer than 1.5 heartbeats.
    h.advance(1_000);
    expect(await c.closed).toBe(1006);
  });

  it("keeps everyone connected when the server itself stalls (a big map generating)", async () => {
    h = await startHarness({ heartbeatMs: 50 });
    const c = await h.player();
    // The clock jumps as far as above, but because the event loop was blocked, not the client.
    h.advance(1_000);
    const until = performance.now() + 200;
    while (performance.now() < until) {
      // busy: no timers, no socket reads
    }
    await new Promise((r) => setTimeout(r, 150));
    expect(c.ws.readyState).toBe(c.ws.OPEN);
    c.send({ t: "ping", clientTime: 1 });
    expect(await c.next("pong")).toMatchObject({ t: "pong" });
  });
});
