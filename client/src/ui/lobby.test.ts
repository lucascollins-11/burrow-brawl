import { DEFAULT_SETTINGS, type RoomState } from "@burrow-brawl/shared/src/net";
import { describe, expect, it } from "vitest";
import {
  applyRoom,
  applyRoomLeft,
  backToLobby,
  errorText,
  initialState,
  isHost,
  startBlocker,
  withResult,
} from "./lobbyState";
import { describeResult } from "./resultsView";
import { MockClient } from "./mockClient";
import { inviteUrl, roomCodeFromPath } from "./routes";

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
});

describe("lobby state", () => {
  it("moves to the lobby when a room arrives and records identity", () => {
    const s = applyRoom(initialState, room(), { id: "a", nickname: "A" });
    expect(s.screen).toBe("lobby");
    expect(isHost(s)).toBe(true);
  });
  it("ignores stale updates and switches to starting when the phase leaves the lobby", () => {
    let s = applyRoom(initialState, room({ version: 5 }));
    s = applyRoom(s, room({ version: 3 }));
    expect(s.room?.version).toBe(5);
    s = applyRoom(s, room({ version: 6, phase: "loading" }));
    expect(s.screen).toBe("starting");
  });
  it("maps error codes to friendly text and handles being kicked", () => {
    expect(errorText("room_not_found", "x")).toMatch(/No room/);
    expect(errorText("something_new", "raw message")).toBe("raw message");
    const s = applyRoomLeft({ ...initialState, screen: "lobby" }, "kicked");
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

describe("MockClient", () => {
  it("creates, joins and starts like the real client", async () => {
    const c = new MockClient("Pip");
    const seen: string[] = [];
    c.on("room", (r) => seen.push(r.phase));
    await expect(c.joinRoom("zzzzz")).rejects.toMatchObject({ code: "room_not_found" });
    expect((await c.joinRoom("k7qx2")).code).toBe("K7QX2");
    await c.setReady(true);
    await c.startMatch();
    expect(seen.at(-1)).toBe("loading");
  });
});

describe("results", () => {
  it("shows the results screen and keeps it through results-phase updates", () => {
    let s = applyRoom(initialState, room({ phase: "match" }));
    s = withResult(s, { winnerTeamId: "t2" });
    expect(s.screen).toBe("results");
    s = applyRoom(s, room({ version: 2, phase: "results" }));
    expect(s.screen).toBe("results");
  });
  it("returns to the lobby on a lobby update or when the player asks", () => {
    let s = applyRoom(initialState, room({ phase: "results" }));
    s = withResult(s, { winnerTeamId: null });
    expect(backToLobby(s).screen).toBe("lobby");
    expect(backToLobby(s).result).toBeNull();
    s = applyRoom(s, room({ version: 3, phase: "lobby" }));
    expect(s.screen).toBe("lobby");
    expect(s.result).toBeNull();
  });
  it("describes winner, own win and draw", () => {
    const r = room();
    expect(describeResult(r, { winnerTeamId: "t2" }, "a")).toMatchObject({
      title: "T2 wins!",
      subtitle: "Played by B",
      youWon: false,
    });
    expect(describeResult(r, { winnerTeamId: "t1" }, "a")).toMatchObject({
      title: "You win!",
      youWon: true,
    });
    expect(describeResult(r, { winnerTeamId: null }, "a").title).toMatch(/draw/);
  });
});

describe("local play setup", () => {
  it("clamps teams and critters per team", async () => {
    const { clampLocal } = await import("./localView");
    expect(clampLocal({ teams: 1, size: 0 })).toEqual({ teams: 2, size: 1 });
    expect(clampLocal({ teams: 9, size: 9 })).toEqual({ teams: 4, size: 4 });
    expect(clampLocal({ teams: 3, size: 2 })).toEqual({ teams: 3, size: 2 });
  });
  it("builds a hot-seat config without a server", async () => {
    const { localMatchConfig } = await import("../game/config");
    const c = localMatchConfig(3, 2, 7);
    expect(c.teamSizes).toEqual([2, 2, 2]);
    expect(c.seed).toBe(7);
    expect(c.turnTicks).toBe(45 * 60);
  });
});
