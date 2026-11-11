import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMatch,
  hashMatch,
  saveMatch,
  stepMatch,
  type MatchConfig,
  mapRecipeFor,
} from "@burrow-brawl/shared";
import { CloseCodes, PROTOCOL_VERSION, type ServerMessage } from "@burrow-brawl/shared/src/net";
import { GameConnection, type WebSocketLike } from "./connection";
import { NetMatch } from "./match";
import {
  GuestRefused,
  createGuest,
  ensureSession,
  loadSession,
  saveSession,
  type KeyValueStore,
} from "./session";
import { roomCodeFromPath, serverUrls } from "./urls";

describe("serverUrls", () => {
  it("accepts ws, wss, http and https bases", () => {
    expect(serverUrls("wss://brawl.fly.dev")).toEqual({
      ws: "wss://brawl.fly.dev/ws",
      http: "https://brawl.fly.dev",
    });
    expect(serverUrls("ws://localhost:8080/")).toEqual({
      ws: "ws://localhost:8080/ws",
      http: "http://localhost:8080",
    });
    expect(serverUrls("https://x.dev/game/ws")).toEqual({
      ws: "wss://x.dev/game/ws",
      http: "https://x.dev/game",
    });
    expect(() => serverUrls("ftp://x")).toThrow();
  });

  it("reads invite codes from /r/CODE", () => {
    expect(roomCodeFromPath("/r/k7qx2")).toBe("K7QX2");
    expect(roomCodeFromPath("/r/K7QX2/")).toBe("K7QX2");
    expect(roomCodeFromPath("/rooms")).toBeNull();
  });
});

describe("session", () => {
  function memStore(): KeyValueStore {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  }

  it("caches sessions and drops ones about to expire", () => {
    const s = memStore();
    const now = 1_000_000_000;
    saveSession(
      { token: "t", id: "guest_x", nickname: "Pip", expiresAt: now + 10 * 86_400_000 },
      s,
    );
    expect(loadSession(s, now)?.token).toBe("t");
    expect(loadSession(s, now + 9.5 * 86_400_000)).toBeNull();
    s.setItem("bb.session.v1", "{garbage");
    expect(loadSession(s, now)).toBeNull();
  });

  it("creates guests and surfaces server errors", async () => {
    const ok = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: "t", id: "guest_a", nickname: "Pip", expiresAt: 1 })),
    );
    expect((await createGuest("http://h", "Pip", ok as unknown as typeof fetch)).token).toBe("t");
    expect(ok).toHaveBeenCalledWith(
      "http://h/api/guest",
      expect.objectContaining({ method: "POST" }),
    );
    const bad = vi.fn(
      async () => new Response(JSON.stringify({ error: "name_invalid" }), { status: 400 }),
    );
    await expect(createGuest("http://h", "x", bad as unknown as typeof fetch)).rejects.toThrow(
      "name_invalid",
    );
  });
});

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  // test helpers
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  recv(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
}

const welcome = (resumeToken: string): ServerMessage => ({
  t: "welcome",
  you: { id: "guest_a", nickname: "Pip" },
  serverTime: 0,
  resumeToken,
  protocolVersion: PROTOCOL_VERSION,
});

