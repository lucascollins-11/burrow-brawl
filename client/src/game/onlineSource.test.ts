import { describe, expect, it, vi } from "vitest";
import {
  createMatch,
  mapRecipeFor,
  saveMatch,
  type Cmd,
  type MatchConfig,
} from "@burrow-brawl/shared";
import { MatchMirror } from "@burrow-brawl/shared";
import { Controls3D } from "../game3d/controls";
import type { Input3D } from "../game3d/input3d";
import { OnlineSource } from "./onlineSource";

const config: MatchConfig = {
  seed: 3,
  teamSizes: [1, 1],
  turnTicks: 600,
  retreatTicks: 60,
  settleCapTicks: 300,
  startHealth: 100,
  windMax: 0,
  map: mapRecipeFor(3, 2),
};

/** Raw input with no keys held. */
const rawInput = {
  consume: () => ({ dx: 0, dy: 0, wheel: 0, actions: [] }),
  axes: () => ({ forward: 0, right: 0 }),
  setAiming: () => {},
} as unknown as Input3D;

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
  const input = new Controls3D(rawInput);
  const source = new OnlineSource({ me: { id: "me" }, room } as never, net as never, input);
  return { source, input, sendCmds };
}

describe("OnlineSource", () => {
  it("knows which teams are ours and sends commands only on our turn", () => {
    const mine = setup("me");
    expect([...mine.source.localTeams]).toEqual([0]);
    mine.source.advance(1); // first frame starts the turn (clears stale input)
    mine.input.skip();
    mine.source.advance(50);
    expect(mine.sendCmds).toHaveBeenCalledWith([{ k: "skip" }]);

    const theirs = setup("someone-else");
    expect(theirs.source.localTeams.size).toBe(0);
    theirs.source.advance(1);
    theirs.input.skip();
    theirs.source.advance(50);
    expect(theirs.sendCmds).not.toHaveBeenCalled();
    expect(theirs.input.enabled).toBe(false);
  });

  it("refuses to start without a match, and follows the mirror a reconnect swaps in", () => {
    const input = new Controls3D(rawInput);
    const net = { mirror: null, teamIds: [], matchId: null, sendCmds: () => {}, update: () => [] };
    expect(() => new OnlineSource({ me: { id: "me" }, room: null }, net as never, input)).toThrow(
      /no match yet/,
    );
    const first = new MatchMirror(config, saveMatch(createMatch(config)));
    const live = { ...net, mirror: first as MatchMirror | null };
    const source = new OnlineSource({ me: { id: "me" }, room: null }, live as never, input);
    const second = new MatchMirror(
      config,
      saveMatch(createMatch({ ...config, seed: 4, map: mapRecipeFor(4, 2) })),
    );
    live.mirror = second;
    expect(source.state).toBe(second.state);
    live.mirror = null;
    expect(() => source.state).toThrow(/no match yet/);
  });
});
