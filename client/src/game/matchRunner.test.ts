import { describe, expect, it } from "vitest";
import type { MatchConfig } from "@burrow-brawl/shared";
import { MatchRunner, type MatchEndInfo } from "./matchRunner";

const cfg: MatchConfig = {
  seed: 7,
  teamSizes: [1, 1],
  turnTicks: 60,
  retreatTicks: 60,
  settleCapTicks: 300,
  startHealth: 100,
  windMax: 0,
  mapWidth: 512,
  mapHeight: 256,
};

describe("MatchRunner", () => {
  it("fires onMatchEnd exactly once when the match is over", () => {
    const runner = new MatchRunner(cfg, (state) => {
      // Knock out team 1 by hand so the win check fires.
      void state;
      return [];
    });
    const ends: MatchEndInfo[] = [];
    runner.onMatchEnd = (i) => ends.push(i);
    runner.state = {
      ...runner.state,
      sim: {
        ...runner.state.sim,
        critters: runner.state.sim.critters.map((c) =>
          c.team === 1 ? { ...c, hp: 0, status: "dead" } : c,
        ),
      },
    };
    // The win check runs when the current turn finishes; skip it along to save time.
    for (let i = 0; i < 400 && ends.length === 0; i++) runner.advance(1000 / 12);
    for (let i = 0; i < 10; i++) runner.advance(1000 / 12);
    expect(ends).toHaveLength(1);
    expect(ends[0]?.winnerTeam).toBe(0);
  });
});
