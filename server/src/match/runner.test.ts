import { describe, expect, it, vi } from "vitest";
import { stepMatch } from "@burrow-brawl/shared";
import type { ServerMessage } from "@burrow-brawl/shared/src/net";
import { MatchRunner, type MatchHost } from "./runner";

const settings = {
  turnSeconds: 45,
  retreatSeconds: 3,
  crittersPerTeam: 1,
  startHealth: 100,
  mapSeed: 7,
  windMax: 50,
};

function host() {
  const sent: ServerMessage[] = [];
  const ends: (string | null)[] = [];
  const h: MatchHost = {
    broadcast: (m) => sent.push(m),
    broadcastTo: (_kind, m) => sent.push(m as ServerMessage),
    sendTo: () => {},
    isConnected: () => true,
    isView: () => false,
    onEnd: (w) => ends.push(w),
  };
  return { h, sent, ends };
}

describe("MatchRunner step errors", () => {
  it("a throwing step ends only its own match, with an error result", () => {
    const config = MatchRunner.configFor(settings, 2);
    const bad = host();
    const good = host();
    let calls = 0;
    const throwing: typeof stepMatch = (c, s, cmds) => {
      if (++calls === 5) throw new RangeError("i32: 4294967296 is not an int32");
      return stepMatch(c, s, cmds);
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = new MatchRunner(config, ["t1", "t2"], ["m1", "m2"], bad.h, {
      ticker: "manual",
      step: throwing,
    });
    const b = new MatchRunner(config, ["t1", "t2"], ["m1", "m2"], good.h, { ticker: "manual" });
    a.start();
    b.start();

    a.advance(30);
    b.advance(30);

    expect(a.tick).toBe(4); // the fifth step threw; state stays at the last good tick
    expect(bad.sent.at(-1)).toEqual({
      t: "match.end",
      winnerTeamId: null,
      tick: 4,
      reason: "error",
    });
    expect(bad.ends).toEqual([null]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(a.onInput("m1", a.turn, [{ k: "jump" }])).toBe("input_rejected");
    a.advance(10);
    expect(a.tick).toBe(4); // stays ended

    expect(b.tick).toBe(30);
    expect(good.ends).toEqual([]);
    expect(good.sent.some((m) => m.t === "match.end")).toBe(false);
    err.mockRestore();
  });
});

describe("MatchRunner realtime ticker", () => {
  it("wakes once per 3-tick batch and keeps 60 Hz", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    try {
      const out = host();
      const r = new MatchRunner(
        MatchRunner.configFor(settings, 2),
        ["t1", "t2"],
        ["m1", "m2"],
        out.h,
        {
          ticker: "realtime",
        },
      );
      r.start();
      vi.advanceTimersByTime(40);
      expect(r.tick).toBe(0); // no wake before the first batch is due
      vi.advanceTimersByTime(10);
      expect(r.tick).toBe(3);
      const seen: number[] = [];
      for (let i = 0; i < 20; i++) {
        vi.advanceTimersByTime(50);
        seen.push(r.tick);
      }
      // Every wake runs a whole batch, so the tick is always a batch boundary.
      expect(seen.every((t) => t % 3 === 0)).toBe(true);
      expect(r.tick).toBe(63);
      expect(vi.getTimerCount()).toBe(1);
      r.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
