import { beforeAll, describe, expect, it, vi } from "vitest";
import { createMatch, saveMatch, type Cmd, type MatchConfig } from "@burrow-brawl/shared";
import { MatchMirror } from "@burrow-brawl/shared";
import { GameInput } from "./input";
import { OnlineSource } from "./onlineSource";

const config: MatchConfig = {
  seed: 3,
  teamSizes: [1, 1],
  turnTicks: 600,
  retreatTicks: 60,
  settleCapTicks: 300,
  startHealth: 100,
  windMax: 0,
  mapWidth: 512,
  mapHeight: 256,
};

function setup(controllerOfTeam0: string) {
  const mirror = new MatchMirror(config, saveMatch(createMatch(config)));
  const sendCmds = vi.fn<(c: Cmd[]) => void>();
  const net = { mirror, teamIds: ["t0", "t1"], matchId: "m", sendCmds, update: () => [] };
  const room = {
    teams: [
      { id: "t0", controllerId: controllerOfTeam0 },
      { id: "t1", controllerId: "other" },
    ],
  };
  const input = new GameInput();
  const source = new OnlineSource({ me: { id: "me" }, room } as never, net as never, input);
  return { source, input, sendCmds };
}

describe("OnlineSource", () => {
  beforeAll(() => {
    // GameInput listens on window; the test environment is plain node.
    vi.stubGlobal("window", { addEventListener: () => {} });
  });

  it("knows which teams are ours and sends commands only on our turn", () => {
    const mine = setup("me");
    expect([...mine.source.localTeams]).toEqual([0]);
    mine.input.skip();
    mine.source.advance(50);
    expect(mine.sendCmds).toHaveBeenCalledWith([{ k: "skip" }]);

    const theirs = setup("someone-else");
    expect(theirs.source.localTeams.size).toBe(0);
    theirs.input.skip();
    theirs.source.advance(50);
    expect(theirs.sendCmds).not.toHaveBeenCalled();
    expect(theirs.input.enabled).toBe(false);
  });
});