describe("GameConnection", () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  function make(onMessage = vi.fn(), onStatus = vi.fn()) {
    const conn = new GameConnection({
      url: "ws://h/ws",
      token: "tok",
      onMessage,
      onStatus,
      createSocket: (u) => new FakeSocket(u),
      random: () => 0.5,
    });
    conn.connect();
    return { conn, onMessage, onStatus, sock: () => FakeSocket.all.at(-1)! };
  }

  it("says hello first and flushes queued messages after welcome", () => {
    const { conn, sock } = make();
    conn.send({ t: "room.create" });
    sock().open();
    expect(sock().sent).toEqual([{ t: "hello", token: "tok", protocolVersion: PROTOCOL_VERSION }]);
    sock().recv(welcome("r1"));
    expect(sock().sent.at(-1)).toEqual({ t: "room.create" });
    expect(conn.status).toBe("open");
  });

  it("matches replies to requests by seq", async () => {
    const { conn, sock } = make();
    sock().open();
    sock().recv(welcome("r1"));
    const p = conn.request({ t: "lobby.ready", ready: true });
    const seq = sock().sent.at(-1)!.seq as number;
    sock().recv({ t: "error", re: seq, code: "not_allowed", message: "no" });
    await expect(p).resolves.toMatchObject({ code: "not_allowed" });
  });

  it("reconnects with backoff and resumes with the last resume token", () => {
    const { onStatus, sock } = make();
    sock().open();
    sock().recv(welcome("r1"));
    sock().drop();
    expect(onStatus).toHaveBeenLastCalledWith("reconnecting", expect.anything());
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all).toHaveLength(2);
    sock().drop(); // fails again: next wait is 1 s
    vi.advanceTimersByTime(900);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(200);
    expect(FakeSocket.all).toHaveLength(3);
    sock().open();
    expect(sock().sent[0]).toMatchObject({ t: "hello", resumeToken: "r1" });
  });

  it("does not reconnect after kick, replace or auth failure", () => {
    for (const code of [CloseCodes.kicked, CloseCodes.replaced, CloseCodes.unauthorized]) {
      FakeSocket.all = [];
      const { onStatus, sock } = make();
      sock().open();
      sock().drop(code);
      vi.advanceTimersByTime(10_000);
      expect(FakeSocket.all).toHaveLength(1);
      expect(onStatus).toHaveBeenLastCalledWith("closed", expect.objectContaining({ code }));
    }
  });

  it("measures round trip time from pongs", () => {
    let t = 1000;
    const conn = new GameConnection({
      url: "ws://h/ws",
      token: "tok",
      onMessage: () => {},
      createSocket: (u) => new FakeSocket(u),
      now: () => t,
    });
    conn.connect();
    const s = FakeSocket.all.at(-1)!;
    s.open();
    s.recv(welcome("r"));
    vi.advanceTimersByTime(2000);
    const ping = s.sent.find((m) => m.t === "ping")!;
    t += 80;
    s.recv({ t: "pong", clientTime: ping.clientTime as number, serverTime: 5000 });
    expect(conn.rttMs).toBe(80);
    expect(conn.clockOffsetMs).toBe(5000 + 40 - t);
  });
});

describe("NetMatch", () => {
  const cfg: MatchConfig = {
    seed: 3,
    teamSizes: [1, 1],
    turnTicks: 600,
    retreatTicks: 60,
    settleCapTicks: 600,
    startHealth: 100,
    windMax: 50,
    map: mapRecipeFor(3, 2),
  };

  it("mirrors the server, fast-forwards to the watermark, and sends commands for the current turn", () => {
    const sent: Record<string, unknown>[] = [];
    const nm = new NetMatch({ send: (m) => void sent.push(m as Record<string, unknown>) });
    let server = createMatch(cfg);
    nm.handle({
      t: "match.start",
      matchId: "m",
      config: cfg,
      teamIds: ["t1", "t2"],
      snapshot: saveMatch(server),
    });
    nm.sendCmds([{ k: "move", yaw: 0 }]);
    expect(sent.at(-1)).toEqual({ t: "input", turn: 1, cmds: [{ k: "move", yaw: 0 }] });

    for (let t = 1; t <= 60; t++) {
      server = stepMatch(cfg, server, t === 5 ? [{ k: "move", yaw: 0 }] : []).state;
      if (t % 3 !== 0) continue;
      nm.handle({
        t: "tick",
        upTo: t,
        ...(t === 6 ? { cmds: [{ applyTick: 5, cmds: [{ k: "move", yaw: 0 }] }] } : {}),
        ...(t % 30 === 0 ? { h: hashMatch(server) } : {}),
      });
    }
    // Nothing is simulated until update(), then every confirmed tick at once (no per-frame cap).
    expect(nm.mirror!.tick).toBe(0);
    nm.update();
    expect(nm.mirror!.tick).toBe(60);
    expect(hashMatch(nm.mirror!.state)).toBe(hashMatch(server));
    // Never past the watermark.
    nm.update();
    expect(nm.mirror!.tick).toBe(60);
    expect(sent.filter((m) => m.t === "desync")).toHaveLength(0);
  });

  it("reports a desync once", () => {
    const sent: Record<string, unknown>[] = [];
    const nm = new NetMatch({ send: (m) => void sent.push(m as Record<string, unknown>) });
    const server = createMatch(cfg);
    nm.handle({
      t: "match.start",
      matchId: "m",
      config: cfg,
      teamIds: ["t1", "t2"],
      snapshot: saveMatch(server),
    });
    nm.handle({ t: "tick", upTo: 30, h: 12345 });
    nm.update();
    nm.update();
    expect(sent.filter((m) => m.t === "desync")).toEqual([
      { t: "desync", tick: 30, h: expect.any(Number) },
    ]);
  });
});

