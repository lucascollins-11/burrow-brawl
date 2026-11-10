import { DEFAULT_SETTINGS, type RoomState, type ServerMessage } from "@burrow-brawl/shared/src/net";
import { describe, expect, it } from "vitest";
import { initialState, isHost, reduce, startBlocker } from "./lobbyState";
import { MockTransport } from "./mockTransport";
import { inviteUrl, roomCodeFromPath } from "./routes";
import { httpBase } from "./guest";

const room = (over: Partial<RoomState> = {}): RoomState => ({
  code: "K7QX2",
  phase: "lobby",
  hostId: "a",
  version: 1,
  settings: { ...DEFAULT_SETTINGS },
  members: [
    { id: "a", nickname: "A", teamId: "t1", ready: true, connected: true, pingMs: 0 },
    { id: "b", nickname: "B", teamId: "t2", ready: true, connected: true, pingMs: 0 },
  ],
  teams: [
    {
      id: "t1",
      name: "T1",
      hatColor: "#f28b82",
      hatStyle: "miner",
      critterNames: ["x"],
      controllerId: "a",
    },
    {
      id: "t2",
      name: "T2",
      hatColor: "#8ab4f8",
      hatStyle: "chef",
      critterNames: ["y"],
      controllerId: "b",
    },
  ],
  ...over,
});

describe("routes", () => {
  it("parses /r/CODE deep links", () => {
    expect(roomCodeFromPath("/r/k7qx2")).toBe("K7QX2");
    expect(roomCodeFromPath("/r/k7qx2/")).toBe("K7QX2");
    expect(roomCodeFromPath("/r/OOOOO")).toBeNull();
    expect(roomCodeFromPath("/")).toBeNull();
    expect(inviteUrl("https://x.dev", "K7QX2")).toBe("https://x.dev/r/K7QX2");
  });
  it("derives http base from ws url", () => {
    expect(httpBase("wss://a.dev/")).toBe("https://a.dev");
    expect(httpBase("ws://localhost:8080")).toBe("http://localhost:8080");
  });
});

describe("lobby reducer", () => {
  it("moves to lobby on room.joined and records identity", () => {
    let s = reduce(initialState, {
      t: "welcome",
      you: { id: "a", nickname: "A" },
      serverTime: 0,
      resumeToken: "",
      protocolVersion: 1,
    });
    s = reduce(s, { t: "room.joined", room: room() });
    expect(s.screen).toBe("lobby");
    expect(isHost(s)).toBe(true);
  });
  it("ignores stale updates and switches to starting when phase leaves lobby", () => {
    let s = reduce(initialState, { t: "room.joined", room: room({ version: 5 }) });
    s = reduce(s, { t: "room.update", room: room({ version: 3 }) });
    expect(s.room?.version).toBe(5);
    s = reduce(s, { t: "room.update", room: room({ version: 6, phase: "loading" }) });
    expect(s.screen).toBe("starting");
  });
  it("maps error codes to friendly text and handles being kicked", () => {
    let s = reduce(initialState, { t: "error", code: "room_not_found", message: "x" });
    expect(s.error).toMatch(/No room/);
    s = reduce({ ...s, screen: "lobby" }, { t: "room.left", reason: "kicked" });
    expect(s.screen).toBe("title");
    expect(s.error).toMatch(/removed/);
  });
});

describe("startBlocker", () => {
  it("explains why start is disabled", () => {
    expect(startBlocker(room())).toBeNull();
    const r = room();
    r.members[1]!.ready = false;
    expect(startBlocker(r)).toMatch(/ready/);
    const r2 = room();
    r2.members[1]!.teamId = null;
    expect(startBlocker(r2)).toMatch(/team/);
    const r3 = room();
    r3.teams[1]!.controllerId = null;
    expect(startBlocker(r3)).toMatch(/2 teams/);
  });
});

describe("MockTransport", () => {
  it("joins, readies up and starts like the real server would", async () => {
    const t = new MockTransport();
    const seen: ServerMessage[] = [];
    t.onMessage((m) => seen.push(m));
    await t.connect();
    t.send({ t: "room.join", code: "zzzzz" });
    expect(seen.at(-1)).toMatchObject({ t: "error", code: "room_not_found" });
    t.send({ t: "room.join", code: "k7qx2" });
    t.send({ t: "lobby.ready", ready: true });
    t.send({ t: "lobby.start" });
    expect(seen.at(-1)).toMatchObject({ t: "room.update", room: { phase: "loading" } });
  });
});