describe("ensureSession wake-up", () => {
  const ok = { token: "t", id: "g_1", nickname: "Pip", expiresAt: Date.now() + 7 * 86_400_000 };
  const json = (status: number, body: object) =>
    ({ ok: status < 400, status, json: async () => body }) as Response;

  it("retries a sleeping server with backoff and reports waking once", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls <= 2) throw new TypeError("fetch failed");
      if (calls === 3) return json(503, {});
      return json(200, ok);
    }) as unknown as typeof fetch;
    const waits: number[] = [];
    let waking = 0;
    const sess = await ensureSession("http://x", "Pip", fetchImpl, {
      onWaking: () => waking++,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(sess.token).toBe("t");
    expect(calls).toBe(4);
    expect(waits).toEqual([1000, 2000, 4000]);
    expect(waking).toBe(1);
  });

  it("does not retry a refusal and gives up after the wake window", async () => {
    const refuse = (async () => json(400, { error: "bad_nickname" })) as unknown as typeof fetch;
    await expect(ensureSession("http://x", "Pip", refuse)).rejects.toBeInstanceOf(GuestRefused);
    let t = 0;
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(
      ensureSession("http://x", "Pip", down, {
        now: () => t,
        sleep: async (ms) => void (t += ms),
        totalMs: 10_000,
      }),
    ).rejects.toThrow(/did not wake up/);
  });
});

describe("NetMatch playback pacing", () => {
  const cfg: MatchConfig = {
    seed: 3,
    teamSizes: [1, 1],
    turnTicks: 600,
    retreatTicks: 60,
    settleCapTicks: 600,
    startHealth: 100,
    windMax: 50,
    map: mapRecipeFor(3, 2),
  };
  const start = () => {
    const nm = new NetMatch({ send: () => undefined });
    nm.handle({
      t: "match.start",
      matchId: "m",
      config: cfg,
      teamIds: ["a", "b"],
      snapshot: saveMatch(createMatch(cfg)),
    });
    return nm;
  };

  it("plays one tick per 16.7 ms, doubles speed over 10 behind, and jumps over 60", () => {
    const nm = start();
    nm.handle({ t: "tick", upTo: 6 });
    expect(nm.update(1000 / 60)).toHaveLength(1);
    expect(nm.update(1000 / 30)).toHaveLength(2);
    nm.update(1000); // drains the rest, never past the watermark
    expect(nm.mirror!.tick).toBe(6);
    expect(nm.update(1000)).toHaveLength(0);

    nm.handle({ t: "tick", upTo: 30 }); // 24 behind: catch-up speed
    const fast = nm.update(1000 / 60);
    // 2 ticks for one frame (plus at most one carried over from the drained backlog).
    expect(fast.length).toBeGreaterThanOrEqual(2);
    expect(fast.length).toBeLessThanOrEqual(3);
    expect(fast.every((s) => !s.fastForwarded)).toBe(true);

    nm.handle({ t: "tick", upTo: 150 }); // way behind (hidden tab)
    const jump = nm.update(1000 / 60);
    expect(nm.mirror!.tick).toBe(150);
    expect(jump.every((s) => s.fastForwarded)).toBe(true);
  });
});
